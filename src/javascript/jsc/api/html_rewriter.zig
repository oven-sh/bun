const std = @import("std");
const Api = @import("../../../api/schema.zig").Api;
const FilesystemRouter = @import("../../../router.zig");
const http = @import("../../../http.zig");
const JavaScript = @import("../javascript.zig");
const QueryStringMap = @import("../../../query_string_map.zig").QueryStringMap;
const CombinedScanner = @import("../../../query_string_map.zig").CombinedScanner;
const bun = @import("../../../global.zig");
const string = bun.string;
const JSC = @import("../../../jsc.zig");
const js = JSC.C;
const WebCore = @import("../webcore/response.zig");
const Router = @This();
const Bundler = @import("../../../bundler.zig");
const VirtualMachine = JavaScript.VirtualMachine;
const ScriptSrcStream = std.io.FixedBufferStream([]u8);
const ZigString = JSC.ZigString;
const Fs = @import("../../../fs.zig");
const Base = @import("../base.zig");
const getAllocator = Base.getAllocator;
const JSObject = JSC.JSObject;
const JSError = Base.JSError;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const strings = @import("strings");
const NewClass = Base.NewClass;
const To = Base.To;
const Request = WebCore.Request;
const d = Base.d;
const FetchEvent = WebCore.FetchEvent;
const Response = WebCore.Response;

pub const HTMLRewriter = struct {
    listeners: *anyopaque,
    built: bool = false,

    pub const Class = NewClass(
        HTMLRewriter,
        .{ .name = "HTMLRewriter" },
        .{
            .constructor = constructor,
            .on = .{
                .rfn = wrap(HTMLRewriter, "on"),
            },
            .onDocument = .{
                .rfn = wrap(HTMLRewriter, "onDocument"),
            },
            .transform = .{
                .rfn = wrap(HTMLRewriter, "transform"),
            },
        },
        .{},
    );

    pub fn constructor(
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) js.JSObjectRef {
        var rewriter = bun.default_allocator.create(HTMLRewriter) catch unreachable;
        rewriter.* = HTMLRewriter{ .listeners = undefined };
        return HTMLRewriter.Class.make(ctx, rewriter);
    }

    pub fn on(
        this: *HTMLRewriter,
        global: *JSGlobalObject,
        event: ZigString,
        listener: JSValue,
    ) JSValue {
        _ = this;
        _ = global;
        _ = event;
        _ = listener;
        return undefined;
    }

    pub fn onDocument(
        this: *HTMLRewriter,
        global: *JSGlobalObject,
        event: ZigString,
        listener: JSValue,
    ) JSValue {
        _ = this;
        _ = global;
        _ = event;
        _ = listener;
        return undefined;
    }

    pub fn transform(this: *HTMLRewriter, global: *JSGlobalObject, response: *Response) JSValue {
        _ = this;
        _ = global;
        _ = response;
        return undefined;
    }
};

const ContentOptions = struct {
    html: bool = false,
};

fn MethodType(comptime Container: type) type {
    return fn (
        this: *Container,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        target: js.JSObjectRef,
        args: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef;
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

pub fn wrap(comptime Container: type, comptime name: string) MethodType(Container) {
    return struct {
        const FunctionType = @TypeOf(@field(Container, name));
        const FunctionTypeInfo: std.builtin.TypeInfo.Fn = @typeInfo(FunctionType).Fn;

        pub fn callback(
            this: *Container,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSObjectRef {
            var iter = JSC.Node.ArgumentsSlice.from(arguments);
            var args: std.meta.ArgsTuple(FunctionType) = undefined;

            comptime var i: usize = 0;
            inline while (i < FunctionTypeInfo.args.len) : (i += 1) {
                const ArgType = FunctionTypeInfo.args[i].arg_type.?;

                switch (ArgType) {
                    *Container => {
                        args[i] = this;
                    },
                    *JSGlobalObject => {
                        args[i] = ctx.ptr();
                    },
                    ZigString => {
                        var arg: ?JSC.JSValue = iter.next();
                        args[i] = (arg orelse {
                            JSC.throwInvalidArguments("Expected string", .{}, ctx, exception);
                            return null;
                        }).getZigString(ctx.ptr());
                    },
                    ?ContentOptions => {
                        var arg: ?JSC.JSValue = iter.next();

                        if (arg) |content_arg| {
                            if (content_arg.get("html")) |html_val| {
                                args[i] = .{ .html = html_val.toBoolean() };
                            }
                        } else {
                            args[i] = null;
                        }
                    },
                    *Response => {
                        var arg: ?JSC.JSValue = iter.next();

                        args[i] = (arg orelse {
                            JSC.throwInvalidArguments("Missing Response object", .{}, ctx, exception);
                            return null;
                        }).as(Response) orelse {
                            JSC.throwInvalidArguments("Expected Response object", .{}, ctx, exception);
                            return null;
                        };
                    },
                    JSValue => {
                        var arg: ?JSC.JSValue = iter.next();

                        args[i] = arg orelse {
                            JSC.throwInvalidArguments("Missing argument", .{}, ctx, exception);
                            return null;
                        };
                    },
                    else => @compileError("Unexpected Type" ++ @typeName(ArgType)),
                }
            }

            const result: JSValue = @call(.{}, @field(Container, name), args);
            if (result.isError()) {
                exception.* = result.asObjectRef();
                return null;
            }

            return result.asObjectRef();
        }
    }.callback;
}

pub fn getterWrap(comptime Container: type, comptime name: string) GetterType(Container) {
    return struct {
        const FunctionType = @TypeOf(@field(Container, name));
        const FunctionTypeInfo: std.builtin.TypeInfo.Fn = @typeInfo(FunctionType).Fn;

        pub fn callback(
            this: *Container,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSStringRef,
            exception: js.ExceptionRef,
        ) js.JSObjectRef {
            const result: JSValue = @call(.{}, @field(Container, name), .{ this, ctx.ptr() });
            if (result.isError()) {
                exception.* = result.asObjectRef();
                return null;
            }

            return result.asObjectRef();
        }
    }.callback;
}

pub const Element = struct {
    global: *JSGlobalObject,
    removed: bool = false,

    pub const Class = NewClass(
        Element,
        .{ .name = "Element" },
        .{
            .getAttribute = .{
                .rfn = wrap(Element, "getAttribute"),
            },
            .hasAttribute = .{
                .rfn = wrap(Element, "hasAttribute"),
            },
            .setAttribute = .{
                .rfn = wrap(Element, "setAttribute"),
            },
            .removeAttribute = .{
                .rfn = wrap(Element, "removeAttribute"),
            },
            .before = .{
                .rfn = wrap(Element, "before"),
            },
            .after = .{
                .rfn = wrap(Element, "after"),
            },
            .prepend = .{
                .rfn = wrap(Element, "prepend"),
            },
            .append = .{
                .rfn = wrap(Element, "append"),
            },
            .replace = .{
                .rfn = wrap(Element, "replace"),
            },
            .setInnerContent = .{
                .rfn = wrap(Element, "setInnerContent"),
            },
            .remove = .{
                .rfn = wrap(Element, "remove"),
            },
            .removeAndKeepContent = .{
                .rfn = wrap(Element, "removeAndKeepContent"),
            },
        },
        .{
            .tagName = .{
                .get = getterWrap(Element, "getTagName"),
            },
            .removed = .{
                .get = getterWrap(Element, "getRemoved"),
            },
            .namespaceUri = .{
                .get = getterWrap(Element, "getNamespaceURI"),
            },
        },
    );

    //     // fn wrap(comptime name: string)

    ///  Returns the value for a given attribute name: ZigString on the element, or null if it is not found.
    pub fn getAttribute(this: *Element, globalObject: *JSGlobalObject, name: ZigString) JSValue {
        _ = this;
        _ = name;
        _ = globalObject;
        return undefined;
    }

    ///  Returns a boolean indicating whether an attribute exists on the element.
    pub fn hasAttribute(this: *Element, globalObject: *JSGlobalObject, name: ZigString) JSValue {
        _ = this;
        _ = name;
        _ = globalObject;
        return undefined;
    }

    ///  Sets an attribute to a provided value, creating the attribute if it does not exist.
    pub fn setAttribute(this: *Element, globalObject: *JSGlobalObject, name: ZigString, value: ZigString) JSValue {
        _ = this;
        _ = name;
        _ = globalObject;
        _ = value;
        return undefined;
    }

    ///  Removes the attribute.
    pub fn removeAttribute(this: *Element, globalObject: *JSGlobalObject, name: ZigString) JSValue {
        _ = this;
        _ = name;
        _ = globalObject;
        return undefined;
    }

    ///  Inserts content before the element.
    pub fn before(this: *Element, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        _ = this;
        _ = content;
        _ = globalObject;
        _ = contentOptions;
        return undefined;
    }

    ///  Inserts content right after the element.
    pub fn after(this: *Element, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        _ = this;
        _ = content;
        _ = globalObject;
        _ = contentOptions;
        return undefined;
    }

    ///  nserts content right after the start tag of the element.
    pub fn prepend(this: *Element, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        _ = this;
        _ = content;
        _ = globalObject;
        _ = contentOptions;
        return undefined;
    }

    ///  Inserts content right before the end tag of the element.
    pub fn append(this: *Element, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        _ = this;
        _ = content;
        _ = globalObject;
        _ = contentOptions;
        return undefined;
    }

    ///  Removes the element and inserts content in place of it.
    pub fn replace(this: *Element, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        _ = this;
        _ = content;
        _ = globalObject;
        _ = contentOptions;
        return undefined;
    }

    ///  Replaces content of the element.
    pub fn setInnerContent(this: *Element, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        _ = this;
        _ = content;
        _ = globalObject;
        _ = contentOptions;
        return undefined;
    }

    ///  Removes the element with all its content.
    pub fn remove(this: *Element, globalObject: *JSGlobalObject) JSValue {
        _ = this;

        _ = globalObject;
        return undefined;
    }

    ///  Removes the start tag and end tag of the element but keeps its inner content intact.
    pub fn removeAndKeepContent(this: *Element, globalObject: *JSGlobalObject) JSValue {
        _ = this;

        _ = globalObject;
        return undefined;
    }

    pub fn getTagName(this: *Element, globalObject: *JSGlobalObject) JSValue {
        _ = this;

        _ = globalObject;
        return undefined;
    }

    pub fn getRemoved(this: *Element, globalObject: *JSGlobalObject) JSValue {
        _ = this;

        _ = globalObject;
        return undefined;
    }

    pub fn getNamespaceURI(this: *Element, globalObject: *JSGlobalObject) JSValue {
        _ = this;

        _ = globalObject;
        return undefined;
    }
};
