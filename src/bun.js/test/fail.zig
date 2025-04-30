const bun = @import("bun");
const default_allocator = bun.default_allocator;
const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const ZigString = JSC.ZigString;
const CallFrame = JSC.CallFrame;
const jest = bun.JSC.Jest;
const Jest = jest.Jest;
const TestRunner = jest.TestRunner;
const DescribeScope = jest.DescribeScope;

pub const Fail = struct {
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

    pub fn call(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        const arguments_ = callframe.arguments_old(1);
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
            _msg = ZigString.fromBytes("fails by fail() assertion");
        }

        var msg = _msg.toSlice(default_allocator);
        defer msg.deinit();

        return globalThis.throwPretty("\n\n{s}\n", .{msg.slice()});
    }
};
