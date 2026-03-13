pub fn toBeCloseTo(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const thisArguments = callFrame.arguments_old(2);
    const arguments = thisArguments.ptr[0..thisArguments.len];

    this.incrementExpectCallCounter();

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toBeCloseTo() requires at least 1 argument. Expected value must be a number", .{});
    }

    const expected_ = arguments[0];
    if (!expected_.isNumber()) {
        return globalThis.throwInvalidArgumentType("toBeCloseTo", "expected", "number");
    }

    var precision: f64 = 2.0;
    if (arguments.len > 1) {
        const precision_ = arguments[1];
        if (!precision_.isNumber()) {
            return globalThis.throwInvalidArgumentType("toBeCloseTo", "precision", "number");
        }

        precision = precision_.asNumber();
    }

    const received_: JSValue = try this.getValue(globalThis, thisValue, "toBeCloseTo", "<green>expected<r>, precision");
    if (!received_.isNumber()) {
        return globalThis.throwInvalidArgumentType("expect", "received", "number");
    }

    var expected = expected_.asNumber();
    var received = received_.asNumber();

    if (std.math.isNegativeInf(expected)) {
        expected = -expected;
    }

    if (std.math.isNegativeInf(received)) {
        received = -received;
    }

    if (std.math.isPositiveInf(expected) and std.math.isPositiveInf(received)) {
        return .js_undefined;
    }

    const expected_diff = bun.pow(10, -precision) / 2;
    const actual_diff = @abs(received - expected);
    var pass = actual_diff < expected_diff;

    const not = this.flags.not;
    if (not) pass = !pass;

    if (pass) return .js_undefined;

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    const expected_fmt = expected_.toFmt(&formatter);
    const received_fmt = received_.toFmt(&formatter);

    const expected_line = "Expected: <green>{f}<r>\n";
    const received_line = "Received: <red>{f}<r>\n";
    const expected_precision = "Expected precision: {d}\n";
    const expected_difference = "Expected difference: \\< <green>{d}<r>\n";
    const received_difference = "Received difference: <red>{d}<r>\n";

    const suffix_fmt = "\n\n" ++ expected_line ++ received_line ++ "\n" ++ expected_precision ++ expected_difference ++ received_difference;

    if (not) {
        const signature = comptime getSignature("toBeCloseTo", "<green>expected<r>, precision", true);
        return this.throw(globalThis, signature, suffix_fmt, .{ expected_fmt, received_fmt, precision, expected_diff, actual_diff });
    }

    const signature = comptime getSignature("toBeCloseTo", "<green>expected<r>, precision", false);
    return this.throw(globalThis, signature, suffix_fmt, .{ expected_fmt, received_fmt, precision, expected_diff, actual_diff });
}

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
