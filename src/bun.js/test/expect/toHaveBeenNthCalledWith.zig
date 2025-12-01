pub fn toHaveBeenNthCalledWith(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    jsc.markBinding(@src());

    const thisValue = callframe.this();
    const arguments = callframe.arguments();
    defer this.postMatch(globalThis);
    const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveBeenNthCalledWith", "<green>n<r>, <green>...expected<r>");

    this.incrementExpectCallCounter();

    const calls = try bun.cpp.JSMockFunction__getCalls(globalThis, value);
    if (!calls.jsType().isArray()) {
        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();
        return this.throw(globalThis, comptime getSignature("toHaveBeenNthCalledWith", "<green>n<r>, <green>...expected<r>", false), "\n\nMatcher error: <red>received<r> value must be a mock function\nReceived: {f}", .{value.toFmt(&formatter)});
    }

    if (arguments.len == 0 or !arguments[0].isAnyInt()) {
        return globalThis.throwInvalidArguments("toHaveBeenNthCalledWith() requires a positive integer as the first argument", .{});
    }
    const nthCallNumI32 = arguments[0].toInt32();

    if (nthCallNumI32 <= 0) {
        return globalThis.throwInvalidArguments("toHaveBeenNthCalledWith() first argument must be a positive integer", .{});
    }
    const nthCallNum: u32 = @intCast(nthCallNumI32);

    const totalCalls = @as(u32, @intCast(try calls.getLength(globalThis)));
    var pass = totalCalls >= nthCallNum;
    var nthCallValue: JSValue = .zero;

    if (pass) {
        nthCallValue = try calls.getIndex(globalThis, nthCallNum - 1);
        const expected_args = arguments[1..];

        if (!nthCallValue.jsType().isArray()) {
            return globalThis.throw("Internal error: expected mock call item to be an array of arguments.", .{});
        }

        if (try nthCallValue.getLength(globalThis) != expected_args.len) {
            pass = false;
        } else {
            var itr = try nthCallValue.arrayIterator(globalThis);
            while (try itr.next()) |callArg| {
                if (!try callArg.jestDeepEquals(expected_args[itr.i - 1], globalThis)) {
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

    const expected_args_slice = arguments[1..];
    const expected_args_js_array = try JSValue.createEmptyArray(globalThis, expected_args_slice.len);
    for (expected_args_slice, 0..) |arg, i| {
        try expected_args_js_array.putIndex(globalThis, @intCast(i), arg);
    }
    expected_args_js_array.ensureStillAlive();

    if (this.flags.not) {
        const signature = comptime getSignature("toHaveBeenNthCalledWith", "<green>n<r>, <green>...expected<r>", true);
        return this.throw(globalThis, signature, "\n\nExpected call #{d} not to be with: <green>{f}<r>\nBut it was.", .{
            nthCallNum,
            expected_args_js_array.toFmt(&formatter),
        });
    }
    const signature = comptime getSignature("toHaveBeenNthCalledWith", "<green>n<r>, <green>...expected<r>", false);

    // Handle case where function was not called enough times
    if (totalCalls < nthCallNum) {
        return this.throw(globalThis, signature, "\n\nThe mock function was called {d} time{s}, but call {d} was requested.", .{
            totalCalls,
            if (totalCalls == 1) "" else "s",
            nthCallNum,
        });
    }

    // The call existed but didn't match. Show a diff.
    const diff_format = DiffFormatter{
        .expected = expected_args_js_array,
        .received = nthCallValue,
        .globalThis = globalThis,
        .not = false,
    };
    return this.throw(globalThis, signature, "\n\nCall #{d}:\n{f}\n", .{ nthCallNum, diff_format });
}

const bun = @import("bun");
const DiffFormatter = @import("../diff_format.zig").DiffFormatter;

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
