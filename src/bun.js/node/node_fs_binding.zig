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

const NodeFSFunction = fn (
    this: *JSC.Node.NodeJSFS,
    globalObject: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue;

const NodeFSFunctionEnum = std.meta.DeclEnum(JSC.Node.NodeFS);

fn callSync(comptime FunctionEnum: NodeFSFunctionEnum) NodeFSFunction {
    const Function = @field(JSC.Node.NodeFS, @tagName(FunctionEnum));
    const FunctionType = @TypeOf(Function);

    const function: std.builtin.Type.Fn = comptime @typeInfo(FunctionType).Fn;
    comptime if (function.params.len != 3) @compileError("Expected 3 arguments");
    const Arguments = comptime function.params[1].type.?;
    const FormattedName = comptime [1]u8{std.ascii.toUpper(@tagName(FunctionEnum)[0])} ++ @tagName(FunctionEnum)[1..];
    const Result = comptime JSC.Maybe(@field(JSC.Node.NodeFS.ReturnType, FormattedName));
    _ = Result;

    const NodeBindingClosure = struct {
        pub fn bind(
            this: *JSC.Node.NodeJSFS,
            globalObject: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) JSC.JSValue {
            var exceptionref: JSC.C.JSValueRef = null;

            var arguments = callframe.arguments(8);

            var slice = ArgumentsSlice.init(globalObject.bunVM(), arguments.slice());
            defer slice.deinit();

            const args = if (comptime Arguments != void)
                (Arguments.fromJS(globalObject, &slice, &exceptionref) orelse {
                    // we might've already thrown
                    if (exceptionref != null)
                        globalObject.throwValue(JSC.JSValue.c(exceptionref));
                    return .zero;
                })
            else
                Arguments{};
            defer {
                if (comptime Arguments != void and @hasDecl(Arguments, "deinit")) args.deinit();
            }

            const exception1 = JSC.JSValue.c(exceptionref);

            if (exception1 != .zero) {
                globalObject.throwValue(exception1);
                return .zero;
            }
            var result = Function(
                &this.node_fs,
                args,
                comptime Flavor.sync,
            );
            switch (result) {
                .err => |err| {
                    globalObject.throwValue(JSC.JSValue.c(err.toJS(globalObject)));
                    return .zero;
                },
                .result => |*res| {
                    return globalObject.toJS(res, .temporary);
                },
            }
        }
    };

    return NodeBindingClosure.bind;
}

fn call(comptime FunctionEnum: NodeFSFunctionEnum) NodeFSFunction {
    const Function = @field(JSC.Node.NodeFS, @tagName(FunctionEnum));
    const FunctionType = @TypeOf(Function);

    const function: std.builtin.Type.Fn = comptime @typeInfo(FunctionType).Fn;
    comptime if (function.params.len != 3) @compileError("Expected 3 arguments");
    const Arguments = comptime function.params[1].type.?;
    const NodeBindingClosure = struct {
        pub fn bind(
            _: *JSC.Node.NodeJSFS,
            globalObject: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) JSC.JSValue {
            var arguments = callframe.arguments(8);

            var slice = ArgumentsSlice.init(globalObject.bunVM(), arguments.slice());
            slice.will_be_async = true;
            var exceptionref: JSC.C.JSValueRef = null;
            const args = if (comptime Arguments != void)
                (Arguments.fromJS(globalObject, &slice, &exceptionref) orelse {
                    // we might've already thrown
                    if (exceptionref != null)
                        globalObject.throwValue(JSC.JSValue.c(exceptionref));
                    slice.deinit();
                    return .zero;
                })
            else
                Arguments{};

            const exception1 = JSC.JSValue.c(exceptionref);

            if (exception1 != .zero) {
                globalObject.throwValue(exception1);

                slice.deinit();
                return .zero;
            }

            // TODO: handle globalObject.throwValue

            const Task = @field(JSC.Node.Async, @tagName(FunctionEnum));
            if (comptime FunctionEnum == .cp) {
                return Task.create(globalObject, args, globalObject.bunVM(), slice.arena);
            } else {
                if (comptime FunctionEnum == .readdir) {
                    if (args.recursive) {
                        return JSC.Node.Async.readdir_recursive.create(globalObject, args, globalObject.bunVM());
                    }
                }

                return Task.create(globalObject, args, globalObject.bunVM());
            }
        }
    };
    return NodeBindingClosure.bind;
}

pub const NodeJSFS = struct {
    node_fs: JSC.Node.NodeFS = .{},

    pub usingnamespace JSC.Codegen.JSNodeJSFS;
    pub usingnamespace bun.New(@This());

    pub fn constructor(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) ?*@This() {
        globalObject.throw("Not a constructor", .{});
        return null;
    }

    pub fn finalize(this: *JSC.Node.NodeJSFS) void {
        if (this.node_fs.vm) |vm| {
            if (vm.node_fs == &this.node_fs) {
                return;
            }
        }

        this.destroy();
    }

    pub const access = call(.access);
    pub const appendFile = call(.appendFile);
    pub const close = call(.close);
    pub const copyFile = call(.copyFile);
    pub const cp = call(.cp);
    pub const exists = call(.exists);
    pub const chown = call(.chown);
    pub const chmod = call(.chmod);
    pub const fchmod = call(.fchmod);
    pub const fchown = call(.fchown);
    pub const fstat = call(.fstat);
    pub const fsync = call(.fsync);
    pub const ftruncate = call(.ftruncate);
    pub const futimes = call(.futimes);
    pub const lchmod = call(.lchmod);
    pub const lchown = call(.lchown);
    pub const link = call(.link);
    pub const lstat = call(.lstat);
    pub const mkdir = call(.mkdir);
    pub const mkdtemp = call(.mkdtemp);
    pub const open = call(.open);
    pub const read = call(.read);
    pub const write = call(.write);
    pub const readdir = call(.readdir);
    pub const readFile = call(.readFile);
    pub const writeFile = call(.writeFile);
    pub const readlink = call(.readlink);
    pub const rm = call(.rm);
    pub const rmdir = call(.rmdir);
    pub const realpath = call(.realpath);
    pub const rename = call(.rename);
    pub const stat = call(.stat);
    pub const symlink = call(.symlink);
    pub const truncate = call(.truncate);
    pub const unlink = call(.unlink);
    pub const utimes = call(.utimes);
    pub const lutimes = call(.lutimes);
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
    pub const realpathSync = callSync(.realpath);
    pub const renameSync = callSync(.rename);
    pub const statSync = callSync(.stat);
    pub const symlinkSync = callSync(.symlink);
    pub const truncateSync = callSync(.truncate);
    pub const unlinkSync = callSync(.unlink);
    pub const utimesSync = callSync(.utimes);
    pub const lutimesSync = callSync(.lutimes);
    pub const rmSync = callSync(.rm);
    pub const rmdirSync = callSync(.rmdir);
    pub const writev = call(.writev);
    pub const writevSync = callSync(.writev);
    pub const readv = call(.readv);
    pub const readvSync = callSync(.readv);

    pub const fdatasyncSync = callSync(.fdatasync);
    pub const fdatasync = call(.fdatasync);

    pub fn getDirent(_: *NodeJSFS, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.Node.Dirent.getConstructor(globalThis);
    }

    pub fn getStats(_: *NodeJSFS, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.Node.StatsSmall.getConstructor(globalThis);
    }

    pub const watch = callSync(.watch);
    pub const watchFile = callSync(.watchFile);
    pub const unwatchFile = callSync(.unwatchFile);

    // Not implemented yet:
    const notimpl = fdatasync;
    pub const opendir = notimpl;
    pub const opendirSync = notimpl;
};

pub fn createBinding(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
    const module = NodeJSFS.new(.{});

    const vm = globalObject.bunVM();
    if (vm.standalone_module_graph != null)
        module.node_fs.vm = vm;

    return module.toJS(globalObject);
}
