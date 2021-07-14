usingnamespace @import("../base.zig");
const std = @import("std");
const Api = @import("../../../api/schema.zig").Api;
const FilesystemRouter = @import("../../../router.zig");
const JavaScript = @import("../javascript.zig");

usingnamespace @import("../webcore/response.zig");
const Router = @This();

match: FilesystemRouter.RouteMap.MatchedRoute,
file_path_str: js.JSStringRef = null,
pathname_str: js.JSStringRef = null,

pub fn constructor(
    ctx: js.JSContextRef,
    function: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSObjectRef {
    return null;
}

pub fn match(
    obj: *c_void,
    ctx: js.JSContextRef,
    function: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSObjectRef {
    return null;
}

fn matcher(
    obj: *c_void,
    ctx: js.JSContextRef,
    arg: js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSObjectRef {
    return null;
}

fn matchRequest(
    ctx: js.JSContextRef,
    request: *const Request,
    exception: js.ExceptionRef,
) js.JSObjectRef {
    return null;
}

fn matchPathName(
    ctx: js.JSContextRef,
    pathname: string,
    exception: js.ExceptionRef,
) js.JSObjectRef {
    return null;
}

fn matchFetchEvent(
    ctx: js.JSContextRef,
    fetch_event: *const FetchEvent,
    exception: js.ExceptionRef,
) js.JSObjectRef {
    return null;
}

const match_type_definition = &[_]d.ts{
    .{
        .tsdoc = "Match a {@link https://developer.mozilla.org/en-US/docs/Web/API/Request Request} to a Route from the local filesystem.",
        .args = &[_]d.ts.arg{
            .{
                .name = "request",
                .@"return" = "Request",
            },
        },
        .@"return" = "Route | null",
    },
    .{
        .tsdoc = "Match a {@link https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent FetchEvent} to a Route from the local filesystem.",
        .args = &[_]d.ts.arg{
            .{
                .name = "event",
                .@"return" = "FetchEvent",
            },
        },
        .@"return" = "Route | null",
    },
    .{
        .tsdoc = "Match a `pathname` to a Route from the local filesystem.",
        .args = &[_]d.ts.arg{
            .{
                .name = "pathname",
                .@"return" = "string",
            },
        },
        .@"return" = "Route | null",
    },
};

pub const Class = NewClass(
    c_void,
    .{
        .name = "Router",
        .read_only = true,
        .ts = .{
            .module = .{
                .path = "speedy.js/router",
                .tsdoc = "Filesystem Router supporting dynamic routes, exact routes, catch-all routes, and optional catch-all routes. Implemented in native code and only available with Speedy.js.",
            },
        },
    },
    .{
        .match = .{
            .get = match,
            .ts = match_type_definition,
        },
    },
    .{
        .Route = Instance.GetClass(c_void){},
    },
);

pub const Instance = NewClass(
    Router,
    .{
        .name = "Route",
        .read_only = true,
        .ts = .{
            .class = d.ts.class{
                .tsdoc = 
                \\Route matched from the filesystem.
                ,
            },
        },
    },
    .{
        .finalize = .{
            .rfn = finalize,
        },
        .constructor = .{
            .rfn = constructor,
            .ts = match_type_definition,
        },
    },
    .{
        .@"pathname" = .{
            .get = getPathname,
            .ro = true,
            .ts = d.ts{
                .@"return" = "string",
                .@"tsdoc" = "URL path as appears in a web browser's address bar",
            },
        },
        .filepath = .{
            .get = getFilePath,
            .ro = true,
            .ts = d.ts{
                .@"return" = "string",
                .tsdoc = 
                \\Project-relative filesystem path to the route file. Useful for importing.
                \\
                \\@example ```tsx
                \\await import(route.filepath);
                \\```
                ,
            },
        },
        .kind = .{
            .get = getKind,
            .ro = true,
            .ts = d.ts{
                .@"return" = "\"exact\" | \"dynamic\" | \"catch-all\" | \"optional-catch-all\"",
            },
        },
        .@"name" = .{
            .@"get" = getRoute,
            .ro = true,
            .ts = d.ts{
                .@"return" = "string",
                .tsdoc = 
                \\Route name
                \\@example
                \\`"blog/posts/[id]"`
                \\`"blog/posts/[id]/[[...slug]]"`
                \\`"blog"`
                ,
            },
        },
        .query = .{
            .@"get" = getQuery,
            .ro = true,
            .ts = d.ts{
                .@"return" = "Record<string, string | string[]>",
                .tsdoc = 
                \\Route parameters as a key-value object
                \\
                \\@example 
                \\```js
                \\console.assert(router.query.id === "123");
                \\console.assert(router.pathname === "/blog/posts/123");
                \\console.assert(router.route === "blog/posts/[id]");
                \\```
                ,
            },
        },
    },
);

pub fn getFilePath(
    this: *Router,
    ctx: js.JSContextRef,
    thisObject: js.JSObjectRef,
    prop: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    if (this.file_path_str == null) {
        this.file_path_str = js.JSStringCreateWithUTF8CString(this.match.file_path.ptr);
    }

    return js.JSValueMakeString(ctx, this.file_path_str);
}

pub fn finalize(
    this: *Router,
    ctx: js.JSObjectRef,
) void {
    // this.deinit();
}

pub fn getPathname(
    this: *Router,
    ctx: js.JSContextRef,
    thisObject: js.JSObjectRef,
    prop: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    if (this.pathname_str == null) {
        this.pathname_str = js.JSStringCreateWithUTF8CString(this.match.pathname.ptr);
    }

    return js.JSValueMakeString(ctx, this.pathname_str);
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

pub fn getKind(
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
