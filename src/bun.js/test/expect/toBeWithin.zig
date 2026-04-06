pub fn toBeWithin(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const _arguments = callFrame.arguments_old(2);
    const arguments = _arguments.ptr[0.._arguments.len];

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toBeWithin() requires 2 arguments", .{});
    }

    const value: JSValue = try this.getValue(globalThis, thisValue, "toBeWithin", "<green>start<r><d>, <r><green>end<r>");

    const startValue = arguments[0];
    startValue.ensureStillAlive();

    if (!startValue.isNumber()) {
        return globalThis.throw("toBeWithin() requires the first argument to be a number", .{});
    }

    const endValue = arguments[1];
    endValue.ensureStillAlive();

    if (!endValue.isNumber()) {
        return globalThis.throw("toBeWithin() requires the second argument to be a number", .{});
    }

    this.incrementExpectCallCounter();

    var pass = value.isNumber();
    if (pass) {
        const num = value.asNumber();
        pass = num >= startValue.asNumber() and num < endValue.asNumber();
    }

    const not = this.flags.not;
    if (not) pass = !pass;

    if (pass) return .js_undefined;

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    const start_fmt = startValue.toFmt(&formatter);
    const end_fmt = endValue.toFmt(&formatter);
    const received_fmt = value.toFmt(&formatter);

    if (not) {
        const expected_line = "Expected: not between <green>{f}<r> <d>(inclusive)<r> and <green>{f}<r> <d>(exclusive)<r>\n";
        const received_line = "Received: <red>{f}<r>\n";
        const signature = comptime getSignature("toBeWithin", "<green>start<r><d>, <r><green>end<r>", true);
        return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ start_fmt, end_fmt, received_fmt });
    }

    const expected_line = "Expected: between <green>{f}<r> <d>(inclusive)<r> and <green>{f}<r> <d>(exclusive)<r>\n";
    const received_line = "Received: <red>{f}<r>\n";
    const signature = comptime getSignature("toBeWithin", "<green>start<r><d>, <r><green>end<r>", false);
    return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ start_fmt, end_fmt, received_fmt });
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
