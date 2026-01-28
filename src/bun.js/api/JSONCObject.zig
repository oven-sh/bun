pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const object = JSValue.createEmptyObject(globalThis, 1);
    object.put(
        globalThis,
        ZigString.static("parse"),
        jsc.JSFunction.create(
            globalThis,
            "parse",
            parse,
            1,
            .{},
        ),
    );

    return object;
}

pub fn parse(
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    var arena = bun.ArenaAllocator.init(globalThis.allocator());
    const allocator = arena.allocator();
    defer arena.deinit();

    var ast_memory_allocator = bun.handleOom(allocator.create(ast.ASTMemoryAllocator));
    var ast_scope = ast_memory_allocator.enter(allocator);
    defer ast_scope.exit();

    var log = logger.Log.init(default_allocator);
    defer log.deinit();
    const input_value = callframe.argument(0);
    if (input_value.isEmptyOrUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("Expected a string to parse", .{});
    }

    var input_slice = try input_value.toSlice(globalThis, bun.default_allocator);
    defer input_slice.deinit();
    const source = &logger.Source.initPathString("input.jsonc", input_slice.slice());
    const parse_result = json.parseTSConfig(source, &log, allocator, true) catch |err| {
        if (err == error.StackOverflow) {
            return globalThis.throwStackOverflow();
        }
        return globalThis.throwValue(try log.toJS(globalThis, default_allocator, "Failed to parse JSONC"));
    };

    return parse_result.toJS(allocator, globalThis) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.JSError => return error.JSError,
        error.JSTerminated => return error.JSTerminated,
        // JSONC parsing does not produce macros or identifiers
        else => unreachable,
    };
}

const bun = @import("bun");
const ast = bun.ast;
const default_allocator = bun.default_allocator;
const logger = bun.logger;
const json = bun.interchange.json;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
