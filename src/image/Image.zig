//! `Bun.Image` — Sharp-shaped image pipeline backed by the statically linked
//! libjpeg-turbo / libspng / libwebp codecs and the highway resize kernel.
//!
//! Shape: the constructor only captures the *input* (path or bytes). Chainable
//! mutators (`resize`, `rotate`, `flip`, `flop`, `jpeg`/`png`/`webp`) each
//! write one slot of `Pipeline` and return `this` — there is no op list, so
//! calling a setter twice overwrites. The actual decode → transform → encode
//! work happens off-thread when a terminal (`bytes`/`buffer`/`blob`/
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
/// Strong while at least one PipelineTask is in flight, weak otherwise. The
/// Strong→wrapper→sourceJS-slot chain is what keeps the borrowed ArrayBuffer
/// alive across the WorkPool roundtrip; switching to weak when idle lets GC
/// collect the wrapper without polling `hasPendingActivity` every cycle.
this_ref: jsc.JSRef = .empty(),
pending_tasks: u32 = 0,

pub const Source = union(enum) {
    /// Input is a JS ArrayBuffer/TypedArray held in the wrapper's `sourceJS`
    /// cached slot. We never cache the raw pointer here — it could be detached
    /// or (for resizable, which we reject) reallocated. Each use re-fetches:
    ///  - `doMetadata` (sync, JS thread): `asArrayBuffer` → probe; no copy.
    ///  - `schedule()` (JS thread): `asArrayBuffer` → `pin()` → hand the
    ///    fresh slice to the worker; `then()` (JS thread) unpins. The pin
    ///    only lives for the task, never touches `finalize` (which runs
    ///    during GC sweep), and only forces `possiblySharedBuffer()`
    ///    materialisation when actually going off-thread — and that costs no
    ///    more than the dupe it replaces.
    js_buffer,
    /// Owned by `bun.default_allocator` — Blob inputs (the Blob's store may be
    /// sliced/freed independently) and decoded data: URLs.
    owned: []u8,
    /// Owned by `bun.default_allocator`. Read on the worker thread.
    path: [:0]u8,

    fn deinit(self: *Source) void {
        switch (self.*) {
            .js_buffer => {},
            .owned => |b| bun.default_allocator.free(b),
            .path => |p| bun.default_allocator.free(p),
        }
    }
};

extern fn JSC__JSValue__pinArrayBuffer(v: jsc.JSValue) bool;
extern fn JSC__JSValue__unpinArrayBuffer(v: jsc.JSValue) void;

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

/// `@intFromFloat` is safety-checked UB on NaN/±Inf/out-of-range; every
/// number we read from JS goes through this so hostile input throws/clamps
/// instead of aborting. NaN → lo, ±Inf → the matching bound; bounds are f64
/// so the clamp stays in float space.
inline fn coerceInt(comptime T: type, x: f64, lo: f64, hi: f64) T {
    if (std.math.isNan(x)) return @intFromFloat(lo);
    return @intFromFloat(@min(@max(x, lo), hi));
}

// ───────────────────────────── lifecycle ────────────────────────────────────

pub fn constructor(global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, this_value: jsc.JSValue) bun.JSError!*Image {
    const args = callframe.arguments();
    if (args.len < 1 or args[0].isUndefinedOrNull())
        return global.throwInvalidArguments("Image() expects a path, ArrayBuffer, TypedArray, Blob or data: URL", .{});

    var img = Image.new(.{ .source = .js_buffer });
    // `opt.get` can throw (Proxy/getter); without this the heap-allocated
    // *Image and the duplicated source bytes leak.
    errdefer img.finalize();
    img.source = try sourceFromJS(global, args[0], this_value);

    if (args.len > 1 and args[1].isObject()) {
        const opt = args[1];
        if (try opt.get(global, "maxPixels")) |v| if (v.isNumber()) {
            img.max_pixels = coerceInt(u64, v.asNumber(), 0, 1e15);
        };
        if (try opt.get(global, "autoOrient")) |v| img.auto_orient = v.toBoolean();
    }
    return img;
}

pub fn finalize(this: *Image) void {
    this.this_ref.finalize();
    this.source.deinit();
    bun.destroy(this);
}

fn sourceFromJS(global: *jsc.JSGlobalObject, value: jsc.JSValue, this_value: jsc.JSValue) bun.JSError!Source {
    // String → file path or data:/base64 URL. Everything else → bytes.
    if (value.isString()) {
        const str = try value.toBunString(global);
        defer str.deref();
        const utf8 = str.toUTF8(bun.default_allocator);
        defer utf8.deinit();
        const s = utf8.slice();
        // `data:[<mime>][;base64],<payload>` — accept any image MIME (we sniff
        // anyway) and decode base64 here. Non-base64 data URLs aren't useful
        // for image bytes.
        if (bun.strings.hasPrefixComptime(s, "data:")) {
            const comma = bun.strings.indexOfChar(s, ',') orelse
                return global.throwInvalidArguments("Image(): malformed data: URL (no comma)", .{});
            const meta = s[5..comma];
            const payload = s[comma + 1 ..];
            if (!bun.strings.contains(meta, ";base64"))
                return global.throwInvalidArguments("Image(): only base64 data: URLs are supported", .{});
            const out = try bun.default_allocator.alloc(u8, bun.base64.decodeLen(payload));
            const r = bun.base64.decode(out, payload);
            if (!r.isSuccessful()) {
                bun.default_allocator.free(out);
                return global.throwInvalidArguments("Image(): invalid base64 in data: URL", .{});
            }
            return .{ .owned = out[0..r.count] };
        }
        return .{ .path = try bun.default_allocator.dupeZ(u8, s) };
    }
    if (value.asArrayBuffer(global)) |ab| {
        // A resizable/growable buffer can shrink or reallocate underneath any
        // slice we'd take; refuse it up front rather than UAF later.
        if (ab.resizable)
            return global.throwInvalidArguments("Image(): resizable/growable ArrayBuffer is not supported; pass a fixed-length view (e.g. buf.slice())", .{});
        // Just remember the JS object — see Source.js_buffer for why we don't
        // cache the pointer or pin here.
        js.sourceJSSetCached(this_value, global, value);
        return .js_buffer;
    }
    if (value.as(jsc.WebCore.Blob)) |blob| {
        // Only in-memory blobs for now; FileBlob/S3 callers can `await
        // file.bytes()` first. Dupe — the Blob's store may be sliced/replaced.
        const view = blob.sharedView();
        if (view.len > 0)
            return .{ .owned = try bun.default_allocator.dupe(u8, view) };
    }
    return global.throwInvalidArguments("Image() input must be a path string, data: URL, ArrayBuffer, TypedArray or in-memory Blob", .{});
}

// ───────────────────────────── chainable ops ────────────────────────────────

pub fn doResize(this: *Image, global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments();
    if (args.len < 1 or !args[0].isNumber())
        return global.throwInvalidArguments("resize(width, height?, options?)", .{});
    // 0x3FFF² is the max_pixels default; capping each side at 0x3FFFF (≈262k)
    // keeps every downstream u32 product in range without a per-stage check.
    var r: Resize = .{
        .w = coerceInt(u32, args[0].asNumber(), 1, 0x3FFFF),
        // 0 height = preserve aspect ratio (resolved at execute time once the
        // source dimensions are known).
        .h = if (args.len > 1 and args[1].isNumber()) coerceInt(u32, args[1].asNumber(), 1, 0x3FFFF) else 0,
    };
    if (args.len > 2 and args[2].isObject()) {
        const opt = args[2];
        if (try opt.get(global, "filter")) |f| if (f.isString()) {
            const s = try f.toBunString(global);
            defer s.deref();
            r.filter = parseFilter(s) orelse
                return global.throwInvalidArguments(
                    "resize: filter must be 'nearest' | 'box' | 'bilinear' | 'cubic' | 'mitchell' | 'lanczos2' | 'lanczos3' | 'mks2013' | 'mks2021'",
                    .{},
                );
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
    // coerceInt for the same NaN/Inf/huge-finite reasons as everywhere else;
    // ±1e15 is plenty of headroom for "any multiple of 90 a user might pass".
    const raw: i64 = coerceInt(i64, args[0].asNumber(), -1e15, 1e15);
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
        // Clamp finite + bounded so Infinity doesn't reach ModulateImpl as
        // f32 +Inf (0×Inf = NaN → static_cast<u8>(NaN) is UB).
        if (try opt.get(global, "brightness")) |v| if (v.isNumber()) {
            const x = v.asNumber();
            m.brightness = if (std.math.isFinite(x)) @floatCast(@min(@max(x, 0.0), 1e4)) else 1.0;
        };
        if (try opt.get(global, "saturation")) |v| if (v.isNumber()) {
            const x = v.asNumber();
            m.saturation = if (std.math.isFinite(x)) @floatCast(@min(@max(x, 0.0), 1e4)) else 1.0;
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
            if (q.isNumber()) enc.quality = coerceInt(u8, q.asNumber(), 1, 100);
        }
        if (try opt.get(global, "lossless")) |l| enc.lossless = l.toBoolean();
        if (try opt.get(global, "compressionLevel")) |c| if (c.isNumber()) {
            enc.compression_level = coerceInt(i8, c.asNumber(), 0, 9);
        };
        if (try opt.get(global, "palette")) |p| enc.palette = p.toBoolean();
        if (try opt.get(global, "colors")) |c| if (c.isNumber()) {
            enc.colors = coerceInt(u16, c.asNumber(), 2, 256);
        };
        if (try opt.get(global, "dither")) |d| enc.dither = d.toBoolean();
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
pub fn doFormatHeic(this: *Image, g: *jsc.JSGlobalObject, cf: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.setFormat(g, cf, .heic);
}
pub fn doFormatAvif(this: *Image, g: *jsc.JSGlobalObject, cf: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.setFormat(g, cf, .avif);
}

fn errorMessage(e: codecs.Error) [:0]const u8 {
    return switch (e) {
        error.UnknownFormat => "Image: unrecognised format (expected JPEG, PNG or WebP)",
        error.DecodeFailed => "Image: decode failed",
        error.EncodeFailed => "Image: encode failed",
        error.TooManyPixels => "Image: input exceeds maxPixels limit",
        error.UnsupportedOnPlatform => "Image: format not supported on this platform (HEIC/AVIF require macOS or Windows)",
        error.OutOfMemory => "Image: out of memory",
    };
}

fn parseFilter(s: bun.String) ?codecs.Filter {
    inline for (@typeInfo(codecs.Filter).@"enum".fields) |f|
        if (s.eqlComptime(f.name)) return @enumFromInt(f.value);
    if (s.eqlComptime("linear")) return .bilinear; // Sharp alias
    return null;
}

/// Fresh slice into the input bytes for use ON THE JS THREAD ONLY (re-reads
/// the ArrayBuffer's vector each call so a detach between construction and
/// here surfaces as `null` instead of UAF). For off-thread, see `pinForTask`.
fn jsThreadBytes(this: *Image, this_value: jsc.JSValue, global: *jsc.JSGlobalObject) ?[]const u8 {
    return switch (this.source) {
        .js_buffer => if (js.sourceJSGetCached(this_value)) |v|
            if (v.asArrayBuffer(global)) |ab| ab.byteSlice() else null
        else
            null,
        .owned => |b| b,
        .path => null,
    };
}

/// Pin the source ArrayBuffer for the duration of one off-thread task and
/// return a slice that's safe for the worker to read. Unpinned in `then()`.
fn pinForTask(this: *Image, this_value: jsc.JSValue, global: *jsc.JSGlobalObject) error{Detached}!PipelineTask.Input {
    switch (this.source) {
        .js_buffer => {
            const v = js.sourceJSGetCached(this_value) orelse return error.Detached;
            // pin() FIRST: for an inline-storage FastTypedArray it calls
            // `possiblySharedBuffer()` → `slowDownAndWasteMemory()`, which
            // copies into a fresh heap ArrayBuffer and repoints `m_vector`.
            // If we'd already taken `byteSlice()` it'd be pointing at the old
            // (now-unreferenced) GC-aux storage. Read the slice AFTER.
            _ = JSC__JSValue__pinArrayBuffer(v);
            const ab = v.asArrayBuffer(global) orelse {
                JSC__JSValue__unpinArrayBuffer(v);
                return error.Detached;
            };
            if (ab.byte_len == 0) {
                JSC__JSValue__unpinArrayBuffer(v);
                return error.Detached;
            }
            return .{ .bytes = ab.byteSlice(), .pinned = v };
        },
        .owned => |b| return .{ .bytes = b },
        .path => |p| return .{ .path = p },
    }
}

// ───────────────────────── static `Bun.Image.backend` ───────────────────────

pub fn getBackend(global: *jsc.JSGlobalObject, _: jsc.JSValue, _: jsc.JSValue) bun.JSError!jsc.JSValue {
    return bun.String.static(@tagName(codecs.backend)).toJS(global);
}

pub fn setBackend(_: jsc.JSValue, global: *jsc.JSGlobalObject, value: jsc.JSValue) bool {
    const str = value.toBunString(global) catch return false;
    defer str.deref();
    codecs.backend = if (str.eqlComptime("system"))
        .system
    else if (str.eqlComptime("bun"))
        .bun
    else {
        global.throwInvalidArgumentTypeValue("Bun.Image.backend", "\"system\" or \"bun\"", value) catch {};
        return false;
    };
    return true;
}

// ───────────────────────────── getters ──────────────────────────────────────

pub fn getWidth(this: *Image, _: *jsc.JSGlobalObject) jsc.JSValue {
    return jsc.JSValue.jsNumber(this.last_width);
}

pub fn getHeight(this: *Image, _: *jsc.JSGlobalObject) jsc.JSValue {
    return jsc.JSValue.jsNumber(this.last_height);
}

// ───────────────────────────── async terminals ──────────────────────────────

pub fn doMetadata(this: *Image, global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    // Header-only probe is a few dozen byte reads — when the bytes are already
    // in memory it's cheaper to do it inline than to bounce off the WorkPool
    // (~0.4 ms roundtrip). Path-backed sources still go async for the file I/O.
    if (this.jsThreadBytes(callframe.this(), global)) |buf| {
        if (codecs.probe(buf, this.max_pixels)) |p| {
            var w = p.width;
            var h = p.height;
            if (this.auto_orient and p.format == .jpeg) {
                const t = exif.readJpeg(buf).transform();
                if (t.rotate == 90 or t.rotate == 270) std.mem.swap(u32, &w, &h);
            }
            this.last_width = @intCast(w);
            this.last_height = @intCast(h);
            const obj = jsc.JSValue.createEmptyObject(global, 3);
            obj.put(global, jsc.ZigString.static("width"), jsc.JSValue.jsNumber(w));
            obj.put(global, jsc.ZigString.static("height"), jsc.JSValue.jsNumber(h));
            obj.put(global, jsc.ZigString.static("format"), jsc.ZigString.init(@tagName(p.format)).toJS(global));
            return jsc.JSPromise.resolvedPromiseValue(global, obj);
        } else |e| switch (e) {
            // HEIC/AVIF need the system backend → fall through to async.
            error.UnsupportedOnPlatform => {},
            else => return jsc.JSPromise.rejectedPromise(
                global,
                global.createErrorInstance("{s}", .{errorMessage(e)}),
            ).asValue(global),
        }
    }
    return this.schedule(global, callframe.this(), .metadata, .uint8array);
}

pub fn doBytes(this: *Image, global: *jsc.JSGlobalObject, cf: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.schedule(global, cf.this(), .{ .encode = this.pipeline.output }, .uint8array);
}

pub fn doBuffer(this: *Image, global: *jsc.JSGlobalObject, cf: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.schedule(global, cf.this(), .{ .encode = this.pipeline.output }, .buffer);
}

pub fn doBlob(this: *Image, global: *jsc.JSGlobalObject, cf: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.schedule(global, cf.this(), .{ .encode = this.pipeline.output }, .blob);
}

pub fn doToBase64(this: *Image, global: *jsc.JSGlobalObject, cf: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.schedule(global, cf.this(), .{ .encode = this.pipeline.output }, .base64);
}

fn schedule(this: *Image, global: *jsc.JSGlobalObject, this_value: jsc.JSValue, kind: PipelineTask.Kind, deliver: PipelineTask.Deliver) bun.JSError!jsc.JSValue {
    const input = this.pinForTask(this_value, global) catch
        return jsc.JSPromise.rejectedPromise(
            global,
            global.createErrorInstance("Image: source ArrayBuffer was detached", .{}),
        ).asValue(global);
    const job = PipelineTask.new(.{
        .image = this,
        .global = global,
        // Struct copy — the worker reads its own snapshot so further chained
        // calls on the JS side between schedule and completion don't race.
        .pipeline = this.pipeline,
        .input = input,
        .kind = kind,
        .deliver = deliver,
        .max_pixels = this.max_pixels,
        .auto_orient = this.auto_orient,
    });
    // First in-flight task ⇒ hold a Strong ref to the wrapper so GC can't
    // collect it (and its sourceJS slot, and the pinned ArrayBuffer) until
    // `then()` drops the count back to 0.
    if (this.pending_tasks == 0) this.this_ref.setStrong(this_value, global);
    this.pending_tasks += 1;
    var task = AsyncImageTask.createOnJSThread(bun.default_allocator, global, job);
    task.schedule();
    return task.promise.value();
}

/// Run the full pipeline on the *current* thread. Used when an `Image` is
/// passed straight to `new Response(image)` / `new Request(url, {body: image})`
/// — the body-init contract is synchronous, so we encode here and hand back an
/// owned buffer the Body can wrap as an `InternalBlob`. The async terminals
/// (`bytes`/`blob`/…) remain the off-thread path.
///
/// A later refinement is to return a `.Locked` body and resolve it from the
/// worker pool; this is the simple, correct first cut.
pub fn encodeForBody(this: *Image, global: *jsc.JSGlobalObject, this_value: jsc.JSValue) bun.JSError!struct { bytes: codecs.Encoded, mime: [:0]const u8 } {
    const input = this.pinForTask(this_value, global) catch
        return global.throw("Image: source ArrayBuffer was detached", .{});
    defer if (input.pinned != .zero) JSC__JSValue__unpinArrayBuffer(input.pinned);
    var task: PipelineTask = .{
        .image = this,
        .global = global,
        .pipeline = this.pipeline,
        .input = input,
        .kind = .{ .encode = this.pipeline.output },
        .deliver = .uint8array,
        .max_pixels = this.max_pixels,
        .auto_orient = this.auto_orient,
    };
    task.run();
    return switch (task.result) {
        .encoded => |e| {
            this.last_width = @intCast(e.w);
            this.last_height = @intCast(e.h);
            return .{ .bytes = e.out, .mime = e.format.mime() };
        },
        .err => |e| global.throw("{s}", .{errorMessage(e)}),
        // Preserve errno/path/syscall instead of flattening to DecodeFailed.
        .io_err => |e| global.throwValue(try e.toJS(global)),
        .meta => unreachable,
    };
}

// ───────────────────────────── worker task ──────────────────────────────────

pub const AsyncImageTask = jsc.ConcurrentPromiseTask(PipelineTask);

pub const PipelineTask = struct {
    pub const new = bun.TrivialNew(@This());

    image: *Image,
    global: *jsc.JSGlobalObject,
    pipeline: Pipeline,
    input: Input,
    kind: Kind,
    deliver: Deliver,
    max_pixels: u64,
    auto_orient: bool,
    result: Result = .{ .err = error.DecodeFailed },

    /// Bytes for the worker. `.pinned` is the JS ArrayBuffer/view to unpin in
    /// `then()` — `.zero` for owned/path sources (nothing to unpin).
    pub const Input = struct {
        bytes: []const u8 = &.{},
        path: ?[:0]const u8 = null,
        pinned: jsc.JSValue = .zero,
    };

    pub const Deliver = enum { uint8array, buffer, blob, base64 };

    pub const Kind = union(enum) {
        /// `null` ⇒ re-encode in the source format (resolved after decode).
        encode: ?codecs.EncodeOptions,
        metadata,
    };

    pub const Result = union(enum) {
        encoded: struct { out: codecs.Encoded, format: codecs.Format, w: u32, h: u32 },
        meta: struct { w: u32, h: u32, format: codecs.Format },
        err: codecs.Error,
        io_err: bun.sys.Error,
    };

    /// Runs on a `WorkPool` thread. No JSC access.
    pub fn run(this: *PipelineTask) void {
        // `this.input` was prepared on the JS thread by `pinForTask`: either a
        // pinned ArrayBuffer slice (pin lives until `then()` unpins), an owned
        // buffer, or a path to read here.
        var owned_file: ?[]u8 = null;
        defer if (owned_file) |f| bun.default_allocator.free(f);
        const input: []const u8 = if (this.input.path) |p|
            switch (bun.sys.File.readFrom(bun.FD.cwd(), p, bun.default_allocator)) {
                .result => |bytes| blk: {
                    owned_file = bytes;
                    break :blk bytes;
                },
                .err => |e| {
                    this.result = .{ .io_err = e };
                    return;
                },
            }
        else
            this.input.bytes;

        // Header-only fast path for `.metadata()` — Sharp parses just the
        // IHDR/SOF/VP8 header; we used to decode the full RGBA buffer first
        // (~70× slower on a 1920×1080 PNG). EXIF orientation only swaps the
        // reported dims, no pixels involved.
        if (this.kind == .metadata) {
            if (codecs.probe(input, this.max_pixels)) |p| {
                var w = p.width;
                var h = p.height;
                if (this.auto_orient and p.format == .jpeg) {
                    const t = exif.readJpeg(input).transform();
                    if (t.rotate == 90 or t.rotate == 270) std.mem.swap(u32, &w, &h);
                }
                this.result = .{ .meta = .{ .w = w, .h = h, .format = p.format } };
                return;
            } else |e| switch (e) {
                // HEIC/AVIF have no header probe — fall through to full decode
                // via the system backend.
                error.UnsupportedOnPlatform => {},
                else => {
                    this.result = .{ .err = e };
                    return;
                },
            }
        }

        // Decode-time downscale hint. The IDCT picker constrains in *stored*
        // axes, so any 90/270 rotate that runs before resize — explicit OR
        // EXIF auto-orient — needs the hint axes swapped, otherwise one axis
        // can be over-shrunk and then upscaled, throwing away detail.
        // (flip/flop are pure mirrors that never change w/h, so the hint
        //  stays valid through them.)
        const hint: codecs.DecodeHint = if (this.pipeline.resize) |r| blk: {
            var tw = r.w;
            // r.h==0 means "preserve aspect" — constrain on width only.
            var th = if (r.h != 0) r.h else r.w;
            const swap_explicit = this.pipeline.rotate == 90 or this.pipeline.rotate == 270;
            const swap_exif = this.auto_orient and blk2: {
                const t = exif.readJpeg(input).transform();
                break :blk2 t.rotate == 90 or t.rotate == 270;
            };
            if (swap_explicit != swap_exif) std.mem.swap(u32, &tw, &th);
            break :blk .{ .target_w = tw, .target_h = th };
        } else .{};

        var decoded = codecs.decode(input, this.max_pixels, hint) catch |e| {
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
            // Reached only for HEIC/AVIF (probe fell through).
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
        this.result = .{ .encoded = .{ .out = out, .format = enc.format, .w = decoded.width, .h = decoded.height } };
    }

    /// Back on the JS thread.
    pub fn then(this: *PipelineTask, promise: *jsc.JSPromise) bun.JSTerminated!void {
        defer this.deinit();
        // JS thread again — release the per-task pin so user code can
        // transfer/detach the source now.
        if (this.input.pinned != .zero) JSC__JSValue__unpinArrayBuffer(this.input.pinned);
        const global = this.global;
        // Stash final dims here (JS thread) — `run()` is on a WorkPool thread
        // so writing `this.image.*` there would race the synchronous getters.
        switch (this.result) {
            .encoded => |e| {
                this.image.last_width = @intCast(e.w);
                this.image.last_height = @intCast(e.h);
            },
            .meta => |m| {
                this.image.last_width = @intCast(m.w);
                this.image.last_height = @intCast(m.h);
            },
            else => {},
        }
        switch (this.result) {
            .encoded => |enc| switch (this.deliver) {
                // The codec's own allocation is handed straight to JS with the
                // codec's free as the finalizer — no dupe of the output.
                .uint8array => try promise.resolve(global, jsc.ArrayBuffer.fromBytes(enc.out.bytes, .Uint8Array)
                    .toJSWithContext(global, null, enc.out.free) catch
                    return promise.reject(global, error.JSError)),
                .buffer => try promise.resolve(global, jsc.JSValue.createBufferWithCtx(global, enc.out.bytes, null, enc.out.free)),
                .blob => {
                    // Blob.Store frees via an Allocator; dupe for that path.
                    const owned = bun.handleOom(bun.default_allocator.dupe(u8, enc.out.bytes));
                    enc.out.deinit();
                    var blob = jsc.WebCore.Blob.init(owned, bun.default_allocator, global);
                    blob.content_type = enc.format.mime();
                    blob.content_type_was_set = true;
                    try promise.resolve(global, jsc.WebCore.Blob.new(blob).toJS(global));
                },
                .base64 => {
                    defer enc.out.deinit();
                    const b64_len = bun.base64.encodeLen(enc.out.bytes);
                    const b64 = bun.handleOom(bun.default_allocator.alloc(u8, b64_len));
                    defer bun.default_allocator.free(b64);
                    const wrote = bun.base64.encode(b64, enc.out.bytes);
                    const str = bun.String.createUTF8ForJS(global, b64[0..wrote]) catch
                        return promise.reject(global, error.JSError);
                    try promise.resolve(global, str);
                },
            },
            .meta => |m| {
                const obj = jsc.JSValue.createEmptyObject(global, 3);
                obj.put(global, jsc.ZigString.static("width"), jsc.JSValue.jsNumber(m.w));
                obj.put(global, jsc.ZigString.static("height"), jsc.JSValue.jsNumber(m.h));
                obj.put(global, jsc.ZigString.static("format"), jsc.ZigString.init(@tagName(m.format)).toJS(global));
                try promise.resolve(global, obj);
            },
            .err => |e| try promise.reject(global, global.createErrorInstance("{s}", .{errorMessage(e)})),
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
            // Same guard as decode: cap output canvas so a clamped-but-huge
            // target (e.g. `resize(Infinity)` → 262k×196k) rejects instead of
            // attempting a multi-GB allocation.
            if (@as(u64, t.w) * t.h > this.max_pixels) return error.TooManyPixels;
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
        // Widen before multiplying — `r.w` is user-controlled and `sh` is
        // bounded only by `max_pixels`, so the u32 product can wrap; and the
        // quotient can exceed u32 for tall-thin sources (1×5M with .resize(1k)
        // → 5e9), so clamp to the same per-side cap doResize uses before the
        // @intCast. The maxPixels guard then rejects the product.
        var h: u32 = if (r.h != 0) r.h else @intCast(@min(@as(u64, 0x3FFFF), @max(1, @as(u64, r.w) * sh / sw)));
        if (r.fit == .inside) {
            // Shrink the box so the source's aspect ratio is preserved and
            // both sides fit. (Sharp's `fit:'inside'`.)
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
        // Always reached from `then()` on the JS thread, so the ref/count
        // touch is safe without atomics.
        this.image.pending_tasks -= 1;
        if (this.image.pending_tasks == 0) this.image.this_ref.downgrade();
        bun.destroy(this);
    }
};

// ───────────────────────────── imports ──────────────────────────────────────

const codecs = @import("./codecs.zig");
const exif = @import("./exif.zig");
const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
