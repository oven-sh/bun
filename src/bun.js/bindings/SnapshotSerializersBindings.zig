// Example Zig bindings for SnapshotSerializers
// This shows how to use the exported C++ functions from Zig

const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;

// Import the exported C++ functions
extern "c" fn SnapshotSerializers__add(
    globalObject: *JSC.JSGlobalObject,
    serializers: JSC.JSValue,
    testCallback: JSC.JSValue,
    serializeCallback: JSC.JSValue,
) JSC.JSValue;

extern "c" fn SnapshotSerializers__serialize(
    globalObject: *JSC.JSGlobalObject,
    serializers: JSC.JSValue,
    value: JSC.JSValue,
) JSC.JSValue;

/// Add a snapshot serializer
pub fn addSerializer(
    global: *JSC.JSGlobalObject,
    serializers: JSC.JSValue,
    test_callback: JSC.JSValue,
    serialize_callback: JSC.JSValue,
) JSC.JSValue {
    return SnapshotSerializers__add(
        global,
        serializers,
        test_callback,
        serialize_callback,
    );
}

/// Serialize a value using the registered serializers
pub fn serialize(
    global: *JSC.JSGlobalObject,
    serializers: JSC.JSValue,
    value: JSC.JSValue,
) JSC.JSValue {
    return SnapshotSerializers__serialize(
        global,
        serializers,
        value,
    );
}

// Example usage:
//
// const serializers = SnapshotSerializers.create(vm, structure);
//
// // Add a serializer for custom objects
// const test_fn = JSFunction.create(...); // function that returns true for custom objects
// const serialize_fn = JSFunction.create(...); // function that serializes the object
//
// _ = addSerializer(global, serializers, test_fn, serialize_fn);
//
// // Use the serializer
// const custom_object = ...;
// const result = serialize(global, serializers, custom_object);
