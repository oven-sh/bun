inline fn toHaveReturnedTimesFn(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame, comptime mode: enum { toHaveReturned, toHaveReturnedTimes }) bun.JSError!JSValue {
    jsc.markBinding(@src());

    const thisValue = callframe.this();
    const arguments = callframe.arguments();
    defer this.postMatch(globalThis);

    const value: JSValue = try this.getValue(globalThis, thisValue, @tagName(mode), "<green>expected<r>");

    this.incrementExpectCallCounter();

    var returns = try mock.jestMockIterator(globalThis, value);

    const expected_success_count: i32 = if (mode == .toHaveReturned) brk: {
        if (arguments.len > 0 and !arguments[0].isUndefined()) {
            return globalThis.throwInvalidArguments(@tagName(mode) ++ "() must not have an argument", .{});
        }
        break :brk 1;
    } else brk: {
        if (arguments.len < 1 or !arguments[0].isUInt32AsAnyInt()) {
            return globalThis.throwInvalidArguments(@tagName(mode) ++ "() requires 1 non-negative integer argument", .{});
        }

        break :brk try arguments[0].coerce(i32, globalThis);
    };

    var pass = false;

    var actual_success_count: i32 = 0;
    var total_call_count: i32 = 0;
    while (try returns.next()) |item| {
        switch (try mock.jestMockReturnObject_type(globalThis, item)) {
            .@"return" => actual_success_count += 1,
            else => {},
        }
        total_call_count += 1;
    }

    pass = switch (mode) {
        .toHaveReturned => actual_success_count >= expected_success_count,
        .toHaveReturnedTimes => actual_success_count == expected_success_count,
    };

    const not = this.flags.not;
    if (not) pass = !pass;
    if (pass) return .js_undefined;

    switch (not) {
        inline else => |is_not| {
            const signature = comptime getSignature(@tagName(mode), "<green>expected<r>", is_not);
            const str: []const u8, const spc: []const u8 = switch (mode) {
                .toHaveReturned => switch (not) {
                    false => .{ ">= ", "   " },
                    true => .{ "< ", "  " },
                },
                .toHaveReturnedTimes => switch (not) {
                    false => .{ "== ", "   " },
                    true => .{ "!= ", "   " },
                },
            };
            return this.throw(globalThis, signature,
                \\
                \\
                \\Expected number of succesful returns: {s}<green>{d}<r>
                \\Received number of succesful returns: {s}<red>{d}<r>
                \\Received number of calls:             {s}<red>{d}<r>
                \\
            , .{ str, expected_success_count, spc, actual_success_count, spc, total_call_count });
        },
    }
}

pub fn toHaveReturned(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    return toHaveReturnedTimesFn(this, globalThis, callframe, .toHaveReturned);
}

pub fn toHaveReturnedTimes(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
    return toHaveReturnedTimesFn(this, globalThis, callframe, .toHaveReturnedTimes);
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;
const mock = bun.jsc.Expect.mock;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
