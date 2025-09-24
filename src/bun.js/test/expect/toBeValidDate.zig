pub fn toBeValidDate(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const value: JSValue = try this.getValue(globalThis, thisValue, "toBeValidDate", "");

    this.incrementExpectCallCounter();

    const not = this.flags.not;
    var pass = (value.isDate() and !std.math.isNan(value.getUnixTimestamp()));
    if (not) pass = !pass;

    if (pass) return thisValue;

    const received = value.toJestPrettyFormat(globalThis);

    if (not) {
        const signature = comptime getSignature("toBeValidDate", "", true);
        return this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
    }

    const signature = comptime getSignature("toBeValidDate", "", false);
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
