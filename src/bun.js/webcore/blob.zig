const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const bun = @import("root").bun;
const RequestContext = @import("../../http.zig").RequestContext;
const MimeType = @import("../../http.zig").MimeType;
const ZigURL = @import("../../url.zig").URL;
const HTTPClient = @import("root").bun.HTTP;
const NetworkThread = HTTPClient.NetworkThread;
const AsyncIO = NetworkThread.AsyncIO;
const JSC = @import("root").bun.JSC;
const js = JSC.C;

const Method = @import("../../http/method.zig").Method;
const FetchHeaders = JSC.FetchHeaders;
const ObjectPool = @import("../../pool.zig").ObjectPool;
const SystemError = JSC.SystemError;
const Output = @import("root").bun.Output;
const MutableString = @import("root").bun.MutableString;
const strings = @import("root").bun.strings;
const string = @import("root").bun.string;
const default_allocator = @import("root").bun.default_allocator;
const FeatureFlags = @import("root").bun.FeatureFlags;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const Properties = @import("../base.zig").Properties;

const getAllocator = @import("../base.zig").getAllocator;

const Environment = @import("../../env.zig");
const ZigString = JSC.ZigString;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSError = JSC.JSError;
const JSGlobalObject = JSC.JSGlobalObject;
const NullableAllocator = @import("../../nullable_allocator.zig").NullableAllocator;

const VirtualMachine = JSC.VirtualMachine;
const Task = JSC.Task;
const JSPrinter = bun.js_printer;
const picohttp = @import("root").bun.picohttp;
const StringJoiner = @import("../../string_joiner.zig");
const uws = @import("root").bun.uws;

const null_fd = bun.invalid_fd;
const Response = JSC.WebCore.Response;
const Body = JSC.WebCore.Body;
const Request = JSC.WebCore.Request;

const PathOrBlob = union(enum) {
    path: JSC.Node.PathOrFileDescriptor,
    blob: Blob,

    pub fn fromJSNoCopy(ctx: js.JSContextRef, args: *JSC.Node.ArgumentsSlice, exception: js.ExceptionRef) ?PathOrBlob {
        if (JSC.Node.PathOrFileDescriptor.fromJS(ctx, args, args.arena.allocator(), exception)) |path| {
            return PathOrBlob{
                .path = path,
            };
        }

        const arg = args.nextEat() orelse return null;

        if (arg.as(Blob)) |blob| {
            return PathOrBlob{
                .blob = blob.*,
            };
        }

        return null;
    }
};

pub const Blob = struct {
    const bloblog = Output.scoped(.Blob, false);

    pub usingnamespace JSC.Codegen.JSBlob;

    size: SizeType = 0,
    offset: SizeType = 0,
    /// When set, the blob will be freed on finalization callbacks
    /// If the blob is contained in Response or Request, this must be null
    allocator: ?std.mem.Allocator = null,
    store: ?*Store = null,
    content_type: string = "",
    content_type_allocated: bool = false,
    content_type_was_set: bool = false,

    /// JavaScriptCore strings are either latin1 or UTF-16
    /// When UTF-16, they're nearly always due to non-ascii characters
    is_all_ascii: ?bool = null,

    /// Was it created via file constructor?
    is_jsdom_file: bool = false,

    globalThis: *JSGlobalObject = undefined,

    last_modified: f64 = 0.0,

    /// Max int of double precision
    /// 9 petabytes is probably enough for awhile
    /// We want to avoid coercing to a BigInt because that's a heap allocation
    /// and it's generally just harder to use
    pub const SizeType = u52;
    pub const max_size = std.math.maxInt(SizeType);

    /// According to https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date,
    /// maximum Date in JavaScript is less than Number.MAX_SAFE_INTEGER (u52).
    pub const JSTimeType = u52;
    pub const init_timestamp = std.math.maxInt(JSTimeType);

    const serialization_version: u8 = 1;
    const reserved_space_for_serialization: u32 = 128;

    pub fn getFormDataEncoding(this: *Blob) ?*bun.FormData.AsyncFormData {
        var content_type_slice: ZigString.Slice = this.getContentType() orelse return null;
        defer content_type_slice.deinit();
        const encoding = bun.FormData.Encoding.get(content_type_slice.slice()) orelse return null;
        return bun.FormData.AsyncFormData.init(this.allocator orelse bun.default_allocator, encoding) catch unreachable;
    }

    pub fn hasContentTypeFromUser(this: *const Blob) bool {
        return this.content_type_was_set or (this.store != null and this.store.?.data == .file);
    }

    const FormDataContext = struct {
        allocator: std.mem.Allocator,
        joiner: StringJoiner,
        boundary: []const u8,
        failed: bool = false,
        globalThis: *JSC.JSGlobalObject,

        pub fn onEntry(this: *FormDataContext, name: ZigString, entry: JSC.DOMFormData.FormDataEntry) void {
            if (this.failed) return;
            var globalThis = this.globalThis;

            const allocator = this.allocator;
            const joiner = &this.joiner;
            const boundary = this.boundary;

            joiner.append("--", 0, null);
            joiner.append(boundary, 0, null);
            joiner.append("\r\n", 0, null);

            joiner.append("Content-Disposition: form-data; name=\"", 0, null);
            const name_slice = name.toSlice(allocator);
            joiner.append(name_slice.slice(), 0, name_slice.allocator.get());
            name_slice.deinit();

            switch (entry) {
                .string => |value| {
                    joiner.append("\"\r\n\r\n", 0, null);
                    const value_slice = value.toSlice(allocator);
                    joiner.append(value_slice.slice(), 0, value_slice.allocator.get());
                },
                .file => |value| {
                    joiner.append("\"; filename=\"", 0, null);
                    const filename_slice = value.filename.toSlice(allocator);
                    joiner.append(filename_slice.slice(), 0, filename_slice.allocator.get());
                    filename_slice.deinit();
                    joiner.append("\"\r\n", 0, null);

                    const blob = value.blob;
                    const content_type = if (blob.content_type.len > 0) blob.content_type else "application/octet-stream";
                    joiner.append("Content-Type: ", 0, null);
                    joiner.append(content_type, 0, null);
                    joiner.append("\r\n\r\n", 0, null);

                    if (blob.store) |store| {
                        blob.resolveSize();

                        switch (store.data) {
                            .file => |file| {

                                // TODO: make this async + lazy
                                const res = JSC.Node.NodeFS.readFile(
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
                                        globalThis.throwValue(err.toJSC(globalThis));
                                        this.failed = true;
                                    },
                                    .result => |result| {
                                        joiner.append(result.slice(), 0, result.buffer.allocator);
                                    },
                                }
                            },
                            .bytes => |_| {
                                joiner.append(blob.sharedView(), 0, null);
                            },
                        }
                    }
                },
            }

            joiner.append("\r\n", 0, null);
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
        impl: *const fn (*anyopaque, ptr: [*]const u8, len: u32) callconv(.C) void,

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
        try writer.writeIntNative(u8, serialization_version);

        try writer.writeIntNative(u64, @as(u64, @intCast(this.offset)));

        try writer.writeIntNative(u32, @as(u32, @truncate(this.content_type.len)));
        _ = try writer.write(this.content_type);
        try writer.writeIntNative(u8, @intFromBool(this.content_type_was_set));

        const store_tag: Store.SerializeTag = if (this.store) |store|
            if (store.data == .file) .file else .bytes
        else
            .empty;

        try writer.writeIntNative(u8, @intFromEnum(store_tag));

        this.resolveSize();
        if (this.store) |store| {
            try store.serialize(Writer, writer);
        }

        // reserved space for future use
        _ = try writer.write(&[_]u8{0} ** reserved_space_for_serialization);
    }

    pub fn onStructuredCloneSerialize(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        ctx: *anyopaque,
        writeBytes: *const fn (*anyopaque, ptr: [*]const u8, len: u32) callconv(.C) void,
    ) callconv(.C) void {
        _ = globalThis;

        const Writer = std.io.Writer(StructuredCloneWriter, StructuredCloneWriter.WriteError, StructuredCloneWriter.write);
        var writer = Writer{
            .context = .{
                .ctx = ctx,
                .impl = writeBytes,
            },
        };

        _onStructuredCloneSerialize(this, Writer, writer) catch return .zero;
    }

    pub fn onStructuredCloneTransfer(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        ctx: *anyopaque,
        write: *const fn (*anyopaque, ptr: [*]const u8, len: usize) callconv(.C) void,
    ) callconv(.C) void {
        _ = write;
        _ = ctx;
        _ = this;
        _ = globalThis;
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
        globalThis: *JSC.JSGlobalObject,
        comptime Reader: type,
        reader: Reader,
    ) !JSValue {
        const allocator = globalThis.allocator();

        const version = try reader.readIntNative(u8);
        _ = version;

        const offset = try reader.readIntNative(u64);

        const content_type_len = try reader.readIntNative(u32);

        const content_type = try readSlice(reader, content_type_len, allocator);

        const content_type_was_set: bool = try reader.readIntNative(u8) != 0;

        const store_tag = try reader.readEnum(Store.SerializeTag, .Little);

        const blob: *Blob = switch (store_tag) {
            .bytes => brk: {
                const bytes_len = try reader.readIntNative(u32);
                const bytes = try readSlice(reader, bytes_len, allocator);

                var blob = Blob.init(bytes, allocator, globalThis);
                var blob_ = try allocator.create(Blob);
                blob_.* = blob;

                break :brk blob_;
            },
            .file => brk: {
                const pathlike_tag = try reader.readEnum(JSC.Node.PathOrFileDescriptor.SerializeTag, .Little);

                switch (pathlike_tag) {
                    .fd => {
                        const fd = @as(i32, @intCast(try reader.readIntNative(u32)));

                        var blob = try allocator.create(Blob);
                        blob.* = Blob.findOrCreateFileFromPath(
                            JSC.Node.PathOrFileDescriptor{
                                .fd = fd,
                            },
                            globalThis,
                        );

                        break :brk blob;
                    },
                    .path => {
                        const path_len = try reader.readIntNative(u32);

                        const path = try readSlice(reader, path_len, default_allocator);

                        var blob = try allocator.create(Blob);
                        blob.* = Blob.findOrCreateFileFromPath(
                            JSC.Node.PathOrFileDescriptor{
                                .path = .{
                                    .string = bun.PathString.init(path),
                                },
                            },
                            globalThis,
                        );

                        break :brk blob;
                    },
                }

                return .zero;
            },
            .empty => brk: {
                var blob = try allocator.create(Blob);
                blob.* = Blob.initEmpty(globalThis);
                break :brk blob;
            },
        };
        blob.allocator = allocator;
        blob.offset = @as(u52, @intCast(offset));
        if (content_type.len > 0) {
            blob.content_type = content_type;
            blob.content_type_allocated = true;
            blob.content_type_was_set = content_type_was_set;
        }

        return blob.toJS(globalThis);
    }

    pub fn onStructuredCloneDeserialize(
        globalThis: *JSC.JSGlobalObject,
        ptr: [*]u8,
        end: [*]u8,
    ) callconv(.C) JSValue {
        const total_length: usize = @intFromPtr(end) - @intFromPtr(ptr);
        var buffer_stream = std.io.fixedBufferStream(ptr[0..total_length]);
        var reader = buffer_stream.reader();

        const blob = _onStructuredCloneDeserialize(globalThis, @TypeOf(reader), reader) catch return .zero;

        if (Environment.allow_assert) {
            std.debug.assert(total_length - reader.context.pos == reserved_space_for_serialization);
        }

        return blob;
    }

    const URLSearchParamsConverter = struct {
        allocator: std.mem.Allocator,
        buf: []u8 = "",
        globalThis: *JSC.JSGlobalObject,
        pub fn convert(this: *URLSearchParamsConverter, str: ZigString) void {
            var out = str.toSlice(this.allocator).cloneIfNeeded(this.allocator) catch unreachable;
            this.buf = bun.constStrToU8(out.slice());
        }
    };

    pub fn fromURLSearchParams(
        globalThis: *JSC.JSGlobalObject,
        allocator: std.mem.Allocator,
        search_params: *JSC.URLSearchParams,
    ) Blob {
        var converter = URLSearchParamsConverter{
            .allocator = allocator,
            .globalThis = globalThis,
        };
        search_params.toString(URLSearchParamsConverter, &converter, URLSearchParamsConverter.convert);
        var store = Blob.Store.init(converter.buf, allocator) catch unreachable;
        store.mime_type = MimeType.all.@"application/x-www-form-urlencoded";

        var blob = Blob.initWithStore(store, globalThis);
        blob.content_type = store.mime_type.value;
        blob.content_type_was_set = true;
        return blob;
    }

    pub fn fromDOMFormData(
        globalThis: *JSC.JSGlobalObject,
        allocator: std.mem.Allocator,
        form_data: *JSC.DOMFormData,
    ) Blob {
        var arena = @import("root").bun.ArenaAllocator.init(allocator);
        defer arena.deinit();
        var stack_allocator = std.heap.stackFallback(1024, arena.allocator());
        var stack_mem_all = stack_allocator.get();

        var hex_buf: [70]u8 = undefined;
        const boundary = brk: {
            var random = globalThis.bunVM().rareData().nextUUID().bytes;
            var formatter = std.fmt.fmtSliceHexLower(&random);
            break :brk std.fmt.bufPrint(&hex_buf, "-WebkitFormBoundary{any}", .{formatter}) catch unreachable;
        };

        var context = FormDataContext{
            .allocator = allocator,
            .joiner = StringJoiner{ .use_pool = false, .node_allocator = stack_mem_all },
            .boundary = boundary,
            .globalThis = globalThis,
        };

        form_data.forEach(FormDataContext, &context, FormDataContext.onEntry);
        if (context.failed) {
            return Blob.initEmpty(globalThis);
        }

        context.joiner.append("--", 0, null);
        context.joiner.append(boundary, 0, null);
        context.joiner.append("--\r\n", 0, null);

        var store = Blob.Store.init(context.joiner.done(allocator) catch unreachable, allocator) catch unreachable;
        var blob = Blob.initWithStore(store, globalThis);
        blob.content_type = std.fmt.allocPrint(allocator, "multipart/form-data; boundary=\"{s}\"", .{boundary}) catch unreachable;
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

    export fn Blob__dupeFromJS(value: JSC.JSValue) ?*Blob {
        var this = Blob.fromJS(value) orelse return null;
        return Blob__dupe(this);
    }

    export fn Blob__setAsFile(this: *Blob, path_str: *bun.String) *Blob {
        this.is_jsdom_file = true;

        // This is not 100% correct...
        if (this.store) |store| {
            if (store.data == .bytes) {
                if (store.data.bytes.stored_name.len == 0) {
                    var utf8 = path_str.toUTF8WithoutRef(bun.default_allocator).clone(bun.default_allocator) catch unreachable;
                    store.data.bytes.stored_name = bun.PathString.init(utf8.slice());
                }
            }
        }

        return this;
    }

    export fn Blob__dupe(ptr: *anyopaque) *Blob {
        var this = bun.cast(*Blob, ptr);
        var new = bun.default_allocator.create(Blob) catch unreachable;
        new.* = this.dupeWithContentType(true);
        new.allocator = bun.default_allocator;
        return new;
    }

    export fn Blob__destroy(this: *Blob) void {
        this.finalize();
    }

    comptime {
        _ = Blob__dupeFromJS;
        _ = Blob__destroy;
        _ = Blob__dupe;
        _ = Blob__setAsFile;
    }

    pub fn writeFormatForSize(size: usize, writer: anytype, comptime enable_ansi_colors: bool) !void {
        try writer.writeAll(comptime Output.prettyFmt("<r>Blob<r>", enable_ansi_colors));
        try writer.print(
            comptime Output.prettyFmt(" (<yellow>{any}<r>)", enable_ansi_colors),
            .{
                bun.fmt.size(size),
            },
        );
    }

    pub fn writeFormat(this: *const Blob, comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);

        if (this.isDetached()) {
            try writer.writeAll(comptime Output.prettyFmt("<d>[<r>Blob<r> detached<d>]<r>", enable_ansi_colors));
            return;
        }

        {
            var store = this.store.?;
            switch (store.data) {
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
                            try writer.print(
                                comptime Output.prettyFmt(" (<r>fd: <yellow>{d}<r>)<r>", enable_ansi_colors),
                                .{
                                    fd,
                                },
                            );
                        },
                    }
                },
                .bytes => {
                    try writeFormatForSize(this.size, writer, enable_ansi_colors);
                },
            }
        }

        if (this.content_type.len > 0 or this.offset > 0) {
            try writer.writeAll(" {\n");
            {
                formatter.indent += 1;
                defer formatter.indent -= 1;

                if (this.content_type.len > 0) {
                    try formatter.writeIndent(Writer, writer);
                    try writer.print(
                        comptime Output.prettyFmt("type: <green>\"{s}\"<r>", enable_ansi_colors),
                        .{
                            this.content_type,
                        },
                    );

                    if (this.offset > 0) {
                        formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
                    }

                    try writer.writeAll("\n");
                }

                if (this.offset > 0) {
                    try formatter.writeIndent(Writer, writer);

                    try writer.print(
                        comptime Output.prettyFmt("offset: <yellow>{d}<r>\n", enable_ansi_colors),
                        .{
                            this.offset,
                        },
                    );
                }
            }

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll("}");
        }
    }

    const CopyFilePromiseHandler = struct {
        promise: *JSPromise,
        globalThis: *JSGlobalObject,
        pub fn run(handler: *@This(), blob_: Store.CopyFile.ResultType) void {
            var promise = handler.promise;
            var globalThis = handler.globalThis;
            bun.default_allocator.destroy(handler);
            var blob = blob_ catch |err| {
                var error_string = ZigString.init(
                    std.fmt.allocPrint(bun.default_allocator, "Failed to write file \"{s}\"", .{bun.asByteSlice(@errorName(err))}) catch unreachable,
                );
                error_string.mark();

                promise.reject(globalThis, error_string.toErrorInstance(globalThis));
                return;
            };
            var _blob = bun.default_allocator.create(Blob) catch unreachable;
            _blob.* = blob;
            _blob.allocator = bun.default_allocator;
            promise.resolve(
                globalThis,
            );
        }
    };

    const WriteFileWaitFromLockedValueTask = struct {
        file_blob: Blob,
        globalThis: *JSGlobalObject,
        promise: *JSPromise,

        pub fn thenWrap(this: *anyopaque, value: *Body.Value) void {
            then(bun.cast(*WriteFileWaitFromLockedValueTask, this), value);
        }

        pub fn then(this: *WriteFileWaitFromLockedValueTask, value: *Body.Value) void {
            var promise = this.promise;
            var globalThis = this.globalThis;
            var file_blob = this.file_blob;
            switch (value.*) {
                .Error => |err| {
                    file_blob.detach();
                    _ = value.use();
                    bun.default_allocator.destroy(this);
                    promise.reject(globalThis, err);
                },
                .Used => {
                    file_blob.detach();
                    _ = value.use();
                    bun.default_allocator.destroy(this);
                    promise.reject(globalThis, ZigString.init("Body was used after it was consumed").toErrorInstance(globalThis));
                },
                .WTFStringImpl,
                .InternalBlob,
                .Null,
                .Empty,
                .Blob,
                => {
                    var blob = value.use();
                    // TODO: this should be one promise not two!
                    const new_promise = writeFileWithSourceDestination(globalThis, &blob, &file_blob);
                    if (new_promise.asAnyPromise()) |_promise| {
                        switch (_promise.status(globalThis.vm())) {
                            .Pending => {
                                promise.resolve(
                                    globalThis,
                                    new_promise,
                                );
                            },
                            .Rejected => {
                                promise.reject(globalThis, _promise.result(globalThis.vm()));
                            },
                            else => {
                                promise.resolve(globalThis, _promise.result(globalThis.vm()));
                            },
                        }
                    }

                    file_blob.detach();
                    bun.default_allocator.destroy(this);
                },
                .Locked => {
                    value.Locked.onReceiveValue = thenWrap;
                    value.Locked.task = this;
                },
            }
        }
    };

    pub fn writeFileWithSourceDestination(
        ctx: JSC.C.JSContextRef,
        source_blob: *Blob,
        destination_blob: *Blob,
    ) JSC.JSValue {
        const destination_type = std.meta.activeTag(destination_blob.store.?.data);

        // Writing an empty string to a file is a no-op
        if (source_blob.store == null) {
            destination_blob.detach();
            return JSC.JSPromise.resolvedPromiseValue(ctx.ptr(), JSC.JSValue.jsNumber(0));
        }

        const source_type = std.meta.activeTag(source_blob.store.?.data);

        if (destination_type == .file and source_type == .bytes) {
            var write_file_promise = bun.default_allocator.create(WriteFilePromise) catch unreachable;
            write_file_promise.* = .{
                .globalThis = ctx.ptr(),
            };

            var file_copier = Store.WriteFile.create(
                bun.default_allocator,
                destination_blob.*,
                source_blob.*,
                *WriteFilePromise,
                write_file_promise,
                WriteFilePromise.run,
            ) catch unreachable;
            var task = Store.WriteFile.WriteFileTask.createOnJSThread(bun.default_allocator, ctx.ptr(), file_copier) catch unreachable;

            // Defer promise creation until we're just about to schedule the task
            var promise = JSC.JSPromise.create(ctx.ptr());
            const promise_value = promise.asValue(ctx);
            write_file_promise.promise.strong.set(ctx, promise_value);
            promise_value.ensureStillAlive();
            task.schedule();
            return promise_value;
        }
        // If this is file <> file, we can just copy the file
        else if (destination_type == .file and source_type == .file) {
            var file_copier = Store.CopyFile.create(
                bun.default_allocator,
                destination_blob.store.?,
                source_blob.store.?,

                destination_blob.offset,
                destination_blob.size,
                ctx.ptr(),
            ) catch unreachable;
            file_copier.schedule();
            return file_copier.promise.value();
        } else if (destination_type == .bytes and source_type == .bytes) {
            // If this is bytes <> bytes, we can just duplicate it
            // this is an edgecase
            // it will happen if someone did Bun.write(new Blob([123]), new Blob([456]))
            // eventually, this could be like Buffer.concat
            var clone = source_blob.dupe();
            clone.allocator = bun.default_allocator;
            var cloned = bun.default_allocator.create(Blob) catch unreachable;
            cloned.* = clone;
            return JSPromise.resolvedPromiseValue(ctx.ptr(), cloned.toJS(ctx));
        } else if (destination_type == .bytes and source_type == .file) {
            var fake_call_frame: [8]JSC.JSValue = undefined;
            @memset(@as([*]u8, @ptrCast(&fake_call_frame))[0..@sizeOf(@TypeOf(fake_call_frame))], 0);
            const blob_value =
                source_blob.getSlice(ctx, @as(*JSC.CallFrame, @ptrCast(&fake_call_frame)));

            return JSPromise.resolvedPromiseValue(
                ctx.ptr(),
                blob_value,
            );
        }

        unreachable;
    }

    pub fn writeFile(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(2).slice();
        var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();
        var exception_ = [1]JSC.JSValueRef{null};
        var exception = &exception_;

        // accept a path or a blob
        var path_or_blob = PathOrBlob.fromJSNoCopy(globalThis, &args, exception) orelse {
            if (exception[0] != null) {
                globalThis.throwValue(exception[0].?.value());
            } else {
                globalThis.throwInvalidArguments("Bun.write expects a path, file descriptor or a blob", .{});
            }
            return .zero;
        };

        var data = args.nextEat() orelse {
            globalThis.throwInvalidArguments("Bun.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write", .{});
            return .zero;
        };

        if (data.isEmptyOrUndefinedOrNull()) {
            globalThis.throwInvalidArguments("Bun.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write", .{});
            return .zero;
        }

        if (path_or_blob == .blob) {
            if (path_or_blob.blob.store == null) {
                globalThis.throwInvalidArguments("Blob is detached", .{});
                return .zero;
            } else {
                // TODO only reset last_modified on success pathes instead of
                // resetting last_modified at the beginning for better performance.
                if (path_or_blob.blob.store.?.data == .file) {
                    // reset last_modified to force getLastModified() to reload after writing.
                    path_or_blob.blob.store.?.data.file.last_modified = init_timestamp;
                }
            }
        }

        var input_store: ?*Store = if (path_or_blob == .blob) path_or_blob.blob.store else null;
        if (input_store) |st| st.ref();
        defer if (input_store) |st| st.deref();

        var needs_async = false;

        if (data.isString()) {
            defer if (!needs_async and path_or_blob == .path) path_or_blob.path.deinit();

            const len = data.getLength(globalThis);

            if (len < 256 * 1024 or bun.isMissingIOUring()) {
                const str = data.toBunString(globalThis);

                const pathlike: JSC.Node.PathOrFileDescriptor = if (path_or_blob == .path)
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
            defer if (!needs_async and path_or_blob == .path) path_or_blob.path.deinit();

            if (buffer_view.byte_len < 256 * 1024 or bun.isMissingIOUring()) {
                const pathlike: JSC.Node.PathOrFileDescriptor = if (path_or_blob == .path)
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

        // if path_or_blob is a path, convert it into a file blob
        var destination_blob: Blob = if (path_or_blob == .path)
            Blob.findOrCreateFileFromPath(path_or_blob.path, globalThis)
        else
            path_or_blob.blob.dupe();

        if (destination_blob.store == null) {
            globalThis.throwInvalidArguments("Writing to an empty blob is not implemented yet", .{});
            return .zero;
        }

        // TODO: implement a writeev() fast path
        var source_blob: Blob = brk: {
            if (data.as(Response)) |response| {
                switch (response.body.value) {
                    .WTFStringImpl,
                    .InternalBlob,
                    .Used,
                    .Empty,
                    .Blob,
                    .Null,
                    => {
                        break :brk response.body.use();
                    },
                    .Error => {
                        destination_blob.detach();
                        const err = response.body.value.Error;
                        err.unprotect();
                        _ = response.body.value.use();
                        return JSC.JSPromise.rejectedPromiseValue(globalThis, err);
                    },
                    .Locked => {
                        var task = bun.default_allocator.create(WriteFileWaitFromLockedValueTask) catch unreachable;
                        var promise = JSC.JSPromise.create(globalThis);
                        task.* = WriteFileWaitFromLockedValueTask{
                            .globalThis = globalThis,
                            .file_blob = destination_blob,
                            .promise = promise,
                        };

                        response.body.value.Locked.task = task;
                        response.body.value.Locked.onReceiveValue = WriteFileWaitFromLockedValueTask.thenWrap;

                        return promise.asValue(globalThis);
                    },
                }
            }

            if (data.as(Request)) |request| {
                switch (request.body.value) {
                    .WTFStringImpl,
                    .InternalBlob,
                    .Used,
                    .Empty,
                    .Blob,
                    .Null,
                    => {
                        break :brk request.body.value.use();
                    },
                    .Error => {
                        destination_blob.detach();
                        const err = request.body.value.Error;
                        err.unprotect();
                        _ = request.body.value.use();
                        return JSC.JSPromise.rejectedPromiseValue(globalThis, err);
                    },
                    .Locked => {
                        var task = bun.default_allocator.create(WriteFileWaitFromLockedValueTask) catch unreachable;
                        var promise = JSC.JSPromise.create(globalThis);
                        task.* = WriteFileWaitFromLockedValueTask{
                            .globalThis = globalThis,
                            .file_blob = destination_blob,
                            .promise = promise,
                        };

                        request.body.value.Locked.task = task;
                        request.body.value.Locked.onReceiveValue = WriteFileWaitFromLockedValueTask.thenWrap;

                        return promise.asValue(globalThis);
                    },
                }
            }

            break :brk Blob.get(
                globalThis,
                data,
                false,
                false,
            ) catch |err| {
                if (err == error.InvalidArguments) {
                    globalThis.throwInvalidArguments(
                        "Expected an Array",
                        .{},
                    );
                    return .zero;
                }

                globalThis.throwOutOfMemory();
                return .zero;
            };
        };

        var destination_store = destination_blob.store;
        if (destination_store) |store| {
            store.ref();
        }

        defer {
            if (destination_store) |store| {
                store.deref();
            }
        }

        return writeFileWithSourceDestination(globalThis, &source_blob, &destination_blob);
    }

    const write_permissions = 0o664;

    fn writeStringToFileFast(
        globalThis: *JSC.JSGlobalObject,
        pathlike: JSC.Node.PathOrFileDescriptor,
        str: bun.String,
        needs_async: *bool,
        comptime needs_open: bool,
    ) JSC.JSValue {
        const fd: bun.FileDescriptor = if (comptime !needs_open) pathlike.fd else brk: {
            var file_path: [bun.MAX_PATH_BYTES]u8 = undefined;
            switch (JSC.Node.Syscall.open(
                pathlike.path.sliceZ(&file_path),
                // we deliberately don't use O_TRUNC here
                // it's a perf optimization
                std.os.O.WRONLY | std.os.O.CREAT | std.os.O.NONBLOCK,
                write_permissions,
            )) {
                .result => |result| {
                    break :brk result;
                },
                .err => |err| {
                    return JSC.JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
                },
            }
            unreachable;
        };

        var truncate = needs_open or str.isEmpty();
        var jsc_vm = globalThis.bunVM();
        var written: usize = 0;

        defer {
            // we only truncate if it's a path
            // if it's a file descriptor, we assume they want manual control over that behavior
            if (truncate) {
                _ = JSC.Node.Syscall.system.ftruncate(fd, @as(i64, @intCast(written)));
            }

            if (needs_open) {
                _ = JSC.Node.Syscall.close(fd);
            }
        }
        if (!str.isEmpty()) {
            var decoded = str.toUTF8(jsc_vm.allocator);
            defer decoded.deinit();

            var remain = decoded.slice();
            while (remain.len > 0) {
                const result = JSC.Node.Syscall.write(fd, remain);
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

                        return JSC.JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
                    },
                }
            }
        }

        return JSC.JSPromise.resolvedPromiseValue(globalThis, JSC.JSValue.jsNumber(written));
    }

    fn writeBytesToFileFast(
        globalThis: *JSC.JSGlobalObject,
        pathlike: JSC.Node.PathOrFileDescriptor,
        bytes: []const u8,
        needs_async: *bool,
        comptime needs_open: bool,
    ) JSC.JSValue {
        const fd: bun.FileDescriptor = if (comptime !needs_open) pathlike.fd else brk: {
            var file_path: [bun.MAX_PATH_BYTES]u8 = undefined;
            switch (JSC.Node.Syscall.open(
                pathlike.path.sliceZ(&file_path),
                // we deliberately don't use O_TRUNC here
                // it's a perf optimization
                std.os.O.WRONLY | std.os.O.CREAT | std.os.O.NONBLOCK,
                write_permissions,
            )) {
                .result => |result| {
                    break :brk result;
                },
                .err => |err| {
                    return JSC.JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
                },
            }
            unreachable;
        };

        var truncate = needs_open or bytes.len == 0;
        var written: usize = 0;
        defer {
            if (truncate) {
                _ = JSC.Node.Syscall.system.ftruncate(fd, @as(i64, @intCast(written)));
            }

            if (needs_open) {
                _ = JSC.Node.Syscall.close(fd);
            }
        }

        var remain = bytes;
        const end = remain.ptr + remain.len;

        while (remain.ptr != end) {
            const result = JSC.Node.Syscall.write(fd, remain);
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
                    return JSC.JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
                },
            }
        }

        return JSC.JSPromise.resolvedPromiseValue(globalThis, JSC.JSValue.jsNumber(written));
    }

    pub export fn JSDOMFile__hasInstance(_: JSC.JSValue, _: *JSC.JSGlobalObject, value: JSC.JSValue) callconv(.C) bool {
        JSC.markBinding(@src());
        var blob = value.as(Blob) orelse return false;
        return blob.is_jsdom_file;
    }

    pub export fn JSDOMFile__construct(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) ?*Blob {
        JSC.markBinding(@src());
        var allocator = bun.default_allocator;
        var blob: Blob = undefined;
        var arguments = callframe.arguments(3);
        var args = arguments.ptr[0..arguments.len];

        if (args.len < 2) {
            globalThis.throwInvalidArguments("new File(bits, name) expects at least 2 arguments", .{});
            return null;
        }

        const name_value_str = bun.String.tryFromJS(args[1], globalThis) orelse {
            globalThis.throwInvalidArguments("new File(bits, name) expects string as the second argument", .{});
            return null;
        };

        blob = get(globalThis, args[0], false, true) catch |err| {
            if (err == error.InvalidArguments) {
                globalThis.throwInvalidArguments("new File(bits, name) expects iterable as the first argument", .{});
                return null;
            }
            globalThis.throwOutOfMemory();
            return null;
        };

        if (blob.store) |store_| {
            store_.data.bytes.stored_name = bun.PathString.init(
                (name_value_str.toUTF8WithoutRef(bun.default_allocator).clone(bun.default_allocator) catch unreachable).slice(),
            );
        }

        if (args.len > 2) {
            const options = args[2];
            if (options.isObject()) {
                // type, the ASCII-encoded string in lower case
                // representing the media type of the Blob.
                // Normative conditions for this member are provided
                // in the § 3.1 Constructors.
                if (options.get(globalThis, "type")) |content_type| {
                    inner: {
                        if (content_type.isString()) {
                            var content_type_str = content_type.toSlice(globalThis, bun.default_allocator);
                            defer content_type_str.deinit();
                            var slice = content_type_str.slice();
                            if (!strings.isAllASCII(slice)) {
                                break :inner;
                            }
                            blob.content_type_was_set = true;

                            if (globalThis.bunVM().mimeType(slice)) |mime| {
                                blob.content_type = mime.value;
                                break :inner;
                            }
                            var content_type_buf = allocator.alloc(u8, slice.len) catch unreachable;
                            blob.content_type = strings.copyLowercase(slice, content_type_buf);
                            blob.content_type_allocated = true;
                        }
                    }
                }

                if (options.getTruthy(globalThis, "lastModified")) |last_modified| {
                    blob.last_modified = last_modified.coerce(f64, globalThis);
                }
            }
        }

        if (blob.content_type.len == 0) {
            blob.content_type = "";
            blob.content_type_was_set = false;
        }

        var blob_ = allocator.create(Blob) catch unreachable;
        blob_.* = blob;
        blob_.allocator = allocator;
        blob_.is_jsdom_file = true;
        return blob_;
    }

    fn estimatedByteSize(this: *Blob) usize {
        // in-memory size. not the size on disk.
        if (this.size != Blob.max_size) {
            return this.size;
        }

        var store = this.store orelse return 0;
        if (store.data == .bytes) {
            return store.data.bytes.len;
        }

        return 0;
    }

    pub fn estimatedSize(this: *Blob) callconv(.C) usize {
        var size = this.estimatedByteSize() + @sizeOf(Blob);

        if (this.store) |store| {
            size += @sizeOf(Blob.Store);
            size += switch (store.data) {
                .bytes => store.data.bytes.stored_name.len,
                .file => store.data.file.pathlike.path.slice().len,
            };
        }

        return size + (this.content_type.len * @as(usize, @intFromBool(this.content_type_allocated)));
    }

    comptime {
        if (!JSC.is_bindgen) {
            _ = JSDOMFile__hasInstance;
            _ = JSDOMFile__construct;
        }
    }

    pub fn constructBunFile(
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        var vm = globalObject.bunVM();
        const arguments = callframe.arguments(2).slice();
        var args = JSC.Node.ArgumentsSlice.init(vm, arguments);
        defer args.deinit();
        var exception_ = [1]JSC.JSValueRef{null};
        var exception = &exception_;

        const path = JSC.Node.PathOrFileDescriptor.fromJS(globalObject, &args, args.arena.allocator(), exception) orelse {
            if (exception_[0] == null) {
                globalObject.throwInvalidArguments("Expected file path string or file descriptor", .{});
            } else {
                globalObject.throwValue(exception_[0].?.value());
            }

            return .undefined;
        };

        const blob = Blob.findOrCreateFileFromPath(path, globalObject);

        var ptr = bun.default_allocator.create(Blob) catch unreachable;
        ptr.* = blob;
        ptr.allocator = bun.default_allocator;
        return ptr.toJS(globalObject);
    }

    pub fn findOrCreateFileFromPath(path_: JSC.Node.PathOrFileDescriptor, globalThis: *JSGlobalObject) Blob {
        var vm = globalThis.bunVM();
        const allocator = vm.allocator;

        const path: JSC.Node.PathOrFileDescriptor = brk: {
            switch (path_) {
                .path => {
                    const slice = path_.path.slice();

                    if (vm.standalone_module_graph) |graph| {
                        if (graph.find(slice)) |file| {
                            return file.blob(globalThis).dupe();
                        }
                    }

                    var cloned = (allocator.dupeZ(u8, slice) catch unreachable)[0..slice.len];

                    break :brk .{
                        .path = .{
                            .string = bun.PathString.init(cloned),
                        },
                    };
                },
                .fd => {
                    switch (path_.fd) {
                        std.os.STDIN_FILENO => return Blob.initWithStore(
                            vm.rareData().stdin(),
                            globalThis,
                        ),
                        std.os.STDERR_FILENO => return Blob.initWithStore(
                            vm.rareData().stderr(),
                            globalThis,
                        ),
                        std.os.STDOUT_FILENO => return Blob.initWithStore(
                            vm.rareData().stdout(),
                            globalThis,
                        ),
                        else => {},
                    }
                    break :brk path_;
                },
            }
        };

        return Blob.initWithStore(Blob.Store.initFile(path, null, allocator) catch unreachable, globalThis);
    }

    pub const Store = struct {
        data: Data,

        mime_type: MimeType = MimeType.none,
        ref_count: u32 = 0,
        is_all_ascii: ?bool = null,
        allocator: std.mem.Allocator,

        pub fn size(this: *const Store) SizeType {
            return switch (this.data) {
                .bytes => this.data.bytes.len,
                .file => Blob.max_size,
            };
        }

        pub const Map = std.HashMap(u64, *JSC.WebCore.Blob.Store, IdentityContext(u64), 80);

        pub const Data = union(enum) {
            bytes: ByteStore,
            file: FileStore,
        };

        pub fn ref(this: *Store) void {
            std.debug.assert(this.ref_count > 0);
            this.ref_count += 1;
        }

        pub fn external(ptr: ?*anyopaque, _: ?*anyopaque, _: usize) callconv(.C) void {
            if (ptr == null) return;
            var this = bun.cast(*Store, ptr);
            this.deref();
        }

        pub fn initFile(pathlike: JSC.Node.PathOrFileDescriptor, mime_type: ?HTTPClient.MimeType, allocator: std.mem.Allocator) !*Store {
            var store = try allocator.create(Blob.Store);
            store.* = .{
                .data = .{
                    .file = FileStore.init(
                        pathlike,
                        mime_type orelse brk: {
                            if (pathlike == .path) {
                                const sliced = pathlike.path.slice();
                                if (sliced.len > 0) {
                                    var extname = std.fs.path.extension(sliced);
                                    extname = std.mem.trim(u8, extname, ".");
                                    if (HTTPClient.MimeType.byExtensionNoDefault(extname)) |mime| {
                                        break :brk mime;
                                    }
                                }
                            }

                            break :brk null;
                        },
                    ),
                },
                .allocator = allocator,
                .ref_count = 1,
            };
            return store;
        }

        pub fn init(bytes: []u8, allocator: std.mem.Allocator) !*Store {
            var store = try allocator.create(Blob.Store);
            store.* = .{
                .data = .{ .bytes = ByteStore.init(bytes, allocator) },
                .allocator = allocator,
                .ref_count = 1,
            };
            return store;
        }

        pub fn sharedView(this: Store) []u8 {
            if (this.data == .bytes)
                return this.data.bytes.slice();

            return &[_]u8{};
        }

        pub fn deref(this: *Blob.Store) void {
            std.debug.assert(this.ref_count >= 1);
            this.ref_count -= 1;
            if (this.ref_count == 0) {
                this.deinit();
            }
        }

        pub fn deinit(this: *Blob.Store) void {
            const allocator = this.allocator;

            switch (this.data) {
                .bytes => |*bytes| {
                    bytes.deinit();
                },
                .file => |file| {
                    if (file.pathlike == .path) {
                        allocator.free(bun.constStrToU8(file.pathlike.path.slice()));
                    }
                },
            }

            allocator.destroy(this);
        }

        const SerializeTag = enum(u8) {
            file = 0,
            bytes = 1,
            empty = 2,
        };

        pub fn serialize(this: *Store, comptime Writer: type, writer: Writer) !void {
            switch (this.data) {
                .file => |file| {
                    const pathlike_tag: JSC.Node.PathOrFileDescriptor.SerializeTag = if (file.pathlike == .fd) .fd else .path;
                    try writer.writeIntNative(u8, @intFromEnum(pathlike_tag));

                    switch (file.pathlike) {
                        .fd => |fd| {
                            try writer.writeIntNative(u32, @as(u32, @intCast(fd)));
                        },
                        .path => |path| {
                            const path_slice = path.slice();
                            try writer.writeIntNative(u32, @as(u32, @truncate(path_slice.len)));
                            _ = try writer.write(path_slice);
                        },
                    }
                },
                .bytes => |bytes| {
                    const slice = bytes.slice();
                    try writer.writeIntNative(u32, @as(u32, @truncate(slice.len)));
                    _ = try writer.write(slice);
                },
            }
        }

        pub fn fromArrayList(list: std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator) !*Blob.Store {
            return try Blob.Store.init(list.items, allocator);
        }

        pub fn FileOpenerMixin(comptime This: type) type {
            return struct {
                open_completion: AsyncIO.Completion = undefined,
                context: *This,

                const State = @This();

                /// This is a workaround for some versions of IO uring returning
                /// EAGAIN when reading a file opened with O_NONBLOCK. Since io_uring waits, we don't need to wait.
                const non_block_without_io_uring = if (Environment.isLinux) 0 else std.os.O.NONBLOCK;

                const __opener_flags = non_block_without_io_uring | std.os.O.CLOEXEC;

                const open_flags_ = if (@hasDecl(This, "open_flags"))
                    This.open_flags | __opener_flags
                else
                    std.os.O.RDONLY | __opener_flags;

                pub fn getFdMac(this: *This) bun.FileDescriptor {
                    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    var path_string = if (@hasField(This, "file_store"))
                        this.file_store.pathlike.path
                    else
                        this.file_blob.store.?.data.file.pathlike.path;

                    var path = path_string.sliceZ(&buf);

                    this.opened_fd = switch (JSC.Node.Syscall.open(path, open_flags_, JSC.Node.default_permission)) {
                        .result => |fd| fd,
                        .err => |err| {
                            this.errno = AsyncIO.asError(err.errno);
                            this.system_error = err.withPath(path_string.slice()).toSystemError();
                            this.opened_fd = null_fd;
                            return null_fd;
                        },
                    };

                    return this.opened_fd;
                }

                pub const OpenCallback = *const fn (*This, bun.FileDescriptor) void;

                pub fn getFd(this: *This, comptime Callback: OpenCallback) void {
                    if (this.opened_fd != null_fd) {
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

                    if (comptime Environment.isMac) {
                        Callback(this, this.getFdMac());
                    } else {
                        this.getFdLinux(Callback);
                    }
                }

                const WrappedOpenCallback = *const fn (*State, *HTTPClient.NetworkThread.Completion, AsyncIO.OpenError!bun.FileDescriptor) void;
                fn OpenCallbackWrapper(comptime Callback: OpenCallback) WrappedOpenCallback {
                    return struct {
                        const callback = Callback;
                        const StateHolder = State;
                        pub fn onOpen(state: *State, completion: *HTTPClient.NetworkThread.Completion, result: AsyncIO.OpenError!bun.FileDescriptor) void {
                            var this = state.context;
                            var path_buffer = completion.operation.open.path;
                            defer bun.default_allocator.free(bun.span(path_buffer));
                            defer bun.default_allocator.destroy(state);
                            this.opened_fd = result catch {
                                this.errno = AsyncIO.asError(-completion.result);
                                // do not use path_buffer here because it is a temporary
                                var path_string = if (@hasField(This, "file_store"))
                                    this.file_store.pathlike.path
                                else
                                    this.file_blob.store.?.data.file.pathlike.path;

                                this.system_error = (JSC.Node.Syscall.Error{
                                    .errno = @as(JSC.Node.Syscall.Error.Int, @intCast(-completion.result)),
                                    .path = path_string.slice(),
                                    .syscall = .open,
                                }).toSystemError();

                                callback(this, null_fd);
                                return;
                            };

                            callback(this, this.opened_fd);
                        }
                    }.onOpen;
                }

                pub fn getFdLinux(this: *This, comptime callback: OpenCallback) void {
                    var aio = &AsyncIO.global;

                    var path_string = if (@hasField(This, "file_store"))
                        this.file_store.pathlike.path
                    else
                        this.file_blob.store.?.data.file.pathlike.path;

                    var holder = bun.default_allocator.create(State) catch unreachable;
                    holder.* = .{
                        .context = this,
                    };
                    var path_buffer = bun.default_allocator.dupeZ(u8, path_string.slice()) catch unreachable;
                    aio.open(
                        *State,
                        holder,
                        comptime OpenCallbackWrapper(callback),
                        &holder.open_completion,
                        path_buffer,
                        open_flags_,
                        JSC.Node.default_permission,
                    );
                }
            };
        }

        pub fn FileCloserMixin(comptime This: type) type {
            return struct {
                const Closer = @This();
                close_completion: AsyncIO.Completion = undefined,

                pub fn doClose(this: *This) void {
                    const fd = this.opened_fd;
                    std.debug.assert(fd != null_fd);
                    var aio = &AsyncIO.global;

                    var closer = bun.default_allocator.create(Closer) catch unreachable;

                    aio.close(
                        *Closer,
                        closer,
                        onClose,
                        &closer.close_completion,
                        fd,
                    );
                    this.opened_fd = null_fd;
                }

                pub fn onClose(closer: *Closer, _: *HTTPClient.NetworkThread.Completion, _: AsyncIO.CloseError!void) void {
                    bun.default_allocator.destroy(closer);
                }
            };
        }

        pub const ReadFile = struct {
            file_store: FileStore,
            byte_store: ByteStore = ByteStore{ .allocator = bun.default_allocator },
            store: ?*Store = null,
            offset: SizeType = 0,
            max_length: SizeType = Blob.max_size,
            opened_fd: bun.FileDescriptor = null_fd,
            read_completion: HTTPClient.NetworkThread.Completion = undefined,
            read_len: SizeType = 0,
            read_off: SizeType = 0,
            size: SizeType = 0,
            buffer: []u8 = undefined,
            task: HTTPClient.NetworkThread.Task = undefined,
            system_error: ?JSC.SystemError = null,
            errno: ?anyerror = null,
            onCompleteCtx: *anyopaque = undefined,
            onCompleteCallback: OnReadFileCallback = undefined,
            io_task: ?*ReadFileTask = null,

            pub const Read = struct {
                buf: []u8,
                is_temporary: bool = false,
                total_size: SizeType = 0,
            };
            pub const ResultType = SystemError.Maybe(Read);

            pub const OnReadFileCallback = *const fn (ctx: *anyopaque, bytes: ResultType) void;

            pub usingnamespace FileOpenerMixin(ReadFile);
            pub usingnamespace FileCloserMixin(ReadFile);

            pub fn createWithCtx(
                allocator: std.mem.Allocator,
                store: *Store,
                onReadFileContext: *anyopaque,
                onCompleteCallback: OnReadFileCallback,
                off: SizeType,
                max_len: SizeType,
            ) !*ReadFile {
                var read_file = try allocator.create(ReadFile);
                read_file.* = ReadFile{
                    .file_store = store.data.file,
                    .offset = off,
                    .max_length = max_len,
                    .store = store,
                    .onCompleteCtx = onReadFileContext,
                    .onCompleteCallback = onCompleteCallback,
                };
                store.ref();
                return read_file;
            }

            pub fn create(
                allocator: std.mem.Allocator,
                store: *Store,
                off: SizeType,
                max_len: SizeType,
                comptime Context: type,
                context: Context,
                comptime callback: fn (ctx: Context, bytes: ResultType) void,
            ) !*ReadFile {
                const Handler = struct {
                    pub fn run(ptr: *anyopaque, bytes: ResultType) void {
                        callback(bun.cast(Context, ptr), bytes);
                    }
                };

                return try ReadFile.createWithCtx(allocator, store, @as(*anyopaque, @ptrCast(context)), Handler.run, off, max_len);
            }

            pub fn doRead(this: *ReadFile) void {
                var aio = &AsyncIO.global;

                var remaining = this.buffer[this.read_off..];
                this.read_len = 0;
                aio.read(
                    *ReadFile,
                    this,
                    onRead,
                    &this.read_completion,
                    this.opened_fd,
                    remaining[0..@min(remaining.len, this.max_length - this.read_off)],
                    this.offset + this.read_off,
                );
            }

            pub const ReadFileTask = JSC.IOTask(@This());

            pub fn then(this: *ReadFile, _: *JSC.JSGlobalObject) void {
                var cb = this.onCompleteCallback;
                var cb_ctx = this.onCompleteCtx;

                if (this.store == null and this.system_error != null) {
                    var system_error = this.system_error.?;
                    bun.default_allocator.destroy(this);
                    cb(cb_ctx, ResultType{ .err = system_error });
                    return;
                } else if (this.store == null) {
                    bun.default_allocator.destroy(this);
                    cb(cb_ctx, ResultType{
                        .err = SystemError{
                            .code = bun.String.static("INTERNAL_ERROR"),
                            .message = bun.String.static("assertion failure - store should not be null"),
                            .syscall = bun.String.static("read"),
                        },
                    });
                    return;
                }

                var store = this.store.?;
                var buf = this.buffer;

                defer store.deref();
                defer bun.default_allocator.destroy(this);
                if (this.system_error) |err| {
                    cb(cb_ctx, ResultType{ .err = err });
                    return;
                }

                cb(cb_ctx, .{ .result = .{ .buf = buf, .total_size = this.size, .is_temporary = true } });
            }
            pub fn run(this: *ReadFile, task: *ReadFileTask) void {
                this.runAsync(task);
            }

            pub fn onRead(this: *ReadFile, completion: *HTTPClient.NetworkThread.Completion, result: AsyncIO.ReadError!usize) void {
                defer this.doReadLoop();

                this.read_len = @as(SizeType, @truncate(result catch |err| {
                    if (@hasField(HTTPClient.NetworkThread.Completion, "result")) {
                        this.errno = AsyncIO.asError(-completion.result);
                        this.system_error = (JSC.Node.Syscall.Error{
                            .errno = @as(JSC.Node.Syscall.Error.Int, @intCast(-completion.result)),
                            .syscall = .read,
                        }).toSystemError();
                    } else {
                        this.system_error = JSC.SystemError{
                            .code = bun.String.static(bun.asByteSlice(@errorName(err))),
                            .path = if (this.file_store.pathlike == .path)
                                bun.String.create(this.file_store.pathlike.path.slice())
                            else
                                bun.String.empty,
                            .syscall = bun.String.static("read"),
                        };

                        this.errno = err;
                    }

                    this.read_len = 0;
                    return;
                }));
            }

            fn runAsync(this: *ReadFile, task: *ReadFileTask) void {
                this.io_task = task;

                if (this.file_store.pathlike == .fd) {
                    this.opened_fd = this.file_store.pathlike.fd;
                }

                this.getFd(runAsyncWithFD);
            }

            fn onFinish(this: *ReadFile) void {
                const fd = this.opened_fd;
                const file = &this.file_store;
                const needs_close = fd != null_fd and file.pathlike == .path and fd > 2;

                this.size = @max(this.read_len, this.size);

                if (needs_close) {
                    this.doClose();
                }

                if (this.io_task) |io_task| {
                    io_task.onFinish();
                    this.io_task = null;
                }
            }

            fn resolveSizeAndLastModified(this: *ReadFile, fd: bun.FileDescriptor) void {
                const stat: std.os.Stat = switch (JSC.Node.Syscall.fstat(fd)) {
                    .result => |result| result,
                    .err => |err| {
                        this.errno = AsyncIO.asError(err.errno);
                        this.system_error = err.toSystemError();
                        return;
                    },
                };

                if (this.store) |store| {
                    if (store.data == .file) {
                        store.data.file.last_modified = toJSTime(stat.mtime().tv_sec, stat.mtime().tv_nsec);
                    }
                }

                if (std.os.S.ISDIR(stat.mode)) {
                    this.errno = error.EISDIR;
                    this.system_error = JSC.SystemError{
                        .code = bun.String.static("EISDIR"),
                        .path = if (this.file_store.pathlike == .path)
                            bun.String.create(this.file_store.pathlike.path.slice())
                        else
                            bun.String.empty,
                        .message = bun.String.static("Directories cannot be read like files"),
                        .syscall = bun.String.static("read"),
                    };
                    return;
                }

                if (stat.size > 0 and std.os.S.ISREG(stat.mode)) {
                    this.size = @min(
                        @as(SizeType, @truncate(@as(SizeType, @intCast(@max(@as(i64, @intCast(stat.size)), 0))))),
                        this.max_length,
                    );
                    // read up to 4k at a time if
                    // they didn't explicitly set a size and we're reading from something that's not a regular file
                } else if (stat.size == 0 and !std.os.S.ISREG(stat.mode)) {
                    this.size = if (this.max_length == Blob.max_size)
                        4096
                    else
                        this.max_length;
                }
            }

            fn runAsyncWithFD(this: *ReadFile, fd: bun.FileDescriptor) void {
                if (this.errno != null) {
                    this.onFinish();
                    return;
                }

                this.resolveSizeAndLastModified(fd);
                if (this.errno != null)
                    return this.onFinish();

                if (this.size == 0) {
                    this.buffer = &[_]u8{};
                    this.byte_store = ByteStore.init(this.buffer, bun.default_allocator);

                    this.onFinish();
                }

                this.buffer = bun.default_allocator.alloc(u8, this.size) catch |err| {
                    this.errno = err;
                    this.onFinish();
                    return;
                };
                this.read_len = 0;
                this.doReadLoop();
            }

            fn doReadLoop(this: *ReadFile) void {
                this.read_off += this.read_len;
                var remain = this.buffer[@min(this.read_off, @as(Blob.SizeType, @truncate(this.buffer.len)))..];

                if (remain.len > 0 and this.errno == null) {
                    this.doRead();
                    return;
                }

                _ = bun.default_allocator.resize(this.buffer, this.read_off);
                this.buffer = this.buffer[0..this.read_off];
                this.byte_store = ByteStore.init(this.buffer, bun.default_allocator);
                this.onFinish();
            }
        };

        pub const WriteFile = struct {
            file_blob: Blob,
            bytes_blob: Blob,

            opened_fd: bun.FileDescriptor = null_fd,
            system_error: ?JSC.SystemError = null,
            errno: ?anyerror = null,
            write_completion: HTTPClient.NetworkThread.Completion = undefined,
            task: HTTPClient.NetworkThread.Task = undefined,
            io_task: ?*WriteFileTask = null,

            onCompleteCtx: *anyopaque = undefined,
            onCompleteCallback: OnWriteFileCallback = undefined,
            wrote: usize = 0,

            pub const ResultType = SystemError.Maybe(SizeType);
            pub const OnWriteFileCallback = *const fn (ctx: *anyopaque, count: ResultType) void;

            pub usingnamespace FileOpenerMixin(WriteFile);
            pub usingnamespace FileCloserMixin(WriteFile);

            // Do not open with APPEND because we may use pwrite()
            pub const open_flags = std.os.O.WRONLY | std.os.O.CREAT | std.os.O.TRUNC;

            pub fn createWithCtx(
                allocator: std.mem.Allocator,
                file_blob: Blob,
                bytes_blob: Blob,
                onWriteFileContext: *anyopaque,
                onCompleteCallback: OnWriteFileCallback,
            ) !*WriteFile {
                var read_file = try allocator.create(WriteFile);
                read_file.* = WriteFile{
                    .file_blob = file_blob,
                    .bytes_blob = bytes_blob,
                    .onCompleteCtx = onWriteFileContext,
                    .onCompleteCallback = onCompleteCallback,
                };
                file_blob.store.?.ref();
                bytes_blob.store.?.ref();
                return read_file;
            }

            pub fn create(
                allocator: std.mem.Allocator,
                file_blob: Blob,
                bytes_blob: Blob,
                comptime Context: type,
                context: Context,
                comptime callback: fn (ctx: Context, bytes: ResultType) void,
            ) !*WriteFile {
                const Handler = struct {
                    pub fn run(ptr: *anyopaque, bytes: ResultType) void {
                        callback(bun.cast(Context, ptr), bytes);
                    }
                };

                return try WriteFile.createWithCtx(
                    allocator,
                    file_blob,
                    bytes_blob,
                    @as(*anyopaque, @ptrCast(context)),
                    Handler.run,
                );
            }

            pub fn doWrite(
                this: *WriteFile,
                buffer: []const u8,
                file_offset: u64,
            ) void {
                var aio = &AsyncIO.global;
                this.wrote = 0;
                const fd = this.opened_fd;
                std.debug.assert(fd != null_fd);
                aio.write(
                    *WriteFile,
                    this,
                    onWrite,
                    &this.write_completion,
                    fd,
                    buffer,
                    if (fd > 2) file_offset else 0,
                );
            }

            pub const WriteFileTask = JSC.IOTask(@This());

            pub fn then(this: *WriteFile, _: *JSC.JSGlobalObject) void {
                var cb = this.onCompleteCallback;
                var cb_ctx = this.onCompleteCtx;

                this.bytes_blob.store.?.deref();
                this.file_blob.store.?.deref();

                if (this.system_error) |err| {
                    bun.default_allocator.destroy(this);
                    cb(cb_ctx, .{
                        .err = err,
                    });
                    return;
                }

                const wrote = this.wrote;
                bun.default_allocator.destroy(this);
                cb(cb_ctx, .{ .result = @as(SizeType, @truncate(wrote)) });
            }
            pub fn run(this: *WriteFile, task: *WriteFileTask) void {
                this.io_task = task;
                this.runAsync();
            }

            pub fn onWrite(this: *WriteFile, _: *HTTPClient.NetworkThread.Completion, result: AsyncIO.WriteError!usize) void {
                defer this.doWriteLoop();
                this.wrote += @as(SizeType, @truncate(result catch |errno| {
                    this.errno = errno;
                    this.system_error = this.system_error orelse JSC.SystemError{
                        .code = bun.String.static(bun.asByteSlice(@errorName(errno))),
                        .syscall = bun.String.static("write"),
                    };

                    this.wrote = 0;
                    return;
                }));
            }

            fn runAsync(this: *WriteFile) void {
                this.getFd(runWithFD);
            }

            fn onFinish(this: *WriteFile) void {
                const fd = this.opened_fd;
                const file = this.file_blob.store.?.data.file;
                const needs_close = fd != null_fd and file.pathlike == .path and fd > 2;

                if (needs_close) {
                    this.doClose();
                }

                if (this.io_task) |io_task| {
                    io_task.onFinish();
                    this.io_task = null;
                }
            }

            fn runWithFD(this: *WriteFile, fd: bun.FileDescriptor) void {
                if (fd == null_fd or this.errno != null) {
                    this.onFinish();
                    return;
                }

                this.doWriteLoop();
            }

            fn doWriteLoop(this: *WriteFile) void {
                var remain = this.bytes_blob.sharedView();
                var file_offset = this.file_blob.offset;

                const this_tick = file_offset + this.wrote;
                remain = remain[@min(this.wrote, remain.len)..];

                if (remain.len > 0 and this.errno == null) {
                    this.doWrite(remain, this_tick);
                } else {
                    this.onFinish();
                }
            }
        };

        pub const IOWhich = enum {
            source,
            destination,
            both,
        };

        const unsupported_directory_error = SystemError{
            .errno = @as(c_int, @intCast(@intFromEnum(bun.C.SystemErrno.EISDIR))),
            .message = bun.String.static("That doesn't work on folders"),
            .syscall = bun.String.static("fstat"),
        };
        const unsupported_non_regular_file_error = SystemError{
            .errno = @as(c_int, @intCast(@intFromEnum(bun.C.SystemErrno.ENOTSUP))),
            .message = bun.String.static("Non-regular files aren't supported yet"),
            .syscall = bun.String.static("fstat"),
        };

        // blocking, but off the main thread
        pub const CopyFile = struct {
            destination_file_store: FileStore,
            source_file_store: FileStore,
            store: ?*Store = null,
            source_store: ?*Store = null,
            offset: SizeType = 0,
            size: SizeType = 0,
            max_length: SizeType = Blob.max_size,
            destination_fd: bun.FileDescriptor = null_fd,
            source_fd: bun.FileDescriptor = null_fd,

            system_error: ?SystemError = null,

            read_len: SizeType = 0,
            read_off: SizeType = 0,

            globalThis: *JSGlobalObject,

            pub const ResultType = anyerror!SizeType;

            pub const Callback = *const fn (ctx: *anyopaque, len: ResultType) void;
            pub const CopyFilePromiseTask = JSC.ConcurrentPromiseTask(CopyFile);
            pub const CopyFilePromiseTaskEventLoopTask = CopyFilePromiseTask.EventLoopTask;

            pub fn create(
                allocator: std.mem.Allocator,
                store: *Store,
                source_store: *Store,
                off: SizeType,
                max_len: SizeType,
                globalThis: *JSC.JSGlobalObject,
            ) !*CopyFilePromiseTask {
                var read_file = try allocator.create(CopyFile);
                read_file.* = CopyFile{
                    .store = store,
                    .source_store = source_store,
                    .offset = off,
                    .max_length = max_len,
                    .globalThis = globalThis,
                    .destination_file_store = store.data.file,
                    .source_file_store = source_store.data.file,
                };
                store.ref();
                source_store.ref();
                return try CopyFilePromiseTask.createOnJSThread(allocator, globalThis, read_file);
            }

            const linux = std.os.linux;
            const darwin = std.os.darwin;

            pub fn deinit(this: *CopyFile) void {
                if (this.source_file_store.pathlike == .path) {
                    if (this.source_file_store.pathlike.path == .string and this.system_error == null) {
                        bun.default_allocator.free(bun.constStrToU8(this.source_file_store.pathlike.path.slice()));
                    }
                }
                this.store.?.deref();

                bun.default_allocator.destroy(this);
            }

            pub fn reject(this: *CopyFile, promise: *JSC.JSPromise) void {
                var globalThis = this.globalThis;
                var system_error: SystemError = this.system_error orelse SystemError{};
                if (this.source_file_store.pathlike == .path and system_error.path.isEmpty()) {
                    system_error.path = bun.String.create(this.source_file_store.pathlike.path.slice());
                }

                if (system_error.message.isEmpty()) {
                    system_error.message = bun.String.static("Failed to copy file");
                }

                var instance = system_error.toErrorInstance(this.globalThis);
                if (this.store) |store| {
                    store.deref();
                }
                promise.reject(globalThis, instance);
            }

            pub fn then(this: *CopyFile, promise: *JSC.JSPromise) void {
                this.source_store.?.deref();

                if (this.system_error != null) {
                    this.reject(promise);
                    return;
                }

                promise.resolve(this.globalThis, JSC.JSValue.jsNumberFromUint64(this.read_len));
            }

            pub fn run(this: *CopyFile) void {
                this.runAsync();
            }

            pub fn doClose(this: *CopyFile) void {
                const close_input = this.destination_file_store.pathlike != .fd and this.destination_fd != null_fd;
                const close_output = this.source_file_store.pathlike != .fd and this.source_fd != null_fd;

                if (close_input and close_output) {
                    this.doCloseFile(.both);
                } else if (close_input) {
                    this.doCloseFile(.destination);
                } else if (close_output) {
                    this.doCloseFile(.source);
                }
            }

            const os = std.os;

            pub fn doCloseFile(this: *CopyFile, comptime which: IOWhich) void {
                switch (which) {
                    .both => {
                        _ = JSC.Node.Syscall.close(this.destination_fd);
                        _ = JSC.Node.Syscall.close(this.source_fd);
                    },
                    .destination => {
                        _ = JSC.Node.Syscall.close(this.destination_fd);
                    },
                    .source => {
                        _ = JSC.Node.Syscall.close(this.source_fd);
                    },
                }
            }

            const O = if (Environment.isLinux) linux.O else std.os.O;
            const open_destination_flags = O.CLOEXEC | O.CREAT | O.WRONLY | O.TRUNC;
            const open_source_flags = O.CLOEXEC | O.RDONLY;

            pub fn doOpenFile(this: *CopyFile, comptime which: IOWhich) !void {
                // open source file first
                // if it fails, we don't want the extra destination file hanging out
                if (which == .both or which == .source) {
                    this.source_fd = switch (JSC.Node.Syscall.open(
                        this.source_file_store.pathlike.path.sliceZAssume(),
                        open_source_flags,
                        0,
                    )) {
                        .result => |result| result,
                        .err => |errno| {
                            this.system_error = errno.toSystemError();
                            return AsyncIO.asError(errno.errno);
                        },
                    };
                }

                if (which == .both or which == .destination) {
                    this.destination_fd = switch (JSC.Node.Syscall.open(
                        this.destination_file_store.pathlike.path.sliceZAssume(),
                        open_destination_flags,
                        JSC.Node.default_permission,
                    )) {
                        .result => |result| result,
                        .err => |errno| {
                            if (which == .both) {
                                _ = JSC.Node.Syscall.close(this.source_fd);
                                this.source_fd = 0;
                            }

                            this.system_error = errno.toSystemError();
                            return AsyncIO.asError(errno.errno);
                        },
                    };
                }
            }

            const TryWith = enum {
                sendfile,
                copy_file_range,
                splice,

                pub const tag = std.EnumMap(TryWith, JSC.Node.Syscall.Tag).init(.{
                    .sendfile = .sendfile,
                    .copy_file_range = .copy_file_range,
                    .splice = .splice,
                });
            };

            pub fn doCopyFileRange(
                this: *CopyFile,
                comptime use: TryWith,
                comptime clear_append_if_invalid: bool,
            ) anyerror!void {
                this.read_off += this.offset;

                var remain = @as(usize, this.max_length);
                const unknown_size = remain == max_size or remain == 0;
                if (unknown_size) {
                    // sometimes stat lies
                    // let's give it 4096 and see how it goes
                    remain = 4096;
                }

                var total_written: usize = 0;
                const src_fd = this.source_fd;
                const dest_fd = this.destination_fd;

                defer {
                    this.read_len = @as(SizeType, @truncate(total_written));
                }

                var has_unset_append = false;

                // If they can't use copy_file_range, they probably also can't
                // use sendfile() or splice()
                if (!bun.canUseCopyFileRangeSyscall()) {
                    switch (JSC.Node.NodeFS.copyFileUsingReadWriteLoop("", "", src_fd, dest_fd, if (unknown_size) 0 else remain, &total_written)) {
                        .err => |err| {
                            this.system_error = err.toSystemError();
                            return AsyncIO.asError(err.errno);
                        },
                        .result => {
                            _ = linux.ftruncate(dest_fd, @as(std.os.off_t, @intCast(total_written)));
                            return;
                        },
                    }
                }

                while (true) {
                    const written = switch (comptime use) {
                        .copy_file_range => linux.copy_file_range(src_fd, null, dest_fd, null, remain, 0),
                        .sendfile => linux.sendfile(dest_fd, src_fd, null, remain),
                        .splice => bun.C.splice(src_fd, null, dest_fd, null, remain, 0),
                    };

                    switch (linux.getErrno(written)) {
                        .SUCCESS => {},

                        .NOSYS, .XDEV => {
                            switch (JSC.Node.NodeFS.copyFileUsingReadWriteLoop("", "", src_fd, dest_fd, if (unknown_size) 0 else remain, &total_written)) {
                                .err => |err| {
                                    this.system_error = err.toSystemError();
                                    return AsyncIO.asError(err.errno);
                                },
                                .result => {
                                    _ = linux.ftruncate(dest_fd, @as(std.os.off_t, @intCast(total_written)));
                                    return;
                                },
                            }
                        },

                        .INVAL => {
                            if (comptime clear_append_if_invalid) {
                                if (!has_unset_append) {
                                    // https://kylelaker.com/2018/08/31/stdout-oappend.html
                                    // make() can set STDOUT / STDERR to O_APPEND
                                    // this messes up sendfile()
                                    has_unset_append = true;
                                    const flags = linux.fcntl(dest_fd, linux.F.GETFL, 0);
                                    if ((flags & O.APPEND) != 0) {
                                        _ = linux.fcntl(dest_fd, linux.F.SETFL, flags ^ O.APPEND);
                                        continue;
                                    }
                                }
                            }

                            // If the Linux machine doesn't support
                            // copy_file_range or the file descrpitor is
                            // incompatible with the chosen syscall, fall back
                            // to a read/write loop
                            if (total_written == 0) {
                                switch (JSC.Node.NodeFS.copyFileUsingReadWriteLoop("", "", src_fd, dest_fd, if (unknown_size) 0 else remain, &total_written)) {
                                    .err => |err| {
                                        this.system_error = err.toSystemError();
                                        return AsyncIO.asError(err.errno);
                                    },
                                    .result => {
                                        _ = linux.ftruncate(dest_fd, @as(std.os.off_t, @intCast(total_written)));
                                        return;
                                    },
                                }
                            }

                            this.system_error = (JSC.Node.Syscall.Error{
                                .errno = @as(JSC.Node.Syscall.Error.Int, @intCast(@intFromEnum(linux.E.INVAL))),
                                .syscall = TryWith.tag.get(use).?,
                            }).toSystemError();
                            return AsyncIO.asError(linux.E.INVAL);
                        },
                        else => |errno| {
                            this.system_error = (JSC.Node.Syscall.Error{
                                .errno = @as(JSC.Node.Syscall.Error.Int, @intCast(@intFromEnum(errno))),
                                .syscall = TryWith.tag.get(use).?,
                            }).toSystemError();
                            return AsyncIO.asError(errno);
                        },
                    }

                    // wrote zero bytes means EOF
                    remain -|= written;
                    total_written += written;
                    if (written == 0 or remain == 0) break;
                }
            }

            pub fn doFCopyFile(this: *CopyFile) anyerror!void {
                switch (JSC.Node.Syscall.fcopyfile(this.source_fd, this.destination_fd, os.system.COPYFILE.DATA)) {
                    .err => |errno| {
                        this.system_error = errno.toSystemError();

                        return AsyncIO.asError(errno.errno);
                    },
                    .result => {},
                }
            }

            pub fn doClonefile(this: *CopyFile) anyerror!void {
                var source_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var dest_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

                switch (JSC.Node.Syscall.clonefile(
                    this.source_file_store.pathlike.path.sliceZ(&source_buf),
                    this.destination_file_store.pathlike.path.sliceZ(
                        &dest_buf,
                    ),
                )) {
                    .err => |errno| {
                        this.system_error = errno.toSystemError();
                        return AsyncIO.asError(errno.errno);
                    },
                    .result => {},
                }
            }

            pub fn runAsync(this: *CopyFile) void {
                // defer task.onFinish();

                var stat_: ?std.os.Stat = null;

                if (this.destination_file_store.pathlike == .fd) {
                    this.destination_fd = this.destination_file_store.pathlike.fd;
                }

                if (this.source_file_store.pathlike == .fd) {
                    this.source_fd = this.source_file_store.pathlike.fd;
                }

                // Do we need to open both files?
                if (this.destination_fd == null_fd and this.source_fd == null_fd) {

                    // First, we attempt to clonefile() on macOS
                    // This is the fastest way to copy a file.
                    if (comptime Environment.isMac) {
                        if (this.offset == 0 and this.source_file_store.pathlike == .path and this.destination_file_store.pathlike == .path) {
                            do_clonefile: {

                                // stat the output file, make sure it:
                                // 1. Exists
                                switch (JSC.Node.Syscall.stat(this.source_file_store.pathlike.path.sliceZAssume())) {
                                    .result => |result| {
                                        stat_ = result;

                                        if (os.S.ISDIR(result.mode)) {
                                            this.system_error = unsupported_directory_error;
                                            return;
                                        }

                                        if (!os.S.ISREG(result.mode))
                                            break :do_clonefile;
                                    },
                                    .err => |err| {
                                        // If we can't stat it, we also can't copy it.
                                        this.system_error = err.toSystemError();
                                        return;
                                    },
                                }

                                if (this.doClonefile()) {
                                    if (this.max_length != Blob.max_size and this.max_length < @as(SizeType, @intCast(stat_.?.size))) {
                                        // If this fails...well, there's not much we can do about it.
                                        _ = bun.C.truncate(
                                            this.destination_file_store.pathlike.path.sliceZAssume(),
                                            @as(std.os.off_t, @intCast(this.max_length)),
                                        );
                                        this.read_len = @as(SizeType, @intCast(this.max_length));
                                    } else {
                                        this.read_len = @as(SizeType, @intCast(stat_.?.size));
                                    }
                                    return;
                                } else |_| {

                                    // this may still fail, in which case we just continue trying with fcopyfile
                                    // it can fail when the input file already exists
                                    // or if the output is not a directory
                                    // or if it's a network volume
                                    this.system_error = null;
                                }
                            }
                        }
                    }

                    this.doOpenFile(.both) catch return;
                    // Do we need to open only one file?
                } else if (this.destination_fd == null_fd) {
                    this.source_fd = this.source_file_store.pathlike.fd;

                    this.doOpenFile(.destination) catch return;
                    // Do we need to open only one file?
                } else if (this.source_fd == null_fd) {
                    this.destination_fd = this.destination_file_store.pathlike.fd;

                    this.doOpenFile(.source) catch return;
                }

                if (this.system_error != null) {
                    return;
                }

                std.debug.assert(this.destination_fd != null_fd);
                std.debug.assert(this.source_fd != null_fd);

                if (this.destination_file_store.pathlike == .fd) {}

                const stat: std.os.Stat = stat_ orelse switch (JSC.Node.Syscall.fstat(this.source_fd)) {
                    .result => |result| result,
                    .err => |err| {
                        this.doClose();
                        this.system_error = err.toSystemError();
                        return;
                    },
                };

                if (os.S.ISDIR(stat.mode)) {
                    this.system_error = unsupported_directory_error;
                    this.doClose();
                    return;
                }

                if (stat.size != 0) {
                    this.max_length = @max(@min(@as(SizeType, @intCast(stat.size)), this.max_length), this.offset) - this.offset;
                    if (this.max_length == 0) {
                        this.doClose();
                        return;
                    }

                    if (os.S.ISREG(stat.mode) and
                        this.max_length > bun.C.preallocate_length and
                        this.max_length != Blob.max_size)
                    {
                        bun.C.preallocate_file(this.destination_fd, 0, this.max_length) catch {};
                    }
                }

                if (comptime Environment.isLinux) {

                    // Bun.write(Bun.file("a"), Bun.file("b"))
                    if (os.S.ISREG(stat.mode) and (os.S.ISREG(this.destination_file_store.mode) or this.destination_file_store.mode == 0)) {
                        if (this.destination_file_store.is_atty orelse false) {
                            this.doCopyFileRange(.copy_file_range, true) catch {};
                        } else {
                            this.doCopyFileRange(.copy_file_range, false) catch {};
                        }

                        this.doClose();
                        return;
                    }

                    // $ bun run foo.js | bun run bar.js
                    if (os.S.ISFIFO(stat.mode) and os.S.ISFIFO(this.destination_file_store.mode)) {
                        if (this.destination_file_store.is_atty orelse false) {
                            this.doCopyFileRange(.splice, true) catch {};
                        } else {
                            this.doCopyFileRange(.splice, false) catch {};
                        }

                        this.doClose();
                        return;
                    }

                    if (os.S.ISREG(stat.mode) or os.S.ISCHR(stat.mode) or os.S.ISSOCK(stat.mode)) {
                        if (this.destination_file_store.is_atty orelse false) {
                            this.doCopyFileRange(.sendfile, true) catch {};
                        } else {
                            this.doCopyFileRange(.sendfile, false) catch {};
                        }

                        this.doClose();
                        return;
                    }

                    this.system_error = unsupported_non_regular_file_error;
                    this.doClose();
                    return;
                }

                if (comptime Environment.isMac) {
                    this.doFCopyFile() catch {
                        this.doClose();

                        return;
                    };
                    if (stat.size != 0 and @as(SizeType, @intCast(stat.size)) > this.max_length) {
                        _ = darwin.ftruncate(this.destination_fd, @as(std.os.off_t, @intCast(this.max_length)));
                    }

                    this.doClose();
                } else {
                    @compileError("TODO: implement copyfile");
                }
            }
        };
    };

    pub const FileStore = struct {
        pathlike: JSC.Node.PathOrFileDescriptor,
        mime_type: HTTPClient.MimeType = HTTPClient.MimeType.other,
        is_atty: ?bool = null,
        mode: JSC.Node.Mode = 0,
        seekable: ?bool = null,
        max_size: SizeType = Blob.max_size,
        // milliseconds since ECMAScript epoch
        last_modified: JSTimeType = init_timestamp,

        pub fn isSeekable(this: *const FileStore) ?bool {
            if (this.seekable) |seekable| {
                return seekable;
            }

            if (this.mode != 0) {
                return std.os.S.ISREG(this.mode);
            }

            return null;
        }

        pub fn init(pathlike: JSC.Node.PathOrFileDescriptor, mime_type: ?HTTPClient.MimeType) FileStore {
            return .{ .pathlike = pathlike, .mime_type = mime_type orelse HTTPClient.MimeType.other };
        }
    };

    pub const ByteStore = struct {
        ptr: [*]u8 = undefined,
        len: SizeType = 0,
        cap: SizeType = 0,
        allocator: std.mem.Allocator,

        /// Used by standalone module graph and the File constructor
        stored_name: bun.PathString = bun.PathString.empty,

        pub fn init(bytes: []u8, allocator: std.mem.Allocator) ByteStore {
            return .{
                .ptr = bytes.ptr,
                .len = @as(SizeType, @truncate(bytes.len)),
                .cap = @as(SizeType, @truncate(bytes.len)),
                .allocator = allocator,
            };
        }

        pub fn fromArrayList(list: std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator) !*ByteStore {
            return ByteStore.init(list.items, allocator);
        }

        pub fn slice(this: ByteStore) []u8 {
            return this.ptr[0..this.len];
        }

        pub fn deinit(this: *ByteStore) void {
            bun.default_allocator.free(this.stored_name.slice());
            this.allocator.free(this.ptr[0..this.cap]);
        }

        pub fn asArrayList(this: ByteStore) std.ArrayListUnmanaged(u8) {
            return this.asArrayListLeak();
        }

        pub fn asArrayListLeak(this: ByteStore) std.ArrayListUnmanaged(u8) {
            return .{
                .items = this.ptr[0..this.len],
                .capacity = this.cap,
            };
        }
    };

    pub fn getStream(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        var recommended_chunk_size: SizeType = 0;
        var arguments_ = callframe.arguments(2);
        var arguments = arguments_.ptr[0..arguments_.len];
        if (arguments.len > 0) {
            if (!arguments[0].isNumber() and !arguments[0].isUndefinedOrNull()) {
                globalThis.throwInvalidArguments("chunkSize must be a number", .{});
                return JSValue.jsUndefined();
            }

            recommended_chunk_size = @as(SizeType, @intCast(@max(0, @as(i52, @truncate(arguments[0].toInt64())))));
        }
        return JSC.WebCore.ReadableStream.fromBlob(
            globalThis,
            this,
            recommended_chunk_size,
        );
    }

    fn promisified(
        value: JSC.JSValue,
        global: *JSGlobalObject,
    ) JSC.JSValue {
        if (value.isError()) {
            return JSC.JSPromise.rejectedPromiseValue(global, value);
        }

        if (value.jsType() == .JSPromise)
            return value;

        return JSPromise.resolvedPromiseValue(
            global,
            value,
        );
    }

    pub fn getText(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        var store = this.store;
        if (store) |st| st.ref();
        defer if (store) |st| st.deref();
        return promisified(this.toString(globalThis, .clone), globalThis);
    }

    pub fn getTextTransfer(
        this: *Blob,
        globalObject: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        var store = this.store;
        if (store) |st| st.ref();
        defer if (store) |st| st.deref();
        return promisified(this.toString(globalObject, .transfer), globalObject);
    }

    pub fn getJSON(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        var store = this.store;
        if (store) |st| st.ref();
        defer if (store) |st| st.deref();

        return promisified(this.toJSON(globalThis, .share), globalThis);
    }

    pub fn getArrayBufferTransfer(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        var store = this.store;
        if (store) |st| st.ref();
        defer if (store) |st| st.deref();

        return promisified(this.toArrayBuffer(globalThis, .transfer), globalThis);
    }

    pub fn getArrayBuffer(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        var store = this.store;
        if (store) |st| st.ref();
        defer if (store) |st| st.deref();
        return promisified(this.toArrayBuffer(globalThis, .clone), globalThis);
    }

    pub fn getFormData(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        var store = this.store;
        if (store) |st| st.ref();
        defer if (store) |st| st.deref();

        return promisified(this.toFormData(globalThis, .temporary), globalThis);
    }

    fn getExistsSync(this: *Blob) JSC.JSValue {
        if (this.size == Blob.max_size) {
            this.resolveSize();
        }

        // If there's no store that means it's empty and we just return true
        // it will not error to return an empty Blob
        var store = this.store orelse return JSValue.jsBoolean(true);

        if (store.data == .bytes) {
            // Bytes will never error
            return JSValue.jsBoolean(true);
        }

        // We say regular files and pipes exist.
        // This is mostly meant for "Can we use this in new Response(file)?"
        return JSValue.jsBoolean(std.os.S.ISREG(store.data.file.mode) or std.os.S.ISFIFO(store.data.file.mode));
    }

    // This mostly means 'can it be read?'
    pub fn getExists(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        return JSC.JSPromise.resolvedPromiseValue(globalThis, this.getExistsSync());
    }

    pub fn getWriter(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        var arguments_ = callframe.arguments(1);
        var arguments = arguments_.ptr[0..arguments_.len];

        if (!arguments.ptr[0].isEmptyOrUndefinedOrNull() and !arguments.ptr[0].isObject()) {
            globalThis.throwInvalidArguments("options must be an object or undefined", .{});
            return JSValue.jsUndefined();
        }

        var store = this.store orelse {
            globalThis.throwInvalidArguments("Blob is detached", .{});
            return JSValue.jsUndefined();
        };

        if (store.data != .file) {
            globalThis.throwInvalidArguments("Blob is read-only", .{});
            return JSValue.jsUndefined();
        }

        var sink = JSC.WebCore.FileSink.init(globalThis.allocator(), null) catch |err| {
            globalThis.throwInvalidArguments("Failed to create FileSink: {s}", .{@errorName(err)});
            return JSValue.jsUndefined();
        };

        const input_path: JSC.WebCore.PathOrFileDescriptor = brk: {
            if (store.data.file.pathlike == .fd) {
                break :brk .{ .fd = store.data.file.pathlike.fd };
            } else {
                break :brk .{
                    .path = ZigString.Slice.fromUTF8NeverFree(
                        store.data.file.pathlike.path.slice(),
                    ).clone(
                        globalThis.allocator(),
                    ) catch unreachable,
                };
            }
        };
        defer input_path.deinit();

        var stream_start: JSC.WebCore.StreamStart = .{
            .FileSink = .{
                .input_path = input_path,
            },
        };

        if (arguments.len > 0 and arguments.ptr[0].isObject()) {
            stream_start = JSC.WebCore.StreamStart.fromJSWithTag(globalThis, arguments[0], .FileSink);
            stream_start.FileSink.input_path = input_path;
        }

        switch (sink.start(stream_start)) {
            .err => |err| {
                globalThis.vm().throwError(globalThis, err.toJSC(globalThis));
                sink.finalize();

                return JSC.JSValue.zero;
            },
            else => {},
        }

        return sink.toJS(globalThis);
    }

    /// https://w3c.github.io/FileAPI/#slice-method-algo
    /// The slice() method returns a new Blob object with bytes ranging from the
    /// optional start parameter up to but not including the optional end
    /// parameter, and with a type attribute that is the value of the optional
    /// contentType parameter. It must act as follows:
    pub fn getSlice(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        var allocator = globalThis.allocator();
        var arguments_ = callframe.arguments(3);
        var args = arguments_.ptr[0..arguments_.len];

        if (this.size == 0) {
            const empty = Blob.initEmpty(globalThis);
            var ptr = allocator.create(Blob) catch {
                return JSC.JSValue.jsUndefined();
            };
            ptr.* = empty;
            ptr.allocator = allocator;
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

        var args_iter = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), args);
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
                    var zig_str = content_type_.getZigString(globalThis);
                    var slicer = zig_str.toSlice(bun.default_allocator);
                    defer slicer.deinit();
                    var slice = slicer.slice();
                    if (!strings.isAllASCII(slice)) {
                        break :inner;
                    }

                    if (globalThis.bunVM().mimeType(slice)) |mime| {
                        content_type = mime.value;
                        break :inner;
                    }

                    content_type_was_allocated = slice.len > 0;
                    var content_type_buf = allocator.alloc(u8, slice.len) catch unreachable;
                    content_type = strings.copyLowercase(slice, content_type_buf);
                }
            }
        }

        const len = @as(SizeType, @intCast(@max(relativeEnd -| relativeStart, 0)));

        // This copies over the is_all_ascii flag
        // which is okay because this will only be a <= slice
        var blob = this.dupe();
        blob.offset = @as(SizeType, @intCast(relativeStart));
        blob.size = len;

        // infer the content type if it was not specified
        if (content_type.len == 0 and this.content_type.len > 0 and !this.content_type_allocated)
            content_type = this.content_type;

        blob.content_type = content_type;
        blob.content_type_allocated = content_type_was_allocated;
        blob.content_type_was_set = this.content_type_was_set or content_type_was_allocated;

        var blob_ = allocator.create(Blob) catch unreachable;
        blob_.* = blob;
        blob_.allocator = allocator;
        return blob_.toJS(globalThis);
    }

    pub fn getMimeType(this: *const Blob) ?bun.HTTP.MimeType {
        if (this.store) |store| {
            return store.mime_type;
        }

        return null;
    }

    pub fn getType(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.content_type.len > 0) {
            if (this.content_type_allocated) {
                return ZigString.init(this.content_type).toValueGC(globalThis);
            }
            return ZigString.init(this.content_type).toValueGC(globalThis);
        }

        if (this.store) |store| {
            return ZigString.init(store.mime_type.value).toValueGC(globalThis);
        }

        return ZigString.Empty.toValue(globalThis);
    }

    // TODO: Move this to a separate `File` object or BunFile
    pub fn getName(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.getFileName()) |path| {
            var str = bun.String.create(path);
            return str.toJS(globalThis);
        }

        return JSValue.undefined;
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
            }
        }

        return null;
    }

    // TODO: Move this to a separate `File` object or BunFile
    pub fn getLastModified(
        this: *Blob,
        _: *JSC.JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.store) |store| {
            if (store.data == .file) {
                // last_modified can be already set during read.
                if (store.data.file.last_modified == init_timestamp) {
                    resolveFileStat(store);
                }
                return JSValue.jsNumber(store.data.file.last_modified);
            }
        }

        if (this.is_jsdom_file) {
            return JSValue.jsNumber(this.last_modified);
        }

        return JSValue.jsNumber(init_timestamp);
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

    export fn Bun__Blob__getSizeForBindings(this: *Blob) callconv(.C) u64 {
        return this.getSizeForBindings();
    }

    comptime {
        if (!JSC.is_bindgen) {
            _ = Bun__Blob__getSizeForBindings;
        }
    }

    pub fn getSize(this: *Blob, _: *JSC.JSGlobalObject) callconv(.C) JSValue {
        if (this.size == Blob.max_size) {
            this.resolveSize();
            if (this.size == Blob.max_size and this.store != null) {
                return JSC.jsNumber(std.math.inf(f64));
            } else if (this.size == 0 and this.store != null) {
                if (this.store.?.data == .file and
                    (this.store.?.data.file.seekable orelse true) == false and
                    this.store.?.data.file.max_size == Blob.max_size)
                {
                    return JSC.jsNumber(std.math.inf(f64));
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

    fn toJSTime(sec: isize, nsec: isize) JSTimeType {
        const millisec = @as(u64, @intCast(@divTrunc(nsec, std.time.ns_per_ms)));
        return @as(JSTimeType, @truncate(@as(u64, @intCast(sec * std.time.ms_per_s)) + millisec));
    }

    /// resolve file stat like size, last_modified
    fn resolveFileStat(store: *Store) void {
        if (store.data.file.pathlike == .path) {
            var buffer: [bun.MAX_PATH_BYTES]u8 = undefined;
            switch (JSC.Node.Syscall.stat(store.data.file.pathlike.path.sliceZ(&buffer))) {
                .result => |stat| {
                    store.data.file.max_size = if (std.os.S.ISREG(stat.mode) or stat.size > 0)
                        @as(SizeType, @truncate(@as(u64, @intCast(@max(stat.size, 0)))))
                    else
                        Blob.max_size;
                    store.data.file.mode = stat.mode;
                    store.data.file.seekable = std.os.S.ISREG(stat.mode);
                    store.data.file.last_modified = toJSTime(stat.mtime().tv_sec, stat.mtime().tv_nsec);
                },
                // the file may not exist yet. Thats's okay.
                else => {},
            }
        } else if (store.data.file.pathlike == .fd) {
            switch (JSC.Node.Syscall.fstat(store.data.file.pathlike.fd)) {
                .result => |stat| {
                    store.data.file.max_size = if (std.os.S.ISREG(stat.mode) or stat.size > 0)
                        @as(SizeType, @truncate(@as(u64, @intCast(@max(stat.size, 0)))))
                    else
                        Blob.max_size;
                    store.data.file.mode = stat.mode;
                    store.data.file.seekable = std.os.S.ISREG(stat.mode);
                    store.data.file.last_modified = toJSTime(stat.mtime().tv_sec, stat.mtime().tv_nsec);
                },
                // the file may not exist yet. Thats's okay.
                else => {},
            }
        }
    }

    pub fn constructor(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) ?*Blob {
        var allocator = globalThis.allocator();
        var blob: Blob = undefined;
        var arguments = callframe.arguments(2);
        var args = arguments.ptr[0..arguments.len];

        switch (args.len) {
            0 => {
                var empty: []u8 = &[_]u8{};
                blob = Blob.init(empty, allocator, globalThis);
            },
            else => {
                blob = get(globalThis, args[0], false, true) catch |err| {
                    if (err == error.InvalidArguments) {
                        globalThis.throwInvalidArguments("new Blob() expects an Array", .{});
                        return null;
                    }
                    globalThis.throw("out of memory", .{});
                    return null;
                };

                if (args.len > 1) {
                    const options = args[1];
                    if (options.isObject()) {
                        // type, the ASCII-encoded string in lower case
                        // representing the media type of the Blob.
                        // Normative conditions for this member are provided
                        // in the § 3.1 Constructors.
                        if (options.get(globalThis, "type")) |content_type| {
                            inner: {
                                if (content_type.isString()) {
                                    var content_type_str = content_type.toSlice(globalThis, bun.default_allocator);
                                    defer content_type_str.deinit();
                                    var slice = content_type_str.slice();
                                    if (!strings.isAllASCII(slice)) {
                                        break :inner;
                                    }
                                    blob.content_type_was_set = true;

                                    if (globalThis.bunVM().mimeType(slice)) |mime| {
                                        blob.content_type = mime.value;
                                        break :inner;
                                    }
                                    var content_type_buf = allocator.alloc(u8, slice.len) catch unreachable;
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

        var blob_ = allocator.create(Blob) catch unreachable;
        blob_.* = blob;
        blob_.allocator = allocator;
        return blob_;
    }

    pub fn finalize(this: *Blob) callconv(.C) void {
        this.deinit();
    }

    pub fn initWithAllASCII(bytes: []u8, allocator: std.mem.Allocator, globalThis: *JSGlobalObject, is_all_ascii: bool) Blob {
        // avoid allocating a Blob.Store if the buffer is actually empty
        var store: ?*Blob.Store = null;
        if (bytes.len > 0) {
            store = Blob.Store.init(bytes, allocator) catch unreachable;
            store.?.is_all_ascii = is_all_ascii;
        }
        return Blob{
            .size = @as(SizeType, @truncate(bytes.len)),
            .store = store,
            .allocator = null,
            .content_type = "",
            .globalThis = globalThis,
            .is_all_ascii = is_all_ascii,
        };
    }

    pub fn init(bytes: []u8, allocator: std.mem.Allocator, globalThis: *JSGlobalObject) Blob {
        return Blob{
            .size = @as(SizeType, @truncate(bytes.len)),
            .store = if (bytes.len > 0)
                Blob.Store.init(bytes, allocator) catch unreachable
            else
                null,
            .allocator = null,
            .content_type = "",
            .globalThis = globalThis,
        };
    }

    pub fn create(
        bytes_: []const u8,
        allocator: std.mem.Allocator,
        globalThis: *JSGlobalObject,
        was_string: bool,
    ) Blob {
        var bytes = allocator.dupe(u8, bytes_) catch @panic("Out of memory");
        return Blob{
            .size = @as(SizeType, @truncate(bytes_.len)),
            .store = if (bytes.len > 0)
                Blob.Store.init(bytes, allocator) catch unreachable
            else
                null,
            .allocator = null,
            .content_type = if (was_string) MimeType.text.value else "",
            .globalThis = globalThis,
        };
    }

    pub fn initWithStore(store: *Blob.Store, globalThis: *JSGlobalObject) Blob {
        return Blob{
            .size = store.size(),
            .store = store,
            .allocator = null,
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
            .allocator = null,
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
        if (duped.content_type_allocated and duped.allocator != null and !include_content_type) {

            // for now, we just want to avoid a use-after-free here
            if (JSC.VirtualMachine.get().mimeType(duped.content_type)) |mime| {
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
        } else if (duped.content_type_allocated and duped.allocator != null and include_content_type) {
            duped.content_type = bun.default_allocator.dupe(u8, this.content_type) catch @panic("Out of memory");
        }

        duped.allocator = null;
        return duped;
    }

    pub fn deinit(this: *Blob) void {
        this.detach();

        if (this.allocator) |alloc| {
            this.allocator = null;
            alloc.destroy(this);
        }
    }

    pub fn sharedView(this: *const Blob) []const u8 {
        if (this.size == 0 or this.store == null) return "";
        var slice_ = this.store.?.sharedView();
        if (slice_.len == 0) return "";
        slice_ = slice_[this.offset..];

        return slice_[0..@min(slice_.len, @as(usize, this.size))];
    }

    pub const Lifetime = JSC.WebCore.Lifetime;
    pub fn setIsASCIIFlag(this: *Blob, is_all_ascii: bool) void {
        this.is_all_ascii = is_all_ascii;
        // if this Blob represents the entire binary data
        // which will be pretty common
        // we can update the store's is_all_ascii flag
        // and any other Blob that points to the same store
        // can skip checking the encoding
        if (this.size > 0 and this.offset == 0 and this.store.?.data == .bytes) {
            this.store.?.is_all_ascii = is_all_ascii;
        }
    }

    pub fn NewReadFileHandler(comptime Function: anytype) type {
        return struct {
            context: Blob,
            promise: JSPromise.Strong = .{},
            globalThis: *JSGlobalObject,
            pub fn run(handler: *@This(), bytes_: Blob.Store.ReadFile.ResultType) void {
                var promise = handler.promise.swap();
                var blob = handler.context;
                blob.allocator = null;
                var globalThis = handler.globalThis;
                bun.default_allocator.destroy(handler);
                switch (bytes_) {
                    .result => |result| {
                        const bytes = result.buf;
                        if (blob.size > 0)
                            blob.size = @min(@as(u32, @truncate(bytes.len)), blob.size);
                        const value = Function(&blob, globalThis, bytes, .temporary);

                        // invalid JSON needs to be rejected
                        if (value.isAnyError()) {
                            promise.reject(globalThis, value);
                        } else {
                            promise.resolve(globalThis, value);
                        }
                    },
                    .err => |err| {
                        promise.reject(globalThis, err.toErrorInstance(globalThis));
                    },
                }
            }
        };
    }

    pub const WriteFilePromise = struct {
        promise: JSPromise.Strong = .{},
        globalThis: *JSGlobalObject,
        pub fn run(handler: *@This(), count: Blob.Store.WriteFile.ResultType) void {
            var promise = handler.promise.swap();
            var globalThis = handler.globalThis;
            bun.default_allocator.destroy(handler);
            const value = promise.asValue(globalThis);
            value.ensureStillAlive();
            switch (count) {
                .err => |err| {
                    promise.reject(globalThis, err.toErrorInstance(globalThis));
                },
                .result => |wrote| {
                    promise.resolve(globalThis, JSC.JSValue.jsNumberFromUint64(wrote));
                },
            }
        }
    };

    pub fn NewInternalReadFileHandler(comptime Context: type, comptime Function: anytype) type {
        return struct {
            pub fn run(handler: *anyopaque, bytes_: Store.ReadFile.ResultType) void {
                Function(bun.cast(Context, handler), bytes_);
            }
        };
    }

    pub fn doReadFileInternal(this: *Blob, comptime Handler: type, ctx: Handler, comptime Function: anytype, global: *JSGlobalObject) void {
        var file_read = Store.ReadFile.createWithCtx(
            bun.default_allocator,
            this.store.?,
            ctx,
            NewInternalReadFileHandler(Handler, Function).run,
            this.offset,
            this.size,
        ) catch unreachable;
        var read_file_task = Store.ReadFile.ReadFileTask.createOnJSThread(bun.default_allocator, global, file_read) catch unreachable;
        read_file_task.schedule();
    }

    pub fn doReadFile(this: *Blob, comptime Function: anytype, global: *JSGlobalObject) JSValue {
        bloblog("doReadFile", .{});

        const Handler = NewReadFileHandler(Function);
        var handler = bun.default_allocator.create(Handler) catch unreachable;
        handler.* = Handler{
            .context = this.*,
            .globalThis = global,
        };

        var file_read = Store.ReadFile.create(
            bun.default_allocator,
            this.store.?,
            this.offset,
            this.size,
            *Handler,
            handler,
            Handler.run,
        ) catch unreachable;
        var read_file_task = Store.ReadFile.ReadFileTask.createOnJSThread(bun.default_allocator, global, file_read) catch unreachable;

        // Create the Promise only after the store has been ref()'d.
        // The garbage collector runs on memory allocations
        // The JSPromise is the next GC'd memory allocation.
        // This shouldn't really fix anything, but it's a little safer.
        var promise = JSPromise.create(global);
        const promise_value = promise.asValue(global);
        promise_value.ensureStillAlive();
        handler.promise.strong.set(global, promise_value);

        read_file_task.schedule();

        bloblog("doReadFile: read_file_task scheduled", .{});
        return promise_value;
    }

    pub fn needsToReadFile(this: *const Blob) bool {
        return this.store != null and this.store.?.data == .file;
    }

    pub fn toStringWithBytes(this: *Blob, global: *JSGlobalObject, buf: []const u8, comptime lifetime: Lifetime) JSValue {
        // null == unknown
        // false == can't be
        const could_be_all_ascii = this.is_all_ascii orelse this.store.?.is_all_ascii;

        if (could_be_all_ascii == null or !could_be_all_ascii.?) {
            // if toUTF16Alloc returns null, it means there are no non-ASCII characters
            // instead of erroring, invalid characters will become a U+FFFD replacement character
            if (strings.toUTF16Alloc(bun.default_allocator, buf, false) catch unreachable) |external| {
                if (lifetime != .temporary)
                    this.setIsASCIIFlag(false);

                if (lifetime == .transfer) {
                    this.detach();
                }

                if (lifetime == .temporary) {
                    bun.default_allocator.free(bun.constStrToU8(buf));
                }

                return ZigString.toExternalU16(external.ptr, external.len, global);
            }

            if (lifetime != .temporary) this.setIsASCIIFlag(true);
        }

        if (buf.len == 0) {
            return ZigString.Empty.toValue(global);
        }

        switch (comptime lifetime) {
            // strings are immutable
            // we don't need to clone
            .clone => {
                this.store.?.ref();
                return ZigString.init(buf).external(global, this.store.?, Store.external);
            },
            .transfer => {
                var store = this.store.?;
                std.debug.assert(store.data == .bytes);
                this.transfer();
                return ZigString.init(buf).external(global, store, Store.external);
            },
            // strings are immutable
            // sharing isn't really a thing
            .share => {
                this.store.?.ref();
                return ZigString.init(buf).external(global, this.store.?, Store.external);
            },
            .temporary => {
                return ZigString.init(buf).toExternalValue(global);
            },
        }
    }

    pub fn toString(this: *Blob, global: *JSGlobalObject, comptime lifetime: Lifetime) JSValue {
        if (this.needsToReadFile()) {
            return this.doReadFile(toStringWithBytes, global);
        }

        const view_: []u8 =
            bun.constStrToU8(this.sharedView());

        if (view_.len == 0)
            return ZigString.Empty.toValue(global);

        return toStringWithBytes(this, global, view_, lifetime);
    }

    pub fn toJSON(this: *Blob, global: *JSGlobalObject, comptime lifetime: Lifetime) JSValue {
        if (this.needsToReadFile()) {
            return this.doReadFile(toJSONWithBytes, global);
        }

        var view_ = this.sharedView();

        return toJSONWithBytes(this, global, view_, lifetime);
    }

    pub fn toJSONWithBytes(this: *Blob, global: *JSGlobalObject, buf: []const u8, comptime lifetime: Lifetime) JSValue {
        if (buf.len == 0) return global.createSyntaxErrorInstance("Unexpected end of JSON input", .{});
        // null == unknown
        // false == can't be
        const could_be_all_ascii = this.is_all_ascii orelse this.store.?.is_all_ascii;
        defer if (comptime lifetime == .temporary) bun.default_allocator.free(bun.constStrToU8(buf));

        if (could_be_all_ascii == null or !could_be_all_ascii.?) {
            var stack_fallback = std.heap.stackFallback(4096, bun.default_allocator);
            const allocator = stack_fallback.get();
            // if toUTF16Alloc returns null, it means there are no non-ASCII characters
            if (strings.toUTF16Alloc(allocator, buf, false) catch null) |external| {
                if (comptime lifetime != .temporary) this.setIsASCIIFlag(false);
                const result = ZigString.init16(external).toJSONObject(global);
                allocator.free(external);
                return result;
            }

            if (comptime lifetime != .temporary) this.setIsASCIIFlag(true);
        }

        if (comptime lifetime == .temporary) {
            return ZigString.init(buf).toJSONObject(global);
        } else {
            return ZigString.init(buf).toJSONObject(global);
        }
    }

    pub fn toFormDataWithBytes(this: *Blob, global: *JSGlobalObject, buf: []u8, comptime _: Lifetime) JSValue {
        var encoder = this.getFormDataEncoding() orelse return {
            return ZigString.init("Invalid encoding").toErrorInstance(global);
        };
        defer encoder.deinit();

        return bun.FormData.toJS(global, buf, encoder.encoding) catch |err|
            global.createErrorInstance("FormData encoding failed: {s}", .{@errorName(err)});
    }

    pub fn toArrayBufferWithBytes(this: *Blob, global: *JSGlobalObject, buf: []u8, comptime lifetime: Lifetime) JSValue {
        switch (comptime lifetime) {
            .clone => {
                return JSC.ArrayBuffer.create(global, buf, .ArrayBuffer);
            },
            .share => {
                this.store.?.ref();
                return JSC.ArrayBuffer.fromBytes(buf, .ArrayBuffer).toJSWithContext(
                    global,
                    this.store.?,
                    JSC.BlobArrayBuffer_deallocator,
                    null,
                );
            },
            .transfer => {
                var store = this.store.?;
                this.transfer();
                return JSC.ArrayBuffer.fromBytes(buf, .ArrayBuffer).toJSWithContext(
                    global,
                    store,
                    JSC.BlobArrayBuffer_deallocator,
                    null,
                );
            },
            .temporary => {
                return JSC.ArrayBuffer.fromBytes(buf, .ArrayBuffer).toJS(
                    global,
                    null,
                );
            },
        }
    }

    pub fn toArrayBuffer(this: *Blob, global: *JSGlobalObject, comptime lifetime: Lifetime) JSValue {
        bloblog("toArrayBuffer", .{});
        if (this.needsToReadFile()) {
            return this.doReadFile(toArrayBufferWithBytes, global);
        }

        var view_ = this.sharedView();
        if (view_.len == 0)
            return JSC.ArrayBuffer.create(global, "", .ArrayBuffer);

        return toArrayBufferWithBytes(this, global, bun.constStrToU8(view_), lifetime);
    }

    pub fn toFormData(this: *Blob, global: *JSGlobalObject, comptime lifetime: Lifetime) JSValue {
        if (this.needsToReadFile()) {
            return this.doReadFile(toFormDataWithBytes, global);
        }

        var view_ = this.sharedView();

        if (view_.len == 0)
            return JSC.DOMFormData.create(global);

        return toFormDataWithBytes(this, global, bun.constStrToU8(view_), lifetime);
    }

    pub inline fn get(
        global: *JSGlobalObject,
        arg: JSValue,
        comptime move: bool,
        comptime require_array: bool,
    ) anyerror!Blob {
        return fromJSMovable(global, arg, move, require_array);
    }

    pub inline fn fromJSMove(global: *JSGlobalObject, arg: JSValue) anyerror!Blob {
        return fromJSWithoutDeferGC(global, arg, true, false);
    }

    pub inline fn fromJSClone(global: *JSGlobalObject, arg: JSValue) anyerror!Blob {
        return fromJSWithoutDeferGC(global, arg, false, true);
    }

    pub inline fn fromJSCloneOptionalArray(global: *JSGlobalObject, arg: JSValue) anyerror!Blob {
        return fromJSWithoutDeferGC(global, arg, false, false);
    }

    fn fromJSMovable(
        global: *JSGlobalObject,
        arg: JSValue,
        comptime move: bool,
        comptime require_array: bool,
    ) anyerror!Blob {
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
    ) anyerror!Blob {
        var current = arg;
        if (current.isUndefinedOrNull()) {
            return Blob{ .globalThis = global };
        }

        var top_value = current;
        var might_only_be_one_thing = false;
        arg.ensureStillAlive();
        defer arg.ensureStillAlive();
        switch (current.jsTypeLoose()) {
            .Array, .DerivedArray => {
                var top_iter = JSC.JSArrayIterator.init(current, global);
                might_only_be_one_thing = top_iter.len == 1;
                if (top_iter.len == 0) {
                    return Blob{ .globalThis = global };
                }
                if (might_only_be_one_thing) {
                    top_value = top_iter.next().?;
                }
            },
            else => {
                might_only_be_one_thing = true;
                if (require_array) {
                    return error.InvalidArguments;
                }
            },
        }

        if (might_only_be_one_thing or !move) {

            // Fast path: one item, we don't need to join
            switch (top_value.jsTypeLoose()) {
                .Cell,
                .NumberObject,
                JSC.JSValue.JSType.String,
                JSC.JSValue.JSType.StringObject,
                JSC.JSValue.JSType.DerivedStringObject,
                => {
                    var sliced = top_value.toSlice(global, bun.default_allocator);
                    const is_all_ascii = !sliced.isAllocated();
                    if (!sliced.isAllocated() and sliced.len > 0) {
                        sliced.ptr = @as([*]const u8, @ptrCast((try bun.default_allocator.dupe(u8, sliced.slice())).ptr));
                        sliced.allocator = NullableAllocator.init(bun.default_allocator);
                    }

                    return Blob.initWithAllASCII(bun.constStrToU8(sliced.slice()), bun.default_allocator, global, is_all_ascii);
                },

                JSC.JSValue.JSType.ArrayBuffer,
                JSC.JSValue.JSType.Int8Array,
                JSC.JSValue.JSType.Uint8Array,
                JSC.JSValue.JSType.Uint8ClampedArray,
                JSC.JSValue.JSType.Int16Array,
                JSC.JSValue.JSType.Uint16Array,
                JSC.JSValue.JSType.Int32Array,
                JSC.JSValue.JSType.Uint32Array,
                JSC.JSValue.JSType.Float32Array,
                JSC.JSValue.JSType.Float64Array,
                JSC.JSValue.JSType.BigInt64Array,
                JSC.JSValue.JSType.BigUint64Array,
                JSC.JSValue.JSType.DataView,
                => {
                    var buf = try bun.default_allocator.dupe(u8, top_value.asArrayBuffer(global).?.byteSlice());

                    return Blob.init(buf, bun.default_allocator, global);
                },

                .DOMWrapper => {
                    if (top_value.as(Blob)) |blob| {
                        if (comptime move) {
                            var _blob = blob.*;
                            _blob.allocator = null;
                            blob.transfer();
                            return _blob;
                        } else {
                            return blob.dupe();
                        }
                    } else if (top_value.as(JSC.API.BuildArtifact)) |build| {
                        if (comptime move) {
                            // I don't think this case should happen?
                            var blob = build.blob;
                            blob.transfer();
                            return blob;
                        } else {
                            return build.blob.dupe();
                        }
                    } else if (current.toSliceClone(global)) |sliced| {
                        if (sliced.allocator.get()) |allocator| {
                            return Blob.initWithAllASCII(bun.constStrToU8(sliced.slice()), allocator, global, false);
                        }
                    }
                },

                else => {},
            }
        }

        var stack_allocator = std.heap.stackFallback(1024, bun.default_allocator);
        var stack_mem_all = stack_allocator.get();
        var stack: std.ArrayList(JSValue) = std.ArrayList(JSValue).init(stack_mem_all);
        var joiner = StringJoiner{ .use_pool = false, .node_allocator = stack_mem_all };
        var could_have_non_ascii = false;

        defer if (stack_allocator.fixed_buffer_allocator.end_index >= 1024) stack.deinit();

        while (true) {
            switch (current.jsTypeLoose()) {
                .NumberObject,
                JSC.JSValue.JSType.String,
                JSC.JSValue.JSType.StringObject,
                JSC.JSValue.JSType.DerivedStringObject,
                => {
                    var sliced = current.toSlice(global, bun.default_allocator);
                    const allocator = sliced.allocator.get();
                    could_have_non_ascii = could_have_non_ascii or allocator != null;
                    joiner.append(
                        sliced.slice(),
                        0,
                        allocator,
                    );
                },

                .Array, .DerivedArray => {
                    var iter = JSC.JSArrayIterator.init(current, global);
                    try stack.ensureUnusedCapacity(iter.len);
                    var any_arrays = false;
                    while (iter.next()) |item| {
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
                                JSC.JSValue.JSType.String,
                                JSC.JSValue.JSType.StringObject,
                                JSC.JSValue.JSType.DerivedStringObject,
                                => {
                                    var sliced = item.toSlice(global, bun.default_allocator);
                                    const allocator = sliced.allocator.get();
                                    could_have_non_ascii = could_have_non_ascii or allocator != null;
                                    joiner.append(
                                        sliced.slice(),
                                        0,
                                        allocator,
                                    );
                                    continue;
                                },
                                JSC.JSValue.JSType.ArrayBuffer,
                                JSC.JSValue.JSType.Int8Array,
                                JSC.JSValue.JSType.Uint8Array,
                                JSC.JSValue.JSType.Uint8ClampedArray,
                                JSC.JSValue.JSType.Int16Array,
                                JSC.JSValue.JSType.Uint16Array,
                                JSC.JSValue.JSType.Int32Array,
                                JSC.JSValue.JSType.Uint32Array,
                                JSC.JSValue.JSType.Float32Array,
                                JSC.JSValue.JSType.Float64Array,
                                JSC.JSValue.JSType.BigInt64Array,
                                JSC.JSValue.JSType.BigUint64Array,
                                JSC.JSValue.JSType.DataView,
                                => {
                                    could_have_non_ascii = true;
                                    var buf = item.asArrayBuffer(global).?;
                                    joiner.append(buf.byteSlice(), 0, null);
                                    continue;
                                },
                                .Array, .DerivedArray => {
                                    any_arrays = true;
                                    could_have_non_ascii = true;
                                    break;
                                },

                                .DOMWrapper => {
                                    if (item.as(Blob)) |blob| {
                                        could_have_non_ascii = could_have_non_ascii or !(blob.is_all_ascii orelse false);
                                        joiner.append(blob.sharedView(), 0, null);
                                        continue;
                                    } else if (current.toSliceClone(global)) |sliced| {
                                        const allocator = sliced.allocator.get();
                                        could_have_non_ascii = could_have_non_ascii or allocator != null;
                                        joiner.append(
                                            sliced.slice(),
                                            0,
                                            allocator,
                                        );
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
                        could_have_non_ascii = could_have_non_ascii or !(blob.is_all_ascii orelse false);
                        joiner.append(blob.sharedView(), 0, null);
                    } else if (current.toSliceClone(global)) |sliced| {
                        const allocator = sliced.allocator.get();
                        could_have_non_ascii = could_have_non_ascii or allocator != null;
                        joiner.append(
                            sliced.slice(),
                            0,
                            allocator,
                        );
                    }
                },

                JSC.JSValue.JSType.ArrayBuffer,
                JSC.JSValue.JSType.Int8Array,
                JSC.JSValue.JSType.Uint8Array,
                JSC.JSValue.JSType.Uint8ClampedArray,
                JSC.JSValue.JSType.Int16Array,
                JSC.JSValue.JSType.Uint16Array,
                JSC.JSValue.JSType.Int32Array,
                JSC.JSValue.JSType.Uint32Array,
                JSC.JSValue.JSType.Float32Array,
                JSC.JSValue.JSType.Float64Array,
                JSC.JSValue.JSType.BigInt64Array,
                JSC.JSValue.JSType.BigUint64Array,
                JSC.JSValue.JSType.DataView,
                => {
                    var buf = current.asArrayBuffer(global).?;
                    joiner.append(buf.slice(), 0, null);
                    could_have_non_ascii = true;
                },

                else => {
                    var sliced = current.toSlice(global, bun.default_allocator);
                    const allocator = sliced.allocator.get();
                    could_have_non_ascii = could_have_non_ascii or allocator != null;
                    joiner.append(
                        sliced.slice(),
                        0,
                        allocator,
                    );
                },
            }
            current = stack.popOrNull() orelse break;
        }

        var joined = try joiner.done(bun.default_allocator);

        if (!could_have_non_ascii) {
            return Blob.initWithAllASCII(joined, bun.default_allocator, global, true);
        }
        return Blob.init(joined, bun.default_allocator, global);
    }
};

pub const AnyBlob = union(enum) {
    Blob: Blob,
    // InlineBlob: InlineBlob,
    InternalBlob: InternalBlob,
    WTFStringImpl: bun.WTF.StringImpl,

    pub fn getFileName(this: *const AnyBlob) ?[]const u8 {
        return switch (this.*) {
            .Blob => this.Blob.getFileName(),
            .WTFStringImpl => null,
            .InternalBlob => null,
        };
    }

    pub inline fn fastSize(this: *const AnyBlob) Blob.SizeType {
        return switch (this.*) {
            .Blob => this.Blob.size,
            .WTFStringImpl => @as(Blob.SizeType, @truncate(this.WTFStringImpl.byteLength())),
            else => @as(Blob.SizeType, @truncate(this.slice().len)),
        };
    }

    pub fn hasContentTypeFromUser(this: AnyBlob) bool {
        return switch (this) {
            .Blob => this.Blob.hasContentTypeFromUser(),
            .WTFStringImpl => false,
            .InternalBlob => false,
        };
    }

    pub fn toJSON(this: *AnyBlob, global: *JSGlobalObject, comptime lifetime: JSC.WebCore.Lifetime) JSValue {
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

                return str.toJSForParseJSON(global);
            },
        }
    }

    pub fn toString(this: *AnyBlob, global: *JSGlobalObject, comptime lifetime: JSC.WebCore.Lifetime) JSValue {
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
                    return ZigString.Empty.toValue(global);
                }

                const owned = this.InternalBlob.toStringOwned(global);
                this.* = .{ .Blob = .{} };
                return owned;
            },
            .WTFStringImpl => {
                var str = bun.String.init(this.WTFStringImpl);
                defer str.deref();
                this.* = .{ .Blob = .{} };

                return str.toJS(global);
            },
        }
    }

    pub fn toArrayBuffer(this: *AnyBlob, global: *JSGlobalObject, comptime lifetime: JSC.WebCore.Lifetime) JSValue {
        switch (this.*) {
            .Blob => return this.Blob.toArrayBuffer(global, lifetime),
            // .InlineBlob => {
            //     if (this.InlineBlob.len == 0) {
            //         return JSC.ArrayBuffer.create(global, "", .ArrayBuffer);
            //     }
            //     var bytes = this.InlineBlob.sliceConst();
            //     this.InlineBlob.len = 0;
            //     const value = JSC.ArrayBuffer.create(
            //         global,
            //         bytes,
            //         .ArrayBuffer,
            //     );
            //     return value;
            // },
            .InternalBlob => {
                if (this.InternalBlob.bytes.items.len == 0) {
                    return JSC.ArrayBuffer.create(global, "", .ArrayBuffer);
                }

                var bytes = this.InternalBlob.toOwnedSlice();
                this.* = .{ .Blob = .{} };
                const value = JSC.ArrayBuffer.fromBytes(
                    bytes,
                    .ArrayBuffer,
                );
                return value.toJS(global, null);
            },
            .WTFStringImpl => {
                const str = bun.String.init(this.WTFStringImpl);
                this.* = .{ .Blob = .{} };
                defer str.deref();

                const out_bytes = str.toUTF8WithoutRef(bun.default_allocator);
                if (out_bytes.isAllocated()) {
                    const value = JSC.ArrayBuffer.fromBytes(
                        @constCast(out_bytes.slice()),
                        .ArrayBuffer,
                    );
                    return value.toJS(global, null);
                }

                return JSC.ArrayBuffer.create(global, out_bytes.slice(), .ArrayBuffer);
            },
        }
    }

    pub inline fn size(this: *const AnyBlob) Blob.SizeType {
        return switch (this.*) {
            .Blob => this.Blob.size,
            .WTFStringImpl => @as(Blob.SizeType, @truncate(this.WTFStringImpl.utf8ByteLength())),
            else => @as(Blob.SizeType, @truncate(this.slice().len)),
        };
    }

    pub fn from(this: *AnyBlob, list: std.ArrayList(u8)) void {
        this.* = .{
            .InternalBlob = InternalBlob{
                .bytes = list,
            },
        };
    }

    pub fn isDetached(this: *const AnyBlob) bool {
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
            .Blob => self.Blob.is_all_ascii orelse false,
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
                self.* = .{
                    .Blob = .{},
                };
            },
            .WTFStringImpl => {
                self.WTFStringImpl.deref();
                self.* = .{
                    .Blob = .{},
                };
            },
        };
    }
};

/// A single-use Blob
pub const InternalBlob = struct {
    bytes: std.ArrayList(u8),
    was_string: bool = false,

    pub fn toStringOwned(this: *@This(), globalThis: *JSC.JSGlobalObject) JSValue {
        if (strings.toUTF16Alloc(globalThis.allocator(), this.bytes.items, false) catch &[_]u16{}) |out| {
            const return_value = ZigString.toExternalU16(out.ptr, out.len, globalThis);
            return_value.ensureStillAlive();
            this.deinit();
            return return_value;
        } else {
            var str = ZigString.init(this.toOwnedSlice());
            str.mark();
            return str.toExternalValue(globalThis);
        }
    }

    pub fn toJSON(this: *@This(), globalThis: *JSC.JSGlobalObject) JSValue {
        const str_bytes = ZigString.init(this.bytes.items).withEncoding();
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
        var bytes = this.bytes.items;
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
pub const InlineBlob = extern struct {
    const real_blob_size = @sizeOf(Blob);
    pub const IntSize = u8;
    pub const available_bytes = real_blob_size - @sizeOf(IntSize) - 1 - 1;
    bytes: [available_bytes]u8 align(1) = undefined,
    len: IntSize align(1) = 0,
    was_string: bool align(1) = false,

    pub fn concat(first: []const u8, second: []const u8) InlineBlob {
        const total = first.len + second.len;
        std.debug.assert(total <= available_bytes);

        var inline_blob: JSC.WebCore.InlineBlob = .{};
        var bytes_slice = inline_blob.bytes[0..total];

        if (first.len > 0)
            @memcpy(bytes_slice[0..first.len], first);

        if (second.len > 0)
            @memcpy(bytes_slice[first.len..][0..second.len], second);

        inline_blob.len = @as(@TypeOf(inline_blob.len), @truncate(total));
        return inline_blob;
    }

    fn internalInit(data: []const u8, was_string: bool) InlineBlob {
        std.debug.assert(data.len <= available_bytes);

        var blob = InlineBlob{
            .len = @as(IntSize, @intCast(data.len)),
            .was_string = was_string,
        };

        if (data.len > 0)
            @memcpy(blob.bytes[0..data.len], data);
        return blob;
    }

    pub fn init(data: []const u8) InlineBlob {
        return internalInit(data, false);
    }

    pub fn initString(data: []const u8) InlineBlob {
        return internalInit(data, true);
    }

    pub fn toStringOwned(this: *@This(), globalThis: *JSC.JSGlobalObject) JSValue {
        if (this.len == 0)
            return ZigString.Empty.toValue(globalThis);

        var str = ZigString.init(this.sliceConst());

        if (!strings.isAllASCII(this.sliceConst())) {
            str.markUTF8();
        }

        const out = str.toValueGC(globalThis);
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
