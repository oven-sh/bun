pub fn toEqualIgnoringWhitespace(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const _arguments = callFrame.arguments_old(1);
    const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toEqualIgnoringWhitespace() requires 1 argument", .{});
    }

    this.incrementExpectCallCounter();

    const expected = arguments[0];
    const value: JSValue = try this.getValue(globalThis, thisValue, "toEqualIgnoringWhitespace", "<green>expected<r>");

    if (!expected.isString()) {
        return globalThis.throw("toEqualIgnoringWhitespace() requires argument to be a string", .{});
    }

    const not = this.flags.not;
    var pass = value.isString() and expected.isString();

    if (pass) {
        const value_slice = try value.toSlice(globalThis, default_allocator);
        defer value_slice.deinit();
        const expected_slice = try expected.toSlice(globalThis, default_allocator);
        defer expected_slice.deinit();

        const value_utf8 = value_slice.slice();
        const expected_utf8 = expected_slice.slice();

        var left: usize = 0;
        var right: usize = 0;

        // Skip leading whitespaces
        while (left < value_utf8.len and std.ascii.isWhitespace(value_utf8[left])) left += 1;
        while (right < expected_utf8.len and std.ascii.isWhitespace(expected_utf8[right])) right += 1;

        while (left < value_utf8.len and right < expected_utf8.len) {
            const left_char = value_utf8[left];
            const right_char = expected_utf8[right];

            if (left_char != right_char) {
                pass = false;
                break;
            }

            left += 1;
            right += 1;

            // Skip trailing whitespaces
            while (left < value_utf8.len and std.ascii.isWhitespace(value_utf8[left])) left += 1;
            while (right < expected_utf8.len and std.ascii.isWhitespace(expected_utf8[right])) right += 1;
        }

        if (left < value_utf8.len or right < expected_utf8.len) {
            pass = false;
        }
    }

    if (not) pass = !pass;
    if (pass) return .js_undefined;

    // handle failure
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    const expected_fmt = expected.toFmt(&formatter);
    const value_fmt = value.toFmt(&formatter);

    if (not) {
        const signature = comptime getSignature("toEqualIgnoringWhitespace", "<green>expected<r>", true);
        return this.throw(globalThis, signature, "\n\n" ++ "Expected: not <green>{f}<r>\n" ++ "Received: <red>{f}<r>\n", .{ expected_fmt, value_fmt });
    }

    const signature = comptime getSignature("toEqualIgnoringWhitespace", "<green>expected<r>", false);
    return this.throw(globalThis, signature, "\n\n" ++ "Expected: <green>{f}<r>\n" ++ "Received: <red>{f}<r>\n", .{ expected_fmt, value_fmt });
}

const std = @import("std");

const bun = @import("bun");
const default_allocator = bun.default_allocator;

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
