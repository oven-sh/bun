const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;

pub const Navigator = struct {
    pub usingnamespace bun.NewRefCounted(@This(), deinit);
    pub usingnamespace JSC.Codegen.JSNativeZlib;

    ref_count: u32 = 1,

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) ?*@This() {
        _ = callframe;
        globalThis.ERR_ILLEGAL_CONSTRUCTOR("Illegal constructor", .{}).throw();
        return null;
    }

    pub fn get_hardwareConcurrency(_: *@This(), globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        _ = globalThis;
        switch (bun.Environment.os) {
            .mac => {
                var cpu_count: c_int = 0;
                var cpu_len: usize = @sizeOf(c_int);
                _ = std.c.sysctlbyname("hw.logicalcpu", &cpu_count, &cpu_len, null, 0);
                return JSC.jsNumber(cpu_count);
            },
            .linux => {
                const cpu_count = std.c.sysconf(std.c._SC_NPROCESSORS_ONLN);
                return JSC.jsNumber(cpu_count);
            },
            .windows => {
                var sysinfo = std.mem.zeroes(std.os.windows.SYSTEM_INFO);
                bun.windows.kernel32.GetSystemInfo(&sysinfo);
                return JSC.jsNumber(sysinfo.dwNumberOfProcessors);
            },
            .wasm => {
                return JSC.jsNumber(1);
            },
        }
    }

    pub fn get_language(_: *@This(), globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        // TODO: query ICU for default locale
        return bun.String.static("en-US").toJS(globalThis);
    }

    pub fn get_languages(this: *@This(), globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.JSArray.create(globalThis, &.{
            this.get_language(globalThis),
        });
    }

    pub fn get_platform(_: *@This(), globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        switch (bun.Environment.os) {
            .mac => {
                // On macOS, modern browsers return 'MacIntel' even if running on Apple Silicon.
                return bun.String.static("MacIntel").toJS(globalThis);
            },
            .windows => {
                // On Windows, modern browsers return 'Win32' even if running on a 64-bit version of Windows.
                return bun.String.static("Win32").toJS(globalThis);
            },
            .linux => switch (bun.Environment.arch) {
                .x64 => return bun.String.static("Linux x86_64").toJS(globalThis),
                else => {},
            },
            .wasm => {},
        }
        return bun.String.static(bun.Environment.os.displayString() ++ " " ++ @tagName(bun.Environment.arch)).toJS(globalThis);
    }

    pub fn get_userAgent(_: *@This(), globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return bun.String.static(bun.Global.user_agent).toJS(globalThis);
    }

    pub fn set_noop(_: *@This(), globalThis: *JSC.JSGlobalObject, newValue: JSC.JSValue) bool {
        _ = globalThis;
        _ = newValue;
        return true;
    }

    pub fn deinit(this: *@This()) void {
        this.destroy();
    }
};
