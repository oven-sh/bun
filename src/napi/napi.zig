const std = @import("std");
const JSC = bun.JSC;
const bun = @import("bun");
const JSValue = JSC.JSValue;
const TODO_EXCEPTION: JSC.C.ExceptionRef = null;

const log = bun.Output.scoped(.napi, false);

const Async = bun.Async;

/// This is `struct napi_env__` from napi.h
pub const NapiEnv = opaque {
    pub fn toJS(self: *NapiEnv) *JSC.JSGlobalObject {
        return NapiEnv__globalObject(self);
    }

    extern fn napi_set_last_error(env: napi_env, status: NapiStatus) napi_status;

    /// Convert err to an extern napi_status, and store the error code in env so that it can be
    /// accessed by napi_get_last_error_info
    pub fn setLastError(self: ?*NapiEnv, err: NapiStatus) napi_status {
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

    /// Assert that we're not currently performing garbage collection
    pub fn checkGC(self: *NapiEnv) void {
        napi_internal_check_gc(self);
    }

    /// Return the Node-API version number declared by the module we are running code from
    pub fn getVersion(self: *NapiEnv) u32 {
        return napi_internal_get_version(self);
    }

    extern fn NapiEnv__globalObject(*NapiEnv) *JSC.JSGlobalObject;
    extern fn napi_internal_get_version(*NapiEnv) u32;
};

fn envIsNull() napi_status {
    // in this case we don't actually have an environment to set the last error on, so it doesn't
    // make sense to call napi_set_last_error
    @branchHint(.cold);
    return @intFromEnum(NapiStatus.invalid_arg);
}

/// This is nullable because native modules may pass null pointers for the NAPI environment, which
/// is an error that our NAPI functions need to handle (by returning napi_invalid_arg). To specify
/// a Zig API that uses a never-null napi_env, use `*NapiEnv`.
pub const napi_env = ?*NapiEnv;

/// Contents are not used by any Zig code
pub const Ref = opaque {};

pub const napi_ref = *Ref;

pub const NapiHandleScope = opaque {
    pub extern fn NapiHandleScope__open(env: *NapiEnv, escapable: bool) ?*NapiHandleScope;
    pub extern fn NapiHandleScope__close(env: *NapiEnv, current: ?*NapiHandleScope) void;
    extern fn NapiHandleScope__append(env: *NapiEnv, value: JSC.JSValue.backing_int) void;
    extern fn NapiHandleScope__escape(handleScope: *NapiHandleScope, value: JSC.JSValue.backing_int) bool;

    /// Create a new handle scope in the given environment, or return null if creating one now is
    /// unsafe (i.e. inside a finalizer)
    pub fn open(env: *NapiEnv, escapable: bool) ?*NapiHandleScope {
        return NapiHandleScope__open(env, escapable);
    }

    /// Closes the given handle scope, releasing all values inside it, if it is safe to do so.
    /// Asserts that self is the current handle scope in env.
    pub fn close(self: ?*NapiHandleScope, env: *NapiEnv) void {
        NapiHandleScope__close(env, self);
    }

    /// Place a value in the handle scope. Must be done while returning any JS value into NAPI
    /// callbacks, as the value must remain alive as long as the handle scope is active, even if the
    /// native module doesn't keep it visible on the stack.
    pub fn append(env: *NapiEnv, value: JSC.JSValue) void {
        NapiHandleScope__append(env, @intFromEnum(value));
    }

    /// Move a value from the current handle scope (which must be escapable) to the reserved escape
    /// slot in the parent handle scope, allowing that value to outlive the current handle scope.
    /// Returns an error if escape() has already been called on this handle scope.
    pub fn escape(self: *NapiHandleScope, value: JSC.JSValue) error{EscapeCalledTwice}!void {
        if (!NapiHandleScope__escape(self, @intFromEnum(value))) {
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
        env: *NapiEnv,
        val: JSC.JSValue,
    ) void {
        NapiHandleScope.append(env, val);
        self.* = @enumFromInt(@intFromEnum(val));
    }

    pub fn get(self: *const napi_value) JSC.JSValue {
        return @enumFromInt(@intFromEnum(self.*));
    }

    pub fn create(env: *NapiEnv, val: JSC.JSValue) napi_value {
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
pub export fn napi_get_undefined(env_: napi_env, result_: ?*napi_value) napi_status {
    log("napi_get_undefined", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, .js_undefined);
    return env.ok();
}
pub export fn napi_get_null(env_: napi_env, result_: ?*napi_value) napi_status {
    log("napi_get_null", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSValue.jsNull());
    return env.ok();
}
pub extern fn napi_get_global(env: napi_env, result: *napi_value) napi_status;
pub export fn napi_get_boolean(env_: napi_env, value: bool, result_: ?*napi_value) napi_status {
    log("napi_get_boolean", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSValue.jsBoolean(value));
    return env.ok();
}
pub export fn napi_create_array(env_: napi_env, result_: ?*napi_value) napi_status {
    log("napi_create_array", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSValue.createEmptyArray(env.toJS(), 0) catch return env.setLastError(.pending_exception));
    return env.ok();
}
pub export fn napi_create_array_with_length(env_: napi_env, length: usize, result_: ?*napi_value) napi_status {
    log("napi_create_array_with_length", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    const result = result_ orelse {
        return env.invalidArg();
    };

    // JSC createEmptyArray takes u32
    // Node and V8 convert out-of-bounds array sizes to 0
    const len = std.math.cast(u32, length) orelse 0;

    const array = JSC.JSValue.createEmptyArray(env.toJS(), len) catch return env.setLastError(.pending_exception);
    array.ensureStillAlive();
    result.set(env, array);
    return env.ok();
}
pub extern fn napi_create_double(_: napi_env, value: f64, result: *napi_value) napi_status;
pub export fn napi_create_int32(env_: napi_env, value: i32, result_: ?*napi_value) napi_status {
    log("napi_create_int32", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSValue.jsNumber(value));
    return env.ok();
}
pub export fn napi_create_uint32(env_: napi_env, value: u32, result_: ?*napi_value) napi_status {
    log("napi_create_uint32", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSValue.jsNumber(value));
    return env.ok();
}
pub export fn napi_create_int64(env_: napi_env, value: i64, result_: ?*napi_value) napi_status {
    log("napi_create_int64", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.set(env, JSValue.jsNumber(value));
    return env.ok();
}
pub export fn napi_create_string_latin1(env_: napi_env, str: ?[*]const u8, length: usize, result_: ?*napi_value) napi_status {
    const env = env_ orelse {
        return envIsNull();
    };
    const result: *napi_value = result_ orelse {
        return env.invalidArg();
    };

    const slice: []const u8 = brk: {
        if (str) |ptr| {
            if (NAPI_AUTO_LENGTH == length) {
                break :brk bun.sliceTo(@as([*:0]const u8, @ptrCast(ptr)), 0);
            } else if (length > std.math.maxInt(i32)) {
                return env.invalidArg();
            } else {
                break :brk ptr[0..length];
            }
        }

        if (length == 0) {
            break :brk &.{};
        } else {
            return env.invalidArg();
        }
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
pub export fn napi_create_string_utf8(env_: napi_env, str: ?[*]const u8, length: usize, result_: ?*napi_value) napi_status {
    const env = env_ orelse {
        return envIsNull();
    };
    const result: *napi_value = result_ orelse {
        return env.invalidArg();
    };

    const slice: []const u8 = brk: {
        if (str) |ptr| {
            if (NAPI_AUTO_LENGTH == length) {
                break :brk bun.sliceTo(@as([*:0]const u8, @ptrCast(ptr)), 0);
            } else if (length > std.math.maxInt(i32)) {
                return env.invalidArg();
            } else {
                break :brk ptr[0..length];
            }
        }

        if (length == 0) {
            break :brk &.{};
        } else {
            return env.invalidArg();
        }
    };

    log("napi_create_string_utf8: {s}", .{slice});

    const globalObject = env.toJS();
    const string = bun.String.createUTF8ForJS(globalObject, slice);
    if (globalObject.hasException()) {
        return env.setLastError(.pending_exception);
    }
    result.set(env, string);
    return env.ok();
}
pub export fn napi_create_string_utf16(env_: napi_env, str: ?[*]const char16_t, length: usize, result_: ?*napi_value) napi_status {
    const env = env_ orelse {
        return envIsNull();
    };
    const result: *napi_value = result_ orelse {
        return env.invalidArg();
    };

    const slice: []const u16 = brk: {
        if (str) |ptr| {
            if (NAPI_AUTO_LENGTH == length) {
                break :brk bun.sliceTo(@as([*:0]const u16, @ptrCast(ptr)), 0);
            } else if (length > std.math.maxInt(i32)) {
                return env.invalidArg();
            } else {
                break :brk ptr[0..length];
            }
        }

        if (length == 0) {
            break :brk &.{};
        } else {
            return env.invalidArg();
        }
    };

    if (comptime bun.Environment.allow_assert)
        log("napi_create_string_utf16: {d} {any}", .{ slice.len, bun.fmt.FormatUTF16{ .buf = slice[0..@min(slice.len, 512)] } });

    if (slice.len == 0) {
        result.set(env, bun.String.empty.toJS(env.toJS()));
        return env.ok();
    }

    var string, const chars = bun.String.createUninitialized(.utf16, slice.len);
    @memcpy(chars, slice);

    result.set(env, string.transferToJS(env.toJS()));
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
pub extern fn napi_get_value_bool(_: napi_env, value_: napi_value, result_: ?*bool) napi_status;

pub extern fn napi_get_value_string_latin1(env: napi_env, value_: napi_value, buf_ptr_: ?[*:0]c_char, bufsize: usize, result_ptr: ?*usize) napi_status;

/// Copies a JavaScript string into a UTF-8 string buffer. The result is the
/// number of bytes (excluding the null terminator) copied into buf.
/// A sufficient buffer size should be greater than the length of string,
/// reserving space for null terminator.
/// If bufsize is insufficient, the string will be truncated and null terminated.
/// If buf is NULL, this method returns the length of the string (in bytes)
/// via the result parameter.
/// The result argument is optional unless buf is NULL.
pub extern fn napi_get_value_string_utf8(env: napi_env, value: napi_value, buf_ptr: [*c]u8, bufsize: usize, result_ptr: ?*usize) napi_status;
pub extern fn napi_get_value_string_utf16(env: napi_env, value_: napi_value, buf_ptr: ?[*]char16_t, bufsize: usize, result_ptr: ?*usize) napi_status;
pub extern fn napi_coerce_to_bool(env: napi_env, value_: napi_value, result_: ?*napi_value) napi_status;
pub extern fn napi_coerce_to_number(env: napi_env, value_: napi_value, result_: ?*napi_value) napi_status;
pub extern fn napi_coerce_to_object(env: napi_env, value_: napi_value, result_: ?*napi_value) napi_status;
pub export fn napi_get_prototype(env_: napi_env, object_: napi_value, result_: ?*napi_value) napi_status {
    log("napi_get_prototype", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const result = result_ orelse {
        return env.invalidArg();
    };
    const object = object_.get();
    if (object == .zero) {
        return env.invalidArg();
    }
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
pub extern fn napi_set_element(env_: napi_env, object_: napi_value, index: c_uint, value_: napi_value) napi_status;
pub extern fn napi_has_element(env_: napi_env, object_: napi_value, index: c_uint, result_: ?*bool) napi_status;
pub extern fn napi_get_element(env: napi_env, object: napi_value, index: u32, result: *napi_value) napi_status;
pub extern fn napi_delete_element(env: napi_env, object: napi_value, index: u32, result: *napi_value) napi_status;
pub extern fn napi_define_properties(env: napi_env, object: napi_value, property_count: usize, properties: [*c]const napi_property_descriptor) napi_status;
pub export fn napi_is_array(env_: napi_env, value_: napi_value, result_: ?*bool) napi_status {
    log("napi_is_array", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    const result = result_ orelse {
        return env.invalidArg();
    };
    const value = value_.get();
    result.* = value.jsType().isArray();
    return env.ok();
}
pub export fn napi_get_array_length(env_: napi_env, value_: napi_value, result_: [*c]u32) napi_status {
    log("napi_get_array_length", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const result = result_ orelse {
        return env.invalidArg();
    };
    const value = value_.get();

    if (!value.jsType().isArray()) {
        return env.setLastError(.array_expected);
    }

    result.* = @truncate(value.getLength(env.toJS()) catch return env.setLastError(.pending_exception));
    return env.ok();
}
pub export fn napi_strict_equals(env_: napi_env, lhs_: napi_value, rhs_: napi_value, result_: ?*bool) napi_status {
    log("napi_strict_equals", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const result = result_ orelse {
        return env.invalidArg();
    };
    const lhs, const rhs = .{ lhs_.get(), rhs_.get() };
    // TODO: this needs to be strictEquals not isSameValue (NaN !== NaN and -0 === 0)
    result.* = lhs.isSameValue(rhs, env.toJS()) catch return env.setLastError(.pending_exception);
    return env.ok();
}
pub extern fn napi_call_function(env: napi_env, recv: napi_value, func: napi_value, argc: usize, argv: [*c]const napi_value, result: *napi_value) napi_status;
pub extern fn napi_new_instance(env: napi_env, constructor: napi_value, argc: usize, argv: [*c]const napi_value, result_: ?*napi_value) napi_status;
pub extern fn napi_instanceof(env_: napi_env, object_: napi_value, constructor_: napi_value, result_: ?*bool) napi_status;
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

pub export fn napi_open_handle_scope(env_: napi_env, result_: ?*napi_handle_scope) napi_status {
    log("napi_open_handle_scope", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.* = NapiHandleScope.open(env, false);
    return env.ok();
}

pub export fn napi_close_handle_scope(env_: napi_env, handle_scope: napi_handle_scope) napi_status {
    log("napi_close_handle_scope", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    if (handle_scope) |scope| {
        scope.close(env);
    }

    return env.ok();
}

// we don't support async contexts
pub export fn napi_async_init(env_: napi_env, _: napi_value, _: napi_value, async_ctx: **anyopaque) napi_status {
    log("napi_async_init", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    async_ctx.* = env;
    return env.ok();
}

// we don't support async contexts
pub export fn napi_async_destroy(env_: napi_env, _: *anyopaque) napi_status {
    log("napi_async_destroy", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    return env.ok();
}

// this is just a regular function call
pub export fn napi_make_callback(env_: napi_env, _: *anyopaque, recv_: napi_value, func_: napi_value, arg_count: usize, args: ?[*]const napi_value, maybe_result: ?*napi_value) napi_status {
    log("napi_make_callback", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const recv, const func = .{ recv_.get(), func_.get() };
    if (func.isEmptyOrUndefinedOrNull() or !func.isCallable()) {
        return env.setLastError(.function_expected);
    }

    const res = func.call(
        env.toJS(),
        if (recv != .zero)
            recv
        else
            .js_undefined,
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

pub export fn napi_open_escapable_handle_scope(env_: napi_env, result_: ?*napi_escapable_handle_scope) napi_status {
    log("napi_open_escapable_handle_scope", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    const result = result_ orelse {
        return env.invalidArg();
    };
    result.* = NapiHandleScope.open(env, true);
    return env.ok();
}
pub export fn napi_close_escapable_handle_scope(env_: napi_env, scope: napi_escapable_handle_scope) napi_status {
    log("napi_close_escapable_handle_scope", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    if (scope) |s| {
        s.close(env);
    }
    return env.ok();
}
pub export fn napi_escape_handle(env_: napi_env, scope_: napi_escapable_handle_scope, escapee: napi_value, result_: ?*napi_value) napi_status {
    log("napi_escape_handle", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
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
pub extern fn napi_type_tag_object(env: napi_env, _: napi_value, _: [*c]const napi_type_tag) napi_status;
pub extern fn napi_check_object_type_tag(env: napi_env, _: napi_value, _: [*c]const napi_type_tag, _: *bool) napi_status;

// do nothing for both of these
pub export fn napi_open_callback_scope(env_: napi_env, _: napi_value, _: *anyopaque, _: *anyopaque) napi_status {
    log("napi_open_callback_scope", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    return env.ok();
}
pub export fn napi_close_callback_scope(env_: napi_env, _: *anyopaque) napi_status {
    log("napi_close_callback_scope", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    return env.ok();
}
pub extern fn napi_throw(env: napi_env, @"error": napi_value) napi_status;
pub extern fn napi_throw_error(env: napi_env, code: [*c]const u8, msg: [*c]const u8) napi_status;
pub extern fn napi_throw_type_error(env: napi_env, code: [*c]const u8, msg: [*c]const u8) napi_status;
pub extern fn napi_throw_range_error(env: napi_env, code: [*c]const u8, msg: [*c]const u8) napi_status;
pub export fn napi_is_error(env_: napi_env, value_: napi_value, result: *bool) napi_status {
    log("napi_is_error", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    const value = value_.get();
    result.* = value.isAnyError();
    return env.ok();
}
pub extern fn napi_is_exception_pending(env: napi_env, result: *bool) napi_status;
pub extern fn napi_get_and_clear_last_exception(env: napi_env, result: *napi_value) napi_status;
pub export fn napi_is_arraybuffer(env_: napi_env, value_: napi_value, result_: ?*bool) napi_status {
    log("napi_is_arraybuffer", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    const result = result_ orelse {
        return env.invalidArg();
    };
    const value = value_.get();
    result.* = !value.isNumber() and value.jsTypeLoose() == .ArrayBuffer;
    return env.ok();
}
pub extern fn napi_create_arraybuffer(env: napi_env, byte_length: usize, data: [*]const u8, result: *napi_value) napi_status;

pub extern fn napi_create_external_arraybuffer(env: napi_env, external_data: ?*anyopaque, byte_length: usize, finalize_cb: napi_finalize, finalize_hint: ?*anyopaque, result: *napi_value) napi_status;

pub export fn napi_get_arraybuffer_info(env_: napi_env, arraybuffer_: napi_value, data: ?*[*]u8, byte_length: ?*usize) napi_status {
    log("napi_get_arraybuffer_info", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    const arraybuffer = arraybuffer_.get();
    const array_buffer = arraybuffer.asArrayBuffer(env.toJS()) orelse return env.setLastError(.arraybuffer_expected);
    const slice = array_buffer.slice();
    if (data) |dat|
        dat.* = slice.ptr;
    if (byte_length) |len|
        len.* = slice.len;
    return env.ok();
}

pub extern fn napi_is_typedarray(napi_env, napi_value, *bool) napi_status;

pub export fn napi_get_typedarray_info(
    env_: napi_env,
    typedarray_: napi_value,
    maybe_type: ?*napi_typedarray_type,
    maybe_length: ?*usize,
    maybe_data: ?*[*]u8,
    maybe_arraybuffer: ?*napi_value,
    maybe_byte_offset: ?*usize,
) napi_status {
    log("napi_get_typedarray_info", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
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
pub export fn napi_is_dataview(env_: napi_env, value_: napi_value, result_: ?*bool) napi_status {
    log("napi_is_dataview", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const result = result_ orelse {
        return env.invalidArg();
    };
    const value = value_.get();
    result.* = !value.isEmptyOrUndefinedOrNull() and value.jsTypeLoose() == .DataView;
    return env.ok();
}
pub export fn napi_get_dataview_info(
    env_: napi_env,
    dataview_: napi_value,
    maybe_bytelength: ?*usize,
    maybe_data: ?*[*]u8,
    maybe_arraybuffer: ?*napi_value,
    maybe_byte_offset: ?*usize,
) napi_status {
    log("napi_get_dataview_info", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
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
pub export fn napi_get_version(env_: napi_env, result_: ?*u32) napi_status {
    log("napi_get_version", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const result = result_ orelse {
        return env.invalidArg();
    };
    // The result is supposed to be the highest NAPI version Bun supports, rather than the version reported by a NAPI module.
    result.* = 9;
    return env.ok();
}
pub export fn napi_create_promise(env_: napi_env, deferred_: ?*napi_deferred, promise_: ?*napi_value) napi_status {
    log("napi_create_promise", .{});
    const env = env_ orelse {
        return envIsNull();
    };
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
pub export fn napi_resolve_deferred(env_: napi_env, deferred: napi_deferred, resolution_: napi_value) napi_status {
    log("napi_resolve_deferred", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const resolution = resolution_.get();
    var prom = deferred.get();
    prom.resolve(env.toJS(), resolution);
    deferred.deinit();
    bun.default_allocator.destroy(deferred);
    return env.ok();
}
pub export fn napi_reject_deferred(env_: napi_env, deferred: napi_deferred, rejection_: napi_value) napi_status {
    log("napi_reject_deferred", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const rejection = rejection_.get();
    var prom = deferred.get();
    prom.reject(env.toJS(), rejection);
    deferred.deinit();
    bun.default_allocator.destroy(deferred);
    return env.ok();
}
pub export fn napi_is_promise(env_: napi_env, value_: napi_value, is_promise_: ?*bool) napi_status {
    log("napi_is_promise", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
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
pub export fn napi_create_date(env_: napi_env, time: f64, result_: ?*napi_value) napi_status {
    log("napi_create_date", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const result = result_ orelse {
        return env.invalidArg();
    };
    var args = [_]JSC.C.JSValueRef{JSC.JSValue.jsNumber(time).asObjectRef()};
    result.set(env, JSValue.c(JSC.C.JSObjectMakeDate(env.toJS().ref(), 1, &args, TODO_EXCEPTION)));
    return env.ok();
}
pub export fn napi_is_date(env_: napi_env, value_: napi_value, is_date_: ?*bool) napi_status {
    log("napi_is_date", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    env.checkGC();
    const is_date = is_date_ orelse {
        return env.invalidArg();
    };
    const value = value_.get();
    is_date.* = value.jsTypeLoose() == .JSDate;
    return env.ok();
}
pub extern fn napi_get_date_value(env: napi_env, value: napi_value, result: *f64) napi_status;
pub extern fn napi_add_finalizer(env: napi_env, js_object: napi_value, native_object: ?*anyopaque, finalize_cb: napi_finalize, finalize_hint: ?*anyopaque, result: napi_ref) napi_status;
pub extern fn napi_create_bigint_int64(env: napi_env, value: i64, result_: ?*napi_value) napi_status;
pub extern fn napi_create_bigint_uint64(env: napi_env, value: u64, result_: ?*napi_value) napi_status;
pub extern fn napi_create_bigint_words(env: napi_env, sign_bit: c_int, word_count: usize, words: [*c]const u64, result: *napi_value) napi_status;
pub extern fn napi_get_value_bigint_int64(_: napi_env, value_: napi_value, result_: ?*i64, _: *bool) napi_status;
pub extern fn napi_get_value_bigint_uint64(_: napi_env, value_: napi_value, result_: ?*u64, _: *bool) napi_status;

pub extern fn napi_get_value_bigint_words(env: napi_env, value: napi_value, sign_bit: [*c]c_int, word_count: [*c]usize, words: [*c]u64) napi_status;
pub extern fn napi_get_all_property_names(env: napi_env, object: napi_value, key_mode: napi_key_collection_mode, key_filter: napi_key_filter, key_conversion: napi_key_conversion, result: *napi_value) napi_status;
pub extern fn napi_set_instance_data(env: napi_env, data: ?*anyopaque, finalize_cb: napi_finalize, finalize_hint: ?*anyopaque) napi_status;
pub extern fn napi_get_instance_data(env: napi_env, data: [*]*anyopaque) napi_status;
pub extern fn napi_detach_arraybuffer(env: napi_env, arraybuffer: napi_value) napi_status;
pub extern fn napi_is_detached_arraybuffer(env: napi_env, value: napi_value, result: *bool) napi_status;

const WorkPool = @import("../work_pool.zig").WorkPool;
const WorkPoolTask = @import("../work_pool.zig").Task;

/// must be globally allocated
pub const napi_async_work = struct {
    task: WorkPoolTask = .{ .callback = &runFromThreadPool },
    concurrent_task: JSC.ConcurrentTask = .{},
    event_loop: *JSC.EventLoop,
    global: *JSC.JSGlobalObject,
    env: *NapiEnv,
    execute: napi_async_execute_callback,
    complete: ?napi_async_complete_callback,
    data: ?*anyopaque = null,
    status: std.atomic.Value(Status) = .init(.pending),
    scheduled: bool = false,
    poll_ref: Async.KeepAlive = .{},

    pub const Status = enum(u32) {
        pending = 0,
        started = 1,
        completed = 2,
        cancelled = 3,
    };

    pub fn new(env: *NapiEnv, execute: napi_async_execute_callback, complete: ?napi_async_complete_callback, data: ?*anyopaque) *napi_async_work {
        const global = env.toJS();

        const work = bun.new(napi_async_work, .{
            .global = global,
            .env = env,
            .execute = execute,
            .event_loop = global.bunVM().eventLoop(),
            .complete = complete,
            .data = data,
        });
        return work;
    }

    pub fn destroy(this: *napi_async_work) void {
        bun.destroy(this);
    }

    pub fn schedule(this: *napi_async_work) void {
        if (this.scheduled) return;
        this.scheduled = true;
        this.poll_ref.ref(this.global.bunVM());
        WorkPool.schedule(&this.task);
    }

    pub fn runFromThreadPool(task: *WorkPoolTask) void {
        var this: *napi_async_work = @fieldParentPtr("task", task);
        this.run();
    }
    fn run(this: *napi_async_work) void {
        if (this.status.cmpxchgStrong(.pending, .started, .seq_cst, .seq_cst)) |state| {
            if (state == .cancelled) {
                this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
                return;
            }
        }
        this.execute(this.env, this.data);
        this.status.store(.completed, .seq_cst);

        this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
    }

    pub fn cancel(this: *napi_async_work) bool {
        return this.status.cmpxchgStrong(.pending, .cancelled, .seq_cst, .seq_cst) == null;
    }

    pub fn runFromJS(this: *napi_async_work, vm: *JSC.VirtualMachine, global: *JSC.JSGlobalObject) void {
        // Note: the "this" value here may already be freed by the user in `complete`
        var poll_ref = this.poll_ref;
        defer poll_ref.unref(vm);

        // https://github.com/nodejs/node/blob/a2de5b9150da60c77144bb5333371eaca3fab936/src/node_api.cc#L1201
        const complete = this.complete orelse {
            return;
        };

        const env = this.env;
        const handle_scope = NapiHandleScope.open(env, false);
        defer if (handle_scope) |scope| scope.close(env);

        const status: NapiStatus = if (this.status.load(.seq_cst) == .cancelled)
            .cancelled
        else
            .ok;

        complete(
            env,
            @intFromEnum(status),
            this.data,
        );

        if (global.hasException()) {
            global.reportActiveExceptionAsUnhandled(error.JSError);
        }
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
pub const napi_async_execute_callback = *const fn (napi_env, ?*anyopaque) callconv(.C) void;
pub const napi_async_complete_callback = *const fn (napi_env, napi_status, ?*anyopaque) callconv(.C) void;
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
pub const napi_async_cleanup_hook = ?*const fn (napi_async_cleanup_hook_handle, ?*anyopaque) callconv(.C) void;

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
        bun.Output.panic("NAPI FATAL ERROR: {s} {s}", .{ location, message });
    }

    bun.Output.panic("napi: {s}", .{message});
}
pub export fn napi_create_buffer(env_: napi_env, length: usize, data: ?**anyopaque, result: *napi_value) napi_status {
    log("napi_create_buffer: {d}", .{length});
    const env = env_ orelse {
        return envIsNull();
    };
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
pub export fn napi_create_buffer_copy(env_: napi_env, length: usize, data: [*]u8, result_data: ?*?*anyopaque, result_: ?*napi_value) napi_status {
    log("napi_create_buffer_copy: {d}", .{length});
    const env = env_ orelse {
        return envIsNull();
    };
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
extern fn napi_is_buffer(napi_env, napi_value, *bool) napi_status;
pub export fn napi_get_buffer_info(env_: napi_env, value_: napi_value, data: ?*[*]u8, length: ?*usize) napi_status {
    log("napi_get_buffer_info", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const value = value_.get();
    const array_buf = value.asArrayBuffer(env.toJS()) orelse {
        return env.setLastError(.invalid_arg);
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
    env_: napi_env,
    _: napi_value,
    _: [*:0]const u8,
    execute_: ?napi_async_execute_callback,
    complete: ?napi_async_complete_callback,
    data: ?*anyopaque,
    result_: ?**napi_async_work,
) napi_status {
    log("napi_create_async_work", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const result = result_ orelse {
        return env.invalidArg();
    };
    // https://github.com/nodejs/node/blob/a2de5b9150da60c77144bb5333371eaca3fab936/src/node_api.cc#L1245
    const execute = execute_ orelse {
        return env.invalidArg();
    };
    result.* = napi_async_work.new(env, execute, complete, data);
    return env.ok();
}
pub export fn napi_delete_async_work(env_: napi_env, work_: ?*napi_async_work) napi_status {
    log("napi_delete_async_work", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const work = work_ orelse {
        return env.invalidArg();
    };
    if (comptime bun.Environment.allow_assert) bun.assert(env.toJS() == work.global);
    work.destroy();
    return env.ok();
}
pub export fn napi_queue_async_work(env_: napi_env, work_: ?*napi_async_work) napi_status {
    log("napi_queue_async_work", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const work = work_ orelse {
        return env.invalidArg();
    };
    if (comptime bun.Environment.allow_assert) bun.assert(env.toJS() == work.global);
    work.schedule();
    return env.ok();
}
pub export fn napi_cancel_async_work(env_: napi_env, work_: ?*napi_async_work) napi_status {
    log("napi_cancel_async_work", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const work = work_ orelse {
        return env.invalidArg();
    };
    if (comptime bun.Environment.allow_assert) bun.assert(env.toJS() == work.global);
    if (work.cancel()) {
        return env.ok();
    }

    return env.genericFailure();
}
pub export fn napi_get_node_version(env_: napi_env, version_: ?**const napi_node_version) napi_status {
    log("napi_get_node_version", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const version = version_ orelse {
        return env.invalidArg();
    };
    version.* = &napi_node_version.global;
    return env.ok();
}
const napi_event_loop = if (bun.Environment.isWindows) *bun.windows.libuv.Loop else *JSC.EventLoop;
pub export fn napi_get_uv_event_loop(env_: napi_env, loop_: ?*napi_event_loop) napi_status {
    log("napi_get_uv_event_loop", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const loop = loop_ orelse {
        return env.invalidArg();
    };
    if (bun.Environment.isWindows) {
        // alignment error is incorrect.
        // TODO(@190n) investigate
        @setRuntimeSafety(false);
        loop.* = JSC.VirtualMachine.get().uvLoop();
    } else {
        // there is no uv event loop on posix, we use our event loop handle.
        loop.* = env.toJS().bunVM().eventLoop();
    }
    return env.ok();
}
pub extern fn napi_fatal_exception(env: napi_env, err: napi_value) napi_status;
pub extern fn napi_add_async_cleanup_hook(env: napi_env, function: napi_async_cleanup_hook, data: ?*anyopaque, handle_out: ?*napi_async_cleanup_hook_handle) napi_status;
pub extern fn napi_add_env_cleanup_hook(env: napi_env, function: ?*const fn (?*anyopaque) void, data: ?*anyopaque) napi_status;
pub extern fn napi_create_typedarray(env: napi_env, napi_typedarray_type, length: usize, arraybuffer: napi_value, byte_offset: usize, result: ?*napi_value) napi_status;
pub extern fn napi_remove_async_cleanup_hook(handle: napi_async_cleanup_hook_handle) napi_status;
pub extern fn napi_remove_env_cleanup_hook(env: napi_env, function: ?*const fn (?*anyopaque) void, data: ?*anyopaque) napi_status;

extern fn napi_internal_cleanup_env_cpp(env: napi_env) callconv(.C) void;
extern fn napi_internal_check_gc(env: napi_env) callconv(.C) void;

pub export fn napi_internal_register_cleanup_zig(env_: napi_env) void {
    const env = env_.?;
    env.toJS().bunVM().rareData().pushCleanupHook(env.toJS(), env, struct {
        fn callback(data: ?*anyopaque) callconv(.C) void {
            napi_internal_cleanup_env_cpp(@ptrCast(data));
        }
    }.callback);
}

extern fn napi_internal_remove_finalizer(env: napi_env, fun: napi_finalize, hint: ?*anyopaque, data: ?*anyopaque) callconv(.C) void;

pub const Finalizer = struct {
    env: napi_env,
    fun: napi_finalize,
    data: ?*anyopaque = null,
    hint: ?*anyopaque = null,

    pub fn run(this: *Finalizer) void {
        const env = this.env.?;
        const handle_scope = NapiHandleScope.open(env, false);
        defer if (handle_scope) |scope| scope.close(env);
        if (this.fun) |fun| {
            fun(env, this.data, this.hint);
        }
        napi_internal_remove_finalizer(env, this.fun, this.hint, this.data);
        if (env.toJS().tryTakeException()) |exception| {
            _ = env.toJS().bunVM().uncaughtException(env.toJS(), exception, false);
        }
    }

    /// For Node-API modules not built with NAPI_EXPERIMENTAL, finalizers should be deferred to the
    /// immediate task queue instead of run immediately. This lets finalizers perform allocations,
    /// which they couldn't if they ran immediately while the garbage collector is still running.
    pub export fn napi_internal_enqueue_finalizer(env: napi_env, fun: napi_finalize, data: ?*anyopaque, hint: ?*anyopaque) callconv(.C) void {
        const task = NapiFinalizerTask.init(.{ .env = env, .fun = fun, .data = data, .hint = hint });
        task.schedule();
    }
};

// TODO: generate comptime version of this instead of runtime checking
pub const ThreadSafeFunction = struct {
    pub const Callback = union(enum) {
        js: JSC.Strong.Optional,
        c: struct {
            js: JSC.Strong.Optional,
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
    tracker: JSC.Debugger.AsyncTaskTracker,

    env: *NapiEnv,

    finalizer: Finalizer = Finalizer{ .env = null, .fun = null, .data = null },
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

    pub const new = bun.TrivialNew(ThreadSafeFunction);

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

        this.call(task, !is_first) catch return false;

        if (queue_finalizer_after_call) {
            this.maybeQueueFinalizer();
        }

        return has_more;
    }

    /// This function can be called multiple times in one tick of the event loop.
    /// See: https://github.com/nodejs/node/pull/38506
    /// In that case, we need to drain microtasks.
    fn call(this: *ThreadSafeFunction, task: ?*anyopaque, is_first: bool) bun.JSExecutionTerminated!void {
        const env = this.env;
        if (!is_first) {
            try this.event_loop.drainMicrotasks();
        }
        const globalObject = env.toJS();

        this.tracker.willDispatch(globalObject);
        defer this.tracker.didDispatch(globalObject);

        switch (this.callback) {
            .js => |strong| {
                const js: JSValue = strong.get() orelse .js_undefined;
                if (js.isEmptyOrUndefinedOrNull()) {
                    return;
                }

                _ = js.call(globalObject, .js_undefined, &.{}) catch |err|
                    globalObject.reportActiveExceptionAsUnhandled(err);
            },
            .c => |cb| {
                const js: JSValue = cb.js.get() orelse .js_undefined;

                const handle_scope = NapiHandleScope.open(env, false);
                defer if (handle_scope) |scope| scope.close(env);
                cb.napi_threadsafe_function_call_js(env, napi_value.create(env, js), this.ctx, task);
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
            Finalizer.napi_internal_enqueue_finalizer(this.env, fun, this.finalizer.data, this.ctx);
        }

        this.callback.deinit();
        this.queue.deinit();
        bun.destroy(this);
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
    env_: napi_env,
    func_: napi_value,
    _: napi_value, // async_resource
    _: napi_value, // async_resource_name
    max_queue_size: usize,
    initial_thread_count: usize,
    thread_finalize_data: ?*anyopaque,
    thread_finalize_cb: napi_finalize,
    context: ?*anyopaque,
    call_js_cb: ?napi_threadsafe_function_call_js,
    result_: ?*napi_threadsafe_function,
) napi_status {
    log("napi_create_threadsafe_function", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    const result = result_ orelse {
        return env.invalidArg();
    };
    const func = func_.get();

    if (call_js_cb == null and (func.isEmptyOrUndefinedOrNull() or !func.isCallable())) {
        return env.setLastError(.function_expected);
    }

    const vm = env.toJS().bunVM();
    var function = ThreadSafeFunction.new(.{
        .event_loop = vm.eventLoop(),
        .env = env,
        .callback = if (call_js_cb) |c| .{
            .c = .{
                .napi_threadsafe_function_call_js = c,
                .js = if (func == .zero) .empty else JSC.Strong.Optional.create(func.withAsyncContextIfNeeded(env.toJS()), vm.global),
            },
        } else .{
            .js = if (func == .zero) .empty else JSC.Strong.Optional.create(func.withAsyncContextIfNeeded(env.toJS()), vm.global),
        },
        .ctx = context,
        .queue = ThreadSafeFunction.Queue.init(max_queue_size, bun.default_allocator),
        .thread_count = .{ .raw = @intCast(initial_thread_count) },
        .poll_ref = Async.KeepAlive.init(),
        .tracker = JSC.Debugger.AsyncTaskTracker.init(vm),
    });

    function.finalizer = .{ .env = env, .data = thread_finalize_data, .fun = thread_finalize_cb };
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
pub export fn napi_unref_threadsafe_function(env_: napi_env, func: napi_threadsafe_function) napi_status {
    log("napi_unref_threadsafe_function", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    bun.assert(func.event_loop.global == env.toJS());
    func.unref();
    return env.ok();
}
pub export fn napi_ref_threadsafe_function(env_: napi_env, func: napi_threadsafe_function) napi_status {
    log("napi_ref_threadsafe_function", .{});
    const env = env_ orelse {
        return envIsNull();
    };
    bun.assert(func.event_loop.global == env.toJS());
    func.ref();
    return env.ok();
}

const NAPI_AUTO_LENGTH = std.math.maxInt(usize);

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
    // Bug @paperclover if you get stuck here
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

const uv_functions_to_export = if (bun.Environment.isPosix) struct {
    pub extern "c" fn uv_accept() void;
    pub extern "c" fn uv_async_init() void;
    pub extern "c" fn uv_async_send() void;
    pub extern "c" fn uv_available_parallelism() void;
    pub extern "c" fn uv_backend_fd() void;
    pub extern "c" fn uv_backend_timeout() void;
    pub extern "c" fn uv_barrier_destroy() void;
    pub extern "c" fn uv_barrier_init() void;
    pub extern "c" fn uv_barrier_wait() void;
    pub extern "c" fn uv_buf_init() void;
    pub extern "c" fn uv_cancel() void;
    pub extern "c" fn uv_chdir() void;
    pub extern "c" fn uv_check_init() void;
    pub extern "c" fn uv_check_start() void;
    pub extern "c" fn uv_check_stop() void;
    pub extern "c" fn uv_clock_gettime() void;
    pub extern "c" fn uv_close() void;
    pub extern "c" fn uv_cond_broadcast() void;
    pub extern "c" fn uv_cond_destroy() void;
    pub extern "c" fn uv_cond_init() void;
    pub extern "c" fn uv_cond_signal() void;
    pub extern "c" fn uv_cond_timedwait() void;
    pub extern "c" fn uv_cond_wait() void;
    pub extern "c" fn uv_cpu_info() void;
    pub extern "c" fn uv_cpumask_size() void;
    pub extern "c" fn uv_cwd() void;
    pub extern "c" fn uv_default_loop() void;
    pub extern "c" fn uv_disable_stdio_inheritance() void;
    pub extern "c" fn uv_dlclose() void;
    pub extern "c" fn uv_dlerror() void;
    pub extern "c" fn uv_dlopen() void;
    pub extern "c" fn uv_dlsym() void;
    pub extern "c" fn uv_err_name() void;
    pub extern "c" fn uv_err_name_r() void;
    pub extern "c" fn uv_exepath() void;
    pub extern "c" fn uv_fileno() void;
    pub extern "c" fn uv_free_cpu_info() void;
    pub extern "c" fn uv_free_interface_addresses() void;
    pub extern "c" fn uv_freeaddrinfo() void;
    pub extern "c" fn uv_fs_access() void;
    pub extern "c" fn uv_fs_chmod() void;
    pub extern "c" fn uv_fs_chown() void;
    pub extern "c" fn uv_fs_close() void;
    pub extern "c" fn uv_fs_closedir() void;
    pub extern "c" fn uv_fs_copyfile() void;
    pub extern "c" fn uv_fs_event_getpath() void;
    pub extern "c" fn uv_fs_event_init() void;
    pub extern "c" fn uv_fs_event_start() void;
    pub extern "c" fn uv_fs_event_stop() void;
    pub extern "c" fn uv_fs_fchmod() void;
    pub extern "c" fn uv_fs_fchown() void;
    pub extern "c" fn uv_fs_fdatasync() void;
    pub extern "c" fn uv_fs_fstat() void;
    pub extern "c" fn uv_fs_fsync() void;
    pub extern "c" fn uv_fs_ftruncate() void;
    pub extern "c" fn uv_fs_futime() void;
    pub extern "c" fn uv_fs_get_path() void;
    pub extern "c" fn uv_fs_get_ptr() void;
    pub extern "c" fn uv_fs_get_result() void;
    pub extern "c" fn uv_fs_get_statbuf() void;
    pub extern "c" fn uv_fs_get_system_error() void;
    pub extern "c" fn uv_fs_get_type() void;
    pub extern "c" fn uv_fs_lchown() void;
    pub extern "c" fn uv_fs_link() void;
    pub extern "c" fn uv_fs_lstat() void;
    pub extern "c" fn uv_fs_lutime() void;
    pub extern "c" fn uv_fs_mkdir() void;
    pub extern "c" fn uv_fs_mkdtemp() void;
    pub extern "c" fn uv_fs_mkstemp() void;
    pub extern "c" fn uv_fs_open() void;
    pub extern "c" fn uv_fs_opendir() void;
    pub extern "c" fn uv_fs_poll_getpath() void;
    pub extern "c" fn uv_fs_poll_init() void;
    pub extern "c" fn uv_fs_poll_start() void;
    pub extern "c" fn uv_fs_poll_stop() void;
    pub extern "c" fn uv_fs_read() void;
    pub extern "c" fn uv_fs_readdir() void;
    pub extern "c" fn uv_fs_readlink() void;
    pub extern "c" fn uv_fs_realpath() void;
    pub extern "c" fn uv_fs_rename() void;
    pub extern "c" fn uv_fs_req_cleanup() void;
    pub extern "c" fn uv_fs_rmdir() void;
    pub extern "c" fn uv_fs_scandir() void;
    pub extern "c" fn uv_fs_scandir_next() void;
    pub extern "c" fn uv_fs_sendfile() void;
    pub extern "c" fn uv_fs_stat() void;
    pub extern "c" fn uv_fs_statfs() void;
    pub extern "c" fn uv_fs_symlink() void;
    pub extern "c" fn uv_fs_unlink() void;
    pub extern "c" fn uv_fs_utime() void;
    pub extern "c" fn uv_fs_write() void;
    pub extern "c" fn uv_get_available_memory() void;
    pub extern "c" fn uv_get_constrained_memory() void;
    pub extern "c" fn uv_get_free_memory() void;
    pub extern "c" fn uv_get_osfhandle() void;
    pub extern "c" fn uv_get_process_title() void;
    pub extern "c" fn uv_get_total_memory() void;
    pub extern "c" fn uv_getaddrinfo() void;
    pub extern "c" fn uv_getnameinfo() void;
    pub extern "c" fn uv_getrusage() void;
    pub extern "c" fn uv_getrusage_thread() void;
    pub extern "c" fn uv_gettimeofday() void;
    pub extern "c" fn uv_guess_handle() void;
    pub extern "c" fn uv_handle_get_data() void;
    pub extern "c" fn uv_handle_get_loop() void;
    pub extern "c" fn uv_handle_get_type() void;
    pub extern "c" fn uv_handle_set_data() void;
    pub extern "c" fn uv_handle_size() void;
    pub extern "c" fn uv_handle_type_name() void;
    pub extern "c" fn uv_has_ref() void;
    pub extern "c" fn uv_hrtime() void;
    pub extern "c" fn uv_idle_init() void;
    pub extern "c" fn uv_idle_start() void;
    pub extern "c" fn uv_idle_stop() void;
    pub extern "c" fn uv_if_indextoiid() void;
    pub extern "c" fn uv_if_indextoname() void;
    pub extern "c" fn uv_inet_ntop() void;
    pub extern "c" fn uv_inet_pton() void;
    pub extern "c" fn uv_interface_addresses() void;
    pub extern "c" fn uv_ip_name() void;
    pub extern "c" fn uv_ip4_addr() void;
    pub extern "c" fn uv_ip4_name() void;
    pub extern "c" fn uv_ip6_addr() void;
    pub extern "c" fn uv_ip6_name() void;
    pub extern "c" fn uv_is_active() void;
    pub extern "c" fn uv_is_closing() void;
    pub extern "c" fn uv_is_readable() void;
    pub extern "c" fn uv_is_writable() void;
    pub extern "c" fn uv_key_create() void;
    pub extern "c" fn uv_key_delete() void;
    pub extern "c" fn uv_key_get() void;
    pub extern "c" fn uv_key_set() void;
    pub extern "c" fn uv_kill() void;
    pub extern "c" fn uv_library_shutdown() void;
    pub extern "c" fn uv_listen() void;
    pub extern "c" fn uv_loadavg() void;
    pub extern "c" fn uv_loop_alive() void;
    pub extern "c" fn uv_loop_close() void;
    pub extern "c" fn uv_loop_configure() void;
    pub extern "c" fn uv_loop_delete() void;
    pub extern "c" fn uv_loop_fork() void;
    pub extern "c" fn uv_loop_get_data() void;
    pub extern "c" fn uv_loop_init() void;
    pub extern "c" fn uv_loop_new() void;
    pub extern "c" fn uv_loop_set_data() void;
    pub extern "c" fn uv_loop_size() void;
    pub extern "c" fn uv_metrics_idle_time() void;
    pub extern "c" fn uv_metrics_info() void;
    pub extern "c" fn uv_mutex_destroy() void;
    pub extern "c" fn uv_mutex_init() void;
    pub extern "c" fn uv_mutex_init_recursive() void;
    pub extern "c" fn uv_mutex_lock() void;
    pub extern "c" fn uv_mutex_trylock() void;
    pub extern "c" fn uv_mutex_unlock() void;
    pub extern "c" fn uv_now() void;
    pub extern "c" fn uv_once() void;
    pub extern "c" fn uv_open_osfhandle() void;
    pub extern "c" fn uv_os_environ() void;
    pub extern "c" fn uv_os_free_environ() void;
    pub extern "c" fn uv_os_free_group() void;
    pub extern "c" fn uv_os_free_passwd() void;
    pub extern "c" fn uv_os_get_group() void;
    pub extern "c" fn uv_os_get_passwd() void;
    pub extern "c" fn uv_os_get_passwd2() void;
    pub extern "c" fn uv_os_getenv() void;
    pub extern "c" fn uv_os_gethostname() void;
    pub extern "c" fn uv_os_getpid() void;
    pub extern "c" fn uv_os_getppid() void;
    pub extern "c" fn uv_os_getpriority() void;
    pub extern "c" fn uv_os_homedir() void;
    pub extern "c" fn uv_os_setenv() void;
    pub extern "c" fn uv_os_setpriority() void;
    pub extern "c" fn uv_os_tmpdir() void;
    pub extern "c" fn uv_os_uname() void;
    pub extern "c" fn uv_os_unsetenv() void;
    pub extern "c" fn uv_pipe() void;
    pub extern "c" fn uv_pipe_bind() void;
    pub extern "c" fn uv_pipe_bind2() void;
    pub extern "c" fn uv_pipe_chmod() void;
    pub extern "c" fn uv_pipe_connect() void;
    pub extern "c" fn uv_pipe_connect2() void;
    pub extern "c" fn uv_pipe_getpeername() void;
    pub extern "c" fn uv_pipe_getsockname() void;
    pub extern "c" fn uv_pipe_init() void;
    pub extern "c" fn uv_pipe_open() void;
    pub extern "c" fn uv_pipe_pending_count() void;
    pub extern "c" fn uv_pipe_pending_instances() void;
    pub extern "c" fn uv_pipe_pending_type() void;
    pub extern "c" fn uv_poll_init() void;
    pub extern "c" fn uv_poll_init_socket() void;
    pub extern "c" fn uv_poll_start() void;
    pub extern "c" fn uv_poll_stop() void;
    pub extern "c" fn uv_prepare_init() void;
    pub extern "c" fn uv_prepare_start() void;
    pub extern "c" fn uv_prepare_stop() void;
    pub extern "c" fn uv_print_active_handles() void;
    pub extern "c" fn uv_print_all_handles() void;
    pub extern "c" fn uv_process_get_pid() void;
    pub extern "c" fn uv_process_kill() void;
    pub extern "c" fn uv_queue_work() void;
    pub extern "c" fn uv_random() void;
    pub extern "c" fn uv_read_start() void;
    pub extern "c" fn uv_read_stop() void;
    pub extern "c" fn uv_recv_buffer_size() void;
    pub extern "c" fn uv_ref() void;
    pub extern "c" fn uv_replace_allocator() void;
    pub extern "c" fn uv_req_get_data() void;
    pub extern "c" fn uv_req_get_type() void;
    pub extern "c" fn uv_req_set_data() void;
    pub extern "c" fn uv_req_size() void;
    pub extern "c" fn uv_req_type_name() void;
    pub extern "c" fn uv_resident_set_memory() void;
    pub extern "c" fn uv_run() void;
    pub extern "c" fn uv_rwlock_destroy() void;
    pub extern "c" fn uv_rwlock_init() void;
    pub extern "c" fn uv_rwlock_rdlock() void;
    pub extern "c" fn uv_rwlock_rdunlock() void;
    pub extern "c" fn uv_rwlock_tryrdlock() void;
    pub extern "c" fn uv_rwlock_trywrlock() void;
    pub extern "c" fn uv_rwlock_wrlock() void;
    pub extern "c" fn uv_rwlock_wrunlock() void;
    pub extern "c" fn uv_sem_destroy() void;
    pub extern "c" fn uv_sem_init() void;
    pub extern "c" fn uv_sem_post() void;
    pub extern "c" fn uv_sem_trywait() void;
    pub extern "c" fn uv_sem_wait() void;
    pub extern "c" fn uv_send_buffer_size() void;
    pub extern "c" fn uv_set_process_title() void;
    pub extern "c" fn uv_setup_args() void;
    pub extern "c" fn uv_shutdown() void;
    pub extern "c" fn uv_signal_init() void;
    pub extern "c" fn uv_signal_start() void;
    pub extern "c" fn uv_signal_start_oneshot() void;
    pub extern "c" fn uv_signal_stop() void;
    pub extern "c" fn uv_sleep() void;
    pub extern "c" fn uv_socketpair() void;
    pub extern "c" fn uv_spawn() void;
    pub extern "c" fn uv_stop() void;
    pub extern "c" fn uv_stream_get_write_queue_size() void;
    pub extern "c" fn uv_stream_set_blocking() void;
    pub extern "c" fn uv_strerror() void;
    pub extern "c" fn uv_strerror_r() void;
    pub extern "c" fn uv_tcp_bind() void;
    pub extern "c" fn uv_tcp_close_reset() void;
    pub extern "c" fn uv_tcp_connect() void;
    pub extern "c" fn uv_tcp_getpeername() void;
    pub extern "c" fn uv_tcp_getsockname() void;
    pub extern "c" fn uv_tcp_init() void;
    pub extern "c" fn uv_tcp_init_ex() void;
    pub extern "c" fn uv_tcp_keepalive() void;
    pub extern "c" fn uv_tcp_nodelay() void;
    pub extern "c" fn uv_tcp_open() void;
    pub extern "c" fn uv_tcp_simultaneous_accepts() void;
    pub extern "c" fn uv_thread_create() void;
    pub extern "c" fn uv_thread_create_ex() void;
    pub extern "c" fn uv_thread_detach() void;
    pub extern "c" fn uv_thread_equal() void;
    pub extern "c" fn uv_thread_getaffinity() void;
    pub extern "c" fn uv_thread_getcpu() void;
    pub extern "c" fn uv_thread_getname() void;
    pub extern "c" fn uv_thread_getpriority() void;
    pub extern "c" fn uv_thread_join() void;
    pub extern "c" fn uv_thread_self() void;
    pub extern "c" fn uv_thread_setaffinity() void;
    pub extern "c" fn uv_thread_setname() void;
    pub extern "c" fn uv_thread_setpriority() void;
    pub extern "c" fn uv_timer_again() void;
    pub extern "c" fn uv_timer_get_due_in() void;
    pub extern "c" fn uv_timer_get_repeat() void;
    pub extern "c" fn uv_timer_init() void;
    pub extern "c" fn uv_timer_set_repeat() void;
    pub extern "c" fn uv_timer_start() void;
    pub extern "c" fn uv_timer_stop() void;
    pub extern "c" fn uv_translate_sys_error() void;
    pub extern "c" fn uv_try_write() void;
    pub extern "c" fn uv_try_write2() void;
    pub extern "c" fn uv_tty_get_vterm_state() void;
    pub extern "c" fn uv_tty_get_winsize() void;
    pub extern "c" fn uv_tty_init() void;
    pub extern "c" fn uv_tty_reset_mode() void;
    pub extern "c" fn uv_tty_set_mode() void;
    pub extern "c" fn uv_tty_set_vterm_state() void;
    pub extern "c" fn uv_udp_bind() void;
    pub extern "c" fn uv_udp_connect() void;
    pub extern "c" fn uv_udp_get_send_queue_count() void;
    pub extern "c" fn uv_udp_get_send_queue_size() void;
    pub extern "c" fn uv_udp_getpeername() void;
    pub extern "c" fn uv_udp_getsockname() void;
    pub extern "c" fn uv_udp_init() void;
    pub extern "c" fn uv_udp_init_ex() void;
    pub extern "c" fn uv_udp_open() void;
    pub extern "c" fn uv_udp_recv_start() void;
    pub extern "c" fn uv_udp_recv_stop() void;
    pub extern "c" fn uv_udp_send() void;
    pub extern "c" fn uv_udp_set_broadcast() void;
    pub extern "c" fn uv_udp_set_membership() void;
    pub extern "c" fn uv_udp_set_multicast_interface() void;
    pub extern "c" fn uv_udp_set_multicast_loop() void;
    pub extern "c" fn uv_udp_set_multicast_ttl() void;
    pub extern "c" fn uv_udp_set_source_membership() void;
    pub extern "c" fn uv_udp_set_ttl() void;
    pub extern "c" fn uv_udp_try_send() void;
    pub extern "c" fn uv_udp_try_send2() void;
    pub extern "c" fn uv_udp_using_recvmmsg() void;
    pub extern "c" fn uv_unref() void;
    pub extern "c" fn uv_update_time() void;
    pub extern "c" fn uv_uptime() void;
    pub extern "c" fn uv_utf16_length_as_wtf8() void;
    pub extern "c" fn uv_utf16_to_wtf8() void;
    pub extern "c" fn uv_version() void;
    pub extern "c" fn uv_version_string() void;
    pub extern "c" fn uv_walk() void;
    pub extern "c" fn uv_write() void;
    pub extern "c" fn uv_write2() void;
    pub extern "c" fn uv_wtf8_length_as_utf16() void;
    pub extern "c" fn uv_wtf8_to_utf16() void;
} else struct {};

pub fn fixDeadCodeElimination() void {
    JSC.markBinding(@src());

    inline for (napi_functions_to_export) |fn_name| {
        std.mem.doNotOptimizeAway(&fn_name);
    }

    inline for (comptime std.meta.declarations(uv_functions_to_export)) |decl| {
        std.mem.doNotOptimizeAway(&@field(uv_functions_to_export, decl.name));
    }

    inline for (comptime std.meta.declarations(V8API)) |decl| {
        std.mem.doNotOptimizeAway(&@field(V8API, decl.name));
    }

    std.mem.doNotOptimizeAway(&@import("../bun.js/node/buffer.zig").BufferVectorized.fill);
}

pub const NapiFinalizerTask = struct {
    finalizer: Finalizer,

    const AnyTask = JSC.AnyTask.New(@This(), runOnJSThread);

    pub fn init(finalizer: Finalizer) *NapiFinalizerTask {
        const finalizer_task = bun.default_allocator.create(NapiFinalizerTask) catch bun.outOfMemory();
        finalizer_task.* = .{
            .finalizer = finalizer,
        };
        return finalizer_task;
    }

    pub fn schedule(this: *NapiFinalizerTask) void {
        const globalThis = this.finalizer.env.?.toJS();

        const vm, const thread_kind = globalThis.tryBunVM();

        if (thread_kind != .main) {
            // TODO(@heimskr): do we need to handle the case where the vm is shutting down?
            vm.eventLoop().enqueueTaskConcurrent(JSC.ConcurrentTask.create(JSC.Task.init(this)));
            return;
        }

        if (vm.isShuttingDown()) {
            // Immediate tasks won't run, so we run this as a cleanup hook instead
            vm.rareData().pushCleanupHook(vm.global, this, runAsCleanupHook);
        } else {
            globalThis.bunVM().event_loop.enqueueTask(JSC.Task.init(this));
        }
    }

    pub fn deinit(this: *NapiFinalizerTask) void {
        bun.default_allocator.destroy(this);
    }

    pub fn runOnJSThread(this: *NapiFinalizerTask) void {
        this.finalizer.run();
        this.deinit();
    }

    fn runAsCleanupHook(opaque_this: ?*anyopaque) callconv(.c) void {
        const this: *NapiFinalizerTask = @alignCast(@ptrCast(opaque_this.?));
        this.runOnJSThread();
    }
};
