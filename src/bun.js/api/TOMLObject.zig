pub fn create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
    const object = JSValue.createEmptyObject(globalThis, 1);
    object.put(
        globalThis,
        ZigString.static("parse"),
        JSC.createCallback(
            globalThis,
            ZigString.static("parse"),
            1,
            parse,
        ),
    );

    return object;
}

pub fn parse(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    var arena = bun.ArenaAllocator.init(globalThis.allocator());
    const allocator = arena.allocator();
    defer arena.deinit();
    var log = logger.Log.init(default_allocator);
    const arguments = callframe.arguments_old(1).slice();
    if (arguments.len == 0 or arguments[0].isEmptyOrUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("Expected a string to parse", .{});
    }

    var input_slice = try arguments[0].toSlice(globalThis, bun.default_allocator);
    defer input_slice.deinit();
    const source = &logger.Source.initPathString("input.toml", input_slice.slice());
    const parse_result = TOMLParser.parse(source, &log, allocator, false) catch {
        return globalThis.throwValue(try log.toJS(globalThis, default_allocator, "Failed to parse toml"));
    };

    // for now...
    const buffer_writer = js_printer.BufferWriter.init(allocator);
    var writer = js_printer.BufferPrinter.init(buffer_writer);
    _ = js_printer.printJSON(
        *js_printer.BufferPrinter,
        &writer,
        parse_result,
        source,
        .{
            .mangled_props = null,
        },
    ) catch {
        return globalThis.throwValue(try log.toJS(globalThis, default_allocator, "Failed to print toml"));
    };

    const slice = writer.ctx.buffer.slice();
    var out = bun.String.fromUTF8(slice);
    defer out.deref();

    return out.toJSByParseJSON(globalThis);
}

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;
const logger = bun.logger;
const bun = @import("bun");
const js_printer = bun.js_printer;
const default_allocator = bun.default_allocator;
const TOMLParser = @import("../../toml/toml_parser.zig").TOML;
