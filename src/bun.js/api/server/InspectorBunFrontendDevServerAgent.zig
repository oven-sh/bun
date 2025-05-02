const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const DevServer = bun.bake.DevServer;

const InspectorBunFrontendDevServerAgentHandle = opaque {
    const c = struct {
        extern "c" fn InspectorBunFrontendDevServerAgent__notifyClientConnected(agent: *InspectorBunFrontendDevServerAgentHandle, devServerId: i32, connectionId: i32) void;
        extern "c" fn InspectorBunFrontendDevServerAgent__notifyClientDisconnected(agent: *InspectorBunFrontendDevServerAgentHandle, devServerId: i32, connectionId: i32) void;
        extern "c" fn InspectorBunFrontendDevServerAgent__notifyBundleStart(agent: *InspectorBunFrontendDevServerAgentHandle, devServerId: i32, triggerFiles: [*]bun.String, triggerFilesLen: usize) void;
        extern "c" fn InspectorBunFrontendDevServerAgent__notifyBundleComplete(agent: *InspectorBunFrontendDevServerAgentHandle, devServerId: i32, durationMs: f64) void;
        extern "c" fn InspectorBunFrontendDevServerAgent__notifyBundleFailed(agent: *InspectorBunFrontendDevServerAgentHandle, devServerId: i32, buildErrorsPayloadBase64: *bun.String) void;
        extern "c" fn InspectorBunFrontendDevServerAgent__notifyClientNavigated(agent: *InspectorBunFrontendDevServerAgentHandle, devServerId: i32, connectionId: i32, url: *bun.String, routeBundleId: i32) void;
        extern "c" fn InspectorBunFrontendDevServerAgent__notifyClientErrorReported(agent: *InspectorBunFrontendDevServerAgentHandle, devServerId: i32, clientErrorPayloadBase64: *bun.String) void;
        extern "c" fn InspectorBunFrontendDevServerAgent__notifyGraphUpdate(agent: *InspectorBunFrontendDevServerAgentHandle, devServerId: i32, visualizerPayloadBase64: *bun.String) void;
        extern "c" fn InspectorBunFrontendDevServerAgent__notifyConsoleLog(agent: *InspectorBunFrontendDevServerAgentHandle, devServerId: i32, kind: u8, data: *bun.String) void;
        extern "c" fn InspectorBunFrontendDevServerAgent__notifyScreenshot(agent: *InspectorBunFrontendDevServerAgentHandle, uniqueId: u32, payload: *bun.String) void;
    };
    const notifyClientConnected = c.InspectorBunFrontendDevServerAgent__notifyClientConnected;
    const notifyClientDisconnected = c.InspectorBunFrontendDevServerAgent__notifyClientDisconnected;
    const notifyBundleStart = c.InspectorBunFrontendDevServerAgent__notifyBundleStart;
    const notifyBundleComplete = c.InspectorBunFrontendDevServerAgent__notifyBundleComplete;
    const notifyBundleFailed = c.InspectorBunFrontendDevServerAgent__notifyBundleFailed;
    const notifyClientNavigated = c.InspectorBunFrontendDevServerAgent__notifyClientNavigated;
    const notifyClientErrorReported = c.InspectorBunFrontendDevServerAgent__notifyClientErrorReported;
    const notifyGraphUpdate = c.InspectorBunFrontendDevServerAgent__notifyGraphUpdate;
    const notifyConsoleLog = c.InspectorBunFrontendDevServerAgent__notifyConsoleLog;
    const notifyScreenshot = c.InspectorBunFrontendDevServerAgent__notifyScreenshot;
};

var dev_server_id_counter: std.atomic.Value(u32) = std.atomic.Value(u32).init(0);

pub const BunFrontendDevServerAgent = struct {
    handle: ?*InspectorBunFrontendDevServerAgentHandle = null,
    dev_servers: std.AutoArrayHashMapUnmanaged(DevServer.DebuggerId, *DevServer) = .{},

    pub fn newDevServerID() DevServer.DebuggerId {
        return DevServer.DebuggerId.init(dev_server_id_counter.fetchAdd(1, .monotonic));
    }

    pub fn __insertDevServer(this: *BunFrontendDevServerAgent, dev_server: *DevServer) void {
        this.dev_servers.put(bun.default_allocator, dev_server.debugger_id, dev_server) catch bun.outOfMemory();
    }

    pub fn isEnabled(this: BunFrontendDevServerAgent) bool {
        return this.handle != null;
    }

    pub fn notifyClientConnected(this: BunFrontendDevServerAgent, devServerId: DevServer.DebuggerId, connectionId: i32) void {
        if (this.handle) |handle| {
            handle.notifyClientConnected(devServerId.get(), connectionId);
        }
    }

    pub fn notifyClientDisconnected(this: BunFrontendDevServerAgent, devServerId: DevServer.DebuggerId, connectionId: i32) void {
        if (this.handle) |handle| {
            handle.notifyClientDisconnected(devServerId.get(), connectionId);
        }
    }

    pub fn notifyBundleStart(this: BunFrontendDevServerAgent, devServerId: DevServer.DebuggerId, triggerFiles: []bun.String) void {
        if (this.handle) |handle| {
            handle.notifyBundleStart(devServerId.get(), triggerFiles.ptr, triggerFiles.len);
        }
    }

    pub fn notifyBundleComplete(this: BunFrontendDevServerAgent, devServerId: DevServer.DebuggerId, durationMs: f64) void {
        if (this.handle) |handle| {
            handle.notifyBundleComplete(devServerId.get(), durationMs);
        }
    }

    pub fn notifyBundleFailed(this: BunFrontendDevServerAgent, devServerId: DevServer.DebuggerId, buildErrorsPayloadBase64: *bun.String) void {
        if (this.handle) |handle| {
            handle.notifyBundleFailed(devServerId.get(), buildErrorsPayloadBase64);
        }
    }

    pub fn notifyClientNavigated(
        this: BunFrontendDevServerAgent,
        devServerId: DevServer.DebuggerId,
        connectionId: i32,
        url: *bun.String,
        routeBundleId: ?DevServer.RouteBundle.Index,
    ) void {
        if (this.handle) |handle| {
            handle.notifyClientNavigated(
                devServerId.get(),
                connectionId,
                url,
                if (routeBundleId) |id| id.get() else -1,
            );
        }
    }

    pub fn notifyClientErrorReported(
        this: BunFrontendDevServerAgent,
        devServerId: DevServer.DebuggerId,
        clientErrorPayloadBase64: *bun.String,
    ) void {
        if (this.handle) |handle| {
            handle.notifyClientErrorReported(devServerId.get(), clientErrorPayloadBase64);
        }
    }

    pub fn notifyGraphUpdate(this: BunFrontendDevServerAgent, devServerId: DevServer.DebuggerId, visualizerPayloadBase64: *bun.String) void {
        if (this.handle) |handle| {
            handle.notifyGraphUpdate(devServerId.get(), visualizerPayloadBase64);
        }
    }

    pub fn notifyConsoleLog(this: BunFrontendDevServerAgent, devServerId: DevServer.DebuggerId, kind: bun.bake.DevServer.ConsoleLogKind, data: *bun.String) void {
        if (this.handle) |handle| {
            handle.notifyConsoleLog(devServerId.get(), @intFromEnum(kind), data);
        }
    }

    pub fn notifyScreenshot(this: BunFrontendDevServerAgent, unique_id: u32, payload: *bun.String) void {
        if (this.handle) |handle| {
            handle.notifyScreenshot(unique_id, payload);
        }
    }

    export fn Bun__InspectorBunFrontendDevServerAgent__setEnabled(agent: ?*InspectorBunFrontendDevServerAgentHandle) void {
        if (JSC.VirtualMachine.get().debugger) |*debugger| {
            debugger.frontend_dev_server_agent.handle = agent;
        }
    }

    export fn Bun__InspectorBunFrontendDevServerAgent__screenshot(_: *InspectorBunFrontendDevServerAgentHandle, dev_server_id_raw: i32, connectionId: i32, uniqueId: i32) c_int {
        if (JSC.VirtualMachine.get().debugger) |*debugger| {
            const dev_server_id = DevServer.DebuggerId.init(@intCast(dev_server_id_raw));
            const dev_server = debugger.frontend_dev_server_agent.dev_servers.get(dev_server_id) orelse {
                return -1;
            };
            const connection = dev_server.active_websocket_connections.get(bun.bake.DevServer.HmrSocket.Id.init(connectionId)) orelse {
                return -2;
            };
            if (connection.requestScreenshot(@intCast(uniqueId))) {
                return 0;
            }
            return -4;
        }
        return -3;
    }
};
