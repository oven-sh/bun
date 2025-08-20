pub fn toBeNumber(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const value: JSValue = try this.getValue(globalThis, thisValue, "toBeNumber", "");

    incrementExpectCallCounter();

    const not = this.flags.not;
    const pass = value.isNumber() != not;

    if (pass) return .js_undefined;

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    const received = value.toFmt(&formatter);

    if (not) {
        const signature = comptime getSignature("toBeNumber", "", true);
        return this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
    }

    const signature = comptime getSignature("toBeNumber", "", false);
    return this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;
const incrementExpectCallCounter = bun.jsc.Expect.incrementExpectCallCounter;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
