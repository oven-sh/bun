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

    pub fn throwPrettyMatcherError(globalThis: *JSGlobalObject, matcher_name: anytype, matcher_params: anytype, flags: Flags, comptime message_fmt: string, message_args: anytype) void {
        switch (Output.enable_ansi_colors) {
            inline else => |colors| {
                const chain = switch (flags.promise) {
                    .resolves => if (flags.not) Output.prettyFmt("resolves<d>.<r>not<d>.<r>", colors) else Output.prettyFmt("resolves<d>.<r>", colors),
                    .rejects => if (flags.not) Output.prettyFmt("rejects<d>.<r>not<d>.<r>", colors) else Output.prettyFmt("rejects<d>.<r>", colors),
                    .none => if (flags.not) Output.prettyFmt("not<d>.<r>", colors) else "",
                };
                const fmt = comptime Output.prettyFmt("<d>expect(<r><red>received<r><d>).<r>{s}{s}<d>(<r>{s}<d>)<r>\n\n" ++ message_fmt, colors);
                globalThis.throwPretty(fmt, .{
                    chain,
                    matcher_name,
                    matcher_params,
                } ++ message_args);
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
        return processPromise(this.flags, globalThis, value, matcher_name, matcher_params, false);
    }

    /// Processes the async flags (resolves/rejects), waiting for the async value if needed.
    /// If no flags, returns the original value
    /// If either flag is set, waits for the result, and returns either it as a JSValue, or null if the expectation failed (in which case if silent is false, also throws a js exception)
    pub fn processPromise(flags: Expect.Flags, globalThis: *JSGlobalObject, value: JSValue, matcher_name: anytype, matcher_params: anytype, comptime silent: bool) ?JSValue {
        switch (flags.promise) {
            inline .resolves, .rejects => |resolution| {
                if (value.asAnyPromise()) |promise| {
                    const vm = globalThis.vm();
                    promise.setHandled(vm);

                    const now = std.time.Instant.now() catch unreachable;
                    const elapsed = if (Jest.runner.?.pending_test) |pending_test| @divFloor(now.since(pending_test.started_at), std.time.ns_per_ms) else 0;
                    const remaining = @as(u32, @truncate(Jest.runner.?.last_test_timeout_timer_duration -| elapsed));

                    if (!globalThis.bunVM().waitForPromiseWithTimeout(promise, remaining)) {
                        if (Jest.runner.?.pending_test) |pending_test|
                            pending_test.timeout();
                        return null;
                    }

                    const newValue = promise.result(vm);
                    switch (promise.status(vm)) {
                        .Fulfilled => switch (resolution) {
                            .resolves => {},
                            .rejects => {
                                if (!silent) {
                                    var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
                                    const message = "Expected promise that rejects<r>\nReceived promise that resolved: <red>{any}<r>\n";
                                    throwPrettyMatcherError(globalThis, matcher_name, matcher_params, flags, message, .{value.toFmt(globalThis, &formatter)});
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
                                    throwPrettyMatcherError(globalThis, matcher_name, matcher_params, flags, message, .{value.toFmt(globalThis, &formatter)});
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
                        throwPrettyMatcherError(globalThis, matcher_name, matcher_params, flags, message, .{value.toFmt(globalThis, &formatter)});
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
        if (processPromise(flags, globalThis, value.*, "", "", true)) |result| {
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
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(1).slice();
        const value = if (arguments.len < 1) JSC.JSValue.jsUndefined() else arguments[0];

        var expect = globalObject.bunVM().allocator.create(Expect) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };

        expect.* = .{
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

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = true;

        if (not) pass = !pass;
        if (pass) return .undefined;

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

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = false;

        if (not) pass = !pass;
        if (pass) return .undefined;

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

        incrementExpectCallCounter();
        const right = arguments[0];
        right.ensureStillAlive();
        const left = this.getValue(globalObject, thisValue, "toBe", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = right.isSameValue(left, globalObject);

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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
            const fmt = comptime signature ++ "\n\n{any}\n";
            if (Output.enable_ansi_colors) {
                globalObject.throw(comptime Output.prettyFmt(fmt, true), .{diff_format});
                return .zero;
            }
            globalObject.throw(comptime Output.prettyFmt(fmt, false), .{diff_format});
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

        incrementExpectCallCounter();

        const expected: JSValue = arguments[0];
        const value: JSValue = this.getValue(globalObject, thisValue, "toHaveLength", "<green>expected<r>") orelse return .zero;

        if (!value.isObject() and !value.isString()) {
            var fmt = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
            globalObject.throw("Received value does not have a length property: {any}", .{value.toFmt(globalObject, &fmt)});
            return .zero;
        }

        if (!expected.isNumber()) {
            var fmt = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
            globalObject.throw("Expected value must be a non-negative integer: {any}", .{expected.toFmt(globalObject, &fmt)});
            return .zero;
        }

        const expected_length: f64 = expected.asNumber();
        if (@round(expected_length) != expected_length or std.math.isInf(expected_length) or std.math.isNan(expected_length) or expected_length < 0) {
            var fmt = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
            globalObject.throw("Expected value must be a non-negative integer: {any}", .{expected.toFmt(globalObject, &fmt)});
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;

        const actual_length = value.getLengthIfPropertyExistsInternal(globalObject);

        if (actual_length == std.math.inf(f64)) {
            var fmt = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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
        if (pass) return .undefined;

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

        incrementExpectCallCounter();

        const expected = arguments[0];
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalObject, thisValue, "toContain", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = false;

        const ExpectedEntry = struct {
            globalObject: *JSC.JSGlobalObject,
            expected: JSValue,
            pass: *bool,
        };

        if (value.jsTypeLoose().isArrayLike()) {
            var itr = value.arrayIterator(globalObject);
            while (itr.next()) |item| {
                if (item.isSameValue(expected, globalObject)) {
                    pass = true;
                    break;
                }
            }
        } else if (value.isStringLiteral() and expected.isStringLiteral()) {
            const value_string = value.toString(globalObject).toSlice(globalObject, default_allocator);
            defer value_string.deinit();
            const expected_string = expected.toString(globalObject).toSlice(globalObject, default_allocator);
            defer expected_string.deinit();

            if (expected_string.len == 0) { // edge case empty string is always contained
                pass = true;
            } else if (strings.contains(value_string.slice(), expected_string.slice())) {
                pass = true;
            } else if (value_string.len == 0 and expected_string.len == 0) { // edge case two empty strings are true
                pass = true;
            }
        } else if (value.isIterable(globalObject)) {
            var expected_entry = ExpectedEntry{
                .globalObject = globalObject,
                .expected = expected,
                .pass = &pass,
            };
            value.forEach(globalObject, &expected_entry, struct {
                pub fn sameValueIterator(
                    _: *JSC.VM,
                    _: *JSGlobalObject,
                    entry_: ?*anyopaque,
                    item: JSValue,
                ) callconv(.C) void {
                    const entry = bun.cast(*ExpectedEntry, entry_.?);
                    if (item.isSameValue(entry.expected, entry.globalObject)) {
                        entry.pass.* = true;
                        // TODO(perf): break out of the `forEach` when a match is found
                    }
                }
            }.sameValueIterator);
        } else {
            globalObject.throw("Received value must be an array type, or both received and expected values must be strings.", .{});
            return .zero;
        }

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = expected.toFmt(globalObject, &formatter);
        if (not) {
            const received_fmt = value.toFmt(globalObject, &formatter);
            const expected_line = "Expected to not contain: <green>{any}<r>\n\nReceived: <red>{any}<r>\n";
            const fmt = comptime getSignature("toContain", "<green>expected<r>", true) ++ "\n\n" ++ expected_line;
            globalObject.throwPretty(fmt, .{ expected_fmt, received_fmt });
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

    pub fn toContainKey(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toContainKey() takes 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = arguments[0];
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalObject, thisValue, "toContainKey", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = value.hasOwnProperty(globalObject, expected.toString(globalObject).getZigString(globalObject));

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = expected.toFmt(globalObject, &formatter);
        if (not) {
            const received_fmt = value.toFmt(globalObject, &formatter);
            const expected_line = "Expected to not contain: <green>{any}<r>\n\nReceived: <red>{any}<r>\n";
            const fmt = comptime getSignature("toContainKey", "<green>expected<r>", true) ++ "\n\n" ++ expected_line;
            globalObject.throwPretty(fmt, .{ expected_fmt, received_fmt });
            return .zero;
        }

        const expected_line = "Expected to contain: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toContainKey", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toContainKeys(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toContainKeys() takes 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = arguments[0];
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalObject, thisValue, "toContainKeys", "<green>expected<r>") orelse return .zero;

        if (!expected.jsType().isArray()) {
            globalObject.throwInvalidArgumentType("toContainKeys", "expected", "array");
            return .zero;
        }

        const not = this.flags.not;
        var pass = true;

        const count = expected.getLength(globalObject);

        var i: u32 = 0;

        while (i < count) : (i += 1) {
            const key = expected.getIndex(globalObject, i);

            if (!value.hasOwnProperty(globalObject, key.toString(globalObject).getZigString(globalObject))) {
                pass = false;
                break;
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
            const expected_line = "Expected to not contain: <green>{any}<r>\n\nReceived: <red>{any}<r>\n";
            const fmt = comptime getSignature("toContainKeys", "<green>expected<r>", true) ++ "\n\n" ++ expected_line;
            globalObject.throwPretty(fmt, .{ expected_fmt, received_fmt });
            return .zero;
        }

        const expected_line = "Expected to contain: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toContainKeys", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toContainAnyKeys(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toContainAnyKeys() takes 1 argument", .{});
            return .zero;
        }

        incrementExpectCallCounter();

        const expected = arguments[0];
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalObject, thisValue, "toContainAnyKeys", "<green>expected<r>") orelse return .zero;

        if (!expected.jsType().isArray()) {
            globalObject.throwInvalidArgumentType("toContainAnyKeys", "expected", "array");
            return .zero;
        }

        const not = this.flags.not;
        var pass = false;

        const count = expected.getLength(globalObject);

        var i: u32 = 0;

        while (i < count) : (i += 1) {
            const key = expected.getIndex(globalObject, i);

            if (value.hasOwnProperty(globalObject, key.toString(globalObject).getZigString(globalObject))) {
                pass = true;
                break;
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
            const expected_line = "Expected to not contain: <green>{any}<r>\n\nReceived: <red>{any}<r>\n";
            const fmt = comptime getSignature("toContainAnyKeys", "<green>expected<r>", true) ++ "\n\n" ++ expected_line;
            globalObject.throwPretty(fmt, .{ expected_fmt, received_fmt });
            return .zero;
        }

        const expected_line = "Expected to contain: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toContainAnyKeys", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        if (Output.enable_ansi_colors) {
            globalObject.throw(Output.prettyFmt(fmt, true), .{ expected_fmt, value_fmt });
            return .zero;
        }

        globalObject.throw(Output.prettyFmt(fmt, false), .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toContainEqual(
        this: *Expect,
        globalObject: *JSC.JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalObject.throwInvalidArguments("toContainEqual() takes 1 argument", .{});
            return .zero;
        }

        active_test_expectation_counter.actual += 1;

        const expected = arguments[0];
        expected.ensureStillAlive();
        const value: JSValue = this.getValue(globalObject, thisValue, "toContainEqual", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = false;

        const ExpectedEntry = struct {
            globalObject: *JSC.JSGlobalObject,
            expected: JSValue,
            pass: *bool,
        };

        const value_type = value.jsType();
        const expected_type = expected.jsType();

        if (value_type.isArrayLike()) {
            var itr = value.arrayIterator(globalObject);
            while (itr.next()) |item| {
                if (item.jestDeepEquals(expected, globalObject)) {
                    pass = true;
                    break;
                }
            }
        } else if (value_type.isStringLike() and expected_type.isStringLike()) {
            if (expected_type.isStringObjectLike() and value_type.isString()) pass = false else {
                const value_string = value.toString(globalObject).toSlice(globalObject, default_allocator);
                defer value_string.deinit();
                const expected_string = expected.toString(globalObject).toSlice(globalObject, default_allocator);
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
        } else if (value.isIterable(globalObject)) {
            var expected_entry = ExpectedEntry{
                .globalObject = globalObject,
                .expected = expected,
                .pass = &pass,
            };
            value.forEach(globalObject, &expected_entry, struct {
                pub fn deepEqualsIterator(
                    _: *JSC.VM,
                    _: *JSGlobalObject,
                    entry_: ?*anyopaque,
                    item: JSValue,
                ) callconv(.C) void {
                    const entry = bun.cast(*ExpectedEntry, entry_.?);
                    if (item.jestDeepEquals(entry.expected, entry.globalObject)) {
                        entry.pass.* = true;
                        // TODO(perf): break out of the `forEach` when a match is found
                    }
                }
            }.deepEqualsIterator);
        } else {
            globalObject.throw("Received value must be an array type, or both received and expected values must be strings.", .{});
            return .zero;
        }

        if (not) pass = !pass;
        if (pass) return thisValue;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const value_fmt = value.toFmt(globalObject, &formatter);
        const expected_fmt = expected.toFmt(globalObject, &formatter);
        if (not) {
            const expected_line = "Expected to not contain: <green>{any}<r>\n";
            const fmt = comptime getSignature("toContainEqual", "<green>expected<r>", true) ++ "\n\n" ++ expected_line;
            globalObject.throwPretty(fmt, .{expected_fmt});
            return .zero;
        }

        const expected_line = "Expected to contain: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const fmt = comptime getSignature("toContainEqual", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
        globalObject.throwPretty(fmt, .{ expected_fmt, value_fmt });
        return .zero;
    }

    pub fn toBeTruthy(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalObject, thisValue, "toBeTruthy", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = false;

        const truthy = value.toBooleanSlow(globalObject);
        if (truthy) pass = true;

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = false;
        if (value.isUndefined()) pass = true;

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = value.isNull();
        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = !value.isUndefined();
        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = false;

        const truthy = value.toBooleanSlow(globalObject);
        if (!truthy) pass = true;

        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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

        incrementExpectCallCounter();

        const expected = arguments[0];
        const value: JSValue = this.getValue(globalObject, thisValue, "toEqual", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = value.jestDeepEquals(expected, globalObject);

        if (not) pass = !pass;
        if (pass) return .undefined;

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

        incrementExpectCallCounter();

        const expected = arguments[0];
        const value: JSValue = this.getValue(globalObject, thisValue, "toStrictEqual", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;
        var pass = value.jestStrictDeepEquals(expected, globalObject);

        if (not) pass = !pass;
        if (pass) return .undefined;

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

        incrementExpectCallCounter();

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
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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

        incrementExpectCallCounter();

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
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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

        incrementExpectCallCounter();

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
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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

        incrementExpectCallCounter();

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
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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

        incrementExpectCallCounter();

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
        if (pass) return .undefined;

        // handle failure
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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
            return .undefined;
        }

        const expected_diff = std.math.pow(f64, 10, -precision) / 2;
        const actual_diff = @abs(received - expected);
        var pass = actual_diff < expected_diff;

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };

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
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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

        incrementExpectCallCounter();

        const expected_value: JSValue = if (arguments.len > 0) brk: {
            const value = arguments[0];
            if (value.isEmptyOrUndefinedOrNull() or !value.isObject() and !value.isString()) {
                var fmt = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
                globalObject.throw("Expected value must be string or Error: {any}", .{value.toFmt(globalObject, &fmt)});
                return .zero;
            }
            break :brk value;
        } else .zero;
        expected_value.ensureStillAlive();

        const value: JSValue = this.getValue(globalObject, thisValue, "toThrow", "<green>expected<r>") orelse return .zero;

        const not = this.flags.not;

        const result_: ?JSValue = brk: {
            if (!value.jsType().isFunction()) {
                if (this.flags.promise != .none) {
                    break :brk value;
                }

                globalObject.throw("Expected value must be a function", .{});
                return .zero;
            }

            var vm = globalObject.bunVM();
            var return_value: JSValue = .zero;

            // Drain existing unhandled rejections
            vm.global.handleRejectedPromises();

            var scope = vm.unhandledRejectionScope();
            const prev_unhandled_pending_rejection_to_capture = vm.unhandled_pending_rejection_to_capture;
            vm.unhandled_pending_rejection_to_capture = &return_value;
            vm.onUnhandledRejection = &VirtualMachine.onQuietUnhandledRejectionHandlerCaptureValue;
            const return_value_from_fucntion: JSValue = value.call(globalObject, &.{});
            vm.unhandled_pending_rejection_to_capture = prev_unhandled_pending_rejection_to_capture;

            vm.global.handleRejectedPromises();

            if (return_value == .zero) {
                return_value = return_value_from_fucntion;
            }

            if (return_value.asAnyPromise()) |promise| {
                vm.waitForPromise(promise);
                scope.apply(vm);
                const promise_result = promise.result(globalObject.vm());

                switch (promise.status(globalObject.vm())) {
                    .Fulfilled => {
                        break :brk null;
                    },
                    .Rejected => {
                        promise.setHandled(globalObject.vm());

                        // since we know for sure it rejected, we should always return the error
                        break :brk promise_result.toError() orelse promise_result;
                    },
                    .Pending => unreachable,
                }
            }

            if (return_value != return_value_from_fucntion) {
                if (return_value_from_fucntion.asAnyPromise()) |existing| {
                    existing.setHandled(globalObject.vm());
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
            var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };

            if (expected_value.isEmpty() or expected_value.isUndefined()) {
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
                    if (!strings.contains(received_slice.slice(), expected_slice.slice())) return .undefined;
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
                    if (!matches.toBooleanSlow(globalObject)) return .undefined;
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
                if (!expected_message.isSameValue(received_message, globalObject)) return .undefined;

                const fmt = signature ++ "\n\nExpected message: not <green>{any}<r>\n";
                globalObject.throwPretty(fmt, .{expected_message.toFmt(globalObject, &formatter)});
                return .zero;
            }

            if (!result.isInstanceOf(globalObject, expected_value)) return .undefined;

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
            if (expected_value.isEmpty() or expected_value.isUndefined()) return .undefined;

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
                    if (strings.contains(received_slice.slice(), expected_slice.slice())) return .undefined;
                }

                // error: message from received error does not match expected string
                var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };

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
                        if (matches.toBooleanSlow(globalObject)) return .undefined;
                    }
                }

                // error: message from received error does not match expected pattern
                var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };

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
                    if (received_message.isSameValue(expected_message, globalObject)) return .undefined;
                }

                // error: message from received error does not match expected error message.
                var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };

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

            if (result.isInstanceOf(globalObject, expected_value)) return .undefined;

            // error: received error not instance of received error constructor
            var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
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
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const received_line = "Received function did not throw\n";

        if (expected_value.isEmpty() or expected_value.isUndefined()) {
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

        incrementExpectCallCounter();

        const not = this.flags.not;
        if (not) {
            const signature = comptime getSignature("toMatchSnapshot", "", true);
            const fmt = signature ++ "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n";
            globalObject.throwPretty(fmt, .{});
        }

        if (this.testScope() == null) {
            const signature = comptime getSignature("toMatchSnapshot", "", true);
            const fmt = signature ++ "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n";
            globalObject.throwPretty(fmt, .{});
            return .zero;
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
            const prop_matchers = _prop_matchers;

            if (!value.jestDeepMatch(prop_matchers, globalObject, true)) {
                // TODO: print diff with properties from propertyMatchers
                const signature = comptime getSignature("toMatchSnapshot", "<green>propertyMatchers<r>", false);
                const fmt = signature ++ "\n\nExpected <green>propertyMatchers<r> to match properties from received object" ++
                    "\n\nReceived: {any}\n";

                var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject };
                globalObject.throwPretty(fmt, .{value.toFmt(globalObject, &formatter)});
                return .zero;
            }
        }

        const result = Jest.runner.?.snapshots.getOrPut(this, value, hint.slice(), globalObject) catch |err| {
            var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject };
            const test_file_path = Jest.runner.?.files.get(this.testScope().?.describe.file_id).source.path.text;
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
                var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject };
                globalObject.throw("Failed to pretty format value: {s}", .{value.toFmt(globalObject, &formatter)});
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
                .globalObject = globalObject,
            };

            globalObject.throwPretty(fmt, .{diff_format});
            return .zero;
        }

        return .undefined;
    }

    pub fn toBeEmpty(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        defer this.postMatch(globalObject);

        const thisValue = callFrame.this();
        const value: JSValue = this.getValue(globalObject, thisValue, "toBeEmpty", "") orelse return .zero;

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = false;
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };

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
        if (pass) return .undefined;

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
            const fmt = comptime getSignature("toBeEmptyObject", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeEmptyObject", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
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

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.jsType().isArray() != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
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

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.isBoolean() != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
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

        const value: JSValue = this.getValue(globalThis, thisValue, "toBeTypeOf", "") orelse return .zero;

        const expected = arguments[0];
        expected.ensureStillAlive();

        const expectedAsStr = expected.toString(globalThis).toSlice(globalThis, default_allocator).slice();
        incrementExpectCallCounter();

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
        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
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

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = (value.isBoolean() and value.toBoolean()) != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
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

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = (value.isBoolean() and !value.toBoolean()) != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
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

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.isNumber() != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
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

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.isAnyInt() != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
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
            const fmt = comptime getSignature("toBeObject", "", true) ++ "\n\nExpected value <b>not<r> to be an object" ++ "\n\nReceived: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeObject", "", false) ++ "\n\nExpected value to be an object" ++ "\n\nReceived: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
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
            const valueStr = value.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            const expectedStr = expected.toString(globalThis).toSlice(globalThis, default_allocator).slice();

            var left: usize = 0;
            var right: usize = 0;

            // Skip leading whitespaces
            while (left < valueStr.len and std.ascii.isWhitespace(valueStr[left])) left += 1;
            while (right < expectedStr.len and std.ascii.isWhitespace(expectedStr[right])) right += 1;

            while (left < valueStr.len and right < expectedStr.len) {
                const left_char = valueStr[left];
                const right_char = expectedStr[right];

                if (left_char != right_char) {
                    pass = false;
                    break;
                }

                left += 1;
                right += 1;

                // Skip trailing whitespaces
                while (left < valueStr.len and std.ascii.isWhitespace(valueStr[left])) left += 1;
                while (right < expectedStr.len and std.ascii.isWhitespace(expectedStr[right])) right += 1;
            }

            if (left < valueStr.len or right < expectedStr.len) {
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
            const fmt = comptime getSignature("toEqualIgnoringWhitespace", "<green>expected<r>", true) ++ "\n\n" ++ "Expected: not <green>{any}<r>\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{ expected_fmt, value_fmt });
            return .zero;
        }

        const fmt = comptime getSignature("toEqualIgnoringWhitespace", "<green>expected<r>", false) ++ "\n\n" ++ "Expected: <green>{any}<r>\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{ expected_fmt, value_fmt });
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

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.isCallable(globalThis.vm()) != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
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

        incrementExpectCallCounter();

        const not = this.flags.not;
        const pass = value.isDate() != not;

        if (pass) return .undefined;

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
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
            const fmt = comptime getSignature("toBeValidDate", "", true) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
            globalThis.throwPretty(fmt, .{received});
            return .zero;
        }

        const fmt = comptime getSignature("toBeValidDate", "", false) ++ "\n\n" ++ "Received: <red>{any}<r>\n";
        globalThis.throwPretty(fmt, .{received});
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

        incrementExpectCallCounter();

        var pass = value.isString();
        if (pass) {
            const value_string = value.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            const expected_string = expected.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            pass = strings.contains(value_string, expected_string) or expected_string.len == 0;
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

    pub fn toIncludeRepeated(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(2);
        const arguments = arguments_.ptr[0..arguments_.len];

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
                const fmt = comptime getSignature("toIncludeRepeated", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
                globalThis.throwPretty(fmt, .{ substring_fmt, expect_string_fmt });
            } else if (countAsNum == 1) {
                const expected_line = "Expected not to include: <green>{any}<r> \n";
                const fmt = comptime getSignature("toIncludeRepeated", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
                globalThis.throwPretty(fmt, .{ substring_fmt, expect_string_fmt });
            } else {
                const expected_line = "Expected not to include: <green>{any}<r> <green>{any}<r> times \n";
                const fmt = comptime getSignature("toIncludeRepeated", "<green>expected<r>", true) ++ "\n\n" ++ expected_line ++ received_line;
                globalThis.throwPretty(fmt, .{ substring_fmt, times_fmt, expect_string_fmt });
            }

            return .zero;
        }

        if (countAsNum == 0) {
            const expected_line = "Expected to not include: <green>{any}<r>\n";
            const fmt = comptime getSignature("toIncludeRepeated", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
            globalThis.throwPretty(fmt, .{ substring_fmt, expect_string_fmt });
        } else if (countAsNum == 1) {
            const expected_line = "Expected to include: <green>{any}<r>\n";
            const fmt = comptime getSignature("toIncludeRepeated", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
            globalThis.throwPretty(fmt, .{ substring_fmt, expect_string_fmt });
        } else {
            const expected_line = "Expected to include: <green>{any}<r> <green>{any}<r> times \n";
            const fmt = comptime getSignature("toIncludeRepeated", "<green>expected<r>", false) ++ "\n\n" ++ expected_line ++ received_line;
            globalThis.throwPretty(fmt, .{ substring_fmt, times_fmt, expect_string_fmt });
        }

        return .zero;
    }

    pub fn toSatisfy(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) callconv(.C) JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments(1);
        const arguments = arguments_.ptr[0..arguments_.len];

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
            const fmt = signature ++ "\n\nExpected: not <green>{any}<r>\n";
            if (Output.enable_ansi_colors) {
                globalThis.throw(Output.prettyFmt(fmt, true), .{predicate.toFmt(globalThis, &formatter)});
                return .zero;
            }
            globalThis.throw(Output.prettyFmt(fmt, false), .{predicate.toFmt(globalThis, &formatter)});
            return .zero;
        }

        const signature = comptime getSignature("toSatisfy", "<green>expected<r>", false);

        const fmt = signature ++ "\n\nExpected: <green>{any}<r>\nReceived: <red>{any}<r>\n";

        if (Output.enable_ansi_colors) {
            globalThis.throw(Output.prettyFmt(fmt, true), .{
                predicate.toFmt(globalThis, &formatter),
                value.toFmt(globalThis, &formatter),
            });
            return .zero;
        }

        globalThis.throw(Output.prettyFmt(fmt, false), .{
            predicate.toFmt(globalThis, &formatter),
            value.toFmt(globalThis, &formatter),
        });

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

        incrementExpectCallCounter();

        var pass = value.isString();
        if (pass) {
            const value_string = value.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            const expected_string = expected.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            pass = strings.startsWith(value_string, expected_string) or expected_string.len == 0;
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

        incrementExpectCallCounter();

        var pass = value.isString();
        if (pass) {
            const value_string = value.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            const expected_string = expected.toString(globalThis).toSlice(globalThis, default_allocator).slice();
            pass = strings.endsWith(value_string, expected_string) or expected_string.len == 0;
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

        incrementExpectCallCounter();
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };

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
        if (pass) return .undefined;

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

        incrementExpectCallCounter();

        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };

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
        if (pass) return .undefined;

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
        incrementExpectCallCounter();

        if (calls == .zero or !calls.jsType().isArray()) {
            globalObject.throw("Expected value must be a mock function: {}", .{value});
            return .zero;
        }

        var pass = calls.getLength(globalObject) > 0;

        const not = this.flags.not;
        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        if (not) {
            const signature = comptime getSignature("toHaveBeenCalled", "", true);
            const fmt = signature ++ "\n\n" ++ "Expected number of calls: <green>0<r>\n" ++ "Received number of calls: <red>{any}<r>\n";
            globalObject.throwPretty(fmt, .{calls.getLength(globalObject)});
            return .zero;
        }

        const signature = comptime getSignature("toHaveBeenCalled", "", false);
        const fmt = signature ++ "\n\n" ++ "Expected number of calls: \\>= <green>1<r>\n" ++ "Received number of calls: <red>{any}<r>\n";
        globalObject.throwPretty(fmt, .{calls.getLength(globalObject)});
        return .zero;
    }

    pub fn toHaveBeenCalledTimes(this: *Expect, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        const thisValue = callframe.this();
        const arguments_ = callframe.arguments(1);
        const arguments: []const JSValue = arguments_.ptr[0..arguments_.len];
        defer this.postMatch(globalObject);
        const value: JSValue = this.getValue(globalObject, thisValue, "toHaveBeenCalledTimes", "<green>expected<r>") orelse return .zero;

        incrementExpectCallCounter();

        const calls = JSMockFunction__getCalls(value);

        if (calls == .zero or !calls.jsType().isArray()) {
            globalObject.throw("Expected value must be a mock function: {}", .{value});
            return .zero;
        }

        if (arguments.len < 1 or !arguments[0].isUInt32AsAnyInt()) {
            globalObject.throwInvalidArguments("toHaveBeenCalledTimes() requires 1 non-negative integer argument", .{});
            return .zero;
        }

        const times = arguments[0].coerce(i32, globalObject);

        var pass = @as(i32, @intCast(calls.getLength(globalObject))) == times;

        const not = this.flags.not;
        if (not) pass = !pass;
        if (pass) return .undefined;

        // handle failure
        if (not) {
            const signature = comptime getSignature("toHaveBeenCalledTimes", "<green>expected<r>", true);
            const fmt = signature ++ "\n\n" ++ "Expected number of calls: not <green>{any}<r>\n" ++ "Received number of calls: <red>{any}<r>\n";
            globalObject.throwPretty(fmt, .{ times, calls.getLength(globalObject) });
            return .zero;
        }

        const signature = comptime getSignature("toHaveBeenCalledTimes", "<green>expected<r>", false);
        const fmt = signature ++ "\n\n" ++ "Expected number of calls: <green>{any}<r>\n" ++ "Received number of calls: <red>{any}<r>\n";
        globalObject.throwPretty(fmt, .{ times, calls.getLength(globalObject) });
        return .zero;
    }

    pub fn toMatchObject(this: *Expect, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        JSC.markBinding(@src());

        defer this.postMatch(globalObject);
        const thisValue = callFrame.this();
        const args = callFrame.arguments(1).slice();

        incrementExpectCallCounter();

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
        if (pass) return .undefined;

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

    pub fn toHaveBeenCalledWith(this: *Expect, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        const thisValue = callframe.this();
        const arguments_ = callframe.argumentsPtr()[0..callframe.argumentsCount()];
        const arguments: []const JSValue = arguments_.ptr[0..arguments_.len];
        defer this.postMatch(globalObject);
        const value: JSValue = this.getValue(globalObject, thisValue, "toHaveBeenCalledWith", "<green>expected<r>") orelse return .zero;

        incrementExpectCallCounter();

        const calls = JSMockFunction__getCalls(value);

        if (calls == .zero or !calls.jsType().isArray()) {
            globalObject.throw("Expected value must be a mock function: {}", .{value});
            return .zero;
        }

        var pass = false;

        if (calls.getLength(globalObject) > 0) {
            var itr = calls.arrayIterator(globalObject);
            while (itr.next()) |callItem| {
                if (callItem == .zero or !callItem.jsType().isArray()) {
                    globalObject.throw("Expected value must be a mock function with calls: {}", .{value});
                    return .zero;
                }

                if (callItem.getLength(globalObject) != arguments.len) {
                    continue;
                }

                var callItr = callItem.arrayIterator(globalObject);
                var match = true;
                while (callItr.next()) |callArg| {
                    if (!callArg.jestDeepEquals(arguments[callItr.i - 1], globalObject)) {
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
            const fmt = signature ++ "\n\n" ++ "Number of calls: <red>{any}<r>\n";
            globalObject.throwPretty(fmt, .{calls.getLength(globalObject)});
            return .zero;
        }

        const signature = comptime getSignature("toHaveBeenCalledWith", "<green>expected<r>", false);
        const fmt = signature ++ "\n\n" ++ "Number of calls: <red>{any}<r>\n";
        globalObject.throwPretty(fmt, .{calls.getLength(globalObject)});
        return .zero;
    }

    pub fn toHaveBeenLastCalledWith(this: *Expect, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        const thisValue = callframe.this();
        const arguments_ = callframe.argumentsPtr()[0..callframe.argumentsCount()];
        const arguments: []const JSValue = arguments_.ptr[0..arguments_.len];
        defer this.postMatch(globalObject);
        const value: JSValue = this.getValue(globalObject, thisValue, "toHaveBeenLastCalledWith", "<green>expected<r>") orelse return .zero;

        incrementExpectCallCounter();

        const calls = JSMockFunction__getCalls(value);

        if (calls == .zero or !calls.jsType().isArray()) {
            globalObject.throw("Expected value must be a mock function: {}", .{value});
            return .zero;
        }

        const totalCalls = @as(u32, @intCast(calls.getLength(globalObject)));
        var lastCallValue: JSValue = .zero;

        var pass = totalCalls > 0;

        if (pass) {
            lastCallValue = calls.getIndex(globalObject, totalCalls - 1);

            if (lastCallValue == .zero or !lastCallValue.jsType().isArray()) {
                globalObject.throw("Expected value must be a mock function with calls: {}", .{value});
                return .zero;
            }

            if (lastCallValue.getLength(globalObject) != arguments.len) {
                pass = false;
            } else {
                var itr = lastCallValue.arrayIterator(globalObject);
                while (itr.next()) |callArg| {
                    if (!callArg.jestDeepEquals(arguments[itr.i - 1], globalObject)) {
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
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const received_fmt = lastCallValue.toFmt(globalObject, &formatter);

        if (not) {
            const signature = comptime getSignature("toHaveBeenLastCalledWith", "<green>expected<r>", true);
            const fmt = signature ++ "\n\n" ++ "Received: <red>{any}<r>" ++ "\n\n" ++ "Number of calls: <red>{any}<r>\n";
            globalObject.throwPretty(fmt, .{ received_fmt, totalCalls });
            return .zero;
        }

        const signature = comptime getSignature("toHaveBeenLastCalledWith", "<green>expected<r>", false);
        const fmt = signature ++ "\n\n" ++ "Received: <red>{any}<r>" ++ "\n\n" ++ "Number of calls: <red>{any}<r>\n";
        globalObject.throwPretty(fmt, .{ received_fmt, totalCalls });
        return .zero;
    }

    pub fn toHaveBeenNthCalledWith(this: *Expect, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        const thisValue = callframe.this();
        const arguments_ = callframe.argumentsPtr()[0..callframe.argumentsCount()];
        const arguments: []const JSValue = arguments_.ptr[0..arguments_.len];
        defer this.postMatch(globalObject);
        const value: JSValue = this.getValue(globalObject, thisValue, "toHaveBeenNthCalledWith", "<green>expected<r>") orelse return .zero;

        incrementExpectCallCounter();

        const calls = JSMockFunction__getCalls(value);

        if (calls == .zero or !calls.jsType().isArray()) {
            globalObject.throw("Expected value must be a mock function: {}", .{value});
            return .zero;
        }

        const nthCallNum = if (arguments.len > 0 and arguments[0].isUInt32AsAnyInt()) arguments[0].coerce(i32, globalObject) else 0;
        if (nthCallNum < 1) {
            globalObject.throwInvalidArguments("toHaveBeenNthCalledWith() requires a positive integer argument", .{});
            return .zero;
        }

        const totalCalls = calls.getLength(globalObject);
        var nthCallValue: JSValue = .zero;

        var pass = totalCalls >= nthCallNum;

        if (pass) {
            nthCallValue = calls.getIndex(globalObject, @as(u32, @intCast(nthCallNum)) - 1);

            if (nthCallValue == .zero or !nthCallValue.jsType().isArray()) {
                globalObject.throw("Expected value must be a mock function with calls: {}", .{value});
                return .zero;
            }

            if (nthCallValue.getLength(globalObject) != (arguments.len - 1)) {
                pass = false;
            } else {
                var itr = nthCallValue.arrayIterator(globalObject);
                while (itr.next()) |callArg| {
                    if (!callArg.jestDeepEquals(arguments[itr.i], globalObject)) {
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
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalObject, .quote_strings = true };
        const received_fmt = nthCallValue.toFmt(globalObject, &formatter);

        if (not) {
            const signature = comptime getSignature("toHaveBeenNthCalledWith", "<green>expected<r>", true);
            const fmt = signature ++ "\n\n" ++ "n: {any}\n" ++ "Received: <red>{any}<r>" ++ "\n\n" ++ "Number of calls: <red>{any}<r>\n";
            globalObject.throwPretty(fmt, .{ nthCallNum, received_fmt, totalCalls });
            return .zero;
        }

        const signature = comptime getSignature("toHaveBeenNthCalledWith", "<green>expected<r>", false);
        const fmt = signature ++ "\n\n" ++ "n: {any}\n" ++ "Received: <red>{any}<r>" ++ "\n\n" ++ "Number of calls: <red>{any}<r>\n";
        globalObject.throwPretty(fmt, .{ nthCallNum, received_fmt, totalCalls });
        return .zero;
    }

    pub const toHaveReturned = notImplementedJSCFn;
    pub const toHaveReturnedTimes = notImplementedJSCFn;
    pub const toHaveReturnedWith = notImplementedJSCFn;
    pub const toHaveLastReturnedWith = notImplementedJSCFn;
    pub const toHaveNthReturnedWith = notImplementedJSCFn;
    pub const toMatchInlineSnapshot = notImplementedJSCFn;
    pub const toThrowErrorMatchingSnapshot = notImplementedJSCFn;
    pub const toThrowErrorMatchingInlineSnapshot = notImplementedJSCFn;

    pub fn getStaticNot(globalObject: *JSGlobalObject, _: JSValue, _: JSValue) callconv(.C) JSValue {
        return ExpectStatic.create(globalObject, .{ .not = true });
    }

    pub fn getStaticResolvesTo(globalObject: *JSGlobalObject, _: JSValue, _: JSValue) callconv(.C) JSValue {
        return ExpectStatic.create(globalObject, .{ .promise = .resolves });
    }

    pub fn getStaticRejectsTo(globalObject: *JSGlobalObject, _: JSValue, _: JSValue) callconv(.C) JSValue {
        return ExpectStatic.create(globalObject, .{ .promise = .rejects });
    }

    pub fn any(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectAny.call(globalObject, callFrame);
    }

    pub fn anything(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectAnything.call(globalObject, callFrame);
    }

    pub fn closeTo(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectCloseTo.call(globalObject, callFrame);
    }

    pub fn objectContaining(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectObjectContaining.call(globalObject, callFrame);
    }

    pub fn stringContaining(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectStringContaining.call(globalObject, callFrame);
    }

    pub fn stringMatching(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectStringMatching.call(globalObject, callFrame);
    }

    pub fn arrayContaining(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return ExpectArrayContaining.call(globalObject, callFrame);
    }

    /// Implements `expect.extend({ ... })`
    pub fn extend(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(1).slice();

        if (args.len == 0 or !args[0].isObject()) {
            globalObject.throwPretty("<d>expect.<r>extend<d>(<r>matchers<d>)<r>\n\nExpected an object containing matchers\n", .{});
            return .zero;
        }

        var expect_proto = Expect__getPrototype(globalObject);
        var expect_constructor = Expect.getConstructor(globalObject);
        var expect_static_proto = ExpectStatic__getPrototype(globalObject);

        const matchers_to_register = args[0];
        {
            var iter = JSC.JSPropertyIterator(.{
                .skip_empty_name = true,
                .include_value = true,
            }).init(globalObject, matchers_to_register.asObjectRef());
            defer iter.deinit();

            while (iter.next()) |matcher_name| {
                const matcher_fn: JSValue = iter.value;

                if (!matcher_fn.jsType().isFunction()) {
                    const type_name = if (matcher_fn.isNull()) bun.String.static("null") else bun.String.init(matcher_fn.jsTypeString(globalObject).getZigString(globalObject));
                    globalObject.throwInvalidArguments("expect.extend: `{s}` is not a valid matcher. Must be a function, is \"{s}\"", .{ matcher_name, type_name });
                    return .zero;
                }

                // Mutate the Expect/ExpectStatic prototypes/constructor with new instances of JSCustomExpectMatcherFunction.
                // Even though they point to the same native functions for all matchers,
                // multiple instances are created because each instance will hold the matcher_fn as a property

                const wrapper_fn = Bun__JSWrappingFunction__create(globalObject, &matcher_name, &Expect.applyCustomMatcher, matcher_fn, true);

                expect_proto.put(globalObject, &matcher_name, wrapper_fn);
                expect_constructor.put(globalObject, &matcher_name, wrapper_fn);
                expect_static_proto.put(globalObject, &matcher_name, wrapper_fn);
            }
        }

        globalObject.bunVM().autoGarbageCollect();

        return .undefined;
    }

    const CustomMatcherParamsFormatter = struct {
        colors: bool,
        globalObject: *JSC.JSGlobalObject,
        matcher_fn: JSValue,

        pub fn format(this: CustomMatcherParamsFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            // try to detect param names from matcher_fn (user function) source code
            if (JSC.JSFunction.getSourceCode(this.matcher_fn)) |source_str| {
                var source_slice = source_str.toSlice(this.globalObject.allocator());
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

    fn throwInvalidMatcherError(globalObject: *JSC.JSGlobalObject, matcher_name: bun.String, result: JSValue) void {
        @setCold(true);

        var formatter = JSC.ConsoleObject.Formatter{
            .globalThis = globalObject,
            .quote_strings = true,
        };

        const fmt =
            "Unexpected return from matcher function `{s}`.\n" ++
            "Matcher functions should return an object in the following format:\n" ++
            "  {{message?: string | function, pass: boolean}}\n" ++
            "'{any}' was returned";
        const err = switch (Output.enable_ansi_colors) {
            inline else => |colors| globalObject.createErrorInstance(Output.prettyFmt(fmt, colors), .{ matcher_name, result.toFmt(globalObject, &formatter) }),
        };
        err.put(globalObject, ZigString.static("name"), ZigString.init("InvalidMatcherError").toValueGC(globalObject));
        globalObject.throwValue(err);
    }

    /// Execute the custom matcher for the given args (the left value + the args passed to the matcher call).
    /// This function is called both for symmetric and asymmetric matching.
    /// If silent=false, throws an exception in JS if the matcher result didn't result in a pass (or if the matcher result is invalid).
    pub fn executeCustomMatcher(globalObject: *JSC.JSGlobalObject, matcher_name: bun.String, matcher_fn: JSValue, args: []const JSValue, flags: Expect.Flags, silent: bool) bool {
        // prepare the this object
        const matcher_context = globalObject.bunVM().allocator.create(ExpectMatcherContext) catch {
            globalObject.throwOutOfMemory();
            return false;
        };
        matcher_context.flags = flags;
        const matcher_context_jsvalue = matcher_context.toJS(globalObject);
        matcher_context_jsvalue.ensureStillAlive();

        // call the custom matcher implementation
        var result = matcher_fn.callWithThis(globalObject, matcher_context_jsvalue, args);
        std.debug.assert(!result.isEmpty());
        if (result.toError()) |err| {
            globalObject.throwValue(err);
            return false;
        }
        // support for async matcher results
        if (result.asAnyPromise()) |promise| {
            const vm = globalObject.vm();
            promise.setHandled(vm);

            const now = std.time.Instant.now() catch unreachable;
            const elapsed = if (Jest.runner.?.pending_test) |pending_test| @divFloor(now.since(pending_test.started_at), std.time.ns_per_ms) else 0;
            const remaining = @as(u32, @truncate(Jest.runner.?.last_test_timeout_timer_duration -| elapsed));

            if (!globalObject.bunVM().waitForPromiseWithTimeout(promise, remaining)) {
                if (Jest.runner.?.pending_test) |pending_test|
                    pending_test.timeout();
                globalObject.throw("Timed out while awaiting the promise returned by matcher \"{s}\"", .{matcher_name});
                return false;
            }
            result = promise.result(vm);
            result.ensureStillAlive();
            std.debug.assert(!result.isEmpty());
            switch (promise.status(vm)) {
                .Pending => unreachable,
                .Fulfilled => {},
                .Rejected => {
                    // TODO throw the actual rejection error
                    globalObject.bunVM().runErrorHandler(result, null);
                    globalObject.throw("Matcher `{s}` returned a promise that rejected", .{matcher_name});
                    return false;
                },
            }
        }

        var pass: bool = undefined;
        var message: JSValue = undefined;

        // Parse and validate the custom matcher result, which should conform to: { pass: boolean, message?: () => string }
        const is_valid = valid: {
            if (result.isObject()) {
                if (result.get(globalObject, "pass")) |pass_value| {
                    pass = pass_value.toBoolean();

                    if (result.get(globalObject, "message")) |message_value| {
                        if (!message_value.isString() and !message_value.isCallable(globalObject.vm())) {
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
            throwInvalidMatcherError(globalObject, matcher_name, result);
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
            message_text = message.toBunString(globalObject);
        } else { // callable
            var message_result = message.callWithGlobalThis(globalObject, &[_]JSValue{});
            std.debug.assert(!message_result.isEmpty());
            if (message_result.toError()) |err| {
                globalObject.throwValue(err);
                return false;
            }
            if (message_result.toStringOrNull(globalObject)) |str| {
                message_text = bun.String.init(str.getZigString(globalObject));
            } else {
                return false;
            }
        }

        const matcher_params = CustomMatcherParamsFormatter{
            .colors = Output.enable_ansi_colors,
            .globalObject = globalObject,
            .matcher_fn = matcher_fn,
        };
        throwPrettyMatcherError(globalObject, matcher_name, matcher_params, .{}, "{s}", .{message_text});
        return false;
    }

    /// Function that is run for either `expect.myMatcher()` call or `expect().myMatcher` call,
    /// and we can known which case it is based on if the `callFrame.this()` value is an instance of Expect
    pub fn applyCustomMatcher(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        defer globalObject.bunVM().autoGarbageCollect();

        // retrieve the user-provided matcher function (matcher_fn)
        const func: JSValue = callFrame.callee();
        var matcher_fn = getCustomMatcherFn(func, globalObject) orelse JSValue.undefined;
        if (!matcher_fn.jsType().isFunction()) {
            globalObject.throw("Internal consistency error: failed to retrieve the matcher function for a custom matcher!", .{});
            return .zero;
        }
        matcher_fn.ensureStillAlive();

        // try to retrieve the Expect instance
        const thisValue: JSValue = callFrame.this();
        const expect: *Expect = Expect.fromJS(thisValue) orelse {
            // if no Expect instance, assume it is a static call (`expect.myMatcher()`), so create an ExpectCustomAsymmetricMatcher instance
            return ExpectCustomAsymmetricMatcher.create(globalObject, callFrame, matcher_fn);
        };

        // if we got an Expect instance, then it's a non-static call (`expect().myMatcher`),
        // so now execute the symmetric matching

        // retrieve the matcher name
        const matcher_name = matcher_fn.getName(globalObject);

        const matcher_params = CustomMatcherParamsFormatter{
            .colors = Output.enable_ansi_colors,
            .globalObject = globalObject,
            .matcher_fn = matcher_fn,
        };

        // retrieve the captured expected value
        var value = Expect.capturedValueGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: failed to retrieve the captured value", .{});
            return .zero;
        };
        value = Expect.processPromise(expect.flags, globalObject, value, matcher_name, matcher_params, false) orelse return .zero;
        value.ensureStillAlive();

        incrementExpectCallCounter();

        // prepare the args array
        const args_ptr = callFrame.argumentsPtr();
        const args_count = callFrame.argumentsCount();
        var allocator = std.heap.stackFallback(8 * @sizeOf(JSValue), globalObject.allocator());
        var matcher_args = std.ArrayList(JSValue).initCapacity(allocator.get(), args_count + 1) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
        matcher_args.appendAssumeCapacity(value);
        for (0..args_count) |i| matcher_args.appendAssumeCapacity(args_ptr[i]);

        // call the matcher, which will throw a js exception when failed
        _ = executeCustomMatcher(globalObject, matcher_name, matcher_fn, matcher_args.items, expect.flags, false);

        return thisValue;
    }

    pub const assertions = notImplementedStaticFn;
    pub const hasAssertions = notImplementedStaticFn;
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

    pub fn doUnreachable(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arg = callframe.arguments(1).ptr[0];

        if (arg.isEmptyOrUndefinedOrNull()) {
            const error_value = bun.String.init("reached unreachable code").toErrorInstance(globalObject);
            error_value.put(globalObject, ZigString.static("name"), bun.String.init("UnreachableError").toJS(globalObject));
            globalObject.throwValue(error_value);
            return .zero;
        }

        if (arg.isString()) {
            const error_value = arg.toBunString(globalObject).toErrorInstance(globalObject);
            error_value.put(globalObject, ZigString.static("name"), bun.String.init("UnreachableError").toJS(globalObject));
            globalObject.throwValue(error_value);
            return .zero;
        }

        globalObject.throwValue(arg);
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

    pub fn create(globalObject: *JSC.JSGlobalObject, flags: Expect.Flags) JSValue {
        var expect = globalObject.bunVM().allocator.create(ExpectStatic) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
        expect.flags = flags;

        const value = expect.toJS(globalObject);
        value.ensureStillAlive();
        return value;
    }

    pub fn getNot(this: *ExpectStatic, _: JSValue, globalObject: *JSGlobalObject) callconv(.C) JSValue {
        var flags = this.flags;
        flags.not = !this.flags.not;
        return create(globalObject, flags);
    }

    pub fn getResolvesTo(this: *ExpectStatic, _: JSValue, globalObject: *JSGlobalObject) callconv(.C) JSValue {
        var flags = this.flags;
        if (flags.promise != .none) return asyncChainingError(globalObject, flags, "resolvesTo");
        flags.promise = .resolves;
        return create(globalObject, flags);
    }

    pub fn getRejectsTo(this: *ExpectStatic, _: JSValue, globalObject: *JSGlobalObject) callconv(.C) JSValue {
        var flags = this.flags;
        if (flags.promise != .none) return asyncChainingError(globalObject, flags, "rejectsTo");
        flags.promise = .rejects;
        return create(globalObject, flags);
    }

    fn asyncChainingError(globalObject: *JSGlobalObject, flags: Expect.Flags, name: string) JSValue {
        @setCold(true);
        const str = switch (flags.promise) {
            .resolves => "resolvesTo",
            .rejects => "rejectsTo",
            else => unreachable,
        };
        globalObject.throw("expect.{s}: already called expect.{s} on this chain", .{ name, str });
        return .zero;
    }

    fn createAsymmetricMatcherWithFlags(T: anytype, this: *ExpectStatic, globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) JSValue {
        //const this: *ExpectStatic = ExpectStatic.fromJS(callFrame.this());
        const instance_jsvalue = T.call(globalObject, callFrame);
        if (!instance_jsvalue.isEmpty() and !instance_jsvalue.isAnyError()) {
            var instance = T.fromJS(instance_jsvalue) orelse {
                globalObject.throwOutOfMemory();
                return .zero;
            };
            instance.flags = this.flags;
        }
        return instance_jsvalue;
    }

    pub fn anything(this: *ExpectStatic, globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return createAsymmetricMatcherWithFlags(ExpectAnything, this, globalObject, callFrame);
    }

    pub fn any(this: *ExpectStatic, globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return createAsymmetricMatcherWithFlags(ExpectAny, this, globalObject, callFrame);
    }

    pub fn arrayContaining(this: *ExpectStatic, globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return createAsymmetricMatcherWithFlags(ExpectArrayContaining, this, globalObject, callFrame);
    }

    pub fn closeTo(this: *ExpectStatic, globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return createAsymmetricMatcherWithFlags(ExpectCloseTo, this, globalObject, callFrame);
    }

    pub fn objectContaining(this: *ExpectStatic, globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return createAsymmetricMatcherWithFlags(ExpectObjectContaining, this, globalObject, callFrame);
    }

    pub fn stringContaining(this: *ExpectStatic, globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return createAsymmetricMatcherWithFlags(ExpectStringContaining, this, globalObject, callFrame);
    }

    pub fn stringMatching(this: *ExpectStatic, globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return createAsymmetricMatcherWithFlags(ExpectStringMatching, this, globalObject, callFrame);
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

    pub fn call(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        const anything = globalObject.bunVM().allocator.create(ExpectAnything) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
        anything.* = .{};

        const anything_js_value = anything.toJS(globalObject);
        anything_js_value.ensureStillAlive();

        var vm = globalObject.bunVM();
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

    pub fn call(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(1).slice();

        if (args.len == 0 or (!args[0].isString() and !args[0].isRegExp())) {
            const fmt = "<d>expect.<r>stringContaining<d>(<r>string<d>)<r>\n\nExpected a string or regular expression\n";
            globalObject.throwPretty(fmt, .{});
            return .zero;
        }

        const test_value = args[0];

        const string_matching = globalObject.bunVM().allocator.create(ExpectStringMatching) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
        string_matching.* = .{};

        const string_matching_js_value = string_matching.toJS(globalObject);
        ExpectStringMatching.testValueSetCached(string_matching_js_value, globalObject, test_value);

        var vm = globalObject.bunVM();
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

    pub fn call(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(2).slice();

        if (args.len == 0 or !args[0].isNumber()) {
            globalObject.throwPretty("<d>expect.<r>closeTo<d>(<r>number<d>, precision?)<r>\n\nExpected a number value", .{});
            return .zero;
        }
        const number_value = args[0];

        var precision_value = if (args.len > 1) args[1] else JSValue.undefined;
        if (precision_value.isUndefined()) {
            precision_value = JSValue.jsNumberFromInt32(2); // default value from jest
        }
        if (!precision_value.isNumber()) {
            globalObject.throwPretty("<d>expect.<r>closeTo<d>(number, <r>precision?<d>)<r>\n\nPrecision must be a number or undefined", .{});
            return .zero;
        }

        const instance = globalObject.bunVM().allocator.create(ExpectCloseTo) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
        instance.* = .{};

        const instance_jsvalue = instance.toJS(globalObject);
        number_value.ensureStillAlive();
        precision_value.ensureStillAlive();
        ExpectCloseTo.numberValueSetCached(instance_jsvalue, globalObject, number_value);
        ExpectCloseTo.digitsValueSetCached(instance_jsvalue, globalObject, precision_value);

        var vm = globalObject.bunVM();
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

    pub fn call(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(1).slice();

        if (args.len == 0 or !args[0].isObject()) {
            const fmt = "<d>expect.<r>objectContaining<d>(<r>object<d>)<r>\n\nExpected an object\n";
            globalObject.throwPretty(fmt, .{});
            return .zero;
        }

        const object_value = args[0];

        const instance = globalObject.bunVM().allocator.create(ExpectObjectContaining) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
        instance.* = .{};

        const instance_jsvalue = instance.toJS(globalObject);
        ExpectObjectContaining.objectValueSetCached(instance_jsvalue, globalObject, object_value);

        var vm = globalObject.bunVM();
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

    pub fn call(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(1).slice();

        if (args.len == 0 or !args[0].isString()) {
            const fmt = "<d>expect.<r>stringContaining<d>(<r>string<d>)<r>\n\nExpected a string\n";
            globalObject.throwPretty(fmt, .{});
            return .zero;
        }

        const string_value = args[0];

        const string_containing = globalObject.bunVM().allocator.create(ExpectStringContaining) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
        string_containing.* = .{};

        const string_containing_js_value = string_containing.toJS(globalObject);
        ExpectStringContaining.stringValueSetCached(string_containing_js_value, globalObject, string_value);

        var vm = globalObject.bunVM();
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

    pub fn call(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const _arguments = callFrame.arguments(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len == 0) {
            globalObject.throw("any() expects to be passed a constructor function. Please pass one or use anything() to match any object.", .{});
            return .zero;
        }

        const constructor = arguments[0];
        constructor.ensureStillAlive();
        if (!constructor.isConstructor()) {
            const fmt = "<d>expect.<r>any<d>(<r>constructor<d>)<r>\n\nExpected a constructor\n";
            globalObject.throwPretty(fmt, .{});
            return .zero;
        }

        var any = globalObject.bunVM().allocator.create(ExpectAny) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
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

pub const ExpectArrayContaining = struct {
    pub usingnamespace JSC.Codegen.JSExpectArrayContaining;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectArrayContaining,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callFrame.arguments(1).slice();

        if (args.len == 0 or !args[0].jsType().isArray()) {
            const fmt = "<d>expect.<r>arrayContaining<d>(<r>array<d>)<r>\n\nExpected a array\n";
            globalObject.throwPretty(fmt, .{});
            return .zero;
        }

        const array_value = args[0];

        const array_containing = globalObject.bunVM().allocator.create(ExpectArrayContaining) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
        array_containing.* = .{};

        const array_containing_js_value = array_containing.toJS(globalObject);
        ExpectArrayContaining.arrayValueSetCached(array_containing_js_value, globalObject, array_value);

        var vm = globalObject.bunVM();
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
    pub fn create(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame, matcher_fn: JSValue) callconv(.C) JSValue {
        var flags: Expect.Flags = undefined;

        // try to retrieve the ExpectStatic instance (to get the flags)
        if (ExpectStatic.fromJS(callFrame.this())) |expect_static| {
            flags = expect_static.flags;
        } else {
            // if it's not an ExpectStatic instance, assume it was called from the Expect constructor, so use the default flags
            flags = .{};
        }

        // create the matcher instance
        const instance = globalObject.bunVM().allocator.create(ExpectCustomAsymmetricMatcher) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
        instance.* = .{};

        const instance_jsvalue = instance.toJS(globalObject);
        instance_jsvalue.ensureStillAlive();

        // store the flags
        instance.flags = flags;

        // store the user-provided matcher function into the instance
        ExpectCustomAsymmetricMatcher.matcherFnSetCached(instance_jsvalue, globalObject, matcher_fn);

        // capture the args as a JS array saved in the instance, so the matcher can be executed later on with them
        const args_ptr = callFrame.argumentsPtr();
        const args_count: usize = callFrame.argumentsCount();
        var args = JSValue.createEmptyArray(globalObject, args_count);
        for (0..args_count) |i| {
            args.putIndex(globalObject, @truncate(i), args_ptr[i]);
        }
        args.ensureStillAlive();
        ExpectCustomAsymmetricMatcher.capturedArgsSetCached(instance_jsvalue, globalObject, args);

        // return the same instance, now fully initialized including the captured args (previously it was incomplete)
        return instance_jsvalue;
    }

    /// Function called by c++ function "matchAsymmetricMatcher" to execute the custom matcher against the provided leftValue
    pub fn execute(this: *ExpectCustomAsymmetricMatcher, thisValue: JSValue, globalObject: *JSC.JSGlobalObject, received: JSValue) callconv(.C) bool {
        // retrieve the user-provided matcher implementation function (the function passed to expect.extend({ ... }))
        const matcher_fn: JSValue = ExpectCustomAsymmetricMatcher.matcherFnGetCached(thisValue) orelse {
            globalObject.throw("Internal consistency error: the ExpectCustomAsymmetricMatcher(matcherFn) was garbage collected but it should not have been!", .{});
            return false;
        };
        matcher_fn.ensureStillAlive();
        if (!matcher_fn.jsType().isFunction()) {
            globalObject.throw("Internal consistency error: the ExpectCustomMatcher(matcherFn) is not a function!", .{});
            return false;
        }

        // retrieve the matcher name
        const matcher_name = matcher_fn.getName(globalObject);

        // retrieve the asymmetric matcher args
        // if null, it means the function has not yet been called to capture the args, which is a misuse of the matcher
        const captured_args: JSValue = ExpectCustomAsymmetricMatcher.capturedArgsGetCached(thisValue) orelse {
            globalObject.throw("expect.{s} misused, it needs to be instantiated by calling it with 0 or more arguments", .{matcher_name});
            return false;
        };
        captured_args.ensureStillAlive();

        // prepare the args array as `[received, ...captured_args]`
        const args_count = captured_args.getLength(globalObject);
        var allocator = std.heap.stackFallback(8 * @sizeOf(JSValue), globalObject.allocator());
        var matcher_args = std.ArrayList(JSValue).initCapacity(allocator.get(), args_count + 1) catch {
            globalObject.throwOutOfMemory();
            return false;
        };
        matcher_args.appendAssumeCapacity(received);
        for (0..args_count) |i| {
            matcher_args.appendAssumeCapacity(captured_args.getIndex(globalObject, @truncate(i)));
        }

        return Expect.executeCustomMatcher(globalObject, matcher_name, matcher_fn, matcher_args.items, this.flags, true);
    }

    pub fn asymmetricMatch(this: *ExpectCustomAsymmetricMatcher, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(1).slice();
        const received_value = if (arguments.len < 1) JSC.JSValue.jsUndefined() else arguments[0];
        const matched = execute(this, callframe.this(), globalObject, received_value);
        return JSValue.jsBoolean(matched);
    }

    /// Calls a custom implementation (if provided) to stringify this asymmetric matcher, and returns true if it was provided and it succeed
    pub fn customPrint(_: *ExpectCustomAsymmetricMatcher, thisValue: JSValue, globalObject: *JSC.JSGlobalObject, writer: anytype, comptime dontThrow: bool) !bool {
        const matcher_fn: JSValue = ExpectCustomAsymmetricMatcher.matcherFnGetCached(thisValue) orelse return false;
        if (matcher_fn.get(globalObject, "toAsymmetricMatcher")) |fn_value| {
            if (fn_value.jsType().isFunction()) {
                const captured_args: JSValue = ExpectCustomAsymmetricMatcher.capturedArgsGetCached(thisValue) orelse return false;
                var stack_fallback = std.heap.stackFallback(256, globalObject.allocator());
                const args_len = captured_args.getLength(globalObject);
                var args = try std.ArrayList(JSValue).initCapacity(stack_fallback.get(), args_len);
                var iter = captured_args.arrayIterator(globalObject);
                while (iter.next()) |arg| {
                    args.appendAssumeCapacity(arg);
                }

                var result = matcher_fn.callWithThis(globalObject, thisValue, args.items);
                if (result.toError()) |err| {
                    if (dontThrow) {
                        return false;
                    } else {
                        globalObject.throwValue(globalObject, err);
                        return error.JSError;
                    }
                }
                try writer.print("{}", .{result.toBunString(globalObject)});
            }
        }
        return false;
    }

    pub fn toAsymmetricMatcher(this: *ExpectCustomAsymmetricMatcher, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        var stack_fallback = std.heap.stackFallback(512, globalObject.allocator());
        var mutable_string = bun.MutableString.init2048(stack_fallback.get()) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
        defer mutable_string.deinit();

        const printed = customPrint(this, callframe.this(), globalObject, mutable_string.writer()) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
        if (printed) {
            return bun.String.init(mutable_string.toOwnedSliceLeaky()).toJS();
        }
        return ExpectMatcherUtils.printValue(globalObject, this, null);
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

    pub fn getUtils(_: *ExpectMatcherContext, globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        return ExpectMatcherUtils__getSingleton(globalObject);
    }

    pub fn getIsNot(this: *ExpectMatcherContext, _: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        return JSValue.jsBoolean(this.flags.not);
    }

    pub fn getPromise(this: *ExpectMatcherContext, globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        return switch (this.flags.promise) {
            .rejects => bun.String.static("rejects").toJS(globalObject),
            .resolves => bun.String.static("resolves").toJS(globalObject),
            else => bun.String.empty.toJS(globalObject),
        };
    }

    pub fn getExpand(_: *ExpectMatcherContext, globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        _ = globalObject;
        // TODO: this should return whether running tests in verbose mode or not (jest flag --expand), but bun currently doesn't have this switch
        return JSValue.false;
    }

    pub fn equals(_: *ExpectMatcherContext, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        var arguments = callframe.arguments(3);
        if (arguments.len < 2) {
            globalObject.throw("expect.extends matcher: this.util.equals expects at least 2 arguments", .{});
            return .zero;
        }
        const args = arguments.slice();
        return JSValue.jsBoolean(args[0].deepEquals(args[1], globalObject));
    }
};

/// Reference: `MatcherUtils` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
pub const ExpectMatcherUtils = struct {
    pub usingnamespace JSC.Codegen.JSExpectMatcherUtils;

    fn createSingleton(globalObject: *JSC.JSGlobalObject) callconv(.C) JSValue {
        var instance = globalObject.bunVM().allocator.create(ExpectMatcherUtils) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
        return instance.toJS(globalObject);
    }

    pub fn finalize(
        this: *ExpectMatcherUtils,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    fn printValue(globalObject: *JSC.JSGlobalObject, value: JSValue, comptime color_or_null: ?[]const u8) !JSValue {
        var stack_fallback = std.heap.stackFallback(512, globalObject.allocator());
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
            .globalThis = globalObject,
            .quote_strings = true,
        };
        try writer.print("{}", .{value.toFmt(globalObject, &formatter)});

        if (comptime color_or_null) |_| {
            if (Output.enable_ansi_colors) {
                try writer.writeAll(Output.prettyFmt("<r>", true));
            }
        }

        try buffered_writer.flush();

        return bun.String.createUTF8(mutable_string.toOwnedSlice()).toJS(globalObject);
    }

    inline fn printValueCatched(globalObject: *JSC.JSGlobalObject, value: JSValue, comptime color_or_null: ?[]const u8) JSValue {
        return printValue(globalObject, value, color_or_null) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
    }

    pub fn stringify(_: *ExpectMatcherUtils, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const arguments = callframe.arguments(1).slice();
        const value = if (arguments.len < 1) JSC.JSValue.jsUndefined() else arguments[0];
        return printValueCatched(globalObject, value, null);
    }

    pub fn printExpected(_: *ExpectMatcherUtils, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const arguments = callframe.arguments(1).slice();
        const value = if (arguments.len < 1) JSC.JSValue.jsUndefined() else arguments[0];
        return printValueCatched(globalObject, value, "<green>");
    }

    pub fn printReceived(_: *ExpectMatcherUtils, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const arguments = callframe.arguments(1).slice();
        const value = if (arguments.len < 1) JSC.JSValue.jsUndefined() else arguments[0];
        return printValueCatched(globalObject, value, "<red>");
    }

    pub fn matcherHint(_: *ExpectMatcherUtils, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const arguments = callframe.arguments(4).slice();

        if (arguments.len == 0 or !arguments[0].isString()) {
            globalObject.throw("matcherHint: the first argument (matcher name) must be a string", .{});
            return .zero;
        }
        const matcher_name = bun.String.init(arguments[0].toString(globalObject).getZigString(globalObject));

        const received = if (arguments.len > 1) arguments[1] else bun.String.static("received").toJS(globalObject);
        const expected = if (arguments.len > 2) arguments[2] else bun.String.static("expected").toJS(globalObject);
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
                globalObject.throw("matcherHint: options must be an object (or undefined)", .{});
                return .zero;
            }
            if (options.get(globalObject, "isNot")) |val| {
                is_not = val.toBoolean();
            }
            if (options.get(globalObject, "comment")) |val| {
                comment = val.toStringOrNull(globalObject);
            }
            if (options.get(globalObject, "promise")) |val| {
                promise = val.toStringOrNull(globalObject);
            }
            if (options.get(globalObject, "secondArgument")) |val| {
                second_argument = val.toStringOrNull(globalObject);
            }
        }

        const diff_formatter = DiffFormatter{
            .received = received,
            .expected = expected,
            .globalObject = globalObject,
            .not = is_not,
        };

        if (is_not) {
            const signature = comptime Expect.getSignature("{s}", "<green>expected<r>", true);
            const fmt = signature ++ "\n\n{any}\n";
            return JSValue.printStringPretty(globalObject, 2048, fmt, .{ matcher_name, diff_formatter }) catch {
                globalObject.throwOutOfMemory();
                return .zero;
            };
        } else {
            const signature = comptime Expect.getSignature("{s}", "<green>expected<r>", false);
            const fmt = signature ++ "\n\n{any}\n";
            return JSValue.printStringPretty(globalObject, 2048, fmt, .{ matcher_name, diff_formatter }) catch {
                globalObject.throwOutOfMemory();
                return .zero;
            };
        }
    }
};

// Extract the matcher_fn from a JSCustomExpectMatcherFunction instance
inline fn getCustomMatcherFn(thisValue: JSValue, globalObject: *JSGlobalObject) ?JSValue {
    var matcher_fn = Bun__JSWrappingFunction__getWrappedFunction(thisValue, globalObject);
    return if (matcher_fn.isEmpty()) null else matcher_fn;
}

/// JSValue.zero is used to indicate it was not a JSMockFunction
/// If there were no calls, it returns an empty JSArray*
extern fn JSMockFunction__getCalls(JSValue) JSValue;

/// JSValue.zero is used to indicate it was not a JSMockFunction
/// If there were no calls, it returns an empty JSArray*
extern fn JSMockFunction__getReturns(JSValue) JSValue;

extern fn Bun__JSWrappingFunction__create(globalObject: *JSC.JSGlobalObject, symbolName: *const ZigString, functionPointer: JSC.JSHostFunctionPtr, wrappedFn: JSValue, strong: bool) JSValue;
extern fn Bun__JSWrappingFunction__getWrappedFunction(this: JSC.JSValue, globalObject: *JSC.JSGlobalObject) JSValue;

extern fn ExpectMatcherUtils__getSingleton(globalObject: *JSC.JSGlobalObject) JSC.JSValue;

extern fn Expect__getPrototype(globalObject: *JSC.JSGlobalObject) JSC.JSValue;
extern fn ExpectStatic__getPrototype(globalObject: *JSC.JSGlobalObject) JSC.JSValue;

comptime {
    @export(ExpectMatcherUtils.createSingleton, .{ .name = "ExpectMatcherUtils_createSigleton" });
    @export(Expect.readFlagsAndProcessPromise, .{ .name = "Expect_readFlagsAndProcessPromise" });
    @export(ExpectCustomAsymmetricMatcher.execute, .{ .name = "ExpectCustomAsymmetricMatcher__execute" });
}

fn incrementExpectCallCounter() void {
    active_test_expectation_counter.actual += 1;
}
