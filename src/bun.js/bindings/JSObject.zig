const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const Shimmer = JSC.Shimmer;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;

pub const JSObject = extern struct {
    pub const shim = Shimmer("JSC", "JSObject", @This());
    const cppFn = shim.cppFn;

    pub fn toJS(obj: *JSObject) JSValue {
        return JSValue.fromCell(obj);
    }

    /// Non-objects will be runtime-coerced to objects.
    ///
    /// For cells this is `toObjectSlow`, for other types it's `toObjectSlowCase`.
    pub fn fromJS(value: JSValue, globalThis: JSValue) *JSObject {
        return JSValue.toObject(value, globalThis);
    }

    /// Returns `null` if the value is not an object.
    pub fn tryFromJS(maybe_obj: JSValue, globalThis: *JSC.JSGlobalObject) ?*JSObject {
        return JSValue.asObject(maybe_obj, globalThis);
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

    pub inline fn put(obj: *JSObject, global: *JSGlobalObject, key: anytype, value: JSValue) !void {
        obj.toJS().put(global, key, value);
    }

    pub inline fn putAllFromStruct(obj: *JSObject, global: *JSGlobalObject, properties: anytype) !void {
        inline for (comptime std.meta.fieldNames(@TypeOf(properties))) |field| {
            try obj.put(global, field, @field(properties, field));
        }
    }

    /// Equivalent to `target[property]`. Calls userland getters/proxies.  Can
    /// throw. Null indicates the property does not exist. JavaScript undefined
    /// and JavaScript null can exist as a property and is different than zig
    /// `null` (property does not exist).
    ///
    /// `property` must be either `[]const u8`. A comptime slice may defer to
    /// calling `fastGet`, which use a more optimal code path. This function is
    /// marked `inline` to allow Zig to determine if `fastGet` should be used
    /// per invocation.
    pub inline fn get(target: *JSObject, global: *JSGlobalObject, property: anytype) bun.JSError!?JSValue {
        const property_slice: []const u8 = property; // must be a slice!

        // This call requires `get` to be `inline`
        if (bun.isComptimeKnown(property_slice)) {
            if (comptime JSValue.BuiltinName.get(property_slice)) |builtin_name| {
                return target.fastGetWithError(global, builtin_name);
            }
        }

        return switch (JSC__JSObject__getIfPropertyExistsImpl(target, global, property_slice.ptr, @intCast(property_slice.len))) {
            .zero => error.JSError,
            .property_does_not_exist_on_object => null,

            // TODO: see bug described in ObjectBindings.cpp
            // since there are false positives, the better path is to make them
            // negatives, as the number of places that desire throwing on
            // existing undefined is extremely small, but non-zero.
            .undefined => null,
            else => |val| val,
        };
    }
    extern fn JSC__JSObject__getIfPropertyExistsImpl(object: *JSObject, global: *JSGlobalObject, ptr: [*]const u8, len: u32) JSValue;

    pub fn fastGetWithError(this: *JSObject, global: *JSGlobalObject, builtin_name: JSValue.BuiltinName) bun.JSError!?JSValue {
        return switch (JSC__JSObject__fastGet(this, global, @intFromEnum(builtin_name))) {
            .zero => error.JSError,
            .undefined => null,
            .property_does_not_exist_on_object => null,
            else => |val| val,
        };
    }
    extern fn JSC__JSObject__fastGet(object: *JSObject, global: *JSGlobalObject, builtin_name: u32) JSValue;

    extern fn JSC__createStructure(*JSC.JSGlobalObject, *JSC.JSCell, u32, names: [*]ExternColumnIdentifier) JSC.JSValue;

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
    extern fn JSC__JSObject__create(global_object: *JSGlobalObject, length: usize, ctx: *anyopaque, initializer: InitializeCallback) JSValue;

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
        return cppFn("getIndex", .{
            this,
            globalThis,
            i,
        });
    }

    pub fn putRecord(this: *JSObject, global: *JSGlobalObject, key: *ZigString, values: []ZigString) void {
        return cppFn("putRecord", .{ this, global, key, values.ptr, values.len });
    }

    extern fn Bun__JSObject__getCodePropertyVMInquiry(*JSGlobalObject, *JSObject) JSValue;

    /// This will not call getters or be observable from JavaScript.
    pub fn getCodePropertyVMInquiry(obj: *JSObject, global: *JSGlobalObject) ?JSValue {
        const v = Bun__JSObject__getCodePropertyVMInquiry(global, obj);
        if (v == .zero) return null;
        return v;
    }
};
