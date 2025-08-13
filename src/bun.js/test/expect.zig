pub const Counter = struct {
    expected: u32 = 0,
    actual: u32 = 0,
};

pub var active_test_expectation_counter: Counter = .{};
pub var is_expecting_assertions: bool = false;
pub var is_expecting_assertions_count: bool = false;

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
    pub const js = jsc.Codegen.JSExpect;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

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

    pub const Flags = packed struct(u8) {
        // note: keep this struct in sync with C++ implementation (at bindings.cpp)

        promise: enum(u2) {
            none = 0,
            resolves = 1,
            rejects = 2,
        } = .none,

        not: bool = false,

        // This was originally padding.
        // We don't use all the bits in the u5, so if you need to reuse this elsewhere, you could.
        asymmetric_matcher_constructor_type: AsymmetricMatcherConstructorType = .none,

        pub const AsymmetricMatcherConstructorType = enum(u5) {
            none = 0,
            Symbol = 1,
            String = 2,
            Object = 3,
            Array = 4,
            BigInt = 5,
            Boolean = 6,
            Number = 7,
            Promise = 8,
            InstanceOf = 9,

            extern fn AsymmetricMatcherConstructorType__fromJS(globalObject: *JSGlobalObject, value: JSValue) i8;
            pub fn fromJS(globalObject: *JSGlobalObject, value: JSValue) bun.JSError!AsymmetricMatcherConstructorType {
                const result = AsymmetricMatcherConstructorType__fromJS(globalObject, value);
                if (result == -1) return error.JSError;
                return @enumFromInt(result);
            }
        };

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

    pub fn getSignature(comptime matcher_name: string, comptime args: string, comptime not: bool) [:0]const u8 {
        const received = "<d>expect(<r><red>received<r><d>).<r>";
        comptime if (not) {
            return received ++ "not<d>.<r>" ++ matcher_name ++ "<d>(<r>" ++ args ++ "<d>)<r>";
        };
        return received ++ matcher_name ++ "<d>(<r>" ++ args ++ "<d>)<r>";
    }

    pub fn throwPrettyMatcherError(globalThis: *JSGlobalObject, custom_label: bun.String, matcher_name: anytype, matcher_params: anytype, flags: Flags, comptime message_fmt: string, message_args: anytype) bun.JSError {
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
                            return globalThis.throwPretty(fmt, .{ chain, matcher_name, matcher_params } ++ message_args);
                        } else {
                            const fmt = comptime Output.prettyFmt("{}\n\n" ++ message_fmt, colors);
                            return globalThis.throwPretty(fmt, .{custom_label} ++ message_args);
                        }
                    },
                }
            },
        }
    }

    pub fn getNot(this: *Expect, thisValue: JSValue, _: *JSGlobalObject) JSValue {
        this.flags.not = !this.flags.not;
        return thisValue;
    }

    pub fn getResolves(this: *Expect, thisValue: JSValue, globalThis: *JSGlobalObject) bun.JSError!JSValue {
        this.flags.promise = switch (this.flags.promise) {
            .resolves, .none => .resolves,
            .rejects => {
                return globalThis.throw("Cannot chain .resolves() after .rejects()", .{});
            },
        };

        return thisValue;
    }

    pub fn getRejects(this: *Expect, thisValue: JSValue, globalThis: *JSGlobalObject) bun.JSError!JSValue {
        this.flags.promise = switch (this.flags.promise) {
            .none, .rejects => .rejects,
            .resolves => {
                return globalThis.throw("Cannot chain .rejects() after .resolves()", .{});
            },
        };

        return thisValue;
    }

    pub fn getValue(this: *Expect, globalThis: *JSGlobalObject, thisValue: JSValue, matcher_name: string, comptime matcher_params_fmt: string) bun.JSError!JSValue {
        const value = js.capturedValueGetCached(thisValue) orelse {
            return globalThis.throw("Internal error: the expect(value) was garbage collected but it should not have been!", .{});
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
    pub fn processPromise(custom_label: bun.String, flags: Expect.Flags, globalThis: *JSGlobalObject, value: JSValue, matcher_name: anytype, matcher_params: anytype, comptime silent: bool) bun.JSError!JSValue {
        switch (flags.promise) {
            inline .resolves, .rejects => |resolution| {
                if (value.asAnyPromise()) |promise| {
                    const vm = globalThis.vm();
                    promise.setHandled(vm);

                    globalThis.bunVM().waitForPromise(promise);

                    const newValue = promise.result(vm);
                    switch (promise.status(vm)) {
                        .fulfilled => switch (resolution) {
                            .resolves => {},
                            .rejects => {
                                if (!silent) {
                                    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
                                    defer formatter.deinit();
                                    const message = "Expected promise that rejects<r>\nReceived promise that resolved: <red>{any}<r>\n";
                                    return throwPrettyMatcherError(globalThis, custom_label, matcher_name, matcher_params, flags, message, .{value.toFmt(&formatter)});
                                }
                                return error.JSError;
                            },
                            .none => unreachable,
                        },
                        .rejected => switch (resolution) {
                            .rejects => {},
                            .resolves => {
                                if (!silent) {
                                    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
                                    defer formatter.deinit();
                                    const message = "Expected promise that resolves<r>\nReceived promise that rejected: <red>{any}<r>\n";
                                    return throwPrettyMatcherError(globalThis, custom_label, matcher_name, matcher_params, flags, message, .{value.toFmt(&formatter)});
                                }
                                return error.JSError;
                            },
                            .none => unreachable,
                        },
                        .pending => unreachable,
                    }

                    newValue.ensureStillAlive();
                    return newValue;
                } else {
                    if (!silent) {
                        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
                        defer formatter.deinit();
                        const message = "Expected promise<r>\nReceived: <red>{any}<r>\n";
                        return throwPrettyMatcherError(globalThis, custom_label, matcher_name, matcher_params, flags, message, .{value.toFmt(&formatter)});
                    }
                    return error.JSError;
                }
            },
            else => {},
        }

        return value;
    }

    pub fn isAsymmetricMatcher(value: JSValue) bool {
        if (ExpectCustomAsymmetricMatcher.fromJS(value) != null) return true;
        if (ExpectAny.fromJS(value) != null) return true;
        if (ExpectAnything.fromJS(value) != null) return true;
        if (ExpectStringMatching.fromJS(value) != null) return true;
        if (ExpectCloseTo.fromJS(value) != null) return true;
        if (ExpectObjectContaining.fromJS(value) != null) return true;
        if (ExpectStringContaining.fromJS(value) != null) return true;
        if (ExpectArrayContaining.fromJS(value) != null) return true;
        return false;
    }

    /// Called by C++ when matching with asymmetric matchers
    fn readFlagsAndProcessPromise(instanceValue: JSValue, globalThis: *JSGlobalObject, outFlags: *Expect.Flags.FlagsCppType, value: *JSValue, any_constructor_type: *u8) callconv(.C) bool {
        const flags: Expect.Flags = flags: {
            if (ExpectCustomAsymmetricMatcher.fromJS(instanceValue)) |instance| {
                break :flags instance.flags;
            } else if (ExpectAny.fromJS(instanceValue)) |instance| {
                any_constructor_type.* = @intFromEnum(instance.flags.asymmetric_matcher_constructor_type);
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
        value.* = processPromise(bun.String.empty, flags, globalThis, value.*, "", "", true) catch return false;
        return true;
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

    pub fn call(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(2).slice();
        const value = if (arguments.len < 1) .js_undefined else arguments[0];

        var custom_label = bun.String.empty;
        if (arguments.len > 1) {
            if (arguments[1].isString() or try arguments[1].implementsToString(globalThis)) {
                const label = try arguments[1].toBunString(globalThis);
                if (globalThis.hasException()) return .zero;
                custom_label = label;
            }
        }

        var expect = globalThis.bunVM().allocator.create(Expect) catch {
            custom_label.deref();
            return globalThis.throwOutOfMemory();
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
        js.capturedValueSetCached(expect_js_value, globalThis, value);
        expect_js_value.ensureStillAlive();

        expect.postMatch(globalThis);
        return expect_js_value;
    }

    pub fn throw(this: *Expect, globalThis: *JSGlobalObject, comptime signature: [:0]const u8, comptime fmt: [:0]const u8, args: anytype) bun.JSError {
        if (this.custom_label.isEmpty()) {
            return globalThis.throwPretty(signature ++ fmt, args);
        } else {
            return globalThis.throwPretty("{}" ++ fmt, .{this.custom_label} ++ args);
        }
    }

    pub fn constructor(globalThis: *JSGlobalObject, _: *CallFrame) bun.JSError!*Expect {
        return globalThis.throw("expect() cannot be called with new", .{});
    }

    // pass here has a leading underscore to avoid name collision with the pass variable in other functions
    pub fn _pass(
        this: *Expect,
        globalThis: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        defer this.postMatch(globalThis);

        const arguments_ = callFrame.arguments_old(1);
        const arguments = arguments_.slice();

        var _msg: ZigString = ZigString.Empty;

        if (arguments.len > 0) {
            const value = arguments[0];
            value.ensureStillAlive();

            if (!value.isString()) {
                return globalThis.throwInvalidArgumentType("pass", "message", "string");
            }

            try value.toZigString(&_msg, globalThis);
        } else {
            _msg = ZigString.fromBytes("passes by .pass() assertion");
        }

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = true;

        if (not) pass = !pass;
        if (pass) return .js_undefined;

        var msg = _msg.toSlice(default_allocator);
        defer msg.deinit();

        if (not) {
            const signature = comptime getSignature("pass", "", true);
            return this.throw(globalThis, signature, "\n\n{s}\n", .{msg.slice()});
        }

        // should never reach here
        return .zero;
    }

    pub fn fail(
        this: *Expect,
        globalThis: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        defer this.postMatch(globalThis);

        const arguments_ = callFrame.arguments_old(1);
        const arguments = arguments_.slice();

        var _msg: ZigString = ZigString.Empty;

        if (arguments.len > 0) {
            const value = arguments[0];
            value.ensureStillAlive();

            if (!value.isString()) {
                return globalThis.throwInvalidArgumentType("fail", "message", "string");
            }

            try value.toZigString(&_msg, globalThis);
        } else {
            _msg = ZigString.fromBytes("fails by .fail() assertion");
        }

        incrementExpectCallCounter();

        const not = this.flags.not;
        var pass = false;

        if (not) pass = !pass;
        if (pass) return .js_undefined;

        var msg = _msg.toSlice(default_allocator);
        defer msg.deinit();

        const signature = comptime getSignature("fail", "", true);
        return this.throw(globalThis, signature, "\n\n{s}\n", .{msg.slice()});
    }

    pub const toBe = @import("./expect/toBe.zig").toBe;
    pub const toBeArray = @import("./expect/toBeArray.zig").toBeArray;
    pub const toBeArrayOfSize = @import("./expect/toBeArrayOfSize.zig").toBeArrayOfSize;
    pub const toBeBoolean = @import("./expect/toBeBoolean.zig").toBeBoolean;
    pub const toBeCloseTo = @import("./expect/toBeCloseTo.zig").toBeCloseTo;
    pub const toBeDate = @import("./expect/toBeDate.zig").toBeDate;
    pub const toBeDefined = @import("./expect/toBeDefined.zig").toBeDefined;
    pub const toBeEmpty = @import("./expect/toBeEmpty.zig").toBeEmpty;
    pub const toBeEmptyObject = @import("./expect/toBeEmptyObject.zig").toBeEmptyObject;
    pub const toBeEven = @import("./expect/toBeEven.zig").toBeEven;
    pub const toBeFalse = @import("./expect/toBeFalse.zig").toBeFalse;
    pub const toBeFalsy = @import("./expect/toBeFalsy.zig").toBeFalsy;
    pub const toBeFinite = @import("./expect/toBeFinite.zig").toBeFinite;
    pub const toBeFunction = @import("./expect/toBeFunction.zig").toBeFunction;
    pub const toBeGreaterThan = @import("./expect/toBeGreaterThan.zig").toBeGreaterThan;
    pub const toBeGreaterThanOrEqual = @import("./expect/toBeGreaterThanOrEqual.zig").toBeGreaterThanOrEqual;
    pub const toBeInteger = @import("./expect/toBeInteger.zig").toBeInteger;
    pub const toBeLessThan = @import("./expect/toBeLessThan.zig").toBeLessThan;
    pub const toBeLessThanOrEqual = @import("./expect/toBeLessThanOrEqual.zig").toBeLessThanOrEqual;
    pub const toBeNaN = @import("./expect/toBeNaN.zig").toBeNaN;
    pub const toBeNegative = @import("./expect/toBeNegative.zig").toBeNegative;
    pub const toBeNil = @import("./expect/toBeNil.zig").toBeNil;
    pub const toBeNull = @import("./expect/toBeNull.zig").toBeNull;
    pub const toBeNumber = @import("./expect/toBeNumber.zig").toBeNumber;
    pub const toBeObject = @import("./expect/toBeObject.zig").toBeObject;
    pub const toBeOdd = @import("./expect/toBeOdd.zig").toBeOdd;
    pub const toBeOneOf = @import("./expect/toBeOneOf.zig").toBeOneOf;
    pub const toBePositive = @import("./expect/toBePositive.zig").toBePositive;
    pub const toBeString = @import("./expect/toBeString.zig").toBeString;
    pub const toBeSymbol = @import("./expect/toBeSymbol.zig").toBeSymbol;
    pub const toBeTrue = @import("./expect/toBeTrue.zig").toBeTrue;
    pub const toBeTruthy = @import("./expect/toBeTruthy.zig").toBeTruthy;
    pub const toBeTypeOf = @import("./expect/toBeTypeOf.zig").toBeTypeOf;
    pub const toBeUndefined = @import("./expect/toBeUndefined.zig").toBeUndefined;
    pub const toBeValidDate = @import("./expect/toBeValidDate.zig").toBeValidDate;
    pub const toBeWithin = @import("./expect/toBeWithin.zig").toBeWithin;
    pub const toContain = @import("./expect/toContain.zig").toContain;
    pub const toContainAllKeys = @import("./expect/toContainAllKeys.zig").toContainAllKeys;
    pub const toContainAllValues = @import("./expect/toContainAllValues.zig").toContainAllValues;
    pub const toContainAnyKeys = @import("./expect/toContainAnyKeys.zig").toContainAnyKeys;
    pub const toContainAnyValues = @import("./expect/toContainAnyValues.zig").toContainAnyValues;
    pub const toContainEqual = @import("./expect/toContainEqual.zig").toContainEqual;
    pub const toContainKey = @import("./expect/toContainKey.zig").toContainKey;
    pub const toContainKeys = @import("./expect/toContainKeys.zig").toContainKeys;
    pub const toContainValue = @import("./expect/toContainValue.zig").toContainValue;
    pub const toContainValues = @import("./expect/toContainValues.zig").toContainValues;
    pub const toEqual = @import("./expect/toEqual.zig").toEqual;
    pub const toEqualIgnoringWhitespace = @import("./expect/toEqualIgnoringWhitespace.zig").toEqualIgnoringWhitespace;
    pub const toHaveLength = @import("./expect/toHaveLength.zig").toHaveLength;
    pub const toHaveProperty = @import("./expect/toHaveProperty.zig").toHaveProperty;
    pub const toInclude = @import("./expect/toInclude.zig").toInclude;
    pub const toIncludeRepeated = @import("./expect/toIncludeRepeated.zig").toIncludeRepeated;
    pub const toMatchInlineSnapshot = @import("./expect/toMatchInlineSnapshot.zig").toMatchInlineSnapshot;
    pub const toMatchSnapshot = @import("./expect/toMatchSnapshot.zig").toMatchSnapshot;
    pub const toSatisfy = @import("./expect/toSatisfy.zig").toSatisfy;
    pub const toStrictEqual = @import("./expect/toStrictEqual.zig").toStrictEqual;
    pub const toThrow = @import("./expect/toThrow.zig").toThrow;
    pub const toThrowErrorMatchingInlineSnapshot = @import("./expect/toThrowErrorMatchingInlineSnapshot.zig").toThrowErrorMatchingInlineSnapshot;
    pub const toThrowErrorMatchingSnapshot = @import("./expect/toThrowErrorMatchingSnapshot.zig").toThrowErrorMatchingSnapshot;

    pub fn getValueAsToThrow(this: *Expect, globalThis: *JSGlobalObject, value: JSValue) bun.JSError!struct { ?JSValue, JSValue } {
        const vm = globalThis.bunVM();

        var return_value_from_function: JSValue = .zero;

        if (!value.jsType().isFunction()) {
            if (this.flags.promise != .none) {
                return .{ value, return_value_from_function };
            }

            return globalThis.throw("Expected value must be a function", .{});
        }

        var return_value: JSValue = .zero;

        // Drain existing unhandled rejections
        vm.global.handleRejectedPromises();

        var scope = vm.unhandledRejectionScope();
        const prev_unhandled_pending_rejection_to_capture = vm.unhandled_pending_rejection_to_capture;
        vm.unhandled_pending_rejection_to_capture = &return_value;
        vm.onUnhandledRejection = &VirtualMachine.onQuietUnhandledRejectionHandlerCaptureValue;
        return_value_from_function = value.call(globalThis, .js_undefined, &.{}) catch |err| globalThis.takeException(err);
        vm.unhandled_pending_rejection_to_capture = prev_unhandled_pending_rejection_to_capture;

        vm.global.handleRejectedPromises();

        if (return_value == .zero) {
            return_value = return_value_from_function;
        }

        if (return_value.asAnyPromise()) |promise| {
            vm.waitForPromise(promise);
            scope.apply(vm);
            switch (promise.unwrap(globalThis.vm(), .mark_handled)) {
                .fulfilled => {
                    return .{ null, return_value_from_function };
                },
                .rejected => |rejected| {
                    // since we know for sure it rejected, we should always return the error
                    return .{ rejected.toError() orelse rejected, return_value_from_function };
                },
                .pending => unreachable,
            }
        }

        if (return_value != return_value_from_function) {
            if (return_value_from_function.asAnyPromise()) |existing| {
                existing.setHandled(globalThis.vm());
            }
        }

        scope.apply(vm);

        return .{ return_value.toError() orelse return_value_from_function.toError(), return_value_from_function };
    }
    pub fn fnToErrStringOrUndefined(this: *Expect, globalThis: *JSGlobalObject, value: JSValue) !?JSValue {
        const err_value, _ = try this.getValueAsToThrow(globalThis, value);

        var err_value_res = err_value orelse return null;
        if (err_value_res.isAnyError()) {
            const message: JSValue = try err_value_res.getTruthyComptime(globalThis, "message") orelse .js_undefined;
            err_value_res = message;
        } else {
            err_value_res = .js_undefined;
        }
        return err_value_res;
    }
    const TrimResult = struct { trimmed: []const u8, start_indent: ?[]const u8, end_indent: ?[]const u8 };
    pub fn trimLeadingWhitespaceForInlineSnapshot(str_in: []const u8, trimmed_buf: []u8) TrimResult {
        std.debug.assert(trimmed_buf.len == str_in.len);
        var src = str_in;
        var dst = trimmed_buf[0..];
        const give_up_1: TrimResult = .{ .trimmed = str_in, .start_indent = null, .end_indent = null };
        // if the line is all whitespace, trim fully
        // the first line containing a character determines the max trim count

        // read first line (should be all-whitespace)
        const first_newline = std.mem.indexOf(u8, src, "\n") orelse return give_up_1;
        for (src[0..first_newline]) |char| if (char != ' ' and char != '\t') return give_up_1;
        src = src[first_newline + 1 ..];

        // read first real line and get indent
        const indent_len = for (src, 0..) |char, i| {
            if (char != ' ' and char != '\t') break i;
        } else src.len;
        const indent_str = src[0..indent_len];
        const give_up_2: TrimResult = .{ .trimmed = str_in, .start_indent = indent_str, .end_indent = indent_str };
        if (indent_len == 0) return give_up_2; // no indent to trim; save time
        // we're committed now
        dst[0] = '\n';
        dst = dst[1..];
        src = src[indent_len..];
        const second_newline = (std.mem.indexOf(u8, src, "\n") orelse return give_up_2) + 1;
        @memcpy(dst[0..second_newline], src[0..second_newline]);
        src = src[second_newline..];
        dst = dst[second_newline..];

        while (src.len > 0) {
            // try read indent
            const max_indent_len = @min(src.len, indent_len);
            const line_indent_len = for (src[0..max_indent_len], 0..) |char, i| {
                if (char != ' ' and char != '\t') break i;
            } else max_indent_len;
            src = src[line_indent_len..];

            if (line_indent_len < max_indent_len) {
                if (src.len == 0) {
                    // perfect; done
                    break;
                }
                if (src[0] == '\n') {
                    // this line has less indentation than the first line, but it's empty so that's okay.
                    dst[0] = '\n';
                    src = src[1..];
                    dst = dst[1..];
                    continue;
                }
                // this line had less indentation than the first line, but wasn't empty. give up.
                return give_up_2;
            } else {
                // this line has the same or more indentation than the first line. copy it.
                const line_newline = (std.mem.indexOf(u8, src, "\n") orelse {
                    // this is the last line. if it's not all whitespace, give up
                    for (src) |char| {
                        if (char != ' ' and char != '\t') return give_up_2;
                    }
                    break;
                }) + 1;
                @memcpy(dst[0..line_newline], src[0..line_newline]);
                src = src[line_newline..];
                dst = dst[line_newline..];
            }
        }
        const end_indent = if (std.mem.lastIndexOfScalar(u8, str_in, '\n')) |c| c + 1 else return give_up_2; // there has to have been at least a single newline to get here
        for (str_in[end_indent..]) |c| if (c != ' ' and c != '\t') return give_up_2; // we already checked, but the last line is not all whitespace again

        // done
        return .{ .trimmed = trimmed_buf[0 .. trimmed_buf.len - dst.len], .start_indent = indent_str, .end_indent = str_in[end_indent..] };
    }
    pub fn inlineSnapshot(
        this: *Expect,
        globalThis: *JSGlobalObject,
        callFrame: *CallFrame,
        value: JSValue,
        property_matchers: ?JSValue,
        result: ?[]const u8,
        comptime fn_name: []const u8,
    ) bun.JSError!JSValue {
        // jest counts inline snapshots towards the snapshot counter for some reason
        _ = Jest.runner.?.snapshots.addCount(this, "") catch |e| switch (e) {
            error.OutOfMemory => return error.OutOfMemory,
            error.NoTest => {},
        };

        const update = Jest.runner.?.snapshots.update_snapshots;
        var needs_write = false;

        var pretty_value: MutableString = try MutableString.init(default_allocator, 0);
        defer pretty_value.deinit();
        try this.matchAndFmtSnapshot(globalThis, value, property_matchers, &pretty_value, fn_name);

        var start_indent: ?[]const u8 = null;
        var end_indent: ?[]const u8 = null;
        if (result) |saved_value| {
            const buf = try Jest.runner.?.snapshots.allocator.alloc(u8, saved_value.len);
            defer Jest.runner.?.snapshots.allocator.free(buf);
            const trim_res = trimLeadingWhitespaceForInlineSnapshot(saved_value, buf);

            if (strings.eqlLong(pretty_value.slice(), trim_res.trimmed, true)) {
                Jest.runner.?.snapshots.passed += 1;
                return .js_undefined;
            } else if (update) {
                Jest.runner.?.snapshots.passed += 1;
                needs_write = true;
                start_indent = trim_res.start_indent;
                end_indent = trim_res.end_indent;
            } else {
                Jest.runner.?.snapshots.failed += 1;
                const signature = comptime getSignature(fn_name, "<green>expected<r>", false);
                const fmt = signature ++ "\n\n{any}\n";
                const diff_format = DiffFormatter{
                    .received_string = pretty_value.slice(),
                    .expected_string = trim_res.trimmed,
                    .globalThis = globalThis,
                };

                return globalThis.throwPretty(fmt, .{diff_format});
            }
        } else {
            needs_write = true;
        }

        if (needs_write) {
            if (this.testScope() == null) {
                const signature = comptime getSignature(fn_name, "", true);
                return this.throw(globalThis, signature, "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n", .{});
            }

            // 1. find the src loc of the snapshot
            const srcloc = callFrame.getCallerSrcLoc(globalThis);
            defer srcloc.str.deref();
            const describe = this.testScope().?.describe;
            const fget = Jest.runner.?.files.get(describe.file_id);

            if (!srcloc.str.eqlUTF8(fget.source.path.text)) {
                const signature = comptime getSignature(fn_name, "", true);
                return this.throw(globalThis, signature,
                    \\
                    \\
                    \\<b>Matcher error<r>: Inline snapshot matchers must be called from the test file:
                    \\  Expected to be called from file: <green>"{}"<r>
                    \\  {s} called from file: <red>"{}"<r>
                    \\
                , .{
                    std.zig.fmtEscapes(fget.source.path.text),
                    fn_name,
                    std.zig.fmtEscapes(srcloc.str.toUTF8(Jest.runner.?.snapshots.allocator).slice()),
                });
            }

            // 2. save to write later
            try Jest.runner.?.snapshots.addInlineSnapshotToWrite(describe.file_id, .{
                .line = srcloc.line,
                .col = srcloc.column,
                .value = pretty_value.toOwnedSlice(),
                .has_matchers = property_matchers != null,
                .is_added = result == null,
                .kind = fn_name,
                .start_indent = if (start_indent) |ind| try Jest.runner.?.snapshots.allocator.dupe(u8, ind) else null,
                .end_indent = if (end_indent) |ind| try Jest.runner.?.snapshots.allocator.dupe(u8, ind) else null,
            });
        }

        return .js_undefined;
    }
    pub fn matchAndFmtSnapshot(this: *Expect, globalThis: *JSGlobalObject, value: JSValue, property_matchers: ?JSValue, pretty_value: *MutableString, comptime fn_name: []const u8) bun.JSError!void {
        if (property_matchers) |_prop_matchers| {
            if (!value.isObject()) {
                const signature = comptime getSignature(fn_name, "<green>properties<r><d>, <r>hint", false);
                return this.throw(globalThis, signature, "\n\n<b>Matcher error: <red>received<r> values must be an object when the matcher has <green>properties<r>\n", .{});
            }

            const prop_matchers = _prop_matchers;

            if (!try value.jestDeepMatch(prop_matchers, globalThis, true)) {
                // TODO: print diff with properties from propertyMatchers
                const signature = comptime getSignature(fn_name, "<green>propertyMatchers<r>", false);
                const fmt = signature ++ "\n\nExpected <green>propertyMatchers<r> to match properties from received object" ++
                    "\n\nReceived: {any}\n";

                var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
                defer formatter.deinit();
                return globalThis.throwPretty(fmt, .{value.toFmt(&formatter)});
            }
        }

        value.jestSnapshotPrettyFormat(pretty_value, globalThis) catch {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
            defer formatter.deinit();
            return globalThis.throw("Failed to pretty format value: {s}", .{value.toFmt(&formatter)});
        };
    }
    pub fn snapshot(this: *Expect, globalThis: *JSGlobalObject, value: JSValue, property_matchers: ?JSValue, hint: []const u8, comptime fn_name: []const u8) bun.JSError!JSValue {
        var pretty_value: MutableString = try MutableString.init(default_allocator, 0);
        defer pretty_value.deinit();
        try this.matchAndFmtSnapshot(globalThis, value, property_matchers, &pretty_value, fn_name);

        const existing_value = Jest.runner.?.snapshots.getOrPut(this, pretty_value.slice(), hint) catch |err| {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
            defer formatter.deinit();
            const test_file_path = Jest.runner.?.files.get(this.testScope().?.describe.file_id).source.path.text;
            return switch (err) {
                error.FailedToOpenSnapshotFile => globalThis.throw("Failed to open snapshot file for test file: {s}", .{test_file_path}),
                error.FailedToMakeSnapshotDirectory => globalThis.throw("Failed to make snapshot directory for test file: {s}", .{test_file_path}),
                error.FailedToWriteSnapshotFile => globalThis.throw("Failed write to snapshot file: {s}", .{test_file_path}),
                error.SyntaxError, error.ParseError => globalThis.throw("Failed to parse snapshot file for: {s}", .{test_file_path}),
                else => globalThis.throw("Failed to snapshot value: {any}", .{value.toFmt(&formatter)}),
            };
        };

        if (existing_value) |saved_value| {
            if (strings.eqlLong(pretty_value.slice(), saved_value, true)) {
                Jest.runner.?.snapshots.passed += 1;
                return .js_undefined;
            }

            Jest.runner.?.snapshots.failed += 1;
            const signature = comptime getSignature(fn_name, "<green>expected<r>", false);
            const fmt = signature ++ "\n\n{any}\n";
            const diff_format = DiffFormatter{
                .received_string = pretty_value.slice(),
                .expected_string = saved_value,
                .globalThis = globalThis,
            };

            return globalThis.throwPretty(fmt, .{diff_format});
        }

        return .js_undefined;
    }

    pub fn toStartWith(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments_old(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            return globalThis.throwInvalidArguments("toStartWith() requires 1 argument", .{});
        }

        const expected = arguments[0];
        expected.ensureStillAlive();

        if (!expected.isString()) {
            return globalThis.throw("toStartWith() requires the first argument to be a string", .{});
        }

        const value: JSValue = try this.getValue(globalThis, thisValue, "toStartWith", "<green>expected<r>");

        incrementExpectCallCounter();

        var pass = value.isString();
        if (pass) {
            const value_string = try value.toSliceOrNull(globalThis);
            defer value_string.deinit();
            const expected_string = try expected.toSliceOrNull(globalThis);
            defer expected_string.deinit();
            pass = strings.startsWith(value_string.slice(), expected_string.slice()) or expected_string.len == 0;
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return .js_undefined;

        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();
        const value_fmt = value.toFmt(&formatter);
        const expected_fmt = expected.toFmt(&formatter);

        if (not) {
            const expected_line = "Expected to not start with: <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toStartWith", "<green>expected<r>", true);
            return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        }

        const expected_line = "Expected to start with: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toStartWith", "<green>expected<r>", false);
        return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
    }

    pub fn toEndWith(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const arguments_ = callFrame.arguments_old(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            return globalThis.throwInvalidArguments("toEndWith() requires 1 argument", .{});
        }

        const expected = arguments[0];
        expected.ensureStillAlive();

        if (!expected.isString()) {
            return globalThis.throw("toEndWith() requires the first argument to be a string", .{});
        }

        const value: JSValue = try this.getValue(globalThis, thisValue, "toEndWith", "<green>expected<r>");

        incrementExpectCallCounter();

        var pass = value.isString();
        if (pass) {
            const value_string = try value.toSliceOrNull(globalThis);
            defer value_string.deinit();
            const expected_string = try expected.toSliceOrNull(globalThis);
            defer expected_string.deinit();
            pass = strings.endsWith(value_string.slice(), expected_string.slice()) or expected_string.len == 0;
        }

        const not = this.flags.not;
        if (not) pass = !pass;

        if (pass) return .js_undefined;

        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();
        const value_fmt = value.toFmt(&formatter);
        const expected_fmt = expected.toFmt(&formatter);

        if (not) {
            const expected_line = "Expected to not end with: <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toEndWith", "<green>expected<r>", true);
            return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        }

        const expected_line = "Expected to end with: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toEndWith", "<green>expected<r>", false);
        return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
    }

    pub fn toBeInstanceOf(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments_old(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            return globalThis.throwInvalidArguments("toBeInstanceOf() requires 1 argument", .{});
        }

        incrementExpectCallCounter();
        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();

        const expected_value = arguments[0];
        if (!expected_value.isConstructor()) {
            return globalThis.throw("Expected value must be a function: {any}", .{expected_value.toFmt(&formatter)});
        }
        expected_value.ensureStillAlive();

        const value: JSValue = try this.getValue(globalThis, thisValue, "toBeInstanceOf", "<green>expected<r>");

        const not = this.flags.not;
        var pass = value.isInstanceOf(globalThis, expected_value);
        if (not) pass = !pass;
        if (pass) return .js_undefined;

        // handle failure
        const expected_fmt = expected_value.toFmt(&formatter);
        const value_fmt = value.toFmt(&formatter);
        if (not) {
            const expected_line = "Expected constructor: not <green>{any}<r>\n";
            const received_line = "Received value: <red>{any}<r>\n";
            const signature = comptime getSignature("toBeInstanceOf", "<green>expected<r>", true);
            return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        }

        const expected_line = "Expected constructor: <green>{any}<r>\n";
        const received_line = "Received value: <red>{any}<r>\n";
        const signature = comptime getSignature("toBeInstanceOf", "<green>expected<r>", false);
        return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
    }

    pub fn toMatch(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());

        defer this.postMatch(globalThis);

        const thisValue = callFrame.this();
        const _arguments = callFrame.arguments_old(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len < 1) {
            return globalThis.throwInvalidArguments("toMatch() requires 1 argument", .{});
        }

        incrementExpectCallCounter();

        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();

        const expected_value = arguments[0];
        if (!expected_value.isString() and !expected_value.isRegExp()) {
            return globalThis.throw("Expected value must be a string or regular expression: {any}", .{expected_value.toFmt(&formatter)});
        }
        expected_value.ensureStillAlive();

        const value: JSValue = try this.getValue(globalThis, thisValue, "toMatch", "<green>expected<r>");

        if (!value.isString()) {
            return globalThis.throw("Received value must be a string: {any}", .{value.toFmt(&formatter)});
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
        if (pass) return .js_undefined;

        // handle failure
        const expected_fmt = expected_value.toFmt(&formatter);
        const value_fmt = value.toFmt(&formatter);

        if (not) {
            const expected_line = "Expected substring or pattern: not <green>{any}<r>\n";
            const received_line = "Received: <red>{any}<r>\n";
            const signature = comptime getSignature("toMatch", "<green>expected<r>", true);
            return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
        }

        const expected_line = "Expected substring or pattern: <green>{any}<r>\n";
        const received_line = "Received: <red>{any}<r>\n";
        const signature = comptime getSignature("toMatch", "<green>expected<r>", false);
        return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
    }

    pub fn toHaveBeenCalled(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const thisValue = callframe.this();
        const firstArgument = callframe.argumentsAsArray(1)[0];
        defer this.postMatch(globalThis);

        if (!firstArgument.isUndefined()) {
            return globalThis.throwInvalidArguments("toHaveBeenCalled() must not have an argument", .{});
        }

        const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveBeenCalled", "");

        const calls = try bun.jsc.fromJSHostCall(globalThis, @src(), JSMockFunction__getCalls, .{value});
        incrementExpectCallCounter();
        if (!calls.jsType().isArray()) {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();
            return globalThis.throw("Expected value must be a mock function: {any}", .{value.toFmt(&formatter)});
        }

        const calls_length = try calls.getLength(globalThis);
        var pass = calls_length > 0;

        const not = this.flags.not;
        if (not) pass = !pass;
        if (pass) return .js_undefined;

        // handle failure
        if (not) {
            const signature = comptime getSignature("toHaveBeenCalled", "", true);
            return this.throw(globalThis, signature, "\n\n" ++ "Expected number of calls: <green>0<r>\n" ++ "Received number of calls: <red>{any}<r>\n", .{calls_length});
        }

        const signature = comptime getSignature("toHaveBeenCalled", "", false);
        return this.throw(globalThis, signature, "\n\n" ++ "Expected number of calls: \\>= <green>1<r>\n" ++ "Received number of calls: <red>{any}<r>\n", .{calls_length});
    }

    pub fn toHaveBeenCalledOnce(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());

        const thisValue = callframe.this();
        defer this.postMatch(globalThis);
        const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveBeenCalledOnce", "<green>expected<r>");

        incrementExpectCallCounter();

        const calls = try bun.jsc.fromJSHostCall(globalThis, @src(), JSMockFunction__getCalls, .{value});
        if (!calls.jsType().isArray()) {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();
            return globalThis.throw("Expected value must be a mock function: {any}", .{value.toFmt(&formatter)});
        }

        const calls_length = try calls.getLength(globalThis);
        var pass = calls_length == 1;

        const not = this.flags.not;
        if (not) pass = !pass;
        if (pass) return .js_undefined;

        // handle failure
        if (not) {
            const signature = comptime getSignature("toHaveBeenCalledOnce", "<green>expected<r>", true);
            return this.throw(globalThis, signature, "\n\n" ++ "Expected number of calls: not <green>1<r>\n" ++ "Received number of calls: <red>{d}<r>\n", .{calls_length});
        }

        const signature = comptime getSignature("toHaveBeenCalledOnce", "<green>expected<r>", false);
        return this.throw(globalThis, signature, "\n\n" ++ "Expected number of calls: <green>1<r>\n" ++ "Received number of calls: <red>{d}<r>\n", .{calls_length});
    }

    pub fn toHaveBeenCalledTimes(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());

        const thisValue = callframe.this();
        const arguments_ = callframe.arguments_old(1);
        const arguments: []const JSValue = arguments_.slice();
        defer this.postMatch(globalThis);
        const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveBeenCalledTimes", "<green>expected<r>");

        incrementExpectCallCounter();

        const calls = try bun.jsc.fromJSHostCall(globalThis, @src(), JSMockFunction__getCalls, .{value});
        if (!calls.jsType().isArray()) {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();
            return globalThis.throw("Expected value must be a mock function: {any}", .{value.toFmt(&formatter)});
        }

        if (arguments.len < 1 or !arguments[0].isUInt32AsAnyInt()) {
            return globalThis.throwInvalidArguments("toHaveBeenCalledTimes() requires 1 non-negative integer argument", .{});
        }

        const times = try arguments[0].coerce(i32, globalThis);

        var pass = @as(i32, @intCast(try calls.getLength(globalThis))) == times;

        const not = this.flags.not;
        if (not) pass = !pass;
        if (pass) return .js_undefined;

        // handle failure
        if (not) {
            const signature = comptime getSignature("toHaveBeenCalledTimes", "<green>expected<r>", true);
            return this.throw(globalThis, signature, "\n\n" ++ "Expected number of calls: not <green>{any}<r>\n" ++ "Received number of calls: <red>{any}<r>\n", .{ times, calls.getLength(globalThis) });
        }

        const signature = comptime getSignature("toHaveBeenCalledTimes", "<green>expected<r>", false);
        return this.throw(globalThis, signature, "\n\n" ++ "Expected number of calls: <green>{any}<r>\n" ++ "Received number of calls: <red>{any}<r>\n", .{ times, calls.getLength(globalThis) });
    }

    pub fn toMatchObject(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());

        defer this.postMatch(globalThis);
        const thisValue = callFrame.this();
        const args = callFrame.arguments_old(1).slice();

        incrementExpectCallCounter();

        const not = this.flags.not;

        const received_object: JSValue = try this.getValue(globalThis, thisValue, "toMatchObject", "<green>expected<r>");

        if (!received_object.isObject()) {
            const matcher_error = "\n\n<b>Matcher error<r>: <red>received<r> value must be a non-null object\n";
            if (not) {
                const signature = comptime getSignature("toMatchObject", "<green>expected<r>", true);
                return this.throw(globalThis, signature, matcher_error, .{});
            }

            const signature = comptime getSignature("toMatchObject", "<green>expected<r>", false);
            return this.throw(globalThis, signature, matcher_error, .{});
        }

        if (args.len < 1 or !args[0].isObject()) {
            const matcher_error = "\n\n<b>Matcher error<r>: <green>expected<r> value must be a non-null object\n";
            if (not) {
                const signature = comptime getSignature("toMatchObject", "", true);
                return this.throw(globalThis, signature, matcher_error, .{});
            }
            const signature = comptime getSignature("toMatchObject", "", false);
            return this.throw(globalThis, signature, matcher_error, .{});
        }

        const property_matchers = args[0];

        var pass = try received_object.jestDeepMatch(property_matchers, globalThis, true);

        if (not) pass = !pass;
        if (pass) return .js_undefined;

        // handle failure
        const diff_formatter = DiffFormatter{
            .received = received_object,
            .expected = property_matchers,
            .globalThis = globalThis,
            .not = not,
        };

        if (not) {
            const signature = comptime getSignature("toMatchObject", "<green>expected<r>", true);
            return this.throw(globalThis, signature, "\n\n{any}\n", .{diff_formatter});
        }

        const signature = comptime getSignature("toMatchObject", "<green>expected<r>", false);
        return this.throw(globalThis, signature, "\n\n{any}\n", .{diff_formatter});
    }

    pub fn toHaveBeenCalledWith(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());

        const thisValue = callframe.this();
        const arguments = callframe.arguments();
        defer this.postMatch(globalThis);
        const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveBeenCalledWith", "<green>...expected<r>");

        incrementExpectCallCounter();

        const calls = try bun.jsc.fromJSHostCall(globalThis, @src(), JSMockFunction__getCalls, .{value});
        if (!calls.jsType().isArray()) {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();
            return this.throw(globalThis, comptime getSignature("toHaveBeenCalledWith", "<green>...expected<r>", false), "\n\nMatcher error: <red>received<r> value must be a mock function\nReceived: {any}", .{value.toFmt(&formatter)});
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
            return this.throw(globalThis, signature, "\n\nExpected mock function not to have been called with: <green>{any}<r>\nBut it was.", .{
                expected_args_js_array.toFmt(&formatter),
            });
        }
        const signature = comptime getSignature("toHaveBeenCalledWith", "<green>...expected<r>", false);

        if (calls_count == 0) {
            return this.throw(globalThis, signature, "\n\nExpected: <green>{any}<r>\nBut it was not called.", .{
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
            return this.throw(globalThis, signature, "\n\n{any}\n", .{diff_format});
        }

        // If there are multiple calls, list them all to help debugging.
        const list_formatter = AllCallsWithArgsFormatter{
            .globalThis = globalThis,
            .calls = calls,
            .formatter = &formatter,
        };

        const fmt =
            \\    <green>Expected<r>: {any}
            \\    <red>Received<r>:
            \\{any}
            \\
            \\    Number of calls: {d}
        ;

        switch (Output.enable_ansi_colors) {
            inline else => |colors| {
                return this.throw(globalThis, signature, Output.prettyFmt("\n\n" ++ fmt ++ "\n", colors), .{
                    expected_args_js_array.toFmt(&formatter),
                    list_formatter,
                    calls_count,
                });
            },
        }
    }

    pub fn toHaveBeenLastCalledWith(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());

        const thisValue = callframe.this();
        const arguments = callframe.arguments();
        defer this.postMatch(globalThis);
        const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveBeenLastCalledWith", "<green>...expected<r>");

        incrementExpectCallCounter();

        const calls = try bun.jsc.fromJSHostCall(globalThis, @src(), JSMockFunction__getCalls, .{value});
        if (!calls.jsType().isArray()) {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();
            return this.throw(globalThis, comptime getSignature("toHaveBeenLastCalledWith", "<green>...expected<r>", false), "\n\nMatcher error: <red>received<r> value must be a mock function\nReceived: {any}", .{value.toFmt(&formatter)});
        }

        const totalCalls: u32 = @truncate(try calls.getLength(globalThis));
        var lastCallValue: JSValue = .zero;

        var pass = totalCalls > 0;

        if (pass) {
            lastCallValue = try calls.getIndex(globalThis, totalCalls - 1);

            if (!lastCallValue.jsType().isArray()) {
                var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
                defer formatter.deinit();
                return globalThis.throw("Expected value must be a mock function with calls: {any}", .{value.toFmt(&formatter)});
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
            return this.throw(globalThis, signature, "\n\nExpected last call not to be with: <green>{any}<r>\nBut it was.", .{
                expected_args_js_array.toFmt(&formatter),
            });
        }
        const signature = comptime getSignature("toHaveBeenLastCalledWith", "<green>...expected<r>", false);

        if (totalCalls == 0) {
            return this.throw(globalThis, signature, "\n\nExpected: <green>{any}<r>\nBut it was not called.", .{
                expected_args_js_array.toFmt(&formatter),
            });
        }

        const diff_format = DiffFormatter{
            .expected = expected_args_js_array,
            .received = lastCallValue,
            .globalThis = globalThis,
            .not = false,
        };
        return this.throw(globalThis, signature, "\n\n{any}\n", .{diff_format});
    }

    pub fn toHaveBeenNthCalledWith(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());

        const thisValue = callframe.this();
        const arguments = callframe.arguments();
        defer this.postMatch(globalThis);
        const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveBeenNthCalledWith", "<green>n<r>, <green>...expected<r>");

        incrementExpectCallCounter();

        const calls = try bun.jsc.fromJSHostCall(globalThis, @src(), JSMockFunction__getCalls, .{value});
        if (!calls.jsType().isArray()) {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();
            return this.throw(globalThis, comptime getSignature("toHaveBeenNthCalledWith", "<green>n<r>, <green>...expected<r>", false), "\n\nMatcher error: <red>received<r> value must be a mock function\nReceived: {any}", .{value.toFmt(&formatter)});
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
            return this.throw(globalThis, signature, "\n\nExpected call #{d} not to be with: <green>{any}<r>\nBut it was.", .{
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
        return this.throw(globalThis, signature, "\n\nCall #{d}:\n{any}\n", .{ nthCallNum, diff_format });
    }

    const AllCallsWithArgsFormatter = struct {
        globalThis: *JSGlobalObject,
        calls: JSValue,
        formatter: *jsc.ConsoleObject.Formatter,

        pub fn format(self: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            var printed_once = false;

            const calls_count = @as(u32, @intCast(try self.calls.getLength(self.globalThis)));
            if (calls_count == 0) {
                try writer.writeAll("(no calls)");
                return;
            }

            for (0..calls_count) |i| {
                if (printed_once) try writer.writeAll("\n");
                printed_once = true;

                try writer.print("           {d: >4}: ", .{i + 1});
                const call_args = try self.calls.getIndex(self.globalThis, @intCast(i));
                try writer.print("{any}", .{call_args.toFmt(self.formatter)});
            }
        }
    };

    const ReturnStatus = enum {
        throw,
        @"return",
        incomplete,

        pub const Map = bun.ComptimeEnumMap(ReturnStatus);
    };

    fn jestMockIterator(globalThis: *JSGlobalObject, value: bun.jsc.JSValue) bun.JSError!bun.jsc.JSArrayIterator {
        const returns: bun.jsc.JSValue = try bun.cpp.JSMockFunction__getReturns(globalThis, value);
        if (!returns.jsType().isArray()) {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();
            return globalThis.throw("Expected value must be a mock function: {any}", .{value.toFmt(&formatter)});
        }

        return try returns.arrayIterator(globalThis);
    }
    fn jestMockReturnObject_type(globalThis: *JSGlobalObject, value: bun.jsc.JSValue) bun.JSError!ReturnStatus {
        if (try value.fastGet(globalThis, .type)) |type_string| {
            if (type_string.isString()) {
                if (try ReturnStatus.Map.fromJS(globalThis, type_string)) |val| return val;
            }
        }
        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();
        return globalThis.throw("Expected value must be a mock function with returns: {any}", .{value.toFmt(&formatter)});
    }
    fn jestMockReturnObject_value(globalThis: *JSGlobalObject, value: bun.jsc.JSValue) bun.JSError!JSValue {
        return (try value.get(globalThis, "value")) orelse .js_undefined;
    }

    inline fn toHaveReturnedTimesFn(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame, comptime mode: enum { toHaveReturned, toHaveReturnedTimes }) bun.JSError!JSValue {
        jsc.markBinding(@src());

        const thisValue = callframe.this();
        const arguments = callframe.arguments();
        defer this.postMatch(globalThis);

        const value: JSValue = try this.getValue(globalThis, thisValue, @tagName(mode), "<green>expected<r>");

        incrementExpectCallCounter();

        var returns = try jestMockIterator(globalThis, value);

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
            switch (try jestMockReturnObject_type(globalThis, item)) {
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

    // Formatter for when there are multiple returns or errors
    const AllCallsFormatter = struct {
        globalThis: *JSGlobalObject,
        returns: JSValue,
        formatter: *jsc.ConsoleObject.Formatter,

        pub fn format(self: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            var printed_once = false;

            var num_returns: i32 = 0;
            var num_calls: i32 = 0;

            var iter = try self.returns.arrayIterator(self.globalThis);
            while (try iter.next()) |item| {
                if (printed_once) try writer.writeAll("\n");
                printed_once = true;

                num_calls += 1;
                try writer.print("           {d: >2}: ", .{num_calls});

                const value = try jestMockReturnObject_value(self.globalThis, item);
                switch (try jestMockReturnObject_type(self.globalThis, item)) {
                    .@"return" => {
                        try writer.print("{any}", .{value.toFmt(self.formatter)});
                        num_returns += 1;
                    },
                    .throw => {
                        try writer.print("function call threw an error: {any}", .{value.toFmt(self.formatter)});
                    },
                    .incomplete => {
                        try writer.print("<incomplete call>", .{});
                    },
                }
            }
        }
    };

    const SuccessfulReturnsFormatter = struct {
        globalThis: *JSGlobalObject,
        successful_returns: *const std.ArrayList(JSValue),
        formatter: *jsc.ConsoleObject.Formatter,

        pub fn format(self: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const len = self.successful_returns.items.len;
            if (len == 0) return;

            var printed_once = false;

            for (self.successful_returns.items, 1..) |val, i| {
                if (printed_once) try writer.writeAll("\n");
                printed_once = true;

                try writer.print("           {d: >4}: ", .{i});
                try writer.print("{any}", .{val.toFmt(self.formatter)});
            }
        }
    };

    pub fn toHaveReturnedWith(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());

        const thisValue = callframe.this();
        defer this.postMatch(globalThis);

        const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveReturnedWith", "<green>expected<r>");

        const expected = callframe.argumentsAsArray(1)[0];
        incrementExpectCallCounter();

        const returns = try bun.cpp.JSMockFunction__getReturns(globalThis, value);
        if (!returns.jsType().isArray()) {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();
            return globalThis.throw("Expected value must be a mock function: {any}", .{value.toFmt(&formatter)});
        }

        const calls_count = @as(u32, @intCast(try returns.getLength(globalThis)));
        var pass = false;

        var successful_returns = std.ArrayList(JSValue).init(globalThis.bunVM().allocator);
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
            return this.throw(globalThis, not_signature, "\n\n" ++ "Expected mock function not to have returned: <green>{any}<r>\n", .{expected.toFmt(&formatter)});
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
                return this.throw(globalThis, signature, "\n\n{any}\n", .{diff_format});
            }

            return this.throw(globalThis, signature, "\n\nExpected: <green>{any}<r>\nReceived: <red>{any}<r>", .{
                expected.toFmt(&formatter),
                received.toFmt(&formatter),
            });
        }

        if (has_errors) {
            // Case: Some calls errored
            const list_formatter = AllCallsFormatter{
                .globalThis = globalThis,
                .returns = returns,
                .formatter = &formatter,
            };
            const fmt =
                \\Some calls errored:
                \\
                \\    Expected: {any}
                \\    Received:
                \\{any}
                \\
                \\    Number of returns: {d}
                \\    Number of calls:   {d}
            ;

            switch (Output.enable_ansi_colors) {
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
            const list_formatter = SuccessfulReturnsFormatter{
                .globalThis = globalThis,
                .successful_returns = &successful_returns,
                .formatter = &formatter,
            };
            const fmt =
                \\    <green>Expected<r>: {any}
                \\    <red>Received<r>:
                \\{any}
                \\
                \\    Number of returns: {d}
            ;

            switch (Output.enable_ansi_colors) {
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

    pub fn toHaveLastReturnedWith(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());

        const thisValue = callframe.this();
        defer this.postMatch(globalThis);

        const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveBeenLastReturnedWith", "<green>expected<r>");

        const expected = callframe.argumentsAsArray(1)[0];
        incrementExpectCallCounter();

        const returns = try bun.cpp.JSMockFunction__getReturns(globalThis, value);
        if (!returns.jsType().isArray()) {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();
            return globalThis.throw("Expected value must be a mock function: {any}", .{value.toFmt(&formatter)});
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
            return this.throw(globalThis, comptime getSignature("toHaveBeenLastReturnedWith", "<green>expected<r>", true), "\n\n" ++ "Expected mock function not to have last returned: <green>{any}<r>\n" ++ "But it did.\n", .{expected.toFmt(&formatter)});
        }

        if (calls_count == 0) {
            return this.throw(globalThis, signature, "\n\n" ++ "The mock function was not called.", .{});
        }

        if (last_call_threw) {
            return this.throw(globalThis, signature, "\n\n" ++ "The last call threw an error: <red>{any}<r>\n", .{last_error_value.toFmt(&formatter)});
        }

        // Diff if possible
        if (expected.isString() and last_return_value.isString()) {
            const diff_format = DiffFormatter{ .expected = expected, .received = last_return_value, .globalThis = globalThis, .not = false };
            return this.throw(globalThis, signature, "\n\n{any}\n", .{diff_format});
        }

        return this.throw(globalThis, signature, "\n\nExpected: <green>{any}<r>\nReceived: <red>{any}<r>", .{ expected.toFmt(&formatter), last_return_value.toFmt(&formatter) });
    }
    pub fn toHaveNthReturnedWith(this: *Expect, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const thisValue = callframe.this();
        defer this.postMatch(globalThis);
        const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveNthReturnedWith", "<green>n<r>, <green>expected<r>");

        const nth_arg, const expected = callframe.argumentsAsArray(2);

        // Validate n is a number
        if (!nth_arg.isAnyInt()) {
            return globalThis.throwInvalidArguments("toHaveNthReturnedWith() first argument must be an integer", .{});
        }

        const n = nth_arg.toInt32();
        if (n <= 0) {
            return globalThis.throwInvalidArguments("toHaveNthReturnedWith() n must be greater than 0", .{});
        }

        incrementExpectCallCounter();
        const returns = try bun.cpp.JSMockFunction__getReturns(globalThis, value);
        if (!returns.jsType().isArray()) {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();
            return globalThis.throw("Expected value must be a mock function: {any}", .{value.toFmt(&formatter)});
        }

        const calls_count = @as(u32, @intCast(try returns.getLength(globalThis)));
        const index = @as(u32, @intCast(n - 1)); // Convert to 0-based index

        var pass = false;
        var nth_return_value: JSValue = .js_undefined;
        var nth_call_threw = false;
        var nth_error_value: JSValue = .js_undefined;
        var nth_call_exists = false;

        if (index < calls_count) {
            nth_call_exists = true;
            const nth_result = returns.getDirectIndex(globalThis, index);
            if (nth_result.isObject()) {
                const result_type = try nth_result.get(globalThis, "type") orelse .js_undefined;
                if (result_type.isString()) {
                    const type_str = try result_type.toBunString(globalThis);
                    defer type_str.deref();
                    if (type_str.eqlComptime("return")) {
                        nth_return_value = try nth_result.get(globalThis, "value") orelse .js_undefined;
                        if (try nth_return_value.jestDeepEquals(expected, globalThis)) {
                            pass = true;
                        }
                    } else if (type_str.eqlComptime("throw")) {
                        nth_call_threw = true;
                        nth_error_value = try nth_result.get(globalThis, "value") orelse .js_undefined;
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

        const signature = comptime getSignature("toHaveNthReturnedWith", "<green>n<r>, <green>expected<r>", false);

        if (this.flags.not) {
            return this.throw(globalThis, comptime getSignature("toHaveNthReturnedWith", "<green>n<r>, <green>expected<r>", true), "\n\n" ++ "Expected mock function not to have returned on call {d}: <green>{any}<r>\n" ++ "But it did.\n", .{ n, expected.toFmt(&formatter) });
        }

        if (!nth_call_exists) {
            return this.throw(globalThis, signature, "\n\n" ++ "The mock function was called {d} time{s}, but call {d} was requested.\n", .{ calls_count, if (calls_count == 1) "" else "s", n });
        }

        if (nth_call_threw) {
            return this.throw(globalThis, signature, "\n\n" ++ "Call {d} threw an error: <red>{any}<r>\n", .{ n, nth_error_value.toFmt(&formatter) });
        }

        // Diff if possible
        if (expected.isString() and nth_return_value.isString()) {
            const diff_format = DiffFormatter{ .expected = expected, .received = nth_return_value, .globalThis = globalThis, .not = false };
            return this.throw(globalThis, signature, "\n\nCall {d}:\n{any}\n", .{ n, diff_format });
        }

        return this.throw(globalThis, signature, "\n\nCall {d}:\nExpected: <green>{any}<r>\nReceived: <red>{any}<r>", .{ n, expected.toFmt(&formatter), nth_return_value.toFmt(&formatter) });
    }

    pub fn getStaticNot(globalThis: *JSGlobalObject, _: JSValue, _: JSValue) bun.JSError!JSValue {
        return ExpectStatic.create(globalThis, .{ .not = true });
    }

    pub fn getStaticResolvesTo(globalThis: *JSGlobalObject, _: JSValue, _: JSValue) bun.JSError!JSValue {
        return ExpectStatic.create(globalThis, .{ .promise = .resolves });
    }

    pub fn getStaticRejectsTo(globalThis: *JSGlobalObject, _: JSValue, _: JSValue) bun.JSError!JSValue {
        return ExpectStatic.create(globalThis, .{ .promise = .rejects });
    }

    pub fn any(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        return ExpectAny.call(globalThis, callFrame);
    }

    pub fn anything(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        return ExpectAnything.call(globalThis, callFrame);
    }

    pub fn closeTo(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        return ExpectCloseTo.call(globalThis, callFrame);
    }

    pub fn objectContaining(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        return ExpectObjectContaining.call(globalThis, callFrame);
    }

    pub fn stringContaining(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        return ExpectStringContaining.call(globalThis, callFrame);
    }

    pub fn stringMatching(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        return ExpectStringMatching.call(globalThis, callFrame);
    }

    pub fn arrayContaining(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        return ExpectArrayContaining.call(globalThis, callFrame);
    }

    /// Implements `expect.extend({ ... })`
    pub fn extend(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        const args = callFrame.arguments_old(1).slice();

        if (args.len == 0 or !args[0].isObject()) {
            return globalThis.throwPretty("<d>expect.<r>extend<d>(<r>matchers<d>)<r>\n\nExpected an object containing matchers\n", .{});
        }

        var expect_proto = Expect__getPrototype(globalThis);
        var expect_constructor = Expect.js.getConstructor(globalThis);
        var expect_static_proto = ExpectStatic__getPrototype(globalThis);

        // SAFETY: already checked that args[0] is an object
        const matchers_to_register = args[0].getObject().?;
        {
            var iter = try jsc.JSPropertyIterator(.{
                .skip_empty_name = false,
                .include_value = true,
                .own_properties_only = false,
            }).init(globalThis, matchers_to_register);
            defer iter.deinit();

            while (try iter.next()) |*matcher_name| {
                const matcher_fn: JSValue = iter.value;

                if (!matcher_fn.jsType().isFunction()) {
                    const type_name = if (matcher_fn.isNull()) bun.String.static("null") else bun.String.init(matcher_fn.jsTypeString(globalThis).getZigString(globalThis));
                    return globalThis.throwInvalidArguments("expect.extend: `{s}` is not a valid matcher. Must be a function, is \"{s}\"", .{ matcher_name, type_name });
                }

                // Mutate the Expect/ExpectStatic prototypes/constructor with new instances of JSCustomExpectMatcherFunction.
                // Even though they point to the same native functions for all matchers,
                // multiple instances are created because each instance will hold the matcher_fn as a property

                const wrapper_fn = Bun__JSWrappingFunction__create(globalThis, matcher_name, jsc.toJSHostFn(Expect.applyCustomMatcher), matcher_fn, true);

                expect_proto.put(globalThis, matcher_name, wrapper_fn);
                expect_constructor.put(globalThis, matcher_name, wrapper_fn);
                expect_static_proto.put(globalThis, matcher_name, wrapper_fn);
            }
        }

        globalThis.bunVM().autoGarbageCollect();

        return .js_undefined;
    }

    const CustomMatcherParamsFormatter = struct {
        colors: bool,
        globalThis: *JSGlobalObject,
        matcher_fn: JSValue,

        pub fn format(this: CustomMatcherParamsFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            // try to detect param names from matcher_fn (user function) source code
            if (jsc.JSFunction.getSourceCode(this.matcher_fn)) |source_str| {
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

    fn throwInvalidMatcherError(globalThis: *JSGlobalObject, matcher_name: bun.String, result: JSValue) bun.JSError {
        @branchHint(.cold);

        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();

        const fmt =
            "Unexpected return from matcher function `{s}`.\n" ++
            "Matcher functions should return an object in the following format:\n" ++
            "  {{message?: string | function, pass: boolean}}\n" ++
            "'{any}' was returned";
        const err = switch (Output.enable_ansi_colors) {
            inline else => |colors| globalThis.createErrorInstance(Output.prettyFmt(fmt, colors), .{ matcher_name, result.toFmt(&formatter) }),
        };
        err.put(globalThis, ZigString.static("name"), bun.String.static("InvalidMatcherError").toJS(globalThis));
        return globalThis.throwValue(err);
    }

    /// Execute the custom matcher for the given args (the left value + the args passed to the matcher call).
    /// This function is called both for symmetric and asymmetric matching.
    /// If silent=false, throws an exception in JS if the matcher result didn't result in a pass (or if the matcher result is invalid).
    pub fn executeCustomMatcher(globalThis: *JSGlobalObject, matcher_name: bun.String, matcher_fn: JSValue, args: []const JSValue, flags: Expect.Flags, silent: bool) bun.JSError!bool {
        // prepare the this object
        const matcher_context = try globalThis.bunVM().allocator.create(ExpectMatcherContext);
        matcher_context.flags = flags;
        const matcher_context_jsvalue = matcher_context.toJS(globalThis);
        matcher_context_jsvalue.ensureStillAlive();

        // call the custom matcher implementation
        var result = try matcher_fn.call(globalThis, matcher_context_jsvalue, args);
        // support for async matcher results
        if (result.asAnyPromise()) |promise| {
            const vm = globalThis.vm();
            promise.setHandled(vm);

            globalThis.bunVM().waitForPromise(promise);

            result = promise.result(vm);
            result.ensureStillAlive();
            assert(result != .zero);
            switch (promise.status(vm)) {
                .pending => unreachable,
                .fulfilled => {},
                .rejected => {
                    // TODO: rewrite this code to use .then() instead of blocking the event loop
                    jsc.VirtualMachine.get().runErrorHandler(result, null);
                    return globalThis.throw("Matcher `{s}` returned a promise that rejected", .{matcher_name});
                },
            }
        }

        var pass: bool = undefined;
        var message: JSValue = undefined;

        // Parse and validate the custom matcher result, which should conform to: { pass: boolean, message?: () => string }
        const is_valid = valid: {
            if (result.isObject()) {
                if (try result.get(globalThis, "pass")) |pass_value| {
                    pass = pass_value.toBoolean();

                    if (try result.fastGet(globalThis, .message)) |message_value| {
                        if (!message_value.isString() and !message_value.isCallable()) {
                            break :valid false;
                        }
                        message = message_value;
                    } else {
                        message = .js_undefined;
                    }

                    break :valid true;
                }
            }
            break :valid false;
        };
        if (!is_valid) {
            return throwInvalidMatcherError(globalThis, matcher_name, result);
        }

        if (flags.not) pass = !pass;
        if (pass or silent) return pass;

        // handle failure
        var message_text: bun.String = bun.String.dead;
        defer message_text.deref();
        if (message.isUndefined()) {
            message_text = bun.String.static("No message was specified for this matcher.");
        } else if (message.isString()) {
            message_text = try message.toBunString(globalThis);
        } else {
            if (comptime Environment.allow_assert)
                assert(message.isCallable()); // checked above

            const message_result = try message.callWithGlobalThis(globalThis, &.{});
            message_text = try bun.String.fromJS(message_result, globalThis);
        }

        const matcher_params = CustomMatcherParamsFormatter{
            .colors = Output.enable_ansi_colors,
            .globalThis = globalThis,
            .matcher_fn = matcher_fn,
        };
        return throwPrettyMatcherError(globalThis, bun.String.empty, matcher_name, matcher_params, .{}, "{s}", .{message_text});
    }

    /// Function that is run for either `expect.myMatcher()` call or `expect().myMatcher` call,
    /// and we can known which case it is based on if the `callFrame.this()` value is an instance of Expect
    pub fn applyCustomMatcher(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!jsc.JSValue {
        defer globalThis.bunVM().autoGarbageCollect();

        // retrieve the user-provided matcher function (matcher_fn)
        const func: JSValue = callFrame.callee();
        var matcher_fn: JSValue = getCustomMatcherFn(func, globalThis) orelse .js_undefined;
        if (!matcher_fn.jsType().isFunction()) {
            return globalThis.throw("Internal consistency error: failed to retrieve the matcher function for a custom matcher!", .{});
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
        var value = js.capturedValueGetCached(thisValue) orelse {
            return globalThis.throw("Internal consistency error: failed to retrieve the captured value", .{});
        };
        value = try processPromise(expect.custom_label, expect.flags, globalThis, value, matcher_name, matcher_params, false);
        value.ensureStillAlive();

        incrementExpectCallCounter();

        // prepare the args array
        const args = callFrame.arguments();
        var allocator = std.heap.stackFallback(8 * @sizeOf(JSValue), globalThis.allocator());
        var matcher_args = try std.ArrayList(JSValue).initCapacity(allocator.get(), args.len + 1);
        matcher_args.appendAssumeCapacity(value);
        for (args) |arg| matcher_args.appendAssumeCapacity(arg);

        _ = try executeCustomMatcher(globalThis, matcher_name, matcher_fn, matcher_args.items, expect.flags, false);

        return thisValue;
    }

    pub const addSnapshotSerializer = notImplementedStaticFn;

    pub fn hasAssertions(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        _ = callFrame;
        defer globalThis.bunVM().autoGarbageCollect();

        is_expecting_assertions = true;

        return .js_undefined;
    }

    pub fn assertions(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        defer globalThis.bunVM().autoGarbageCollect();

        const arguments_ = callFrame.arguments_old(1);
        const arguments = arguments_.slice();

        if (arguments.len < 1) {
            return globalThis.throwInvalidArguments("expect.assertions() takes 1 argument", .{});
        }

        const expected: JSValue = arguments[0];

        if (!expected.isNumber()) {
            var fmt = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            return globalThis.throw("Expected value must be a non-negative integer: {any}", .{expected.toFmt(&fmt)});
        }

        const expected_assertions: f64 = try expected.toNumber(globalThis);
        if (@round(expected_assertions) != expected_assertions or std.math.isInf(expected_assertions) or std.math.isNan(expected_assertions) or expected_assertions < 0 or expected_assertions > std.math.maxInt(u32)) {
            var fmt = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            return globalThis.throw("Expected value must be a non-negative integer: {any}", .{expected.toFmt(&fmt)});
        }

        const unsigned_expected_assertions: u32 = @intFromFloat(expected_assertions);

        is_expecting_assertions_count = true;
        active_test_expectation_counter.expected = unsigned_expected_assertions;

        return .js_undefined;
    }

    pub fn notImplementedJSCFn(_: *Expect, globalThis: *JSGlobalObject, _: *CallFrame) bun.JSError!JSValue {
        return globalThis.throw("Not implemented", .{});
    }

    pub fn notImplementedStaticFn(globalThis: *JSGlobalObject, _: *CallFrame) bun.JSError!JSValue {
        return globalThis.throw("Not implemented", .{});
    }

    pub fn notImplementedJSCProp(_: *Expect, _: JSValue, globalThis: *JSGlobalObject) bun.JSError!JSValue {
        return globalThis.throw("Not implemented", .{});
    }

    pub fn notImplementedStaticProp(globalThis: *JSGlobalObject, _: JSValue, _: JSValue) bun.JSError!JSValue {
        return globalThis.throw("Not implemented", .{});
    }

    pub fn postMatch(_: *Expect, globalThis: *JSGlobalObject) void {
        var vm = globalThis.bunVM();
        vm.autoGarbageCollect();
    }

    pub fn doUnreachable(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        const arg = callframe.arguments_old(1).ptr[0];

        if (arg.isEmptyOrUndefinedOrNull()) {
            const error_value = bun.String.init("reached unreachable code").toErrorInstance(globalThis);
            error_value.put(globalThis, ZigString.static("name"), bun.String.init("UnreachableError").toJS(globalThis));
            return globalThis.throwValue(error_value);
        }

        if (arg.isString()) {
            const error_value = (try arg.toBunString(globalThis)).toErrorInstance(globalThis);
            error_value.put(globalThis, ZigString.static("name"), bun.String.init("UnreachableError").toJS(globalThis));
            return globalThis.throwValue(error_value);
        }

        return globalThis.throwValue(arg);
    }
};

/// Static instance of expect, holding a set of flags.
/// Returned for example when executing `expect.not`
pub const ExpectStatic = struct {
    pub const js = jsc.Codegen.JSExpectStatic;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectStatic,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn create(globalThis: *JSGlobalObject, flags: Expect.Flags) bun.JSError!JSValue {
        var expect = try globalThis.bunVM().allocator.create(ExpectStatic);
        expect.flags = flags;

        const value = expect.toJS(globalThis);
        value.ensureStillAlive();
        return value;
    }

    pub fn getNot(this: *ExpectStatic, _: JSValue, globalThis: *JSGlobalObject) bun.JSError!JSValue {
        var flags = this.flags;
        flags.not = !this.flags.not;
        return create(globalThis, flags);
    }

    pub fn getResolvesTo(this: *ExpectStatic, _: JSValue, globalThis: *JSGlobalObject) bun.JSError!JSValue {
        var flags = this.flags;
        if (flags.promise != .none) return asyncChainingError(globalThis, flags, "resolvesTo");
        flags.promise = .resolves;
        return create(globalThis, flags);
    }

    pub fn getRejectsTo(this: *ExpectStatic, _: JSValue, globalThis: *JSGlobalObject) bun.JSError!JSValue {
        var flags = this.flags;
        if (flags.promise != .none) return asyncChainingError(globalThis, flags, "rejectsTo");
        flags.promise = .rejects;
        return create(globalThis, flags);
    }

    fn asyncChainingError(globalThis: *JSGlobalObject, flags: Expect.Flags, name: string) bun.JSError {
        @branchHint(.cold);
        const str = switch (flags.promise) {
            .resolves => "resolvesTo",
            .rejects => "rejectsTo",
            else => unreachable,
        };
        return globalThis.throw("expect.{s}: already called expect.{s} on this chain", .{ name, str });
    }

    fn createAsymmetricMatcherWithFlags(T: type, this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        //const this: *ExpectStatic = ExpectStatic.fromJS(callFrame.this());
        const instance_jsvalue = try T.call(globalThis, callFrame);
        if (instance_jsvalue != .zero and !instance_jsvalue.isAnyError()) {
            var instance = T.fromJS(instance_jsvalue) orelse {
                return globalThis.throwOutOfMemory();
            };
            instance.flags = this.flags;
        }
        return instance_jsvalue;
    }

    pub fn anything(this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        return createAsymmetricMatcherWithFlags(ExpectAnything, this, globalThis, callFrame);
    }

    pub fn any(this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        return createAsymmetricMatcherWithFlags(ExpectAny, this, globalThis, callFrame);
    }

    pub fn arrayContaining(this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        return createAsymmetricMatcherWithFlags(ExpectArrayContaining, this, globalThis, callFrame);
    }

    pub fn closeTo(this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        return createAsymmetricMatcherWithFlags(ExpectCloseTo, this, globalThis, callFrame);
    }

    pub fn objectContaining(this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        return createAsymmetricMatcherWithFlags(ExpectObjectContaining, this, globalThis, callFrame);
    }

    pub fn stringContaining(this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        return createAsymmetricMatcherWithFlags(ExpectStringContaining, this, globalThis, callFrame);
    }

    pub fn stringMatching(this: *ExpectStatic, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        return createAsymmetricMatcherWithFlags(ExpectStringMatching, this, globalThis, callFrame);
    }
};

pub const ExpectAnything = struct {
    pub const js = jsc.Codegen.JSExpectAnything;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectAnything,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalThis: *JSGlobalObject, _: *CallFrame) bun.JSError!JSValue {
        const anything = try globalThis.bunVM().allocator.create(ExpectAnything);
        anything.* = .{};

        const anything_js_value = anything.toJS(globalThis);
        anything_js_value.ensureStillAlive();

        var vm = globalThis.bunVM();
        vm.autoGarbageCollect();

        return anything_js_value;
    }
};

pub const ExpectStringMatching = struct {
    pub const js = jsc.Codegen.JSExpectStringMatching;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectStringMatching,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        const args = callFrame.arguments();

        if (args.len == 0 or (!args[0].isString() and !args[0].isRegExp())) {
            const fmt = "<d>expect.<r>stringContaining<d>(<r>string<d>)<r>\n\nExpected a string or regular expression\n";
            return globalThis.throwPretty(fmt, .{});
        }

        const test_value = args[0];

        const string_matching = try globalThis.bunVM().allocator.create(ExpectStringMatching);
        string_matching.* = .{};

        const string_matching_js_value = string_matching.toJS(globalThis);
        js.testValueSetCached(string_matching_js_value, globalThis, test_value);

        var vm = globalThis.bunVM();
        vm.autoGarbageCollect();
        return string_matching_js_value;
    }
};

pub const ExpectCloseTo = struct {
    pub const js = jsc.Codegen.JSExpectCloseTo;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectCloseTo,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        const args = callFrame.arguments_old(2).slice();

        if (args.len == 0 or !args[0].isNumber()) {
            return globalThis.throwPretty("<d>expect.<r>closeTo<d>(<r>number<d>, precision?)<r>\n\nExpected a number value", .{});
        }
        const number_value = args[0];

        var precision_value: JSValue = if (args.len > 1) args[1] else .js_undefined;
        if (precision_value.isUndefined()) {
            precision_value = JSValue.jsNumberFromInt32(2); // default value from jest
        }
        if (!precision_value.isNumber()) {
            return globalThis.throwPretty("<d>expect.<r>closeTo<d>(number, <r>precision?<d>)<r>\n\nPrecision must be a number or undefined", .{});
        }

        const instance = try globalThis.bunVM().allocator.create(ExpectCloseTo);
        instance.* = .{};

        const instance_jsvalue = instance.toJS(globalThis);
        number_value.ensureStillAlive();
        precision_value.ensureStillAlive();
        ExpectCloseTo.js.numberValueSetCached(instance_jsvalue, globalThis, number_value);
        ExpectCloseTo.js.digitsValueSetCached(instance_jsvalue, globalThis, precision_value);

        var vm = globalThis.bunVM();
        vm.autoGarbageCollect();
        return instance_jsvalue;
    }
};

pub const ExpectObjectContaining = struct {
    pub const js = jsc.Codegen.JSExpectObjectContaining;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectObjectContaining,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        const args = callFrame.arguments_old(1).slice();

        if (args.len == 0 or !args[0].isObject()) {
            const fmt = "<d>expect.<r>objectContaining<d>(<r>object<d>)<r>\n\nExpected an object\n";
            return globalThis.throwPretty(fmt, .{});
        }

        const object_value = args[0];

        const instance = try globalThis.bunVM().allocator.create(ExpectObjectContaining);
        instance.* = .{};

        const instance_jsvalue = instance.toJS(globalThis);
        ExpectObjectContaining.js.objectValueSetCached(instance_jsvalue, globalThis, object_value);

        var vm = globalThis.bunVM();
        vm.autoGarbageCollect();
        return instance_jsvalue;
    }
};

pub const ExpectStringContaining = struct {
    pub const js = jsc.Codegen.JSExpectStringContaining;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectStringContaining,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        const args = callFrame.arguments_old(1).slice();

        if (args.len == 0 or !args[0].isString()) {
            const fmt = "<d>expect.<r>stringContaining<d>(<r>string<d>)<r>\n\nExpected a string\n";
            return globalThis.throwPretty(fmt, .{});
        }

        const string_value = args[0];

        const string_containing = try globalThis.bunVM().allocator.create(ExpectStringContaining);
        string_containing.* = .{};

        const string_containing_js_value = string_containing.toJS(globalThis);
        ExpectStringContaining.js.stringValueSetCached(string_containing_js_value, globalThis, string_value);

        var vm = globalThis.bunVM();
        vm.autoGarbageCollect();
        return string_containing_js_value;
    }
};

pub const ExpectAny = struct {
    pub const js = jsc.Codegen.JSExpectAny;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    flags: Expect.Flags = .{},

    pub fn finalize(this: *ExpectAny) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        const _arguments = callFrame.arguments_old(1);
        const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

        if (arguments.len == 0) {
            return globalThis.throw("any() expects to be passed a constructor function. Please pass one or use anything() to match any object.", .{});
        }

        const constructor = arguments[0];
        constructor.ensureStillAlive();
        if (!constructor.isConstructor()) {
            const fmt = "<d>expect.<r>any<d>(<r>constructor<d>)<r>\n\nExpected a constructor\n";
            return globalThis.throwPretty(fmt, .{});
        }

        const asymmetric_matcher_constructor_type = try Expect.Flags.AsymmetricMatcherConstructorType.fromJS(globalThis, constructor);

        // I don't think this case is possible, but just in case!
        if (globalThis.hasException()) {
            return error.JSError;
        }

        var any = try globalThis.bunVM().allocator.create(ExpectAny);
        any.* = .{
            .flags = .{
                .asymmetric_matcher_constructor_type = asymmetric_matcher_constructor_type,
            },
        };

        const any_js_value = any.toJS(globalThis);
        any_js_value.ensureStillAlive();
        ExpectAny.js.constructorValueSetCached(any_js_value, globalThis, constructor);
        any_js_value.ensureStillAlive();

        var vm = globalThis.bunVM();
        vm.autoGarbageCollect();

        return any_js_value;
    }
};

pub const ExpectArrayContaining = struct {
    pub const js = jsc.Codegen.JSExpectArrayContaining;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectArrayContaining,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn call(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        const args = callFrame.arguments_old(1).slice();

        if (args.len == 0 or !args[0].jsType().isArray()) {
            const fmt = "<d>expect.<r>arrayContaining<d>(<r>array<d>)<r>\n\nExpected a array\n";
            return globalThis.throwPretty(fmt, .{});
        }

        const array_value = args[0];

        const array_containing = try globalThis.bunVM().allocator.create(ExpectArrayContaining);
        array_containing.* = .{};

        const array_containing_js_value = array_containing.toJS(globalThis);
        ExpectArrayContaining.js.arrayValueSetCached(array_containing_js_value, globalThis, array_value);

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
    pub const js = jsc.Codegen.JSExpectCustomAsymmetricMatcher;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectCustomAsymmetricMatcher,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    /// Implements the static call of the custom matcher (`expect.myCustomMatcher(<args>)`),
    /// which creates an asymmetric matcher instance (`ExpectCustomAsymmetricMatcher`).
    /// This will not run the matcher, but just capture the args etc.
    pub fn create(globalThis: *JSGlobalObject, callFrame: *CallFrame, matcher_fn: JSValue) bun.JSError!JSValue {
        var flags: Expect.Flags = undefined;

        // try to retrieve the ExpectStatic instance (to get the flags)
        if (ExpectStatic.fromJS(callFrame.this())) |expect_static| {
            flags = expect_static.flags;
        } else {
            // if it's not an ExpectStatic instance, assume it was called from the Expect constructor, so use the default flags
            flags = .{};
        }

        // create the matcher instance
        const instance = try globalThis.bunVM().allocator.create(ExpectCustomAsymmetricMatcher);
        instance.* = .{};

        const instance_jsvalue = instance.toJS(globalThis);
        instance_jsvalue.ensureStillAlive();

        // store the flags
        instance.flags = flags;

        // store the user-provided matcher function into the instance
        js.matcherFnSetCached(instance_jsvalue, globalThis, matcher_fn);

        // capture the args as a JS array saved in the instance, so the matcher can be executed later on with them
        const args = callFrame.arguments();
        const array = try JSValue.createEmptyArray(globalThis, args.len);
        for (args, 0..) |arg, i| {
            try array.putIndex(globalThis, @truncate(i), arg);
        }
        js.capturedArgsSetCached(instance_jsvalue, globalThis, array);
        array.ensureStillAlive();

        // return the same instance, now fully initialized including the captured args (previously it was incomplete)
        return instance_jsvalue;
    }

    /// Function called by c++ function "matchAsymmetricMatcher" to execute the custom matcher against the provided leftValue
    pub fn execute(this: *ExpectCustomAsymmetricMatcher, thisValue: JSValue, globalThis: *JSGlobalObject, received: JSValue) callconv(.C) bool {
        // retrieve the user-provided matcher implementation function (the function passed to expect.extend({ ... }))
        const matcher_fn: JSValue = js.matcherFnGetCached(thisValue) orelse {
            globalThis.throw("Internal consistency error: the ExpectCustomAsymmetricMatcher(matcherFn) was garbage collected but it should not have been!", .{}) catch {};
            return false;
        };
        matcher_fn.ensureStillAlive();
        if (!matcher_fn.jsType().isFunction()) {
            globalThis.throw("Internal consistency error: the ExpectCustomMatcher(matcherFn) is not a function!", .{}) catch {};
            return false;
        }

        // retrieve the matcher name
        const matcher_name = matcher_fn.getName(globalThis);

        // retrieve the asymmetric matcher args
        // if null, it means the function has not yet been called to capture the args, which is a misuse of the matcher
        const captured_args: JSValue = js.capturedArgsGetCached(thisValue) orelse {
            globalThis.throw("expect.{s} misused, it needs to be instantiated by calling it with 0 or more arguments", .{matcher_name}) catch {};
            return false;
        };
        captured_args.ensureStillAlive();

        // prepare the args array as `[received, ...captured_args]`
        const args_count = captured_args.getLength(globalThis) catch return false;
        var allocator = std.heap.stackFallback(8 * @sizeOf(JSValue), globalThis.allocator());
        var matcher_args = std.ArrayList(JSValue).initCapacity(allocator.get(), args_count + 1) catch {
            globalThis.throwOutOfMemory() catch {};
            return false;
        };
        matcher_args.appendAssumeCapacity(received);
        for (0..args_count) |i| {
            matcher_args.appendAssumeCapacity(captured_args.getIndex(globalThis, @truncate(i)) catch return false);
        }

        return Expect.executeCustomMatcher(globalThis, matcher_name, matcher_fn, matcher_args.items, this.flags, true) catch false;
    }

    pub fn asymmetricMatch(this: *ExpectCustomAsymmetricMatcher, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(1).slice();
        const received_value = if (arguments.len < 1) .js_undefined else arguments[0];
        const matched = execute(this, callframe.this(), globalThis, received_value);
        return JSValue.jsBoolean(matched);
    }

    fn maybeClear(comptime dontThrow: bool, globalThis: *JSGlobalObject, err: bun.JSError) bun.JSError!bool {
        if (dontThrow) {
            globalThis.clearException();
            return false;
        }
        return err;
    }

    /// Calls a custom implementation (if provided) to stringify this asymmetric matcher, and returns true if it was provided and it succeed
    pub fn customPrint(_: *ExpectCustomAsymmetricMatcher, thisValue: JSValue, globalThis: *JSGlobalObject, writer: anytype, comptime dontThrow: bool) !bool {
        const matcher_fn: JSValue = js.matcherFnGetCached(thisValue) orelse return false;
        if (matcher_fn.get(globalThis, "toAsymmetricMatcher") catch |e| return maybeClear(dontThrow, globalThis, e)) |fn_value| {
            if (fn_value.jsType().isFunction()) {
                const captured_args: JSValue = js.capturedArgsGetCached(thisValue) orelse return false;
                var stack_fallback = std.heap.stackFallback(256, globalThis.allocator());
                const args_len = captured_args.getLength(globalThis) catch |e| return maybeClear(dontThrow, globalThis, e);
                var args = try std.ArrayList(JSValue).initCapacity(stack_fallback.get(), args_len);
                var iter = captured_args.arrayIterator(globalThis) catch |e| return maybeClear(dontThrow, globalThis, e);
                while (iter.next() catch |e| return maybeClear(dontThrow, globalThis, e)) |arg| {
                    args.appendAssumeCapacity(arg);
                }

                const result = matcher_fn.call(globalThis, thisValue, args.items) catch |e| return maybeClear(dontThrow, globalThis, e);
                try writer.print("{}", .{result.toBunString(globalThis) catch |e| return maybeClear(dontThrow, globalThis, e)});
            }
        }
        return false;
    }

    pub fn toAsymmetricMatcher(this: *ExpectCustomAsymmetricMatcher, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        var stack_fallback = std.heap.stackFallback(512, globalThis.allocator());
        var mutable_string = try bun.MutableString.init2048(stack_fallback.get());
        defer mutable_string.deinit();

        const printed = try customPrint(this, callframe.this(), globalThis, mutable_string.writer());
        if (printed) {
            return bun.String.init(mutable_string.slice()).toJS();
        }
        return ExpectMatcherUtils.printValue(globalThis, this, null);
    }
};

/// Reference: `MatcherContext` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
pub const ExpectMatcherContext = struct {
    pub const js = jsc.Codegen.JSExpectMatcherContext;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    flags: Expect.Flags = .{},

    pub fn finalize(
        this: *ExpectMatcherContext,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn getUtils(_: *ExpectMatcherContext, globalThis: *JSGlobalObject) JSValue {
        return ExpectMatcherUtils__getSingleton(globalThis);
    }

    pub fn getIsNot(this: *ExpectMatcherContext, _: *JSGlobalObject) JSValue {
        return JSValue.jsBoolean(this.flags.not);
    }

    pub fn getPromise(this: *ExpectMatcherContext, globalThis: *JSGlobalObject) JSValue {
        return switch (this.flags.promise) {
            .rejects => bun.String.static("rejects").toJS(globalThis),
            .resolves => bun.String.static("resolves").toJS(globalThis),
            else => bun.String.empty.toJS(globalThis),
        };
    }

    pub fn getExpand(_: *ExpectMatcherContext, globalThis: *JSGlobalObject) JSValue {
        _ = globalThis;
        // TODO: this should return whether running tests in verbose mode or not (jest flag --expand), but bun currently doesn't have this switch
        return JSValue.false;
    }

    pub fn equals(_: *ExpectMatcherContext, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        var arguments = callframe.arguments_old(3);
        if (arguments.len < 2) {
            return globalThis.throw("expect.extends matcher: this.util.equals expects at least 2 arguments", .{});
        }
        const args = arguments.slice();
        return JSValue.jsBoolean(try args[0].jestDeepEquals(args[1], globalThis));
    }
};

/// Reference: `MatcherUtils` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
pub const ExpectMatcherUtils = struct {
    pub const js = jsc.Codegen.JSExpectMatcherUtils;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    fn createSingleton(globalThis: *JSGlobalObject) callconv(.C) JSValue {
        var instance = globalThis.bunVM().allocator.create(ExpectMatcherUtils) catch {
            return globalThis.throwOutOfMemoryValue();
        };
        return instance.toJS(globalThis);
    }

    pub fn finalize(
        this: *ExpectMatcherUtils,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    fn printValue(globalThis: *JSGlobalObject, value: JSValue, comptime color_or_null: ?[]const u8) !JSValue {
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

        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();
        try writer.print("{}", .{value.toFmt(&formatter)});

        if (comptime color_or_null) |_| {
            if (Output.enable_ansi_colors) {
                try writer.writeAll(Output.prettyFmt("<r>", true));
            }
        }

        try buffered_writer.flush();

        return bun.String.createUTF8ForJS(globalThis, mutable_string.slice());
    }

    inline fn printValueCatched(globalThis: *JSGlobalObject, value: JSValue, comptime color_or_null: ?[]const u8) JSValue {
        return printValue(globalThis, value, color_or_null) catch {
            return globalThis.throwOutOfMemoryValue();
        };
    }

    pub fn stringify(_: *ExpectMatcherUtils, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(1).slice();
        const value = if (arguments.len < 1) .js_undefined else arguments[0];
        return printValueCatched(globalThis, value, null);
    }

    pub fn printExpected(_: *ExpectMatcherUtils, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(1).slice();
        const value = if (arguments.len < 1) .js_undefined else arguments[0];
        return printValueCatched(globalThis, value, "<green>");
    }

    pub fn printReceived(_: *ExpectMatcherUtils, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(1).slice();
        const value = if (arguments.len < 1) .js_undefined else arguments[0];
        return printValueCatched(globalThis, value, "<red>");
    }

    pub fn matcherHint(_: *ExpectMatcherUtils, globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(4).slice();

        if (arguments.len == 0 or !arguments[0].isString()) {
            return globalThis.throw("matcherHint: the first argument (matcher name) must be a string", .{});
        }
        const matcher_name = try arguments[0].toBunString(globalThis);
        defer matcher_name.deref();

        const received = if (arguments.len > 1) arguments[1] else bun.String.static("received").toJS(globalThis);
        const expected = if (arguments.len > 2) arguments[2] else bun.String.static("expected").toJS(globalThis);
        const options = if (arguments.len > 3) arguments[3] else .js_undefined;

        var is_not = false;
        var comment: ?*jsc.JSString = null; // TODO support
        var promise: ?*jsc.JSString = null; // TODO support
        var second_argument: ?*jsc.JSString = null; // TODO support
        // TODO support "chalk" colors (they are actually functions like: (value: string) => string;)
        //var second_argument_color: ?string = null;
        //var expected_color: ?string = null;
        //var received_color: ?string = null;

        if (!options.isUndefinedOrNull()) {
            if (!options.isObject()) {
                return globalThis.throw("matcherHint: options must be an object (or undefined)", .{});
            }
            if (try options.get(globalThis, "isNot")) |val| {
                is_not = val.toBoolean();
            }
            if (try options.get(globalThis, "comment")) |val| {
                comment = try val.toJSString(globalThis);
            }
            if (try options.get(globalThis, "promise")) |val| {
                promise = try val.toJSString(globalThis);
            }
            if (try options.get(globalThis, "secondArgument")) |val| {
                second_argument = try val.toJSString(globalThis);
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
            return try JSValue.printStringPretty(globalThis, 2048, fmt, .{ matcher_name, diff_formatter });
        } else {
            const signature = comptime Expect.getSignature("{s}", "<green>expected<r>", false);
            const fmt = signature ++ "\n\n{any}\n";
            return try JSValue.printStringPretty(globalThis, 2048, fmt, .{ matcher_name, diff_formatter });
        }
    }
};

pub const ExpectTypeOf = struct {
    pub const js = jsc.Codegen.JSExpectTypeOf;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    pub fn finalize(
        this: *ExpectTypeOf,
    ) callconv(.C) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn create(globalThis: *JSGlobalObject) bun.JSError!JSValue {
        var expect = try globalThis.bunVM().allocator.create(ExpectTypeOf);

        const value = expect.toJS(globalThis);
        value.ensureStillAlive();
        return value;
    }

    pub fn fnOneArgumentReturnsVoid(_: *ExpectTypeOf, _: *JSGlobalObject, _: *CallFrame) bun.JSError!JSValue {
        return .js_undefined;
    }
    pub fn fnOneArgumentReturnsExpectTypeOf(_: *ExpectTypeOf, globalThis: *JSGlobalObject, _: *CallFrame) bun.JSError!JSValue {
        return create(globalThis);
    }
    pub fn getReturnsExpectTypeOf(_: *ExpectTypeOf, globalThis: *JSGlobalObject) bun.JSError!JSValue {
        return create(globalThis);
    }

    pub fn constructor(globalThis: *JSGlobalObject, _: *CallFrame) bun.JSError!*ExpectTypeOf {
        return globalThis.throw("expectTypeOf() cannot be called with new", .{});
    }
    pub fn call(globalThis: *JSGlobalObject, _: *CallFrame) bun.JSError!JSValue {
        return create(globalThis);
    }
};

// Extract the matcher_fn from a JSCustomExpectMatcherFunction instance
inline fn getCustomMatcherFn(thisValue: JSValue, globalThis: *JSGlobalObject) ?JSValue {
    const matcher_fn = Bun__JSWrappingFunction__getWrappedFunction(thisValue, globalThis);
    return if (matcher_fn == .zero) null else matcher_fn;
}

/// JSValue.zero is used to indicate it was not a JSMockFunction
/// If there were no calls, it returns an empty JSArray*
extern fn JSMockFunction__getCalls(JSValue) JSValue;

/// JSValue.zero is used to indicate it was not a JSMockFunction
/// If there were no calls, it returns an empty JSArray*
extern fn JSMockFunction__getReturns(JSValue) JSValue;

extern fn Bun__JSWrappingFunction__create(globalThis: *JSGlobalObject, symbolName: *const bun.String, functionPointer: *const jsc.JSHostFn, wrappedFn: JSValue, strong: bool) JSValue;
extern fn Bun__JSWrappingFunction__getWrappedFunction(this: JSValue, globalThis: *JSGlobalObject) JSValue;

extern fn ExpectMatcherUtils__getSingleton(globalThis: *JSGlobalObject) JSValue;

extern fn Expect__getPrototype(globalThis: *JSGlobalObject) JSValue;
extern fn ExpectStatic__getPrototype(globalThis: *JSGlobalObject) JSValue;

comptime {
    @export(&ExpectMatcherUtils.createSingleton, .{ .name = "ExpectMatcherUtils_createSigleton" });
    @export(&Expect.readFlagsAndProcessPromise, .{ .name = "Expect_readFlagsAndProcessPromise" });
    @export(&ExpectCustomAsymmetricMatcher.execute, .{ .name = "ExpectCustomAsymmetricMatcher__execute" });
}

pub fn incrementExpectCallCounter() void {
    active_test_expectation_counter.actual += 1;
}

fn testTrimLeadingWhitespaceForSnapshot(src: []const u8, expected: []const u8) !void {
    const cpy = try std.testing.allocator.alloc(u8, src.len);
    defer std.testing.allocator.free(cpy);

    const res = Expect.trimLeadingWhitespaceForInlineSnapshot(src, cpy);
    sanityCheck(src, res);

    try std.testing.expectEqualStrings(expected, res.trimmed);
}
fn sanityCheck(input: []const u8, res: Expect.TrimResult) void {
    // sanity check: output has same number of lines & all input lines endWith output lines
    var input_iter = std.mem.splitScalar(u8, input, '\n');
    var output_iter = std.mem.splitScalar(u8, res.trimmed, '\n');
    while (true) {
        const next_input = input_iter.next();
        const next_output = output_iter.next();
        if (next_input == null) {
            std.debug.assert(next_output == null);
            break;
        }
        std.debug.assert(next_output != null);
        std.debug.assert(std.mem.endsWith(u8, next_input.?, next_output.?));
    }
}
fn testOne(input: []const u8) anyerror!void {
    const cpy = try std.testing.allocator.alloc(u8, input.len);
    defer std.testing.allocator.free(cpy);
    const res = Expect.trimLeadingWhitespaceForInlineSnapshot(input, cpy);
    sanityCheck(input, res);
}

test "Expect.trimLeadingWhitespaceForInlineSnapshot" {
    try testTrimLeadingWhitespaceForSnapshot(
        \\
        \\Hello, world!
        \\
    ,
        \\
        \\Hello, world!
        \\
    );
    try testTrimLeadingWhitespaceForSnapshot(
        \\
        \\  Hello, world!
        \\
    ,
        \\
        \\Hello, world!
        \\
    );
    try testTrimLeadingWhitespaceForSnapshot(
        \\
        \\  Object{
        \\    key: value
        \\  }
        \\
    ,
        \\
        \\Object{
        \\  key: value
        \\}
        \\
    );
    try testTrimLeadingWhitespaceForSnapshot(
        \\
        \\  Object{
        \\  key: value
        \\
        \\  }
        \\
    ,
        \\
        \\Object{
        \\key: value
        \\
        \\}
        \\
    );
    try testTrimLeadingWhitespaceForSnapshot(
        \\
        \\    Object{
        \\  key: value
        \\  }
        \\
    ,
        \\
        \\    Object{
        \\  key: value
        \\  }
        \\
    );
    try testTrimLeadingWhitespaceForSnapshot(
        \\
        \\  "æ™
        \\
        \\  !!!!*5897yhduN"'\`Il"
        \\
    ,
        \\
        \\"æ™
        \\
        \\!!!!*5897yhduN"'\`Il"
        \\
    );
}

test "fuzz Expect.trimLeadingWhitespaceForInlineSnapshot" {
    try std.testing.fuzz(testOne, .{});
}

const string = []const u8;

const std = @import("std");
const DiffFormatter = @import("./diff_format.zig").DiffFormatter;

const bun = @import("bun");
const Environment = bun.Environment;
const MutableString = bun.MutableString;
const Output = bun.Output;
const assert = bun.assert;
const default_allocator = bun.default_allocator;
const strings = bun.strings;

const jsc = bun.jsc;
const CallFrame = jsc.CallFrame;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
const ZigString = jsc.ZigString;

const jest = bun.jsc.Jest;
const DescribeScope = jest.DescribeScope;
const Jest = jest.Jest;
const TestRunner = jest.TestRunner;
