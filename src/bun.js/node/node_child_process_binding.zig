const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;

pub fn directIpcSend(global: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    const S = struct {
        fn cb(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            const arguments = callframe.arguments(1);
            if (arguments.len < 1) {
                globalThis.throwNotEnoughArguments("raw_process_send", 1, arguments.len);
                return .zero;
            }
            const vm = globalThis.bunVM();
            if (vm.getIPCInstance()) |ipc_instance| {
                const success = ipc_instance.data.serializeAndSend(globalThis, arguments.slice()[0]);
                return if (success) .true else .false;
            } else {
                globalThis.throw("IPC Socket is no longer open.", .{});
                return .zero;
            }
        }
    };
    return JSC.JSFunction.create(global, "raw_process_send", S.cb, 3, .{});
}
