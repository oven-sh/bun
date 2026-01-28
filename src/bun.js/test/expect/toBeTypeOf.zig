const JSTypeOfMap = bun.ComptimeStringMap([]const u8, .{
    .{ "function", "function" },
    .{ "object", "object" },
    .{ "bigint", "bigint" },
    .{ "boolean", "boolean" },
    .{ "number", "number" },
    .{ "string", "string" },
    .{ "symbol", "symbol" },
    .{ "undefined", "undefined" },
});

pub fn toBeTypeOf(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const _arguments = callFrame.arguments_old(1);
    const arguments = _arguments.ptr[0.._arguments.len];

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toBeTypeOf() requires 1 argument", .{});
    }

    const value: JSValue = try this.getValue(globalThis, thisValue, "toBeTypeOf", "");

    const expected = arguments[0];
    expected.ensureStillAlive();

    if (!expected.isString()) {
        return globalThis.throwInvalidArguments("toBeTypeOf() requires a string argument", .{});
    }

    const expected_type = try expected.toBunString(globalThis);
    defer expected_type.deref();
    this.incrementExpectCallCounter();

    const typeof = expected_type.inMap(JSTypeOfMap) orelse {
        return globalThis.throwInvalidArguments("toBeTypeOf() requires a valid type string argument ('function', 'object', 'bigint', 'boolean', 'number', 'string', 'symbol', 'undefined')", .{});
    };

    const not = this.flags.not;
    var pass = false;
    var whatIsTheType: []const u8 = "";

    // Checking for function/class should be done before everything else, or it will fail.
    if (value.isCallable()) {
        whatIsTheType = "function";
    } else if (value.isObject() or value.jsType().isArray() or value.isNull()) {
        whatIsTheType = "object";
    } else if (value.isBigInt()) {
        whatIsTheType = "bigint";
    } else if (value.isBoolean()) {
        whatIsTheType = "boolean";
    } else if (value.isNumber()) {
        whatIsTheType = "number";
    } else if (value.jsType().isString()) {
        whatIsTheType = "string";
    } else if (value.isSymbol()) {
        whatIsTheType = "symbol";
    } else if (value.isUndefined()) {
        whatIsTheType = "undefined";
    } else {
        return globalThis.throw("Internal consistency error: unknown JSValue type", .{});
    }

    pass = strings.eql(typeof, whatIsTheType);

    if (not) pass = !pass;
    if (pass) return .js_undefined;

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    const received = value.toFmt(&formatter);
    const expected_str = expected.toFmt(&formatter);

    if (not) {
        const signature = comptime getSignature("toBeTypeOf", "", true);
        return this.throw(globalThis, signature, "\n\n" ++ "Expected type: not <green>{f}<r>\n" ++ "Received type: <red>\"{s}\"<r>\nReceived value: <red>{f}<r>\n", .{ expected_str, whatIsTheType, received });
    }

    const signature = comptime getSignature("toBeTypeOf", "", false);
    return this.throw(globalThis, signature, "\n\n" ++ "Expected type: <green>{f}<r>\n" ++ "Received type: <red>\"{s}\"<r>\nReceived value: <red>{f}<r>\n", .{ expected_str, whatIsTheType, received });
}

const bun = @import("bun");
const strings = bun.strings;

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
