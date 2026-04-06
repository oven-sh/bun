pub fn toSatisfy(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const arguments_ = callFrame.arguments_old(1);
    const arguments = arguments_.slice();

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toSatisfy() requires 1 argument", .{});
    }

    this.incrementExpectCallCounter();

    const predicate = arguments[0];
    predicate.ensureStillAlive();

    if (!predicate.isCallable()) {
        return globalThis.throw("toSatisfy() argument must be a function", .{});
    }

    const value = Expect.js.capturedValueGetCached(thisValue) orelse {
        return globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
    };
    value.ensureStillAlive();

    const result = predicate.call(globalThis, .js_undefined, &.{value}) catch |e| {
        const err = globalThis.takeException(e);
        const fmt = ZigString.init("toSatisfy() predicate threw an exception");
        return globalThis.throwValue(try globalThis.createAggregateError(&.{err}, &fmt));
    };

    const not = this.flags.not;
    const pass = (result.isBoolean() and result.toBoolean()) != not;

    if (pass) return .js_undefined;

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    if (not) {
        const signature = comptime getSignature("toSatisfy", "<green>expected<r>", true);
        return this.throw(globalThis, signature, "\n\nExpected: not <green>{f}<r>\n", .{predicate.toFmt(&formatter)});
    }

    const signature = comptime getSignature("toSatisfy", "<green>expected<r>", false);

    return this.throw(globalThis, signature, "\n\nExpected: <green>{f}<r>\nReceived: <red>{f}<r>\n", .{
        predicate.toFmt(&formatter),
        value.toFmt(&formatter),
    });
}

const bun = @import("bun");
const ZigString = bun.ZigString;

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
