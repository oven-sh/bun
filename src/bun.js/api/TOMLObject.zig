pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const object = JSValue.createEmptyObject(globalThis, 2);
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
    object.put(
        globalThis,
        ZigString.static("stringify"),
        jsc.createCallback(
            globalThis,
            ZigString.static("stringify"),
            1,
            stringify,
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
    var log = logger.Log.init(default_allocator);
    const arguments = callframe.arguments_old(1).slice();
    if (arguments.len == 0 or arguments[0].isEmptyOrUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("Expected a string to parse", .{});
    }

    var input_slice = try arguments[0].toSlice(globalThis, bun.default_allocator);
    defer input_slice.deinit();
    const source = &logger.Source.initPathString("input.toml", input_slice.slice());
    const parse_result = TOML.parse(source, &log, allocator, false) catch {
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
    var out = bun.String.borrowUTF8(slice);
    defer out.deref();

    return out.toJSByParseJSON(globalThis);
}

pub fn stringify(
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(3).slice();
    if (arguments.len == 0 or arguments[0].isEmptyOrUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("Expected a value to stringify", .{});
    }

    const value = arguments[0];
    
    // Note: replacer parameter is not supported (like YAML.stringify)
    
    // Parse options if provided  
    var options = toml_stringify.TOMLStringifyOptions{};
    if (arguments.len > 2 and !arguments[2].isEmptyOrUndefinedOrNull()) {
        const opts = arguments[2];
        if (opts.isObject()) {
            if (opts.get(globalThis, "inlineTables")) |maybe_inline_tables| {
                if (maybe_inline_tables) |inline_tables| {
                    if (inline_tables.isBoolean()) {
                        options.inline_tables = inline_tables.toBoolean();
                    }
                }
            } else |_| {}
            
            if (opts.get(globalThis, "arraysMultiline")) |maybe_arrays_multiline| {
                if (maybe_arrays_multiline) |arrays_multiline| {
                    if (arrays_multiline.isBoolean()) {
                        options.arrays_multiline = arrays_multiline.toBoolean();
                    }
                }
            } else |_| {}
            
            if (opts.get(globalThis, "indent")) |maybe_indent| {
                if (maybe_indent) |indent| {
                    if (indent.isString()) {
                        const indent_str = try indent.toBunString(globalThis);
                        defer indent_str.deref();
                        const slice = indent_str.toSlice(default_allocator);
                        defer slice.deinit();
                        // Note: For now we'll use the default indent, but this could be improved
                    }
                }
            } else |_| {}
        }
    }
    
    const result = toml_stringify.stringify(globalThis, value, options) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.InvalidValue => return globalThis.throwInvalidArguments("Invalid value for TOML stringification", .{}),
        error.CircularReference => return globalThis.throwInvalidArguments("Circular reference detected", .{}),
        error.InvalidKey => return globalThis.throwInvalidArguments("Invalid key for TOML", .{}),
        error.UnsupportedType => return globalThis.throwInvalidArguments("Unsupported type for TOML stringification", .{}),
        error.JSError => return globalThis.throwInvalidArguments("JavaScript error occurred", .{}),
    };
    
    var out = bun.String.borrowUTF8(result);
    defer out.deref();
    return out.toJS(globalThis);
}

const bun = @import("bun");
const default_allocator = bun.default_allocator;
const js_printer = bun.js_printer;
const logger = bun.logger;
const TOML = bun.interchange.toml.TOML;
const toml_stringify = @import("../../interchange/toml_stringify.zig");

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
