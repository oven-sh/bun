pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const object = JSValue.createEmptyObject(globalThis, 1);
    object.put(
        globalThis,
        ZigString.static("parse"),
        jsc.createCallback(
            globalThis,
            ZigString.static("parse"),
            1,
            parse,
        ),
    );

    return object;
}

pub fn parse(
    global: *jsc.JSGlobalObject,
    callFrame: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    var arena: bun.ArenaAllocator = .init(bun.default_allocator);
    defer arena.deinit();

    const input_value = callFrame.argumentsAsArray(1)[0];

    const input_str = try input_value.toBunString(global);
    const input = input_str.toSlice(arena.allocator());
    defer input.deinit();

    var log = logger.Log.init(bun.default_allocator);
    defer log.deinit();

    const source = &logger.Source.initPathString("input.yaml", input.slice());

    const root = bun.interchange.yaml.YAML.parse(source, &log, arena.allocator()) catch |err| return switch (err) {
        error.OutOfMemory => |oom| oom,
        error.StackOverflow => global.throwStackOverflow(),
        else => global.throwValue(try log.toJS(global, bun.default_allocator, "Failed to parse YAML")),
    };

    var ctx: ParserCtx = .{
        .seen_objects = .init(arena.allocator()),
        .stack_check = .init(),
        .global = global,
        .root = root,
        .result = .zero,
    };
    defer ctx.deinit();

    MarkedArgumentBuffer.run(ParserCtx, &ctx, &ParserCtx.run);

    return ctx.result;
}

const ParserCtx = struct {
    seen_objects: std.AutoHashMap(*const anyopaque, JSValue),
    stack_check: bun.StackCheck,

    global: *JSGlobalObject,
    root: Expr,

    result: JSValue,

    pub fn deinit(ctx: *ParserCtx) void {
        ctx.seen_objects.deinit();
    }

    pub fn run(ctx: *ParserCtx, args: *MarkedArgumentBuffer) callconv(.c) void {
        ctx.result = ctx.toJS(args, ctx.root) catch |err| switch (err) {
            error.OutOfMemory => {
                ctx.result = ctx.global.throwOutOfMemoryValue();
                return;
            },
            error.JSError => {
                ctx.result = .zero;
                return;
            },
        };
    }

    pub fn toJS(ctx: *ParserCtx, args: *MarkedArgumentBuffer, expr: Expr) JSError!JSValue {
        if (!ctx.stack_check.isSafeToRecurse()) {
            return ctx.global.throwStackOverflow();
        }
        switch (expr.data) {
            .e_null => return .null,
            .e_boolean => |boolean| return .jsBoolean(boolean.value),
            .e_number => |number| return .jsNumber(number.value),
            .e_string => |str| {
                return str.toJS(bun.default_allocator, ctx.global);
            },
            .e_array => {
                if (ctx.seen_objects.get(expr.data.e_array)) |arr| {
                    return arr;
                }

                var arr = try JSValue.createEmptyArray(ctx.global, expr.data.e_array.items.len);

                args.append(arr);
                try ctx.seen_objects.put(expr.data.e_array, arr);

                for (expr.data.e_array.slice(), 0..) |item, _i| {
                    const i: u32 = @intCast(_i);
                    const value = try ctx.toJS(args, item);
                    try arr.putIndex(ctx.global, i, value);
                }

                return arr;
            },
            .e_object => {
                if (ctx.seen_objects.get(expr.data.e_object)) |obj| {
                    return obj;
                }

                var obj = JSValue.createEmptyObject(ctx.global, expr.data.e_object.properties.len);

                args.append(obj);
                try ctx.seen_objects.put(expr.data.e_object, obj);

                for (expr.data.e_object.properties.slice()) |prop| {
                    const key_expr = prop.key.?;
                    const value_expr = prop.value.?;

                    const key = try ctx.toJS(args, key_expr);
                    const value = try ctx.toJS(args, value_expr);

                    const key_str = try key.toBunString(ctx.global);
                    defer key_str.deref();

                    obj.putMayBeIndex(ctx.global, &key_str, value);
                }

                return obj;
            },

            // unreachable. the yaml AST does not use any other
            // expr types
            else => return .js_undefined,
        }
    }
};

const std = @import("std");

const bun = @import("bun");
const JSError = bun.JSError;
const default_allocator = bun.default_allocator;
const logger = bun.logger;
const YAML = bun.interchange.yaml.YAML;

const ast = bun.ast;
const Expr = ast.Expr;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const MarkedArgumentBuffer = jsc.MarkedArgumentBuffer;
const ZigString = jsc.ZigString;
