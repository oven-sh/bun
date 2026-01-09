const Archive = @This();

pub const js = jsc.Codegen.JSArchive;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

/// The underlying data for the archive - uses Blob.Store for thread-safe ref counting
store: *jsc.WebCore.Blob.Store,

pub fn finalize(this: *Archive) void {
    jsc.markBinding(@src());
    this.store.deref();
    bun.destroy(this);
}

/// Pretty-print for console.log
pub fn writeFormat(this: *const Archive, comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
    const Writer = @TypeOf(writer);
    const Output = bun.Output;
    const data = this.store.sharedView();

    try writer.print(comptime Output.prettyFmt("Archive ({f}) {{\n", enable_ansi_colors), .{bun.fmt.size(data.len, .{})});

    {
        formatter.indent += 1;
        defer formatter.indent -|= 1;

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll(comptime Output.prettyFmt("<r>files<d>:<r> ", enable_ansi_colors));
        try formatter.printAs(.Double, Writer, writer, jsc.JSValue.jsNumber(countFilesInArchive(data)), .NumberObject, enable_ansi_colors);
    }
    try writer.writeAll("\n");
    try formatter.writeIndent(Writer, writer);
    try writer.writeAll("}");
    formatter.resetLine();
}

/// Configure archive for reading tar/tar.gz
fn configureArchiveReader(archive: *libarchive.lib.Archive) void {
    _ = archive.readSupportFormatTar();
    _ = archive.readSupportFormatGnutar();
    _ = archive.readSupportFilterGzip();
    _ = archive.readSetOptions("read_concatenated_archives");
}

/// Count the number of files in an archive
fn countFilesInArchive(data: []const u8) u32 {
    const archive = libarchive.lib.Archive.readNew();
    defer _ = archive.readFree();
    configureArchiveReader(archive);

    if (archive.readOpenMemory(data) != .ok) {
        return 0;
    }

    var count: u32 = 0;
    var entry: *libarchive.lib.Archive.Entry = undefined;
    while (archive.readNextHeader(&entry) == .ok) {
        if (entry.filetype() == @intFromEnum(libarchive.lib.FileType.regular)) {
            count += 1;
        }
    }

    return count;
}

/// Constructor: new Archive() - throws an error since users should use Archive.from()
pub fn constructor(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!*Archive {
    return globalThis.throwInvalidArguments("Archive cannot be constructed directly. Use Archive.from() instead.", .{});
}

/// Static method: Archive.from(data)
/// Creates an Archive from either:
/// - An object { [path: string]: Blob | string | ArrayBufferView | ArrayBufferLike }
/// - A Blob, ArrayBufferView, or ArrayBufferLike (assumes it's already a valid archive)
pub fn from(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arg = callframe.argumentsAsArray(1)[0];
    if (arg == .zero) {
        return globalThis.throwInvalidArguments("Archive.from requires an argument", .{});
    }

    // For Blob/Archive, ref the existing store (zero-copy)
    if (arg.as(jsc.WebCore.Blob)) |blob_ptr| {
        if (blob_ptr.store) |store| {
            store.ref();
            return bun.new(Archive, .{ .store = store }).toJS(globalThis);
        }
    }

    // For ArrayBuffer/TypedArray, copy the data
    if (arg.asArrayBuffer(globalThis)) |array_buffer| {
        const data = try bun.default_allocator.dupe(u8, array_buffer.slice());
        return createArchive(globalThis, data);
    }

    // For plain objects, build a tarball
    if (arg.isObject()) {
        const data = try buildTarballFromObject(globalThis, arg);
        return createArchive(globalThis, data);
    }

    return globalThis.throwInvalidArguments("Expected an object, Blob, TypedArray, or ArrayBuffer", .{});
}

fn createArchive(globalThis: *jsc.JSGlobalObject, data: []u8) jsc.JSValue {
    const store = jsc.WebCore.Blob.Store.init(data, bun.default_allocator);
    return bun.new(Archive, .{ .store = store }).toJS(globalThis);
}

/// Shared helper that builds tarball bytes from a JS object
fn buildTarballFromObject(globalThis: *jsc.JSGlobalObject, obj: jsc.JSValue) bun.JSError![]u8 {
    const allocator = bun.default_allocator;
    const lib = libarchive.lib;

    const js_obj = obj.getObject() orelse {
        return globalThis.throwInvalidArguments("Expected an object", .{});
    };

    // Set up archive first
    var growing_buffer = lib.GrowingBuffer.init(allocator);
    errdefer growing_buffer.deinit();

    const archive = lib.Archive.writeNew();
    defer _ = archive.writeFree();

    if (archive.writeSetFormatPaxRestricted() != .ok) {
        return globalThis.throwInvalidArguments("Failed to create tarball: ArchiveFormatError", .{});
    }

    if (lib.archive_write_open2(
        @ptrCast(archive),
        @ptrCast(&growing_buffer),
        &lib.GrowingBuffer.openCallback,
        &lib.GrowingBuffer.writeCallback,
        &lib.GrowingBuffer.closeCallback,
        null,
    ) != 0) {
        return globalThis.throwInvalidArguments("Failed to create tarball: ArchiveOpenError", .{});
    }

    const entry = lib.Archive.Entry.new();
    defer entry.free();

    const now_secs: isize = @intCast(@divTrunc(std.time.milliTimestamp(), 1000));

    // Iterate over object properties and write directly to archive
    const PropIterator = jsc.JSPropertyIterator(.{
        .skip_empty_name = true,
        .include_value = true,
    });

    var iter = try PropIterator.init(globalThis, js_obj);
    defer iter.deinit();

    while (try iter.next()) |key| {
        const value = iter.value;
        if (value == .zero) continue;

        // Get the key as a null-terminated string
        const key_slice = key.toUTF8(allocator);
        defer key_slice.deinit();
        const key_str = try allocator.dupeZ(u8, key_slice.slice());
        defer allocator.free(key_str);

        // Get data - use view for Blob/ArrayBuffer, convert for strings
        const data_slice = try getEntryData(globalThis, value, allocator);
        defer data_slice.deinit();

        // Write entry to archive
        const data = data_slice.slice();
        _ = entry.clear();
        entry.setPathnameUtf8(key_str);
        entry.setSize(@intCast(data.len));
        entry.setFiletype(@intFromEnum(lib.FileType.regular));
        entry.setPerm(0o644);
        entry.setMtime(now_secs, 0);

        if (archive.writeHeader(entry) != .ok) {
            return globalThis.throwInvalidArguments("Failed to create tarball: ArchiveHeaderError", .{});
        }
        if (archive.writeData(data) < 0) {
            return globalThis.throwInvalidArguments("Failed to create tarball: ArchiveWriteError", .{});
        }
        if (archive.writeFinishEntry() != .ok) {
            return globalThis.throwInvalidArguments("Failed to create tarball: ArchiveFinishEntryError", .{});
        }
    }

    if (archive.writeClose() != .ok) {
        return globalThis.throwInvalidArguments("Failed to create tarball: ArchiveCloseError", .{});
    }

    return growing_buffer.toOwnedSlice() catch {
        return globalThis.throwInvalidArguments("Failed to create tarball: OutOfMemory", .{});
    };
}

/// Returns data as a ZigString.Slice (handles ownership automatically via deinit)
fn getEntryData(globalThis: *jsc.JSGlobalObject, value: jsc.JSValue, allocator: std.mem.Allocator) bun.JSError!jsc.ZigString.Slice {
    // For Blob, use sharedView (no copy needed)
    if (value.as(jsc.WebCore.Blob)) |blob_ptr| {
        return jsc.ZigString.Slice.fromUTF8NeverFree(blob_ptr.sharedView());
    }

    // For ArrayBuffer/TypedArray, use view (no copy needed)
    if (value.asArrayBuffer(globalThis)) |array_buffer| {
        return jsc.ZigString.Slice.fromUTF8NeverFree(array_buffer.slice());
    }

    // For strings, convert (allocates)
    return value.toSlice(globalThis, allocator);
}

/// Static method: Archive.write(path, data, compress?)
/// Creates and writes an archive to disk in one operation
pub fn write(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const path_arg, const data_arg, const compress_arg = callframe.argumentsAsArray(3);
    if (data_arg == .zero) {
        return globalThis.throwInvalidArguments("Archive.write requires at least 2 arguments (path, data)", .{});
    }

    // Get the path
    if (!path_arg.isString()) {
        return globalThis.throwInvalidArguments("Archive.write: first argument must be a string path", .{});
    }

    const path_slice = try path_arg.toSlice(globalThis, bun.default_allocator);
    defer path_slice.deinit();

    // Determine compression
    const use_gzip = try parseCompressArg(globalThis, compress_arg);

    // Try to use store reference (zero-copy) for Archive/Blob
    if (fromJS(data_arg)) |archive| {
        return startWriteTask(globalThis, .{ .store = archive.store }, path_slice.slice(), use_gzip);
    }

    if (data_arg.as(jsc.WebCore.Blob)) |blob_ptr| {
        if (blob_ptr.store) |store| {
            return startWriteTask(globalThis, .{ .store = store }, path_slice.slice(), use_gzip);
        }
    }

    // Fall back to copying data for ArrayBuffer/TypedArray/objects
    const archive_data = try getArchiveData(globalThis, data_arg);
    return startWriteTask(globalThis, .{ .owned = archive_data }, path_slice.slice(), use_gzip);
}

/// Get archive data from a value, returning owned bytes
fn getArchiveData(globalThis: *jsc.JSGlobalObject, arg: jsc.JSValue) bun.JSError![]u8 {
    // Check if it's a typed array, ArrayBuffer, or similar
    if (arg.asArrayBuffer(globalThis)) |array_buffer| {
        return bun.default_allocator.dupe(u8, array_buffer.slice());
    }

    // Check if it's an object with entries (plain object) - build tarball
    if (arg.isObject()) {
        return buildTarballFromObject(globalThis, arg);
    }

    return globalThis.throwInvalidArguments("Expected an object, Blob, TypedArray, ArrayBuffer, or Archive", .{});
}

fn parseCompressArg(globalThis: *jsc.JSGlobalObject, arg: jsc.JSValue) bun.JSError!bool {
    if (arg.isUndefinedOrNull()) {
        return false;
    }

    if (arg.isBoolean()) {
        return arg.toBoolean();
    }

    if (arg.isString()) {
        const str = try arg.toSlice(globalThis, bun.default_allocator);
        defer str.deinit();
        if (std.mem.eql(u8, str.slice(), "gzip")) {
            return true;
        }
        return globalThis.throwInvalidArguments("Archive: compress argument must be 'gzip', a boolean, or undefined", .{});
    }

    return globalThis.throwInvalidArguments("Archive: compress argument must be 'gzip', a boolean, or undefined", .{});
}

/// Instance method: archive.extract(path, options?)
/// Extracts the archive to the given path
/// Options:
///   - glob: string | string[] - Only extract files matching the glob pattern(s)
///   - ignore: string | string[] - Exclude files matching the ignore pattern(s)
/// Returns Promise<number> with count of extracted files
pub fn extract(this: *Archive, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const path_arg, const options_arg = callframe.argumentsAsArray(2);
    if (path_arg == .zero or !path_arg.isString()) {
        return globalThis.throwInvalidArguments("Archive.extract requires a path argument", .{});
    }

    const path_slice = try path_arg.toSlice(globalThis, bun.default_allocator);
    defer path_slice.deinit();

    // Parse options
    var glob_patterns: ?[]const []const u8 = null;
    var ignore_patterns: ?[]const []const u8 = null;
    errdefer {
        if (glob_patterns) |patterns| freePatterns(patterns);
        if (ignore_patterns) |patterns| freePatterns(patterns);
    }

    if (!options_arg.isUndefinedOrNull()) {
        if (!options_arg.isObject()) {
            return globalThis.throwInvalidArguments("Archive.extract: second argument must be an options object", .{});
        }

        // Parse glob option
        if (try options_arg.getTruthy(globalThis, "glob")) |glob_val| {
            glob_patterns = try parsePatternArg(globalThis, glob_val, "glob");
        }

        // Parse ignore option
        if (try options_arg.getTruthy(globalThis, "ignore")) |ignore_val| {
            ignore_patterns = try parsePatternArg(globalThis, ignore_val, "ignore");
        }
    }

    return startExtractTask(globalThis, this.store, path_slice.slice(), glob_patterns, ignore_patterns);
}

/// Parse a string or array of strings into a pattern list
fn parsePatternArg(globalThis: *jsc.JSGlobalObject, arg: jsc.JSValue, name: []const u8) bun.JSError![]const []const u8 {
    const allocator = bun.default_allocator;

    // Single string
    if (arg.isString()) {
        const str_slice = try arg.toSlice(globalThis, allocator);
        defer str_slice.deinit();
        const pattern = allocator.dupe(u8, str_slice.slice()) catch return error.OutOfMemory;
        errdefer allocator.free(pattern);
        const patterns = allocator.alloc([]const u8, 1) catch return error.OutOfMemory;
        patterns[0] = pattern;
        return patterns;
    }

    // Array of strings
    if (arg.jsType() == .Array) {
        const len = try arg.getLength(globalThis);
        if (len == 0) return allocator.alloc([]const u8, 0) catch return error.OutOfMemory;

        var patterns = std.ArrayList([]const u8).initCapacity(allocator, @intCast(len)) catch return error.OutOfMemory;
        errdefer {
            for (patterns.items) |p| allocator.free(p);
            patterns.deinit(allocator);
        }

        var iter = try arg.arrayIterator(globalThis);
        while (try iter.next()) |item| {
            if (!item.isString()) {
                return globalThis.throwInvalidArguments("Archive.extract: {s} array must contain only strings", .{name});
            }
            const str_slice = try item.toSlice(globalThis, allocator);
            defer str_slice.deinit();
            const pattern = allocator.dupe(u8, str_slice.slice()) catch return error.OutOfMemory;
            patterns.appendAssumeCapacity(pattern);
        }

        return patterns.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }

    return globalThis.throwInvalidArguments("Archive.extract: {s} must be a string or array of strings", .{name});
}

fn freePatterns(patterns: []const []const u8) void {
    for (patterns) |p| bun.default_allocator.free(p);
    bun.default_allocator.free(patterns);
}

/// Instance method: archive.blob(compress?)
/// Returns Promise<Blob> with the archive data
pub fn blob(this: *Archive, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const compress_arg = callframe.argumentsAsArray(1)[0];
    const use_gzip = try parseCompressArg(globalThis, compress_arg);
    return startBlobTask(globalThis, this.store, use_gzip, .blob);
}

/// Instance method: archive.bytes(compress?)
/// Returns Promise<Uint8Array> with the archive data
pub fn bytes(this: *Archive, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const compress_arg = callframe.argumentsAsArray(1)[0];
    const use_gzip = try parseCompressArg(globalThis, compress_arg);
    return startBlobTask(globalThis, this.store, use_gzip, .bytes);
}

/// Instance method: archive.files(glob?)
/// Returns Promise<Map<string, File>> with archive file contents
pub fn files(this: *Archive, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const glob_arg = callframe.argument(0);

    var glob_patterns: ?[]const []const u8 = null;
    errdefer if (glob_patterns) |patterns| freePatterns(patterns);

    if (!glob_arg.isUndefinedOrNull()) {
        glob_patterns = try parsePatternArg(globalThis, glob_arg, "glob");
    }

    return startFilesTask(globalThis, this.store, glob_patterns);
}

// ============================================================================
// Generic Async Task Infrastructure
// ============================================================================

const PromiseResult = union(enum) {
    resolve: jsc.JSValue,
    reject: jsc.JSValue,

    fn fulfill(this: PromiseResult, globalThis: *jsc.JSGlobalObject, promise: *jsc.JSPromise) bun.JSTerminated!void {
        switch (this) {
            .resolve => |v| try promise.resolve(globalThis, v),
            .reject => |v| try promise.reject(globalThis, v),
        }
    }
};

/// Generic async task that handles all the boilerplate for thread pool tasks.
/// Context must provide:
///   - `fn run(*Context) void` - runs on thread pool
///   - `fn runFromJS(*Context, *jsc.JSGlobalObject) PromiseResult` - returns value to resolve/reject
///   - `fn deinit(*Context) void` - cleanup
fn AsyncTask(comptime Context: type) type {
    return struct {
        const Self = @This();

        ctx: Context,
        promise: jsc.JSPromise.Strong,
        vm: *jsc.VirtualMachine,
        task: jsc.WorkPoolTask = .{ .callback = &run },
        concurrent_task: jsc.ConcurrentTask = .{},
        ref: bun.Async.KeepAlive = .{},

        fn create(globalThis: *jsc.JSGlobalObject, ctx: Context) error{OutOfMemory}!*Self {
            const vm = globalThis.bunVM();
            const self = bun.new(Self, .{
                .ctx = ctx,
                .promise = jsc.JSPromise.Strong.init(globalThis),
                .vm = vm,
            });
            self.ref.ref(vm);
            return self;
        }

        fn schedule(this: *Self) void {
            jsc.WorkPool.schedule(&this.task);
        }

        fn run(work_task: *jsc.WorkPoolTask) void {
            const this: *Self = @fieldParentPtr("task", work_task);
            const result = Context.run(&this.ctx);
            // Handle both error union and non-error union return types
            this.ctx.result = if (@typeInfo(@TypeOf(result)) == .error_union)
                result catch |err| .{ .err = err }
            else
                result;
            this.vm.enqueueTaskConcurrent(
                this.concurrent_task.from(this, .manual_deinit),
            );
        }

        pub fn runFromJS(this: *Self) bun.JSTerminated!void {
            this.ref.unref(this.vm);

            defer {
                Context.deinit(&this.ctx);
                bun.destroy(this);
            }

            if (this.vm.isShuttingDown()) return;

            const globalThis = this.vm.global;
            const promise = this.promise.swap();
            const result = Context.runFromJS(&this.ctx, globalThis) catch |e| {
                // JSError means exception is already pending
                return try promise.reject(globalThis, globalThis.takeException(e));
            };
            try result.fulfill(globalThis, promise);
        }
    };
}

// ============================================================================
// Task Contexts
// ============================================================================

const ExtractContext = struct {
    const Result = union(enum) {
        success: u32,
        err: error{ReadError},
    };

    store: *jsc.WebCore.Blob.Store,
    path: []const u8,
    glob_patterns: ?[]const []const u8,
    ignore_patterns: ?[]const []const u8,
    result: Result = .{ .err = error.ReadError },

    fn run(this: *ExtractContext) Result {
        // If we have glob or ignore patterns, use filtered extraction
        if (this.glob_patterns != null or this.ignore_patterns != null) {
            const count = extractToDiskFiltered(
                this.store.sharedView(),
                this.path,
                this.glob_patterns,
                this.ignore_patterns,
            ) catch return .{ .err = error.ReadError };
            return .{ .success = count };
        }

        // Otherwise use the fast path without filtering
        const count = libarchive.Archiver.extractToDisk(
            this.store.sharedView(),
            this.path,
            null,
            void,
            {},
            .{ .depth_to_skip = 0, .close_handles = true, .log = false, .npm = false },
        ) catch return .{ .err = error.ReadError };
        return .{ .success = count };
    }

    fn runFromJS(this: *ExtractContext, globalThis: *jsc.JSGlobalObject) bun.JSError!PromiseResult {
        return switch (this.result) {
            .success => |count| .{ .resolve = jsc.JSValue.jsNumber(count) },
            .err => |e| .{ .reject = globalThis.createErrorInstance("{s}", .{@errorName(e)}) },
        };
    }

    fn deinit(this: *ExtractContext) void {
        this.store.deref();
        bun.default_allocator.free(this.path);
        if (this.glob_patterns) |patterns| freePatterns(patterns);
        if (this.ignore_patterns) |patterns| freePatterns(patterns);
    }
};

pub const ExtractTask = AsyncTask(ExtractContext);

fn startExtractTask(
    globalThis: *jsc.JSGlobalObject,
    store: *jsc.WebCore.Blob.Store,
    path: []const u8,
    glob_patterns: ?[]const []const u8,
    ignore_patterns: ?[]const []const u8,
) bun.JSError!jsc.JSValue {
    const path_copy = try bun.default_allocator.dupe(u8, path);
    errdefer bun.default_allocator.free(path_copy);

    store.ref();
    errdefer store.deref();

    const task = try ExtractTask.create(globalThis, .{
        .store = store,
        .path = path_copy,
        .glob_patterns = glob_patterns,
        .ignore_patterns = ignore_patterns,
    });

    const promise_js = task.promise.value();
    task.schedule();
    return promise_js;
}

const BlobContext = struct {
    const OutputType = enum { blob, bytes };
    const Error = error{ OutOfMemory, GzipInitFailed, GzipCompressFailed };
    const Result = union(enum) {
        compressed: []u8,
        uncompressed: void,
        err: Error,
    };

    store: *jsc.WebCore.Blob.Store,
    use_gzip: bool,
    output_type: OutputType,
    result: Result = .{ .uncompressed = {} },

    fn run(this: *BlobContext) Result {
        if (this.use_gzip) {
            return .{ .compressed = compressGzip(this.store.sharedView()) catch |e| return .{ .err = e } };
        }
        return .{ .uncompressed = {} };
    }

    fn runFromJS(this: *BlobContext, globalThis: *jsc.JSGlobalObject) bun.JSError!PromiseResult {
        switch (this.result) {
            .err => |e| return .{ .reject = globalThis.createErrorInstance("{s}", .{@errorName(e)}) },
            .compressed => |data| {
                this.result = .{ .uncompressed = {} }; // Ownership transferred
                return .{ .resolve = switch (this.output_type) {
                    .blob => jsc.WebCore.Blob.new(jsc.WebCore.Blob.createWithBytesAndAllocator(data, bun.default_allocator, globalThis, false)).toJS(globalThis),
                    .bytes => jsc.JSValue.createBuffer(globalThis, data),
                } };
            },
            .uncompressed => return switch (this.output_type) {
                .blob => blk: {
                    this.store.ref();
                    break :blk .{ .resolve = jsc.WebCore.Blob.new(jsc.WebCore.Blob.initWithStore(this.store, globalThis)).toJS(globalThis) };
                },
                .bytes => .{ .resolve = jsc.JSValue.createBuffer(globalThis, bun.default_allocator.dupe(u8, this.store.sharedView()) catch return .{ .reject = globalThis.createOutOfMemoryError() }) },
            },
        }
    }

    fn deinit(this: *BlobContext) void {
        this.store.deref();
        if (this.result == .compressed) bun.default_allocator.free(this.result.compressed);
    }
};

pub const BlobTask = AsyncTask(BlobContext);

fn startBlobTask(globalThis: *jsc.JSGlobalObject, store: *jsc.WebCore.Blob.Store, use_gzip: bool, output_type: BlobContext.OutputType) bun.JSError!jsc.JSValue {
    store.ref();
    errdefer store.deref();

    const task = try BlobTask.create(globalThis, .{
        .store = store,
        .use_gzip = use_gzip,
        .output_type = output_type,
    });

    const promise_js = task.promise.value();
    task.schedule();
    return promise_js;
}

const WriteContext = struct {
    const Error = error{ OutOfMemory, GzipInitFailed, GzipCompressFailed };
    const Result = union(enum) {
        success: void,
        err: Error,
        sys_err: bun.sys.Error,
    };
    const Data = union(enum) {
        owned: []u8,
        store: *jsc.WebCore.Blob.Store,
    };

    data: Data,
    path: [:0]const u8,
    use_gzip: bool,
    result: Result = .{ .success = {} },

    fn run(this: *WriteContext) Result {
        const source_data = switch (this.data) {
            .owned => |d| d,
            .store => |s| s.sharedView(),
        };
        const data_to_write = if (this.use_gzip)
            compressGzip(source_data) catch |e| return .{ .err = e }
        else
            source_data;
        defer if (this.use_gzip) bun.default_allocator.free(data_to_write);

        const file = switch (bun.sys.File.openat(.cwd(), this.path, bun.O.CREAT | bun.O.WRONLY | bun.O.TRUNC, 0o644)) {
            .err => |err| return .{ .sys_err = err.clone(bun.default_allocator) },
            .result => |f| f,
        };
        defer file.close();

        return switch (file.writeAll(data_to_write)) {
            .err => |err| .{ .sys_err = err.clone(bun.default_allocator) },
            .result => .{ .success = {} },
        };
    }

    fn runFromJS(this: *WriteContext, globalThis: *jsc.JSGlobalObject) bun.JSError!PromiseResult {
        return switch (this.result) {
            .success => .{ .resolve = .js_undefined },
            .err => |e| .{ .reject = globalThis.createErrorInstance("{s}", .{@errorName(e)}) },
            .sys_err => |sys_err| .{ .reject = sys_err.toJS(globalThis) },
        };
    }

    fn deinit(this: *WriteContext) void {
        switch (this.data) {
            .owned => |d| bun.default_allocator.free(d),
            .store => |s| s.deref(),
        }
        bun.default_allocator.free(this.path);
        if (this.result == .sys_err) {
            var sys_err = this.result.sys_err;
            sys_err.deinit();
        }
    }
};

pub const WriteTask = AsyncTask(WriteContext);

fn startWriteTask(
    globalThis: *jsc.JSGlobalObject,
    data: WriteContext.Data,
    path: []const u8,
    use_gzip: bool,
) bun.JSError!jsc.JSValue {
    const path_z = try bun.default_allocator.dupeZ(u8, path);
    errdefer bun.default_allocator.free(path_z);

    // Ref store if using store reference
    if (data == .store) {
        data.store.ref();
    }
    errdefer if (data == .store) data.store.deref();
    errdefer if (data == .owned) bun.default_allocator.free(data.owned);

    const task = try WriteTask.create(globalThis, .{
        .data = data,
        .path = path_z,
        .use_gzip = use_gzip,
    });

    const promise_js = task.promise.value();
    task.schedule();
    return promise_js;
}

const FilesContext = struct {
    const FileEntry = struct { path: []u8, data: []u8, mtime: i64 };
    const FileEntryList = std.ArrayList(FileEntry);
    const Error = error{ OutOfMemory, ReadError };
    const Result = union(enum) {
        success: FileEntryList,
        libarchive_err: [*:0]u8,
        err: Error,

        fn deinit(self: *Result) void {
            switch (self.*) {
                .libarchive_err => |s| bun.default_allocator.free(std.mem.span(s)),
                .success => |*list| {
                    for (list.items) |e| {
                        bun.default_allocator.free(e.path);
                        if (e.data.len > 0) bun.default_allocator.free(e.data);
                    }
                    list.deinit(bun.default_allocator);
                },
                .err => {},
            }
        }
    };

    store: *jsc.WebCore.Blob.Store,
    glob_patterns: ?[]const []const u8,
    result: Result = .{ .err = error.ReadError },

    fn cloneErrorString(archive: *libarchive.lib.Archive) ?[*:0]u8 {
        const err_str = archive.errorString();
        if (err_str.len == 0) return null;
        return bun.default_allocator.dupeZ(u8, err_str) catch null;
    }

    fn run(this: *FilesContext) std.mem.Allocator.Error!Result {
        const lib = libarchive.lib;
        const archive = lib.Archive.readNew();
        defer _ = archive.readFree();
        configureArchiveReader(archive);

        if (archive.readOpenMemory(this.store.sharedView()) != .ok) {
            return if (cloneErrorString(archive)) |err| .{ .libarchive_err = err } else .{ .err = error.ReadError };
        }

        var entries: FileEntryList = .empty;
        errdefer {
            for (entries.items) |e| {
                bun.default_allocator.free(e.path);
                if (e.data.len > 0) bun.default_allocator.free(e.data);
            }
            entries.deinit(bun.default_allocator);
        }

        var entry: *lib.Archive.Entry = undefined;
        while (archive.readNextHeader(&entry) == .ok) {
            if (entry.filetype() != @intFromEnum(lib.FileType.regular)) continue;

            const pathname = entry.pathnameUtf8();
            // Apply glob pattern filtering (if patterns specified, at least one must match)
            if (this.glob_patterns) |patterns| {
                var matches_any = false;
                for (patterns) |pattern| {
                    if (bun.glob.match(pattern, pathname).matches()) {
                        matches_any = true;
                        break;
                    }
                }
                if (!matches_any) continue;
            }

            const size: usize = @intCast(@max(entry.size(), 0));
            const mtime = entry.mtime();

            // Read data first before allocating path
            var data: []u8 = &.{};
            if (size > 0) {
                data = try bun.default_allocator.alloc(u8, size);
                var total_read: usize = 0;
                while (total_read < size) {
                    const read = archive.readData(data[total_read..]);
                    if (read < 0) {
                        // Read error - not an allocation error, must free manually
                        bun.default_allocator.free(data);
                        return if (cloneErrorString(archive)) |err| .{ .libarchive_err = err } else .{ .err = error.ReadError };
                    }
                    if (read == 0) break;
                    total_read += @intCast(read);
                }
            }
            errdefer if (data.len > 0) bun.default_allocator.free(data);

            const path_copy = try bun.default_allocator.dupe(u8, pathname);
            errdefer bun.default_allocator.free(path_copy);

            try entries.append(bun.default_allocator, .{ .path = path_copy, .data = data, .mtime = mtime });
        }

        return .{ .success = entries };
    }

    fn runFromJS(this: *FilesContext, globalThis: *jsc.JSGlobalObject) bun.JSError!PromiseResult {
        switch (this.result) {
            .success => |*entries| {
                const map = jsc.JSMap.create(globalThis);
                const map_ptr = jsc.JSMap.fromJS(map) orelse {
                    return .{ .reject = globalThis.createErrorInstance("Failed to create Map", .{}) };
                };

                for (entries.items) |*entry| {
                    const blob_ptr = jsc.WebCore.Blob.new(jsc.WebCore.Blob.createWithBytesAndAllocator(entry.data, bun.default_allocator, globalThis, false));
                    entry.data = &.{}; // Ownership transferred
                    blob_ptr.is_jsdom_file = true;
                    blob_ptr.name = bun.String.cloneUTF8(entry.path);
                    blob_ptr.last_modified = @floatFromInt(entry.mtime * 1000);

                    try map_ptr.set(globalThis, blob_ptr.name.toJS(globalThis), blob_ptr.toJS(globalThis));
                }

                return .{ .resolve = map };
            },
            .libarchive_err => |err_msg| return .{ .reject = globalThis.createErrorInstance("{s}", .{err_msg}) },
            .err => |e| return .{ .reject = globalThis.createErrorInstance("{s}", .{@errorName(e)}) },
        }
    }

    fn deinit(this: *FilesContext) void {
        this.result.deinit();
        this.store.deref();
        if (this.glob_patterns) |patterns| freePatterns(patterns);
    }
};

pub const FilesTask = AsyncTask(FilesContext);

fn startFilesTask(globalThis: *jsc.JSGlobalObject, store: *jsc.WebCore.Blob.Store, glob_patterns: ?[]const []const u8) bun.JSError!jsc.JSValue {
    store.ref();
    errdefer store.deref();
    errdefer if (glob_patterns) |patterns| freePatterns(patterns);

    const task = try FilesTask.create(globalThis, .{
        .store = store,
        .glob_patterns = glob_patterns,
    });

    const promise_js = task.promise.value();
    task.schedule();
    return promise_js;
}

// ============================================================================
// Helpers
// ============================================================================

fn compressGzip(data: []const u8) ![]u8 {
    libdeflate.load();

    const compressor = libdeflate.Compressor.alloc(6) orelse return error.GzipInitFailed;
    defer compressor.deinit();

    const max_size = compressor.maxBytesNeeded(data, .gzip);

    // Use stack buffer for small data, heap for large
    const stack_threshold = 256 * 1024;
    var stack_buf: [stack_threshold]u8 = undefined;

    if (max_size <= stack_threshold) {
        const result = compressor.gzip(data, &stack_buf);
        if (result.status != .success) return error.GzipCompressFailed;
        return bun.default_allocator.dupe(u8, stack_buf[0..result.written]);
    }

    const output = try bun.default_allocator.alloc(u8, max_size);
    errdefer bun.default_allocator.free(output);

    const result = compressor.gzip(data, output);
    if (result.status != .success) return error.GzipCompressFailed;

    return bun.default_allocator.realloc(output, result.written) catch output[0..result.written];
}

/// Extract archive to disk with glob/ignore pattern filtering
fn extractToDiskFiltered(
    file_buffer: []const u8,
    root: []const u8,
    glob_patterns: ?[]const []const u8,
    ignore_patterns: ?[]const []const u8,
) !u32 {
    const lib = libarchive.lib;
    const archive = lib.Archive.readNew();
    defer _ = archive.readFree();
    configureArchiveReader(archive);

    if (archive.readOpenMemory(file_buffer) != .ok) {
        return error.ReadError;
    }

    // Open/create target directory
    const cwd = std.fs.cwd();
    cwd.makePath(root) catch {};

    var dir = if (std.fs.path.isAbsolute(root))
        try std.fs.openDirAbsolute(root, .{})
    else
        try cwd.openDir(root, .{});
    defer dir.close();

    var count: u32 = 0;
    var entry: *lib.Archive.Entry = undefined;

    while (archive.readNextHeader(&entry) == .ok) {
        const pathname = entry.pathnameUtf8();
        if (pathname.len == 0) continue;

        // Apply glob pattern filtering (if patterns specified, at least one must match)
        if (glob_patterns) |patterns| {
            var matches_any = false;
            for (patterns) |pattern| {
                if (bun.glob.match(pattern, pathname).matches()) {
                    matches_any = true;
                    break;
                }
            }
            if (!matches_any) continue;
        }

        // Apply ignore pattern filtering (if any pattern matches, skip)
        if (ignore_patterns) |patterns| {
            var is_ignored = false;
            for (patterns) |pattern| {
                if (bun.glob.match(pattern, pathname).matches()) {
                    is_ignored = true;
                    break;
                }
            }
            if (is_ignored) continue;
        }

        const filetype = entry.filetype();
        const kind = bun.sys.kindFromMode(filetype);

        switch (kind) {
            .directory => {
                dir.makePath(pathname) catch {};
                count += 1;
            },
            .file => {
                const size: usize = @intCast(@max(entry.size(), 0));
                const mode: bun.Mode = @intCast(entry.perm() | 0o666);

                // Create parent directories if needed
                if (std.fs.path.dirname(pathname)) |parent_dir| {
                    dir.makePath(parent_dir) catch {};
                }

                // Create and write the file
                const file = dir.createFileZ(pathname, .{
                    .truncate = true,
                    .mode = mode,
                }) catch continue;

                var write_success = true;
                if (size > 0) {
                    // Read archive data and write to file
                    var remaining = size;
                    var buf: [64 * 1024]u8 = undefined;
                    while (remaining > 0) {
                        const to_read = @min(remaining, buf.len);
                        const read = archive.readData(buf[0..to_read]);
                        if (read <= 0) {
                            write_success = false;
                            break;
                        }
                        const bytes_read: usize = @intCast(read);
                        _ = file.write(buf[0..bytes_read]) catch {
                            write_success = false;
                            break;
                        };
                        remaining -= bytes_read;
                    }
                }
                file.close();

                if (write_success) {
                    count += 1;
                } else {
                    // Remove partial file on failure
                    dir.deleteFile(pathname) catch {};
                }
            },
            .sym_link => {
                const link_target = entry.symlink();
                if (bun.Environment.isPosix) {
                    bun.sys.symlinkat(link_target, .fromNative(dir.fd), pathname).unwrap() catch |err| {
                        switch (err) {
                            error.EPERM, error.ENOENT => {
                                if (std.fs.path.dirname(pathname)) |parent| {
                                    dir.makePath(parent) catch {};
                                }
                                _ = bun.sys.symlinkat(link_target, .fromNative(dir.fd), pathname).unwrap() catch continue;
                            },
                            else => continue,
                        }
                    };
                    count += 1;
                }
            },
            else => {},
        }
    }

    return count;
}

const libarchive = @import("../../libarchive/libarchive.zig");
const libdeflate = @import("../../deps/libdeflate.zig");
const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
