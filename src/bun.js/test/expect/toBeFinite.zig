pub fn toBeFinite(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const value: JSValue = try this.getValue(globalThis, thisValue, "toBeFinite", "");

    this.incrementExpectCallCounter();

    var pass = value.isNumber();
    if (pass) {
        const num: f64 = value.asNumber();
        pass = std.math.isFinite(num) and !std.math.isNan(num);
    }

    const not = this.flags.not;
    if (not) pass = !pass;

    if (pass) return .js_undefined;

    const received = value.toJestPrettyFormat(globalThis);

    if (not) {
        const signature = comptime getSignature("toBeFinite", "", true);
        return this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
    }

    const signature = comptime getSignature("toBeFinite", "", false);
    return this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
}

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
