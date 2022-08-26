const JSC = @import("javascript_core");
const Classes = @import("./generated_classes_list.zig").Classes;
const Environment = @import("../../env.zig");
const std = @import("std");

pub const StaticGetterType = fn (*JSC.JSGlobalObject, JSC.JSValue, JSC.JSValue) callconv(.C) JSC.JSValue;
pub const StaticSetterType = fn (*JSC.JSGlobalObject, JSC.JSValue, JSC.JSValue, JSC.JSValue) callconv(.C) bool;
pub const StaticCallbackType = fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

pub const JSSHA1 = struct {
    const SHA1 = Classes.SHA1;
    const GetterType = fn (*SHA1, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*SHA1, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*SHA1, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*SHA1 {
        JSC.markBinding();
        return SHA1__fromJS(value);
    }

    /// Get the SHA1 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        return SHA1__getConstructor(globalObject);
    }

    /// Create a new instance of SHA1
    pub fn toJS(this: *SHA1, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        if (comptime Environment.allow_assert) {
            const value__ = SHA1__create(globalObject, this);
            std.debug.assert(value__.as(SHA1).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return SHA1__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of SHA1.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*SHA1) bool {
        JSC.markBinding();
        return SHA1__dangerouslySetPtr(value, ptr);
    }

    extern fn SHA1__fromJS(JSC.JSValue) ?*SHA1;
    extern fn SHA1__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn SHA1__create(globalObject: *JSC.JSGlobalObject, ptr: ?*SHA1) JSC.JSValue;

    extern fn SHA1__dangerouslySetPtr(JSC.JSValue, ?*SHA1) bool;

    comptime {
        if (@TypeOf(SHA1.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*SHA1)) {
            @compileLog("SHA1.constructor is not a constructor");
        }

        if (@TypeOf(SHA1.finalize) != (fn (*SHA1) callconv(.C) void)) {
            @compileLog("SHA1.finalize is not a finalizer");
        }

        if (@TypeOf(SHA1.getByteLength) != GetterType)
            @compileLog("Expected SHA1.getByteLength to be a getter");

        if (@TypeOf(SHA1.digest) != CallbackType)
            @compileLog("Expected SHA1.digest to be a callback");
        if (@TypeOf(SHA1.update) != CallbackType)
            @compileLog("Expected SHA1.update to be a callback");
        if (@TypeOf(SHA1.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected SHA1.getByteLengthStatic to be a static getter");

        if (@TypeOf(SHA1.hash) != StaticCallbackType)
            @compileLog("Expected SHA1.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(SHA1.constructor, .{ .name = "SHA1Class__construct" });
            @export(SHA1.digest, .{ .name = "SHA1Prototype__digest" });
            @export(SHA1.finalize, .{ .name = "SHA1Class__finalize" });
            @export(SHA1.getByteLength, .{ .name = "SHA1Prototype__getByteLength" });
            @export(SHA1.getByteLengthStatic, .{ .name = "SHA1Class__getByteLengthStatic" });
            @export(SHA1.hash, .{ .name = "SHA1Class__hash" });
            @export(SHA1.update, .{ .name = "SHA1Prototype__update" });
        }
    }
};
pub const JSMD5 = struct {
    const MD5 = Classes.MD5;
    const GetterType = fn (*MD5, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*MD5, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*MD5, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*MD5 {
        JSC.markBinding();
        return MD5__fromJS(value);
    }

    /// Get the MD5 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        return MD5__getConstructor(globalObject);
    }

    /// Create a new instance of MD5
    pub fn toJS(this: *MD5, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        if (comptime Environment.allow_assert) {
            const value__ = MD5__create(globalObject, this);
            std.debug.assert(value__.as(MD5).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return MD5__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of MD5.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*MD5) bool {
        JSC.markBinding();
        return MD5__dangerouslySetPtr(value, ptr);
    }

    extern fn MD5__fromJS(JSC.JSValue) ?*MD5;
    extern fn MD5__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn MD5__create(globalObject: *JSC.JSGlobalObject, ptr: ?*MD5) JSC.JSValue;

    extern fn MD5__dangerouslySetPtr(JSC.JSValue, ?*MD5) bool;

    comptime {
        if (@TypeOf(MD5.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*MD5)) {
            @compileLog("MD5.constructor is not a constructor");
        }

        if (@TypeOf(MD5.finalize) != (fn (*MD5) callconv(.C) void)) {
            @compileLog("MD5.finalize is not a finalizer");
        }

        if (@TypeOf(MD5.getByteLength) != GetterType)
            @compileLog("Expected MD5.getByteLength to be a getter");

        if (@TypeOf(MD5.digest) != CallbackType)
            @compileLog("Expected MD5.digest to be a callback");
        if (@TypeOf(MD5.update) != CallbackType)
            @compileLog("Expected MD5.update to be a callback");
        if (@TypeOf(MD5.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected MD5.getByteLengthStatic to be a static getter");

        if (@TypeOf(MD5.hash) != StaticCallbackType)
            @compileLog("Expected MD5.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(MD5.constructor, .{ .name = "MD5Class__construct" });
            @export(MD5.digest, .{ .name = "MD5Prototype__digest" });
            @export(MD5.finalize, .{ .name = "MD5Class__finalize" });
            @export(MD5.getByteLength, .{ .name = "MD5Prototype__getByteLength" });
            @export(MD5.getByteLengthStatic, .{ .name = "MD5Class__getByteLengthStatic" });
            @export(MD5.hash, .{ .name = "MD5Class__hash" });
            @export(MD5.update, .{ .name = "MD5Prototype__update" });
        }
    }
};
pub const JSMD4 = struct {
    const MD4 = Classes.MD4;
    const GetterType = fn (*MD4, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*MD4, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*MD4, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*MD4 {
        JSC.markBinding();
        return MD4__fromJS(value);
    }

    /// Get the MD4 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        return MD4__getConstructor(globalObject);
    }

    /// Create a new instance of MD4
    pub fn toJS(this: *MD4, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        if (comptime Environment.allow_assert) {
            const value__ = MD4__create(globalObject, this);
            std.debug.assert(value__.as(MD4).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return MD4__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of MD4.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*MD4) bool {
        JSC.markBinding();
        return MD4__dangerouslySetPtr(value, ptr);
    }

    extern fn MD4__fromJS(JSC.JSValue) ?*MD4;
    extern fn MD4__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn MD4__create(globalObject: *JSC.JSGlobalObject, ptr: ?*MD4) JSC.JSValue;

    extern fn MD4__dangerouslySetPtr(JSC.JSValue, ?*MD4) bool;

    comptime {
        if (@TypeOf(MD4.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*MD4)) {
            @compileLog("MD4.constructor is not a constructor");
        }

        if (@TypeOf(MD4.finalize) != (fn (*MD4) callconv(.C) void)) {
            @compileLog("MD4.finalize is not a finalizer");
        }

        if (@TypeOf(MD4.getByteLength) != GetterType)
            @compileLog("Expected MD4.getByteLength to be a getter");

        if (@TypeOf(MD4.digest) != CallbackType)
            @compileLog("Expected MD4.digest to be a callback");
        if (@TypeOf(MD4.update) != CallbackType)
            @compileLog("Expected MD4.update to be a callback");
        if (@TypeOf(MD4.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected MD4.getByteLengthStatic to be a static getter");

        if (@TypeOf(MD4.hash) != StaticCallbackType)
            @compileLog("Expected MD4.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(MD4.constructor, .{ .name = "MD4Class__construct" });
            @export(MD4.digest, .{ .name = "MD4Prototype__digest" });
            @export(MD4.finalize, .{ .name = "MD4Class__finalize" });
            @export(MD4.getByteLength, .{ .name = "MD4Prototype__getByteLength" });
            @export(MD4.getByteLengthStatic, .{ .name = "MD4Class__getByteLengthStatic" });
            @export(MD4.hash, .{ .name = "MD4Class__hash" });
            @export(MD4.update, .{ .name = "MD4Prototype__update" });
        }
    }
};
pub const JSSHA224 = struct {
    const SHA224 = Classes.SHA224;
    const GetterType = fn (*SHA224, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*SHA224, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*SHA224, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*SHA224 {
        JSC.markBinding();
        return SHA224__fromJS(value);
    }

    /// Get the SHA224 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        return SHA224__getConstructor(globalObject);
    }

    /// Create a new instance of SHA224
    pub fn toJS(this: *SHA224, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        if (comptime Environment.allow_assert) {
            const value__ = SHA224__create(globalObject, this);
            std.debug.assert(value__.as(SHA224).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return SHA224__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of SHA224.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*SHA224) bool {
        JSC.markBinding();
        return SHA224__dangerouslySetPtr(value, ptr);
    }

    extern fn SHA224__fromJS(JSC.JSValue) ?*SHA224;
    extern fn SHA224__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn SHA224__create(globalObject: *JSC.JSGlobalObject, ptr: ?*SHA224) JSC.JSValue;

    extern fn SHA224__dangerouslySetPtr(JSC.JSValue, ?*SHA224) bool;

    comptime {
        if (@TypeOf(SHA224.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*SHA224)) {
            @compileLog("SHA224.constructor is not a constructor");
        }

        if (@TypeOf(SHA224.finalize) != (fn (*SHA224) callconv(.C) void)) {
            @compileLog("SHA224.finalize is not a finalizer");
        }

        if (@TypeOf(SHA224.getByteLength) != GetterType)
            @compileLog("Expected SHA224.getByteLength to be a getter");

        if (@TypeOf(SHA224.digest) != CallbackType)
            @compileLog("Expected SHA224.digest to be a callback");
        if (@TypeOf(SHA224.update) != CallbackType)
            @compileLog("Expected SHA224.update to be a callback");
        if (@TypeOf(SHA224.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected SHA224.getByteLengthStatic to be a static getter");

        if (@TypeOf(SHA224.hash) != StaticCallbackType)
            @compileLog("Expected SHA224.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(SHA224.constructor, .{ .name = "SHA224Class__construct" });
            @export(SHA224.digest, .{ .name = "SHA224Prototype__digest" });
            @export(SHA224.finalize, .{ .name = "SHA224Class__finalize" });
            @export(SHA224.getByteLength, .{ .name = "SHA224Prototype__getByteLength" });
            @export(SHA224.getByteLengthStatic, .{ .name = "SHA224Class__getByteLengthStatic" });
            @export(SHA224.hash, .{ .name = "SHA224Class__hash" });
            @export(SHA224.update, .{ .name = "SHA224Prototype__update" });
        }
    }
};
pub const JSSHA512 = struct {
    const SHA512 = Classes.SHA512;
    const GetterType = fn (*SHA512, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*SHA512, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*SHA512, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*SHA512 {
        JSC.markBinding();
        return SHA512__fromJS(value);
    }

    /// Get the SHA512 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        return SHA512__getConstructor(globalObject);
    }

    /// Create a new instance of SHA512
    pub fn toJS(this: *SHA512, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        if (comptime Environment.allow_assert) {
            const value__ = SHA512__create(globalObject, this);
            std.debug.assert(value__.as(SHA512).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return SHA512__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of SHA512.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*SHA512) bool {
        JSC.markBinding();
        return SHA512__dangerouslySetPtr(value, ptr);
    }

    extern fn SHA512__fromJS(JSC.JSValue) ?*SHA512;
    extern fn SHA512__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn SHA512__create(globalObject: *JSC.JSGlobalObject, ptr: ?*SHA512) JSC.JSValue;

    extern fn SHA512__dangerouslySetPtr(JSC.JSValue, ?*SHA512) bool;

    comptime {
        if (@TypeOf(SHA512.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*SHA512)) {
            @compileLog("SHA512.constructor is not a constructor");
        }

        if (@TypeOf(SHA512.finalize) != (fn (*SHA512) callconv(.C) void)) {
            @compileLog("SHA512.finalize is not a finalizer");
        }

        if (@TypeOf(SHA512.getByteLength) != GetterType)
            @compileLog("Expected SHA512.getByteLength to be a getter");

        if (@TypeOf(SHA512.digest) != CallbackType)
            @compileLog("Expected SHA512.digest to be a callback");
        if (@TypeOf(SHA512.update) != CallbackType)
            @compileLog("Expected SHA512.update to be a callback");
        if (@TypeOf(SHA512.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected SHA512.getByteLengthStatic to be a static getter");

        if (@TypeOf(SHA512.hash) != StaticCallbackType)
            @compileLog("Expected SHA512.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(SHA512.constructor, .{ .name = "SHA512Class__construct" });
            @export(SHA512.digest, .{ .name = "SHA512Prototype__digest" });
            @export(SHA512.finalize, .{ .name = "SHA512Class__finalize" });
            @export(SHA512.getByteLength, .{ .name = "SHA512Prototype__getByteLength" });
            @export(SHA512.getByteLengthStatic, .{ .name = "SHA512Class__getByteLengthStatic" });
            @export(SHA512.hash, .{ .name = "SHA512Class__hash" });
            @export(SHA512.update, .{ .name = "SHA512Prototype__update" });
        }
    }
};
pub const JSSHA384 = struct {
    const SHA384 = Classes.SHA384;
    const GetterType = fn (*SHA384, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*SHA384, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*SHA384, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*SHA384 {
        JSC.markBinding();
        return SHA384__fromJS(value);
    }

    /// Get the SHA384 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        return SHA384__getConstructor(globalObject);
    }

    /// Create a new instance of SHA384
    pub fn toJS(this: *SHA384, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        if (comptime Environment.allow_assert) {
            const value__ = SHA384__create(globalObject, this);
            std.debug.assert(value__.as(SHA384).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return SHA384__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of SHA384.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*SHA384) bool {
        JSC.markBinding();
        return SHA384__dangerouslySetPtr(value, ptr);
    }

    extern fn SHA384__fromJS(JSC.JSValue) ?*SHA384;
    extern fn SHA384__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn SHA384__create(globalObject: *JSC.JSGlobalObject, ptr: ?*SHA384) JSC.JSValue;

    extern fn SHA384__dangerouslySetPtr(JSC.JSValue, ?*SHA384) bool;

    comptime {
        if (@TypeOf(SHA384.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*SHA384)) {
            @compileLog("SHA384.constructor is not a constructor");
        }

        if (@TypeOf(SHA384.finalize) != (fn (*SHA384) callconv(.C) void)) {
            @compileLog("SHA384.finalize is not a finalizer");
        }

        if (@TypeOf(SHA384.getByteLength) != GetterType)
            @compileLog("Expected SHA384.getByteLength to be a getter");

        if (@TypeOf(SHA384.digest) != CallbackType)
            @compileLog("Expected SHA384.digest to be a callback");
        if (@TypeOf(SHA384.update) != CallbackType)
            @compileLog("Expected SHA384.update to be a callback");
        if (@TypeOf(SHA384.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected SHA384.getByteLengthStatic to be a static getter");

        if (@TypeOf(SHA384.hash) != StaticCallbackType)
            @compileLog("Expected SHA384.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(SHA384.constructor, .{ .name = "SHA384Class__construct" });
            @export(SHA384.digest, .{ .name = "SHA384Prototype__digest" });
            @export(SHA384.finalize, .{ .name = "SHA384Class__finalize" });
            @export(SHA384.getByteLength, .{ .name = "SHA384Prototype__getByteLength" });
            @export(SHA384.getByteLengthStatic, .{ .name = "SHA384Class__getByteLengthStatic" });
            @export(SHA384.hash, .{ .name = "SHA384Class__hash" });
            @export(SHA384.update, .{ .name = "SHA384Prototype__update" });
        }
    }
};
pub const JSSHA256 = struct {
    const SHA256 = Classes.SHA256;
    const GetterType = fn (*SHA256, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*SHA256, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*SHA256, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*SHA256 {
        JSC.markBinding();
        return SHA256__fromJS(value);
    }

    /// Get the SHA256 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        return SHA256__getConstructor(globalObject);
    }

    /// Create a new instance of SHA256
    pub fn toJS(this: *SHA256, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        if (comptime Environment.allow_assert) {
            const value__ = SHA256__create(globalObject, this);
            std.debug.assert(value__.as(SHA256).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return SHA256__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of SHA256.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*SHA256) bool {
        JSC.markBinding();
        return SHA256__dangerouslySetPtr(value, ptr);
    }

    extern fn SHA256__fromJS(JSC.JSValue) ?*SHA256;
    extern fn SHA256__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn SHA256__create(globalObject: *JSC.JSGlobalObject, ptr: ?*SHA256) JSC.JSValue;

    extern fn SHA256__dangerouslySetPtr(JSC.JSValue, ?*SHA256) bool;

    comptime {
        if (@TypeOf(SHA256.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*SHA256)) {
            @compileLog("SHA256.constructor is not a constructor");
        }

        if (@TypeOf(SHA256.finalize) != (fn (*SHA256) callconv(.C) void)) {
            @compileLog("SHA256.finalize is not a finalizer");
        }

        if (@TypeOf(SHA256.getByteLength) != GetterType)
            @compileLog("Expected SHA256.getByteLength to be a getter");

        if (@TypeOf(SHA256.digest) != CallbackType)
            @compileLog("Expected SHA256.digest to be a callback");
        if (@TypeOf(SHA256.update) != CallbackType)
            @compileLog("Expected SHA256.update to be a callback");
        if (@TypeOf(SHA256.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected SHA256.getByteLengthStatic to be a static getter");

        if (@TypeOf(SHA256.hash) != StaticCallbackType)
            @compileLog("Expected SHA256.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(SHA256.constructor, .{ .name = "SHA256Class__construct" });
            @export(SHA256.digest, .{ .name = "SHA256Prototype__digest" });
            @export(SHA256.finalize, .{ .name = "SHA256Class__finalize" });
            @export(SHA256.getByteLength, .{ .name = "SHA256Prototype__getByteLength" });
            @export(SHA256.getByteLengthStatic, .{ .name = "SHA256Class__getByteLengthStatic" });
            @export(SHA256.hash, .{ .name = "SHA256Class__hash" });
            @export(SHA256.update, .{ .name = "SHA256Prototype__update" });
        }
    }
};
pub const JSSHA512_256 = struct {
    const SHA512_256 = Classes.SHA512_256;
    const GetterType = fn (*SHA512_256, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*SHA512_256, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*SHA512_256, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*SHA512_256 {
        JSC.markBinding();
        return SHA512_256__fromJS(value);
    }

    /// Get the SHA512_256 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        return SHA512_256__getConstructor(globalObject);
    }

    /// Create a new instance of SHA512_256
    pub fn toJS(this: *SHA512_256, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        if (comptime Environment.allow_assert) {
            const value__ = SHA512_256__create(globalObject, this);
            std.debug.assert(value__.as(SHA512_256).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return SHA512_256__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of SHA512_256.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*SHA512_256) bool {
        JSC.markBinding();
        return SHA512_256__dangerouslySetPtr(value, ptr);
    }

    extern fn SHA512_256__fromJS(JSC.JSValue) ?*SHA512_256;
    extern fn SHA512_256__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn SHA512_256__create(globalObject: *JSC.JSGlobalObject, ptr: ?*SHA512_256) JSC.JSValue;

    extern fn SHA512_256__dangerouslySetPtr(JSC.JSValue, ?*SHA512_256) bool;

    comptime {
        if (@TypeOf(SHA512_256.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*SHA512_256)) {
            @compileLog("SHA512_256.constructor is not a constructor");
        }

        if (@TypeOf(SHA512_256.finalize) != (fn (*SHA512_256) callconv(.C) void)) {
            @compileLog("SHA512_256.finalize is not a finalizer");
        }

        if (@TypeOf(SHA512_256.getByteLength) != GetterType)
            @compileLog("Expected SHA512_256.getByteLength to be a getter");

        if (@TypeOf(SHA512_256.digest) != CallbackType)
            @compileLog("Expected SHA512_256.digest to be a callback");
        if (@TypeOf(SHA512_256.update) != CallbackType)
            @compileLog("Expected SHA512_256.update to be a callback");
        if (@TypeOf(SHA512_256.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected SHA512_256.getByteLengthStatic to be a static getter");

        if (@TypeOf(SHA512_256.hash) != StaticCallbackType)
            @compileLog("Expected SHA512_256.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(SHA512_256.constructor, .{ .name = "SHA512_256Class__construct" });
            @export(SHA512_256.digest, .{ .name = "SHA512_256Prototype__digest" });
            @export(SHA512_256.finalize, .{ .name = "SHA512_256Class__finalize" });
            @export(SHA512_256.getByteLength, .{ .name = "SHA512_256Prototype__getByteLength" });
            @export(SHA512_256.getByteLengthStatic, .{ .name = "SHA512_256Class__getByteLengthStatic" });
            @export(SHA512_256.hash, .{ .name = "SHA512_256Class__hash" });
            @export(SHA512_256.update, .{ .name = "SHA512_256Prototype__update" });
        }
    }
};
pub const JSTextDecoder = struct {
    const TextDecoder = Classes.TextDecoder;
    const GetterType = fn (*TextDecoder, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*TextDecoder, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*TextDecoder, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*TextDecoder {
        JSC.markBinding();
        return TextDecoder__fromJS(value);
    }

    /// Get the TextDecoder constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        return TextDecoder__getConstructor(globalObject);
    }

    /// Create a new instance of TextDecoder
    pub fn toJS(this: *TextDecoder, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        if (comptime Environment.allow_assert) {
            const value__ = TextDecoder__create(globalObject, this);
            std.debug.assert(value__.as(TextDecoder).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return TextDecoder__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of TextDecoder.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*TextDecoder) bool {
        JSC.markBinding();
        return TextDecoder__dangerouslySetPtr(value, ptr);
    }

    extern fn TextDecoder__fromJS(JSC.JSValue) ?*TextDecoder;
    extern fn TextDecoder__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn TextDecoder__create(globalObject: *JSC.JSGlobalObject, ptr: ?*TextDecoder) JSC.JSValue;

    extern fn TextDecoder__dangerouslySetPtr(JSC.JSValue, ?*TextDecoder) bool;

    comptime {
        if (@TypeOf(TextDecoder.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*TextDecoder)) {
            @compileLog("TextDecoder.constructor is not a constructor");
        }

        if (@TypeOf(TextDecoder.finalize) != (fn (*TextDecoder) callconv(.C) void)) {
            @compileLog("TextDecoder.finalize is not a finalizer");
        }

        if (@TypeOf(TextDecoder.decode) != CallbackType)
            @compileLog("Expected TextDecoder.decode to be a callback");
        if (@TypeOf(TextDecoder.getEncoding) != GetterType)
            @compileLog("Expected TextDecoder.getEncoding to be a getter");

        if (@TypeOf(TextDecoder.getFatal) != GetterType)
            @compileLog("Expected TextDecoder.getFatal to be a getter");

        if (!JSC.is_bindgen) {
            @export(TextDecoder.constructor, .{ .name = "TextDecoderClass__construct" });
            @export(TextDecoder.decode, .{ .name = "TextDecoderPrototype__decode" });
            @export(TextDecoder.finalize, .{ .name = "TextDecoderClass__finalize" });
            @export(TextDecoder.getEncoding, .{ .name = "TextDecoderPrototype__getEncoding" });
            @export(TextDecoder.getFatal, .{ .name = "TextDecoderPrototype__getFatal" });
        }
    }
};
pub const JSRequest = struct {
    const Request = Classes.Request;
    const GetterType = fn (*Request, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*Request, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*Request, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*Request {
        JSC.markBinding();
        return Request__fromJS(value);
    }

    /// Get the Request constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        return Request__getConstructor(globalObject);
    }

    /// Create a new instance of Request
    pub fn toJS(this: *Request, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        if (comptime Environment.allow_assert) {
            const value__ = Request__create(globalObject, this);
            std.debug.assert(value__.as(Request).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return Request__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of Request.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*Request) bool {
        JSC.markBinding();
        return Request__dangerouslySetPtr(value, ptr);
    }

    extern fn Request__fromJS(JSC.JSValue) ?*Request;
    extern fn Request__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn Request__create(globalObject: *JSC.JSGlobalObject, ptr: ?*Request) JSC.JSValue;

    extern fn Request__dangerouslySetPtr(JSC.JSValue, ?*Request) bool;

    comptime {
        if (@TypeOf(Request.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*Request)) {
            @compileLog("Request.constructor is not a constructor");
        }

        if (@TypeOf(Request.finalize) != (fn (*Request) callconv(.C) void)) {
            @compileLog("Request.finalize is not a finalizer");
        }

        if (@TypeOf(Request.getArrayBuffer) != CallbackType)
            @compileLog("Expected Request.getArrayBuffer to be a callback");
        if (@TypeOf(Request.getBlob) != CallbackType)
            @compileLog("Expected Request.getBlob to be a callback");
        if (@TypeOf(Request.getBodyUsed) != GetterType)
            @compileLog("Expected Request.getBodyUsed to be a getter");

        if (@TypeOf(Request.getCache) != GetterType)
            @compileLog("Expected Request.getCache to be a getter");

        if (@TypeOf(Request.doClone) != CallbackType)
            @compileLog("Expected Request.doClone to be a callback");
        if (@TypeOf(Request.getCredentials) != GetterType)
            @compileLog("Expected Request.getCredentials to be a getter");

        if (@TypeOf(Request.getDestination) != GetterType)
            @compileLog("Expected Request.getDestination to be a getter");

        if (@TypeOf(Request.getHeaders) != GetterType)
            @compileLog("Expected Request.getHeaders to be a getter");

        if (@TypeOf(Request.getIntegrity) != GetterType)
            @compileLog("Expected Request.getIntegrity to be a getter");

        if (@TypeOf(Request.getJSON) != CallbackType)
            @compileLog("Expected Request.getJSON to be a callback");
        if (@TypeOf(Request.getMethod) != GetterType)
            @compileLog("Expected Request.getMethod to be a getter");

        if (@TypeOf(Request.getMode) != GetterType)
            @compileLog("Expected Request.getMode to be a getter");

        if (@TypeOf(Request.getRedirect) != GetterType)
            @compileLog("Expected Request.getRedirect to be a getter");

        if (@TypeOf(Request.getReferrer) != GetterType)
            @compileLog("Expected Request.getReferrer to be a getter");

        if (@TypeOf(Request.getReferrerPolicy) != GetterType)
            @compileLog("Expected Request.getReferrerPolicy to be a getter");

        if (@TypeOf(Request.getText) != CallbackType)
            @compileLog("Expected Request.getText to be a callback");
        if (@TypeOf(Request.getUrl) != GetterType)
            @compileLog("Expected Request.getUrl to be a getter");

        if (!JSC.is_bindgen) {
            @export(Request.constructor, .{ .name = "RequestClass__construct" });
            @export(Request.doClone, .{ .name = "RequestPrototype__doClone" });
            @export(Request.finalize, .{ .name = "RequestClass__finalize" });
            @export(Request.getArrayBuffer, .{ .name = "RequestPrototype__getArrayBuffer" });
            @export(Request.getBlob, .{ .name = "RequestPrototype__getBlob" });
            @export(Request.getBodyUsed, .{ .name = "RequestPrototype__getBodyUsed" });
            @export(Request.getCache, .{ .name = "RequestPrototype__getCache" });
            @export(Request.getCredentials, .{ .name = "RequestPrototype__getCredentials" });
            @export(Request.getDestination, .{ .name = "RequestPrototype__getDestination" });
            @export(Request.getHeaders, .{ .name = "RequestPrototype__getHeaders" });
            @export(Request.getIntegrity, .{ .name = "RequestPrototype__getIntegrity" });
            @export(Request.getJSON, .{ .name = "RequestPrototype__getJSON" });
            @export(Request.getMethod, .{ .name = "RequestPrototype__getMethod" });
            @export(Request.getMode, .{ .name = "RequestPrototype__getMode" });
            @export(Request.getRedirect, .{ .name = "RequestPrototype__getRedirect" });
            @export(Request.getReferrer, .{ .name = "RequestPrototype__getReferrer" });
            @export(Request.getReferrerPolicy, .{ .name = "RequestPrototype__getReferrerPolicy" });
            @export(Request.getText, .{ .name = "RequestPrototype__getText" });
            @export(Request.getUrl, .{ .name = "RequestPrototype__getUrl" });
        }
    }
};
pub const JSResponse = struct {
    const Response = Classes.Response;
    const GetterType = fn (*Response, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*Response, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*Response, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*Response {
        JSC.markBinding();
        return Response__fromJS(value);
    }

    /// Get the Response constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        return Response__getConstructor(globalObject);
    }

    /// Create a new instance of Response
    pub fn toJS(this: *Response, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        if (comptime Environment.allow_assert) {
            const value__ = Response__create(globalObject, this);
            std.debug.assert(value__.as(Response).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return Response__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of Response.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*Response) bool {
        JSC.markBinding();
        return Response__dangerouslySetPtr(value, ptr);
    }

    extern fn Response__fromJS(JSC.JSValue) ?*Response;
    extern fn Response__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn Response__create(globalObject: *JSC.JSGlobalObject, ptr: ?*Response) JSC.JSValue;

    extern fn Response__dangerouslySetPtr(JSC.JSValue, ?*Response) bool;

    comptime {
        if (@TypeOf(Response.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*Response)) {
            @compileLog("Response.constructor is not a constructor");
        }

        if (@TypeOf(Response.finalize) != (fn (*Response) callconv(.C) void)) {
            @compileLog("Response.finalize is not a finalizer");
        }

        if (@TypeOf(Response.getArrayBuffer) != CallbackType)
            @compileLog("Expected Response.getArrayBuffer to be a callback");
        if (@TypeOf(Response.getBlob) != CallbackType)
            @compileLog("Expected Response.getBlob to be a callback");
        if (@TypeOf(Response.getBodyUsed) != GetterType)
            @compileLog("Expected Response.getBodyUsed to be a getter");

        if (@TypeOf(Response.doClone) != CallbackType)
            @compileLog("Expected Response.doClone to be a callback");
        if (@TypeOf(Response.getHeaders) != GetterType)
            @compileLog("Expected Response.getHeaders to be a getter");

        if (@TypeOf(Response.getJSON) != CallbackType)
            @compileLog("Expected Response.getJSON to be a callback");
        if (@TypeOf(Response.getOK) != GetterType)
            @compileLog("Expected Response.getOK to be a getter");

        if (@TypeOf(Response.getStatus) != GetterType)
            @compileLog("Expected Response.getStatus to be a getter");

        if (@TypeOf(Response.getStatusText) != GetterType)
            @compileLog("Expected Response.getStatusText to be a getter");

        if (@TypeOf(Response.getText) != CallbackType)
            @compileLog("Expected Response.getText to be a callback");
        if (@TypeOf(Response.getResponseType) != GetterType)
            @compileLog("Expected Response.getResponseType to be a getter");

        if (@TypeOf(Response.getURL) != GetterType)
            @compileLog("Expected Response.getURL to be a getter");

        if (@TypeOf(Response.constructError) != StaticCallbackType)
            @compileLog("Expected Response.constructError to be a static callback");
        if (@TypeOf(Response.constructJSON) != StaticCallbackType)
            @compileLog("Expected Response.constructJSON to be a static callback");
        if (@TypeOf(Response.constructRedirect) != StaticCallbackType)
            @compileLog("Expected Response.constructRedirect to be a static callback");
        if (!JSC.is_bindgen) {
            @export(Response.constructError, .{ .name = "ResponseClass__constructError" });
            @export(Response.constructJSON, .{ .name = "ResponseClass__constructJSON" });
            @export(Response.constructor, .{ .name = "ResponseClass__construct" });
            @export(Response.constructRedirect, .{ .name = "ResponseClass__constructRedirect" });
            @export(Response.doClone, .{ .name = "ResponsePrototype__doClone" });
            @export(Response.finalize, .{ .name = "ResponseClass__finalize" });
            @export(Response.getArrayBuffer, .{ .name = "ResponsePrototype__getArrayBuffer" });
            @export(Response.getBlob, .{ .name = "ResponsePrototype__getBlob" });
            @export(Response.getBodyUsed, .{ .name = "ResponsePrototype__getBodyUsed" });
            @export(Response.getHeaders, .{ .name = "ResponsePrototype__getHeaders" });
            @export(Response.getJSON, .{ .name = "ResponsePrototype__getJSON" });
            @export(Response.getOK, .{ .name = "ResponsePrototype__getOK" });
            @export(Response.getResponseType, .{ .name = "ResponsePrototype__getResponseType" });
            @export(Response.getStatus, .{ .name = "ResponsePrototype__getStatus" });
            @export(Response.getStatusText, .{ .name = "ResponsePrototype__getStatusText" });
            @export(Response.getText, .{ .name = "ResponsePrototype__getText" });
            @export(Response.getURL, .{ .name = "ResponsePrototype__getURL" });
        }
    }
};

comptime {
    _ = JSSHA1;
    _ = JSMD5;
    _ = JSMD4;
    _ = JSSHA224;
    _ = JSSHA512;
    _ = JSSHA384;
    _ = JSSHA256;
    _ = JSSHA512_256;
    _ = JSTextDecoder;
    _ = JSRequest;
    _ = JSResponse;
}
