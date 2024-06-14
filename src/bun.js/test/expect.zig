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
pub var is_expecting_assertions: bool = false;
pub var is_expecting_assertions_count: bool = false;
pub var expected_assertions_number: u32 = 0;

const log = bun.Output.scoped(.expect, false);

/// Helper to retrieve matcher flags from a jsvalue of a class like ExpectAny, ExpectStringMatching, etc.
pub fn getMatcherFlags(comptime T: type, value: JSValue) Expect.Flags {
    if (T.flagsGetCached(value)) |flagsValue| {
        if (!flagsValue.isEmpty()) {
            return Expect.Flags.fromBitset(flagsValue.toInt32());
        }
    }
    return .{};
}

/// https://jestjs.io/docs/expect
// To support async tests, we need to track the test ID
pub const Expect = struct {
    pub usingnamespace JSC.Codegen.JSExpect;
    flags: Flags = .{},
    parent: ParentScope = .{ .global = {} },
    custom_label: bun.String = bun.String.empty,

    pub const TestScope = struct {
        test_id: TestRunner.Test.ID,
        describe: *DescribeScope,
    };

    pub const ParentScope = union(enum) {
        global: void,
        TestScope: TestScope,
    };

    pub fn testScope(this: *const Expect) ?*const TestScope {
        if (this.parent == .TestScope) {
            return &this.parent.TestScope;
        }

        return null;
    }

    pub const Flags = packed struct {
        // note: keep this struct in sync with C++ implementation (at bindings.cpp)

        promise: enum(u2) {
            none = 0,
            resolves = 1,
            rejects = 2,
        } = .none,

        not: bool = false,

        _: u5 = undefined, // padding

        pub const FlagsCppType = u8;
        comptime {
            if (@bitSizeOf(Flags) != @bitSizeOf(FlagsCppType)) @compileError("Flags size is invalid, should match FlagsCppType");
        }

        pub inline fn encode(this: Flags) FlagsCppType {
            return @bitCast(this);
        }

        pub inline fn decode(bitset: FlagsCppType) Flags {
            return @bitCast(bitset);
        }
    };

    pub fn getSignature(comptime matcher_name: string, comptime args: string, comptime not: bool) string {
        const received = "<d>expect(<r><red>received<r><d>).<r>";
        comptime if (not) {
            return received ++ "not<d>.<r>" ++ matcher_name ++ "<d>(<r>" ++ args ++ "<d>)<r>";
        };
        return received ++ matcher_name ++ "<d>(<r>" ++ args ++ "<d>)<r>";
    }

    pub fn throwPrettyMatcherError(globalThis: *JSGlobalObject, custom_label: bun.String, matcher_name: anytype, matcher_params: anytype, flags: Flags, comptime message_fmt: string, message_args: anytype) void {
        switch (Output.enable_ansi_colors) {
            inline else => |colors| {
                const chain = switch (flags.promise) {
                    .resolves => if (flags.not) Output.prettyFmt("resolves<d>.<r>not<d>.<r>", colors) else Output.prettyFmt("resolves<d>.<r>", colors),
                    .rejects => if (flags.not) Output.prettyFmt("rejects<d>.<r>not<d>.<r>", colors) else Output.prettyFmt("rejects<d>.<r>", colors),
                    .none => if (flags.not) Output.prettyFmt("not<d>.<r>", colors) else "",
                };
                switch (!custom_label.isEmpty()) {
                    inline else => |use_default_label| {
                        if (use_default_label) {
                            const fmt = comptime Output.prettyFmt("<d>expect(<r><red>received<r><d>).<r>{s}{s}<d>(<r>{s}<d>)<r>\n\n" ++ message_fmt, colors);
                            globalThis.throwPretty(fmt, .{
                                chain,
                                matcher_name,
                                matcher_params,
                            } ++ message_args);
                        } else {
                            const fmt = comptime Output.prettyFmt("{}\n\n" ++ message_fmt, colors);
                            globalThis.throwPretty(fmt, .{
                                custom_label,
                            } ++ message_args);
                        }
                    },
                }
            },
        }
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

    pub fn getValue(this: *Expect, globalThis: *JSGlobalObject, thisValue: JSValue, matcher_name: string, comptime matcher_params_fmt: string) ?JSValue {
        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal error: the expect(value) was garbage collected but it should not have been!", .{});
            return null;
        };
        value.ensureStillAlive();

        const matcher_params = switch (Output.enable_ansi_colors) {
            inline else => |colors| comptime Output.prettyFmt(matcher_params_fmt, colors),
        };
        return processPromise(this.custom_label, this.flags, globalThis, value, matcher_name, matcher_params, false);
    }

    /// Processes the async flags (resolves/rejects), waiting for the async value if needed.
    /// If no flags, returns the original value
    /// If either flag is set, waits for the result, and returns either it as a JSValue, or null if the expectation failed (in which case if silent is false, also throws a js exception)
    pub fn processPromise(custom_label: bun.String, flags: Expect.Flags, globalThis: *JSGlobalObject, value: JSValue, matcher_name: anytype, matcher_params: anytype, comptime silent: bool) ?JSValue {
        switch (flags.promise) {
            inline .resolves, .rejects => |resolution| {
                if (value.asAnyPromise()) |promise| {
                    const vm = globalThis.vm();
                    promise.setHandled(vm);

                    globalThis.bunVM().waitForPromise(promise);

                    const newValue = promise.result(vm);
                    switch (promise.status(vm)) {
                        .Fulfilled => switch (resolution) {
                            .resolves => {},
                            .rejects => {
                                if (!silent) {
                                    var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
                                    const message = "Expected promise that rejects<r>\nReceived promise that resolved: <red>{any}<r>\n";
                                    throwPrettyMatcherError(globalThis, custom_label, matcher_name, matcher_params, flags, message, .{value.toFmt(globalThis, &formatter)});
                                }
                                return null;
                            },
                            .none => unreachable,
                        },
                        .Rejected => switch (resolution) {
                            .rejects => {},
                            .resolves => {
                                if (!silent) {
                                    var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
                                    const message = "Expected promise that resolves<r>\nReceived promise that rejected: <red>{any}<r>\n";
                                    throwPrettyMatcherError(globalThis, custom_label, matcher_name, matcher_params, flags, message, .{value.toFmt(globalThis, &formatter)});
                                }
                                return null;
                            },
                            .none => unreachable,
                        },
                        .Pending => unreachable,
                    }

                    newValue.ensureStillAlive();
                    return newValue;
                } else {
                    if (!silent) {
                        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
                        const message = "Expected promise<r>\nReceived: <red>{any}<r>\n";
                        throwPrettyMatcherError(globalThis, custom_label, matcher_name, matcher_params, flags, message, .{value.toFmt(globalThis, &formatter)});
                    }
                    return null;
                }
            },
            else => {},
        }

        return value;
    }

    /// Called by C++ when matching with asymmetric matchers
    fn readFlagsAndProcessPromise(instanceValue: JSValue, globalThis: *JSGlobalObject, outFlags: *Expect.Flags.FlagsCppType, value: *JSValue) callconv(.C) bool {
        const flags: Expect.Flags = flags: {
            if (ExpectCustomAsymmetricMatcher.fromJS(instanceValue)) |instance| {
                break :flags instance.flags;
            } else if (ExpectAny.fromJS(instanceValue)) |instance| {
                break :flags instance.flags;
            } else if (ExpectAnything.fromJS(instanceValue)) |instance| {
                break :flags instance.flags;
            } else if (ExpectStringMatching.fromJS(instanceValue)) |instance| {
                break :flags instance.flags;
            } else if (ExpectCloseTo.fromJS(instanceValue)) |instance| {
                break :flags instance.flags;
            } else if (ExpectObjectContaining.fromJS(instanceValue)) |instance| {
                break :flags instance.flags;
            } else if (ExpectStringContaining.fromJS(instanceValue)) |instance| {
                break :flags instance.flags;
            } else if (ExpectArrayContaining.fromJS(instanceValue)) |instance| {
                break :flags instance.flags;
            } else {
                break :flags Expect.Flags{};
            }
        };

        outFlags.* = flags.encode();

        // (note that matcher_name/matcher_args are not used because silent=true)
        if (processPromise(bun.String.empty, flags, globalThis, value.*, "", "", true)) |result| {
            value.* = result;
            return true;
        }
        return false;
    }

    pub fn getSnapshotName(this: *Expect, allocator: std.mem.Allocator, hint: string) ![]const u8 {
        const parent = this.testScope() orelse return error.NoTest;

        const test_name = parent.describe.tests.items[parent.test_id].label;

        var length: usize = 0;
        var curr_scope: ?*DescribeScope = parent.describe;
        while (curr_scope) |scope| {
            if (scope.label.len > 0) {
                length += scope.label.len + 1;
            }
            curr_scope = scope.parent;
        }
        length += test_name.len;
        if (hint.len > 0) {
            length += hint.len + 2;
        }

        var buf = try allocator.alloc(u8, length);

        var index = buf.len;
        if (hint.len > 0) {
            index -= hint.len;
            bun.copy(u8, buf[index..], hint);
            index -= test_name.len + 2;
            bun.copy(u8, buf[index..], test_name);
            bun.copy(u8, buf[index + test_name.len ..], ": ");
        } else {
            index -= test_name.len;
            bun.copy(u8, buf[index..], test_name);
        }
        // copy describe scopes in reverse order
        curr_scope = parent.describe;
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
        this.custom_label.deref();
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(2).slice();
        const value = if (arguments.len < 1) JSC.JSValue.jsUndefined() else arguments[0];

        var custom_label = bun.String.empty;
        if (arguments.len > 1) {
            if (arguments[1].isString() or arguments[1].implementsToString(globalThis)) {
                const label = arguments[1].toBunString(globalThis);
                if (globalThis.hasException()) return .zero;
                custom_label = label;
            }
        }

        var expect = globalThis.bunVM().allocator.create(Expect) catch {
            custom_label.deref();
            globalThis.throwOutOfMemory();
            return .zero;
        };

        expect.* = .{
            .custom_label = custom_label,
            .parent = if (Jest.runner) |runner|
                if (runner.pending_test) |pending|
                    Expect.ParentScope{ .TestScope = Expect.TestScope{
                        .describe = pending.describe,
                        .test_id = pending.test_id,
                    } }
                else
                    Expect.ParentScope{ .global = {} }
            else
                Expect.ParentScope{ .global = {} },
        };
        const expect_js_value = expect.toJS(globalThis);
        expect_js_value.ensureStillAlive();
        Expect.capturedValueSetCached(expect_js_value, globalThis, value);
        expect_js_value.ensureStillAlive();

        expect.postMatch(globalThis);
        return expect_js_value;
    }

    pub fn throw(this: *Expect, globalThis: *JSC.JSGlobalObject, comptime signature: string, comptime fmt: string, args: anytype) void {
        if (this.custom_label.isEmpty()) {
            globalThis.throwPretty(comptime signature ++ fmt, args);
        } else {
            globalThis.throwPretty(comptime "{}" ++ fmt, .{this.custom_label} ++ args);
        }
    }

    pub fn constructor(
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) ?*Expect {
        globalThis.throw("expect() cannot be called with new", .{});
        return null;
    }

    // pass here has a leading underscore to avoid name collision with the pass variable in other functions
    pub fn _pass(
        this: *Expect,
        globalThis: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);

        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

        var _msg: ZigString = ZigString.Empty;

        if (arguments.len > 0) {
            const value = arguments[0];
            value.ensureStillAlive();

            if (!value.isString()) {
                globalThis.throwInvalidArgumentType("pass", "message", "string");
                return .zero;
            }

            value.toZigString(&_msg, globalThis);
        } else {
            _msg = ZigString.fromBytes("passes by .pass() assertion");
        }

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = true;

        if (not) pass = !pass;
        if (pass) return .undefined;

        var msg = _msg.toSlice(default_allocator);
        defer msg.deinit();

        if (not) {
            const signature = comptime getSignature("pass", "", true);
            this.throw(globalThis, signature, "\n\n{s}\n", .{msg.slice()});
            return .zero;
        }

        // should never reach here
        return .zero;
    }

    pub fn fail(
        this: *Expect,
        globalThis: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);

        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

        var _msg: ZigString = ZigString.Empty;

        if (arguments.len > 0) {
            const value = arguments[0];
            value.ensureStillAlive();

            if (!value.isString()) {
                globalThis.throwInvalidArgumentType("fail", "message", "string");
                return .zero;
            }

            value.toZigString(&_msg, globalThis);
        } else {
            _msg = ZigString.fromBytes("fails by .fail() assertion");
        }

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = false;

        if (not) pass = !pass;
        if (pass) return .undefined;

        var msg = _msg.toSlice(default_allocator);
        defer msg.deinit();

        const signature = comptime getSignature("fail", "", true);
        this.throw(globalThis, signature, "\n\n{s}\n", .{msg.slice()});
        return .zero;
    }

    /// Object.is()
    pub fn toBe(
        this: *Expect,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);
        const thisValue = callframe.this();
        const arguments_ = callframe.arguments(2);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toBe() takes 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();
        const right = arguments[0];
        right.ensureStillAlive();
        const left = this.getValue(globalThis, thisValue, "toBe", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = right.isSameValue(left, globalThis);

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };

        switch (this.custom_label.isEmpty()) {
            inline else => |has_custom_label| {
                if (not) {
                    const signature = comptime getSignature("toBe", "<green>expected<r>", true);
                    this.throw(globalThis, signature, "\n\nExpected: not <green>{any}<r>\n", .{right.toFmt(globalThis, &formatter)});
                    return .zero;
                }

                const signature = comptime getSignature("toBe", "<green>expected<r>", false);
                if (left.deepEquals(right, globalThis) or left.strictDeepEquals(right, globalThis)) {
                    const fmt = signature ++
                        (if (!has_custom_label) "\n\n<d>If this test should pass, replace \"toBe\" with \"toEqual\" or \"toStrictEqual\"<r>" else "") ++
                        "\n\nExpected: <green>{any}<r>\n" ++
                        "Received: serializes to the same string\n";
                    this.throw(globalThis, signature, fmt, .{right.toFmt(globalThis, &formatter)});
                    return .zero;
                }

                if (right.isString() and left.isString()) {
                    const diff_format = DiffFormatter{
                        .expected = right,
                        .received = left,
                        .globalThis = globalThis,
                        .not = not,
                    };
                    this.throw(globalThis, signature, "\n\n{any}\n", .{diff_format});
                    return .zero;
                }

                this.throw(globalThis, signature, "\n\nExpected: <green>{any}<r>\nReceived: <red>{any}<r>\n", .{
                    right.toFmt(globalThis, &formatter),
                    left.toFmt(globalThis, &formatter),
                });
                return .zero;
            },
        }
    }

    pub fn toHaveLength(
        this: *Expect,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);
        const thisValue = callframe.this();
        const arguments_ = callframe.arguments(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toHaveLength() takes 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected: JSValue = arguments[0];
        const value: JSValue = this.getValue(globalThis, thisValue, "toHaveLength", "<green>expected<r>") orelse return .zero;

        if (!value.isObject() and !value.isString()) {
            var fmt = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            globalThis.throw("Received value does not have a length property: {any}", .{value.toFmt(globalThis, &fmt)});
            return .zero;
        }

        if (!expected.isNumber()) {
            var fmt = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            globalThis.throw("Expected value must be a non-negative integer: {any}", .{expected.toFmt(globalThis, &fmt)});
            return .zero;
        }

        const expected_length: f64 = expected.asNumber();
        if (@round(expected_length) != expected_length or std.math.isInf(expected_length) or std.math.isNan(expected_length) or expected_length < 0) {
            var fmt = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            globalThis.throw("Expected value must be a non-negative integer: {any}", .{expected.toFmt(globalThis, &fmt)});
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;

        const actual_length = value.getLengthIfPropertyExistsInternal(globalThis);

        if (actual_length == std.math.inf(f64)) {
            var fmt = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            globalThis.throw("Received value does not have a length property: {any}", .{value.toFmt(globalThis, &fmt)});
            return .zero;
        } else if (std.math.isNan(actual_length)) {
            globalThis.throw("Received value has non-number length property: {}", .{actual_length});
            return .zero;
        }

        if (actual_length == expected_length) {
            pass = true;
        }

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        if (not) {
            const expected_line = "Expected length: not <green>{d}<r>\n";
            const signature = comptime getSignature("toHaveLength", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line, .{expected_length});
            return .zero;
        }

        const expected_line = "Expected length: <green>{d}<r>\n";
        const received_line = "Received length: <red>{d}<r>\n";
        const signature = comptime getSignature("toHaveLength", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_length, actual_length });
        return .zero;
    }

    pub fn toBeOneOf(
        this: *Expect,
        globalThis: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toBeOneOf() takes 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = this.getValue(globalThis, thisValue, "toBeOneOf", "<green>expected<r>") orelse return .zero;
        const list_value: JSValue = arguments[0];

        const not = this.flags.not;
        var pass = false;

        const ExpectedEntry = struct {
            globalThis: *JSC.JSGlobalObject,
            expected: JSValue,
            pass: *bool,
        };

        if (list_value.jsTypeLoose().isArrayLike()) {
            var itr = list_value.arrayIterator(globalThis);
            while (itr.next()) |item| {
                // Confusingly, jest-extended uses `deepEqual`, instead of `toBe`
                if (item.jestDeepEquals(expected, globalThis)) {
                    pass = true;
                    break;
                }
            }
        } else if (list_value.isIterable(globalThis)) {
            var expected_entry = ExpectedEntry{
                .globalThis = globalThis,
                .expected = expected,
                .pass = &pass,
            };
            list_value.forEach(globalThis, &expected_entry, struct {
                pub fn sameValueIterator(
                    _: *JSC.VM,
                    _: *JSGlobalObject,
                    entry_: ?*anyopaque,
                    item: JSValue,
                ) callconv(.C) void {
                    const entry = bun.cast(*ExpectedEntry, entry_.?);
                    // Confusingly, jest-extended uses `deepEqual`, instead of `toBe`
                    if (item.jestDeepEquals(entry.expected, entry.globalThis)) {
                        entry.pass.* = true;
                        // TODO(perf): break out of the `forEach` when a match is found
                    }
                }
            }.sameValueIterator);
        } else {
            globalThis.throw("Received value must be an array type, or both received and expected values must be strings.", .{});
            return .zero;
        }

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = list_value.toFmt(globalThis, &formatter);
        const expected_fmt = expected.toFmt(globalThis, &formatter);
        if (not) {
            const received_fmt = list_value.toFmt(globalThis, &formatter);
            const expected_line = "Expected to not be one of: <green>{any}<r>\nReceived: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeOneOf", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line, .{ received_fmt, expected_fmt });
            return .zero;
        }

        const expected_line = "Expected to be one of: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeOneOf", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ value_fmt, expected_fmt });
        return .zero;
    }

    pub fn toContain(
        this: *Expect,
        globalThis: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toContain() takes 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = arguments[0];
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalThis, thisValue, "toContain", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = false;

        const ExpectedEntry = struct {
            globalThis: *JSC.JSGlobalObject,
            expected: JSValue,
            pass: *bool,
        };

        if (value.jsTypeLoose().isArrayLike()) {
            var itr = value.arrayIterator(globalThis);
            while (itr.next()) |item| {
                if (item.isSameValue(expected, globalThis)) {
                    pass = true;
                    break;
                }
            }
        } else if (value.isStringLiteral() and expected.isStringLiteral()) {
            const value_string = value.toSlice(globalThis, default_allocator);
            defer value_string.deinit();
            const expected_string = expected.toSlice(globalThis, default_allocator);
            defer expected_string.deinit();

            if (expected_string.len == 0) { // edge case empty string is always contained
                pass = true;
            } else if (strings.contains(value_string.slice(), expected_string.slice())) {
                pass = true;
            } else if (value_string.len == 0 and expected_string.len == 0) { // edge case two empty strings are true
                pass = true;
            }
        } else if (value.isIterable(globalThis)) {
            var expected_entry = ExpectedEntry{
                .globalThis = globalThis,
                .expected = expected,
                .pass = &pass,
            };
            value.forEach(globalThis, &expected_entry, struct {
                pub fn sameValueIterator(
                    _: *JSC.VM,
                    _: *JSGlobalObject,
                    entry_: ?*anyopaque,
                    item: JSValue,
                ) callconv(.C) void {
                    const entry = bun.cast(*ExpectedEntry, entry_.?);
                    if (item.isSameValue(entry.expected, entry.globalThis)) {
                        entry.pass.* = true;
                        // TODO(perf): break out of the `forEach` when a match is found
                    }
                }
            }.sameValueIterator);
        } else {
            globalThis.throw("Received value must be an array type, or both received and expected values must be strings.", .{});
            return .zero;
        }

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = expected.toFmt(globalThis, &formatter);
        if (not) {
            const received_fmt = value.toFmt(globalThis, &formatter);
            const expected_line = "Expected to not contain: <green>{any}<r>\nReceived: <red>{any}<r>\n";
            const signature = comptime getSignature("toContain", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line, .{ expected_fmt, received_fmt });
            return .zero;
        }

        const expected_line = "Expected to contain: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toContain", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toContainKey(
        this: *Expect,
        globalThis: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toContainKey() takes 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = arguments[0];
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalThis, thisValue, "toContainKey", "<green>expected<r>") orelse return .zero;
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };

        const not = this.flags.not;
        if (!value.isObject()) {
            const err = globalThis.createTypeErrorInstance("Expected value must be an object\nReceived: {}", .{value.toFmt(
                globalThis,
                &formatter,
            )});
            globalThis.throwValue(err);
            return .zero;
        }

        var pass = value.hasOwnPropertyValue(globalThis, expected);

        if (globalThis.hasException()) {
            return .zero;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure

        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = expected.toFmt(globalThis, &formatter);
        if (not) {
            const received_fmt = value.toFmt(globalThis, &formatter);
            const expected_line = "Expected to not contain: <green>{any}<r>\nReceived: <red>{any}<r>\n";
            const signature = comptime getSignature("toContainKey", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line, .{ expected_fmt, received_fmt });
            return .zero;
        }

        const expected_line = "Expected to contain: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toContainKey", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toContainKeys(
        this: *Expect,
        globalThis: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toContainKeys() takes 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = arguments[0];
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalThis, thisValue, "toContainKeys", "<green>expected<r>") orelse return .zero;

        if (!expected.jsType().isArray()) {
            globalThis.throwInvalidArgumentType("toContainKeys", "expected", "array");
            return .zero;
        }

        const not = this.flags.not;
        var pass = brk: {
            const count = expected.getLength(globalThis);

            // jest-extended checks for truthiness before calling hasOwnProperty
            // https://github.com/jest-community/jest-extended/blob/711fdcc54d68c2b2c1992c7cfbdf0d0bd6be0f4d/src/matchers/toContainKeys.js#L1-L6
            if (!value.coerce(bool, globalThis)) break :brk count == 0;

            var i: u32 = 0;

            while (i < count) : (i += 1) {
                const key = expected.getIndex(globalThis, i);

                if (!value.hasOwnPropertyValue(globalThis, key)) {
                    break :brk false;
                }
            }

            break :brk true;
        };

        if (globalThis.hasException()) {
            return .zero;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = expected.toFmt(globalThis, &formatter);
        if (not) {
            const received_fmt = value.toFmt(globalThis, &formatter);
            const expected_line = "Expected to not contain: <green>{any}<r>\nReceived: <red>{any}<r>\n";
            const signature = comptime getSignature("toContainKeys", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line, .{ expected_fmt, received_fmt });
            return .zero;
        }

        const expected_line = "Expected to contain: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toContainKeys", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toContainAllKeys(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toContainAllKeys() takes 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = arguments[0];
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalObject, thisValue, "toContainAllKeys", "<green>expected<r>") orelse return .zero;

        if (!expected.jsType().isArray()) {
            globalObject.throwInvalidArgumentType("toContainAllKeys", "expected", "array");
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;

        const count = expected.getLength(globalObject);

        var keys = value.keys(globalObject);
        if (keys.getLength(globalObject) == count) {
            var itr = keys.arrayIterator(globalObject);
            outer: {
                while (itr.next()) |item| {
                    var i: u32 = 0;
                    while (i < count) : (i += 1) {
                        const key = expected.getIndex(globalObject, i);
                        if (item.jestDeepEquals(key, globalObject)) break;
                    } else break :outer;
                }
                pass = true;
            }
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = keys.toFmt(globalObject, &formatter);
        const expected_fmt = expected.toFmt(globalObject, &formatter);
        if (not) {
            const received_fmt = keys.toFmt(globalObject, &formatter);
            const expected_line = "Expected to not contain all keys: <green>{any}<r>\nReceived: <red>{any}<r>\n";
            const fmt = "\n\n" ++ expected_line;
            this.throw(globalObject, comptime getSignature("toContainAllKeys", "<green>expected<r>", true), fmt, .{ expected_fmt, received_fmt });
            return .zero;
        }

        const expected_line = "Expected to contain all keys: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = "\n\n" ++ expected_line ++ received_line;
        this.throw(globalObject, comptime getSignature("toContainAllKeys", "<green>expected<r>", false), fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toContainAnyKeys(
        this: *Expect,
        globalThis: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toContainAnyKeys() takes 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = arguments[0];
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalThis, thisValue, "toContainAnyKeys", "<green>expected<r>") orelse return .zero;

        if (!expected.jsType().isArray()) {
            globalThis.throwInvalidArgumentType("toContainAnyKeys", "expected", "array");
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;

        const count = expected.getLength(globalThis);

        var i: u32 = 0;

        while (i < count) : (i += 1) {
            const key = expected.getIndex(globalThis, i);

            if (value.hasOwnPropertyValue(globalThis, key)) {
                pass = true;
                break;
            }
        }

        if (globalThis.hasException()) {
            return .zero;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = expected.toFmt(globalThis, &formatter);
        if (not) {
            const received_fmt = value.toFmt(globalThis, &formatter);
            const expected_line = "Expected to not contain: <green>{any}<r>\nReceived: <red>{any}<r>\n";
            const signature = comptime getSignature("toContainAnyKeys", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line, .{ expected_fmt, received_fmt });
            return .zero;
        }

        const expected_line = "Expected to contain: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toContainAnyKeys", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toContainValue(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toContainValue() takes 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = arguments[0];
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalObject, thisValue, "toContainValue", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = false;

        if (!value.isUndefinedOrNull()) {
            const values = value.values(globalObject);
            var itr = values.arrayIterator(globalObject);
            while (itr.next()) |item| {
                if (item.jestDeepEquals(expected, globalObject)) {
                    pass = true;
                    break;
                }
            }
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = expected.toFmt(globalObject, &formatter);
        if (not) {
            const received_fmt = value.toFmt(globalObject, &formatter);
            const expected_line = "Expected to not contain: <green>{any}<r>\nReceived: <red>{any}<r>\n";
            const fmt = "\n\n" ++ expected_line;
            this.throw(globalObject, comptime getSignature("toContainValue", "<green>expected<r>", true), fmt, .{ expected_fmt, received_fmt });
            return .zero;
        }

        const expected_line = "Expected to contain: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = "\n\n" ++ expected_line ++ received_line;
        this.throw(globalObject, comptime getSignature("toContainValue", "<green>expected<r>", false), fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toContainValues(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toContainValues() takes 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = arguments[0];
        if (!expected.jsType().isArray()) {
            globalObject.throwInvalidArgumentType("toContainValues", "expected", "array");
            return .zero;
        }
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalObject, thisValue, "toContainValues", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = true;

        if (!value.isUndefinedOrNull()) {
            const values = value.values(globalObject);
            var itr = expected.arrayIterator(globalObject);
            const count = values.getLength(globalObject);

            while (itr.next()) |item| {
                var i: u32 = 0;
                while (i < count) : (i += 1) {
                    const key = values.getIndex(globalObject, i);
                    if (key.jestDeepEquals(item, globalObject)) break;
                } else {
                    pass = false;
                    break;
                }
            }
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = expected.toFmt(globalObject, &formatter);
        if (not) {
            const received_fmt = value.toFmt(globalObject, &formatter);
            const expected_line = "Expected to not contain: <green>{any}<r>\nReceived: <red>{any}<r>\n";
            const fmt = "\n\n" ++ expected_line;
            this.throw(globalObject, comptime getSignature("toContainValues", "<green>expected<r>", true), fmt, .{ expected_fmt, received_fmt });
            return .zero;
        }

        const expected_line = "Expected to contain: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = "\n\n" ++ expected_line ++ received_line;
        this.throw(globalObject, comptime getSignature("toContainValues", "<green>expected<r>", false), fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toContainAllValues(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toContainAllValues() takes 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = arguments[0];
        if (!expected.jsType().isArray()) {
            globalObject.throwInvalidArgumentType("toContainAllValues", "expected", "array");
            return .zero;
        }
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalObject, thisValue, "toContainAllValues", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = false;

        if (!value.isUndefinedOrNull()) {
            var values = value.values(globalObject);
            var itr = expected.arrayIterator(globalObject);
            const count = values.getLength(globalObject);
            const expectedLength = expected.getLength(globalObject);

            if (count == expectedLength) {
                while (itr.next()) |item| {
                    var i: u32 = 0;
                    while (i < count) : (i += 1) {
                        const key = values.getIndex(globalObject, i);
                        if (key.jestDeepEquals(item, globalObject)) {
                            pass = true;
                            break;
                        }
                    } else {
                        pass = false;
                        break;
                    }
                }
            }
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = expected.toFmt(globalObject, &formatter);
        if (not) {
            const received_fmt = value.toFmt(globalObject, &formatter);
            const expected_line = "Expected to not contain all values: <green>{any}<r>\nReceived: <red>{any}<r>\n";
            const fmt = "\n\n" ++ expected_line;
            this.throw(globalObject, comptime getSignature("toContainAllValues", "<green>expected<r>", true), fmt, .{ expected_fmt, received_fmt });
            return .zero;
        }

        const expected_line = "Expected to contain all values: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = "\n\n" ++ expected_line ++ received_line;
        this.throw(globalObject, comptime getSignature("toContainAllValues", "<green>expected<r>", false), fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toContainAnyValues(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toContainAnyValues() takes 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = arguments[0];
        if (!expected.jsType().isArray()) {
            globalObject.throwInvalidArgumentType("toContainAnyValues", "expected", "array");
            return .zero;
        }
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalObject, thisValue, "toContainAnyValues", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = false;

        if (!value.isUndefinedOrNull()) {
            var values = value.values(globalObject);
            var itr = expected.arrayIterator(globalObject);
            const count = values.getLength(globalObject);

            outer: while (itr.next()) |item| {
                var i: u32 = 0;
                while (i < count) : (i += 1) {
                    const key = values.getIndex(globalObject, i);
                    if (key.jestDeepEquals(item, globalObject)) {
                        pass = true;
                        break :outer;
                    }
                }
            }
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = expected.toFmt(globalObject, &formatter);
        if (not) {
            const received_fmt = value.toFmt(globalObject, &formatter);
            const expected_line = "Expected to not contain any of the following values: <green>{any}<r>\nReceived: <red>{any}<r>\n";
            const fmt = "\n\n" ++ expected_line;
            this.throw(globalObject, comptime getSignature("toContainAnyValues", "<green>expected<r>", true), fmt, .{ expected_fmt, received_fmt });
            return .zero;
        }

        const expected_line = "Expected to contain any of the following values: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = "\n\n" ++ expected_line ++ received_line;
        this.throw(globalObject, comptime getSignature("toContainAnyValues", "<green>expected<r>", false), fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toContainEqual(
        this: *Expect,
        globalThis: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toContainEqual() takes 1 argument", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected = arguments[0];
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalThis, thisValue, "toContainEqual", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = false;

        const ExpectedEntry = struct {
            globalThis: *JSC.JSGlobalObject,
            expected: JSValue,
            pass: *bool,
        };

        const value_type = value.jsType();
        const expected_type = expected.jsType();

        if (value_type.isArrayLike()) {
            var itr = value.arrayIterator(globalThis);
            while (itr.next()) |item| {
                if (item.jestDeepEquals(expected, globalThis)) {
                    pass = true;
                    break;
                }
            }
        } else if (value_type.isStringLike() and expected_type.isStringLike()) {
            if (expected_type.isStringObjectLike() and value_type.isString()) pass = false else {
                const value_string = value.toSliceOrNull(globalThis) orelse return .zero;
                defer value_string.deinit();
                const expected_string = expected.toSliceOrNull(globalThis) orelse return .zero;
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
        } else if (value.isIterable(globalThis)) {
            var expected_entry = ExpectedEntry{
                .globalThis = globalThis,
                .expected = expected,
                .pass = &pass,
            };
            value.forEach(globalThis, &expected_entry, struct {
                pub fn deepEqualsIterator(
                    _: *JSC.VM,
                    _: *JSGlobalObject,
                    entry_: ?*anyopaque,
                    item: JSValue,
                ) callconv(.C) void {
                    const entry = bun.cast(*ExpectedEntry, entry_.?);
                    if (item.jestDeepEquals(entry.expected, entry.globalThis)) {
                        entry.pass.* = true;
                        // TODO(perf): break out of the `forEach` when a match is found
                    }
                }
            }.deepEqualsIterator);
        } else {
            globalThis.throw("Received value must be an array type, or both received and expected values must be strings.", .{});
            return .zero;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = expected.toFmt(globalThis, &formatter);
        if (not) {
            const expected_line = "Expected to not contain: <green>{any}<r>\n";
            const signature = comptime getSignature("toContainEqual", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line, .{expected_fmt});
            return .zero;
        }

        const expected_line = "Expected to contain: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toContainEqual", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toBeTruthy(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);
        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeTruthy", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = false;

        const truthy = value.toBooleanSlow(globalThis);
        if (truthy) pass = true;

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeTruthy", "", true);
            this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeTruthy", "", false);
        this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
        return .zero;
    }

    pub fn toBeUndefined(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);
        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeUndefined", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = false;
        if (value.isUndefined()) pass = true;

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeUndefined", "", true);
            this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeUndefined", "", false);
        this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
        return .zero;
    }

    pub fn toBeNaN(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeNaN", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = false;
        if (value.isNumber()) {
            const number = value.asNumber();
            if (number != number) pass = true;
        }

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeNaN", "", true);
            this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeNaN", "", false);
        this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
        return .zero;
    }

    pub fn toBeNull(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeNull", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = value.isNull();
        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeNull", "", true);
            this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeNull", "", false);
        this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
        return .zero;
    }

    pub fn toBeDefined(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeDefined", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = !value.isUndefined();
        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeDefined", "", true);
            this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeDefined", "", false);
        this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
        return .zero;
    }

    pub fn toBeFalsy(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();

        const value: JSValue = this.getValue(globalThis, thisValue, "toBeFalsy", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = false;

        const truthy = value.toBooleanSlow(globalThis);
        if (!truthy) pass = true;

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeFalsy", "", true);
            this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeFalsy", "", false);
        this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
        return .zero;
    }

    pub fn toEqual(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toEqual() requires 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = arguments[0];
        const value: JSValue = this.getValue(globalThis, thisValue, "toEqual", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = value.jestDeepEquals(expected, globalThis);

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        const diff_formatter = DiffFormatter{
            .received = value,
            .expected = expected,
            .globalThis = globalThis,
            .not = not,
        };

        if (not) {
            const signature = comptime getSignature("toEqual", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n{any}\n", .{diff_formatter});
            return .zero;
        }

        const signature = comptime getSignature("toEqual", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n{any}\n", .{diff_formatter});
        return .zero;
    }

    pub fn toStrictEqual(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toStrictEqual() requires 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = arguments[0];
        const value: JSValue = this.getValue(globalThis, thisValue, "toStrictEqual", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = value.jestStrictDeepEquals(expected, globalThis);

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        const diff_formatter = DiffFormatter{ .received = value, .expected = expected, .globalThis = globalThis, .not = not };

        if (not) {
            const signature = comptime getSignature("toStrictEqual", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n{any}\n", .{diff_formatter});
            return .zero;
        }

        const signature = comptime getSignature("toStrictEqual", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n{any}\n", .{diff_formatter});
        return .zero;
    }

    pub fn toHaveProperty(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(2);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toHaveProperty() requires at least 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected_property_path = arguments[0];
        expected_property_path.ensureStillAlive();
        const expected_property: ?JSValue = if (arguments.len > 1) arguments[1] else null;
        if (expected_property) |ev| ev.ensureStillAlive();

        const value: JSValue = this.getValue(globalThis, thisValue, "toHaveProperty", "<green>path<r><d>, <r><green>value<r>") orelse return .zero;

        if (!expected_property_path.isString() and !expected_property_path.isIterable(globalThis)) {
            globalThis.throw("Expected path must be a string or an array", .{});
            return .zero;
        }

        const not = this.flags.not;
        var path_string = ZigString.Empty;
        expected_property_path.toZigString(&path_string, globalThis);

        var pass = !value.isUndefinedOrNull();
        var received_property: JSValue = .zero;

        if (pass) {
            received_property = value.getIfPropertyExistsFromPath(globalThis, expected_property_path);
            pass = !received_property.isEmpty();
        }

        if (pass and expected_property != null) {
            pass = received_property.jestDeepEquals(expected_property.?, globalThis);
        }

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        if (not) {
            if (expected_property != null) {
                const signature = comptime getSignature("toHaveProperty", "<green>path<r><d>, <r><green>value<r>", true);
                if (!received_property.isEmpty()) {
                    this.throw(globalThis, signature, "\n\nExpected path: <green>{any}<r>\n\nExpected value: not <green>{any}<r>\n", .{
                        expected_property_path.toFmt(globalThis, &formatter),
                        expected_property.?.toFmt(globalThis, &formatter),
                    });
                    return .zero;
                }
            }

            const signature = comptime getSignature("toHaveProperty", "<green>path<r>", true);
            this.throw(globalThis, signature, "\n\nExpected path: not <green>{any}<r>\n\nReceived value: <red>{any}<r>\n", .{
                expected_property_path.toFmt(globalThis, &formatter),
                received_property.toFmt(globalThis, &formatter),
            });
            return .zero;
        }

        if (expected_property != null) {
            const signature = comptime getSignature("toHaveProperty", "<green>path<r><d>, <r><green>value<r>", false);
            if (!received_property.isEmpty()) {
                // deep equal case
                const diff_format = DiffFormatter{
                    .received = received_property,
                    .expected = expected_property.?,
                    .globalThis = globalThis,
                };

                this.throw(globalThis, signature, "\n\n{any}\n", .{diff_format});
                return .zero;
            }

            const fmt = "\n\nExpected path: <green>{any}<r>\n\nExpected value: <green>{any}<r>\n\n" ++
                "Unable to find property\n";
            this.throw(globalThis, signature, fmt, .{
                expected_property_path.toFmt(globalThis, &formatter),
                expected_property.?.toFmt(globalThis, &formatter),
            });
            return .zero;
        }

        const signature = comptime getSignature("toHaveProperty", "<green>path<r>", false);
        this.throw(globalThis, signature, "\n\nExpected path: <green>{any}<r>\n\nUnable to find property\n", .{expected_property_path.toFmt(globalThis, &formatter)});
        return .zero;
    }

    pub fn toBeEven(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();

        const value: JSValue = this.getValue(globalThis, thisValue, "toBeEven", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = false;

        if (value.isAnyInt()) {
            const _value = value.toInt64();
            pass = @mod(_value, 2) == 0;
            if (_value == -0.0) { // negative zero is even
                pass = true;
            }
        } else if (value.isBigInt() or value.isBigInt32()) {
            const _value = value.toInt64();
            pass = switch (_value == -0.0) { // negative zero is even
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
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeEven", "", true);
            this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeEven", "", false);
        this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
        return .zero;
    }

    pub fn toBeGreaterThan(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toBeGreaterThan() requires 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value: JSValue = this.getValue(globalThis, thisValue, "toBeGreaterThan", "<green>expected<r>") orelse return .zero;

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalThis.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() > other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalThis, other_value)) {
                .greater_than => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalThis, value)) {
                .less_than => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = other_value.toFmt(globalThis, &formatter);
        if (not) {
            const expected_line = "Expected: not \\> <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeGreaterThan", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected: \\> <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeGreaterThan", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toBeGreaterThanOrEqual(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toBeGreaterThanOrEqual() requires 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value: JSValue = this.getValue(globalThis, thisValue, "toBeGreaterThanOrEqual", "<green>expected<r>") orelse return .zero;

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalThis.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() >= other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalThis, other_value)) {
                .greater_than, .equal => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalThis, value)) {
                .less_than, .equal => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = other_value.toFmt(globalThis, &formatter);
        if (not) {
            const expected_line = "Expected: not \\>= <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeGreaterThanOrEqual", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected: \\>= <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeGreaterThanOrEqual", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toBeLessThan(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toBeLessThan() requires 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value: JSValue = this.getValue(globalThis, thisValue, "toBeLessThan", "<green>expected<r>") orelse return .zero;

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalThis.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() < other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalThis, other_value)) {
                .less_than => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalThis, value)) {
                .greater_than => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = other_value.toFmt(globalThis, &formatter);
        if (not) {
            const expected_line = "Expected: not \\< <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeLessThan", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected: \\< <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeLessThan", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toBeLessThanOrEqual(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toBeLessThanOrEqual() requires 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const other_value = arguments[0];
        other_value.ensureStillAlive();

        const value: JSValue = this.getValue(globalThis, thisValue, "toBeLessThanOrEqual", "<green>expected<r>") orelse return .zero;

        if ((!value.isNumber() and !value.isBigInt()) or (!other_value.isNumber() and !other_value.isBigInt())) {
            globalThis.throw("Expected and actual values must be numbers or bigints", .{});
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;

        if (!value.isBigInt() and !other_value.isBigInt()) {
            pass = value.asNumber() <= other_value.asNumber();
        } else if (value.isBigInt()) {
            pass = switch (value.asBigIntCompare(globalThis, other_value)) {
                .less_than, .equal => true,
                else => pass,
            };
        } else {
            pass = switch (other_value.asBigIntCompare(globalThis, value)) {
                .greater_than, .equal => true,
                else => pass,
            };
        }

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = other_value.toFmt(globalThis, &formatter);
        if (not) {
            const expected_line = "Expected: not \\<= <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeLessThanOrEqual", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected: \\<= <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeLessThanOrEqual", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toBeCloseTo(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const thisArguments = callFrame.arguments(2);
        const arguments = thisArguments.ptr[0..thisArguments.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toBeCloseTo() requires at least 1 argument. Expected value must be a number", .{});
            return .zero;
        }

        const expected_ = arguments[0];
        if (!expected_.isNumber()) {
            globalThis.throwInvalidArgumentType("toBeCloseTo", "expected", "number");
            return .zero;
        }

        var precision: f64 = 2.0;
        if (arguments.len > 1) {
            const precision_ = arguments[1];
            if (!precision_.isNumber()) {
                globalThis.throwInvalidArgumentType("toBeCloseTo", "precision", "number");
                return .zero;
            }

            precision = precision_.asNumber();
        }

        const received_: JSValue = this.getValue(globalThis, thisValue, "toBeCloseTo", "<green>expected<r>, precision") orelse return .zero;
        if (!received_.isNumber()) {
            globalThis.throwInvalidArgumentType("expect", "received", "number");
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
            return .undefined;
        }

        const expected_diff = std.math.pow(f64, 10, -precision) / 2;
        const actual_diff = @abs(received - expected);
        var pass = actual_diff < expected_diff;

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };

        const expected_fmt = expected_.toFmt(globalThis, &formatter);
        const received_fmt = received_.toFmt(globalThis, &formatter);

        const expected_line = "Expected: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const expected_precision = "Expected precision: {d}\n";
        const expected_difference = "Expected difference: \\< <green>{d}<r>\n";
        const received_difference = "Received difference: <red>{d}<r>\n";

        const suffix_fmt = "\n\n" ++ expected_line ++ received_line ++ "\n" ++ expected_precision ++ expected_difference ++ received_difference;

        if (not) {
            const signature = comptime getSignature("toBeCloseTo", "<green>expected<r>, precision", true);
            this.throw(globalThis, signature, suffix_fmt, .{ expected_fmt, received_fmt, precision, expected_diff, actual_diff });
            return .zero;
        }

        const signature = comptime getSignature("toBeCloseTo", "<green>expected<r>, precision", false);
        this.throw(globalThis, signature, suffix_fmt, .{ expected_fmt, received_fmt, precision, expected_diff, actual_diff });
        return .zero;
    }

    pub fn toBeOdd(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();

        const value: JSValue = this.getValue(globalThis, thisValue, "toBeOdd", "") orelse return .zero;

        incrementExpectCallCounter();

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
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        if (not) {
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeOdd", "", true);
            this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
            return .zero;
        }

        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeOdd", "", false);
        this.throw(globalThis, signature, "\n\n" ++ received_line, .{value_fmt});
        return .zero;
    }

    pub fn toThrow(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        incrementExpectCallCounter();

        const expected_value: JSValue = if (arguments.len > 0) brk: {
            const value = arguments[0];
            if (value.isEmptyOrUndefinedOrNull() or !value.isObject() and !value.isString()) {
                var fmt = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
                globalThis.throw("Expected value must be string or Error: {any}", .{value.toFmt(globalThis, &fmt)});
                return .zero;
            }
            break :brk value;
        } else .zero;
        expected_value.ensureStillAlive();

        const value: JSValue = this.getValue(globalThis, thisValue, "toThrow", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;

        const result_: ?JSValue = brk: {
            if (!value.jsType().isFunction()) {
                if (this.flags.promise != .none) {
                    break :brk value;
                }

                globalThis.throw("Expected value must be a function", .{});
                return .zero;
            }

            var vm = globalThis.bunVM();
            var return_value: JSValue = .zero;

            // Drain existing unhandled rejections
            vm.global.handleRejectedPromises();

            var scope = vm.unhandledRejectionScope();
            const prev_unhandled_pending_rejection_to_capture = vm.unhandled_pending_rejection_to_capture;
            vm.unhandled_pending_rejection_to_capture = &return_value;
            vm.onUnhandledRejection = &VirtualMachine.onQuietUnhandledRejectionHandlerCaptureValue;
            const return_value_from_fucntion: JSValue = value.call(globalThis, &.{});
            vm.unhandled_pending_rejection_to_capture = prev_unhandled_pending_rejection_to_capture;

            vm.global.handleRejectedPromises();

            if (return_value == .zero) {
                return_value = return_value_from_fucntion;
            }

            if (return_value.asAnyPromise()) |promise| {
                vm.waitForPromise(promise);
                scope.apply(vm);
                const promise_result = promise.result(globalThis.vm());

                switch (promise.status(globalThis.vm())) {
                    .Fulfilled => {
                        break :brk null;
                    },
                    .Rejected => {
                        promise.setHandled(globalThis.vm());

                        // since we know for sure it rejected, we should always return the error
                        break :brk promise_result.toError() orelse promise_result;
                    },
                    .Pending => unreachable,
                }
            }

            if (return_value != return_value_from_fucntion) {
                if (return_value_from_fucntion.asAnyPromise()) |existing| {
                    existing.setHandled(globalThis.vm());
                }
            }

            scope.apply(vm);

            break :brk return_value.toError() orelse return_value_from_fucntion.toError();
        };

        const did_throw = result_ != null;

        if (not) {
            const signature = comptime getSignature("toThrow", "<green>expected<r>", true);

            if (!did_throw) return .undefined;

            const result: JSValue = result_.?;
            var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };

            if (expected_value.isEmpty() or expected_value.isUndefined()) {
                const signature_no_args = comptime getSignature("toThrow", "", true);
                if (result.toError()) |err| {
                    const name = err.get(globalThis, "name") orelse JSValue.undefined;
                    const message = err.get(globalThis, "message") orelse JSValue.undefined;
                    const fmt = signature_no_args ++ "\n\nError name: <red>{any}<r>\nError message: <red>{any}<r>\n";
                    globalThis.throwPretty(fmt, .{
                        name.toFmt(globalThis, &formatter),
                        message.toFmt(globalThis, &formatter),
                    });
                    return .zero;
                }

                // non error thrown
                const fmt = signature_no_args ++ "\n\nThrown value: <red>{any}<r>\n";
                globalThis.throwPretty(fmt, .{result.toFmt(globalThis, &formatter)});
                return .zero;
            }

            if (expected_value.isString()) {
                const received_message = result.getIfPropertyExistsImpl(globalThis, "message", 7);

                // TODO: remove this allocation
                // partial match
                {
                    const expected_slice = expected_value.toSliceOrNull(globalThis) orelse return .zero;
                    defer expected_slice.deinit();
                    const received_slice = received_message.toSliceOrNull(globalThis) orelse return .zero;
                    defer received_slice.deinit();
                    if (!strings.contains(received_slice.slice(), expected_slice.slice())) return .undefined;
                }

                this.throw(globalThis, signature, "\n\nExpected substring: not <green>{any}<r>\nReceived message: <red>{any}<r>\n", .{
                    expected_value.toFmt(globalThis, &formatter),
                    received_message.toFmt(globalThis, &formatter),
                });
                return .zero;
            }

            if (expected_value.isRegExp()) {
                const received_message = result.getIfPropertyExistsImpl(globalThis, "message", 7);

                // TODO: REMOVE THIS GETTER! Expose a binding to call .test on the RegExp object directly.
                if (expected_value.get(globalThis, "test")) |test_fn| {
                    const matches = test_fn.callWithThis(globalThis, expected_value, &.{received_message});
                    if (!matches.toBooleanSlow(globalThis)) return .undefined;
                }

                this.throw(globalThis, signature, "\n\nExpected pattern: not <green>{any}<r>\nReceived message: <red>{any}<r>\n", .{
                    expected_value.toFmt(globalThis, &formatter),
                    received_message.toFmt(globalThis, &formatter),
                });
                return .zero;
            }

            if (expected_value.get(globalThis, "message")) |expected_message| {
                const received_message = result.getIfPropertyExistsImpl(globalThis, "message", 7);
                // no partial match for this case
                if (!expected_message.isSameValue(received_message, globalThis)) return .undefined;

                this.throw(globalThis, signature, "\n\nExpected message: not <green>{any}<r>\n", .{expected_message.toFmt(globalThis, &formatter)});
                return .zero;
            }

            if (!result.isInstanceOf(globalThis, expected_value)) return .undefined;

            var expected_class = ZigString.Empty;
            expected_value.getClassName(globalThis, &expected_class);
            const received_message = result.getIfPropertyExistsImpl(globalThis, "message", 7);
            this.throw(globalThis, signature, "\n\nExpected constructor: not <green>{s}<r>\n\nReceived message: <red>{any}<r>\n", .{ expected_class, received_message.toFmt(globalThis, &formatter) });
            return .zero;
        }

        if (did_throw) {
            if (expected_value.isEmpty() or expected_value.isUndefined()) return .undefined;

            const result: JSValue = if (result_.?.toError()) |r|
                r
            else
                result_.?;

            const _received_message: ?JSValue = if (result.isObject())
                result.get(globalThis, "message")
            else if (result.toStringOrNull(globalThis)) |js_str|
                JSC.JSValue.fromCell(js_str)
            else
                null;

            if (expected_value.isString()) {
                if (_received_message) |received_message| {
                    // TODO: remove this allocation
                    // partial match
                    const expected_slice = expected_value.toSliceOrNull(globalThis) orelse return .zero;
                    defer expected_slice.deinit();
                    const received_slice = received_message.toSlice(globalThis, globalThis.allocator());
                    defer received_slice.deinit();
                    if (strings.contains(received_slice.slice(), expected_slice.slice())) return .undefined;
                }

                // error: message from received error does not match expected string
                var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };

                const signature = comptime getSignature("toThrow", "<green>expected<r>", false);

                if (_received_message) |received_message| {
                    const expected_value_fmt = expected_value.toFmt(globalThis, &formatter);
                    const received_message_fmt = received_message.toFmt(globalThis, &formatter);
                    this.throw(globalThis, signature, "\n\n" ++ "Expected substring: <green>{any}<r>\nReceived message: <red>{any}<r>\n", .{ expected_value_fmt, received_message_fmt });
                    return .zero;
                }

                const expected_fmt = expected_value.toFmt(globalThis, &formatter);
                const received_fmt = result.toFmt(globalThis, &formatter);
                this.throw(globalThis, signature, "\n\n" ++ "Expected substring: <green>{any}<r>\nReceived value: <red>{any}<r>", .{ expected_fmt, received_fmt });

                return .zero;
            }

            if (expected_value.isRegExp()) {
                if (_received_message) |received_message| {
                    // TODO: REMOVE THIS GETTER! Expose a binding to call .test on the RegExp object directly.
                    if (expected_value.get(globalThis, "test")) |test_fn| {
                        const matches = test_fn.callWithThis(globalThis, expected_value, &.{received_message});
                        if (matches.toBooleanSlow(globalThis)) return .undefined;
                    }
                }

                // error: message from received error does not match expected pattern
                var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };

                if (_received_message) |received_message| {
                    const expected_value_fmt = expected_value.toFmt(globalThis, &formatter);
                    const received_message_fmt = received_message.toFmt(globalThis, &formatter);
                    const signature = comptime getSignature("toThrow", "<green>expected<r>", false);

                    this.throw(globalThis, signature, "\n\n" ++ "Expected pattern: <green>{any}<r>\nReceived message: <red>{any}<r>\n", .{ expected_value_fmt, received_message_fmt });

                    return .zero;
                }

                const expected_fmt = expected_value.toFmt(globalThis, &formatter);
                const received_fmt = result.toFmt(globalThis, &formatter);
                const signature = comptime getSignature("toThrow", "<green>expected<r>", false);
                this.throw(globalThis, signature, "\n\n" ++ "Expected pattern: <green>{any}<r>\nReceived value: <red>{any}<r>", .{ expected_fmt, received_fmt });
                return .zero;
            }

            // If it's not an object, we are going to crash here.
            assert(expected_value.isObject());

            if (expected_value.get(globalThis, "message")) |expected_message| {
                const signature = comptime getSignature("toThrow", "<green>expected<r>", false);

                if (_received_message) |received_message| {
                    if (received_message.isSameValue(expected_message, globalThis)) return .undefined;
                }

                // error: message from received error does not match expected error message.
                var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };

                if (_received_message) |received_message| {
                    const expected_fmt = expected_message.toFmt(globalThis, &formatter);
                    const received_fmt = received_message.toFmt(globalThis, &formatter);
                    this.throw(globalThis, signature, "\n\nExpected message: <green>{any}<r>\nReceived message: <red>{any}<r>\n", .{ expected_fmt, received_fmt });
                    return .zero;
                }

                const expected_fmt = expected_message.toFmt(globalThis, &formatter);
                const received_fmt = result.toFmt(globalThis, &formatter);
                this.throw(globalThis, signature, "\n\nExpected message: <green>{any}<r>\nReceived value: <red>{any}<r>\n", .{ expected_fmt, received_fmt });
                return .zero;
            }

            if (result.isInstanceOf(globalThis, expected_value)) return .undefined;

            // error: received error not instance of received error constructor
            var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            var expected_class = ZigString.Empty;
            var received_class = ZigString.Empty;
            expected_value.getClassName(globalThis, &expected_class);
            result.getClassName(globalThis, &received_class);
            const signature = comptime getSignature("toThrow", "<green>expected<r>", false);
            const fmt = signature ++ "\n\nExpected constructor: <green>{s}<r>\nReceived constructor: <red>{s}<r>\n\n";

            if (_received_message) |received_message| {
                const message_fmt = fmt ++ "Received message: <red>{any}<r>\n";
                const received_message_fmt = received_message.toFmt(globalThis, &formatter);

                globalThis.throwPretty(message_fmt, .{
                    expected_class,
                    received_class,
                    received_message_fmt,
                });
                return .zero;
            }

            const received_fmt = result.toFmt(globalThis, &formatter);
            const value_fmt = fmt ++ "Received value: <red>{any}<r>\n";

            globalThis.throwPretty(value_fmt, .{
                expected_class,
                received_class,
                received_fmt,
            });
            return .zero;
        }

        // did not throw
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received_line = "Received function did not throw\n";

        if (expected_value.isEmpty() or expected_value.isUndefined()) {
            const signature = comptime getSignature("toThrow", "", false);
            this.throw(globalThis, signature, "\n\n" ++ received_line, .{});
            return .zero;
        }

        const signature = comptime getSignature("toThrow", "<green>expected<r>", false);

        if (expected_value.isString()) {
            const expected_fmt = "\n\nExpected substring: <green>{any}<r>\n\n" ++ received_line;
            this.throw(globalThis, signature, expected_fmt, .{expected_value.toFmt(globalThis, &formatter)});
            return .zero;
        }

        if (expected_value.isRegExp()) {
            const expected_fmt = "\n\nExpected pattern: <green>{any}<r>\n\n" ++ received_line;
            this.throw(globalThis, signature, expected_fmt, .{expected_value.toFmt(globalThis, &formatter)});
            return .zero;
        }

        if (expected_value.get(globalThis, "message")) |expected_message| {
            const expected_fmt = "\n\nExpected message: <green>{any}<r>\n\n" ++ received_line;
            this.throw(globalThis, signature, expected_fmt, .{expected_message.toFmt(globalThis, &formatter)});
            return .zero;
        }

        const expected_fmt = "\n\nExpected constructor: <green>{s}<r>\n\n" ++ received_line;
        var expected_class = ZigString.Empty;
        expected_value.getClassName(globalThis, &expected_class);
        this.throw(globalThis, signature, expected_fmt, .{expected_class});
        return .zero;
    }

    pub fn toMatchSnapshot(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);
        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(2);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        incrementExpectCallCounter();

        const not = this.flags.not;
        if (not) {
            const signature = comptime getSignature("toMatchSnapshot", "", true);
            this.throw(globalThis, signature, "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n", .{});
        }

        if (this.testScope() == null) {
            const signature = comptime getSignature("toMatchSnapshot", "", true);
            this.throw(globalThis, signature, "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n", .{});
            return .zero;
        }

        var hint_string: ZigString = ZigString.Empty;
        var property_matchers: ?JSValue = null;
        switch (arguments.len) {
            0 => {},
            1 => {
                if (arguments[0].isString()) {
                    arguments[0].toZigString(&hint_string, globalThis);
                } else if (arguments[0].isObject()) {
                    property_matchers = arguments[0];
                }
            },
            else => {
                if (!arguments[0].isObject()) {
                    const signature = comptime getSignature("toMatchSnapshot", "<green>properties<r><d>, <r>hint", false);
                    this.throw(globalThis, signature, "\n\nMatcher error: Expected <green>properties<r> must be an object\n", .{});
                    return .zero;
                }

                property_matchers = arguments[0];

                if (arguments[1].isString()) {
                    arguments[1].toZigString(&hint_string, globalThis);
                }
            },
        }

        var hint = hint_string.toSlice(default_allocator);
        defer hint.deinit();

        const value: JSValue = this.getValue(globalThis, thisValue, "toMatchSnapshot", "<green>properties<r><d>, <r>hint") orelse return .zero;

        if (!value.isObject() and property_matchers != null) {
            const signature = comptime getSignature("toMatchSnapshot", "<green>properties<r><d>, <r>hint", false);
            this.throw(globalThis, signature, "\n\n<b>Matcher error: <red>received<r> values must be an object when the matcher has <green>properties<r>\n", .{});
            return .zero;
        }

        if (property_matchers) |_prop_matchers| {
            const prop_matchers = _prop_matchers;

            if (!value.jestDeepMatch(prop_matchers, globalThis, true)) {
                // TODO: print diff with properties from propertyMatchers
                const signature = comptime getSignature("toMatchSnapshot", "<green>propertyMatchers<r>", false);
                const fmt = signature ++ "\n\nExpected <green>propertyMatchers<r> to match properties from received object" ++
                    "\n\nReceived: {any}\n";

                var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis };
                globalThis.throwPretty(fmt, .{value.toFmt(globalThis, &formatter)});
                return .zero;
            }
        }

        const result = Jest.runner.?.snapshots.getOrPut(this, value, hint.slice(), globalThis) catch |err| {
            var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis };
            const test_file_path = Jest.runner.?.files.get(this.testScope().?.describe.file_id).source.path.text;
            switch (err) {
                error.FailedToOpenSnapshotFile => globalThis.throw("Failed to open snapshot file for test file: {s}", .{test_file_path}),
                error.FailedToMakeSnapshotDirectory => globalThis.throw("Failed to make snapshot directory for test file: {s}", .{test_file_path}),
                error.FailedToWriteSnapshotFile => globalThis.throw("Failed write to snapshot file: {s}", .{test_file_path}),
                error.ParseError => globalThis.throw("Failed to parse snapshot file for: {s}", .{test_file_path}),
                else => globalThis.throw("Failed to snapshot value: {any}", .{value.toFmt(globalThis, &formatter)}),
            }
            return .zero;
        };

        if (result) |saved_value| {
            var pretty_value: MutableString = MutableString.init(default_allocator, 0) catch unreachable;
            value.jestSnapshotPrettyFormat(&pretty_value, globalThis) catch {
                var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis };
                globalThis.throw("Failed to pretty format value: {s}", .{value.toFmt(globalThis, &formatter)});
                return .zero;
            };
            defer pretty_value.deinit();

            if (strings.eqlLong(pretty_value.toOwnedSliceLeaky(), saved_value, true)) {
                Jest.runner.?.snapshots.passed += 1;
                return .undefined;
            }

            Jest.runner.?.snapshots.failed += 1;
            const signature = comptime getSignature("toMatchSnapshot", "<green>expected<r>", false);
            const fmt = signature ++ "\n\n{any}\n";
            const diff_format = DiffFormatter{
                .received_string = pretty_value.toOwnedSliceLeaky(),
                .expected_string = saved_value,
                .globalThis = globalThis,
            };

            globalThis.throwPretty(fmt, .{diff_format});
            return .zero;
        }

        return .undefined;
    }

    pub fn toBeEmpty(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeEmpty", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = false;
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };

        const actual_length = value.getLengthIfPropertyExistsInternal(globalThis);

        if (actual_length == std.math.inf(f64)) {
            if (value.jsTypeLoose().isObject()) {
                if (value.isIterable(globalThis)) {
                    var any_properties_in_iterator = false;
                    value.forEach(globalThis, &any_properties_in_iterator, struct {
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
                    }).init(globalThis, value);
                    defer props_iter.deinit();
                    pass = props_iter.len == 0;
                }
            } else {
                const signature = comptime getSignature("toBeEmpty", "", false);
                const fmt = signature ++ "\n\nExpected value to be a string, object, or iterable" ++
                    "\n\nReceived: <red>{any}<r>\n";
                globalThis.throwPretty(fmt, .{value.toFmt(globalThis, &formatter)});
                return .zero;
            }
        } else if (std.math.isNan(actual_length)) {
            globalThis.throw("Received value has non-number length property: {}", .{actual_length});
            return .zero;
        } else {
            pass = actual_length == 0;
        }

        if (not and pass) {
            const signature = comptime getSignature("toBeEmpty", "", true);
            const fmt = signature ++ "\n\nExpected value <b>not<r> to be a string, object, or iterable" ++
                "\n\nReceived: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{value.toFmt(globalThis, &formatter)});
            return .zero;
        }

        if (not) pass = !pass;
        if (pass) return .undefined;

        if (not) {
            const signature = comptime getSignature("toBeEmpty", "", true);
            const fmt = signature ++ "\n\nExpected value <b>not<r> to be empty" ++
                "\n\nReceived: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{value.toFmt(globalThis, &formatter)});
            return .zero;
        }

        const signature = comptime getSignature("toBeEmpty", "", false);
        const fmt = signature ++ "\n\nExpected value to be empty" ++
            "\n\nReceived: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{value.toFmt(globalThis, &formatter)});
        return .zero;
    }

    pub fn toBeEmptyObject(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeEmptyObject", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = value.isObjectEmpty(globalThis);

        if (not) pass = !pass;
        if (pass) return thisValue;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeEmptyObject", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeEmptyObject", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
        return .zero;
    }

    pub fn toBeNil(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeNil", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.isUndefinedOrNull() != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeNil", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeNil", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
        return .zero;
    }

    pub fn toBeArray(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeArray", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.jsType().isArray() != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeArray", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeArray", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
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

        const size = arguments[0];
        size.ensureStillAlive();

        if (!size.isAnyInt()) {
            globalThis.throw("toBeArrayOfSize() requires the first argument to be a number", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = value.jsType().isArray() and @as(i32, @intCast(value.getLength(globalThis))) == size.toInt32();

        if (not) pass = !pass;
        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeArrayOfSize", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeArrayOfSize", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
        return .zero;
    }

    pub fn toBeBoolean(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeBoolean", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.isBoolean() != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeBoolean", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeBoolean", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
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

        const value: JSValue = this.getValue(globalThis, thisValue, "toBeTypeOf", "") orelse return .zero;

        const expected = arguments[0];
        expected.ensureStillAlive();

        if (!expected.isString()) {
            globalThis.throwInvalidArguments("toBeTypeOf() requires a string argument", .{});
            return .zero;
        }

        const expected_type = expected.toBunString(globalThis);
        defer expected_type.deref();
        incrementExpectCallCounter();

        const typeof = expected_type.inMap(JSTypeOfMap) orelse {
            globalThis.throwInvalidArguments("toBeTypeOf() requires a valid type string argument ('function', 'object', 'bigint', 'boolean', 'number', 'string', 'symbol', 'undefined')", .{});
            return .zero;
        };

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

        pass = strings.eql(typeof, whatIsTheType);

        if (not) pass = !pass;
        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);
        const expected_str = expected.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeTypeOf", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Expected type: not <green>{any}<r>\n" ++ "Received type: <red>\"{s}\"<r>\nReceived value: <red>{any}<r>\n", .{ expected_str, whatIsTheType, received });
            return .zero;
        }

        const signature = comptime getSignature("toBeTypeOf", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Expected type: <green>{any}<r>\n" ++ "Received type: <red>\"{s}\"<r>\nReceived value: <red>{any}<r>\n", .{ expected_str, whatIsTheType, received });
        return .zero;
    }

    pub fn toBeTrue(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeTrue", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = (value.isBoolean() and value.toBoolean()) != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeTrue", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeTrue", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
        return .zero;
    }

    pub fn toBeFalse(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeFalse", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = (value.isBoolean() and !value.toBoolean()) != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeFalse", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeFalse", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
        return .zero;
    }

    pub fn toBeNumber(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeNumber", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.isNumber() != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeNumber", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeNumber", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
        return .zero;
    }

    pub fn toBeInteger(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeInteger", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.isAnyInt() != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeInteger", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeInteger", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
        return .zero;
    }

    pub fn toBeObject(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeObject", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.isObject() != not;

        if (pass) return thisValue;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeObject", "", true);
            this.throw(globalThis, signature, "\n\nExpected value <b>not<r> to be an object" ++ "\n\nReceived: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeObject", "", false);
        this.throw(globalThis, signature, "\n\nExpected value to be an object" ++ "\n\nReceived: <red>{any}<r>\n", .{received});
        return .zero;
    }

    pub fn toBeFinite(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeFinite", "") orelse return .zero;

        incrementExpectCallCounter();

        var pass = value.isNumber();
        if (pass) {
            const num: f64 = value.asNumber();
            pass = std.math.isFinite(num) and !std.math.isNan(num);
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeFinite", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeFinite", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
        return .zero;
    }

    pub fn toBePositive(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBePositive", "") orelse return .zero;

        incrementExpectCallCounter();

        var pass = value.isNumber();
        if (pass) {
            const num: f64 = value.asNumber();
            pass = @round(num) > 0 and !std.math.isInf(num) and !std.math.isNan(num);
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBePositive", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBePositive", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
        return .zero;
    }

    pub fn toBeNegative(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeNegative", "") orelse return .zero;

        incrementExpectCallCounter();

        var pass = value.isNumber();
        if (pass) {
            const num: f64 = value.asNumber();
            pass = @round(num) < 0 and !std.math.isInf(num) and !std.math.isNan(num);
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeNegative", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeNegative", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
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

        incrementExpectCallCounter();

        var pass = value.isNumber();
        if (pass) {
            const num = value.asNumber();
            pass = num >= startValue.asNumber() and num < endValue.asNumber();
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const start_fmt = startValue.toFmt(globalThis, &formatter);
        const end_fmt = endValue.toFmt(globalThis, &formatter);
        const received_fmt = value.toFmt(globalThis, &formatter);

        if (not) {
            const expected_line = "Expected: not between <green>{any}<r> <d>(inclusive)<r> and <green>{any}<r> <d>(exclusive)<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeWithin", "<green>start<r><d>, <r><green>end<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ start_fmt, end_fmt, received_fmt });
            return .zero;
        }

        const expected_line = "Expected: between <green>{any}<r> <d>(inclusive)<r> and <green>{any}<r> <d>(exclusive)<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeWithin", "<green>start<r><d>, <r><green>end<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ start_fmt, end_fmt, received_fmt });
        return .zero;
    }

    pub fn toEqualIgnoringWhitespace(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toEqualIgnoringWhitespace() requires 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = arguments[0];
        const value: JSValue = this.getValue(globalThis, thisValue, "toEqualIgnoringWhitespace", "<green>expected<r>") orelse return .zero;

        if (!expected.isString()) {
            globalThis.throw("toEqualIgnoringWhitespace() requires argument to be a string", .{});
            return .zero;
        }

        const not = this.flags.not;
        var pass = value.isString() and expected.isString();

        if (pass) {
            const value_slice = value.toSlice(globalThis, default_allocator);
            defer value_slice.deinit();
            const expected_slice = expected.toSlice(globalThis, default_allocator);
            defer expected_slice.deinit();

            const value_utf8 = value_slice.slice();
            const expected_utf8 = expected_slice.slice();

            var left: usize = 0;
            var right: usize = 0;

            // Skip leading whitespaces
            while (left < value_utf8.len and std.ascii.isWhitespace(value_utf8[left])) left += 1;
            while (right < expected_utf8.len and std.ascii.isWhitespace(expected_utf8[right])) right += 1;

            while (left < value_utf8.len and right < expected_utf8.len) {
                const left_char = value_utf8[left];
                const right_char = expected_utf8[right];

                if (left_char != right_char) {
                    pass = false;
                    break;
                }

                left += 1;
                right += 1;

                // Skip trailing whitespaces
                while (left < value_utf8.len and std.ascii.isWhitespace(value_utf8[left])) left += 1;
                while (right < expected_utf8.len and std.ascii.isWhitespace(expected_utf8[right])) right += 1;
            }

            if (left < value_utf8.len or right < expected_utf8.len) {
                pass = false;
            }
        }

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const expected_fmt = expected.toFmt(globalThis, &formatter);
        const value_fmt = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toEqualIgnoringWhitespace", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ "Expected: not <green>{any}<r>\n" ++ "Received: <red>{any}<r>\n", .{ expected_fmt, value_fmt });
            return .zero;
        }

        const signature = comptime getSignature("toEqualIgnoringWhitespace", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ "Expected: <green>{any}<r>\n" ++ "Received: <red>{any}<r>\n", .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toBeSymbol(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeSymbol", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.isSymbol() != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeSymbol", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeSymbol", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
        return .zero;
    }

    pub fn toBeFunction(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeFunction", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.isCallable(globalThis.vm()) != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeFunction", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeFunction", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
        return .zero;
    }

    pub fn toBeDate(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeDate", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.isDate() != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeDate", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeDate", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
        return .zero;
    }

    pub fn toBeValidDate(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeValidDate", "") orelse return .zero;

        active_test_expectation_counter.actual += 1;

        const not = this.flags.not;
        var pass = (value.isDate() and !std.math.isNan(value.getUnixTimestamp()));
        if (not) pass = !pass;

        if (pass) return thisValue;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeValidDate", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeValidDate", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
        return .zero;
    }

    pub fn toBeString(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalThis, thisValue, "toBeString", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.isString() != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received = value.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toBeString", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
            return .zero;
        }

        const signature = comptime getSignature("toBeString", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>\n", .{received});
        return .zero;
    }

    pub fn toInclude(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

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

        incrementExpectCallCounter();

        var pass = value.isString();
        if (pass) {
            const value_string = value.toSliceOrNull(globalThis) orelse return .zero;
            defer value_string.deinit();
            const expected_string = expected.toSliceOrNull(globalThis) orelse return .zero;
            defer expected_string.deinit();
            pass = strings.contains(value_string.slice(), expected_string.slice()) or expected_string.len == 0;
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = expected.toFmt(globalThis, &formatter);

        if (not) {
            const expected_line = "Expected to not include: <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toInclude", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected to include: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toInclude", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toIncludeRepeated(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(2);
        const arguments = arguments_.slice();

        if (arguments.len < 2) {
            globalThis.throwInvalidArguments("toIncludeRepeated() requires 2 arguments", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const substring = arguments[0];
        substring.ensureStillAlive();

        if (!substring.isString()) {
            globalThis.throw("toIncludeRepeated() requires the first argument to be a string", .{});
            return .zero;
        }

        const count = arguments[1];
        count.ensureStillAlive();

        if (!count.isAnyInt()) {
            globalThis.throw("toIncludeRepeated() requires the second argument to be a number", .{});
            return .zero;
        }

        const countAsNum = count.toU32();

        const expect_string = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };

        if (!expect_string.isString()) {
            globalThis.throw("toIncludeRepeated() requires the expect(value) to be a string", .{});
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;

        const _expectStringAsStr = expect_string.toSliceOrNull(globalThis) orelse return .zero;
        const _subStringAsStr = substring.toSliceOrNull(globalThis) orelse return .zero;

        defer {
            _expectStringAsStr.deinit();
            _subStringAsStr.deinit();
        }

        const expectStringAsStr = _expectStringAsStr.slice();
        const subStringAsStr = _subStringAsStr.slice();

        if (subStringAsStr.len == 0) {
            globalThis.throw("toIncludeRepeated() requires the first argument to be a non-empty string", .{});
            return .zero;
        }

        if (countAsNum == 0)
            pass = !strings.contains(expectStringAsStr, subStringAsStr)
        else
            pass = std.mem.containsAtLeast(u8, expectStringAsStr, countAsNum, subStringAsStr);

        if (not) pass = !pass;
        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const expect_string_fmt = expect_string.toFmt(globalThis, &formatter);
        const substring_fmt = substring.toFmt(globalThis, &formatter);
        const times_fmt = count.toFmt(globalThis, &formatter);

        const received_line = "Received: <red>{any}<r>\n";

        if (not) {
            if (countAsNum == 0) {
                const expected_line = "Expected to include: <green>{any}<r> \n";
                const signature = comptime getSignature("toIncludeRepeated", "<green>expected<r>", true);
                this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ substring_fmt, expect_string_fmt });
            } else if (countAsNum == 1) {
                const expected_line = "Expected not to include: <green>{any}<r> \n";
                const signature = comptime getSignature("toIncludeRepeated", "<green>expected<r>", true);
                this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ substring_fmt, expect_string_fmt });
            } else {
                const expected_line = "Expected not to include: <green>{any}<r> <green>{any}<r> times \n";
                const signature = comptime getSignature("toIncludeRepeated", "<green>expected<r>", true);
                this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ substring_fmt, times_fmt, expect_string_fmt });
            }

            return .zero;
        }

        if (countAsNum == 0) {
            const expected_line = "Expected to not include: <green>{any}<r>\n";
            const signature = comptime getSignature("toIncludeRepeated", "<green>expected<r>", false);
            this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ substring_fmt, expect_string_fmt });
        } else if (countAsNum == 1) {
            const expected_line = "Expected to include: <green>{any}<r>\n";
            const signature = comptime getSignature("toIncludeRepeated", "<green>expected<r>", false);
            this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ substring_fmt, expect_string_fmt });
        } else {
            const expected_line = "Expected to include: <green>{any}<r> <green>{any}<r> times \n";
            const signature = comptime getSignature("toIncludeRepeated", "<green>expected<r>", false);
            this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ substring_fmt, times_fmt, expect_string_fmt });
        }

        return .zero;
    }

    pub fn toSatisfy(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toSatisfy() requires 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const predicate = arguments[0];
        predicate.ensureStillAlive();

        if (!predicate.isCallable(globalThis.vm())) {
            globalThis.throw("toSatisfy() argument must be a function", .{});
            return .zero;
        }

        const value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the expect(value) was garbage collected but it should not have been!", .{});
            return .zero;
        };
        value.ensureStillAlive();

        const result = predicate.call(globalThis, &.{value});

        if (result.toError()) |err| {
            var errors: [1]*anyopaque = undefined;
            var _err = errors[0..errors.len];

            _err[0] = err.asVoid();

            const fmt = ZigString.init("toSatisfy() predicate threw an exception");
            globalThis.vm().throwError(globalThis, globalThis.createAggregateError(_err.ptr, _err.len, &fmt));
            return .zero;
        }

        const not = this.flags.not;
        const pass = (result.isBoolean() and result.toBoolean()) != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };

        if (not) {
            const signature = comptime getSignature("toSatisfy", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\nExpected: not <green>{any}<r>\n", .{predicate.toFmt(globalThis, &formatter)});
            return .zero;
        }

        const signature = comptime getSignature("toSatisfy", "<green>expected<r>", false);

        this.throw(globalThis, signature, "\n\nExpected: <green>{any}<r>\nReceived: <red>{any}<r>\n", .{
            predicate.toFmt(globalThis, &formatter),
            value.toFmt(globalThis, &formatter),
        });

        return .zero;
    }

    pub fn toStartWith(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

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

        incrementExpectCallCounter();

        var pass = value.isString();
        if (pass) {
            const value_string = value.toSliceOrNull(globalThis) orelse return .zero;
            defer value_string.deinit();
            const expected_string = expected.toSliceOrNull(globalThis) orelse return .zero;
            defer expected_string.deinit();
            pass = strings.startsWith(value_string.slice(), expected_string.slice()) or expected_string.len == 0;
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = expected.toFmt(globalThis, &formatter);

        if (not) {
            const expected_line = "Expected to not start with: <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toStartWith", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected to start with: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toStartWith", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toEndWith(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

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

        incrementExpectCallCounter();

        var pass = value.isString();
        if (pass) {
            const value_string = value.toSliceOrNull(globalThis) orelse return .zero;
            defer value_string.deinit();
            const expected_string = expected.toSliceOrNull(globalThis) orelse return .zero;
            defer expected_string.deinit();
            pass = strings.endsWith(value_string.slice(), expected_string.slice()) or expected_string.len == 0;
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const value_fmt = value.toFmt(globalThis, &formatter);
        const expected_fmt = expected.toFmt(globalThis, &formatter);

        if (not) {
            const expected_line = "Expected to not end with: <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toEndWith", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected to end with: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toEndWith", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toBeInstanceOf(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toBeInstanceOf() requires 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };

        const expected_value = arguments[0];
        if (!expected_value.isConstructor()) {
            globalThis.throw("Expected value must be a function: {any}", .{expected_value.toFmt(globalThis, &formatter)});
            return .zero;
        }
        expected_value.ensureStillAlive();

        const value: JSValue = this.getValue(globalThis, thisValue, "toBeInstanceOf", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = value.isInstanceOf(globalThis, expected_value);
        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        const expected_fmt = expected_value.toFmt(globalThis, &formatter);
        const value_fmt = value.toFmt(globalThis, &formatter);
        if (not) {
            const expected_line = "Expected constructor: not <green>{any}<r>\n";
            const received_line = "Received value: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeInstanceOf", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected constructor: <green>{any}<r>\n";
        const received_line = "Received value: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeInstanceOf", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toMatch(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        JSC.markBinding(@src());

        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("toMatch() requires 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };

        const expected_value = arguments[0];
        if (!expected_value.isString() and !expected_value.isRegExp()) {
            globalThis.throw("Expected value must be a string or regular expression: {any}", .{expected_value.toFmt(globalThis, &formatter)});
            return .zero;
        }
        expected_value.ensureStillAlive();

        const value: JSValue = this.getValue(globalThis, thisValue, "toMatch", "<green>expected<r>") orelse return .zero;

        if (!value.isString()) {
            globalThis.throw("Received value must be a string: {any}", .{value.toFmt(globalThis, &formatter)});
            return .zero;
        }

        const not = this.flags.not;
        var pass: bool = brk: {
            if (expected_value.isString()) {
                break :brk value.stringIncludes(globalThis, expected_value);
            } else if (expected_value.isRegExp()) {
                break :brk expected_value.toMatch(globalThis, value);
            }
            unreachable;
        };

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        const expected_fmt = expected_value.toFmt(globalThis, &formatter);
        const value_fmt = value.toFmt(globalThis, &formatter);

        if (not) {
            const expected_line = "Expected substring or pattern: not <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toMatch", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const expected_line = "Expected substring or pattern: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toMatch", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toHaveBeenCalled(this: *Expect, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());
        const thisValue = callframe.this();
        defer this.postMatch(globalThis);

        const value: JSValue = this.getValue(globalThis, thisValue, "toHaveBeenCalled", "") orelse return .zero;

        const calls = JSMockFunction__getCalls(value);
        incrementExpectCallCounter();

        if (calls == .zero or !calls.jsType().isArray()) {
            globalThis.throw("Expected value must be a mock function: {}", .{value});
            return .zero;
        }

        var pass = calls.getLength(globalThis) > 0;

        const not = this.flags.not;
        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        if (not) {
            const signature = comptime getSignature("toHaveBeenCalled", "", true);
            this.throw(globalThis, signature, "\n\n" ++ "Expected number of calls: <green>0<r>\n" ++ "Received number of calls: <red>{any}<r>\n", .{calls.getLength(globalThis)});
            return .zero;
        }

        const signature = comptime getSignature("toHaveBeenCalled", "", false);
        this.throw(globalThis, signature, "\n\n" ++ "Expected number of calls: \\>= <green>1<r>\n" ++ "Received number of calls: <red>{any}<r>\n", .{calls.getLength(globalThis)});
        return .zero;
    }

    pub fn toHaveBeenCalledTimes(this: *Expect, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        const thisValue = callframe.this();
        const arguments_ = callframe.arguments(1);
        const arguments: []const JSValue = arguments_.slice();
        defer this.postMatch(globalThis);
        const value: JSValue = this.getValue(globalThis, thisValue, "toHaveBeenCalledTimes", "<green>expected<r>") orelse return .zero;

        incrementExpectCallCounter();

        const calls = JSMockFunction__getCalls(value);

        if (calls == .zero or !calls.jsType().isArray()) {
            globalThis.throw("Expected value must be a mock function: {}", .{value});
            return .zero;
        }

        if (arguments.len < 1 or !arguments[0].isUInt32AsAnyInt()) {
            globalThis.throwInvalidArguments("toHaveBeenCalledTimes() requires 1 non-negative integer argument", .{});
            return .zero;
        }

        const times = arguments[0].coerce(i32, globalThis);

        var pass = @as(i32, @intCast(calls.getLength(globalThis))) == times;

        const not = this.flags.not;
        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        if (not) {
            const signature = comptime getSignature("toHaveBeenCalledTimes", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ "Expected number of calls: not <green>{any}<r>\n" ++ "Received number of calls: <red>{any}<r>\n", .{ times, calls.getLength(globalThis) });
            return .zero;
        }

        const signature = comptime getSignature("toHaveBeenCalledTimes", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ "Expected number of calls: <green>{any}<r>\n" ++ "Received number of calls: <red>{any}<r>\n", .{ times, calls.getLength(globalThis) });
        return .zero;
    }

    pub fn toMatchObject(this: *Expect, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        JSC.markBinding(@src());

        defer this.postMatch(globalThis);
        const thisValue = callFrame.this();
        const args = callFrame.arguments(1).slice();

        incrementExpectCallCounter();

        const not = this.flags.not;

        const received_object: JSValue = this.getValue(globalThis, thisValue, "toMatchObject", "<green>expected<r>") orelse return .zero;

        if (!received_object.isObject()) {
            const matcher_error = "\n\n<b>Matcher error<r>: <red>received<r> value must be a non-null object\n";
            if (not) {
                const signature = comptime getSignature("toMatchObject", "<green>expected<r>", true);
                this.throw(globalThis, signature, matcher_error, .{});
                return .zero;
            }

            const signature = comptime getSignature("toMatchObject", "<green>expected<r>", false);
            this.throw(globalThis, signature, matcher_error, .{});
            return .zero;
        }

        if (args.len < 1 or !args[0].isObject()) {
            const matcher_error = "\n\n<b>Matcher error<r>: <green>expected<r> value must be a non-null object\n";
            if (not) {
                const signature = comptime getSignature("toMatchObject", "", true);
                this.throw(globalThis, signature, matcher_error, .{});
                return .zero;
            }
            const signature = comptime getSignature("toMatchObject", "", false);
            this.throw(globalThis, signature, matcher_error, .{});
            return .zero;
        }

        const property_matchers = args[0];

        var pass = received_object.jestDeepMatch(property_matchers, globalThis, true);

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        const diff_formatter = DiffFormatter{
            .received = received_object,
            .expected = property_matchers,
            .globalThis = globalThis,
            .not = not,
        };

        if (not) {
            const signature = comptime getSignature("toMatchObject", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n{any}\n", .{diff_formatter});
            return .zero;
        }

        const signature = comptime getSignature("toMatchObject", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n{any}\n", .{diff_formatter});
        return .zero;
    }

    pub fn toHaveBeenCalledWith(this: *Expect, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        const thisValue = callframe.this();
        const arguments = callframe.argumentsPtr()[0..callframe.argumentsCount()];
        defer this.postMatch(globalThis);
        const value: JSValue = this.getValue(globalThis, thisValue, "toHaveBeenCalledWith", "<green>expected<r>") orelse return .zero;

        incrementExpectCallCounter();

        const calls = JSMockFunction__getCalls(value);

        if (calls == .zero or !calls.jsType().isArray()) {
            globalThis.throw("Expected value must be a mock function: {}", .{value});
            return .zero;
        }

        var pass = false;

        if (calls.getLength(globalThis) > 0) {
            var itr = calls.arrayIterator(globalThis);
            while (itr.next()) |callItem| {
                if (callItem == .zero or !callItem.jsType().isArray()) {
                    globalThis.throw("Expected value must be a mock function with calls: {}", .{value});
                    return .zero;
                }

                if (callItem.getLength(globalThis) != arguments.len) {
                    continue;
                }

                var callItr = callItem.arrayIterator(globalThis);
                var match = true;
                while (callItr.next()) |callArg| {
                    if (!callArg.jestDeepEquals(arguments[callItr.i - 1], globalThis)) {
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

        const not = this.flags.not;
        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        if (not) {
            const signature = comptime getSignature("toHaveBeenCalledWith", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ "Number of calls: <red>{any}<r>\n", .{calls.getLength(globalThis)});
            return .zero;
        }

        const signature = comptime getSignature("toHaveBeenCalledWith", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ "Number of calls: <red>{any}<r>\n", .{calls.getLength(globalThis)});
        return .zero;
    }

    pub fn toHaveBeenLastCalledWith(this: *Expect, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        const thisValue = callframe.this();
        const arguments = callframe.argumentsPtr()[0..callframe.argumentsCount()];
        defer this.postMatch(globalThis);
        const value: JSValue = this.getValue(globalThis, thisValue, "toHaveBeenLastCalledWith", "<green>expected<r>") orelse return .zero;

        incrementExpectCallCounter();

        const calls = JSMockFunction__getCalls(value);

        if (calls == .zero or !calls.jsType().isArray()) {
            globalThis.throw("Expected value must be a mock function: {}", .{value});
            return .zero;
        }

        const totalCalls = @as(u32, @intCast(calls.getLength(globalThis)));
        var lastCallValue: JSValue = .zero;

        var pass = totalCalls > 0;

        if (pass) {
            lastCallValue = calls.getIndex(globalThis, totalCalls - 1);

            if (lastCallValue == .zero or !lastCallValue.jsType().isArray()) {
                globalThis.throw("Expected value must be a mock function with calls: {}", .{value});
                return .zero;
            }

            if (lastCallValue.getLength(globalThis) != arguments.len) {
                pass = false;
            } else {
                var itr = lastCallValue.arrayIterator(globalThis);
                while (itr.next()) |callArg| {
                    if (!callArg.jestDeepEquals(arguments[itr.i - 1], globalThis)) {
                        pass = false;
                        break;
                    }
                }
            }
        }

        const not = this.flags.not;
        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received_fmt = lastCallValue.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toHaveBeenLastCalledWith", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>" ++ "\n\n" ++ "Number of calls: <red>{any}<r>\n", .{ received_fmt, totalCalls });
            return .zero;
        }

        const signature = comptime getSignature("toHaveBeenLastCalledWith", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ "Received: <red>{any}<r>" ++ "\n\n" ++ "Number of calls: <red>{any}<r>\n", .{ received_fmt, totalCalls });
        return .zero;
    }

    pub fn toHaveBeenNthCalledWith(this: *Expect, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        const thisValue = callframe.this();
        const arguments = callframe.argumentsPtr()[0..callframe.argumentsCount()];
        defer this.postMatch(globalThis);
        const value: JSValue = this.getValue(globalThis, thisValue, "toHaveBeenNthCalledWith", "<green>expected<r>") orelse return .zero;

        incrementExpectCallCounter();

        const calls = JSMockFunction__getCalls(value);

        if (calls == .zero or !calls.jsType().isArray()) {
            globalThis.throw("Expected value must be a mock function: {}", .{value});
            return .zero;
        }

        const nthCallNum = if (arguments.len > 0 and arguments[0].isUInt32AsAnyInt()) arguments[0].coerce(i32, globalThis) else 0;
        if (nthCallNum < 1) {
            globalThis.throwInvalidArguments("toHaveBeenNthCalledWith() requires a positive integer argument", .{});
            return .zero;
        }

        const totalCalls = calls.getLength(globalThis);
        var nthCallValue: JSValue = .zero;

        var pass = totalCalls >= nthCallNum;

        if (pass) {
            nthCallValue = calls.getIndex(globalThis, @as(u32, @intCast(nthCallNum)) - 1);

            if (nthCallValue == .zero or !nthCallValue.jsType().isArray()) {
                globalThis.throw("Expected value must be a mock function with calls: {}", .{value});
                return .zero;
            }

            if (nthCallValue.getLength(globalThis) != (arguments.len - 1)) {
                pass = false;
            } else {
                var itr = nthCallValue.arrayIterator(globalThis);
                while (itr.next()) |callArg| {
                    if (!callArg.jestDeepEquals(arguments[itr.i], globalThis)) {
                        pass = false;
                        break;
                    }
                }
            }
        }

        const not = this.flags.not;
        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        const received_fmt = nthCallValue.toFmt(globalThis, &formatter);

        if (not) {
            const signature = comptime getSignature("toHaveBeenNthCalledWith", "<green>expected<r>", true);
            this.throw(globalThis, signature, "\n\n" ++ "n: {any}\n" ++ "Received: <red>{any}<r>" ++ "\n\n" ++ "Number of calls: <red>{any}<r>\n", .{ nthCallNum, received_fmt, totalCalls });
            return .zero;
        }

        const signature = comptime getSignature("toHaveBeenNthCalledWith", "<green>expected<r>", false);
        this.throw(globalThis, signature, "\n\n" ++ "n: {any}\n" ++ "Received: <red>{any}<r>" ++ "\n\n" ++ "Number of calls: <red>{any}<r>\n", .{ nthCallNum, received_fmt, totalCalls });
        return .zero;
    }

    const ReturnStatus = enum {
        throw,
        @"return",
        incomplete,

        pub const Map = bun.ComptimeEnumMap(ReturnStatus);
    };

    inline fn toHaveReturnedTimesFn(this: *Expect, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame, comptime known_index: ?i32) JSC.JSValue {
        JSC.markBinding(@src());

        const thisValue = callframe.this();
        const arguments = callframe.arguments(1).slice();
        defer this.postMatch(globalThis);

        const name = comptime if (known_index != null and known_index.? == 0) "toHaveReturned" else "toHaveReturnedTimes";

        const value: JSValue = this.getValue(globalThis, thisValue, name, if (known_index != null and known_index.? == 0) "" else "<green>expected<r>") orelse return .zero;

        incrementExpectCallCounter();

        const returns = JSMockFunction__getReturns(value);

        if (returns == .zero or !returns.jsType().isArray()) {
            globalThis.throw("Expected value must be a mock function: {}", .{value});
            return .zero;
        }

        const return_count: i32 = if (known_index) |index| index else brk: {
            if (arguments.len < 1 or !arguments[0].isUInt32AsAnyInt()) {
                globalThis.throwInvalidArguments(name ++ "() requires 1 non-negative integer argument", .{});
                return .zero;
            }

            break :brk arguments[0].coerce(i32, globalThis);
        };

        var pass = false;
        const index: u32 = @as(u32, @intCast(return_count)) -| 1;

        const times_value = returns.getDirectIndex(
            globalThis,
            index,
        );

        const total_count = returns.getLength(globalThis);

        const return_status: ReturnStatus = brk: {
            // Returns is an array of:
            //
            //  { type: "throw" | "incomplete" | "return", value: any}
            //
            if (total_count >= return_count and times_value.isCell()) {
                if (times_value.get(globalThis, "type")) |type_string| {
                    if (type_string.isString()) {
                        break :brk ReturnStatus.Map.fromJS(globalThis, type_string) orelse {
                            if (!globalThis.hasException())
                                globalThis.throw("Expected value must be a mock function with returns: {}", .{value});
                            return .zero;
                        };
                    }
                }
            }

            break :brk ReturnStatus.incomplete;
        };
        if (globalThis.hasException())
            return .zero;

        pass = return_status == ReturnStatus.@"return";

        const not = this.flags.not;
        if (not) pass = !pass;
        if (pass) return .undefined;

        if (!pass and return_status == ReturnStatus.throw) {
            const signature = comptime getSignature(name, "<green>expected<r>", false);
            const fmt = signature ++ "\n\n" ++ "Function threw an exception\n{any}\n";
            var formatter = JSC.ConsoleObject.Formatter{
                .globalThis = globalThis,
                .quote_strings = true,
            };
            globalThis.throwPretty(fmt, .{times_value.get(globalThis, "value").?.toFmt(globalThis, &formatter)});
            return .zero;
        }

        switch (not) {
            inline else => |is_not| {
                const signature = comptime getSignature(name, "<green>expected<r>", is_not);
                this.throw(globalThis, signature, "\n\n" ++ "Expected number of successful calls: <green>{d}<r>\n" ++ "Received number of calls: <red>{d}<r>\n", .{ return_count, total_count });
                return .zero;
            },
        }
    }

    pub fn toHaveReturned(this: *Expect, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        return toHaveReturnedTimesFn(this, globalThis, callframe, 1);
    }

    pub fn toHaveReturnedTimes(this: *Expect, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        return toHaveReturnedTimesFn(this, globalThis, callframe, null);
    }

    pub const toHaveReturnedWith = notImplementedJSCFn;
    pub const toHaveLastReturnedWith = notImplementedJSCFn;
    pub const toHaveNthReturnedWith = notImplementedJSCFn;
    pub const toMatchInlineSnapshot = notImplementedJSCFn;
    pub const toThrowErrorMatchingSnapshot = notImplementedJSCFn;
    pub const toThrowErrorMatchingInlineSnapshot = notImplementedJSCFn;

    pub fn getStaticNot(globalThis: *JSGlobalObject, _: JSValue, _: JSValue) callconv(.C) JSValue {
        return ExpectStatic.create(globalThis, .{ .not = true });
    }

    pub fn getStaticResolvesTo(globalThis: *JSGlobalObject, _: JSValue, _: JSValue) callconv(.C) JSValue {
        return ExpectStatic.create(globalThis, .{ .promise = .resolves });
    }

    pub fn getStaticRejectsTo(globalThis: *JSGlobalObject, _: JSValue, _: JSValue) callconv(.C) JSValue {
        return ExpectStatic.create(globalThis, .{ .promise = .rejects });
    }

    pub fn any(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectAny.call(globalThis, callFrame);
    }

    pub fn anything(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectAnything.call(globalThis, callFrame);
    }

    pub fn closeTo(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectCloseTo.call(globalThis, callFrame);
    }

    pub fn objectContaining(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectObjectContaining.call(globalThis, callFrame);
    }

    pub fn stringContaining(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectStringContaining.call(globalThis, callFrame);
    }

    pub fn stringMatching(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectStringMatching.call(globalThis, callFrame);
    }

    pub fn arrayContaining(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectArrayContaining.call(globalThis, callFrame);
    }

    /// Implements `expect.extend({ ... })`
    pub fn extend(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(1).slice();

        if (args.len == 0 or !args[0].isObject()) {
            globalThis.throwPretty("<d>expect.<r>extend<d>(<r>matchers<d>)<r>\n\nExpected an object containing matchers\n", .{});
            return .zero;
        }

        var expect_proto = Expect__getPrototype(globalThis);
        var expect_constructor = Expect.getConstructor(globalThis);
        var expect_static_proto = ExpectStatic__getPrototype(globalThis);

        const matchers_to_register = args[0];
        {
            var iter = JSC.JSPropertyIterator(.{
                .skip_empty_name = false,
                .include_value = true,
            }).init(globalThis, matchers_to_register);
            defer iter.deinit();

            while (iter.next()) |*matcher_name| {
                const matcher_fn: JSValue = iter.value;

                if (!matcher_fn.jsType().isFunction()) {
                    const type_name = if (matcher_fn.isNull()) bun.String.static("null") else bun.String.init(matcher_fn.jsTypeString(globalThis).getZigString(globalThis));
                    globalThis.throwInvalidArguments("expect.extend: `{s}` is not a valid matcher. Must be a function, is \"{s}\"", .{ matcher_name, type_name });
                    return .zero;
                }

                // Mutate the Expect/ExpectStatic prototypes/constructor with new instances of JSCustomExpectMatcherFunction.
                // Even though they point to the same native functions for all matchers,
                // multiple instances are created because each instance will hold the matcher_fn as a property

                const wrapper_fn = Bun__JSWrappingFunction__create(globalThis, matcher_name, &Expect.applyCustomMatcher, matcher_fn, true);

                expect_proto.put(globalThis, matcher_name, wrapper_fn);
                expect_constructor.put(globalThis, matcher_name, wrapper_fn);
                expect_static_proto.put(globalThis, matcher_name, wrapper_fn);
            }
        }

        globalThis.bunVM().autoGarbageCollect();

        return .undefined;
    }

    const CustomMatcherParamsFormatter = struct {
        colors: bool,
        globalThis: *JSC.JSGlobalObject,
        matcher_fn: JSValue,

        pub fn format(this: CustomMatcherParamsFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            // try to detect param names from matcher_fn (user function) source code
            if (JSC.JSFunction.getSourceCode(this.matcher_fn)) |source_str| {
                var source_slice = source_str.toSlice(this.globalThis.allocator());
                defer source_slice.deinit();

                var source: string = source_slice.slice();
                if (std.mem.indexOfScalar(u8, source, '(')) |lparen| {
                    if (std.mem.indexOfScalarPos(u8, source, lparen, ')')) |rparen| {
                        const params_str = source[(lparen + 1)..rparen];
                        var param_index: usize = 0;
                        var iter = std.mem.splitScalar(u8, params_str, ',');
                        while (iter.next()) |param_name| : (param_index += 1) {
                            if (param_index > 0) { // skip the first param from the matcher_fn, which is the received value
                                if (param_index > 1) {
                                    try writer.writeAll(if (this.colors) Output.prettyFmt("<r><d>, <r><green>", true) else ", ");
                                } else if (this.colors) {
                                    try writer.writeAll("<green>");
                                }
                                const param_name_trimmed = std.mem.trim(u8, param_name, " ");
                                if (param_name_trimmed.len > 0) {
                                    try writer.writeAll(param_name_trimmed);
                                } else {
                                    try writer.print("arg{d}", .{param_index - 1});
                                }
                            }
                        }
                        if (param_index > 1 and this.colors) {
                            try writer.writeAll("<r>");
                        }
                        return; // don't do fallback
                    }
                }
            }

            // fallback
            switch (this.colors) {
                inline else => |colors| try writer.print(Output.prettyFmt("<green>...args<r>", colors), .{}),
            }
        }
    };

    fn throwInvalidMatcherError(globalThis: *JSC.JSGlobalObject, matcher_name: bun.String, result: JSValue) void {
        @setCold(true);

        var formatter = JSC.ConsoleObject.Formatter{
            .globalThis = globalThis,
            .quote_strings = true,
        };

        const fmt =
            "Unexpected return from matcher function `{s}`.\n" ++
            "Matcher functions should return an object in the following format:\n" ++
            "  {{message?: string | function, pass: boolean}}\n" ++
            "'{any}' was returned";
        const err = switch (Output.enable_ansi_colors) {
            inline else => |colors| globalThis.createErrorInstance(Output.prettyFmt(fmt, colors), .{ matcher_name, result.toFmt(globalThis, &formatter) }),
        };
        err.put(globalThis, ZigString.static("name"), ZigString.init("InvalidMatcherError").toValueGC(globalThis));
        globalThis.throwValue(err);
    }

    /// Execute the custom matcher for the given args (the left value + the args passed to the matcher call).
    /// This function is called both for symmetric and asymmetric matching.
    /// If silent=false, throws an exception in JS if the matcher result didn't result in a pass (or if the matcher result is invalid).
    pub fn executeCustomMatcher(globalThis: *JSC.JSGlobalObject, matcher_name: bun.String, matcher_fn: JSValue, args: []const JSValue, flags: Expect.Flags, silent: bool) bool {
        // prepare the this object
        const matcher_context = globalThis.bunVM().allocator.create(ExpectMatcherContext) catch {
            globalThis.throwOutOfMemory();
            return false;
        };
        matcher_context.flags = flags;
        const matcher_context_jsvalue = matcher_context.toJS(globalThis);
        matcher_context_jsvalue.ensureStillAlive();

        // call the custom matcher implementation
        var result = matcher_fn.callWithThis(globalThis, matcher_context_jsvalue, args);
        assert(!result.isEmpty());
        if (result.toError()) |err| {
            globalThis.throwValue(err);
            return false;
        }
        // support for async matcher results
        if (result.asAnyPromise()) |promise| {
            const vm = globalThis.vm();
            promise.setHandled(vm);

            globalThis.bunVM().waitForPromise(promise);

            result = promise.result(vm);
            result.ensureStillAlive();
            assert(!result.isEmpty());
            switch (promise.status(vm)) {
                .Pending => unreachable,
                .Fulfilled => {},
                .Rejected => {
                    // TODO: rewrite this code to use .then() instead of blocking the event loop
                    JSC.VirtualMachine.get().runErrorHandler(result, null);
                    globalThis.throw("Matcher `{s}` returned a promise that rejected", .{matcher_name});
                    return false;
                },
            }
        }

        var pass: bool = undefined;
        var message: JSValue = undefined;

        // Parse and validate the custom matcher result, which should conform to: { pass: boolean, message?: () => string }
        const is_valid = valid: {
            if (result.isObject()) {
                if (result.get(globalThis, "pass")) |pass_value| {
                    pass = pass_value.toBooleanSlow(globalThis);
                    if (globalThis.hasException()) return false;

                    if (result.get(globalThis, "message")) |message_value| {
                        if (!message_value.isString() and !message_value.isCallable(globalThis.vm())) {
                            break :valid false;
                        }
                        message = message_value;
                    } else {
                        message = JSValue.undefined;
                    }

                    break :valid true;
                }
            }
            break :valid false;
        };
        if (!is_valid) {
            throwInvalidMatcherError(globalThis, matcher_name, result);
            return false;
        }

        if (flags.not) pass = !pass;
        if (pass or silent) return pass;

        // handle failure
        var message_text: bun.String = bun.String.dead;
        defer message_text.deref();
        if (message.isUndefined()) {
            message_text = bun.String.static("No message was specified for this matcher.");
        } else if (message.isString()) {
            message_text = message.toBunString(globalThis);
        } else {
            if (comptime Environment.allow_assert)
                assert(message.isCallable(globalThis.vm())); // checked above

            var message_result = message.callWithGlobalThis(globalThis, &[_]JSValue{});
            assert(!message_result.isEmpty());
            if (message_result.toError()) |err| {
                globalThis.throwValue(err);
                return false;
            }
            if (bun.String.tryFromJS(message_result, globalThis)) |str| {
                message_text = str;
            } else {
                if (globalThis.hasException()) return false;
                var formatter = JSC.ConsoleObject.Formatter{
                    .globalThis = globalThis,
                    .quote_strings = true,
                };
                globalThis.throw(
                    "Expected custom matcher message to return a string, but got: {}",
                    .{message_result.toFmt(globalThis, &formatter)},
                );
                return false;
            }
        }

        const matcher_params = CustomMatcherParamsFormatter{
            .colors = Output.enable_ansi_colors,
            .globalThis = globalThis,
            .matcher_fn = matcher_fn,
        };
        throwPrettyMatcherError(globalThis, bun.String.empty, matcher_name, matcher_params, .{}, "{s}", .{message_text});
        return false;
    }

    /// Function that is run for either `expect.myMatcher()` call or `expect().myMatcher` call,
    /// and we can known which case it is based on if the `callFrame.this()` value is an instance of Expect
    pub fn applyCustomMatcher(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer globalThis.bunVM().autoGarbageCollect();

        // retrieve the user-provided matcher function (matcher_fn)
        const func: JSValue = callFrame.callee();
        var matcher_fn = getCustomMatcherFn(func, globalThis) orelse JSValue.undefined;
        if (!matcher_fn.jsType().isFunction()) {
            globalThis.throw("Internal consistency error: failed to retrieve the matcher function for a custom matcher!", .{});
            return .zero;
        }
        matcher_fn.ensureStillAlive();

        // try to retrieve the Expect instance
        const thisValue: JSValue = callFrame.this();
        const expect: *Expect = Expect.fromJS(thisValue) orelse {
            // if no Expect instance, assume it is a static call (`expect.myMatcher()`), so create an ExpectCustomAsymmetricMatcher instance
            return ExpectCustomAsymmetricMatcher.create(globalThis, callFrame, matcher_fn);
        };

        // if we got an Expect instance, then it's a non-static call (`expect().myMatcher`),
        // so now execute the symmetric matching

        // retrieve the matcher name
        const matcher_name = matcher_fn.getName(globalThis);

        const matcher_params = CustomMatcherParamsFormatter{
            .colors = Output.enable_ansi_colors,
            .globalThis = globalThis,
            .matcher_fn = matcher_fn,
        };

        // retrieve the captured expected value
        var value = Expect.capturedValueGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: failed to retrieve the captured value", .{});
            return .zero;
        };
        value = Expect.processPromise(expect.custom_label, expect.flags, globalThis, value, matcher_name, matcher_params, false) orelse return .zero;
        value.ensureStillAlive();

        incrementExpectCallCounter();

        // prepare the args array
        const args_ptr = callFrame.argumentsPtr();
        const args_count = callFrame.argumentsCount();
        var allocator = std.heap.stackFallback(8 * @sizeOf(JSValue), globalThis.allocator());
        var matcher_args = std.ArrayList(JSValue).initCapacity(allocator.get(), args_count + 1) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        matcher_args.appendAssumeCapacity(value);
        for (0..args_count) |i| matcher_args.appendAssumeCapacity(args_ptr[i]);

        // call the matcher, which will throw a js exception when failed
        if (!executeCustomMatcher(globalThis, matcher_name, matcher_fn, matcher_args.items, expect.flags, false) or globalThis.hasException()) {
            return .zero;
        }

        return thisValue;
    }

    pub const addSnapshotSerializer = notImplementedStaticFn;

    pub fn hasAssertions(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        _ = callFrame;
        defer globalThis.bunVM().autoGarbageCollect();

        is_expecting_assertions = true;

        return .undefined;
    }

    pub fn assertions(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer globalThis.bunVM().autoGarbageCollect();

        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            globalThis.throwInvalidArguments("expect.assertions() takes 1 argument", .{});
            return .zero;
        }

        const expected: JSValue = arguments[0];

        if (!expected.isNumber()) {
            var fmt = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            globalThis.throw("Expected value must be a non-negative integer: {any}", .{expected.toFmt(globalThis, &fmt)});
            return .zero;
        }

        const expected_assertions: f64 = expected.asNumber();
        if (@round(expected_assertions) != expected_assertions or std.math.isInf(expected_assertions) or std.math.isNan(expected_assertions) or expected_assertions < 0) {
            var fmt = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            globalThis.throw("Expected value must be a non-negative integer: {any}", .{expected.toFmt(globalThis, &fmt)});
            return .zero;
        }

        const unsigned_expected_assertions: u32 = @intFromFloat(expected_assertions);

        is_expecting_assertions_count = true;
        expected_assertions_number = unsigned_expected_assertions;

        return .undefined;
    }

    pub fn notImplementedJSCFn(_: *Expect, globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        globalThis.throw("Not implemented", .{});
        return .zero;
    }

    pub fn notImplementedStaticFn(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        globalThis.throw("Not implemented", .{});
        return .zero;
    }

    pub fn notImplementedJSCProp(_: *Expect, _: JSC.JSValue, globalThis: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        globalThis.throw("Not implemented", .{});
        return .zero;
    }

    pub fn notImplementedStaticProp(globalThis: *JSC.JSGlobalObject, _: JSC.JSValue, _: JSC.JSValue) callconv(.C) JSC.JSValue {
        globalThis.throw("Not implemented", .{});
        return .zero;
    }

    pub fn postMatch(_: *Expect, globalThis: *JSC.JSGlobalObject) void {
        var vm = globalThis.bunVM();
        vm.autoGarbageCollect();
    }

    pub fn doUnreachable(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arg = callframe.arguments(1).ptr[0];

        if (arg.isEmptyOrUndefinedOrNull()) {
            const error_value = bun.String.init("reached unreachable code").toErrorInstance(globalThis);
            error_value.put(globalThis, ZigString.static("name"), bun.String.init("UnreachableError").toJS(globalThis));
            globalThis.throwValue(error_value);
            return .zero;
        }

        if (arg.isString()) {
            const error_value = arg.toBunString(globalThis).toErrorInstance(globalThis);
            error_value.put(globalThis, ZigString.static("name"), bun.String.init("UnreachableError").toJS(globalThis));
            globalThis.throwValue(error_value);
            return .zero;
        }

        globalThis.throwValue(arg);
        return .zero;
    }
};

/// Static instance of expect, holding a set of flags.
/// Returned for example when executing `expect.not`
pub const ExpectStatic = struct {
    pub usingnamespace JSC.Codegen.JSExpectStatic;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectStatic,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn create(globalThis: *JSC.JSGlobalObject, flags: Expect.Flags) JSValue {
        var expect = globalThis.bunVM().allocator.create(ExpectStatic) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        expect.flags = flags;

        const value = expect.toJS(globalThis);
        value.ensureStillAlive();
        return value;
    }

    pub fn getNot(this: *ExpectStatic, _: JSValue, globalThis: *JSGlobalObject) callconv(.C) JSValue {
        var flags = this.flags;
        flags.not = !this.flags.not;
        return create(globalThis, flags);
    }

    pub fn getResolvesTo(this: *ExpectStatic, _: JSValue, globalThis: *JSGlobalObject) callconv(.C) JSValue {
        var flags = this.flags;
        if (flags.promise != .none) return asyncChainingError(globalThis, flags, "resolvesTo");
        flags.promise = .resolves;
        return create(globalThis, flags);
    }

    pub fn getRejectsTo(this: *ExpectStatic, _: JSValue, globalThis: *JSGlobalObject) callconv(.C) JSValue {
        var flags = this.flags;
        if (flags.promise != .none) return asyncChainingError(globalThis, flags, "rejectsTo");
        flags.promise = .rejects;
        return create(globalThis, flags);
    }

    fn asyncChainingError(globalThis: *JSGlobalObject, flags: Expect.Flags, name: string) JSValue {
        @setCold(true);
        const str = switch (flags.promise) {
            .resolves => "resolvesTo",
            .rejects => "rejectsTo",
            else => unreachable,
        };
        globalThis.throw("expect.{s}: already called expect.{s} on this chain", .{ name, str });
        return .zero;
    }

    fn createAsymmetricMatcherWithFlags(T: anytype, this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) JSValue {
        //const this: *ExpectStatic = ExpectStatic.fromJS(callFrame.this());
        const instance_jsvalue = T.call(globalThis, callFrame);
        if (!instance_jsvalue.isEmpty() and !instance_jsvalue.isAnyError()) {
            var instance = T.fromJS(instance_jsvalue) orelse {
                globalThis.throwOutOfMemory();
                return .zero;
            };
            instance.flags = this.flags;
        }
        return instance_jsvalue;
    }

    pub fn anything(this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return createAsymmetricMatcherWithFlags(ExpectAnything, this, globalThis, callFrame);
    }

    pub fn any(this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return createAsymmetricMatcherWithFlags(ExpectAny, this, globalThis, callFrame);
    }

    pub fn arrayContaining(this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return createAsymmetricMatcherWithFlags(ExpectArrayContaining, this, globalThis, callFrame);
    }

    pub fn closeTo(this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return createAsymmetricMatcherWithFlags(ExpectCloseTo, this, globalThis, callFrame);
    }

    pub fn objectContaining(this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return createAsymmetricMatcherWithFlags(ExpectObjectContaining, this, globalThis, callFrame);
    }

    pub fn stringContaining(this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return createAsymmetricMatcherWithFlags(ExpectStringContaining, this, globalThis, callFrame);
    }

    pub fn stringMatching(this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return createAsymmetricMatcherWithFlags(ExpectStringMatching, this, globalThis, callFrame);
    }
};

pub const ExpectAnything = struct {
    pub usingnamespace JSC.Codegen.JSExpectAnything;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectAnything,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        const anything = globalThis.bunVM().allocator.create(ExpectAnything) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        anything.* = .{};

        const anything_js_value = anything.toJS(globalThis);
        anything_js_value.ensureStillAlive();

        var vm = globalThis.bunVM();
        vm.autoGarbageCollect();

        return anything_js_value;
    }
};

pub const ExpectStringMatching = struct {
    pub usingnamespace JSC.Codegen.JSExpectStringMatching;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectStringMatching,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(1).slice();

        if (args.len == 0 or (!args[0].isString() and !args[0].isRegExp())) {
            const fmt = "<d>expect.<r>stringContaining<d>(<r>string<d>)<r>\n\nExpected a string or regular expression\n";
            globalThis.throwPretty(fmt, .{});
            return .zero;
        }

        const test_value = args[0];

        const string_matching = globalThis.bunVM().allocator.create(ExpectStringMatching) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        string_matching.* = .{};

        const string_matching_js_value = string_matching.toJS(globalThis);
        ExpectStringMatching.testValueSetCached(string_matching_js_value, globalThis, test_value);

        var vm = globalThis.bunVM();
        vm.autoGarbageCollect();
        return string_matching_js_value;
    }
};

pub const ExpectCloseTo = struct {
    pub usingnamespace JSC.Codegen.JSExpectCloseTo;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectCloseTo,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(2).slice();

        if (args.len == 0 or !args[0].isNumber()) {
            globalThis.throwPretty("<d>expect.<r>closeTo<d>(<r>number<d>, precision?)<r>\n\nExpected a number value", .{});
            return .zero;
        }
        const number_value = args[0];

        var precision_value = if (args.len > 1) args[1] else JSValue.undefined;
        if (precision_value.isUndefined()) {
            precision_value = JSValue.jsNumberFromInt32(2); // default value from jest
        }
        if (!precision_value.isNumber()) {
            globalThis.throwPretty("<d>expect.<r>closeTo<d>(number, <r>precision?<d>)<r>\n\nPrecision must be a number or undefined", .{});
            return .zero;
        }

        const instance = globalThis.bunVM().allocator.create(ExpectCloseTo) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        instance.* = .{};

        const instance_jsvalue = instance.toJS(globalThis);
        number_value.ensureStillAlive();
        precision_value.ensureStillAlive();
        ExpectCloseTo.numberValueSetCached(instance_jsvalue, globalThis, number_value);
        ExpectCloseTo.digitsValueSetCached(instance_jsvalue, globalThis, precision_value);

        var vm = globalThis.bunVM();
        vm.autoGarbageCollect();
        return instance_jsvalue;
    }
};

pub const ExpectObjectContaining = struct {
    pub usingnamespace JSC.Codegen.JSExpectObjectContaining;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectObjectContaining,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(1).slice();

        if (args.len == 0 or !args[0].isObject()) {
            const fmt = "<d>expect.<r>objectContaining<d>(<r>object<d>)<r>\n\nExpected an object\n";
            globalThis.throwPretty(fmt, .{});
            return .zero;
        }

        const object_value = args[0];

        const instance = globalThis.bunVM().allocator.create(ExpectObjectContaining) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        instance.* = .{};

        const instance_jsvalue = instance.toJS(globalThis);
        ExpectObjectContaining.objectValueSetCached(instance_jsvalue, globalThis, object_value);

        var vm = globalThis.bunVM();
        vm.autoGarbageCollect();
        return instance_jsvalue;
    }
};

pub const ExpectStringContaining = struct {
    pub usingnamespace JSC.Codegen.JSExpectStringContaining;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectStringContaining,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(1).slice();

        if (args.len == 0 or !args[0].isString()) {
            const fmt = "<d>expect.<r>stringContaining<d>(<r>string<d>)<r>\n\nExpected a string\n";
            globalThis.throwPretty(fmt, .{});
            return .zero;
        }

        const string_value = args[0];

        const string_containing = globalThis.bunVM().allocator.create(ExpectStringContaining) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        string_containing.* = .{};

        const string_containing_js_value = string_containing.toJS(globalThis);
        ExpectStringContaining.stringValueSetCached(string_containing_js_value, globalThis, string_value);

        var vm = globalThis.bunVM();
        vm.autoGarbageCollect();
        return string_containing_js_value;
    }
};

pub const ExpectAny = struct {
    pub usingnamespace JSC.Codegen.JSExpectAny;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectAny,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len == 0) {
            globalThis.throw("any() expects to be passed a constructor function. Please pass one or use anything() to match any object.", .{});
            return .zero;
        }

        const constructor = arguments[0];
        constructor.ensureStillAlive();
        if (!constructor.isConstructor()) {
            const fmt = "<d>expect.<r>any<d>(<r>constructor<d>)<r>\n\nExpected a constructor\n";
            globalThis.throwPretty(fmt, .{});
            return .zero;
        }

        var any = globalThis.bunVM().allocator.create(ExpectAny) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        any.* = .{};

        const any_js_value = any.toJS(globalThis);
        any_js_value.ensureStillAlive();
        ExpectAny.constructorValueSetCached(any_js_value, globalThis, constructor);
        any_js_value.ensureStillAlive();

        var vm = globalThis.bunVM();
        vm.autoGarbageCollect();

        return any_js_value;
    }
};

pub const ExpectArrayContaining = struct {
    pub usingnamespace JSC.Codegen.JSExpectArrayContaining;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectArrayContaining,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(1).slice();

        if (args.len == 0 or !args[0].jsType().isArray()) {
            const fmt = "<d>expect.<r>arrayContaining<d>(<r>array<d>)<r>\n\nExpected a array\n";
            globalThis.throwPretty(fmt, .{});
            return .zero;
        }

        const array_value = args[0];

        const array_containing = globalThis.bunVM().allocator.create(ExpectArrayContaining) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        array_containing.* = .{};

        const array_containing_js_value = array_containing.toJS(globalThis);
        ExpectArrayContaining.arrayValueSetCached(array_containing_js_value, globalThis, array_value);

        var vm = globalThis.bunVM();
        vm.autoGarbageCollect();
        return array_containing_js_value;
    }
};

/// An instantiated asymmetric custom matcher, returned from calls to `expect.toCustomMatch(...)`
///
/// Reference: `AsymmetricMatcher` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
/// (but only created for *custom* matchers, as built-ins have their own classes)
pub const ExpectCustomAsymmetricMatcher = struct {
    pub usingnamespace JSC.Codegen.JSExpectCustomAsymmetricMatcher;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectCustomAsymmetricMatcher,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    /// Implements the static call of the custom matcher (`expect.myCustomMatcher(<args>)`),
    /// which creates an asymmetric matcher instance (`ExpectCustomAsymmetricMatcher`).
    /// This will not run the matcher, but just capture the args etc.
    pub fn create(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame, matcher_fn: JSValue) callconv(.C) JSValue {
        var flags: Expect.Flags = undefined;

        // try to retrieve the ExpectStatic instance (to get the flags)
        if (ExpectStatic.fromJS(callFrame.this())) |expect_static| {
            flags = expect_static.flags;
        } else {
            // if it's not an ExpectStatic instance, assume it was called from the Expect constructor, so use the default flags
            flags = .{};
        }

        // create the matcher instance
        const instance = globalThis.bunVM().allocator.create(ExpectCustomAsymmetricMatcher) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        instance.* = .{};

        const instance_jsvalue = instance.toJS(globalThis);
        instance_jsvalue.ensureStillAlive();

        // store the flags
        instance.flags = flags;

        // store the user-provided matcher function into the instance
        ExpectCustomAsymmetricMatcher.matcherFnSetCached(instance_jsvalue, globalThis, matcher_fn);

        // capture the args as a JS array saved in the instance, so the matcher can be executed later on with them
        const args_ptr = callFrame.argumentsPtr();
        const args_count: usize = callFrame.argumentsCount();
        var args = JSValue.createEmptyArray(globalThis, args_count);
        for (0..args_count) |i| {
            args.putIndex(globalThis, @truncate(i), args_ptr[i]);
        }
        args.ensureStillAlive();
        ExpectCustomAsymmetricMatcher.capturedArgsSetCached(instance_jsvalue, globalThis, args);

        // return the same instance, now fully initialized including the captured args (previously it was incomplete)
        return instance_jsvalue;
    }

    /// Function called by c++ function "matchAsymmetricMatcher" to execute the custom matcher against the provided leftValue
    pub fn execute(this: *ExpectCustomAsymmetricMatcher, thisValue: JSValue, globalThis: *JSC.JSGlobalObject, received: JSValue) callconv(.C) bool {
        // retrieve the user-provided matcher implementation function (the function passed to expect.extend({ ... }))
        const matcher_fn: JSValue = ExpectCustomAsymmetricMatcher.matcherFnGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the ExpectCustomAsymmetricMatcher(matcherFn) was garbage collected but it should not have been!", .{});
            return false;
        };
        matcher_fn.ensureStillAlive();
        if (!matcher_fn.jsType().isFunction()) {
            globalThis.throw("Internal consistency error: the ExpectCustomMatcher(matcherFn) is not a function!", .{});
            return false;
        }

        // retrieve the matcher name
        const matcher_name = matcher_fn.getName(globalThis);

        // retrieve the asymmetric matcher args
        // if null, it means the function has not yet been called to capture the args, which is a misuse of the matcher
        const captured_args: JSValue = ExpectCustomAsymmetricMatcher.capturedArgsGetCached(thisValue) orelse {
            globalThis.throw("expect.{s} misused, it needs to be instantiated by calling it with 0 or more arguments", .{matcher_name});
            return false;
        };
        captured_args.ensureStillAlive();

        // prepare the args array as `[received, ...captured_args]`
        const args_count = captured_args.getLength(globalThis);
        var allocator = std.heap.stackFallback(8 * @sizeOf(JSValue), globalThis.allocator());
        var matcher_args = std.ArrayList(JSValue).initCapacity(allocator.get(), args_count + 1) catch {
            globalThis.throwOutOfMemory();
            return false;
        };
        matcher_args.appendAssumeCapacity(received);
        for (0..args_count) |i| {
            matcher_args.appendAssumeCapacity(captured_args.getIndex(globalThis, @truncate(i)));
        }

        return Expect.executeCustomMatcher(globalThis, matcher_name, matcher_fn, matcher_args.items, this.flags, true);
    }

    pub fn asymmetricMatch(this: *ExpectCustomAsymmetricMatcher, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(1).slice();
        const received_value = if (arguments.len < 1) JSC.JSValue.jsUndefined() else arguments[0];
        const matched = execute(this, callframe.this(), globalThis, received_value);
        return JSValue.jsBoolean(matched);
    }

    /// Calls a custom implementation (if provided) to stringify this asymmetric matcher, and returns true if it was provided and it succeed
    pub fn customPrint(_: *ExpectCustomAsymmetricMatcher, thisValue: JSValue, globalThis: *JSC.JSGlobalObject, writer: anytype, comptime dontThrow: bool) !bool {
        const matcher_fn: JSValue = ExpectCustomAsymmetricMatcher.matcherFnGetCached(thisValue) orelse return false;
        if (matcher_fn.get(globalThis, "toAsymmetricMatcher")) |fn_value| {
            if (fn_value.jsType().isFunction()) {
                const captured_args: JSValue = ExpectCustomAsymmetricMatcher.capturedArgsGetCached(thisValue) orelse return false;
                var stack_fallback = std.heap.stackFallback(256, globalThis.allocator());
                const args_len = captured_args.getLength(globalThis);
                var args = try std.ArrayList(JSValue).initCapacity(stack_fallback.get(), args_len);
                var iter = captured_args.arrayIterator(globalThis);
                while (iter.next()) |arg| {
                    args.appendAssumeCapacity(arg);
                }

                var result = matcher_fn.callWithThis(globalThis, thisValue, args.items);
                if (result.toError()) |err| {
                    if (dontThrow) {
                        return false;
                    } else {
                        globalThis.throwValue(globalThis, err);
                        return error.JSError;
                    }
                }
                try writer.print("{}", .{result.toBunString(globalThis)});
            }
        }
        return false;
    }

    pub fn toAsymmetricMatcher(this: *ExpectCustomAsymmetricMatcher, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        var stack_fallback = std.heap.stackFallback(512, globalThis.allocator());
        var mutable_string = bun.MutableString.init2048(stack_fallback.get()) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        defer mutable_string.deinit();

        const printed = customPrint(this, callframe.this(), globalThis, mutable_string.writer()) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        if (printed) {
            return bun.String.init(mutable_string.toOwnedSliceLeaky()).toJS();
        }
        return ExpectMatcherUtils.printValue(globalThis, this, null);
    }
};

/// Reference: `MatcherContext` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
pub const ExpectMatcherContext = struct {
    pub usingnamespace JSC.Codegen.JSExpectMatcherContext;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectMatcherContext,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn getUtils(_: *ExpectMatcherContext, globalThis: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        return ExpectMatcherUtils__getSingleton(globalThis);
    }

    pub fn getIsNot(this: *ExpectMatcherContext, _: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        return JSValue.jsBoolean(this.flags.not);
    }

    pub fn getPromise(this: *ExpectMatcherContext, globalThis: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        return switch (this.flags.promise) {
            .rejects => bun.String.static("rejects").toJS(globalThis),
            .resolves => bun.String.static("resolves").toJS(globalThis),
            else => bun.String.empty.toJS(globalThis),
        };
    }

    pub fn getExpand(_: *ExpectMatcherContext, globalThis: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        _ = globalThis;
        // TODO: this should return whether running tests in verbose mode or not (jest flag --expand), but bun currently doesn't have this switch
        return JSValue.false;
    }

    pub fn equals(_: *ExpectMatcherContext, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        var arguments = callframe.arguments(3);
        if (arguments.len < 2) {
            globalThis.throw("expect.extends matcher: this.util.equals expects at least 2 arguments", .{});
            return .zero;
        }
        const args = arguments.slice();
        return JSValue.jsBoolean(args[0].jestDeepEquals(args[1], globalThis));
    }
};

/// Reference: `MatcherUtils` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
pub const ExpectMatcherUtils = struct {
    pub usingnamespace JSC.Codegen.JSExpectMatcherUtils;

    fn createSingleton(globalThis: *JSC.JSGlobalObject) callconv(.C) JSValue {
        var instance = globalThis.bunVM().allocator.create(ExpectMatcherUtils) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        return instance.toJS(globalThis);
    }

    pub fn finalize(
        this: *ExpectMatcherUtils,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    fn printValue(globalThis: *JSC.JSGlobalObject, value: JSValue, comptime color_or_null: ?[]const u8) !JSValue {
        var stack_fallback = std.heap.stackFallback(512, globalThis.allocator());
        var mutable_string = try bun.MutableString.init2048(stack_fallback.get());
        defer mutable_string.deinit();

        var buffered_writer = bun.MutableString.BufferedWriter{ .context = &mutable_string };
        var writer = buffered_writer.writer();

        if (comptime color_or_null) |color| {
            if (Output.enable_ansi_colors) {
                try writer.writeAll(Output.prettyFmt(color, true));
            }
        }

        var formatter = JSC.ConsoleObject.Formatter{
            .globalThis = globalThis,
            .quote_strings = true,
        };
        try writer.print("{}", .{value.toFmt(globalThis, &formatter)});

        if (comptime color_or_null) |_| {
            if (Output.enable_ansi_colors) {
                try writer.writeAll(Output.prettyFmt("<r>", true));
            }
        }

        try buffered_writer.flush();

        const str = bun.String.createUTF8(mutable_string.toOwnedSlice());
        defer str.deref();
        return str.toJS(globalThis);
    }

    inline fn printValueCatched(globalThis: *JSC.JSGlobalObject, value: JSValue, comptime color_or_null: ?[]const u8) JSValue {
        return printValue(globalThis, value, color_or_null) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
    }

    pub fn stringify(_: *ExpectMatcherUtils, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const arguments = callframe.arguments(1).slice();
        const value = if (arguments.len < 1) JSC.JSValue.jsUndefined() else arguments[0];
        return printValueCatched(globalThis, value, null);
    }

    pub fn printExpected(_: *ExpectMatcherUtils, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const arguments = callframe.arguments(1).slice();
        const value = if (arguments.len < 1) JSC.JSValue.jsUndefined() else arguments[0];
        return printValueCatched(globalThis, value, "<green>");
    }

    pub fn printReceived(_: *ExpectMatcherUtils, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const arguments = callframe.arguments(1).slice();
        const value = if (arguments.len < 1) JSC.JSValue.jsUndefined() else arguments[0];
        return printValueCatched(globalThis, value, "<red>");
    }

    pub fn matcherHint(_: *ExpectMatcherUtils, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const arguments = callframe.arguments(4).slice();

        if (arguments.len == 0 or !arguments[0].isString()) {
            globalThis.throw("matcherHint: the first argument (matcher name) must be a string", .{});
            return .zero;
        }
        const matcher_name = arguments[0].toBunString(globalThis);
        defer matcher_name.deref();

        const received = if (arguments.len > 1) arguments[1] else bun.String.static("received").toJS(globalThis);
        const expected = if (arguments.len > 2) arguments[2] else bun.String.static("expected").toJS(globalThis);
        const options = if (arguments.len > 3) arguments[3] else JSValue.jsUndefined();

        var is_not = false;
        var comment: ?*JSC.JSString = null; // TODO support
        var promise: ?*JSC.JSString = null; // TODO support
        var second_argument: ?*JSC.JSString = null; // TODO support
        // TODO support "chalk" colors (they are actually functions like: (value: string) => string;)
        //var second_argument_color: ?string = null;
        //var expected_color: ?string = null;
        //var received_color: ?string = null;

        if (!options.isUndefinedOrNull()) {
            if (!options.isObject()) {
                globalThis.throw("matcherHint: options must be an object (or undefined)", .{});
                return .zero;
            }
            if (options.get(globalThis, "isNot")) |val| {
                is_not = val.coerce(bool, globalThis);
            }
            if (options.get(globalThis, "comment")) |val| {
                comment = val.toStringOrNull(globalThis);
            }
            if (options.get(globalThis, "promise")) |val| {
                promise = val.toStringOrNull(globalThis);
            }
            if (options.get(globalThis, "secondArgument")) |val| {
                second_argument = val.toStringOrNull(globalThis);
            }
        }

        const diff_formatter = DiffFormatter{
            .received = received,
            .expected = expected,
            .globalThis = globalThis,
            .not = is_not,
        };

        if (is_not) {
            const signature = comptime Expect.getSignature("{s}", "<green>expected<r>", true);
            const fmt = signature ++ "\n\n{any}\n";
            return JSValue.printStringPretty(globalThis, 2048, fmt, .{ matcher_name, diff_formatter }) catch {
                globalThis.throwOutOfMemory();
                return .zero;
            };
        } else {
            const signature = comptime Expect.getSignature("{s}", "<green>expected<r>", false);
            const fmt = signature ++ "\n\n{any}\n";
            return JSValue.printStringPretty(globalThis, 2048, fmt, .{ matcher_name, diff_formatter }) catch {
                globalThis.throwOutOfMemory();
                return .zero;
            };
        }
    }
};

// Extract the matcher_fn from a JSCustomExpectMatcherFunction instance
inline fn getCustomMatcherFn(thisValue: JSValue, globalThis: *JSGlobalObject) ?JSValue {
    var matcher_fn = Bun__JSWrappingFunction__getWrappedFunction(thisValue, globalThis);
    return if (matcher_fn.isEmpty()) null else matcher_fn;
}

/// JSValue.zero is used to indicate it was not a JSMockFunction
/// If there were no calls, it returns an empty JSArray*
extern fn JSMockFunction__getCalls(JSValue) JSValue;

/// JSValue.zero is used to indicate it was not a JSMockFunction
/// If there were no calls, it returns an empty JSArray*
extern fn JSMockFunction__getReturns(JSValue) JSValue;

extern fn Bun__JSWrappingFunction__create(globalThis: *JSC.JSGlobalObject, symbolName: *const bun.String, functionPointer: JSC.JSHostFunctionPtr, wrappedFn: JSValue, strong: bool) JSValue;
extern fn Bun__JSWrappingFunction__getWrappedFunction(this: JSC.JSValue, globalThis: *JSC.JSGlobalObject) JSValue;

extern fn ExpectMatcherUtils__getSingleton(globalThis: *JSC.JSGlobalObject) JSC.JSValue;

extern fn Expect__getPrototype(globalThis: *JSC.JSGlobalObject) JSC.JSValue;
extern fn ExpectStatic__getPrototype(globalThis: *JSC.JSGlobalObject) JSC.JSValue;

comptime {
    @export(ExpectMatcherUtils.createSingleton, .{ .name = "ExpectMatcherUtils_createSigleton" });
    @export(Expect.readFlagsAndProcessPromise, .{ .name = "Expect_readFlagsAndProcessPromise" });
    @export(ExpectCustomAsymmetricMatcher.execute, .{ .name = "ExpectCustomAsymmetricMatcher__execute" });
}

fn incrementExpectCallCounter() void {
    active_test_expectation_counter.actual += 1;
}

const assert = bun.assert;
