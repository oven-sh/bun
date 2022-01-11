const JSC = @import("javascript_core");
const std = @import("std");
const Flavor = @import("./types.zig").Flavor;
const ArgumentsSlice = @import("./types.zig").ArgumentsSlice;
const system = std.os.system;
const Maybe = @import("./types.zig").Maybe;
const Encoding = @import("./types.zig").Encoding;
const Args = JSC.Node.NodeFS.Arguments;

const NodeFSFunction = fn (
    *JSC.Node.NodeFS,
    JSC.C.JSContextRef,
    JSC.C.JSObjectRef,
    JSC.C.JSObjectRef,
    []const JSC.C.JSValueRef,
    JSC.C.ExceptionRef,
) JSC.C.JSValueRef;

pub const toJSTrait = std.meta.trait.hasFn("toJS");
pub const fromJSTrait = std.meta.trait.hasFn("fromJS");
pub fn toJSWithType(comptime Type: type, value: Type, context: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
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
            this: *JSC.Node.NodeFS,
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
            this: *JSC.Node.NodeFS,
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
    JSC.Node.NodeFS,
    .{ .name = "fs" },

    .{
        .access = .{
            .name = "access",
            .rfn = call(JSC.Node.NodeFSaccess),
        },
        .appendFile = .{
            .name = "appendFile",
            .rfn = call(JSC.Node.NodeFSappendFile),
        },
        .close = .{
            .name = "close",
            .rfn = call(JSC.Node.NodeFSclose),
        },
        .copyFile = .{
            .name = "copyFile",
            .rfn = call(JSC.Node.NodeFScopyFile),
        },
        .exists = .{
            .name = "exists",
            .rfn = call(JSC.Node.NodeFSexists),
        },
        .chown = .{
            .name = "chown",
            .rfn = call(JSC.Node.NodeFSchown),
        },
        .chmod = .{
            .name = "chmod",
            .rfn = call(JSC.Node.NodeFSchmod),
        },
        .fchmod = .{
            .name = "fchmod",
            .rfn = call(JSC.Node.NodeFSfchmod),
        },
        .fchown = .{
            .name = "fchown",
            .rfn = call(JSC.Node.NodeFSfchown),
        },
        .fstat = .{
            .name = "fstat",
            .rfn = call(JSC.Node.NodeFSfstat),
        },
        .fsync = .{
            .name = "fsync",
            .rfn = call(JSC.Node.NodeFSfsync),
        },
        .ftruncate = .{
            .name = "ftruncate",
            .rfn = call(JSC.Node.NodeFSftruncate),
        },
        .futimes = .{
            .name = "futimes",
            .rfn = call(JSC.Node.NodeFSfutimes),
        },
        .lchmod = .{
            .name = "lchmod",
            .rfn = call(JSC.Node.NodeFSlchmod),
        },
        .lchown = .{
            .name = "lchown",
            .rfn = call(JSC.Node.NodeFSlchown),
        },
        .link = .{
            .name = "link",
            .rfn = call(JSC.Node.NodeFSlink),
        },
        .lstat = .{
            .name = "lstat",
            .rfn = call(JSC.Node.NodeFSlstat),
        },
        .mkdir = .{
            .name = "mkdir",
            .rfn = call(JSC.Node.NodeFSmkdir),
        },
        .mkdtemp = .{
            .name = "mkdtemp",
            .rfn = call(JSC.Node.NodeFSmkdtemp),
        },
        .open = .{
            .name = "open",
            .rfn = call(JSC.Node.NodeFSopen),
        },
        .read = .{
            .name = "read",
            .rfn = call(JSC.Node.NodeFSread),
        },
        .write = .{
            .name = "write",
            .rfn = call(JSC.Node.NodeFSwrite),
        },
        .readdir = .{
            .name = "readdir",
            .rfn = call(JSC.Node.NodeFSreaddir),
        },
        .readFile = .{
            .name = "readFile",
            .rfn = call(JSC.Node.NodeFSreadFile),
        },
        .writeFile = .{
            .name = "writeFile",
            .rfn = call(JSC.Node.NodeFSwriteFile),
        },
        .readlink = .{
            .name = "readlink",
            .rfn = call(JSC.Node.NodeFSreadlink),
        },
        .realpath = .{
            .name = "realpath",
            .rfn = call(JSC.Node.NodeFSrealpath),
        },
        .rename = .{
            .name = "rename",
            .rfn = call(JSC.Node.NodeFSrename),
        },
        .stat = .{
            .name = "stat",
            .rfn = call(JSC.Node.NodeFSstat),
        },
        .symlink = .{
            .name = "symlink",
            .rfn = call(JSC.Node.NodeFSsymlink),
        },
        .truncate = .{
            .name = "truncate",
            .rfn = call(JSC.Node.NodeFStruncate),
        },
        .unlink = .{
            .name = "unlink",
            .rfn = call(JSC.Node.NodeFSunlink),
        },
        .utimes = .{
            .name = "utimes",
            .rfn = call(JSC.Node.NodeFSutimes),
        },
        .lutimes = .{
            .name = "lutimes",
            .rfn = call(JSC.Node.NodeFSlutimes),
        },

        .accessSync = .{
            .name = "accessSync",
            .rfn = callSync(JSC.Node.NodeFSaccess),
        },
        .appendFileSync = .{
            .name = "appendFileSync",
            .rfn = callSync(JSC.Node.NodeFSappendFile),
        },
        .closeSync = .{
            .name = "closeSync",
            .rfn = callSync(JSC.Node.NodeFSclose),
        },
        .copyFileSync = .{
            .name = "copyFileSync",
            .rfn = callSync(JSC.Node.NodeFScopyFile),
        },
        .existsSync = .{
            .name = "existsSync",
            .rfn = callSync(JSC.Node.NodeFSexists),
        },
        .chownSync = .{
            .name = "chownSync",
            .rfn = callSync(JSC.Node.NodeFSchown),
        },
        .chmodSync = .{
            .name = "chmodSync",
            .rfn = callSync(JSC.Node.NodeFSchmod),
        },
        .fchmodSync = .{
            .name = "fchmodSync",
            .rfn = callSync(JSC.Node.NodeFSfchmod),
        },
        .fchownSync = .{
            .name = "fchownSync",
            .rfn = callSync(JSC.Node.NodeFSfchown),
        },
        .fstatSync = .{
            .name = "fstatSync",
            .rfn = callSync(JSC.Node.NodeFSfstat),
        },
        .fsyncSync = .{
            .name = "fsyncSync",
            .rfn = callSync(JSC.Node.NodeFSfsync),
        },
        .ftruncateSync = .{
            .name = "ftruncateSync",
            .rfn = callSync(JSC.Node.NodeFSftruncate),
        },
        .futimesSync = .{
            .name = "futimesSync",
            .rfn = callSync(JSC.Node.NodeFSfutimes),
        },
        .lchmodSync = .{
            .name = "lchmodSync",
            .rfn = callSync(JSC.Node.NodeFSlchmod),
        },
        .lchownSync = .{
            .name = "lchownSync",
            .rfn = callSync(JSC.Node.NodeFSlchown),
        },
        .linkSync = .{
            .name = "linkSync",
            .rfn = callSync(JSC.Node.NodeFSlink),
        },
        .lstatSync = .{
            .name = "lstatSync",
            .rfn = callSync(JSC.Node.NodeFSlstat),
        },
        .mkdirSync = .{
            .name = "mkdirSync",
            .rfn = callSync(JSC.Node.NodeFSmkdir),
        },
        .mkdtempSync = .{
            .name = "mkdtempSync",
            .rfn = callSync(JSC.Node.NodeFSmkdtemp),
        },
        .openSync = .{
            .name = "openSync",
            .rfn = callSync(JSC.Node.NodeFSopen),
        },
        .readSync = .{
            .name = "readSync",
            .rfn = callSync(JSC.Node.NodeFSread),
        },
        .writeSync = .{
            .name = "writeSync",
            .rfn = callSync(JSC.Node.NodeFSwrite),
        },
        .readdirSync = .{
            .name = "readdirSync",
            .rfn = callSync(JSC.Node.NodeFSreaddir),
        },
        .readFileSync = .{
            .name = "readFileSync",
            .rfn = callSync(JSC.Node.NodeFSreadFile),
        },
        .writeFileSync = .{
            .name = "writeFileSync",
            .rfn = callSync(JSC.Node.NodeFSwriteFile),
        },
        .readlinkSync = .{
            .name = "readlinkSync",
            .rfn = callSync(JSC.Node.NodeFSreadlink),
        },
        .realpathSync = .{
            .name = "realpathSync",
            .rfn = callSync(JSC.Node.NodeFSrealpath),
        },
        .renameSync = .{
            .name = "renameSync",
            .rfn = callSync(JSC.Node.NodeFSrename),
        },
        .statSync = .{
            .name = "statSync",
            .rfn = callSync(JSC.Node.NodeFSstat),
        },
        .symlinkSync = .{
            .name = "symlinkSync",
            .rfn = callSync(JSC.Node.NodeFSsymlink),
        },
        .truncateSync = .{
            .name = "truncateSync",
            .rfn = callSync(JSC.Node.NodeFStruncate),
        },
        .unlinkSync = .{
            .name = "unlinkSync",
            .rfn = callSync(JSC.Node.NodeFSunlink),
        },
        .utimesSync = .{
            .name = "utimesSync",
            .rfn = callSync(JSC.Node.NodeFSutimes),
        },
        .lutimesSync = .{
            .name = "lutimesSync",
            .rfn = callSync(JSC.Node.NodeFSlutimes),
        },
    },
    .{},
);
