const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const VM = @import("./VM.zig").VM;

/// Call Frame for JavaScript -> Native function calls. In Bun, it is
/// preferred to use the bindings generator instead of directly decoding
/// arguments. See `docs/project/bindgen.md`
pub const CallFrame = opaque {
    /// A slice of all passed arguments to this function call.
    pub fn arguments(self: *const CallFrame) []const JSValue {
        return self.asUnsafeJSValueArray()[offset_first_argument..][0..self.argumentsCount()];
    }

    /// Usage: `const arg1, const arg2 = call_frame.argumentsAsArray(2);`
    pub fn argumentsAsArray(call_frame: *const CallFrame, comptime count: usize) [count]JSValue {
        const slice = call_frame.arguments();
        var value: [count]JSValue = .{.undefined} ** count;
        const n = @min(call_frame.argumentsCount(), count);
        @memcpy(value[0..n], slice[0..n]);
        return value;
    }

    /// This function protects out-of-bounds access by returning `JSValue.undefined`
    pub fn argument(self: *const CallFrame, i: usize) JSC.JSValue {
        return if (self.argumentsCount() > i) self.arguments()[i] else .undefined;
    }

    pub fn argumentsCount(self: *const CallFrame) u32 {
        return self.argumentCountIncludingThis() - 1;
    }

    /// When this CallFrame belongs to a constructor, this value is not the `this`
    /// value, but instead the value of `new.target`.
    pub fn this(self: *const CallFrame) JSC.JSValue {
        return self.asUnsafeJSValueArray()[offset_this_argument];
    }

    /// `JSValue` for the current function being called.
    pub fn callee(self: *const CallFrame) JSC.JSValue {
        return self.asUnsafeJSValueArray()[offset_callee];
    }

    /// From JavaScriptCore/interpreter/CallFrame.h
    ///
    ///   |          ......            |   |
    ///   +----------------------------+   |
    ///   |           argN             |   v  lower address
    ///   +----------------------------+
    ///   |           arg1             |
    ///   +----------------------------+
    ///   |           arg0             |
    ///   +----------------------------+
    ///   |           this             |
    ///   +----------------------------+
    ///   | argumentCountIncludingThis |
    ///   +----------------------------+
    ///   |          callee            |
    ///   +----------------------------+
    ///   |        codeBlock           |
    ///   +----------------------------+
    ///   |      return-address        |
    ///   +----------------------------+
    ///   |       callerFrame          |
    ///   +----------------------------+  <- callee's cfr is pointing this address
    ///   |          local0            |
    ///   +----------------------------+
    ///   |          local1            |
    ///   +----------------------------+
    ///   |          localN            |
    ///   +----------------------------+
    ///   |          ......            |
    ///
    /// The proper return type of this should be []Register, but
    inline fn asUnsafeJSValueArray(self: *const CallFrame) [*]const JSC.JSValue {
        return @ptrCast(@alignCast(self));
    }

    // These constants are from JSC::CallFrameSlot in JavaScriptCore/interpreter/CallFrame.h
    const offset_code_block = 2;
    const offset_callee = offset_code_block + 1;
    const offset_argument_count_including_this = offset_callee + 1;
    const offset_this_argument = offset_argument_count_including_this + 1;
    const offset_first_argument = offset_this_argument + 1;

    /// This function is manually ported from JSC's equivalent function in C++
    /// See JavaScriptCore/interpreter/CallFrame.h
    fn argumentCountIncludingThis(self: *const CallFrame) u32 {
        // Register defined in JavaScriptCore/interpreter/Register.h
        const Register = extern union {
            value: JSValue, // EncodedJSValue
            call_frame: *CallFrame,
            code_block: *anyopaque, // CodeBlock*
            /// EncodedValueDescriptor defined in JavaScriptCore/runtime/JSCJSValue.h
            encoded_value: extern union {
                ptr: JSValue, // JSCell*
                as_bits: extern struct {
                    payload: i32,
                    tag: i32,
                },
            },
            number: f64, // double
            integer: i64, // integer
        };
        const registers: [*]const Register = @alignCast(@ptrCast(self));
        // argumentCountIncludingThis takes the register at the defined offset, then
        // calls 'ALWAYS_INLINE int32_t Register::unboxedInt32() const',
        // which in turn calls 'ALWAYS_INLINE int32_t Register::payload() const'
        // which accesses `.encodedValue.asBits.payload`
        // JSC stores and works with value as signed, but it is always 1 or more.
        return @intCast(registers[offset_argument_count_including_this].encoded_value.as_bits.payload);
    }

    fn Arguments(comptime max: usize) type {
        return struct {
            ptr: [max]JSC.JSValue,
            len: usize,

            pub inline fn init(comptime i: usize, ptr: [*]const JSC.JSValue) @This() {
                var args: [max]JSC.JSValue = std.mem.zeroes([max]JSC.JSValue);
                args[0..i].* = ptr[0..i].*;

                return @This(){
                    .ptr = args,
                    .len = i,
                };
            }

            pub inline fn initUndef(comptime i: usize, ptr: [*]const JSC.JSValue) @This() {
                var args = [1]JSC.JSValue{.undefined} ** max;
                args[0..i].* = ptr[0..i].*;
                return @This(){ .ptr = args, .len = i };
            }

            pub inline fn slice(self: *const @This()) []const JSValue {
                return self.ptr[0..self.len];
            }

            pub inline fn mut(self: *@This()) []JSValue {
                return self.ptr[0..];
            }
        };
    }

    /// Do not use this function. Migration path:
    /// arguments(n).ptr[k] -> argumentsAsArray(n)[k]
    /// arguments(n).slice() -> arguments()
    /// arguments(n).mut() -> `var args = argumentsAsArray(n); &args`
    pub fn arguments_old(self: *const CallFrame, comptime max: usize) Arguments(max) {
        const slice = self.arguments();
        comptime bun.assert(max <= 14);
        return switch (@as(u4, @min(slice.len, max))) {
            0 => .{ .ptr = undefined, .len = 0 },
            inline 1...14 => |count| Arguments(max).init(comptime @min(count, max), slice.ptr),
            else => unreachable,
        };
    }

    /// Do not use this function. Migration path:
    /// argumentsAsArray(n)
    pub fn argumentsUndef(self: *const CallFrame, comptime max: usize) Arguments(max) {
        const slice = self.arguments();
        comptime bun.assert(max <= 9);
        return switch (@as(u4, @min(slice.len, max))) {
            0 => .{ .ptr = .{.undefined} ** max, .len = 0 },
            inline 1...9 => |count| Arguments(max).initUndef(@min(count, max), slice.ptr),
            else => unreachable,
        };
    }

    extern fn Bun__CallFrame__isFromBunMain(*const CallFrame, *const VM) bool;
    pub const isFromBunMain = Bun__CallFrame__isFromBunMain;

    extern fn Bun__CallFrame__getCallerSrcLoc(*const CallFrame, *JSGlobalObject, *bun.String, *c_uint, *c_uint) void;
    pub const CallerSrcLoc = struct {
        str: bun.String,
        line: c_uint,
        column: c_uint,
    };
    pub fn getCallerSrcLoc(call_frame: *const CallFrame, globalThis: *JSGlobalObject) CallerSrcLoc {
        var str: bun.String = undefined;
        var line: c_uint = undefined;
        var column: c_uint = undefined;
        Bun__CallFrame__getCallerSrcLoc(call_frame, globalThis, &str, &line, &column);
        return .{
            .str = str,
            .line = line,
            .column = column,
        };
    }
};
