const std = @import("std");
const bun = @import("root").bun;
const default_allocator = bun.default_allocator;
const string = bun.string;
const MutableString = bun.MutableString;
const strings = bun.strings;
const Output = bun.Output;
const jest = bun.JSC.Jest;
const Jest = jest.Jest;
const TestRunner = jest.TestRunner;
const DescribeScope = jest.DescribeScope;
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSType = JSValue.JSType;
const JSError = JSC.JSError;
const JSObject = JSC.JSObject;
const CallFrame = JSC.CallFrame;
const ZigString = JSC.ZigString;
const Environment = bun.Environment;
const DiffFormatter = @import("./diff_format.zig").DiffFormatter;

pub const Counter = struct {
    expected: u32 = 0,
    actual: u32 = 0,
};

const JSTypeOfMap = bun.ComptimeStringMap([]const u8, .{
    .{ "function", "function" },
    .{ "object", "object" },
    .{ "bigint", "bigint" },
    .{ "boolean", "boolean" },
    .{ "number", "number" },
    .{ "string", "string" },
    .{ "symbol", "symbol" },
    .{ "undefined", "undefined" },
});

pub var active_test_expectation_counter: Counter = .{};

/// https://jestjs.io/docs/expect
// To support async tests, we need to track the test ID
pub const Expect = struct {
    pub usingnamespace JSC.Codegen.JSExpect;

    test_id: TestRunner.Test.ID,
    scope: *DescribeScope,
    flags: Flags = .{},

    pub const Flags = packed struct {
        promise: enum(u2) {
            resolves,
            rejects,
            none,
        } = .none,
        not: bool = false,
    };

    pub fn getSignature(comptime matcher_name: string, comptime args: string, comptime not: bool) string {
        const received = "<d>expect(<r><red>received<r><d>).<r>";
        comptime if (not) {
            return received ++ "not<d>.<r>" ++ matcher_name ++ "<d>(<r>" ++ args ++ "<d>)<r>";
        };
        return received ++ matcher_name ++ "<d>(<r>" ++ args ++ "<d>)<r>";
    }

    pub fn getFullSignature(comptime matcher: string, comptime args: string, comptime flags: Flags) string {
        const fmt = "<d>expect(<r><red>received<r><d>).<r>" ++ if (flags.promise != .none)
            switch (flags.promise) {
                .resolves => if (flags.not) "resolves<d>.<r>not<d>.<r>" else "resolves<d>.<r>",
                .rejects => if (flags.not) "rejects<d>.<r>not<d>.<r>" else "rejects<d>.<r>",
                else => unreachable,
            }
        else if (flags.not) "not<d>.<r>" else "";
        return fmt ++ matcher ++ "<d>(<r>" ++ args ++ "<d>)<r>";
    }

    pub fn getNot(this: *Expect, thisValue: JSValue, _: *JSGlobalObject) callconv(.C) JSValue {
        this.flags.not = !this.flags.not;
        return thisValue;
    }

    pub fn getResolves(this: *Expect, thisValue: JSValue, globalThis: *JSGlobalObject) callconv(.C) JSValue {
        this.flags.promise = switch (this.flags.promise) {
            .resolves, .none => .resolves,
            .rejects => {
                globalThis.throw("Cannot chain .resolves() after .rejects()", .{});
                return .zero;
            },
        };

        return thisValue;
    }

    pub fn getRejects(this: *Expect, thisValue: JSValue, globalThis: *JSGlobalObject) callconv(.C) JSValue {
        this.flags.promise = switch (this.flags.promise) {
            .none, .rejects => .rejects,
            .resolves => {
                globalThis.throw("Cannot chain .rejects() after .resolves()", .{});
                return .zero;
            },
        };

        return thisValue;
    }

    pub fn getValue(this: *Expect, globalThis: *JSGlobalObject, thisValue: JSValue, comptime matcher_name: string, comptime matcher_args: string) ?JSValue {
        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("{s}() must be called in a test", .{matcher_name});
            return null;
        }

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal error: the expect(value) was garbage collected but it should not have been!", .{});
            return null;
        };
        value.ensureStillAlive();

        switch (this.flags.promise) {
            inline .resolves, .rejects => |resolution| {
                if (value.asAnyPromise()) |promise| {
                    var vm = globalThis.vm();
                    promise.setHandled(vm);

                    const now = std.time.Instant.now() catch unreachable;
                    const pending_test = Jest.runner.?.pending_test.?;
                    const elapsed = @divFloor(now.since(pending_test.started_at), std.time.ns_per_ms);
                    const remaining = @as(u32, @truncate(Jest.runner.?.last_test_timeout_timer_duration -| elapsed));

                    if (!globalThis.bunVM().waitForPromiseWithTimeout(promise, remaining)) {
                        pending_test.timeout();
                        return null;
                    }

                    const newValue = promise.result(vm);
                    switch (promise.status(vm)) {
                        .Fulfilled => switch (comptime resolution) {
                            .resolves => {},
                            .rejects => {
                                if (this.flags.not) {
                                    const signature = comptime getFullSignature(matcher_name, matcher_args, .{ .not = true, .promise = .rejects });
                                    const fmt = signature ++ "\n\nExpected promise that rejects<r>\nReceived promise that resolved: <red>{any}<r>\n";
                                    var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
                                    globalThis.throwPretty(fmt, .{newValue.toFmt(globalThis, &formatter)});
                                    return null;
                                }
                                const signature = comptime getFullSignature(matcher_name, matcher_args, .{ .not = false, .promise = .rejects });
                                const fmt = signature ++ "\n\nExpected promise that rejects<r>\nReceived promise that resolved: <red>{any}<r>\n";
                                var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
                                globalThis.throwPretty(fmt, .{newValue.toFmt(globalThis, &formatter)});
                                return null;
                            },
                            .none => unreachable,
                        },
                        .Rejected => switch (comptime resolution) {
                            .rejects => {},
                            .resolves => {
                                if (this.flags.not) {
                                    const signature = comptime getFullSignature(matcher_name, matcher_args, .{ .not = true, .promise = .resolves });
                                    const fmt = signature ++ "\n\nExpected promise that resolves<r>\nReceived promise that rejected: <red>{any}<r>\n";
                                    var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
                                    globalThis.throwPretty(fmt, .{newValue.toFmt(globalThis, &formatter)});
                                    return null;
                                }
                                const signature = comptime getFullSignature(matcher_name, matcher_args, .{ .not = false, .promise = .resolves });
                                const fmt = signature ++ "\n\nExpected promise that resolves<r>\nReceived promise that rejected: <red>{any}<r>\n";
                                var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
                                globalThis.throwPretty(fmt, .{newValue.toFmt(globalThis, &formatter)});
                                return null;
                            },
                            .none => unreachable,
                        },
                        .Pending => unreachable,
                    }

                    newValue.ensureStillAlive();
                    return newValue;
                } else {
                    switch (this.flags.promise) {
                        .resolves => {
                            if (this.flags.not) {
                                const signature = comptime getFullSignature(matcher_name, matcher_args, .{ .not = true, .promise = .resolves });
                                const fmt = signature ++ "\n\nExpected promise<r>\nReceived: <red>{any}<r>\n";
                                var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
                                globalThis.throwPretty(fmt, .{value.toFmt(globalThis, &formatter)});
                                return null;
                            }
                            const signature = comptime getFullSignature(matcher_name, matcher_args, .{ .not = false, .promise = .resolves });
                            const fmt = signature ++ "\n\nExpected promise<r>\nReceived: <red>{any}<r>\n";
                            var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
                            globalThis.throwPretty(fmt, .{value.toFmt(globalThis, &formatter)});
                            return null;
                        },
                        .rejects => {
                            if (this.flags.not) {
                                const signature = comptime getFullSignature(matcher_name, matcher_args, .{ .not = true, .promise = .rejects });
                                const fmt = signature ++ "\n\nExpected promise<r>\nReceived: <red>{any}<r>\n";
                                var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
                                globalThis.throwPretty(fmt, .{value.toFmt(globalThis, &formatter)});
                                return null;
                            }
                            const signature = comptime getFullSignature(matcher_name, matcher_args, .{ .not = false, .promise = .rejects });
                            const fmt = signature ++ "\n\nExpected promise<r>\nReceived: <red>{any}<r>\n";
                            var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
                            globalThis.throwPretty(fmt, .{value.toFmt(globalThis, &formatter)});
                            return null;
                        },
                        .none => unreachable,
                    }
                }
            },
            else => {},
        }

        return value;
    }

    pub fn getSnapshotName(this: *Expect, allocator: std.mem.Allocator, hint: string) ![]const u8 {
        var test_name = this.scope.tests.items[this.test_id].label;
        var name_builder = MutableString.initEmpty(allocator);
        
        for (test_name) | value | { 
            if(value == '`') {
                try name_builder.append("\\");
            } 
            try name_builder.appendChar(value);
        }
        const escaped_name = name_builder.toOwnedSentinelLeaky();  
        defer allocator.free(escaped_name);

        var length: usize = 0;
        var curr_scope: ?*DescribeScope = this.scope;
        while (curr_scope) |scope| {
            if (scope.label.len > 0) {
                length += scope.label.len + 1;
            }
            curr_scope = scope.parent;
        }
        length += escaped_name.len;
        if (hint.len > 0) {
            length += hint.len + 2;
        }

        var buf = try allocator.alloc(u8, length);

        var index = buf.len;
        if (hint.len > 0) {
            index -= hint.len;
            bun.copy(u8, buf[index..], hint);
            index -= escaped_name.len + 2;
            bun.copy(u8, buf[index..], escaped_name);
            bun.copy(u8, buf[index + escaped_name.len ..], ": ");
        } else {
            index -= escaped_name.len;
            bun.copy(u8, buf[index..], escaped_name);
        }
        // copy describe scopes in reverse order
        curr_scope = this.scope;
        while (curr_scope) |scope| {
            if (scope.label.len > 0) {
                index -= scope.label.len + 1;
                bun.copy(u8, buf[index..], scope.label);
                buf[index + scope.label.len] = ' ';
            }
            curr_scope = scope.parent;
        }

        return buf;
    }

    pub fn finalize(
        this: *Expect,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(1);
        const value = if (arguments.len < 1) JSC.JSValue.jsUndefined() else arguments.ptr[0];

        var expect = globalObject.bunVM().allocator.create(Expect) catch unreachable;

        if (Jest.runner.?.pending_test == null) {
            const err = globalObject.createErrorInstance("expect() must be called in a test", .{});
            err.put(globalObject, ZigString.static("name"), ZigString.init("TestNotRunningError").toValueGC(globalObject));
            globalObject.throwValue(err);
            return .zero;
        }

        expect.* = .{
            .scope = Jest.runner.?.pending_test.?.describe,
            .test_id = Jest.runner.?.pending_test.?.test_id,
        };
        const expect_js_value = expect.toJS(globalObject);
        expect_js_value.ensureStillAlive();
        Expect.capturedValueSetCached(expect_js_value, globalObject, value);
        expect_js_value.ensureStillAlive();
        expect.postMatch(globalObject);
        return expect_js_value;
    }

    pub fn constructor(
        globalObject: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) ?*Expect {
        globalObject.throw("expect() cannot be called with new", .{});
        return null;
    }

    // pass here has a leading underscore to avoid name collision with the pass variable in other functions
    pub fn _pass(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        var _msg: ZigString = ZigString.Empty;

        if (arguments.len > 0) {
            const value = arguments[0];
            value.ensureStillAlive();

            if (!value.isString()) {
                globalObject.throwInvalidArgumentType("pass", "message", "string");
                return .zero;
            }

            value.toZigString(&_msg, globalObject);
        } else {
            _msg = ZigString.fromBytes("passes by .pass() assertion");
        }

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        var pass = true;

        if (not) pass = !pass;
        if (pass) return thisValue;

        var msg = _msg.toSlice(default_allocator);
        defer msg.deinit();

        if (not) {
            const signature = comptime getSignature("pass", "", true);
            const fmt = signature ++ "\n\n{s}\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{msg.slice()});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{msg.slice()});
            return .zero;
        }

        // should never reach here
        return .zero;
    }

    pub fn fail(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        var _msg: ZigString = ZigString.Empty;

        if (arguments.len > 0) {
            const value = arguments[0];
            value.ensureStillAlive();

            if (!value.isString()) {
                globalObject.throwInvalidArgumentType("fail", "message", "string");
                return .zero;
            }

            value.toZigString(&_msg, globalObject);
        } else {
            _msg = ZigString.fromBytes("fails by .fail() assertion");
        }

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        var pass = false;

        if (not) pass = !pass;
        if (pass) return thisValue;

        var msg = _msg.toSlice(default_allocator);
        defer msg.deinit();

        const signature = comptime getSignature("fail", "", true);
        const fmt = signature ++ "\n\n{s}\n";
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{msg.slice()});
            return .zero;
        }
        globalObject.throw(Output.prettyFmt(fmt, false), .{msg.slice()});
        return .zero;
    }

    /// Object.is()
    pub fn toBe(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callframe.this();
        const arguments_ = callframe.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBe() takes 1 argument", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;
        const right = arguments[0];
        right.ensureStillAlive();
        const left = this.getValue(globalObject, thisValue, "toBe", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = right.isSameValue(left, globalObject);

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        if (not) {
            const signature = comptime getSignature("toBe", "<green>expected<r>", true);
            const fmt = signature ++ "\n\nExpected: not <green>{any}<r>\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{right.toFmt(globalObject, &formatter)});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{right.toFmt(globalObject, &formatter)});
            return .zero;
        }

        const signature = comptime getSignature("toBe", "<green>expected<r>", false);
        if (left.deepEquals(right, globalObject) or left.strictDeepEquals(right, globalObject)) {
            const fmt = signature ++
                "\n\n<d>If this test should pass, replace \"toBe\" with \"toEqual\" or \"toStrictEqual\"<r>" ++
                "\n\nExpected: <green>{any}<r>\n" ++
                "Received: serializes to the same string\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{right.toFmt(globalObject, &formatter)});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{right.toFmt(globalObject, &formatter)});
            return .zero;
        }

        if (right.isString() and left.isString()) {
            const diff_format = DiffFormatter{
                .expected = right,
                .received = left,
                .globalObject = globalObject,
                .not = not,
            };
            const fmt = signature ++ "\n\n{any}\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{diff_format});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{diff_format});
            return .zero;
        }

        const fmt = signature ++ "\n\nExpected: <green>{any}<r>\nReceived: <red>{any}<r>\n";
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{
                right.toFmt(globalObject, &formatter),
                left.toFmt(globalObject, &formatter),
            });
            return .zero;
        }
        globalObject.throw(Output.prettyFmt(fmt, false), .{
            right.toFmt(globalObject, &formatter),
            left.toFmt(globalObject, &formatter),
        });
        return .zero;
    }

    pub fn toHaveLength(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callframe.this();
        const arguments_ = callframe.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toHaveLength() takes 1 argument", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected: JSValue = arguments[0];
        const value: JSValue = this.getValue(globalObject, thisValue, "toHaveLength", "<green>expected<r>") orelse return .zero;

        if (!value.isObject() and !value.isString()) {
            var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
            globalObject.throw("Received value does not have a length property: {any}", .{value.toFmt(globalObject, &fmt)});
            return .zero;
        }

        if (!expected.isNumber()) {
            var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
            globalObject.throw("Expected value must be a non-negative integer: {any}", .{expected.toFmt(globalObject, &fmt)});
            return .zero;
        }

        const expected_length: f64 = expected.asNumber();
        if (@round(expected_length) != expected_length or std.math.isInf(expected_length) or std.math.isNan(expected_length) or expected_length < 0) {
            var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
            globalObject.throw("Expected value must be a non-negative integer: {any}", .{expected.toFmt(globalObject, &fmt)});
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;

        const actual_length = value.getLengthIfPropertyExistsInternal(globalObject);

        if (actual_length == std.math.inf(f64)) {
            var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
            globalObject.throw("Received value does not have a length property: {any}", .{value.toFmt(globalObject, &fmt)});
            return .zero;
        } else if (std.math.isNan(actual_length)) {
            globalObject.throw("Received value has non-number length property: {}", .{actual_length});
            return .zero;
        }

        if (actual_length == expected_length) {
            pass = true;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        if (not) {
            const expected_line = "Expected length: not <green>{d}<r>\n";
            const fmt = comptime getSignature("toHaveLength", "<green>expected<r>", true) ++ "\n\n" ++ expected_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{expected_length});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{expected_length});
            return .zero;
        }

        const expected_line = "Expected length: <green>{d}<r>\n";
        const received_line = "Received length: <red>{d}<r>\n";
        const fmt = comptime getSignature("toHaveLength", "<green>expected<r>", false) ++ "\n\n" ++
            expected_line ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_length, actual_length });
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_length, actual_length });
        return .zero;
    }

    pub fn toContain(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toContain() takes 1 argument", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected = arguments[0];
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalObject, thisValue, "toContain", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = false;

        if (value.isIterable(globalObject)) {
            var itr = value.arrayIterator(globalObject);
            while (itr.next()) |item| {
                if (item.isSameValue(expected, globalObject)) {
                    pass = true;
                    break;
                }
            }
        } else if (value.isString() and expected.isString()) {
            const value_string = value.toString(globalObject).toSlice(globalObject, default_allocator).slice();
            const expected_string = expected.toString(globalObject).toSlice(globalObject, default_allocator).slice();
            if (strings.contains(value_string, expected_string)) {
                pass = true;
            } else if (value_string.len == 0 and expected_string.len == 0) { // edge case two empty strings are true
                pass = true;
            }
        } else {
            globalObject.throw("Received value must be an array type, or both received and expected values must be strings.", .{});
            return .zero;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = expected.toFmt(globalObject, &formatter);
        if (not) {
            const expected_line = "Expected to not contain: <green>{any}<r>\n";
            const fmt = comptime getSignature("toContain", "<green>expected<r>", true) ++ "\n\n" ++ expected_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{expected_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{expected_fmt});
            return .zero;
        }

        const expected_line = "Expected to contain: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toContain", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toBeTruthy(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalObject, thisValue, "toBeTruthy", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        var pass = false;

        const truthy = value.toBooleanSlow(globalObject);
        if (truthy) pass = true;

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeTruthy", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeTruthy", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toBeUndefined(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalObject, thisValue, "toBeUndefined", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        var pass = false;
        if (value.isUndefined()) pass = true;

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeUndefined", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeUndefined", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toBeNaN(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalObject, thisValue, "toBeNaN", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        var pass = false;
        if (value.isNumber()) {
            const number = value.asNumber();
            if (number != number) pass = true;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeNaN", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeNaN", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toBeNull(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalObject, thisValue, "toBeNull", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        var pass = value.isNull();
        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeNull", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeNull", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toBeDefined(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalObject, thisValue, "toBeDefined", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        var pass = !value.isUndefined();
        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeDefined", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeDefined", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toBeFalsy(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();

        const value: JSValue = this.getValue(globalObject, thisValue, "toBeFalsy", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        var pass = false;

        const truthy = value.toBooleanSlow(globalObject);
        if (!truthy) pass = true;

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeFalsy", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeFalsy", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toEqual(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toEqual() requires 1 argument", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected = arguments[0];
        const value: JSValue = this.getValue(globalObject, thisValue, "toEqual", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = value.jestDeepEquals(expected, globalObject);

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        const diff_formatter = DiffFormatter{
            .received = value,
            .expected = expected,
            .globalObject = globalObject,
            .not = not,
        };

        if (not) {
            const signature = comptime getSignature("toEqual", "<green>expected<r>", true);
            const fmt = signature ++ "\n\n{any}\n";
            globalObject.throwPretty(fmt, .{diff_formatter});
            return .zero;
        }

        const signature = comptime getSignature("toEqual", "<green>expected<r>", false);
        const fmt = signature ++ "\n\n{any}\n";
        globalObject.throwPretty(fmt, .{diff_formatter});
        return .zero;
    }

    pub fn toStrictEqual(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toStrictEqual() requires 1 argument", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected = arguments[0];
        const value: JSValue = this.getValue(globalObject, thisValue, "toStrictEqual", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = value.jestStrictDeepEquals(expected, globalObject);

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        const diff_formatter = DiffFormatter{ .received = value, .expected = expected, .globalObject = globalObject, .not = not };

        if (not) {
            const signature = comptime getSignature("toStrictEqual", "<green>expected<r>", true);
            const fmt = signature ++ "\n\n{any}\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{diff_formatter});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{diff_formatter});
            return .zero;
        }

        const signature = comptime getSignature("toStrictEqual", "<green>expected<r>", false);
        const fmt = signature ++ "\n\n{any}\n";
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{diff_formatter});
            return .zero;
        }
        globalObject.throw(Output.prettyFmt(fmt, false), .{diff_formatter});
        return .zero;
    }

    pub fn toHaveProperty(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(2);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toHaveProperty() requires at least 1 argument", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected_property_path = arguments[0];
        expected_property_path.ensureStillAlive();
        const expected_property: ?JSValue = if (arguments.len > 1) arguments[1] else null;
        if (expected_property) |ev| ev.ensureStillAlive();

        const value: JSValue = this.getValue(globalObject, thisValue, "toHaveProperty", "<green>path<r><d>, <r><green>value<r>") orelse return .zero;

        if (!expected_property_path.isString() and !expected_property_path.isIterable(globalObject)) {
            globalObject.throw("Expected path must be a string or an array", .{});
            return .zero;
        }

        const not = this.flags.not;
        var path_string = ZigString.Empty;
        expected_property_path.toZigString(&path_string, globalObject);

        var pass = !value.isUndefinedOrNull();
        var received_property: JSValue = .zero;

        if (pass) {
            received_property = value.getIfPropertyExistsFromPath(globalObject, expected_property_path);
            pass = !received_property.isEmpty();
        }

        if (pass and expected_property != null) {
            pass = received_property.jestDeepEquals(expected_property.?, globalObject);
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        if (not) {
            if (expected_property != null) {
                const signature = comptime getSignature("toHaveProperty", "<green>path<r><d>, <r><green>value<r>", true);
                if (!received_property.isEmpty()) {
                    const fmt = signature ++ "\n\nExpected path: <green>{any}<r>\n\nExpected value: not <green>{any}<r>\n";
                    if (Output.enable_ansi_colors) {
                        globalObject.throw(Output.prettyFmt(fmt, true), .{
                            expected_property_path.toFmt(globalObject, &formatter),
                            expected_property.?.toFmt(globalObject, &formatter),
                        });
                        return .zero;
                    }
                    globalObject.throw(Output.prettyFmt(fmt, true), .{
                        expected_property_path.toFmt(globalObject, &formatter),
                        expected_property.?.toFmt(globalObject, &formatter),
                    });
                    return .zero;
                }
            }

            const signature = comptime getSignature("toHaveProperty", "<green>path<r>", true);
            const fmt = signature ++ "\n\nExpected path: not <green>{any}<r>\n\nReceived value: <red>{any}<r>\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{
                    expected_property_path.toFmt(globalObject, &formatter),
                    received_property.toFmt(globalObject, &formatter),
                });
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{
                expected_property_path.toFmt(globalObject, &formatter),
                received_property.toFmt(globalObject, &formatter),
            });
            return .zero;
        }

        if (expected_property != null) {
            const signature = comptime getSignature("toHaveProperty", "<green>path<r><d>, <r><green>value<r>", false);
            if (!received_property.isEmpty()) {
                // deep equal case
                const fmt = signature ++ "\n\n{any}\n";
                const diff_format = DiffFormatter{
                    .received = received_property,
                    .expected = expected_property.?,
                    .globalObject = globalObject,
                };

                if (Output.enable_ansi_colors) {
                    globalObject.throw(Output.prettyFmt(fmt, true), .{diff_format});
                    return .zero;
                }
                globalObject.throw(Output.prettyFmt(fmt, false), .{diff_format});
                return .zero;
            }

            const fmt = signature ++ "\n\nExpected path: <green>{any}<r>\n\nExpected value: <green>{any}<r>\n\n" ++
                "Unable to find property\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{
                    expected_property_path.toFmt(globalObject, &formatter),
                    expected_property.?.toFmt(globalObject, &formatter),
                });
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{
                expected_property_path.toFmt(globalObject, &formatter),
                expected_property.?.toFmt(globalObject, &formatter),
            });
            return .zero;
        }

        const signature = comptime getSignature("toHaveProperty", "<green>path<r>", false);
        const fmt = signature ++ "\n\nExpected path: <green>{any}<r>\n\nUnable to find property\n";
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{expected_property_path.toFmt(globalObject, &formatter)});
            return .zero;
        }
        globalObject.throw(Output.prettyFmt(fmt, false), .{expected_property_path.toFmt(globalObject, &formatter)});
        return .zero;
    }

    pub fn toBeEven(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();

        const value: JSValue = this.getValue(globalObject, thisValue, "toBeEven", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        var pass = false;

        if (value.isAnyInt()) {
            const _value = value.toInt64();
            pass = @mod(_value, 2) == 0;
            if (_value == -0) { // negative zero is even
                pass = true;
            }
        } else if (value.isBigInt() or value.isBigInt32()) {
            const _value = value.toInt64();
            pass = switch (_value == -0) { // negative zero is even
                true => true,
                else => _value & 1 == 0,
            };
        } else if (value.isNumber()) {
            const _value = JSValue.asNumber(value);
            if (@mod(_value, 1) == 0 and @mod(_value, 2) == 0) { // if the fraction is all zeros and even
                pass = true;
            } else {
                pass = false;
            }
        } else {
            pass = false;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeEven", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeEven", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toBeGreaterThan(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeGreaterThan() requires 1 argument", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value: JSValue = this.getValue(globalObject, thisValue, "toBeGreaterThan", "<green>expected<r>") orelse return .zero;

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalObject.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() > other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalObject, other_value)) {
                .greater_than => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalObject, value)) {
                .less_than => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = other_value.toFmt(globalObject, &formatter);
        if (not) {
            const expected_line = "Expected: not \\> <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeGreaterThan", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected: \\> <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeGreaterThan", "<green>expected<r>", false) ++ "\n\n" ++
            expected_line ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(comptime Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toBeGreaterThanOrEqual(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeGreaterThanOrEqual() requires 1 argument", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value: JSValue = this.getValue(globalObject, thisValue, "toBeGreaterThanOrEqual", "<green>expected<r>") orelse return .zero;

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalObject.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() >= other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalObject, other_value)) {
                .greater_than, .equal => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalObject, value)) {
                .less_than, .equal => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = other_value.toFmt(globalObject, &formatter);
        if (not) {
            const expected_line = "Expected: not \\>= <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeGreaterThanOrEqual", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected: \\>= <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeGreaterThanOrEqual", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(comptime Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
            return .zero;
        }
        return .zero;
    }

    pub fn toBeLessThan(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeLessThan() requires 1 argument", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value: JSValue = this.getValue(globalObject, thisValue, "toBeLessThan", "<green>expected<r>") orelse return .zero;

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalObject.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() < other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalObject, other_value)) {
                .less_than => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalObject, value)) {
                .greater_than => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = other_value.toFmt(globalObject, &formatter);
        if (not) {
            const expected_line = "Expected: not \\< <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeLessThan", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected: \\< <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeLessThan", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(comptime Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
            return .zero;
        }
        return .zero;
    }

    pub fn toBeLessThanOrEqual(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeLessThanOrEqual() requires 1 argument", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value: JSValue = this.getValue(globalObject, thisValue, "toBeLessThanOrEqual", "<green>expected<r>") orelse return .zero;

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalObject.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() <= other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalObject, other_value)) {
                .less_than, .equal => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalObject, value)) {
                .greater_than, .equal => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = other_value.toFmt(globalObject, &formatter);
        if (not) {
            const expected_line = "Expected: not \\<= <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeLessThanOrEqual", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected: \\<= <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeLessThanOrEqual", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(comptime Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
            return .zero;
        }
        return .zero;
    }

    pub fn toBeCloseTo(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const thisArguments = callFrame.arguments(2);
        const arguments = thisArguments.ptr[0..thisArguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeCloseTo() requires at least 1 argument. Expected value must be a number", .{});
            return .zero;
        }

        const expected_ = arguments[0];
        if (!expected_.isNumber()) {
            globalObject.throwInvalidArgumentType("toBeCloseTo", "expected", "number");
            return .zero;
        }

        var precision: f64 = 2.0;
        if (arguments.len > 1) {
            const precision_ = arguments[1];
            if (!precision_.isNumber()) {
                globalObject.throwInvalidArgumentType("toBeCloseTo", "precision", "number");
                return .zero;
            }

            precision = precision_.asNumber();
        }

        const received_: JSValue = this.getValue(globalObject, thisValue, "toBeCloseTo", "<green>expected<r>, precision") orelse return .zero;
        if (!received_.isNumber()) {
            globalObject.throwInvalidArgumentType("expect", "received", "number");
            return .zero;
        }

        var expected = expected_.asNumber();
        var received = received_.asNumber();

        if (std.math.isNegativeInf(expected)) {
            expected = -expected;
        }

        if (std.math.isNegativeInf(received)) {
            received = -received;
        }

        if (std.math.isPositiveInf(expected) and std.math.isPositiveInf(received)) {
            return thisValue;
        }

        const expected_diff = std.math.pow(f64, 10, -precision) / 2;
        const actual_diff = std.math.fabs(received - expected);
        var pass = actual_diff < expected_diff;

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

        const expected_fmt = expected_.toFmt(globalObject, &formatter);
        const received_fmt = received_.toFmt(globalObject, &formatter);

        const expected_line = "Expected: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const expected_precision = "Expected precision: {d}\n";
        const expected_difference = "Expected difference: \\< <green>{d}<r>\n";
        const received_difference = "Received difference: <red>{d}<r>\n";

        const suffix_fmt = "\n\n" ++ expected_line ++ received_line ++ "\n" ++ expected_precision ++ expected_difference ++ received_difference;

        if (not) {
            const fmt = comptime getSignature("toBeCloseTo", "<green>expected<r>, precision", true) ++ suffix_fmt;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, received_fmt, precision, expected_diff, actual_diff });
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, received_fmt, precision, expected_diff, actual_diff });
            return .zero;
        }

        const fmt = comptime getSignature("toBeCloseTo", "<green>expected<r>, precision", false) ++ suffix_fmt;

        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, received_fmt, precision, expected_diff, actual_diff });
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, received_fmt, precision, expected_diff, actual_diff });
        return .zero;
    }

    pub fn toBeOdd(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();

        const value: JSValue = this.getValue(globalObject, thisValue, "toBeOdd", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        var pass = false;

        if (value.isBigInt32()) {
            pass = value.toInt32() & 1 == 1;
        } else if (value.isBigInt()) {
            pass = value.toInt64() & 1 == 1;
        } else if (value.isInt32()) {
            const _value = value.toInt32();
            pass = @mod(_value, 2) == 1;
        } else if (value.isAnyInt()) {
            const _value = value.toInt64();
            pass = @mod(_value, 2) == 1;
        } else if (value.isNumber()) {
            const _value = JSValue.asNumber(value);
            if (@mod(_value, 1) == 0 and @mod(_value, 2) == 1) { // if the fraction is all zeros and odd
                pass = true;
            } else {
                pass = false;
            }
        } else {
            pass = false;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeOdd", "", true) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeOdd", "", false) ++ "\n\n" ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{value_fmt});
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{value_fmt});
        return .zero;
    }

    pub fn toThrow(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        active_test_expectation_counter.actual += 1;

        const expected_value: JSValue = if (arguments.len > 0) brk: {
            const value = arguments[0];
            if (value.isEmptyOrUndefinedOrNull() or !value.isObject() and !value.isString()) {
                var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
                globalObject.throw("Expected value must be string or Error: {any}", .{value.toFmt(globalObject, &fmt)});
                return .zero;
            }
            break :brk value;
        } else .zero;
        expected_value.ensureStillAlive();

        const value: JSValue = this.getValue(globalObject, thisValue, "toThrow", "<green>expected<r>") orelse return .zero;

        if (!value.jsType().isFunction()) {
            globalObject.throw("Expected value must be a function", .{});
            return .zero;
        }

        const not = this.flags.not;

        const result_: ?JSValue = brk: {
            var vm = globalObject.bunVM();
            var return_value: JSValue = .zero;
            var scope = vm.unhandledRejectionScope();
            var prev_unhandled_pending_rejection_to_capture = vm.unhandled_pending_rejection_to_capture;
            vm.unhandled_pending_rejection_to_capture = &return_value;
            vm.onUnhandledRejection = &VirtualMachine.onQuietUnhandledRejectionHandlerCaptureValue;
            const return_value_from_fucntion: JSValue = value.call(globalObject, &.{});
            vm.unhandled_pending_rejection_to_capture = prev_unhandled_pending_rejection_to_capture;

            if (return_value == .zero) {
                return_value = return_value_from_fucntion;
            }

            if (return_value.asAnyPromise()) |promise| {
                globalObject.bunVM().waitForPromise(promise);
                scope.apply(vm);
                const promise_result = promise.result(globalObject.vm());

                switch (promise.status(globalObject.vm())) {
                    .Fulfilled => {
                        break :brk null;
                    },
                    .Rejected => {
                        // since we know for sure it rejected, we should always return the error
                        break :brk promise_result.toError() orelse promise_result;
                    },
                    .Pending => unreachable,
                }
            }
            scope.apply(vm);

            break :brk return_value.toError();
        };

        const did_throw = result_ != null;

        if (not) {
            const signature = comptime getSignature("toThrow", "<green>expected<r>", true);

            if (!did_throw) return thisValue;

            const result: JSValue = result_.?;
            var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

            if (expected_value.isEmpty()) {
                const signature_no_args = comptime getSignature("toThrow", "", true);
                if (result.toError()) |err| {
                    const name = err.get(globalObject, "name") orelse JSValue.undefined;
                    const message = err.get(globalObject, "message") orelse JSValue.undefined;
                    const fmt = signature_no_args ++ "\n\nError name: <red>{any}<r>\nError message: <red>{any}<r>\n";
                    globalObject.throwPretty(fmt, .{
                        name.toFmt(globalObject, &formatter),
                        message.toFmt(globalObject, &formatter),
                    });
                    return .zero;
                }

                // non error thrown
                const fmt = signature_no_args ++ "\n\nThrown value: <red>{any}<r>\n";
                globalObject.throwPretty(fmt, .{result.toFmt(globalObject, &formatter)});
                return .zero;
            }

            if (expected_value.isString()) {
                const received_message = result.getIfPropertyExistsImpl(globalObject, "message", 7);

                // TODO: remove this allocation
                // partial match
                {
                    const expected_slice = expected_value.toSliceOrNull(globalObject) orelse return .zero;
                    defer expected_slice.deinit();
                    const received_slice = received_message.toSliceOrNull(globalObject) orelse return .zero;
                    defer received_slice.deinit();
                    if (!strings.contains(received_slice.slice(), expected_slice.slice())) return thisValue;
                }

                const fmt = signature ++ "\n\nExpected substring: not <green>{any}<r>\nReceived message: <red>{any}<r>\n";
                globalObject.throwPretty(fmt, .{
                    expected_value.toFmt(globalObject, &formatter),
                    received_message.toFmt(globalObject, &formatter),
                });
                return .zero;
            }

            if (expected_value.isRegExp()) {
                const received_message = result.getIfPropertyExistsImpl(globalObject, "message", 7);

                // TODO: REMOVE THIS GETTER! Expose a binding to call .test on the RegExp object directly.
                if (expected_value.get(globalObject, "test")) |test_fn| {
                    const matches = test_fn.callWithThis(globalObject, expected_value, &.{received_message});
                    if (!matches.toBooleanSlow(globalObject)) return thisValue;
                }

                const fmt = signature ++ "\n\nExpected pattern: not <green>{any}<r>\nReceived message: <red>{any}<r>\n";
                globalObject.throwPretty(fmt, .{
                    expected_value.toFmt(globalObject, &formatter),
                    received_message.toFmt(globalObject, &formatter),
                });
                return .zero;
            }

            if (expected_value.get(globalObject, "message")) |expected_message| {
                const received_message = result.getIfPropertyExistsImpl(globalObject, "message", 7);
                // no partial match for this case
                if (!expected_message.isSameValue(received_message, globalObject)) return thisValue;

                const fmt = signature ++ "\n\nExpected message: not <green>{any}<r>\n";
                globalObject.throwPretty(fmt, .{expected_message.toFmt(globalObject, &formatter)});
                return .zero;
            }

            if (!result.isInstanceOf(globalObject, expected_value)) return thisValue;

            var expected_class = ZigString.Empty;
            expected_value.getClassName(globalObject, &expected_class);
            const received_message = result.getIfPropertyExistsImpl(globalObject, "message", 7);
            const fmt = signature ++ "\n\nExpected constructor: not <green>{s}<r>\n\nReceived message: <red>{any}<r>\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_class, received_message.toFmt(globalObject, &formatter) });
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_class, received_message.toFmt(globalObject, &formatter) });
            return .zero;
        }

        const signature = comptime getSignature("toThrow", "<green>expected<r>", false);
        if (did_throw) {
            if (expected_value.isEmpty()) return thisValue;

            const result: JSValue = if (result_.?.toError()) |r|
                r
            else
                result_.?;

            const _received_message: ?JSValue = if (result.isObject())
                result.get(globalObject, "message")
            else if (result.toStringOrNull(globalObject)) |js_str|
                JSC.JSValue.fromCell(js_str)
            else
                null;

            if (expected_value.isString()) {
                if (_received_message) |received_message| {
                    // TODO: remove this allocation
                    // partial match
                    const expected_slice = expected_value.toSliceOrNull(globalObject) orelse return .zero;
                    defer expected_slice.deinit();
                    const received_slice = received_message.toSlice(globalObject, globalObject.allocator());
                    defer received_slice.deinit();
                    if (strings.contains(received_slice.slice(), expected_slice.slice())) return thisValue;
                }

                // error: message from received error does not match expected string
                var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

                if (_received_message) |received_message| {
                    const expected_value_fmt = expected_value.toFmt(globalObject, &formatter);
                    const received_message_fmt = received_message.toFmt(globalObject, &formatter);
                    const fmt = signature ++ "\n\n" ++ "Expected substring: <green>{any}<r>\nReceived message: <red>{any}<r>\n";
                    globalObject.throwPretty(fmt, .{ expected_value_fmt, received_message_fmt });
                    return .zero;
                }

                const expected_fmt = expected_value.toFmt(globalObject, &formatter);
                const received_fmt = result.toFmt(globalObject, &formatter);
                const fmt = signature ++ "\n\n" ++ "Expected substring: <green>{any}<r>\nReceived value: <red>{any}<r>";
                globalObject.throwPretty(fmt, .{ expected_fmt, received_fmt });

                return .zero;
            }

            if (expected_value.isRegExp()) {
                if (_received_message) |received_message| {
                    // TODO: REMOVE THIS GETTER! Expose a binding to call .test on the RegExp object directly.
                    if (expected_value.get(globalObject, "test")) |test_fn| {
                        const matches = test_fn.callWithThis(globalObject, expected_value, &.{received_message});
                        if (matches.toBooleanSlow(globalObject)) return thisValue;
                    }
                }

                // error: message from received error does not match expected pattern
                var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

                if (_received_message) |received_message| {
                    const expected_value_fmt = expected_value.toFmt(globalObject, &formatter);
                    const received_message_fmt = received_message.toFmt(globalObject, &formatter);
                    const fmt = signature ++ "\n\n" ++ "Expected pattern: <green>{any}<r>\nReceived message: <red>{any}<r>\n";
                    globalObject.throwPretty(fmt, .{ expected_value_fmt, received_message_fmt });

                    return .zero;
                }

                const expected_fmt = expected_value.toFmt(globalObject, &formatter);
                const received_fmt = result.toFmt(globalObject, &formatter);
                const fmt = signature ++ "\n\n" ++ "Expected pattern: <green>{any}<r>\nReceived value: <red>{any}<r>";
                globalObject.throwPretty(fmt, .{ expected_fmt, received_fmt });
                return .zero;
            }

            // If it's not an object, we are going to crash here.
            std.debug.assert(expected_value.isObject());

            if (expected_value.get(globalObject, "message")) |expected_message| {
                if (_received_message) |received_message| {
                    if (received_message.isSameValue(expected_message, globalObject)) return thisValue;
                }

                // error: message from received error does not match expected error message.
                var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

                if (_received_message) |received_message| {
                    const expected_fmt = expected_message.toFmt(globalObject, &formatter);
                    const received_fmt = received_message.toFmt(globalObject, &formatter);
                    const fmt = signature ++ "\n\nExpected message: <green>{any}<r>\nReceived message: <red>{any}<r>\n";
                    globalObject.throwPretty(fmt, .{ expected_fmt, received_fmt });
                    return .zero;
                }

                const expected_fmt = expected_message.toFmt(globalObject, &formatter);
                const received_fmt = result.toFmt(globalObject, &formatter);
                const fmt = signature ++ "\n\nExpected message: <green>{any}<r>\nReceived value: <red>{any}<r>\n";
                globalObject.throwPretty(fmt, .{ expected_fmt, received_fmt });
                return .zero;
            }

            if (result.isInstanceOf(globalObject, expected_value)) return thisValue;

            // error: received error not instance of received error constructor
            var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
            var expected_class = ZigString.Empty;
            var received_class = ZigString.Empty;
            expected_value.getClassName(globalObject, &expected_class);
            result.getClassName(globalObject, &received_class);
            const fmt = signature ++ "\n\nExpected constructor: <green>{s}<r>\nReceived constructor: <red>{s}<r>\n\n";

            if (_received_message) |received_message| {
                const message_fmt = fmt ++ "Received message: <red>{any}<r>\n";
                const received_message_fmt = received_message.toFmt(globalObject, &formatter);

                globalObject.throwPretty(message_fmt, .{
                    expected_class,
                    received_class,
                    received_message_fmt,
                });
                return .zero;
            }

            const received_fmt = result.toFmt(globalObject, &formatter);
            const value_fmt = fmt ++ "Received value: <red>{any}<r>\n";

            globalObject.throwPretty(value_fmt, .{
                expected_class,
                received_class,
                received_fmt,
            });
            return .zero;
        }

        // did not throw
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const received_line = "Received function did not throw\n";

        if (expected_value.isEmpty()) {
            const fmt = comptime getSignature("toThrow", "", false) ++ "\n\n" ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{});
            return .zero;
        }

        if (expected_value.isString()) {
            const expected_fmt = "\n\nExpected substring: <green>{any}<r>\n\n" ++ received_line;
            const fmt = signature ++ expected_fmt;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{expected_value.toFmt(globalObject, &formatter)});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{expected_value.toFmt(globalObject, &formatter)});
            return .zero;
        }

        if (expected_value.isRegExp()) {
            const expected_fmt = "\n\nExpected pattern: <green>{any}<r>\n\n" ++ received_line;
            const fmt = signature ++ expected_fmt;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{expected_value.toFmt(globalObject, &formatter)});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{expected_value.toFmt(globalObject, &formatter)});
            return .zero;
        }

        if (expected_value.get(globalObject, "message")) |expected_message| {
            const expected_fmt = "\n\nExpected message: <green>{any}<r>\n\n" ++ received_line;
            const fmt = signature ++ expected_fmt;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{expected_message.toFmt(globalObject, &formatter)});
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{expected_message.toFmt(globalObject, &formatter)});
            return .zero;
        }

        const expected_fmt = "\n\nExpected constructor: <green>{s}<r>\n\n" ++ received_line;
        var expected_class = ZigString.Empty;
        expected_value.getClassName(globalObject, &expected_class);
        const fmt = signature ++ expected_fmt;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{expected_class});
            return .zero;
        }
        globalObject.throw(Output.prettyFmt(fmt, true), .{expected_class});
        return .zero;
    }

    pub fn toMatchSnapshot(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(2);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        if (not) {
            const signature = comptime getSignature("toMatchSnapshot", "", true);
            const fmt = signature ++ "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n";
            globalObject.throwPretty(fmt, .{});
        }

        var hint_string: ZigString = ZigString.Empty;
        var property_matchers: ?JSValue = null;
        switch (arguments.len) {
            0 => {},
            1 => {
                if (arguments[0].isString()) {
                    arguments[0].toZigString(&hint_string, globalObject);
                } else if (arguments[0].isObject()) {
                    property_matchers = arguments[0];
                }
            },
            else => {
                if (!arguments[0].isObject()) {
                    const signature = comptime getSignature("toMatchSnapshot", "<green>properties<r><d>, <r>hint", false);
                    const fmt = signature ++ "\n\nMatcher error: Expected <green>properties<r> must be an object\n";
                    globalObject.throwPretty(fmt, .{});
                    return .zero;
                }

                property_matchers = arguments[0];

                if (arguments[1].isString()) {
                    arguments[1].toZigString(&hint_string, globalObject);
                }
            },
        }

        var hint = hint_string.toSlice(default_allocator);
        defer hint.deinit();

        const value: JSValue = this.getValue(globalObject, thisValue, "toMatchSnapshot", "<green>properties<r><d>, <r>hint") orelse return .zero;

        if (!value.isObject() and property_matchers != null) {
            const signature = comptime getSignature("toMatchSnapshot", "<green>properties<r><d>, <r>hint", false);
            const fmt = signature ++ "\n\n<b>Matcher error: <red>received<r> values must be an object when the matcher has <green>properties<r>\n";
            globalObject.throwPretty(fmt, .{});
            return .zero;
        }

        if (property_matchers) |_prop_matchers| {
            var prop_matchers = _prop_matchers;

            if (!value.jestDeepMatch(prop_matchers, globalObject, true)) {
                // TODO: print diff with properties from propertyMatchers
                const signature = comptime getSignature("toMatchSnapshot", "<green>propertyMatchers<r>", false);
                const fmt = signature ++ "\n\nExpected <green>propertyMatchers<r> to match properties from received object" ++
                    "\n\nReceived: {any}\n";

                var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
                globalObject.throwPretty(fmt, .{value.toFmt(globalObject, &formatter)});
                return .zero;
            }
        }

        const result = Jest.runner.?.snapshots.getOrPut(this, value, hint.slice(), globalObject) catch |err| {
            var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
            const test_file_path = Jest.runner.?.files.get(this.scope.file_id).source.path.text;
            switch (err) {
                error.FailedToOpenSnapshotFile => globalObject.throw("Failed to open snapshot file for test file: {s}", .{test_file_path}),
                error.FailedToMakeSnapshotDirectory => globalObject.throw("Failed to make snapshot directory for test file: {s}", .{test_file_path}),
                error.FailedToWriteSnapshotFile => globalObject.throw("Failed write to snapshot file: {s}", .{test_file_path}),
                error.ParseError => globalObject.throw("Failed to parse snapshot file for: {s}", .{test_file_path}),
                else => globalObject.throw("Failed to snapshot value: {any}", .{value.toFmt(globalObject, &formatter)}),
            }
            return .zero;
        };

        if (result) |saved_value| {
            var pretty_value: MutableString = MutableString.init(default_allocator, 0) catch unreachable;
            value.jestSnapshotPrettyFormat(&pretty_value, globalObject) catch {
                var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
                globalObject.throw("Failed to pretty format value: {s}", .{value.toFmt(globalObject, &formatter)});
                return .zero;
            };
            defer pretty_value.deinit();

            if (strings.eqlLong(pretty_value.toOwnedSliceLeaky(), saved_value, true)) {
                Jest.runner.?.snapshots.passed += 1;
                return thisValue;
            }

            Jest.runner.?.snapshots.failed += 1;
            const signature = comptime getSignature("toMatchSnapshot", "<green>expected<r>", false);
            const fmt = signature ++ "\n\n{any}\n";
            const diff_format = DiffFormatter{
                .received_string = pretty_value.toOwnedSliceLeaky(),
                .expected_string = saved_value,
                .globalObject = globalObject,
            };

            globalObject.throwPretty(fmt, .{diff_format});
            return .zero;
        }

        return thisValue;
    }

    pub fn toBeEmpty(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalObject, thisValue, "toBeEmpty", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        var pass = false;
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

        const actual_length = value.getLengthIfPropertyExistsInternal(globalObject);

        if (actual_length == std.math.inf(f64)) {
            if (value.jsTypeLoose().isObject()) {
                if (value.isIterable(globalObject)) {
                    var any_properties_in_iterator = false;
                    value.forEach(globalObject, &any_properties_in_iterator, struct {
                        pub fn anythingInIterator(
                            _: *JSC.VM,
                            _: *JSGlobalObject,
                            any_: ?*anyopaque,
                            _: JSValue,
                        ) callconv(.C) void {
                            bun.cast(*bool, any_.?).* = true;
                        }
                    }.anythingInIterator);
                    pass = !any_properties_in_iterator;
                } else {
                    var props_iter = JSC.JSPropertyIterator(.{
                        .skip_empty_name = false,

                        .include_value = true,
                    }).init(globalObject, value.asObjectRef());
                    defer props_iter.deinit();
                    pass = props_iter.len == 0;
                }
            } else {
                const signature = comptime getSignature("toBeEmpty", "", false);
                const fmt = signature ++ "\n\nExpected value to be a string, object, or iterable" ++
                    "\n\nReceived: <red>{any}<r>\n";
                globalObject.throwPretty(fmt, .{value.toFmt(globalObject, &formatter)});
                return .zero;
            }
        } else if (std.math.isNan(actual_length)) {
            globalObject.throw("Received value has non-number length property: {}", .{actual_length});
            return .zero;
        } else {
            pass = actual_length == 0;
        }

        if (not and pass) {
            const signature = comptime getSignature("toBeEmpty", "", true);
            const fmt = signature ++ "\n\nExpected value <b>not<r> to be a string, object, or iterable" ++
                "\n\nReceived: <red>{any}<r>\n";
            globalObject.throwPretty(fmt, .{value.toFmt(globalObject, &formatter)});
            return .zero;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        if (not) {
            const signature = comptime getSignature("toBeEmpty", "", true);
            const fmt = signature ++ "\n\nExpected value <b>not<r> to be empty" ++
                "\n\nReceived: <red>{any}<r>\n";
            globalObject.throwPretty(fmt, .{value.toFmt(globalObject, &formatter)});
            return .zero;
        }

        const signature = comptime getSignature("toBeEmpty", "", false);
        const fmt = signature ++ "\n\nExpected value to be empty" ++
            "\n\nReceived: <red>{any}<r>\n";
        globalObject.throwPretty(fmt, .{value.toFmt(globalObject, &formatter)});
        return .zero;
    }

    pub fn toBeNil(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeNil", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        const pass = value.isUndefinedOrNull() != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeNil", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeNil", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeArray(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeArray", "") orelse return .zero;

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeArray() must be called in a test", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        const pass = value.jsType().isArray() != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeArray", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeArray", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeArrayOfSize(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toBeArrayOfSize() requires 1 argument", .{});
            return .zero;
        }

        const value: JSValue = this.getValue(globalThis, thisValue, "toBeArrayOfSize", "") orelse return .zero;

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeArrayOfSize() must be called in a test", .{});
            return .zero;
        }

        const size = arguments[0];
        size.ensureStillAlive();

        if (!size.isAnyInt()) {
            globalThis.throw("toBeArrayOfSize() requires the first argument to be a number", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        var pass = value.jsType().isArray() and @as(i32, @intCast(value.getLength(globalThis))) == size.toInt32();

        if (not) pass = !pass;
        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeArrayOfSize", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeArrayOfSize", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeBoolean(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeBoolean", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        const pass = value.isBoolean() != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeBoolean", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeBoolean", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeTypeOf(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toBeTypeOf() requires 1 argument", .{});
            return .zero;
        }

        if (this.scope.tests.items.len <= this.test_id) {
            globalThis.throw("toBeTypeOf() must be called in a test", .{});
            return .zero;
        }

        const value: JSValue = this.getValue(globalThis, thisValue, "toBeTypeOf", "") orelse return .zero;

        const expected = arguments[0];
        expected.ensureStillAlive();

        const expectedAsStr = expected.toString(globalThis).toSlice(globalThis, default_allocator).slice();
        active_test_expectation_counter.actual += 1;

        if (!expected.isString()) {
            globalThis.throwInvalidArguments("toBeTypeOf() requires a string argument", .{});
            return .zero;
        }

        if (!JSTypeOfMap.has(expectedAsStr)) {
            globalThis.throwInvalidArguments("toBeTypeOf() requires a valid type string argument ('function', 'object', 'bigint', 'boolean', 'number', 'string', 'symbol', 'undefined')", .{});
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;
        var whatIsTheType: []const u8 = "";

        // Checking for function/class should be done before everything else, or it will fail.
        if (value.isCallable(globalThis.vm())) {
            whatIsTheType = "function";
        } else if (value.isObject() or value.jsType().isArray() or value.isNull()) {
            whatIsTheType = "object";
        } else if (value.isBigInt()) {
            whatIsTheType = "bigint";
        } else if (value.isBoolean()) {
            whatIsTheType = "boolean";
        } else if (value.isNumber()) {
            whatIsTheType = "number";
        } else if (value.jsType().isString()) {
            whatIsTheType = "string";
        } else if (value.isSymbol()) {
            whatIsTheType = "symbol";
        } else if (value.isUndefined()) {
            whatIsTheType = "undefined";
        } else {
            globalThis.throw("Internal consistency error: unknown JSValue type", .{});
            return .zero;
        }

        pass = strings.eql(expectedAsStr, whatIsTheType);

        if (not) pass = !pass;
        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);
        const expected_str = expected.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeTypeOf", "", true) ++ "\n\n" ++ "Expected type: not <green>{any}<r>\n" ++ "Received type: <red>\"{s}\"<r>\nReceived value: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{ expected_str, whatIsTheType, received });
            return .zero;
        }

        const fmt = comptime getSignature("toBeTypeOf", "", false) ++ "\n\n" ++ "Expected type: <green>{any}<r>\n" ++ "Received type: <red>\"{s}\"<r>\nReceived value: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{ expected_str, whatIsTheType, received });
        return .zero;
    }

    pub fn toBeTrue(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeTrue", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        const pass = (value.isBoolean() and value.toBoolean()) != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeTrue", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeTrue", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeFalse(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeFalse", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        const pass = (value.isBoolean() and !value.toBoolean()) != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeFalse", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeFalse", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeNumber(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeNumber", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        const pass = value.isNumber() != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeNumber", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeNumber", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeInteger(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeInteger", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        const pass = value.isAnyInt() != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeInteger", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeInteger", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeFinite(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeFinite", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        var pass = value.isNumber();
        if (pass) {
            const num: f64 = value.asNumber();
            pass = std.math.isFinite(num) and !std.math.isNan(num);
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeFinite", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeFinite", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBePositive(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBePositive", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        var pass = value.isNumber();
        if (pass) {
            const num: f64 = value.asNumber();
            pass = @round(num) > 0 and !std.math.isInf(num) and !std.math.isNan(num);
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBePositive", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBePositive", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeNegative(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeNegative", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        var pass = value.isNumber();
        if (pass) {
            const num: f64 = value.asNumber();
            pass = @round(num) < 0 and !std.math.isInf(num) and !std.math.isNan(num);
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeNegative", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeNegative", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeWithin(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(2);
        const arguments = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toBeWithin() requires 2 arguments", .{});
            return .zero;
        }

        const value: JSValue = this.getValue(globalThis, thisValue, "toBeWithin", "<green>start<r><d>, <r><green>end<r>") orelse return .zero;

        const startValue = arguments[0];
        startValue.ensureStillAlive();

        if (!startValue.isNumber()) {
            globalThis.throw("toBeWithin() requires the first argument to be a number", .{});
            return .zero;
        }

        const endValue = arguments[1];
        endValue.ensureStillAlive();

        if (!endValue.isNumber()) {
            globalThis.throw("toBeWithin() requires the second argument to be a number", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        var pass = value.isNumber();
        if (pass) {
            const num = value.asNumber();
            pass = num >= startValue.asNumber() and num < endValue.asNumber();
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const start_fmt = startValue.toFmt(globalThis, &formatter);
        const end_fmt = endValue.toFmt(globalThis, &formatter);
        const received_fmt = value.toFmt(globalThis, &formatter);

        if (not) {
            const expected_line = "Expected: not between <green>{any}<r> <d>(inclusive)<r> and <green>{any}<r> <d>(exclusive)<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeWithin", "<green>start<r><d>, <r><green>end<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            globalThis.throwPretty(fmt, .{ start_fmt, end_fmt, received_fmt });
            return .zero;
        }

        const expected_line = "Expected: between <green>{any}<r> <d>(inclusive)<r> and <green>{any}<r> <d>(exclusive)<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeWithin", "<green>start<r><d>, <r><green>end<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        globalThis.throwPretty(fmt, .{ start_fmt, end_fmt, received_fmt });
        return .zero;
    }

    pub fn toBeSymbol(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeSymbol", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        const pass = value.isSymbol() != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeSymbol", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeSymbol", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeFunction(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeFunction", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        const pass = value.isCallable(globalThis.vm()) != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeFunction", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeFunction", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeDate(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeDate", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        const pass = value.isDate() != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeDate", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeDate", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toBeString(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeString", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        const pass = value.isString() != not;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const fmt = comptime getSignature("toBeString", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeString", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
        return .zero;
    }

    pub fn toInclude(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toInclude() requires 1 argument", .{});
            return .zero;
        }

        const expected = arguments[0];
        expected.ensureStillAlive();

        if (!expected.isString()) {
            globalThis.throw("toInclude() requires the first argument to be a string", .{});
            return .zero;
        }

        const value: JSValue = this.getValue(globalThis, thisValue, "toInclude", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        var pass = value.isString();
        if (pass) {
            const value_string = value.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            const expected_string = expected.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            pass = strings.contains(value_string, expected_string) or expected_string.len == 0;
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = expected.toFmt(globalThis, &formatter);

        if (not) {
            const expected_line = "Expected to not include: <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toInclude", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            globalThis.throwPretty(fmt, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected to include: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toInclude", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        globalThis.throwPretty(fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toStartWith(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toStartWith() requires 1 argument", .{});
            return .zero;
        }

        const expected = arguments[0];
        expected.ensureStillAlive();

        if (!expected.isString()) {
            globalThis.throw("toStartWith() requires the first argument to be a string", .{});
            return .zero;
        }

        const value: JSValue = this.getValue(globalThis, thisValue, "toStartWith", "<green>expected<r>") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        var pass = value.isString();
        if (pass) {
            const value_string = value.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            const expected_string = expected.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            pass = strings.startsWith(value_string, expected_string) or expected_string.len == 0;
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = expected.toFmt(globalThis, &formatter);

        if (not) {
            const expected_line = "Expected to not start with: <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toStartWith", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            globalThis.throwPretty(fmt, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected to start with: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toStartWith", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        globalThis.throwPretty(fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toEndWith(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toEndWith() requires 1 argument", .{});
            return .zero;
        }

        const expected = arguments[0];
        expected.ensureStillAlive();

        if (!expected.isString()) {
            globalThis.throw("toEndWith() requires the first argument to be a string", .{});
            return .zero;
        }

        const value: JSValue = this.getValue(globalThis, thisValue, "toEndWith", "<green>expected<r>") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        var pass = value.isString();
        if (pass) {
            const value_string = value.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            const expected_string = expected.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            pass = strings.endsWith(value_string, expected_string) or expected_string.len == 0;
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = expected.toFmt(globalThis, &formatter);

        if (not) {
            const expected_line = "Expected to not end with: <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toEndWith", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            globalThis.throwPretty(fmt, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected to end with: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toEndWith", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        globalThis.throwPretty(fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toBeInstanceOf(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toBeInstanceOf() requires 1 argument", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

        const expected_value = arguments[0];
        if (!expected_value.isConstructor()) {
            globalObject.throw("Expected value must be a function: {any}", .{expected_value.toFmt(globalObject, &formatter)});
            return .zero;
        }
        expected_value.ensureStillAlive();

        const value: JSValue = this.getValue(globalObject, thisValue, "toBeInstanceOf", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = value.isInstanceOf(globalObject, expected_value);
        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        const expected_fmt = expected_value.toFmt(globalObject, &formatter);
        const value_fmt = value.toFmt(globalObject, &formatter);
        if (not) {
            const expected_line = "Expected constructor: not <green>{any}<r>\n";
            const received_line = "Received value: <red>{any}<r>\n";
            const fmt = comptime getSignature("toBeInstanceOf", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
                return .zero;
            }

            globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected constructor: <green>{any}<r>\n";
        const received_line = "Received value: <red>{any}<r>\n";
        const fmt = comptime getSignature("toBeInstanceOf", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        globalObject.throwPretty(fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toMatch(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        JSC.markBinding(@src());

        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toMatch() requires 1 argument", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };

        const expected_value = arguments[0];
        if (!expected_value.isString() and !expected_value.isRegExp()) {
            globalObject.throw("Expected value must be a string or regular expression: {any}", .{expected_value.toFmt(globalObject, &formatter)});
            return .zero;
        }
        expected_value.ensureStillAlive();

        const value: JSValue = this.getValue(globalObject, thisValue, "toMatch", "<green>expected<r>") orelse return .zero;

        if (!value.isString()) {
            globalObject.throw("Received value must be a string: {any}", .{value.toFmt(globalObject, &formatter)});
            return .zero;
        }

        const not = this.flags.not;
        var pass: bool = brk: {
            if (expected_value.isString()) {
                break :brk value.stringIncludes(globalObject, expected_value);
            } else if (expected_value.isRegExp()) {
                break :brk expected_value.toMatch(globalObject, value);
            }
            unreachable;
        };

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        const expected_fmt = expected_value.toFmt(globalObject, &formatter);
        const value_fmt = value.toFmt(globalObject, &formatter);

        if (not) {
            const expected_line = "Expected substring or pattern: not <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const fmt = comptime getSignature("toMatch", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
            globalObject.throwPretty(fmt, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected substring or pattern: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toMatch", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        globalObject.throwPretty(fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toHaveBeenCalled(this: *Expect, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());
        const thisValue = callframe.this();
        defer this.postMatch(globalObject);

        const value: JSValue = this.getValue(globalObject, thisValue, "toHaveBeenCalled", "") orelse return .zero;

        const calls = JSMockFunction__getCalls(value);
        active_test_expectation_counter.actual += 1;

        if (calls == .zero or !calls.jsType().isArray()) {
            globalObject.throw("Expected value must be a mock function: {}", .{value});
            return .zero;
        }

        var pass = calls.getLength(globalObject) > 0;

        const not = this.flags.not;
        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        if (not) {
            const signature = comptime getSignature("toHaveBeenCalled", "", true);
            const fmt = signature ++ "\n\nExpected: not <green>{any}<r>\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{calls.toFmt(globalObject, &formatter)});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{calls.toFmt(globalObject, &formatter)});
            return .zero;
        } else {
            const signature = comptime getSignature("toHaveBeenCalled", "", true);
            const fmt = signature ++ "\n\nExpected <green>{any}<r>\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{calls.toFmt(globalObject, &formatter)});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{calls.toFmt(globalObject, &formatter)});
            return .zero;
        }

        unreachable;
    }
    pub fn toHaveBeenCalledTimes(this: *Expect, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        const thisValue = callframe.this();
        const arguments_ = callframe.arguments(1);
        const arguments: []const JSValue = arguments_.ptr[0..arguments_.len];
        defer this.postMatch(globalObject);
        const value: JSValue = this.getValue(globalObject, thisValue, "toHaveBeenCalledTimes", "<green>expected<r>") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const calls = JSMockFunction__getCalls(value);

        if (calls == .zero or !calls.jsType().isArray()) {
            globalObject.throw("Expected value must be a mock function: {}", .{value});
            return .zero;
        }

        if (arguments.len < 1 or !arguments[0].isAnyInt()) {
            globalObject.throwInvalidArguments("toHaveBeenCalledTimes() requires 1 integer argument", .{});
            return .zero;
        }

        const times = arguments[0].coerce(i32, globalObject);

        var pass = @as(i32, @intCast(calls.getLength(globalObject))) == times;

        const not = this.flags.not;
        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject, .quote_strings = true };
        if (not) {
            const signature = comptime getSignature("toHaveBeenCalledTimes", "<green>expected<r>", true);
            const fmt = signature ++ "\n\nExpected: not <green>{any}<r>\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{calls.toFmt(globalObject, &formatter)});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{calls.toFmt(globalObject, &formatter)});
            return .zero;
        } else {
            const signature = comptime getSignature("toHaveBeenCalledTimes", "<green>expected<r>", true);
            const fmt = signature ++ "\n\nExpected <green>{any}<r>\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(Output.prettyFmt(fmt, true), .{calls.toFmt(globalObject, &formatter)});
                return .zero;
            }
            globalObject.throw(Output.prettyFmt(fmt, false), .{calls.toFmt(globalObject, &formatter)});
            return .zero;
        }

        unreachable;
    }

    pub fn toMatchObject(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        JSC.markBinding(@src());

        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const args = callFrame.arguments(1).slice();

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;

        const received_object: JSValue = this.getValue(globalObject, thisValue, "toMatchObject", "<green>expected<r>") orelse return .zero;

        if (!received_object.isObject()) {
            const matcher_error = "\n\n<b>Matcher error<r>: <red>received<r> value must be a non-null object\n";
            if (not) {
                const fmt = comptime getSignature("toMatchObject", "<green>expected<r>", true) ++ matcher_error;
                globalObject.throwPretty(fmt, .{});
                return .zero;
            }

            const fmt = comptime getSignature("toMatchObject", "<green>expected<r>", false) ++ matcher_error;
            globalObject.throwPretty(fmt, .{});
            return .zero;
        }

        if (args.len < 1 or !args[0].isObject()) {
            const matcher_error = "\n\n<b>Matcher error<r>: <green>expected<r> value must be a non-null object\n";
            if (not) {
                const fmt = comptime getSignature("toMatchObject", "", true) ++ matcher_error;
                globalObject.throwPretty(fmt, .{});
                return .zero;
            }
            const fmt = comptime getSignature("toMatchObject", "", false) ++ matcher_error;
            globalObject.throwPretty(fmt, .{});
            return .zero;
        }

        const property_matchers = args[0];

        var pass = received_object.jestDeepMatch(property_matchers, globalObject, true);

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        const diff_formatter = DiffFormatter{
            .received = received_object,
            .expected = property_matchers,
            .globalObject = globalObject,
            .not = not,
        };

        if (not) {
            const signature = comptime getSignature("toMatchObject", "<green>expected<r>", true);
            const fmt = signature ++ "\n\n{any}\n";
            globalObject.throwPretty(fmt, .{diff_formatter});
            return .zero;
        }

        const signature = comptime getSignature("toMatchObject", "<green>expected<r>", false);
        const fmt = signature ++ "\n\n{any}\n";
        globalObject.throwPretty(fmt, .{diff_formatter});
        return .zero;
    }

    pub const toHaveBeenCalledWith = notImplementedJSCFn;
    pub const toHaveBeenLastCalledWith = notImplementedJSCFn;
    pub const toHaveBeenNthCalledWith = notImplementedJSCFn;
    pub const toHaveReturnedTimes = notImplementedJSCFn;
    pub const toHaveReturnedWith = notImplementedJSCFn;
    pub const toHaveLastReturnedWith = notImplementedJSCFn;
    pub const toHaveNthReturnedWith = notImplementedJSCFn;
    pub const toContainEqual = notImplementedJSCFn;
    pub const toMatchInlineSnapshot = notImplementedJSCFn;
    pub const toThrowErrorMatchingSnapshot = notImplementedJSCFn;
    pub const toThrowErrorMatchingInlineSnapshot = notImplementedJSCFn;

    pub const getStaticNot = notImplementedStaticProp;
    pub const getStaticResolves = notImplementedStaticProp;
    pub const getStaticRejects = notImplementedStaticProp;

    pub fn any(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectAny.call(globalObject, callFrame);
    }

    pub fn anything(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectAnything.call(globalObject, callFrame);
    }

    pub fn stringContaining(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectStringContaining.call(globalObject, callFrame);
    }

    pub fn stringMatching(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectStringMatching.call(globalObject, callFrame);
    }

    pub const extend = notImplementedStaticFn;
    pub const arrayContaining = notImplementedStaticFn;
    pub const assertions = notImplementedStaticFn;
    pub const hasAssertions = notImplementedStaticFn;
    pub const objectContaining = notImplementedStaticFn;
    pub const addSnapshotSerializer = notImplementedStaticFn;

    pub fn notImplementedJSCFn(_: *Expect, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        globalObject.throw("Not implemented", .{});
        return .zero;
    }

    pub fn notImplementedStaticFn(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        globalObject.throw("Not implemented", .{});
        return .zero;
    }

    pub fn notImplementedJSCProp(_: *Expect, _: JSC.JSValue, globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        globalObject.throw("Not implemented", .{});
        return .zero;
    }

    pub fn notImplementedStaticProp(globalObject: *JSC.JSGlobalObject, _: JSC.JSValue, _: JSC.JSValue) callconv(.C) JSC.JSValue {
        globalObject.throw("Not implemented", .{});
        return .zero;
    }

    pub fn postMatch(_: *Expect, globalObject: *JSC.JSGlobalObject) void {
        var vm = globalObject.bunVM();
        vm.autoGarbageCollect();
    }
};

pub const ExpectAnything = struct {
    pub usingnamespace JSC.Codegen.JSExpectAnything;

    pub fn finalize(
        this: *ExpectAnything,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        const anything = globalObject.bunVM().allocator.create(ExpectAnything) catch unreachable;
        if (Jest.runner.?.pending_test == null) {
            const err = globalObject.createErrorInstance("expect.anything() must be called in a test", .{});
            err.put(globalObject, ZigString.static("name"), ZigString.init("TestNotRunningError").toValueGC(globalObject));
            globalObject.throwValue(err);
            return .zero;
        }

        const anything_js_value = anything.toJS(globalObject);
        anything_js_value.ensureStillAlive();

        var vm = globalObject.bunVM();
        vm.autoGarbageCollect();

        return anything_js_value;
    }
};

pub const ExpectStringMatching = struct {
    pub usingnamespace JSC.Codegen.JSExpectStringMatching;

    pub fn finalize(
        this: *ExpectStringMatching,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(1).slice();

        if (args.len == 0 or (!args[0].isString() and !args[0].isRegExp())) {
            const fmt = "<d>expect.<r>stringContaining<d>(<r>string<d>)<r>\n\nExpected a string or regular expression\n";
            globalObject.throwPretty(fmt, .{});
            return .zero;
        }

        const test_value = args[0];
        const string_matching = globalObject.bunVM().allocator.create(ExpectStringMatching) catch unreachable;

        if (Jest.runner.?.pending_test == null) {
            const err = globalObject.createErrorInstance("expect.stringContaining() must be called in a test", .{});
            err.put(globalObject, ZigString.static("name"), ZigString.init("TestNotRunningError").toValueGC(globalObject));
            globalObject.throwValue(err);
            return .zero;
        }

        const string_matching_js_value = string_matching.toJS(globalObject);
        ExpectStringMatching.testValueSetCached(string_matching_js_value, globalObject, test_value);

        var vm = globalObject.bunVM();
        vm.autoGarbageCollect();
        return string_matching_js_value;
    }
};

pub const ExpectStringContaining = struct {
    pub usingnamespace JSC.Codegen.JSExpectStringContaining;

    pub fn finalize(
        this: *ExpectStringContaining,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(1).slice();

        if (args.len == 0 or !args[0].isString()) {
            const fmt = "<d>expect.<r>stringContaining<d>(<r>string<d>)<r>\n\nExpected a string\n";
            globalObject.throwPretty(fmt, .{});
            return .zero;
        }

        const string_value = args[0];

        const string_containing = globalObject.bunVM().allocator.create(ExpectStringContaining) catch unreachable;

        if (Jest.runner.?.pending_test == null) {
            const err = globalObject.createErrorInstance("expect.stringContaining() must be called in a test", .{});
            err.put(globalObject, ZigString.static("name"), ZigString.init("TestNotRunningError").toValueGC(globalObject));
            globalObject.throwValue(err);
            return .zero;
        }

        const string_containing_js_value = string_containing.toJS(globalObject);
        ExpectStringContaining.stringValueSetCached(string_containing_js_value, globalObject, string_value);

        var vm = globalObject.bunVM();
        vm.autoGarbageCollect();
        return string_containing_js_value;
    }
};

pub const ExpectAny = struct {
    pub usingnamespace JSC.Codegen.JSExpectAny;

    pub fn finalize(
        this: *ExpectAny,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len == 0) {
            globalObject.throw("any() expects to be passed a constructor function.", .{});
            return .zero;
        }

        const constructor = arguments[0];
        constructor.ensureStillAlive();
        if (!constructor.isConstructor()) {
            const fmt = "<d>expect.<r>any<d>(<r>constructor<d>)<r>\n\nExpected a constructor\n";
            globalObject.throwPretty(fmt, .{});
            return .zero;
        }

        var any = globalObject.bunVM().allocator.create(ExpectAny) catch unreachable;

        if (Jest.runner.?.pending_test == null) {
            const err = globalObject.createErrorInstance("expect.any() must be called in a test", .{});
            err.put(globalObject, ZigString.static("name"), ZigString.init("TestNotRunningError").toValueGC(globalObject));
            globalObject.throwValue(err);
            return .zero;
        }

        any.* = .{};
        const any_js_value = any.toJS(globalObject);
        any_js_value.ensureStillAlive();
        ExpectAny.constructorValueSetCached(any_js_value, globalObject, constructor);
        any_js_value.ensureStillAlive();

        var vm = globalObject.bunVM();
        vm.autoGarbageCollect();

        return any_js_value;
    }
};

/// JSValue.zero is used to indicate it was not a JSMockFunction
/// If there were no calls, it returns an empty JSArray*
extern fn JSMockFunction__getCalls(JSValue) JSValue;

/// JSValue.zero is used to indicate it was not a JSMockFunction
/// If there were no calls, it returns an empty JSArray*
extern fn JSMockFunction__getReturns(JSValue) JSValue;
