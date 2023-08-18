pub const js = @import("root").bun.JSC.C;
const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const JavaScript = @import("./javascript.zig");
const JSC = @import("root").bun.JSC;
const WebCore = @import("./webcore.zig");
const Test = @import("./test/jest.zig");
const Fetch = WebCore.Fetch;
const Response = WebCore.Response;
const Request = WebCore.Request;
const Router = @import("./api/filesystem_router.zig");
const FetchEvent = WebCore.FetchEvent;
const IdentityContext = @import("../identity_context.zig").IdentityContext;
const uws = @import("root").bun.uws;
const Body = WebCore.Body;
const TaggedPointerTypes = @import("../tagged_pointer.zig");
const TaggedPointerUnion = TaggedPointerTypes.TaggedPointerUnion;

pub const ExceptionValueRef = [*c]js.JSValueRef;
pub const JSValueRef = js.JSValueRef;

fn ObjectPtrType(comptime Type: type) type {
    if (Type == void) return Type;
    return *Type;
}

const Internal = struct {
    pub fn toJSWithType(globalThis: *JSC.JSGlobalObject, comptime Type: type, value: Type, exception: JSC.C.ExceptionRef) JSValue {
        // TODO: refactor withType to use this instead of the other way around
        return JSC.JSValue.c(To.JS.withType(Type, value, globalThis, exception));
    }

    pub fn toJS(globalThis: *JSC.JSGlobalObject, value: anytype, exception: JSC.C.ExceptionRef) JSValue {
        return toJSWithType(globalThis, @TypeOf(value), value, exception);
    }
};

pub usingnamespace Internal;

pub const To = struct {
    pub const Cpp = struct {
        pub fn PropertyGetter(
            comptime Type: type,
        ) type {
            return comptime fn (
                this: ObjectPtrType(Type),
                globalThis: *JSC.JSGlobalObject,
            ) callconv(.C) JSC.JSValue;
        }

        const toJS = Internal.toJSWithType;

        pub fn GetterFn(comptime Type: type, comptime decl: std.meta.DeclEnum(Type)) PropertyGetter(Type) {
            return struct {
                pub fn getter(
                    this: ObjectPtrType(Type),
                    globalThis: *JSC.JSGlobalObject,
                ) callconv(.C) JSC.JSValue {
                    var exception_ref = [_]JSC.C.JSValueRef{null};
                    var exception: JSC.C.ExceptionRef = &exception_ref;
                    const result = toJS(globalThis, @call(.auto, @field(Type, @tagName(decl)), .{this}), exception);
                    if (exception.* != null) {
                        globalThis.throwValue(JSC.JSValue.c(exception.*));
                        return .zero;
                    }

                    return result;
                }
            }.getter;
        }
    };
    pub const JS = struct {
        pub inline fn str(_: anytype, val: anytype) js.JSStringRef {
            return js.JSStringCreateWithUTF8CString(val[0.. :0]);
        }

        pub fn functionWithCallback(
            comptime ZigContextType: type,
            zig: ObjectPtrType(ZigContextType),
            name: js.JSStringRef,
            ctx: js.JSContextRef,
            comptime callback: fn (
                obj: ObjectPtrType(ZigContextType),
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                thisObject: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef,
        ) js.JSObjectRef {
            var function = js.JSObjectMakeFunctionWithCallback(ctx, name, Callback(ZigContextType, callback).rfn);
            std.debug.assert(js.JSObjectSetPrivate(
                function,
                JSPrivateDataPtr.init(zig).ptr(),
            ));
            return function;
        }

        pub fn Finalize(
            comptime ZigContextType: type,
            comptime ctxfn: fn (
                this: ObjectPtrType(ZigContextType),
            ) void,
        ) type {
            return struct {
                pub fn rfn(
                    object: js.JSObjectRef,
                ) callconv(.C) void {
                    return ctxfn(
                        GetJSPrivateData(ZigContextType, object) orelse return,
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

        pub fn withType(comptime Type: type, value: Type, context: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            return withTypeClone(Type, value, context, exception, false);
        }

        pub fn withTypeClone(comptime Type: type, value: Type, context: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef, clone: bool) JSC.C.JSValueRef {
            if (comptime std.meta.trait.isNumber(Type)) {
                return JSC.JSValue.jsNumberWithType(Type, value).asRef();
            }

            var zig_str: JSC.ZigString = undefined;

            return switch (comptime Type) {
                void => JSC.C.JSValueMakeUndefined(context),
                bool => JSC.C.JSValueMakeBoolean(context, value),
                []const u8, [:0]const u8, [*:0]const u8, []u8, [:0]u8, [*:0]u8 => brk: {
                    zig_str = ZigString.init(value);
                    const val = zig_str.toValueAuto(context.ptr());

                    break :brk val.asObjectRef();
                },
                []const JSC.ZigString => {
                    var array = JSC.JSValue.createStringArray(context.ptr(), value.ptr, value.len, clone).asObjectRef();
                    const values: []const JSC.ZigString = value;
                    defer bun.default_allocator.free(values);
                    if (clone) {
                        for (values) |out| {
                            if (out.isGloballyAllocated()) {
                                out.deinitGlobal();
                            }
                        }
                    }

                    return array;
                },
                []const bun.String => {
                    defer {
                        for (value) |out| {
                            out.deref();
                        }
                        bun.default_allocator.free(value);
                    }
                    return bun.String.toJSArray(context, value).asObjectRef();
                },
                []const PathString, []const []const u8, []const []u8, [][]const u8, [][:0]const u8, [][:0]u8 => {
                    if (value.len == 0)
                        return JSC.C.JSObjectMakeArray(context, 0, null, exception);

                    var stack_fallback = std.heap.stackFallback(512, bun.default_allocator);
                    var allocator = stack_fallback.get();

                    var zig_strings = allocator.alloc(ZigString, value.len) catch unreachable;
                    defer if (stack_fallback.fixed_buffer_allocator.end_index >= 511) allocator.free(zig_strings);

                    for (value, 0..) |path_string, i| {
                        if (comptime Type == []const PathString) {
                            zig_strings[i] = ZigString.init(path_string.slice());
                        } else {
                            zig_strings[i] = ZigString.init(path_string);
                        }
                    }
                    // there is a possible C ABI bug or something here when the ptr is null
                    // it should not be segfaulting but it is
                    // that's why we check at the top of this function
                    var array = JSC.JSValue.createStringArray(context.ptr(), zig_strings.ptr, zig_strings.len, clone).asObjectRef();

                    if (clone and value.len > 0) {
                        for (value) |path_string| {
                            if (comptime Type == []const PathString) {
                                bun.default_allocator.free(path_string.slice());
                            } else {
                                bun.default_allocator.free(path_string);
                            }
                        }
                        bun.default_allocator.free(value);
                    }

                    return array;
                },

                JSC.C.JSValueRef => value,

                else => {
                    const Info: std.builtin.Type = comptime @typeInfo(Type);
                    if (comptime Info == .Enum) {
                        const Enum: std.builtin.Type.Enum = Info.Enum;
                        if (comptime !std.meta.trait.isNumber(Enum.tag_type)) {
                            zig_str = JSC.ZigString.init(@tagName(value));
                            return zig_str.toValue(context.ptr()).asObjectRef();
                        }
                    }

                    // Recursion can stack overflow here
                    if (comptime std.meta.trait.isSlice(Type)) {
                        const Child = comptime std.meta.Child(Type);

                        var array = JSC.JSValue.createEmptyArray(context, value.len);
                        for (value, 0..) |item, i| {
                            array.putIndex(
                                context,
                                @truncate(i),
                                JSC.JSValue.c(To.JS.withType(Child, item, context, exception)),
                            );

                            if (exception.* != null) {
                                return null;
                            }
                        }
                        return array.asObjectRef();
                    }

                    if (comptime std.meta.trait.isZigString(Type)) {
                        zig_str = JSC.ZigString.init(value);
                        return zig_str.toValue(context.ptr()).asObjectRef();
                    }

                    if (comptime Info == .Pointer) {
                        const Child = comptime std.meta.Child(Type);
                        if (comptime std.meta.trait.isContainer(Child) and @hasDecl(Child, "Class") and @hasDecl(Child.Class, "isJavaScriptCoreClass")) {
                            return Child.Class.make(context, value);
                        }
                    }

                    if (comptime Info == .Struct) {
                        if (comptime @hasDecl(Type, "Class") and @hasDecl(Type.Class, "isJavaScriptCoreClass")) {
                            if (comptime !@hasDecl(Type, "finalize")) {
                                @compileError(std.fmt.comptimePrint("JSC class {s} must implement finalize to prevent memory leaks", .{Type.Class.name}));
                            }

                            if (comptime !@hasDecl(Type, "toJS")) {
                                var val = bun.default_allocator.create(Type) catch unreachable;
                                val.* = value;
                                return Type.Class.make(context, val);
                            }
                        }
                    }

                    if (comptime @hasDecl(Type, "toJS") and @typeInfo(@TypeOf(@field(Type, "toJS"))).Fn.params.len == 2) {
                        var val = bun.default_allocator.create(Type) catch unreachable;
                        val.* = value;
                        return val.toJS(context).asObjectRef();
                    }

                    const res = value.toJS(context, exception);

                    if (@TypeOf(res) == JSC.C.JSValueRef) {
                        return res;
                    } else if (@TypeOf(res) == JSC.JSValue) {
                        return res.asObjectRef();
                    }
                },
            };
        }

        pub fn PropertyGetter(
            comptime Type: type,
        ) type {
            return comptime fn (
                this: ObjectPtrType(Type),
                ctx: js.JSContextRef,
                _: js.JSValueRef,
                _: js.JSStringRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef;
        }

        pub fn Getter(comptime Type: type, comptime field: std.meta.FieldEnum(Type)) PropertyGetter(Type) {
            return struct {
                pub fn rfn(
                    this: ObjectPtrType(Type),
                    ctx: js.JSContextRef,
                    _: js.JSValueRef,
                    _: js.JSStringRef,
                    exception: js.ExceptionRef,
                ) js.JSValueRef {
                    return withType(std.meta.fieldInfo(Type, field).type, @field(this, @tagName(field)), ctx, exception);
                }
            }.rfn;
        }

        pub const JSC_C_Function = fn (
            js.JSContextRef,
            js.JSObjectRef,
            js.JSObjectRef,
            usize,
            [*c]const js.JSValueRef,
            js.ExceptionRef,
        ) callconv(.C) js.JSValueRef;

        pub fn Callback(
            comptime ZigContextType: type,
            comptime ctxfn: fn (
                obj: ObjectPtrType(ZigContextType),
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
                    if (comptime ZigContextType == anyopaque) {
                        return ctxfn(
                            js.JSObjectGetPrivate(function) orelse js.JSObjectGetPrivate(thisObject) orelse undefined,
                            ctx,
                            function,
                            thisObject,
                            if (arguments) |args| args[0..argumentCount] else &[_]js.JSValueRef{},
                            exception,
                        );
                    } else if (comptime ZigContextType == void) {
                        return ctxfn(
                            {},
                            ctx,
                            function,
                            thisObject,
                            if (arguments) |args| args[0..argumentCount] else &[_]js.JSValueRef{},
                            exception,
                        );
                    } else {
                        return ctxfn(
                            GetJSPrivateData(ZigContextType, function) orelse GetJSPrivateData(ZigContextType, thisObject) orelse return js.JSValueMakeUndefined(ctx),
                            ctx,
                            function,
                            thisObject,
                            if (arguments) |args| args[0..argumentCount] else &[_]js.JSValueRef{},
                            exception,
                        );
                    }
                }
            };
        }
    };
};

pub const Properties = struct {
    pub const UTF8 = struct {
        pub var filepath: string = "filepath";

        pub const module: string = "module";
        pub const globalThis: string = "globalThis";
        pub const exports: string = "exports";
        pub const log: string = "log";
        pub const debug: string = "debug";
        pub const name: string = "name";
        pub const info: string = "info";
        pub const error_: string = "error";
        pub const warn: string = "warn";
        pub const console: string = "console";
        pub const require: string = "require";
        pub const description: string = "description";
        pub const initialize_bundled_module: string = "$$m";
        pub const load_module_function: string = "$lOaDuRcOdE$";
        pub const window: string = "window";
        pub const default: string = "default";
        pub const include: string = "include";

        pub const env: string = "env";

        pub const GET = "GET";
        pub const PUT = "PUT";
        pub const POST = "POST";
        pub const PATCH = "PATCH";
        pub const HEAD = "HEAD";
        pub const OPTIONS = "OPTIONS";

        pub const navigate = "navigate";
        pub const follow = "follow";
    };

    pub const Refs = struct {
        pub var empty_string_ptr = [_]u8{0};
        pub var empty_string: js.JSStringRef = undefined;
    };

    pub fn init() void {
        Refs.empty_string = js.JSStringCreateWithUTF8CString(&Refs.empty_string_ptr);
    }
};

const hasSetter = std.meta.trait.hasField("set");
const hasReadOnly = std.meta.trait.hasField("ro");
const hasFinalize = std.meta.trait.hasField("finalize");
const hasEnumerable = std.meta.trait.hasField("enumerable");

const hasTypeScriptField = std.meta.trait.hasField("ts");
fn hasTypeScript(comptime Type: type) bool {
    if (hasTypeScriptField(Type)) {
        return true;
    }

    return @hasDecl(Type, "ts");
}

fn getTypeScript(comptime Type: type, value: Type) d.ts.or_decl {
    if (comptime !@hasDecl(Type, "ts") and !@hasField(Type, "ts")) {
        return d.ts.or_decl{
            .ts = .{ .name = @typeName(Type) },
        };
    }

    if (comptime hasTypeScriptField(Type)) {
        if (@TypeOf(value.ts) == d.ts.decl) {
            return d.ts.or_decl{ .decl = value };
        } else {
            return d.ts.or_decl{ .ts = value.ts };
        }
    }

    if (@TypeOf(Type.ts) == d.ts.decl) {
        return d.ts.or_decl{ .decl = Type.ts };
    } else {
        return d.ts.or_decl{ .ts = value.ts };
    }
}

pub const d = struct {
    pub const ts = struct {
        @"return": string = "unknown",
        tsdoc: string = "",
        name: string = "",
        read_only: ?bool = null,
        args: []const arg = &[_]arg{},
        splat_args: bool = false,

        pub const or_decl = union(Tag) {
            ts: ts,
            decl: decl,
            pub const Tag = enum { ts, decl };
        };

        pub const decl = union(Tag) {
            module: module,
            class: class,
            empty: u0,
            pub const Tag = enum { module, class, empty };
        };

        pub const module = struct {
            tsdoc: string = "",
            read_only: ?bool = null,
            path: string = "",
            global: bool = false,

            properties: []ts = &[_]ts{},
            functions: []ts = &[_]ts{},
            classes: []class = &[_]class{},
        };

        pub const class = struct {
            name: string = "",
            tsdoc: string = "",
            @"return": string = "",
            read_only: ?bool = null,
            interface: bool = true,
            default_export: bool = false,

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
                        for (func.args, 0..) |a, i| {
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
                        for (func.args, 0..) |a, i| {
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

                pub fn printDecl(comptime klass: d.ts.decl, comptime _indent: usize) string {
                    return comptime switch (klass) {
                        .module => |mod| printModule(mod, _indent),
                        .class => |cla| printClass(cla, _indent),
                        .empty => "",
                    };
                }

                pub fn printModule(comptime klass: d.ts.module, comptime _indent: usize) string {
                    comptime var indent = _indent;
                    comptime var buf: string = "";
                    comptime brk: {
                        if (klass.tsdoc.len > 0) {
                            buf = buf ++ printTSDoc(klass.tsdoc, indent);
                        }

                        if (klass.global) {
                            buf = buf ++ printIndented("declare global {{\n", .{}, indent);
                        } else {
                            buf = buf ++ printIndented("declare module \"{s}\" {{\n", .{klass.path}, indent);
                        }

                        indent += indent_level;

                        for (klass.properties, 0..) |property, i| {
                            if (i > 0) {
                                buf = buf ++ "\n";
                            }

                            buf = buf ++ printVar(property, indent);
                        }

                        buf = buf ++ "\n";

                        for (klass.functions, 0..) |func, i| {
                            if (i > 0) {
                                buf = buf ++ "\n";
                            }

                            buf = buf ++ printFunction(
                                func,
                                indent,
                                false,
                            );
                        }

                        for (klass.classes, 0..) |func, i| {
                            if (i > 0) {
                                buf = buf ++ "\n";
                            }

                            buf = buf ++ printClass(
                                func,
                                indent,
                            );
                        }

                        indent -= indent_level;

                        buf = buf ++ printIndented("}}\n", .{}, indent);

                        break :brk;
                    }
                    return comptime buf;
                }

                pub fn printClass(comptime klass: d.ts.class, comptime _indent: usize) string {
                    comptime var indent = _indent;
                    comptime var buf: string = "";
                    comptime brk: {
                        if (klass.tsdoc.len > 0) {
                            buf = buf ++ printTSDoc(klass.tsdoc, indent);
                        }

                        const qualifier = if (!klass.default_export) "export " else "";

                        if (klass.interface) {
                            buf = buf ++ printIndented("export interface {s} {{\n", .{klass.name}, indent);
                        } else {
                            buf = buf ++ printIndented("{s}class {s} {{\n", .{ qualifier, klass.name }, indent);
                        }

                        indent += indent_level;

                        var did_print_constructor = false;
                        for (klass.functions) |func| {
                            if (!strings.eqlComptime(func.name, "constructor")) continue;
                            did_print_constructor = true;
                            buf = buf ++ printInstanceFunction(
                                func,
                                indent,
                                !klass.interface,
                            );
                        }

                        for (klass.properties, 0..) |property, i| {
                            if (i > 0 or did_print_constructor) {
                                buf = buf ++ "\n";
                            }

                            buf = buf ++ printProperty(property, indent);
                        }

                        buf = buf ++ "\n";

                        for (klass.functions, 0..) |func, i| {
                            if (i > 0) {
                                buf = buf ++ "\n";
                            }

                            if (strings.eqlComptime(func.name, "constructor")) continue;

                            buf = buf ++ printInstanceFunction(
                                func,
                                indent,
                                false,
                            );
                        }

                        indent -= indent_level;

                        buf = buf ++ printIndented("}}\n", .{}, indent);

                        if (klass.default_export) {
                            buf = buf ++ printIndented("export = {s};\n", .{klass.name}, indent);
                        }

                        break :brk;
                    }
                    return comptime buf;
                }

                pub fn printTSDoc(comptime str: string, comptime indent: usize) string {
                    comptime var buf: string = "";

                    comptime brk: {
                        var splitter = std.mem.split(u8, str, "\n");

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
    name: stringZ,

    read_only: bool = false,
    hidden: []const string = &[_]string{},
    no_inheritance: bool = false,
    singleton: bool = false,
    ts: d.ts.decl = d.ts.decl{ .empty = 0 },
    has_dom_calls: bool = false,
};

pub fn NewConstructor(
    comptime InstanceType: type,
    comptime staticFunctions: anytype,
    comptime properties: anytype,
) type {
    return struct {
        pub usingnamespace NewClassWithInstanceType(void, InstanceType.Class.class_options, staticFunctions, properties, InstanceType);
        const name_string = ZigString.static(InstanceType.Class.class_options.name);
        pub fn constructor(ctx: js.JSContextRef) callconv(.C) js.JSObjectRef {
            return JSValue.makeWithNameAndPrototype(
                ctx.ptr(),
                @This().get().*,
                InstanceType.Class.get().*,
                name_string,
            ).asObjectRef();
        }
    };
}

const _to_json: stringZ = "toJSON";

pub fn NewClass(
    comptime ZigType: type,
    comptime options: ClassOptions,
    comptime staticFunctions: anytype,
    comptime properties: anytype,
) type {
    return NewClassWithInstanceType(ZigType, options, staticFunctions, properties, void);
}

pub fn NewClassWithInstanceType(
    comptime ZigType: type,
    comptime options: ClassOptions,
    comptime staticFunctions: anytype,
    comptime properties: anytype,
    comptime InstanceType: type,
) type {
    return struct {
        const read_only = options.read_only;
        const singleton = options.singleton;
        pub const name = options.name;
        pub const class_options = options;
        pub const isJavaScriptCoreClass = true;
        pub const Zig = ZigType;
        const ClassDefinitionCreator = @This();
        const function_names = std.meta.fieldNames(@TypeOf(staticFunctions));
        pub const functionDefinitions = staticFunctions;
        const function_name_literals = function_names;
        var function_name_refs: [function_names.len]js.JSStringRef = undefined;
        var function_name_refs_set = false;

        const property_names = std.meta.fieldNames(@TypeOf(properties));
        var property_name_refs: [property_names.len]js.JSStringRef = undefined;
        var property_name_refs_set: bool = false;
        const property_name_literals = property_names;

        const LazyClassRef = struct {
            ref: js.JSClassRef = null,
            loaded: bool = false,
        };

        threadlocal var lazy_ref: LazyClassRef = LazyClassRef{};

        pub inline fn isLoaded() bool {
            return lazy_ref.loaded;
        }

        const ConstructorWrapper = struct {
            pub fn rfn(
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                _: js.JSObjectRef,
                argumentCount: usize,
                arguments: [*c]const js.JSValueRef,
                exception: js.ExceptionRef,
            ) callconv(.C) js.JSValueRef {
                return getClassDefinition().callAsConstructor.?(ctx, function, argumentCount, arguments, exception);
            }
        };

        pub fn throwInvalidConstructorError(ctx: js.JSContextRef, _: js.JSObjectRef, _: usize, _: [*c]const js.JSValueRef, exception: js.ExceptionRef) callconv(.C) js.JSObjectRef {
            JSError(getAllocator(ctx), "" ++ name ++ " is not a constructor", .{}, ctx, exception);
            return null;
        }

        pub fn throwInvalidFunctionError(
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: usize,
            _: [*c]const js.JSValueRef,
            exception: js.ExceptionRef,
        ) callconv(.C) js.JSValueRef {
            JSError(getAllocator(ctx), "" ++ name ++ " is not a function", .{}, ctx, exception);
            return null;
        }

        pub const Constructor = ConstructorWrapper.rfn;

        var class_definition: js.JSClassDefinition = undefined;
        var class_definition_set: bool = false;
        const static_functions__: [function_name_literals.len + 1]js.JSStaticFunction = if (function_name_literals.len > 0) generateDef([function_name_literals.len + 1]js.JSStaticFunction) else undefined;
        const static_values_ptr = &static_properties;

        fn generateClassDefinition() void {
            class_definition = comptime brk: {
                var def = generateDef(JSC.C.JSClassDefinition);
                if (function_name_literals.len > 0)
                    def.staticFunctions = &static_functions__;
                if (options.no_inheritance) {
                    def.attributes = JSC.C.JSClassAttributes.kJSClassAttributeNoAutomaticPrototype;
                }
                if (property_names.len > 0) {
                    def.staticValues = static_values_ptr;
                }

                def.className = options.name.ptr;
                // def.getProperty = getPropertyCallback;

                if (!(def.callAsConstructor == null and def.callAsFunction == null)) {
                    if (def.callAsConstructor == null) {
                        def.callAsConstructor = &throwInvalidConstructorError;
                    }

                    if (def.callAsFunction == null) {
                        def.callAsFunction = &throwInvalidFunctionError;
                    }

                    if (!singleton and def.hasInstance == null)
                        def.hasInstance = &customHasInstance;

                    if (def.getPropertyNames == null) {
                        def.getPropertyNames = &getPropertyNames;
                    }
                } else {
                    def.attributes = JSC.C.JSClassAttributes.kJSClassAttributeNoAutomaticPrototype;
                }

                break :brk def;
            };
        }

        fn getClassDefinition() *const JSC.C.JSClassDefinition {
            if (!class_definition_set) {
                class_definition_set = true;
                generateClassDefinition();
            }

            return &class_definition;
        }

        pub fn get() callconv(.C) [*c]js.JSClassRef {
            var lazy = lazy_ref;

            if (!lazy.loaded) {
                lazy = .{
                    .ref = js.JSClassCreate(getClassDefinition()),
                    .loaded = true,
                };
                lazy_ref = lazy;
            }

            _ = js.JSClassRetain(lazy.ref);

            return &lazy.ref;
        }

        pub fn customHasInstance(ctx: js.JSContextRef, _: js.JSObjectRef, value: js.JSValueRef, _: js.ExceptionRef) callconv(.C) bool {
            if (InstanceType != void) {
                var current = value;
                while (current != null) {
                    if (js.JSValueIsObjectOfClass(ctx, current, InstanceType.Class.get().*)) {
                        return true;
                    }
                    current = js.JSObjectGetPrototype(ctx, current);
                }
                return false;
            }

            return js.JSValueIsObjectOfClass(ctx, value, get().*);
        }

        pub fn make(ctx: js.JSContextRef, ptr: *ZigType) js.JSObjectRef {
            var real_ptr = JSPrivateDataPtr.init(ptr).ptr();
            if (comptime Environment.allow_assert) {
                std.debug.assert(JSPrivateDataPtr.isValidPtr(real_ptr));
                std.debug.assert(JSPrivateDataPtr.from(real_ptr).get(ZigType).? == ptr);
            }

            var result = js.JSObjectMake(
                ctx,
                get().*,
                real_ptr,
            );

            if (comptime Environment.allow_assert) {
                std.debug.assert(JSPrivateDataPtr.from(js.JSObjectGetPrivate(result)).ptr() == real_ptr);
            }

            return result;
        }

        pub fn putDOMCalls(globalThis: *JSC.JSGlobalObject, value: JSValue) void {
            inline for (function_name_literals) |functionName| {
                const Function = comptime @field(staticFunctions, functionName);
                if (@TypeOf(Function) == type and @hasDecl(Function, "is_dom_call")) {
                    Function.put(globalThis, value);
                }
            }
        }

        pub fn GetClass(comptime ReceiverType: type) type {
            const ClassGetter = struct {
                get: fn (
                    *ReceiverType,
                    js.JSContextRef,
                    js.JSObjectRef,
                    js.ExceptionRef,
                ) js.JSValueRef = rfn,

                pub fn rfn(
                    _: *ReceiverType,
                    ctx: js.JSContextRef,
                    _: js.JSObjectRef,
                    _: js.ExceptionRef,
                ) js.JSValueRef {
                    return js.JSObjectMake(ctx, get().*, null);
                }
            };

            return ClassGetter;
        }

        fn StaticProperty(comptime id: usize) type {
            return struct {
                pub fn getter(
                    ctx: js.JSContextRef,
                    obj: js.JSObjectRef,
                    prop: js.JSStringRef,
                    exception: js.ExceptionRef,
                ) callconv(.C) js.JSValueRef {
                    var this: ObjectPtrType(ZigType) = if (comptime ZigType == void) {} else GetJSPrivateData(ZigType, obj) orelse return js.JSValueMakeUndefined(ctx);

                    const Field = @TypeOf(@field(
                        properties,
                        property_names[id],
                    ));
                    switch (comptime @typeInfo(Field)) {
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
                            comptime {
                                if (!@hasField(@TypeOf(@field(properties, property_names[id])), "get")) {
                                    @compileError(
                                        "Cannot get static property " ++ property_names[id] ++ " of " ++ name ++ " because it is a struct without a getter",
                                    );
                                }
                            }
                            const func = @field(
                                @field(
                                    properties,
                                    property_names[id],
                                ),
                                "get",
                            );

                            const Func = @typeInfo(@TypeOf(func));
                            const WithPropFn = fn (
                                ObjectPtrType(ZigType),
                                js.JSContextRef,
                                js.JSObjectRef,
                                js.JSStringRef,
                                js.ExceptionRef,
                            ) js.JSValueRef;

                            if (Func.Fn.params.len == @typeInfo(WithPropFn).Fn.params.len) {
                                return func(
                                    this,
                                    ctx,
                                    obj,
                                    prop,
                                    exception,
                                );
                            } else {
                                return func(
                                    this,
                                    ctx,
                                    obj,
                                    exception,
                                );
                            }
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
                    var this = GetJSPrivateData(ZigType, obj) orelse return false;

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

        pub fn getPropertyNames(
            _: js.JSContextRef,
            _: js.JSObjectRef,
            props: js.JSPropertyNameAccumulatorRef,
        ) callconv(.C) void {
            if (comptime property_name_refs.len > 0) {
                if (!property_name_refs_set) {
                    comptime var i: usize = 0;
                    property_name_refs_set = true;
                    inline while (i < comptime property_name_refs.len) : (i += 1) {
                        property_name_refs[i] = js.JSStringCreateStatic(property_names[i].ptr, property_names[i].len);
                    }
                    comptime i = 0;
                } else {
                    comptime var i: usize = 0;
                    inline while (i < property_name_refs.len) : (i += 1) {
                        js.JSPropertyNameAccumulatorAddName(props, property_name_refs[i]);
                    }
                }
            }

            const ref_len = comptime function_name_refs.len;
            if (comptime function_name_refs.len > 0) {
                if (!function_name_refs_set) {
                    comptime var j: usize = 0;
                    function_name_refs_set = true;
                    inline while (j < ref_len) : (j += 1) {
                        function_name_refs[j] = js.JSStringCreateStatic(function_names[j].ptr, function_names[j].len);
                    }
                    comptime j = 0;

                    inline while (j < ref_len) : (j += 1) {
                        js.JSPropertyNameAccumulatorAddName(props, function_name_refs[j]);
                    }
                } else {
                    comptime var j: usize = 0;
                    inline while (j < ref_len) : (j += 1) {
                        js.JSPropertyNameAccumulatorAddName(props, function_name_refs[j]);
                    }
                }
            }
        }

        const static_properties: [property_names.len + 1]js.JSStaticValue = brk: {
            var props: [property_names.len + 1]js.JSStaticValue = undefined;
            @memset(
                &props,
                js.JSStaticValue{
                    .name = @as([*c]const u8, @ptrFromInt(0)),
                    .getProperty = null,
                    .setProperty = null,
                    .attributes = js.JSPropertyAttributes.kJSPropertyAttributeNone,
                },
            );
            if (property_name_literals.len > 0 and @TypeOf(property_name_literals[0]) == [:0]const u8) {
                @compileError("@typeInfo() struct field names are null-terminated");
            }
            for (property_name_literals, 0..) |lit, i| {
                props[i] = brk2: {
                    var static_prop = JSC.C.JSStaticValue{
                        // TODO: update when @typeInfo struct field names are sentinel terminated
                        // https://github.com/ziglang/zig/issues/16072
                        .name = lit ++ .{0},
                        .getProperty = null,
                        .setProperty = null,
                        .attributes = @as(js.JSPropertyAttributes, @enumFromInt(0)),
                    };
                    static_prop.getProperty = StaticProperty(i).getter;

                    const field = @field(properties, property_names[i]);

                    if (hasSetter(@TypeOf(field))) {
                        static_prop.setProperty = StaticProperty(i).setter;
                    }
                    break :brk2 static_prop;
                };
            }
            break :brk props;
        };

        // this madness is a workaround for stage1 compiler bugs
        fn generateDef(comptime ReturnType: type) ReturnType {
            var count: usize = 0;
            var def: js.JSClassDefinition = js.JSClassDefinition{
                .version = 0,
                .attributes = js.JSClassAttributes.kJSClassAttributeNone,
                .className = "",
                .parentClass = null,
                .staticValues = null,
                .staticFunctions = null,
                .initialize = null,
                .finalize = null,
                .hasProperty = null,
                .getProperty = null,
                .setProperty = null,
                .deleteProperty = null,
                .getPropertyNames = null,
                .callAsFunction = null,
                .callAsConstructor = null,
                .hasInstance = null,
                .convertToType = null,
            };
            var __static_functions: [function_name_literals.len + 1]js.JSStaticFunction = undefined;
            for (__static_functions, 0..) |_, i| {
                __static_functions[i] = js.JSStaticFunction{
                    .name = "",
                    .callAsFunction = null,
                    .attributes = js.JSPropertyAttributes.kJSPropertyAttributeNone,
                };
            }

            @setEvalBranchQuota(50_000);
            const is_read_only = options.read_only;

            inline for (comptime function_name_literals) |function_name_literal| {
                const CtxField = comptime @field(staticFunctions, function_name_literal);

                switch (comptime @typeInfo(@TypeOf(CtxField))) {
                    .Struct => {
                        if (comptime strings.eqlComptime(function_name_literal, "constructor")) {
                            def.callAsConstructor = &To.JS.Constructor(staticFunctions.constructor.rfn).rfn;
                        } else if (comptime strings.eqlComptime(function_name_literal, "finalize")) {
                            def.finalize = &To.JS.Finalize(ZigType, staticFunctions.finalize.rfn).rfn;
                        } else if (comptime strings.eqlComptime(function_name_literal, "call")) {
                            def.callAsFunction = &To.JS.Callback(ZigType, staticFunctions.call.rfn).rfn;
                        } else if (comptime strings.eqlComptime(function_name_literal, "callAsFunction")) {
                            const ctxfn = @field(staticFunctions, function_name_literal).rfn;
                            const Func: std.builtin.Type.Fn = @typeInfo(@TypeOf(if (@typeInfo(@TypeOf(ctxfn)) == .Pointer) ctxfn.* else ctxfn)).Fn;

                            const PointerType = std.meta.Child(Func.params[0].type.?);

                            def.callAsFunction = &(if (Func.calling_convention == .C) ctxfn else To.JS.Callback(
                                PointerType,
                                ctxfn,
                            ).rfn);
                        } else if (comptime strings.eqlComptime(function_name_literal, "hasProperty")) {
                            def.hasProperty = @field(staticFunctions, "hasProperty").rfn;
                        } else if (comptime strings.eqlComptime(function_name_literal, "getProperty")) {
                            def.getProperty = @field(staticFunctions, "getProperty").rfn;
                        } else if (comptime strings.eqlComptime(function_name_literal, "setProperty")) {
                            def.setProperty = @field(staticFunctions, "setProperty").rfn;
                        } else if (comptime strings.eqlComptime(function_name_literal, "deleteProperty")) {
                            def.deleteProperty = &@field(staticFunctions, "deleteProperty").rfn;
                        } else if (comptime strings.eqlComptime(function_name_literal, "getPropertyNames")) {
                            def.getPropertyNames = @field(staticFunctions, "getPropertyNames").rfn;
                        } else if (comptime strings.eqlComptime(function_name_literal, "convertToType")) {
                            def.convertToType = @field(staticFunctions, "convertToType").rfn;
                        } else if (comptime !@hasField(@TypeOf(CtxField), "is_dom_call")) {
                            if (!@hasField(@TypeOf(CtxField), "rfn")) {
                                @compileError("Expected " ++ options.name ++ "." ++ function_name_literal ++ " to have .rfn");
                            }
                            const ctxfn = CtxField.rfn;
                            const Func: std.builtin.Type.Fn = @typeInfo(@TypeOf(if (@typeInfo(@TypeOf(ctxfn)) == .Pointer) ctxfn.* else ctxfn)).Fn;

                            var attributes: c_uint = @intFromEnum(js.JSPropertyAttributes.kJSPropertyAttributeNone);

                            if (comptime is_read_only or hasReadOnly(@TypeOf(CtxField))) {
                                attributes |= @intFromEnum(js.JSPropertyAttributes.kJSPropertyAttributeReadOnly);
                            }

                            if (comptime hasEnumerable(@TypeOf(CtxField)) and !CtxField.enumerable) {
                                attributes |= @intFromEnum(js.JSPropertyAttributes.kJSPropertyAttributeDontEnum);
                            }

                            const PointerType = comptime brk: {
                                if (Func.params[0].type.? != void) {
                                    break :brk std.meta.Child(Func.params[0].type.?);
                                }
                                break :brk void;
                            };

                            __static_functions[count] = js.JSStaticFunction{
                                .name = bun.sliceTo(function_name_literal ++ [_]u8{0}, 0).ptr,
                                .callAsFunction = if (Func.calling_convention == .C) &CtxField.rfn else &To.JS.Callback(
                                    PointerType,
                                    if (@typeInfo(@TypeOf(ctxfn)) == .Pointer) ctxfn.* else ctxfn,
                                ).rfn,
                                .attributes = @as(js.JSPropertyAttributes, @enumFromInt(attributes)),
                            };

                            count += 1;
                        }
                    },
                    .Fn => {
                        if (comptime strings.eqlComptime(function_name_literal, "constructor")) {
                            def.callAsConstructor = &To.JS.Constructor(staticFunctions.constructor).rfn;
                        } else if (comptime strings.eqlComptime(function_name_literal, "finalize")) {
                            def.finalize = &To.JS.Finalize(ZigType, staticFunctions.finalize).rfn;
                        } else if (comptime strings.eqlComptime(function_name_literal, "call")) {
                            def.callAsFunction = &To.JS.Callback(ZigType, staticFunctions.call).rfn;
                        } else if (comptime strings.eqlComptime(function_name_literal, "getPropertyNames")) {
                            def.getPropertyNames = &To.JS.Callback(ZigType, staticFunctions.getPropertyNames).rfn;
                        } else if (comptime strings.eqlComptime(function_name_literal, "hasInstance")) {
                            def.hasInstance = &staticFunctions.hasInstance;
                        } else {
                            const attributes: js.JSPropertyAttributes = brk: {
                                var base = @intFromEnum(js.JSPropertyAttributes.kJSPropertyAttributeNone);

                                if (is_read_only)
                                    base |= @intFromEnum(js.JSPropertyAttributes.kJSPropertyAttributeReadOnly);

                                break :brk @as(js.JSPropertyAttributes, @enumFromInt(base));
                            };

                            __static_functions[count] = js.JSStaticFunction{
                                .name = (function_name_literal ++ [_]u8{0})[0..function_name_literal.len :0],
                                .callAsFunction = &To.JS.Callback(
                                    ZigType,
                                    @field(staticFunctions, function_name_literal),
                                ).rfn,
                                .attributes = attributes,
                            };

                            count += 1;
                        }
                    },
                    else => {},
                }
            }

            if (comptime ReturnType == JSC.C.JSClassDefinition) {
                return def;
            } else {
                return __static_functions;
            }
        }
    };
}

// pub fn NewInstanceFunction(
//     comptime className: []const u8,
//     comptime functionName: []const u8,
//     comptime InstanceType: type,
//     comptime target: anytype,
// ) type {
//     return struct {
//         pub const shim = JSC.Shimmer("ZigGenerated__" ++ className, functionName, @This());
//         pub const name = functionName;
//         pub const Type = InstanceType;

//         pub fn callAsFunction(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
//             var this = InstanceType.toWrapped(callframe.this()) orelse {
//                 callframe.toInvalidArguments("Expected this to be a " ++ className, .{}, globalObject);
//                 return JSC.JSValue.jsUndefined();
//             };

//             return target(globalObject, this, callframe.arguments());
//         }

//         pub const Export = shim.exportFunctions(.{
//             .callAsFunction = callAsFunction,
//         });

//         pub const symbol = Export[0].symbol_name;

//         comptime {
//             if (!JSC.is_bindgen) {
//                 @export(callAsFunction, .{
//                     .name = Export[0].symbol_name,
//                 });
//             }
//         }
//     };
// }

// pub fn NewStaticFunction(
//     comptime className: []const u8,
//     comptime functionName: []const u8,
//     comptime target: anytype,
// ) type {
//     return struct {
//         pub const shim = JSC.Shimmer("ZigGenerated__Static__" ++ className, functionName, @This());
//         pub const name = functionName;

//         pub fn callAsFunction(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
//             return target(globalObject, callframe.arguments());
//         }

//         pub const Export = shim.exportFunctions(.{
//             .callAsFunction = callAsFunction,
//         });

//         pub const symbol = Export[0].symbol_name;

//         comptime {
//             if (!JSC.is_bindgen) {
//                 @export(callAsFunction, .{
//                     .name = Export[0].symbol_name,
//                 });
//             }
//         }
//     };
// }

// pub fn NewStaticConstructor(
//     comptime className: []const u8,
//     comptime functionName: []const u8,
//     comptime target: anytype,
// ) type {
//     return struct {
//         pub const shim = JSC.Shimmer("ZigGenerated__Static__" ++ className, functionName, @This());
//         pub const name = functionName;

//         pub fn callAsConstructor(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
//             return target(globalObject, callframe.arguments());
//         }

//         pub const Export = shim.exportFunctions(.{
//             .callAsConstructor = callAsConstructor,
//         });

//         pub const symbol = Export[0].symbol_name;

//         comptime {
//             if (!JSC.is_bindgen) {
//                 @export(callAsConstructor, .{
//                     .name = Export[0].symbol_name,
//                 });
//             }
//         }
//     };
// }

// pub fn NewStaticObject(
//     comptime className: []const u8,
//     comptime function_definitions: anytype,
//     comptime property_definitions_: anytype,
// ) type {
//     return struct {
//         const property_definitions = property_definitions_;
//         pub const shim = JSC.Shimmer("ZigGenerated", name, @This());
//         pub const name = className;
//         pub const Type = void;

//         const function_names = std.meta.fieldNames(@TypeOf(function_definitions));
//         pub fn getFunctions() [function_names.len]type {
//             var data: [function_names.len]type = undefined;
//             var i: usize = 0;
//             while (i < function_names.len) : (i += 1) {
//                 if (strings.eqlComptime(function_names[i], "constructor")) {
//                     data[i] = NewStaticConstructor(className, function_names[i], @TypeOf(function_definitions)[function_names[i]]);
//                 } else {
//                     data[i] = NewStaticFunction(className, function_names[i], @TypeOf(function_definitions)[function_names[i]]);
//                 }
//             }

//             return data;
//         }

//         const property_names = std.meta.fieldNames(@TypeOf(property_definitions));
//         pub fn getProperties() [property_definitions.len]type {
//             var data: [property_definitions.len]type = undefined;
//             var i: usize = 0;
//             while (i < property_definitions.len) : (i += 1) {
//                 const definition = property_definitions[i];
//                 if (@hasField(definition, "lazyClass")) {
//                     data[i] = New(className, property_names[i], @field(property_definitions, property_names[i]));
//                 } else if (@hasField(definition, "lazyProperty")) {
//                     data[i] = NewLazyProperty(className, property_names[i], @field(property_definitions, property_names[i]));
//                 } else if (@hasField(definition, "get") and @hasField(definition, "set")) {
//                     data[i] = NewStaticProperty(className, property_names[i], definition.get, definition.set);
//                 } else if (@hasField(definition, "get")) {
//                     data[i] = NewStaticProperty(className, property_names[i], definition.get, {});
//                 } else if (@hasField(definition, "set")) {
//                     data[i] = NewStaticProperty(className, property_names[i], {}, definition.set);
//                 } else {
//                     @compileError(className ++ "." ++ property_names[i] ++ " missing lazy, get, or set");
//                 }
//             }

//             return data;
//         }

//         pub const entries = getProperties() ++ getFunctions();
//     };
// }

const JSValue = JSC.JSValue;
const ZigString = JSC.ZigString;

pub const PathString = bun.PathString;

pub fn JSError(
    _: std.mem.Allocator,
    comptime fmt: string,
    args: anytype,
    ctx: js.JSContextRef,
    exception: ExceptionValueRef,
) void {
    @setCold(true);

    exception.* = createError(ctx, fmt, args).asObjectRef();
}

pub fn createError(
    globalThis: *JSC.JSGlobalObject,
    comptime fmt: string,
    args: anytype,
) JSC.JSValue {
    if (comptime std.meta.fields(@TypeOf(args)).len == 0) {
        var zig_str = JSC.ZigString.init(fmt);
        if (comptime !strings.isAllASCIISimple(fmt)) {
            zig_str.markUTF16();
        }

        return zig_str.toErrorInstance(globalThis);
    } else {
        var fallback = std.heap.stackFallback(256, default_allocator);
        var allocator = fallback.get();

        var buf = std.fmt.allocPrint(allocator, fmt, args) catch unreachable;
        var zig_str = JSC.ZigString.init(buf);
        zig_str.detectEncoding();
        // it alwayas clones
        const res = zig_str.toErrorInstance(globalThis);
        allocator.free(buf);
        return res;
    }
}

pub fn throwTypeError(
    code: JSC.Node.ErrorCode,
    comptime fmt: string,
    args: anytype,
    ctx: js.JSContextRef,
    exception: ExceptionValueRef,
) void {
    exception.* = toTypeError(code, fmt, args, ctx).asObjectRef();
}

pub fn toTypeErrorWithCode(
    code: []const u8,
    comptime fmt: string,
    args: anytype,
    ctx: js.JSContextRef,
) JSC.JSValue {
    @setCold(true);
    var zig_str: JSC.ZigString = undefined;
    if (comptime std.meta.fields(@TypeOf(args)).len == 0) {
        zig_str = JSC.ZigString.init(fmt);
        zig_str.detectEncoding();
    } else {
        var buf = std.fmt.allocPrint(default_allocator, fmt, args) catch unreachable;
        zig_str = JSC.ZigString.init(buf);
        zig_str.detectEncoding();
        zig_str.mark();
    }
    const code_str = ZigString.init(code);
    return JSC.JSValue.createTypeError(&zig_str, &code_str, ctx.ptr());
}

pub fn toTypeError(
    code: JSC.Node.ErrorCode,
    comptime fmt: string,
    args: anytype,
    ctx: js.JSContextRef,
) JSC.JSValue {
    return toTypeErrorWithCode(@tagName(code), fmt, args, ctx);
}

pub fn throwInvalidArguments(
    comptime fmt: string,
    args: anytype,
    ctx: js.JSContextRef,
    exception: ExceptionValueRef,
) void {
    @setCold(true);
    return throwTypeError(JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE, fmt, args, ctx, exception);
}

pub fn toInvalidArguments(
    comptime fmt: string,
    args: anytype,
    ctx: js.JSContextRef,
) JSC.JSValue {
    @setCold(true);
    return toTypeError(JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE, fmt, args, ctx);
}

pub fn getAllocator(_: js.JSContextRef) std.mem.Allocator {
    return default_allocator;
}

/// Print a JSValue to stdout; this is only meant for debugging purposes
pub fn dump(value: JSValue, globalObject: *JSC.JSGlobalObject) !void {
    var formatter = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
    try Output.errorWriter().print("{}\n", .{value.toFmt(globalObject, &formatter)});
    Output.flush();
}

pub const JSStringList = std.ArrayList(js.JSStringRef);

pub const ArrayBuffer = extern struct {
    ptr: [*]u8 = undefined,
    offset: u32 = 0,
    len: u32 = 0,
    byte_len: u32 = 0,
    typed_array_type: JSC.JSValue.JSType = .Cell,
    value: JSC.JSValue = JSC.JSValue.zero,
    shared: bool = false,

    pub const Strong = struct {
        array_buffer: ArrayBuffer,
        held: JSC.Strong = .{},

        pub fn clear(this: *ArrayBuffer.Strong) void {
            var ref: *JSC.napi.Ref = this.ref orelse return;
            ref.set(JSC.JSValue.zero);
        }

        pub fn slice(this: *const ArrayBuffer.Strong) []u8 {
            return this.array_buffer.slice();
        }

        pub fn deinit(this: *ArrayBuffer.Strong) void {
            this.held.deinit();
        }
    };

    pub const empty = ArrayBuffer{ .offset = 0, .len = 0, .byte_len = 0, .typed_array_type = .Uint8Array, .ptr = undefined };

    pub const name = "Bun__ArrayBuffer";
    pub const Stream = std.io.FixedBufferStream([]u8);

    pub inline fn stream(this: ArrayBuffer) Stream {
        return Stream{ .pos = 0, .buf = this.slice() };
    }

    pub fn create(globalThis: *JSC.JSGlobalObject, bytes: []const u8, comptime kind: BinaryType) JSValue {
        JSC.markBinding(@src());
        return switch (comptime kind) {
            .Uint8Array => Bun__createUint8ArrayForCopy(globalThis, bytes.ptr, bytes.len, false),
            .Buffer => Bun__createUint8ArrayForCopy(globalThis, bytes.ptr, bytes.len, true),
            .ArrayBuffer => Bun__createArrayBufferForCopy(globalThis, bytes.ptr, bytes.len),
            else => @compileError("Not implemented yet"),
        };
    }

    pub fn createEmpty(globalThis: *JSC.JSGlobalObject, comptime kind: JSC.JSValue.JSType) JSValue {
        JSC.markBinding(@src());

        return switch (comptime kind) {
            .Uint8Array => Bun__createUint8ArrayForCopy(globalThis, null, 0, false),
            .ArrayBuffer => Bun__createArrayBufferForCopy(globalThis, null, 0),
            else => @compileError("Not implemented yet"),
        };
    }

    pub fn createBuffer(globalThis: *JSC.JSGlobalObject, bytes: []const u8) JSValue {
        JSC.markBinding(@src());
        return Bun__createUint8ArrayForCopy(globalThis, bytes.ptr, bytes.len, true);
    }

    extern "C" fn Bun__createUint8ArrayForCopy(*JSC.JSGlobalObject, ptr: ?*const anyopaque, len: usize, buffer: bool) JSValue;
    extern "C" fn Bun__createArrayBufferForCopy(*JSC.JSGlobalObject, ptr: ?*const anyopaque, len: usize) JSValue;

    pub fn fromTypedArray(ctx: JSC.C.JSContextRef, value: JSC.JSValue) ArrayBuffer {
        var out = std.mem.zeroes(ArrayBuffer);
        std.debug.assert(value.asArrayBuffer_(ctx.ptr(), &out));
        out.value = value;
        return out;
    }

    pub fn fromBytes(bytes: []u8, typed_array_type: JSC.JSValue.JSType) ArrayBuffer {
        return ArrayBuffer{ .offset = 0, .len = @as(u32, @intCast(bytes.len)), .byte_len = @as(u32, @intCast(bytes.len)), .typed_array_type = typed_array_type, .ptr = bytes.ptr };
    }

    pub fn toJSUnchecked(this: ArrayBuffer, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.JSValue {

        // The reason for this is
        // JSC C API returns a detached arraybuffer
        // if you pass it a zero-length TypedArray
        // we don't ever want to send the user a detached arraybuffer
        // that's just silly.
        if (this.byte_len == 0) {
            if (this.typed_array_type == .ArrayBuffer) {
                return create(ctx, "", .ArrayBuffer);
            }

            if (this.typed_array_type == .Uint8Array) {
                return create(ctx, "", .Uint8Array);
            }

            // TODO: others
        }

        if (this.typed_array_type == .ArrayBuffer) {
            return JSC.JSValue.fromRef(JSC.C.JSObjectMakeArrayBufferWithBytesNoCopy(
                ctx,
                this.ptr,
                this.byte_len,
                MarkedArrayBuffer_deallocator,
                @as(*anyopaque, @ptrFromInt(@intFromPtr(&bun.default_allocator))),
                exception,
            ));
        }

        return JSC.JSValue.fromRef(JSC.C.JSObjectMakeTypedArrayWithBytesNoCopy(
            ctx,
            this.typed_array_type.toC(),
            this.ptr,
            this.byte_len,
            MarkedArrayBuffer_deallocator,
            @as(*anyopaque, @ptrFromInt(@intFromPtr(&bun.default_allocator))),
            exception,
        ));
    }

    const log = Output.scoped(.ArrayBuffer, false);

    pub fn toJS(this: ArrayBuffer, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.JSValue {
        if (!this.value.isEmpty()) {
            return this.value;
        }

        // If it's not a mimalloc heap buffer, we're not going to call a deallocator
        if (this.len > 0 and !bun.Mimalloc.mi_is_in_heap_region(this.ptr)) {
            log("toJS but will never free: {d} bytes", .{this.len});

            if (this.typed_array_type == .ArrayBuffer) {
                return JSC.JSValue.fromRef(JSC.C.JSObjectMakeArrayBufferWithBytesNoCopy(
                    ctx,
                    this.ptr,
                    this.byte_len,
                    null,
                    null,
                    exception,
                ));
            }

            return JSC.JSValue.fromRef(JSC.C.JSObjectMakeTypedArrayWithBytesNoCopy(
                ctx,
                this.typed_array_type.toC(),
                this.ptr,
                this.byte_len,
                null,
                null,
                exception,
            ));
        }

        return this.toJSUnchecked(ctx, exception);
    }

    pub fn toJSWithContext(
        this: ArrayBuffer,
        ctx: JSC.C.JSContextRef,
        deallocator: ?*anyopaque,
        callback: JSC.C.JSTypedArrayBytesDeallocator,
        exception: JSC.C.ExceptionRef,
    ) JSC.JSValue {
        if (!this.value.isEmpty()) {
            return this.value;
        }

        if (this.typed_array_type == .ArrayBuffer) {
            return JSC.JSValue.fromRef(JSC.C.JSObjectMakeArrayBufferWithBytesNoCopy(
                ctx,
                this.ptr,
                this.byte_len,
                callback,
                deallocator,
                exception,
            ));
        }

        return JSC.JSValue.fromRef(JSC.C.JSObjectMakeTypedArrayWithBytesNoCopy(
            ctx,
            this.typed_array_type.toC(),
            this.ptr,
            this.byte_len,
            callback,
            deallocator,
            exception,
        ));
    }

    pub const fromArrayBuffer = fromTypedArray;

    /// The equivalent of
    ///
    /// ```js
    ///    new ArrayBuffer(view.buffer, view.byteOffset, view.byteLength)
    /// ```
    pub inline fn byteSlice(this: *const @This()) []u8 {
        return this.ptr[this.offset .. this.offset + this.byte_len];
    }

    /// The equivalent of
    ///
    /// ```js
    ///    new ArrayBuffer(view.buffer, view.byteOffset, view.byteLength)
    /// ```
    pub const slice = byteSlice;

    pub inline fn asU16(this: *const @This()) []u16 {
        return std.mem.bytesAsSlice(u16, @as([*]u16, @alignCast(this.ptr))[this.offset..this.byte_len]);
    }

    pub inline fn asU16Unaligned(this: *const @This()) []align(1) u16 {
        return std.mem.bytesAsSlice(u16, @as([*]align(1) u16, @alignCast(this.ptr))[this.offset..this.byte_len]);
    }

    pub inline fn asU32(this: *const @This()) []u32 {
        return std.mem.bytesAsSlice(u32, @as([*]u32, @alignCast(this.ptr))[this.offset..this.byte_len]);
    }
};

pub const MarkedArrayBuffer = struct {
    buffer: ArrayBuffer,
    allocator: ?std.mem.Allocator = null,

    pub const Stream = ArrayBuffer.Stream;

    pub inline fn stream(this: *MarkedArrayBuffer) Stream {
        return this.buffer.stream();
    }

    pub fn fromTypedArray(ctx: JSC.C.JSContextRef, value: JSC.JSValue) MarkedArrayBuffer {
        return MarkedArrayBuffer{
            .allocator = null,
            .buffer = ArrayBuffer.fromTypedArray(ctx, value),
        };
    }
    pub fn fromArrayBuffer(ctx: JSC.C.JSContextRef, value: JSC.JSValue) MarkedArrayBuffer {
        return MarkedArrayBuffer{
            .allocator = null,
            .buffer = ArrayBuffer.fromArrayBuffer(ctx, value),
        };
    }

    pub fn fromString(str: []const u8, allocator: std.mem.Allocator) !MarkedArrayBuffer {
        var buf = try allocator.dupe(u8, str);
        return MarkedArrayBuffer.fromBytes(buf, allocator, JSC.JSValue.JSType.Uint8Array);
    }

    pub fn fromJS(global: *JSC.JSGlobalObject, value: JSC.JSValue, _: JSC.C.ExceptionRef) ?MarkedArrayBuffer {
        const array_buffer = value.asArrayBuffer(global) orelse return null;
        return MarkedArrayBuffer{ .buffer = array_buffer, .allocator = null };
    }

    pub fn fromBytes(bytes: []u8, allocator: std.mem.Allocator, typed_array_type: JSC.JSValue.JSType) MarkedArrayBuffer {
        return MarkedArrayBuffer{
            .buffer = ArrayBuffer.fromBytes(bytes, typed_array_type),
            .allocator = allocator,
        };
    }

    pub const empty = MarkedArrayBuffer{
        .allocator = null,
        .buffer = ArrayBuffer.empty,
    };

    pub inline fn slice(this: *const @This()) []u8 {
        return this.buffer.byteSlice();
    }

    pub fn destroy(this: *MarkedArrayBuffer) void {
        const content = this.*;
        if (this.allocator) |allocator| {
            this.allocator = null;
            allocator.free(content.buffer.slice());
            allocator.destroy(this);
        }
    }

    pub fn init(allocator: std.mem.Allocator, size: u32, typed_array_type: js.JSTypedArrayType) !*MarkedArrayBuffer {
        const bytes = try allocator.alloc(u8, size);
        var container = try allocator.create(MarkedArrayBuffer);
        container.* = MarkedArrayBuffer.fromBytes(bytes, allocator, typed_array_type);
        return container;
    }

    pub fn toNodeBuffer(this: MarkedArrayBuffer, ctx: js.JSContextRef) js.JSObjectRef {
        return JSValue.createBufferWithCtx(ctx, this.buffer.byteSlice(), this.buffer.ptr, MarkedArrayBuffer_deallocator).asObjectRef();
    }

    pub fn toJSObjectRef(this: MarkedArrayBuffer, ctx: js.JSContextRef, exception: js.ExceptionRef) js.JSObjectRef {
        if (!this.buffer.value.isEmptyOrUndefinedOrNull()) {
            return this.buffer.value.asObjectRef();
        }
        if (this.buffer.byte_len == 0) {
            return js.JSObjectMakeTypedArray(
                ctx,
                this.buffer.typed_array_type.toC(),
                0,
                exception,
            );
        }

        return js.JSObjectMakeTypedArrayWithBytesNoCopy(
            ctx,
            this.buffer.typed_array_type.toC(),
            this.buffer.ptr,

            this.buffer.byte_len,
            MarkedArrayBuffer_deallocator,
            this.buffer.ptr,
            exception,
        );
    }

    pub const toJS = toJSObjectRef;
};

// expensive heap reference-counted string type
// only use this for big strings
// like source code
// not little ones
pub const RefString = struct {
    ptr: [*]const u8 = undefined,
    len: usize = 0,
    hash: Hash = 0,
    impl: bun.WTF.StringImpl,

    allocator: std.mem.Allocator,

    ctx: ?*anyopaque = null,
    onBeforeDeinit: ?*const Callback = null,

    pub const Hash = u32;
    pub const Map = std.HashMap(Hash, *JSC.RefString, IdentityContext(Hash), 80);

    pub fn toJS(this: *RefString, global: *JSC.JSGlobalObject) JSValue {
        return bun.String.init(this.impl).toJS(global);
    }

    pub const Callback = fn (ctx: *anyopaque, str: *RefString) void;

    pub fn computeHash(input: []const u8) u32 {
        return std.hash.XxHash32.hash(0, input);
    }

    pub fn slice(this: *RefString) []const u8 {
        this.ref();

        return this.leak();
    }

    pub fn ref(this: *RefString) void {
        this.impl.ref();
    }

    pub fn leak(this: RefString) []const u8 {
        @setRuntimeSafety(false);
        return this.ptr[0..this.len];
    }

    pub fn deref(this: *RefString) void {
        this.impl.deref();
    }

    pub export fn RefString__free(this: *anyopaque, _: *anyopaque, _: u32) void {
        bun.cast(*RefString, this).deinit();
    }

    pub fn deinit(this: *RefString) void {
        if (this.onBeforeDeinit) |onBeforeDeinit| {
            onBeforeDeinit(this.ctx.?, this);
        }

        this.allocator.free(this.leak());
        this.allocator.destroy(this);
    }
};

comptime {
    std.testing.refAllDecls(RefString);
}

// TODO: remove this abstraction and make it work directly with
pub const ExternalBuffer = struct {
    global: *JSC.JSGlobalObject,
    ctx: ?*anyopaque = null,
    function: JSC.napi.napi_finalize = null,
    allocator: std.mem.Allocator,
    buf: []u8 = &[_]u8{},

    pub fn create(ctx: ?*anyopaque, buf: []u8, global: *JSC.JSGlobalObject, function: JSC.napi.napi_finalize, allocator: std.mem.Allocator) !*ExternalBuffer {
        var container = try allocator.create(ExternalBuffer);
        container.* = .{
            .ctx = ctx,
            .global = global,
            .allocator = allocator,
            .function = function,
            .buf = buf,
        };
        return container;
    }

    pub fn toJS(this: *ExternalBuffer, ctx: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.JSValue.createBufferWithCtx(ctx, this.buf, this, ExternalBuffer_deallocator);
    }

    pub fn toArrayBuffer(this: *ExternalBuffer, ctx: *JSC.JSGlobalObject) JSC.JSValue {
        return JSValue.c(JSC.C.JSObjectMakeArrayBufferWithBytesNoCopy(ctx.ref(), this.buf.ptr, this.buf.len, ExternalBuffer_deallocator, this, null));
    }
};
pub export fn ExternalBuffer_deallocator(bytes_: *anyopaque, ctx: *anyopaque) callconv(.C) void {
    var external: *ExternalBuffer = bun.cast(*ExternalBuffer, ctx);
    if (external.function) |function| {
        function(external.global, external.ctx, bytes_);
    }

    const allocator = external.allocator;
    allocator.destroy(external);
}

pub export fn MarkedArrayBuffer_deallocator(bytes_: *anyopaque, _: *anyopaque) void {
    const mimalloc = @import("../allocators/mimalloc.zig");
    // zig's memory allocator interface won't work here
    // mimalloc knows the size of things
    // but we don't
    // if (comptime Environment.allow_assert) {
    //     std.debug.assert(mimalloc.mi_check_owned(bytes_) or
    //         mimalloc.mi_heap_check_owned(JSC.VirtualMachine.get().arena.heap.?, bytes_));
    // }

    mimalloc.mi_free(bytes_);
}

pub export fn BlobArrayBuffer_deallocator(_: *anyopaque, blob: *anyopaque) void {
    // zig's memory allocator interface won't work here
    // mimalloc knows the size of things
    // but we don't
    var store = bun.cast(*JSC.WebCore.Blob.Store, blob);
    store.deref();
}

pub fn castObj(obj: js.JSObjectRef, comptime Type: type) *Type {
    return JSPrivateDataPtr.from(js.JSObjectGetPrivate(obj)).as(Type);
}

const JSNode = @import("../js_ast.zig").Macro.JSNode;
const LazyPropertiesObject = @import("../js_ast.zig").Macro.LazyPropertiesObject;
const ModuleNamespace = @import("../js_ast.zig").Macro.ModuleNamespace;
const Expect = Test.Expect;
const DescribeScope = Test.DescribeScope;
const TestScope = Test.TestScope;
const NodeFS = JSC.Node.NodeFS;
const TextEncoder = WebCore.TextEncoder;
const TextDecoder = WebCore.TextDecoder;
const HTMLRewriter = JSC.Cloudflare.HTMLRewriter;
const Element = JSC.Cloudflare.Element;
const Comment = JSC.Cloudflare.Comment;
const TextChunk = JSC.Cloudflare.TextChunk;
const DocType = JSC.Cloudflare.DocType;
const EndTag = JSC.Cloudflare.EndTag;
const DocEnd = JSC.Cloudflare.DocEnd;
const AttributeIterator = JSC.Cloudflare.AttributeIterator;
const Blob = JSC.WebCore.Blob;
const Server = JSC.API.Server;
const SSLServer = JSC.API.SSLServer;
const DebugServer = JSC.API.DebugServer;
const DebugSSLServer = JSC.API.DebugSSLServer;
const SHA1 = JSC.API.Bun.Crypto.SHA1;
const MD5 = JSC.API.Bun.Crypto.MD5;
const MD4 = JSC.API.Bun.Crypto.MD4;
const SHA224 = JSC.API.Bun.Crypto.SHA224;
const SHA512 = JSC.API.Bun.Crypto.SHA512;
const SHA384 = JSC.API.Bun.Crypto.SHA384;
const SHA256 = JSC.API.Bun.Crypto.SHA256;
const SHA512_256 = JSC.API.Bun.Crypto.SHA512_256;
const MD5_SHA1 = JSC.API.Bun.Crypto.MD5_SHA1;
const FFI = JSC.FFI;
pub const JSPrivateDataPtr = TaggedPointerUnion(.{
    DebugServer,
    DebugSSLServer,
    FetchEvent,
    JSNode,
    LazyPropertiesObject,

    ModuleNamespace,
    Router,
    Server,

    SSLServer,
    FFI,
});

pub inline fn GetJSPrivateData(comptime Type: type, ref: js.JSObjectRef) ?*Type {
    return JSPrivateDataPtr.from(js.JSObjectGetPrivate(ref)).get(Type);
}

pub const JSPropertyNameIterator = struct {
    array: js.JSPropertyNameArrayRef,
    count: u32,
    i: u32 = 0,

    pub fn next(this: *JSPropertyNameIterator) ?js.JSStringRef {
        if (this.i >= this.count) return null;
        const i = this.i;
        this.i += 1;

        return js.JSPropertyNameArrayGetNameAtIndex(this.array, i);
    }
};

pub fn getterWrap(comptime Container: type, comptime name: string) GetterType(Container) {
    return struct {
        const FunctionType = @TypeOf(@field(Container, name));
        const FunctionTypeInfo: std.builtin.Type.Fn = @typeInfo(FunctionType).Fn;
        const ArgsTuple = std.meta.ArgsTuple(FunctionType);

        pub fn callback(
            this: *Container,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSStringRef,
            exception: js.ExceptionRef,
        ) js.JSObjectRef {
            const result: JSValue = if (comptime std.meta.fields(ArgsTuple).len == 1)
                @call(.auto, @field(Container, name), .{
                    this,
                })
            else
                @call(.auto, @field(Container, name), .{ this, ctx.ptr() });
            if (result.isError()) {
                exception.* = result.asObjectRef();
                return null;
            }

            return result.asObjectRef();
        }
    }.callback;
}

fn GetterType(comptime Container: type) type {
    return fn (
        this: *Container,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef;
}

fn MethodType(comptime Container: type, comptime has_container: bool) type {
    return fn (
        this: if (has_container) *Container else void,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        target: js.JSObjectRef,
        args: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef;
}

pub fn wrapSync(
    comptime Container: type,
    comptime name: string,
) MethodType(Container, true) {
    return wrap(Container, name, false);
}

pub fn wrapAsync(
    comptime Container: type,
    comptime name: string,
) MethodType(Container, true) {
    return wrap(Container, name, true);
}

pub fn wrap(
    comptime Container: type,
    comptime name: string,
    comptime maybe_async: bool,
) MethodType(Container, true) {
    return wrapWithHasContainer(Container, name, maybe_async, true, true);
}

pub const DOMEffect = struct {
    reads: [4]ID = std.mem.zeroes([4]ID),
    writes: [4]ID = std.mem.zeroes([4]ID),

    pub const top = DOMEffect{
        .reads = .{ ID.Heap, ID.Heap, ID.Heap, ID.Heap },
        .writes = .{ ID.Heap, ID.Heap, ID.Heap, ID.Heap },
    };

    pub fn forRead(read: ID) DOMEffect {
        return DOMEffect{
            .reads = .{ read, ID.Heap, ID.Heap, ID.Heap },
            .writes = .{ ID.Heap, ID.Heap, ID.Heap, ID.Heap },
        };
    }

    pub fn forWrite(read: ID) DOMEffect {
        return DOMEffect{
            .writes = .{ read, ID.Heap, ID.Heap, ID.Heap },
            .reads = .{ ID.Heap, ID.Heap, ID.Heap, ID.Heap },
        };
    }

    pub const pure = DOMEffect{};

    pub fn isPure(this: DOMEffect) bool {
        return this.reads[0] == ID.InvalidAbstractHeap and this.writes[0] == ID.InvalidAbstractHeap;
    }

    pub const ID = enum(u8) {
        InvalidAbstractHeap = 0,
        World,
        Stack,
        Heap,
        Butterfly_publicLength,
        Butterfly_vectorLength,
        GetterSetter_getter,
        GetterSetter_setter,
        JSCell_cellState,
        JSCell_indexingType,
        JSCell_structureID,
        JSCell_typeInfoFlags,
        JSObject_butterfly,
        JSPropertyNameEnumerator_cachedPropertyNames,
        RegExpObject_lastIndex,
        NamedProperties,
        IndexedInt32Properties,
        IndexedDoubleProperties,
        IndexedContiguousProperties,
        IndexedArrayStorageProperties,
        DirectArgumentsProperties,
        ScopeProperties,
        TypedArrayProperties,
        /// Used to reflect the fact that some allocations reveal object identity */
        HeapObjectCount,
        RegExpState,
        MathDotRandomState,
        JSDateFields,
        JSMapFields,
        JSSetFields,
        JSWeakMapFields,
        JSWeakSetFields,
        JSInternalFields,
        InternalState,
        CatchLocals,
        Absolute,
        /// DOMJIT tells the heap range with the pair of integers. */
        DOMState,
        /// Use this for writes only, to indicate that this may fire watchpoints. Usually this is never directly written but instead we test to see if a node clobbers this; it just so happens that you have to write world to clobber it. */
        Watchpoint_fire,
        /// Use these for reads only, just to indicate that if the world got clobbered, then this operation will not work. */
        MiscFields,
        /// Use this for writes only, just to indicate that hoisting the node is invalid. This works because we don't hoist anything that has any side effects at all. */
        SideState,
    };
};

fn DOMCallArgumentType(comptime Type: type) []const u8 {
    const ChildType = if (@typeInfo(Type) == .Pointer) std.meta.Child(Type) else Type;
    return switch (ChildType) {
        i8, u8, i16, u16, i32 => "JSC::SpecInt32Only",
        u32, i64, u64 => "JSC::SpecInt52Any",
        f64 => "JSC::SpecDoubleReal",
        bool => "JSC::SpecBoolean",
        JSC.JSString => "JSC::SpecString",
        JSC.JSUint8Array => "JSC::SpecUint8Array",
        else => @compileError("Unknown DOM type: " ++ @typeName(Type)),
    };
}

fn DOMCallArgumentTypeWrapper(comptime Type: type) []const u8 {
    const ChildType = if (@typeInfo(Type) == .Pointer) std.meta.Child(Type) else Type;
    return switch (ChildType) {
        i32 => "int32_t",
        f64 => "double",
        u64 => "uint64_t",
        i64 => "int64_t",
        bool => "bool",
        JSC.JSString => "JSC::JSString*",
        JSC.JSUint8Array => "JSC::JSUint8Array*",
        else => @compileError("Unknown DOM type: " ++ @typeName(Type)),
    };
}

fn DOMCallResultType(comptime Type: type) []const u8 {
    const ChildType = if (@typeInfo(Type) == .Pointer) std.meta.Child(Type) else Type;
    return switch (ChildType) {
        i32 => "JSC::SpecInt32Only",
        bool => "JSC::SpecBoolean",
        JSC.JSString => "JSC::SpecString",
        JSC.JSUint8Array => "JSC::SpecUint8Array",
        JSC.JSCell => "JSC::SpecCell",
        u52, i52 => "JSC::SpecInt52Any",
        f64 => "JSC::SpecDoubleReal",
        else => "JSC::SpecHeapTop",
    };
}

pub fn DOMCall(
    comptime class_name: string,
    comptime Container: type,
    comptime functionName: string,
    comptime ResultType: type,
    comptime dom_effect: DOMEffect,
) type {
    return extern struct {
        const className = class_name;
        pub const is_dom_call = true;
        const Slowpath = @field(Container, functionName);
        const SlowpathType = @TypeOf(@field(Container, functionName));
        pub const shim = JSC.Shimmer(className, functionName, @This());
        pub const name = class_name ++ "__" ++ functionName;

        // Zig doesn't support @frameAddress(1)
        // so we have to add a small wrapper fujnction
        pub fn slowpath(
            globalObject: *JSC.JSGlobalObject,
            thisValue: JSC.JSValue,
            arguments_ptr: [*]const JSC.JSValue,
            arguments_len: usize,
        ) callconv(.C) JSValue {
            return @call(.auto, @field(Container, functionName), .{
                globalObject,
                thisValue,
                arguments_ptr[0..arguments_len],
            });
        }

        pub const fastpath = @field(Container, functionName ++ "WithoutTypeChecks");
        pub const Fastpath = @TypeOf(fastpath);
        pub const Arguments = std.meta.ArgsTuple(Fastpath);

        pub const Export = shim.exportFunctions(.{
            .slowpath = slowpath,
            .fastpath = fastpath,
        });

        pub fn put(globalObject: *JSC.JSGlobalObject, value: JSValue) void {
            shim.cppFn("put", .{ globalObject, value });
        }

        pub const effect = dom_effect;

        pub fn printGenerateDOMJITSignature(comptime Writer: type, writer: Writer) !void {
            const signatureName = "DOMJIT_" ++ shim.name ++ "_signature";
            const slowPathName = Export[0].symbol_name;
            const fastPathName = Export[1].symbol_name;
            const Fields: []const std.builtin.Type.StructField = std.meta.fields(Arguments);

            const options = .{
                .name = functionName,
                .exportName = name ++ "__put",
                .signatureName = signatureName,
                .IDLResultName = DOMCallResultType(ResultType),
                .fastPathName = fastPathName,
                .slowPathName = slowPathName,
                .argumentsCount = Fields.len - 2,
            };
            {
                const fmt =
                    \\extern "C" JSC_DECLARE_HOST_FUNCTION({[slowPathName]s}Wrapper);
                    \\extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL({[fastPathName]s}Wrapper, EncodedJSValue, (JSC::JSGlobalObject* lexicalGlobalObject, void* thisValue
                ;
                try writer.print(fmt, .{ .fastPathName = options.fastPathName, .slowPathName = options.slowPathName });
            }
            {
                switch (Fields.len - 2) {
                    0 => {
                        try writer.writeAll("));\n");
                    },
                    1 => {
                        try writer.writeAll(", ");
                        try writer.writeAll(DOMCallArgumentTypeWrapper(Fields[2].type));
                        try writer.writeAll("));\n");
                    },
                    2 => {
                        try writer.writeAll(", ");
                        try writer.writeAll(DOMCallArgumentTypeWrapper(Fields[2].type));
                        try writer.writeAll(", ");
                        try writer.writeAll(DOMCallArgumentTypeWrapper(Fields[3].type));
                        try writer.writeAll("));\n");
                    },
                    else => @compileError("Must be <= 3 arguments"),
                }
            }

            {
                const fmt =
                    \\
                    \\JSC_DEFINE_JIT_OPERATION({[fastPathName]s}Wrapper, EncodedJSValue, (JSC::JSGlobalObject* lexicalGlobalObject, void* thisValue
                ;
                try writer.print(fmt, .{ .fastPathName = options.fastPathName });
            }
            {
                switch (Fields.len - 2) {
                    0 => {
                        try writer.writeAll(")) {\n");
                    },
                    1 => {
                        try writer.writeAll(", ");
                        try writer.writeAll(DOMCallArgumentTypeWrapper(Fields[2].type));
                        try writer.writeAll(" arg1)) {\n");
                    },
                    2 => {
                        try writer.writeAll(", ");
                        try writer.writeAll(DOMCallArgumentTypeWrapper(Fields[2].type));
                        try writer.writeAll(" arg1, ");
                        try writer.writeAll(DOMCallArgumentTypeWrapper(Fields[3].type));
                        try writer.writeAll(" arg2)) {\n");
                    },
                    else => @compileError("Must be <= 3 arguments"),
                }
                {
                    const fmt =
                        \\VM& vm = JSC::getVM(lexicalGlobalObject);
                        \\IGNORE_WARNINGS_BEGIN("frame-address")
                        \\CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
                        \\IGNORE_WARNINGS_END
                        \\JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
                        \\return {[fastPathName]s}(lexicalGlobalObject, thisValue
                    ;
                    try writer.print(fmt, .{ .fastPathName = options.fastPathName });
                }
                {
                    switch (Fields.len - 2) {
                        0 => {
                            try writer.writeAll(");\n}\n");
                        },
                        1 => {
                            try writer.writeAll(", arg1);\n}\n");
                        },
                        2 => {
                            try writer.writeAll(", arg1, arg2);\n}\n");
                        },
                        else => @compileError("Must be <= 3 arguments"),
                    }
                }
            }

            {
                const fmt =
                    \\JSC_DEFINE_HOST_FUNCTION({[slowPathName]s}Wrapper, (JSC::JSGlobalObject *globalObject, JSC::CallFrame* frame)) {{
                    \\    return {[slowPathName]s}(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
                    \\}}
                    \\
                    \\extern "C" void {[exportName]s}(JSC::JSGlobalObject *globalObject, JSC::EncodedJSValue value) {{
                    \\  JSC::JSObject *thisObject = JSC::jsCast<JSC::JSObject *>(JSC::JSValue::decode(value));
                    \\  static const JSC::DOMJIT::Signature {[signatureName]s}(
                    \\    {[fastPathName]s}Wrapper,
                    \\    thisObject->classInfo(),
                    \\
                ;

                try writer.print(fmt, .{
                    .slowPathName = options.slowPathName,
                    .exportName = options.exportName,
                    .fastPathName = options.fastPathName,
                    .signatureName = options.signatureName,
                });
            }
            if (effect.isPure()) {
                try writer.writeAll("JSC::DOMJIT::Effect::forPure(),\n  ");
            } else if (effect.writes[0] == DOMEffect.pure.writes[0]) {
                try writer.print(
                    "JSC::DOMJIT::Effect::forReadKinds(JSC::DFG::AbstractHeapKind::{s}, JSC::DFG::AbstractHeapKind::{s}, JSC::DFG::AbstractHeapKind::{s}, JSC::DFG::AbstractHeapKind::{s}),\n  ",
                    .{
                        @tagName(effect.reads[0]),
                        @tagName(effect.reads[1]),
                        @tagName(effect.reads[2]),
                        @tagName(effect.reads[3]),
                    },
                );
            } else if (effect.reads[0] == DOMEffect.pure.reads[0]) {
                try writer.print(
                    "JSC::DOMJIT::Effect::forWriteKinds(JSC::DFG::AbstractHeapKind::{s}, JSC::DFG::AbstractHeapKind::{s}, JSC::DFG::AbstractHeapKind::{s}, JSC::DFG::AbstractHeapKind::{s}),\n  ",
                    .{
                        @tagName(effect.writes[0]),
                        @tagName(effect.writes[1]),
                        @tagName(effect.writes[2]),
                        @tagName(effect.writes[3]),
                    },
                );
            } else {
                try writer.writeAll("JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),\n  ");
            }

            {
                try writer.writeAll(DOMCallResultType(ResultType));
            }

            switch (Fields.len - 2) {
                0 => {},
                1 => {
                    try writer.writeAll(",\n  ");
                    try writer.writeAll(DOMCallArgumentType(Fields[2].type));
                    try writer.writeAll("\n  ");
                },
                2 => {
                    try writer.writeAll(",\n  ");
                    try writer.writeAll(DOMCallArgumentType(Fields[2].type));
                    try writer.writeAll(",\n  ");
                    try writer.writeAll(DOMCallArgumentType(Fields[3].type));
                    try writer.writeAll("\n  ");
                },
                else => @compileError("Must be <= 3 arguments"),
            }

            try writer.writeAll(");\n  ");

            {
                const fmt =
                    \\                JSFunction* function = JSFunction::create(
                    \\                    globalObject->vm(),
                    \\                    globalObject,
                    \\                    {[argumentsCount]d},
                    \\                    String("{[name]s}"_s),
                    \\                    {[slowPathName]s}Wrapper, ImplementationVisibility::Public, NoIntrinsic, {[slowPathName]s}Wrapper,
                    \\                    &{[signatureName]s}
                    \\                );
                    \\           thisObject->putDirect(
                    \\             globalObject->vm(),
                    \\             Identifier::fromString(globalObject->vm(), "{[name]s}"_s),
                    \\             function,
                    \\             JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DOMJITFunction | 0
                    \\           );
                    \\}}
                ;
                try writer.print(fmt, .{
                    .argumentsCount = options.argumentsCount,
                    .name = options.name,
                    .slowPathName = options.slowPathName,
                    .signatureName = options.signatureName,
                });
            }
        }

        pub const Extern = [_][]const u8{"put"};

        comptime {
            if (!JSC.is_bindgen) {
                @export(slowpath, .{ .name = Export[0].symbol_name });
                @export(fastpath, .{ .name = Export[1].symbol_name });
            } else {
                _ = slowpath;
                _ = fastpath;
            }
        }
    };
}

pub fn wrapWithHasContainer(
    comptime Container: type,
    comptime name: string,
    comptime maybe_async: bool,
    comptime has_container: bool,
    comptime auto_protect: bool,
) MethodType(Container, has_container) {
    return struct {
        const FunctionType = @TypeOf(@field(Container, name));
        const FunctionTypeInfo: std.builtin.Type.Fn = @typeInfo(FunctionType).Fn;
        const Args = std.meta.ArgsTuple(FunctionType);
        const eater = if (auto_protect) JSC.Node.ArgumentsSlice.protectEatNext else JSC.Node.ArgumentsSlice.nextEat;

        pub fn callback(
            this: if (has_container) *Container else void,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            thisObject: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSObjectRef {
            var iter = JSC.Node.ArgumentsSlice.from(ctx.bunVM(), arguments);
            defer iter.deinit();
            var args: Args = undefined;

            comptime var passed_exception_ref = false;
            comptime var i: usize = 0;
            inline while (i < FunctionTypeInfo.params.len) : (i += 1) {
                const ArgType = comptime FunctionTypeInfo.params[i].type.?;

                switch (comptime ArgType) {
                    *Container => {
                        args[i] = this;
                    },
                    *JSC.JSGlobalObject => {
                        args[i] = ctx.ptr();
                    },
                    JSC.Node.StringOrBuffer => {
                        const arg = iter.nextEat() orelse {
                            exception.* = JSC.toInvalidArguments("expected string or buffer", .{}, ctx).asObjectRef();
                            return null;
                        };
                        args[i] = JSC.Node.StringOrBuffer.fromJS(ctx.ptr(), iter.arena.allocator(), arg, exception) orelse {
                            exception.* = JSC.toInvalidArguments("expected string or buffer", .{}, ctx).asObjectRef();
                            return null;
                        };
                    },
                    ?JSC.Node.StringOrBuffer => {
                        if (iter.nextEat()) |arg| {
                            if (!arg.isEmptyOrUndefinedOrNull()) {
                                args[i] = JSC.Node.StringOrBuffer.fromJS(ctx.ptr(), iter.arena.allocator(), arg, exception) orelse {
                                    exception.* = JSC.toInvalidArguments("expected string or buffer", .{}, ctx).asObjectRef();
                                    return null;
                                };
                            } else {
                                args[i] = null;
                            }
                        } else {
                            args[i] = null;
                        }
                    },
                    ?JSC.Node.SliceOrBuffer => {
                        if (iter.nextEat()) |arg| {
                            if (!arg.isEmptyOrUndefinedOrNull()) {
                                args[i] = JSC.Node.SliceOrBuffer.fromJS(ctx.ptr(), iter.arena.allocator(), arg, exception) orelse {
                                    exception.* = JSC.toInvalidArguments("expected string or buffer", .{}, ctx).asObjectRef();
                                    return null;
                                };
                            } else {
                                args[i] = null;
                            }
                        } else {
                            args[i] = null;
                        }
                    },
                    JSC.ArrayBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = arg.asArrayBuffer(ctx.ptr()) orelse {
                                exception.* = JSC.toInvalidArguments("expected TypedArray", .{}, ctx).asObjectRef();
                                return null;
                            };
                        } else {
                            exception.* = JSC.toInvalidArguments("expected TypedArray", .{}, ctx).asObjectRef();
                            return null;
                        }
                    },
                    ?JSC.ArrayBuffer => {
                        if (iter.nextEat()) |arg| {
                            if (!arg.isEmptyOrUndefinedOrNull()) {
                                args[i] = arg.asArrayBuffer(ctx.ptr()) orelse {
                                    exception.* = JSC.toInvalidArguments("expected TypedArray", .{}, ctx).asObjectRef();
                                    return null;
                                };
                            } else {
                                args[i] = null;
                            }
                        } else {
                            args[i] = null;
                        }
                    },
                    ZigString => {
                        var string_value = eater(&iter) orelse {
                            JSC.throwInvalidArguments("Missing argument", .{}, ctx, exception);
                            return null;
                        };

                        if (string_value.isUndefinedOrNull()) {
                            JSC.throwInvalidArguments("Expected string", .{}, ctx, exception);
                            return null;
                        }

                        args[i] = string_value.getZigString(ctx.ptr());
                    },
                    ?JSC.Cloudflare.ContentOptions => {
                        if (iter.nextEat()) |content_arg| {
                            if (content_arg.get(ctx.ptr(), "html")) |html_val| {
                                args[i] = .{ .html = html_val.toBoolean() };
                            }
                        } else {
                            args[i] = null;
                        }
                    },
                    *Response => {
                        args[i] = (eater(&iter) orelse {
                            JSC.throwInvalidArguments("Missing Response object", .{}, ctx, exception);
                            iter.deinit();
                            return null;
                        }).as(Response) orelse {
                            JSC.throwInvalidArguments("Expected Response object", .{}, ctx, exception);
                            iter.deinit();
                            return null;
                        };
                    },
                    *Request => {
                        args[i] = (eater(&iter) orelse {
                            JSC.throwInvalidArguments("Missing Request object", .{}, ctx, exception);
                            return null;
                        }).as(Request) orelse {
                            JSC.throwInvalidArguments("Expected Request object", .{}, ctx, exception);
                            return null;
                        };
                    },
                    js.JSObjectRef => {
                        args[i] = thisObject;
                        if (!JSValue.fromRef(thisObject).isCell() or !JSValue.fromRef(thisObject).isObject()) {
                            JSC.throwInvalidArguments("Expected object", .{}, ctx, exception);
                            return null;
                        }
                    },
                    js.ExceptionRef => {
                        args[i] = exception;
                        passed_exception_ref = true;
                    },
                    JSValue => {
                        const val = eater(&iter) orelse {
                            JSC.throwInvalidArguments("Missing argument", .{}, ctx, exception);
                            return null;
                        };
                        args[i] = val;
                    },
                    ?JSValue => {
                        args[i] = eater(&iter);
                    },
                    else => @compileError("Unexpected Type " ++ @typeName(ArgType)),
                }
            }

            var result: JSValue = @call(.auto, @field(Container, name), args);
            if (comptime passed_exception_ref) {
                if (exception.* != null) {
                    return null;
                }
            } else {
                if (result.isError()) {
                    exception.* = result.asObjectRef();
                    return null;
                }
            }

            if (comptime maybe_async) {
                if (result.asAnyPromise()) |promise| {
                    var vm = ctx.ptr().bunVM();
                    vm.waitForPromise(promise);
                    result = promise.result(ctx.vm());
                }
            }

            if (result == .zero) {
                return null;
            }

            return result.asObjectRef();
        }
    }.callback;
}

pub fn InstanceMethodType(comptime Container: type) type {
    return fn (instance: *Container, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue;
}

pub fn wrapInstanceMethod(
    comptime Container: type,
    comptime name: string,
    comptime auto_protect: bool,
) InstanceMethodType(Container) {
    return struct {
        const FunctionType = @TypeOf(@field(Container, name));
        const FunctionTypeInfo: std.builtin.Type.Fn = @typeInfo(FunctionType).Fn;
        const Args = std.meta.ArgsTuple(FunctionType);
        const eater = if (auto_protect) JSC.Node.ArgumentsSlice.protectEatNext else JSC.Node.ArgumentsSlice.nextEat;

        pub fn method(
            this: *Container,
            globalThis: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            const arguments = callframe.arguments(FunctionTypeInfo.params.len);
            var iter = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments.ptr[0..arguments.len]);
            var args: Args = undefined;

            comptime var i: usize = 0;
            inline while (i < FunctionTypeInfo.params.len) : (i += 1) {
                const ArgType = comptime FunctionTypeInfo.params[i].type.?;

                switch (comptime ArgType) {
                    *Container => {
                        args[i] = this;
                    },
                    *JSC.JSGlobalObject => {
                        args[i] = globalThis.ptr();
                    },
                    *JSC.CallFrame => {
                        args[i] = callframe;
                    },
                    JSC.Node.StringOrBuffer => {
                        const arg = iter.nextEat() orelse {
                            globalThis.throwInvalidArguments("expected string or buffer", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        };
                        args[i] = JSC.Node.StringOrBuffer.fromJS(globalThis.ptr(), iter.arena.allocator(), arg, null) orelse {
                            globalThis.throwInvalidArguments("expected string or buffer", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        };
                    },
                    ?JSC.Node.StringOrBuffer => {
                        if (iter.nextEat()) |arg| {
                            if (!arg.isEmptyOrUndefinedOrNull()) {
                                args[i] = JSC.Node.StringOrBuffer.fromJS(globalThis.ptr(), iter.arena.allocator(), arg, null) orelse {
                                    globalThis.throwInvalidArguments("expected string or buffer", .{});
                                    iter.deinit();
                                    return JSC.JSValue.zero;
                                };
                            } else {
                                args[i] = null;
                            }
                        } else {
                            args[i] = null;
                        }
                    },
                    ?JSC.Node.SliceOrBuffer => {
                        if (iter.nextEat()) |arg| {
                            if (!arg.isEmptyOrUndefinedOrNull()) {
                                args[i] = JSC.Node.SliceOrBuffer.fromJS(globalThis.ptr(), iter.arena.allocator(), arg) orelse {
                                    globalThis.throwInvalidArguments("expected string or buffer", .{});
                                    iter.deinit();
                                    return JSC.JSValue.zero;
                                };
                            } else {
                                args[i] = null;
                            }
                        } else {
                            args[i] = null;
                        }
                    },
                    JSC.ArrayBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = arg.asArrayBuffer(globalThis.ptr()) orelse {
                                globalThis.throwInvalidArguments("expected TypedArray", .{});
                                iter.deinit();
                                return JSC.JSValue.zero;
                            };
                        } else {
                            globalThis.throwInvalidArguments("expected TypedArray", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        }
                    },
                    ?JSC.ArrayBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = arg.asArrayBuffer(globalThis.ptr()) orelse {
                                globalThis.throwInvalidArguments("expected TypedArray", .{});
                                iter.deinit();
                                return JSC.JSValue.zero;
                            };
                        } else {
                            args[i] = null;
                        }
                    },
                    ZigString => {
                        var string_value = eater(&iter) orelse {
                            globalThis.throwInvalidArguments("Missing argument", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        };

                        if (string_value.isUndefinedOrNull()) {
                            globalThis.throwInvalidArguments("Expected string", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        }

                        args[i] = string_value.getZigString(globalThis.ptr());
                    },
                    ?JSC.Cloudflare.ContentOptions => {
                        if (iter.nextEat()) |content_arg| {
                            if (content_arg.get(globalThis.ptr(), "html")) |html_val| {
                                args[i] = .{ .html = html_val.toBoolean() };
                            }
                        } else {
                            args[i] = null;
                        }
                    },
                    *Response => {
                        args[i] = (eater(&iter) orelse {
                            globalThis.throwInvalidArguments("Missing Response object", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        }).as(Response) orelse {
                            globalThis.throwInvalidArguments("Expected Response object", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        };
                    },
                    *Request => {
                        args[i] = (eater(&iter) orelse {
                            globalThis.throwInvalidArguments("Missing Request object", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        }).as(Request) orelse {
                            globalThis.throwInvalidArguments("Expected Request object", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        };
                    },
                    JSValue => {
                        const val = eater(&iter) orelse {
                            globalThis.throwInvalidArguments("Missing argument", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        };
                        args[i] = val;
                    },
                    ?JSValue => {
                        args[i] = eater(&iter);
                    },
                    else => @compileError("Unexpected Type " ++ @typeName(ArgType)),
                }
            }

            defer iter.deinit();

            return @call(.auto, @field(Container, name), args);
        }
    }.method;
}

pub fn wrapStaticMethod(
    comptime Container: type,
    comptime name: string,
    comptime auto_protect: bool,
) JSC.Codegen.StaticCallbackType {
    return struct {
        const FunctionType = @TypeOf(@field(Container, name));
        const FunctionTypeInfo: std.builtin.Type.Fn = @typeInfo(FunctionType).Fn;
        const Args = std.meta.ArgsTuple(FunctionType);
        const eater = if (auto_protect) JSC.Node.ArgumentsSlice.protectEatNext else JSC.Node.ArgumentsSlice.nextEat;

        pub fn method(
            globalThis: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            const arguments = callframe.arguments(FunctionTypeInfo.params.len);
            var iter = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments.ptr[0..arguments.len]);
            var args: Args = undefined;

            comptime var i: usize = 0;
            inline while (i < FunctionTypeInfo.params.len) : (i += 1) {
                const ArgType = comptime FunctionTypeInfo.params[i].type.?;

                switch (comptime ArgType) {
                    *JSC.JSGlobalObject => {
                        args[i] = globalThis.ptr();
                    },
                    JSC.Node.StringOrBuffer => {
                        const arg = iter.nextEat() orelse {
                            globalThis.throwInvalidArguments("expected string or buffer", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        };
                        args[i] = JSC.Node.StringOrBuffer.fromJS(globalThis.ptr(), iter.arena.allocator(), arg, null) orelse {
                            globalThis.throwInvalidArguments("expected string or buffer", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        };
                    },
                    ?JSC.Node.StringOrBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = JSC.Node.StringOrBuffer.fromJS(globalThis.ptr(), iter.arena.allocator(), arg, null) orelse {
                                globalThis.throwInvalidArguments("expected string or buffer", .{});
                                iter.deinit();
                                return JSC.JSValue.zero;
                            };
                        } else {
                            args[i] = null;
                        }
                    },
                    JSC.Node.SliceOrBuffer => {
                        const arg = iter.nextEat() orelse {
                            globalThis.throwInvalidArguments("expected string or buffer", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        };
                        args[i] = JSC.Node.SliceOrBuffer.fromJS(globalThis.ptr(), iter.arena.allocator(), arg) orelse {
                            globalThis.throwInvalidArguments("expected string or buffer", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        };
                    },
                    ?JSC.Node.SliceOrBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = JSC.Node.SliceOrBuffer.fromJS(globalThis.ptr(), iter.arena.allocator(), arg) orelse {
                                globalThis.throwInvalidArguments("expected string or buffer", .{});
                                iter.deinit();
                                return JSC.JSValue.zero;
                            };
                        } else {
                            args[i] = null;
                        }
                    },
                    JSC.ArrayBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = arg.asArrayBuffer(globalThis.ptr()) orelse {
                                globalThis.throwInvalidArguments("expected TypedArray", .{});
                                iter.deinit();
                                return JSC.JSValue.zero;
                            };
                        } else {
                            globalThis.throwInvalidArguments("expected TypedArray", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        }
                    },
                    ?JSC.ArrayBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = arg.asArrayBuffer(globalThis.ptr()) orelse {
                                globalThis.throwInvalidArguments("expected TypedArray", .{});
                                iter.deinit();
                                return JSC.JSValue.zero;
                            };
                        } else {
                            args[i] = null;
                        }
                    },
                    ZigString => {
                        var string_value = eater(&iter) orelse {
                            globalThis.throwInvalidArguments("Missing argument", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        };

                        if (string_value.isUndefinedOrNull()) {
                            globalThis.throwInvalidArguments("Expected string", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        }

                        args[i] = string_value.getZigString(globalThis.ptr());
                    },
                    ?JSC.Cloudflare.ContentOptions => {
                        if (iter.nextEat()) |content_arg| {
                            if (content_arg.get(globalThis.ptr(), "html")) |html_val| {
                                args[i] = .{ .html = html_val.toBoolean() };
                            }
                        } else {
                            args[i] = null;
                        }
                    },
                    *Response => {
                        args[i] = (eater(&iter) orelse {
                            globalThis.throwInvalidArguments("Missing Response object", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        }).as(Response) orelse {
                            globalThis.throwInvalidArguments("Expected Response object", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        };
                    },
                    *Request => {
                        args[i] = (eater(&iter) orelse {
                            globalThis.throwInvalidArguments("Missing Request object", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        }).as(Request) orelse {
                            globalThis.throwInvalidArguments("Expected Request object", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        };
                    },
                    JSValue => {
                        const val = eater(&iter) orelse {
                            globalThis.throwInvalidArguments("Missing argument", .{});
                            iter.deinit();
                            return JSC.JSValue.zero;
                        };
                        args[i] = val;
                    },
                    ?JSValue => {
                        args[i] = eater(&iter);
                    },
                    else => @compileError(std.fmt.comptimePrint("Unexpected Type " ++ @typeName(ArgType) ++ " at argument {d} in {s}#{s}", .{ i, @typeName(Container), name })),
                }
            }

            defer iter.deinit();

            return @call(.auto, @field(Container, name), args);
        }
    }.method;
}

/// Track whether an object should keep the event loop alive
pub const Ref = struct {
    has: bool = false,

    pub fn init() Ref {
        return .{};
    }

    pub fn unref(this: *Ref, vm: *JSC.VirtualMachine) void {
        if (!this.has)
            return;
        this.has = false;
        vm.active_tasks -= 1;
    }

    pub fn ref(this: *Ref, vm: *JSC.VirtualMachine) void {
        if (this.has)
            return;
        this.has = true;
        vm.active_tasks += 1;
    }
};

/// Track if an object whose file descriptor is being watched should keep the event loop alive.
/// This is not reference counted. It only tracks active or inactive.
pub const PollRef = struct {
    status: Status = .inactive,

    const log = Output.scoped(.PollRef, false);

    const Status = enum { active, inactive, done };

    pub inline fn isActive(this: PollRef) bool {
        return this.status == .active;
    }

    /// Make calling ref() on this poll into a no-op.
    pub fn disable(this: *PollRef) void {
        this.unref(JSC.VirtualMachine.get());
        this.status = .done;
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn deactivate(this: *PollRef, loop: *uws.Loop) void {
        if (this.status != .active)
            return;

        this.status = .inactive;
        loop.num_polls -= 1;
        loop.active -|= 1;
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn activate(this: *PollRef, loop: *uws.Loop) void {
        if (this.status != .inactive)
            return;

        this.status = .active;
        loop.num_polls += 1;
        loop.active += 1;
    }

    pub fn init() PollRef {
        return .{};
    }

    /// Prevent a poll from keeping the process alive.
    pub fn unref(this: *PollRef, vm: *JSC.VirtualMachine) void {
        if (this.status != .active)
            return;
        this.status = .inactive;
        vm.uws_event_loop.?.unref();
    }

    /// From another thread, Prevent a poll from keeping the process alive.
    pub fn unrefConcurrently(this: *PollRef, vm: *JSC.VirtualMachine) void {
        if (this.status != .active)
            return;
        this.status = .inactive;
        vm.uws_event_loop.?.unrefConcurrently();
    }

    /// Prevent a poll from keeping the process alive on the next tick.
    pub fn unrefOnNextTick(this: *PollRef, vm: *JSC.VirtualMachine) void {
        if (this.status != .active)
            return;
        this.status = .inactive;
        vm.pending_unref_counter +|= 1;
    }

    /// From another thread, prevent a poll from keeping the process alive on the next tick.
    pub fn unrefOnNextTickConcurrently(this: *PollRef, vm: *JSC.VirtualMachine) void {
        if (this.status != .active)
            return;
        this.status = .inactive;
        _ = @atomicRmw(@TypeOf(vm.pending_unref_counter), &vm.pending_unref_counter, .Add, 1, .Monotonic);
    }

    /// Allow a poll to keep the process alive.
    pub fn ref(this: *PollRef, vm: *JSC.VirtualMachine) void {
        if (this.status != .inactive)
            return;
        this.status = .active;
        vm.uws_event_loop.?.ref();
    }

    /// Allow a poll to keep the process alive.
    pub fn refConcurrently(this: *PollRef, vm: *JSC.VirtualMachine) void {
        if (this.status != .inactive)
            return;
        this.status = .active;
        vm.uws_event_loop.?.refConcurrently();
    }
};

const KQueueGenerationNumber = if (Environment.isMac and Environment.allow_assert) usize else u0;
pub const FilePoll = struct {
    var max_generation_number: KQueueGenerationNumber = 0;

    fd: u32 = invalid_fd,
    flags: Flags.Set = Flags.Set{},
    owner: Owner = undefined,

    /// We re-use FilePoll objects to avoid allocating new ones.
    ///
    /// That means we might run into situations where the event is stale.
    /// on macOS kevent64 has an extra pointer field so we use it for that
    /// linux doesn't have a field like that
    generation_number: KQueueGenerationNumber = 0,

    const FileReader = JSC.WebCore.FileReader;
    const FileSink = JSC.WebCore.FileSink;
    const FIFO = JSC.WebCore.FIFO;
    const Subprocess = JSC.Subprocess;
    const BufferedInput = Subprocess.BufferedInput;
    const BufferedOutput = Subprocess.BufferedOutput;
    const DNSResolver = JSC.DNS.DNSResolver;
    const GetAddrInfoRequest = JSC.DNS.GetAddrInfoRequest;
    const Deactivated = opaque {
        pub var owner: Owner = Owner.init(@as(*Deactivated, @ptrFromInt(@as(usize, 0xDEADBEEF))));
    };

    pub const Owner = bun.TaggedPointerUnion(.{
        FileReader,
        FileSink,
        Subprocess,
        BufferedInput,
        FIFO,
        Deactivated,
        DNSResolver,
        GetAddrInfoRequest,
    });

    fn updateFlags(poll: *FilePoll, updated: Flags.Set) void {
        var flags = poll.flags;
        flags.remove(.readable);
        flags.remove(.writable);
        flags.remove(.process);
        flags.remove(.machport);
        flags.remove(.eof);
        flags.remove(.hup);

        flags.setUnion(updated);
        poll.flags = flags;
    }

    pub fn onKQueueEvent(poll: *FilePoll, loop: *uws.Loop, kqueue_event: *const std.os.system.kevent64_s) void {
        if (KQueueGenerationNumber != u0)
            std.debug.assert(poll.generation_number == kqueue_event.ext[0]);

        poll.updateFlags(Flags.fromKQueueEvent(kqueue_event.*));
        poll.onUpdate(loop, kqueue_event.data);
    }

    pub fn onEpollEvent(poll: *FilePoll, loop: *uws.Loop, epoll_event: *std.os.linux.epoll_event) void {
        poll.updateFlags(Flags.fromEpollEvent(epoll_event.*));
        poll.onUpdate(loop, 0);
    }

    pub fn clearEvent(poll: *FilePoll, flag: Flags) void {
        poll.flags.remove(flag);
    }

    pub fn isReadable(this: *FilePoll) bool {
        const readable = this.flags.contains(.readable);
        this.flags.remove(.readable);
        return readable;
    }

    pub fn isHUP(this: *FilePoll) bool {
        const readable = this.flags.contains(.hup);
        this.flags.remove(.hup);
        return readable;
    }

    pub fn isEOF(this: *FilePoll) bool {
        const readable = this.flags.contains(.eof);
        this.flags.remove(.eof);
        return readable;
    }

    pub fn isWritable(this: *FilePoll) bool {
        const readable = this.flags.contains(.writable);
        this.flags.remove(.writable);
        return readable;
    }

    pub fn deinit(this: *FilePoll) void {
        var vm = JSC.VirtualMachine.get();
        this.deinitWithVM(vm);
    }

    pub fn deinitWithoutVM(this: *FilePoll, loop: *uws.Loop, polls: *JSC.FilePoll.HiveArray) void {
        if (this.isRegistered()) {
            _ = this.unregister(loop);
        }

        this.owner = Deactivated.owner;
        this.flags = Flags.Set{};
        this.fd = invalid_fd;
        polls.put(this);
    }

    pub fn deinitWithVM(this: *FilePoll, vm: *JSC.VirtualMachine) void {
        var loop = vm.uws_event_loop.?;
        this.deinitWithoutVM(loop, vm.rareData().filePolls(vm));
    }

    pub fn isRegistered(this: *const FilePoll) bool {
        return this.flags.contains(.poll_writable) or this.flags.contains(.poll_readable) or this.flags.contains(.poll_process) or this.flags.contains(.poll_machport);
    }

    const kqueue_or_epoll = if (Environment.isMac) "kevent" else "epoll";

    pub fn onUpdate(poll: *FilePoll, loop: *uws.Loop, size_or_offset: i64) void {
        if (poll.flags.contains(.one_shot) and !poll.flags.contains(.needs_rearm)) {
            if (poll.flags.contains(.has_incremented_poll_count)) poll.deactivate(loop);
            poll.flags.insert(.needs_rearm);
        }
        var ptr = poll.owner;
        switch (ptr.tag()) {
            @field(Owner.Tag, "FIFO") => {
                log("onUpdate " ++ kqueue_or_epoll ++ " (fd: {d}) FIFO", .{poll.fd});
                ptr.as(FIFO).ready(size_or_offset, poll.flags.contains(.hup));
            },
            @field(Owner.Tag, "Subprocess") => {
                log("onUpdate " ++ kqueue_or_epoll ++ " (fd: {d}) Subprocess", .{poll.fd});
                var loader = ptr.as(JSC.Subprocess);

                loader.onExitNotification();
            },
            @field(Owner.Tag, "FileSink") => {
                log("onUpdate " ++ kqueue_or_epoll ++ " (fd: {d}) FileSink", .{poll.fd});
                var loader = ptr.as(JSC.WebCore.FileSink);
                loader.onPoll(size_or_offset, 0);
            },

            @field(Owner.Tag, "DNSResolver") => {
                log("onUpdate " ++ kqueue_or_epoll ++ " (fd: {d}) DNSResolver", .{poll.fd});
                var loader: *DNSResolver = ptr.as(DNSResolver);
                loader.onDNSPoll(poll);
            },

            @field(Owner.Tag, "GetAddrInfoRequest") => {
                log("onUpdate " ++ kqueue_or_epoll ++ " (fd: {d}) GetAddrInfoRequest", .{poll.fd});
                var loader: *GetAddrInfoRequest = ptr.as(GetAddrInfoRequest);
                loader.onMachportChange();
            },

            else => {
                log("onUpdate " ++ kqueue_or_epoll ++ " (fd: {d}) disconnected?", .{poll.fd});
            },
        }
    }

    pub const Flags = enum {
        // What are we asking the event loop about?

        /// Poll for readable events
        poll_readable,

        /// Poll for writable events
        poll_writable,

        /// Poll for process-related events
        poll_process,

        /// Poll for machport events
        poll_machport,

        // What did the event loop tell us?
        readable,
        writable,
        process,
        eof,
        hup,
        machport,

        // What is the type of file descriptor?
        fifo,
        tty,

        one_shot,
        needs_rearm,

        has_incremented_poll_count,

        disable,

        nonblocking,

        pub fn poll(this: Flags) Flags {
            return switch (this) {
                .readable => .poll_readable,
                .writable => .poll_writable,
                .process => .poll_process,
                .machport => .poll_machport,
                else => this,
            };
        }

        pub const Set = std.EnumSet(Flags);
        pub const Struct = std.enums.EnumFieldStruct(Flags, bool, false);

        pub fn fromKQueueEvent(kqueue_event: std.os.system.kevent64_s) Flags.Set {
            var flags = Flags.Set{};
            if (kqueue_event.filter == std.os.system.EVFILT_READ) {
                flags.insert(Flags.readable);
                log("readable", .{});
                if (kqueue_event.flags & std.os.system.EV_EOF != 0) {
                    flags.insert(Flags.hup);
                    log("hup", .{});
                }
            } else if (kqueue_event.filter == std.os.system.EVFILT_WRITE) {
                flags.insert(Flags.writable);
                log("writable", .{});
                if (kqueue_event.flags & std.os.system.EV_EOF != 0) {
                    flags.insert(Flags.hup);
                    log("hup", .{});
                }
            } else if (kqueue_event.filter == std.os.system.EVFILT_PROC) {
                log("proc", .{});
                flags.insert(Flags.process);
            } else if (kqueue_event.filter == std.os.system.EVFILT_MACHPORT) {
                log("machport", .{});
                flags.insert(Flags.machport);
            }
            return flags;
        }

        pub fn fromEpollEvent(epoll: std.os.linux.epoll_event) Flags.Set {
            var flags = Flags.Set{};
            if (epoll.events & std.os.linux.EPOLL.IN != 0) {
                flags.insert(Flags.readable);
                log("readable", .{});
            }
            if (epoll.events & std.os.linux.EPOLL.OUT != 0) {
                flags.insert(Flags.writable);
                log("writable", .{});
            }
            if (epoll.events & std.os.linux.EPOLL.ERR != 0) {
                flags.insert(Flags.eof);
                log("eof", .{});
            }
            if (epoll.events & std.os.linux.EPOLL.HUP != 0) {
                flags.insert(Flags.hup);
                log("hup", .{});
            }
            return flags;
        }
    };

    pub const HiveArray = bun.HiveArray(FilePoll, 128).Fallback;

    const log = Output.scoped(.FilePoll, false);

    pub inline fn isActive(this: *const FilePoll) bool {
        return this.flags.contains(.has_incremented_poll_count);
    }

    pub inline fn isWatching(this: *const FilePoll) bool {
        return !this.flags.contains(.needs_rearm) and (this.flags.contains(.poll_readable) or this.flags.contains(.poll_writable) or this.flags.contains(.poll_process));
    }

    pub inline fn isKeepingProcessAlive(this: *const FilePoll) bool {
        return !this.flags.contains(.disable) and this.isActive();
    }

    /// Make calling ref() on this poll into a no-op.
    pub fn disableKeepingProcessAlive(this: *FilePoll, vm: *JSC.VirtualMachine) void {
        if (this.flags.contains(.disable))
            return;
        this.flags.insert(.disable);

        vm.uws_event_loop.?.active -= @as(u32, @intFromBool(this.flags.contains(.has_incremented_poll_count)));
    }

    pub fn enableKeepingProcessAlive(this: *FilePoll, vm: *JSC.VirtualMachine) void {
        if (!this.flags.contains(.disable))
            return;
        this.flags.remove(.disable);

        vm.uws_event_loop.?.active += @as(u32, @intFromBool(this.flags.contains(.has_incremented_poll_count)));
    }

    pub fn canActivate(this: *const FilePoll) bool {
        return !this.flags.contains(.has_incremented_poll_count);
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn deactivate(this: *FilePoll, loop: *uws.Loop) void {
        std.debug.assert(this.flags.contains(.has_incremented_poll_count));
        loop.num_polls -= @as(i32, @intFromBool(this.flags.contains(.has_incremented_poll_count)));
        loop.active -|= @as(u32, @intFromBool(!this.flags.contains(.disable) and this.flags.contains(.has_incremented_poll_count)));

        this.flags.remove(.has_incremented_poll_count);
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn activate(this: *FilePoll, loop: *uws.Loop) void {
        loop.num_polls += @as(i32, @intFromBool(!this.flags.contains(.has_incremented_poll_count)));
        loop.active += @as(u32, @intFromBool(!this.flags.contains(.disable) and !this.flags.contains(.has_incremented_poll_count)));

        this.flags.insert(.has_incremented_poll_count);
    }

    pub fn init(vm: *JSC.VirtualMachine, fd: bun.FileDescriptor, flags: Flags.Struct, comptime Type: type, owner: *Type) *FilePoll {
        return initWithOwner(vm, fd, flags, Owner.init(owner));
    }

    pub fn initWithOwner(vm: *JSC.VirtualMachine, fd: bun.FileDescriptor, flags: Flags.Struct, owner: Owner) *FilePoll {
        var poll = vm.rareData().filePolls(vm).get();
        poll.fd = @as(u32, @intCast(fd));
        poll.flags = Flags.Set.init(flags);
        poll.owner = owner;
        if (KQueueGenerationNumber != u0) {
            max_generation_number +%= 1;
            poll.generation_number = max_generation_number;
        }
        return poll;
    }

    pub inline fn canRef(this: *const FilePoll) bool {
        if (this.flags.contains(.disable))
            return false;

        return !this.flags.contains(.has_incremented_poll_count);
    }

    pub inline fn canUnref(this: *const FilePoll) bool {
        return this.flags.contains(.has_incremented_poll_count);
    }

    /// Prevent a poll from keeping the process alive.
    pub fn unref(this: *FilePoll, vm: *JSC.VirtualMachine) void {
        if (!this.canUnref())
            return;
        log("unref", .{});
        this.deactivate(vm.uws_event_loop.?);
    }

    /// Allow a poll to keep the process alive.
    pub fn ref(this: *FilePoll, vm: *JSC.VirtualMachine) void {
        if (this.canRef())
            return;
        log("ref", .{});
        this.activate(vm.uws_event_loop.?);
    }

    pub fn onTick(loop: *uws.Loop, tagged_pointer: ?*anyopaque) callconv(.C) void {
        var tag = Pollable.from(tagged_pointer);

        if (tag.tag() != @field(Pollable.Tag, "FilePoll"))
            return;

        var file_poll = tag.as(FilePoll);
        if (comptime Environment.isMac)
            onKQueueEvent(file_poll, loop, &loop.ready_polls[@as(usize, @intCast(loop.current_ready_poll))])
        else if (comptime Environment.isLinux)
            onEpollEvent(file_poll, loop, &loop.ready_polls[@as(usize, @intCast(loop.current_ready_poll))]);
    }

    const Pollable = bun.TaggedPointerUnion(
        .{
            FilePoll,
            Deactivated,
        },
    );

    comptime {
        @export(onTick, .{ .name = "Bun__internal_dispatch_ready_poll" });
    }

    const timeout = std.mem.zeroes(std.os.timespec);
    const kevent = std.c.kevent;
    const linux = std.os.linux;

    pub fn register(this: *FilePoll, loop: *uws.Loop, flag: Flags, one_shot: bool) JSC.Maybe(void) {
        return registerWithFd(this, loop, flag, one_shot, this.fd);
    }
    pub fn registerWithFd(this: *FilePoll, loop: *uws.Loop, flag: Flags, one_shot: bool, fd: u64) JSC.Maybe(void) {
        const watcher_fd = loop.fd;

        log("register: {s} ({d})", .{ @tagName(flag), fd });

        std.debug.assert(fd != invalid_fd);

        if (one_shot) {
            this.flags.insert(.one_shot);
        }

        if (comptime Environment.isLinux) {
            const one_shot_flag: u32 = if (!this.flags.contains(.one_shot)) 0 else linux.EPOLL.ONESHOT;

            const flags: u32 = switch (flag) {
                .process,
                .readable,
                => linux.EPOLL.IN | linux.EPOLL.HUP | one_shot_flag,
                .writable => linux.EPOLL.OUT | linux.EPOLL.HUP | linux.EPOLL.ERR | one_shot_flag,
                else => unreachable,
            };

            var event = linux.epoll_event{ .events = flags, .data = .{ .u64 = @intFromPtr(Pollable.init(this).ptr()) } };

            const ctl = linux.epoll_ctl(
                watcher_fd,
                if (this.isRegistered() or this.flags.contains(.needs_rearm)) linux.EPOLL.CTL_MOD else linux.EPOLL.CTL_ADD,
                @as(std.os.fd_t, @intCast(fd)),
                &event,
            );

            if (JSC.Maybe(void).errnoSys(ctl, .epoll_ctl)) |errno| {
                return errno;
            }
        } else if (comptime Environment.isMac) {
            var changelist = std.mem.zeroes([2]std.os.system.kevent64_s);
            const one_shot_flag: u16 = if (!this.flags.contains(.one_shot)) 0 else std.c.EV_ONESHOT;
            changelist[0] = switch (flag) {
                .readable => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_READ,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_ADD | one_shot_flag,
                    .ext = .{ this.generation_number, 0 },
                },
                .writable => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_WRITE,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_ADD | one_shot_flag,
                    .ext = .{ this.generation_number, 0 },
                },
                .process => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_PROC,
                    .data = 0,
                    .fflags = std.c.NOTE_EXIT,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_ADD | one_shot_flag,
                    .ext = .{ this.generation_number, 0 },
                },
                .machport => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_MACHPORT,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_ADD | one_shot_flag,
                    .ext = .{ this.generation_number, 0 },
                },
                else => unreachable,
            };

            // output events only include change errors
            const KEVENT_FLAG_ERROR_EVENTS = 0x000002;

            // The kevent() system call returns the number of events placed in
            // the eventlist, up to the value given by nevents.  If the time
            // limit expires, then kevent() returns 0.
            const rc = rc: {
                while (true) {
                    const rc = std.os.system.kevent64(
                        watcher_fd,
                        &changelist,
                        1,
                        // The same array may be used for the changelist and eventlist.
                        &changelist,
                        // we set 0 here so that if we get an error on
                        // registration, it becomes errno
                        0,
                        KEVENT_FLAG_ERROR_EVENTS,
                        &timeout,
                    );

                    if (std.c.getErrno(rc) == .INTR) continue;
                    break :rc rc;
                }
            };

            // If an error occurs while
            // processing an element of the changelist and there is enough room
            // in the eventlist, then the event will be placed in the eventlist
            // with EV_ERROR set in flags and the system error in data.
            if (changelist[0].flags == std.c.EV_ERROR and changelist[0].data != 0) {
                return JSC.Maybe(void).errnoSys(changelist[0].data, .kevent).?;
                // Otherwise, -1 will be returned, and errno will be set to
                // indicate the error condition.
            }

            const errno = std.c.getErrno(rc);

            if (errno != .SUCCESS) {
                return JSC.Maybe(void){
                    .err = JSC.Node.Syscall.Error.fromCode(errno, .kqueue),
                };
            }
        } else {
            @compileError("TODO: Pollable");
        }
        if (this.canActivate())
            this.activate(loop);
        this.flags.insert(switch (flag) {
            .readable => .poll_readable,
            .process => if (comptime Environment.isLinux) .poll_readable else .poll_process,
            .writable => .poll_writable,
            .machport => .poll_machport,
            else => unreachable,
        });
        this.flags.remove(.needs_rearm);

        return JSC.Maybe(void).success;
    }

    const invalid_fd = bun.invalid_fd;

    pub fn unregister(this: *FilePoll, loop: *uws.Loop) JSC.Maybe(void) {
        return this.unregisterWithFd(loop, this.fd);
    }

    pub fn unregisterWithFd(this: *FilePoll, loop: *uws.Loop, fd: u64) JSC.Maybe(void) {
        if (!(this.flags.contains(.poll_readable) or this.flags.contains(.poll_writable) or this.flags.contains(.poll_process) or this.flags.contains(.poll_machport))) {
            // no-op
            return JSC.Maybe(void).success;
        }

        std.debug.assert(fd != invalid_fd);
        const watcher_fd = loop.fd;
        const flag: Flags = brk: {
            if (this.flags.contains(.poll_readable))
                break :brk .readable;
            if (this.flags.contains(.poll_writable))
                break :brk .writable;
            if (this.flags.contains(.poll_process))
                break :brk .process;

            if (this.flags.contains(.poll_machport))
                break :brk .machport;
            return JSC.Maybe(void).success;
        };

        if (this.flags.contains(.needs_rearm)) {
            log("unregister: {s} ({d}) skipped due to needs_rearm", .{ @tagName(flag), fd });
            this.flags.remove(.poll_process);
            this.flags.remove(.poll_readable);
            this.flags.remove(.poll_process);
            this.flags.remove(.poll_machport);
            return JSC.Maybe(void).success;
        }

        log("unregister: {s} ({d})", .{ @tagName(flag), fd });

        if (comptime Environment.isLinux) {
            const ctl = linux.epoll_ctl(
                watcher_fd,
                linux.EPOLL.CTL_DEL,
                @as(std.os.fd_t, @intCast(fd)),
                null,
            );

            if (JSC.Maybe(void).errnoSys(ctl, .epoll_ctl)) |errno| {
                return errno;
            }
        } else if (comptime Environment.isMac) {
            var changelist = std.mem.zeroes([2]std.os.system.kevent64_s);

            changelist[0] = switch (flag) {
                .readable => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_READ,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_DELETE,
                    .ext = .{ 0, 0 },
                },
                .machport => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_MACHPORT,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_DELETE,
                    .ext = .{ 0, 0 },
                },
                .writable => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_WRITE,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_DELETE,
                    .ext = .{ 0, 0 },
                },
                .process => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_PROC,
                    .data = 0,
                    .fflags = std.c.NOTE_EXIT,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_DELETE,
                    .ext = .{ 0, 0 },
                },
                else => unreachable,
            };

            // output events only include change errors
            const KEVENT_FLAG_ERROR_EVENTS = 0x000002;

            // The kevent() system call returns the number of events placed in
            // the eventlist, up to the value given by nevents.  If the time
            // limit expires, then kevent() returns 0.
            const rc = std.os.system.kevent64(
                watcher_fd,
                &changelist,
                1,
                // The same array may be used for the changelist and eventlist.
                &changelist,
                1,
                KEVENT_FLAG_ERROR_EVENTS,
                &timeout,
            );
            // If an error occurs while
            // processing an element of the changelist and there is enough room
            // in the eventlist, then the event will be placed in the eventlist
            // with EV_ERROR set in flags and the system error in data.
            if (changelist[0].flags == std.c.EV_ERROR) {
                return JSC.Maybe(void).errnoSys(changelist[0].data, .kevent).?;
                // Otherwise, -1 will be returned, and errno will be set to
                // indicate the error condition.
            }

            const errno = std.c.getErrno(rc);
            switch (rc) {
                std.math.minInt(@TypeOf(rc))...-1 => return JSC.Maybe(void).errnoSys(@intFromEnum(errno), .kevent).?,
                else => {},
            }
        } else {
            @compileError("TODO: Pollable");
        }

        this.flags.remove(.needs_rearm);
        this.flags.remove(.one_shot);
        // we don't support both right now
        std.debug.assert(!(this.flags.contains(.poll_readable) and this.flags.contains(.poll_writable)));
        this.flags.remove(.poll_readable);
        this.flags.remove(.poll_writable);
        this.flags.remove(.poll_process);
        this.flags.remove(.poll_machport);

        if (this.isActive())
            this.deactivate(loop);

        return JSC.Maybe(void).success;
    }
};

pub const Strong = @import("./Strong.zig").Strong;

pub const BinaryType = enum {
    Buffer,
    ArrayBuffer,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Float32Array,
    Float64Array,
    // DataView,

    pub fn toJSType(this: BinaryType) JSC.JSValue.JSType {
        return switch (this) {
            .ArrayBuffer => .ArrayBuffer,
            .Buffer => .Uint8Array,
            // .DataView => .DataView,
            .Float32Array => .Float32Array,
            .Float64Array => .Float64Array,
            .Int16Array => .Int16Array,
            .Int32Array => .Int32Array,
            .Int8Array => .Int8Array,
            .Uint16Array => .Uint16Array,
            .Uint32Array => .Uint32Array,
            .Uint8Array => .Uint8Array,
        };
    }

    pub fn toTypedArrayType(this: BinaryType) JSC.C.JSTypedArrayType {
        return this.toJSType().toC();
    }

    pub const Map = bun.ComptimeStringMap(
        BinaryType,
        .{
            .{ "ArrayBuffer", .ArrayBuffer },
            .{ "Buffer", .Buffer },
            // .{ "DataView", .DataView },
            .{ "Float32Array", .Float32Array },
            .{ "Float64Array", .Float64Array },
            .{ "Int16Array", .Int16Array },
            .{ "Int32Array", .Int32Array },
            .{ "Int8Array", .Int8Array },
            .{ "Uint16Array", .Uint16Array },
            .{ "Uint32Array", .Uint32Array },
            .{ "Uint8Array", .Uint8Array },
            .{ "arraybuffer", .ArrayBuffer },
            .{ "buffer", .Buffer },
            // .{ "dataview", .DataView },
            .{ "float32array", .Float32Array },
            .{ "float64array", .Float64Array },
            .{ "int16array", .Int16Array },
            .{ "int32array", .Int32Array },
            .{ "int8array", .Int8Array },
            .{ "nodebuffer", .Buffer },
            .{ "uint16array", .Uint16Array },
            .{ "uint32array", .Uint32Array },
            .{ "uint8array", .Uint8Array },
        },
    );

    pub fn fromString(input: []const u8) ?BinaryType {
        return Map.get(input);
    }

    pub fn fromJSValue(globalThis: *JSC.JSGlobalObject, input: JSValue) ?BinaryType {
        if (input.isString()) {
            return Map.getWithEql(input.getZigString(globalThis), ZigString.eqlComptime);
        }

        return null;
    }

    /// This clones bytes
    pub fn toJS(this: BinaryType, bytes: []const u8, globalThis: *JSC.JSGlobalObject) JSValue {
        switch (this) {
            .Buffer => return JSC.ArrayBuffer.createBuffer(globalThis, bytes),
            .ArrayBuffer => return JSC.ArrayBuffer.create(globalThis, bytes, .ArrayBuffer),
            .Uint8Array => return JSC.ArrayBuffer.create(globalThis, bytes, .Uint8Array),

            // These aren't documented, but they are supported
            .Uint16Array, .Uint32Array, .Int8Array, .Int16Array, .Int32Array, .Float32Array, .Float64Array => {
                const buffer = JSC.ArrayBuffer.create(globalThis, bytes, .ArrayBuffer);
                return JSC.JSValue.c(JSC.C.JSObjectMakeTypedArrayWithArrayBuffer(globalThis, this.toTypedArrayType(), buffer.asObjectRef(), null));
            },
        }
    }
};

pub const AsyncTaskTracker = struct {
    id: u64,

    pub fn init(vm: *JSC.VirtualMachine) AsyncTaskTracker {
        return .{ .id = vm.nextAsyncTaskID() };
    }

    pub fn didSchedule(this: AsyncTaskTracker, globalObject: *JSC.JSGlobalObject) void {
        if (this.id == 0) return;

        bun.JSC.Debugger.didScheduleAsyncCall(globalObject, bun.JSC.Debugger.AsyncCallType.EventListener, this.id, true);
    }

    pub fn didCancel(this: AsyncTaskTracker, globalObject: *JSC.JSGlobalObject) void {
        if (this.id == 0) return;

        bun.JSC.Debugger.didCancelAsyncCall(globalObject, bun.JSC.Debugger.AsyncCallType.EventListener, this.id);
    }

    pub fn willDispatch(this: AsyncTaskTracker, globalObject: *JSC.JSGlobalObject) void {
        if (this.id == 0) {
            return;
        }

        bun.JSC.Debugger.willDispatchAsyncCall(globalObject, bun.JSC.Debugger.AsyncCallType.EventListener, this.id);
    }

    pub fn didDispatch(this: AsyncTaskTracker, globalObject: *JSC.JSGlobalObject) void {
        if (this.id == 0) {
            return;
        }

        bun.JSC.Debugger.didDispatchAsyncCall(globalObject, bun.JSC.Debugger.AsyncCallType.EventListener, this.id);
    }
};
