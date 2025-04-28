const HTTPServerAgent = @This();

/// Underlying C++ agent. Set to null when not enabled.
agent: ?*InspectorHTTPServerAgent = null,

/// This becomes the "server ID" field.
next_server_id: ServerId = 0,

pub fn isEnabled(this: *const HTTPServerAgent) bool {
    return this.agent != null;
}

//#region Events
pub fn notifyServerStarted(this: *HTTPServerAgent, instance: JSC.API.AnyServer) void {
    if (this.agent) |agent| {
        const server_id = this.next_server_id + 1;
        this.next_server_id = server_id;
        instance.setInspectorServerID(server_id);
        var url = instance.getURLAsString();
        defer url.deref();

        agent.notifyServerStarted(
            server_id,
            @intCast(instance.vm().hot_reload_counter),
            &url,
            @floatFromInt(std.time.milliTimestamp()),
            instance.ptr.ptr(),
        );
    }
}

pub fn notifyServerStopped(this: *const HTTPServerAgent, server: JSC.API.AnyServer) void {
    if (this.agent) |agent| {
        agent.notifyServerStopped(server.inspectorServerID(), @floatFromInt(std.time.milliTimestamp()));
    }
}

pub fn notifyServerRoutesUpdated(this: *const HTTPServerAgent, server: JSC.API.AnyServer) !void {
    if (this.agent) |agent| {
        const config = server.config();
        var routes = std.ArrayList(Route).init(bun.default_allocator);
        defer {
            for (routes.items) |*route| {
                route.deinit();
            }
            routes.deinit();
        }

        var max_id: u32 = 0;

        switch (server.userRoutes()) {
            inline else => |user_routes| {
                for (user_routes) |*user_route| {
                    const decl: *const JSC.API.ServerConfig.RouteDeclaration = &user_route.route;
                    max_id = @max(max_id, user_route.id);
                    try routes.append(.{
                        .route_id = @intCast(user_route.id),
                        .path = bun.String.init(decl.path),
                        .type = .api,
                        // TODO:
                        .param_names = null,
                        .param_names_len = 0,
                        .script_line = -1,
                        .file_path = .empty,
                    });
                }
            },
        }

        for (config.static_routes.items) |*route| {
            try routes.append(.{
                .route_id = @intCast(max_id + 1),
                .path = bun.String.init(route.path),
                .type = switch (route.route) {
                    .html => .html,
                    .static => .static,
                    else => .default,
                },
                .script_line = -1,
                // TODO:
                .param_names = null,
                .param_names_len = 0,
                .file_path = switch (route.route) {
                    .html => |html| bun.String.init(html.bundle.data.path),
                    else => .empty,
                },
            });
            max_id += 1;
        }

        agent.notifyServerRoutesUpdated(server.inspectorServerID(), @intCast(JSC.VirtualMachine.get().hot_reload_counter), routes.items);
    }
}

//#endregion

//#region Types

pub const Route = extern struct {
    route_id: RouteId,
    path: BunString = .empty,
    type: Type = .default,
    script_line: i32 = -1,
    param_names: ?[*]BunString = null,
    param_names_len: usize = 0,
    file_path: BunString = .empty,
    script_id: BunString = .empty,
    script_url: BunString = .empty,

    pub const Type = enum(u8) {
        default = 1,
        api = 2,
        html = 3,
        static = 4,
    };

    pub fn params(this: *const Route) []BunString {
        const ptr = this.param_names orelse return &[_]BunString{};
        return ptr[0..this.param_names_len];
    }

    pub fn deinit(this: *Route) void {
        for (this.params()) |*param_name| {
            param_name.deref();
        }
        bun.default_allocator.free(this.params());
        this.path.deref();
        this.file_path.deref();
        this.script_id.deref();
        this.script_url.deref();
    }
};

//#endregion

//#region C++ agent reference type for Zig
pub const InspectorHTTPServerAgent = opaque {
    extern fn Bun__HTTPServerAgent__notifyServerStarted(agent: *InspectorHTTPServerAgent, serverId: ServerId, hotReloadId: HotReloadId, address: *const BunString, startTime: f64, serverInstance: *anyopaque) void;
    extern fn Bun__HTTPServerAgent__notifyServerStopped(agent: *InspectorHTTPServerAgent, serverId: ServerId, timestamp: f64) void;
    extern fn Bun__HTTPServerAgent__notifyServerRoutesUpdated(agent: *InspectorHTTPServerAgent, serverId: ServerId, hotReloadId: HotReloadId, routes: [*]Route, routesCount: usize) void;
    extern fn Bun__HTTPServerAgent__notifyRequestWillBeSent(agent: *InspectorHTTPServerAgent, requestId: RequestId, serverId: ServerId, routeId: RouteId, url: *const BunString, fullUrl: *const BunString, method: HTTPMethod, headersJson: *const BunString, paramsJson: *const BunString, hasBody: bool, timestamp: f64) void;
    extern fn Bun__HTTPServerAgent__notifyResponseReceived(agent: *InspectorHTTPServerAgent, requestId: RequestId, serverId: ServerId, statusCode: i32, statusText: *const BunString, headersJson: *const BunString, hasBody: bool, timestamp: f64) void;
    extern fn Bun__HTTPServerAgent__notifyBodyChunkReceived(agent: *InspectorHTTPServerAgent, requestId: RequestId, serverId: ServerId, flags: i32, chunk: *const BunString, timestamp: f64) void;
    extern fn Bun__HTTPServerAgent__notifyRequestFinished(agent: *InspectorHTTPServerAgent, requestId: RequestId, serverId: ServerId, timestamp: f64, duration: f64) void;
    extern fn Bun__HTTPServerAgent__notifyRequestHandlerException(agent: *InspectorHTTPServerAgent, requestId: RequestId, serverId: ServerId, message: *const BunString, url: *const BunString, line: i32, timestamp: f64) void;

    pub fn notifyServerStarted(agent: *InspectorHTTPServerAgent, serverId: ServerId, hotReloadId: HotReloadId, address: *const BunString, startTime: f64, serverInstance: *anyopaque) void {
        Bun__HTTPServerAgent__notifyServerStarted(agent, serverId, hotReloadId, address, startTime, serverInstance);
    }

    pub fn notifyServerStopped(agent: *InspectorHTTPServerAgent, serverId: ServerId, timestamp: f64) void {
        Bun__HTTPServerAgent__notifyServerStopped(agent, serverId, timestamp);
    }

    pub fn notifyServerRoutesUpdated(agent: *InspectorHTTPServerAgent, serverId: ServerId, hotReloadId: HotReloadId, routes: []Route) void {
        Bun__HTTPServerAgent__notifyServerRoutesUpdated(agent, serverId, hotReloadId, routes.ptr, routes.len);
    }
};

//#endregion

//#region Zig -> C++

export fn Bun__HTTPServerAgent__setEnabled(agent: ?*InspectorHTTPServerAgent) void {
    if (JSC.VirtualMachine.get().debugger) |*debugger| {
        debugger.http_server_agent.agent = agent;
    }
}

//#endregion

// Typedefs from HTTPServer.json
pub const ServerId = i32;
pub const RequestId = i32;
pub const RouteId = i32;
pub const HotReloadId = i32;
pub const HTTPMethod = bun.http.Method;

const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;
const ZigException = JSC.ZigException;
const BunString = bun.String;
