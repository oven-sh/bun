pub fn create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
    const object = JSValue.createEmptyObject(globalThis, 1);
    object.put(
        globalThis,
        ZigString.static("parse"),
        JSC.createCallback(
            globalThis,
            ZigString.static("parse"),
            2,
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
    const arguments = callframe.arguments_old(2).slice();
    if (arguments.len == 0 or arguments[0].isEmptyOrUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("Expected a string to parse", .{});
    }

    // Default parser options
    var parser_options = CSVParser.CSVParserOptions{};

    // Process options if provided
    if (arguments.len > 1 and !arguments[1].isEmptyOrUndefinedOrNull() and arguments[1].isObject()) {
        const options = arguments[1];

        // Use 'try' to propagate potential errors from .get()
        const header_value = try options.get(globalThis, "header");
        // Check if header_value is non-null before accessing methods
        if (header_value) |hv| {
            if (hv.isBoolean()) {
                parser_options.header = hv.asBoolean();
            }
        }

        // Use 'try' to propagate potential errors from .get()
        const delimiter_value = try options.get(globalThis, "delimiter");
        // Check if delimiter_value is non-null before accessing methods
        if (delimiter_value) |dv| {
            if (dv.isString()) {
                const dv_ = try dv.toSlice(globalThis, default_allocator);
                parser_options.delimiter = dv_.slice();
            }
        }

        if (try options.get(globalThis, "comments")) |comments_value| {
            if (comments_value.isBoolean()) {
                parser_options.comments = comments_value.asBoolean();
            }
        }

        if (try options.get(globalThis, "trim_whitespace")) |trim_value| {
            if (trim_value.isBoolean()) {
                parser_options.trim_whitespace = trim_value.asBoolean();
            }
        }

        if (try options.get(globalThis, "dynamic_typing")) |typing_value| {
            if (typing_value.isBoolean()) {
                parser_options.dynamic_typing = typing_value.asBoolean();
            }
        }
    }

    var input_slice = try arguments[0].toSlice(globalThis, bun.default_allocator);
    defer input_slice.deinit();
    var source = logger.Source.initPathString("input.csv", input_slice.slice());

    // Parse the CSV data
    const parse_result = CSVParser.CSV.parse(&source, &log, allocator, false, parser_options) catch {
        return globalThis.throwValue(log.toJS(globalThis, default_allocator, "Failed to parse CSV"));
    };

    // for now...
    const buffer_writer = js_printer.BufferWriter.init(allocator);
    var writer = js_printer.BufferPrinter.init(buffer_writer);
    _ = js_printer.printJSON(
        *js_printer.BufferPrinter,
        &writer,
        parse_result,
        &source,
        .{
            .mangled_props = null,
        },
    ) catch {
        return globalThis.throwValue(log.toJS(globalThis, default_allocator, "Failed to print csv"));
    };

    const slice = writer.ctx.buffer.slice();
    var out = bun.String.fromUTF8(slice);
    defer out.deref();

    return out.toJSByParseJSON(globalThis);
}

const CSVObject = @This();
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const JSObject = JSC.JSObject;
const std = @import("std");
const ZigString = JSC.ZigString;
const logger = bun.logger;
const bun = @import("bun");
const js_printer = bun.js_printer;
const default_allocator = bun.default_allocator;
const CSVParser = @import("../../csv/csv_parser.zig");
