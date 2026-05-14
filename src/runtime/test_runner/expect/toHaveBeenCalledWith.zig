pub fn toHaveBeenCalledWith(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    jsc.markBinding(@src());

    const thisValue = callframe.this();
    const arguments = callframe.arguments();
    defer this.postMatch(globalThis);
    const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveBeenCalledWith", "<green>...expected<r>");

    this.incrementExpectCallCounter();

    const calls = try bun.cpp.JSMockFunction__getCalls(globalThis, value);
    if (!calls.jsType().isArray()) {
        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();
        return this.throw(globalThis, comptime getSignature("toHaveBeenCalledWith", "<green>...expected<r>", false), "\n\nMatcher error: <red>received<r> value must be a mock function\nReceived: {f}", .{value.toFmt(&formatter)});
    }

    var pass = false;

    const calls_count = @as(u32, @intCast(try calls.getLength(globalThis)));
    if (calls_count > 0) {
        var itr = try calls.arrayIterator(globalThis);
        while (try itr.next()) |callItem| {
            if (callItem == .zero or !callItem.jsType().isArray()) {
                // This indicates a malformed mock object, which is an internal error.
                return globalThis.throw("Internal error: expected mock call item to be an array of arguments.", .{});
            }

            if (try callItem.getLength(globalThis) != arguments.len) {
                continue;
            }

            var callItr = try callItem.arrayIterator(globalThis);
            var match = true;
            while (try callItr.next()) |callArg| {
                if (!try callArg.jestDeepEquals(arguments[callItr.i - 1], globalThis)) {
                    match = false;
                    break;
                }
            }

            if (match) {
                pass = true;
                break;
            }
        }
    }

    if (pass != this.flags.not) {
        return .js_undefined;
    }

    // handle failure
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    const expected_args_js_array = try JSValue.createEmptyArray(globalThis, arguments.len);
    for (arguments, 0..) |arg, i| {
        try expected_args_js_array.putIndex(globalThis, @intCast(i), arg);
    }
    expected_args_js_array.ensureStillAlive();

    if (this.flags.not) {
        const signature = comptime getSignature("toHaveBeenCalledWith", "<green>...expected<r>", true);
        return this.throw(globalThis, signature, "\n\nExpected mock function not to have been called with: <green>{f}<r>\nBut it was.", .{
            expected_args_js_array.toFmt(&formatter),
        });
    }
    const signature = comptime getSignature("toHaveBeenCalledWith", "<green>...expected<r>", false);

    if (calls_count == 0) {
        return this.throw(globalThis, signature, "\n\nExpected: <green>{f}<r>\nBut it was not called.", .{
            expected_args_js_array.toFmt(&formatter),
        });
    }

    // If there's only one call, provide a nice diff.
    if (calls_count == 1) {
        const received_call_args = try calls.getIndex(globalThis, 0);
        const diff_format = DiffFormatter{
            .expected = expected_args_js_array,
            .received = received_call_args,
            .globalThis = globalThis,
            .not = false,
        };
        return this.throw(globalThis, signature, "\n\n{f}\n", .{diff_format});
    }

    // If there are multiple calls, list them all to help debugging.
    const list_formatter = mock.AllCallsWithArgsFormatter{
        .globalThis = globalThis,
        .calls = calls,
        .formatter = &formatter,
    };

    const fmt =
        \\    <green>Expected<r>: {f}
        \\    <red>Received<r>:
        \\{f}
        \\
        \\    Number of calls: {d}
    ;

    switch (Output.enable_ansi_colors_stderr) {
        inline else => |colors| {
            return this.throw(globalThis, signature, Output.prettyFmt("\n\n" ++ fmt ++ "\n", colors), .{
                expected_args_js_array.toFmt(&formatter),
                list_formatter,
                calls_count,
            });
        },
    }
}

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
