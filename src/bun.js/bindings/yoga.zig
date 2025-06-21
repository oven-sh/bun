const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

// External C function from JSYogaModule.cpp
extern fn Bun__createYogaModule(globalObject: *JSGlobalObject) JSValue;

pub const Yoga = struct {
    /// Create the Yoga module object
    pub fn create(globalObject: *JSGlobalObject) JSValue {
        return Bun__createYogaModule(globalObject);
    }

    /// Register Yoga as a global module
    pub fn load(globalObject: *JSGlobalObject) void {
        const yoga_module = create(globalObject);
        
        // Make it available as globalThis.Yoga
        const global_this = globalObject.getGlobalThis();
        global_this.put(
            globalObject,
            JSC.ZigString.static("Yoga"),
            yoga_module,
        );
    }
};

comptime {
    // Ensure the external function is linked
    _ = &Bun__createYogaModule;
}