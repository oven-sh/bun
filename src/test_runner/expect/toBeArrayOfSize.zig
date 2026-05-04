pub fn toBeArrayOfSize(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const _arguments = callFrame.arguments_old(1);
    const arguments = _arguments.ptr[0.._arguments.len];

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toBeArrayOfSize() requires 1 argument", .{});
    }

    const value: JSValue = try this.getValue(globalThis, thisValue, "toBeArrayOfSize", "");

    const size = arguments[0];
    size.ensureStillAlive();

    if (!size.isAnyInt()) {
        return globalThis.throw("toBeArrayOfSize() requires the first argument to be a number", .{});
    }

    this.incrementExpectCallCounter();

    const not = this.flags.not;
    var pass = value.jsType().isArray() and @as(i32, @intCast(try value.getLength(globalThis))) == size.toInt32();

    if (not) pass = !pass;
    if (pass) return .js_undefined;

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    const received = value.toFmt(&formatter);

    if (not) {
        const signature = comptime getSignature("toBeArrayOfSize", "", true);
        return this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{f}<r>\n", .{received});
    }

    const signature = comptime getSignature("toBeArrayOfSize", "", false);
    return this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{f}<r>\n", .{received});
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
