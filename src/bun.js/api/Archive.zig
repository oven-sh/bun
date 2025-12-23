const Archive = @This();

pub const js = jsc.Codegen.JSArchive;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

const log = bun.Output.scoped(.Archive, .hidden);

/// The underlying data for the archive - owned bytes
data: []u8,
allocator: std.mem.Allocator,

pub fn finalize(this: *Archive) void {
    jsc.markBinding(@src());
    this.allocator.free(this.data);
    bun.destroy(this);
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
    const args = callframe.arguments_old(1);
    if (args.len < 1) {
        return globalThis.throwInvalidArguments("Archive.from requires an argument", .{});
    }

    return fromValue(globalThis, args.ptr[0]);
}

/// Create archive from a value (helper for both from() and write())
fn fromValue(globalThis: *jsc.JSGlobalObject, arg: jsc.JSValue) bun.JSError!jsc.JSValue {
    const allocator = bun.default_allocator;

    // Check if it's a typed array, ArrayBuffer, or similar - copy immediately
    if (arg.asArrayBuffer(globalThis)) |array_buffer| {
        const data = try allocator.dupe(u8, array_buffer.slice());
        return createArchive(globalThis, data, allocator);
    }

    // Check if it's a Blob - copy immediately
    if (arg.as(jsc.WebCore.Blob)) |blob_ptr| {
        const data = try allocator.dupe(u8, blob_ptr.sharedView());
        return createArchive(globalThis, data, allocator);
    }

    // Check if it's an object with entries (plain object)
    if (arg.isObject()) {
        return fromObject(globalThis, arg);
    }

    return globalThis.throwInvalidArguments("Archive.from expects an object, Blob, TypedArray, or ArrayBuffer", .{});
}

fn createArchive(globalThis: *jsc.JSGlobalObject, data: []u8, allocator: std.mem.Allocator) jsc.JSValue {
    const archive = bun.new(Archive, .{
        .data = data,
        .allocator = allocator,
    });
    return archive.toJS(globalThis);
}

fn fromObject(globalThis: *jsc.JSGlobalObject, obj: jsc.JSValue) bun.JSError!jsc.JSValue {
    const allocator = bun.default_allocator;

    const js_obj = obj.getObject() orelse {
        return globalThis.throwInvalidArguments("Archive.from expects an object", .{});
    };

    // Collect entries first
    var entries = std.StringArrayHashMap([]u8).init(allocator);
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
    const archive_bytes = buildTarballFromEntries(entries, false, allocator) catch |err| {
        return globalThis.throwInvalidArguments("Failed to create tarball: {s}", .{@errorName(err)});
    };

    return createArchive(globalThis, archive_bytes, allocator);
}

fn getEntryDataCopy(globalThis: *jsc.JSGlobalObject, value: jsc.JSValue, allocator: std.mem.Allocator) bun.JSError![]u8 {
    // Check for TypedArray/ArrayBuffer first - copy immediately
    if (value.asArrayBuffer(globalThis)) |array_buffer| {
        return allocator.dupe(u8, array_buffer.slice());
    }

    // Check for Blob - copy immediately
    if (value.as(jsc.WebCore.Blob)) |blob_ptr| {
        return allocator.dupe(u8, blob_ptr.sharedView());
    }

    // Check for string - copy immediately
    if (value.isString()) {
        const str = try value.toSlice(globalThis, allocator);
        defer str.deinit();
        return allocator.dupe(u8, str.slice());
    }

    return globalThis.throwInvalidArguments("Archive entry value must be a Blob, string, TypedArray, or ArrayBuffer", .{});
}

/// Static method: Archive.write(path, data, compress?)
/// Creates and writes an archive to disk in one operation
pub fn write(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments_old(3);
    if (args.len < 2) {
        return globalThis.throwInvalidArguments("Archive.write requires at least 2 arguments (path, data)", .{});
    }

    const path_arg = args.ptr[0];
    const data_arg = args.ptr[1];
    const compress_arg = if (args.len > 2) args.ptr[2] else jsc.JSValue.js_undefined;

    // Get the path
    if (!path_arg.isString()) {
        return globalThis.throwInvalidArguments("Archive.write: first argument must be a string path", .{});
    }

    const path_slice = try path_arg.toSlice(globalThis, bun.default_allocator);
    defer path_slice.deinit();

    // Determine compression
    const use_gzip = try parseCompressArg(globalThis, compress_arg);

    // Get archive data directly without creating an intermediate Archive object
    const archive_data = try getArchiveData(globalThis, data_arg);
    errdefer bun.default_allocator.free(archive_data);

    // Create write task - it takes ownership of archive_data
    const task = WriteTask.createWithData(globalThis, archive_data, path_slice.slice(), use_gzip);
    const promise_js = task.promise.value();
    task.schedule();

    return promise_js;
}

/// Get archive data from a value without creating an Archive object
fn getArchiveData(globalThis: *jsc.JSGlobalObject, arg: jsc.JSValue) bun.JSError![]u8 {
    const allocator = bun.default_allocator;

    // Check if it's a typed array, ArrayBuffer, or similar - copy immediately
    if (arg.asArrayBuffer(globalThis)) |array_buffer| {
        return allocator.dupe(u8, array_buffer.slice());
    }

    // Check if it's a Blob - copy immediately
    if (arg.as(jsc.WebCore.Blob)) |blob_ptr| {
        return allocator.dupe(u8, blob_ptr.sharedView());
    }

    // Check if it's an existing Archive
    if (fromJS(arg)) |archive| {
        return allocator.dupe(u8, archive.data);
    }

    // Check if it's an object with entries (plain object) - build tarball
    if (arg.isObject()) {
        return getArchiveDataFromObject(globalThis, arg);
    }

    return globalThis.throwInvalidArguments("Archive.write expects an object, Blob, TypedArray, ArrayBuffer, or Archive", .{});
}

/// Build archive data from an object without creating an Archive object
fn getArchiveDataFromObject(globalThis: *jsc.JSGlobalObject, obj: jsc.JSValue) bun.JSError![]u8 {
    const allocator = bun.default_allocator;

    const js_obj = obj.getObject() orelse {
        return globalThis.throwInvalidArguments("Archive.write expects an object", .{});
    };

    // Collect entries first
    var entries = std.StringArrayHashMap([]u8).init(allocator);
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

fn parseCompressArg(globalThis: *jsc.JSGlobalObject, arg: jsc.JSValue) bun.JSError!bool {
    if (arg.isUndefinedOrNull()) {
        return false;
    }

    if (arg.isString()) {
        const str = try arg.toSlice(globalThis, bun.default_allocator);
        defer str.deinit();
        if (std.mem.eql(u8, str.slice(), "gzip")) {
            return true;
        }
        return globalThis.throwInvalidArguments("Archive: compress argument must be 'gzip' or undefined", .{});
    }

    return globalThis.throwInvalidArguments("Archive: compress argument must be 'gzip' or undefined", .{});
}

/// Instance method: archive.extract(path)
/// Extracts the archive to the given path
/// Returns Promise<number> with count of extracted files
pub fn extract(this: *Archive, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments_old(1);
    if (args.len < 1) {
        return globalThis.throwInvalidArguments("Archive.extract requires a path argument", .{});
    }

    const path_arg = args.ptr[0];
    if (!path_arg.isString()) {
        return globalThis.throwInvalidArguments("Archive.extract: first argument must be a string path", .{});
    }

    const path_slice = try path_arg.toSlice(globalThis, bun.default_allocator);
    defer path_slice.deinit();

    // Create extract task (it manages its own promise)
    const task = ExtractTask.create(globalThis, this, path_slice.slice());
    const promise_js = task.promise.value();
    task.schedule();

    return promise_js;
}

/// Instance method: archive.blob(compress?)
/// Returns Promise<Blob> with the archive data
pub fn blob(this: *Archive, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments_old(1);
    const compress_arg = if (args.len > 0) args.ptr[0] else jsc.JSValue.js_undefined;

    const use_gzip = try parseCompressArg(globalThis, compress_arg);

    // Create blob task (it manages its own promise)
    const task = BlobTask.create(globalThis, this, use_gzip, .blob);
    const promise_js = task.promise.value();
    task.schedule();

    return promise_js;
}

/// Instance method: archive.bytes(compress?)
/// Returns Promise<Uint8Array> with the archive data
pub fn bytes(this: *Archive, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments_old(1);
    const compress_arg = if (args.len > 0) args.ptr[0] else jsc.JSValue.js_undefined;

    const use_gzip = try parseCompressArg(globalThis, compress_arg);

    // Create blob task (it manages its own promise)
    const task = BlobTask.create(globalThis, this, use_gzip, .bytes);
    const promise_js = task.promise.value();
    task.schedule();

    return promise_js;
}

// Task for extracting archives
pub const ExtractTask = struct {
    /// Owned copy of archive data (copied to avoid GC issues)
    archive_data: []u8,
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

    pub fn create(globalThis: *jsc.JSGlobalObject, archive: *Archive, path: []const u8) *ExtractTask {
        const vm = globalThis.bunVM();
        const extract_task = bun.new(ExtractTask, .{
            // Copy archive data to avoid GC issues - Archive could be finalized while task runs
            .archive_data = bun.default_allocator.dupe(u8, archive.data) catch @panic("OOM"),
            .path = bun.default_allocator.dupe(u8, path) catch @panic("OOM"),
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
            this.archive_data,
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
            bun.default_allocator.free(this.archive_data);
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

    /// Owned copy of archive data (copied to avoid GC issues)
    archive_data: []u8,
    use_gzip: bool,
    promise: jsc.JSPromise.Strong,
    vm: *jsc.VirtualMachine,
    output_type: OutputType,
    result: union(enum) {
        pending: void,
        success: []u8,
        err: []const u8,
    } = .pending,
    task: jsc.WorkPoolTask = .{ .callback = &run },
    concurrent_task: jsc.ConcurrentTask = .{},
    ref: bun.Async.KeepAlive = .{},

    pub fn create(globalThis: *jsc.JSGlobalObject, archive: *Archive, use_gzip: bool, output_type: OutputType) *BlobTask {
        const vm = globalThis.bunVM();
        const blob_task = bun.new(BlobTask, .{
            // Copy archive data to avoid GC issues - Archive could be finalized while task runs
            .archive_data = bun.default_allocator.dupe(u8, archive.data) catch @panic("OOM"),
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
            const compressed = compressGzip(this.archive_data) catch |err| {
                this.result = .{ .err = @errorName(err) };
                return;
            };
            this.result = .{ .success = compressed };
        } else {
            // Just copy the data (already have our own copy in archive_data)
            // Transfer ownership from archive_data to result
            this.result = .{ .success = this.archive_data };
            this.archive_data = &.{}; // Ownership transferred
        }
    }

    fn onFinish(this: *BlobTask) void {
        this.vm.enqueueTaskConcurrent(
            this.concurrent_task.from(this, .manual_deinit),
        );
    }

    pub fn runFromJS(this: *BlobTask) bun.JSTerminated!void {
        defer {
            // Free archive_data if ownership wasn't transferred (gzip case or error)
            if (this.archive_data.len > 0) {
                bun.default_allocator.free(this.archive_data);
            }
            // Free result data on shutdown or error
            if (this.result == .success and this.result.success.len > 0) {
                // This only happens if we're shutting down or hit an error below
                // In normal success case, ownership is transferred to Blob/Buffer
            }
            bun.destroy(this);
        }

        this.ref.unref(this.vm);

        // Free result data on shutdown
        if (this.vm.isShuttingDown()) {
            if (this.result == .success) {
                bun.default_allocator.free(this.result.success);
                this.result = .pending; // Mark as freed
            }
            return;
        }

        const globalThis = this.vm.global;
        const promise = this.promise.swap();

        switch (this.result) {
            .success => |data| {
                switch (this.output_type) {
                    .blob => {
                        // Transfer ownership to Blob
                        const blob_struct = jsc.WebCore.Blob.createWithBytesAndAllocator(data, bun.default_allocator, globalThis, false);
                        const blob_ptr = jsc.WebCore.Blob.new(blob_struct);
                        this.result = .pending; // Ownership transferred
                        try promise.resolve(globalThis, blob_ptr.toJS(globalThis));
                    },
                    .bytes => {
                        // Transfer ownership to the buffer
                        const array = jsc.JSValue.createBuffer(globalThis, data);
                        this.result = .pending; // Ownership transferred
                        try promise.resolve(globalThis, array);
                    },
                }
            },
            .err => |err_msg| {
                const err = globalThis.createErrorInstance("{s}", .{err_msg});
                try promise.reject(globalThis, err);
            },
            .pending => unreachable,
        }
    }
};

// Task for writing archives to disk
pub const WriteTask = struct {
    /// Owned copy of archive data (copied to avoid GC issues)
    archive_data: []u8,
    path: []const u8,
    use_gzip: bool,
    promise: jsc.JSPromise.Strong,
    vm: *jsc.VirtualMachine,
    result: union(enum) {
        pending: void,
        success: void,
        err: []const u8,
    } = .pending,
    task: jsc.WorkPoolTask = .{ .callback = &run },
    concurrent_task: jsc.ConcurrentTask = .{},
    ref: bun.Async.KeepAlive = .{},

    pub fn create(globalThis: *jsc.JSGlobalObject, archive: *Archive, path: []const u8, use_gzip: bool) *WriteTask {
        const vm = globalThis.bunVM();
        const write_task = bun.new(WriteTask, .{
            // Copy archive data to avoid GC issues - Archive could be finalized while task runs
            .archive_data = bun.default_allocator.dupe(u8, archive.data) catch @panic("OOM"),
            .path = bun.default_allocator.dupe(u8, path) catch @panic("OOM"),
            .use_gzip = use_gzip,
            .promise = jsc.JSPromise.Strong.init(globalThis),
            .vm = vm,
        });
        write_task.ref.ref(vm);
        return write_task;
    }

    /// Create with pre-allocated data (takes ownership)
    pub fn createWithData(globalThis: *jsc.JSGlobalObject, archive_data: []u8, path: []const u8, use_gzip: bool) *WriteTask {
        const vm = globalThis.bunVM();
        const write_task = bun.new(WriteTask, .{
            // Takes ownership of archive_data
            .archive_data = archive_data,
            .path = bun.default_allocator.dupe(u8, path) catch @panic("OOM"),
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
            compressGzip(this.archive_data) catch |err| {
                this.result = .{ .err = @errorName(err) };
                return;
            }
        else
            this.archive_data;

        defer if (this.use_gzip) bun.default_allocator.free(data_to_write);

        // Write to file
        const path_z = bun.default_allocator.dupeZ(u8, this.path) catch {
            this.result = .{ .err = "out of memory" };
            return;
        };
        defer bun.default_allocator.free(path_z);

        const file = std.fs.cwd().createFile(path_z, .{}) catch |err| {
            this.result = .{ .err = @errorName(err) };
            return;
        };
        defer file.close();

        file.writeAll(data_to_write) catch |err| {
            this.result = .{ .err = @errorName(err) };
            return;
        };

        this.result = .{ .success = {} };
    }

    fn onFinish(this: *WriteTask) void {
        this.vm.enqueueTaskConcurrent(
            this.concurrent_task.from(this, .manual_deinit),
        );
    }

    pub fn runFromJS(this: *WriteTask) bun.JSTerminated!void {
        defer {
            bun.default_allocator.free(this.archive_data);
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
            .success => {
                try promise.resolve(globalThis, jsc.JSValue.js_undefined);
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

    // Shrink to actual size
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
fn buildTarballFromEntries(entries: std.StringArrayHashMap([]u8), use_gzip: bool, allocator: std.mem.Allocator) ![]u8 {
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
