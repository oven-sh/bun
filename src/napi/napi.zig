const std = @import("std");
const JSC = bun.JSC;
const strings = bun.strings;
const bun = @import("root").bun;
const Lock = bun.Mutex;
const JSValue = JSC.JSValue;
const ZigString = JSC.ZigString;
const TODO_EXCEPTION: JSC.C.ExceptionRef = null;

const Channel = @import("../sync.zig").Channel;

const log = bun.Output.scoped(.napi, false);

const Async = bun.Async;

/// Actually a JSGlobalObject
pub const NapiEnv = opaque {
    pub fn fromJS(global: *JSC.JSGlobalObject) *NapiEnv {
        return @ptrCast(global);
    }

    pub fn toJS(self: *NapiEnv) *JSC.JSGlobalObject {
        return @ptrCast(self);
    }

    extern fn napi_set_last_error(env: napi_env, status: NapiStatus) napi_status;

    /// Convert err to an extern napi_status, and store the error code in env so that it can be
    /// accessed by napi_get_last_error_info
    pub fn setLastError(self: *NapiEnv, err: NapiStatus) napi_status {
        return napi_set_last_error(self, err);
    }

    /// Convenience wrapper for setLastError(.ok)
    pub fn ok(self: *NapiEnv) napi_status {
        return self.setLastError(.ok);
    }

    /// These wrappers exist for convenience and so we can set a breakpoint in lldb
    pub fn invalidArg(self: *NapiEnv) napi_status {
        if (comptime bun.Environment.allow_assert) {
            log("invalid arg", .{});
        }
        return self.setLastError(.invalid_arg);
    }

    pub fn genericFailure(self: *NapiEnv) napi_status {
        if (comptime bun.Environment.allow_assert) {
            log("generic failure", .{});
        }
        return self.setLastError(.generic_failure);
    }
};

pub const napi_env = *NapiEnv;

/// Contents are not used by any Zig code
pub const Ref = opaque {};

pub const napi_ref = *Ref;

pub const NapiHandleScope = opaque {
    pub extern fn NapiHandleScope__open(globalObject: *JSC.JSGlobalObject, escapable: bool) ?*NapiHandleScope;
    pub extern fn NapiHandleScope__close(globalObject: *JSC.JSGlobalObject, current: ?*NapiHandleScope) void;
    extern fn NapiHandleScope__append(globalObject: *JSC.JSGlobalObject, value: JSValue) void;
    extern fn NapiHandleScope__escape(handleScope: *NapiHandleScope, value: JSValue) bool;

    /// Create a new handle scope in the given environment, or return null if creating one now is
    /// unsafe (i.e. inside a finalizer)
    pub fn open(env: napi_env, escapable: bool) ?*NapiHandleScope {
        return NapiHandleScope__open(env.toJS(), escapable);
    }

    /// Closes the given handle scope, releasing all values inside it, if it is safe to do so.
    /// Asserts that self is the current handle scope in env.
    pub fn close(self: ?*NapiHandleScope, env: napi_env) void {
        NapiHandleScope__close(env.toJS(), self);
    }

    /// Place a value in the handle scope. Must be done while returning any JS value into NAPI
    /// callbacks, as the value must remain alive as long as the handle scope is active, even if the
    /// native module doesn't keep it visible on the stack.
    pub fn append(env: napi_env, value: JSC.JSValue) void {
        NapiHandleScope__append(env.toJS(), value);
    }

    /// Move a value from the current handle scope (which must be escapable) to the reserved escape
    /// slot in the parent handle scope, allowing that value to outlive the current handle scope.
    /// Returns an error if escape() has already been called on this handle scope.
    pub fn escape(self: *NapiHandleScope, value: JSC.JSValue) error{EscapeCalledTwice}!void {
        if (!NapiHandleScope__escape(self, value)) {
            return error.EscapeCalledTwice;
        }
    }
};

pub const napi_handle_scope = ?*NapiHandleScope;
pub const napi_escapable_handle_scope = ?*NapiHandleScope;
pub const napi_callback_info = *JSC.CallFrame;
pub const napi_deferred = *JSC.JSPromise.Strong;

/// To ensure napi_values are not collected prematurely after being returned into a native module,
/// you must use these functions rather than convert between napi_value and JSC.JSValue directly
pub const napi_value = enum(i64) {
    _,

    pub fn set(
        self: *napi_value,
        env: napi_env,
        val: JSC.JSValue,
    ) void {
        NapiHandleScope.append(env, val);
        self.* = @enumFromInt(@intFromEnum(val));
    }

    pub fn get(self: *const napi_value) JSC.JSValue {
        return @enumFromInt(@intFromEnum(self.*));
    }

    pub fn create(env: napi_env, val: JSC.JSValue) napi_value {
        NapiHandleScope.append(env, val);
        return @enumFromInt(@intFromEnum(val));
    }
};

const char16_t = u16;
pub const napi_property_attributes = c_uint;
pub const napi_valuetype = enum(c_uint) {
    undefined = 0,
    null = 1,
    boolean = 2,
    number = 3,
    string = 4,
    symbol = 5,
    object = 6,
    function = 7,
    external = 8,
    bigint = 9,
};
pub const napi_typedarray_type = enum(c_uint) {
    int8_array = 0,
    uint8_array = 1,
    uint8_clamped_array = 2,
    int16_array = 3,
    uint16_array = 4,
    int32_array = 5,
    uint32_array = 6,
    float32_array = 7,
    float64_array = 8,
    bigint64_array = 9,
    biguint64_array = 10,

    pub fn fromJSType(this: JSC.JSValue.JSType) ?napi_typedarray_type {
        return switch (this) {
            .Int8Array => napi_typedarray_type.int8_array,
            .Uint8Array => napi_typedarray_type.uint8_array,
            .Uint8ClampedArray => napi_typedarray_type.uint8_clamped_array,
            .Int16Array => napi_typedarray_type.int16_array,
            .Uint16Array => napi_typedarray_type.uint16_array,
            .Int32Array => napi_typedarray_type.int32_array,
            .Uint32Array => napi_typedarray_type.uint32_array,
            .Float32Array => napi_typedarray_type.float32_array,
            .Float64Array => napi_typedarray_type.float64_array,
            .BigInt64Array => napi_typedarray_type.bigint64_array,
            .BigUint64Array => napi_typedarray_type.biguint64_array,
            else => null,
        };
    }

    pub fn toJSType(this: napi_typedarray_type) JSC.JSValue.JSType {
        return switch (this) {
            .int8_array => .Int8Array,
            .uint8_array => .Uint8Array,
            .uint8_clamped_array => .Uint8ClampedArray,
            .int16_array => .Int16Array,
            .uint16_array => .Uint16Array,
            .int32_array => .Int32Array,
            .uint32_array => .Uint32Array,
            .float32_array => .Float32Array,
            .float64_array => .Float64Array,
            .bigint64_array => .BigInt64Array,
            .biguint64_array => .BigUint64Array,
        };
    }

    pub fn toC(this: napi_typedarray_type) JSC.C.JSTypedArrayType {
        return this.toJSType().toC();
    }
};

pub const NapiStatus = enum(c_uint) {
    ok = 0,
    invalid_arg = 1,
    object_expected = 2,
    string_expected = 3,
    name_expected = 4,
    function_expected = 5,
    number_expected = 6,
    boolean_expected = 7,
    array_expected = 8,
    generic_failure = 9,
    pending_exception = 10,
    cancelled = 11,
    escape_called_twice = 12,
    handle_scope_mismatch = 13,
    callback_scope_mismatch = 14,
    queue_full = 15,
    closing = 16,
    bigint_expected = 17,
    date_expected = 18,
    arraybuffer_expected = 19,
    detachable_arraybuffer_expected = 20,
    would_deadlock = 21,
};

/// This is not an `enum` so that the enum values cannot be trivially returned from NAPI functions,
/// as that would skip storing the last error code. You should wrap return values in a call to
/// napi_env.setLastError.
pub const napi_status = c_uint;

pub const napi_callback = ?*const fn (napi_env, napi_callback_info) callconv(.C) napi_value;

/// expects `napi_env`, `callback_data`, `context`
pub const napi_finalize = ?*const fn (napi_env, ?*anyopaque, ?*anyopaque) callconv(.C) void;
pub const napi_property_descriptor = extern struct {
    utf8name: [*c]const u8,
    name: napi_value,
    method: napi_callback,
    getter: napi_callback,
    setter: napi_callback,
    value: napi_value,
    attributes: napi_property_attributes,
    data: ?*anyopaque,
};
pub const napi_extended_error_info = extern struct {
    error_message: [*c]const u8,
    engine_reserved: ?*anyopaque,
    engine_error_code: u32,
    error_code: napi_status,
};

const napi_key_collection_mode = c_uint;
const napi_key_filter = c_uint;
const napi_key_conversion = c_uint;
const napi_type_tag = extern struct {
    lower: u64,
    upper: u64,
};
pub extern fn napi_get_last_error_info(env: napi_env, result: [*c][*c]const napi_extended_error_info) napi_status;
pub export fn napi_get_undefined(env: napi_env, result_: ?*napi_value) napi_status {
    log("napi_get_undefined", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSValue.jsUndefined());
    return env.ok();
}
pub export fn napi_get_null(env: napi_env, result_: ?*napi_value) napi_status {
    log("napi_get_null", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSValue.jsNull());
    return env.ok();
}
pub extern fn napi_get_global(env: napi_env, result: *napi_value) napi_status;
pub export fn napi_get_boolean(env: napi_env, value: bool, result_: ?*napi_value) napi_status {
    log("napi_get_boolean", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSValue.jsBoolean(value));
    return env.ok();
}
pub export fn napi_create_array(env: napi_env, result_: ?*napi_value) napi_status {
    log("napi_create_array", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSValue.createEmptyArray(env.toJS(), 0));
    return env.ok();
}
pub export fn napi_create_array_with_length(env: napi_env, length: usize, result_: ?*napi_value) napi_status {
    log("napi_create_array_with_length", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };

    // JSC createEmptyArray takes u32
    // Node and V8 convert out-of-bounds array sizes to 0
    const len = std.math.cast(u32, length) orelse 0;

    const array = JSC.JSValue.createEmptyArray(env.toJS(), len);
    array.ensureStillAlive();
    result.set(env, array);
    return env.ok();
}
pub extern fn napi_create_double(_: napi_env, value: f64, result: *napi_value) napi_status;
pub export fn napi_create_int32(env: napi_env, value: i32, result_: ?*napi_value) napi_status {
    log("napi_create_int32", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSValue.jsNumber(value));
    return env.ok();
}
pub export fn napi_create_uint32(env: napi_env, value: u32, result_: ?*napi_value) napi_status {
    log("napi_create_uint32", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSValue.jsNumber(value));
    return env.ok();
}
pub export fn napi_create_int64(env: napi_env, value: i64, result_: ?*napi_value) napi_status {
    log("napi_create_int64", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSValue.jsNumber(value));
    return env.ok();
}
pub export fn napi_create_string_latin1(env: napi_env, str: ?[*]const u8, length: usize, result_: ?*napi_value) napi_status {
    const result: *napi_value = result_ orelse {
        return env.invalidArg();
    };

    const slice: []const u8 = brk: {
        if (NAPI_AUTO_LENGTH == length) {
            break :brk bun.sliceTo(@as([*:0]const u8, @ptrCast(str)), 0);
        } else if (length > std.math.maxInt(u32)) {
            return env.invalidArg();
        }

        if (str) |ptr|
            break :brk ptr[0..length];

        return env.invalidArg();
    };

    log("napi_create_string_latin1: {s}", .{slice});

    if (slice.len == 0) {
        result.set(env, bun.String.empty.toJS(env.toJS()));
        return env.ok();
    }

    var string, const bytes = bun.String.createUninitialized(.latin1, slice.len);
    defer string.deref();

    @memcpy(bytes, slice);

    result.set(env, string.toJS(env.toJS()));
    return env.ok();
}
pub export fn napi_create_string_utf8(env: napi_env, str: ?[*]const u8, length: usize, result_: ?*napi_value) napi_status {
    const result: *napi_value = result_ orelse {
        return env.invalidArg();
    };
    const slice: []const u8 = brk: {
        if (NAPI_AUTO_LENGTH == length) {
            break :brk bun.sliceTo(@as([*:0]const u8, @ptrCast(str)), 0);
        } else if (length > std.math.maxInt(u32)) {
            return env.invalidArg();
        }

        if (str) |ptr|
            break :brk ptr[0..length];

        return env.invalidArg();
    };

    log("napi_create_string_utf8: {s}", .{slice});

    var string = bun.String.createUTF8(slice);
    if (string.tag == .Dead) {
        return env.genericFailure();
    }

    defer string.deref();
    result.set(env, string.toJS(env.toJS()));
    return env.ok();
}
pub export fn napi_create_string_utf16(env: napi_env, str: ?[*]const char16_t, length: usize, result_: ?*napi_value) napi_status {
    const result: *napi_value = result_ orelse {
        return env.invalidArg();
    };

    const slice: []const u16 = brk: {
        if (NAPI_AUTO_LENGTH == length) {
            break :brk bun.sliceTo(@as([*:0]const u16, @ptrCast(str)), 0);
        } else if (length > std.math.maxInt(u32)) {
            return env.invalidArg();
        }

        if (str) |ptr|
            break :brk ptr[0..length];

        return env.invalidArg();
    };

    if (comptime bun.Environment.allow_assert)
        log("napi_create_string_utf16: {d} {any}", .{ slice.len, bun.fmt.FormatUTF16{ .buf = slice[0..@min(slice.len, 512)] } });

    if (slice.len == 0) {
        result.set(env, bun.String.empty.toJS(env.toJS()));
    }

    var string, const chars = bun.String.createUninitialized(.utf16, slice.len);
    defer string.deref();

    @memcpy(chars, slice);

    result.set(env, string.toJS(env.toJS()));
    return env.ok();
}
pub extern fn napi_create_symbol(env: napi_env, description: napi_value, result: *napi_value) napi_status;
pub extern fn napi_create_error(env: napi_env, code: napi_value, msg: napi_value, result: *napi_value) napi_status;
pub extern fn napi_create_type_error(env: napi_env, code: napi_value, msg: napi_value, result: *napi_value) napi_status;
pub extern fn napi_create_range_error(env: napi_env, code: napi_value, msg: napi_value, result: *napi_value) napi_status;
pub extern fn napi_typeof(env: napi_env, value: napi_value, result: *napi_valuetype) napi_status;
pub extern fn napi_get_value_double(env: napi_env, value: napi_value, result: *f64) napi_status;
pub extern fn napi_get_value_int32(_: napi_env, value_: napi_value, result: ?*i32) napi_status;
pub extern fn napi_get_value_uint32(_: napi_env, value_: napi_value, result_: ?*u32) napi_status;
pub extern fn napi_get_value_int64(_: napi_env, value_: napi_value, result_: ?*i64) napi_status;
pub export fn napi_get_value_bool(env: napi_env, value_: napi_value, result_: ?*bool) napi_status {
    log("napi_get_value_bool", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    const value = value_.get();

    result.* = value.to(bool);
    return env.ok();
}
inline fn maybeAppendNull(ptr: anytype, doit: bool) void {
    if (doit) {
        ptr.* = 0;
    }
}
pub export fn napi_get_value_string_latin1(env: napi_env, value_: napi_value, buf_ptr_: ?[*:0]c_char, bufsize: usize, result_ptr: ?*usize) napi_status {
    log("napi_get_value_string_latin1", .{});
    const value = value_.get();
    defer value.ensureStillAlive();
    const buf_ptr = @as(?[*:0]u8, @ptrCast(buf_ptr_));

    const str = value.toBunString(env.toJS());
    defer str.deref();

    var buf = buf_ptr orelse {
        if (result_ptr) |result| {
            result.* = str.latin1ByteLength();
        }

        return env.ok();
    };

    if (str.isEmpty()) {
        if (result_ptr) |result| {
            result.* = 0;
        }
        buf[0] = 0;

        return env.ok();
    }

    var buf_ = buf[0..bufsize];

    if (bufsize == NAPI_AUTO_LENGTH) {
        buf_ = bun.sliceTo(buf_ptr.?, 0);
        if (buf_.len == 0) {
            if (result_ptr) |result| {
                result.* = 0;
            }
            return env.ok();
        }
    }
    const written = str.encodeInto(buf_, .latin1) catch unreachable;
    const max_buf_len = buf_.len;

    if (result_ptr) |result| {
        result.* = written;
    } else if (written < max_buf_len) {
        buf[written] = 0;
    }

    return env.ok();
}

/// Copies a JavaScript string into a UTF-8 string buffer. The result is the
/// number of bytes (excluding the null terminator) copied into buf.
/// A sufficient buffer size should be greater than the length of string,
/// reserving space for null terminator.
/// If bufsize is insufficient, the string will be truncated and null terminated.
/// If buf is NULL, this method returns the length of the string (in bytes)
/// via the result parameter.
/// The result argument is optional unless buf is NULL.
pub extern fn napi_get_value_string_utf8(env: napi_env, value: napi_value, buf_ptr: [*c]u8, bufsize: usize, result_ptr: ?*usize) napi_status;
pub export fn napi_get_value_string_utf16(env: napi_env, value_: napi_value, buf_ptr: ?[*]char16_t, bufsize: usize, result_ptr: ?*usize) napi_status {
    log("napi_get_value_string_utf16", .{});
    const value = value_.get();
    defer value.ensureStillAlive();
    const str = value.toBunString(env.toJS());
    defer str.deref();

    var buf = buf_ptr orelse {
        if (result_ptr) |result| {
            result.* = str.utf16ByteLength();
        }

        return env.ok();
    };

    if (str.isEmpty()) {
        if (result_ptr) |result| {
            result.* = 0;
        }
        buf[0] = 0;

        return env.ok();
    }

    var buf_ = buf[0..bufsize];

    if (bufsize == NAPI_AUTO_LENGTH) {
        buf_ = bun.sliceTo(@as([*:0]u16, @ptrCast(buf_ptr.?)), 0);
        if (buf_.len == 0) {
            if (result_ptr) |result| {
                result.* = 0;
            }
            return env.ok();
        }
    }

    const max_buf_len = buf_.len;
    const written = (str.encodeInto(std.mem.sliceAsBytes(buf_), .utf16le) catch unreachable) >> 1;

    if (result_ptr) |result| {
        result.* = written;
        // We should only write to the buffer is no result pointer is provided.
        // If we perform both operations,
    } else if (written < max_buf_len) {
        buf[written] = 0;
    }

    return env.ok();
}
pub export fn napi_coerce_to_bool(env: napi_env, value_: napi_value, result_: ?*napi_value) napi_status {
    log("napi_coerce_to_bool", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    const value = value_.get();
    result.set(env, JSValue.jsBoolean(value.coerce(bool, env.toJS())));
    return env.ok();
}
pub export fn napi_coerce_to_number(env: napi_env, value_: napi_value, result_: ?*napi_value) napi_status {
    log("napi_coerce_to_number", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    const value = value_.get();
    result.set(env, JSC.JSValue.jsNumber(JSC.C.JSValueToNumber(env.toJS().ref(), value.asObjectRef(), TODO_EXCEPTION)));
    return env.ok();
}
pub export fn napi_coerce_to_object(env: napi_env, value_: napi_value, result_: ?*napi_value) napi_status {
    log("napi_coerce_to_object", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    const value = value_.get();
    result.set(env, JSValue.c(JSC.C.JSValueToObject(env.toJS().ref(), value.asObjectRef(), TODO_EXCEPTION)));
    return env.ok();
}
pub export fn napi_get_prototype(env: napi_env, object_: napi_value, result_: ?*napi_value) napi_status {
    log("napi_get_prototype", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    const object = object_.get();
    if (!object.isObject()) {
        return env.setLastError(.object_expected);
    }

    result.set(env, JSValue.c(JSC.C.JSObjectGetPrototype(env.toJS().ref(), object.asObjectRef())));
    return env.ok();
}
// TODO: bind JSC::ownKeys
// pub export fn napi_get_property_names(env: napi_env, object: napi_value, result: *napi_value) napi_status {
// log("napi_get_property_names     ", .{});
// if (!object.isObject()) {
//         return .object_expected;
//     }

//     result.* =
// }
pub export fn napi_set_element(env: napi_env, object_: napi_value, index: c_uint, value_: napi_value) napi_status {
    log("napi_set_element", .{});
    const object = object_.get();
    const value = value_.get();
    if (!object.jsType().isIndexable()) {
        return env.setLastError(.array_expected);
    }
    if (value == .zero)
        return env.invalidArg();
    JSC.C.JSObjectSetPropertyAtIndex(env.toJS().ref(), object.asObjectRef(), index, value.asObjectRef(), TODO_EXCEPTION);
    return env.ok();
}
pub export fn napi_has_element(env: napi_env, object_: napi_value, index: c_uint, result_: ?*bool) napi_status {
    log("napi_has_element", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    const object = object_.get();

    if (!object.jsType().isIndexable()) {
        return env.setLastError(.array_expected);
    }

    result.* = object.getLength(env.toJS()) > index;
    return env.ok();
}
pub extern fn napi_get_element(env: napi_env, object: napi_value, index: u32, result: *napi_value) napi_status;
pub extern fn napi_delete_element(env: napi_env, object: napi_value, index: u32, result: *napi_value) napi_status;
pub extern fn napi_define_properties(env: napi_env, object: napi_value, property_count: usize, properties: [*c]const napi_property_descriptor) napi_status;
pub export fn napi_is_array(env: napi_env, value_: napi_value, result_: ?*bool) napi_status {
    log("napi_is_array", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    const value = value_.get();
    result.* = value.jsType().isArray();
    return env.ok();
}
pub export fn napi_get_array_length(env: napi_env, value_: napi_value, result_: [*c]u32) napi_status {
    log("napi_get_array_length", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    const value = value_.get();

    if (!value.jsType().isArray()) {
        return env.setLastError(.array_expected);
    }

    result.* = @as(u32, @truncate(value.getLength(env.toJS())));
    return env.ok();
}
pub export fn napi_strict_equals(env: napi_env, lhs_: napi_value, rhs_: napi_value, result_: ?*bool) napi_status {
    log("napi_strict_equals", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    const lhs, const rhs = .{ lhs_.get(), rhs_.get() };
    // there is some nuance with NaN here i'm not sure about
    result.* = lhs.isSameValue(rhs, env.toJS());
    return env.ok();
}
pub extern fn napi_call_function(env: napi_env, recv: napi_value, func: napi_value, argc: usize, argv: [*c]const napi_value, result: *napi_value) napi_status;
pub extern fn napi_new_instance(env: napi_env, constructor: napi_value, argc: usize, argv: [*c]const napi_value, result_: ?*napi_value) napi_status;
pub export fn napi_instanceof(env: napi_env, object_: napi_value, constructor_: napi_value, result_: ?*bool) napi_status {
    log("napi_instanceof", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    const object, const constructor = .{ object_.get(), constructor_.get() };
    // TODO: does this throw object_expected in node?
    result.* = object.isObject() and object.isInstanceOf(env.toJS(), constructor);
    return env.ok();
}
pub extern fn napi_get_cb_info(env: napi_env, cbinfo: napi_callback_info, argc: [*c]usize, argv: *napi_value, this_arg: *napi_value, data: [*]*anyopaque) napi_status;
pub extern fn napi_get_new_target(env: napi_env, cbinfo: napi_callback_info, result: *napi_value) napi_status;
pub extern fn napi_define_class(
    env: napi_env,
    utf8name: [*c]const u8,
    length: usize,
    constructor: napi_callback,
    data: ?*anyopaque,
    property_count: usize,
    properties: [*c]const napi_property_descriptor,
    result: *napi_value,
) napi_status;
pub extern fn napi_wrap(env: napi_env, js_object: napi_value, native_object: ?*anyopaque, finalize_cb: napi_finalize, finalize_hint: ?*anyopaque, result: *napi_ref) napi_status;
pub extern fn napi_unwrap(env: napi_env, js_object: napi_value, result: [*]*anyopaque) napi_status;
pub extern fn napi_remove_wrap(env: napi_env, js_object: napi_value, result: [*]*anyopaque) napi_status;
pub extern fn napi_create_object(env: napi_env, result: *napi_value) napi_status;
pub extern fn napi_create_external(env: napi_env, data: ?*anyopaque, finalize_cb: napi_finalize, finalize_hint: ?*anyopaque, result: *napi_value) napi_status;
pub extern fn napi_get_value_external(env: napi_env, value: napi_value, result: [*]*anyopaque) napi_status;
pub extern fn napi_create_reference(env: napi_env, value: napi_value, initial_refcount: u32, result: *napi_ref) napi_status;
pub extern fn napi_delete_reference(env: napi_env, ref: napi_ref) napi_status;
pub extern fn napi_reference_ref(env: napi_env, ref: napi_ref, result: [*c]u32) napi_status;
pub extern fn napi_reference_unref(env: napi_env, ref: napi_ref, result: [*c]u32) napi_status;
pub extern fn napi_get_reference_value(env: napi_env, ref: napi_ref, result: *napi_value) napi_status;
pub extern fn napi_get_reference_value_internal(ref: napi_ref) JSC.JSValue;

pub export fn napi_open_handle_scope(env: napi_env, result_: ?*napi_handle_scope) napi_status {
    log("napi_open_handle_scope", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.* = NapiHandleScope.open(env, false);
    return env.ok();
}

pub export fn napi_close_handle_scope(env: napi_env, handle_scope: napi_handle_scope) napi_status {
    log("napi_close_handle_scope", .{});
    if (handle_scope) |scope| {
        scope.close(env);
    }

    return env.ok();
}

// we don't support async contexts
pub export fn napi_async_init(env: napi_env, _: napi_value, _: napi_value, async_ctx: **anyopaque) napi_status {
    log("napi_async_init", .{});
    async_ctx.* = env;
    return env.ok();
}

// we don't support async contexts
pub export fn napi_async_destroy(env: napi_env, _: *anyopaque) napi_status {
    log("napi_async_destroy", .{});
    return env.ok();
}

// this is just a regular function call
pub export fn napi_make_callback(env: napi_env, _: *anyopaque, recv_: napi_value, func_: napi_value, arg_count: usize, args: ?[*]const napi_value, maybe_result: ?*napi_value) napi_status {
    log("napi_make_callback", .{});
    const recv, const func = .{ recv_.get(), func_.get() };
    if (func.isEmptyOrUndefinedOrNull() or !func.isCallable(env.toJS().vm())) {
        return env.setLastError(.function_expected);
    }

    const res = func.call(
        env.toJS(),
        if (recv != .zero)
            recv
        else
            .undefined,
        if (arg_count > 0 and args != null)
            @as([*]const JSC.JSValue, @ptrCast(args.?))[0..arg_count]
        else
            &.{},
    ) catch |err| // TODO: handle errors correctly
        env.toJS().takeException(err);

    if (maybe_result) |result| {
        result.set(env, res);
    }

    // TODO: this is likely incorrect
    if (res.isAnyError()) {
        return env.setLastError(.pending_exception);
    }

    return env.ok();
}

// Sometimes shared libraries reference symbols which are not used
// We don't want to fail to load the library because of that
// so we instead return an error and warn the user
fn notImplementedYet(comptime name: []const u8) void {
    bun.onceUnsafe(
        struct {
            pub fn warn() void {
                if (JSC.VirtualMachine.get().log.level.atLeast(.warn)) {
                    bun.Output.prettyErrorln("<r><yellow>warning<r><d>:<r> Node-API function <b>\"{s}\"<r> is not implemented yet.\n Track the status of Node-API in Bun: https://github.com/oven-sh/bun/issues/158", .{name});
                    bun.Output.flush();
                }
            }
        }.warn,
        void,
    );
}

pub export fn napi_open_escapable_handle_scope(env: napi_env, result_: ?*napi_escapable_handle_scope) napi_status {
    log("napi_open_escapable_handle_scope", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.* = NapiHandleScope.open(env, true);
    return env.ok();
}
pub export fn napi_close_escapable_handle_scope(env: napi_env, scope: napi_escapable_handle_scope) napi_status {
    log("napi_close_escapable_handle_scope", .{});
    if (scope) |s| {
        s.close(env);
    }
    return env.ok();
}
pub export fn napi_escape_handle(env: napi_env, scope_: napi_escapable_handle_scope, escapee: napi_value, result_: ?*napi_value) napi_status {
    log("napi_escape_handle", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    const scope = scope_ orelse {
        return env.invalidArg();
    };
    scope.escape(escapee.get()) catch return env.setLastError(.escape_called_twice);
    result.* = escapee;
    return env.ok();
}
pub extern fn napi_type_tag_object(_: napi_env, _: napi_value, _: [*c]const napi_type_tag) napi_status;
pub extern fn napi_check_object_type_tag(_: napi_env, _: napi_value, _: [*c]const napi_type_tag, _: *bool) napi_status;

// do nothing for both of these
pub export fn napi_open_callback_scope(env: napi_env, _: napi_value, _: *anyopaque, _: *anyopaque) napi_status {
    log("napi_open_callback_scope", .{});
    return env.ok();
}
pub export fn napi_close_callback_scope(env: napi_env, _: *anyopaque) napi_status {
    log("napi_close_callback_scope", .{});
    return env.ok();
}
pub extern fn napi_throw(env: napi_env, @"error": napi_value) napi_status;
pub extern fn napi_throw_error(env: napi_env, code: [*c]const u8, msg: [*c]const u8) napi_status;
pub extern fn napi_throw_type_error(env: napi_env, code: [*c]const u8, msg: [*c]const u8) napi_status;
pub extern fn napi_throw_range_error(env: napi_env, code: [*c]const u8, msg: [*c]const u8) napi_status;
pub export fn napi_is_error(env: napi_env, value_: napi_value, result: *bool) napi_status {
    log("napi_is_error", .{});
    const value = value_.get();
    result.* = value.isAnyError();
    return env.ok();
}
pub extern fn napi_is_exception_pending(env: napi_env, result: *bool) napi_status;
pub extern fn napi_get_and_clear_last_exception(env: napi_env, result: *napi_value) napi_status;
pub export fn napi_is_arraybuffer(env: napi_env, value_: napi_value, result_: ?*bool) napi_status {
    log("napi_is_arraybuffer", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    const value = value_.get();
    result.* = !value.isNumber() and value.jsTypeLoose() == .ArrayBuffer;
    return env.ok();
}
pub extern fn napi_create_arraybuffer(env: napi_env, byte_length: usize, data: [*]const u8, result: *napi_value) napi_status;

pub extern fn napi_create_external_arraybuffer(env: napi_env, external_data: ?*anyopaque, byte_length: usize, finalize_cb: napi_finalize, finalize_hint: ?*anyopaque, result: *napi_value) napi_status;

pub export fn napi_get_arraybuffer_info(env: napi_env, arraybuffer_: napi_value, data: ?*[*]u8, byte_length: ?*usize) napi_status {
    log("napi_get_arraybuffer_info", .{});
    const arraybuffer = arraybuffer_.get();
    const array_buffer = arraybuffer.asArrayBuffer(env.toJS()) orelse return env.setLastError(.arraybuffer_expected);
    const slice = array_buffer.slice();
    if (data) |dat|
        dat.* = slice.ptr;
    if (byte_length) |len|
        len.* = slice.len;
    return env.ok();
}
pub export fn napi_is_typedarray(env: napi_env, value_: napi_value, result_: ?*bool) napi_status {
    log("napi_is_typedarray", .{});
    const value = value_.get();
    const result = result_ orelse return env.invalidArg();
    result.* = value.jsTypeLoose().isTypedArray();
    return env.ok();
}
pub export fn napi_create_typedarray(env: napi_env, @"type": napi_typedarray_type, length: usize, arraybuffer_: napi_value, byte_offset: usize, result_: ?*napi_value) napi_status {
    log("napi_create_typedarray", .{});
    const arraybuffer = arraybuffer_.get();
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSValue.c(
        JSC.C.JSObjectMakeTypedArrayWithArrayBufferAndOffset(
            env.toJS().ref(),
            @"type".toC(),
            arraybuffer.asObjectRef(),
            byte_offset,
            length,
            TODO_EXCEPTION,
        ),
    ));
    return env.ok();
}
pub export fn napi_get_typedarray_info(
    env: napi_env,
    typedarray_: napi_value,
    maybe_type: ?*napi_typedarray_type,
    maybe_length: ?*usize,
    maybe_data: ?*[*]u8,
    maybe_arraybuffer: ?*napi_value,
    maybe_byte_offset: ?*usize,
) napi_status {
    log("napi_get_typedarray_info", .{});
    const typedarray = typedarray_.get();
    if (typedarray.isEmptyOrUndefinedOrNull())
        return env.invalidArg();
    defer typedarray.ensureStillAlive();

    const array_buffer = typedarray.asArrayBuffer(env.toJS()) orelse return env.invalidArg();
    if (maybe_type) |@"type"|
        @"type".* = napi_typedarray_type.fromJSType(array_buffer.typed_array_type) orelse return env.invalidArg();

    // TODO: handle detached
    if (maybe_data) |data|
        data.* = array_buffer.ptr;

    if (maybe_length) |length|
        length.* = array_buffer.len;

    if (maybe_arraybuffer) |arraybuffer|
        arraybuffer.set(env, JSValue.c(JSC.C.JSObjectGetTypedArrayBuffer(env.toJS().ref(), typedarray.asObjectRef(), null)));

    if (maybe_byte_offset) |byte_offset|
        byte_offset.* = array_buffer.offset;
    return env.ok();
}
pub extern fn napi_create_dataview(env: napi_env, length: usize, arraybuffer: napi_value, byte_offset: usize, result: *napi_value) napi_status;
pub export fn napi_is_dataview(env: napi_env, value_: napi_value, result_: ?*bool) napi_status {
    log("napi_is_dataview", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    const value = value_.get();
    result.* = !value.isEmptyOrUndefinedOrNull() and value.jsTypeLoose() == .DataView;
    return env.ok();
}
pub export fn napi_get_dataview_info(
    env: napi_env,
    dataview_: napi_value,
    maybe_bytelength: ?*usize,
    maybe_data: ?*[*]u8,
    maybe_arraybuffer: ?*napi_value,
    maybe_byte_offset: ?*usize,
) napi_status {
    log("napi_get_dataview_info", .{});
    const dataview = dataview_.get();
    const array_buffer = dataview.asArrayBuffer(env.toJS()) orelse return env.setLastError(.object_expected);
    if (maybe_bytelength) |bytelength|
        bytelength.* = array_buffer.byte_len;

    if (maybe_data) |data|
        data.* = array_buffer.ptr;

    if (maybe_arraybuffer) |arraybuffer|
        arraybuffer.set(env, JSValue.c(JSC.C.JSObjectGetTypedArrayBuffer(env.toJS().ref(), dataview.asObjectRef(), null)));

    if (maybe_byte_offset) |byte_offset|
        byte_offset.* = array_buffer.offset;

    return env.ok();
}
pub export fn napi_get_version(env: napi_env, result_: ?*u32) napi_status {
    log("napi_get_version", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.* = NAPI_VERSION;
    return env.ok();
}
pub export fn napi_create_promise(env: napi_env, deferred_: ?*napi_deferred, promise_: ?*napi_value) napi_status {
    log("napi_create_promise", .{});
    const deferred = deferred_ orelse {
        return env.invalidArg();
    };
    const promise = promise_ orelse {
        return env.invalidArg();
    };
    deferred.* = bun.default_allocator.create(JSC.JSPromise.Strong) catch @panic("failed to allocate napi_deferred");
    deferred.*.* = JSC.JSPromise.Strong.init(env.toJS());
    promise.set(env, deferred.*.get().asValue(env.toJS()));
    return env.ok();
}
pub export fn napi_resolve_deferred(env: napi_env, deferred: napi_deferred, resolution_: napi_value) napi_status {
    log("napi_resolve_deferred", .{});
    const resolution = resolution_.get();
    var prom = deferred.get();
    prom.resolve(env.toJS(), resolution);
    deferred.deinit();
    bun.default_allocator.destroy(deferred);
    return env.ok();
}
pub export fn napi_reject_deferred(env: napi_env, deferred: napi_deferred, rejection_: napi_value) napi_status {
    log("napi_reject_deferred", .{});
    const rejection = rejection_.get();
    var prom = deferred.get();
    prom.reject(env.toJS(), rejection);
    deferred.deinit();
    bun.default_allocator.destroy(deferred);
    return env.ok();
}
pub export fn napi_is_promise(env: napi_env, value_: napi_value, is_promise_: ?*bool) napi_status {
    log("napi_is_promise", .{});
    const value = value_.get();
    const is_promise = is_promise_ orelse {
        return env.invalidArg();
    };

    if (value == .zero) {
        return env.invalidArg();
    }

    is_promise.* = value.asAnyPromise() != null;
    return env.ok();
}
pub extern fn napi_run_script(env: napi_env, script: napi_value, result: *napi_value) napi_status;
pub extern fn napi_adjust_external_memory(env: napi_env, change_in_bytes: i64, adjusted_value: [*c]i64) napi_status;
pub export fn napi_create_date(env: napi_env, time: f64, result_: ?*napi_value) napi_status {
    log("napi_create_date", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    var args = [_]JSC.C.JSValueRef{JSC.JSValue.jsNumber(time).asObjectRef()};
    result.set(env, JSValue.c(JSC.C.JSObjectMakeDate(env.toJS().ref(), 1, &args, TODO_EXCEPTION)));
    return env.ok();
}
pub export fn napi_is_date(env: napi_env, value_: napi_value, is_date_: ?*bool) napi_status {
    log("napi_is_date", .{});
    const is_date = is_date_ orelse {
        return env.invalidArg();
    };
    const value = value_.get();
    is_date.* = value.jsTypeLoose() == .JSDate;
    return env.ok();
}
pub extern fn napi_get_date_value(env: napi_env, value: napi_value, result: *f64) napi_status;
pub extern fn napi_add_finalizer(env: napi_env, js_object: napi_value, native_object: ?*anyopaque, finalize_cb: napi_finalize, finalize_hint: ?*anyopaque, result: napi_ref) napi_status;
pub export fn napi_create_bigint_int64(env: napi_env, value: i64, result_: ?*napi_value) napi_status {
    log("napi_create_bigint_int64", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSC.JSValue.fromInt64NoTruncate(env.toJS(), value));
    return env.ok();
}
pub export fn napi_create_bigint_uint64(env: napi_env, value: u64, result_: ?*napi_value) napi_status {
    log("napi_create_bigint_uint64", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSC.JSValue.fromUInt64NoTruncate(env.toJS(), value));
    return env.ok();
}
pub extern fn napi_create_bigint_words(env: napi_env, sign_bit: c_int, word_count: usize, words: [*c]const u64, result: *napi_value) napi_status;
pub extern fn napi_get_value_bigint_int64(env: napi_env, value: napi_value, result: ?*i64, lossless: ?*bool) napi_status;
pub extern fn napi_get_value_bigint_uint64(env: napi_env, value: napi_value, result: ?*u64, lossless: ?*bool) napi_status;

pub extern fn napi_get_value_bigint_words(env: napi_env, value: napi_value, sign_bit: [*c]c_int, word_count: [*c]usize, words: [*c]u64) napi_status;
pub extern fn napi_get_all_property_names(env: napi_env, object: napi_value, key_mode: napi_key_collection_mode, key_filter: napi_key_filter, key_conversion: napi_key_conversion, result: *napi_value) napi_status;
pub extern fn napi_set_instance_data(env: napi_env, data: ?*anyopaque, finalize_cb: napi_finalize, finalize_hint: ?*anyopaque) napi_status;
pub extern fn napi_get_instance_data(env: napi_env, data: [*]*anyopaque) napi_status;
pub extern fn napi_detach_arraybuffer(env: napi_env, arraybuffer: napi_value) napi_status;
pub extern fn napi_is_detached_arraybuffer(env: napi_env, value: napi_value, result: *bool) napi_status;

pub const struct_napi_async_work__ = opaque {};
const WorkPool = @import("../work_pool.zig").WorkPool;
const WorkPoolTask = @import("../work_pool.zig").Task;

/// must be globally allocated
pub const napi_async_work = struct {
    task: WorkPoolTask = .{ .callback = &runFromThreadPool },
    concurrent_task: JSC.ConcurrentTask = .{},
    completion_task: ?*anyopaque = null,
    event_loop: *JSC.EventLoop,
    global: *JSC.JSGlobalObject,
    execute: napi_async_execute_callback = null,
    complete: napi_async_complete_callback = null,
    ctx: ?*anyopaque = null,
    status: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    can_deinit: bool = false,
    wait_for_deinit: bool = false,
    scheduled: bool = false,
    ref: Async.KeepAlive = .{},
    pub const Status = enum(u32) {
        pending = 0,
        started = 1,
        completed = 2,
        cancelled = 3,
    };

    pub fn create(global: *JSC.JSGlobalObject, execute: napi_async_execute_callback, complete: napi_async_complete_callback, ctx: ?*anyopaque) !*napi_async_work {
        const work = try bun.default_allocator.create(napi_async_work);
        work.* = .{
            .global = global,
            .execute = execute,
            .event_loop = global.bunVM().eventLoop(),
            .complete = complete,
            .ctx = ctx,
        };
        return work;
    }

    pub fn runFromThreadPool(task: *WorkPoolTask) void {
        var this: *napi_async_work = @fieldParentPtr("task", task);

        this.run();
    }
    pub fn run(this: *napi_async_work) void {
        if (this.status.cmpxchgStrong(@intFromEnum(Status.pending), @intFromEnum(Status.started), .seq_cst, .seq_cst)) |state| {
            if (state == @intFromEnum(Status.cancelled)) {
                if (this.wait_for_deinit) {
                    // this might cause a segfault due to Task using a linked list!
                    bun.default_allocator.destroy(this);
                }
            }
            return;
        }
        this.execute.?(NapiEnv.fromJS(this.global), this.ctx);
        this.status.store(@intFromEnum(Status.completed), .seq_cst);

        this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
    }

    pub fn schedule(this: *napi_async_work) void {
        if (this.scheduled) return;
        this.scheduled = true;
        this.ref.ref(this.global.bunVM());
        WorkPool.schedule(&this.task);
    }

    pub fn cancel(this: *napi_async_work) bool {
        this.ref.unref(this.global.bunVM());
        return this.status.cmpxchgStrong(@intFromEnum(Status.cancelled), @intFromEnum(Status.pending), .seq_cst, .seq_cst) != null;
    }

    pub fn deinit(this: *napi_async_work) void {
        this.ref.unref(this.global.bunVM());

        if (this.can_deinit) {
            bun.default_allocator.destroy(this);
            return;
        }
        this.wait_for_deinit = true;
    }

    fn runFromJSWithError(this: *napi_async_work) bun.JSError!void {
        const handle_scope = NapiHandleScope.open(NapiEnv.fromJS(this.global), false);
        defer if (handle_scope) |scope| scope.close(NapiEnv.fromJS(this.global));
        this.complete.?(
            NapiEnv.fromJS(this.global),
            @intFromEnum(if (this.status.load(.seq_cst) == @intFromEnum(Status.cancelled))
                NapiStatus.cancelled
            else
                NapiStatus.ok),
            this.ctx.?,
        );
        if (this.global.hasException()) {
            return error.JSError;
        }
    }

    pub fn runFromJS(this: *napi_async_work) void {
        this.runFromJSWithError() catch |e| {
            this.global.reportActiveExceptionAsUnhandled(e);
        };
    }
};
pub const napi_threadsafe_function = *ThreadSafeFunction;
pub const napi_threadsafe_function_release_mode = enum(c_uint) {
    release = 0,
    abort = 1,
};
pub const napi_tsfn_nonblocking = 0;
pub const napi_tsfn_blocking = 1;
pub const napi_threadsafe_function_call_mode = c_uint;
pub const napi_async_execute_callback = ?*const fn (napi_env, ?*anyopaque) callconv(.C) void;
pub const napi_async_complete_callback = ?*const fn (napi_env, napi_status, ?*anyopaque) callconv(.C) void;
pub const napi_threadsafe_function_call_js = *const fn (napi_env, napi_value, ?*anyopaque, ?*anyopaque) callconv(.C) void;
pub const napi_node_version = extern struct {
    major: u32,
    minor: u32,
    patch: u32,
    release: [*:0]const u8,

    const parsed_nodejs_version = std.SemanticVersion.parse(bun.Environment.reported_nodejs_version) catch @panic("Invalid reported Node.js version");

    pub const global: napi_node_version = .{
        .major = parsed_nodejs_version.major,
        .minor = parsed_nodejs_version.minor,
        .patch = parsed_nodejs_version.patch,
        .release = "node",
    };
};
pub const struct_napi_async_cleanup_hook_handle__ = opaque {};
pub const napi_async_cleanup_hook_handle = ?*struct_napi_async_cleanup_hook_handle__;
pub const napi_async_cleanup_hook = *const fn (napi_async_cleanup_hook_handle, ?*anyopaque) callconv(.C) void;

pub const napi_addon_register_func = *const fn (napi_env, napi_value) callconv(.C) napi_value;
pub const struct_napi_module = extern struct {
    nm_version: c_int,
    nm_flags: c_uint,
    nm_filename: [*c]const u8,
    nm_register_func: napi_addon_register_func,
    nm_modname: [*c]const u8,
    nm_priv: ?*anyopaque,
    reserved: [4]?*anyopaque,
};
pub const napi_module = struct_napi_module;
fn napiSpan(ptr: anytype, len: usize) []const u8 {
    if (ptr == null)
        return &[_]u8{};

    if (len == NAPI_AUTO_LENGTH) {
        return bun.sliceTo(ptr.?, 0);
    }

    return ptr.?[0..len];
}
pub export fn napi_fatal_error(location_ptr: ?[*:0]const u8, location_len: usize, message_ptr: ?[*:0]const u8, message_len_: usize) noreturn {
    log("napi_fatal_error", .{});
    var message = napiSpan(message_ptr, message_len_);
    if (message.len == 0) {
        message = "fatal error";
    }

    const location = napiSpan(location_ptr, location_len);
    if (location.len > 0) {
        bun.Output.panic("napi: {s}\n  {s}", .{ message, location });
    }

    bun.Output.panic("napi: {s}", .{message});
}
pub export fn napi_create_buffer(env: napi_env, length: usize, data: ?**anyopaque, result: *napi_value) napi_status {
    log("napi_create_buffer: {d}", .{length});
    var buffer = JSC.JSValue.createBufferFromLength(env.toJS(), length);
    if (length > 0) {
        if (data) |ptr| {
            ptr.* = buffer.asArrayBuffer(env.toJS()).?.ptr;
        }
    }
    result.set(env, buffer);
    return env.ok();
}
pub extern fn napi_create_external_buffer(env: napi_env, length: usize, data: ?*anyopaque, finalize_cb: napi_finalize, finalize_hint: ?*anyopaque, result: *napi_value) napi_status;
pub export fn napi_create_buffer_copy(env: napi_env, length: usize, data: [*]u8, result_data: ?*?*anyopaque, result_: ?*napi_value) napi_status {
    log("napi_create_buffer_copy: {d}", .{length});
    const result = result_ orelse {
        return env.invalidArg();
    };
    var buffer = JSC.JSValue.createBufferFromLength(env.toJS(), length);
    if (buffer.asArrayBuffer(env.toJS())) |array_buf| {
        if (length > 0) {
            @memcpy(array_buf.slice()[0..length], data[0..length]);
        }
        if (result_data) |ptr| {
            ptr.* = if (length > 0) array_buf.ptr else null;
        }
    }

    result.set(env, buffer);

    return env.ok();
}
pub export fn napi_is_buffer(env: napi_env, value_: napi_value, result_: ?*bool) napi_status {
    log("napi_is_buffer", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    const value = value_.get();
    result.* = value.isBuffer(env.toJS());
    return env.ok();
}
pub export fn napi_get_buffer_info(env: napi_env, value_: napi_value, data: ?*[*]u8, length: ?*usize) napi_status {
    log("napi_get_buffer_info", .{});
    const value = value_.get();
    const array_buf = value.asArrayBuffer(env.toJS()) orelse {
        // TODO: is invalid_arg what to return here?
        return env.setLastError(.arraybuffer_expected);
    };

    if (data) |dat|
        dat.* = array_buf.ptr;

    if (length) |len|
        len.* = array_buf.byte_len;

    return env.ok();
}

extern fn node_api_create_syntax_error(napi_env, napi_value, napi_value, *napi_value) napi_status;
extern fn node_api_symbol_for(napi_env, [*]const c_char, usize, *napi_value) napi_status;
extern fn node_api_throw_syntax_error(napi_env, [*]const c_char, [*]const c_char) napi_status;
extern fn node_api_create_external_string_latin1(napi_env, [*:0]u8, usize, napi_finalize, ?*anyopaque, *JSValue, *bool) napi_status;
extern fn node_api_create_external_string_utf16(napi_env, [*:0]u16, usize, napi_finalize, ?*anyopaque, *JSValue, *bool) napi_status;

pub export fn napi_create_async_work(
    env: napi_env,
    _: napi_value,
    _: [*:0]const u8,
    execute: napi_async_execute_callback,
    complete: napi_async_complete_callback,
    data: ?*anyopaque,
    result_: ?**napi_async_work,
) napi_status {
    log("napi_create_async_work", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.* = napi_async_work.create(env.toJS(), execute, complete, data) catch {
        return env.genericFailure();
    };
    return env.ok();
}
pub export fn napi_delete_async_work(env: napi_env, work_: ?*napi_async_work) napi_status {
    log("napi_delete_async_work", .{});
    const work = work_ orelse {
        return env.invalidArg();
    };
    bun.assert(env.toJS() == work.global);
    work.deinit();
    return env.ok();
}
pub export fn napi_queue_async_work(env: napi_env, work_: ?*napi_async_work) napi_status {
    log("napi_queue_async_work", .{});
    const work = work_ orelse {
        return env.invalidArg();
    };
    bun.assert(env.toJS() == work.global);
    work.schedule();
    return env.ok();
}
pub export fn napi_cancel_async_work(env: napi_env, work_: ?*napi_async_work) napi_status {
    log("napi_cancel_async_work", .{});
    const work = work_ orelse {
        return env.invalidArg();
    };
    bun.assert(env.toJS() == work.global);
    if (work.cancel()) {
        return env.ok();
    }

    return env.genericFailure();
}
pub export fn napi_get_node_version(env: napi_env, version_: ?**const napi_node_version) napi_status {
    log("napi_get_node_version", .{});
    const version = version_ orelse {
        return env.invalidArg();
    };
    version.* = &napi_node_version.global;
    return env.ok();
}
const napi_event_loop = if (bun.Environment.isWindows) *bun.windows.libuv.Loop else *JSC.EventLoop;
pub export fn napi_get_uv_event_loop(env: napi_env, loop_: ?*napi_event_loop) napi_status {
    log("napi_get_uv_event_loop", .{});
    const loop = loop_ orelse {
        return env.invalidArg();
    };
    if (bun.Environment.isWindows) {
        // alignment error is incorrect.
        @setRuntimeSafety(false);
        loop.* = JSC.VirtualMachine.get().uvLoop();
    } else {
        // there is no uv event loop on posix, we use our event loop handle.
        loop.* = env.toJS().bunVM().eventLoop();
    }
    return env.ok();
}
pub extern fn napi_fatal_exception(env: napi_env, err: napi_value) napi_status;

// We use a linked list here because we assume removing these is relatively rare
// and array reallocations are relatively expensive.
pub export fn napi_add_env_cleanup_hook(env: napi_env, fun: ?*const fn (?*anyopaque) callconv(.C) void, arg: ?*anyopaque) napi_status {
    log("napi_add_env_cleanup_hook", .{});
    if (fun == null)
        return env.ok();

    env.toJS().bunVM().rareData().pushCleanupHook(env.toJS(), arg, fun.?);
    return env.ok();
}
pub export fn napi_remove_env_cleanup_hook(env: napi_env, fun: ?*const fn (?*anyopaque) callconv(.C) void, arg: ?*anyopaque) napi_status {
    log("napi_remove_env_cleanup_hook", .{});

    // Avoid looking up env.bunVM().
    if (bun.Global.isExiting()) {
        return env.ok();
    }

    const vm = JSC.VirtualMachine.get();

    if (vm.rare_data == null or fun == null or vm.isShuttingDown())
        return env.ok();

    var rare_data = vm.rare_data.?;
    const cmp = JSC.RareData.CleanupHook.init(env.toJS(), arg, fun.?);
    for (rare_data.cleanup_hooks.items, 0..) |*hook, i| {
        if (hook.eql(cmp)) {
            _ = rare_data.cleanup_hooks.orderedRemove(i);
            break;
        }
    }

    return env.ok();
}

pub const Finalizer = struct {
    fun: napi_finalize,
    data: ?*anyopaque = null,
};

// TODO: generate comptime version of this instead of runtime checking
pub const ThreadSafeFunction = struct {
    pub const Callback = union(enum) {
        js: JSC.Strong,
        c: struct {
            js: JSC.Strong,
            napi_threadsafe_function_call_js: napi_threadsafe_function_call_js,
        },

        pub fn deinit(this: *Callback) void {
            if (this.* == .js) {
                this.js.deinit();
            } else if (this.* == .c) {
                this.c.js.deinit();
            }
        }
    };
    /// thread-safe functions can be "referenced" and "unreferenced". A
    /// "referenced" thread-safe function will cause the event loop on the thread
    /// on which it is created to remain alive until the thread-safe function is
    /// destroyed. In contrast, an "unreferenced" thread-safe function will not
    /// prevent the event loop from exiting. The APIs napi_ref_threadsafe_function
    /// and napi_unref_threadsafe_function exist for this purpose.
    ///
    /// Neither does napi_unref_threadsafe_function mark the thread-safe
    /// functions as able to be destroyed nor does napi_ref_threadsafe_function
    /// prevent it from being destroyed.
    poll_ref: Async.KeepAlive,

    // User implementation error can cause this number to go negative.
    thread_count: std.atomic.Value(i64) = std.atomic.Value(i64).init(0),
    // for std.condvar
    lock: std.Thread.Mutex = .{},

    event_loop: *JSC.EventLoop,
    tracker: JSC.AsyncTaskTracker,

    env: napi_env,

    finalizer: Finalizer = Finalizer{ .fun = null, .data = null },
    has_queued_finalizer: bool = false,
    queue: Queue = .{
        .data = std.fifo.LinearFifo(?*anyopaque, .Dynamic).init(bun.default_allocator),
        .max_queue_size = 0,
    },

    ctx: ?*anyopaque = null,

    callback: Callback = undefined,
    dispatch_state: DispatchState.Atomic = DispatchState.Atomic.init(.idle),
    blocking_condvar: std.Thread.Condition = .{},
    closing: std.atomic.Value(ClosingState) = std.atomic.Value(ClosingState).init(.not_closing),
    aborted: std.atomic.Value(bool) = std.atomic.Value(bool).init(true),

    pub usingnamespace bun.New(ThreadSafeFunction);

    const ClosingState = enum(u8) {
        not_closing,
        closing,
        closed,
    };

    pub const DispatchState = enum(u8) {
        idle,
        running,
        pending,

        pub const Atomic = std.atomic.Value(DispatchState);
    };

    pub const Queue = struct {
        data: std.fifo.LinearFifo(?*anyopaque, .Dynamic),

        /// This value will never change after initialization. Zero means the size is unlimited.
        max_queue_size: usize,

        count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

        pub fn init(max_queue_size: usize, allocator: std.mem.Allocator) Queue {
            return .{ .data = std.fifo.LinearFifo(?*anyopaque, .Dynamic).init(allocator), .max_queue_size = max_queue_size };
        }

        pub fn deinit(this: *Queue) void {
            this.data.deinit();
        }

        pub fn isBlocked(this: *const Queue) bool {
            return this.max_queue_size > 0 and this.count.load(.seq_cst) >= this.max_queue_size;
        }
    };

    // This has two states:
    // 1. We need to run potentially multiple tasks.
    // 2. We need to finalize the ThreadSafeFunction.
    pub fn onDispatch(this: *ThreadSafeFunction) void {
        if (this.closing.load(.seq_cst) == .closed) {
            // Finalize the ThreadSafeFunction.
            this.deinit();
            return;
        }

        var is_first = true;

        // Run the tasks.
        while (true) {
            this.dispatch_state.store(.running, .seq_cst);
            if (this.dispatchOne(is_first)) {
                is_first = false;
                this.dispatch_state.store(.pending, .seq_cst);
            } else {
                // We're done running tasks, for now.
                this.dispatch_state.store(.idle, .seq_cst);
                break;
            }
        }

        // Node sets a maximum number of runs per ThreadSafeFunction to 1,000.
        // We don't set a max. I would like to see an issue caused by not
        // setting a max before we do set a max. It is better for performance to
        // not add unnecessary event loop ticks.
    }

    pub fn isClosing(this: *const ThreadSafeFunction) bool {
        return this.closing.load(.seq_cst) != .not_closing;
    }

    fn maybeQueueFinalizer(this: *ThreadSafeFunction) void {
        switch (this.closing.swap(.closed, .seq_cst)) {
            .closing, .not_closing => {
                // TODO: is this boolean necessary? Can we rely just on the closing value?
                if (!this.has_queued_finalizer) {
                    this.has_queued_finalizer = true;
                    this.callback.deinit();
                    this.poll_ref.disable();
                    this.event_loop.enqueueTask(JSC.Task.init(this));
                }
            },
            .closed => {
                // already scheduled.
            },
        }
    }

    pub fn dispatchOne(this: *ThreadSafeFunction, is_first: bool) bool {
        var queue_finalizer_after_call = false;
        const has_more, const task = brk: {
            this.lock.lock();
            defer this.lock.unlock();
            const was_blocked = this.queue.isBlocked();
            const t = this.queue.data.readItem() orelse {
                // When there are no tasks and the number of threads that have
                // references reaches zero, we prepare to finalize the
                // ThreadSafeFunction.
                if (this.thread_count.load(.seq_cst) == 0) {
                    if (this.queue.max_queue_size > 0) {
                        this.blocking_condvar.signal();
                    }
                    this.maybeQueueFinalizer();
                }
                return false;
            };

            if (this.queue.count.fetchSub(1, .seq_cst) == 1 and this.thread_count.load(.seq_cst) == 0) {
                this.closing.store(.closing, .seq_cst);
                if (this.queue.max_queue_size > 0) {
                    this.blocking_condvar.signal();
                }
                queue_finalizer_after_call = true;
            } else if (was_blocked and !this.queue.isBlocked()) {
                this.blocking_condvar.signal();
            }

            break :brk .{ !this.isClosing(), t };
        };

        this.call(task, !is_first);

        if (queue_finalizer_after_call) {
            this.maybeQueueFinalizer();
        }

        return has_more;
    }

    /// This function can be called multiple times in one tick of the event loop.
    /// See: https://github.com/nodejs/node/pull/38506
    /// In that case, we need to drain microtasks.
    fn call(this: *ThreadSafeFunction, task: ?*anyopaque, is_first: bool) void {
        const globalObject = this.env.toJS();
        if (!is_first) {
            this.event_loop.drainMicrotasks();
        }

        this.tracker.willDispatch(globalObject);
        defer this.tracker.didDispatch(globalObject);

        switch (this.callback) {
            .js => |strong| {
                const js = strong.get() orelse .undefined;
                if (js.isEmptyOrUndefinedOrNull()) {
                    return;
                }

                _ = js.call(globalObject, .undefined, &.{}) catch |err|
                    globalObject.reportActiveExceptionAsUnhandled(err);
            },
            .c => |cb| {
                const js = cb.js.get() orelse .undefined;

                const handle_scope = NapiHandleScope.open(this.env, false);
                defer if (handle_scope) |scope| scope.close(this.env);
                cb.napi_threadsafe_function_call_js(this.env, napi_value.create(this.env, js), this.ctx, task);
            },
        }
    }

    pub fn enqueue(this: *ThreadSafeFunction, ctx: ?*anyopaque, block: bool) napi_status {
        this.lock.lock();
        defer this.lock.unlock();
        if (block) {
            while (this.queue.isBlocked()) {
                this.blocking_condvar.wait(&this.lock);
            }
        } else {
            if (this.queue.isBlocked()) {
                // don't set the error on the env as this is run from another thread
                return @intFromEnum(NapiStatus.queue_full);
            }
        }

        if (this.isClosing()) {
            if (this.thread_count.load(.seq_cst) <= 0) {
                return @intFromEnum(NapiStatus.invalid_arg);
            }
            _ = this.release(.release, true);
            return @intFromEnum(NapiStatus.closing);
        }

        _ = this.queue.count.fetchAdd(1, .seq_cst);
        this.queue.data.writeItem(ctx) catch bun.outOfMemory();
        this.scheduleDispatch();
        return @intFromEnum(NapiStatus.ok);
    }

    fn scheduleDispatch(this: *ThreadSafeFunction) void {
        switch (this.dispatch_state.swap(.pending, .seq_cst)) {
            .idle => {
                this.event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.createFrom(this));
            },
            .running => {
                // it will check if it has more work to do
            },
            .pending => {
                // we've already scheduled it to run
            },
        }
    }

    pub fn deinit(this: *ThreadSafeFunction) void {
        this.unref();

        if (this.finalizer.fun) |fun| {
            const handle_scope = NapiHandleScope.open(this.env, false);
            defer if (handle_scope) |scope| scope.close(this.env);
            fun(this.env, this.finalizer.data, this.ctx);
        }

        this.callback.deinit();
        this.queue.deinit();
        this.destroy();
    }

    pub fn ref(this: *ThreadSafeFunction) void {
        this.poll_ref.refConcurrentlyFromEventLoop(this.event_loop);
    }

    pub fn unref(this: *ThreadSafeFunction) void {
        this.poll_ref.unrefConcurrentlyFromEventLoop(this.event_loop);
    }

    pub fn acquire(this: *ThreadSafeFunction) napi_status {
        this.lock.lock();
        defer this.lock.unlock();
        if (this.isClosing()) {
            return @intFromEnum(NapiStatus.closing);
        }
        _ = this.thread_count.fetchAdd(1, .seq_cst);
        return @intFromEnum(NapiStatus.ok);
    }

    pub fn release(this: *ThreadSafeFunction, mode: napi_threadsafe_function_release_mode, already_locked: bool) napi_status {
        if (!already_locked) this.lock.lock();
        defer if (!already_locked) this.lock.unlock();

        if (this.thread_count.load(.seq_cst) < 0) {
            return @intFromEnum(NapiStatus.invalid_arg);
        }

        const prev_remaining = this.thread_count.fetchSub(1, .seq_cst);

        if (mode == .abort or prev_remaining == 1) {
            if (!this.isClosing()) {
                if (mode == .abort) {
                    this.closing.store(.closing, .seq_cst);
                    this.aborted.store(true, .seq_cst);
                    if (this.queue.max_queue_size > 0) {
                        this.blocking_condvar.signal();
                    }
                }
                this.scheduleDispatch();
            }
        }

        return @intFromEnum(NapiStatus.ok);
    }
};

pub export fn napi_create_threadsafe_function(
    env: napi_env,
    func_: napi_value,
    _: napi_value,
    _: napi_value,
    max_queue_size: usize,
    initial_thread_count: usize,
    thread_finalize_data: ?*anyopaque,
    thread_finalize_cb: napi_finalize,
    context: ?*anyopaque,
    call_js_cb: ?napi_threadsafe_function_call_js,
    result_: ?*napi_threadsafe_function,
) napi_status {
    log("napi_create_threadsafe_function", .{});
    const result = result_ orelse {
        return env.invalidArg();
    };
    const func = func_.get();
    const global = env.toJS();

    if (call_js_cb == null and (func.isEmptyOrUndefinedOrNull() or !func.isCallable(global.vm()))) {
        return env.setLastError(.function_expected);
    }

    const vm = global.bunVM();
    var function = ThreadSafeFunction.new(.{
        .event_loop = vm.eventLoop(),
        .env = env,
        .callback = if (call_js_cb) |c| .{
            .c = .{
                .napi_threadsafe_function_call_js = c,
                .js = if (func == .zero) .{} else JSC.Strong.create(func.withAsyncContextIfNeeded(global), vm.global),
            },
        } else .{
            .js = if (func == .zero) .{} else JSC.Strong.create(func.withAsyncContextIfNeeded(global), vm.global),
        },
        .ctx = context,
        .queue = ThreadSafeFunction.Queue.init(max_queue_size, bun.default_allocator),
        .thread_count = .{ .raw = @intCast(initial_thread_count) },
        .poll_ref = Async.KeepAlive.init(),
        .tracker = JSC.AsyncTaskTracker.init(vm),
    });

    function.finalizer = .{ .data = thread_finalize_data, .fun = thread_finalize_cb };
    // nodejs by default keeps the event loop alive until the thread-safe function is unref'd
    function.ref();
    function.tracker.didSchedule(vm.global);

    result.* = function;
    return env.ok();
}
pub export fn napi_get_threadsafe_function_context(func: napi_threadsafe_function, result: *?*anyopaque) napi_status {
    log("napi_get_threadsafe_function_context", .{});
    result.* = func.ctx;
    return @intFromEnum(NapiStatus.ok);
}
pub export fn napi_call_threadsafe_function(func: napi_threadsafe_function, data: ?*anyopaque, is_blocking: napi_threadsafe_function_call_mode) napi_status {
    log("napi_call_threadsafe_function", .{});
    return func.enqueue(data, is_blocking == napi_tsfn_blocking);
}
pub export fn napi_acquire_threadsafe_function(func: napi_threadsafe_function) napi_status {
    log("napi_acquire_threadsafe_function", .{});
    return func.acquire();
}
pub export fn napi_release_threadsafe_function(func: napi_threadsafe_function, mode: napi_threadsafe_function_release_mode) napi_status {
    log("napi_release_threadsafe_function", .{});
    return func.release(mode, false);
}
pub export fn napi_unref_threadsafe_function(env: napi_env, func: napi_threadsafe_function) napi_status {
    log("napi_unref_threadsafe_function", .{});
    bun.assert(func.event_loop.global == env.toJS());
    func.unref();
    return env.ok();
}
pub export fn napi_ref_threadsafe_function(env: napi_env, func: napi_threadsafe_function) napi_status {
    log("napi_ref_threadsafe_function", .{});
    bun.assert(func.event_loop.global == env.toJS());
    func.ref();
    return env.ok();
}

pub export fn napi_add_async_cleanup_hook(env: napi_env, _: napi_async_cleanup_hook, _: ?*anyopaque, _: [*c]napi_async_cleanup_hook_handle) napi_status {
    log("napi_add_async_cleanup_hook", .{});
    // TODO:
    return env.ok();
}
pub export fn napi_remove_async_cleanup_hook(_: napi_async_cleanup_hook_handle) napi_status {
    log("napi_remove_async_cleanup_hook", .{});
    // TODO:
    return @intFromEnum(NapiStatus.ok);
}

const NAPI_VERSION = @as(c_int, 8);
const NAPI_AUTO_LENGTH = std.math.maxInt(usize);
const NAPI_MODULE_VERSION = @as(c_int, 1);

/// v8:: C++ symbols defined in v8.cpp
///
/// Do not call these at runtime, as they do not contain type and callconv info. They are simply
/// used for DCE suppression and asserting that the symbols exist at link-time.
///
// TODO: write a script to generate this struct. ideally it wouldn't even need to be committed to source.
const V8API = if (!bun.Environment.isWindows) struct {
    pub extern fn _ZN2v87Isolate10GetCurrentEv() *anyopaque;
    pub extern fn _ZN2v87Isolate13TryGetCurrentEv() *anyopaque;
    pub extern fn _ZN2v87Isolate17GetCurrentContextEv() *anyopaque;
    pub extern fn _ZN4node25AddEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_() *anyopaque;
    pub extern fn _ZN4node28RemoveEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_() *anyopaque;
    pub extern fn _ZN2v86Number3NewEPNS_7IsolateEd() *anyopaque;
    pub extern fn _ZNK2v86Number5ValueEv() *anyopaque;
    pub extern fn _ZN2v86String11NewFromUtf8EPNS_7IsolateEPKcNS_13NewStringTypeEi() *anyopaque;
    pub extern fn _ZNK2v86String9WriteUtf8EPNS_7IsolateEPciPii() *anyopaque;
    pub extern fn _ZN2v812api_internal12ToLocalEmptyEv() *anyopaque;
    pub extern fn _ZNK2v86String6LengthEv() *anyopaque;
    pub extern fn _ZN2v88External3NewEPNS_7IsolateEPv() *anyopaque;
    pub extern fn _ZNK2v88External5ValueEv() *anyopaque;
    pub extern fn _ZN2v86Object3NewEPNS_7IsolateE() *anyopaque;
    pub extern fn _ZN2v86Object3SetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEES5_() *anyopaque;
    pub extern fn _ZN2v86Object16SetInternalFieldEiNS_5LocalINS_4DataEEE() *anyopaque;
    pub extern fn _ZN2v86Object20SlowGetInternalFieldEi() *anyopaque;
    pub extern fn _ZN2v811HandleScope12CreateHandleEPNS_8internal7IsolateEm() *anyopaque;
    pub extern fn _ZN2v811HandleScopeC1EPNS_7IsolateE() *anyopaque;
    pub extern fn _ZN2v811HandleScopeD1Ev() *anyopaque;
    pub extern fn _ZN2v811HandleScopeD2Ev() *anyopaque;
    pub extern fn _ZN2v816FunctionTemplate11GetFunctionENS_5LocalINS_7ContextEEE() *anyopaque;
    pub extern fn _ZN2v816FunctionTemplate3NewEPNS_7IsolateEPFvRKNS_20FunctionCallbackInfoINS_5ValueEEEENS_5LocalIS4_EENSA_INS_9SignatureEEEiNS_19ConstructorBehaviorENS_14SideEffectTypeEPKNS_9CFunctionEttt() *anyopaque;
    pub extern fn _ZN2v814ObjectTemplate11NewInstanceENS_5LocalINS_7ContextEEE() *anyopaque;
    pub extern fn _ZN2v814ObjectTemplate21SetInternalFieldCountEi() *anyopaque;
    pub extern fn _ZNK2v814ObjectTemplate18InternalFieldCountEv() *anyopaque;
    pub extern fn _ZN2v814ObjectTemplate3NewEPNS_7IsolateENS_5LocalINS_16FunctionTemplateEEE() *anyopaque;
    pub extern fn _ZN2v824EscapableHandleScopeBase10EscapeSlotEPm() *anyopaque;
    pub extern fn _ZN2v824EscapableHandleScopeBaseC2EPNS_7IsolateE() *anyopaque;
    pub extern fn _ZN2v88internal35IsolateFromNeverReadOnlySpaceObjectEm() *anyopaque;
    pub extern fn _ZN2v85Array3NewEPNS_7IsolateEPNS_5LocalINS_5ValueEEEm() *anyopaque;
    pub extern fn _ZN2v88Function7SetNameENS_5LocalINS_6StringEEE() *anyopaque;
    pub extern fn _ZNK2v85Value9IsBooleanEv() *anyopaque;
    pub extern fn _ZNK2v87Boolean5ValueEv() *anyopaque;
    pub extern fn _ZNK2v85Value10FullIsTrueEv() *anyopaque;
    pub extern fn _ZNK2v85Value11FullIsFalseEv() *anyopaque;
    pub extern fn _ZN2v820EscapableHandleScopeC1EPNS_7IsolateE() *anyopaque;
    pub extern fn _ZN2v820EscapableHandleScopeC2EPNS_7IsolateE() *anyopaque;
    pub extern fn _ZN2v820EscapableHandleScopeD1Ev() *anyopaque;
    pub extern fn _ZN2v820EscapableHandleScopeD2Ev() *anyopaque;
    pub extern fn _ZNK2v85Value8IsObjectEv() *anyopaque;
    pub extern fn _ZNK2v85Value8IsNumberEv() *anyopaque;
    pub extern fn _ZNK2v85Value8IsUint32Ev() *anyopaque;
    pub extern fn _ZNK2v85Value11Uint32ValueENS_5LocalINS_7ContextEEE() *anyopaque;
    pub extern fn _ZNK2v85Value11IsUndefinedEv() *anyopaque;
    pub extern fn _ZNK2v85Value6IsNullEv() *anyopaque;
    pub extern fn _ZNK2v85Value17IsNullOrUndefinedEv() *anyopaque;
    pub extern fn _ZNK2v85Value6IsTrueEv() *anyopaque;
    pub extern fn _ZNK2v85Value7IsFalseEv() *anyopaque;
    pub extern fn _ZNK2v85Value8IsStringEv() *anyopaque;
    pub extern fn _ZN2v87Boolean3NewEPNS_7IsolateEb() *anyopaque;
    pub extern fn _ZN2v86Object16GetInternalFieldEi() *anyopaque;
    pub extern fn _ZN2v87Context10GetIsolateEv() *anyopaque;
    pub extern fn _ZN2v86String14NewFromOneByteEPNS_7IsolateEPKhNS_13NewStringTypeEi() *anyopaque;
    pub extern fn _ZNK2v86String10Utf8LengthEPNS_7IsolateE() *anyopaque;
    pub extern fn _ZNK2v86String10IsExternalEv() *anyopaque;
    pub extern fn _ZNK2v86String17IsExternalOneByteEv() *anyopaque;
    pub extern fn _ZNK2v86String17IsExternalTwoByteEv() *anyopaque;
    pub extern fn _ZNK2v86String9IsOneByteEv() *anyopaque;
    pub extern fn _ZNK2v86String19ContainsOnlyOneByteEv() *anyopaque;
    pub extern fn _ZN2v812api_internal18GlobalizeReferenceEPNS_8internal7IsolateEm() *anyopaque;
    pub extern fn _ZN2v812api_internal13DisposeGlobalEPm() *anyopaque;
    pub extern fn _ZNK2v88Function7GetNameEv() *anyopaque;
    pub extern fn _ZNK2v85Value10IsFunctionEv() *anyopaque;
    pub extern fn _ZN2v812api_internal17FromJustIsNothingEv() *anyopaque;
    pub extern fn uv_os_getpid() *anyopaque;
    pub extern fn uv_os_getppid() *anyopaque;
} else struct {
    // MSVC name mangling is different than it is on unix.
    // To make this easier to deal with, I have provided a script to generate the list of functions.
    //
    // dumpbin .\build\CMakeFiles\bun-debug.dir\src\bun.js\bindings\v8\*.cpp.obj /symbols | where-object { $_.Contains(' node::') -or $_.Contains(' v8::') } | foreach-object { (($_ -split "\|")[1] -split " ")[1] } | ForEach-Object { "extern fn @`"${_}`"() *anyopaque;" }
    //
    // Bug @paperdave if you get stuck here
    pub extern fn @"?TryGetCurrent@Isolate@v8@@SAPEAV12@XZ"() *anyopaque;
    pub extern fn @"?GetCurrent@Isolate@v8@@SAPEAV12@XZ"() *anyopaque;
    pub extern fn @"?GetCurrentContext@Isolate@v8@@QEAA?AV?$Local@VContext@v8@@@2@XZ"() *anyopaque;
    pub extern fn @"?AddEnvironmentCleanupHook@node@@YAXPEAVIsolate@v8@@P6AXPEAX@Z1@Z"() *anyopaque;
    pub extern fn @"?RemoveEnvironmentCleanupHook@node@@YAXPEAVIsolate@v8@@P6AXPEAX@Z1@Z"() *anyopaque;
    pub extern fn @"?New@Number@v8@@SA?AV?$Local@VNumber@v8@@@2@PEAVIsolate@2@N@Z"() *anyopaque;
    pub extern fn @"?Value@Number@v8@@QEBANXZ"() *anyopaque;
    pub extern fn @"?NewFromUtf8@String@v8@@SA?AV?$MaybeLocal@VString@v8@@@2@PEAVIsolate@2@PEBDW4NewStringType@2@H@Z"() *anyopaque;
    pub extern fn @"?WriteUtf8@String@v8@@QEBAHPEAVIsolate@2@PEADHPEAHH@Z"() *anyopaque;
    pub extern fn @"?ToLocalEmpty@api_internal@v8@@YAXXZ"() *anyopaque;
    pub extern fn @"?Length@String@v8@@QEBAHXZ"() *anyopaque;
    pub extern fn @"?New@External@v8@@SA?AV?$Local@VExternal@v8@@@2@PEAVIsolate@2@PEAX@Z"() *anyopaque;
    pub extern fn @"?Value@External@v8@@QEBAPEAXXZ"() *anyopaque;
    pub extern fn @"?New@Object@v8@@SA?AV?$Local@VObject@v8@@@2@PEAVIsolate@2@@Z"() *anyopaque;
    pub extern fn @"?Set@Object@v8@@QEAA?AV?$Maybe@_N@2@V?$Local@VContext@v8@@@2@V?$Local@VValue@v8@@@2@1@Z"() *anyopaque;
    pub extern fn @"?SetInternalField@Object@v8@@QEAAXHV?$Local@VData@v8@@@2@@Z"() *anyopaque;
    pub extern fn @"?SlowGetInternalField@Object@v8@@AEAA?AV?$Local@VData@v8@@@2@H@Z"() *anyopaque;
    pub extern fn @"?CreateHandle@HandleScope@v8@@KAPEA_KPEAVIsolate@internal@2@_K@Z"() *anyopaque;
    pub extern fn @"??0HandleScope@v8@@QEAA@PEAVIsolate@1@@Z"() *anyopaque;
    pub extern fn @"??1HandleScope@v8@@QEAA@XZ"() *anyopaque;
    pub extern fn @"?GetFunction@FunctionTemplate@v8@@QEAA?AV?$MaybeLocal@VFunction@v8@@@2@V?$Local@VContext@v8@@@2@@Z"() *anyopaque;
    pub extern fn @"?New@FunctionTemplate@v8@@SA?AV?$Local@VFunctionTemplate@v8@@@2@PEAVIsolate@2@P6AXAEBV?$FunctionCallbackInfo@VValue@v8@@@2@@ZV?$Local@VValue@v8@@@2@V?$Local@VSignature@v8@@@2@HW4ConstructorBehavior@2@W4SideEffectType@2@PEBVCFunction@2@GGG@Z"() *anyopaque;
    pub extern fn @"?NewInstance@ObjectTemplate@v8@@QEAA?AV?$MaybeLocal@VObject@v8@@@2@V?$Local@VContext@v8@@@2@@Z"() *anyopaque;
    pub extern fn @"?SetInternalFieldCount@ObjectTemplate@v8@@QEAAXH@Z"() *anyopaque;
    pub extern fn @"?InternalFieldCount@ObjectTemplate@v8@@QEBAHXZ"() *anyopaque;
    pub extern fn @"?New@ObjectTemplate@v8@@SA?AV?$Local@VObjectTemplate@v8@@@2@PEAVIsolate@2@V?$Local@VFunctionTemplate@v8@@@2@@Z"() *anyopaque;
    pub extern fn @"?EscapeSlot@EscapableHandleScopeBase@v8@@IEAAPEA_KPEA_K@Z"() *anyopaque;
    pub extern fn @"??0EscapableHandleScopeBase@v8@@QEAA@PEAVIsolate@1@@Z"() *anyopaque;
    pub extern fn @"?IsolateFromNeverReadOnlySpaceObject@internal@v8@@YAPEAVIsolate@12@_K@Z"() *anyopaque;
    pub extern fn @"?New@Array@v8@@SA?AV?$Local@VArray@v8@@@2@PEAVIsolate@2@PEAV?$Local@VValue@v8@@@2@_K@Z"() *anyopaque;
    pub extern fn @"?SetName@Function@v8@@QEAAXV?$Local@VString@v8@@@2@@Z"() *anyopaque;
    pub extern fn @"?IsBoolean@Value@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?Value@Boolean@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?FullIsTrue@Value@v8@@AEBA_NXZ"() *anyopaque;
    pub extern fn @"?FullIsFalse@Value@v8@@AEBA_NXZ"() *anyopaque;
    pub extern fn @"??1EscapableHandleScope@v8@@QEAA@XZ"() *anyopaque;
    pub extern fn @"??0EscapableHandleScope@v8@@QEAA@PEAVIsolate@1@@Z"() *anyopaque;
    pub extern fn @"?IsObject@Value@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?IsNumber@Value@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?IsUint32@Value@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?Uint32Value@Value@v8@@QEBA?AV?$Maybe@I@2@V?$Local@VContext@v8@@@2@@Z"() *anyopaque;
    pub extern fn @"?IsUndefined@Value@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?IsNull@Value@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?IsNullOrUndefined@Value@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?IsTrue@Value@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?IsFalse@Value@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?IsString@Value@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?New@Boolean@v8@@SA?AV?$Local@VBoolean@v8@@@2@PEAVIsolate@2@_N@Z"() *anyopaque;
    pub extern fn @"?GetInternalField@Object@v8@@QEAA?AV?$Local@VData@v8@@@2@H@Z"() *anyopaque;
    pub extern fn @"?GetIsolate@Context@v8@@QEAAPEAVIsolate@2@XZ"() *anyopaque;
    pub extern fn @"?NewFromOneByte@String@v8@@SA?AV?$MaybeLocal@VString@v8@@@2@PEAVIsolate@2@PEBEW4NewStringType@2@H@Z"() *anyopaque;
    pub extern fn @"?IsExternal@String@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?IsExternalOneByte@String@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?IsExternalTwoByte@String@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?IsOneByte@String@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?Utf8Length@String@v8@@QEBAHPEAVIsolate@2@@Z"() *anyopaque;
    pub extern fn @"?ContainsOnlyOneByte@String@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?GlobalizeReference@api_internal@v8@@YAPEA_KPEAVIsolate@internal@2@_K@Z"() *anyopaque;
    pub extern fn @"?DisposeGlobal@api_internal@v8@@YAXPEA_K@Z"() *anyopaque;
    pub extern fn @"?GetName@Function@v8@@QEBA?AV?$Local@VValue@v8@@@2@XZ"() *anyopaque;
    pub extern fn @"?IsFunction@Value@v8@@QEBA_NXZ"() *anyopaque;
    pub extern fn @"?FromJustIsNothing@api_internal@v8@@YAXXZ"() *anyopaque;
};

// To update this list, use find + multi-cursor in your editor.
// - pub extern fn napi_
// - pub export fn napi_
const napi_functions_to_export = .{
    napi_acquire_threadsafe_function,
    napi_add_async_cleanup_hook,
    napi_add_env_cleanup_hook,
    napi_add_finalizer,
    napi_adjust_external_memory,
    napi_async_destroy,
    napi_async_init,
    napi_call_function,
    napi_call_threadsafe_function,
    napi_cancel_async_work,
    napi_check_object_type_tag,
    napi_close_callback_scope,
    napi_close_escapable_handle_scope,
    napi_close_handle_scope,
    napi_coerce_to_bool,
    napi_coerce_to_number,
    napi_coerce_to_object,
    napi_create_array,
    napi_create_array_with_length,
    napi_create_arraybuffer,
    napi_create_async_work,
    napi_create_bigint_int64,
    napi_create_bigint_uint64,
    napi_create_bigint_words,
    napi_create_buffer,
    napi_create_buffer_copy,
    napi_create_dataview,
    napi_create_date,
    napi_create_double,
    napi_create_error,
    napi_create_external,
    napi_create_external_arraybuffer,
    napi_create_external_buffer,
    napi_create_int32,
    napi_create_int64,
    napi_create_object,
    napi_create_promise,
    napi_create_range_error,
    napi_create_reference,
    napi_create_string_latin1,
    napi_create_string_utf16,
    napi_create_string_utf8,
    napi_create_symbol,
    napi_create_threadsafe_function,
    napi_create_type_error,
    napi_create_typedarray,
    napi_create_uint32,
    napi_define_class,
    napi_define_properties,
    napi_delete_async_work,
    napi_delete_element,
    napi_delete_reference,
    napi_detach_arraybuffer,
    napi_escape_handle,
    napi_fatal_error,
    napi_fatal_exception,
    napi_get_all_property_names,
    napi_get_and_clear_last_exception,
    napi_get_array_length,
    napi_get_arraybuffer_info,
    napi_get_boolean,
    napi_get_buffer_info,
    napi_get_cb_info,
    napi_get_dataview_info,
    napi_get_date_value,
    napi_get_element,
    napi_get_global,
    napi_get_instance_data,
    napi_get_last_error_info,
    napi_get_new_target,
    napi_get_node_version,
    napi_get_null,
    napi_get_prototype,
    napi_get_reference_value,
    napi_get_reference_value_internal,
    napi_get_threadsafe_function_context,
    napi_get_typedarray_info,
    napi_get_undefined,
    napi_get_uv_event_loop,
    napi_get_value_bigint_int64,
    napi_get_value_bigint_uint64,
    napi_get_value_bigint_words,
    napi_get_value_bool,
    napi_get_value_double,
    napi_get_value_external,
    napi_get_value_int32,
    napi_get_value_int64,
    napi_get_value_string_latin1,
    napi_get_value_string_utf16,
    napi_get_value_string_utf8,
    napi_get_value_uint32,
    napi_get_version,
    napi_has_element,
    napi_instanceof,
    napi_is_array,
    napi_is_arraybuffer,
    napi_is_buffer,
    napi_is_dataview,
    napi_is_date,
    napi_is_detached_arraybuffer,
    napi_is_error,
    napi_is_exception_pending,
    napi_is_promise,
    napi_is_typedarray,
    napi_make_callback,
    napi_new_instance,
    napi_open_callback_scope,
    napi_open_escapable_handle_scope,
    napi_open_handle_scope,
    napi_queue_async_work,
    napi_ref_threadsafe_function,
    napi_reference_ref,
    napi_reference_unref,
    napi_reject_deferred,
    napi_release_threadsafe_function,
    napi_remove_async_cleanup_hook,
    napi_remove_env_cleanup_hook,
    napi_remove_wrap,
    napi_resolve_deferred,
    napi_run_script,
    napi_set_element,
    napi_set_instance_data,
    napi_strict_equals,
    napi_throw,
    napi_throw_error,
    napi_throw_range_error,
    napi_throw_type_error,
    napi_type_tag_object,
    napi_typeof,
    napi_unref_threadsafe_function,
    napi_unwrap,
    napi_wrap,

    // -- node-api
    node_api_create_syntax_error,
    node_api_symbol_for,
    node_api_throw_syntax_error,
    node_api_create_external_string_latin1,
    node_api_create_external_string_utf16,
};

pub fn fixDeadCodeElimination() void {
    JSC.markBinding(@src());

    inline for (napi_functions_to_export) |fn_name| {
        std.mem.doNotOptimizeAway(&fn_name);
    }

    inline for (comptime std.meta.declarations(V8API)) |decl| {
        std.mem.doNotOptimizeAway(&@field(V8API, decl.name));
    }

    std.mem.doNotOptimizeAway(&@import("../bun.js/node/buffer.zig").BufferVectorized.fill);
}
