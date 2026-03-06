pub const Counter = struct {
    expected: u32 = 0,
    actual: u32 = 0,
};

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
    parent: ?*bun.jsc.Jest.bun_test.BunTest.RefData,
    custom_label: bun.String = bun.String.empty,

    pub const TestScope = struct {
        test_id: TestRunner.Test.ID,
        describe: *DescribeScope,
    };

    pub fn incrementExpectCallCounter(this: *Expect) void {
        const parent = this.parent orelse return; // not in bun:test
        var buntest_strong = parent.bunTest() orelse return; // the test file this expect() call was for is no longer
        defer buntest_strong.deinit();
        const buntest = buntest_strong.get();
        if (parent.phase.sequence(buntest)) |sequence| {
            // found active sequence
            sequence.expect_call_count +|= 1;
        } else {
            // in concurrent group or otherwise failed to get the sequence; increment the expect call count in the reporter directly
            if (buntest.reporter) |reporter| {
                reporter.summary().expectations +|= 1;
            }
        }
    }

    pub fn bunTest(this: *Expect) ?bun.jsc.Jest.bun_test.BunTestPtr {
        const parent = this.parent orelse return null;
        return parent.bunTest();
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
        switch (Output.enable_ansi_colors_stderr) {
            inline else => |colors| {
                const chain = switch (flags.promise) {
                    .resolves => if (flags.not) Output.prettyFmt("resolves<d>.<r>not<d>.<r>", colors) else Output.prettyFmt("resolves<d>.<r>", colors),
                    .rejects => if (flags.not) Output.prettyFmt("rejects<d>.<r>not<d>.<r>", colors) else Output.prettyFmt("rejects<d>.<r>", colors),
                    .none => if (flags.not) Output.prettyFmt("not<d>.<r>", colors) else "",
                };
                switch (!custom_label.isEmpty()) {
                    inline else => |use_default_label| {
                        if (use_default_label) {
                            const fmt = comptime Output.prettyFmt("<d>expect(<r><red>received<r><d>).<r>" ++ bun.deprecated.autoFormatLabel(@TypeOf(chain)) ++ bun.deprecated.autoFormatLabel(@TypeOf(matcher_name)) ++ "<d>(<r>" ++ bun.deprecated.autoFormatLabel(@TypeOf(matcher_params)) ++ "<d>)<r>\n\n" ++ message_fmt, colors);
                            return globalThis.throwPretty(fmt, .{ chain, matcher_name, matcher_params } ++ message_args);
                        } else {
                            const fmt = comptime Output.prettyFmt("{f}\n\n" ++ message_fmt, colors);
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

        const matcher_params = switch (Output.enable_ansi_colors_stderr) {
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
                    switch (promise.status()) {
                        .fulfilled => switch (resolution) {
                            .resolves => {},
                            .rejects => {
                                if (!silent) {
                                    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
                                    defer formatter.deinit();
                                    const message = "Expected promise that rejects<r>\nReceived promise that resolved: <red>{f}<r>\n";
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
                                    const message = "Expected promise that resolves<r>\nReceived promise that rejected: <red>{f}<r>\n";
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
                        const message = "Expected promise<r>\nReceived: <red>{f}<r>\n";
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
    fn readFlagsAndProcessPromise(instanceValue: JSValue, globalThis: *JSGlobalObject, outFlags: *Expect.Flags.FlagsCppType, value: *JSValue, any_constructor_type: *u8) callconv(.c) bool {
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
        const parent = this.parent orelse return error.NoTest;
        var buntest_strong = parent.bunTest() orelse return error.TestNotActive;
        defer buntest_strong.deinit();
        const buntest = buntest_strong.get();
        const execution_entry = parent.phase.entry(buntest) orelse return error.SnapshotInConcurrentGroup;

        const test_name = execution_entry.base.name orelse "(unnamed)";

        var length: usize = 0;
        var curr_scope = execution_entry.base.parent;
        while (curr_scope) |scope| {
            if (scope.base.name != null and scope.base.name.?.len > 0) {
                length += scope.base.name.?.len + 1;
            }
            curr_scope = scope.base.parent;
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
        curr_scope = execution_entry.base.parent;
        while (curr_scope) |scope| {
            if (scope.base.name != null and scope.base.name.?.len > 0) {
                index -= scope.base.name.?.len + 1;
                bun.copy(u8, buf[index..], scope.base.name.?);
                buf[index + scope.base.name.?.len] = ' ';
            }
            curr_scope = scope.base.parent;
        }

        return buf;
    }

    pub fn finalize(
        this: *Expect,
    ) callconv(.c) void {
        this.custom_label.deref();
        if (this.parent) |parent| parent.deref();
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

        const active_execution_entry_ref = if (bun.jsc.Jest.bun_test.cloneActiveStrong()) |buntest_strong_| blk: {
            var buntest_strong = buntest_strong_;
            defer buntest_strong.deinit();
            break :blk bun.jsc.Jest.bun_test.BunTest.ref(buntest_strong, buntest_strong.get().getCurrentStateData());
        } else null;
        errdefer if (active_execution_entry_ref) |entry_ref| entry_ref.deinit();

        expect.* = .{
            .custom_label = custom_label,
            .parent = active_execution_entry_ref,
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
            return globalThis.throwPretty("{f}" ++ fmt, .{this.custom_label} ++ args);
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

        this.incrementExpectCallCounter();

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

        this.incrementExpectCallCounter();

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
    pub const toBeInstanceOf = @import("./expect/toBeInstanceOf.zig").toBeInstanceOf;
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
    pub const toEndWith = @import("./expect/toEndWith.zig").toEndWith;
    pub const toEqual = @import("./expect/toEqual.zig").toEqual;
    pub const toEqualIgnoringWhitespace = @import("./expect/toEqualIgnoringWhitespace.zig").toEqualIgnoringWhitespace;
    pub const toHaveBeenCalled = @import("./expect/toHaveBeenCalled.zig").toHaveBeenCalled;
    pub const toHaveBeenCalledOnce = @import("./expect/toHaveBeenCalledOnce.zig").toHaveBeenCalledOnce;
    pub const toHaveBeenCalledTimes = @import("./expect/toHaveBeenCalledTimes.zig").toHaveBeenCalledTimes;
    pub const toHaveBeenCalledWith = @import("./expect/toHaveBeenCalledWith.zig").toHaveBeenCalledWith;
    pub const toHaveBeenLastCalledWith = @import("./expect/toHaveBeenLastCalledWith.zig").toHaveBeenLastCalledWith;
    pub const toHaveBeenNthCalledWith = @import("./expect/toHaveBeenNthCalledWith.zig").toHaveBeenNthCalledWith;
    pub const toHaveLastReturnedWith = @import("./expect/toHaveLastReturnedWith.zig").toHaveLastReturnedWith;
    pub const toHaveLength = @import("./expect/toHaveLength.zig").toHaveLength;
    pub const toHaveNthReturnedWith = @import("./expect/toHaveNthReturnedWith.zig").toHaveNthReturnedWith;
    pub const toHaveProperty = @import("./expect/toHaveProperty.zig").toHaveProperty;
    pub const toHaveReturned = @import("./expect/toHaveReturned.zig").toHaveReturned;
    pub const toHaveReturnedTimes = @import("./expect/toHaveReturnedTimes.zig").toHaveReturnedTimes;
    pub const toHaveReturnedWith = @import("./expect/toHaveReturnedWith.zig").toHaveReturnedWith;
    pub const toInclude = @import("./expect/toInclude.zig").toInclude;
    pub const toIncludeRepeated = @import("./expect/toIncludeRepeated.zig").toIncludeRepeated;
    pub const toMatch = @import("./expect/toMatch.zig").toMatch;
    pub const toMatchInlineSnapshot = @import("./expect/toMatchInlineSnapshot.zig").toMatchInlineSnapshot;
    pub const toMatchObject = @import("./expect/toMatchObject.zig").toMatchObject;
    pub const toMatchSnapshot = @import("./expect/toMatchSnapshot.zig").toMatchSnapshot;
    pub const toSatisfy = @import("./expect/toSatisfy.zig").toSatisfy;
    pub const toStartWith = @import("./expect/toStartWith.zig").toStartWith;
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
        const runner = Jest.runner orelse {
            const signature = comptime getSignature(fn_name, "", false);
            return this.throw(globalThis, signature, "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n", .{});
        };
        _ = runner.snapshots.addCount(this, "") catch |e| switch (e) {
            error.OutOfMemory => return error.OutOfMemory,
            error.NoTest => {},
            error.SnapshotInConcurrentGroup => {},
            error.TestNotActive => {},
        };

        const update = runner.snapshots.update_snapshots;
        var needs_write = false;

        var pretty_value = std.Io.Writer.Allocating.init(default_allocator);
        defer pretty_value.deinit();
        try this.matchAndFmtSnapshot(globalThis, value, property_matchers, &pretty_value.writer, fn_name);

        var start_indent: ?[]const u8 = null;
        var end_indent: ?[]const u8 = null;
        if (result) |saved_value| {
            const buf = try runner.snapshots.allocator.alloc(u8, saved_value.len);
            defer runner.snapshots.allocator.free(buf);
            const trim_res = trimLeadingWhitespaceForInlineSnapshot(saved_value, buf);

            if (strings.eqlLong(pretty_value.written(), trim_res.trimmed, true)) {
                runner.snapshots.passed += 1;
                return .js_undefined;
            } else if (update) {
                runner.snapshots.passed += 1;
                needs_write = true;
                start_indent = trim_res.start_indent;
                end_indent = trim_res.end_indent;
            } else {
                runner.snapshots.failed += 1;
                const signature = comptime getSignature(fn_name, "<green>expected<r>", false);
                const fmt = signature ++ "\n\n{f}\n";
                const diff_format = DiffFormatter{
                    .received_string = pretty_value.written(),
                    .expected_string = trim_res.trimmed,
                    .globalThis = globalThis,
                };

                return globalThis.throwPretty(fmt, .{diff_format});
            }
        } else {
            needs_write = true;
        }

        if (needs_write) {
            if (bun.ci.isCI()) {
                if (!update) {
                    const signature = comptime getSignature(fn_name, "", false);
                    // Only creating new snapshots can reach here (updating with mismatches errors earlier with diff)
                    return this.throw(globalThis, signature, "\n\n<b>Matcher error<r>: Inline snapshot creation is disabled in CI environments unless --update-snapshots is used.\nTo override, set the environment variable CI=false.\n\nReceived: {s}", .{pretty_value.written()});
                }
            }
            var buntest_strong = this.bunTest() orelse {
                const signature = comptime getSignature(fn_name, "", false);
                return this.throw(globalThis, signature, "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n", .{});
            };
            defer buntest_strong.deinit();
            const buntest = buntest_strong.get();

            // 1. find the src loc of the snapshot
            const srcloc = callFrame.getCallerSrcLoc(globalThis);
            defer srcloc.str.deref();
            const file_id = buntest.file_id;
            const fget = runner.files.get(file_id);

            if (!srcloc.str.eqlUTF8(fget.source.path.text)) {
                const signature = comptime getSignature(fn_name, "", false);
                return this.throw(globalThis, signature,
                    \\
                    \\
                    \\<b>Matcher error<r>: Inline snapshot matchers must be called from the test file:
                    \\  Expected to be called from file: <green>"{f}"<r>
                    \\  {s} called from file: <red>"{f}"<r>
                    \\
                , .{
                    std.zig.fmtString(fget.source.path.text),
                    fn_name,
                    std.zig.fmtString(srcloc.str.toUTF8(runner.snapshots.allocator).slice()),
                });
            }

            // 2. save to write later
            try runner.snapshots.addInlineSnapshotToWrite(file_id, .{
                .line = srcloc.line,
                .col = srcloc.column,
                .value = try pretty_value.toOwnedSlice(),
                .has_matchers = property_matchers != null,
                .is_added = result == null,
                .kind = fn_name,
                .start_indent = if (start_indent) |ind| try runner.snapshots.allocator.dupe(u8, ind) else null,
                .end_indent = if (end_indent) |ind| try runner.snapshots.allocator.dupe(u8, ind) else null,
            });
        }

        return .js_undefined;
    }
    pub fn matchAndFmtSnapshot(this: *Expect, globalThis: *JSGlobalObject, value: JSValue, property_matchers: ?JSValue, pretty_value: *std.Io.Writer, comptime fn_name: []const u8) bun.JSError!void {
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
                    "\n\nReceived: {f}\n";

                var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
                defer formatter.deinit();
                return globalThis.throwPretty(fmt, .{value.toFmt(&formatter)});
            }
        }

        value.jestSnapshotPrettyFormat(pretty_value, globalThis) catch {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
            defer formatter.deinit();
            return globalThis.throw("Failed to pretty format value: {f}", .{value.toFmt(&formatter)});
        };
    }
    pub fn snapshot(this: *Expect, globalThis: *JSGlobalObject, value: JSValue, property_matchers: ?JSValue, hint: []const u8, comptime fn_name: []const u8) bun.JSError!JSValue {
        var pretty_value = std.Io.Writer.Allocating.init(default_allocator);
        defer pretty_value.deinit();
        try this.matchAndFmtSnapshot(globalThis, value, property_matchers, &pretty_value.writer, fn_name);

        const existing_value = Jest.runner.?.snapshots.getOrPut(this, pretty_value.written(), hint) catch |err| {
            var buntest_strong = this.bunTest() orelse return globalThis.throw("Snapshot matchers cannot be used outside of a test", .{});
            defer buntest_strong.deinit();
            const buntest = buntest_strong.get();
            const test_file_path = Jest.runner.?.files.get(buntest.file_id).source.path.text;
            const runner = Jest.runner.?;
            return switch (err) {
                error.FailedToOpenSnapshotFile => globalThis.throw("Failed to open snapshot file for test file: {s}", .{test_file_path}),
                error.FailedToMakeSnapshotDirectory => globalThis.throw("Failed to make snapshot directory for test file: {s}", .{test_file_path}),
                error.FailedToWriteSnapshotFile => globalThis.throw("Failed write to snapshot file: {s}", .{test_file_path}),
                error.SyntaxError, error.ParseError => globalThis.throw("Failed to parse snapshot file for: {s}", .{test_file_path}),
                error.SnapshotCreationNotAllowedInCI => blk: {
                    const snapshot_name = runner.snapshots.last_error_snapshot_name;
                    defer if (snapshot_name) |name| {
                        runner.snapshots.allocator.free(name);
                        runner.snapshots.last_error_snapshot_name = null;
                    };
                    if (snapshot_name) |name| {
                        break :blk globalThis.throw("Snapshot creation is disabled in CI environments unless --update-snapshots is used\nTo override, set the environment variable CI=false.\n\nSnapshot name: \"{s}\"\nReceived: {s}", .{ name, pretty_value.written() });
                    } else {
                        break :blk globalThis.throw("Snapshot creation is disabled in CI environments unless --update-snapshots is used\nTo override, set the environment variable CI=false.\n\nReceived: {s}", .{pretty_value.written()});
                    }
                },
                error.SnapshotInConcurrentGroup => globalThis.throw("Snapshot matchers are not supported in concurrent tests", .{}),
                error.TestNotActive => globalThis.throw("Snapshot matchers are not supported after the test has finished executing", .{}),
                else => blk: {
                    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
                    defer formatter.deinit();
                    break :blk globalThis.throw("Failed to snapshot value: {f}", .{value.toFmt(&formatter)});
                },
            };
        };

        if (existing_value) |saved_value| {
            if (strings.eqlLong(pretty_value.written(), saved_value, true)) {
                Jest.runner.?.snapshots.passed += 1;
                return .js_undefined;
            }

            Jest.runner.?.snapshots.failed += 1;
            const signature = comptime getSignature(fn_name, "<green>expected<r>", false);
            const fmt = signature ++ "\n\n{f}\n";
            const diff_format = DiffFormatter{
                .received_string = pretty_value.written(),
                .expected_string = saved_value,
                .globalThis = globalThis,
            };

            return globalThis.throwPretty(fmt, .{diff_format});
        }

        return .js_undefined;
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
                    return globalThis.throwInvalidArguments("expect.extend: `{f}` is not a valid matcher. Must be a function, is \"{f}\"", .{ matcher_name, type_name });
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

        pub fn format(this: CustomMatcherParamsFormatter, writer: *std.Io.Writer) !void {
            // try to detect param names from matcher_fn (user function) source code
            if (jsc.JSFunction.getSourceCode(this.matcher_fn)) |source_str| {
                const source_slice = source_str.toUTF8(this.globalThis.allocator());
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
            "Unexpected return from matcher function `{f}`.\n" ++
            "Matcher functions should return an object in the following format:\n" ++
            "  {{message?: string | function, pass: boolean}}\n" ++
            "'{f}' was returned";
        const err = switch (Output.enable_ansi_colors_stderr) {
            inline else => |colors| globalThis.createErrorInstance(Output.prettyFmt(fmt, colors), .{ matcher_name, result.toFmt(&formatter) }),
        };
        err.put(globalThis, ZigString.static("name"), try bun.String.static("InvalidMatcherError").toJS(globalThis));
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
            switch (promise.status()) {
                .pending => unreachable,
                .fulfilled => {},
                .rejected => {
                    // TODO: rewrite this code to use .then() instead of blocking the event loop
                    jsc.VirtualMachine.get().runErrorHandler(result, null);
                    return globalThis.throw("Matcher `{f}` returned a promise that rejected", .{matcher_name});
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
            .colors = Output.enable_ansi_colors_stderr,
            .globalThis = globalThis,
            .matcher_fn = matcher_fn,
        };
        return throwPrettyMatcherError(globalThis, bun.String.empty, matcher_name, matcher_params, .{}, "{f}", .{message_text});
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
        const matcher_name = try matcher_fn.getName(globalThis);

        const matcher_params = CustomMatcherParamsFormatter{
            .colors = Output.enable_ansi_colors_stderr,
            .globalThis = globalThis,
            .matcher_fn = matcher_fn,
        };

        // retrieve the captured expected value
        var value = js.capturedValueGetCached(thisValue) orelse {
            return globalThis.throw("Internal consistency error: failed to retrieve the captured value", .{});
        };
        value = try processPromise(expect.custom_label, expect.flags, globalThis, value, matcher_name, matcher_params, false);
        value.ensureStillAlive();

        expect.incrementExpectCallCounter();

        // prepare the args array
        const args = callFrame.arguments();
        var allocator = std.heap.stackFallback(8 * @sizeOf(JSValue), globalThis.allocator());
        var matcher_args = try std.array_list.Managed(JSValue).initCapacity(allocator.get(), args.len + 1);
        matcher_args.appendAssumeCapacity(value);
        for (args) |arg| matcher_args.appendAssumeCapacity(arg);

        _ = try executeCustomMatcher(globalThis, matcher_name, matcher_fn, matcher_args.items, expect.flags, false);

        return thisValue;
    }

    pub const addSnapshotSerializer = notImplementedStaticFn;

    pub fn hasAssertions(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        _ = callFrame;
        defer globalThis.bunVM().autoGarbageCollect();

        var buntest_strong = bun.jsc.Jest.bun_test.cloneActiveStrong() orelse return globalThis.throw("expect.assertions() must be called within a test", .{});
        defer buntest_strong.deinit();
        const buntest = buntest_strong.get();
        const state_data = buntest.getCurrentStateData();
        const execution = state_data.sequence(buntest) orelse return globalThis.throw("expect.assertions() is not supported in the describe phase, in concurrent tests, between tests, or after test execution has completed", .{});
        if (execution.expect_assertions != .exact) {
            execution.expect_assertions = .at_least_one;
        }

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
            return globalThis.throw("Expected value must be a non-negative integer: {f}", .{expected.toFmt(&fmt)});
        }

        const expected_assertions: f64 = try expected.toNumber(globalThis);
        if (@round(expected_assertions) != expected_assertions or std.math.isInf(expected_assertions) or std.math.isNan(expected_assertions) or expected_assertions < 0 or expected_assertions > std.math.maxInt(u32)) {
            var fmt = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            return globalThis.throw("Expected value must be a non-negative integer: {f}", .{expected.toFmt(&fmt)});
        }

        const unsigned_expected_assertions: u32 = @intFromFloat(expected_assertions);

        var buntest_strong = bun.jsc.Jest.bun_test.cloneActiveStrong() orelse return globalThis.throw("expect.assertions() must be called within a test", .{});
        defer buntest_strong.deinit();
        const buntest = buntest_strong.get();
        const state_data = buntest.getCurrentStateData();
        const execution = state_data.sequence(buntest) orelse return globalThis.throw("expect.assertions() is not supported in the describe phase, in concurrent tests, between tests, or after test execution has completed", .{});
        execution.expect_assertions = .{ .exact = unsigned_expected_assertions };

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
            error_value.put(globalThis, ZigString.static("name"), try bun.String.init("UnreachableError").toJS(globalThis));
            return globalThis.throwValue(error_value);
        }

        if (arg.isString()) {
            const error_value = (try arg.toBunString(globalThis)).toErrorInstance(globalThis);
            error_value.put(globalThis, ZigString.static("name"), try bun.String.init("UnreachableError").toJS(globalThis));
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
    ) callconv(.c) void {
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
    ) callconv(.c) void {
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
    ) callconv(.c) void {
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
    ) callconv(.c) void {
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
    ) callconv(.c) void {
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
    ) callconv(.c) void {
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

    pub fn finalize(this: *ExpectAny) callconv(.c) void {
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
    ) callconv(.c) void {
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
    ) callconv(.c) void {
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
    pub fn execute(this: *ExpectCustomAsymmetricMatcher, thisValue: JSValue, globalThis: *JSGlobalObject, received: JSValue) callconv(.c) bool {
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
        const matcher_name = matcher_fn.getName(globalThis) catch {
            return false;
        };

        // retrieve the asymmetric matcher args
        // if null, it means the function has not yet been called to capture the args, which is a misuse of the matcher
        const captured_args: JSValue = js.capturedArgsGetCached(thisValue) orelse {
            globalThis.throw("expect.{f} misused, it needs to be instantiated by calling it with 0 or more arguments", .{matcher_name}) catch {};
            return false;
        };
        captured_args.ensureStillAlive();

        // prepare the args array as `[received, ...captured_args]`
        const args_count = captured_args.getLength(globalThis) catch return false;
        var allocator = std.heap.stackFallback(8 * @sizeOf(JSValue), globalThis.allocator());
        var matcher_args = std.array_list.Managed(JSValue).initCapacity(allocator.get(), args_count + 1) catch {
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
                var args = try std.array_list.Managed(JSValue).initCapacity(stack_fallback.get(), args_len);
                var iter = captured_args.arrayIterator(globalThis) catch |e| return maybeClear(dontThrow, globalThis, e);
                while (iter.next() catch |e| return maybeClear(dontThrow, globalThis, e)) |arg| {
                    args.appendAssumeCapacity(arg);
                }

                const result = matcher_fn.call(globalThis, thisValue, args.items) catch |e| return maybeClear(dontThrow, globalThis, e);
                try writer.print("{f}", .{result.toBunString(globalThis) catch |e| return maybeClear(dontThrow, globalThis, e)});
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
    ) callconv(.c) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    pub fn getUtils(_: *ExpectMatcherContext, globalThis: *JSGlobalObject) JSValue {
        return ExpectMatcherUtils__getSingleton(globalThis);
    }

    pub fn getIsNot(this: *ExpectMatcherContext, _: *JSGlobalObject) JSValue {
        return JSValue.jsBoolean(this.flags.not);
    }

    pub fn getPromise(this: *ExpectMatcherContext, globalThis: *JSGlobalObject) bun.JSError!JSValue {
        return switch (this.flags.promise) {
            .rejects => bun.String.static("rejects").toJS(globalThis),
            .resolves => bun.String.static("resolves").toJS(globalThis),
            else => bun.String.empty.toJS(globalThis),
        };
    }

    pub fn getExpand(_: *ExpectMatcherContext, globalThis: *JSGlobalObject) JSValue {
        _ = globalThis;
        // TODO: this should return whether running tests in verbose mode or not (jest flag --expand), but bun currently doesn't have this switch
        return .false;
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

    fn createSingleton(globalThis: *JSGlobalObject) callconv(.c) JSValue {
        var instance = globalThis.bunVM().allocator.create(ExpectMatcherUtils) catch {
            return globalThis.throwOutOfMemoryValue();
        };
        return instance.toJS(globalThis);
    }

    pub fn finalize(
        this: *ExpectMatcherUtils,
    ) callconv(.c) void {
        VirtualMachine.get().allocator.destroy(this);
    }

    fn printValue(globalThis: *JSGlobalObject, value: JSValue, comptime color_or_null: ?[]const u8) !JSValue {
        var stack_fallback = std.heap.stackFallback(512, globalThis.allocator());
        var mutable_string = try bun.MutableString.init2048(stack_fallback.get());
        defer mutable_string.deinit();

        var buffered_writer = bun.MutableString.BufferedWriter{ .context = &mutable_string };
        var writer = buffered_writer.writer();

        if (comptime color_or_null) |color| {
            if (Output.enable_ansi_colors_stderr) {
                try writer.writeAll(Output.prettyFmt(color, true));
            }
        }

        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();
        try writer.print("{f}", .{value.toFmt(&formatter)});

        if (comptime color_or_null) |_| {
            if (Output.enable_ansi_colors_stderr) {
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

        const received = if (arguments.len > 1) arguments[1] else try bun.String.static("received").toJS(globalThis);
        const expected = if (arguments.len > 2) arguments[2] else try bun.String.static("expected").toJS(globalThis);
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
            const signature = comptime Expect.getSignature("{f}", "<green>expected<r>", true);
            const fmt = signature ++ "\n\n{f}\n";
            return try JSValue.printStringPretty(globalThis, 2048, fmt, .{ matcher_name, diff_formatter });
        } else {
            const signature = comptime Expect.getSignature("{f}", "<green>expected<r>", false);
            const fmt = signature ++ "\n\n{f}\n";
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
    ) callconv(.c) void {
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

pub const mock = struct {
    pub fn jestMockIterator(globalThis: *JSGlobalObject, value: bun.jsc.JSValue) bun.JSError!bun.jsc.JSArrayIterator {
        const returns: bun.jsc.JSValue = try bun.cpp.JSMockFunction__getReturns(globalThis, value);
        if (!returns.jsType().isArray()) {
            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
            defer formatter.deinit();
            return globalThis.throw("Expected value must be a mock function: {f}", .{value.toFmt(&formatter)});
        }

        return try returns.arrayIterator(globalThis);
    }
    pub fn jestMockReturnObject_type(globalThis: *JSGlobalObject, value: bun.jsc.JSValue) bun.JSError!ReturnStatus {
        if (try value.fastGet(globalThis, .type)) |type_string| {
            if (type_string.isString()) {
                if (try ReturnStatus.Map.fromJS(globalThis, type_string)) |val| return val;
            }
        }
        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
        defer formatter.deinit();
        return globalThis.throw("Expected value must be a mock function with returns: {f}", .{value.toFmt(&formatter)});
    }
    pub fn jestMockReturnObject_value(globalThis: *JSGlobalObject, value: bun.jsc.JSValue) bun.JSError!JSValue {
        return (try value.get(globalThis, "value")) orelse .js_undefined;
    }

    pub const AllCallsWithArgsFormatter = struct {
        globalThis: *JSGlobalObject,
        calls: JSValue,
        formatter: *jsc.ConsoleObject.Formatter,

        pub fn format(self: @This(), writer: *std.Io.Writer) std.Io.Writer.Error!void {
            var printed_once = false;

            const calls_count = @as(u32, @intCast(self.calls.getLength(self.globalThis) catch |e| return bun.deprecated.jsErrorToWriteError(e)));
            if (calls_count == 0) {
                try writer.writeAll("(no calls)");
                return;
            }

            for (0..calls_count) |i| {
                if (printed_once) try writer.writeAll("\n");
                printed_once = true;

                try writer.print("           {d: >4}: ", .{i + 1});
                const call_args = self.calls.getIndex(self.globalThis, @intCast(i)) catch |e| return bun.deprecated.jsErrorToWriteError(e);
                try writer.print("{f}", .{call_args.toFmt(self.formatter)});
            }
        }
    };

    pub const ReturnStatus = enum {
        throw,
        @"return",
        incomplete,

        pub const Map = bun.ComptimeEnumMap(ReturnStatus);
    };

    // Formatter for when there are multiple returns or errors
    pub const AllCallsFormatter = struct {
        globalThis: *JSGlobalObject,
        returns: JSValue,
        formatter: *jsc.ConsoleObject.Formatter,

        pub fn format(self: @This(), writer: *std.Io.Writer) std.Io.Writer.Error!void {
            var printed_once = false;

            var num_returns: i32 = 0;
            var num_calls: i32 = 0;

            var iter = self.returns.arrayIterator(self.globalThis) catch |e| return bun.deprecated.jsErrorToWriteError(e);
            while (iter.next() catch |e| return bun.deprecated.jsErrorToWriteError(e)) |item| {
                if (printed_once) try writer.writeAll("\n");
                printed_once = true;

                num_calls += 1;
                try writer.print("           {d: >2}: ", .{num_calls});

                const value = jestMockReturnObject_value(self.globalThis, item) catch |e| return bun.deprecated.jsErrorToWriteError(e);
                switch (jestMockReturnObject_type(self.globalThis, item) catch |e| return bun.deprecated.jsErrorToWriteError(e)) {
                    .@"return" => {
                        try writer.print("{f}", .{value.toFmt(self.formatter)});
                        num_returns += 1;
                    },
                    .throw => {
                        try writer.print("function call threw an error: {f}", .{value.toFmt(self.formatter)});
                    },
                    .incomplete => {
                        try writer.print("<incomplete call>", .{});
                    },
                }
            }
        }
    };

    pub const SuccessfulReturnsFormatter = struct {
        globalThis: *JSGlobalObject,
        successful_returns: *const std.array_list.Managed(JSValue),
        formatter: *jsc.ConsoleObject.Formatter,

        pub fn format(self: @This(), writer: *std.Io.Writer) !void {
            const len = self.successful_returns.items.len;
            if (len == 0) return;

            var printed_once = false;

            for (self.successful_returns.items, 1..) |val, i| {
                if (printed_once) try writer.writeAll("\n");
                printed_once = true;

                try writer.print("           {d: >4}: ", .{i});
                try writer.print("{f}", .{val.toFmt(self.formatter)});
            }
        }
    };
};

// Extract the matcher_fn from a JSCustomExpectMatcherFunction instance
inline fn getCustomMatcherFn(thisValue: JSValue, globalThis: *JSGlobalObject) ?JSValue {
    const matcher_fn = Bun__JSWrappingFunction__getWrappedFunction(thisValue, globalThis);
    return if (matcher_fn == .zero) null else matcher_fn;
}

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
