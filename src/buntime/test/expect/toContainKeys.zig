pub fn toContainKeys(
    this: *Expect,
    globalThis: *JSGlobalObject,
    callFrame: *CallFrame,
) bun.JSError!JSValue {
    defer this.postMatch(globalThis);
    const thisValue = callFrame.this();
    const arguments_ = callFrame.arguments_old(1);
    const arguments = arguments_.slice();

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toContainKeys() takes 1 argument", .{});
    }

    this.incrementExpectCallCounter();

    const expected = arguments[0];
    expected.ensureStillAlive();
    const value: JSValue = try this.getValue(globalThis, thisValue, "toContainKeys", "<green>expected<r>");

    if (!expected.jsType().isArray()) {
        return globalThis.throwInvalidArgumentType("toContainKeys", "expected", "array");
    }

    const not = this.flags.not;
    var pass = brk: {
        const count = try expected.getLength(globalThis);

        // jest-extended checks for truthiness before calling hasOwnProperty, and we cannot call hasOwnPropertyValue with non-objects
        // https://github.com/jest-community/jest-extended/blob/711fdcc54d68c2b2c1992c7cfbdf0d0bd6be0f4d/src/matchers/toContainKeys.js#L1-L6
        if (!value.isObject()) break :brk count == 0;

        var i: u32 = 0;

        while (i < count) : (i += 1) {
            const key = try expected.getIndex(globalThis, i);

            if (!try value.hasOwnPropertyValue(globalThis, key)) {
                break :brk false;
            }
        }

        break :brk true;
    };

    if (not) pass = !pass;
    if (pass) return thisValue;

    // handle failure
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    const value_fmt = value.toFmt(&formatter);
    const expected_fmt = expected.toFmt(&formatter);
    if (not) {
        const received_fmt = value.toFmt(&formatter);
        const expected_line = "Expected to not contain: <green>{f}<r>\nReceived: <red>{f}<r>\n";
        const signature = comptime getSignature("toContainKeys", "<green>expected<r>", true);
        return this.throw(globalThis, signature, "\n\n" ++ expected_line, .{ expected_fmt, received_fmt });
    }

    const expected_line = "Expected to contain: <green>{f}<r>\n";
    const received_line = "Received: <red>{f}<r>\n";
    const signature = comptime getSignature("toContainKeys", "<green>expected<r>", false);
    return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
