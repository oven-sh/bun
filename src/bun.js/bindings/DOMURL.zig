const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const C_API = bun.JSC.C;
const StringPointer = @import("../../api/schema.zig").Api.StringPointer;
const Exports = @import("./exports.zig");
const strings = bun.strings;
const ErrorableZigString = Exports.ErrorableZigString;
const ErrorableResolvedSource = Exports.ErrorableResolvedSource;
const ZigException = Exports.ZigException;
const ZigStackTrace = Exports.ZigStackTrace;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const JSC = bun.JSC;
const Shimmer = JSC.Shimmer;
const FFI = @import("./FFI.zig");
const NullableAllocator = bun.NullableAllocator;
const MutableString = bun.MutableString;
const JestPrettyFormat = @import("../test/pretty_format.zig").JestPrettyFormat;
const String = bun.String;
const ErrorableString = JSC.ErrorableString;
const JSError = bun.JSError;
const OOM = bun.OOM;

const Api = @import("../../api/schema.zig").Api;

const Bun = JSC.API.Bun;

pub const VM = @import("./VM.zig").VM;
pub const URL = @import("./URL.zig").URL;
pub const ZigString = @import("./ZigString.zig").ZigString;
pub const JSGlobalObject = @import("./JSGlobalObject.zig").JSGlobalObject;
pub const CommonStrings = @import("./CommonStrings.zig").CommonStrings;
pub const WTF = @import("./WTF.zig").WTF;
pub const JSString = @import("./JSString.zig").JSString;
pub const JSObject = @import("./JSObject.zig").JSObject;
pub const JSCell = @import("./JSCell.zig").JSCell;
pub const GetterSetter = @import("./GetterSetter.zig").GetterSetter;
pub const CustomGetterSetter = @import("./CustomGetterSetter.zig").CustomGetterSetter;

pub const DOMURL = opaque {
    pub extern fn WebCore__DOMURL__cast_(JSValue0: JSValue, arg1: *VM) ?*DOMURL;
    pub extern fn WebCore__DOMURL__href_(arg0: ?*DOMURL, arg1: *ZigString) void;
    pub extern fn WebCore__DOMURL__pathname_(arg0: ?*DOMURL, arg1: *ZigString) void;

    pub fn cast_(value: JSValue, vm: *VM) ?*DOMURL {
        return WebCore__DOMURL__cast_(value, vm);
    }

    pub fn cast(value: JSValue) ?*DOMURL {
        return cast_(value, JSC.VirtualMachine.get().global.vm());
    }

    pub fn href_(this: *DOMURL, out: *ZigString) void {
        return WebCore__DOMURL__href_(this, out);
    }

    pub fn href(this: *DOMURL) ZigString {
        var out = ZigString.Empty;
        this.href_(&out);
        return out;
    }

    extern fn WebCore__DOMURL__fileSystemPath(arg0: *DOMURL, error_code: *c_int) bun.String;
    pub const ToFileSystemPathError = error{
        NotFileUrl,
        InvalidPath,
        InvalidHost,
    };
    pub fn fileSystemPath(this: *DOMURL) ToFileSystemPathError!bun.String {
        var error_code: c_int = 0;
        const path = WebCore__DOMURL__fileSystemPath(this, &error_code);
        switch (error_code) {
            1 => return ToFileSystemPathError.InvalidHost,
            2 => return ToFileSystemPathError.InvalidPath,
            3 => return ToFileSystemPathError.NotFileUrl,
            else => {},
        }
        bun.assert(path.tag != .Dead);
        return path;
    }

    pub fn pathname_(this: *DOMURL, out: *ZigString) void {
        return WebCore__DOMURL__pathname_(this, out);
    }

    pub fn pathname(this: *DOMURL) ZigString {
        var out = ZigString.Empty;
        this.pathname_(&out);
        return out;
    }
};
