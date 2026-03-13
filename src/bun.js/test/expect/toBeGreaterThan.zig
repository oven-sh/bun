pub fn toBeGreaterThan(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const _arguments = callFrame.arguments_old(1);
    const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toBeGreaterThan() requires 1 argument", .{});
    }

    this.incrementExpectCallCounter();

    const other_value = arguments[0];
    other_value.ensureStillAlive();

    const value: JSValue = try this.getValue(globalThis, thisValue, "toBeGreaterThan", "<green>expected<r>");

    if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
        return globalThis.throw("Expected and actual values must be numbers or bigints", .{});
    }

    const not = this.flags.not;
    var pass = false;

    if (!value.isBigInt() and !other_value.isBigInt()) {
        pass = value.asNumber() > other_value.asNumber();
    } else if (value.isBigInt()) {
        pass = switch (value.asBigIntCompare(globalThis, other_value)) {
            .greater_than => true,
            else => pass,
        };
    } else {
        pass = switch (other_value.asBigIntCompare(globalThis, value)) {
            .less_than => true,
            else => pass,
        };
    }

    if (not) pass = !pass;
    if (pass) return .js_undefined;

    // handle failure
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    const value_fmt = value.toFmt(&formatter);
    const expected_fmt = other_value.toFmt(&formatter);
    if (not) {
        const expected_line = "Expected: not \\> <green>{f}<r>\n";
        const received_line = "Received: <red>{f}<r>\n";
        const signature = comptime getSignature("toBeGreaterThan", "<green>expected<r>", true);
        return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
    }

    const expected_line = "Expected: \\> <green>{f}<r>\n";
    const received_line = "Received: <red>{f}<r>\n";
    const signature = comptime getSignature("toBeGreaterThan", "<green>expected<r>", false);
    return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
