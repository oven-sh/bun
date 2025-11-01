pub fn toHaveLength(
    this: *Expect,
    globalThis: *JSGlobalObject,
    callframe: *CallFrame,
) bun.JSError!JSValue {
    defer this.postMatch(globalThis);
    const thisValue = callframe.this();
    const arguments_ = callframe.arguments_old(1);
    const arguments = arguments_.slice();

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toHaveLength() takes 1 argument", .{});
    }

    this.incrementExpectCallCounter();

    const expected: JSValue = arguments[0];
    const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveLength", "<green>expected<r>");

    if (!value.isObject() and !value.isString()) {
        var fmt = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        return globalThis.throw("Received value does not have a length property: {f}", .{value.toFmt(&fmt)});
    }

    if (!expected.isNumber()) {
        var fmt = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        return globalThis.throw("Expected value must be a non-negative integer: {f}", .{expected.toFmt(&fmt)});
    }

    const expected_length: f64 = expected.asNumber();
    if (@round(expected_length) != expected_length or std.math.isInf(expected_length) or std.math.isNan(expected_length) or expected_length < 0) {
        var fmt = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        return globalThis.throw("Expected value must be a non-negative integer: {f}", .{expected.toFmt(&fmt)});
    }

    const not = this.flags.not;
    var pass = false;

    const actual_length = try value.getLengthIfPropertyExistsInternal(globalThis);

    if (actual_length == std.math.inf(f64)) {
        var fmt = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        return globalThis.throw("Received value does not have a length property: {f}", .{value.toFmt(&fmt)});
    } else if (std.math.isNan(actual_length)) {
        return globalThis.throw("Received value has non-number length property: {}", .{actual_length});
    }

    if (actual_length == expected_length) {
        pass = true;
    }

    if (not) pass = !pass;
    if (pass) return .js_undefined;

    // handle failure
    if (not) {
        const expected_line = "Expected length: not <green>{d}<r>\n";
        const signature = comptime getSignature("toHaveLength", "<green>expected<r>", true);
        return this.throw(globalThis, signature, "\n\n" ++ expected_line, .{expected_length});
    }

    const expected_line = "Expected length: <green>{d}<r>\n";
    const received_line = "Received length: <red>{d}<r>\n";
    const signature = comptime getSignature("toHaveLength", "<green>expected<r>", false);
    return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_length, actual_length });
}

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
