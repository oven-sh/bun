pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const object = JSValue.createEmptyObject(globalThis, 1);
    object.put(
        globalThis,
        ZigString.static("parse"),
        jsc.JSFunction.create(globalThis, "parse", parse, 1, .{}),
    );
    return object;
}

pub fn parse(
    global: *jsc.JSGlobalObject,
    callFrame: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    var arena: bun.ArenaAllocator = .init(bun.default_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var ast_memory_allocator = bun.handleOom(allocator.create(ast.ASTMemoryAllocator));
    var ast_scope = ast_memory_allocator.enter(allocator);
    defer ast_scope.exit();

    const input_value = callFrame.argument(0);

    if (input_value.isEmptyOrUndefinedOrNull()) {
        return global.throwInvalidArguments("Expected a string to parse", .{});
    }

    const input: jsc.Node.BlobOrStringOrBuffer =
        try jsc.Node.BlobOrStringOrBuffer.fromJS(global, allocator, input_value) orelse input: {
            var str = try input_value.toBunString(global);
            defer str.deref();
            break :input .{ .string_or_buffer = .{ .string = str.toSlice(allocator) } };
        };
    defer input.deinit();

    var log = logger.Log.init(bun.default_allocator);
    defer log.deinit();

    const source = &logger.Source.initPathString("input.xml", input.slice());

    const root = bun.interchange.xml.XML.parse(source, &log, allocator) catch |err| return switch (err) {
        error.OutOfMemory => |oom| oom,
        error.StackOverflow => global.throwStackOverflow(),
        else => {
            if (log.msgs.items.len > 0) {
                const first_msg = log.msgs.items[0];
                return global.throwValue(global.createSyntaxErrorInstance(
                    "XML Parse error: {s}",
                    .{first_msg.data.text},
                ));
            }
            return global.throwValue(global.createSyntaxErrorInstance(
                "XML Parse error: Unable to parse XML string",
                .{},
            ));
        },
    };

    // The XML AST never contains cycles (unlike YAML anchors/aliases), so a
    // simple recursive conversion is fine here.
    return exprToJS(root, global);
}

fn exprToJS(expr: Expr, global: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    switch (expr.data) {
        .e_null => return .null,
        .e_boolean => |boolean| return .jsBoolean(boolean.value),
        .e_number => |number| return .jsNumber(number.value),
        .e_string => |str| {
            return str.toJS(bun.default_allocator, global);
        },
        .e_array => |arr| {
            var js_arr = try JSValue.createEmptyArray(global, arr.items.len);
            for (arr.slice(), 0..) |item, _i| {
                const i: u32 = @intCast(_i);
                const value = try exprToJS(item, global);
                try js_arr.putIndex(global, i, value);
            }
            return js_arr;
        },
        .e_object => |obj| {
            var js_obj = JSValue.createEmptyObject(global, obj.properties.len);
            for (obj.properties.slice()) |prop| {
                const key_expr = prop.key.?;
                const value = try exprToJS(prop.value.?, global);
                const key_js = try exprToJS(key_expr, global);
                const key_str = try key_js.toBunString(global);
                defer key_str.deref();
                try js_obj.putMayBeIndex(global, &key_str, value);
            }
            return js_obj;
        },
        else => return .js_undefined,
    }
}

const std = @import("std");

const bun = @import("bun");
const logger = bun.logger;

const ast = bun.ast;
const Expr = ast.Expr;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
