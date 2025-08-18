pub fn toBeTruthy(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);
    const thisValue = callFrame.this();
    const value: JSValue = try this.getValue(globalThis, thisValue, "toBeTruthy", "");

    incrementExpectCallCounter();

    const not = this.flags.not;
    var pass = false;

    const truthy = value.toBoolean();
    if (truthy) pass = true;

    if (not) pass = !pass;
    if (pass) return .js_undefined;

    // handle failure
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    const value_fmt = value.toFmt(&formatter);
    if (not) {
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeTruthy", "", true);
        return this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
    }

    const received_line = "Received: <red>{any}<r>\n";
    const signature = comptime getSignature("toBeTruthy", "", false);
    return this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;
const incrementExpectCallCounter = bun.jsc.Expect.incrementExpectCallCounter;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
