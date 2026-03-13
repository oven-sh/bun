pub fn toHaveLastReturnedWith(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    jsc.markBinding(@src());

    const thisValue = callframe.this();
    defer this.postMatch(globalThis);

    const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveBeenLastReturnedWith", "<green>expected<r>");

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
    var last_return_value: JSValue = .js_undefined;
    var last_call_threw = false;
    var last_error_value: JSValue = .js_undefined;

    if (calls_count > 0) {
        const last_result = returns.getDirectIndex(globalThis, calls_count - 1);

        if (last_result.isObject()) {
            const result_type = try last_result.get(globalThis, "type") orelse .js_undefined;
            if (result_type.isString()) {
                const type_str = try result_type.toBunString(globalThis);
                defer type_str.deref();

                if (type_str.eqlComptime("return")) {
                    last_return_value = try last_result.get(globalThis, "value") orelse .js_undefined;

                    if (try last_return_value.jestDeepEquals(expected, globalThis)) {
                        pass = true;
                    }
                } else if (type_str.eqlComptime("throw")) {
                    last_call_threw = true;
                    last_error_value = try last_result.get(globalThis, "value") orelse .js_undefined;
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

    const signature = comptime getSignature("toHaveBeenLastReturnedWith", "<green>expected<r>", false);

    if (this.flags.not) {
        return this.throw(globalThis, comptime getSignature("toHaveBeenLastReturnedWith", "<green>expected<r>", true), "\n\n" ++ "Expected mock function not to have last returned: <green>{f}<r>\n" ++ "But it did.\n", .{expected.toFmt(&formatter)});
    }

    if (calls_count == 0) {
        return this.throw(globalThis, signature, "\n\n" ++ "The mock function was not called.", .{});
    }

    if (last_call_threw) {
        return this.throw(globalThis, signature, "\n\n" ++ "The last call threw an error: <red>{f}<r>\n", .{last_error_value.toFmt(&formatter)});
    }

    // Diff if possible
    if (expected.isString() and last_return_value.isString()) {
        const diff_format = DiffFormatter{ .expected = expected, .received = last_return_value, .globalThis = globalThis, .not = false };
        return this.throw(globalThis, signature, "\n\n{f}\n", .{diff_format});
    }

    return this.throw(globalThis, signature, "\n\nExpected: <green>{f}<r>\nReceived: <red>{f}<r>", .{ expected.toFmt(&formatter), last_return_value.toFmt(&formatter) });
}

const bun = @import("bun");
const DiffFormatter = @import("../diff_format.zig").DiffFormatter;

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;
const mock = bun.jsc.Expect.mock;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
