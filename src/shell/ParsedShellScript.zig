const ParsedShellScript = @This();

pub const js = jsc.Codegen.JSParsedShellScript;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

args: ?*ShellArgs = null,
/// allocated with arena in jsobjs
jsobjs: std.array_list.Managed(JSValue),
export_env: ?EnvMap = null,
quiet: bool = false,
cwd: ?bun.String = null,
this_jsvalue: JSValue = .zero,
estimated_size_for_gc: usize = 0,

fn #computeEstimatedSizeForGC(this: *const ParsedShellScript) usize {
    var size: usize = @sizeOf(ParsedShellScript);
    if (this.args) |args| {
        size += args.memoryCost();
    }
    if (this.export_env) |*env| {
        size += env.memoryCost();
    }
    if (this.cwd) |*cwd| {
        size += cwd.estimatedSize();
    }
    size += std.mem.sliceAsBytes(this.jsobjs.allocatedSlice()).len;
    return size;
}

pub fn memoryCost(this: *const ParsedShellScript) usize {
    return this.#computeEstimatedSizeForGC();
}

pub fn estimatedSize(this: *const ParsedShellScript) usize {
    return this.estimated_size_for_gc;
}

pub fn take(
    this: *ParsedShellScript,
    _: *jsc.JSGlobalObject,
    out_args: **ShellArgs,
    out_jsobjs: *std.array_list.Managed(JSValue),
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
    this.jsobjs = std.array_list.Managed(JSValue).init(bun.default_allocator);
    this.cwd = null;
    this.export_env = null;
}

pub fn finalize(
    this: *ParsedShellScript,
) void {
    this.this_jsvalue = .zero;

    if (this.export_env) |*env| env.deinit();
    if (this.cwd) |*cwd| cwd.deref();
    if (this.args) |a| a.deinit();
    bun.destroy(this);
}

pub fn setCwd(this: *ParsedShellScript, globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments_ = callframe.arguments_old(2);
    var arguments = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    const str_js = arguments.nextEat() orelse {
        return globalThis.throw("$`...`.cwd(): expected a string argument", .{});
    };
    const str = try bun.String.fromJS(str_js, globalThis);
    this.cwd = str;
    return .js_undefined;
}

pub fn setQuiet(this: *ParsedShellScript, _: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arg = callframe.argument(0);
    this.quiet = arg.toBoolean();
    return .js_undefined;
}

pub fn setEnv(this: *ParsedShellScript, globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const value1 = callframe.argument(0).getObject() orelse {
        return globalThis.throwInvalidArguments("env must be an object", .{});
    };

    var object_iter = try jsc.JSPropertyIterator(.{
        .skip_empty_name = false,
        .include_value = true,
    }).init(globalThis, value1);
    defer object_iter.deinit();

    var env: EnvMap = EnvMap.init(bun.default_allocator);
    env.ensureTotalCapacity(object_iter.len);

    // If the env object does not include a $PATH, it must disable path lookup for argv[0]
    // PATH = "";

    while (try object_iter.next()) |key| {
        const keyslice = bun.handleOom(key.toOwnedSlice(bun.default_allocator));
        var value = object_iter.value;
        if (value.isUndefined()) continue;

        const value_str = try value.getZigString(globalThis);
        const slice = bun.handleOom(value_str.toOwnedSlice(bun.default_allocator));
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

pub const createParsedShellScript = jsc.MarkedArgumentBuffer.wrap(createParsedShellScriptImpl);

fn createParsedShellScriptImpl(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, marked_argument_buffer: *jsc.MarkedArgumentBuffer) bun.JSError!JSValue {
    var shargs = ShellArgs.init();
    var needs_to_free_shargs = true;
    defer if (needs_to_free_shargs) shargs.deinit();

    const arguments_ = callframe.arguments_old(2);
    const arguments = arguments_.slice();
    if (arguments.len < 2) {
        return globalThis.throwNotEnoughArguments("Bun.$", 2, arguments.len);
    }
    const string_args = arguments[0];
    const template_args_js = arguments[1];
    var template_args = try template_args_js.arrayIterator(globalThis);

    var stack_alloc = std.heap.stackFallback(@sizeOf(bun.String) * 4, shargs.arena_allocator());
    var jsstrings = try std.array_list.Managed(bun.String).initCapacity(stack_alloc.get(), 4);
    defer {
        for (jsstrings.items[0..]) |bunstr| {
            bunstr.deref();
        }
        jsstrings.deinit();
    }
    var jsobjs = std.array_list.Managed(JSValue).init(shargs.arena_allocator());
    var script = std.array_list.Managed(u8).init(shargs.arena_allocator());
    try bun.shell.shellCmdFromJS(globalThis, string_args, &template_args, &jsobjs, &jsstrings, &script, marked_argument_buffer);

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
    parsed_shell_script.estimated_size_for_gc = parsed_shell_script.#computeEstimatedSizeForGC();
    const this_jsvalue = jsc.Codegen.JSParsedShellScript.toJSWithValues(parsed_shell_script, globalThis, marked_argument_buffer);
    parsed_shell_script.this_jsvalue = this_jsvalue;

    bun.analytics.Features.shell += 1;
    needs_to_free_shargs = false;
    return this_jsvalue;
}

const std = @import("std");

const interpreter = @import("./interpreter.zig");
const ShellArgs = interpreter.ShellArgs;

const bun = @import("bun");
const assert = bun.assert;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;

const CallFrame = jsc.CallFrame;
const ArgumentsSlice = jsc.CallFrame.ArgumentsSlice;

const shell = bun.shell;
const EnvMap = shell.EnvMap;
const EnvStr = shell.EnvStr;
const Interpreter = shell.Interpreter;
