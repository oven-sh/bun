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

        pub fn Finalize(
            comptime ZigContextType: type,
            comptime ctxfn: fn (
                this: *ZigContextType,
                object: js.JSObjectRef,
            ) void,
        ) type {
            return struct {
                pub fn rfn(
                    object: js.JSObjectRef,
                ) callconv(.C) void {
                    var object_ptr_ = js.JSObjectGetPrivate(object);
                    if (object_ptr_ == null) return;

                    return ctxfn(
                        @ptrCast(*ZigContextType, @alignCast(@alignOf(*ZigContextType), object_ptr_.?)),
                        object,
                    );
                }
            };
        }

        pub fn Constructor(
            comptime ctxfn: fn (
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef,
        ) type {
            return struct {
                pub fn rfn(
                    ctx: js.JSContextRef,
                    function: js.JSObjectRef,
                    argumentCount: usize,
                    arguments: [*c]const js.JSValueRef,
                    exception: js.ExceptionRef,
                ) callconv(.C) js.JSValueRef {
                    return ctxfn(
                        ctx,
                        function,
                        if (arguments) |args| args[0..argumentCount] else &[_]js.JSValueRef{},
                        exception,
                    );
                }
            };
        }
        pub fn ConstructorCallback(
            comptime ctxfn: fn (
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef,
        ) type {
            return struct {
                pub fn rfn(
                    ctx: js.JSContextRef,
                    function: js.JSObjectRef,
                    argumentCount: usize,
                    arguments: [*c]const js.JSValueRef,
                    exception: js.ExceptionRef,
                ) callconv(.C) js.JSValueRef {
                    return ctxfn(
                        ctx,
                        function,
                        if (arguments) |args| args[0..argumentCount] else &[_]js.JSValueRef{},
                        exception,
                    );
                }
            };
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

pub const RuntimeImports = struct {
    pub fn resolve(ctx: js.JSContextRef, str: string) ?js.JSObjectRef {
        switch (ModuleList.Map.get(str) orelse ModuleList.none) {
            .Router => {
                const Router = @import("./api/router.zig");
                return js.JSObjectMake(ctx, Router.Class.get().*, null);
            },
            else => {
                return null;
            },
        }
    }

    pub const ModuleList = enum(u8) {
        Router = 0,
        none = std.math.maxInt(u8),

        pub const Map = std.ComptimeStringMap(
            ModuleList,
            .{
                .{ "speedy.js/router", ModuleList.Router },
            },
        );
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
        pub const default = "default";
        pub const include = "include";

        pub const GET = "GET";
        pub const PUT = "PUT";
        pub const POST = "POST";
        pub const PATCH = "PATCH";
        pub const HEAD = "HEAD";
        pub const OPTIONS = "OPTIONS";

        pub const navigate = "navigate";
        pub const follow = "follow";
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
        pub const default: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.default);
        pub const include: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.include);

        pub const GET: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.GET);
        pub const PUT: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.PUT);
        pub const POST: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.POST);
        pub const PATCH: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.PATCH);
        pub const HEAD: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.HEAD);
        pub const OPTIONS: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.OPTIONS);

        pub const navigate: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.navigate);
        pub const follow: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.follow);
    };

    pub const Refs = struct {
        pub var module: js.JSStringRef = undefined;
        pub var globalThis: js.JSStringRef = undefined;
        pub var exports: js.JSStringRef = undefined;
        pub var log: js.JSStringRef = undefined;
        pub var debug: js.JSStringRef = undefined;
        pub var info: js.JSStringRef = undefined;
        pub var error_: js.JSStringRef = undefined;
        pub var warn: js.JSStringRef = undefined;
        pub var console: js.JSStringRef = undefined;
        pub var require: js.JSStringRef = undefined;
        pub var description: js.JSStringRef = undefined;
        pub var name: js.JSStringRef = undefined;
        pub var initialize_bundled_module: js.JSStringRef = undefined;
        pub var load_module_function: js.JSStringRef = undefined;
        pub var window: js.JSStringRef = undefined;
        pub var default: js.JSStringRef = undefined;
        pub var include: js.JSStringRef = undefined;
        pub var GET: js.JSStringRef = undefined;
        pub var PUT: js.JSStringRef = undefined;
        pub var POST: js.JSStringRef = undefined;
        pub var PATCH: js.JSStringRef = undefined;
        pub var HEAD: js.JSStringRef = undefined;
        pub var OPTIONS: js.JSStringRef = undefined;

        pub var empty_string_ptr = [_]u8{0};
        pub var empty_string: js.JSStringRef = undefined;

        pub var navigate: js.JSStringRef = undefined;
        pub var follow: js.JSStringRef = undefined;
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

        Refs.empty_string = js.JSStringCreateWithUTF8CString(&Refs.empty_string_ptr);
    }
};

const hasSetter = std.meta.trait.hasField("set");
const hasReadOnly = std.meta.trait.hasField("ro");
const hasFinalize = std.meta.trait.hasField("finalize");
const hasTypeScript = std.meta.trait.hasField("ts");

pub const d = struct {
    pub const ts = struct {
        @"return": string = "",
        tsdoc: string = "",
        name: string = "",
        read_only: ?bool = null,
        args: []const arg = &[_]arg{},
        splat_args: bool = false,

        pub const builder = struct {
            classes: []class,
        };

        pub const class = struct {
            path: string = "",
            name: string = "",
            tsdoc: string = "",
            @"return": string = "",
            read_only: ?bool = null,
            interface: bool = true,
            global: bool = false,

            properties: []ts = &[_]ts{},
            functions: []ts = &[_]ts{},

            pub const Printer = struct {
                const indent_level = 2;
                pub fn printIndented(comptime fmt: string, args: anytype, comptime indent: usize) string {
                    comptime var buf: string = "";
                    comptime buf = buf ++ " " ** indent;

                    return comptime buf ++ std.fmt.comptimePrint(fmt, args);
                }

                pub fn printVar(comptime property: d.ts, comptime indent: usize) string {
                    comptime var buf: string = "";
                    comptime buf = buf ++ " " ** indent;

                    comptime {
                        if (property.read_only orelse false) {
                            buf = buf ++ "readonly ";
                        }

                        buf = buf ++ "var ";
                        buf = buf ++ property.name;
                        buf = buf ++ ": ";

                        if (property.@"return".len > 0) {
                            buf = buf ++ property.@"return";
                        } else {
                            buf = buf ++ "any";
                        }

                        buf = buf ++ ";\n";
                    }

                    comptime {
                        if (property.tsdoc.len > 0) {
                            buf = printTSDoc(property.tsdoc, indent) ++ buf;
                        }
                    }

                    return buf;
                }

                pub fn printProperty(comptime property: d.ts, comptime indent: usize) string {
                    comptime var buf: string = "";
                    comptime buf = buf ++ " " ** indent;

                    comptime {
                        if (property.read_only orelse false) {
                            buf = buf ++ "readonly ";
                        }

                        buf = buf ++ property.name;
                        buf = buf ++ ": ";

                        if (property.@"return".len > 0) {
                            buf = buf ++ property.@"return";
                        } else {
                            buf = buf ++ "any";
                        }

                        buf = buf ++ ";\n";
                    }

                    comptime {
                        if (property.tsdoc.len > 0) {
                            buf = printTSDoc(property.tsdoc, indent) ++ buf;
                        }
                    }

                    return buf;
                }
                pub fn printInstanceFunction(comptime func: d.ts, comptime _indent: usize, comptime no_type: bool) string {
                    comptime var indent = _indent;
                    comptime var buf: string = "";

                    comptime {
                        var args: string = "";
                        for (func.args) |a, i| {
                            if (i > 0) {
                                args = args ++ ", ";
                            }
                            args = args ++ printArg(a);
                        }

                        if (no_type) {
                            buf = buf ++ printIndented("{s}({s});\n", .{
                                func.name,
                                args,
                            }, indent);
                        } else {
                            buf = buf ++ printIndented("{s}({s}): {s};\n", .{
                                func.name,
                                args,
                                func.@"return",
                            }, indent);
                        }
                    }

                    comptime {
                        if (func.tsdoc.len > 0) {
                            buf = printTSDoc(func.tsdoc, indent) ++ buf;
                        }
                    }

                    return buf;
                }
                pub fn printFunction(comptime func: d.ts, comptime _indent: usize, comptime no_type: bool) string {
                    comptime var indent = _indent;
                    comptime var buf: string = "";

                    comptime {
                        var args: string = "";
                        for (func.args) |a, i| {
                            if (i > 0) {
                                args = args ++ ", ";
                            }
                            args = args ++ printArg(a);
                        }

                        if (no_type) {
                            buf = buf ++ printIndented("function {s}({s});\n", .{
                                func.name,
                                args,
                            }, indent);
                        } else {
                            buf = buf ++ printIndented("function {s}({s}): {s};\n", .{
                                func.name,
                                args,
                                func.@"return",
                            }, indent);
                        }
                    }

                    comptime {
                        if (func.tsdoc.len > 0) {
                            buf = printTSDoc(func.tsdoc, indent) ++ buf;
                        }
                    }

                    return buf;
                }
                pub fn printArg(
                    comptime _arg: d.ts.arg,
                ) string {
                    comptime var buf: string = "";
                    comptime {
                        buf = buf ++ _arg.name;
                        buf = buf ++ ": ";

                        if (_arg.@"return".len == 0) {
                            buf = buf ++ "any";
                        } else {
                            buf = buf ++ _arg.@"return";
                        }
                    }

                    return buf;
                }
                pub fn printClass(comptime klass: d.ts.class, comptime _indent: usize) string {
                    comptime var indent = _indent;
                    comptime var buf: string = "";
                    comptime brk: {
                        if (klass.path.len > 0) {
                            buf = buf ++ printIndented("declare module \"{s}\" {{\n\n", .{klass.path}, indent);
                            indent += indent_level;
                        }
                        if (klass.tsdoc.len > 0) {
                            buf = buf ++ printTSDoc(klass.tsdoc, indent);
                        }

                        const qualifier = if (klass.path.len == 0 and !klass.interface) "declare " else "";
                        var stmt: string = qualifier;

                        if (!klass.global) {
                            if (klass.interface) {
                                buf = buf ++ printIndented("export interface {s} {{\n", .{klass.name}, indent);
                            } else {
                                buf = buf ++ printIndented("{s}class {s} {{\n", .{ qualifier, klass.name }, indent);
                            }

                            indent += indent_level;
                        }

                        var did_print_constructor = false;
                        for (klass.functions) |func, i| {
                            if (!strings.eqlComptime(func.name, "constructor")) continue;
                            did_print_constructor = true;
                            buf = buf ++ printInstanceFunction(
                                func,
                                indent,
                                !klass.interface,
                            );
                        }

                        for (klass.properties) |property, i| {
                            if (i > 0 or did_print_constructor) {
                                buf = buf ++ "\n";
                            }

                            if (!klass.global) {
                                buf = buf ++ printProperty(property, indent);
                            } else {
                                buf = buf ++ printVar(property, indent);
                            }
                        }

                        buf = buf ++ "\n";

                        for (klass.functions) |func, i| {
                            if (i > 0) {
                                buf = buf ++ "\n";
                            }

                            if (strings.eqlComptime(func.name, "constructor")) continue;

                            if (!klass.global) {
                                buf = buf ++ printInstanceFunction(
                                    func,
                                    indent,
                                    false,
                                );
                            } else {
                                buf = buf ++ printFunction(
                                    func,
                                    indent,
                                    false,
                                );
                            }
                        }

                        indent -= indent_level;

                        buf = buf ++ printIndented("}}\n", .{}, indent);

                        if (klass.path.len > 0) {
                            buf = buf ++ printIndented("export = {s};\n", .{klass.name}, indent);
                            indent -= indent_level;
                            buf = buf ++ printIndented("\n}}\n", .{}, indent);
                        }

                        break :brk;
                    }
                    return comptime buf;
                }

                pub fn printTSDoc(comptime str: string, comptime indent: usize) string {
                    comptime var buf: string = "";

                    comptime brk: {
                        var splitter = std.mem.split(str, "\n");

                        const first = splitter.next() orelse break :brk;
                        const second = splitter.next() orelse {
                            buf = buf ++ printIndented("/**  {s}  */\n", .{std.mem.trim(u8, first, " ")}, indent);
                            break :brk;
                        };
                        buf = buf ++ printIndented("/**\n", .{}, indent);
                        buf = buf ++ printIndented(" *  {s}\n", .{std.mem.trim(u8, first, " ")}, indent);
                        buf = buf ++ printIndented(" *  {s}\n", .{std.mem.trim(u8, second, " ")}, indent);
                        while (splitter.next()) |line| {
                            buf = buf ++ printIndented(" *  {s}\n", .{std.mem.trim(u8, line, " ")}, indent);
                        }
                        buf = buf ++ printIndented("*/\n", .{}, indent);
                    }

                    return buf;
                }
            };
        };

        pub const arg = struct {
            name: string = "",
            @"return": string = "any",
            optional: bool = false,
        };
    };
};

// This should only exist at compile-time.
pub const ClassOptions = struct {
    name: string,

    read_only: bool = false,
    singleton: bool = false,
    ts: d.ts.class = d.ts.class{},
};

pub fn NewClass(
    comptime ZigType: type,
    comptime options: ClassOptions,
    comptime staticFunctions: anytype,
    comptime properties: anytype,
) type {
    const read_only = options.read_only;
    const singleton = options.singleton;

    return struct {
        const name = options.name;
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

        pub var ref: js.JSClassRef = null;
        pub var loaded = false;
        pub var definition: js.JSClassDefinition = undefined;
        const ConstructorWrapper = struct {
            pub fn rfn(
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                thisObject: js.JSObjectRef,
                argumentCount: usize,
                arguments: [*c]const js.JSValueRef,
                exception: js.ExceptionRef,
            ) callconv(.C) js.JSValueRef {
                return definition.callAsConstructor.?(ctx, function, argumentCount, arguments, exception);
            }
        };

        pub const Constructor = ConstructorWrapper.rfn;

        pub const static_value_count = static_properties.len;

        pub fn get() callconv(.C) [*c]js.JSClassRef {
            if (!loaded) {
                loaded = true;
                definition = define();
                ref = js.JSClassRetain(js.JSClassCreate(&definition));
            }
            return &ref;
        }

        pub fn RawGetter(comptime ReceiverType: type) type {
            const ClassGetter = struct {
                pub fn getter(
                    ctx: js.JSContextRef,
                    obj: js.JSObjectRef,
                    prop: js.JSStringRef,
                    exception: js.ExceptionRef,
                ) callconv(.C) js.JSValueRef {
                    return js.JSObjectMake(ctx, get().*, null);
                }
            };

            return ClassGetter;
        }

        pub fn GetClass(comptime ReceiverType: type) type {
            const ClassGetter = struct {
                pub fn getter(
                    receiver: *ReceiverType,
                    ctx: js.JSContextRef,
                    obj: js.JSObjectRef,
                    exception: js.ExceptionRef,
                ) js.JSValueRef {
                    return js.JSObjectMake(ctx, get().*, null);
                }
            };

            return ClassGetter;
        }

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

                    var exc: js.JSValueRef = null;

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

        // This should only be run at comptime
        pub fn typescriptDeclaration() d.ts.class {
            comptime var class = options.ts;

            comptime {
                if (class.name.len == 0) {
                    class.name = options.name;
                }

                if (class.read_only == null) {
                    class.read_only = options.read_only;
                }

                if (static_functions.len > 0) {
                    var count: usize = 0;
                    inline for (function_name_literals) |function_name, i| {
                        const func = @field(staticFunctions, function_names[i]);
                        const Func = @TypeOf(func);

                        switch (@typeInfo(Func)) {
                            .Struct => {
                                if (hasTypeScript(Func)) {
                                    count += 1;
                                }
                            },
                            else => continue,
                        }
                    }

                    var funcs = std.mem.zeroes([count]d.ts);
                    class.functions = std.mem.span(&funcs);
                    var func_i: usize = 0;

                    inline for (function_name_literals) |function_name, i| {
                        const func = @field(staticFunctions, function_names[i]);
                        const Func = @TypeOf(func);

                        switch (@typeInfo(Func)) {
                            .Struct => {
                                if (hasTypeScript(Func)) {
                                    var ts_function: d.ts = func.ts;
                                    if (ts_function.name.len == 0) {
                                        ts_function.name = function_names[i];
                                    }

                                    if (ts_function.read_only == null) {
                                        ts_function.read_only = class.read_only;
                                    }

                                    class.functions[func_i] = ts_function;

                                    func_i += 1;
                                }
                            },
                            else => continue,
                        }
                    }
                }

                if (property_names.len > 0) {
                    var count: usize = 0;
                    inline for (property_names) |property_name, i| {
                        const field = @field(properties, property_names[i]);

                        if (hasTypeScript(@TypeOf(field))) {
                            count += 1;
                        }
                    }

                    var props = std.mem.zeroes([count]d.ts);
                    class.properties = std.mem.span(&props);
                    var property_i: usize = 0;

                    inline for (property_names) |property_name, i| {
                        const field = @field(properties, property_names[i]);

                        if (hasTypeScript(@TypeOf(field))) {
                            var ts_field: d.ts = field.ts;
                            if (ts_field.name.len == 0) {
                                ts_field.name = property_name;
                            }

                            if (ts_field.read_only == null) {
                                if (hasReadOnly(@TypeOf(field))) {
                                    ts_field.read_only = field.ro;
                                } else {
                                    ts_field.read_only = class.read_only;
                                }
                            }

                            class.properties[property_i] = ts_field;

                            property_i += 1;
                        }
                    }
                }
            }

            return comptime class;
        }

        pub fn define() js.JSClassDefinition {
            var def = js.kJSClassDefinitionEmpty;

            if (static_functions.len > 0) {
                std.mem.set(js.JSStaticFunction, &static_functions, std.mem.zeroes(js.JSStaticFunction));
                var count: usize = 0;
                inline for (function_name_literals) |function_name, i| {
                    switch (comptime @typeInfo(@TypeOf(@field(staticFunctions, function_names[i])))) {
                        .Struct => {
                            if (comptime strings.eqlComptime(function_names[i], "constructor")) {
                                def.callAsConstructor = To.JS.Constructor(staticFunctions.constructor.rfn).rfn;
                            } else if (comptime strings.eqlComptime(function_names[i], "finalize")) {
                                def.finalize = To.JS.Finalize(ZigType, staticFunctions.finalize.rfn).rfn;
                            } else {
                                var callback = To.JS.Callback(
                                    ZigType,
                                    @field(staticFunctions, function_names[i]).rfn,
                                ).rfn;
                                static_functions[count] = js.JSStaticFunction{
                                    .name = (function_names[i][0.. :0]).ptr,
                                    .callAsFunction = callback,
                                    .attributes = comptime if (read_only) js.JSPropertyAttributes.kJSPropertyAttributeReadOnly else js.JSPropertyAttributes.kJSPropertyAttributeNone,
                                };

                                count += 1;
                            }
                        },
                        .Fn => {
                            if (comptime strings.eqlComptime(function_names[i], "constructor")) {
                                def.callAsConstructor = To.JS.Constructor(staticFunctions.constructor).rfn;
                            } else if (comptime strings.eqlComptime(function_names[i], "finalize")) {
                                def.finalize = To.JS.Finalize(ZigType, staticFunctions.finalize).rfn;
                            } else {
                                var callback = To.JS.Callback(
                                    ZigType,
                                    @field(staticFunctions, function_names[i]),
                                ).rfn;
                                static_functions[count] = js.JSStaticFunction{
                                    .name = (function_names[i][0.. :0]).ptr,
                                    .callAsFunction = callback,
                                    .attributes = comptime if (read_only) js.JSPropertyAttributes.kJSPropertyAttributeReadOnly else js.JSPropertyAttributes.kJSPropertyAttributeNone,
                                };

                                count += 1;
                            }
                        },
                        else => unreachable,
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

                    if (comptime hasSetter(@TypeOf(field))) {
                        static_properties[i].setProperty = StaticProperty(i).setter;
                    }
                    static_properties[i].name = property_names[i][0.. :0];
                }

                def.staticValues = (&static_properties);
            }

            def.className = class_name_str;
            // def.getProperty = getPropertyCallback;

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
        defer allocator.free(buf);

        var message = js.JSStringCreateWithUTF8CString(buf);
        defer js.JSStringRelease(message);

        error_args[0] = js.JSValueMakeString(ctx, message);
        exception.* = js.JSObjectMakeError(ctx, 1, &error_args, null);
    }
}

pub fn getAllocator(ctx: js.JSContextRef) *std.mem.Allocator {
    return std.heap.c_allocator;
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

pub fn castObj(obj: js.JSObjectRef, comptime Type: type) *Type {
    return @ptrCast(
        *Type,
        @alignCast(@alignOf(*Type), js.JSObjectGetPrivate(obj).?),
    );
}
