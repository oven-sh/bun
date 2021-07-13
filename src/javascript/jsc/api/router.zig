usingnamespace @import("../base.zig");
const std = @import("std");
const Api = @import("../../../api/schema.zig").Api;
const FilesystemRouter = @import("../../../router.zig");
const JavaScript = @import("../javascript.zig");

pub const Router = struct {
    match: FilesystemRouter.RouteMap.MatchedRoute,
    file_path_str: js.JSStringRef = null,
    pathname_str: js.JSStringRef = null,

    pub const Class = NewClass(
        Router,
        "Router",
        .{
            .finalize = finalize,
        },
        .{
            .@"pathname" = .{
                .get = getPathname,
                .ro = true,
                .ts = .{
                    .@"return" = "string",
                    .@"tsdoc" = "URL path as appears in a web browser's address bar",
                },
            },
            .@"filepath" = .{
                .get = getPageFilePath,
                .ro = true,
                .ts = .{
                    .@"return" = "string",
                    .@"tsdoc" = 
                    \\Project-relative filesystem path to the route file
                    \\
                    \\@example
                    \\
                    \\```tsx
                    \\const PageComponent = (await import(route.filepath)).default;
                    \\ReactDOMServer.renderToString(<PageComponent query={route.query} />);
                    \\```
                    ,
                },
            },
            .@"route" = .{
                .@"get" = getRoute,
                .ro = true,
            },
            .query = .{
                .@"get" = getQuery,
                .ro = true,
            },
            .pageFilePath = .{
                .@"get" = getPageFilePath,
                .ro = true,
            },
        },
        false,
        false,
    );

    pub fn getPageFilePath(
        this: *Router,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (this.file_path_str == null) {
            this.file_path_str = js.JSStringCreateWithUTF8CString(this.match.file_path[0.. :0]);
        }

        return js.JSValueMakeString(ctx, this.file_path_str);
    }

    pub fn finalize(
        this: *Router,
        ctx: js.JSObjectRef,
    ) void {
        // this.deinit();
    }

    pub fn requirePage(
        this: *Router,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {}

    pub fn getPathname(
        this: *Router,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (this.pathname_str == null) {
            this.pathname_str = js.JSStringCreateWithUTF8CString(this.match.pathname[0.. :0]);
        }

        return js.JSValueMakeString(ctx, this.pathname_str);
    }

    pub fn getAsPath(
        this: *Router,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, Properties.Refs.default);
    }

    pub fn getRoute(
        this: *Router,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, Properties.Refs.default);
    }

    pub fn getQuery(
        this: *Router,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, Properties.Refs.default);
    }
};
