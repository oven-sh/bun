/// Opaque type for working with JavaScript `Map` objects.
pub const JSMap = opaque {
    pub const create = bun.cpp.JSC__JSMap__create;
    pub const set = bun.cpp.JSC__JSMap__set;

    /// Retrieve a value from this JS Map object.
    ///
    /// Note this shares semantics with the JS `Map.prototype.get` method, and
    /// will return .js_undefined if a value is not found.
    pub const get = bun.cpp.JSC__JSMap__get;

    /// Test whether this JS Map object has a given key.
    pub const has = bun.cpp.JSC__JSMap__has;

    /// Attempt to remove a key from this JS Map object.
    pub const remove = bun.cpp.JSC__JSMap__remove;

    /// Clear all entries from this JS Map object.
    pub const clear = bun.cpp.JSC__JSMap__clear;

    /// Retrieve the number of entries in this JS Map object.
    pub const size = bun.cpp.JSC__JSMap__size;

    /// Attempt to convert a `JSValue` to a `*JSMap`.
    ///
    /// Returns `null` if the value is not a Map.
    pub fn fromJS(value: JSValue) ?*JSMap {
        if (value.jsTypeLoose() == .Map) {
            return bun.cast(*JSMap, value.asEncoded().asPtr.?);
        }

        return null;
    }
};

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
