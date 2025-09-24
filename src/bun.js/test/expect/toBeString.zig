pub fn toBeString(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const value: JSValue = try this.getValue(globalThis, thisValue, "toBeString", "");

    this.incrementExpectCallCounter();

    const not = this.flags.not;
    const pass = value.isString() != not;

    if (pass) return .js_undefined;

    const received = value.toJestPrettyFormat(globalThis);

    if (not) {
        const signature = comptime getSignature("toBeString", "", true);
        return this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
    }

    const signature = comptime getSignature("toBeString", "", false);
    return this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
