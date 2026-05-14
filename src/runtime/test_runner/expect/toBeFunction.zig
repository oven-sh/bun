pub fn toBeFunction(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const value: JSValue = try this.getValue(globalThis, thisValue, "toBeFunction", "");

    this.incrementExpectCallCounter();

    const not = this.flags.not;
    const pass = value.isCallable() != not;

    if (pass) return .js_undefined;

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    const received = value.toFmt(&formatter);

    if (not) {
        const signature = comptime getSignature("toBeFunction", "", true);
        return this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{f}<r>\n", .{received});
    }

    const signature = comptime getSignature("toBeFunction", "", false);
    return this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{f}<r>\n", .{received});
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
