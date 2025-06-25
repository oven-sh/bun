pub const js = JSC.Codegen.JSParsedShellScript;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

args: ?*ShellArgs = null,
/// allocated with arena in jsobjs
jsobjs: std.ArrayList(JSValue),
export_env: ?EnvMap = null,
quiet: bool = false,
cwd: ?bun.String = null,
this_jsvalue: JSValue = .zero,

pub fn take(
    this: *ParsedShellScript,
    _: *JSC.JSGlobalObject,
    out_args: **ShellArgs,
    out_jsobjs: *std.ArrayList(JSValue),
    out_quiet: *bool,
    out_cwd: *?bun.String,
    out_export_env: *?EnvMap,
) void {
    out_args.* = this.args.?;
    out_jsobjs.* = this.jsobjs;
    out_quiet.* = this.quiet;
    out_cwd.* = this.cwd;
    out_export_env.* = this.export_env;

    this.args = null;
    this.jsobjs = std.ArrayList(JSValue).init(bun.default_allocator);
    this.cwd = null;
    this.export_env = null;
}

pub fn finalize(
    this: *ParsedShellScript,
) void {
    this.this_jsvalue = .zero;

    if (this.export_env) |*env| env.deinit();
    if (this.cwd) |*cwd| cwd.deref();
    for (this.jsobjs.items) |jsobj| {
        jsobj.unprotect();
    }
    if (this.args) |a| a.deinit();
    bun.destroy(this);
}

pub fn setCwd(this: *ParsedShellScript, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments_ = callframe.arguments_old(2);
    var arguments = JSC.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    const str_js = arguments.nextEat() orelse {
        return globalThis.throw("$`...`.cwd(): expected a string argument", .{});
    };
    const str = try bun.String.fromJS(str_js, globalThis);
    this.cwd = str;
    return .js_undefined;
}

pub fn setQuiet(this: *ParsedShellScript, _: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    this.quiet = true;
    return .js_undefined;
}

pub fn setEnv(this: *ParsedShellScript, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const value1 = callframe.argument(0).getObject() orelse {
        return globalThis.throwInvalidArguments("env must be an object", .{});
    };

    var object_iter = try JSC.JSPropertyIterator(.{
        .skip_empty_name = false,
        .include_value = true,
    }).init(globalThis, value1);
    defer object_iter.deinit();

    var env: EnvMap = EnvMap.init(bun.default_allocator);
    env.ensureTotalCapacity(object_iter.len);

    // If the env object does not include a $PATH, it must disable path lookup for argv[0]
    // PATH = "";

    while (try object_iter.next()) |key| {
        const keyslice = key.toOwnedSlice(bun.default_allocator) catch bun.outOfMemory();
        var value = object_iter.value;
        if (value.isUndefined()) continue;

        const value_str = try value.getZigString(globalThis);
        const slice = value_str.toOwnedSlice(bun.default_allocator) catch bun.outOfMemory();
        const keyref = EnvStr.initRefCounted(keyslice);
        defer keyref.deref();
        const valueref = EnvStr.initRefCounted(slice);
        defer valueref.deref();

        env.insert(keyref, valueref);
    }
    if (this.export_env) |*previous| {
        previous.deinit();
    }
    this.export_env = env;
    return .js_undefined;
}

pub fn createParsedShellScript(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    var shargs = ShellArgs.init();

    const arguments_ = callframe.arguments_old(2);
    const arguments = arguments_.slice();
    if (arguments.len < 2) {
        return globalThis.throwNotEnoughArguments("Bun.$", 2, arguments.len);
    }
    const string_args = arguments[0];
    const template_args_js = arguments[1];
    var template_args = try template_args_js.arrayIterator(globalThis);

    var stack_alloc = std.heap.stackFallback(@sizeOf(bun.String) * 4, shargs.arena_allocator());
    var jsstrings = try std.ArrayList(bun.String).initCapacity(stack_alloc.get(), 4);
    defer {
        for (jsstrings.items[0..]) |bunstr| {
            bunstr.deref();
        }
        jsstrings.deinit();
    }
    var jsobjs = std.ArrayList(JSValue).init(shargs.arena_allocator());
    var script = std.ArrayList(u8).init(shargs.arena_allocator());
    try bun.shell.shellCmdFromJS(globalThis, string_args, &template_args, &jsobjs, &jsstrings, &script);

    var parser: ?bun.shell.Parser = null;
    var lex_result: ?shell.LexResult = null;
    const script_ast = Interpreter.parse(
        shargs.arena_allocator(),
        script.items[0..],
        jsobjs.items[0..],
        jsstrings.items[0..],
        &parser,
        &lex_result,
    ) catch |err| {
        if (err == shell.ParseError.Lex) {
            assert(lex_result != null);
            const str = lex_result.?.combineErrors(shargs.arena_allocator());
            return globalThis.throwPretty("{s}", .{str});
        }

        if (parser) |*p| {
            if (bun.Environment.allow_assert) {
                assert(p.errors.items.len > 0);
            }
            const errstr = p.combineErrors();
            return globalThis.throwPretty("{s}", .{errstr});
        }

        return globalThis.throwError(err, "failed to lex/parse shell");
    };

    shargs.script_ast = script_ast;

    const parsed_shell_script = bun.new(ParsedShellScript, .{
        .args = shargs,
        .jsobjs = jsobjs,
    });
    parsed_shell_script.this_jsvalue = JSC.Codegen.JSParsedShellScript.toJS(parsed_shell_script, globalThis);

    bun.Analytics.Features.shell += 1;
    return parsed_shell_script.this_jsvalue;
}

const ParsedShellScript = @This();
const bun = @import("bun");
const shell = bun.shell;
const Interpreter = shell.Interpreter;
const interpreter = @import("./interpreter.zig");
const EnvMap = shell.EnvMap;
const EnvStr = shell.EnvStr;
const JSC = bun.JSC;
const ShellArgs = interpreter.ShellArgs;
const std = @import("std");
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const CallFrame = JSC.CallFrame;
const ArgumentsSlice = JSC.CallFrame.ArgumentsSlice;
const assert = bun.assert;
