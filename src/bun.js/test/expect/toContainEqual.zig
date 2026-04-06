pub fn toContainEqual(
    this: *Expect,
    globalThis: *JSGlobalObject,
    callFrame: *CallFrame,
) bun.JSError!JSValue {
    defer this.postMatch(globalThis);
    const thisValue = callFrame.this();
    const arguments_ = callFrame.arguments_old(1);
    const arguments = arguments_.slice();

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toContainEqual() takes 1 argument", .{});
    }

    this.incrementExpectCallCounter();

    const expected = arguments[0];
    expected.ensureStillAlive();
    const value: JSValue = try this.getValue(globalThis, thisValue, "toContainEqual", "<green>expected<r>");

    const not = this.flags.not;
    var pass = false;

    const ExpectedEntry = struct {
        globalThis: *JSGlobalObject,
        expected: JSValue,
        pass: *bool,
    };

    const value_type = value.jsType();
    const expected_type = expected.jsType();

    if (value_type.isArrayLike()) {
        var itr = try value.arrayIterator(globalThis);
        while (try itr.next()) |item| {
            if (try item.jestDeepEquals(expected, globalThis)) {
                pass = true;
                break;
            }
        }
    } else if (value_type.isStringLike() and expected_type.isStringLike()) {
        if (expected_type.isStringObjectLike() and value_type.isString()) pass = false else {
            const value_string = try value.toSliceOrNull(globalThis);
            defer value_string.deinit();
            const expected_string = try expected.toSliceOrNull(globalThis);
            defer expected_string.deinit();

            // jest does not have a `typeof === "string"` check for `toContainEqual`.
            // it immediately spreads the value into an array.

            var expected_codepoint_cursor = strings.CodepointIterator.Cursor{};
            var expected_iter = strings.CodepointIterator.init(expected_string.slice());
            _ = expected_iter.next(&expected_codepoint_cursor);

            pass = if (expected_iter.next(&expected_codepoint_cursor))
                false
            else
                strings.indexOf(value_string.slice(), expected_string.slice()) != null;
        }
    } else if (try value.isIterable(globalThis)) {
        var expected_entry = ExpectedEntry{
            .globalThis = globalThis,
            .expected = expected,
            .pass = &pass,
        };
        try value.forEach(globalThis, &expected_entry, struct {
            pub fn deepEqualsIterator(
                _: *jsc.VM,
                _: *JSGlobalObject,
                entry_: ?*anyopaque,
                item: JSValue,
            ) callconv(.c) void {
                const entry = bun.cast(*ExpectedEntry, entry_.?);
                if (item.jestDeepEquals(entry.expected, entry.globalThis) catch return) {
                    entry.pass.* = true;
                    // TODO(perf): break out of the `forEach` when a match is found
                }
            }
        }.deepEqualsIterator);
    } else {
        return globalThis.throw("Received value must be an array type, or both received and expected values must be strings.", .{});
    }

    if (not) pass = !pass;
    if (pass) return thisValue;

    // handle failure
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    const value_fmt = value.toFmt(&formatter);
    const expected_fmt = expected.toFmt(&formatter);
    if (not) {
        const expected_line = "Expected to not contain: <green>{f}<r>\n";
        const signature = comptime getSignature("toContainEqual", "<green>expected<r>", true);
        return this.throw(globalThis, signature, "\n\n" ++ expected_line, .{expected_fmt});
    }

    const expected_line = "Expected to contain: <green>{f}<r>\n";
    const received_line = "Received: <red>{f}<r>\n";
    const signature = comptime getSignature("toContainEqual", "<green>expected<r>", false);
    return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
}

const bun = @import("bun");
const strings = bun.strings;

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
