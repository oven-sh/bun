const JSC = @import("javascript_core");
const NodeFS = @import("./node_fs.zig").NodeFS;
const std = @import("std");
const Flavor = @import("./types.zig").Flavor;
const ArgumentsSlice = @import("./types.zig").ArgumentsSlice;
const system = std.os.system;
const Maybe = @import("./types.zig").Maybe;
const Encoding = @import("./types.zig").Encoding;
const Args = NodeFS.Arguments;

const NodeFSFunction = fn (
    *NodeFS,
    JSC.C.JSContextRef,
    JSC.C.JSObjectRef,
    JSC.C.JSObjectRef,
    []const JSC.C.JSValueRef,
    JSC.C.ExceptionRef,
) JSC.C.JSValueRef;

pub const toJSTrait = std.meta.trait.hasFn("toJS");
pub const fromJSTrait = std.meta.trait.hasFn("fromJS");
fn toJSWithType(comptime Type: type, value: Type, context: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
    switch (comptime Type) {
        void => JSC.C.JSValueMakeUndefined(context),
        bool => JSC.C.JSValueMakeBoolean(context, value),
        []const u8, [:0]const u8, [*:0]const u8, []u8, [:0]u8, [*:0]u8 => {
            var zig_str = JSC.ZigString.init(value);
            zig_str.detectEncoding();
            return zig_str.toValueAuto(context.asJSGlobalObject()).asObjectRef();
        },

        else => {
            if (comptime std.meta.trait.isNumber(Type)) {
                return JSC.JSValue.jsNumberWithType(Type, value).asRef();
            }

            if (comptime std.meta.trait.isZigString(Type)) {
                var zig_str = JSC.ZigString.init(value);
                return zig_str.toValue(context.asJSGlobalObject()).asObjectRef();
            }

            return value.toJS(context, exception).asObjectRef();
        },
    }
}

fn callSync(comptime Function: anytype) NodeFSFunction {
    const FunctionType = @TypeOf(Function);

    const function: std.builtin.TypeInfo.Fn = comptime @typeInfo(FunctionType).Fn;
    comptime if (function.args.len != 3) @compileError("Expected 3 arguments");
    const Arguments = comptime function.args[2].arg_type.?;
    const Result = comptime function.return_type.?;

    const NodeBindingClosure = struct {
        pub fn bind(
            this: *NodeFS,
            ctx: JSC.C.JSContextRef,
            _: JSC.C.JSObjectRef,
            _: JSC.C.JSObjectRef,
            arguments: []const JSC.C.JSValueRef,
            exception: JSC.C.ExceptionRef,
        ) JSC.C.JSValueRef {
            var slice = ArgumentsSlice.init(arguments);

            defer {
                // TODO: fix this
                for (arguments.len) |arg| {
                    JSC.C.JSValueUnprotect(ctx, arg);
                }
                slice.arena.deinit();
            }

            const args = if (comptime Arguments != void)
                Arguments.fromJS(ctx, &slice, exception)
            else
                Arguments{};
            if (exception.* != null) return null;

            const result: Maybe(Result) = Function(this, comptime Flavor.sync, args);
            switch (result) {
                .err => |err| {
                    exception.* = err.toJS(ctx);
                    return null;
                },
                .result => |res| toJSWithType(Result, res, ctx, exception),
            }

            unreachable;
        }
    };

    return NodeBindingClosure.bind;
}

fn call(comptime Function: anytype) NodeFSFunction {
    const FunctionType = @TypeOf(Function);

    const function: std.builtin.TypeInfo.Fn = comptime @typeInfo(FunctionType).Fn;
    comptime if (function.args.len != 3) @compileError("Expected 3 arguments");
    const Arguments = comptime function.args[2].arg_type.?;
    const Result = comptime function.return_type.?;
    comptime if (Arguments != void and !fromJSTrait(Arguments)) @compileError(std.fmt.comptimePrint("{s} is missing fromJS()", .{@typeName(Arguments)}));
    comptime if (Result != void and !toJSTrait(Result)) @compileError(std.fmt.comptimePrint("{s} is missing toJS()", .{@typeName(Result)}));
    const NodeBindingClosure = struct {
        pub fn bind(
            this: *NodeFS,
            ctx: JSC.C.JSContextRef,
            _: JSC.C.JSObjectRef,
            _: JSC.C.JSObjectRef,
            arguments: []const JSC.C.JSValueRef,
            exception: JSC.C.ExceptionRef,
        ) JSC.C.JSValueRef {
            _ = this;
            _ = ctx;
            _ = arguments;
            exception.* = JSC.Node.SystemError.Class.make(ctx, &JSC.Node.SystemError.todo);
            return null;
            // var slice = ArgumentsSlice.init(arguments);

            // defer {
            //     for (arguments.len) |arg| {
            //         JSC.C.JSValueUnprotect(ctx, arg);
            //     }
            //     slice.arena.deinit();
            // }

            // const args = if (comptime Arguments != void)
            //     Arguments.fromJS(ctx, &slice, exception)
            // else
            //     Arguments{};
            // if (exception.* != null) return null;

            // const result: Maybe(Result) = Function(this, comptime Flavor.sync, args);
            // switch (result) {
            //     .err => |err| {
            //         exception.* = err.toJS(ctx);
            //         return null;
            //     },
            //     .result => |res| {
            //         return switch (comptime Result) {
            //             void => JSC.JSValue.jsUndefined().asRef(),
            //             else => res.toJS(ctx),
            //         };
            //     },
            // }
            // unreachable;
        }
    };
    return NodeBindingClosure.bind;
}

pub const NodeFSBindings = JSC.NewClass(
    NodeFS,
    .{ .name = "fs" },

    .{
        .access = .{
            .name = "access",
            .rfn = call(NodeFS.access),
        },
        .appendFile = .{
            .name = "appendFile",
            .rfn = call(NodeFS.appendFile),
        },
        .close = .{
            .name = "close",
            .rfn = call(NodeFS.close),
        },
        .copyFile = .{
            .name = "copyFile",
            .rfn = call(NodeFS.copyFile),
        },
        .exists = .{
            .name = "exists",
            .rfn = call(NodeFS.exists),
        },
        .chown = .{
            .name = "chown",
            .rfn = call(NodeFS.chown),
        },
        .chmod = .{
            .name = "chmod",
            .rfn = call(NodeFS.chmod),
        },
        .fchmod = .{
            .name = "fchmod",
            .rfn = call(NodeFS.fchmod),
        },
        .fchown = .{
            .name = "fchown",
            .rfn = call(NodeFS.fchown),
        },
        .fstat = .{
            .name = "fstat",
            .rfn = call(NodeFS.fstat),
        },
        .fsync = .{
            .name = "fsync",
            .rfn = call(NodeFS.fsync),
        },
        .ftruncate = .{
            .name = "ftruncate",
            .rfn = call(NodeFS.ftruncate),
        },
        .futimes = .{
            .name = "futimes",
            .rfn = call(NodeFS.futimes),
        },
        .lchmod = .{
            .name = "lchmod",
            .rfn = call(NodeFS.lchmod),
        },
        .lchown = .{
            .name = "lchown",
            .rfn = call(NodeFS.lchown),
        },
        .link = .{
            .name = "link",
            .rfn = call(NodeFS.link),
        },
        .lstat = .{
            .name = "lstat",
            .rfn = call(NodeFS.lstat),
        },
        .mkdir = .{
            .name = "mkdir",
            .rfn = call(NodeFS.mkdir),
        },
        .mkdtemp = .{
            .name = "mkdtemp",
            .rfn = call(NodeFS.mkdtemp),
        },
        .open = .{
            .name = "open",
            .rfn = call(NodeFS.open),
        },
        .read = .{
            .name = "read",
            .rfn = call(NodeFS.read),
        },
        .write = .{
            .name = "write",
            .rfn = call(NodeFS.write),
        },
        .readdir = .{
            .name = "readdir",
            .rfn = call(NodeFS.readdir),
        },
        .readFile = .{
            .name = "readFile",
            .rfn = call(NodeFS.readFile),
        },
        .writeFile = .{
            .name = "writeFile",
            .rfn = call(NodeFS.writeFile),
        },
        .readlink = .{
            .name = "readlink",
            .rfn = call(NodeFS.readlink),
        },
        .realpath = .{
            .name = "realpath",
            .rfn = call(NodeFS.realpath),
        },
        .rename = .{
            .name = "rename",
            .rfn = call(NodeFS.rename),
        },
        .stat = .{
            .name = "stat",
            .rfn = call(NodeFS.stat),
        },
        .symlink = .{
            .name = "symlink",
            .rfn = call(NodeFS.symlink),
        },
        .truncate = .{
            .name = "truncate",
            .rfn = call(NodeFS.truncate),
        },
        .unlink = .{
            .name = "unlink",
            .rfn = call(NodeFS.unlink),
        },
        .utimes = .{
            .name = "utimes",
            .rfn = call(NodeFS.utimes),
        },
        .lutimes = .{
            .name = "lutimes",
            .rfn = call(NodeFS.lutimes),
        },

        .accessSync = .{
            .name = "accessSync",
            .rfn = callSync(NodeFS.access),
        },
        .appendFileSync = .{
            .name = "appendFileSync",
            .rfn = callSync(NodeFS.appendFile),
        },
        .closeSync = .{
            .name = "closeSync",
            .rfn = callSync(NodeFS.close),
        },
        .copyFileSync = .{
            .name = "copyFileSync",
            .rfn = callSync(NodeFS.copyFile),
        },
        .existsSync = .{
            .name = "existsSync",
            .rfn = callSync(NodeFS.exists),
        },
        .chownSync = .{
            .name = "chownSync",
            .rfn = callSync(NodeFS.chown),
        },
        .chmodSync = .{
            .name = "chmodSync",
            .rfn = callSync(NodeFS.chmod),
        },
        .fchmodSync = .{
            .name = "fchmodSync",
            .rfn = callSync(NodeFS.fchmod),
        },
        .fchownSync = .{
            .name = "fchownSync",
            .rfn = callSync(NodeFS.fchown),
        },
        .fstatSync = .{
            .name = "fstatSync",
            .rfn = callSync(NodeFS.fstat),
        },
        .fsyncSync = .{
            .name = "fsyncSync",
            .rfn = callSync(NodeFS.fsync),
        },
        .ftruncateSync = .{
            .name = "ftruncateSync",
            .rfn = callSync(NodeFS.ftruncate),
        },
        .futimesSync = .{
            .name = "futimesSync",
            .rfn = callSync(NodeFS.futimes),
        },
        .lchmodSync = .{
            .name = "lchmodSync",
            .rfn = callSync(NodeFS.lchmod),
        },
        .lchownSync = .{
            .name = "lchownSync",
            .rfn = callSync(NodeFS.lchown),
        },
        .linkSync = .{
            .name = "linkSync",
            .rfn = callSync(NodeFS.link),
        },
        .lstatSync = .{
            .name = "lstatSync",
            .rfn = callSync(NodeFS.lstat),
        },
        .mkdirSync = .{
            .name = "mkdirSync",
            .rfn = callSync(NodeFS.mkdir),
        },
        .mkdtempSync = .{
            .name = "mkdtempSync",
            .rfn = callSync(NodeFS.mkdtemp),
        },
        .openSync = .{
            .name = "openSync",
            .rfn = callSync(NodeFS.open),
        },
        .readSync = .{
            .name = "readSync",
            .rfn = callSync(NodeFS.read),
        },
        .writeSync = .{
            .name = "writeSync",
            .rfn = callSync(NodeFS.write),
        },
        .readdirSync = .{
            .name = "readdirSync",
            .rfn = callSync(NodeFS.readdir),
        },
        .readFileSync = .{
            .name = "readFileSync",
            .rfn = callSync(NodeFS.readFile),
        },
        .writeFileSync = .{
            .name = "writeFileSync",
            .rfn = callSync(NodeFS.writeFile),
        },
        .readlinkSync = .{
            .name = "readlinkSync",
            .rfn = callSync(NodeFS.readlink),
        },
        .realpathSync = .{
            .name = "realpathSync",
            .rfn = callSync(NodeFS.realpath),
        },
        .renameSync = .{
            .name = "renameSync",
            .rfn = callSync(NodeFS.rename),
        },
        .statSync = .{
            .name = "statSync",
            .rfn = callSync(NodeFS.stat),
        },
        .symlinkSync = .{
            .name = "symlinkSync",
            .rfn = callSync(NodeFS.symlink),
        },
        .truncateSync = .{
            .name = "truncateSync",
            .rfn = callSync(NodeFS.truncate),
        },
        .unlinkSync = .{
            .name = "unlinkSync",
            .rfn = callSync(NodeFS.unlink),
        },
        .utimesSync = .{
            .name = "utimesSync",
            .rfn = callSync(NodeFS.utimes),
        },
        .lutimesSync = .{
            .name = "lutimesSync",
            .rfn = callSync(NodeFS.lutimes),
        },
    },
    .{},
);
