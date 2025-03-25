const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;
const JSError = bun.JSError;

pub const JSObject = opaque {
    extern fn JSC__JSObject__getIndex(this: JSValue, globalThis: *JSGlobalObject, i: u32) JSValue;
    extern fn JSC__JSObject__putRecord(this: *JSObject, global: *JSGlobalObject, key: *ZigString, values: [*]ZigString, len: usize) void;
    extern fn Bun__JSObject__getCodePropertyVMInquiry(global: *JSGlobalObject, obj: *JSObject) JSValue;
    extern fn JSC__createStructure(global: *JSC.JSGlobalObject, owner: *JSC.JSCell, length: u32, names: [*]ExternColumnIdentifier) JSC.JSValue;
    extern fn JSC__JSObject__create(global_object: *JSGlobalObject, length: usize, ctx: *anyopaque, initializer: InitializeCallback) JSValue;

    pub fn toJS(obj: *JSObject) JSValue {
        return JSValue.fromCell(obj);
    }

    /// Marshall a struct instance into a JSObject, copying its properties.
    ///
    /// Each field will be encoded with `JSC.toJS`. Fields whose types have a
    /// `toJS` method will have it called to encode.
    ///
    /// This method is equivalent to `Object.create(...)` + setting properties,
    /// and is only intended for creating POJOs.
    pub fn create(pojo: anytype, global: *JSGlobalObject) *JSObject {
        return createFromStructWithPrototype(@TypeOf(pojo), pojo, global, false);
    }
    /// Marshall a struct into a JSObject, copying its properties. It's
    /// `__proto__` will be `null`.
    ///
    /// Each field will be encoded with `JSC.toJS`. Fields whose types have a
    /// `toJS` method will have it called to encode.
    ///
    /// This is roughly equivalent to creating an object with
    /// `Object.create(null)` and adding properties to it.
    pub fn createNullProto(pojo: anytype, global: *JSGlobalObject) *JSObject {
        return createFromStructWithPrototype(@TypeOf(pojo), pojo, global, true);
    }

    /// Marshall a struct instance into a JSObject. `pojo` is borrowed.
    ///
    /// Each field will be encoded with `JSC.toJS`. Fields whose types have a
    /// `toJS` method will have it called to encode.
    ///
    /// This method is equivalent to `Object.create(...)` + setting properties,
    /// and is only intended for creating POJOs.
    ///
    /// The object's prototype with either be `null` or `ObjectPrototype`
    /// depending on whether `null_prototype` is set. Prefer using the object
    /// prototype (`null_prototype = false`) unless you have a good reason not
    /// to.
    fn createFromStructWithPrototype(comptime T: type, pojo: T, global: *JSGlobalObject, comptime null_prototype: bool) *JSObject {
        const info: std.builtin.Type.Struct = @typeInfo(T).@"struct";

        const obj = obj: {
            const val = if (comptime null_prototype)
                JSValue.createEmptyObjectWithNullPrototype(global)
            else
                JSValue.createEmptyObject(global, comptime info.fields.len);
            if (bun.Environment.isDebug)
                bun.assert(val.isObject());
            break :obj val.uncheckedPtrCast(JSObject);
        };

        const cell = toJS(obj);
        inline for (info.fields) |field| {
            const property = @field(pojo, field.name);
            cell.put(
                global,
                field.name,
                JSC.toJS(global, @TypeOf(property), property, .temporary),
            );
        }

        return obj;
    }

    pub fn get(obj: *JSObject, global: *JSGlobalObject, prop: anytype) JSError!?JSValue {
        return obj.toJS().get(global, prop);
    }

    pub inline fn put(obj: *JSObject, global: *JSGlobalObject, key: anytype, value: JSValue) !void {
        obj.toJS().put(global, key, value);
    }

    pub inline fn putAllFromStruct(obj: *JSObject, global: *JSGlobalObject, properties: anytype) !void {
        inline for (comptime std.meta.fieldNames(@TypeOf(properties))) |field| {
            try obj.put(global, field, @field(properties, field));
        }
    }

    /// When the GC sees a JSValue referenced in the stack, it knows not to free it
    /// This mimics the implementation in JavaScriptCore's C++
    pub inline fn ensureStillAlive(this: *JSObject) void {
        std.mem.doNotOptimizeAway(this);
    }

    pub const ExternColumnIdentifier = extern struct {
        tag: u8 = 0,
        value: extern union {
            index: u32,
            name: bun.String,
        },

        pub fn string(this: *ExternColumnIdentifier) ?*bun.String {
            return switch (this.tag) {
                2 => &this.value.name,
                else => null,
            };
        }

        pub fn deinit(this: *ExternColumnIdentifier) void {
            if (this.string()) |str| {
                str.deref();
            }
        }
    };

    pub fn createStructure(global: *JSGlobalObject, owner: JSC.JSValue, length: u32, names: [*]ExternColumnIdentifier) JSValue {
        JSC.markBinding(@src());
        return JSC__createStructure(global, owner.asCell(), length, names);
    }

    const InitializeCallback = *const fn (ctx: *anyopaque, obj: *JSObject, global: *JSGlobalObject) callconv(.C) void;

    pub fn Initializer(comptime Ctx: type, comptime func: fn (*Ctx, obj: *JSObject, global: *JSGlobalObject) void) type {
        return struct {
            pub fn call(this: *anyopaque, obj: *JSObject, global: *JSGlobalObject) callconv(.C) void {
                @call(bun.callmod_inline, func, .{ @as(*Ctx, @ptrCast(@alignCast(this))), obj, global });
            }
        };
    }

    pub fn createWithInitializer(comptime Ctx: type, creator: *Ctx, global: *JSGlobalObject, length: usize) JSValue {
        const Type = Initializer(Ctx, Ctx.create);
        return JSC__JSObject__create(global, length, creator, Type.call);
    }

    pub fn getIndex(this: JSValue, globalThis: *JSGlobalObject, i: u32) JSValue {
        return JSC__JSObject__getIndex(this, globalThis, i);
    }

    pub fn putRecord(this: *JSObject, global: *JSGlobalObject, key: *ZigString, values: []ZigString) void {
        return JSC__JSObject__putRecord(this, global, key, values.ptr, values.len);
    }

    /// This will not call getters or be observable from JavaScript.
    pub fn getCodePropertyVMInquiry(obj: *JSObject, global: *JSGlobalObject) ?JSValue {
        const v = Bun__JSObject__getCodePropertyVMInquiry(global, obj);
        if (v == .zero) return null;
        return v;
    }
};
