//! `Bun.Image` — Sharp-shaped image pipeline backed by the statically linked
//! libjpeg-turbo / libspng / libwebp codecs and the highway resize kernel.
//!
//! Shape: the constructor only captures the *input* (path or bytes). Chainable
//! mutators (`resize`, `rotate`, `flip`, `flop`, `jpeg`/`png`/`webp`) each
//! write one slot of `Pipeline` and return `this` — there is no op list, so
//! calling a setter twice overwrites. The actual decode → transform → encode
//! work happens off-thread when a terminal (`bytes`/`blob`/`toBuffer`/
//! `toBase64`/`metadata`) is awaited, via `jsc.ConcurrentPromiseTask`.

const Image = @This();

pub const js = jsc.Codegen.JSImage;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;
pub const toJS = js.toJS;

pub const new = bun.TrivialNew(@This());

source: Source,
pipeline: Pipeline = .{},
/// Decompression-bomb guard. Checked against the *header* dimensions before
/// any RGBA buffer is allocated. Mirrors Sharp's `limitInputPixels`.
max_pixels: u64 = codecs.default_max_pixels,
/// Apply EXIF Orientation (JPEG) before any user ops, the way Sharp's
/// `.rotate()`-with-no-args / `autoOrient` does.
auto_orient: bool = true,
/// Populated after a pipeline has run once; lets `.width`/`.height` answer
/// synchronously after the first await.
last_width: i32 = -1,
last_height: i32 = -1,
has_pending_activity: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),

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

pub const Fit = enum { fill, inside };

pub const Resize = struct {
    w: u32,
    h: u32,
    filter: codecs.Filter = .lanczos3,
    fit: Fit = .fill,
    without_enlargement: bool = false,
};

/// One slot per operation, not an op list — calling `.resize()` twice
/// overwrites, it doesn't resize twice. This is Sharp's semantics and means
/// the worker snapshot is a plain struct copy with a fixed execution order
/// (`run()` below), no allocation, no "too many ops" edge.
///
/// Execution order matches Sharp: (autoOrient) → rotate → flip/flop → resize
/// → modulate. Rotate precedes resize so the target box is interpreted in
/// upright space; modulate runs last so it operates on the fewest pixels.
pub const Pipeline = struct {
    rotate: u16 = 0, // 0/90/180/270
    flip: bool = false, // vertical
    flop: bool = false, // horizontal
    resize: ?Resize = null,
    modulate: ?Modulate = null,
    /// Output settings from `.jpeg()/.png()/.webp()`. `null` ⇒ re-encode in
    /// source format.
    output: ?codecs.EncodeOptions = null,
};

pub const Modulate = struct {
    /// Multiplier; 1.0 = identity.
    brightness: f32 = 1.0,
    /// 0 = greyscale, 1 = identity, >1 = boost.
    saturation: f32 = 1.0,
};

// ───────────────────────────── lifecycle ────────────────────────────────────

pub fn constructor(global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*Image {
    const args = callframe.arguments();
    if (args.len < 1 or args[0].isUndefinedOrNull())
        return global.throwInvalidArguments("Image() expects a path, ArrayBuffer, TypedArray or Blob", .{});

    const src = try sourceFromJS(global, args[0]);
    var img = Image.new(.{ .source = src });

    if (args.len > 1 and args[1].isObject()) {
        const opt = args[1];
        if (try opt.get(global, "maxPixels")) |v| if (v.isNumber()) {
            img.max_pixels = @intFromFloat(@max(0, v.asNumber()));
        };
        if (try opt.get(global, "autoOrient")) |v| img.auto_orient = v.toBoolean();
    }
    return img;
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

pub fn doResize(this: *Image, global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments();
    if (args.len < 1 or !args[0].isNumber())
        return global.throwInvalidArguments("resize(width, height?, options?)", .{});
    var r: Resize = .{
        .w = @intFromFloat(@max(1, args[0].asNumber())),
        // 0 height = preserve aspect ratio (resolved at execute time once the
        // source dimensions are known).
        .h = if (args.len > 1 and args[1].isNumber()) @intFromFloat(@max(1, args[1].asNumber())) else 0,
    };
    if (args.len > 2 and args[2].isObject()) {
        const opt = args[2];
        if (try opt.get(global, "filter")) |f| if (f.isString()) {
            const s = try f.toBunString(global);
            defer s.deref();
            if (s.eqlComptime("box")) r.filter = .box //
            else if (s.eqlComptime("bilinear")) r.filter = .bilinear //
            else if (s.eqlComptime("lanczos3")) r.filter = .lanczos3 //
            else return global.throwInvalidArguments("resize: filter must be 'box' | 'bilinear' | 'lanczos3'", .{});
        };
        if (try opt.get(global, "fit")) |f| if (f.isString()) {
            const s = try f.toBunString(global);
            defer s.deref();
            if (s.eqlComptime("inside")) r.fit = .inside //
            else if (s.eqlComptime("fill")) r.fit = .fill //
            else return global.throwInvalidArguments("resize: fit must be 'fill' | 'inside'", .{});
        };
        if (try opt.get(global, "withoutEnlargement")) |v| r.without_enlargement = v.toBoolean();
    }
    this.pipeline.resize = r;
    return callframe.this();
}

pub fn doRotate(this: *Image, global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments();
    if (args.len < 1 or !args[0].isNumber())
        return global.throwInvalidArguments("rotate(degrees) expects 90, 180 or 270", .{});
    const raw: i32 = @intFromFloat(args[0].asNumber());
    const deg: u32 = @intCast(@mod(@mod(raw, 360) + 360, 360));
    if (deg != 0 and deg != 90 and deg != 180 and deg != 270)
        return global.throwInvalidArguments("rotate: only multiples of 90 are supported", .{});
    this.pipeline.rotate = @intCast(deg);
    return callframe.this();
}

pub fn doFlip(this: *Image, _: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    this.pipeline.flip = true;
    return callframe.this();
}

pub fn doFlop(this: *Image, _: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    this.pipeline.flop = true;
    return callframe.this();
}

pub fn doModulate(this: *Image, global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments();
    var m: Modulate = this.pipeline.modulate orelse .{};
    if (args.len > 0 and args[0].isObject()) {
        const opt = args[0];
        if (try opt.get(global, "brightness")) |v| if (v.isNumber()) {
            m.brightness = @floatCast(@max(0, v.asNumber()));
        };
        if (try opt.get(global, "saturation")) |v| if (v.isNumber()) {
            m.saturation = @floatCast(@max(0, v.asNumber()));
        };
    }
    this.pipeline.modulate = m;
    return callframe.this();
}

fn setFormat(this: *Image, global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, fmt: codecs.Format) bun.JSError!jsc.JSValue {
    var enc: codecs.EncodeOptions = this.pipeline.output orelse .{ .format = fmt };
    enc.format = fmt;
    const args = callframe.arguments();
    if (args.len > 0 and args[0].isObject()) {
        const opt = args[0];
        if (try opt.get(global, "quality")) |q| {
            if (q.isNumber()) enc.quality = @intFromFloat(@min(@max(q.asNumber(), 1), 100));
        }
        if (try opt.get(global, "lossless")) |l| enc.lossless = l.toBoolean();
        if (try opt.get(global, "compressionLevel")) |c| if (c.isNumber()) {
            enc.compression_level = @intFromFloat(@min(@max(c.asNumber(), 0), 9));
        };
    }
    this.pipeline.output = enc;
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
    return this.schedule(global, .{ .encode = this.pipeline.output }, .uint8array);
}

pub fn doBlob(this: *Image, global: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.schedule(global, .{ .encode = this.pipeline.output }, .blob);
}

pub fn doToBase64(this: *Image, global: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.schedule(global, .{ .encode = this.pipeline.output }, .base64);
}

fn schedule(this: *Image, global: *jsc.JSGlobalObject, kind: PipelineTask.Kind, deliver: PipelineTask.Deliver) bun.JSError!jsc.JSValue {
    const job = PipelineTask.new(.{
        .image = this,
        .global = global,
        // Struct copy — the worker reads its own snapshot so further chained
        // calls on the JS side between schedule and completion don't race.
        .pipeline = this.pipeline,
        .source = this.snapshotSource(),
        .kind = kind,
        .deliver = deliver,
        .max_pixels = this.max_pixels,
        .auto_orient = this.auto_orient,
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
    pipeline: Pipeline,
    kind: Kind,
    deliver: Deliver,
    max_pixels: u64,
    auto_orient: bool,
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

        var decoded = codecs.decode(input, this.max_pixels) catch |e| {
            this.result = .{ .err = e };
            return;
        };
        defer bun.default_allocator.free(decoded.rgba);

        const src_format = codecs.Format.sniff(input) orelse .png;

        // EXIF auto-orient: applied BEFORE any user op so resize targets and
        // metadata report the visually-upright dimensions, the way Sharp does.
        if (this.auto_orient and src_format == .jpeg) {
            const orient = exif.readJpeg(input);
            if (orient != .normal) applyOrientation(&decoded, orient) catch |e| {
                this.result = .{ .err = e };
                return;
            };
        }

        if (this.kind == .metadata) {
            this.result = .{ .meta = .{ .w = decoded.width, .h = decoded.height, .format = src_format } };
            return;
        }

        this.applyPipeline(&decoded) catch |e| {
            this.result = .{ .err = e };
            return;
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
                    error.TooManyPixels => "Image: input exceeds maxPixels limit",
                    error.OutOfMemory => "Image: out of memory",
                };
                try promise.reject(global, global.createErrorInstance("{s}", .{msg}));
            },
            .io_err => |e| try promise.reject(global, e.toJS(global)),
        }
    }

    /// Fixed Sharp order: rotate → flip/flop → resize. Each stage replaces
    /// `d` in place; the old buffer is freed before assigning the new one so
    /// peak memory is at most 2× one frame.
    fn applyPipeline(this: *PipelineTask, d: *codecs.Decoded) codecs.Error!void {
        const p = this.pipeline;
        if (p.rotate != 0) {
            const next = try codecs.rotate(d.rgba, d.width, d.height, p.rotate);
            bun.default_allocator.free(d.rgba);
            d.* = next;
        }
        if (p.flip) {
            const next = try codecs.flip(d.rgba, d.width, d.height, false);
            bun.default_allocator.free(d.rgba);
            d.rgba = next;
        }
        if (p.flop) {
            const next = try codecs.flip(d.rgba, d.width, d.height, true);
            bun.default_allocator.free(d.rgba);
            d.rgba = next;
        }
        if (p.resize) |r| {
            const t = resolveResize(r, d.width, d.height);
            if (t.w != d.width or t.h != d.height) {
                const next = try codecs.resize(d.rgba, d.width, d.height, t.w, t.h, r.filter);
                bun.default_allocator.free(d.rgba);
                d.* = .{ .rgba = next, .width = t.w, .height = t.h };
            }
        }
        if (p.modulate) |m| codecs.modulate(d.rgba, m.brightness, m.saturation);
    }

    /// Map a resize spec to concrete output dims given the current dims.
    fn resolveResize(r: Resize, sw: u32, sh: u32) struct { w: u32, h: u32 } {
        var w = r.w;
        var h = if (r.h != 0) r.h else @max(1, r.w * sh / sw);
        if (r.fit == .inside) {
            // Shrink the box so the source's aspect ratio is preserved and
            // both sides fit. (Sharp's `fit:'inside'` — the only mode the
            // Claude Code path uses.)
            const sx = @as(f64, @floatFromInt(w)) / @as(f64, @floatFromInt(sw));
            const sy = @as(f64, @floatFromInt(h)) / @as(f64, @floatFromInt(sh));
            const s = @min(sx, sy);
            w = @max(1, @as(u32, @intFromFloat(@round(@as(f64, @floatFromInt(sw)) * s))));
            h = @max(1, @as(u32, @intFromFloat(@round(@as(f64, @floatFromInt(sh)) * s))));
        }
        if (r.without_enlargement and (w > sw or h > sh)) return .{ .w = sw, .h = sh };
        return .{ .w = w, .h = h };
    }

    fn applyOrientation(d: *codecs.Decoded, orient: exif.Orientation) codecs.Error!void {
        const t = orient.transform();
        if (t.flip) {
            const next = try codecs.flip(d.rgba, d.width, d.height, false);
            bun.default_allocator.free(d.rgba);
            d.rgba = next;
        }
        if (t.flop) {
            const next = try codecs.flip(d.rgba, d.width, d.height, true);
            bun.default_allocator.free(d.rgba);
            d.rgba = next;
        }
        if (t.rotate != 0) {
            const next = try codecs.rotate(d.rgba, d.width, d.height, t.rotate);
            bun.default_allocator.free(d.rgba);
            d.* = next;
        }
    }

    fn deinit(this: *PipelineTask) void {
        _ = this.image.has_pending_activity.fetchSub(1, .seq_cst);
        this.source.deinit();
        bun.destroy(this);
    }
};

// ───────────────────────────── imports ──────────────────────────────────────

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const codecs = @import("./codecs.zig");
const exif = @import("./exif.zig");
