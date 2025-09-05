pub const JSMap = opaque {
    extern fn JSC__JSMap__create(*JSGlobalObject) JSValue;

    pub fn create(globalObject: *JSGlobalObject) JSValue {
        return JSC__JSMap__create(globalObject);
    }

    pub fn set(this: *JSMap, globalObject: *JSGlobalObject, key: JSValue, value: JSValue) void {
        return bun.cpp.JSC__JSMap__set(this, globalObject, key, value);
    }

    extern fn JSC__JSMap__get(*JSMap, *JSGlobalObject, JSValue) JSValue;

    pub fn get(this: *JSMap, globalObject: *JSGlobalObject, key: JSValue) bun.JSError!?JSValue {
        var scope: jsc.CatchScope = undefined;
        scope.init(globalObject, @src());
        defer scope.deinit();

        const value = JSC__JSMap__get(this, globalObject, key);

        try scope.returnIfException();

        if (value == .zero) {
            return null;
        }
        return value;
    }

    pub fn has(this: *JSMap, globalObject: *JSGlobalObject, key: JSValue) bool {
        return bun.cpp.JSC__JSMap__has(this, globalObject, key);
    }

    pub fn remove(this: *JSMap, globalObject: *JSGlobalObject, key: JSValue) bool {
        return bun.cpp.JSC__JSMap__remove(this, globalObject, key);
    }

    pub fn size(this: *JSMap, globalObject: *JSGlobalObject) usize {
        return bun.cpp.JSC__JSMap__size(this, globalObject);
    }

    pub fn fromJS(value: JSValue) ?*JSMap {
        if (value.jsTypeLoose() == .Map) {
            return bun.cast(*JSMap, value.asEncoded().asPtr.?);
        }

        return null;
    }
};

const bun = @import("bun");

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
