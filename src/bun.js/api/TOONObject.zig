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
    const source = &logger.Source.initPathString("input.toon", input_slice.slice());
    const parse_result = TOON.parse(source, &log, allocator) catch {
        return globalThis.throwValue(try log.toJS(globalThis, default_allocator, "Failed to parse toon"));
    };

    // Convert parsed result to JSON
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
        return globalThis.throwValue(try log.toJS(globalThis, default_allocator, "Failed to print toon"));
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
    const value, const replacer, const space_value = callframe.argumentsAsArray(3);

    value.ensureStillAlive();

    if (value.isUndefined() or value.isSymbol() or value.isFunction()) {
        return .js_undefined;
    }

    if (!replacer.isUndefinedOrNull()) {
        return globalThis.throw("TOON.stringify does not support the replacer argument", .{});
    }

    var scope: bun.AllocationScope = .init(bun.default_allocator);
    defer scope.deinit();

    var stringifier = TOON.stringify(scope.allocator(), globalThis, value, space_value) catch |err| return switch (err) {
        error.OutOfMemory => error.JSError,
        error.JSError, error.JSTerminated => |js_err| js_err,
        error.StackOverflow => globalThis.throwStackOverflow(),
    };
    defer stringifier.deinit();

    return stringifier.toString(globalThis);
}

const bun = @import("bun");
const default_allocator = bun.default_allocator;
const js_printer = bun.js_printer;
const logger = bun.logger;
const TOON = bun.interchange.toon.TOON;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
