pub fn toHaveBeenCalledOnce(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    jsc.markBinding(@src());

    const thisValue = callframe.this();
    defer this.postMatch(globalThis);
    const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveBeenCalledOnce", "<green>expected<r>");

    this.incrementExpectCallCounter();

    const calls = try bun.cpp.JSMockFunction__getCalls(globalThis, value);
    if (!calls.jsType().isArray()) {
        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();
        return globalThis.throw("Expected value must be a mock function: {f}", .{value.toFmt(&formatter)});
    }

    const calls_length = try calls.getLength(globalThis);
    var pass = calls_length == 1;

    const not = this.flags.not;
    if (not) pass = !pass;
    if (pass) return .js_undefined;

    // handle failure
    if (not) {
        const signature = comptime getSignature("toHaveBeenCalledOnce", "<green>expected<r>", true);
        return this.throw(globalThis, signature, "\n\n" ++ "Expected number of calls: not <green>1<r>\n" ++ "Received number of calls: <red>{d}<r>\n", .{calls_length});
    }

    const signature = comptime getSignature("toHaveBeenCalledOnce", "<green>expected<r>", false);
    return this.throw(globalThis, signature, "\n\n" ++ "Expected number of calls: <green>1<r>\n" ++ "Received number of calls: <red>{d}<r>\n", .{calls_length});
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
