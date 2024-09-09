const std = @import("std");
const JSC = bun.JSC;
const strings = bun.strings;
const bun = @import("root").bun;
const Lock = @import("../lock.zig").Lock;
const JSValue = JSC.JSValue;
const ZigString = JSC.ZigString;
const TODO_EXCEPTION: JSC.C.ExceptionRef = null;

const Channel = @import("../sync.zig").Channel;

const log = bun.Output.scoped(.napi, false);

// These wrappers exist so we can set a breakpoint in lldb
fn invalidArg() napi_status {
    if (comptime bun.Environment.allow_assert) {
        log("invalid arg", .{});
    }
    return .invalid_arg;
}

fn genericFailure() napi_status {
    if (comptime bun.Environment.allow_assert) {
        log("generic failure", .{});
    }
    return .generic_failure;
}
const Async = bun.Async;

pub const napi_env = *JSC.JSGlobalObject;
pub const Ref = opaque {
    pub fn create(globalThis: *JSC.JSGlobalObject, value: JSValue) *Ref {
        JSC.markBinding(@src());
        var ref: *Ref = undefined;
        bun.assert(
            napi_create_reference(
                globalThis,
                value,
                1,
                &ref,
            ) == .ok,
        );
        if (comptime bun.Environment.isDebug) {
            bun.assert(ref.get() == value);
        }
        return ref;
    }

    pub fn get(ref: *Ref) JSValue {
        JSC.markBinding(@src());
        return napi_get_reference_value_internal(ref);
    }

    pub fn destroy(ref: *Ref) void {
        JSC.markBinding(@src());
        napi_delete_reference_internal(ref);
    }

    pub fn set(this: *Ref, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        napi_set_ref(this, value);
    }

    extern fn napi_delete_reference_internal(ref: *Ref) void;
    extern fn napi_set_ref(ref: *Ref, value: JSC.JSValue) void;
};
pub const NapiHandleScope = opaque {
    extern fn NapiHandleScope__push(globalObject: *JSC.JSGlobalObject, escapable: bool) *NapiHandleScope;
    extern fn NapiHandleScope__pop(globalObject: *JSC.JSGlobalObject, current: *NapiHandleScope) void;
    extern fn NapiHandleScope__append(globalObject: *JSC.JSGlobalObject, value: JSC.JSValueReprInt) void;
    extern fn NapiHandleScope__escape(handleScope: *NapiHandleScope, value: JSC.JSValueReprInt) bool;

    pub fn push(env: napi_env, escapable: bool) *NapiHandleScope {
        return NapiHandleScope__push(env, escapable);
    }

    pub fn pop(self: *NapiHandleScope, env: napi_env) void {
        NapiHandleScope__pop(env, self);
    }

    pub fn append(env: napi_env, value: JSC.JSValue) void {
        NapiHandleScope__append(env, @intFromEnum(value));
    }

    pub fn escape(self: *NapiHandleScope, value: JSC.JSValue) error{EscapeCalledTwice}!void {
        if (!NapiHandleScope__escape(self, @intFromEnum(value))) {
            return error.EscapeCalledTwice;
        }
    }
};

pub const napi_handle_scope = *NapiHandleScope;
pub const napi_escapable_handle_scope = *NapiHandleScope;
pub const napi_callback_info = *JSC.CallFrame;
pub const napi_deferred = *JSC.JSPromise.Strong;

/// To ensure napi_values are not collected prematurely after being returned into a native module,
/// you must use these functions rather than convert between napi_value and JSC.JSValue directly
pub const napi_value = enum(JSC.JSValueReprInt) {
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

pub const struct_napi_escapable_handle_scope__ = opaque {};

const char16_t = u16;
pub const napi_default: c_int = 0;
pub const napi_writable: c_int = 1;
pub const napi_enumerable: c_int = 2;
pub const napi_configurable: c_int = 4;
pub const napi_static: c_int = 1024;
pub const napi_default_method: c_int = 5;
pub const napi_default_jsproperty: c_int = 7;
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
pub const napi_status = enum(c_uint) {
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
pub const napi_key_include_prototypes: c_int = 0;
pub const napi_key_own_only: c_int = 1;
pub const napi_key_collection_mode = c_uint;
pub const napi_key_all_properties: c_int = 0;
pub const napi_key_writable: c_int = 1;
pub const napi_key_enumerable: c_int = 2;
pub const napi_key_configurable: c_int = 4;
pub const napi_key_skip_strings: c_int = 8;
pub const napi_key_skip_symbols: c_int = 16;
pub const napi_key_filter = c_uint;
pub const napi_key_keep_numbers: c_int = 0;
pub const napi_key_numbers_to_strings: c_int = 1;
pub const napi_key_conversion = c_uint;
pub const napi_type_tag = extern struct {
    lower: u64,
    upper: u64,
};
pub extern fn napi_get_last_error_info(env: napi_env, result: [*c][*c]const napi_extended_error_info) napi_status;
pub export fn napi_get_undefined(env: napi_env, result_: ?*napi_value) napi_status {
    log("napi_get_undefined", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    result.set(env, JSValue.jsUndefined());
    return .ok;
}
pub export fn napi_get_null(env: napi_env, result_: ?*napi_value) napi_status {
    log("napi_get_null", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    result.set(env, JSValue.jsNull());
    return .ok;
}
pub extern fn napi_get_global(env: napi_env, result: *napi_value) napi_status;
pub export fn napi_get_boolean(env: napi_env, value: bool, result_: ?*napi_value) napi_status {
    log("napi_get_boolean", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    result.set(env, JSValue.jsBoolean(value));
    return .ok;
}
pub export fn napi_create_array(env: napi_env, result_: ?*napi_value) napi_status {
    log("napi_create_array", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    result.set(env, JSValue.createEmptyArray(env, 0));
    return .ok;
}
const prefilled_undefined_args_array: [128]JSC.JSValue = brk: {
    var args: [128]JSC.JSValue = undefined;
    for (args, 0..) |_, i| {
        args[i] = JSValue.jsUndefined();
    }
    break :brk args;
};
pub export fn napi_create_array_with_length(env: napi_env, length: usize, result_: ?*napi_value) napi_status {
    log("napi_create_array_with_length", .{});
    const result = result_ orelse {
        return invalidArg();
    };

    const len = @as(u32, @intCast(length));

    const array = JSC.JSValue.createEmptyArray(env, len);
    array.ensureStillAlive();

    var i: u32 = 0;
    while (i < len) : (i += 1) {
        array.putIndex(env, i, JSValue.jsUndefined());
    }

    array.ensureStillAlive();
    result.set(env, array);
    return .ok;
}
pub extern fn napi_create_double(_: napi_env, value: f64, result: *napi_value) napi_status;
pub export fn napi_create_int32(env: napi_env, value: i32, result_: ?*napi_value) napi_status {
    log("napi_create_int32", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    result.set(env, JSValue.jsNumber(value));
    return .ok;
}
pub export fn napi_create_uint32(env: napi_env, value: u32, result_: ?*napi_value) napi_status {
    log("napi_create_uint32", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    result.set(env, JSValue.jsNumber(value));
    return .ok;
}
pub export fn napi_create_int64(env: napi_env, value: i64, result_: ?*napi_value) napi_status {
    log("napi_create_int64", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    result.set(env, JSValue.jsNumber(value));
    return .ok;
}
pub export fn napi_create_string_latin1(env: napi_env, str: ?[*]const u8, length: usize, result_: ?*napi_value) napi_status {
    const result: *napi_value = result_ orelse {
        return invalidArg();
    };

    const slice: []const u8 = brk: {
        if (NAPI_AUTO_LENGTH == length) {
            break :brk bun.sliceTo(@as([*:0]const u8, @ptrCast(str)), 0);
        } else if (length > std.math.maxInt(u32)) {
            return invalidArg();
        }

        if (str) |ptr|
            break :brk ptr[0..length];

        return invalidArg();
    };

    log("napi_create_string_latin1: {s}", .{slice});

    if (slice.len == 0) {
        result.set(env, bun.String.empty.toJS(env));
        return .ok;
    }

    var string, const bytes = bun.String.createUninitialized(.latin1, slice.len);
    defer string.deref();

    @memcpy(bytes, slice);

    result.set(env, string.toJS(env));
    return .ok;
}
pub export fn napi_create_string_utf8(env: napi_env, str: ?[*]const u8, length: usize, result_: ?*napi_value) napi_status {
    const result: *napi_value = result_ orelse {
        return invalidArg();
    };
    const slice: []const u8 = brk: {
        if (NAPI_AUTO_LENGTH == length) {
            break :brk bun.sliceTo(@as([*:0]const u8, @ptrCast(str)), 0);
        } else if (length > std.math.maxInt(u32)) {
            return invalidArg();
        }

        if (str) |ptr|
            break :brk ptr[0..length];

        return invalidArg();
    };

    log("napi_create_string_utf8: {s}", .{slice});

    var string = bun.String.createUTF8(slice);
    if (string.tag == .Dead) {
        return .generic_failure;
    }

    defer string.deref();
    result.set(env, string.toJS(env));
    return .ok;
}
pub export fn napi_create_string_utf16(env: napi_env, str: ?[*]const char16_t, length: usize, result_: ?*napi_value) napi_status {
    const result: *napi_value = result_ orelse {
        return invalidArg();
    };

    const slice: []const u16 = brk: {
        if (NAPI_AUTO_LENGTH == length) {
            break :brk bun.sliceTo(@as([*:0]const u16, @ptrCast(str)), 0);
        } else if (length > std.math.maxInt(u32)) {
            return invalidArg();
        }

        if (str) |ptr|
            break :brk ptr[0..length];

        return invalidArg();
    };

    if (comptime bun.Environment.allow_assert)
        log("napi_create_string_utf16: {d} {any}", .{ slice.len, bun.fmt.FormatUTF16{ .buf = slice[0..@min(slice.len, 512)] } });

    if (slice.len == 0) {
        result.set(env, bun.String.empty.toJS(env));
    }

    var string, const chars = bun.String.createUninitialized(.utf16, slice.len);
    defer string.deref();

    @memcpy(chars, slice);

    result.set(env, string.toJS(env));
    return .ok;
}
pub extern fn napi_create_symbol(env: napi_env, description: napi_value, result: *napi_value) napi_status;
pub extern fn napi_create_error(env: napi_env, code: napi_value, msg: napi_value, result: *napi_value) napi_status;
pub extern fn napi_create_type_error(env: napi_env, code: napi_value, msg: napi_value, result: *napi_value) napi_status;
pub extern fn napi_create_range_error(env: napi_env, code: napi_value, msg: napi_value, result: *napi_value) napi_status;
pub extern fn napi_typeof(env: napi_env, value: napi_value, result: *napi_valuetype) napi_status;
pub extern fn napi_get_value_double(env: napi_env, value: napi_value, result: *f64) napi_status;
pub export fn napi_get_value_int32(_: napi_env, value_: napi_value, result_: ?*i32) napi_status {
    log("napi_get_value_int32", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const value = value_.get();
    if (!value.isNumber()) {
        return .number_expected;
    }
    result.* = value.to(i32);
    return .ok;
}
pub export fn napi_get_value_uint32(_: napi_env, value_: napi_value, result_: ?*u32) napi_status {
    log("napi_get_value_uint32", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const value = value_.get();
    if (!value.isNumber()) {
        return .number_expected;
    }
    result.* = value.to(u32);
    return .ok;
}
pub export fn napi_get_value_int64(_: napi_env, value_: napi_value, result_: ?*i64) napi_status {
    log("napi_get_value_int64", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const value = value_.get();
    if (!value.isNumber()) {
        return .number_expected;
    }
    result.* = value.to(i64);
    return .ok;
}
pub export fn napi_get_value_bool(_: napi_env, value_: napi_value, result_: ?*bool) napi_status {
    log("napi_get_value_bool", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const value = value_.get();

    result.* = value.to(bool);
    return .ok;
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

    const str = value.toBunString(env);
    defer str.deref();

    var buf = buf_ptr orelse {
        if (result_ptr) |result| {
            result.* = str.latin1ByteLength();
        }

        return .ok;
    };

    if (str.isEmpty()) {
        if (result_ptr) |result| {
            result.* = 0;
        }
        buf[0] = 0;

        return .ok;
    }

    var buf_ = buf[0..bufsize];

    if (bufsize == NAPI_AUTO_LENGTH) {
        buf_ = bun.sliceTo(buf_ptr.?, 0);
        if (buf_.len == 0) {
            if (result_ptr) |result| {
                result.* = 0;
            }
            return .ok;
        }
    }
    const written = str.encodeInto(buf_, .latin1) catch unreachable;
    const max_buf_len = buf_.len;

    if (result_ptr) |result| {
        result.* = written;
    } else if (written < max_buf_len) {
        buf[written] = 0;
    }

    return .ok;
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
    const str = value.toBunString(env);
    defer str.deref();

    var buf = buf_ptr orelse {
        if (result_ptr) |result| {
            result.* = str.utf16ByteLength();
        }

        return .ok;
    };

    if (str.isEmpty()) {
        if (result_ptr) |result| {
            result.* = 0;
        }
        buf[0] = 0;

        return .ok;
    }

    var buf_ = buf[0..bufsize];

    if (bufsize == NAPI_AUTO_LENGTH) {
        buf_ = bun.sliceTo(@as([*:0]u16, @ptrCast(buf_ptr.?)), 0);
        if (buf_.len == 0) {
            if (result_ptr) |result| {
                result.* = 0;
            }
            return .ok;
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

    return .ok;
}
pub export fn napi_coerce_to_bool(env: napi_env, value_: napi_value, result_: ?*napi_value) napi_status {
    log("napi_coerce_to_bool", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const value = value_.get();
    result.set(env, JSValue.jsBoolean(value.coerce(bool, env)));
    return .ok;
}
pub export fn napi_coerce_to_number(env: napi_env, value_: napi_value, result_: ?*napi_value) napi_status {
    log("napi_coerce_to_number", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const value = value_.get();
    result.set(env, JSC.JSValue.jsNumber(JSC.C.JSValueToNumber(env.ref(), value.asObjectRef(), TODO_EXCEPTION)));
    return .ok;
}
pub export fn napi_coerce_to_object(env: napi_env, value_: napi_value, result_: ?*napi_value) napi_status {
    log("napi_coerce_to_object", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const value = value_.get();
    result.set(env, JSValue.c(JSC.C.JSValueToObject(env.ref(), value.asObjectRef(), TODO_EXCEPTION)));
    return .ok;
}
pub export fn napi_get_prototype(env: napi_env, object_: napi_value, result_: ?*napi_value) napi_status {
    log("napi_get_prototype", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const object = object_.get();
    if (!object.isObject()) {
        return .object_expected;
    }

    result.set(env, JSValue.c(JSC.C.JSObjectGetPrototype(env.ref(), object.asObjectRef())));
    return .ok;
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
        return .array_expected;
    }
    if (value.isEmpty())
        return invalidArg();
    JSC.C.JSObjectSetPropertyAtIndex(env.ref(), object.asObjectRef(), index, value.asObjectRef(), TODO_EXCEPTION);
    return .ok;
}
pub export fn napi_has_element(env: napi_env, object_: napi_value, index: c_uint, result_: ?*bool) napi_status {
    log("napi_has_element", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const object = object_.get();

    if (!object.jsType().isIndexable()) {
        return .array_expected;
    }

    result.* = object.getLength(env) > index;
    return .ok;
}
pub extern fn napi_get_element(env: napi_env, object: napi_value, index: u32, result: *napi_value) napi_status;
pub extern fn napi_delete_element(env: napi_env, object: napi_value, index: u32, result: *napi_value) napi_status;
pub extern fn napi_define_properties(env: napi_env, object: napi_value, property_count: usize, properties: [*c]const napi_property_descriptor) napi_status;
pub export fn napi_is_array(_: napi_env, value_: napi_value, result_: ?*bool) napi_status {
    log("napi_is_array", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const value = value_.get();
    result.* = value.jsType().isArray();
    return .ok;
}
pub export fn napi_get_array_length(env: napi_env, value_: napi_value, result_: [*c]u32) napi_status {
    log("napi_get_array_length", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const value = value_.get();

    if (!value.jsType().isArray()) {
        return .array_expected;
    }

    result.* = @as(u32, @truncate(value.getLength(env)));
    return .ok;
}
pub export fn napi_strict_equals(env: napi_env, lhs_: napi_value, rhs_: napi_value, result_: ?*bool) napi_status {
    log("napi_strict_equals", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const lhs, const rhs = .{ lhs_.get(), rhs_.get() };
    // there is some nuance with NaN here i'm not sure about
    result.* = lhs.isSameValue(rhs, env);
    return .ok;
}
pub extern fn napi_call_function(env: napi_env, recv: napi_value, func: napi_value, argc: usize, argv: [*c]const napi_value, result: *napi_value) napi_status;
pub extern fn napi_new_instance(env: napi_env, constructor: napi_value, argc: usize, argv: [*c]const napi_value, result_: ?*napi_value) napi_status;
pub export fn napi_instanceof(env: napi_env, object_: napi_value, constructor_: napi_value, result_: ?*bool) napi_status {
    log("napi_instanceof", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const object, const constructor = .{ object_.get(), constructor_.get() };
    // TODO: does this throw object_expected in node?
    result.* = object.isObject() and object.isInstanceOf(env, constructor);
    return .ok;
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
pub extern fn napi_wrap(env: napi_env, js_object: napi_value, native_object: ?*anyopaque, finalize_cb: napi_finalize, finalize_hint: ?*anyopaque, result: [*]*Ref) napi_status;
pub extern fn napi_unwrap(env: napi_env, js_object: napi_value, result: [*]*anyopaque) napi_status;
pub extern fn napi_remove_wrap(env: napi_env, js_object: napi_value, result: [*]*anyopaque) napi_status;
pub extern fn napi_create_object(env: napi_env, result: *napi_value) napi_status;
pub extern fn napi_create_external(env: napi_env, data: ?*anyopaque, finalize_cb: napi_finalize, finalize_hint: ?*anyopaque, result: *napi_value) napi_status;
pub extern fn napi_get_value_external(env: napi_env, value: napi_value, result: [*]*anyopaque) napi_status;
pub extern fn napi_create_reference(env: napi_env, value: napi_value, initial_refcount: u32, result: **Ref) napi_status;
pub extern fn napi_delete_reference(env: napi_env, ref: *Ref) napi_status;
pub extern fn napi_reference_ref(env: napi_env, ref: *Ref, result: [*c]u32) napi_status;
pub extern fn napi_reference_unref(env: napi_env, ref: *Ref, result: [*c]u32) napi_status;
pub extern fn napi_get_reference_value(env: napi_env, ref: *Ref, result: *napi_value) napi_status;
pub extern fn napi_get_reference_value_internal(ref: *Ref) JSC.JSValue;

pub export fn napi_open_handle_scope(env: napi_env, result_: ?*napi_handle_scope) napi_status {
    log("napi_open_handle_scope", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    result.* = NapiHandleScope.push(env, false);
    return .ok;
}

pub export fn napi_close_handle_scope(env: napi_env, handle_scope: napi_handle_scope) napi_status {
    log("napi_close_handle_scope", .{});
    handle_scope.pop(env);
    return .ok;
}

// we don't support async contexts
pub export fn napi_async_init(env: napi_env, _: napi_value, _: napi_value, async_ctx: **anyopaque) napi_status {
    log("napi_async_init", .{});
    async_ctx.* = env;
    return .ok;
}

// we don't support async contexts
pub export fn napi_async_destroy(_: napi_env, _: *anyopaque) napi_status {
    log("napi_async_destroy", .{});
    return .ok;
}

// this is just a regular function call
pub export fn napi_make_callback(env: napi_env, _: *anyopaque, recv_: napi_value, func_: napi_value, arg_count: usize, args: ?[*]const napi_value, maybe_result: ?*napi_value) napi_status {
    log("napi_make_callback", .{});
    const recv, const func = .{ recv_.get(), func_.get() };
    if (func.isEmptyOrUndefinedOrNull() or !func.isCallable(env.vm())) {
        return .function_expected;
    }

    const res = func.call(
        env,
        if (recv != .zero)
            recv
        else
            .undefined,
        if (arg_count > 0 and args != null)
            @as([*]const JSC.JSValue, @ptrCast(args.?))[0..arg_count]
        else
            &.{},
    );

    if (maybe_result) |result| {
        result.set(env, res);
    }

    // TODO: this is likely incorrect
    if (res.isAnyError()) {
        return .pending_exception;
    }

    return .ok;
}

// Sometimes shared libraries reference symbols which are not used
// We don't want to fail to load the library because of that
// so we instead return an error and warn the user
fn notImplementedYet(comptime name: []const u8) void {
    bun.once(
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
        return invalidArg();
    };
    result.* = NapiHandleScope.push(env, true);
    return .ok;
}
pub export fn napi_close_escapable_handle_scope(env: napi_env, scope: napi_escapable_handle_scope) napi_status {
    log("napi_close_escapable_handle_scope", .{});
    scope.pop(env);
    return .ok;
}
pub export fn napi_escape_handle(_: napi_env, scope: napi_escapable_handle_scope, escapee: napi_value, result_: ?*napi_value) napi_status {
    log("napi_escape_handle", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    scope.escape(escapee.get()) catch return .escape_called_twice;
    result.* = escapee;
    return .ok;
}
pub export fn napi_type_tag_object(_: napi_env, _: napi_value, _: [*c]const napi_type_tag) napi_status {
    log("napi_type_tag_object", .{});
    notImplementedYet("napi_type_tag_object");
    return genericFailure();
}
pub export fn napi_check_object_type_tag(_: napi_env, _: napi_value, _: [*c]const napi_type_tag, _: *bool) napi_status {
    log("napi_check_object_type_tag", .{});
    notImplementedYet("napi_check_object_type_tag");
    return genericFailure();
}

// do nothing for both of these
pub export fn napi_open_callback_scope(_: napi_env, _: napi_value, _: *anyopaque, _: *anyopaque) napi_status {
    log("napi_open_callback_scope", .{});
    return .ok;
}
pub export fn napi_close_callback_scope(_: napi_env, _: *anyopaque) napi_status {
    log("napi_close_callback_scope", .{});
    return .ok;
}
pub extern fn napi_throw(env: napi_env, @"error": napi_value) napi_status;
pub extern fn napi_throw_error(env: napi_env, code: [*c]const u8, msg: [*c]const u8) napi_status;
pub extern fn napi_throw_type_error(env: napi_env, code: [*c]const u8, msg: [*c]const u8) napi_status;
pub extern fn napi_throw_range_error(env: napi_env, code: [*c]const u8, msg: [*c]const u8) napi_status;
pub export fn napi_is_error(_: napi_env, value_: napi_value, result: *bool) napi_status {
    log("napi_is_error", .{});
    const value = value_.get();
    result.* = value.isAnyError();
    return .ok;
}
pub extern fn napi_is_exception_pending(env: napi_env, result: *bool) napi_status;
pub extern fn napi_get_and_clear_last_exception(env: napi_env, result: *napi_value) napi_status;
pub export fn napi_is_arraybuffer(_: napi_env, value_: napi_value, result_: ?*bool) napi_status {
    log("napi_is_arraybuffer", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const value = value_.get();
    result.* = !value.isNumber() and value.jsTypeLoose() == .ArrayBuffer;
    return .ok;
}
pub extern fn napi_create_arraybuffer(env: napi_env, byte_length: usize, data: [*]const u8, result: *napi_value) napi_status;

pub extern fn napi_create_external_arraybuffer(env: napi_env, external_data: ?*anyopaque, byte_length: usize, finalize_cb: napi_finalize, finalize_hint: ?*anyopaque, result: *napi_value) napi_status;

pub export fn napi_get_arraybuffer_info(env: napi_env, arraybuffer_: napi_value, data: ?*[*]u8, byte_length: ?*usize) napi_status {
    log("napi_get_arraybuffer_info", .{});
    const arraybuffer = arraybuffer_.get();
    const array_buffer = arraybuffer.asArrayBuffer(env) orelse return .arraybuffer_expected;
    const slice = array_buffer.slice();
    if (data) |dat|
        dat.* = slice.ptr;
    if (byte_length) |len|
        len.* = slice.len;
    return .ok;
}
pub export fn napi_is_typedarray(_: napi_env, value_: napi_value, result: ?*bool) napi_status {
    log("napi_is_typedarray", .{});
    const value = value_.get();
    if (result != null)
        result.?.* = value.jsTypeLoose().isTypedArray();
    return if (result != null) .ok else invalidArg();
}
pub export fn napi_create_typedarray(env: napi_env, @"type": napi_typedarray_type, length: usize, arraybuffer_: napi_value, byte_offset: usize, result_: ?*napi_value) napi_status {
    log("napi_create_typedarray", .{});
    const arraybuffer = arraybuffer_.get();
    const result = result_ orelse {
        return invalidArg();
    };
    result.set(env, JSValue.c(
        JSC.C.JSObjectMakeTypedArrayWithArrayBufferAndOffset(
            env.ref(),
            @"type".toC(),
            arraybuffer.asObjectRef(),
            byte_offset,
            length,
            TODO_EXCEPTION,
        ),
    ));
    return .ok;
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
        return invalidArg();
    defer typedarray.ensureStillAlive();

    const array_buffer = typedarray.asArrayBuffer(env) orelse return invalidArg();
    if (maybe_type) |@"type"|
        @"type".* = napi_typedarray_type.fromJSType(array_buffer.typed_array_type) orelse return invalidArg();

    // TODO: handle detached
    if (maybe_data) |data|
        data.* = array_buffer.ptr;

    if (maybe_length) |length|
        length.* = array_buffer.len;

    if (maybe_arraybuffer) |arraybuffer|
        arraybuffer.set(env, JSValue.c(JSC.C.JSObjectGetTypedArrayBuffer(env.ref(), typedarray.asObjectRef(), null)));

    if (maybe_byte_offset) |byte_offset|
        byte_offset.* = array_buffer.offset;
    return .ok;
}
pub extern fn napi_create_dataview(env: napi_env, length: usize, arraybuffer: napi_value, byte_offset: usize, result: *napi_value) napi_status;
pub export fn napi_is_dataview(_: napi_env, value_: napi_value, result_: ?*bool) napi_status {
    log("napi_is_dataview", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const value = value_.get();
    result.* = !value.isEmptyOrUndefinedOrNull() and value.jsTypeLoose() == .DataView;
    return .ok;
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
    const array_buffer = dataview.asArrayBuffer(env) orelse return .object_expected;
    if (maybe_bytelength) |bytelength|
        bytelength.* = array_buffer.byte_len;

    if (maybe_data) |data|
        data.* = array_buffer.ptr;

    if (maybe_arraybuffer) |arraybuffer|
        arraybuffer.set(env, JSValue.c(JSC.C.JSObjectGetTypedArrayBuffer(env.ref(), dataview.asObjectRef(), null)));

    if (maybe_byte_offset) |byte_offset|
        byte_offset.* = array_buffer.offset;

    return .ok;
}
pub export fn napi_get_version(_: napi_env, result_: ?*u32) napi_status {
    log("napi_get_version", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    result.* = NAPI_VERSION;
    return .ok;
}
pub export fn napi_create_promise(env: napi_env, deferred_: ?*napi_deferred, promise_: ?*napi_value) napi_status {
    log("napi_create_promise", .{});
    const deferred = deferred_ orelse {
        return invalidArg();
    };
    const promise = promise_ orelse {
        return invalidArg();
    };
    deferred.* = bun.default_allocator.create(JSC.JSPromise.Strong) catch @panic("failed to allocate napi_deferred");
    deferred.*.* = JSC.JSPromise.Strong.init(env);
    promise.set(env, deferred.*.get().asValue(env));
    return .ok;
}
pub export fn napi_resolve_deferred(env: napi_env, deferred: napi_deferred, resolution_: napi_value) napi_status {
    log("napi_resolve_deferred", .{});
    const resolution = resolution_.get();
    var prom = deferred.get();
    prom.resolve(env, resolution);
    deferred.deinit();
    bun.default_allocator.destroy(deferred);
    return .ok;
}
pub export fn napi_reject_deferred(env: napi_env, deferred: napi_deferred, rejection_: napi_value) napi_status {
    log("napi_reject_deferred", .{});
    const rejection = rejection_.get();
    var prom = deferred.get();
    prom.reject(env, rejection);
    deferred.deinit();
    bun.default_allocator.destroy(deferred);
    return .ok;
}
pub export fn napi_is_promise(_: napi_env, value_: napi_value, is_promise_: ?*bool) napi_status {
    log("napi_is_promise", .{});
    const value = value_.get();
    const is_promise = is_promise_ orelse {
        return invalidArg();
    };

    if (value.isEmpty()) {
        return invalidArg();
    }

    is_promise.* = value.asAnyPromise() != null;
    return .ok;
}
pub extern fn napi_run_script(env: napi_env, script: napi_value, result: *napi_value) napi_status;
pub extern fn napi_adjust_external_memory(env: napi_env, change_in_bytes: i64, adjusted_value: [*c]i64) napi_status;
pub export fn napi_create_date(env: napi_env, time: f64, result_: ?*napi_value) napi_status {
    log("napi_create_date", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    var args = [_]JSC.C.JSValueRef{JSC.JSValue.jsNumber(time).asObjectRef()};
    result.set(env, JSValue.c(JSC.C.JSObjectMakeDate(env.ref(), 1, &args, TODO_EXCEPTION)));
    return .ok;
}
pub export fn napi_is_date(_: napi_env, value_: napi_value, is_date_: ?*bool) napi_status {
    log("napi_is_date", .{});
    const is_date = is_date_ orelse {
        return invalidArg();
    };
    const value = value_.get();
    is_date.* = value.jsTypeLoose() == .JSDate;
    return .ok;
}
pub extern fn napi_get_date_value(env: napi_env, value: napi_value, result: *f64) napi_status;
pub extern fn napi_add_finalizer(env: napi_env, js_object: napi_value, native_object: ?*anyopaque, finalize_cb: napi_finalize, finalize_hint: ?*anyopaque, result: *Ref) napi_status;
pub export fn napi_create_bigint_int64(env: napi_env, value: i64, result_: ?*napi_value) napi_status {
    log("napi_create_bigint_int64", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    result.set(env, JSC.JSValue.fromInt64NoTruncate(env, value));
    return .ok;
}
pub export fn napi_create_bigint_uint64(env: napi_env, value: u64, result_: ?*napi_value) napi_status {
    log("napi_create_bigint_uint64", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    result.set(env, JSC.JSValue.fromUInt64NoTruncate(env, value));
    return .ok;
}
pub extern fn napi_create_bigint_words(env: napi_env, sign_bit: c_int, word_count: usize, words: [*c]const u64, result: *napi_value) napi_status;
// TODO: lossless
pub export fn napi_get_value_bigint_int64(_: napi_env, value_: napi_value, result_: ?*i64, _: *bool) napi_status {
    log("napi_get_value_bigint_int64", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const value = value_.get();
    result.* = value.toInt64();
    return .ok;
}
// TODO: lossless
pub export fn napi_get_value_bigint_uint64(_: napi_env, value_: napi_value, result_: ?*u64, _: *bool) napi_status {
    log("napi_get_value_bigint_uint64", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const value = value_.get();
    result.* = value.toUInt64NoTruncate();
    return .ok;
}

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
    global: napi_env,
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

    pub fn create(global: napi_env, execute: napi_async_execute_callback, complete: napi_async_complete_callback, ctx: ?*anyopaque) !*napi_async_work {
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
        this.execute.?(this.global, this.ctx);
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

    pub fn runFromJS(this: *napi_async_work) void {
        const handle_scope = NapiHandleScope.push(this.global, false);
        defer handle_scope.pop(this.global);
        this.complete.?(
            this.global,
            if (this.status.load(.seq_cst) == @intFromEnum(Status.cancelled))
                napi_status.cancelled
            else
                napi_status.ok,
            this.ctx.?,
        );
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
    var buffer = JSC.JSValue.createBufferFromLength(env, length);
    if (length > 0) {
        if (data) |ptr| {
            ptr.* = buffer.asArrayBuffer(env).?.ptr;
        }
    }
    result.set(env, buffer);
    return .ok;
}
pub extern fn napi_create_external_buffer(env: napi_env, length: usize, data: ?*anyopaque, finalize_cb: napi_finalize, finalize_hint: ?*anyopaque, result: *napi_value) napi_status;
pub export fn napi_create_buffer_copy(env: napi_env, length: usize, data: [*]u8, result_data: ?*?*anyopaque, result_: ?*napi_value) napi_status {
    log("napi_create_buffer_copy: {d}", .{length});
    const result = result_ orelse {
        return invalidArg();
    };
    var buffer = JSC.JSValue.createBufferFromLength(env, length);
    if (buffer.asArrayBuffer(env)) |array_buf| {
        if (length > 0) {
            @memcpy(array_buf.slice()[0..length], data[0..length]);
        }
        if (result_data) |ptr| {
            ptr.* = if (length > 0) array_buf.ptr else null;
        }
    }

    result.set(env, buffer);

    return .ok;
}
pub export fn napi_is_buffer(env: napi_env, value_: napi_value, result_: ?*bool) napi_status {
    log("napi_is_buffer", .{});
    const result = result_ orelse {
        return invalidArg();
    };
    const value = value_.get();
    result.* = value.isBuffer(env);
    return .ok;
}
pub export fn napi_get_buffer_info(env: napi_env, value_: napi_value, data: ?*[*]u8, length: ?*usize) napi_status {
    log("napi_get_buffer_info", .{});
    const value = value_.get();
    const array_buf = value.asArrayBuffer(env) orelse {
        // TODO: is invalid_arg what to return here?
        return .arraybuffer_expected;
    };

    if (data) |dat|
        dat.* = array_buf.ptr;

    if (length) |len|
        len.* = array_buf.byte_len;

    return .ok;
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
        return invalidArg();
    };
    result.* = napi_async_work.create(env, execute, complete, data) catch {
        return genericFailure();
    };
    return .ok;
}
pub export fn napi_delete_async_work(env: napi_env, work_: ?*napi_async_work) napi_status {
    log("napi_delete_async_work", .{});
    const work = work_ orelse {
        return invalidArg();
    };
    bun.assert(env == work.global);
    work.deinit();
    return .ok;
}
pub export fn napi_queue_async_work(env: napi_env, work_: ?*napi_async_work) napi_status {
    log("napi_queue_async_work", .{});
    const work = work_ orelse {
        return invalidArg();
    };
    bun.assert(env == work.global);
    work.schedule();
    return .ok;
}
pub export fn napi_cancel_async_work(env: napi_env, work_: ?*napi_async_work) napi_status {
    log("napi_cancel_async_work", .{});
    const work = work_ orelse {
        return invalidArg();
    };
    bun.assert(env == work.global);
    if (work.cancel()) {
        return .ok;
    }

    return napi_status.generic_failure;
}
pub export fn napi_get_node_version(_: napi_env, version_: ?**const napi_node_version) napi_status {
    log("napi_get_node_version", .{});
    const version = version_ orelse {
        return invalidArg();
    };
    version.* = &napi_node_version.global;
    return .ok;
}
const napi_event_loop = if (bun.Environment.isWindows) *bun.windows.libuv.Loop else *JSC.EventLoop;
pub export fn napi_get_uv_event_loop(env: napi_env, loop_: ?*napi_event_loop) napi_status {
    log("napi_get_uv_event_loop", .{});
    const loop = loop_ orelse {
        return invalidArg();
    };
    if (bun.Environment.isWindows) {
        // alignment error is incorrect.
        @setRuntimeSafety(false);
        loop.* = JSC.VirtualMachine.get().uvLoop();
    } else {
        // there is no uv event loop on posix, we use our event loop handle.
        loop.* = env.bunVM().eventLoop();
    }
    return .ok;
}
pub extern fn napi_fatal_exception(env: napi_env, err: napi_value) napi_status;

// We use a linked list here because we assume removing these is relatively rare
// and array reallocations are relatively expensive.
pub export fn napi_add_env_cleanup_hook(env: napi_env, fun: ?*const fn (?*anyopaque) callconv(.C) void, arg: ?*anyopaque) napi_status {
    log("napi_add_env_cleanup_hook", .{});
    if (fun == null)
        return .ok;

    env.bunVM().rareData().pushCleanupHook(env, arg, fun.?);
    return .ok;
}
pub export fn napi_remove_env_cleanup_hook(env: napi_env, fun: ?*const fn (?*anyopaque) callconv(.C) void, arg: ?*anyopaque) napi_status {
    log("napi_remove_env_cleanup_hook", .{});

    // Avoid looking up env.bunVM().
    if (bun.Global.isExiting()) {
        return .ok;
    }

    const vm = JSC.VirtualMachine.get();

    if (vm.rare_data == null or fun == null or vm.isShuttingDown())
        return .ok;

    var rare_data = vm.rare_data.?;
    const cmp = JSC.RareData.CleanupHook.init(env, arg, fun.?);
    for (rare_data.cleanup_hooks.items, 0..) |*hook, i| {
        if (hook.eql(cmp)) {
            _ = rare_data.cleanup_hooks.orderedRemove(i);
            break;
        }
    }

    return .ok;
}

pub const Finalizer = struct {
    fun: napi_finalize,
    data: ?*anyopaque = null,
};

// TODO: generate comptime version of this instead of runtime checking
pub const ThreadSafeFunction = struct {
    pub const Callback = union(enum) {
        js: JSValue,
        c: struct {
            js: JSValue,
            napi_threadsafe_function_call_js: napi_threadsafe_function_call_js,
        },
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

    thread_count: usize = 0,
    owning_thread_lock: Lock = .{},
    event_loop: *JSC.EventLoop,
    tracker: JSC.AsyncTaskTracker,

    env: napi_env,

    finalizer: Finalizer = Finalizer{ .fun = null, .data = null },
    channel: Queue,

    ctx: ?*anyopaque = null,

    callback: Callback = undefined,

    const ThreadSafeFunctionTask = JSC.AnyTask.New(@This(), call);
    pub const Queue = union(enum) {
        sized: Channel(?*anyopaque, .Slice),
        unsized: Channel(?*anyopaque, .Dynamic),

        pub fn isClosed(this: *const @This()) bool {
            return @atomicLoad(
                bool,
                switch (this.*) {
                    .sized => &this.sized.is_closed,
                    .unsized => &this.unsized.is_closed,
                },
                .seq_cst,
            );
        }

        pub fn close(this: *@This()) void {
            switch (this.*) {
                .sized => this.sized.close(),
                .unsized => this.unsized.close(),
            }
        }

        pub fn init(size: usize, allocator: std.mem.Allocator) @This() {
            switch (size) {
                0 => {
                    return .{
                        .unsized = Channel(?*anyopaque, .Dynamic).init(allocator),
                    };
                },
                else => {
                    const slice = allocator.alloc(?*anyopaque, size) catch unreachable;
                    return .{
                        .sized = Channel(?*anyopaque, .Slice).init(slice),
                    };
                },
            }
        }

        pub fn writeItem(this: *@This(), value: ?*anyopaque) !void {
            switch (this.*) {
                .sized => try this.sized.writeItem(value),
                .unsized => try this.unsized.writeItem(value),
            }
        }

        pub fn readItem(this: *@This()) !?*anyopaque {
            return switch (this.*) {
                .sized => try this.sized.readItem(),
                .unsized => try this.unsized.readItem(),
            };
        }

        pub fn tryWriteItem(this: *@This(), value: ?*anyopaque) !bool {
            return switch (this.*) {
                .sized => try this.sized.tryWriteItem(value),
                .unsized => try this.unsized.tryWriteItem(value),
            };
        }

        pub fn tryReadItem(this: *@This()) !??*anyopaque {
            return switch (this.*) {
                .sized => try this.sized.tryReadItem(),
                .unsized => try this.unsized.tryReadItem(),
            };
        }
    };

    pub fn call(this: *ThreadSafeFunction) void {
        const task = this.channel.tryReadItem() catch null orelse return;
        const vm = this.event_loop.virtual_machine;
        const globalObject = this.env;

        this.tracker.willDispatch(globalObject);
        defer this.tracker.didDispatch(globalObject);

        switch (this.callback) {
            .js => |js_function| {
                if (js_function.isEmptyOrUndefinedOrNull()) {
                    return;
                }
                const err = js_function.call(globalObject, .undefined, &.{});
                if (err.isAnyError()) {
                    _ = vm.uncaughtException(globalObject, err, false);
                }
            },
            .c => |cb| {
                if (comptime bun.Environment.isDebug) {
                    const str = cb.js.toBunString(globalObject);
                    defer str.deref();
                    log("call() {}", .{str});
                }

                const handle_scope = NapiHandleScope.push(globalObject, false);
                defer handle_scope.pop(globalObject);
                cb.napi_threadsafe_function_call_js(globalObject, napi_value.create(globalObject, cb.js), this.ctx, task);
            },
        }
    }

    pub fn enqueue(this: *ThreadSafeFunction, ctx: ?*anyopaque, block: bool) !void {
        if (block) {
            try this.channel.writeItem(ctx);
        } else {
            if (!try this.channel.tryWriteItem(ctx)) {
                return error.WouldBlock;
            }
        }

        this.event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.createFrom(this));
    }

    pub fn finalize(opaq: *anyopaque) void {
        var this = bun.cast(*ThreadSafeFunction, opaq);
        this.unref();

        if (this.finalizer.fun) |fun| {
            fun(this.event_loop.global, this.finalizer.data, this.ctx);
        }

        if (this.callback == .js) {
            if (!this.callback.js.isEmptyOrUndefinedOrNull()) {
                this.callback.js.unprotect();
            }
        } else if (this.callback == .c) {
            if (!this.callback.c.js.isEmptyOrUndefinedOrNull()) {
                this.callback.c.js.unprotect();
            }
        }
        bun.default_allocator.destroy(this);
    }

    pub fn ref(this: *ThreadSafeFunction) void {
        this.poll_ref.refConcurrentlyFromEventLoop(this.event_loop);
    }

    pub fn unref(this: *ThreadSafeFunction) void {
        this.poll_ref.unrefConcurrentlyFromEventLoop(this.event_loop);
    }

    pub fn acquire(this: *ThreadSafeFunction) !void {
        this.owning_thread_lock.lock();
        defer this.owning_thread_lock.unlock();
        if (this.channel.isClosed())
            return error.Closed;
        this.thread_count += 1;
    }

    pub fn release(this: *ThreadSafeFunction, mode: napi_threadsafe_function_release_mode) napi_status {
        this.owning_thread_lock.lock();
        defer this.owning_thread_lock.unlock();

        if (this.thread_count == 0) {
            return invalidArg();
        }

        this.thread_count -= 1;

        if (this.channel.isClosed()) {
            return .ok;
        }

        if (mode == .abort) {
            this.channel.close();
        }

        if (mode == .abort or this.thread_count == 0) {
            this.event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(this, finalize));
        }

        return .ok;
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
        return invalidArg();
    };
    const func = func_.get();

    if (call_js_cb == null and (func.isEmptyOrUndefinedOrNull() or !func.isCallable(env.vm()))) {
        return napi_status.function_expected;
    }

    if (!func.isEmptyOrUndefinedOrNull()) {
        func.protect();
    }

    const vm = env.bunVM();
    var function = bun.default_allocator.create(ThreadSafeFunction) catch return genericFailure();
    function.* = .{
        .event_loop = vm.eventLoop(),
        .env = env,
        .callback = if (call_js_cb) |c| .{
            .c = .{
                .napi_threadsafe_function_call_js = c,
                .js = if (func == .zero) .undefined else func.withAsyncContextIfNeeded(env),
            },
        } else .{
            .js = if (func == .zero) .undefined else func.withAsyncContextIfNeeded(env),
        },
        .ctx = context,
        .channel = ThreadSafeFunction.Queue.init(max_queue_size, bun.default_allocator),
        .thread_count = initial_thread_count,
        .poll_ref = Async.KeepAlive.init(),
        .tracker = JSC.AsyncTaskTracker.init(vm),
    };

    function.finalizer = .{ .data = thread_finalize_data, .fun = thread_finalize_cb };
    // nodejs by default keeps the event loop alive until the thread-safe function is unref'd
    function.ref();
    function.tracker.didSchedule(vm.global);

    result.* = function;
    return .ok;
}
pub export fn napi_get_threadsafe_function_context(func: napi_threadsafe_function, result: *?*anyopaque) napi_status {
    log("napi_get_threadsafe_function_context", .{});
    result.* = func.ctx;
    return .ok;
}
pub export fn napi_call_threadsafe_function(func: napi_threadsafe_function, data: ?*anyopaque, is_blocking: napi_threadsafe_function_call_mode) napi_status {
    log("napi_call_threadsafe_function", .{});
    func.enqueue(data, is_blocking == napi_tsfn_blocking) catch |err| {
        switch (err) {
            error.WouldBlock => {
                return napi_status.queue_full;
            },

            else => return .closing,
        }
    };
    return .ok;
}
pub export fn napi_acquire_threadsafe_function(func: napi_threadsafe_function) napi_status {
    log("napi_acquire_threadsafe_function", .{});
    func.acquire() catch return .closing;
    return .ok;
}
pub export fn napi_release_threadsafe_function(func: napi_threadsafe_function, mode: napi_threadsafe_function_release_mode) napi_status {
    log("napi_release_threadsafe_function", .{});
    return func.release(mode);
}
pub export fn napi_unref_threadsafe_function(env: napi_env, func: napi_threadsafe_function) napi_status {
    log("napi_unref_threadsafe_function", .{});
    bun.assert(func.event_loop.global == env);
    func.unref();
    return .ok;
}
pub export fn napi_ref_threadsafe_function(env: napi_env, func: napi_threadsafe_function) napi_status {
    log("napi_ref_threadsafe_function", .{});
    bun.assert(func.event_loop.global == env);
    func.ref();
    return .ok;
}

pub export fn napi_add_async_cleanup_hook(_: napi_env, _: napi_async_cleanup_hook, _: ?*anyopaque, _: [*c]napi_async_cleanup_hook_handle) napi_status {
    log("napi_add_async_cleanup_hook", .{});
    // TODO:
    return .ok;
}
pub export fn napi_remove_async_cleanup_hook(_: napi_async_cleanup_hook_handle) napi_status {
    log("napi_remove_async_cleanup_hook", .{});
    // TODO:
    return .ok;
}

pub const NAPI_VERSION_EXPERIMENTAL = @import("std").zig.c_translation.promoteIntLiteral(c_int, 2147483647, .decimal);
pub const NAPI_VERSION = @as(c_int, 8);
pub const NAPI_AUTO_LENGTH = std.math.maxInt(usize);
pub const SRC_NODE_API_TYPES_H_ = "";
pub const NAPI_MODULE_VERSION = @as(c_int, 1);

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
};

pub fn fixDeadCodeElimination() void {
    JSC.markBinding(@src());

    inline for (comptime std.meta.declarations(@This())) |decl| {
        if (std.mem.startsWith(u8, decl.name, "node_api_") or std.mem.startsWith(u8, decl.name, "napi_")) {
            std.mem.doNotOptimizeAway(&@field(@This(), decl.name));
        }
    }

    inline for (comptime std.meta.declarations(V8API)) |decl| {
        std.mem.doNotOptimizeAway(&@field(V8API, decl.name));
    }

    std.mem.doNotOptimizeAway(&@import("../bun.js/node/buffer.zig").BufferVectorized.fill);
}
