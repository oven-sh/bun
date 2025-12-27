const Directory = @This();

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const strings = bun.strings;
const Environment = bun.Environment;

pub const js = jsc.Codegen.JSDirectory;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

const DirIterator = bun.DirIterator;
const Dirent = bun.jsc.Node.Dirent;

/// The path to the directory. This is stored as a string and the directory
/// is NOT opened until files() or filesSync() is called - this is the lazy
/// loading pattern similar to Bun.file().
path: bun.String,

/// Construct a Directory from JavaScript arguments.
/// Called when: `new Bun.Directory(path)` or `Bun.dir(path)`
pub fn constructor(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*Directory {
    const alloc = bun.default_allocator;
    const arguments = callframe.arguments_old(1).slice();

    if (arguments.len == 0) {
        return globalObject.throwInvalidArguments("Expected directory path string", .{});
    }

    const path_arg = arguments[0];
    if (!path_arg.isString()) {
        return globalObject.throwInvalidArgumentTypeValue("path", "string", path_arg);
    }

    var path_string = try bun.String.fromJS(path_arg, globalObject);

    if (path_string.isEmpty()) {
        return globalObject.throwInvalidArguments("Path cannot be empty", .{});
    }

    // Store the path - we don't open the directory yet (lazy loading)
    const dir = bun.handleOom(alloc.create(Directory));
    dir.* = .{ .path = path_string };
    return dir;
}

/// Called when the object is garbage collected
pub fn finalize(this: *Directory) callconv(.c) void {
    const alloc = bun.default_allocator;
    this.path.deref();
    alloc.destroy(this);
}

/// Get the path property
pub fn getPath(this: *Directory, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
    return this.path.toJS(globalObject);
}

/// Get the name property (basename of the directory)
pub fn getName(this: *Directory, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
    const path_slice = this.path.toUTF8(bun.default_allocator);
    defer path_slice.deinit();

    const basename = std.fs.path.basename(path_slice.slice());
    return bun.String.cloneUTF8(basename).toJS(globalObject);
}

/// Async version of files() - returns Promise<Dirent[]>
pub fn files(this: *Directory, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();

    // Create a strong reference to the path for the async task
    this.path.ref();

    var task = FilesTask.new(.{
        .path = this.path,
        .vm = vm,
    });

    task.promise = jsc.JSPromise.Strong.init(globalObject);
    task.any_task = jsc.AnyTask.New(FilesTask, &FilesTask.runFromJS).init(task);
    task.ref.ref(vm);
    jsc.WorkPool.schedule(&task.task);

    return task.promise.value();
}

/// Sync version of files() - returns Dirent[]
pub fn filesSync(this: *Directory, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const path_slice = this.path.toUTF8(bun.default_allocator);
    defer path_slice.deinit();

    return readDirectoryEntries(globalObject, path_slice.slice());
}

/// Read directory entries synchronously and return as JS array of Dirent objects
fn readDirectoryEntries(globalObject: *jsc.JSGlobalObject, path: []const u8) bun.JSError!jsc.JSValue {
    const path_z = bun.default_allocator.dupeZ(u8, path) catch return globalObject.throw("Out of memory", .{});
    defer bun.default_allocator.free(path_z);

    // Open the directory
    const flags = bun.O.DIRECTORY | bun.O.RDONLY;
    const fd = switch (bun.sys.open(path_z, flags, 0)) {
        .err => |err| {
            const js_err = err.withPath(path).toJS(globalObject);
            return globalObject.throwValue(js_err);
        },
        .result => |fd_result| fd_result,
    };
    defer fd.close();

    // Use the directory iterator
    var iterator = DirIterator.iterate(fd, .u8);

    // Collect entries
    var entries = std.ArrayListUnmanaged(Dirent){};
    defer {
        for (entries.items) |*item| {
            item.deref();
        }
        entries.deinit(bun.default_allocator);
    }

    var dirent_path = bun.String.cloneUTF8(path);
    defer dirent_path.deref();

    var entry = iterator.next();
    while (switch (entry) {
        .err => |err| {
            const js_err = err.withPath(path).toJS(globalObject);
            return globalObject.throwValue(js_err);
        },
        .result => |ent| ent,
    }) |current| : (entry = iterator.next()) {
        const utf8_name = current.name.slice();
        dirent_path.ref();
        entries.append(bun.default_allocator, .{
            .name = bun.String.cloneUTF8(utf8_name),
            .path = dirent_path,
            .kind = current.kind,
        }) catch return globalObject.throw("Out of memory", .{});
    }

    // Convert to JS array
    var array = try jsc.JSValue.createEmptyArray(globalObject, entries.items.len);
    var previous_jsstring: ?*jsc.JSString = null;

    for (entries.items, 0..) |*item, i| {
        const js_dirent = try item.toJS(globalObject, &previous_jsstring);
        try array.putIndex(globalObject, @truncate(i), js_dirent);
    }

    return array;
}

/// Async task for reading directory entries
const FilesTask = struct {
    task: jsc.WorkPoolTask = .{ .callback = &workPoolCallback },
    promise: jsc.JSPromise.Strong = .{},
    vm: *jsc.VirtualMachine,
    path: bun.String,
    any_task: jsc.AnyTask = undefined,
    ref: bun.Async.KeepAlive = .{},
    result: Result = undefined,

    const Result = union(enum) {
        success: []Dirent,
        err: bun.sys.Error,
    };

    pub const new = bun.TrivialNew(@This());

    fn workPoolCallback(task_ptr: *jsc.WorkPoolTask) void {
        const this: *FilesTask = @fieldParentPtr("task", task_ptr);
        defer this.vm.enqueueTaskConcurrent(jsc.ConcurrentTask.create(this.any_task.task()));

        const path_slice = this.path.toUTF8(bun.default_allocator);
        defer path_slice.deinit();

        const path_z = bun.default_allocator.dupeZ(u8, path_slice.slice()) catch {
            this.result = .{ .err = bun.sys.Error.fromCode(.NOMEM, .open) };
            return;
        };
        defer bun.default_allocator.free(path_z);

        // Open the directory
        const flags = bun.O.DIRECTORY | bun.O.RDONLY;
        const fd = switch (bun.sys.open(path_z, flags, 0)) {
            .err => |err| {
                this.result = .{ .err = err };
                return;
            },
            .result => |fd_result| fd_result,
        };
        defer fd.close();

        // Use the directory iterator
        var iterator = DirIterator.iterate(fd, .u8);

        // Collect entries
        var entries = std.ArrayListUnmanaged(Dirent){};

        var dirent_path = bun.String.cloneUTF8(path_slice.slice());
        defer dirent_path.deref();

        var entry = iterator.next();
        while (switch (entry) {
            .err => |err| {
                for (entries.items) |*item| {
                    item.deref();
                }
                entries.deinit(bun.default_allocator);
                this.result = .{ .err = err };
                return;
            },
            .result => |ent| ent,
        }) |current| : (entry = iterator.next()) {
            const utf8_name = current.name.slice();
            dirent_path.ref();
            entries.append(bun.default_allocator, .{
                .name = bun.String.cloneUTF8(utf8_name),
                .path = dirent_path,
                .kind = current.kind,
            }) catch {
                for (entries.items) |*item| {
                    item.deref();
                }
                entries.deinit(bun.default_allocator);
                this.result = .{ .err = bun.sys.Error.fromCode(.NOMEM, .open) };
                return;
            };
        }

        this.result = .{ .success = entries.toOwnedSlice(bun.default_allocator) catch &.{} };
    }

    pub fn runFromJS(this: *FilesTask) bun.JSTerminated!void {
        defer this.deinit();

        if (this.vm.isShuttingDown()) {
            return;
        }

        const globalObject = this.vm.global;
        const promise = this.promise.swap();

        switch (this.result) {
            .err => |err| {
                const js_err = err.toJS(globalObject);
                try promise.reject(globalObject, js_err);
            },
            .success => |entries| {
                defer bun.default_allocator.free(entries);

                // Convert to JS array
                var array = jsc.JSValue.createEmptyArray(globalObject, entries.len) catch {
                    for (entries) |*item| {
                        @constCast(item).deref();
                    }
                    try promise.reject(globalObject, globalObject.createErrorInstance("Out of memory", .{}));
                    return;
                };

                var previous_jsstring: ?*jsc.JSString = null;
                for (entries, 0..) |*item, i| {
                    const js_dirent = @constCast(item).toJS(globalObject, &previous_jsstring) catch {
                        for (entries[i..]) |*remaining| {
                            @constCast(remaining).deref();
                        }
                        // An exception is already pending from toJS, so we just return
                        return error.JSTerminated;
                    };
                    array.putIndex(globalObject, @truncate(i), js_dirent) catch {
                        for (entries[i + 1 ..]) |*remaining| {
                            @constCast(remaining).deref();
                        }
                        return error.JSTerminated;
                    };
                }

                try promise.resolve(globalObject, array);
            },
        }
    }

    fn deinit(this: *FilesTask) void {
        this.ref.unref(this.vm);
        this.path.deref();
        this.promise.deinit();
        bun.destroy(this);
    }
};

comptime {
    _ = js;
}
