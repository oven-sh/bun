pub fn toContainKey(
    this: *Expect,
    globalThis: *JSGlobalObject,
    callFrame: *CallFrame,
) bun.JSError!JSValue {
    defer this.postMatch(globalThis);
    const thisValue = callFrame.this();
    const arguments_ = callFrame.arguments_old(1);
    const arguments = arguments_.slice();

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toContainKey() takes 1 argument", .{});
    }

    incrementExpectCallCounter();

    const expected = arguments[0];
    expected.ensureStillAlive();
    const value: JSValue = try this.getValue(globalThis, thisValue, "toContainKey", "<green>expected<r>");
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    const not = this.flags.not;
    if (!value.isObject()) {
        return globalThis.throwInvalidArguments("Expected value must be an object\nReceived: {}", .{value.toFmt(&formatter)});
    }

    var pass = try value.hasOwnPropertyValue(globalThis, expected);

    if (not) pass = !pass;
    if (pass) return thisValue;

    // handle failure

    const value_fmt = value.toFmt(&formatter);
    const expected_fmt = expected.toFmt(&formatter);
    if (not) {
        const received_fmt = value.toFmt(&formatter);
        const expected_line = "Expected to not contain: <green>{any}<r>\nReceived: <red>{any}<r>\n";
        const signature = comptime getSignature("toContainKey", "<green>expected<r>", true);
        return this.throw(globalThis, signature, "\n\n" ++ expected_line, .{ expected_fmt, received_fmt });
    }

    const expected_line = "Expected to contain: <green>{any}<r>\n";
    const received_line = "Received: <red>{any}<r>\n";
    const signature = comptime getSignature("toContainKey", "<green>expected<r>", false);
    return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;
const incrementExpectCallCounter = bun.jsc.Expect.incrementExpectCallCounter;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
