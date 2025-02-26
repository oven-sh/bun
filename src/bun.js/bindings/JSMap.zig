const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const C_API = bun.JSC.C;
const StringPointer = @import("../../api/schema.zig").Api.StringPointer;
const Exports = @import("./exports.zig");
const strings = bun.strings;
const ErrorableZigString = Exports.ErrorableZigString;
const ErrorableResolvedSource = Exports.ErrorableResolvedSource;
const ZigException = Exports.ZigException;
const ZigStackTrace = Exports.ZigStackTrace;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const JSC = bun.JSC;
const Shimmer = JSC.Shimmer;
const FFI = @import("./FFI.zig");
const NullableAllocator = bun.NullableAllocator;
const MutableString = bun.MutableString;
const JestPrettyFormat = @import("../test/pretty_format.zig").JestPrettyFormat;
const String = bun.String;
const ErrorableString = JSC.ErrorableString;
const JSError = bun.JSError;
const OOM = bun.OOM;

const Api = @import("../../api/schema.zig").Api;

const Bun = JSC.API.Bun;

const JSGlobalObject = JSC.JSGlobalObject;
const VM = JSC.VM;
const ZigString = JSC.ZigString;
const CommonStrings = JSC.CommonStrings;
const URL = JSC.URL;
const WTF = JSC.WTF;
const JSString = JSC.JSString;
const JSObject = JSC.JSObject;
const JSValue = JSC.JSValue;
const GetterSetter = JSC.GetterSetter;
const CustomGetterSetter = JSC.CustomGetterSetter;

pub const JSMap = opaque {
    extern fn JSC__JSMap__create(*JSGlobalObject) JSValue;
    extern fn JSC__JSMap__get_(?*JSMap, *JSGlobalObject, JSValue) JSValue;
    extern fn JSC__JSMap__has(arg0: ?*JSMap, arg1: *JSGlobalObject, JSValue2: JSValue) bool;
    extern fn JSC__JSMap__remove(arg0: ?*JSMap, arg1: *JSGlobalObject, JSValue2: JSValue) bool;
    extern fn JSC__JSMap__set(arg0: ?*JSMap, arg1: *JSGlobalObject, JSValue2: JSValue, JSValue3: JSValue) void;

    pub fn create(globalObject: *JSGlobalObject) JSValue {
        return JSC__JSMap__create(globalObject);
    }

    pub fn set(this: *JSMap, globalObject: *JSGlobalObject, key: JSValue, value: JSValue) void {
        return JSC__JSMap__set(this, globalObject, key, value);
    }

    pub fn get_(this: *JSMap, globalObject: *JSGlobalObject, key: JSValue) JSValue {
        return JSC__JSMap__get_(this, globalObject, key);
    }

    pub fn get(this: *JSMap, globalObject: *JSGlobalObject, key: JSValue) ?JSValue {
        const value = get_(this, globalObject, key);
        if (value.isEmpty()) {
            return null;
        }
        return value;
    }

    pub fn has(this: *JSMap, globalObject: *JSGlobalObject, key: JSValue) bool {
        return JSC__JSMap__has(this, globalObject, key);
    }

    pub fn remove(this: *JSMap, globalObject: *JSGlobalObject, key: JSValue) bool {
        return JSC__JSMap__remove(this, globalObject, key);
    }

    pub fn fromJS(value: JSValue) ?*JSMap {
        if (value.jsTypeLoose() == .Map) {
            return bun.cast(*JSMap, value.asEncoded().asPtr.?);
        }

        return null;
    }
};
