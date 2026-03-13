pub fn toHaveBeenLastCalledWith(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    jsc.markBinding(@src());

    const thisValue = callframe.this();
    const arguments = callframe.arguments();
    defer this.postMatch(globalThis);
    const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveBeenLastCalledWith", "<green>...expected<r>");

    this.incrementExpectCallCounter();

    const calls = try bun.cpp.JSMockFunction__getCalls(globalThis, value);
    if (!calls.jsType().isArray()) {
        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();
        return this.throw(globalThis, comptime getSignature("toHaveBeenLastCalledWith", "<green>...expected<r>", false), "\n\nMatcher error: <red>received<r> value must be a mock function\nReceived: {f}", .{value.toFmt(&formatter)});
    }

    const totalCalls: u32 = @truncate(try calls.getLength(globalThis));
    var lastCallValue: JSValue = .zero;

    var pass = totalCalls > 0;

    if (pass) {
        lastCallValue = try calls.getIndex(globalThis, totalCalls - 1);

        if (!lastCallValue.jsType().isArray()) {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();
            return globalThis.throw("Expected value must be a mock function with calls: {f}", .{value.toFmt(&formatter)});
        }

        if (try lastCallValue.getLength(globalThis) != arguments.len) {
            pass = false;
        } else {
            var itr = try lastCallValue.arrayIterator(globalThis);
            while (try itr.next()) |callArg| {
                if (!try callArg.jestDeepEquals(arguments[itr.i - 1], globalThis)) {
                    pass = false;
                    break;
                }
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
        const signature = comptime getSignature("toHaveBeenLastCalledWith", "<green>...expected<r>", true);
        return this.throw(globalThis, signature, "\n\nExpected last call not to be with: <green>{f}<r>\nBut it was.", .{
            expected_args_js_array.toFmt(&formatter),
        });
    }
    const signature = comptime getSignature("toHaveBeenLastCalledWith", "<green>...expected<r>", false);

    if (totalCalls == 0) {
        return this.throw(globalThis, signature, "\n\nExpected: <green>{f}<r>\nBut it was not called.", .{
            expected_args_js_array.toFmt(&formatter),
        });
    }

    const diff_format = DiffFormatter{
        .expected = expected_args_js_array,
        .received = lastCallValue,
        .globalThis = globalThis,
        .not = false,
    };
    return this.throw(globalThis, signature, "\n\n{f}\n", .{diff_format});
}

const bun = @import("bun");
const DiffFormatter = @import("../diff_format.zig").DiffFormatter;

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
