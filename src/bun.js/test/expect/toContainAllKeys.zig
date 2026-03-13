pub fn toContainAllKeys(
    this: *Expect,
    globalObject: *JSGlobalObject,
    callFrame: *CallFrame,
) bun.JSError!JSValue {
    defer this.postMatch(globalObject);
    const thisValue = callFrame.this();
    const arguments_ = callFrame.arguments_old(1);
    const arguments = arguments_.slice();

    if (arguments.len < 1) {
        return globalObject.throwInvalidArguments("toContainAllKeys() takes 1 argument", .{});
    }

    this.incrementExpectCallCounter();

    const expected = arguments[0];
    expected.ensureStillAlive();
    const value: JSValue = try this.getValue(globalObject, thisValue, "toContainAllKeys", "<green>expected<r>");

    if (!expected.jsType().isArray()) {
        return globalObject.throwInvalidArgumentType("toContainAllKeys", "expected", "array");
    }

    const not = this.flags.not;
    var pass = false;

    const count = try expected.getLength(globalObject);

    var keys = try value.keys(globalObject);
    if (try keys.getLength(globalObject) == count) {
        var itr = try keys.arrayIterator(globalObject);
        outer: {
            while (try itr.next()) |item| {
                var i: u32 = 0;
                while (i < count) : (i += 1) {
                    const key = try expected.getIndex(globalObject, i);
                    if (try item.jestDeepEquals(key, globalObject)) break;
                } else break :outer;
            }
            pass = true;
        }
    }

    if (not) pass = !pass;
    if (pass) return thisValue;

    // handle failure
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
    defer formatter.deinit();
    const value_fmt = keys.toFmt(&formatter);
    const expected_fmt = expected.toFmt(&formatter);
    if (not) {
        const received_fmt = keys.toFmt(&formatter);
        const expected_line = "Expected to not contain all keys: <green>{f}<r>\nReceived: <red>{f}<r>\n";
        const fmt = "\n\n" ++ expected_line;
        return this.throw(globalObject, comptime getSignature("toContainAllKeys", "<green>expected<r>", true), fmt, .{ expected_fmt, received_fmt });
    }

    const expected_line = "Expected to contain all keys: <green>{f}<r>\n";
    const received_line = "Received: <red>{f}<r>\n";
    const fmt = "\n\n" ++ expected_line ++ received_line;
    return this.throw(globalObject, comptime getSignature("toContainAllKeys", "<green>expected<r>", false), fmt, .{ expected_fmt, value_fmt });
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
