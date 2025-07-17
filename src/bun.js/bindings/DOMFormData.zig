const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const VM = JSC.VM;
const ZigString = JSC.ZigString;

pub const DOMFormData = opaque {
    extern fn WebCore__DOMFormData__cast_(JSValue0: JSValue, arg1: *VM) ?*DOMFormData;
    extern fn WebCore__DOMFormData__create(arg0: *JSGlobalObject) JSValue;
    extern fn WebCore__DOMFormData__createFromURLQuery(arg0: *JSGlobalObject, arg1: *ZigString) JSValue;
    extern fn WebCore__DOMFormData__toQueryString(arg0: *DOMFormData, arg1: *anyopaque, arg2: *const fn (arg0: *anyopaque, *ZigString) callconv(.C) void) void;
    extern fn WebCore__DOMFormData__fromJS(JSValue0: JSValue) ?*DOMFormData;
    extern fn WebCore__DOMFormData__append(arg0: *DOMFormData, arg1: *ZigString, arg2: *ZigString) void;
    extern fn WebCore__DOMFormData__appendBlob(arg0: *DOMFormData, arg1: *JSGlobalObject, arg2: *ZigString, arg3: *anyopaque, arg4: *ZigString) void;
    extern fn WebCore__DOMFormData__count(arg0: *DOMFormData) usize;

    pub fn create(
        global: *JSGlobalObject,
    ) JSValue {
        return WebCore__DOMFormData__create(global);
    }

    pub fn createFromURLQuery(
        global: *JSGlobalObject,
        query: *ZigString,
    ) JSValue {
        return WebCore__DOMFormData__createFromURLQuery(global, query);
    }

    extern fn DOMFormData__toQueryString(
        *DOMFormData,
        ctx: *anyopaque,
        callback: *const fn (ctx: *anyopaque, *ZigString) callconv(.C) void,
    ) void;

    pub fn toQueryString(
        this: *DOMFormData,
        comptime Ctx: type,
        ctx: Ctx,
        comptime callback: fn (ctx: Ctx, ZigString) callconv(.C) void,
    ) void {
        const Wrapper = struct {
            const cb = callback;
            pub fn run(c: *anyopaque, str: *ZigString) callconv(.C) void {
                cb(@as(Ctx, @ptrCast(c)), str.*);
            }
        };

        WebCore__DOMFormData__toQueryString(this, ctx, &Wrapper.run);
    }

    pub fn fromJS(value: JSValue) ?*DOMFormData {
        return WebCore__DOMFormData__fromJS(value);
    }

    pub fn append(
        this: *DOMFormData,
        name_: *ZigString,
        value_: *ZigString,
    ) void {
        WebCore__DOMFormData__append(this, name_, value_);
    }

    pub fn appendBlob(
        this: *DOMFormData,
        global: *JSC.JSGlobalObject,
        name_: *ZigString,
        blob: *anyopaque,
        filename_: *ZigString,
    ) void {
        return WebCore__DOMFormData__appendBlob(this, global, name_, blob, filename_);
    }

    pub fn count(
        this: *DOMFormData,
    ) usize {
        return WebCore__DOMFormData__count(this);
    }

    const ForEachFunction = *const fn (
        ctx_ptr: ?*anyopaque,
        name: *ZigString,
        value_ptr: *anyopaque,
        filename: ?*ZigString,
        is_blob: u8,
    ) callconv(.C) void;

    extern fn DOMFormData__forEach(*DOMFormData, ?*anyopaque, ForEachFunction) void;
    pub const FormDataEntry = union(enum) {
        string: ZigString,
        file: struct {
            blob: *JSC.WebCore.Blob,
            filename: ZigString,
        },
    };
    pub fn forEach(
        this: *DOMFormData,
        comptime Context: type,
        ctx: *Context,
        comptime callback_wrapper: *const fn (ctx: *Context, name: ZigString, value: FormDataEntry) void,
    ) void {
        const Wrap = struct {
            const wrapper = callback_wrapper;
            pub fn forEachWrapper(
                ctx_ptr: ?*anyopaque,
                name_: *ZigString,
                value_ptr: *anyopaque,
                filename: ?*ZigString,
                is_blob: u8,
            ) callconv(.C) void {
                const ctx_ = bun.cast(*Context, ctx_ptr.?);
                const value = if (is_blob == 0)
                    FormDataEntry{ .string = bun.cast(*ZigString, value_ptr).* }
                else
                    FormDataEntry{
                        .file = .{
                            .blob = bun.cast(*JSC.WebCore.Blob, value_ptr),
                            .filename = (filename orelse &ZigString.Empty).*,
                        },
                    };

                wrapper(ctx_, name_.*, value);
            }
        };
        JSC.markBinding(@src());
        DOMFormData__forEach(this, ctx, Wrap.forEachWrapper);
    }
};
