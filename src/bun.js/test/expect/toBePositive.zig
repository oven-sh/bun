pub fn toBePositive(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const value: JSValue = try this.getValue(globalThis, thisValue, "toBePositive", "");

    this.incrementExpectCallCounter();

    var pass = value.isNumber();
    if (pass) {
        const num: f64 = value.asNumber();
        pass = @round(num) > 0 and !std.math.isInf(num) and !std.math.isNan(num);
    }

    const not = this.flags.not;
    if (not) pass = !pass;

    if (pass) return .js_undefined;

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    const received = value.toFmt(&formatter);

    if (not) {
        const signature = comptime getSignature("toBePositive", "", true);
        return this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{f}<r>\n", .{received});
    }

    const signature = comptime getSignature("toBePositive", "", false);
    return this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{f}<r>\n", .{received});
}

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
