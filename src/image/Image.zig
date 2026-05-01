//! `Bun.Image` — Sharp-shaped image pipeline backed by the statically linked
//! libjpeg-turbo / libspng / libwebp codecs and the highway resize kernel.
//!
//! Shape: the constructor only captures the *input* (path or bytes). Chainable
//! mutators (`resize`, `rotate`, `flip`, `flop`) push ops into a small inline
//! list and return `this`. The actual decode → transform → encode work happens
//! off-thread when `toBuffer()` (or `metadata()`) is awaited, via
//! `jsc.ConcurrentPromiseTask` so the JS thread never blocks on a codec.

const Image = @This();

pub const js = jsc.Codegen.JSImage;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;
pub const toJS = js.toJS;

pub const new = bun.TrivialNew(@This());

source: Source,
ops: bun.BoundedArray(Op, max_ops) = .{},
/// Output settings recorded by `.jpeg()/.png()/.webp()`. `null` means
/// "re-encode in the source format" (set on first decode if still null when a
/// terminal runs).
output: ?codecs.EncodeOptions = null,
/// Populated after a pipeline has run once; lets `.width`/`.height` answer
/// synchronously after the first await.
last_width: i32 = -1,
last_height: i32 = -1,
has_pending_activity: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),

const max_ops = 16;

pub const Source = union(enum) {
    /// Owned by `bun.default_allocator`. Set when the constructor argument was
    /// a typed array / ArrayBuffer / Blob whose bytes were already in memory —
    /// duplicated so the JS object can be GC'd while work runs off-thread.
    bytes: []u8,
    /// Owned by `bun.default_allocator`. Read on the worker thread.
    path: [:0]u8,

    fn deinit(self: *Source) void {
        switch (self.*) {
            .bytes => |b| bun.default_allocator.free(b),
            .path => |p| bun.default_allocator.free(p),
        }
    }
};

pub const Op = union(enum) {
    resize: struct { w: u32, h: u32, filter: codecs.Filter },
    rotate: u32, // 90 / 180 / 270
    flip: void, // vertical
    flop: void, // horizontal
};

// ───────────────────────────── lifecycle ────────────────────────────────────

pub fn constructor(global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*Image {
    const args = callframe.arguments();
    if (args.len < 1 or args[0].isUndefinedOrNull())
        return global.throwInvalidArguments("Image() expects a path, ArrayBuffer, TypedArray or Blob", .{});

    const src = try sourceFromJS(global, args[0]);
    return Image.new(.{ .source = src });
}

pub fn finalize(this: *Image) void {
    this.source.deinit();
    bun.destroy(this);
}

pub fn hasPendingActivity(this: *Image) callconv(.c) bool {
    return this.has_pending_activity.load(.seq_cst) > 0;
}

fn sourceFromJS(global: *jsc.JSGlobalObject, value: jsc.JSValue) bun.JSError!Source {
    // String → file path. Everything else → bytes.
    if (value.isString()) {
        const str = try value.toBunString(global);
        defer str.deref();
        const utf8 = str.toUTF8(bun.default_allocator);
        defer utf8.deinit();
        return .{ .path = try bun.default_allocator.dupeZ(u8, utf8.slice()) };
    }
    if (value.asArrayBuffer(global)) |ab| {
        return .{ .bytes = try bun.default_allocator.dupe(u8, ab.byteSlice()) };
    }
    if (value.as(jsc.WebCore.Blob)) |blob| {
        // Only in-memory blobs for now; FileBlob/S3 callers can `await
        // file.bytes()` first.
        const view = blob.sharedView();
        if (view.len > 0)
            return .{ .bytes = try bun.default_allocator.dupe(u8, view) };
    }
    return global.throwInvalidArguments("Image() input must be a path string, ArrayBuffer, TypedArray or in-memory Blob", .{});
}

// ───────────────────────────── chainable ops ────────────────────────────────

fn pushOp(this: *Image, global: *jsc.JSGlobalObject, op: Op) bun.JSError!void {
    this.ops.append(op) catch
        return global.throw("Image: too many chained operations (max {d})", .{max_ops});
}

pub fn doResize(this: *Image, global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments();
    if (args.len < 1 or !args[0].isNumber())
        return global.throwInvalidArguments("resize(width, height?, options?)", .{});
    const w: u32 = @intFromFloat(@max(1, args[0].asNumber()));
    // 0 height = preserve aspect ratio (resolved at execute time once the
    // source dimensions are known).
    const h: u32 = if (args.len > 1 and args[1].isNumber())
        @intFromFloat(@max(1, args[1].asNumber()))
    else
        0;

    var filter: codecs.Filter = .lanczos3;
    if (args.len > 2 and args[2].isObject()) {
        if (try args[2].get(global, "filter")) |f| {
            if (f.isString()) {
                const s = try f.toBunString(global);
                defer s.deref();
                if (s.eqlComptime("box")) filter = .box //
                else if (s.eqlComptime("bilinear")) filter = .bilinear //
                else if (s.eqlComptime("lanczos3")) filter = .lanczos3 //
                else return global.throwInvalidArguments("resize: filter must be 'box' | 'bilinear' | 'lanczos3'", .{});
            }
        }
    }
    try this.pushOp(global, .{ .resize = .{ .w = w, .h = h, .filter = filter } });
    return callframe.this();
}

pub fn doRotate(this: *Image, global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments();
    if (args.len < 1 or !args[0].isNumber())
        return global.throwInvalidArguments("rotate(degrees) expects 90, 180 or 270", .{});
    const raw: i32 = @intFromFloat(args[0].asNumber());
    const deg: u32 = @intCast(@mod(@mod(raw, 360) + 360, 360));
    if (deg == 0) return callframe.this();
    if (deg != 90 and deg != 180 and deg != 270)
        return global.throwInvalidArguments("rotate: only multiples of 90 are supported", .{});
    try this.pushOp(global, .{ .rotate = deg });
    return callframe.this();
}

pub fn doFlip(this: *Image, global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    try this.pushOp(global, .flip);
    return callframe.this();
}

pub fn doFlop(this: *Image, global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    try this.pushOp(global, .flop);
    return callframe.this();
}

fn setFormat(this: *Image, global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, fmt: codecs.Format) bun.JSError!jsc.JSValue {
    var enc: codecs.EncodeOptions = this.output orelse .{ .format = fmt };
    enc.format = fmt;
    const args = callframe.arguments();
    if (args.len > 0 and args[0].isObject()) {
        const opt = args[0];
        if (try opt.get(global, "quality")) |q| {
            if (q.isNumber()) enc.quality = @intFromFloat(@min(@max(q.asNumber(), 1), 100));
        }
        if (try opt.get(global, "lossless")) |l| enc.lossless = l.toBoolean();
    }
    this.output = enc;
    return callframe.this();
}

pub fn doFormatJpeg(this: *Image, g: *jsc.JSGlobalObject, cf: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.setFormat(g, cf, .jpeg);
}
pub fn doFormatPng(this: *Image, g: *jsc.JSGlobalObject, cf: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.setFormat(g, cf, .png);
}
pub fn doFormatWebp(this: *Image, g: *jsc.JSGlobalObject, cf: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.setFormat(g, cf, .webp);
}

// ───────────────────────────── getters ──────────────────────────────────────

pub fn getWidth(this: *Image, _: *jsc.JSGlobalObject) jsc.JSValue {
    return jsc.JSValue.jsNumber(this.last_width);
}

pub fn getHeight(this: *Image, _: *jsc.JSGlobalObject) jsc.JSValue {
    return jsc.JSValue.jsNumber(this.last_height);
}

// ───────────────────────────── async terminals ──────────────────────────────

pub fn doMetadata(this: *Image, global: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.schedule(global, .metadata, .uint8array);
}

pub fn doToBuffer(this: *Image, global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments();
    var enc: codecs.EncodeOptions = .{ .format = .png };
    if (args.len > 0 and args[0].isObject()) {
        const opt = args[0];
        if (try opt.get(global, "format")) |f| {
            if (f.isString()) {
                const s = try f.toBunString(global);
                defer s.deref();
                if (s.eqlComptime("jpeg") or s.eqlComptime("jpg")) enc.format = .jpeg //
                else if (s.eqlComptime("png")) enc.format = .png //
                else if (s.eqlComptime("webp")) enc.format = .webp //
                else return global.throwInvalidArguments("toBuffer: format must be 'jpeg' | 'png' | 'webp'", .{});
            }
        }
        if (try opt.get(global, "quality")) |q| {
            if (q.isNumber()) enc.quality = @intFromFloat(@min(@max(q.asNumber(), 1), 100));
        }
        if (try opt.get(global, "lossless")) |l| enc.lossless = l.toBoolean();
    }
    return this.schedule(global, .{ .encode = enc }, .uint8array);
}

pub fn doBytes(this: *Image, global: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.schedule(global, .{ .encode = this.output }, .uint8array);
}

pub fn doBlob(this: *Image, global: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.schedule(global, .{ .encode = this.output }, .blob);
}

pub fn doToBase64(this: *Image, global: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.schedule(global, .{ .encode = this.output }, .base64);
}

fn schedule(this: *Image, global: *jsc.JSGlobalObject, kind: PipelineTask.Kind, deliver: PipelineTask.Deliver) bun.JSError!jsc.JSValue {
    // Snapshot the op list — `toBuffer()` can be awaited multiple times and
    // mutators may run between awaits.
    const snap = bun.default_allocator.dupe(Op, this.ops.constSlice()) catch bun.outOfMemory();
    const job = PipelineTask.new(.{
        .image = this,
        .global = global,
        .ops = snap,
        .source = this.snapshotSource(),
        .kind = kind,
        .deliver = deliver,
    });
    _ = this.has_pending_activity.fetchAdd(1, .seq_cst);
    var task = AsyncImageTask.createOnJSThread(bun.default_allocator, global, job);
    task.schedule();
    return task.promise.value();
}

/// The worker thread must not race the JS thread for `this.source`, and a
/// path-backed source needs reading. Either way the worker gets an owned copy.
fn snapshotSource(this: *Image) Source {
    return switch (this.source) {
        .bytes => |b| .{ .bytes = bun.default_allocator.dupe(u8, b) catch bun.outOfMemory() },
        .path => |p| .{ .path = bun.default_allocator.dupeZ(u8, p) catch bun.outOfMemory() },
    };
}

// ───────────────────────────── worker task ──────────────────────────────────

pub const AsyncImageTask = jsc.ConcurrentPromiseTask(PipelineTask);

pub const PipelineTask = struct {
    pub const new = bun.TrivialNew(@This());

    image: *Image,
    global: *jsc.JSGlobalObject,
    source: Source,
    ops: []Op,
    kind: Kind,
    deliver: Deliver,
    result: Result = .{ .err = error.DecodeFailed },

    pub const Deliver = enum { uint8array, blob, base64 };

    pub const Kind = union(enum) {
        /// `null` ⇒ re-encode in the source format (resolved after decode).
        encode: ?codecs.EncodeOptions,
        metadata,
    };

    pub const Result = union(enum) {
        encoded: struct { bytes: []u8, format: codecs.Format },
        meta: struct { w: u32, h: u32, format: codecs.Format },
        err: codecs.Error,
        io_err: bun.sys.Error,
    };

    /// Runs on a `WorkPool` thread. No JSC access.
    pub fn run(this: *PipelineTask) void {
        const input = switch (this.source) {
            .bytes => |b| b,
            .path => |p| switch (bun.sys.File.readFrom(bun.FD.cwd(), p, bun.default_allocator)) {
                .result => |bytes| blk: {
                    // Replace the path with the bytes so deinit frees the
                    // right thing.
                    this.source.deinit();
                    this.source = .{ .bytes = bytes };
                    break :blk bytes;
                },
                .err => |e| {
                    this.result = .{ .io_err = e };
                    return;
                },
            },
        };

        var decoded = codecs.decode(input) catch |e| {
            this.result = .{ .err = e };
            return;
        };
        defer bun.default_allocator.free(decoded.rgba);

        const src_format = codecs.Format.sniff(input) orelse .png;

        if (this.kind == .metadata) {
            this.result = .{ .meta = .{ .w = decoded.width, .h = decoded.height, .format = src_format } };
            return;
        }

        for (this.ops) |op| switch (op) {
            .resize => |r| {
                const dh = if (r.h != 0) r.h else @max(1, r.w * decoded.height / decoded.width);
                const dw = r.w;
                const next = codecs.resize(decoded.rgba, decoded.width, decoded.height, dw, dh, r.filter) catch |e| {
                    this.result = .{ .err = e };
                    return;
                };
                bun.default_allocator.free(decoded.rgba);
                decoded = .{ .rgba = next, .width = dw, .height = dh };
            },
            .rotate => |deg| {
                const next = codecs.rotate(decoded.rgba, decoded.width, decoded.height, deg) catch |e| {
                    this.result = .{ .err = e };
                    return;
                };
                bun.default_allocator.free(decoded.rgba);
                decoded = next;
            },
            .flip, .flop => {
                const next = codecs.flip(decoded.rgba, decoded.width, decoded.height, op == .flop) catch |e| {
                    this.result = .{ .err = e };
                    return;
                };
                bun.default_allocator.free(decoded.rgba);
                decoded.rgba = next;
            },
        };

        const enc: codecs.EncodeOptions = this.kind.encode orelse .{ .format = src_format };
        const out = codecs.encode(decoded.rgba, decoded.width, decoded.height, enc) catch |e| {
            this.result = .{ .err = e };
            return;
        };
        // Stash final dims so the synchronous getters can answer post-await.
        this.image.last_width = @intCast(decoded.width);
        this.image.last_height = @intCast(decoded.height);
        this.result = .{ .encoded = .{ .bytes = out, .format = enc.format } };
    }

    /// Back on the JS thread.
    pub fn then(this: *PipelineTask, promise: *jsc.JSPromise) bun.JSTerminated!void {
        defer this.deinit();
        const global = this.global;
        switch (this.result) {
            .encoded => |enc| switch (this.deliver) {
                .uint8array => try promise.resolve(global, jsc.JSUint8Array.fromBytes(global, enc.bytes)),
                .blob => {
                    var blob = jsc.WebCore.Blob.init(enc.bytes, bun.default_allocator, global);
                    blob.content_type = enc.format.mime();
                    blob.content_type_was_set = true;
                    try promise.resolve(global, jsc.WebCore.Blob.new(blob).toJS(global));
                },
                .base64 => {
                    defer bun.default_allocator.free(enc.bytes);
                    const b64_len = bun.base64.encodeLen(enc.bytes);
                    const b64 = bun.handleOom(bun.default_allocator.alloc(u8, b64_len));
                    defer bun.default_allocator.free(b64);
                    const wrote = bun.base64.encode(b64, enc.bytes);
                    const str = bun.String.createUTF8ForJS(global, b64[0..wrote]) catch
                        return promise.reject(global, error.JSError);
                    try promise.resolve(global, str);
                },
            },
            .meta => |m| {
                this.image.last_width = @intCast(m.w);
                this.image.last_height = @intCast(m.h);
                const obj = jsc.JSValue.createEmptyObject(global, 3);
                obj.put(global, jsc.ZigString.static("width"), jsc.JSValue.jsNumber(m.w));
                obj.put(global, jsc.ZigString.static("height"), jsc.JSValue.jsNumber(m.h));
                obj.put(global, jsc.ZigString.static("format"), jsc.ZigString.init(@tagName(m.format)).toJS(global));
                try promise.resolve(global, obj);
            },
            .err => |e| {
                const msg = switch (e) {
                    error.UnknownFormat => "Image: unrecognised format (expected JPEG, PNG or WebP)",
                    error.DecodeFailed => "Image: decode failed",
                    error.EncodeFailed => "Image: encode failed",
                    error.OutOfMemory => "Image: out of memory",
                };
                try promise.reject(global, global.createErrorInstance("{s}", .{msg}));
            },
            .io_err => |e| try promise.reject(global, e.toJS(global)),
        }
    }

    fn deinit(this: *PipelineTask) void {
        _ = this.image.has_pending_activity.fetchSub(1, .seq_cst);
        this.source.deinit();
        bun.default_allocator.free(this.ops);
        bun.destroy(this);
    }
};

// ───────────────────────────── imports ──────────────────────────────────────

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const codecs = @import("./codecs.zig");
