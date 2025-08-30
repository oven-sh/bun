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

    const args = callFrame.arguments();
    if (args.len < 1) {
        return global.throwInvalidArguments("XML.parse() requires 1 argument (xmlString)", .{});
    }

    const input_value = args.ptr[0];
    if (!input_value.isString()) {
        return global.throwInvalidArguments("XML.parse() expects a string as first argument", .{});
    }

    const input_str = try input_value.toBunString(global);
    const input = input_str.toSlice(arena.allocator());
    defer input.deinit();

    var log = logger.Log.init(bun.default_allocator);
    defer log.deinit();

    const source = &logger.Source.initPathString("input.xml", input.slice());

    const root = bun.interchange.xml.XML.parse(source, &log, arena.allocator()) catch |err| return switch (err) {
        error.OutOfMemory => |oom| oom,
        error.StackOverflow => global.throwStackOverflow(),
        else => global.throwValue(try log.toJS(global, bun.default_allocator, "Failed to parse XML")),
    };

    var ctx: ParserCtx = .{
        .stack_check = .init(),
        .global = global,
        .root = root,
        .result = .zero,
    };

    MarkedArgumentBuffer.run(ParserCtx, &ctx, &ParserCtx.run);

    return ctx.result;
}

const ParserCtx = struct {
    stack_check: bun.StackCheck,
    global: *JSGlobalObject,
    root: Expr,
    result: JSValue,

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
            .e_object => {
                var obj = JSValue.createEmptyObject(ctx.global, expr.data.e_object.properties.len);
                args.append(obj);

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

            .e_string => {
                return ZigString.init(expr.data.e_string.data).withEncoding().toJS(ctx.global);
            },

            .e_array => {
                var array = try JSValue.createEmptyArray(ctx.global, @intCast(expr.data.e_array.items.len));
                args.append(array);

                for (expr.data.e_array.items.slice(), 0..) |item_expr, index| {
                    const item_value = try ctx.toJS(args, item_expr);
                    try array.putIndex(ctx.global, @intCast(index), item_value);
                }

                return array;
            },

            else => return ctx.global.throwError(error.TypeError, "XML.parse: unsupported AST node type"),
        }
    }
};

const bun = @import("bun");
const JSError = bun.JSError;
const default_allocator = bun.default_allocator;
const logger = bun.logger;
const Expr = bun.ast.Expr;
const XML = bun.interchange.xml.XML;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const MarkedArgumentBuffer = jsc.MarkedArgumentBuffer;
const ZigString = jsc.ZigString;
