pub fn toThrowErrorMatchingInlineSnapshot(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);
    const thisValue = callFrame.this();
    const _arguments = callFrame.arguments_old(2);
    const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

    this.incrementExpectCallCounter();

    const not = this.flags.not;
    if (not) {
        const signature = comptime getSignature("toThrowErrorMatchingInlineSnapshot", "", true);
        return this.throw(globalThis, signature, "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n", .{});
    }

    var has_expected = false;
    var expected_string: ZigString = ZigString.Empty;
    switch (arguments.len) {
        0 => {},
        1 => {
            if (arguments[0].isString()) {
                has_expected = true;
                try arguments[0].toZigString(&expected_string, globalThis);
            } else {
                return this.throw(globalThis, "", "\n\nMatcher error: Expected first argument to be a string\n", .{});
            }
        },
        else => return this.throw(globalThis, "", "\n\nMatcher error: Expected zero or one arguments\n", .{}),
    }

    var expected = expected_string.toSlice(default_allocator);
    defer expected.deinit();

    const expected_slice: ?[]const u8 = if (has_expected) expected.slice() else null;

    const value: JSValue = (try this.fnToErrStringOrUndefined(globalThis, try this.getValue(globalThis, thisValue, "toThrowErrorMatchingInlineSnapshot", "<green>properties<r><d>, <r>hint"))) orelse {
        const signature = comptime getSignature("toThrowErrorMatchingInlineSnapshot", "", false);
        return this.throw(globalThis, signature, "\n\n<b>Matcher error<r>: Received function did not throw\n", .{});
    };

    return this.inlineSnapshot(globalThis, callFrame, value, null, expected_slice, "toThrowErrorMatchingInlineSnapshot");
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
