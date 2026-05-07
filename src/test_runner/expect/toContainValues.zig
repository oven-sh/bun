pub fn toContainValues(
    this: *Expect,
    globalObject: *JSGlobalObject,
    callFrame: *CallFrame,
) bun.JSError!JSValue {
    defer this.postMatch(globalObject);
    const thisValue = callFrame.this();
    const arguments_ = callFrame.arguments_old(1);
    const arguments = arguments_.slice();

    if (arguments.len < 1) {
        return globalObject.throwInvalidArguments("toContainValues() takes 1 argument", .{});
    }

    this.incrementExpectCallCounter();

    const expected = arguments[0];
    if (!expected.jsType().isArray()) {
        return globalObject.throwInvalidArgumentType("toContainValues", "expected", "array");
    }
    expected.ensureStillAlive();
    const value: JSValue = try this.getValue(globalObject, thisValue, "toContainValues", "<green>expected<r>");

    const not = this.flags.not;
    var pass = true;

    if (!value.isUndefinedOrNull()) {
        const values = try value.values(globalObject);
        var itr = try expected.arrayIterator(globalObject);
        const count = try values.getLength(globalObject);

        while (try itr.next()) |item| {
            var i: u32 = 0;
            while (i < count) : (i += 1) {
                const key = try values.getIndex(globalObject, i);
                if (try key.jestDeepEquals(item, globalObject)) break;
            } else {
                pass = false;
                break;
            }
        }
    }

    if (not) pass = !pass;
    if (pass) return thisValue;

    // handle failure
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
    defer formatter.deinit();
    const value_fmt = value.toFmt(&formatter);
    const expected_fmt = expected.toFmt(&formatter);
    if (not) {
        const received_fmt = value.toFmt(&formatter);
        const expected_line = "Expected to not contain: <green>{f}<r>\nReceived: <red>{f}<r>\n";
        const fmt = "\n\n" ++ expected_line;
        return this.throw(globalObject, comptime getSignature("toContainValues", "<green>expected<r>", true), fmt, .{ expected_fmt, received_fmt });
    }

    const expected_line = "Expected to contain: <green>{f}<r>\n";
    const received_line = "Received: <red>{f}<r>\n";
    const fmt = "\n\n" ++ expected_line ++ received_line;
    return this.throw(globalObject, comptime getSignature("toContainValues", "<green>expected<r>", false), fmt, .{ expected_fmt, value_fmt });
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
