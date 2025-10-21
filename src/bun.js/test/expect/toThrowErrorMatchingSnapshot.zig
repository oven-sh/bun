pub fn toThrowErrorMatchingSnapshot(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);
    const thisValue = callFrame.this();
    const _arguments = callFrame.arguments_old(2);
    const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

    this.incrementExpectCallCounter();

    const not = this.flags.not;
    if (not) {
        const signature = comptime getSignature("toThrowErrorMatchingSnapshot", "", true);
        return this.throw(globalThis, signature, "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n", .{});
    }

    var bunTest_strong = this.bunTest() orelse {
        const signature = comptime getSignature("toThrowErrorMatchingSnapshot", "", true);
        return this.throw(globalThis, signature, "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n", .{});
    };
    defer bunTest_strong.deinit();

    var hint_string: ZigString = ZigString.Empty;
    switch (arguments.len) {
        0 => {},
        1 => {
            if (arguments[0].isString()) {
                try arguments[0].toZigString(&hint_string, globalThis);
            } else {
                return this.throw(globalThis, "", "\n\nMatcher error: Expected first argument to be a string\n", .{});
            }
        },
        else => return this.throw(globalThis, "", "\n\nMatcher error: Expected zero or one arguments\n", .{}),
    }

    var hint = hint_string.toSlice(default_allocator);
    defer hint.deinit();

    const value: JSValue = (try this.fnToErrStringOrUndefined(globalThis, try this.getValue(globalThis, thisValue, "toThrowErrorMatchingSnapshot", "<green>properties<r><d>, <r>hint"))) orelse {
        const signature = comptime getSignature("toThrowErrorMatchingSnapshot", "", false);
        return this.throw(globalThis, signature, "\n\n<b>Matcher error<r>: Received function did not throw\n", .{});
    };

    return this.snapshot(globalThis, value, null, hint.slice(), "toThrowErrorMatchingSnapshot");
}

const bun = @import("bun");
const ZigString = bun.ZigString;
const default_allocator = bun.default_allocator;

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
