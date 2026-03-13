pub fn toBeOdd(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();

    const value: JSValue = try this.getValue(globalThis, thisValue, "toBeOdd", "");

    this.incrementExpectCallCounter();

    const not = this.flags.not;
    var pass = false;

    if (value.isBigInt32()) {
        pass = value.toInt32() & 1 == 1;
    } else if (value.isBigInt()) {
        pass = value.toInt64() & 1 == 1;
    } else if (value.isInt32()) {
        const _value = value.toInt32();
        pass = @mod(_value, 2) == 1;
    } else if (value.isAnyInt()) {
        const _value = value.toInt64();
        pass = @mod(_value, 2) == 1;
    } else if (value.isNumber()) {
        const _value = JSValue.asNumber(value);
        if (@mod(_value, 1) == 0 and @mod(_value, 2) == 1) { // if the fraction is all zeros and odd
            pass = true;
        } else {
            pass = false;
        }
    } else {
        pass = false;
    }

    if (not) pass = !pass;
    if (pass) return .js_undefined;

    // handle failure
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    const value_fmt = value.toFmt(&formatter);
    if (not) {
        const received_line = "Received: <red>{f}<r>\n";
        const signature = comptime getSignature("toBeOdd", "", true);
        return this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
    }

    const received_line = "Received: <red>{f}<r>\n";
    const signature = comptime getSignature("toBeOdd", "", false);
    return this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
