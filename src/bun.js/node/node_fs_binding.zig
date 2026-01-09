const NodeFSFunction = fn (this: *jsc.Node.fs.Binding, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue;

const NodeFSFunctionEnum = std.meta.DeclEnum(node.fs.NodeFS);

/// Returns bindings to call jsc.Node.fs.NodeFS.<function>.
/// Async calls use a thread pool.
fn Bindings(comptime function_name: NodeFSFunctionEnum) type {
    const function = @field(jsc.Node.fs.NodeFS, @tagName(function_name));
    const fn_info = @typeInfo(@TypeOf(function)).@"fn";
    if (fn_info.params.len != 3) {
        @compileError("Expected fn(NodeFS, Arguments) Return for NodeFS." ++ @tagName(function_name));
    }
    const Arguments = fn_info.params[1].type.?;

    return struct {
        pub fn runSync(this: *Binding, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            var slice = ArgumentsSlice.init(globalObject.bunVM(), callframe.arguments());
            defer slice.deinit();

            const args = if (Arguments != void)
                try Arguments.fromJS(globalObject, &slice);

            defer if (comptime Arguments != void and @hasDecl(Arguments, "deinit"))
                args.deinit();

            if (globalObject.hasException()) {
                return .zero;
            }

            // Check permissions before executing the operation
            if (comptime Arguments != void) {
                try checkFsPermission(function_name, globalObject, args);
            }

            var result = function(&this.node_fs, args, .sync);
            return switch (result) {
                .err => |err| globalObject.throwValue(err.toJS(globalObject)),
                .result => |*res| globalObject.toJS(res),
            };
        }

        pub fn runAsync(this: *Binding, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            var slice = ArgumentsSlice.init(globalObject.bunVM(), callframe.arguments());
            slice.will_be_async = true;
            var deinit = false;

            defer if (deinit) slice.deinit();

            var args = if (Arguments != void)
                Arguments.fromJS(globalObject, &slice) catch |err| {
                    deinit = true;
                    return err;
                };

            defer if (deinit) args.deinit();

            if (globalObject.hasException()) {
                deinit = true;
                return .zero;
            }

            // Check permissions before executing the operation
            if (comptime Arguments != void) {
                checkFsPermission(function_name, globalObject, args) catch |err| {
                    deinit = true;
                    return err;
                };
            }

            const have_abort_signal = @hasField(Arguments, "signal");
            if (have_abort_signal) check_early_abort: {
                const signal = args.signal orelse break :check_early_abort;
                if (signal.reasonIfAborted(globalObject)) |reason| {
                    deinit = true;
                    return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalObject, reason.toJS(globalObject));
                }
            }

            const Task = @field(node.fs.Async, @tagName(function_name));
            switch (comptime function_name) {
                .cp => return Task.create(globalObject, this, args, globalObject.bunVM(), slice.arena),
                .readdir => if (args.recursive) return node.fs.AsyncReaddirRecursiveTask.create(globalObject, args, globalObject.bunVM()),
                else => {},
            }
            return Task.create(globalObject, this, args, globalObject.bunVM());
        }
    };
}

fn callAsync(comptime FunctionEnum: NodeFSFunctionEnum) NodeFSFunction {
    return Bindings(FunctionEnum).runAsync;
}
fn callSync(comptime FunctionEnum: NodeFSFunctionEnum) NodeFSFunction {
    return Bindings(FunctionEnum).runSync;
}

pub const Binding = struct {
    node_fs: node.fs.NodeFS = .{},

    pub const js = jsc.Codegen.JSNodeJSFS;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    pub const new = bun.TrivialNew(@This());

    pub fn finalize(this: *Binding) void {
        if (this.node_fs.vm) |vm| {
            if (vm.node_fs == &this.node_fs) {
                return;
            }
        }

        bun.destroy(this);
    }

    pub fn getDirent(_: *Binding, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        return jsc.Node.Dirent.getConstructor(globalThis);
    }

    pub fn getStats(_: *Binding, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        return jsc.Node.StatsSmall.getConstructor(globalThis);
    }

    pub const access = callAsync(.access);
    pub const appendFile = callAsync(.appendFile);
    pub const close = callAsync(.close);
    pub const copyFile = callAsync(.copyFile);
    pub const cp = callAsync(.cp);
    pub const exists = callAsync(.exists);
    pub const chown = callAsync(.chown);
    pub const chmod = callAsync(.chmod);
    pub const fchmod = callAsync(.fchmod);
    pub const fchown = callAsync(.fchown);
    pub const fstat = callAsync(.fstat);
    pub const fsync = callAsync(.fsync);
    pub const ftruncate = callAsync(.ftruncate);
    pub const futimes = callAsync(.futimes);
    pub const lchmod = callAsync(.lchmod);
    pub const lchown = callAsync(.lchown);
    pub const link = callAsync(.link);
    pub const lstat = callAsync(.lstat);
    pub const mkdir = callAsync(.mkdir);
    pub const mkdtemp = callAsync(.mkdtemp);
    pub const open = callAsync(.open);
    pub const read = callAsync(.read);
    pub const write = callAsync(.write);
    pub const readdir = callAsync(.readdir);
    pub const readFile = callAsync(.readFile);
    pub const writeFile = callAsync(.writeFile);
    pub const readlink = callAsync(.readlink);
    pub const rm = callAsync(.rm);
    pub const rmdir = callAsync(.rmdir);
    pub const realpath = callAsync(.realpathNonNative);
    pub const realpathNative = callAsync(.realpath);
    pub const rename = callAsync(.rename);
    pub const stat = callAsync(.stat);
    pub const statfs = callAsync(.statfs);
    pub const symlink = callAsync(.symlink);
    pub const truncate = callAsync(.truncate);
    pub const unlink = callAsync(.unlink);
    pub const utimes = callAsync(.utimes);
    pub const lutimes = callAsync(.lutimes);
    pub const accessSync = callSync(.access);
    pub const appendFileSync = callSync(.appendFile);
    pub const closeSync = callSync(.close);
    pub const cpSync = callSync(.cp);
    pub const copyFileSync = callSync(.copyFile);
    pub const existsSync = callSync(.exists);
    pub const chownSync = callSync(.chown);
    pub const chmodSync = callSync(.chmod);
    pub const fchmodSync = callSync(.fchmod);
    pub const fchownSync = callSync(.fchown);
    pub const fstatSync = callSync(.fstat);
    pub const fsyncSync = callSync(.fsync);
    pub const ftruncateSync = callSync(.ftruncate);
    pub const futimesSync = callSync(.futimes);
    pub const lchmodSync = callSync(.lchmod);
    pub const lchownSync = callSync(.lchown);
    pub const linkSync = callSync(.link);
    pub const lstatSync = callSync(.lstat);
    pub const mkdirSync = callSync(.mkdir);
    pub const mkdtempSync = callSync(.mkdtemp);
    pub const openSync = callSync(.open);
    pub const readSync = callSync(.read);
    pub const writeSync = callSync(.write);
    pub const readdirSync = callSync(.readdir);
    pub const readFileSync = callSync(.readFile);
    pub const writeFileSync = callSync(.writeFile);
    pub const readlinkSync = callSync(.readlink);
    pub const realpathSync = callSync(.realpathNonNative);
    pub const realpathNativeSync = callSync(.realpath);
    pub const renameSync = callSync(.rename);
    pub const statSync = callSync(.stat);
    pub const statfsSync = callSync(.statfs);
    pub const symlinkSync = callSync(.symlink);
    pub const truncateSync = callSync(.truncate);
    pub const unlinkSync = callSync(.unlink);
    pub const utimesSync = callSync(.utimes);
    pub const lutimesSync = callSync(.lutimes);
    pub const rmSync = callSync(.rm);
    pub const rmdirSync = callSync(.rmdir);
    pub const writev = callAsync(.writev);
    pub const writevSync = callSync(.writev);
    pub const readv = callAsync(.readv);
    pub const readvSync = callSync(.readv);
    pub const fdatasyncSync = callSync(.fdatasync);
    pub const fdatasync = callAsync(.fdatasync);
    pub const watch = callSync(.watch);
    pub const watchFile = callSync(.watchFile);
    pub const unwatchFile = callSync(.unwatchFile);
    // pub const statfs = callAsync(.statfs);
    // pub const statfsSync = callSync(.statfs);
};

pub fn createBinding(globalObject: *jsc.JSGlobalObject) jsc.JSValue {
    const module = Binding.new(.{});

    const vm = globalObject.bunVM();
    module.node_fs.vm = vm;

    return module.toJS(globalObject);
}

pub fn createMemfdForTesting(globalObject: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callFrame.arguments_old(1);

    if (arguments.len < 1) {
        return .js_undefined;
    }

    if (comptime !bun.Environment.isLinux) {
        return globalObject.throw("memfd_create is not implemented on this platform", .{});
    }

    const size = arguments.ptr[0].toInt64();
    switch (bun.sys.memfd_create("my_memfd", .non_executable)) {
        .result => |fd| {
            _ = bun.sys.ftruncate(fd, size);
            return jsc.JSValue.jsNumber(fd.cast());
        },
        .err => |err| {
            return globalObject.throwValue(err.toJS(globalObject));
        },
    }
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const node = bun.api.node;
const ArgumentsSlice = jsc.CallFrame.ArgumentsSlice;
const permission_check = bun.permission_check;
const permissions = bun.permissions;

/// Determine what permission is required for a filesystem operation
fn getRequiredPermission(comptime function_name: NodeFSFunctionEnum) ?struct { kind: permissions.Kind, needs_path: bool } {
    return switch (function_name) {
        // Read operations
        .access, .exists, .lstat, .stat, .readFile, .readdir, .readlink, .realpath, .realpathNonNative => .{ .kind = .read, .needs_path = true },
        .fstat, .read, .readv => .{ .kind = .read, .needs_path = false }, // FD-based, no path check

        // Write operations
        .appendFile, .writeFile, .chmod, .chown, .lchmod, .lchown, .link, .mkdir, .mkdtemp, .rm, .rmdir, .symlink, .truncate, .unlink, .utimes, .lutimes, .rename => .{ .kind = .write, .needs_path = true },
        .fchmod, .fchown, .fsync, .fdatasync, .ftruncate, .futimes, .write, .writev, .close => .{ .kind = .write, .needs_path = false }, // FD-based

        // Both read and write
        .copyFile, .cp => .{ .kind = .write, .needs_path = true }, // Requires both, check write as it's more restrictive

        // Open can be read or write depending on flags - check at a lower level
        .open => null,

        // Watch operations - read permission
        .watch, .watchFile, .unwatchFile => .{ .kind = .read, .needs_path = true },

        // statfs - sys permission
        .statfs => null, // Special handling needed

        // Internal helpers and other functions don't need permission checks here
        else => null,
    };
}

/// Check permission for a filesystem operation
fn checkFsPermission(comptime function_name: NodeFSFunctionEnum, globalObject: *jsc.JSGlobalObject, args: anytype) bun.JSError!void {
    const ArgsType = @TypeOf(args);

    // Get the required permission for this operation
    const required = comptime getRequiredPermission(function_name);
    if (comptime required == null) {
        return;
    }

    // If this is an FD-based operation, we can't easily check permissions
    // because we'd need to track which FD was opened with which permissions
    if (comptime !required.?.needs_path) {
        return;
    }

    // Handle multi-path operations (rename, link, symlink, cp, copyFile)
    // These need to check both source and destination paths
    if (comptime @hasField(ArgsType, "old_path") and @hasField(ArgsType, "new_path")) {
        // rename, link: check write on both paths
        const old_path = args.old_path.slice();
        const new_path = args.new_path.slice();
        const resolved_old = resolvePath(globalObject, old_path, &path_resolve_buf);
        const resolved_new = resolvePath(globalObject, new_path, &path_resolve_buf2);
        try permission_check.requireWrite(globalObject, resolved_old);
        try permission_check.requireWrite(globalObject, resolved_new);
        return;
    }

    if (comptime @hasField(ArgsType, "target_path") and @hasField(ArgsType, "new_path")) {
        // symlink: check read on target, write on new_path
        const target_path = args.target_path.slice();
        const new_path = args.new_path.slice();
        const resolved_target = resolvePath(globalObject, target_path, &path_resolve_buf);
        const resolved_new = resolvePath(globalObject, new_path, &path_resolve_buf2);
        try permission_check.requireRead(globalObject, resolved_target);
        try permission_check.requireWrite(globalObject, resolved_new);
        return;
    }

    if (comptime @hasField(ArgsType, "src") and @hasField(ArgsType, "dest")) {
        // cp, copyFile: check read on src, write on dest
        const src_path = args.src.slice();
        const dest_path = args.dest.slice();
        const resolved_src = resolvePath(globalObject, src_path, &path_resolve_buf);
        const resolved_dest = resolvePath(globalObject, dest_path, &path_resolve_buf2);
        try permission_check.requireRead(globalObject, resolved_src);
        try permission_check.requireWrite(globalObject, resolved_dest);
        return;
    }

    // Extract the path from the arguments (single-path operations)
    const path_slice: ?[]const u8 = blk: {
        // Different argument types have different field names for the path
        if (comptime @hasField(ArgsType, "path")) {
            const path_field = args.path;
            if (@TypeOf(path_field) == node.PathOrFileDescriptor) {
                // PathOrFileDescriptor can be a path or file descriptor
                if (path_field == .path) {
                    break :blk path_field.path.slice();
                }
                // File descriptor - can't easily check permissions
                break :blk null;
            } else {
                // PathLike or optional PathLike
                if (@typeInfo(@TypeOf(path_field)) == .optional) {
                    if (path_field) |p| {
                        break :blk p.slice();
                    }
                    break :blk null;
                } else {
                    break :blk path_field.slice();
                }
            }
        } else if (comptime @hasField(ArgsType, "file")) {
            const file_field = args.file;
            if (@TypeOf(file_field) == node.PathOrFileDescriptor) {
                if (file_field == .path) {
                    break :blk file_field.path.slice();
                }
                break :blk null;
            }
        }
        break :blk null;
    };

    // If we couldn't extract a path (e.g., FD-based operation), skip check
    if (path_slice == null) {
        return;
    }

    // Resolve relative paths to absolute paths
    const resolved_path = resolvePath(globalObject, path_slice.?, &path_resolve_buf);

    // Check the permission
    switch (required.?.kind) {
        .read => try permission_check.requireRead(globalObject, resolved_path),
        .write => try permission_check.requireWrite(globalObject, resolved_path),
        else => {},
    }
}

/// Resolve a path to an absolute path using the current working directory
fn resolvePath(globalObject: *jsc.JSGlobalObject, path: []const u8, buf: *[bun.MAX_PATH_BYTES]u8) []const u8 {
    // If it's already an absolute path, use it directly
    if (bun.path.Platform.auto.isAbsolute(path)) {
        return path;
    }
    // Otherwise, resolve it relative to the cwd
    const cwd = globalObject.bunVM().transpiler.fs.top_level_dir;
    return bun.path.joinAbsStringBuf(cwd, buf, &.{path}, .auto);
}

threadlocal var path_resolve_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
threadlocal var path_resolve_buf2: [bun.MAX_PATH_BYTES]u8 = undefined;
