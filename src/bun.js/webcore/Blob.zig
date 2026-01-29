//! The JS `Blob` class can be backed by different forms (in Blob.Store), which
//! represent different sources of Blob. For example, `Bun.file()` returns Blob
//! objects that reference the filesystem (Blob.Store.File). This is how
//! operations like writing `Store.File` to another `Store.File` knows to use a
//! basic file copy instead of a naive read write loop.

const Blob = @This();

const debug = Output.scoped(.Blob, .visible);

pub const Store = @import("./blob/Store.zig");
pub const read_file = @import("./blob/read_file.zig");
pub const write_file = @import("./blob/write_file.zig");
pub const copy_file = @import("./blob/copy_file.zig");

pub fn new(blob: Blob) *Blob {
    const result = bun.new(Blob, blob);
    result.#ref_count = .init(1);
    return result;
}

pub const js = jsc.Codegen.JSBlob;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

reported_estimated_size: usize = 0,

size: SizeType = 0,
offset: SizeType = 0,
store: ?*Store = null,
content_type: string = "",
content_type_allocated: bool = false,
content_type_was_set: bool = false,

/// JavaScriptCore strings are either latin1 or UTF-16
/// When UTF-16, they're nearly always due to non-ascii characters
charset: strings.AsciiStatus = .unknown,

/// Was it created via file constructor?
is_jsdom_file: bool = false,

/// Reference count, for use with `bun.ptr.ExternalShared`. If the reference count is 0, that means
/// this blob is *not* heap-allocated, and will not be freed in `deinit`.
#ref_count: bun.ptr.RawRefCount(u32, .single_threaded) = .init(0),

globalThis: *JSGlobalObject = undefined,

last_modified: f64 = 0.0,
/// Blob name will lazy initialize when getName is called, but
/// we must be able to set the name, and we need to keep the value alive
/// https://github.com/oven-sh/bun/issues/10178
name: bun.String = .dead,

pub const Ref = bun.ptr.ExternalShared(Blob);

/// Max int of double precision
/// 9 petabytes is probably enough for awhile
/// We want to avoid coercing to a BigInt because that's a heap allocation
/// and it's generally just harder to use
pub const SizeType = u52;
pub const max_size = std.math.maxInt(SizeType);

/// 1: Initial
/// 2: Added byte for whether it's a dom file, length and bytes for `stored_name`,
///    and f64 for `last_modified`. Removed reserved bytes, it's handled by version
///    number.
/// 3: Added File name serialization for File objects (when is_jsdom_file is true)
const serialization_version: u8 = 3;

comptime {
    _ = Bun__Blob__getSizeForBindings;
}

pub const ClosingState = enum(u8) {
    running,
    closing,
};

pub fn getFormDataEncoding(this: *Blob) ?*bun.FormData.AsyncFormData {
    var content_type_slice: ZigString.Slice = this.getContentType() orelse return null;
    defer content_type_slice.deinit();
    const encoding = bun.FormData.Encoding.get(content_type_slice.slice()) orelse return null;
    return bun.handleOom(bun.FormData.AsyncFormData.init(bun.default_allocator, encoding));
}

pub fn hasContentTypeFromUser(this: *const Blob) bool {
    return this.content_type_was_set or (this.store != null and (this.store.?.data == .file or this.store.?.data == .s3));
}

pub fn contentTypeOrMimeType(this: *const Blob) ?[]const u8 {
    if (this.content_type.len > 0) {
        return this.content_type;
    }
    if (this.store) |store| {
        switch (store.data) {
            .file => |file| {
                return file.mime_type.value;
            },
            .s3 => |s3| {
                return s3.mime_type.value;
            },
            else => return null,
        }
    }
    return null;
}

pub fn isBunFile(this: *const Blob) bool {
    const store = this.store orelse return false;

    return store.data == .file;
}

pub fn doReadFromS3(this: *Blob, comptime Function: anytype, global: *JSGlobalObject) bun.JSTerminated!JSValue {
    debug("doReadFromS3", .{});

    const WrappedFn = struct {
        pub fn wrapped(b: *Blob, g: *JSGlobalObject, by: []u8) jsc.JSValue {
            return jsc.toJSHostCall(g, @src(), Function, .{ b, g, by, .clone });
        }
    };
    return S3BlobDownloadTask.init(global, this, WrappedFn.wrapped);
}

pub fn doReadFile(this: *Blob, comptime Function: anytype, global: *JSGlobalObject) JSValue {
    debug("doReadFile", .{});

    const Handler = NewReadFileHandler(Function);

    var handler = bun.new(Handler, .{
        .context = this.*,
        .globalThis = global,
    });

    if (Environment.isWindows) {
        var promise = JSPromise.create(global);
        const promise_value = promise.toJS();
        promise_value.ensureStillAlive();
        handler.promise.strong.set(global, promise_value);

        read_file.ReadFileUV.start(handler.globalThis.bunVM().uvLoop(), this.store.?, this.offset, this.size, Handler, handler);

        return promise_value;
    }

    const file_read = read_file.ReadFile.create(
        bun.default_allocator,
        this.store.?,
        this.offset,
        this.size,
        *Handler,
        handler,
        Handler.run,
    ) catch |err| bun.handleOom(err);
    var read_file_task = read_file.ReadFileTask.createOnJSThread(bun.default_allocator, global, file_read);

    // Create the Promise only after the store has been ref()'d.
    // The garbage collector runs on memory allocations
    // The JSPromise is the next GC'd memory allocation.
    // This shouldn't really fix anything, but it's a little safer.
    var promise = JSPromise.create(global);
    const promise_value = promise.toJS();
    promise_value.ensureStillAlive();
    handler.promise.strong.set(global, promise_value);

    read_file_task.schedule();

    debug("doReadFile: read_file_task scheduled", .{});
    return promise_value;
}

pub fn NewInternalReadFileHandler(comptime Context: type, comptime Function: anytype) type {
    return struct {
        pub fn run(handler: *anyopaque, bytes: read_file.ReadFileResultType) void {
            Function(bun.cast(Context, handler), bytes);
        }
    };
}

pub fn doReadFileInternal(this: *Blob, comptime Handler: type, ctx: Handler, comptime Function: anytype, global: *JSGlobalObject) void {
    if (Environment.isWindows) {
        const ReadFileHandler = NewInternalReadFileHandler(Handler, Function);
        return read_file.ReadFileUV.start(libuv.Loop.get(), this.store.?, this.offset, this.size, ReadFileHandler, ctx);
    }
    const file_read = read_file.ReadFile.createWithCtx(
        bun.default_allocator,
        this.store.?,
        ctx,
        NewInternalReadFileHandler(Handler, Function).run,
        this.offset,
        this.size,
    ) catch |err| bun.handleOom(err);
    var read_file_task = read_file.ReadFileTask.createOnJSThread(bun.default_allocator, global, file_read);
    read_file_task.schedule();
}

const FormDataContext = struct {
    allocator: std.mem.Allocator,
    joiner: StringJoiner,
    boundary: []const u8,
    failed: bool = false,
    globalThis: *jsc.JSGlobalObject,

    pub fn onEntry(this: *FormDataContext, name: ZigString, entry: jsc.DOMFormData.FormDataEntry) void {
        if (this.failed) return;
        var globalThis = this.globalThis;

        const allocator = this.allocator;
        const joiner = &this.joiner;
        const boundary = this.boundary;

        joiner.pushStatic("--");
        joiner.pushStatic(boundary); // note: "static" here means "outlives the joiner"
        joiner.pushStatic("\r\n");

        joiner.pushStatic("Content-Disposition: form-data; name=\"");
        const name_slice = name.toSlice(allocator);
        joiner.push(name_slice.slice(), name_slice.allocator.get());

        switch (entry) {
            .string => |value| {
                joiner.pushStatic("\"\r\n\r\n");
                const value_slice = value.toSlice(allocator);
                joiner.push(value_slice.slice(), value_slice.allocator.get());
            },
            .file => |value| {
                joiner.pushStatic("\"; filename=\"");
                const filename_slice = value.filename.toSlice(allocator);
                joiner.push(filename_slice.slice(), filename_slice.allocator.get());
                joiner.pushStatic("\"\r\n");

                const blob = value.blob;
                const content_type = if (blob.content_type.len > 0) blob.content_type else "application/octet-stream";
                joiner.pushStatic("Content-Type: ");
                joiner.pushStatic(content_type);
                joiner.pushStatic("\r\n\r\n");

                if (blob.store) |store| {
                    if (blob.size == Blob.max_size) {
                        blob.resolveSize();
                    }
                    switch (store.data) {
                        .s3 => |_| {
                            // TODO: s3
                            // we need to make this async and use download/downloadSlice
                        },
                        .file => |file| {

                            // TODO: make this async + lazy
                            const res = jsc.Node.fs.NodeFS.readFile(
                                globalThis.bunVM().nodeFS(),
                                .{
                                    .encoding = .buffer,
                                    .path = file.pathlike,
                                    .offset = blob.offset,
                                    .max_size = blob.size,
                                },
                                .sync,
                            );

                            switch (res) {
                                .err => |err| {
                                    this.failed = true;
                                    const js_err = err.toJS(globalThis) catch return;
                                    globalThis.throwValue(js_err) catch {};
                                },
                                .result => |result| {
                                    joiner.push(result.slice(), result.buffer.allocator);
                                },
                            }
                        },
                        .bytes => |_| {
                            joiner.pushStatic(blob.sharedView());
                        },
                    }
                }
            },
        }

        joiner.pushStatic("\r\n");
    }
};

pub fn getContentType(
    this: *Blob,
) ?ZigString.Slice {
    if (this.content_type.len > 0)
        return ZigString.Slice.fromUTF8NeverFree(this.content_type);

    return null;
}

const StructuredCloneWriter = struct {
    ctx: *anyopaque,
    impl: *const fn (*anyopaque, ptr: [*]const u8, len: u32) callconv(jsc.conv) void,

    pub const WriteError = error{};
    pub fn write(this: StructuredCloneWriter, bytes: []const u8) WriteError!usize {
        this.impl(this.ctx, bytes.ptr, @as(u32, @truncate(bytes.len)));
        return bytes.len;
    }
};

fn _onStructuredCloneSerialize(
    this: *Blob,
    comptime Writer: type,
    writer: Writer,
) !void {
    try writer.writeInt(u8, serialization_version, .little);

    try writer.writeInt(u64, @intCast(this.offset), .little);

    try writer.writeInt(u32, @truncate(this.content_type.len), .little);
    try writer.writeAll(this.content_type);
    try writer.writeInt(u8, @intFromBool(this.content_type_was_set), .little);

    const store_tag: Store.SerializeTag = if (this.store) |store|
        if (store.data == .file) .file else .bytes
    else
        .empty;

    try writer.writeInt(u8, @intFromEnum(store_tag), .little);

    this.resolveSize();
    if (this.store) |store| {
        try store.serialize(Writer, writer);
    }

    try writer.writeInt(u8, @intFromBool(this.is_jsdom_file), .little);
    try writeFloat(f64, this.last_modified, Writer, writer);

    // Serialize File name if this is a File object
    if (this.is_jsdom_file) {
        if (this.getNameString()) |name_string| {
            const name_slice = name_string.toUTF8(bun.default_allocator);
            defer name_slice.deinit();
            try writer.writeInt(u32, @truncate(name_slice.slice().len), .little);
            try writer.writeAll(name_slice.slice());
        } else {
            // No name available, write empty string
            try writer.writeInt(u32, 0, .little);
        }
    }
}

pub fn onStructuredCloneSerialize(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
    ctx: *anyopaque,
    writeBytes: *const fn (*anyopaque, ptr: [*]const u8, len: u32) callconv(jsc.conv) void,
) void {
    _ = globalThis;

    const Writer = std.Io.GenericWriter(StructuredCloneWriter, StructuredCloneWriter.WriteError, StructuredCloneWriter.write);
    const writer = Writer{
        .context = .{
            .ctx = ctx,
            .impl = writeBytes,
        },
    };

    try _onStructuredCloneSerialize(this, Writer, writer);
}

pub fn onStructuredCloneTransfer(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
    ctx: *anyopaque,
    write: *const fn (*anyopaque, ptr: [*]const u8, len: usize) callconv(.c) void,
) void {
    _ = write;
    _ = ctx;
    _ = this;
    _ = globalThis;
}

fn writeFloat(
    comptime FloatType: type,
    value: FloatType,
    comptime Writer: type,
    writer: Writer,
) !void {
    const bytes: [@sizeOf(FloatType)]u8 = @bitCast(value);
    try writer.writeAll(&bytes);
}

fn readFloat(
    comptime FloatType: type,
    comptime Reader: type,
    reader: Reader,
) !FloatType {
    var bytes_buf: [@sizeOf(FloatType)]u8 = undefined;
    if (Reader == *std.Io.Reader) {
        try reader.readSliceAll(&bytes_buf);
    } else {
        const len = try reader.readAll(&bytes_buf);
        if (len < @sizeOf(FloatType)) return error.EndOfStream;
    }
    return @bitCast(bytes_buf);
}

fn readSlice(
    reader: anytype,
    len: usize,
    allocator: std.mem.Allocator,
) ![]u8 {
    var slice = try allocator.alloc(u8, len);
    slice = slice[0..try reader.read(slice)];
    if (slice.len != len) return error.TooSmall;
    return slice;
}

fn _onStructuredCloneDeserialize(
    globalThis: *jsc.JSGlobalObject,
    comptime Reader: type,
    reader: Reader,
) !JSValue {
    const allocator = bun.default_allocator;

    const version = try reader.readInt(u8, .little);

    const offset = try reader.readInt(u64, .little);

    const content_type_len = try reader.readInt(u32, .little);

    const content_type = try readSlice(reader, content_type_len, allocator);

    const content_type_was_set: bool = try reader.readInt(u8, .little) != 0;

    const store_tag = try reader.readEnum(Store.SerializeTag, .little);

    const blob: *Blob = switch (store_tag) {
        .bytes => bytes: {
            const bytes_len = try reader.readInt(u32, .little);
            const bytes = try readSlice(reader, bytes_len, allocator);

            const blob = Blob.init(bytes, allocator, globalThis);

            versions: {
                if (version == 1) break :versions;

                const name_len = try reader.readInt(u32, .little);
                const name = try readSlice(reader, name_len, allocator);

                if (blob.store) |store| switch (store.data) {
                    .bytes => |*bytes_store| bytes_store.stored_name = bun.PathString.init(name),
                    else => {},
                };

                if (version == 2) break :versions;
            }

            break :bytes Blob.new(blob);
        },
        .file => file: {
            const pathlike_tag = try reader.readEnum(jsc.Node.PathOrFileDescriptor.SerializeTag, .little);

            switch (pathlike_tag) {
                .fd => {
                    const fd = try reader.readStruct(bun.FD);

                    var path_or_fd = jsc.Node.PathOrFileDescriptor{
                        .fd = fd,
                    };
                    const blob = Blob.new(Blob.findOrCreateFileFromPath(
                        &path_or_fd,
                        globalThis,
                        true,
                    ));

                    break :file blob;
                },
                .path => {
                    const path_len = try reader.readInt(u32, .little);

                    const path = try readSlice(reader, path_len, default_allocator);
                    var dest = jsc.Node.PathOrFileDescriptor{
                        .path = .{
                            .string = bun.PathString.init(path),
                        },
                    };
                    const blob = Blob.new(Blob.findOrCreateFileFromPath(
                        &dest,
                        globalThis,
                        true,
                    ));

                    break :file blob;
                },
            }

            return .zero;
        },
        .empty => Blob.new(Blob.initEmpty(globalThis)),
    };

    versions: {
        if (version == 1) break :versions;

        blob.is_jsdom_file = try reader.readInt(u8, .little) != 0;
        blob.last_modified = try readFloat(f64, Reader, reader);

        if (version == 2) break :versions;

        // Version 3: Read File name if this is a File object
        if (blob.is_jsdom_file) {
            const name_len = try reader.readInt(u32, .little);
            const name_bytes = try readSlice(reader, name_len, allocator);
            blob.name = bun.String.cloneUTF8(name_bytes);
            allocator.free(name_bytes);
        }

        if (version == 3) break :versions;
    }

    bun.assertf(blob.isHeapAllocated(), "expected blob to be heap-allocated", .{});
    blob.offset = @as(u52, @intCast(offset));
    if (content_type.len > 0) {
        blob.content_type = content_type;
        blob.content_type_allocated = true;
        blob.content_type_was_set = content_type_was_set;
    }

    return blob.toJS(globalThis);
}

pub fn onStructuredCloneDeserialize(globalThis: *jsc.JSGlobalObject, ptr: *[*]u8, end: [*]u8) bun.JSError!JSValue {
    const total_length: usize = @intFromPtr(end) - @intFromPtr(ptr.*);
    var buffer_stream = std.io.fixedBufferStream(ptr.*[0..total_length]);
    const reader = buffer_stream.reader();

    const result = _onStructuredCloneDeserialize(globalThis, @TypeOf(reader), reader) catch |err| switch (err) {
        error.EndOfStream, error.TooSmall, error.InvalidValue => {
            return globalThis.throw("Blob.onStructuredCloneDeserialize failed", .{});
        },
        error.OutOfMemory => {
            return globalThis.throwOutOfMemory();
        },
    };

    // Advance the pointer by the number of bytes consumed
    ptr.* = ptr.* + buffer_stream.pos;

    return result;
}

const URLSearchParamsConverter = struct {
    allocator: std.mem.Allocator,
    buf: []u8 = "",
    globalThis: *jsc.JSGlobalObject,
    pub fn convert(this: *URLSearchParamsConverter, str: ZigString) void {
        this.buf = bun.handleOom(str.toOwnedSlice(this.allocator));
    }
};

pub fn fromURLSearchParams(
    globalThis: *jsc.JSGlobalObject,
    allocator: std.mem.Allocator,
    search_params: *jsc.URLSearchParams,
) Blob {
    var converter = URLSearchParamsConverter{
        .allocator = allocator,
        .globalThis = globalThis,
    };
    search_params.toString(URLSearchParamsConverter, &converter, URLSearchParamsConverter.convert);
    var store = Blob.Store.init(converter.buf, allocator);
    store.mime_type = MimeType.Compact.from(.@"application/x-www-form-urlencoded").toMimeType();

    var blob = Blob.initWithStore(store, globalThis);
    blob.content_type = store.mime_type.value;
    blob.content_type_was_set = true;
    return blob;
}

pub fn fromDOMFormData(
    globalThis: *jsc.JSGlobalObject,
    allocator: std.mem.Allocator,
    form_data: *jsc.DOMFormData,
) Blob {
    var arena = bun.ArenaAllocator.init(allocator);
    defer arena.deinit();
    var stack_allocator = std.heap.stackFallback(1024, arena.allocator());
    const stack_mem_all = stack_allocator.get();

    var hex_buf: [70]u8 = undefined;
    const boundary = brk: {
        var random = globalThis.bunVM().rareData().nextUUID().bytes;
        break :brk std.fmt.bufPrint(&hex_buf, "-WebkitFormBoundary{x}", .{&random}) catch unreachable;
    };

    var context = FormDataContext{
        .allocator = allocator,
        .joiner = .{ .allocator = stack_mem_all },
        .boundary = boundary,
        .globalThis = globalThis,
    };

    form_data.forEach(FormDataContext, &context, FormDataContext.onEntry);
    if (context.failed) {
        return Blob.initEmpty(globalThis);
    }

    context.joiner.pushStatic("--");
    context.joiner.pushStatic(boundary);
    context.joiner.pushStatic("--\r\n");

    const store = Blob.Store.init(bun.handleOom(context.joiner.done(allocator)), allocator);
    var blob = Blob.initWithStore(store, globalThis);
    blob.content_type = std.fmt.allocPrint(allocator, "multipart/form-data; boundary={s}", .{boundary}) catch |err| bun.handleOom(err);
    blob.content_type_allocated = true;
    blob.content_type_was_set = true;

    return blob;
}

pub fn contentType(this: *const Blob) string {
    return this.content_type;
}

pub fn isDetached(this: *const Blob) bool {
    return this.store == null;
}

export fn Blob__dupeFromJS(value: jsc.JSValue) ?*Blob {
    const this = Blob.fromJS(value) orelse return null;
    return Blob__dupe(this);
}

export fn Blob__setAsFile(this: *Blob, path_str: *bun.String) void {
    this.is_jsdom_file = true;

    // This is not 100% correct...
    if (this.store) |store| {
        if (store.data == .bytes) {
            if (store.data.bytes.stored_name.len == 0) {
                const utf8 = path_str.toUTF8Bytes(bun.default_allocator);
                store.data.bytes.stored_name = bun.PathString.init(utf8);
            }
        }
    }
}

export fn Blob__dupe(this: *Blob) *Blob {
    return new(this.dupeWithContentType(true));
}

export fn Blob__getFileNameString(this: *Blob) callconv(.c) bun.String {
    if (this.getFileName()) |filename| {
        return bun.String.fromBytes(filename);
    }

    return bun.String.empty;
}

comptime {
    _ = Blob__dupeFromJS;
    _ = Blob__dupe;
    _ = Blob__setAsFile;
    _ = Blob__getFileNameString;
}

pub fn writeFormatForSize(is_jdom_file: bool, size: usize, writer: anytype, comptime enable_ansi_colors: bool) !void {
    if (is_jdom_file) {
        try writer.writeAll(comptime Output.prettyFmt("<r>File<r>", enable_ansi_colors));
    } else {
        try writer.writeAll(comptime Output.prettyFmt("<r>Blob<r>", enable_ansi_colors));
    }
    try writer.print(
        comptime Output.prettyFmt(" (<yellow>{f}<r>)", enable_ansi_colors),
        .{
            bun.fmt.size(size, .{}),
        },
    );
}

pub fn writeFormat(this: *Blob, comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
    const Writer = @TypeOf(writer);

    if (this.isDetached()) {
        if (this.is_jsdom_file) {
            try writer.writeAll(comptime Output.prettyFmt("<d>[<r>File<r> detached<d>]<r>", enable_ansi_colors));
        } else {
            try writer.writeAll(comptime Output.prettyFmt("<d>[<r>Blob<r> detached<d>]<r>", enable_ansi_colors));
        }
        return;
    }

    {
        const store = this.store.?;
        switch (store.data) {
            .s3 => |*s3| {
                try S3File.writeFormat(s3, Formatter, formatter, writer, enable_ansi_colors, this.content_type, this.offset);
            },
            .file => |file| {
                try writer.writeAll(comptime Output.prettyFmt("<r>FileRef<r>", enable_ansi_colors));
                switch (file.pathlike) {
                    .path => |path| {
                        try writer.print(
                            comptime Output.prettyFmt(" (<green>\"{s}\"<r>)<r>", enable_ansi_colors),
                            .{
                                path.slice(),
                            },
                        );
                    },
                    .fd => |fd| {
                        if (Environment.isWindows) {
                            switch (fd.decodeWindows()) {
                                .uv => |uv_file| try writer.print(
                                    comptime Output.prettyFmt(" (<r>fd<d>:<r> <yellow>{d}<r>)<r>", enable_ansi_colors),
                                    .{uv_file},
                                ),
                                .windows => |handle| {
                                    if (Environment.isDebug) {
                                        @panic("this shouldn't be reachable.");
                                    }
                                    try writer.print(
                                        comptime Output.prettyFmt(" (<r>fd<d>:<r> <yellow>0x{x}<r>)<r>", enable_ansi_colors),
                                        .{@intFromPtr(handle)},
                                    );
                                },
                            }
                        } else {
                            try writer.print(
                                comptime Output.prettyFmt(" (<r>fd<d>:<r> <yellow>{d}<r>)<r>", enable_ansi_colors),
                                .{fd.native()},
                            );
                        }
                    },
                }
            },
            .bytes => {
                try writeFormatForSize(this.is_jsdom_file, this.size, writer, enable_ansi_colors);
            },
        }
    }

    const show_name = (this.is_jsdom_file and this.getNameString() != null) or (!this.name.isEmpty() and this.store != null and this.store.?.data == .bytes);
    if (!this.isS3() and (this.content_type.len > 0 or this.offset > 0 or show_name or this.last_modified != 0.0)) {
        try writer.writeAll(" {\n");
        {
            formatter.indent += 1;
            defer formatter.indent -= 1;

            if (show_name) {
                try formatter.writeIndent(Writer, writer);

                try writer.print(
                    comptime Output.prettyFmt("name<d>:<r> <green>\"{f}\"<r>", enable_ansi_colors),
                    .{
                        this.getNameString() orelse bun.String.empty,
                    },
                );

                if (this.content_type.len > 0 or this.offset > 0 or this.last_modified != 0) {
                    try formatter.printComma(Writer, writer, enable_ansi_colors);
                }

                try writer.writeAll("\n");
            }

            if (this.content_type.len > 0) {
                try formatter.writeIndent(Writer, writer);
                try writer.print(
                    comptime Output.prettyFmt("type<d>:<r> <green>\"{s}\"<r>", enable_ansi_colors),
                    .{
                        this.content_type,
                    },
                );

                if (this.offset > 0 or this.last_modified != 0) {
                    try formatter.printComma(Writer, writer, enable_ansi_colors);
                }

                try writer.writeAll("\n");
            }

            if (this.offset > 0) {
                try formatter.writeIndent(Writer, writer);

                try writer.print(
                    comptime Output.prettyFmt("offset<d>:<r> <yellow>{d}<r>\n", enable_ansi_colors),
                    .{
                        this.offset,
                    },
                );

                if (this.last_modified != 0) {
                    try formatter.printComma(Writer, writer, enable_ansi_colors);
                }

                try writer.writeAll("\n");
            }

            if (this.last_modified != 0) {
                try formatter.writeIndent(Writer, writer);

                try writer.print(
                    comptime Output.prettyFmt("lastModified<d>:<r> <yellow>{d}<r>\n", enable_ansi_colors),
                    .{
                        this.last_modified,
                    },
                );
            }
        }

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("}");
    }
}

const Retry = enum { @"continue", fail, no };

// TODO: move this to bun.sys?
// we choose not to inline this so that the path buffer is not on the stack unless necessary.
pub noinline fn mkdirIfNotExists(this: anytype, err: bun.sys.Error, path_string: [:0]const u8, err_path: []const u8) Retry {
    if (err.getErrno() == .NOENT and this.mkdirp_if_not_exists) {
        if (std.fs.path.dirname(path_string)) |dirname| {
            var node_fs: jsc.Node.fs.NodeFS = .{};
            switch (node_fs.mkdirRecursive(.{
                .path = .{ .string = bun.PathString.init(dirname) },
                .recursive = true,
                .always_return_none = true,
            })) {
                .result => {
                    this.mkdirp_if_not_exists = false;
                    return .@"continue";
                },
                .err => |err2| {
                    if (comptime @hasField(@TypeOf(this.*), "errno")) {
                        this.errno = bun.errnoToZigErr(err2.errno);
                    }
                    this.system_error = err.withPath(err_path).toSystemError();
                    if (comptime @hasField(@TypeOf(this.*), "opened_fd")) {
                        this.opened_fd = invalid_fd;
                    }
                    return .fail;
                },
            }
        }
    }
    return .no;
}

/// Write an empty string to a file by truncating it.
///
/// This behavior matches what we do with the fast path.
///
/// Returns an encoded `*JSPromise` that resolves if the file
/// - doesn't exist and is created
/// - exists and is truncated
fn writeFileWithEmptySourceToDestination(ctx: *jsc.JSGlobalObject, destination_blob: *Blob, options: WriteFileOptions) bun.JSError!jsc.JSValue {
    // SAFETY: null-checked by caller
    const destination_store = destination_blob.store.?;
    defer destination_blob.detach();

    switch (destination_store.data) {
        .file => |file| {
            // TODO: make this async
            const node_fs = ctx.bunVM().nodeFS();
            var result = node_fs.truncate(.{
                .path = file.pathlike,
                .len = 0,
                .flags = bun.O.CREAT,
            }, .sync);

            if (result == .err) {
                const errno = result.err.getErrno();
                var was_eperm = false;
                err: switch (errno) {
                    // truncate might return EPERM when the parent directory doesn't exist
                    // #6336
                    .PERM => {
                        was_eperm = true;
                        result.err.errno = @intCast(@intFromEnum(bun.sys.E.NOENT));
                        continue :err .NOENT;
                    },
                    .NOENT => {
                        if (options.mkdirp_if_not_exists == false) break :err;
                        // NOTE: if .err is PERM, it ~should~ really is a
                        // permissions issue
                        const dirpath: []const u8 = switch (file.pathlike) {
                            .path => |path| std.fs.path.dirname(path.slice()) orelse break :err,
                            .fd => {
                                // NOTE: if this is an fd, it means the file
                                // exists, so we shouldn't try to mkdir it
                                // also means PERM is _actually_ a
                                // permissions issue
                                if (was_eperm) result.err.errno = @intCast(@intFromEnum(bun.sys.E.PERM));
                                break :err;
                            },
                        };
                        const mkdir_result = node_fs.mkdirRecursive(.{
                            .path = .{ .string = bun.PathString.init(dirpath) },
                            // TODO: Do we really want .mode to be 0o777?
                            .recursive = true,
                            .always_return_none = true,
                        });
                        if (mkdir_result == .err) {
                            result.err = mkdir_result.err;
                            break :err;
                        }

                        // SAFETY: we check if `file.pathlike` is an fd or
                        // not above, returning if it is.
                        var buf: bun.PathBuffer = undefined;
                        const mode: bun.Mode = options.mode orelse jsc.Node.fs.default_permission;
                        while (true) {
                            const open_res = bun.sys.open(file.pathlike.path.sliceZ(&buf), bun.O.CREAT | bun.O.TRUNC, mode);
                            switch (open_res) {
                                // errors fall through and are handled below
                                .err => |err| {
                                    if (err.getErrno() == .INTR) continue;
                                    result.err = open_res.err;
                                    break :err;
                                },
                                .result => |fd| {
                                    fd.close();
                                    return jsc.JSPromise.resolvedPromiseValue(ctx, .jsNumber(0));
                                },
                            }
                        }
                    },
                    else => {},
                }

                result.err = result.err.withPathLike(file.pathlike);
                return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(ctx, try result.toJS(ctx));
            }
        },
        .s3 => |*s3| {

            // create empty file
            var aws_options = s3.getCredentialsWithOptions(options.extra_options, ctx) catch |err| {
                return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(ctx, ctx.takeException(err));
            };
            defer aws_options.deinit();

            const Wrapper = struct {
                promise: jsc.JSPromise.Strong,
                store: *Store,
                global: *jsc.JSGlobalObject,

                pub const new = bun.TrivialNew(@This());

                pub fn resolve(result: S3.S3UploadResult, opaque_this: *anyopaque) bun.JSTerminated!void {
                    const this: *@This() = @ptrCast(@alignCast(opaque_this));
                    defer this.deinit();
                    switch (result) {
                        .success => try this.promise.resolve(this.global, .jsNumber(0)),
                        .failure => |err| try this.promise.reject(this.global, err.toJS(this.global, this.store.getPath())),
                    }
                }

                fn deinit(this: *@This()) void {
                    this.promise.deinit();
                    this.store.deref();
                    bun.destroy(this);
                }
            };

            const promise = jsc.JSPromise.Strong.init(ctx);
            const promise_value = promise.value();
            const proxy = ctx.bunVM().transpiler.env.getHttpProxy(true, null, null);
            const proxy_url = if (proxy) |p| p.href else null;
            destination_store.ref();
            try S3.upload(
                &aws_options.credentials,
                s3.path(),
                "",
                destination_blob.contentTypeOrMimeType(),
                aws_options.content_disposition,
                aws_options.content_encoding,
                aws_options.acl,
                proxy_url,
                aws_options.storage_class,
                aws_options.request_payer,
                Wrapper.resolve,
                Wrapper.new(.{
                    .promise = promise,
                    .store = destination_store,
                    .global = ctx,
                }),
            );
            return promise_value;
        },
        // Writing to a buffer-backed blob should be a type error,
        // making this unreachable. TODO: `{}` -> `unreachable`
        .bytes => {},
    }

    return jsc.JSPromise.resolvedPromiseValue(ctx, jsc.JSValue.jsNumber(0));
}

pub fn writeFileWithSourceDestination(ctx: *jsc.JSGlobalObject, source_blob: *Blob, destination_blob: *Blob, options: WriteFileOptions) bun.JSError!jsc.JSValue {
    const destination_store = destination_blob.store orelse Output.panic("Destination blob is detached", .{});
    const destination_type = std.meta.activeTag(destination_store.data);

    // TODO: make sure this invariant isn't being broken elsewhere (outside
    // its usage from `Blob.writeFileInternal`), then upgrade this to
    // Environment.allow_assert
    if (Environment.isDebug) {
        bun.assertf(destination_type != .bytes, "Cannot write to a Blob backed by a Buffer or TypedArray. This is a bug in the caller. Please report it to the Bun team.", .{});
    }

    const source_store = source_blob.store orelse return writeFileWithEmptySourceToDestination(ctx, destination_blob, options);
    const source_type = std.meta.activeTag(source_store.data);

    if (destination_type == .file and source_type == .bytes) {
        var write_file_promise = bun.new(WriteFilePromise, .{
            .globalThis = ctx,
        });

        if (comptime Environment.isWindows) {
            var promise = JSPromise.create(ctx);
            const promise_value = promise.asValue(ctx);
            promise_value.ensureStillAlive();
            write_file_promise.promise.strong.set(ctx, promise_value);
            _ = write_file.WriteFileWindows.create(
                ctx.bunVM().eventLoop(),
                destination_blob.*,
                source_blob.*,
                *WriteFilePromise,
                write_file_promise,
                &WriteFilePromise.run,
                options.mkdirp_if_not_exists orelse true,
            ) catch |e| switch (e) {
                error.WriteFileWindowsDeinitialized => {},
                error.JSTerminated => |ex| return ex,
            };
            return promise_value;
        }

        const file_copier = write_file.WriteFile.create(
            destination_blob.*,
            source_blob.*,
            *WriteFilePromise,
            write_file_promise,
            WriteFilePromise.run,
            options.mkdirp_if_not_exists orelse true,
        ) catch unreachable;
        var task = write_file.WriteFileTask.createOnJSThread(bun.default_allocator, ctx, file_copier);
        // Defer promise creation until we're just about to schedule the task
        var promise = jsc.JSPromise.create(ctx);
        const promise_value = promise.asValue(ctx);
        write_file_promise.promise.strong.set(ctx, promise_value);
        promise_value.ensureStillAlive();
        task.schedule();
        return promise_value;
    }
    // If this is file <> file, we can just copy the file
    else if (destination_type == .file and source_type == .file) {
        if (comptime Environment.isWindows) {
            return Blob.copy_file.CopyFileWindows.init(
                destination_store,
                source_store,
                ctx.bunVM().eventLoop(),
                options.mkdirp_if_not_exists orelse true,
                destination_blob.size,
                options.mode,
            );
        }
        var file_copier = copy_file.CopyFile.create(
            bun.default_allocator,
            destination_store,
            source_store,
            destination_blob.offset,
            destination_blob.size,
            ctx,
            options.mkdirp_if_not_exists orelse true,
            options.mode,
        );
        file_copier.schedule();
        return file_copier.promise.value();
    } else if (destination_type == .file and source_type == .s3) {
        const s3 = &source_store.data.s3;
        if (try jsc.WebCore.ReadableStream.fromJS(try jsc.WebCore.ReadableStream.fromBlobCopyRef(
            ctx,
            source_blob,
            @truncate(s3.options.partSize),
        ), ctx)) |stream| {
            return destination_blob.pipeReadableStreamToBlob(ctx, stream, options.extra_options);
        } else {
            return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(ctx, ctx.createErrorInstance("Failed to stream bytes from s3 bucket", .{}));
        }
    } else if (destination_type == .bytes and source_type == .bytes) {
        // If this is bytes <> bytes, we can just duplicate it
        // this is an edgecase
        // it will happen if someone did Bun.write(new Blob([123]), new Blob([456]))
        // eventually, this could be like Buffer.concat
        const cloned = Blob.new(source_blob.dupe());
        return JSPromise.resolvedPromiseValue(ctx, cloned.toJS(ctx));
    } else if (destination_type == .bytes and (source_type == .file or source_type == .s3)) {
        const blob_value = source_blob.getSliceFrom(ctx, 0, 0, "", false);

        return JSPromise.resolvedPromiseValue(
            ctx,
            blob_value,
        );
    } else if (destination_type == .s3) {
        const s3 = &destination_store.data.s3;
        var aws_options = s3.getCredentialsWithOptions(options.extra_options, ctx) catch |err| {
            return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(ctx, ctx.takeException(err));
        };
        defer aws_options.deinit();
        const proxy = ctx.bunVM().transpiler.env.getHttpProxy(true, null, null);
        const proxy_url = if (proxy) |p| p.href else null;
        switch (source_store.data) {
            .bytes => |bytes| {
                if (bytes.len > S3.MultiPartUploadOptions.MAX_SINGLE_UPLOAD_SIZE) {
                    if (try jsc.WebCore.ReadableStream.fromJS(try jsc.WebCore.ReadableStream.fromBlobCopyRef(
                        ctx,
                        source_blob,
                        @truncate(s3.options.partSize),
                    ), ctx)) |stream| {
                        return S3.uploadStream(
                            (if (options.extra_options != null) aws_options.credentials.dupe() else s3.getCredentials()),
                            s3.path(),
                            stream,
                            ctx,
                            aws_options.options,
                            aws_options.acl,
                            aws_options.storage_class,
                            destination_blob.contentTypeOrMimeType(),
                            aws_options.content_disposition,
                            aws_options.content_encoding,
                            proxy_url,
                            aws_options.request_payer,
                            null,
                            undefined,
                        );
                    } else {
                        return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(ctx, ctx.createErrorInstance("Failed to stream bytes to s3 bucket", .{}));
                    }
                } else {
                    const Wrapper = struct {
                        store: *Store,
                        promise: jsc.JSPromise.Strong,
                        global: *jsc.JSGlobalObject,

                        pub const new = bun.TrivialNew(@This());

                        pub fn resolve(result: S3.S3UploadResult, opaque_self: *anyopaque) bun.JSTerminated!void {
                            const this: *@This() = @ptrCast(@alignCast(opaque_self));
                            defer this.deinit();
                            switch (result) {
                                .success => try this.promise.resolve(this.global, .jsNumber(this.store.data.bytes.len)),
                                .failure => |err| try this.promise.reject(this.global, err.toJS(this.global, this.store.getPath())),
                            }
                        }

                        fn deinit(this: *@This()) void {
                            this.promise.deinit();
                            this.store.deref();
                        }
                    };
                    source_store.ref();
                    const promise = jsc.JSPromise.Strong.init(ctx);
                    const promise_value = promise.value();

                    try S3.upload(
                        &aws_options.credentials,
                        s3.path(),
                        bytes.slice(),
                        destination_blob.contentTypeOrMimeType(),
                        aws_options.content_disposition,
                        aws_options.content_encoding,
                        aws_options.acl,
                        proxy_url,
                        aws_options.storage_class,
                        aws_options.request_payer,
                        Wrapper.resolve,
                        Wrapper.new(.{
                            .store = source_store,
                            .promise = promise,
                            .global = ctx,
                        }),
                    );
                    return promise_value;
                }
            },
            .file, .s3 => {
                // stream
                if (try jsc.WebCore.ReadableStream.fromJS(try jsc.WebCore.ReadableStream.fromBlobCopyRef(
                    ctx,
                    source_blob,
                    @truncate(s3.options.partSize),
                ), ctx)) |stream| {
                    return S3.uploadStream(
                        (if (options.extra_options != null) aws_options.credentials.dupe() else s3.getCredentials()),
                        s3.path(),
                        stream,
                        ctx,
                        s3.options,
                        aws_options.acl,
                        aws_options.storage_class,
                        destination_blob.contentTypeOrMimeType(),
                        aws_options.content_disposition,
                        aws_options.content_encoding,
                        proxy_url,
                        aws_options.request_payer,
                        null,
                        undefined,
                    );
                } else {
                    return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(ctx, ctx.createErrorInstance("Failed to stream bytes to s3 bucket", .{}));
                }
            },
        }
    }

    unreachable;
}

const WriteFileOptions = struct {
    mkdirp_if_not_exists: ?bool = null,
    extra_options: ?JSValue = null,
    mode: ?bun.Mode = null,
};

/// ## Errors
/// - If `path_or_blob` is a detached blob
/// ## Panics
/// - If `path_or_blob` is a `Blob` backed by a byte store
pub fn writeFileInternal(globalThis: *jsc.JSGlobalObject, path_or_blob_: *PathOrBlob, data: jsc.JSValue, options: WriteFileOptions) bun.JSError!jsc.JSValue {
    if (data.isEmptyOrUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("Bun.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write", .{});
    }
    var path_or_blob = path_or_blob_.*;
    if (path_or_blob == .blob) {
        const blob_store = path_or_blob.blob.store orelse {
            return globalThis.throwInvalidArguments("Blob is detached", .{});
        };
        bun.assertWithLocation(blob_store.data != .bytes, @src());
        // TODO only reset last_modified on success paths instead of
        // resetting last_modified at the beginning for better performance.
        if (blob_store.data == .file) {
            // reset last_modified to force getLastModified() to reload after writing.
            blob_store.data.file.last_modified = jsc.init_timestamp;
        }
    }

    const input_store: ?*Store = if (path_or_blob == .blob) path_or_blob.blob.store else null;
    if (input_store) |st| st.ref();
    defer if (input_store) |st| st.deref();

    var needs_async = false;

    if (options.mkdirp_if_not_exists) |mkdir| {
        if (mkdir and
            path_or_blob == .blob and
            path_or_blob.blob.store != null and
            path_or_blob.blob.store.?.data == .file and
            path_or_blob.blob.store.?.data.file.pathlike == .fd)
        {
            return globalThis.throwInvalidArguments("Cannot create a directory for a file descriptor", .{});
        }
    }

    // If you're doing Bun.write(), try to go fast by writing short input on the main thread.
    // This is a heuristic, but it's a good one.
    //
    // except if you're on Windows. Windows I/O is slower. Let's not even try.
    if (comptime !Environment.isWindows) {
        if (path_or_blob == .path or
            // If they try to set an offset, its a little more complicated so let's avoid that
            (path_or_blob.blob.offset == 0 and !path_or_blob.blob.isS3() and
                // Is this a file that is known to be a pipe? Let's avoid blocking the main thread on it.
                !(path_or_blob.blob.store != null and
                    path_or_blob.blob.store.?.data == .file and
                    path_or_blob.blob.store.?.data.file.mode != 0 and
                    bun.isRegularFile(path_or_blob.blob.store.?.data.file.mode))))
        {
            if (data.isString()) {
                const len = try data.getLength(globalThis);

                if (len < 256 * 1024) {
                    const str = try data.toBunString(globalThis);
                    defer str.deref();

                    const pathlike: jsc.Node.PathOrFileDescriptor = if (path_or_blob == .path)
                        path_or_blob.path
                    else
                        path_or_blob.blob.store.?.data.file.pathlike;

                    if (pathlike == .path) {
                        const result = writeStringToFileFast(
                            globalThis,
                            pathlike,
                            str,
                            &needs_async,
                            true,
                        );
                        if (!needs_async) {
                            return result;
                        }
                    } else {
                        const result = writeStringToFileFast(
                            globalThis,
                            pathlike,
                            str,
                            &needs_async,
                            false,
                        );
                        if (!needs_async) {
                            return result;
                        }
                    }
                }
            } else if (data.asArrayBuffer(globalThis)) |buffer_view| {
                if (buffer_view.byte_len < 256 * 1024) {
                    const pathlike: jsc.Node.PathOrFileDescriptor = if (path_or_blob == .path)
                        path_or_blob.path
                    else
                        path_or_blob.blob.store.?.data.file.pathlike;

                    if (pathlike == .path) {
                        const result = writeBytesToFileFast(
                            globalThis,
                            pathlike,
                            buffer_view.byteSlice(),
                            &needs_async,
                            true,
                        );

                        if (!needs_async) {
                            return result;
                        }
                    } else {
                        const result = writeBytesToFileFast(
                            globalThis,
                            pathlike,
                            buffer_view.byteSlice(),
                            &needs_async,
                            false,
                        );

                        if (!needs_async) {
                            return result;
                        }
                    }
                }
            }
        }
    }

    // if path_or_blob is a path, convert it into a file blob
    var destination_blob: Blob = if (path_or_blob == .path) brk: {
        const new_blob = Blob.findOrCreateFileFromPath(&path_or_blob_.path, globalThis, true);
        if (new_blob.store == null) {
            return globalThis.throwInvalidArguments("Writing to an empty blob is not implemented yet", .{});
        }
        break :brk new_blob;
    } else path_or_blob.blob.dupe();

    if (bun.Environment.allow_assert and path_or_blob == .blob) {
        // sanity check. Should never happen because
        // 1. destination blobs passed via path_or_blob are null checked at the very start
        // 2. newly created blobs from paths get null checked immediately after creation.
        bun.unsafeAssert(path_or_blob.blob.store != null);
    }

    // TODO: implement a writeev() fast path
    var source_blob: Blob = brk: {
        if (data.as(Response)) |response| {
            const bodyValue = response.getBodyValue();
            switch (bodyValue.*) {
                .WTFStringImpl,
                .InternalBlob,
                .Used,
                .Empty,
                .Blob,
                .Null,
                => {
                    break :brk bodyValue.use();
                },
                .Error => |*err_ref| {
                    destination_blob.detach();
                    _ = bodyValue.use();
                    return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err_ref.toJS(globalThis));
                },
                .Locked => {
                    if (destination_blob.isS3()) {
                        const s3 = &destination_blob.store.?.data.s3;
                        var aws_options = try s3.getCredentialsWithOptions(options.extra_options, globalThis);
                        defer aws_options.deinit();
                        _ = try bodyValue.toReadableStream(globalThis);

                        if (response.getBodyReadableStream(globalThis) orelse bodyValue.Locked.readable.get(globalThis)) |readable| {
                            if (readable.isDisturbed(globalThis)) {
                                destination_blob.detach();
                                return globalThis.throwInvalidArguments("ReadableStream has already been used", .{});
                            }
                            const proxy = globalThis.bunVM().transpiler.env.getHttpProxy(true, null, null);
                            const proxy_url = if (proxy) |p| p.href else null;

                            return S3.uploadStream(
                                (if (options.extra_options != null) aws_options.credentials.dupe() else s3.getCredentials()),
                                s3.path(),
                                readable,
                                globalThis,
                                aws_options.options,
                                aws_options.acl,
                                aws_options.storage_class,
                                destination_blob.contentTypeOrMimeType(),
                                aws_options.content_disposition,
                                aws_options.content_encoding,
                                proxy_url,
                                aws_options.request_payer,
                                null,
                                undefined,
                            );
                        }
                        destination_blob.detach();
                        return globalThis.throwInvalidArguments("ReadableStream has already been used", .{});
                    }
                    var task = bun.new(WriteFileWaitFromLockedValueTask, .{
                        .globalThis = globalThis,
                        .file_blob = destination_blob,
                        .promise = jsc.JSPromise.Strong.init(globalThis),
                        .mkdirp_if_not_exists = options.mkdirp_if_not_exists orelse true,
                    });
                    bodyValue.Locked.task = task;
                    bodyValue.Locked.onReceiveValue = WriteFileWaitFromLockedValueTask.thenWrap;
                    return task.promise.value();
                },
            }
        }

        if (data.as(Request)) |request| {
            const bodyValue = request.getBodyValue();
            switch (bodyValue.*) {
                .WTFStringImpl,
                .InternalBlob,
                .Used,
                .Empty,
                .Blob,
                .Null,
                => {
                    break :brk bodyValue.use();
                },
                .Error => |*err_ref| {
                    destination_blob.detach();
                    _ = bodyValue.use();
                    return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err_ref.toJS(globalThis));
                },
                .Locked => |locked| {
                    if (destination_blob.isS3()) {
                        const s3 = &destination_blob.store.?.data.s3;
                        var aws_options = try s3.getCredentialsWithOptions(options.extra_options, globalThis);
                        defer aws_options.deinit();
                        _ = try bodyValue.toReadableStream(globalThis);
                        if (request.getBodyReadableStream(globalThis) orelse locked.readable.get(globalThis)) |readable| {
                            if (readable.isDisturbed(globalThis)) {
                                destination_blob.detach();
                                return globalThis.throwInvalidArguments("ReadableStream has already been used", .{});
                            }
                            const proxy = globalThis.bunVM().transpiler.env.getHttpProxy(true, null, null);
                            const proxy_url = if (proxy) |p| p.href else null;
                            return S3.uploadStream(
                                (if (options.extra_options != null) aws_options.credentials.dupe() else s3.getCredentials()),
                                s3.path(),
                                readable,
                                globalThis,
                                aws_options.options,
                                aws_options.acl,
                                aws_options.storage_class,
                                destination_blob.contentTypeOrMimeType(),
                                aws_options.content_disposition,
                                aws_options.content_encoding,
                                proxy_url,
                                aws_options.request_payer,
                                null,
                                undefined,
                            );
                        }
                        destination_blob.detach();
                        return globalThis.throwInvalidArguments("ReadableStream has already been used", .{});
                    }
                    var task = bun.new(WriteFileWaitFromLockedValueTask, .{
                        .globalThis = globalThis,
                        .file_blob = destination_blob,
                        .promise = jsc.JSPromise.Strong.init(globalThis),
                        .mkdirp_if_not_exists = options.mkdirp_if_not_exists orelse true,
                    });

                    bodyValue.Locked.task = task;
                    bodyValue.Locked.onReceiveValue = WriteFileWaitFromLockedValueTask.thenWrap;

                    return task.promise.value();
                },
            }
        }

        // Check for Archive - allows Bun.write() and S3 writes to accept Archive instances
        if (data.as(Archive)) |archive| {
            archive.store.ref();
            break :brk Blob.initWithStore(archive.store, globalThis);
        }

        break :brk try Blob.get(
            globalThis,
            data,
            false,
            false,
        );
    };
    defer source_blob.detach();

    const destination_store = destination_blob.store;
    if (destination_store) |store| {
        store.ref();
    }

    defer {
        if (destination_store) |store| {
            store.deref();
        }
    }

    return writeFileWithSourceDestination(globalThis, &source_blob, &destination_blob, options);
}

fn validateWritableBlob(globalThis: *jsc.JSGlobalObject, blob: *Blob) bun.JSError!void {
    const store = blob.store orelse {
        return globalThis.throw("Cannot write to a detached Blob", .{});
    };
    if (store.data == .bytes) {
        return globalThis.throwInvalidArguments("Cannot write to a Blob backed by bytes, which are always read-only", .{});
    }
}

/// `Bun.write(destination, input, options?)`
pub fn writeFile(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();
    var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    // accept a path or a blob
    var path_or_blob = try PathOrBlob.fromJSNoCopy(globalThis, &args);
    defer {
        if (path_or_blob == .path) {
            path_or_blob.path.deinit();
        }
    }
    // "Blob" must actually be a BunFile, not a webcore blob.
    if (path_or_blob == .blob) {
        try validateWritableBlob(globalThis, &path_or_blob.blob);
    }

    const data = args.nextEat() orelse {
        return globalThis.throwInvalidArguments("Bun.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write", .{});
    };
    var mkdirp_if_not_exists: ?bool = null;
    var mode: ?bun.Mode = null;
    const options = args.nextEat();
    if (options) |options_object| {
        if (options_object.isObject()) {
            if (try options_object.getTruthy(globalThis, "createPath")) |create_directory| {
                if (!create_directory.isBoolean()) {
                    return globalThis.throwInvalidArgumentType("write", "options.createPath", "boolean");
                }
                mkdirp_if_not_exists = create_directory.toBoolean();
            }
            if (try options_object.get(globalThis, "mode")) |mode_value| {
                if (!mode_value.isEmptyOrUndefinedOrNull()) {
                    if (!mode_value.isNumber()) {
                        return globalThis.throwInvalidArgumentType("write", "options.mode", "number");
                    }
                    const mode_int = mode_value.toInt64();
                    if (mode_int < 0 or mode_int > 0o777) {
                        return globalThis.throwRangeError(mode_int, .{ .field_name = "mode", .min = 0, .max = 0o777 });
                    }
                    mode = @intCast(mode_int);
                }
            }
        } else if (!options_object.isEmptyOrUndefinedOrNull()) {
            return globalThis.throwInvalidArgumentType("write", "options", "object");
        }
    }
    return writeFileInternal(globalThis, &path_or_blob, data, .{
        .mkdirp_if_not_exists = mkdirp_if_not_exists,
        .extra_options = options,
        .mode = mode,
    });
}

const write_permissions = 0o664;

fn writeStringToFileFast(
    globalThis: *jsc.JSGlobalObject,
    pathlike: jsc.Node.PathOrFileDescriptor,
    str: bun.String,
    needs_async: *bool,
    comptime needs_open: bool,
) jsc.JSValue {
    const fd: bun.FileDescriptor = if (comptime !needs_open) pathlike.fd else brk: {
        var file_path: bun.PathBuffer = undefined;
        switch (bun.sys.open(
            pathlike.path.sliceZ(&file_path),
            // we deliberately don't use O_TRUNC here
            // it's a perf optimization
            bun.O.WRONLY | bun.O.CREAT | bun.O.NONBLOCK,
            write_permissions,
        )) {
            .result => |result| {
                break :brk result;
            },
            .err => |err| {
                if (err.getErrno() == .NOENT) {
                    needs_async.* = true;
                    return .zero;
                }

                return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(
                    globalThis,
                    err.withPath(pathlike.path.slice()).toJS(globalThis) catch return .zero,
                );
            },
        }
        unreachable;
    };

    var truncate = needs_open or str.isEmpty();
    const jsc_vm = globalThis.bunVM();
    var written: usize = 0;

    defer {
        // we only truncate if it's a path
        // if it's a file descriptor, we assume they want manual control over that behavior
        if (truncate) {
            _ = fd.truncate(@intCast(written));
        }
        if (needs_open) {
            fd.close();
        }
    }
    if (!str.isEmpty()) {
        var decoded = str.toUTF8(jsc_vm.allocator);
        defer decoded.deinit();

        var remain = decoded.slice();
        while (remain.len > 0) {
            const result = bun.sys.write(fd, remain);
            switch (result) {
                .result => |res| {
                    written += res;
                    remain = remain[res..];
                    if (res == 0) break;
                },
                .err => |err| {
                    truncate = false;
                    if (err.getErrno() == .AGAIN) {
                        needs_async.* = true;
                        return .zero;
                    }
                    if (comptime !needs_open) {
                        return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err.toJS(globalThis) catch return .zero);
                    }
                    return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(
                        globalThis,
                        err.withPath(pathlike.path.slice()).toJS(globalThis) catch return .zero,
                    );
                },
            }
        }
    }

    return jsc.JSPromise.resolvedPromiseValue(globalThis, jsc.JSValue.jsNumber(written));
}

fn writeBytesToFileFast(
    globalThis: *jsc.JSGlobalObject,
    pathlike: jsc.Node.PathOrFileDescriptor,
    bytes: []const u8,
    needs_async: *bool,
    comptime needs_open: bool,
) jsc.JSValue {
    const fd: bun.FileDescriptor = if (comptime !needs_open) pathlike.fd else brk: {
        var file_path: bun.PathBuffer = undefined;
        switch (bun.sys.open(
            pathlike.path.sliceZ(&file_path),
            if (!Environment.isWindows)
                // we deliberately don't use O_TRUNC here
                // it's a perf optimization
                bun.O.WRONLY | bun.O.CREAT | bun.O.NONBLOCK
            else
                bun.O.WRONLY | bun.O.CREAT,
            write_permissions,
        )) {
            .result => |result| {
                break :brk result;
            },
            .err => |err| {
                if (!Environment.isWindows) {
                    if (err.getErrno() == .NOENT) {
                        needs_async.* = true;
                        return .zero;
                    }
                }

                return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(
                    globalThis,
                    err.withPath(pathlike.path.slice()).toJS(globalThis) catch return .zero,
                );
            },
        }
    };

    // TODO: on windows this is always synchronous

    const truncate = needs_open or bytes.len == 0;
    var written: usize = 0;
    defer if (needs_open) fd.close();

    var remain = bytes;
    const end = remain.ptr + remain.len;

    while (remain.ptr != end) {
        const result = bun.sys.write(fd, remain);
        switch (result) {
            .result => |res| {
                written += res;
                remain = remain[res..];
                if (res == 0) break;
            },
            .err => |err| {
                if (!Environment.isWindows) {
                    if (err.getErrno() == .AGAIN) {
                        needs_async.* = true;
                        return .zero;
                    }
                }
                if (comptime !needs_open) {
                    return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(
                        globalThis,
                        err.toJS(globalThis) catch return .zero,
                    );
                }
                return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(
                    globalThis,
                    err.withPath(pathlike.path.slice()).toJS(globalThis) catch return .zero,
                );
            },
        }
    }

    if (truncate) {
        if (Environment.isWindows) {
            _ = std.os.windows.kernel32.SetEndOfFile(fd.cast());
        } else {
            _ = bun.sys.ftruncate(fd, @as(i64, @intCast(written)));
        }
    }

    return jsc.JSPromise.resolvedPromiseValue(globalThis, jsc.JSValue.jsNumber(written));
}
export fn JSDOMFile__construct(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) callconv(jsc.conv) ?*Blob {
    return JSDOMFile__construct_(globalThis, callframe) catch |err| switch (err) {
        error.JSError => null,
        error.OutOfMemory => {
            globalThis.throwOutOfMemory() catch {};
            return null;
        },
        error.JSTerminated => null,
    };
}
pub fn JSDOMFile__construct_(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*Blob {
    jsc.markBinding(@src());
    const allocator = bun.default_allocator;
    var blob: Blob = undefined;
    var arguments = callframe.arguments_old(3);
    const args = arguments.slice();

    if (args.len < 2) {
        return globalThis.throwInvalidArguments("new File(bits, name) expects at least 2 arguments", .{});
    }
    {
        const name_value_str = try bun.String.fromJS(args[1], globalThis);
        defer name_value_str.deref();

        blob = try get(globalThis, args[0], false, true);
        if (blob.store) |store_| {
            switch (store_.data) {
                .bytes => |*bytes| {
                    bytes.stored_name = bun.PathString.init(
                        name_value_str.toUTF8Bytes(bun.default_allocator),
                    );
                },
                .s3, .file => {
                    blob.name = name_value_str.dupeRef();
                },
            }
        } else if (!name_value_str.isEmpty()) {
            // not store but we have a name so we need a store
            blob.store = Blob.Store.new(.{
                .data = .{
                    .bytes = Blob.Store.Bytes.initEmptyWithName(
                        bun.PathString.init(name_value_str.toUTF8Bytes(bun.default_allocator)),
                        allocator,
                    ),
                },
                .allocator = allocator,
                .ref_count = .init(1),
            });
        }
    }

    var set_last_modified = false;

    if (args.len > 2) {
        const options = args[2];
        if (options.isObject()) {
            // type, the ASCII-encoded string in lower case
            // representing the media type of the Blob.
            // Normative conditions for this member are provided
            // in the § 3.1 Constructors.
            if (try options.get(globalThis, "type")) |content_type| {
                inner: {
                    if (content_type.isString()) {
                        var content_type_str = try content_type.toSlice(globalThis, bun.default_allocator);
                        defer content_type_str.deinit();
                        const slice = content_type_str.slice();
                        if (!strings.isAllASCII(slice)) {
                            break :inner;
                        }
                        blob.content_type_was_set = true;

                        if (globalThis.bunVM().mimeType(slice)) |mime| {
                            blob.content_type = mime.value;
                            break :inner;
                        }
                        const content_type_buf = bun.handleOom(allocator.alloc(u8, slice.len));
                        blob.content_type = strings.copyLowercase(slice, content_type_buf);
                        blob.content_type_allocated = true;
                    }
                }
            }

            if (try options.getTruthy(globalThis, "lastModified")) |last_modified| {
                set_last_modified = true;
                blob.last_modified = try last_modified.coerce(f64, globalThis);
            }
        }
    }

    if (!set_last_modified) {
        // `lastModified` should be the current date in milliseconds if unspecified.
        // https://developer.mozilla.org/en-US/docs/Web/API/File/lastModified
        blob.last_modified = @floatFromInt(std.time.milliTimestamp());
    }

    if (blob.content_type.len == 0) {
        blob.content_type = "";
        blob.content_type_was_set = false;
    }

    var blob_ = Blob.new(blob);
    blob_.is_jsdom_file = true;
    return blob_;
}

fn calculateEstimatedByteSize(this: *Blob) void {
    // in-memory size. not the size on disk.
    var size: usize = @sizeOf(Blob);

    if (this.store) |store| {
        size += @sizeOf(Blob.Store);
        switch (store.data) {
            .bytes => {
                size += store.data.bytes.stored_name.estimatedSize();
                size += if (this.size != Blob.max_size)
                    this.size
                else
                    store.data.bytes.len;
            },
            .file => size += store.data.file.pathlike.estimatedSize(),
            .s3 => size += store.data.s3.estimatedSize(),
        }
    }

    this.reported_estimated_size = size + (this.content_type.len * @intFromBool(this.content_type_allocated)) + this.name.byteSlice().len;
}

pub fn estimatedSize(this: *Blob) usize {
    return this.reported_estimated_size;
}

comptime {
    _ = JSDOMFile__hasInstance;
}

pub fn constructBunFile(
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    var vm = globalObject.bunVM();
    const arguments = callframe.arguments_old(2).slice();
    var args = jsc.CallFrame.ArgumentsSlice.init(vm, arguments);
    defer args.deinit();

    var path = (try jsc.Node.PathOrFileDescriptor.fromJS(globalObject, &args, bun.default_allocator)) orelse {
        return globalObject.throwInvalidArguments("Expected file path string or file descriptor", .{});
    };
    const options = if (arguments.len >= 2) arguments[1] else null;

    if (path == .path) {
        if (strings.hasPrefixComptime(path.path.slice(), "s3://")) {
            return try S3File.constructInternalJS(globalObject, path.path, options);
        }
    }
    defer path.deinitAndUnprotect();

    var blob = Blob.findOrCreateFileFromPath(&path, globalObject, false);

    if (options) |opts| {
        if (opts.isObject()) {
            if (try opts.getTruthy(globalObject, "type")) |file_type| {
                inner: {
                    if (file_type.isString()) {
                        var allocator = bun.default_allocator;
                        var str = try file_type.toSlice(globalObject, bun.default_allocator);
                        defer str.deinit();
                        const slice = str.slice();
                        if (!strings.isAllASCII(slice)) {
                            break :inner;
                        }
                        blob.content_type_was_set = true;
                        if (vm.mimeType(str.slice())) |entry| {
                            blob.content_type = entry.value;
                            break :inner;
                        }
                        const content_type_buf = bun.handleOom(allocator.alloc(u8, slice.len));
                        blob.content_type = strings.copyLowercase(slice, content_type_buf);
                        blob.content_type_allocated = true;
                    }
                }
            }
            if (try opts.getTruthy(globalObject, "lastModified")) |last_modified| {
                blob.last_modified = try last_modified.coerce(f64, globalObject);
            }
        }
    }

    var ptr = Blob.new(blob);
    return ptr.toJS(globalObject);
}

pub fn findOrCreateFileFromPath(path_or_fd: *jsc.Node.PathOrFileDescriptor, globalThis: *JSGlobalObject, comptime check_s3: bool) Blob {
    var vm = globalThis.bunVM();
    const allocator = bun.default_allocator;
    if (check_s3) {
        if (path_or_fd.* == .path) {
            if (strings.startsWith(path_or_fd.path.slice(), "s3://")) {
                const credentials = globalThis.bunVM().transpiler.env.getS3Credentials();
                const copy = path_or_fd.*;
                path_or_fd.* = .{ .path = .{ .string = bun.PathString.empty } };
                return Blob.initWithStore(bun.handleOom(Blob.Store.initS3(copy.path, null, credentials, allocator)), globalThis);
            }
        }
    }

    const path: jsc.Node.PathOrFileDescriptor = brk: {
        switch (path_or_fd.*) {
            .path => {
                var slice = path_or_fd.path.slice();

                if (Environment.isWindows and bun.strings.eqlComptime(slice, "/dev/null")) {
                    path_or_fd.deinit();
                    path_or_fd.* = .{
                        .path = .{
                            // this memory is freed with this allocator in `Blob.Store.deinit`
                            .string = bun.PathString.init(bun.handleOom(allocator.dupe(u8, "\\\\.\\NUL"))),
                        },
                    };
                    slice = path_or_fd.path.slice();
                }

                if (vm.standalone_module_graph) |graph| {
                    if (graph.find(slice)) |file| {
                        defer {
                            if (path_or_fd.path != .string) {
                                path_or_fd.deinit();
                                path_or_fd.* = .{ .path = .{ .string = bun.PathString.empty } };
                            }
                        }

                        return file.blob(globalThis).dupe();
                    }
                }

                path_or_fd.toThreadSafe();
                const copy = path_or_fd.*;
                path_or_fd.* = .{ .path = .{ .string = bun.PathString.empty } };
                break :brk copy;
            },
            .fd => {
                if (path_or_fd.fd.stdioTag()) |tag| {
                    const store = switch (tag) {
                        .std_in => vm.rareData().stdin(),
                        .std_err => vm.rareData().stderr(),
                        .std_out => vm.rareData().stdout(),
                    };
                    store.ref();
                    return Blob.initWithStore(store, globalThis);
                }
                break :brk path_or_fd.*;
            },
        }
    };

    return Blob.initWithStore(bun.handleOom(Blob.Store.initFile(path, null, allocator)), globalThis);
}

pub fn getStream(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    const thisValue = callframe.this();
    if (js.streamGetCached(thisValue)) |cached| {
        return cached;
    }
    var recommended_chunk_size: SizeType = 0;
    const recommended_chunk_size_value = callframe.argument(0);
    if (!recommended_chunk_size_value.isUndefinedOrNull()) {
        if (!recommended_chunk_size_value.isNumber()) {
            return globalThis.throwInvalidArguments("chunkSize must be a number", .{});
        }

        recommended_chunk_size = @intCast(@max(0, @as(i52, @truncate(recommended_chunk_size_value.toInt64()))));
    }
    const stream = try jsc.WebCore.ReadableStream.fromBlobCopyRef(
        globalThis,
        this,
        recommended_chunk_size,
    );

    if (this.store) |store| {
        switch (store.data) {
            .file => |f| switch (f.pathlike) {
                .fd => {
                    // in the case we have a file descriptor store, we want to de-duplicate
                    // readable streams. in every other case we want `.stream()` to be it's
                    // own stream.
                    js.streamSetCached(thisValue, globalThis, stream);
                },
                else => {},
            },
            else => {},
        }
    }

    return stream;
}

pub fn toStreamWithOffset(
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    const this = callframe.this().as(Blob) orelse @panic("this is not a Blob");
    const args = callframe.arguments_old(1).slice();

    return jsc.WebCore.ReadableStream.fromFileBlobWithOffset(
        globalThis,
        this,
        @intCast(args[0].toInt64()),
    );
}

// Zig doesn't let you pass a function with a comptime argument to a runtime-knwon function.
fn lifetimeWrap(comptime Fn: anytype, comptime lifetime: jsc.WebCore.Lifetime) fn (*Blob, *jsc.JSGlobalObject) jsc.JSValue {
    return struct {
        fn wrap(this: *Blob, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
            return jsc.toJSHostCall(globalObject, @src(), Fn, .{ this, globalObject, lifetime });
        }
    }.wrap;
}

pub fn getText(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
    _: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    return this.getTextClone(globalThis);
}

pub fn getTextClone(
    this: *Blob,
    globalObject: *jsc.JSGlobalObject,
) bun.JSTerminated!jsc.JSValue {
    const store = this.store;
    if (store) |st| st.ref();
    defer if (store) |st| st.deref();
    return jsc.JSPromise.wrap(globalObject, lifetimeWrap(toString, .clone), .{ this, globalObject });
}

pub fn getTextTransfer(
    this: *Blob,
    globalObject: *jsc.JSGlobalObject,
) jsc.JSValue {
    const store = this.store;
    if (store) |st| st.ref();
    defer if (store) |st| st.deref();
    return jsc.JSPromise.wrap(globalObject, lifetimeWrap(toString, .transfer), .{ this, globalObject });
}

pub fn getJSON(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
    _: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    return this.getJSONShare(globalThis);
}

pub fn getJSONShare(
    this: *Blob,
    globalObject: *jsc.JSGlobalObject,
) bun.JSTerminated!jsc.JSValue {
    const store = this.store;
    if (store) |st| st.ref();
    defer if (store) |st| st.deref();
    return jsc.JSPromise.wrap(globalObject, lifetimeWrap(toJSON, .share), .{ this, globalObject });
}
pub fn getArrayBufferTransfer(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
) jsc.JSValue {
    const store = this.store;
    if (store) |st| st.ref();
    defer if (store) |st| st.deref();

    return jsc.JSPromise.wrap(globalThis, lifetimeWrap(toArrayBuffer, .transfer), .{ this, globalThis });
}

pub fn getArrayBufferClone(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
) bun.JSTerminated!jsc.JSValue {
    const store = this.store;
    if (store) |st| st.ref();
    defer if (store) |st| st.deref();
    return jsc.JSPromise.wrap(globalThis, lifetimeWrap(toArrayBuffer, .clone), .{ this, globalThis });
}

pub fn getArrayBuffer(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
    _: *jsc.CallFrame,
) bun.JSError!JSValue {
    return this.getArrayBufferClone(globalThis);
}

pub fn getBytesClone(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
) bun.JSTerminated!JSValue {
    const store = this.store;
    if (store) |st| st.ref();
    defer if (store) |st| st.deref();
    return jsc.JSPromise.wrap(globalThis, lifetimeWrap(toUint8Array, .clone), .{ this, globalThis });
}

pub fn getBytes(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
    _: *jsc.CallFrame,
) bun.JSError!JSValue {
    return this.getBytesClone(globalThis);
}

pub fn getBytesTransfer(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
) JSValue {
    const store = this.store;
    if (store) |st| st.ref();
    defer if (store) |st| st.deref();
    return jsc.JSPromise.wrap(globalThis, lifetimeWrap(toUint8Array, .transfer), .{ this, globalThis });
}

pub fn getFormData(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
    _: *jsc.CallFrame,
) bun.JSError!JSValue {
    const store = this.store;
    if (store) |st| st.ref();
    defer if (store) |st| st.deref();

    return jsc.JSPromise.wrap(globalThis, lifetimeWrap(toFormData, .temporary), .{ this, globalThis });
}

fn getExistsSync(this: *Blob) jsc.JSValue {
    if (this.size == Blob.max_size) {
        this.resolveSize();
    }

    // If there's no store that means it's empty and we just return true
    // it will not error to return an empty Blob
    const store = this.store orelse return .true;

    if (store.data == .bytes) {
        // Bytes will never error
        return .true;
    }

    // We say regular files and pipes exist.
    // This is mostly meant for "Can we use this in new Response(file)?"
    return JSValue.jsBoolean(
        bun.isRegularFile(store.data.file.mode) or bun.sys.S.ISFIFO(store.data.file.mode),
    );
}

pub fn isS3(this: *const Blob) bool {
    if (this.store) |store| {
        return store.data == .s3;
    }
    return false;
}

const S3BlobDownloadTask = struct {
    blob: Blob,
    globalThis: *jsc.JSGlobalObject,
    promise: jsc.JSPromise.Strong,
    poll_ref: bun.Async.KeepAlive = .{},

    handler: S3ReadHandler,
    pub const new = bun.TrivialNew(S3BlobDownloadTask);
    pub const S3ReadHandler = *const fn (this: *Blob, globalthis: *JSGlobalObject, raw_bytes: []u8) JSValue;

    pub fn callHandler(this: *S3BlobDownloadTask, raw_bytes: []u8) JSValue {
        return this.handler(&this.blob, this.globalThis, raw_bytes);
    }
    pub fn onS3DownloadResolved(result: S3.S3DownloadResult, this: *S3BlobDownloadTask) bun.JSTerminated!void {
        defer this.deinit();
        switch (result) {
            .success => |response| {
                const bytes = response.body.list.items;
                if (this.blob.size == Blob.max_size) {
                    this.blob.size = @truncate(bytes.len);
                }
                try jsc.AnyPromise.wrap(.{ .normal = this.promise.get() }, this.globalThis, S3BlobDownloadTask.callHandler, .{ this, bytes });
            },
            inline .not_found, .failure => |err| {
                try this.promise.reject(this.globalThis, err.toJS(this.globalThis, this.blob.store.?.getPath()));
            },
        }
    }

    pub fn init(globalThis: *jsc.JSGlobalObject, blob: *Blob, handler: S3BlobDownloadTask.S3ReadHandler) bun.JSTerminated!JSValue {
        blob.store.?.ref();

        const this = S3BlobDownloadTask.new(.{
            .globalThis = globalThis,
            .blob = blob.*,
            .promise = jsc.JSPromise.Strong.init(globalThis),
            .handler = handler,
        });
        const promise = this.promise.value();
        const env = this.globalThis.bunVM().transpiler.env;
        const credentials = this.blob.store.?.data.s3.getCredentials();
        const path = this.blob.store.?.data.s3.path();

        this.poll_ref.ref(globalThis.bunVM());
        const s3_store = &this.blob.store.?.data.s3;
        if (blob.offset > 0) {
            const len: ?usize = if (blob.size != Blob.max_size) @intCast(blob.size) else null;
            const offset: usize = @intCast(blob.offset);
            try S3.downloadSlice(credentials, path, offset, len, @ptrCast(&S3BlobDownloadTask.onS3DownloadResolved), this, if (env.getHttpProxy(true, null, null)) |proxy| proxy.href else null, s3_store.request_payer);
        } else if (blob.size == Blob.max_size) {
            try S3.download(credentials, path, @ptrCast(&S3BlobDownloadTask.onS3DownloadResolved), this, if (env.getHttpProxy(true, null, null)) |proxy| proxy.href else null, s3_store.request_payer);
        } else {
            const len: usize = @intCast(blob.size);
            const offset: usize = @intCast(blob.offset);
            try S3.downloadSlice(credentials, path, offset, len, @ptrCast(&S3BlobDownloadTask.onS3DownloadResolved), this, if (env.getHttpProxy(true, null, null)) |proxy| proxy.href else null, s3_store.request_payer);
        }
        return promise;
    }

    pub fn deinit(this: *S3BlobDownloadTask) void {
        this.blob.store.?.deref();
        this.poll_ref.unref(this.globalThis.bunVM());
        this.promise.deinit();
        bun.destroy(this);
    }
};

pub fn doWrite(this: *Blob, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(3).slice();
    var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    try validateWritableBlob(globalThis, this);

    const data = args.nextEat() orelse {
        return globalThis.throwInvalidArguments("blob.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write", .{});
    };
    if (data.isEmptyOrUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("blob.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write", .{});
    }
    var mkdirp_if_not_exists: ?bool = null;
    const options = args.nextEat();
    if (options) |options_object| {
        if (options_object.isObject()) {
            if (try options_object.getTruthy(globalThis, "createPath")) |create_directory| {
                if (!create_directory.isBoolean()) {
                    return globalThis.throwInvalidArgumentType("write", "options.createPath", "boolean");
                }
                mkdirp_if_not_exists = create_directory.toBoolean();
            }
            if (try options_object.getTruthy(globalThis, "type")) |content_type| {
                //override the content type
                if (!content_type.isString()) {
                    return globalThis.throwInvalidArgumentType("write", "options.type", "string");
                }
                var content_type_str = try content_type.toSlice(globalThis, bun.default_allocator);
                defer content_type_str.deinit();
                const slice = content_type_str.slice();
                if (strings.isAllASCII(slice)) {
                    if (this.content_type_allocated) {
                        bun.default_allocator.free(this.content_type);
                    }
                    this.content_type_was_set = true;

                    if (globalThis.bunVM().mimeType(slice)) |mime| {
                        this.content_type = mime.value;
                    } else {
                        const content_type_buf = bun.handleOom(bun.default_allocator.alloc(u8, slice.len));
                        this.content_type = strings.copyLowercase(slice, content_type_buf);
                        this.content_type_allocated = true;
                    }
                }
            }
        } else if (!options_object.isEmptyOrUndefinedOrNull()) {
            return globalThis.throwInvalidArgumentType("write", "options", "object");
        }
    }
    var blob_internal: PathOrBlob = .{ .blob = this.* };
    return writeFileInternal(globalThis, &blob_internal, data, .{ .mkdirp_if_not_exists = mkdirp_if_not_exists, .extra_options = options });
}

pub fn doUnlink(this: *Blob, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(1).slice();
    var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    try validateWritableBlob(globalThis, this);

    const store = this.store.?;
    return switch (store.data) {
        .s3 => |*s3| try s3.unlink(store, globalThis, args.nextEat()),
        .file => |file| file.unlink(globalThis),
        else => unreachable, // validateWritableBlob should have caught this
    };
}

// This mostly means 'can it be read?'
pub fn getExists(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
    _: *jsc.CallFrame,
) bun.JSError!JSValue {
    if (this.isS3()) {
        return S3File.S3BlobStatTask.exists(globalThis, this);
    }
    return jsc.JSPromise.resolvedPromiseValue(globalThis, this.getExistsSync());
}

pub const FileStreamWrapper = struct {
    promise: jsc.JSPromise.Strong,
    readable_stream_ref: jsc.WebCore.ReadableStream.Strong,
    sink: *jsc.WebCore.FileSink,

    pub const new = bun.TrivialNew(@This());

    pub fn deinit(this: *@This()) void {
        this.promise.deinit();
        this.readable_stream_ref.deinit();
        this.sink.deref();
        bun.destroy(this);
    }
};

pub fn onFileStreamResolveRequestStream(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var args = callframe.arguments_old(2);
    var this = args.ptr[args.len - 1].asPromisePtr(FileStreamWrapper);
    defer this.deinit();
    var strong = this.readable_stream_ref;
    defer strong.deinit();
    this.readable_stream_ref = .{};
    if (strong.get(globalThis)) |stream| {
        stream.done(globalThis);
    }
    try this.promise.resolve(globalThis, jsc.JSValue.jsNumber(0));
    return .js_undefined;
}

pub fn onFileStreamRejectRequestStream(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments_old(2);
    var this = args.ptr[args.len - 1].asPromisePtr(FileStreamWrapper);
    defer this.sink.deref();
    const err = args.ptr[0];

    var strong = this.readable_stream_ref;
    defer strong.deinit();
    this.readable_stream_ref = .{};

    try this.promise.reject(globalThis, err);

    if (strong.get(globalThis)) |stream| {
        stream.cancel(globalThis);
    }
    return .js_undefined;
}
comptime {
    const jsonResolveRequestStream = jsc.toJSHostFn(onFileStreamResolveRequestStream);
    @export(&jsonResolveRequestStream, .{ .name = "Bun__FileStreamWrapper__onResolveRequestStream" });
    const jsonRejectRequestStream = jsc.toJSHostFn(onFileStreamRejectRequestStream);
    @export(&jsonRejectRequestStream, .{ .name = "Bun__FileStreamWrapper__onRejectRequestStream" });
}

pub fn pipeReadableStreamToBlob(this: *Blob, globalThis: *jsc.JSGlobalObject, readable_stream: jsc.WebCore.ReadableStream, extra_options: ?JSValue) bun.JSError!jsc.JSValue {
    var store = this.store orelse {
        return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, globalThis.createErrorInstance("Blob is detached", .{}));
    };

    if (this.isS3()) {
        const s3 = &this.store.?.data.s3;
        var aws_options = s3.getCredentialsWithOptions(extra_options, globalThis) catch |err| {
            return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, globalThis.takeException(err));
        };
        defer aws_options.deinit();

        const path = s3.path();
        const proxy = globalThis.bunVM().transpiler.env.getHttpProxy(true, null, null);
        const proxy_url = if (proxy) |p| p.href else null;

        return S3.uploadStream(
            (if (extra_options != null) aws_options.credentials.dupe() else s3.getCredentials()),
            path,
            readable_stream,
            globalThis,
            aws_options.options,
            aws_options.acl,
            aws_options.storage_class,
            this.contentTypeOrMimeType(),
            aws_options.content_disposition,
            aws_options.content_encoding,
            proxy_url,
            aws_options.request_payer,
            null,
            undefined,
        );
    }

    if (store.data != .file) {
        return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, globalThis.createErrorInstance("Blob is read-only", .{}));
    }

    const file_sink = brk_sink: {
        if (Environment.isWindows) {
            const pathlike = store.data.file.pathlike;
            const fd: bun.FileDescriptor = if (pathlike == .fd) pathlike.fd else brk: {
                var file_path: bun.PathBuffer = undefined;
                const path = pathlike.path.sliceZ(&file_path);
                switch (bun.sys.open(
                    path,
                    bun.O.WRONLY | bun.O.CREAT | bun.O.NONBLOCK,
                    write_permissions,
                )) {
                    .result => |result| {
                        break :brk result;
                    },
                    .err => |err| {
                        return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, try err.withPath(path).toJS(globalThis));
                    },
                }
                unreachable;
            };

            const is_stdout_or_stderr = brk: {
                if (pathlike != .fd) {
                    break :brk false;
                }

                if (globalThis.bunVM().rare_data) |rare| {
                    if (store == rare.stdout_store) {
                        break :brk true;
                    }

                    if (store == rare.stderr_store) {
                        break :brk true;
                    }
                }

                break :brk if (fd.stdioTag()) |tag| switch (tag) {
                    .std_out, .std_err => true,
                    else => false,
                } else false;
            };
            var sink = jsc.WebCore.FileSink.init(fd, this.globalThis.bunVM().eventLoop());
            sink.writer.owns_fd = pathlike != .fd;

            if (is_stdout_or_stderr) {
                switch (sink.writer.startSync(fd, false)) {
                    .err => |err| {
                        sink.deref();
                        return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, try err.toJS(globalThis));
                    },
                    else => {},
                }
            } else {
                switch (sink.writer.start(fd, true)) {
                    .err => |err| {
                        sink.deref();
                        return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, try err.toJS(globalThis));
                    },
                    else => {},
                }
            }

            break :brk_sink sink;
        }

        var sink = jsc.WebCore.FileSink.init(bun.invalid_fd, this.globalThis.bunVM().eventLoop());

        const input_path: jsc.WebCore.PathOrFileDescriptor = brk: {
            if (store.data.file.pathlike == .fd) {
                break :brk .{ .fd = store.data.file.pathlike.fd };
            } else {
                break :brk .{
                    .path = bun.handleOom(ZigString.Slice.initDupe(
                        bun.default_allocator,
                        store.data.file.pathlike.path.slice(),
                    )),
                };
            }
        };
        defer input_path.deinit();

        const stream_start: jsc.WebCore.streams.Start = .{
            .FileSink = .{
                .input_path = input_path,
            },
        };

        switch (sink.start(stream_start)) {
            .err => |err| {
                sink.deref();
                return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, try err.toJS(globalThis));
            },
            else => {},
        }
        break :brk_sink sink;
    };
    var signal = &file_sink.signal;

    signal.* = jsc.WebCore.FileSink.JSSink.SinkSignal.init(.zero);

    // explicitly set it to a dead pointer
    // we use this memory address to disable signals being sent
    signal.clear();
    bun.assert(signal.isDead());

    const assignment_result: jsc.JSValue = jsc.WebCore.FileSink.JSSink.assignToStream(
        globalThis,
        readable_stream.value,
        file_sink,
        @as(**anyopaque, @ptrCast(&signal.ptr)),
    );

    assignment_result.ensureStillAlive();

    // assert that it was updated
    bun.assert(!signal.isDead());

    if (assignment_result.toError()) |err| {
        file_sink.deref();
        return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
    }

    if (!assignment_result.isEmptyOrUndefinedOrNull()) {
        globalThis.bunVM().drainMicrotasks();

        assignment_result.ensureStillAlive();
        // it returns a Promise when it goes through ReadableStreamDefaultReader
        if (assignment_result.asAnyPromise()) |promise| {
            switch (promise.status()) {
                .pending => {
                    const wrapper = FileStreamWrapper.new(.{
                        .promise = jsc.JSPromise.Strong.init(globalThis),
                        .readable_stream_ref = jsc.WebCore.ReadableStream.Strong.init(readable_stream, globalThis),
                        .sink = file_sink,
                    });
                    const promise_value = wrapper.promise.value();

                    try assignment_result.then(
                        globalThis,
                        wrapper,
                        onFileStreamResolveRequestStream,
                        onFileStreamRejectRequestStream,
                    );
                    return promise_value;
                },
                .fulfilled => {
                    file_sink.deref();
                    readable_stream.done(globalThis);
                    return jsc.JSPromise.resolvedPromiseValue(globalThis, jsc.JSValue.jsNumber(0));
                },
                .rejected => {
                    file_sink.deref();

                    readable_stream.cancel(globalThis);

                    return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, promise.result(globalThis.vm()));
                },
            }
        } else {
            file_sink.deref();

            readable_stream.cancel(globalThis);

            return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, assignment_result);
        }
    }
    file_sink.deref();

    return jsc.JSPromise.resolvedPromiseValue(globalThis, jsc.JSValue.jsNumber(0));
}

pub fn getWriter(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    var arguments_ = callframe.arguments_old(1);
    var arguments = arguments_.ptr[0..arguments_.len];

    if (!arguments.ptr[0].isEmptyOrUndefinedOrNull() and !arguments.ptr[0].isObject()) {
        return globalThis.throwInvalidArguments("options must be an object or undefined", .{});
    }

    try validateWritableBlob(globalThis, this);

    var store = this.store.?;
    if (this.isS3()) {
        const s3 = &this.store.?.data.s3;
        const path = s3.path();
        const proxy = globalThis.bunVM().transpiler.env.getHttpProxy(true, null, null);
        const proxy_url = if (proxy) |p| p.href else null;
        if (arguments.len > 0) {
            const options = arguments.ptr[0];
            if (options.isObject()) {
                if (try options.getTruthy(globalThis, "type")) |content_type| {
                    //override the content type
                    if (!content_type.isString()) {
                        return globalThis.throwInvalidArgumentType("write", "options.type", "string");
                    }
                    var content_type_str = try content_type.toSlice(globalThis, bun.default_allocator);
                    defer content_type_str.deinit();
                    const slice = content_type_str.slice();
                    if (strings.isAllASCII(slice)) {
                        if (this.content_type_allocated) {
                            bun.default_allocator.free(this.content_type);
                        }
                        this.content_type_was_set = true;

                        if (globalThis.bunVM().mimeType(slice)) |mime| {
                            this.content_type = mime.value;
                        } else {
                            const content_type_buf = bun.handleOom(bun.default_allocator.alloc(u8, slice.len));
                            this.content_type = strings.copyLowercase(slice, content_type_buf);
                            this.content_type_allocated = true;
                        }
                    }
                }
                var content_disposition_str: ?ZigString.Slice = null;
                defer if (content_disposition_str) |cd| cd.deinit();
                if (try options.getTruthy(globalThis, "contentDisposition")) |content_disposition| {
                    if (!content_disposition.isString()) {
                        return globalThis.throwInvalidArgumentType("write", "options.contentDisposition", "string");
                    }
                    content_disposition_str = try content_disposition.toSlice(globalThis, bun.default_allocator);
                }
                var content_encoding_str: ?ZigString.Slice = null;
                defer if (content_encoding_str) |ce| ce.deinit();
                if (try options.getTruthy(globalThis, "contentEncoding")) |content_encoding| {
                    if (!content_encoding.isString()) {
                        return globalThis.throwInvalidArgumentType("write", "options.contentEncoding", "string");
                    }
                    content_encoding_str = try content_encoding.toSlice(globalThis, bun.default_allocator);
                }
                var credentialsWithOptions = try s3.getCredentialsWithOptions(options, globalThis);
                defer credentialsWithOptions.deinit();
                return try S3.writableStream(
                    credentialsWithOptions.credentials.dupe(),
                    path,
                    globalThis,
                    credentialsWithOptions.options,
                    this.contentTypeOrMimeType(),
                    if (content_disposition_str) |cd| cd.slice() else null,
                    if (content_encoding_str) |ce| ce.slice() else null,
                    proxy_url,
                    credentialsWithOptions.storage_class,
                    credentialsWithOptions.request_payer,
                );
            }
        }
        return try S3.writableStream(
            s3.getCredentials(),
            path,
            globalThis,
            .{},
            this.contentTypeOrMimeType(),
            null,
            null,
            proxy_url,
            null,
            s3.request_payer,
        );
    }

    if (Environment.isWindows) {
        const pathlike = store.data.file.pathlike;
        const vm = globalThis.bunVM();
        const fd: bun.FileDescriptor = if (pathlike == .fd) pathlike.fd else brk: {
            var file_path: bun.PathBuffer = undefined;
            switch (bun.sys.open(
                pathlike.path.sliceZ(&file_path),
                bun.O.WRONLY | bun.O.CREAT | bun.O.NONBLOCK,
                write_permissions,
            )) {
                .result => |result| {
                    break :brk result;
                },
                .err => |err| {
                    return globalThis.throwValue(try err.withPath(pathlike.path.slice()).toJS(globalThis));
                },
            }
            @compileError("unreachable");
        };

        const is_stdout_or_stderr = brk: {
            if (pathlike != .fd) {
                break :brk false;
            }

            if (vm.rare_data) |rare| {
                if (store == rare.stdout_store) {
                    break :brk true;
                }

                if (store == rare.stderr_store) {
                    break :brk true;
                }
            }

            break :brk if (fd.stdioTag()) |tag| switch (tag) {
                .std_out, .std_err => true,
                else => false,
            } else false;
        };
        var sink = jsc.WebCore.FileSink.init(fd, this.globalThis.bunVM().eventLoop());
        sink.writer.owns_fd = pathlike != .fd;

        if (is_stdout_or_stderr) {
            switch (sink.writer.startSync(fd, false)) {
                .err => |err| {
                    sink.deref();
                    return globalThis.throwValue(try err.toJS(globalThis));
                },
                else => {},
            }
        } else {
            switch (sink.writer.start(fd, true)) {
                .err => |err| {
                    sink.deref();
                    return globalThis.throwValue(try err.toJS(globalThis));
                },
                else => {},
            }
        }

        return sink.toJS(globalThis);
    }

    var sink = jsc.WebCore.FileSink.init(bun.invalid_fd, this.globalThis.bunVM().eventLoop());

    const input_path: jsc.WebCore.PathOrFileDescriptor = brk: {
        if (store.data.file.pathlike == .fd) {
            break :brk .{ .fd = store.data.file.pathlike.fd };
        } else {
            break :brk .{
                .path = bun.handleOom(ZigString.Slice.initDupe(
                    bun.default_allocator,
                    store.data.file.pathlike.path.slice(),
                )),
            };
        }
    };
    defer input_path.deinit();

    var stream_start: bun.webcore.streams.Start = .{
        .FileSink = .{
            .input_path = input_path,
        },
    };

    if (arguments.len > 0 and arguments.ptr[0].isObject()) {
        stream_start = try jsc.WebCore.streams.Start.fromJSWithTag(globalThis, arguments[0], .FileSink);
        stream_start.FileSink.input_path = input_path;
    }

    switch (sink.start(stream_start)) {
        .err => |err| {
            sink.deref();
            return globalThis.throwValue(try err.toJS(globalThis));
        },
        else => {},
    }

    return sink.toJS(globalThis);
}

pub fn getSliceFrom(this: *Blob, globalThis: *jsc.JSGlobalObject, relativeStart: i64, relativeEnd: i64, content_type: []const u8, content_type_was_allocated: bool) JSValue {
    const offset = this.offset +| @as(SizeType, @intCast(relativeStart));
    const len = @as(SizeType, @intCast(@max(relativeEnd -| relativeStart, 0)));

    // This copies over the charset field
    // which is okay because this will only be a <= slice
    var blob = this.dupe();
    blob.offset = offset;
    blob.size = len;

    // infer the content type if it was not specified
    if (content_type.len == 0 and this.content_type.len > 0 and !this.content_type_allocated) {
        blob.content_type = this.content_type;
    } else {
        blob.content_type = content_type;
    }
    blob.content_type_allocated = content_type_was_allocated;
    blob.content_type_was_set = this.content_type_was_set or content_type_was_allocated;

    var blob_ = Blob.new(blob);
    return blob_.toJS(globalThis);
}

/// https://w3c.github.io/FileAPI/#slice-method-algo
/// The slice() method returns a new Blob object with bytes ranging from the
/// optional start parameter up to but not including the optional end
/// parameter, and with a type attribute that is the value of the optional
/// contentType parameter. It must act as follows:
pub fn getSlice(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    const allocator = bun.default_allocator;
    var arguments_ = callframe.arguments_old(3);
    var args = arguments_.ptr[0..arguments_.len];

    if (this.size == 0) {
        const empty = Blob.initEmpty(globalThis);
        var ptr = Blob.new(empty);
        return ptr.toJS(globalThis);
    }

    // If the optional start parameter is not used as a parameter when making this call, let relativeStart be 0.
    var relativeStart: i64 = 0;

    // If the optional end parameter is not used as a parameter when making this call, let relativeEnd be size.
    var relativeEnd: i64 = @as(i64, @intCast(this.size));

    if (args.ptr[0].isString()) {
        args.ptr[2] = args.ptr[0];
        args.ptr[1] = .zero;
        args.ptr[0] = .zero;
        args.len = 3;
    } else if (args.ptr[1].isString()) {
        args.ptr[2] = args.ptr[1];
        args.ptr[1] = .zero;
        args.len = 3;
    }

    var args_iter = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), args);
    if (args_iter.nextEat()) |start_| {
        if (start_.isNumber()) {
            const start = start_.toInt64();
            if (start < 0) {
                // If the optional start parameter is negative, let relativeStart be start + size.
                relativeStart = @as(i64, @intCast(@max(start +% @as(i64, @intCast(this.size)), 0)));
            } else {
                // Otherwise, let relativeStart be start.
                relativeStart = @min(@as(i64, @intCast(start)), @as(i64, @intCast(this.size)));
            }
        }
    }

    if (args_iter.nextEat()) |end_| {
        if (end_.isNumber()) {
            const end = end_.toInt64();
            // If end is negative, let relativeEnd be max((size + end), 0).
            if (end < 0) {
                // If the optional start parameter is negative, let relativeStart be start + size.
                relativeEnd = @as(i64, @intCast(@max(end +% @as(i64, @intCast(this.size)), 0)));
            } else {
                // Otherwise, let relativeStart be start.
                relativeEnd = @min(@as(i64, @intCast(end)), @as(i64, @intCast(this.size)));
            }
        }
    }

    var content_type: string = "";
    var content_type_was_allocated = false;
    if (args_iter.nextEat()) |content_type_| {
        inner: {
            if (content_type_.isString()) {
                var zig_str = try content_type_.getZigString(globalThis);
                var slicer = zig_str.toSlice(bun.default_allocator);
                defer slicer.deinit();
                const slice = slicer.slice();
                if (!strings.isAllASCII(slice)) {
                    break :inner;
                }

                if (globalThis.bunVM().mimeType(slice)) |mime| {
                    content_type = mime.value;
                    break :inner;
                }

                content_type_was_allocated = slice.len > 0;
                const content_type_buf = bun.handleOom(allocator.alloc(u8, slice.len));
                content_type = strings.copyLowercase(slice, content_type_buf);
            }
        }
    }

    return this.getSliceFrom(globalThis, relativeStart, relativeEnd, content_type, content_type_was_allocated);
}

pub fn getMimeType(this: *const Blob) ?bun.http.MimeType {
    if (this.store) |store| {
        return store.mime_type;
    }

    return null;
}

pub fn getMimeTypeOrContentType(this: *const Blob) ?bun.http.MimeType {
    if (this.content_type_was_set) {
        return bun.http.MimeType.init(this.content_type, null, null);
    }

    if (this.store) |store| {
        return store.mime_type;
    }

    return null;
}

pub fn getType(
    this: *Blob,
    globalThis: *jsc.JSGlobalObject,
) JSValue {
    if (this.content_type.len > 0) {
        if (this.content_type_allocated) {
            return ZigString.init(this.content_type).toJS(globalThis);
        }
        return ZigString.init(this.content_type).toJS(globalThis);
    }

    if (this.store) |store| {
        return ZigString.init(store.mime_type.value).toJS(globalThis);
    }

    return ZigString.Empty.toJS(globalThis);
}

pub fn getNameString(this: *Blob) ?bun.String {
    if (this.name.tag != .Dead) return this.name;

    if (this.getFileName()) |path| {
        this.name = bun.String.cloneUTF8(path);
        return this.name;
    }

    return null;
}

// TODO: Move this to a separate `File` object or BunFile
pub fn getName(
    this: *Blob,
    _: jsc.JSValue,
    globalThis: *jsc.JSGlobalObject,
) bun.JSError!JSValue {
    return if (this.getNameString()) |name| name.toJS(globalThis) else .js_undefined;
}

pub fn setName(
    this: *Blob,
    jsThis: jsc.JSValue,
    globalThis: *jsc.JSGlobalObject,
    value: JSValue,
) JSError!void {
    // by default we don't have a name so lets allow it to be set undefined
    if (value.isEmptyOrUndefinedOrNull()) {
        this.name.deref();
        this.name = bun.String.dead;
        js.nameSetCached(jsThis, globalThis, value);
        return;
    }
    if (value.isString()) {
        const old_name = this.name;

        errdefer this.name = bun.String.empty;
        this.name = try bun.String.fromJS(value, globalThis);
        // We don't need to increment the reference count since tryFromJS already did it.
        js.nameSetCached(jsThis, globalThis, value);
        old_name.deref();
    }
}

pub fn getFileName(
    this: *const Blob,
) ?[]const u8 {
    if (this.store) |store| {
        if (store.data == .file) {
            if (store.data.file.pathlike == .path) {
                return store.data.file.pathlike.path.slice();
            }

            // we shouldn't return Number here.
        } else if (store.data == .bytes) {
            if (store.data.bytes.stored_name.slice().len > 0)
                return store.data.bytes.stored_name.slice();
        } else if (store.data == .s3) {
            return store.data.s3.path();
        }
    }

    return null;
}

pub fn getLoader(blob: *const Blob, jsc_vm: *VirtualMachine) ?bun.options.Loader {
    if (blob.getFileName()) |filename| {
        const current_path = bun.fs.Path.init(filename);
        return current_path.loader(&jsc_vm.transpiler.options.loaders) orelse .tsx;
    } else if (blob.getMimeTypeOrContentType()) |mime_type| {
        return .fromMimeType(mime_type);
    } else {
        // Be maximally permissive.
        return .tsx;
    }
}

// TODO: Move this to a separate `File` object or BunFile
pub fn getLastModified(
    this: *Blob,
    _: *jsc.JSGlobalObject,
) JSValue {
    if (this.store) |store| {
        if (store.data == .file) {
            // last_modified can be already set during read.
            if (store.data.file.last_modified == jsc.init_timestamp and !this.isS3()) {
                resolveFileStat(store);
            }
            return JSValue.jsNumber(store.data.file.last_modified);
        }
    }

    if (this.is_jsdom_file) {
        return JSValue.jsNumber(this.last_modified);
    }

    return JSValue.jsNumber(jsc.init_timestamp);
}

pub fn getSizeForBindings(this: *Blob) u64 {
    if (this.size == Blob.max_size) {
        this.resolveSize();
    }

    // If the file doesn't exist or is not seekable
    // signal that the size is unknown.
    if (this.store != null and this.store.?.data == .file and
        !(this.store.?.data.file.seekable orelse false))
    {
        return std.math.maxInt(u64);
    }

    if (this.size == Blob.max_size)
        return std.math.maxInt(u64);

    return this.size;
}

export fn Bun__Blob__getSizeForBindings(this: *Blob) callconv(.c) u64 {
    return this.getSizeForBindings();
}

export fn Blob__getDataPtr(value: jsc.JSValue) callconv(.c) ?*anyopaque {
    const blob = Blob.fromJS(value) orelse return null;
    const data = blob.sharedView();
    if (data.len == 0) return null;
    return @constCast(data.ptr);
}

export fn Blob__getSize(value: jsc.JSValue) callconv(.c) usize {
    const blob = Blob.fromJS(value) orelse return 0;
    const data = blob.sharedView();
    return data.len;
}

export fn Blob__fromBytes(globalThis: *jsc.JSGlobalObject, ptr: ?[*]const u8, len: usize) callconv(.c) *Blob {
    if (ptr == null or len == 0) {
        const blob = new(initEmpty(globalThis));
        return blob;
    }

    const bytes = bun.handleOom(bun.default_allocator.dupe(u8, ptr.?[0..len]));
    const store = Store.init(bytes, bun.default_allocator);
    return new(initWithStore(store, globalThis));
}

pub fn getStat(this: *Blob, globalThis: *jsc.JSGlobalObject, callback: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const store = this.store orelse return .js_undefined;
    // TODO: make this async for files
    return switch (store.data) {
        .file => |*file| {
            return switch (file.pathlike) {
                .path => |path_like| {
                    return bun.api.node.fs.Async.stat.create(globalThis, undefined, .{
                        .path = .{
                            .encoded_slice = switch (path_like) {
                                // it's already converted to utf8
                                .encoded_slice => |slice| try slice.toOwned(bun.default_allocator),
                                else => try ZigString.init(path_like.slice()).toSliceClone(bun.default_allocator),
                            },
                        },
                    }, globalThis.bunVM());
                },
                .fd => |fd| bun.api.node.fs.Async.fstat.create(globalThis, undefined, .{ .fd = fd }, globalThis.bunVM()),
            };
        },
        .s3 => S3File.getStat(this, globalThis, callback),
        else => .js_undefined,
    };
}
pub fn getSize(this: *Blob, _: *jsc.JSGlobalObject) JSValue {
    if (this.size == Blob.max_size) {
        if (this.isS3()) {
            return jsc.JSValue.jsNumber(std.math.nan(f64));
        }
        this.resolveSize();
        if (this.size == Blob.max_size and this.store != null) {
            return .jsNumber(std.math.inf(f64));
        } else if (this.size == 0 and this.store != null) {
            if (this.store.?.data == .file and
                (this.store.?.data.file.seekable orelse true) == false and
                this.store.?.data.file.max_size == Blob.max_size)
            {
                return .jsNumber(std.math.inf(f64));
            }
        }
    }

    return JSValue.jsNumber(this.size);
}

pub fn resolveSize(this: *Blob) void {
    if (this.store) |store| {
        if (store.data == .bytes) {
            const offset = this.offset;
            const store_size = store.size();
            if (store_size != Blob.max_size) {
                this.offset = @min(store_size, offset);
                this.size = store_size - offset;
            }

            return;
        } else if (store.data == .file) {
            if (store.data.file.seekable == null) {
                resolveFileStat(store);
            }

            if (store.data.file.seekable != null and store.data.file.max_size != Blob.max_size) {
                const store_size = store.data.file.max_size;
                const offset = this.offset;

                this.offset = @min(store_size, offset);
                this.size = store_size -| offset;
                return;
            }
        }

        this.size = 0;
    } else {
        this.size = 0;
    }
}

/// resolve file stat like size, last_modified
fn resolveFileStat(store: *Store) void {
    if (store.data.file.pathlike == .path) {
        var buffer: bun.PathBuffer = undefined;
        switch (bun.sys.stat(store.data.file.pathlike.path.sliceZ(&buffer))) {
            .result => |stat| {
                store.data.file.max_size = if (bun.isRegularFile(stat.mode) or stat.size > 0)
                    @truncate(@as(u64, @intCast(@max(stat.size, 0))))
                else
                    Blob.max_size;
                store.data.file.mode = @intCast(stat.mode);
                store.data.file.seekable = bun.isRegularFile(stat.mode);
                store.data.file.last_modified = jsc.toJSTime(stat.mtime().sec, stat.mtime().nsec);
            },
            // the file may not exist yet. Thats's okay.
            else => {},
        }
    } else if (store.data.file.pathlike == .fd) {
        switch (bun.sys.fstat(store.data.file.pathlike.fd)) {
            .result => |stat| {
                store.data.file.max_size = if (bun.isRegularFile(stat.mode) or stat.size > 0)
                    @as(SizeType, @truncate(@as(u64, @intCast(@max(stat.size, 0)))))
                else
                    Blob.max_size;
                store.data.file.mode = @intCast(stat.mode);
                store.data.file.seekable = bun.isRegularFile(stat.mode);
                store.data.file.last_modified = jsc.toJSTime(stat.mtime().sec, stat.mtime().nsec);
            },
            // the file may not exist yet. Thats's okay.
            else => {},
        }
    }
}

pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*Blob {
    const allocator = bun.default_allocator;
    var blob: Blob = undefined;
    var arguments = callframe.arguments_old(2);
    const args = arguments.slice();

    switch (args.len) {
        0 => {
            const empty: []u8 = &[_]u8{};
            blob = Blob.init(empty, allocator, globalThis);
        },
        else => {
            blob = try get(globalThis, args[0], false, true);

            if (args.len > 1) {
                const options = args[1];
                if (options.isObject()) {
                    // type, the ASCII-encoded string in lower case
                    // representing the media type of the Blob.
                    // Normative conditions for this member are provided
                    // in the § 3.1 Constructors.
                    if (try options.get(globalThis, "type")) |content_type| {
                        inner: {
                            if (content_type.isString()) {
                                var content_type_str = try content_type.toSlice(globalThis, bun.default_allocator);
                                defer content_type_str.deinit();
                                const slice = content_type_str.slice();
                                if (!strings.isAllASCII(slice)) {
                                    break :inner;
                                }
                                blob.content_type_was_set = true;

                                if (globalThis.bunVM().mimeType(slice)) |mime| {
                                    blob.content_type = mime.value;
                                    break :inner;
                                }
                                const content_type_buf = bun.handleOom(allocator.alloc(u8, slice.len));
                                blob.content_type = strings.copyLowercase(slice, content_type_buf);
                                blob.content_type_allocated = true;
                            }
                        }
                    }
                }
            }

            if (blob.content_type.len == 0) {
                blob.content_type = "";
                blob.content_type_was_set = false;
            }
        },
    }

    blob.calculateEstimatedByteSize();
    return Blob.new(blob);
}

pub fn finalize(this: *Blob) void {
    bun.assertf(
        this.isHeapAllocated(),
        "`finalize` may only be called on a heap-allocated Blob",
        .{},
    );
    var shared = Blob.Ref.adopt(this);
    shared.deinit();
}

pub fn initWithAllASCII(bytes: []u8, allocator: std.mem.Allocator, globalThis: *JSGlobalObject, is_all_ascii: bool) Blob {
    // avoid allocating a Blob.Store if the buffer is actually empty
    var store: ?*Blob.Store = null;
    if (bytes.len > 0) {
        store = Blob.Store.init(bytes, allocator);
        store.?.is_all_ascii = is_all_ascii;
    }
    return Blob{
        .size = @as(SizeType, @truncate(bytes.len)),
        .store = store,
        .content_type = "",
        .globalThis = globalThis,
        .charset = .fromBool(is_all_ascii),
    };
}

/// Takes ownership of `bytes`, which must have been allocated with `allocator`.
pub fn init(bytes: []u8, allocator: std.mem.Allocator, globalThis: *JSGlobalObject) Blob {
    return Blob{
        .size = @as(SizeType, @truncate(bytes.len)),
        .store = if (bytes.len > 0)
            Blob.Store.init(bytes, allocator)
        else
            null,
        .content_type = "",
        .globalThis = globalThis,
    };
}

pub fn createWithBytesAndAllocator(
    bytes: []u8,
    allocator: std.mem.Allocator,
    globalThis: *JSGlobalObject,
    was_string: bool,
) Blob {
    return Blob{
        .size = @as(SizeType, @truncate(bytes.len)),
        .store = if (bytes.len > 0)
            Blob.Store.init(bytes, allocator)
        else
            null,
        .content_type = if (was_string) MimeType.text.value else "",
        .globalThis = globalThis,
    };
}

pub fn tryCreate(
    bytes_: []const u8,
    allocator_: std.mem.Allocator,
    globalThis: *JSGlobalObject,
    was_string: bool,
) !Blob {
    if (comptime Environment.isLinux) {
        if (bun.linux.MemFdAllocator.shouldUse(bytes_)) {
            switch (bun.linux.MemFdAllocator.create(bytes_)) {
                .err => {},
                .result => |result| {
                    const store = Store.new(
                        .{
                            .data = .{
                                .bytes = result,
                            },
                            .allocator = bun.default_allocator,
                            .ref_count = std.atomic.Value(u32).init(1),
                        },
                    );
                    var blob = initWithStore(store, globalThis);
                    if (was_string and blob.content_type.len == 0) {
                        blob.content_type = MimeType.text.value;
                    }

                    return blob;
                },
            }
        }
    }

    return createWithBytesAndAllocator(try allocator_.dupe(u8, bytes_), allocator_, globalThis, was_string);
}

pub fn create(
    bytes_: []const u8,
    allocator_: std.mem.Allocator,
    globalThis: *JSGlobalObject,
    was_string: bool,
) Blob {
    return bun.handleOom(tryCreate(bytes_, allocator_, globalThis, was_string));
}

pub fn initWithStore(store: *Blob.Store, globalThis: *JSGlobalObject) Blob {
    return Blob{
        .size = store.size(),
        .store = store,
        .content_type = if (store.data == .file)
            store.data.file.mime_type.value
        else
            "",
        .globalThis = globalThis,
    };
}

pub fn initEmpty(globalThis: *JSGlobalObject) Blob {
    return Blob{
        .size = 0,
        .store = null,
        .content_type = "",
        .globalThis = globalThis,
    };
}

// Transferring doesn't change the reference count
// It is a move
inline fn transfer(this: *Blob) void {
    this.store = null;
}

pub fn detach(this: *Blob) void {
    if (this.store != null) this.store.?.deref();
    this.store = null;
}

/// This does not duplicate
/// This creates a new view
/// and increment the reference count
pub fn dupe(this: *const Blob) Blob {
    return this.dupeWithContentType(false);
}

pub fn dupeWithContentType(this: *const Blob, include_content_type: bool) Blob {
    if (this.store != null) this.store.?.ref();
    var duped = this.*;
    duped.setNotHeapAllocated();
    if (duped.content_type_allocated and duped.isHeapAllocated() and !include_content_type) {

        // for now, we just want to avoid a use-after-free here
        if (jsc.VirtualMachine.get().mimeType(duped.content_type)) |mime| {
            duped.content_type = mime.value;
        } else {
            // TODO: fix this
            // this is a bug.
            // it means whenever
            duped.content_type = "";
        }

        duped.content_type_allocated = false;
        duped.content_type_was_set = false;
        if (this.content_type_was_set) {
            duped.content_type_was_set = duped.content_type.len > 0;
        }
    } else if (duped.content_type_allocated and duped.isHeapAllocated() and include_content_type) {
        duped.content_type = bun.handleOom(bun.default_allocator.dupe(u8, this.content_type));
    }
    duped.name = duped.name.dupeRef();
    return duped;
}

pub fn toJS(this: *Blob, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
    // if (comptime Environment.allow_assert) {
    //     assert(this.isHeapAllocated());
    // }
    this.calculateEstimatedByteSize();

    if (this.isS3()) {
        return S3File.toJSUnchecked(globalObject, this);
    }

    return js.toJSUnchecked(globalObject, this);
}

pub fn deinit(this: *Blob) void {
    this.detach();
    this.name.deref();
    this.name = .dead;

    if (this.isHeapAllocated()) {
        bun.destroy(this);
    }
}

pub fn sharedView(this: *const Blob) []const u8 {
    if (this.size == 0 or this.store == null) return "";
    var slice_ = this.store.?.sharedView();
    if (slice_.len == 0) return "";
    slice_ = slice_[this.offset..];

    return slice_[0..@min(slice_.len, @as(usize, this.size))];
}

pub const Lifetime = jsc.WebCore.Lifetime;

pub fn setIsASCIIFlag(this: *Blob, is_all_ascii: bool) void {
    this.charset = .fromBool(is_all_ascii);
    // if this Blob represents the entire binary data
    // which will be pretty common
    // we can update the store's is_all_ascii flag
    // and any other Blob that points to the same store
    // can skip checking the encoding
    if (this.size > 0 and this.offset == 0 and this.store.?.data == .bytes) {
        this.store.?.is_all_ascii = is_all_ascii;
    }
}

pub fn needsToReadFile(this: *const Blob) bool {
    return this.store != null and (this.store.?.data == .file);
}

pub fn toStringWithBytes(this: *Blob, global: *JSGlobalObject, raw_bytes: []const u8, comptime lifetime: Lifetime) bun.JSError!JSValue {
    const bom, const buf = strings.BOM.detectAndSplit(raw_bytes);

    if (buf.len == 0) {
        // If all it contained was the bom, we need to free the bytes
        if (lifetime == .temporary) bun.default_allocator.free(raw_bytes);
        return ZigString.Empty.toJS(global);
    }

    if (bom == .utf16_le) {
        defer if (lifetime == .temporary) bun.default_allocator.free(raw_bytes);
        var out = bun.String.cloneUTF16(bun.reinterpretSlice(u16, buf));
        defer out.deref();
        return out.toJS(global);
    }

    // null == unknown
    // false == can't be
    const could_be_all_ascii = this.isAllASCII() orelse this.store.?.is_all_ascii;

    if (could_be_all_ascii == null or !could_be_all_ascii.?) {
        // if toUTF16Alloc returns null, it means there are no non-ASCII characters
        // instead of erroring, invalid characters will become a U+FFFD replacement character
        if (strings.toUTF16Alloc(bun.default_allocator, buf, false, false) catch return global.throwOutOfMemory()) |external| {
            if (lifetime != .temporary)
                this.setIsASCIIFlag(false);

            if (lifetime == .transfer) {
                this.detach();
            }

            if (lifetime == .temporary) {
                bun.default_allocator.free(raw_bytes);
            }

            return ZigString.toExternalU16(external.ptr, external.len, global);
        }

        if (lifetime != .temporary) this.setIsASCIIFlag(true);
    }

    switch (comptime lifetime) {
        // strings are immutable
        // we don't need to clone
        .clone => {
            this.store.?.ref();
            // we don't need to worry about UTF-8 BOM in this case because the store owns the memory.
            return ZigString.init(buf).external(global, this.store.?, Store.external);
        },
        .transfer => {
            const store = this.store.?;
            assert(store.data == .bytes);
            this.transfer();
            // we don't need to worry about UTF-8 BOM in this case because the store owns the memory.
            return ZigString.init(buf).external(global, store, Store.external);
        },
        // strings are immutable
        // sharing isn't really a thing
        .share => {
            this.store.?.ref();
            // we don't need to worry about UTF-8 BOM in this case because the store owns the memory.s
            return ZigString.init(buf).external(global, this.store.?, Store.external);
        },
        .temporary => {
            // if there was a UTF-8 BOM, we need to clone the buffer because
            // external doesn't support this case here yet.
            if (buf.len != raw_bytes.len) {
                var out = bun.String.cloneLatin1(buf);
                defer {
                    bun.default_allocator.free(raw_bytes);
                    out.deref();
                }

                return out.toJS(global);
            }

            return ZigString.init(buf).toExternalValue(global);
        },
    }
}

pub fn toStringTransfer(this: *Blob, global: *JSGlobalObject) bun.JSError!JSValue {
    return this.toString(global, .transfer);
}

pub fn toString(this: *Blob, global: *JSGlobalObject, comptime lifetime: Lifetime) bun.JSError!JSValue {
    if (this.needsToReadFile()) {
        return this.doReadFile(toStringWithBytes, global);
    }
    if (this.isS3()) {
        return this.doReadFromS3(toStringWithBytes, global);
    }

    const view_: []u8 =
        @constCast(this.sharedView());

    if (view_.len == 0)
        return ZigString.Empty.toJS(global);

    return toStringWithBytes(this, global, view_, lifetime);
}

pub fn toJSON(this: *Blob, global: *JSGlobalObject, comptime lifetime: Lifetime) bun.JSError!JSValue {
    if (this.needsToReadFile()) {
        return this.doReadFile(toJSONWithBytes, global);
    }
    if (this.isS3()) {
        return this.doReadFromS3(toJSONWithBytes, global);
    }

    const view_ = this.sharedView();

    return toJSONWithBytes(this, global, view_, lifetime);
}

pub fn toJSONWithBytes(this: *Blob, global: *JSGlobalObject, raw_bytes: []const u8, comptime lifetime: Lifetime) bun.JSError!JSValue {
    const bom, const buf = strings.BOM.detectAndSplit(raw_bytes);
    if (buf.len == 0) return global.createSyntaxErrorInstance("Unexpected end of JSON input", .{});

    if (bom == .utf16_le) {
        var out = bun.String.cloneUTF16(bun.reinterpretSlice(u16, buf));
        defer if (lifetime == .temporary) bun.default_allocator.free(raw_bytes);
        defer if (lifetime == .transfer) this.detach();
        defer out.deref();
        return out.toJSByParseJSON(global);
    }
    // null == unknown
    // false == can't be
    const could_be_all_ascii = this.isAllASCII() orelse this.store.?.is_all_ascii;
    defer if (comptime lifetime == .temporary) bun.default_allocator.free(@constCast(buf));

    if (could_be_all_ascii == null or !could_be_all_ascii.?) {
        var stack_fallback = std.heap.stackFallback(4096, bun.default_allocator);
        const allocator = stack_fallback.get();
        // if toUTF16Alloc returns null, it means there are no non-ASCII characters
        if (strings.toUTF16Alloc(allocator, buf, false, false) catch null) |external| {
            if (comptime lifetime != .temporary) this.setIsASCIIFlag(false);
            const result = ZigString.initUTF16(external).toJSONObject(global);
            allocator.free(external);
            return result;
        }

        if (comptime lifetime != .temporary) this.setIsASCIIFlag(true);
    }

    return ZigString.init(buf).toJSONObject(global);
}

pub fn toFormDataWithBytes(this: *Blob, global: *JSGlobalObject, buf: []u8, comptime _: Lifetime) JSValue {
    var encoder = this.getFormDataEncoding() orelse return {
        return ZigString.init("Invalid encoding").toErrorInstance(global);
    };
    defer encoder.deinit();

    return bun.FormData.toJS(global, buf, encoder.encoding) catch |err|
        global.createErrorInstance("FormData encoding failed: {s}", .{@errorName(err)});
}

pub fn toArrayBufferWithBytes(this: *Blob, global: *JSGlobalObject, buf: []u8, comptime lifetime: Lifetime) bun.JSError!JSValue {
    return toArrayBufferViewWithBytes(this, global, buf, lifetime, .ArrayBuffer);
}

pub fn toUint8ArrayWithBytes(this: *Blob, global: *JSGlobalObject, buf: []u8, comptime lifetime: Lifetime) bun.JSError!JSValue {
    return toArrayBufferViewWithBytes(this, global, buf, lifetime, .Uint8Array);
}

pub fn toArrayBufferViewWithBytes(this: *Blob, global: *JSGlobalObject, buf: []u8, comptime lifetime: Lifetime, comptime TypedArrayView: jsc.JSValue.JSType) bun.JSError!JSValue {
    switch (comptime lifetime) {
        .clone => {
            if (TypedArrayView != .ArrayBuffer) {
                // ArrayBuffer doesn't have this limit.
                if (buf.len > jsc.VirtualMachine.synthetic_allocation_limit) {
                    this.detach();
                    return global.throwOutOfMemory();
                }
            }

            if (comptime Environment.isLinux) {
                // If we can use a copy-on-write clone of the buffer, do so.
                if (this.store) |store| {
                    if (store.data == .bytes) {
                        const allocated_slice = store.data.bytes.allocatedSlice();
                        if (bun.isSliceInBuffer(buf, allocated_slice)) {
                            if (bun.linux.MemFdAllocator.from(store.data.bytes.allocator)) |allocator| {
                                allocator.ref();
                                defer allocator.deref();

                                const byteOffset = @as(usize, @intFromPtr(buf.ptr)) -| @as(usize, @intFromPtr(allocated_slice.ptr));
                                const byteLength = buf.len;

                                const result = jsc.ArrayBuffer.toArrayBufferFromSharedMemfd(
                                    allocator.fd.cast(),
                                    global,
                                    byteOffset,
                                    byteLength,
                                    allocated_slice.len,
                                    TypedArrayView,
                                );
                                debug("toArrayBuffer COW clone({d}, {d}) = {d}", .{ byteOffset, byteLength, @intFromBool(result != .zero) });

                                if (result != .zero) {
                                    return result;
                                }
                            }
                        }
                    }
                }
            }
            return jsc.ArrayBuffer.create(global, buf, TypedArrayView);
        },
        .share => {
            if (buf.len > jsc.synthetic_allocation_limit and TypedArrayView != .ArrayBuffer) {
                return global.throwOutOfMemory();
            }

            this.store.?.ref();
            return jsc.ArrayBuffer.fromBytes(buf, TypedArrayView).toJSWithContext(
                global,
                this.store.?,
                jsc.BlobArrayBuffer_deallocator,
                null,
            );
        },
        .transfer => {
            if (buf.len > jsc.VirtualMachine.synthetic_allocation_limit and TypedArrayView != .ArrayBuffer) {
                this.detach();
                return global.throwOutOfMemory();
            }

            const store = this.store.?;
            this.transfer();
            return jsc.ArrayBuffer.fromBytes(buf, TypedArrayView).toJSWithContext(
                global,
                store,
                jsc.array_buffer.BlobArrayBuffer_deallocator,
            );
        },
        .temporary => {
            if (buf.len > jsc.VirtualMachine.synthetic_allocation_limit and TypedArrayView != .ArrayBuffer) {
                bun.default_allocator.free(buf);
                return global.throwOutOfMemory();
            }

            return jsc.ArrayBuffer.fromBytes(buf, TypedArrayView).toJS(global);
        },
    }
}

pub fn toArrayBuffer(this: *Blob, global: *JSGlobalObject, comptime lifetime: Lifetime) bun.JSError!JSValue {
    debug("toArrayBuffer", .{});
    return toArrayBufferView(this, global, lifetime, .ArrayBuffer);
}

pub fn toUint8Array(this: *Blob, global: *JSGlobalObject, comptime lifetime: Lifetime) bun.JSError!JSValue {
    debug("toUin8Array", .{});
    return toArrayBufferView(this, global, lifetime, .Uint8Array);
}

pub fn toArrayBufferView(this: *Blob, global: *JSGlobalObject, comptime lifetime: Lifetime, comptime TypedArrayView: jsc.JSValue.JSType) bun.JSError!JSValue {
    const WithBytesFn = comptime if (TypedArrayView == .Uint8Array)
        toUint8ArrayWithBytes
    else
        toArrayBufferWithBytes;
    if (this.needsToReadFile()) {
        return this.doReadFile(WithBytesFn, global);
    }

    if (this.isS3()) {
        return this.doReadFromS3(WithBytesFn, global);
    }

    const view_ = this.sharedView();
    if (view_.len == 0)
        return jsc.ArrayBuffer.create(global, "", TypedArrayView);

    return WithBytesFn(this, global, @constCast(view_), lifetime);
}

pub fn toFormData(this: *Blob, global: *JSGlobalObject, comptime lifetime: Lifetime) bun.JSTerminated!JSValue {
    if (this.needsToReadFile()) {
        return this.doReadFile(toFormDataWithBytes, global);
    }
    if (this.isS3()) {
        return this.doReadFromS3(toFormDataWithBytes, global);
    }

    const view_ = this.sharedView();

    if (view_.len == 0)
        return jsc.DOMFormData.create(global);

    return toFormDataWithBytes(this, global, @constCast(view_), lifetime);
}

pub inline fn get(
    global: *JSGlobalObject,
    arg: JSValue,
    comptime move: bool,
    comptime require_array: bool,
) bun.JSError!Blob {
    return fromJSMovable(global, arg, move, require_array);
}

pub inline fn fromJSMove(global: *JSGlobalObject, arg: JSValue) bun.JSError!Blob {
    return fromJSWithoutDeferGC(global, arg, true, false);
}

pub inline fn fromJSClone(global: *JSGlobalObject, arg: JSValue) bun.JSError!Blob {
    return fromJSWithoutDeferGC(global, arg, false, true);
}

pub inline fn fromJSCloneOptionalArray(global: *JSGlobalObject, arg: JSValue) bun.JSError!Blob {
    return fromJSWithoutDeferGC(global, arg, false, false);
}

fn fromJSMovable(
    global: *JSGlobalObject,
    arg: JSValue,
    comptime move: bool,
    comptime require_array: bool,
) bun.JSError!Blob {
    const FromJSFunction = if (comptime move and !require_array)
        fromJSMove
    else if (!require_array)
        fromJSCloneOptionalArray
    else
        fromJSClone;

    return FromJSFunction(global, arg);
}

fn fromJSWithoutDeferGC(
    global: *JSGlobalObject,
    arg: JSValue,
    comptime move: bool,
    comptime require_array: bool,
) bun.JSError!Blob {
    var current = arg;
    if (current.isUndefinedOrNull()) {
        return Blob{ .globalThis = global };
    }

    var top_value = current;
    var might_only_be_one_thing = false;
    arg.ensureStillAlive();
    defer arg.ensureStillAlive();
    var fail_if_top_value_is_not_typed_array_like = false;
    switch (current.jsTypeLoose()) {
        .Array, .DerivedArray => {
            var top_iter = try jsc.JSArrayIterator.init(current, global);
            might_only_be_one_thing = top_iter.len == 1;
            if (top_iter.len == 0) {
                return Blob{ .globalThis = global };
            }
            if (might_only_be_one_thing) {
                top_value = (try top_iter.next()).?;
            }
        },
        else => {
            might_only_be_one_thing = true;
            if (require_array) {
                fail_if_top_value_is_not_typed_array_like = true;
            }
        },
    }

    if (might_only_be_one_thing or !move) {

        // Fast path: one item, we don't need to join
        switch (top_value.jsTypeLoose()) {
            .Cell,
            .NumberObject,
            jsc.JSValue.JSType.String,
            jsc.JSValue.JSType.StringObject,
            jsc.JSValue.JSType.DerivedStringObject,
            => {
                if (!fail_if_top_value_is_not_typed_array_like) {
                    var str = try top_value.toBunString(global);
                    defer str.deref();
                    const bytes, const ascii = try str.toOwnedSliceReturningAllASCII(bun.default_allocator);
                    return Blob.initWithAllASCII(bytes, bun.default_allocator, global, ascii);
                }
            },

            jsc.JSValue.JSType.ArrayBuffer,
            jsc.JSValue.JSType.Int8Array,
            jsc.JSValue.JSType.Uint8Array,
            jsc.JSValue.JSType.Uint8ClampedArray,
            jsc.JSValue.JSType.Int16Array,
            jsc.JSValue.JSType.Uint16Array,
            jsc.JSValue.JSType.Int32Array,
            jsc.JSValue.JSType.Uint32Array,
            jsc.JSValue.JSType.Float16Array,
            jsc.JSValue.JSType.Float32Array,
            jsc.JSValue.JSType.Float64Array,
            jsc.JSValue.JSType.BigInt64Array,
            jsc.JSValue.JSType.BigUint64Array,
            jsc.JSValue.JSType.DataView,
            => {
                return try Blob.tryCreate(top_value.asArrayBuffer(global).?.byteSlice(), bun.default_allocator, global, false);
            },

            .DOMWrapper => {
                if (!fail_if_top_value_is_not_typed_array_like) {
                    if (top_value.as(Blob)) |blob| {
                        if (comptime move) {
                            var _blob = blob.*;
                            _blob.setNotHeapAllocated();
                            blob.transfer();
                            return _blob;
                        } else {
                            return blob.dupe();
                        }
                    } else if (top_value.as(jsc.API.BuildArtifact)) |build| {
                        if (comptime move) {
                            // I don't think this case should happen?
                            var blob = build.blob;
                            blob.transfer();
                            return blob;
                        } else {
                            return build.blob.dupe();
                        }
                    } else {
                        const sliced = try current.toSliceClone(global);
                        if (sliced.allocator.get()) |allocator| {
                            return Blob.initWithAllASCII(@constCast(sliced.slice()), allocator, global, false);
                        }
                    }
                }
            },

            else => {},
        }

        // new Blob("ok")
        // new File("ok", "file.txt")
        if (fail_if_top_value_is_not_typed_array_like) {
            return global.throwInvalidArguments("new Blob() expects an Array", .{});
        }
    }

    var stack_allocator = std.heap.stackFallback(1024, bun.default_allocator);
    const stack_mem_all = stack_allocator.get();
    var stack: std.array_list.Managed(JSValue) = std.array_list.Managed(JSValue).init(stack_mem_all);
    var joiner = StringJoiner{ .allocator = stack_mem_all };
    var could_have_non_ascii = false;

    defer if (stack_allocator.fixed_buffer_allocator.end_index >= 1024) stack.deinit();

    while (true) {
        switch (current.jsTypeLoose()) {
            .NumberObject,
            jsc.JSValue.JSType.String,
            jsc.JSValue.JSType.StringObject,
            jsc.JSValue.JSType.DerivedStringObject,
            => {
                var sliced = try current.toSlice(global, bun.default_allocator);
                const allocator = sliced.allocator.get();
                could_have_non_ascii = could_have_non_ascii or !sliced.allocator.isWTFAllocator();
                joiner.push(sliced.slice(), allocator);
            },

            .Array, .DerivedArray => {
                var iter = try jsc.JSArrayIterator.init(current, global);
                try stack.ensureUnusedCapacity(iter.len);
                var any_arrays = false;
                while (try iter.next()) |item| {
                    if (item.isUndefinedOrNull()) continue;

                    // When it's a string or ArrayBuffer inside an array, we can avoid the extra push/pop
                    // we only really want this for nested arrays
                    // However, we must preserve the order
                    // That means if there are any arrays
                    // we have to restart the loop
                    if (!any_arrays) {
                        switch (item.jsTypeLoose()) {
                            .NumberObject,
                            .Cell,
                            .String,
                            .StringObject,
                            .DerivedStringObject,
                            => {
                                var sliced = try item.toSlice(global, bun.default_allocator);
                                const allocator = sliced.allocator.get();
                                could_have_non_ascii = could_have_non_ascii or !sliced.allocator.isWTFAllocator();
                                joiner.push(sliced.slice(), allocator);
                                continue;
                            },
                            .ArrayBuffer,
                            .Int8Array,
                            .Uint8Array,
                            .Uint8ClampedArray,
                            .Int16Array,
                            .Uint16Array,
                            .Int32Array,
                            .Uint32Array,
                            .Float16Array,
                            .Float32Array,
                            .Float64Array,
                            .BigInt64Array,
                            .BigUint64Array,
                            .DataView,
                            => {
                                could_have_non_ascii = true;
                                var buf = item.asArrayBuffer(global).?;
                                joiner.pushStatic(buf.byteSlice());
                                continue;
                            },
                            .Array, .DerivedArray => {
                                any_arrays = true;
                                could_have_non_ascii = true;
                                break;
                            },

                            .DOMWrapper => {
                                if (item.as(Blob)) |blob| {
                                    could_have_non_ascii = could_have_non_ascii or blob.charset != .all_ascii;
                                    joiner.pushStatic(blob.sharedView());
                                    continue;
                                } else {
                                    const sliced = try current.toSliceClone(global);
                                    const allocator = sliced.allocator.get();
                                    could_have_non_ascii = could_have_non_ascii or allocator != null;
                                    joiner.push(sliced.slice(), allocator);
                                }
                            },
                            else => {},
                        }
                    }

                    stack.appendAssumeCapacity(item);
                }
            },

            .DOMWrapper => {
                if (current.as(Blob)) |blob| {
                    could_have_non_ascii = could_have_non_ascii or blob.charset != .all_ascii;
                    joiner.pushStatic(blob.sharedView());
                } else {
                    const sliced = try current.toSliceClone(global);
                    const allocator = sliced.allocator.get();
                    could_have_non_ascii = could_have_non_ascii or allocator != null;
                    joiner.push(sliced.slice(), allocator);
                }
            },

            .ArrayBuffer,
            .Int8Array,
            .Uint8Array,
            .Uint8ClampedArray,
            .Int16Array,
            .Uint16Array,
            .Int32Array,
            .Uint32Array,
            .Float16Array,
            .Float32Array,
            .Float64Array,
            .BigInt64Array,
            .BigUint64Array,
            .DataView,
            => {
                var buf = current.asArrayBuffer(global).?;
                joiner.pushStatic(buf.slice());
                could_have_non_ascii = true;
            },

            else => {
                var sliced = try current.toSlice(global, bun.default_allocator);
                if (global.hasException()) {
                    const end_result = try joiner.done(bun.default_allocator);
                    bun.default_allocator.free(end_result);
                    return error.JSError;
                }
                could_have_non_ascii = could_have_non_ascii or !sliced.allocator.isWTFAllocator();
                joiner.push(sliced.slice(), sliced.allocator.get());
            },
        }
        current = stack.pop() orelse break;
    }

    const joined = try joiner.done(bun.default_allocator);

    if (!could_have_non_ascii) {
        return Blob.initWithAllASCII(joined, bun.default_allocator, global, true);
    }
    return Blob.init(joined, bun.default_allocator, global);
}

pub const Any = union(enum) {
    Blob: Blob,
    InternalBlob: Internal,
    WTFStringImpl: bun.WTF.StringImpl,

    pub fn fromOwnedSlice(allocator: std.mem.Allocator, bytes: []u8) Any {
        return .{ .InternalBlob = .{ .bytes = .fromOwnedSlice(allocator, bytes) } };
    }

    pub fn fromArrayList(list: std.array_list.Managed(u8)) Any {
        return .{ .InternalBlob = .{ .bytes = list } };
    }

    /// Assumed that AnyBlob itself is covered by the caller.
    pub fn memoryCost(this: *const Any) usize {
        return switch (this.*) {
            .Blob => |*blob| if (blob.store) |blob_store| blob_store.memoryCost() else 0,
            .WTFStringImpl => |str| if (str.refCount() == 1) str.memoryCost() else 0,
            .InternalBlob => |*internal_blob| internal_blob.memoryCost(),
        };
    }

    pub fn hasOneRef(this: *const Any) bool {
        if (this.store()) |s| {
            return s.hasOneRef();
        }

        return false;
    }

    pub fn getFileName(this: *const Any) ?[]const u8 {
        return switch (this.*) {
            .Blob => this.Blob.getFileName(),
            .WTFStringImpl => null,
            .InternalBlob => null,
        };
    }

    pub inline fn fastSize(this: *const Any) Blob.SizeType {
        return switch (this.*) {
            .Blob => this.Blob.size,
            .WTFStringImpl => @truncate(this.WTFStringImpl.byteLength()),
            .InternalBlob => @truncate(this.slice().len),
        };
    }

    pub inline fn size(this: *const Any) Blob.SizeType {
        return switch (this.*) {
            .Blob => this.Blob.size,
            .WTFStringImpl => @truncate(this.WTFStringImpl.utf8ByteLength()),
            else => @truncate(this.slice().len),
        };
    }

    pub fn hasContentTypeFromUser(this: Any) bool {
        return switch (this) {
            .Blob => this.Blob.hasContentTypeFromUser(),
            .WTFStringImpl => false,
            .InternalBlob => false,
        };
    }

    fn toInternalBlobIfPossible(this: *Any) void {
        if (this.* == .Blob) {
            if (this.Blob.store) |s| {
                if (s.data == .bytes and s.hasOneRef()) {
                    this.* = .{ .InternalBlob = s.data.bytes.toInternalBlob() };
                    s.deref();
                    return;
                }
            }
        }
    }

    pub fn toActionValue(this: *Any, globalThis: *JSGlobalObject, action: streams.BufferAction.Tag) bun.JSError!jsc.JSValue {
        if (action != .blob) {
            this.toInternalBlobIfPossible();
        }

        switch (action) {
            .text => {
                if (this.* == .Blob) {
                    return this.toString(globalThis, .clone);
                }

                return this.toStringTransfer(globalThis);
            },
            .bytes => {
                if (this.* == .Blob) {
                    return this.toArrayBufferView(globalThis, .clone, .Uint8Array);
                }

                return this.toUint8ArrayTransfer(globalThis);
            },
            .blob => {
                const result = Blob.new(this.toBlob(globalThis));
                result.globalThis = globalThis;
                return result.toJS(globalThis);
            },
            .arrayBuffer => {
                if (this.* == .Blob) {
                    return this.toArrayBufferView(globalThis, .clone, .ArrayBuffer);
                }

                return this.toArrayBufferTransfer(globalThis);
            },
            .json => {
                return this.toJSON(globalThis, .share);
            },
        }
    }

    pub fn toPromise(this: *Any, globalThis: *JSGlobalObject, action: streams.BufferAction.Tag) bun.JSTerminated!jsc.JSValue {
        return jsc.JSPromise.wrap(globalThis, toActionValue, .{ this, globalThis, action });
    }

    pub fn wrap(this: *Any, promise: jsc.AnyPromise, globalThis: *JSGlobalObject, action: streams.BufferAction.Tag) bun.JSTerminated!void {
        return promise.wrap(globalThis, toActionValue, .{ this, globalThis, action });
    }

    pub fn toJSON(this: *Any, global: *JSGlobalObject, comptime lifetime: jsc.WebCore.Lifetime) bun.JSError!JSValue {
        switch (this.*) {
            .Blob => return this.Blob.toJSON(global, lifetime),
            // .InlineBlob => {
            //     if (this.InlineBlob.len == 0) {
            //         return JSValue.jsNull();
            //     }
            //     var str = this.InlineBlob.toStringOwned(global);
            //     return str.parseJSON(global);
            // },
            .InternalBlob => {
                if (this.InternalBlob.bytes.items.len == 0) {
                    return JSValue.jsNull();
                }

                const str = this.InternalBlob.toJSON(global);

                // the GC will collect the string
                this.* = .{
                    .Blob = .{},
                };

                return str;
            },
            .WTFStringImpl => {
                var str = bun.String.init(this.WTFStringImpl);
                defer str.deref();
                this.* = .{
                    .Blob = .{},
                };

                if (str.length() == 0) {
                    return JSValue.jsNull();
                }

                return str.toJSByParseJSON(global);
            },
        }
    }

    pub fn toJSONShare(this: *Any, global: *JSGlobalObject) bun.JSError!JSValue {
        return this.toJSON(global, .share);
    }

    pub fn toStringTransfer(this: *Any, global: *JSGlobalObject) bun.JSError!JSValue {
        return this.toString(global, .transfer);
    }

    pub fn toUint8ArrayTransfer(this: *Any, global: *JSGlobalObject) bun.JSError!JSValue {
        return this.toUint8Array(global, .transfer);
    }

    pub fn toArrayBufferTransfer(this: *Any, global: *JSGlobalObject) bun.JSError!JSValue {
        return this.toArrayBuffer(global, .transfer);
    }

    pub fn toBlob(this: *Any, global: *JSGlobalObject) Blob {
        if (this.size() == 0) {
            return Blob.initEmpty(global);
        }

        if (this.* == .Blob) {
            return this.Blob.dupe();
        }

        if (this.* == .WTFStringImpl) {
            const blob = Blob.create(this.slice(), bun.default_allocator, global, true);
            this.* = .{ .Blob = .{} };
            return blob;
        }

        const blob = Blob.init(this.InternalBlob.slice(), this.InternalBlob.bytes.allocator, global);
        this.* = .{ .Blob = .{} };
        return blob;
    }

    pub fn toString(this: *Any, global: *JSGlobalObject, comptime lifetime: jsc.WebCore.Lifetime) bun.JSError!JSValue {
        switch (this.*) {
            .Blob => return this.Blob.toString(global, lifetime),
            // .InlineBlob => {
            //     if (this.InlineBlob.len == 0) {
            //         return ZigString.Empty.toValue(global);
            //     }
            //     const owned = this.InlineBlob.toStringOwned(global);
            //     this.* = .{ .InlineBlob = .{ .len = 0 } };
            //     return owned;
            // },
            .InternalBlob => {
                if (this.InternalBlob.bytes.items.len == 0) {
                    return ZigString.Empty.toJS(global);
                }

                const owned = try this.InternalBlob.toStringOwned(global);
                this.* = .{ .Blob = .{} };
                return owned;
            },
            .WTFStringImpl => {
                var str = bun.String.init(this.WTFStringImpl);
                defer str.deref();
                this.* = .{ .Blob = .{} };

                return try str.toJS(global);
            },
        }
    }

    pub fn toArrayBuffer(this: *Any, global: *JSGlobalObject, comptime lifetime: jsc.WebCore.Lifetime) bun.JSError!JSValue {
        return this.toArrayBufferView(global, lifetime, .ArrayBuffer);
    }

    pub fn toUint8Array(this: *Any, global: *JSGlobalObject, comptime lifetime: jsc.WebCore.Lifetime) bun.JSError!JSValue {
        return this.toArrayBufferView(global, lifetime, .Uint8Array);
    }

    pub fn toArrayBufferView(this: *Any, global: *JSGlobalObject, comptime lifetime: jsc.WebCore.Lifetime, comptime TypedArrayView: jsc.JSValue.JSType) bun.JSError!JSValue {
        switch (this.*) {
            .Blob => return this.Blob.toArrayBufferView(global, lifetime, TypedArrayView),
            // .InlineBlob => {
            //     if (this.InlineBlob.len == 0) {
            //         return jsc.ArrayBuffer.create(global, "", .ArrayBuffer);
            //     }
            //     var bytes = this.InlineBlob.sliceConst();
            //     this.InlineBlob.len = 0;
            //     const value = jsc.ArrayBuffer.create(
            //         global,
            //         bytes,
            //         .ArrayBuffer,
            //     );
            //     return value;
            // },
            .InternalBlob => {
                const bytes = this.InternalBlob.toOwnedSlice();
                this.* = .{ .Blob = .{} };

                return jsc.ArrayBuffer.fromDefaultAllocator(
                    global,
                    bytes,
                    TypedArrayView,
                );
            },
            .WTFStringImpl => {
                const str = bun.String.init(this.WTFStringImpl);
                this.* = .{ .Blob = .{} };
                defer str.deref();

                const out_bytes = str.toUTF8WithoutRef(bun.default_allocator);
                if (out_bytes.isAllocated()) {
                    return jsc.ArrayBuffer.fromDefaultAllocator(
                        global,
                        @constCast(out_bytes.slice()),
                        TypedArrayView,
                    );
                }

                return jsc.ArrayBuffer.create(global, out_bytes.slice(), TypedArrayView);
            },
        }
    }

    pub fn isDetached(this: *const Any) bool {
        return switch (this.*) {
            .Blob => |blob| blob.isDetached(),
            .InternalBlob => this.InternalBlob.bytes.items.len == 0,
            .WTFStringImpl => this.WTFStringImpl.length() == 0,
        };
    }

    pub fn store(this: *const @This()) ?*Blob.Store {
        if (this.* == .Blob) {
            return this.Blob.store;
        }

        return null;
    }

    pub fn contentType(self: *const @This()) []const u8 {
        return switch (self.*) {
            .Blob => self.Blob.content_type,
            .WTFStringImpl => MimeType.text.value,
            // .InlineBlob => self.InlineBlob.contentType(),
            .InternalBlob => self.InternalBlob.contentType(),
        };
    }

    pub fn wasString(self: *const @This()) bool {
        return switch (self.*) {
            .Blob => self.Blob.charset == .all_ascii,
            .WTFStringImpl => true,
            // .InlineBlob => self.InlineBlob.was_string,
            .InternalBlob => self.InternalBlob.was_string,
        };
    }

    pub inline fn slice(self: *const @This()) []const u8 {
        return switch (self.*) {
            .Blob => self.Blob.sharedView(),
            .WTFStringImpl => self.WTFStringImpl.utf8Slice(),
            // .InlineBlob => self.InlineBlob.sliceConst(),
            .InternalBlob => self.InternalBlob.sliceConst(),
        };
    }

    pub fn needsToReadFile(self: *const @This()) bool {
        return switch (self.*) {
            .Blob => self.Blob.needsToReadFile(),
            .WTFStringImpl, .InternalBlob => false,
        };
    }

    pub fn isS3(self: *const @This()) bool {
        return switch (self.*) {
            .Blob => self.Blob.isS3(),
            .WTFStringImpl, .InternalBlob => false,
        };
    }

    pub fn detach(self: *@This()) void {
        return switch (self.*) {
            .Blob => {
                self.Blob.detach();
                self.* = .{
                    .Blob = .{},
                };
            },
            // .InlineBlob => {
            //     self.InlineBlob.len = 0;
            // },
            .InternalBlob => {
                self.InternalBlob.bytes.clearAndFree();
                self.* = .{ .Blob = .{} };
            },
            .WTFStringImpl => {
                self.WTFStringImpl.deref();
                self.* = .{ .Blob = .{} };
            },
        };
    }
};

/// A single-use Blob backed by an allocation of memory.
pub const Internal = struct {
    bytes: std.array_list.Managed(u8),
    was_string: bool = false,

    pub fn memoryCost(this: *const @This()) usize {
        return this.bytes.capacity;
    }

    pub fn toStringOwned(this: *@This(), globalThis: *jsc.JSGlobalObject) bun.JSError!JSValue {
        const bytes_without_bom = strings.withoutUTF8BOM(this.bytes.items);
        if (strings.toUTF16Alloc(bun.default_allocator, bytes_without_bom, false, false) catch &[_]u16{}) |out| {
            const return_value = ZigString.toExternalU16(out.ptr, out.len, globalThis);
            return_value.ensureStillAlive();
            this.deinit();
            return return_value;
        } else if
        // If there was a UTF8 BOM, we clone it
        (bytes_without_bom.len != this.bytes.items.len) {
            defer this.deinit();
            var out = bun.String.cloneLatin1(this.bytes.items[3..]);
            defer out.deref();
            return out.toJS(globalThis);
        } else {
            var str = ZigString.init(this.toOwnedSlice());
            str.markGlobal();
            return str.toExternalValue(globalThis);
        }
    }

    pub fn toJSON(this: *@This(), globalThis: *jsc.JSGlobalObject) JSValue {
        const str_bytes = ZigString.init(strings.withoutUTF8BOM(this.bytes.items)).withEncoding();
        const json = str_bytes.toJSONObject(globalThis);
        this.deinit();
        return json;
    }

    pub inline fn sliceConst(this: *const @This()) []const u8 {
        return this.bytes.items;
    }

    pub fn deinit(this: *@This()) void {
        this.bytes.clearAndFree();
    }

    pub inline fn slice(this: @This()) []u8 {
        return this.bytes.items;
    }

    pub fn toOwnedSlice(this: *@This()) []u8 {
        const bytes = this.bytes.items;
        const capacity = this.bytes.capacity;
        if (bytes.len == 0 and capacity > 0) {
            this.bytes.clearAndFree();
            return &.{};
        }

        this.bytes.items = &.{};
        this.bytes.capacity = 0;

        return bytes;
    }

    pub fn clearAndFree(this: *@This()) void {
        this.bytes.clearAndFree();
    }

    pub fn contentType(self: *const @This()) []const u8 {
        if (self.was_string) {
            return MimeType.text.value;
        }

        return MimeType.other.value;
    }
};

/// A blob which stores all the data in the same space as a real Blob
/// This is an optimization for small Response and Request bodies
/// It means that we can avoid an additional heap allocation for a small response
pub const Inline = extern struct {
    const real_blob_size = @sizeOf(Blob);
    pub const IntSize = u8;
    pub const available_bytes = real_blob_size - @sizeOf(IntSize) - 1 - 1;
    bytes: [available_bytes]u8 align(1) = undefined,
    len: IntSize align(1) = 0,
    was_string: bool align(1) = false,

    pub fn concat(first: []const u8, second: []const u8) Inline {
        const total = first.len + second.len;
        assert(total <= available_bytes);

        var inline_blob: jsc.WebCore.InlineBlob = .{};
        var bytes_slice = inline_blob.bytes[0..total];

        if (first.len > 0)
            @memcpy(bytes_slice[0..first.len], first);

        if (second.len > 0)
            @memcpy(bytes_slice[first.len..][0..second.len], second);

        inline_blob.len = @as(@TypeOf(inline_blob.len), @truncate(total));
        return inline_blob;
    }

    fn internalInit(data: []const u8, was_string: bool) Inline {
        assert(data.len <= available_bytes);

        var blob = Inline{
            .len = @as(IntSize, @intCast(data.len)),
            .was_string = was_string,
        };

        if (data.len > 0)
            @memcpy(blob.bytes[0..data.len], data);
        return blob;
    }

    pub fn init(data: []const u8) Inline {
        return internalInit(data, false);
    }

    pub fn initString(data: []const u8) Inline {
        return internalInit(data, true);
    }

    pub fn toStringOwned(this: *@This(), globalThis: *jsc.JSGlobalObject) JSValue {
        if (this.len == 0)
            return ZigString.Empty.toJS(globalThis);

        var str = ZigString.init(this.sliceConst());

        if (!strings.isAllASCII(this.sliceConst())) {
            str.markUTF8();
        }

        const out = str.toJS(globalThis);
        out.ensureStillAlive();
        this.len = 0;
        return out;
    }

    pub fn contentType(self: *const @This()) []const u8 {
        if (self.was_string) {
            return MimeType.text.value;
        }

        return MimeType.other.value;
    }

    pub fn deinit(_: *@This()) void {}

    pub inline fn slice(this: *@This()) []u8 {
        return this.bytes[0..this.len];
    }

    pub inline fn sliceConst(this: *const @This()) []const u8 {
        return this.bytes[0..this.len];
    }

    pub fn toOwnedSlice(this: *@This()) []u8 {
        return this.slice();
    }

    pub fn clearAndFree(_: *@This()) void {}
};

pub export fn JSDOMFile__hasInstance(_: jsc.JSValue, _: *jsc.JSGlobalObject, value: jsc.JSValue) callconv(jsc.conv) bool {
    jsc.markBinding(@src());
    const blob = value.as(Blob) orelse return false;
    return blob.is_jsdom_file;
}

// TODO: move to bun.sys?
pub fn FileOpener(comptime This: type) type {
    return struct {
        context: *This,

        const State = @This();

        const __opener_flags = bun.O.NONBLOCK | bun.O.CLOEXEC;

        const open_flags_ = if (@hasDecl(This, "open_flags"))
            This.open_flags | __opener_flags
        else
            bun.O.RDONLY | __opener_flags;

        fn getFdByOpening(this: *This, comptime Callback: OpenCallback) void {
            var buf: bun.PathBuffer = undefined;
            var path_string = if (@hasField(This, "file_store"))
                this.file_store.pathlike.path
            else
                this.file_blob.store.?.data.file.pathlike.path;

            const path = path_string.sliceZ(&buf);

            if (Environment.isWindows) {
                const WrappedCallback = struct {
                    pub fn callback(req: *libuv.fs_t) callconv(.c) void {
                        var self: *This = @ptrCast(@alignCast(req.data.?));
                        {
                            defer req.deinit();
                            if (req.result.errEnum()) |errEnum| {
                                var path_string_2 = if (@hasField(This, "file_store"))
                                    self.file_store.pathlike.path
                                else
                                    self.file_blob.store.?.data.file.pathlike.path;
                                self.errno = bun.errnoToZigErr(errEnum);
                                self.system_error = bun.sys.Error.fromCode(errEnum, .open)
                                    .withPath(path_string_2.slice())
                                    .toSystemError();
                                self.opened_fd = invalid_fd;
                            } else {
                                self.opened_fd = req.result.toFD();
                            }
                        }
                        Callback(self, self.opened_fd);
                    }
                };

                const rc = libuv.uv_fs_open(
                    this.loop,
                    &this.req,
                    path,
                    open_flags_,
                    jsc.Node.fs.default_permission,
                    &WrappedCallback.callback,
                );
                if (rc.errEnum()) |errno| {
                    this.errno = bun.errnoToZigErr(errno);
                    this.system_error = bun.sys.Error.fromCode(errno, .open).withPath(path_string.slice()).toSystemError();
                    this.opened_fd = invalid_fd;
                    Callback(this, invalid_fd);
                }
                this.req.data = @ptrCast(this);
                return;
            }

            while (true) {
                this.opened_fd = switch (bun.sys.open(path, open_flags_, jsc.Node.fs.default_permission)) {
                    .result => |fd| fd,
                    .err => |err| {
                        if (comptime @hasField(This, "mkdirp_if_not_exists")) {
                            if (err.errno == @intFromEnum(bun.sys.E.NOENT)) {
                                switch (mkdirIfNotExists(this, err, path, path_string.slice())) {
                                    .@"continue" => continue,
                                    .fail => {
                                        this.opened_fd = invalid_fd;
                                        break;
                                    },
                                    .no => {},
                                }
                            }
                        }

                        this.errno = bun.errnoToZigErr(err.errno);
                        this.system_error = err.withPath(path_string.slice()).toSystemError();
                        this.opened_fd = invalid_fd;
                        break;
                    },
                };
                break;
            }

            Callback(this, this.opened_fd);
        }

        const OpenCallback = *const fn (*This, bun.FileDescriptor) void;

        pub fn getFd(this: *This, comptime Callback: OpenCallback) void {
            if (this.opened_fd != invalid_fd) {
                Callback(this, this.opened_fd);
                return;
            }

            if (@hasField(This, "file_store")) {
                const pathlike = this.file_store.pathlike;
                if (pathlike == .fd) {
                    this.opened_fd = pathlike.fd;
                    Callback(this, this.opened_fd);
                    return;
                }
            } else {
                const pathlike = this.file_blob.store.?.data.file.pathlike;
                if (pathlike == .fd) {
                    this.opened_fd = pathlike.fd;
                    Callback(this, this.opened_fd);
                    return;
                }
            }

            getFdByOpening(this, Callback);
        }
    };
}

// TODO: move to bun.sys?
pub fn FileCloser(comptime This: type) type {
    return struct {
        fn scheduleClose(request: *io.Request) io.Action {
            var this: *This = @alignCast(@fieldParentPtr("io_request", request));
            return io.Action{
                .close = .{
                    .ctx = this,
                    .fd = this.opened_fd,
                    .onDone = @ptrCast(&onIORequestClosed),
                    .poll = &this.io_poll,
                    .tag = This.io_tag,
                },
            };
        }

        fn onIORequestClosed(this: *This) void {
            this.io_poll.flags.remove(.was_ever_registered);
            this.task = .{ .callback = &onCloseIORequest };
            bun.jsc.WorkPool.schedule(&this.task);
        }

        fn onCloseIORequest(task: *jsc.WorkPoolTask) void {
            debug("onCloseIORequest()", .{});
            var this: *This = @alignCast(@fieldParentPtr("task", task));
            this.close_after_io = false;
            this.update();
        }

        pub fn doClose(this: *This, is_allowed_to_close_fd: bool) bool {
            if (@hasField(This, "io_request")) {
                if (this.close_after_io) {
                    this.state.store(ClosingState.closing, .seq_cst);

                    @atomicStore(@TypeOf(this.io_request.callback), &this.io_request.callback, &scheduleClose, .seq_cst);
                    if (!this.io_request.scheduled)
                        io.Loop.get().schedule(&this.io_request);
                    return true;
                }
            }

            if (is_allowed_to_close_fd and
                this.opened_fd != invalid_fd and
                this.opened_fd.stdioTag() == null)
            {
                if (comptime Environment.isWindows) {
                    bun.Async.Closer.close(this.opened_fd, this.loop);
                } else {
                    _ = this.opened_fd.closeAllowingBadFileDescriptor(null);
                }
                this.opened_fd = invalid_fd;
            }

            return false;
        }
    };
}

pub fn isAllASCII(self: *const Blob) ?bool {
    return switch (self.charset) {
        .unknown => null,
        .all_ascii => true,
        .non_ascii => false,
    };
}

/// Takes ownership of `self` by value. Invalidates `self`.
pub fn takeOwnership(self: *Blob) Blob {
    var result = self.*;
    self.* = undefined;
    result.setNotHeapAllocated();
    return result;
}

pub fn isHeapAllocated(self: *const Blob) bool {
    return self.#ref_count.raw_value != 0;
}

fn setNotHeapAllocated(self: *Blob) void {
    self.#ref_count = .init(0);
}

pub const external_shared_descriptor = struct {
    pub const ref = Blob__ref;
    pub const deref = Blob__deref;
};

export fn Blob__ref(self: *Blob) void {
    bun.assertf(self.isHeapAllocated(), "cannot ref: this Blob is not heap-allocated", .{});
    self.#ref_count.increment();
}

export fn Blob__deref(self: *Blob) void {
    bun.assertf(self.isHeapAllocated(), "cannot deref: this Blob is not heap-allocated", .{});
    if (self.#ref_count.decrement() == .should_destroy) {
        self.#ref_count.increment(); // deinit has its own isHeapAllocated() guard around bun.destroy(this), so this is needed to ensure that returns true.
        self.deinit();
    }
}

const WriteFilePromise = write_file.WriteFilePromise;
const WriteFileWaitFromLockedValueTask = write_file.WriteFileWaitFromLockedValueTask;
const NewReadFileHandler = read_file.NewReadFileHandler;

const string = []const u8;

const Archive = @import("../api/Archive.zig");
const Environment = @import("../../env.zig");
const S3File = @import("./S3File.zig");
const std = @import("std");

const bun = @import("bun");
const JSError = bun.JSError;
const Output = bun.Output;
const S3 = bun.S3;
const StringJoiner = bun.StringJoiner;
const assert = bun.assert;
const default_allocator = bun.default_allocator;
const invalid_fd = bun.invalid_fd;
const io = bun.io;
const strings = bun.strings;
const libuv = bun.windows.libuv;
const streams = bun.webcore.streams;

const http = bun.http;
const MimeType = http.MimeType;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSPromise = jsc.JSPromise;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
const ZigString = jsc.ZigString;
const PathOrBlob = jsc.Node.PathOrBlob;

const Request = jsc.WebCore.Request;
const Response = jsc.WebCore.Response;
