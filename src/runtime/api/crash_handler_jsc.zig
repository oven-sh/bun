//! JS testing/debugging bindings for the crash handler. Keeps
//! `src/crash_handler/` free of JSC types.

pub const js_bindings = struct {
    const jsc = bun.jsc;
    const JSValue = jsc.JSValue;

    pub fn generate(global: *jsc.JSGlobalObject) jsc.JSValue {
        const obj = jsc.JSValue.createEmptyObject(global, 8);
        inline for (.{
            .{ "getMachOImageZeroOffset", jsGetMachOImageZeroOffset },
            .{ "getFeaturesAsVLQ", jsGetFeaturesAsVLQ },
            .{ "getFeatureData", jsGetFeatureData },
            .{ "segfault", jsSegfault },
            .{ "panic", jsPanic },
            .{ "rootError", jsRootError },
            .{ "outOfMemory", jsOutOfMemory },
            .{ "raiseIgnoringPanicHandler", jsRaiseIgnoringPanicHandler },
        }) |tuple| {
            const name = jsc.ZigString.static(tuple[0]);
            obj.put(global, name, jsc.JSFunction.create(global, tuple[0], tuple[1], 1, .{}));
        }
        return obj;
    }

    pub fn jsGetMachOImageZeroOffset(_: *bun.jsc.JSGlobalObject, _: *bun.jsc.CallFrame) bun.JSError!JSValue {
        if (!bun.Environment.isMac) return .js_undefined;

        const header = std.c._dyld_get_image_header(0) orelse return .js_undefined;
        const base_address = @intFromPtr(header);
        const vmaddr_slide = std.c._dyld_get_image_vmaddr_slide(0);

        return JSValue.jsNumber(base_address - vmaddr_slide);
    }

    pub fn jsSegfault(_: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        @setRuntimeSafety(false);
        crash_handler.suppressCoreDumpsIfNecessary();
        const ptr: [*]align(1) u64 = @ptrFromInt(0xDEADBEEF);
        ptr[0] = 0xDEADBEEF;
        std.mem.doNotOptimizeAway(&ptr);
        return .js_undefined;
    }

    pub fn jsPanic(_: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        crash_handler.suppressCoreDumpsIfNecessary();
        bun.crash_handler.panicImpl("invoked crashByPanic() handler", null, null);
    }

    pub fn jsRootError(_: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        bun.crash_handler.handleRootError(error.Test, null);
    }

    pub fn jsOutOfMemory(_: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        crash_handler.suppressCoreDumpsIfNecessary();
        bun.outOfMemory();
    }

    pub fn jsRaiseIgnoringPanicHandler(_: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        crash_handler.suppressCoreDumpsIfNecessary();
        bun.Global.raiseIgnoringPanicHandler(.SIGSEGV);
    }

    pub fn jsGetFeaturesAsVLQ(global: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const bits = bun.analytics.packedFeatures();
        var buf = bun.BoundedArray(u8, 16){};
        crash_handler.writeU64AsTwoVLQs(buf.writer(), @bitCast(bits)) catch {
            // there is definitely enough space in the bounded array
            unreachable;
        };
        var str = bun.String.cloneLatin1(buf.slice());
        return str.transferToJS(global);
    }

    pub fn jsGetFeatureData(global: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const obj = JSValue.createEmptyObject(global, 5);
        const list = bun.analytics.packed_features_list;
        const array = try JSValue.createEmptyArray(global, list.len);
        for (list, 0..) |feature, i| {
            try array.putIndex(global, @intCast(i), try bun.String.static(feature).toJS(global));
        }
        obj.put(global, jsc.ZigString.static("features"), array);
        obj.put(global, jsc.ZigString.static("version"), try bun.String.init(Global.package_json_version).toJS(global));
        obj.put(global, jsc.ZigString.static("is_canary"), jsc.JSValue.jsBoolean(bun.Environment.is_canary));

        // This is the source of truth for the git sha.
        // Not the github ref or the git tag.
        obj.put(global, jsc.ZigString.static("revision"), try bun.String.init(bun.Environment.git_sha).toJS(global));

        obj.put(global, jsc.ZigString.static("generated_at"), JSValue.jsNumberFromInt64(@max(std.time.milliTimestamp(), 0)));
        return obj;
    }
};

const std = @import("std");

const bun = @import("bun");
const Global = bun.Global;
const crash_handler = bun.crash_handler;
