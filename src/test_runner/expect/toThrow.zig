pub fn toThrow(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const arguments = callFrame.argumentsAsArray(1);

    this.incrementExpectCallCounter();

    const expected_value: JSValue = brk: {
        const value = arguments[0];
        if (value.isUndefined()) {
            break :brk .zero;
        }
        if (value.isUndefinedOrNull() or !value.isObject() and !value.isString()) {
            var fmt = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            return globalThis.throw("Expected value must be string or Error: {f}", .{value.toFmt(&fmt)});
        }
        if (value.isObject()) {
            if (ExpectAny.fromJSDirect(value)) |_| {
                if (ExpectAny.js.constructorValueGetCached(value)) |innerConstructorValue| {
                    break :brk innerConstructorValue;
                }
            }
        } else if (value.isString()) {
            // `.toThrow("") behaves the same as `.toThrow()`
            const s = try value.toJSString(globalThis);
            if (s.length() == 0) break :brk .zero;
        }
        break :brk value;
    };
    expected_value.ensureStillAlive();

    const not = this.flags.not;

    const result_, const return_value_from_function = try this.getValueAsToThrow(globalThis, try this.getValue(globalThis, thisValue, "toThrow", "<green>expected<r>"));

    const did_throw = result_ != null;

    if (not) {
        const signature = comptime getSignature("toThrow", "<green>expected<r>", true);

        if (!did_throw) return .js_undefined;

        const result: JSValue = result_.?;
        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();

        if (expected_value == .zero or expected_value.isUndefined()) {
            const signature_no_args = comptime getSignature("toThrow", "", true);
            if (result.toError()) |err| {
                const name: JSValue = try err.getTruthyComptime(globalThis, "name") orelse .js_undefined;
                const message: JSValue = try err.getTruthyComptime(globalThis, "message") orelse .js_undefined;
                const fmt = signature_no_args ++ "\n\nError name: <red>{f}<r>\nError message: <red>{f}<r>\n";
                return globalThis.throwPretty(fmt, .{
                    name.toFmt(&formatter),
                    message.toFmt(&formatter),
                });
            }

            // non error thrown
            const fmt = signature_no_args ++ "\n\nThrown value: <red>{f}<r>\n";
            return globalThis.throwPretty(fmt, .{result.toFmt(&formatter)});
        }

        if (expected_value.isString()) {
            const received_message: JSValue = (if (result.isObject())
                try result.fastGet(globalThis, .message)
            else
                JSValue.fromCell(try result.toJSString(globalThis))) orelse .js_undefined;
            if (globalThis.hasException()) return .zero;

            // TODO: remove this allocation
            // partial match
            {
                const expected_slice = try expected_value.toSliceOrNull(globalThis);
                defer expected_slice.deinit();
                const received_slice = try received_message.toSliceOrNull(globalThis);
                defer received_slice.deinit();
                if (!strings.contains(received_slice.slice(), expected_slice.slice())) return .js_undefined;
            }

            return this.throw(globalThis, signature, "\n\nExpected substring: not <green>{f}<r>\nReceived message: <red>{f}<r>\n", .{
                expected_value.toFmt(&formatter),
                received_message.toFmt(&formatter),
            });
        }

        if (expected_value.isRegExp()) {
            const received_message: JSValue = (if (result.isObject())
                try result.fastGet(globalThis, .message)
            else
                JSValue.fromCell(try result.toJSString(globalThis))) orelse .js_undefined;

            if (globalThis.hasException()) return .zero;
            // TODO: REMOVE THIS GETTER! Expose a binding to call .test on the RegExp object directly.
            if (try expected_value.get(globalThis, "test")) |test_fn| {
                const matches = test_fn.call(globalThis, expected_value, &.{received_message}) catch |err| globalThis.takeException(err);
                if (!matches.toBoolean()) return .js_undefined;
            }

            return this.throw(globalThis, signature, "\n\nExpected pattern: not <green>{f}<r>\nReceived message: <red>{f}<r>\n", .{
                expected_value.toFmt(&formatter),
                received_message.toFmt(&formatter),
            });
        }

        if (try expected_value.fastGet(globalThis, .message)) |expected_message| {
            const received_message: JSValue = (if (result.isObject())
                try result.fastGet(globalThis, .message)
            else
                JSValue.fromCell(try result.toJSString(globalThis))) orelse .js_undefined;
            if (globalThis.hasException()) return .zero;

            // no partial match for this case
            if (!try expected_message.isSameValue(received_message, globalThis)) return .js_undefined;

            return this.throw(globalThis, signature, "\n\nExpected message: not <green>{f}<r>\n", .{expected_message.toFmt(&formatter)});
        }

        if (!result.isInstanceOf(globalThis, expected_value)) return .js_undefined;

        var expected_class = ZigString.Empty;
        try expected_value.getClassName(globalThis, &expected_class);
        const received_message: JSValue = (try result.fastGet(globalThis, .message)) orelse .js_undefined;
        return this.throw(globalThis, signature, "\n\nExpected constructor: not <green>{f}<r>\n\nReceived message: <red>{f}<r>\n", .{ expected_class, received_message.toFmt(&formatter) });
    }

    if (did_throw) {
        if (expected_value == .zero or expected_value.isUndefined()) return .js_undefined;

        const result: JSValue = if (result_.?.toError()) |r|
            r
        else
            result_.?;

        const _received_message: ?JSValue = if (result.isObject())
            try result.fastGet(globalThis, .message)
        else
            JSValue.fromCell(try result.toJSString(globalThis));

        if (expected_value.isString()) {
            if (_received_message) |received_message| {
                // TODO: remove this allocation
                // partial match
                const expected_slice = try expected_value.toSliceOrNull(globalThis);
                defer expected_slice.deinit();
                const received_slice = try received_message.toSlice(globalThis, globalThis.allocator());
                defer received_slice.deinit();
                if (strings.contains(received_slice.slice(), expected_slice.slice())) return .js_undefined;
            }

            // error: message from received error does not match expected string
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();

            const signature = comptime getSignature("toThrow", "<green>expected<r>", false);

            if (_received_message) |received_message| {
                const expected_value_fmt = expected_value.toFmt(&formatter);
                const received_message_fmt = received_message.toFmt(&formatter);
                return this.throw(globalThis, signature, "\n\n" ++ "Expected substring: <green>{f}<r>\nReceived message: <red>{f}<r>\n", .{ expected_value_fmt, received_message_fmt });
            }

            const expected_fmt = expected_value.toFmt(&formatter);
            const received_fmt = result.toFmt(&formatter);
            return this.throw(globalThis, signature, "\n\n" ++ "Expected substring: <green>{f}<r>\nReceived value: <red>{f}<r>", .{ expected_fmt, received_fmt });
        }

        if (expected_value.isRegExp()) {
            if (_received_message) |received_message| {
                // TODO: REMOVE THIS GETTER! Expose a binding to call .test on the RegExp object directly.
                if (try expected_value.get(globalThis, "test")) |test_fn| {
                    const matches = test_fn.call(globalThis, expected_value, &.{received_message}) catch |err| globalThis.takeException(err);
                    if (matches.toBoolean()) return .js_undefined;
                }
            }

            // error: message from received error does not match expected pattern
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();

            if (_received_message) |received_message| {
                const expected_value_fmt = expected_value.toFmt(&formatter);
                const received_message_fmt = received_message.toFmt(&formatter);
                const signature = comptime getSignature("toThrow", "<green>expected<r>", false);

                return this.throw(globalThis, signature, "\n\n" ++ "Expected pattern: <green>{f}<r>\nReceived message: <red>{f}<r>\n", .{ expected_value_fmt, received_message_fmt });
            }

            const expected_fmt = expected_value.toFmt(&formatter);
            const received_fmt = result.toFmt(&formatter);
            const signature = comptime getSignature("toThrow", "<green>expected<r>", false);
            return this.throw(globalThis, signature, "\n\n" ++ "Expected pattern: <green>{f}<r>\nReceived value: <red>{f}<r>", .{ expected_fmt, received_fmt });
        }

        if (Expect.isAsymmetricMatcher(expected_value)) {
            const signature = comptime getSignature("toThrow", "<green>expected<r>", false);
            const is_equal = try result.jestStrictDeepEquals(expected_value, globalThis);

            if (globalThis.hasException()) {
                return .zero;
            }

            if (is_equal) {
                return .js_undefined;
            }

            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();
            const received_fmt = result.toFmt(&formatter);
            const expected_fmt = expected_value.toFmt(&formatter);
            return this.throw(globalThis, signature, "\n\nExpected value: <green>{f}<r>\nReceived value: <red>{f}<r>\n", .{ expected_fmt, received_fmt });
        }

        // If it's not an object, we are going to crash here.
        assert(expected_value.isObject());

        if (try expected_value.fastGet(globalThis, .message)) |expected_message| {
            const signature = comptime getSignature("toThrow", "<green>expected<r>", false);

            if (_received_message) |received_message| {
                if (try received_message.isSameValue(expected_message, globalThis)) return .js_undefined;
            }

            // error: message from received error does not match expected error message.
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();

            if (_received_message) |received_message| {
                const expected_fmt = expected_message.toFmt(&formatter);
                const received_fmt = received_message.toFmt(&formatter);
                return this.throw(globalThis, signature, "\n\nExpected message: <green>{f}<r>\nReceived message: <red>{f}<r>\n", .{ expected_fmt, received_fmt });
            }

            const expected_fmt = expected_message.toFmt(&formatter);
            const received_fmt = result.toFmt(&formatter);
            return this.throw(globalThis, signature, "\n\nExpected message: <green>{f}<r>\nReceived value: <red>{f}<r>\n", .{ expected_fmt, received_fmt });
        }

        if (result.isInstanceOf(globalThis, expected_value)) return .js_undefined;

        // error: received error not instance of received error constructor
        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();
        var expected_class = ZigString.Empty;
        var received_class = ZigString.Empty;
        try expected_value.getClassName(globalThis, &expected_class);
        try result.getClassName(globalThis, &received_class);
        const signature = comptime getSignature("toThrow", "<green>expected<r>", false);
        const fmt = signature ++ "\n\nExpected constructor: <green>{f}<r>\nReceived constructor: <red>{f}<r>\n\n";

        if (_received_message) |received_message| {
            const message_fmt = fmt ++ "Received message: <red>{f}<r>\n";
            const received_message_fmt = received_message.toFmt(&formatter);

            return globalThis.throwPretty(message_fmt, .{
                expected_class,
                received_class,
                received_message_fmt,
            });
        }

        const received_fmt = result.toFmt(&formatter);
        const value_fmt = fmt ++ "Received value: <red>{f}<r>\n";

        return globalThis.throwPretty(value_fmt, .{
            expected_class,
            received_class,
            received_fmt,
        });
    }

    // did not throw
    const result = return_value_from_function;
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    const received_line = "Received function did not throw\nReceived value: <red>{f}<r>\n";

    if (expected_value == .zero or expected_value.isUndefined()) {
        const signature = comptime getSignature("toThrow", "", false);
        return this.throw(globalThis, signature, "\n\n" ++ received_line, .{result.toFmt(&formatter)});
    }

    const signature = comptime getSignature("toThrow", "<green>expected<r>", false);

    if (expected_value.isString()) {
        const expected_fmt = "\n\nExpected substring: <green>{f}<r>\n\n" ++ received_line;
        return this.throw(globalThis, signature, expected_fmt, .{ expected_value.toFmt(&formatter), result.toFmt(&formatter) });
    }

    if (expected_value.isRegExp()) {
        const expected_fmt = "\n\nExpected pattern: <green>{f}<r>\n\n" ++ received_line;
        return this.throw(globalThis, signature, expected_fmt, .{ expected_value.toFmt(&formatter), result.toFmt(&formatter) });
    }

    if (try expected_value.fastGet(globalThis, .message)) |expected_message| {
        const expected_fmt = "\n\nExpected message: <green>{f}<r>\n\n" ++ received_line;
        return this.throw(globalThis, signature, expected_fmt, .{ expected_message.toFmt(&formatter), result.toFmt(&formatter) });
    }

    const expected_fmt = "\n\nExpected constructor: <green>{f}<r>\n\n" ++ received_line;
    var expected_class = ZigString.Empty;
    try expected_value.getClassName(globalThis, &expected_class);
    return this.throw(globalThis, signature, expected_fmt, .{ expected_class, result.toFmt(&formatter) });
}

const bun = @import("bun");
const ZigString = bun.ZigString;
const assert = bun.assert;
const strings = bun.strings;

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;
const ExpectAny = bun.jsc.Expect.ExpectAny;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
