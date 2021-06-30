pub const js = @import("./JavaScriptCore.zig");
const std = @import("std");
pub usingnamespace @import("../../global.zig");
const javascript = @import("./javascript.zig");
pub const ExceptionValueRef = [*c]js.JSValueRef;
pub const JSValueRef = js.JSValueRef;

pub const To = struct {
    pub const JS = struct {
        pub inline fn str(ref: anytype, val: anytype) js.JSStringRef {
            return js.JSStringCreateWithUTF8CString(val[0.. :0]);
        }

        pub fn functionWithCallback(
            comptime ZigContextType: type,
            zig: *ZigContextType,
            name: js.JSStringRef,
            ctx: js.JSContextRef,
            comptime callback: fn (
                obj: *ZigContextType,
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                thisObject: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef,
        ) js.JSObjectRef {
            var function = js.JSObjectMakeFunctionWithCallback(ctx, name, Callback(ZigContextType, callback).rfn);
            _ = js.JSObjectSetPrivate(
                function,
                @ptrCast(*c_void, @alignCast(@alignOf(*c_void), zig)),
            );
            return function;
        }

        pub fn Callback(
            comptime ZigContextType: type,
            comptime ctxfn: fn (
                obj: *ZigContextType,
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                thisObject: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef,
        ) type {
            return struct {
                pub fn rfn(
                    ctx: js.JSContextRef,
                    function: js.JSObjectRef,
                    thisObject: js.JSObjectRef,
                    argumentCount: usize,
                    arguments: [*c]const js.JSValueRef,
                    exception: js.ExceptionRef,
                ) callconv(.C) js.JSValueRef {
                    var object_ptr_ = js.JSObjectGetPrivate(function);
                    if (object_ptr_ == null) {
                        object_ptr_ = js.JSObjectGetPrivate(thisObject);
                    }

                    if (object_ptr_ == null) {
                        return js.JSValueMakeUndefined(ctx);
                    }

                    var object_ptr = object_ptr_.?;

                    return ctxfn(
                        @ptrCast(*ZigContextType, @alignCast(@alignOf(*ZigContextType), object_ptr)),
                        ctx,
                        function,
                        thisObject,
                        if (arguments) |args| args[0..argumentCount] else &[_]js.JSValueRef{},
                        exception,
                    );
                }
            };
        }
    };

    pub const Ref = struct {
        pub inline fn str(ref: anytype) js.JSStringRef {
            return @as(js.JSStringRef, ref);
        }
    };

    pub const Zig = struct {
        pub inline fn str(ref: anytype, buf: anytype) string {
            return buf[0..js.JSStringGetUTF8CString(Ref.str(ref), buf.ptr, buf.len)];
        }
    };
};

pub const Properties = struct {
    pub const UTF8 = struct {
        pub const module = "module";
        pub const globalThis = "globalThis";
        pub const exports = "exports";
        pub const log = "log";
        pub const debug = "debug";
        pub const name = "name";
        pub const info = "info";
        pub const error_ = "error";
        pub const warn = "warn";
        pub const console = "console";
        pub const require = "require";
        pub const description = "description";
        pub const initialize_bundled_module = "$$m";
        pub const load_module_function = "$lOaDuRcOdE$";
        pub const window = "window";
    };

    pub const UTF16 = struct {
        pub const module: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.module);
        pub const globalThis: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.globalThis);
        pub const exports: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.exports);
        pub const log: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.log);
        pub const debug: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.debug);
        pub const info: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.info);
        pub const error_: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.error_);
        pub const warn: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.warn);
        pub const console: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.console);
        pub const require: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.require);
        pub const description: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.description);
        pub const name: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.name);
        pub const initialize_bundled_module = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.initialize_bundled_module);
        pub const load_module_function: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.load_module_function);
        pub const window: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.window);
    };

    pub const Refs = struct {
        pub var module: js.JSStringRef = null;
        pub var globalThis: js.JSStringRef = null;
        pub var exports: js.JSStringRef = null;
        pub var log: js.JSStringRef = null;
        pub var debug: js.JSStringRef = null;
        pub var info: js.JSStringRef = null;
        pub var error_: js.JSStringRef = null;
        pub var warn: js.JSStringRef = null;
        pub var console: js.JSStringRef = null;
        pub var require: js.JSStringRef = null;
        pub var description: js.JSStringRef = null;
        pub var name: js.JSStringRef = null;
        pub var initialize_bundled_module: js.JSStringRef = null;
        pub var load_module_function: js.JSStringRef = null;
        pub var window: js.JSStringRef = null;
    };

    pub fn init() void {
        inline for (std.meta.fieldNames(UTF8)) |name| {
            @field(Refs, name) = js.JSStringRetain(
                js.JSStringCreateWithCharactersNoCopy(
                    @field(StringStore.UTF16, name).ptr,
                    @field(StringStore.UTF16, name).len - 1,
                ),
            );

            if (isDebug) {
                std.debug.assert(
                    js.JSStringIsEqualToUTF8CString(@field(Refs, name), @field(UTF8, name)[0.. :0]),
                );
            }
        }
    }
};

pub fn NewClass(
    comptime ZigType: type,
    comptime name: string,
    comptime staticFunctions: anytype,
    comptime properties: anytype,
    comptime read_only: bool,
    comptime singleton: bool,
) type {
    return struct {
        const ClassDefinitionCreator = @This();
        const function_names = std.meta.fieldNames(@TypeOf(staticFunctions));
        const names_buf = brk: {
            var total_len: usize = 0;
            for (function_names) |field, i| {
                total_len += std.unicode.utf8ToUtf16LeStringLiteral(field).len;
            }
            var offset: usize = 0;
            var names_buf_ = std.mem.zeroes([total_len]u16);
            for (function_names) |field, i| {
                var name_ = std.unicode.utf8ToUtf16LeStringLiteral(field);
                std.mem.copy(u16, names_buf_[offset .. name_.len + offset], name_[0..]);
                offset += name_.len;
            }
            break :brk names_buf_;
        };
        const function_name_literals: [function_names.len][]const js.JSChar = brk: {
            var names = std.mem.zeroes([function_names.len][]const js.JSChar);
            var len: usize = 0;
            for (function_names) |field, i| {
                const end = len + std.unicode.utf8ToUtf16LeStringLiteral(field).len;
                names[i] = names_buf[len..end];
                len = end;
            }
            break :brk names;
        };
        var function_name_refs: [function_names.len]js.JSStringRef = undefined;
        var class_name_str = name[0.. :0].ptr;

        const class_name_literal = std.unicode.utf8ToUtf16LeStringLiteral(name);
        var static_functions: [function_name_refs.len + 1]js.JSStaticFunction = undefined;
        var instance_functions: [function_names.len]js.JSObjectRef = undefined;
        const property_names = std.meta.fieldNames(@TypeOf(properties));
        var property_name_refs: [property_names.len]js.JSStringRef = undefined;
        const property_name_literals: [property_names.len][]const js.JSChar = brk: {
            var list = std.mem.zeroes([property_names.len][]const js.JSChar);
            for (property_names) |prop_name, i| {
                list[i] = std.unicode.utf8ToUtf16LeStringLiteral(prop_name);
            }
            break :brk list;
        };
        var static_properties: [property_names.len]js.JSStaticValue = undefined;

        pub fn getPropertyCallback(
            ctx: js.JSContextRef,
            obj: js.JSObjectRef,
            prop: js.JSStringRef,
            exception: js.ExceptionRef,
        ) callconv(.C) js.JSValueRef {
            var instance_pointer_ = js.JSObjectGetPrivate(obj);
            if (instance_pointer_ == null) return null;
            var instance_pointer = instance_pointer_.?;
            var ptr = @ptrCast(
                *ZigType,
                @alignCast(
                    @alignOf(
                        *ZigType,
                    ),
                    instance_pointer,
                ),
            );

            if (singleton) {
                inline for (function_names) |propname, i| {
                    if (js.JSStringIsEqual(prop, function_name_refs[i])) {
                        return instance_functions[i];
                    }
                }
                if (comptime std.meta.trait.hasFn("onMissingProperty")(ZigType)) {
                    return ptr.onMissingProperty(ctx, obj, prop, exception);
                }
            } else {
                inline for (property_names) |propname, i| {
                    if (js.JSStringIsEqual(prop, property_name_refs[i])) {
                        return @field(
                            properties,
                            propname,
                        )(ptr, ctx, obj, exception);
                    }
                }

                if (comptime std.meta.trait.hasFn("onMissingProperty")(ZigType)) {
                    return ptr.onMissingProperty(ctx, obj, prop, exception);
                }
            }

            return js.JSValueMakeUndefined(ctx);
        }

        fn StaticProperty(comptime id: usize) type {
            return struct {
                pub fn getter(
                    ctx: js.JSContextRef,
                    obj: js.JSObjectRef,
                    prop: js.JSStringRef,
                    exception: js.ExceptionRef,
                ) callconv(.C) js.JSValueRef {
                    var instance_pointer_ = js.JSObjectGetPrivate(obj);
                    if (instance_pointer_ == null) return null;
                    var this: *ZigType = @ptrCast(
                        *ZigType,
                        @alignCast(
                            @alignOf(
                                *ZigType,
                            ),
                            instance_pointer_.?,
                        ),
                    );

                    var exc: js.ExceptionRef = null;

                    switch (comptime @typeInfo(@TypeOf(@field(
                        properties,
                        property_names[id],
                    )))) {
                        .Fn => {
                            return @field(
                                properties,
                                property_names[id],
                            )(
                                this,
                                ctx,
                                obj,
                                exception,
                            );
                        },
                        .Struct => {
                            return @field(
                                @field(
                                    properties,
                                    property_names[id],
                                ),
                                "get",
                            )(
                                this,
                                ctx,
                                obj,
                                prop,
                                exception,
                            );
                        },
                        else => unreachable,
                    }
                }

                pub fn setter(
                    ctx: js.JSContextRef,
                    obj: js.JSObjectRef,
                    prop: js.JSStringRef,
                    value: js.JSValueRef,
                    exception: js.ExceptionRef,
                ) callconv(.C) bool {
                    var instance_pointer_ = js.JSObjectGetPrivate(obj);
                    if (instance_pointer_ == null) return false;
                    var this: *ZigType = @ptrCast(
                        *ZigType,
                        @alignCast(
                            @alignOf(
                                *ZigType,
                            ),
                            instance_pointer_.?,
                        ),
                    );

                    var exc: js.ExceptionRef = null;

                    switch (comptime @typeInfo(@TypeOf(@field(
                        properties,
                        property_names[id],
                    )))) {
                        .Struct => {
                            return @field(
                                @field(
                                    properties,
                                    property_names[id],
                                ),
                                "set",
                            )(
                                this,
                                ctx,
                                obj,
                                prop,
                                value,
                                exception,
                            );
                        },
                        else => unreachable,
                    }
                }
            };
        }

        pub fn define() js.JSClassDefinition {
            var def = js.kJSClassDefinitionEmpty;

            if (static_functions.len > 0) {
                std.mem.set(js.JSStaticFunction, &static_functions, std.mem.zeroes(js.JSStaticFunction));
                var count: usize = 0;
                inline for (function_name_literals) |function_name, i| {
                    if (comptime strings.eqlComptime(function_names[i], "constructor")) {
                        def.callAsConstructor = @field(staticFunctions, function_names[i]);
                    } else {
                        count += 1;
                        var callback = To.JS.Callback(ZigType, @field(staticFunctions, function_names[i])).rfn;
                        static_functions[count] = js.JSStaticFunction{
                            .name = (function_names[i][0.. :0]).ptr,
                            .callAsFunction = callback,
                            .attributes = comptime if (read_only) js.JSPropertyAttributes.kJSPropertyAttributeReadOnly else js.JSPropertyAttributes.kJSPropertyAttributeNone,
                        };
                    }

                    // if (singleton) {
                    //     var function = js.JSObjectMakeFunctionWithCallback(ctx, function_name_refs[i], callback);
                    //     instance_functions[i] = function;
                    // }
                }

                def.staticFunctions = static_functions[0..count].ptr;
            }

            if (property_names.len > 0) {
                inline for (comptime property_name_literals) |prop_name, i| {
                    property_name_refs[i] = js.JSStringCreateWithCharactersNoCopy(
                        prop_name.ptr,
                        prop_name.len,
                    );
                    static_properties[i] = std.mem.zeroes(js.JSStaticValue);
                    static_properties[i].getProperty = StaticProperty(i).getter;

                    const field = comptime @field(properties, property_names[i]);
                    const hasSetter = std.meta.trait.hasField("set");
                    if (comptime hasSetter(@TypeOf(field))) {
                        static_properties[i].setProperty = StaticProperty(i).setter;
                    }
                    static_properties[i].name = property_names[i][0.. :0];
                }

                def.staticValues = (&static_properties);
            }

            def.className = class_name_str;
            // def.getProperty = getPropertyCallback;

            def.finalize

            return def;
        }
    };
}

threadlocal var error_args: [1]js.JSValueRef = undefined;
pub fn JSError(
    allocator: *std.mem.Allocator,
    comptime fmt: string,
    args: anytype,
    ctx: js.JSContextRef,
    exception: ExceptionValueRef,
) void {
    if (comptime std.meta.fields(@TypeOf(args)).len == 0) {
        var message = js.JSStringCreateWithUTF8CString(fmt[0.. :0]);
        defer js.JSStringRelease(message);
        error_args[0] = js.JSValueMakeString(ctx, message);
        exception.* = js.JSObjectMakeError(ctx, 1, &error_args, null);
    } else {
        var buf = std.fmt.allocPrintZ(allocator, fmt, args) catch unreachable;
        var message = js.JSStringCreateWithUTF8CString(buf);
        defer js.JSStringRelease(message);
        defer allocator.free(buf);
        error_args[0] = js.JSValueMakeString(ctx, message);
        exception.* = js.JSObjectMakeError(ctx, 1, &error_args, null);
    }
}

pub fn getAllocator(ctx: js.JSContextRef) *std.mem.Allocator {
    var global_obj = js.JSContextGetGlobalObject(ctx);
    var priv = js.JSObjectGetPrivate(global_obj).?;
    var global = @ptrCast(*javascript.GlobalObject, @alignCast(@alignOf(*javascript.GlobalObject), priv));

    return global.vm.allocator;
}

pub const JSStringList = std.ArrayList(js.JSStringRef);

pub const ArrayBuffer = struct {
    ptr: [*]u8 = undefined,
    offset: u32,
    // for the array type,
    len: u32,

    byte_len: u32,

    typed_array_type: js.JSTypedArrayType,
};
