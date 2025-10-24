pub fn toBeOneOf(
    this: *Expect,
    globalThis: *JSGlobalObject,
    callFrame: *CallFrame,
) bun.JSError!JSValue {
    defer this.postMatch(globalThis);
    const thisValue = callFrame.this();
    const arguments_ = callFrame.arguments_old(1);
    const arguments = arguments_.slice();

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toBeOneOf() takes 1 argument", .{});
    }

    this.incrementExpectCallCounter();

    const expected = try this.getValue(globalThis, thisValue, "toBeOneOf", "<green>expected<r>");
    const list_value: JSValue = arguments[0];

    const not = this.flags.not;
    var pass = false;

    const ExpectedEntry = struct {
        globalThis: *JSGlobalObject,
        expected: JSValue,
        pass: *bool,
    };

    if (list_value.jsTypeLoose().isArrayLike()) {
        var itr = try list_value.arrayIterator(globalThis);
        while (try itr.next()) |item| {
            // Confusingly, jest-extended uses `deepEqual`, instead of `toBe`
            if (try item.jestDeepEquals(expected, globalThis)) {
                pass = true;
                break;
            }
        }
    } else if (try list_value.isIterable(globalThis)) {
        var expected_entry = ExpectedEntry{
            .globalThis = globalThis,
            .expected = expected,
            .pass = &pass,
        };
        try list_value.forEach(globalThis, &expected_entry, struct {
            pub fn sameValueIterator(
                _: *jsc.VM,
                _: *JSGlobalObject,
                entry_: ?*anyopaque,
                item: JSValue,
            ) callconv(.c) void {
                const entry = bun.cast(*ExpectedEntry, entry_.?);
                // Confusingly, jest-extended uses `deepEqual`, instead of `toBe`
                if (item.jestDeepEquals(entry.expected, entry.globalThis) catch return) {
                    entry.pass.* = true;
                    // TODO(perf): break out of the `forEach` when a match is found
                }
            }
        }.sameValueIterator);
    } else {
        return globalThis.throw("Received value must be an array type, or both received and expected values must be strings.", .{});
    }

    if (not) pass = !pass;
    if (pass) return .js_undefined;

    // handle failure
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    const value_fmt = list_value.toFmt(&formatter);
    const expected_fmt = expected.toFmt(&formatter);
    if (not) {
        const received_fmt = list_value.toFmt(&formatter);
        const expected_line = "Expected to not be one of: <green>{f}<r>\nReceived: <red>{f}<r>\n";
        const signature = comptime getSignature("toBeOneOf", "<green>expected<r>", true);
        return this.throw(globalThis, signature, "\n\n" ++ expected_line, .{ received_fmt, expected_fmt });
    }

    const expected_line = "Expected to be one of: <green>{f}<r>\n";
    const received_line = "Received: <red>{f}<r>\n";
    const signature = comptime getSignature("toBeOneOf", "<green>expected<r>", false);
    return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ value_fmt, expected_fmt });
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
