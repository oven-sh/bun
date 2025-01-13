ref_count: u32 = 1,
globalObject: *JSGlobalObject,
path: []const u8,

pub fn init(globalObject: *JSGlobalObject, path: []const u8) !*HTMLBundle {
    return HTMLBundle.new(.{
        .globalObject = globalObject,
        .path = try bun.default_allocator.dupe(u8, path),
    });
}

pub fn finalize(this: *HTMLBundle) void {
    this.deref();
}

pub fn deinit(this: *HTMLBundle) void {
    bun.default_allocator.free(this.path);
    this.destroy();
}

pub fn getPath(this: *HTMLBundle, globalObject: *JSGlobalObject) JSValue {
    var str = bun.String.createUTF8(this.path);
    return str.transferToJS(globalObject);
}

pub fn write(this: *HTMLBundle, globalObject: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    _ = this; // autofix
    const args_ = callframe.arguments_old(1);
    var args = JSC.Node.ArgumentsSlice.init(globalObject.bunVM(), args_.slice());
    defer args.deinit();
    const destination_path = (try JSC.Node.PathLike.fromJS(globalObject, &args)) orelse {
        return globalObject.throwMissingArgumentsValue(&.{"path"});
    };
    _ = destination_path; // autofix
    return globalObject.throwTODO("Finish implementing HTMLBundle.write");
}

pub usingnamespace JSC.Codegen.JSHTMLBundle;
pub usingnamespace bun.NewRefCounted(HTMLBundle, deinit);
const bun = @import("root").bun;
const std = @import("std");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const JSString = JSC.JSString;
const JSValueRef = JSC.JSValueRef;
const HTMLBundle = @This();
