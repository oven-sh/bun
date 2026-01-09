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
    const data = try getArchiveData(globalThis, arg, false);
    return createArchive(globalThis, data);
}

fn createArchive(globalThis: *jsc.JSGlobalObject, data: []u8) jsc.JSValue {
    const store = jsc.WebCore.Blob.Store.init(data, bun.default_allocator);
    return bun.new(Archive, .{ .store = store }).toJS(globalThis);
}

/// Shared helper that builds tarball bytes from a JS object
fn buildTarballFromObject(globalThis: *jsc.JSGlobalObject, obj: jsc.JSValue) bun.JSError![]u8 {
    const allocator = bun.default_allocator;

    const js_obj = obj.getObject() orelse {
        return globalThis.throwInvalidArguments("Expected an object", .{});
    };

    // Collect entries first
    var entries = bun.StringArrayHashMap([]u8).init(allocator);
    defer {
        var iter = entries.iterator();
        while (iter.next()) |entry| {
            allocator.free(entry.key_ptr.*);
            allocator.free(entry.value_ptr.*);
        }
        entries.deinit();
    }

    // Iterate over object properties
    const PropIterator = jsc.JSPropertyIterator(.{
        .skip_empty_name = true,
        .include_value = true,
    });

    var iter = try PropIterator.init(globalThis, js_obj);
    defer iter.deinit();

    while (try iter.next()) |key| {
        const value = iter.value;
        if (value == .zero) continue;

        // Get the key as a string
        const key_slice = key.toUTF8(allocator);
        defer key_slice.deinit();
        const key_str = try allocator.dupeZ(u8, key_slice.slice());
        errdefer allocator.free(key_str);

        // Get the value data - copy it immediately
        const entry_data = try getEntryDataCopy(globalThis, value, allocator);
        errdefer allocator.free(entry_data);

        try entries.put(key_str, entry_data);
    }

    // Build the tarball immediately
    return buildTarballFromEntries(entries, false, allocator) catch |err| {
        return globalThis.throwInvalidArguments("Failed to create tarball: {s}", .{@errorName(err)});
    };
}

fn getEntryDataCopy(globalThis: *jsc.JSGlobalObject, value: jsc.JSValue, allocator: std.mem.Allocator) bun.JSError![]u8 {
    // Check for Blob first - copy immediately
    if (value.as(jsc.WebCore.Blob)) |blob_ptr| {
        return allocator.dupe(u8, blob_ptr.sharedView());
    }

    // Use StringOrBuffer.fromJSToOwnedSlice for strings and typed arrays
    // This handles the conversion efficiently without unnecessary copies
    return jsc.Node.StringOrBuffer.fromJSToOwnedSlice(globalThis, value, allocator);
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

    // Get archive data directly without creating an intermediate Archive object
    const archive_data = try getArchiveData(globalThis, data_arg, true);
    errdefer bun.default_allocator.free(archive_data);

    // Create write task - it takes ownership of archive_data
    const task = try WriteTask.create(globalThis, archive_data, path_slice.slice(), use_gzip);
    const promise_js = task.promise.value();
    task.schedule();

    return promise_js;
}

/// Get archive data from a value, returning owned bytes
fn getArchiveData(globalThis: *jsc.JSGlobalObject, arg: jsc.JSValue, accept_archive: bool) bun.JSError![]u8 {
    // Check if it's a typed array, ArrayBuffer, or similar
    if (arg.asArrayBuffer(globalThis)) |array_buffer| {
        return bun.default_allocator.dupe(u8, array_buffer.slice());
    }

    // Check if it's a Blob
    if (arg.as(jsc.WebCore.Blob)) |blob_ptr| {
        return bun.default_allocator.dupe(u8, blob_ptr.sharedView());
    }

    // Check if it's an existing Archive
    if (accept_archive) {
        if (fromJS(arg)) |archive| {
            return bun.default_allocator.dupe(u8, archive.store.sharedView());
        }
    }

    // Check if it's an object with entries (plain object) - build tarball
    if (arg.isObject()) {
        return buildTarballFromObject(globalThis, arg);
    }

    return globalThis.throwInvalidArguments("Expected an object, Blob, TypedArray, or ArrayBuffer", .{});
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

/// Instance method: archive.extract(path)
/// Extracts the archive to the given path
/// Returns Promise<number> with count of extracted files
pub fn extract(this: *Archive, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const path_arg = callframe.argumentsAsArray(1)[0];
    if (path_arg == .zero or !path_arg.isString()) {
        return globalThis.throwInvalidArguments("Archive.extract requires a path argument", .{});
    }

    const path_slice = try path_arg.toSlice(globalThis, bun.default_allocator);
    defer path_slice.deinit();

    // Create extract task (it manages its own promise)
    const task = try ExtractTask.create(globalThis, this, path_slice.slice());
    const promise_js = task.promise.value();
    task.schedule();

    return promise_js;
}

/// Instance method: archive.blob(compress?)
/// Returns Promise<Blob> with the archive data
pub fn blob(this: *Archive, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const compress_arg = callframe.argumentsAsArray(1)[0];

    const use_gzip = try parseCompressArg(globalThis, compress_arg);

    // Create blob task (it manages its own promise)
    const task = try BlobTask.create(globalThis, this, use_gzip, .blob);
    const promise_js = task.promise.value();
    task.schedule();

    return promise_js;
}

/// Instance method: archive.bytes(compress?)
/// Returns Promise<Uint8Array> with the archive data
pub fn bytes(this: *Archive, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const compress_arg = callframe.argumentsAsArray(1)[0];

    const use_gzip = try parseCompressArg(globalThis, compress_arg);

    // Create blob task (it manages its own promise)
    const task = try BlobTask.create(globalThis, this, use_gzip, .bytes);
    const promise_js = task.promise.value();
    task.schedule();

    return promise_js;
}

/// Instance method: archive.files(glob?)
/// Returns Promise<Map<string, File>> with archive file contents
pub fn files(this: *Archive, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const glob_arg = callframe.argument(0);

    var glob_pattern: ?[]const u8 = null;

    if (!glob_arg.isUndefinedOrNull()) {
        if (!glob_arg.isString()) {
            return globalThis.throwInvalidArguments("Archive.files: argument must be a string glob pattern or undefined", .{});
        }
        const glob_slice = try glob_arg.toSlice(globalThis, bun.default_allocator);
        defer glob_slice.deinit();
        glob_pattern = try bun.default_allocator.dupe(u8, glob_slice.slice());
    }
    errdefer if (glob_pattern) |p| bun.default_allocator.free(p);

    const task = try FilesTask.create(globalThis, this, glob_pattern);
    const promise_js = task.promise.value();
    task.schedule();

    return promise_js;
}

// Task for extracting archives
pub const ExtractTask = struct {
    /// Reference to archive data store (thread-safe ref counted)
    store: *jsc.WebCore.Blob.Store,
    path: []const u8,
    promise: jsc.JSPromise.Strong,
    vm: *jsc.VirtualMachine,
    result: union(enum) {
        pending: void,
        success: u32,
        err: []const u8,
    } = .pending,
    task: jsc.WorkPoolTask = .{ .callback = &run },
    concurrent_task: jsc.ConcurrentTask = .{},
    ref: bun.Async.KeepAlive = .{},

    pub fn create(globalThis: *jsc.JSGlobalObject, archive: *Archive, path: []const u8) bun.JSError!*ExtractTask {
        const vm = globalThis.bunVM();
        const path_copy = bun.default_allocator.dupe(u8, path) catch return error.OutOfMemory;
        archive.store.ref();
        errdefer archive.store.deref();
        const extract_task = bun.new(ExtractTask, .{
            .store = archive.store,
            .path = path_copy,
            .promise = jsc.JSPromise.Strong.init(globalThis),
            .vm = vm,
        });
        extract_task.ref.ref(vm);
        return extract_task;
    }

    pub fn schedule(this: *ExtractTask) void {
        jsc.WorkPool.schedule(&this.task);
    }

    fn run(task: *jsc.WorkPoolTask) void {
        const this: *ExtractTask = @fieldParentPtr("task", task);
        this.doExtract();
        this.onFinish();
    }

    fn doExtract(this: *ExtractTask) void {
        const count = libarchive.Archiver.extractToDisk(
            this.store.sharedView(),
            this.path,
            null,
            void,
            {},
            .{ .depth_to_skip = 0, .close_handles = true, .log = false, .npm = false },
        ) catch |err| {
            this.result = .{ .err = @errorName(err) };
            return;
        };

        this.result = .{ .success = count };
    }

    fn onFinish(this: *ExtractTask) void {
        this.vm.enqueueTaskConcurrent(
            this.concurrent_task.from(this, .manual_deinit),
        );
    }

    pub fn runFromJS(this: *ExtractTask) bun.JSTerminated!void {
        defer {
            this.store.deref();
            bun.default_allocator.free(this.path);
            bun.destroy(this);
        }

        this.ref.unref(this.vm);

        if (this.vm.isShuttingDown()) {
            return;
        }

        const globalThis = this.vm.global;
        const promise = this.promise.swap();

        switch (this.result) {
            .success => |count| {
                try promise.resolve(globalThis, jsc.JSValue.jsNumber(count));
            },
            .err => |err_msg| {
                const err = globalThis.createErrorInstance("{s}", .{err_msg});
                try promise.reject(globalThis, err);
            },
            .pending => unreachable,
        }
    }
};

// Task for creating blob/bytes from archive
pub const BlobTask = struct {
    pub const OutputType = enum { blob, bytes };

    /// Reference to archive data store (thread-safe ref counted)
    store: *jsc.WebCore.Blob.Store,
    use_gzip: bool,
    promise: jsc.JSPromise.Strong,
    vm: *jsc.VirtualMachine,
    output_type: OutputType,
    /// For gzip case, holds the compressed data
    compressed_data: ?[]u8 = null,
    err: ?[]const u8 = null,
    task: jsc.WorkPoolTask = .{ .callback = &run },
    concurrent_task: jsc.ConcurrentTask = .{},
    ref: bun.Async.KeepAlive = .{},

    pub fn create(globalThis: *jsc.JSGlobalObject, archive: *Archive, use_gzip: bool, output_type: OutputType) bun.JSError!*BlobTask {
        const vm = globalThis.bunVM();
        archive.store.ref();
        errdefer archive.store.deref();
        const blob_task = bun.new(BlobTask, .{
            .store = archive.store,
            .use_gzip = use_gzip,
            .promise = jsc.JSPromise.Strong.init(globalThis),
            .vm = vm,
            .output_type = output_type,
        });
        blob_task.ref.ref(vm);
        return blob_task;
    }

    pub fn schedule(this: *BlobTask) void {
        jsc.WorkPool.schedule(&this.task);
    }

    fn run(task: *jsc.WorkPoolTask) void {
        const this: *BlobTask = @fieldParentPtr("task", task);
        this.doCreateBlob();
        this.onFinish();
    }

    fn doCreateBlob(this: *BlobTask) void {
        if (this.use_gzip) {
            // Compress with gzip
            const compressed = compressGzip(this.store.sharedView()) catch |err| {
                this.err = @errorName(err);
                return;
            };
            this.compressed_data = compressed;
        }
        // For non-gzip case, we'll just ref the store and create a blob from it in runFromJS
    }

    fn onFinish(this: *BlobTask) void {
        this.vm.enqueueTaskConcurrent(
            this.concurrent_task.from(this, .manual_deinit),
        );
    }

    pub fn runFromJS(this: *BlobTask) bun.JSTerminated!void {
        defer {
            this.store.deref();
            // Free compressed data if ownership wasn't transferred
            if (this.compressed_data) |data| {
                bun.default_allocator.free(data);
            }
            bun.destroy(this);
        }

        this.ref.unref(this.vm);

        if (this.vm.isShuttingDown()) {
            return;
        }

        const globalThis = this.vm.global;
        const promise = this.promise.swap();

        // Handle error case
        if (this.err) |err_msg| {
            const err = globalThis.createErrorInstance("{s}", .{err_msg});
            try promise.reject(globalThis, err);
            return;
        }

        if (this.use_gzip) {
            // Gzip case: use compressed data
            const data = this.compressed_data.?;
            switch (this.output_type) {
                .blob => {
                    const blob_struct = jsc.WebCore.Blob.createWithBytesAndAllocator(data, bun.default_allocator, globalThis, false);
                    const blob_ptr = jsc.WebCore.Blob.new(blob_struct);
                    this.compressed_data = null; // Ownership transferred
                    try promise.resolve(globalThis, blob_ptr.toJS(globalThis));
                },
                .bytes => {
                    const array = jsc.JSValue.createBuffer(globalThis, data);
                    this.compressed_data = null; // Ownership transferred
                    try promise.resolve(globalThis, array);
                },
            }
        } else {
            // Non-gzip case: reference the store directly (no copy needed for blob)
            switch (this.output_type) {
                .blob => {
                    // Create a Blob that references the same store (zero-copy)
                    this.store.ref();
                    errdefer this.store.deref();
                    const new_blob = jsc.WebCore.Blob.initWithStore(this.store, globalThis);
                    const blob_ptr = jsc.WebCore.Blob.new(new_blob);
                    try promise.resolve(globalThis, blob_ptr.toJS(globalThis));
                },
                .bytes => {
                    // createBuffer takes ownership of the slice, so we need to copy it
                    const data_copy = bun.default_allocator.dupe(u8, this.store.sharedView()) catch {
                        try promise.reject(globalThis, globalThis.createOutOfMemoryError());
                        return;
                    };
                    const array = jsc.JSValue.createBuffer(globalThis, data_copy);
                    try promise.resolve(globalThis, array);
                },
            }
        }
    }
};

// Task for writing archives to disk
pub const WriteTask = struct {
    data: []u8,
    path: []const u8,
    use_gzip: bool,
    promise: jsc.JSPromise.Strong,
    vm: *jsc.VirtualMachine,
    result: union(enum) {
        pending: void,
        success: void,
        zig_err: []const u8,
        sys_err: bun.sys.Error,
    } = .pending,
    task: jsc.WorkPoolTask = .{ .callback = &run },
    concurrent_task: jsc.ConcurrentTask = .{},
    ref: bun.Async.KeepAlive = .{},

    /// Create with pre-allocated data (takes ownership of archive_data)
    pub fn create(globalThis: *jsc.JSGlobalObject, archive_data: []u8, path: []const u8, use_gzip: bool) bun.JSError!*WriteTask {
        const vm = globalThis.bunVM();
        const path_copy = bun.default_allocator.dupe(u8, path) catch return error.OutOfMemory;
        const write_task = bun.new(WriteTask, .{
            .data = archive_data,
            .path = path_copy,
            .use_gzip = use_gzip,
            .promise = jsc.JSPromise.Strong.init(globalThis),
            .vm = vm,
        });
        write_task.ref.ref(vm);
        return write_task;
    }

    pub fn schedule(this: *WriteTask) void {
        jsc.WorkPool.schedule(&this.task);
    }

    fn run(task: *jsc.WorkPoolTask) void {
        const this: *WriteTask = @fieldParentPtr("task", task);
        this.doWrite();
        this.onFinish();
    }

    fn doWrite(this: *WriteTask) void {
        const data_to_write = if (this.use_gzip)
            compressGzip(this.data) catch |err| {
                this.result = .{ .zig_err = @errorName(err) };
                return;
            }
        else
            this.data;

        defer if (this.use_gzip) bun.default_allocator.free(data_to_write);

        // Write to file
        const path_z = bun.default_allocator.dupeZ(u8, this.path) catch {
            this.result = .{ .zig_err = "OutOfMemory" };
            return;
        };
        defer bun.default_allocator.free(path_z);

        const file = switch (bun.sys.File.openat(.cwd(), path_z, bun.O.CREAT | bun.O.WRONLY | bun.O.TRUNC, 0o644)) {
            .err => |err| {
                // Clone to avoid dangling pointers to stack/freed buffers
                this.result = .{ .sys_err = err.clone(bun.default_allocator) };
                return;
            },
            .result => |f| f,
        };
        defer file.close();

        switch (file.writeAll(data_to_write)) {
            .err => |err| {
                // Clone to avoid dangling pointers to stack/freed buffers
                this.result = .{ .sys_err = err.clone(bun.default_allocator) };
                return;
            },
            .result => {},
        }

        this.result = .{ .success = {} };
    }

    fn onFinish(this: *WriteTask) void {
        this.vm.enqueueTaskConcurrent(
            this.concurrent_task.from(this, .manual_deinit),
        );
    }

    pub fn runFromJS(this: *WriteTask) bun.JSTerminated!void {
        defer {
            bun.default_allocator.free(this.data);
            bun.default_allocator.free(this.path);
            if (this.result == .sys_err) {
                var sys_err = this.result.sys_err;
                sys_err.deinit();
            }
            bun.destroy(this);
        }

        this.ref.unref(this.vm);

        if (this.vm.isShuttingDown()) {
            return;
        }

        const globalThis = this.vm.global;
        const promise = this.promise.swap();

        switch (this.result) {
            .success => {
                try promise.resolve(globalThis, jsc.JSValue.js_undefined);
            },
            .zig_err => |err_msg| {
                const err = globalThis.createErrorInstance("{s}", .{err_msg});
                try promise.reject(globalThis, err);
            },
            .sys_err => |sys_err| {
                try promise.reject(globalThis, sys_err.toJS(globalThis));
            },
            .pending => unreachable,
        }
    }
};

// Task for getting archive files as Map<string, File>
pub const FilesTask = struct {
    /// Reference to archive data store (thread-safe ref counted)
    store: *jsc.WebCore.Blob.Store,
    glob_pattern: ?[]const u8,
    promise: jsc.JSPromise.Strong,
    vm: *jsc.VirtualMachine,
    result: union(enum) {
        pending: void,
        success: FileEntryList,
        err: []const u8,
    } = .pending,
    task: jsc.WorkPoolTask = .{ .callback = &run },
    concurrent_task: jsc.ConcurrentTask = .{},
    ref: bun.Async.KeepAlive = .{},

    const FileEntry = struct {
        path: []u8,
        data: []u8,
        mtime: i64,
    };
    const FileEntryList = std.ArrayList(FileEntry);

    pub fn create(globalThis: *jsc.JSGlobalObject, archive: *Archive, glob_pattern: ?[]const u8) bun.JSError!*FilesTask {
        const vm = globalThis.bunVM();
        archive.store.ref();
        errdefer archive.store.deref();
        const files_task = bun.new(FilesTask, .{
            .store = archive.store,
            .glob_pattern = glob_pattern,
            .promise = jsc.JSPromise.Strong.init(globalThis),
            .vm = vm,
        });
        files_task.ref.ref(vm);
        return files_task;
    }

    pub fn schedule(this: *FilesTask) void {
        jsc.WorkPool.schedule(&this.task);
    }

    fn run(task: *jsc.WorkPoolTask) void {
        const this: *FilesTask = @fieldParentPtr("task", task);
        this.doCollectFiles();
        this.onFinish();
    }

    fn doCollectFiles(this: *FilesTask) void {
        const lib = libarchive.lib;
        const archive = lib.Archive.readNew();
        defer _ = archive.readFree();
        configureArchiveReader(archive);

        if (archive.readOpenMemory(this.store.sharedView()) != .ok) {
            this.result = .{ .err = "Failed to open archive" };
            return;
        }

        var entries: FileEntryList = .empty;
        errdefer {
            for (entries.items) |entry| {
                bun.default_allocator.free(entry.path);
                bun.default_allocator.free(entry.data);
            }
            entries.deinit(bun.default_allocator);
        }

        var entry: *lib.Archive.Entry = undefined;
        while (archive.readNextHeader(&entry) == .ok) {
            // Only include regular files, not directories
            if (entry.filetype() != @intFromEnum(lib.FileType.regular)) {
                continue;
            }

            const pathname = entry.pathnameUtf8();
            const path_slice: []const u8 = pathname;

            // Apply glob filter if provided
            if (this.glob_pattern) |pattern| {
                if (!bun.glob.match(pattern, path_slice).matches()) {
                    continue;
                }
            }

            const size: usize = @intCast(@max(entry.size(), 0));

            // Copy the path
            const path_copy = bun.default_allocator.dupe(u8, path_slice) catch {
                this.result = .{ .err = "OutOfMemory" };
                return;
            };
            errdefer bun.default_allocator.free(path_copy);

            // Read the file data
            var data: []u8 = &.{};
            if (size > 0) {
                data = bun.default_allocator.alloc(u8, size) catch {
                    this.result = .{ .err = "OutOfMemory" };
                    return;
                };
                errdefer bun.default_allocator.free(data);

                var total_read: usize = 0;
                while (total_read < size) {
                    const read = archive.readData(data[total_read..]);
                    if (read < 0) {
                        this.result = .{ .err = "Failed to read archive entry data" };
                        return;
                    }
                    if (read == 0) break;
                    total_read += @intCast(read);
                }
            }

            entries.append(bun.default_allocator, .{
                .path = path_copy,
                .data = data,
                .mtime = entry.mtime(),
            }) catch {
                bun.default_allocator.free(path_copy);
                if (data.len > 0) bun.default_allocator.free(data);
                this.result = .{ .err = "OutOfMemory" };
                return;
            };
        }

        this.result = .{ .success = entries };
    }

    fn onFinish(this: *FilesTask) void {
        this.vm.enqueueTaskConcurrent(
            this.concurrent_task.from(this, .manual_deinit),
        );
    }

    pub fn runFromJS(this: *FilesTask) bun.JSTerminated!void {
        this.ref.unref(this.vm);

        defer {
            this.store.deref();
            if (this.glob_pattern) |p| bun.default_allocator.free(p);
            // Clean up entries
            if (this.result == .success) {
                for (this.result.success.items) |entry| {
                    bun.default_allocator.free(entry.path);
                    if (entry.data.len > 0) bun.default_allocator.free(entry.data);
                }
                this.result.success.deinit(bun.default_allocator);
            }
            bun.destroy(this);
        }

        if (this.vm.isShuttingDown()) {
            return;
        }

        const globalThis = this.vm.global;
        const promise = this.promise.swap();

        switch (this.result) {
            .success => |*entries| {
                // Create a new Map
                const map = jsc.JSMap.create(globalThis);
                const map_ptr = jsc.JSMap.fromJS(map) orelse {
                    try promise.reject(globalThis, globalThis.createErrorInstance("Failed to create Map", .{}));
                    return;
                };

                // Populate the map with File objects
                for (entries.items) |*entry| {
                    // Create the File (Blob with is_jsdom_file=true and name set)
                    // Blob takes ownership of entry.data
                    const blob_struct = jsc.WebCore.Blob.createWithBytesAndAllocator(
                        entry.data,
                        bun.default_allocator,
                        globalThis,
                        false,
                    );
                    entry.data = &.{}; // Ownership transferred to Blob

                    const blob_ptr = jsc.WebCore.Blob.new(blob_struct);
                    blob_ptr.is_jsdom_file = true;
                    blob_ptr.name = bun.String.cloneUTF8(entry.path);
                    blob_ptr.last_modified = @floatFromInt(entry.mtime * 1000);

                    // Use blob's name for map key (avoids second clone)
                    map_ptr.set(globalThis, blob_ptr.name.toJS(globalThis), blob_ptr.toJS(globalThis)) catch |err| {
                        try promise.reject(globalThis, globalThis.createErrorInstance("Failed to populate Map: {s}", .{@errorName(err)}));
                        return;
                    };
                }

                try promise.resolve(globalThis, map);
            },
            .err => |err_msg| {
                const err = globalThis.createErrorInstance("{s}", .{err_msg});
                try promise.reject(globalThis, err);
            },
            .pending => unreachable,
        }
    }
};

// Helper to compress data with gzip
fn compressGzip(data: []const u8) ![]u8 {
    const libdeflate = @import("../../deps/libdeflate.zig");
    libdeflate.load();

    const compressor = libdeflate.Compressor.alloc(6) orelse return error.GzipInitFailed;
    defer compressor.deinit();

    const max_size = compressor.maxBytesNeeded(data, .gzip);
    const output = bun.default_allocator.alloc(u8, max_size) catch return error.OutOfMemory;
    errdefer bun.default_allocator.free(output);

    const result = compressor.gzip(data, output);
    if (result.status != .success) {
        return error.GzipCompressFailed;
    }

    // Shrink to actual size. If realloc fails, return the original buffer slice.
    // This is a non-critical optimization - we accept slightly larger memory usage
    // rather than failing the entire operation.
    return bun.default_allocator.realloc(output, result.written) catch output[0..result.written];
}

/// Growing memory buffer for archive writes
const GrowingBuffer = struct {
    buffer: []u8,
    used: usize,
    allocator: std.mem.Allocator,
    had_error: bool,

    fn init(allocator: std.mem.Allocator) GrowingBuffer {
        return .{
            .buffer = &.{},
            .used = 0,
            .allocator = allocator,
            .had_error = false,
        };
    }

    fn deinit(self: *GrowingBuffer) void {
        if (self.buffer.len > 0) {
            self.allocator.free(self.buffer);
            self.buffer = &.{};
        }
    }

    fn ensureCapacity(self: *GrowingBuffer, needed: usize) bool {
        if (self.used + needed <= self.buffer.len) return true;

        const new_capacity = @max(self.buffer.len * 2, self.used + needed, 64 * 1024);
        if (self.buffer.len == 0) {
            self.buffer = self.allocator.alloc(u8, new_capacity) catch {
                self.had_error = true;
                return false;
            };
        } else {
            self.buffer = self.allocator.realloc(self.buffer, new_capacity) catch {
                self.had_error = true;
                return false;
            };
        }
        return true;
    }

    fn write(self: *GrowingBuffer, data: []const u8) bool {
        if (!self.ensureCapacity(data.len)) return false;
        @memcpy(self.buffer[self.used..][0..data.len], data);
        self.used += data.len;
        return true;
    }

    fn toOwnedSlice(self: *GrowingBuffer) ![]u8 {
        if (self.had_error) return error.OutOfMemory;
        if (self.used == 0) {
            self.deinit();
            return &.{};
        }
        const result = self.allocator.realloc(self.buffer, self.used) catch self.buffer[0..self.used];
        self.buffer = &.{};
        self.used = 0;
        return result;
    }

    // C callbacks for libarchive
    fn openCallback(_: *libarchive.lib.struct_archive, client_data: *anyopaque) callconv(.c) c_int {
        const self: *GrowingBuffer = @ptrCast(@alignCast(client_data));
        self.used = 0;
        self.had_error = false;
        return 0; // ARCHIVE_OK
    }

    fn writeCallback(_: *libarchive.lib.struct_archive, client_data: *anyopaque, buff: ?*const anyopaque, length: usize) callconv(.c) libarchive.lib.la_ssize_t {
        const self: *GrowingBuffer = @ptrCast(@alignCast(client_data));
        if (buff == null or length == 0) return 0;

        const data: [*]const u8 = @ptrCast(buff.?);
        if (!self.write(data[0..length])) {
            return -1; // ARCHIVE_FATAL
        }
        return @intCast(length);
    }

    fn closeCallback(_: *libarchive.lib.struct_archive, _: *anyopaque) callconv(.c) c_int {
        return 0; // ARCHIVE_OK
    }
};

// Build a tarball from a hashmap of entries using a growing memory buffer
fn buildTarballFromEntries(entries: bun.StringArrayHashMap([]u8), use_gzip: bool, allocator: std.mem.Allocator) ![]u8 {
    const lib = libarchive.lib;

    var growing_buffer = GrowingBuffer.init(allocator);
    errdefer growing_buffer.deinit();

    const archive = lib.Archive.writeNew();
    defer _ = archive.writeFree();

    // Set format to PAX (modern tar format)
    if (archive.writeSetFormatPaxRestricted() != .ok) {
        return error.ArchiveFormatError;
    }

    // Add gzip filter if requested
    if (use_gzip) {
        if (archive.writeAddFilterGzip() != .ok) {
            return error.ArchiveFilterError;
        }
    }

    // Open with our growing buffer callbacks
    const result = libarchive.lib.archive_write_open2(
        @ptrCast(archive),
        @ptrCast(&growing_buffer),
        &GrowingBuffer.openCallback,
        &GrowingBuffer.writeCallback,
        &GrowingBuffer.closeCallback,
        null,
    );
    if (result != 0) {
        return error.ArchiveOpenError;
    }

    const entry = lib.Archive.Entry.new();
    defer entry.free();

    const now_secs: isize = @intCast(@divTrunc(std.time.milliTimestamp(), 1000));

    // Write each entry
    var iter = entries.iterator();
    while (iter.next()) |kv| {
        const path = kv.key_ptr.*;
        const value = kv.value_ptr.*;

        // Clear and set up entry
        _ = entry.clear();
        // The path was allocated with dupeZ so it has a null terminator
        entry.setPathnameUtf8(path.ptr[0..path.len :0]);
        entry.setSize(@intCast(value.len));
        entry.setFiletype(@intFromEnum(lib.FileType.regular));
        entry.setPerm(0o644);
        entry.setMtime(now_secs, 0);

        // Write header
        if (archive.writeHeader(entry) != .ok) {
            return error.ArchiveHeaderError;
        }

        // Write data
        const written = archive.writeData(value);
        if (written < 0) {
            return error.ArchiveWriteError;
        }

        if (archive.writeFinishEntry() != .ok) {
            return error.ArchiveFinishEntryError;
        }
    }

    if (archive.writeClose() != .ok) {
        return error.ArchiveCloseError;
    }

    return growing_buffer.toOwnedSlice();
}

const libarchive = @import("../../libarchive/libarchive.zig");
const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
