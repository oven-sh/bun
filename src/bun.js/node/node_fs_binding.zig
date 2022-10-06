const JSC = @import("../../jsc.zig");
const std = @import("std");
const Flavor = JSC.Node.Flavor;
const ArgumentsSlice = JSC.Node.ArgumentsSlice;
const system = std.os.system;
const Maybe = JSC.Maybe;
const Encoding = JSC.Node.Encoding;
const FeatureFlags = @import("../../global.zig").FeatureFlags;
const Args = JSC.Node.NodeFS.Arguments;
const d = JSC.d;

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
const NodeFSFunctionEnum = JSC.Node.DeclEnum(JSC.Node.NodeFS);

fn callSync(comptime FunctionEnum: NodeFSFunctionEnum) NodeFSFunction {
    const Function = @field(JSC.Node.NodeFS, @tagName(FunctionEnum));
    const FunctionType = @TypeOf(Function);

    const function: std.builtin.TypeInfo.Fn = comptime @typeInfo(FunctionType).Fn;
    comptime if (function.args.len != 3) @compileError("Expected 3 arguments");
    const Arguments = comptime function.args[1].arg_type.?;
    const FormattedName = comptime [1]u8{std.ascii.toUpper(@tagName(FunctionEnum)[0])} ++ @tagName(FunctionEnum)[1..];
    const Result = comptime JSC.Maybe(@field(JSC.Node.NodeFS.ReturnType, FormattedName));

    const NodeBindingClosure = struct {
        pub fn bind(
            this: *JSC.Node.NodeFS,
            ctx: JSC.C.JSContextRef,
            _: JSC.C.JSObjectRef,
            _: JSC.C.JSObjectRef,
            arguments: []const JSC.C.JSValueRef,
            exception: JSC.C.ExceptionRef,
        ) JSC.C.JSValueRef {
            var slice = ArgumentsSlice.init(ctx.bunVM(), @ptrCast([*]const JSC.JSValue, arguments.ptr)[0..arguments.len]);
            defer slice.deinit();

            const args = if (comptime Arguments != void)
                (Arguments.fromJS(ctx, &slice, exception) orelse return null)
            else
                Arguments{};
            if (exception.* != null) return null;

            const result: Result = Function(
                this,
                args,
                comptime Flavor.sync,
            );
            return switch (result) {
                .err => |err| brk: {
                    exception.* = err.toJS(ctx);
                    break :brk null;
                },
                .result => |res| if (comptime Result.ReturnType != void)
                    JSC.To.JS.withType(Result.ReturnType, res, ctx, exception)
                else
                    JSC.C.JSValueMakeUndefined(ctx),
            };
        }
    };

    return NodeBindingClosure.bind;
}

fn call(comptime Function: NodeFSFunctionEnum) NodeFSFunction {
    // const FunctionType = @TypeOf(Function);
    _ = Function;

    // const function: std.builtin.TypeInfo.Fn = comptime @typeInfo(FunctionType).Fn;
    // comptime if (function.args.len != 3) @compileError("Expected 3 arguments");
    // const Arguments = comptime function.args[2].arg_type orelse @compileError(std.fmt.comptimePrint("Function {s} expected to have an arg type at [2]", .{@typeName(FunctionType)}));
    // const Result = comptime function.return_type.?;
    // comptime if (Arguments != void and !fromJSTrait(Arguments)) @compileError(std.fmt.comptimePrint("{s} is missing fromJS()", .{@typeName(Arguments)}));
    // comptime if (Result != void and !toJSTrait(Result)) @compileError(std.fmt.comptimePrint("{s} is missing toJS()", .{@typeName(Result)}));
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
            var err = JSC.SystemError{};
            exception.* = err.toErrorInstance(ctx.ptr()).asObjectRef();
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
    .{ .name = "fs", .ts = .{ .module = .{ .path = "fs" } } },

    .{
        .access = .{
            .name = "access",
            .rfn = call(.access),
        },
        .appendFile = .{
            .name = "appendFile",
            .rfn = call(.appendFile),
        },
        .close = .{
            .name = "close",
            .rfn = call(.close),
        },
        .copyFile = .{
            .name = "copyFile",
            .rfn = call(.copyFile),
        },
        .exists = .{
            .name = "exists",
            .rfn = call(.exists),
        },
        .chown = .{
            .name = "chown",
            .rfn = call(.chown),
        },
        .chmod = .{
            .name = "chmod",
            .rfn = call(.chmod),
        },
        .fchmod = .{
            .name = "fchmod",
            .rfn = call(.fchmod),
        },
        .fchown = .{
            .name = "fchown",
            .rfn = call(.fchown),
        },
        .fstat = .{
            .name = "fstat",
            .rfn = call(.fstat),
        },
        .fsync = .{
            .name = "fsync",
            .rfn = call(.fsync),
        },
        .ftruncate = .{
            .name = "ftruncate",
            .rfn = call(.ftruncate),
        },
        .futimes = .{
            .name = "futimes",
            .rfn = call(.futimes),
        },
        .lchmod = .{
            .name = "lchmod",
            .rfn = call(.lchmod),
        },
        .lchown = .{
            .name = "lchown",
            .rfn = call(.lchown),
        },
        .link = .{
            .name = "link",
            .rfn = call(.link),
        },
        .lstat = .{
            .name = "lstat",
            .rfn = call(.lstat),
        },
        .mkdir = .{
            .name = "mkdir",
            .rfn = call(.mkdir),
        },
        .mkdtemp = .{
            .name = "mkdtemp",
            .rfn = call(.mkdtemp),
        },
        .open = .{
            .name = "open",
            .rfn = call(.open),
        },
        .read = .{
            .name = "read",
            .rfn = call(.read),
        },
        .write = .{
            .name = "write",
            .rfn = call(.write),
        },
        .readdir = .{
            .name = "readdir",
            .rfn = call(.readdir),
        },
        .readFile = .{
            .name = "readFile",
            .rfn = call(.readFile),
        },
        .writeFile = .{
            .name = "writeFile",
            .rfn = call(.writeFile),
        },
        .readlink = .{
            .name = "readlink",
            .rfn = call(.readlink),
        },
        .rm = .{
            .name = "rm",
            .rfn = call(.rm),
        },
        .realpath = .{
            .name = "realpath",
            .rfn = call(.realpath),
        },
        .rename = .{
            .name = "rename",
            .rfn = call(.rename),
        },
        .stat = .{
            .name = "stat",
            .rfn = call(.stat),
        },
        .symlink = .{
            .name = "symlink",
            .rfn = call(.symlink),
        },
        .truncate = .{
            .name = "truncate",
            .rfn = call(.truncate),
        },
        .unlink = .{
            .name = "unlink",
            .rfn = call(.unlink),
        },
        .utimes = .{
            .name = "utimes",
            .rfn = call(.utimes),
        },
        .lutimes = .{
            .name = "lutimes",
            .rfn = call(.lutimes),
        },

        .createReadStream = .{
            .name = "createReadStream",
            .rfn = if (FeatureFlags.node_streams) callSync(.createReadStream) else call(.createReadStream),
        },

        .createWriteStream = .{
            .name = "createWriteStream",
            .rfn = if (FeatureFlags.node_streams) callSync(.createWriteStream) else call(.createWriteStream),
        },

        .accessSync = .{
            .name = "accessSync",
            .rfn = callSync(.access),
        },
        .appendFileSync = .{
            .name = "appendFileSync",
            .rfn = callSync(.appendFile),
        },
        .closeSync = .{
            .name = "closeSync",
            .rfn = callSync(.close),
        },
        .copyFileSync = .{
            .name = "copyFileSync",
            .rfn = callSync(.copyFile),
        },
        .existsSync = .{
            .name = "existsSync",
            .rfn = callSync(.exists),
        },
        .chownSync = .{
            .name = "chownSync",
            .rfn = callSync(.chown),
        },
        .chmodSync = .{
            .name = "chmodSync",
            .rfn = callSync(.chmod),
        },
        .fchmodSync = .{
            .name = "fchmodSync",
            .rfn = callSync(.fchmod),
        },
        .fchownSync = .{
            .name = "fchownSync",
            .rfn = callSync(.fchown),
        },
        .fstatSync = .{
            .name = "fstatSync",
            .rfn = callSync(.fstat),
        },
        .fsyncSync = .{
            .name = "fsyncSync",
            .rfn = callSync(.fsync),
        },
        .ftruncateSync = .{
            .name = "ftruncateSync",
            .rfn = callSync(.ftruncate),
        },
        .futimesSync = .{
            .name = "futimesSync",
            .rfn = callSync(.futimes),
        },
        .lchmodSync = .{
            .name = "lchmodSync",
            .rfn = callSync(.lchmod),
        },
        .lchownSync = .{
            .name = "lchownSync",
            .rfn = callSync(.lchown),
        },
        .linkSync = .{
            .name = "linkSync",
            .rfn = callSync(.link),
        },
        .lstatSync = .{
            .name = "lstatSync",
            .rfn = callSync(.lstat),
        },
        .mkdirSync = .{
            .name = "mkdirSync",
            .rfn = callSync(.mkdir),
        },
        .mkdtempSync = .{
            .name = "mkdtempSync",
            .rfn = callSync(.mkdtemp),
        },
        .openSync = .{
            .name = "openSync",
            .rfn = callSync(.open),
        },
        .readSync = .{
            .name = "readSync",
            .rfn = callSync(.read),
        },
        .writeSync = .{
            .name = "writeSync",
            .rfn = callSync(.write),
        },
        .readdirSync = .{
            .name = "readdirSync",
            .rfn = callSync(.readdir),
        },
        .readFileSync = .{
            .name = "readFileSync",
            .rfn = callSync(.readFile),
        },
        .writeFileSync = .{
            .name = "writeFileSync",
            .rfn = callSync(.writeFile),
        },
        .readlinkSync = .{
            .name = "readlinkSync",
            .rfn = callSync(.readlink),
        },
        .realpathSync = .{
            .name = "realpathSync",
            .rfn = callSync(.realpath),
        },
        .renameSync = .{
            .name = "renameSync",
            .rfn = callSync(.rename),
        },
        .statSync = .{
            .name = "statSync",
            .rfn = callSync(.stat),
        },
        .symlinkSync = .{
            .name = "symlinkSync",
            .rfn = callSync(.symlink),
        },
        .truncateSync = .{
            .name = "truncateSync",
            .rfn = callSync(.truncate),
        },
        .unlinkSync = .{
            .name = "unlinkSync",
            .rfn = callSync(.unlink),
        },
        .utimesSync = .{
            .name = "utimesSync",
            .rfn = callSync(.utimes),
        },
        .lutimesSync = .{
            .name = "lutimesSync",
            .rfn = callSync(.lutimes),
        },
        .rmSync = .{
            .name = "rmSync",
            .rfn = callSync(.rm),
        },
    },
    .{},
);
