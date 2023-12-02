const bun = @import("root").bun;
const JSC = bun.JSC;

pub const Debugger = struct {
    pub const AsyncCallType = enum(u8) {
        DOMTimer = 1,
        EventListener = 2,
        PostMessage = 3,
        RequestAnimationFrame = 4,
        Microtask = 5,
    };
    extern fn Debugger__didScheduleAsyncCall(*JSC.JSGlobalObject, AsyncCallType, u64, bool) void;
    extern fn Debugger__didCancelAsyncCall(*JSC.JSGlobalObject, AsyncCallType, u64) void;
    extern fn Debugger__didDispatchAsyncCall(*JSC.JSGlobalObject, AsyncCallType, u64) void;
    extern fn Debugger__willDispatchAsyncCall(*JSC.JSGlobalObject, AsyncCallType, u64) void;

    pub fn didScheduleAsyncCall(globalObject: *JSC.JSGlobalObject, call: AsyncCallType, id: u64, single_shot: bool) void {
        JSC.markBinding(@src());
        Debugger__didScheduleAsyncCall(globalObject, call, id, single_shot);
    }
    pub fn didCancelAsyncCall(globalObject: *JSC.JSGlobalObject, call: AsyncCallType, id: u64) void {
        JSC.markBinding(@src());
        Debugger__didCancelAsyncCall(globalObject, call, id);
    }
    pub fn didDispatchAsyncCall(globalObject: *JSC.JSGlobalObject, call: AsyncCallType, id: u64) void {
        JSC.markBinding(@src());
        Debugger__didDispatchAsyncCall(globalObject, call, id);
    }
    pub fn willDispatchAsyncCall(globalObject: *JSC.JSGlobalObject, call: AsyncCallType, id: u64) void {
        JSC.markBinding(@src());
        Debugger__willDispatchAsyncCall(globalObject, call, id);
    }
};
