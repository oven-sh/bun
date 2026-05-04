pub fn toBeInstanceOf(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const _arguments = callFrame.arguments_old(1);
    const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toBeInstanceOf() requires 1 argument", .{});
    }

    this.incrementExpectCallCounter();
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    const expected_value = arguments[0];
    if (!expected_value.isConstructor()) {
        return globalThis.throw("Expected value must be a function: {f}", .{expected_value.toFmt(&formatter)});
    }
    expected_value.ensureStillAlive();

    const value: JSValue = try this.getValue(globalThis, thisValue, "toBeInstanceOf", "<green>expected<r>");

    const not = this.flags.not;
    var pass = value.isInstanceOf(globalThis, expected_value);
    if (not) pass = !pass;
    if (pass) return .js_undefined;

    // handle failure
    const expected_fmt = expected_value.toFmt(&formatter);
    const value_fmt = value.toFmt(&formatter);
    if (not) {
        const expected_line = "Expected constructor: not <green>{f}<r>\n";
        const received_line = "Received value: <red>{f}<r>\n";
        const signature = comptime getSignature("toBeInstanceOf", "<green>expected<r>", true);
        return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
    }

    const expected_line = "Expected constructor: <green>{f}<r>\n";
    const received_line = "Received value: <red>{f}<r>\n";
    const signature = comptime getSignature("toBeInstanceOf", "<green>expected<r>", false);
    return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
