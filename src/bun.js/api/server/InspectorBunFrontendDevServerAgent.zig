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
};

pub const BunFrontendDevServerAgent = struct {
    next_inspector_connection_id: i32 = 0,
    handle: ?*InspectorBunFrontendDevServerAgentHandle = null,

    pub fn nextConnectionID(this: *BunFrontendDevServerAgent) i32 {
        const id = this.next_inspector_connection_id;
        this.next_inspector_connection_id +%= 1;
        return id;
    }

    pub fn isEnabled(this: *const BunFrontendDevServerAgent) bool {
        return this.handle != null;
    }

    pub fn notifyClientConnected(this: *const BunFrontendDevServerAgent, devServerId: DebuggerId, connectionId: i32) void {
        if (this.handle) |handle| {
            handle.notifyClientConnected(devServerId.get(), connectionId);
        }
    }

    pub fn notifyClientDisconnected(this: *const BunFrontendDevServerAgent, devServerId: DebuggerId, connectionId: i32) void {
        if (this.handle) |handle| {
            handle.notifyClientDisconnected(devServerId.get(), connectionId);
        }
    }

    pub fn notifyBundleStart(this: *const BunFrontendDevServerAgent, devServerId: DebuggerId, triggerFiles: []bun.String) void {
        if (this.handle) |handle| {
            handle.notifyBundleStart(devServerId.get(), triggerFiles.ptr, triggerFiles.len);
        }
    }

    pub fn notifyBundleComplete(this: *const BunFrontendDevServerAgent, devServerId: DebuggerId, durationMs: f64) void {
        if (this.handle) |handle| {
            handle.notifyBundleComplete(devServerId.get(), durationMs);
        }
    }

    pub fn notifyBundleFailed(this: *const BunFrontendDevServerAgent, devServerId: DebuggerId, buildErrorsPayloadBase64: *bun.String) void {
        if (this.handle) |handle| {
            handle.notifyBundleFailed(devServerId.get(), buildErrorsPayloadBase64);
        }
    }

    pub fn notifyClientNavigated(
        this: *const BunFrontendDevServerAgent,
        devServerId: DebuggerId,
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
        this: *const BunFrontendDevServerAgent,
        devServerId: DebuggerId,
        clientErrorPayloadBase64: *bun.String,
    ) void {
        if (this.handle) |handle| {
            handle.notifyClientErrorReported(devServerId.get(), clientErrorPayloadBase64);
        }
    }

    pub fn notifyGraphUpdate(this: *const BunFrontendDevServerAgent, devServerId: DebuggerId, visualizerPayloadBase64: *bun.String) void {
        if (this.handle) |handle| {
            handle.notifyGraphUpdate(devServerId.get(), visualizerPayloadBase64);
        }
    }

    pub fn notifyConsoleLog(this: BunFrontendDevServerAgent, devServerId: DebuggerId, kind: bun.bake.DevServer.ConsoleLogKind, data: *bun.String) void {
        if (this.handle) |handle| {
            handle.notifyConsoleLog(devServerId.get(), @intFromEnum(kind), data);
        }
    }

    export fn Bun__InspectorBunFrontendDevServerAgent__setEnabled(agent: ?*InspectorBunFrontendDevServerAgentHandle) void {
        if (JSC.VirtualMachine.get().debugger) |*debugger| {
            debugger.frontend_dev_server_agent.handle = agent;
        }
    }
};

const DebuggerId = JSC.Debugger.DebuggerId;
