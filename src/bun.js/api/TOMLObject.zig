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
            3,
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
    const value, const replacer, const space = callframe.argumentsAsArray(3);
    
    value.ensureStillAlive();
    
    if (value.isUndefined() or value.isSymbol() or value.isFunction()) {
        return .js_undefined;
    }
    
    if (!replacer.isUndefinedOrNull()) {
        return globalThis.throw("TOML.stringify does not support the replacer argument", .{});
    }
    
    // TOML doesn't use space parameter - it has fixed formatting rules
    _ = space;
    
    // Use a temporary allocator for stringification
    var arena = bun.ArenaAllocator.init(globalThis.allocator());
    defer arena.deinit();
    const allocator = arena.allocator();

    const result = toml_stringify.stringify(globalThis, value, allocator) catch |err| switch (err) {
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

const toml_stringify = @import("../../interchange/toml_stringify.zig");

const bun = @import("bun");
const default_allocator = bun.default_allocator;
const js_printer = bun.js_printer;
const logger = bun.logger;
const TOML = bun.interchange.toml.TOML;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
