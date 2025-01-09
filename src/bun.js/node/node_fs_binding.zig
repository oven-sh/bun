const bun = @import("root").bun;
const JSC = bun.JSC;
const std = @import("std");
const Flavor = JSC.Node.Flavor;
const ArgumentsSlice = JSC.Node.ArgumentsSlice;
const system = std.posix.system;
const Maybe = JSC.Maybe;
const Encoding = JSC.Node.Encoding;
const FeatureFlags = bun.FeatureFlags;
const Args = JSC.Node.NodeFS.Arguments;
const d = JSC.d;

const NodeFSFunction = fn (this: *JSC.Node.NodeJSFS, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue;

const NodeFSFunctionEnum = std.meta.DeclEnum(JSC.Node.NodeFS);

/// Returns bindings to call JSC.Node.NodeFS.<function>.
/// Async calls use a thread pool.
fn Bindings(comptime function_name: NodeFSFunctionEnum) type {
    const function = @field(JSC.Node.NodeFS, @tagName(function_name));
    const fn_info = @typeInfo(@TypeOf(function)).Fn;
    if (fn_info.params.len != 3) {
        @compileError("Expected fn(NodeFS, Arguments) Return for NodeFS." ++ @tagName(function_name));
    }
    const Arguments = fn_info.params[1].type.?;

    return struct {
        pub fn runSync(this: *JSC.Node.NodeJSFS, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            var slice = ArgumentsSlice.init(globalObject.bunVM(), callframe.arguments());
            defer slice.deinit();

            const args = if (Arguments != void)
                try Arguments.fromJS(globalObject, &slice);

            defer if (comptime Arguments != void and @hasDecl(Arguments, "deinit"))
                args.deinit();

            if (globalObject.hasException()) {
                return .zero;
            }

            var result = function(&this.node_fs, args, .sync);
            return switch (result) {
                .err => |err| globalObject.throwValue(JSC.JSValue.c(err.toJS(globalObject))),
                .result => |*res| globalObject.toJS(res, .temporary),
            };
        }

        pub fn runAsync(this: *JSC.Node.NodeJSFS, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            var slice = ArgumentsSlice.init(globalObject.bunVM(), callframe.arguments());
            slice.will_be_async = true;

            const args = if (Arguments != void)
                Arguments.fromJS(globalObject, &slice) catch |err| {
                    slice.deinit();
                    return err;
                };

            if (globalObject.hasException()) {
                slice.deinit();
                return .zero;
            }

            const Task = @field(JSC.Node.Async, @tagName(function_name));
            switch (comptime function_name) {
                .cp => return Task.create(globalObject, this, args, globalObject.bunVM(), slice.arena),
                .readdir => if (args.recursive) return JSC.Node.Async.readdir_recursive.create(globalObject, args, globalObject.bunVM()),
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

pub const NodeJSFS = struct {
    node_fs: JSC.Node.NodeFS = .{},

    pub usingnamespace JSC.Codegen.JSNodeJSFS;
    pub usingnamespace bun.New(@This());

    pub fn finalize(this: *JSC.Node.NodeJSFS) void {
        if (this.node_fs.vm) |vm| {
            if (vm.node_fs == &this.node_fs) {
                return;
            }
        }

        this.destroy();
    }

    pub fn getDirent(_: *NodeJSFS, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.Node.Dirent.getConstructor(globalThis);
    }

    pub fn getStats(_: *NodeJSFS, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.Node.StatsSmall.getConstructor(globalThis);
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
};

pub fn createBinding(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
    const module = NodeJSFS.new(.{});

    const vm = globalObject.bunVM();
    module.node_fs.vm = vm;

    return module.toJS(globalObject);
}

pub fn createMemfdForTesting(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callFrame.arguments_old(1);

    if (arguments.len < 1) {
        return .undefined;
    }

    if (comptime !bun.Environment.isLinux) {
        return globalObject.throw("memfd_create is not implemented on this platform", .{});
    }

    const size = arguments.ptr[0].toInt64();
    switch (bun.sys.memfd_create("my_memfd", std.os.linux.MFD.CLOEXEC)) {
        .result => |fd| {
            _ = bun.sys.ftruncate(fd, size);
            return JSC.JSValue.jsNumber(fd.cast());
        },
        .err => |err| {
            return globalObject.throwValue(err.toJSC(globalObject));
        },
    }
}
