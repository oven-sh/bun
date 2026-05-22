pub fn toHaveReturnedWith(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    jsc.markBinding(@src());

    const thisValue = callframe.this();
    defer this.postMatch(globalThis);

    const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveReturnedWith", "<green>expected<r>");

    const expected = callframe.argumentsAsArray(1)[0];
    this.incrementExpectCallCounter();

    const returns = try bun.cpp.JSMockFunction__getReturns(globalThis, value);
    if (!returns.jsType().isArray()) {
        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();
        return globalThis.throw("Expected value must be a mock function: {f}", .{value.toFmt(&formatter)});
    }

    const calls_count = @as(u32, @intCast(try returns.getLength(globalThis)));
    var pass = false;

    var successful_returns = std.array_list.Managed(JSValue).init(globalThis.bunVM().allocator);
    defer successful_returns.deinit();

    var has_errors = false;

    // Check for a pass and collect info for error messages
    for (0..calls_count) |i| {
        const result = returns.getDirectIndex(globalThis, @truncate(i));

        if (result.isObject()) {
            const result_type = try result.get(globalThis, "type") orelse .js_undefined;
            if (result_type.isString()) {
                const type_str = try result_type.toBunString(globalThis);
                defer type_str.deref();

                if (type_str.eqlComptime("return")) {
                    const result_value = try result.get(globalThis, "value") orelse .js_undefined;
                    try successful_returns.append(result_value);

                    // Check for pass condition only if not already passed
                    if (!pass) {
                        if (try result_value.jestDeepEquals(expected, globalThis)) {
                            pass = true;
                        }
                    }
                } else if (type_str.eqlComptime("throw")) {
                    has_errors = true;
                }
            }
        }
    }

    if (pass != this.flags.not) {
        return .js_undefined;
    }

    // Handle failure
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    const signature = comptime getSignature("toHaveReturnedWith", "<green>expected<r>", false);

    if (this.flags.not) {
        const not_signature = comptime getSignature("toHaveReturnedWith", "<green>expected<r>", true);
        return this.throw(globalThis, not_signature, "\n\n" ++ "Expected mock function not to have returned: <green>{f}<r>\n", .{expected.toFmt(&formatter)});
    }

    // No match was found.
    const successful_returns_count = successful_returns.items.len;

    // Case: Only one successful return, no errors
    if (calls_count == 1 and successful_returns_count == 1) {
        const received = successful_returns.items[0];
        if (expected.isString() and received.isString()) {
            const diff_format = DiffFormatter{
                .expected = expected,
                .received = received,
                .globalThis = globalThis,
                .not = false,
            };
            return this.throw(globalThis, signature, "\n\n{f}\n", .{diff_format});
        }

        return this.throw(globalThis, signature, "\n\nExpected: <green>{f}<r>\nReceived: <red>{f}<r>", .{
            expected.toFmt(&formatter),
            received.toFmt(&formatter),
        });
    }

    if (has_errors) {
        // Case: Some calls errored
        const list_formatter = mock.AllCallsFormatter{
            .globalThis = globalThis,
            .returns = returns,
            .formatter = &formatter,
        };
        const fmt =
            \\Some calls errored:
            \\
            \\    Expected: {f}
            \\    Received:
            \\{f}
            \\
            \\    Number of returns: {d}
            \\    Number of calls:   {d}
        ;

        switch (Output.enable_ansi_colors_stderr) {
            inline else => |colors| {
                return this.throw(globalThis, signature, Output.prettyFmt("\n\n" ++ fmt ++ "\n", colors), .{
                    expected.toFmt(&formatter),
                    list_formatter,
                    successful_returns_count,
                    calls_count,
                });
            },
        }
    } else {
        // Case: No errors, but no match (and multiple returns)
        const list_formatter = mock.SuccessfulReturnsFormatter{
            .globalThis = globalThis,
            .successful_returns = &successful_returns,
            .formatter = &formatter,
        };
        const fmt =
            \\    <green>Expected<r>: {f}
            \\    <red>Received<r>:
            \\{f}
            \\
            \\    Number of returns: {d}
        ;

        switch (Output.enable_ansi_colors_stderr) {
            inline else => |colors| {
                return this.throw(globalThis, signature, Output.prettyFmt("\n\n" ++ fmt ++ "\n", colors), .{
                    expected.toFmt(&formatter),
                    list_formatter,
                    successful_returns_count,
                });
            },
        }
    }
}

const std = @import("std");
const DiffFormatter = @import("../diff_format.zig").DiffFormatter;

const bun = @import("bun");
const Output = bun.Output;

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;
const mock = bun.jsc.Expect.mock;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
