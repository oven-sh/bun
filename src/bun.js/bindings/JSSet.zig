/// Opaque type for working with JavaScript `Set` objects.
pub const JSSet = opaque {
    pub const create = bun.cpp.JSC__JSSet__create;

    /// Add a value to this JS Set object.
    pub const add = bun.cpp.JSC__JSSet__add;

    /// Test whether this JS Set object has a given value.
    pub const has = bun.cpp.JSC__JSSet__has;

    /// Attempt to remove a value from this JS Set object.
    pub const remove = bun.cpp.JSC__JSSet__remove;

    /// Clear all entries from this JS Set object.
    pub const clear = bun.cpp.JSC__JSSet__clear;

    /// Retrieve the number of entries in this JS Set object.
    pub const size = bun.cpp.JSC__JSSet__size;

    /// Attempt to convert a `JSValue` to a `*JSSet`.
    ///
    /// Returns `null` if the value is not a Set.
    pub fn fromJS(value: JSValue) ?*JSSet {
        if (value.jsTypeLoose() == .Set) {
            return bun.cast(*JSSet, value.asEncoded().asPtr.?);
        }

        return null;
    }
};

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
