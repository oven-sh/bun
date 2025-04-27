const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;

const InspectorBunFrontendDevServerAgentHandle = opaque {
    pub fn notifyClientConnected(agent: *InspectorBunFrontendDevServerAgentHandle, connectionId: i32) void {
        InspectorBunFrontendDevServerAgent__notifyClientConnected(agent, connectionId);
    }

    pub fn notifyClientDisconnected(agent: *InspectorBunFrontendDevServerAgentHandle, connectionId: i32) void {
        InspectorBunFrontendDevServerAgent__notifyClientDisconnected(agent, connectionId);
    }

    pub fn notifyBundleStart(agent: *InspectorBunFrontendDevServerAgentHandle, triggerFiles: []bun.String, buildId: i32) void {
        InspectorBunFrontendDevServerAgent__notifyBundleStart(agent, triggerFiles.ptr, triggerFiles.len, buildId);
    }

    pub fn notifyBundleComplete(agent: *InspectorBunFrontendDevServerAgentHandle, durationMs: f64, buildId: i32) void {
        InspectorBunFrontendDevServerAgent__notifyBundleComplete(agent, durationMs, buildId);
    }

    pub fn notifyBundleFailed(agent: *InspectorBunFrontendDevServerAgentHandle, buildErrorsPayloadBase64: *bun.String, buildId: i32) void {
        InspectorBunFrontendDevServerAgent__notifyBundleFailed(agent, buildErrorsPayloadBase64, buildId);
    }

    pub fn notifyClientNavigated(agent: *InspectorBunFrontendDevServerAgentHandle, connectionId: i32, url: *bun.String, routeBundleId: i32) void {
        InspectorBunFrontendDevServerAgent__notifyClientNavigated(agent, connectionId, url, routeBundleId);
    }

    pub fn notifyClientErrorReported(agent: *InspectorBunFrontendDevServerAgentHandle, clientErrorPayloadBase64: *bun.String) void {
        InspectorBunFrontendDevServerAgent__notifyClientErrorReported(agent, clientErrorPayloadBase64);
    }

    pub fn notifyGraphUpdate(agent: *InspectorBunFrontendDevServerAgentHandle, visualizerPayloadBase64: *bun.String) void {
        InspectorBunFrontendDevServerAgent__notifyGraphUpdate(agent, visualizerPayloadBase64);
    }

    // C API for creating/destroying the C++ agent
    extern "c" fn InspectorBunFrontendDevServerAgent__notifyClientConnected(agent: *InspectorBunFrontendDevServerAgentHandle, connectionId: i32) void;
    extern "c" fn InspectorBunFrontendDevServerAgent__notifyClientDisconnected(agent: *InspectorBunFrontendDevServerAgentHandle, connectionId: i32) void;
    extern "c" fn InspectorBunFrontendDevServerAgent__notifyBundleStart(agent: *InspectorBunFrontendDevServerAgentHandle, triggerFiles: [*]bun.String, triggerFilesLen: usize, buildId: i32) void;
    extern "c" fn InspectorBunFrontendDevServerAgent__notifyBundleComplete(agent: *InspectorBunFrontendDevServerAgentHandle, durationMs: f64, buildId: i32) void;
    extern "c" fn InspectorBunFrontendDevServerAgent__notifyBundleFailed(agent: *InspectorBunFrontendDevServerAgentHandle, buildErrorsPayloadBase64: *bun.String, buildId: i32) void;
    extern "c" fn InspectorBunFrontendDevServerAgent__notifyClientNavigated(agent: *InspectorBunFrontendDevServerAgentHandle, connectionId: i32, url: *bun.String, routeBundleId: i32) void;
    extern "c" fn InspectorBunFrontendDevServerAgent__notifyClientErrorReported(agent: *InspectorBunFrontendDevServerAgentHandle, clientErrorPayloadBase64: *bun.String) void;
    extern "c" fn InspectorBunFrontendDevServerAgent__notifyGraphUpdate(agent: *InspectorBunFrontendDevServerAgentHandle, visualizerPayloadBase64: *bun.String) void;
};

pub const BunFrontendDevServerAgent = struct {
    next_inspector_connection_id: i32 = 0,
    handle: ?*InspectorBunFrontendDevServerAgentHandle = null,

    pub fn nextConnectionID(this: *BunFrontendDevServerAgent) i32 {
        const id = this.next_inspector_connection_id;
        this.next_inspector_connection_id +%= 1;
        return id;
    }

    pub fn isEnabled(this: BunFrontendDevServerAgent) bool {
        return this.handle != null;
    }

    pub fn notifyClientConnected(this: BunFrontendDevServerAgent, connectionId: i32) void {
        if (this.handle) |handle| {
            InspectorBunFrontendDevServerAgentHandle.notifyClientConnected(handle, connectionId);
        }
    }

    pub fn notifyClientDisconnected(this: BunFrontendDevServerAgent, connectionId: i32) void {
        if (this.handle) |handle| {
            InspectorBunFrontendDevServerAgentHandle.notifyClientDisconnected(handle, connectionId);
        }
    }

    pub fn notifyBundleStart(this: BunFrontendDevServerAgent, triggerFiles: []bun.String, buildId: i32) void {
        if (this.handle) |handle| {
            InspectorBunFrontendDevServerAgentHandle.notifyBundleStart(handle, triggerFiles, buildId);
        }
    }

    pub fn notifyBundleComplete(this: BunFrontendDevServerAgent, durationMs: f64, buildId: i32) void {
        if (this.handle) |handle| {
            InspectorBunFrontendDevServerAgentHandle.notifyBundleComplete(handle, durationMs, buildId);
        }
    }

    pub fn notifyBundleFailed(this: BunFrontendDevServerAgent, buildErrorsPayloadBase64: *bun.String, buildId: i32) void {
        if (this.handle) |handle| {
            InspectorBunFrontendDevServerAgentHandle.notifyBundleFailed(handle, buildErrorsPayloadBase64, buildId);
        }
    }

    pub fn notifyClientNavigated(this: BunFrontendDevServerAgent, connectionId: i32, url: *bun.String, routeBundleId: i32) void {
        if (this.handle) |handle| {
            InspectorBunFrontendDevServerAgentHandle.notifyClientNavigated(handle, connectionId, url, routeBundleId);
        }
    }

    pub fn notifyClientErrorReported(this: BunFrontendDevServerAgent, clientErrorPayloadBase64: *bun.String) void {
        if (this.handle) |handle| {
            InspectorBunFrontendDevServerAgentHandle.notifyClientErrorReported(handle, clientErrorPayloadBase64);
        }
    }

    pub fn notifyGraphUpdate(this: BunFrontendDevServerAgent, visualizerPayloadBase64: *bun.String) void {
        if (this.handle) |handle| {
            InspectorBunFrontendDevServerAgentHandle.notifyGraphUpdate(handle, visualizerPayloadBase64);
        }
    }

    export fn Bun__InspectorBunFrontendDevServerAgent__setEnabled(agent: ?*InspectorBunFrontendDevServerAgentHandle) void {
        if (JSC.VirtualMachine.get().debugger) |*debugger| {
            debugger.frontend_dev_server_agent.handle = agent;
        }
    }
};
