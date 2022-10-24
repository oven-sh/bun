const JSC = @import("javascript_core");
const Classes = @import("./generated_classes_list.zig").Classes;
const Environment = @import("../../env.zig");
const std = @import("std");

pub const StaticGetterType = fn (*JSC.JSGlobalObject, JSC.JSValue, JSC.JSValue) callconv(.C) JSC.JSValue;
pub const StaticSetterType = fn (*JSC.JSGlobalObject, JSC.JSValue, JSC.JSValue, JSC.JSValue) callconv(.C) bool;
pub const StaticCallbackType = fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

pub const JSTCPSocket = struct {
    const TCPSocket = Classes.TCPSocket;
    const GetterType = fn (*TCPSocket, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*TCPSocket, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*TCPSocket, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*TCPSocket {
        JSC.markBinding(@src());
        return TCPSocket__fromJS(value);
    }

    extern fn TCPSocketPrototype__dataSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for data on TCPSocket
    /// This value will be visited by the garbage collector.
    pub fn dataSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        TCPSocketPrototype__dataSetCachedValue(thisValue, globalObject, value);
    }

    extern fn TCPSocketPrototype__remoteAddressSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for remoteAddress on TCPSocket
    /// This value will be visited by the garbage collector.
    pub fn remoteAddressSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        TCPSocketPrototype__remoteAddressSetCachedValue(thisValue, globalObject, value);
    }

    /// Get the TCPSocket constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return TCPSocket__getConstructor(globalObject);
    }

    /// Create a new instance of TCPSocket
    pub fn toJS(this: *TCPSocket, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = TCPSocket__create(globalObject, this);
            std.debug.assert(value__.as(TCPSocket).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return TCPSocket__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of TCPSocket.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*TCPSocket) bool {
        JSC.markBinding(@src());
        return TCPSocket__dangerouslySetPtr(value, ptr);
    }

    extern fn TCPSocket__fromJS(JSC.JSValue) ?*TCPSocket;
    extern fn TCPSocket__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn TCPSocket__create(globalObject: *JSC.JSGlobalObject, ptr: ?*TCPSocket) JSC.JSValue;

    extern fn TCPSocket__dangerouslySetPtr(JSC.JSValue, ?*TCPSocket) bool;

    comptime {
        if (@TypeOf(TCPSocket.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*TCPSocket)) {
            @compileLog("TCPSocket.constructor is not a constructor");
        }

        if (@TypeOf(TCPSocket.finalize) != (fn (*TCPSocket) callconv(.C) void)) {
            @compileLog("TCPSocket.finalize is not a finalizer");
        }

        if (@TypeOf(TCPSocket.getData) != GetterType)
            @compileLog("Expected TCPSocket.getData to be a getter");

        if (@TypeOf(TCPSocket.setData) != SetterType)
            @compileLog("Expected TCPSocket.setData to be a setter");
        if (@TypeOf(TCPSocket.end) != CallbackType)
            @compileLog("Expected TCPSocket.end to be a callback");
        if (@TypeOf(TCPSocket.flush) != CallbackType)
            @compileLog("Expected TCPSocket.flush to be a callback");
        if (@TypeOf(TCPSocket.getListener) != GetterType)
            @compileLog("Expected TCPSocket.getListener to be a getter");

        if (@TypeOf(TCPSocket.getLocalPort) != GetterType)
            @compileLog("Expected TCPSocket.getLocalPort to be a getter");

        if (@TypeOf(TCPSocket.getReadyState) != GetterType)
            @compileLog("Expected TCPSocket.getReadyState to be a getter");

        if (@TypeOf(TCPSocket.ref) != CallbackType)
            @compileLog("Expected TCPSocket.ref to be a callback");
        if (@TypeOf(TCPSocket.reload) != CallbackType)
            @compileLog("Expected TCPSocket.reload to be a callback");
        if (@TypeOf(TCPSocket.getRemoteAddress) != GetterType)
            @compileLog("Expected TCPSocket.getRemoteAddress to be a getter");

        if (@TypeOf(TCPSocket.shutdown) != CallbackType)
            @compileLog("Expected TCPSocket.shutdown to be a callback");
        if (@TypeOf(TCPSocket.timeout) != CallbackType)
            @compileLog("Expected TCPSocket.timeout to be a callback");
        if (@TypeOf(TCPSocket.unref) != CallbackType)
            @compileLog("Expected TCPSocket.unref to be a callback");
        if (@TypeOf(TCPSocket.write) != CallbackType)
            @compileLog("Expected TCPSocket.write to be a callback");
        if (!JSC.is_bindgen) {
            @export(TCPSocket.constructor, .{ .name = "TCPSocketClass__construct" });
            @export(TCPSocket.end, .{ .name = "TCPSocketPrototype__end" });
            @export(TCPSocket.finalize, .{ .name = "TCPSocketClass__finalize" });
            @export(TCPSocket.flush, .{ .name = "TCPSocketPrototype__flush" });
            @export(TCPSocket.getData, .{ .name = "TCPSocketPrototype__getData" });
            @export(TCPSocket.getListener, .{ .name = "TCPSocketPrototype__getListener" });
            @export(TCPSocket.getLocalPort, .{ .name = "TCPSocketPrototype__getLocalPort" });
            @export(TCPSocket.getReadyState, .{ .name = "TCPSocketPrototype__getReadyState" });
            @export(TCPSocket.getRemoteAddress, .{ .name = "TCPSocketPrototype__getRemoteAddress" });
            @export(TCPSocket.ref, .{ .name = "TCPSocketPrototype__ref" });
            @export(TCPSocket.reload, .{ .name = "TCPSocketPrototype__reload" });
            @export(TCPSocket.setData, .{ .name = "TCPSocketPrototype__setData" });
            @export(TCPSocket.shutdown, .{ .name = "TCPSocketPrototype__shutdown" });
            @export(TCPSocket.timeout, .{ .name = "TCPSocketPrototype__timeout" });
            @export(TCPSocket.unref, .{ .name = "TCPSocketPrototype__unref" });
            @export(TCPSocket.write, .{ .name = "TCPSocketPrototype__write" });
        }
    }
};
pub const JSTLSSocket = struct {
    const TLSSocket = Classes.TLSSocket;
    const GetterType = fn (*TLSSocket, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*TLSSocket, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*TLSSocket, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*TLSSocket {
        JSC.markBinding(@src());
        return TLSSocket__fromJS(value);
    }

    extern fn TLSSocketPrototype__dataSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for data on TLSSocket
    /// This value will be visited by the garbage collector.
    pub fn dataSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        TLSSocketPrototype__dataSetCachedValue(thisValue, globalObject, value);
    }

    extern fn TLSSocketPrototype__remoteAddressSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for remoteAddress on TLSSocket
    /// This value will be visited by the garbage collector.
    pub fn remoteAddressSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        TLSSocketPrototype__remoteAddressSetCachedValue(thisValue, globalObject, value);
    }

    /// Get the TLSSocket constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return TLSSocket__getConstructor(globalObject);
    }

    /// Create a new instance of TLSSocket
    pub fn toJS(this: *TLSSocket, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = TLSSocket__create(globalObject, this);
            std.debug.assert(value__.as(TLSSocket).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return TLSSocket__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of TLSSocket.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*TLSSocket) bool {
        JSC.markBinding(@src());
        return TLSSocket__dangerouslySetPtr(value, ptr);
    }

    extern fn TLSSocket__fromJS(JSC.JSValue) ?*TLSSocket;
    extern fn TLSSocket__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn TLSSocket__create(globalObject: *JSC.JSGlobalObject, ptr: ?*TLSSocket) JSC.JSValue;

    extern fn TLSSocket__dangerouslySetPtr(JSC.JSValue, ?*TLSSocket) bool;

    comptime {
        if (@TypeOf(TLSSocket.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*TLSSocket)) {
            @compileLog("TLSSocket.constructor is not a constructor");
        }

        if (@TypeOf(TLSSocket.finalize) != (fn (*TLSSocket) callconv(.C) void)) {
            @compileLog("TLSSocket.finalize is not a finalizer");
        }

        if (@TypeOf(TLSSocket.getData) != GetterType)
            @compileLog("Expected TLSSocket.getData to be a getter");

        if (@TypeOf(TLSSocket.setData) != SetterType)
            @compileLog("Expected TLSSocket.setData to be a setter");
        if (@TypeOf(TLSSocket.end) != CallbackType)
            @compileLog("Expected TLSSocket.end to be a callback");
        if (@TypeOf(TLSSocket.flush) != CallbackType)
            @compileLog("Expected TLSSocket.flush to be a callback");
        if (@TypeOf(TLSSocket.getListener) != GetterType)
            @compileLog("Expected TLSSocket.getListener to be a getter");

        if (@TypeOf(TLSSocket.getLocalPort) != GetterType)
            @compileLog("Expected TLSSocket.getLocalPort to be a getter");

        if (@TypeOf(TLSSocket.getReadyState) != GetterType)
            @compileLog("Expected TLSSocket.getReadyState to be a getter");

        if (@TypeOf(TLSSocket.ref) != CallbackType)
            @compileLog("Expected TLSSocket.ref to be a callback");
        if (@TypeOf(TLSSocket.reload) != CallbackType)
            @compileLog("Expected TLSSocket.reload to be a callback");
        if (@TypeOf(TLSSocket.getRemoteAddress) != GetterType)
            @compileLog("Expected TLSSocket.getRemoteAddress to be a getter");

        if (@TypeOf(TLSSocket.shutdown) != CallbackType)
            @compileLog("Expected TLSSocket.shutdown to be a callback");
        if (@TypeOf(TLSSocket.timeout) != CallbackType)
            @compileLog("Expected TLSSocket.timeout to be a callback");
        if (@TypeOf(TLSSocket.unref) != CallbackType)
            @compileLog("Expected TLSSocket.unref to be a callback");
        if (@TypeOf(TLSSocket.write) != CallbackType)
            @compileLog("Expected TLSSocket.write to be a callback");
        if (!JSC.is_bindgen) {
            @export(TLSSocket.constructor, .{ .name = "TLSSocketClass__construct" });
            @export(TLSSocket.end, .{ .name = "TLSSocketPrototype__end" });
            @export(TLSSocket.finalize, .{ .name = "TLSSocketClass__finalize" });
            @export(TLSSocket.flush, .{ .name = "TLSSocketPrototype__flush" });
            @export(TLSSocket.getData, .{ .name = "TLSSocketPrototype__getData" });
            @export(TLSSocket.getListener, .{ .name = "TLSSocketPrototype__getListener" });
            @export(TLSSocket.getLocalPort, .{ .name = "TLSSocketPrototype__getLocalPort" });
            @export(TLSSocket.getReadyState, .{ .name = "TLSSocketPrototype__getReadyState" });
            @export(TLSSocket.getRemoteAddress, .{ .name = "TLSSocketPrototype__getRemoteAddress" });
            @export(TLSSocket.ref, .{ .name = "TLSSocketPrototype__ref" });
            @export(TLSSocket.reload, .{ .name = "TLSSocketPrototype__reload" });
            @export(TLSSocket.setData, .{ .name = "TLSSocketPrototype__setData" });
            @export(TLSSocket.shutdown, .{ .name = "TLSSocketPrototype__shutdown" });
            @export(TLSSocket.timeout, .{ .name = "TLSSocketPrototype__timeout" });
            @export(TLSSocket.unref, .{ .name = "TLSSocketPrototype__unref" });
            @export(TLSSocket.write, .{ .name = "TLSSocketPrototype__write" });
        }
    }
};
pub const JSListener = struct {
    const Listener = Classes.Listener;
    const GetterType = fn (*Listener, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*Listener, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*Listener, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*Listener {
        JSC.markBinding(@src());
        return Listener__fromJS(value);
    }

    extern fn ListenerPrototype__hostnameSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for hostname on Listener
    /// This value will be visited by the garbage collector.
    pub fn hostnameSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        ListenerPrototype__hostnameSetCachedValue(thisValue, globalObject, value);
    }

    extern fn ListenerPrototype__unixSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for unix on Listener
    /// This value will be visited by the garbage collector.
    pub fn unixSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        ListenerPrototype__unixSetCachedValue(thisValue, globalObject, value);
    }

    /// Get the Listener constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return Listener__getConstructor(globalObject);
    }

    /// Create a new instance of Listener
    pub fn toJS(this: *Listener, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = Listener__create(globalObject, this);
            std.debug.assert(value__.as(Listener).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return Listener__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of Listener.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*Listener) bool {
        JSC.markBinding(@src());
        return Listener__dangerouslySetPtr(value, ptr);
    }

    extern fn Listener__fromJS(JSC.JSValue) ?*Listener;
    extern fn Listener__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn Listener__create(globalObject: *JSC.JSGlobalObject, ptr: ?*Listener) JSC.JSValue;

    extern fn Listener__dangerouslySetPtr(JSC.JSValue, ?*Listener) bool;

    comptime {
        if (@TypeOf(Listener.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*Listener)) {
            @compileLog("Listener.constructor is not a constructor");
        }

        if (@TypeOf(Listener.finalize) != (fn (*Listener) callconv(.C) void)) {
            @compileLog("Listener.finalize is not a finalizer");
        }

        if (@TypeOf(Listener.getData) != GetterType)
            @compileLog("Expected Listener.getData to be a getter");

        if (@TypeOf(Listener.setData) != SetterType)
            @compileLog("Expected Listener.setData to be a setter");
        if (@TypeOf(Listener.getHostname) != GetterType)
            @compileLog("Expected Listener.getHostname to be a getter");

        if (@TypeOf(Listener.getPort) != GetterType)
            @compileLog("Expected Listener.getPort to be a getter");

        if (@TypeOf(Listener.ref) != CallbackType)
            @compileLog("Expected Listener.ref to be a callback");
        if (@TypeOf(Listener.reload) != CallbackType)
            @compileLog("Expected Listener.reload to be a callback");
        if (@TypeOf(Listener.stop) != CallbackType)
            @compileLog("Expected Listener.stop to be a callback");
        if (@TypeOf(Listener.getUnix) != GetterType)
            @compileLog("Expected Listener.getUnix to be a getter");

        if (@TypeOf(Listener.unref) != CallbackType)
            @compileLog("Expected Listener.unref to be a callback");
        if (!JSC.is_bindgen) {
            @export(Listener.constructor, .{ .name = "ListenerClass__construct" });
            @export(Listener.finalize, .{ .name = "ListenerClass__finalize" });
            @export(Listener.getData, .{ .name = "ListenerPrototype__getData" });
            @export(Listener.getHostname, .{ .name = "ListenerPrototype__getHostname" });
            @export(Listener.getPort, .{ .name = "ListenerPrototype__getPort" });
            @export(Listener.getUnix, .{ .name = "ListenerPrototype__getUnix" });
            @export(Listener.ref, .{ .name = "ListenerPrototype__ref" });
            @export(Listener.reload, .{ .name = "ListenerPrototype__reload" });
            @export(Listener.setData, .{ .name = "ListenerPrototype__setData" });
            @export(Listener.stop, .{ .name = "ListenerPrototype__stop" });
            @export(Listener.unref, .{ .name = "ListenerPrototype__unref" });
        }
    }
};
pub const JSSubprocess = struct {
    const Subprocess = Classes.Subprocess;
    const GetterType = fn (*Subprocess, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*Subprocess, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*Subprocess, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*Subprocess {
        JSC.markBinding(@src());
        return Subprocess__fromJS(value);
    }

    extern fn SubprocessPrototype__stderrSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for stderr on Subprocess
    /// This value will be visited by the garbage collector.
    pub fn stderrSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        SubprocessPrototype__stderrSetCachedValue(thisValue, globalObject, value);
    }

    extern fn SubprocessPrototype__stdinSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for stdin on Subprocess
    /// This value will be visited by the garbage collector.
    pub fn stdinSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        SubprocessPrototype__stdinSetCachedValue(thisValue, globalObject, value);
    }

    extern fn SubprocessPrototype__stdoutSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for stdout on Subprocess
    /// This value will be visited by the garbage collector.
    pub fn stdoutSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        SubprocessPrototype__stdoutSetCachedValue(thisValue, globalObject, value);
    }

    /// Get the Subprocess constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return Subprocess__getConstructor(globalObject);
    }

    /// Create a new instance of Subprocess
    pub fn toJS(this: *Subprocess, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = Subprocess__create(globalObject, this);
            std.debug.assert(value__.as(Subprocess).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return Subprocess__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of Subprocess.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*Subprocess) bool {
        JSC.markBinding(@src());
        return Subprocess__dangerouslySetPtr(value, ptr);
    }

    extern fn Subprocess__fromJS(JSC.JSValue) ?*Subprocess;
    extern fn Subprocess__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn Subprocess__create(globalObject: *JSC.JSGlobalObject, ptr: ?*Subprocess) JSC.JSValue;

    extern fn Subprocess__dangerouslySetPtr(JSC.JSValue, ?*Subprocess) bool;

    comptime {
        if (@TypeOf(Subprocess.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*Subprocess)) {
            @compileLog("Subprocess.constructor is not a constructor");
        }

        if (@TypeOf(Subprocess.finalize) != (fn (*Subprocess) callconv(.C) void)) {
            @compileLog("Subprocess.finalize is not a finalizer");
        }

        if (@TypeOf(Subprocess.getExitCode) != GetterType)
            @compileLog("Expected Subprocess.getExitCode to be a getter");

        if (@TypeOf(Subprocess.getExited) != GetterType)
            @compileLog("Expected Subprocess.getExited to be a getter");

        if (@TypeOf(Subprocess.kill) != CallbackType)
            @compileLog("Expected Subprocess.kill to be a callback");
        if (@TypeOf(Subprocess.getKilled) != GetterType)
            @compileLog("Expected Subprocess.getKilled to be a getter");

        if (@TypeOf(Subprocess.getPid) != GetterType)
            @compileLog("Expected Subprocess.getPid to be a getter");

        if (@TypeOf(Subprocess.getStdout) != GetterType)
            @compileLog("Expected Subprocess.getStdout to be a getter");

        if (@TypeOf(Subprocess.doRef) != CallbackType)
            @compileLog("Expected Subprocess.doRef to be a callback");
        if (@TypeOf(Subprocess.getStderr) != GetterType)
            @compileLog("Expected Subprocess.getStderr to be a getter");

        if (@TypeOf(Subprocess.getStdin) != GetterType)
            @compileLog("Expected Subprocess.getStdin to be a getter");

        if (@TypeOf(Subprocess.getStdout) != GetterType)
            @compileLog("Expected Subprocess.getStdout to be a getter");

        if (@TypeOf(Subprocess.doUnref) != CallbackType)
            @compileLog("Expected Subprocess.doUnref to be a callback");
        if (@TypeOf(Subprocess.getStdin) != GetterType)
            @compileLog("Expected Subprocess.getStdin to be a getter");

        if (!JSC.is_bindgen) {
            @export(Subprocess.constructor, .{ .name = "SubprocessClass__construct" });
            @export(Subprocess.doRef, .{ .name = "SubprocessPrototype__doRef" });
            @export(Subprocess.doUnref, .{ .name = "SubprocessPrototype__doUnref" });
            @export(Subprocess.finalize, .{ .name = "SubprocessClass__finalize" });
            @export(Subprocess.getExitCode, .{ .name = "SubprocessPrototype__getExitCode" });
            @export(Subprocess.getExited, .{ .name = "SubprocessPrototype__getExited" });
            @export(Subprocess.getKilled, .{ .name = "SubprocessPrototype__getKilled" });
            @export(Subprocess.getPid, .{ .name = "SubprocessPrototype__getPid" });
            @export(Subprocess.getStderr, .{ .name = "SubprocessPrototype__getStderr" });
            @export(Subprocess.getStdin, .{ .name = "SubprocessPrototype__getStdin" });
            @export(Subprocess.getStdout, .{ .name = "SubprocessPrototype__getStdout" });
            @export(Subprocess.kill, .{ .name = "SubprocessPrototype__kill" });
        }
    }
};
pub const JSSHA1 = struct {
    const SHA1 = Classes.SHA1;
    const GetterType = fn (*SHA1, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*SHA1, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*SHA1, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*SHA1 {
        JSC.markBinding(@src());
        return SHA1__fromJS(value);
    }

    /// Get the SHA1 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return SHA1__getConstructor(globalObject);
    }

    /// Create a new instance of SHA1
    pub fn toJS(this: *SHA1, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = SHA1__create(globalObject, this);
            std.debug.assert(value__.as(SHA1).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return SHA1__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of SHA1.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*SHA1) bool {
        JSC.markBinding(@src());
        return SHA1__dangerouslySetPtr(value, ptr);
    }

    extern fn SHA1__fromJS(JSC.JSValue) ?*SHA1;
    extern fn SHA1__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn SHA1__create(globalObject: *JSC.JSGlobalObject, ptr: ?*SHA1) JSC.JSValue;

    extern fn SHA1__dangerouslySetPtr(JSC.JSValue, ?*SHA1) bool;

    comptime {
        if (@TypeOf(SHA1.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*SHA1)) {
            @compileLog("SHA1.constructor is not a constructor");
        }

        if (@TypeOf(SHA1.finalize) != (fn (*SHA1) callconv(.C) void)) {
            @compileLog("SHA1.finalize is not a finalizer");
        }

        if (@TypeOf(SHA1.getByteLength) != GetterType)
            @compileLog("Expected SHA1.getByteLength to be a getter");

        if (@TypeOf(SHA1.digest) != CallbackType)
            @compileLog("Expected SHA1.digest to be a callback");
        if (@TypeOf(SHA1.update) != CallbackType)
            @compileLog("Expected SHA1.update to be a callback");
        if (@TypeOf(SHA1.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected SHA1.getByteLengthStatic to be a static getter");

        if (@TypeOf(SHA1.hash) != StaticCallbackType)
            @compileLog("Expected SHA1.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(SHA1.constructor, .{ .name = "SHA1Class__construct" });
            @export(SHA1.digest, .{ .name = "SHA1Prototype__digest" });
            @export(SHA1.finalize, .{ .name = "SHA1Class__finalize" });
            @export(SHA1.getByteLength, .{ .name = "SHA1Prototype__getByteLength" });
            @export(SHA1.getByteLengthStatic, .{ .name = "SHA1Class__getByteLengthStatic" });
            @export(SHA1.hash, .{ .name = "SHA1Class__hash" });
            @export(SHA1.update, .{ .name = "SHA1Prototype__update" });
        }
    }
};
pub const JSMD5 = struct {
    const MD5 = Classes.MD5;
    const GetterType = fn (*MD5, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*MD5, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*MD5, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*MD5 {
        JSC.markBinding(@src());
        return MD5__fromJS(value);
    }

    /// Get the MD5 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return MD5__getConstructor(globalObject);
    }

    /// Create a new instance of MD5
    pub fn toJS(this: *MD5, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = MD5__create(globalObject, this);
            std.debug.assert(value__.as(MD5).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return MD5__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of MD5.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*MD5) bool {
        JSC.markBinding(@src());
        return MD5__dangerouslySetPtr(value, ptr);
    }

    extern fn MD5__fromJS(JSC.JSValue) ?*MD5;
    extern fn MD5__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn MD5__create(globalObject: *JSC.JSGlobalObject, ptr: ?*MD5) JSC.JSValue;

    extern fn MD5__dangerouslySetPtr(JSC.JSValue, ?*MD5) bool;

    comptime {
        if (@TypeOf(MD5.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*MD5)) {
            @compileLog("MD5.constructor is not a constructor");
        }

        if (@TypeOf(MD5.finalize) != (fn (*MD5) callconv(.C) void)) {
            @compileLog("MD5.finalize is not a finalizer");
        }

        if (@TypeOf(MD5.getByteLength) != GetterType)
            @compileLog("Expected MD5.getByteLength to be a getter");

        if (@TypeOf(MD5.digest) != CallbackType)
            @compileLog("Expected MD5.digest to be a callback");
        if (@TypeOf(MD5.update) != CallbackType)
            @compileLog("Expected MD5.update to be a callback");
        if (@TypeOf(MD5.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected MD5.getByteLengthStatic to be a static getter");

        if (@TypeOf(MD5.hash) != StaticCallbackType)
            @compileLog("Expected MD5.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(MD5.constructor, .{ .name = "MD5Class__construct" });
            @export(MD5.digest, .{ .name = "MD5Prototype__digest" });
            @export(MD5.finalize, .{ .name = "MD5Class__finalize" });
            @export(MD5.getByteLength, .{ .name = "MD5Prototype__getByteLength" });
            @export(MD5.getByteLengthStatic, .{ .name = "MD5Class__getByteLengthStatic" });
            @export(MD5.hash, .{ .name = "MD5Class__hash" });
            @export(MD5.update, .{ .name = "MD5Prototype__update" });
        }
    }
};
pub const JSMD4 = struct {
    const MD4 = Classes.MD4;
    const GetterType = fn (*MD4, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*MD4, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*MD4, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*MD4 {
        JSC.markBinding(@src());
        return MD4__fromJS(value);
    }

    /// Get the MD4 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return MD4__getConstructor(globalObject);
    }

    /// Create a new instance of MD4
    pub fn toJS(this: *MD4, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = MD4__create(globalObject, this);
            std.debug.assert(value__.as(MD4).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return MD4__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of MD4.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*MD4) bool {
        JSC.markBinding(@src());
        return MD4__dangerouslySetPtr(value, ptr);
    }

    extern fn MD4__fromJS(JSC.JSValue) ?*MD4;
    extern fn MD4__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn MD4__create(globalObject: *JSC.JSGlobalObject, ptr: ?*MD4) JSC.JSValue;

    extern fn MD4__dangerouslySetPtr(JSC.JSValue, ?*MD4) bool;

    comptime {
        if (@TypeOf(MD4.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*MD4)) {
            @compileLog("MD4.constructor is not a constructor");
        }

        if (@TypeOf(MD4.finalize) != (fn (*MD4) callconv(.C) void)) {
            @compileLog("MD4.finalize is not a finalizer");
        }

        if (@TypeOf(MD4.getByteLength) != GetterType)
            @compileLog("Expected MD4.getByteLength to be a getter");

        if (@TypeOf(MD4.digest) != CallbackType)
            @compileLog("Expected MD4.digest to be a callback");
        if (@TypeOf(MD4.update) != CallbackType)
            @compileLog("Expected MD4.update to be a callback");
        if (@TypeOf(MD4.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected MD4.getByteLengthStatic to be a static getter");

        if (@TypeOf(MD4.hash) != StaticCallbackType)
            @compileLog("Expected MD4.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(MD4.constructor, .{ .name = "MD4Class__construct" });
            @export(MD4.digest, .{ .name = "MD4Prototype__digest" });
            @export(MD4.finalize, .{ .name = "MD4Class__finalize" });
            @export(MD4.getByteLength, .{ .name = "MD4Prototype__getByteLength" });
            @export(MD4.getByteLengthStatic, .{ .name = "MD4Class__getByteLengthStatic" });
            @export(MD4.hash, .{ .name = "MD4Class__hash" });
            @export(MD4.update, .{ .name = "MD4Prototype__update" });
        }
    }
};
pub const JSSHA224 = struct {
    const SHA224 = Classes.SHA224;
    const GetterType = fn (*SHA224, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*SHA224, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*SHA224, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*SHA224 {
        JSC.markBinding(@src());
        return SHA224__fromJS(value);
    }

    /// Get the SHA224 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return SHA224__getConstructor(globalObject);
    }

    /// Create a new instance of SHA224
    pub fn toJS(this: *SHA224, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = SHA224__create(globalObject, this);
            std.debug.assert(value__.as(SHA224).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return SHA224__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of SHA224.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*SHA224) bool {
        JSC.markBinding(@src());
        return SHA224__dangerouslySetPtr(value, ptr);
    }

    extern fn SHA224__fromJS(JSC.JSValue) ?*SHA224;
    extern fn SHA224__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn SHA224__create(globalObject: *JSC.JSGlobalObject, ptr: ?*SHA224) JSC.JSValue;

    extern fn SHA224__dangerouslySetPtr(JSC.JSValue, ?*SHA224) bool;

    comptime {
        if (@TypeOf(SHA224.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*SHA224)) {
            @compileLog("SHA224.constructor is not a constructor");
        }

        if (@TypeOf(SHA224.finalize) != (fn (*SHA224) callconv(.C) void)) {
            @compileLog("SHA224.finalize is not a finalizer");
        }

        if (@TypeOf(SHA224.getByteLength) != GetterType)
            @compileLog("Expected SHA224.getByteLength to be a getter");

        if (@TypeOf(SHA224.digest) != CallbackType)
            @compileLog("Expected SHA224.digest to be a callback");
        if (@TypeOf(SHA224.update) != CallbackType)
            @compileLog("Expected SHA224.update to be a callback");
        if (@TypeOf(SHA224.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected SHA224.getByteLengthStatic to be a static getter");

        if (@TypeOf(SHA224.hash) != StaticCallbackType)
            @compileLog("Expected SHA224.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(SHA224.constructor, .{ .name = "SHA224Class__construct" });
            @export(SHA224.digest, .{ .name = "SHA224Prototype__digest" });
            @export(SHA224.finalize, .{ .name = "SHA224Class__finalize" });
            @export(SHA224.getByteLength, .{ .name = "SHA224Prototype__getByteLength" });
            @export(SHA224.getByteLengthStatic, .{ .name = "SHA224Class__getByteLengthStatic" });
            @export(SHA224.hash, .{ .name = "SHA224Class__hash" });
            @export(SHA224.update, .{ .name = "SHA224Prototype__update" });
        }
    }
};
pub const JSSHA512 = struct {
    const SHA512 = Classes.SHA512;
    const GetterType = fn (*SHA512, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*SHA512, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*SHA512, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*SHA512 {
        JSC.markBinding(@src());
        return SHA512__fromJS(value);
    }

    /// Get the SHA512 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return SHA512__getConstructor(globalObject);
    }

    /// Create a new instance of SHA512
    pub fn toJS(this: *SHA512, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = SHA512__create(globalObject, this);
            std.debug.assert(value__.as(SHA512).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return SHA512__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of SHA512.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*SHA512) bool {
        JSC.markBinding(@src());
        return SHA512__dangerouslySetPtr(value, ptr);
    }

    extern fn SHA512__fromJS(JSC.JSValue) ?*SHA512;
    extern fn SHA512__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn SHA512__create(globalObject: *JSC.JSGlobalObject, ptr: ?*SHA512) JSC.JSValue;

    extern fn SHA512__dangerouslySetPtr(JSC.JSValue, ?*SHA512) bool;

    comptime {
        if (@TypeOf(SHA512.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*SHA512)) {
            @compileLog("SHA512.constructor is not a constructor");
        }

        if (@TypeOf(SHA512.finalize) != (fn (*SHA512) callconv(.C) void)) {
            @compileLog("SHA512.finalize is not a finalizer");
        }

        if (@TypeOf(SHA512.getByteLength) != GetterType)
            @compileLog("Expected SHA512.getByteLength to be a getter");

        if (@TypeOf(SHA512.digest) != CallbackType)
            @compileLog("Expected SHA512.digest to be a callback");
        if (@TypeOf(SHA512.update) != CallbackType)
            @compileLog("Expected SHA512.update to be a callback");
        if (@TypeOf(SHA512.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected SHA512.getByteLengthStatic to be a static getter");

        if (@TypeOf(SHA512.hash) != StaticCallbackType)
            @compileLog("Expected SHA512.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(SHA512.constructor, .{ .name = "SHA512Class__construct" });
            @export(SHA512.digest, .{ .name = "SHA512Prototype__digest" });
            @export(SHA512.finalize, .{ .name = "SHA512Class__finalize" });
            @export(SHA512.getByteLength, .{ .name = "SHA512Prototype__getByteLength" });
            @export(SHA512.getByteLengthStatic, .{ .name = "SHA512Class__getByteLengthStatic" });
            @export(SHA512.hash, .{ .name = "SHA512Class__hash" });
            @export(SHA512.update, .{ .name = "SHA512Prototype__update" });
        }
    }
};
pub const JSSHA384 = struct {
    const SHA384 = Classes.SHA384;
    const GetterType = fn (*SHA384, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*SHA384, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*SHA384, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*SHA384 {
        JSC.markBinding(@src());
        return SHA384__fromJS(value);
    }

    /// Get the SHA384 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return SHA384__getConstructor(globalObject);
    }

    /// Create a new instance of SHA384
    pub fn toJS(this: *SHA384, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = SHA384__create(globalObject, this);
            std.debug.assert(value__.as(SHA384).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return SHA384__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of SHA384.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*SHA384) bool {
        JSC.markBinding(@src());
        return SHA384__dangerouslySetPtr(value, ptr);
    }

    extern fn SHA384__fromJS(JSC.JSValue) ?*SHA384;
    extern fn SHA384__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn SHA384__create(globalObject: *JSC.JSGlobalObject, ptr: ?*SHA384) JSC.JSValue;

    extern fn SHA384__dangerouslySetPtr(JSC.JSValue, ?*SHA384) bool;

    comptime {
        if (@TypeOf(SHA384.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*SHA384)) {
            @compileLog("SHA384.constructor is not a constructor");
        }

        if (@TypeOf(SHA384.finalize) != (fn (*SHA384) callconv(.C) void)) {
            @compileLog("SHA384.finalize is not a finalizer");
        }

        if (@TypeOf(SHA384.getByteLength) != GetterType)
            @compileLog("Expected SHA384.getByteLength to be a getter");

        if (@TypeOf(SHA384.digest) != CallbackType)
            @compileLog("Expected SHA384.digest to be a callback");
        if (@TypeOf(SHA384.update) != CallbackType)
            @compileLog("Expected SHA384.update to be a callback");
        if (@TypeOf(SHA384.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected SHA384.getByteLengthStatic to be a static getter");

        if (@TypeOf(SHA384.hash) != StaticCallbackType)
            @compileLog("Expected SHA384.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(SHA384.constructor, .{ .name = "SHA384Class__construct" });
            @export(SHA384.digest, .{ .name = "SHA384Prototype__digest" });
            @export(SHA384.finalize, .{ .name = "SHA384Class__finalize" });
            @export(SHA384.getByteLength, .{ .name = "SHA384Prototype__getByteLength" });
            @export(SHA384.getByteLengthStatic, .{ .name = "SHA384Class__getByteLengthStatic" });
            @export(SHA384.hash, .{ .name = "SHA384Class__hash" });
            @export(SHA384.update, .{ .name = "SHA384Prototype__update" });
        }
    }
};
pub const JSSHA256 = struct {
    const SHA256 = Classes.SHA256;
    const GetterType = fn (*SHA256, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*SHA256, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*SHA256, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*SHA256 {
        JSC.markBinding(@src());
        return SHA256__fromJS(value);
    }

    /// Get the SHA256 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return SHA256__getConstructor(globalObject);
    }

    /// Create a new instance of SHA256
    pub fn toJS(this: *SHA256, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = SHA256__create(globalObject, this);
            std.debug.assert(value__.as(SHA256).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return SHA256__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of SHA256.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*SHA256) bool {
        JSC.markBinding(@src());
        return SHA256__dangerouslySetPtr(value, ptr);
    }

    extern fn SHA256__fromJS(JSC.JSValue) ?*SHA256;
    extern fn SHA256__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn SHA256__create(globalObject: *JSC.JSGlobalObject, ptr: ?*SHA256) JSC.JSValue;

    extern fn SHA256__dangerouslySetPtr(JSC.JSValue, ?*SHA256) bool;

    comptime {
        if (@TypeOf(SHA256.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*SHA256)) {
            @compileLog("SHA256.constructor is not a constructor");
        }

        if (@TypeOf(SHA256.finalize) != (fn (*SHA256) callconv(.C) void)) {
            @compileLog("SHA256.finalize is not a finalizer");
        }

        if (@TypeOf(SHA256.getByteLength) != GetterType)
            @compileLog("Expected SHA256.getByteLength to be a getter");

        if (@TypeOf(SHA256.digest) != CallbackType)
            @compileLog("Expected SHA256.digest to be a callback");
        if (@TypeOf(SHA256.update) != CallbackType)
            @compileLog("Expected SHA256.update to be a callback");
        if (@TypeOf(SHA256.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected SHA256.getByteLengthStatic to be a static getter");

        if (@TypeOf(SHA256.hash) != StaticCallbackType)
            @compileLog("Expected SHA256.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(SHA256.constructor, .{ .name = "SHA256Class__construct" });
            @export(SHA256.digest, .{ .name = "SHA256Prototype__digest" });
            @export(SHA256.finalize, .{ .name = "SHA256Class__finalize" });
            @export(SHA256.getByteLength, .{ .name = "SHA256Prototype__getByteLength" });
            @export(SHA256.getByteLengthStatic, .{ .name = "SHA256Class__getByteLengthStatic" });
            @export(SHA256.hash, .{ .name = "SHA256Class__hash" });
            @export(SHA256.update, .{ .name = "SHA256Prototype__update" });
        }
    }
};
pub const JSSHA512_256 = struct {
    const SHA512_256 = Classes.SHA512_256;
    const GetterType = fn (*SHA512_256, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*SHA512_256, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*SHA512_256, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*SHA512_256 {
        JSC.markBinding(@src());
        return SHA512_256__fromJS(value);
    }

    /// Get the SHA512_256 constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return SHA512_256__getConstructor(globalObject);
    }

    /// Create a new instance of SHA512_256
    pub fn toJS(this: *SHA512_256, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = SHA512_256__create(globalObject, this);
            std.debug.assert(value__.as(SHA512_256).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return SHA512_256__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of SHA512_256.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*SHA512_256) bool {
        JSC.markBinding(@src());
        return SHA512_256__dangerouslySetPtr(value, ptr);
    }

    extern fn SHA512_256__fromJS(JSC.JSValue) ?*SHA512_256;
    extern fn SHA512_256__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn SHA512_256__create(globalObject: *JSC.JSGlobalObject, ptr: ?*SHA512_256) JSC.JSValue;

    extern fn SHA512_256__dangerouslySetPtr(JSC.JSValue, ?*SHA512_256) bool;

    comptime {
        if (@TypeOf(SHA512_256.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*SHA512_256)) {
            @compileLog("SHA512_256.constructor is not a constructor");
        }

        if (@TypeOf(SHA512_256.finalize) != (fn (*SHA512_256) callconv(.C) void)) {
            @compileLog("SHA512_256.finalize is not a finalizer");
        }

        if (@TypeOf(SHA512_256.getByteLength) != GetterType)
            @compileLog("Expected SHA512_256.getByteLength to be a getter");

        if (@TypeOf(SHA512_256.digest) != CallbackType)
            @compileLog("Expected SHA512_256.digest to be a callback");
        if (@TypeOf(SHA512_256.update) != CallbackType)
            @compileLog("Expected SHA512_256.update to be a callback");
        if (@TypeOf(SHA512_256.getByteLengthStatic) != StaticGetterType)
            @compileLog("Expected SHA512_256.getByteLengthStatic to be a static getter");

        if (@TypeOf(SHA512_256.hash) != StaticCallbackType)
            @compileLog("Expected SHA512_256.hash to be a static callback");
        if (!JSC.is_bindgen) {
            @export(SHA512_256.constructor, .{ .name = "SHA512_256Class__construct" });
            @export(SHA512_256.digest, .{ .name = "SHA512_256Prototype__digest" });
            @export(SHA512_256.finalize, .{ .name = "SHA512_256Class__finalize" });
            @export(SHA512_256.getByteLength, .{ .name = "SHA512_256Prototype__getByteLength" });
            @export(SHA512_256.getByteLengthStatic, .{ .name = "SHA512_256Class__getByteLengthStatic" });
            @export(SHA512_256.hash, .{ .name = "SHA512_256Class__hash" });
            @export(SHA512_256.update, .{ .name = "SHA512_256Prototype__update" });
        }
    }
};
pub const JSServerWebSocket = struct {
    const ServerWebSocket = Classes.ServerWebSocket;
    const GetterType = fn (*ServerWebSocket, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*ServerWebSocket, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*ServerWebSocket, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*ServerWebSocket {
        JSC.markBinding(@src());
        return ServerWebSocket__fromJS(value);
    }

    extern fn ServerWebSocketPrototype__dataSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for data on ServerWebSocket
    /// This value will be visited by the garbage collector.
    pub fn dataSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        ServerWebSocketPrototype__dataSetCachedValue(thisValue, globalObject, value);
    }

    extern fn ServerWebSocketPrototype__remoteAddressSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for remoteAddress on ServerWebSocket
    /// This value will be visited by the garbage collector.
    pub fn remoteAddressSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        ServerWebSocketPrototype__remoteAddressSetCachedValue(thisValue, globalObject, value);
    }

    /// Get the ServerWebSocket constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return ServerWebSocket__getConstructor(globalObject);
    }

    /// Create a new instance of ServerWebSocket
    pub fn toJS(this: *ServerWebSocket, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = ServerWebSocket__create(globalObject, this);
            std.debug.assert(value__.as(ServerWebSocket).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return ServerWebSocket__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of ServerWebSocket.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*ServerWebSocket) bool {
        JSC.markBinding(@src());
        return ServerWebSocket__dangerouslySetPtr(value, ptr);
    }

    extern fn ServerWebSocket__fromJS(JSC.JSValue) ?*ServerWebSocket;
    extern fn ServerWebSocket__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn ServerWebSocket__create(globalObject: *JSC.JSGlobalObject, ptr: ?*ServerWebSocket) JSC.JSValue;

    extern fn ServerWebSocket__dangerouslySetPtr(JSC.JSValue, ?*ServerWebSocket) bool;

    comptime {
        if (@TypeOf(ServerWebSocket.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*ServerWebSocket)) {
            @compileLog("ServerWebSocket.constructor is not a constructor");
        }

        if (@TypeOf(ServerWebSocket.finalize) != (fn (*ServerWebSocket) callconv(.C) void)) {
            @compileLog("ServerWebSocket.finalize is not a finalizer");
        }

        if (@TypeOf(ServerWebSocket.getBinaryType) != GetterType)
            @compileLog("Expected ServerWebSocket.getBinaryType to be a getter");

        if (@TypeOf(ServerWebSocket.setBinaryType) != SetterType)
            @compileLog("Expected ServerWebSocket.setBinaryType to be a setter");
        if (@TypeOf(ServerWebSocket.close) != CallbackType)
            @compileLog("Expected ServerWebSocket.close to be a callback");
        if (@TypeOf(ServerWebSocket.cork) != CallbackType)
            @compileLog("Expected ServerWebSocket.cork to be a callback");
        if (@TypeOf(ServerWebSocket.getData) != GetterType)
            @compileLog("Expected ServerWebSocket.getData to be a getter");

        if (@TypeOf(ServerWebSocket.setData) != SetterType)
            @compileLog("Expected ServerWebSocket.setData to be a setter");
        if (@TypeOf(ServerWebSocket.getBufferedAmount) != CallbackType)
            @compileLog("Expected ServerWebSocket.getBufferedAmount to be a callback");
        if (@TypeOf(ServerWebSocket.isSubscribed) != CallbackType)
            @compileLog("Expected ServerWebSocket.isSubscribed to be a callback");
        if (@TypeOf(ServerWebSocket.publish) != CallbackType)
            @compileLog("Expected ServerWebSocket.publish to be a callback");
        if (@TypeOf(ServerWebSocket.publishBinaryWithoutTypeChecks) != fn (*ServerWebSocket, *JSC.JSGlobalObject, *JSC.JSString, *JSC.JSUint8Array) callconv(.C) JSC.JSValue)
            @compileLog("Expected ServerWebSocket.publishBinaryWithoutTypeChecks to be a DOMJIT function");
        if (@TypeOf(ServerWebSocket.publishBinary) != CallbackType)
            @compileLog("Expected ServerWebSocket.publishBinary to be a callback");
        if (@TypeOf(ServerWebSocket.publishTextWithoutTypeChecks) != fn (*ServerWebSocket, *JSC.JSGlobalObject, *JSC.JSString, *JSC.JSString) callconv(.C) JSC.JSValue)
            @compileLog("Expected ServerWebSocket.publishTextWithoutTypeChecks to be a DOMJIT function");
        if (@TypeOf(ServerWebSocket.publishText) != CallbackType)
            @compileLog("Expected ServerWebSocket.publishText to be a callback");
        if (@TypeOf(ServerWebSocket.getReadyState) != GetterType)
            @compileLog("Expected ServerWebSocket.getReadyState to be a getter");

        if (@TypeOf(ServerWebSocket.getRemoteAddress) != GetterType)
            @compileLog("Expected ServerWebSocket.getRemoteAddress to be a getter");

        if (@TypeOf(ServerWebSocket.send) != CallbackType)
            @compileLog("Expected ServerWebSocket.send to be a callback");
        if (@TypeOf(ServerWebSocket.sendBinaryWithoutTypeChecks) != fn (*ServerWebSocket, *JSC.JSGlobalObject, *JSC.JSUint8Array, bool) callconv(.C) JSC.JSValue)
            @compileLog("Expected ServerWebSocket.sendBinaryWithoutTypeChecks to be a DOMJIT function");
        if (@TypeOf(ServerWebSocket.sendBinary) != CallbackType)
            @compileLog("Expected ServerWebSocket.sendBinary to be a callback");
        if (@TypeOf(ServerWebSocket.sendTextWithoutTypeChecks) != fn (*ServerWebSocket, *JSC.JSGlobalObject, *JSC.JSString, bool) callconv(.C) JSC.JSValue)
            @compileLog("Expected ServerWebSocket.sendTextWithoutTypeChecks to be a DOMJIT function");
        if (@TypeOf(ServerWebSocket.sendText) != CallbackType)
            @compileLog("Expected ServerWebSocket.sendText to be a callback");
        if (@TypeOf(ServerWebSocket.subscribe) != CallbackType)
            @compileLog("Expected ServerWebSocket.subscribe to be a callback");
        if (@TypeOf(ServerWebSocket.unsubscribe) != CallbackType)
            @compileLog("Expected ServerWebSocket.unsubscribe to be a callback");
        if (!JSC.is_bindgen) {
            @export(ServerWebSocket.close, .{ .name = "ServerWebSocketPrototype__close" });
            @export(ServerWebSocket.constructor, .{ .name = "ServerWebSocketClass__construct" });
            @export(ServerWebSocket.cork, .{ .name = "ServerWebSocketPrototype__cork" });
            @export(ServerWebSocket.finalize, .{ .name = "ServerWebSocketClass__finalize" });
            @export(ServerWebSocket.getBinaryType, .{ .name = "ServerWebSocketPrototype__getBinaryType" });
            @export(ServerWebSocket.getBufferedAmount, .{ .name = "ServerWebSocketPrototype__getBufferedAmount" });
            @export(ServerWebSocket.getData, .{ .name = "ServerWebSocketPrototype__getData" });
            @export(ServerWebSocket.getReadyState, .{ .name = "ServerWebSocketPrototype__getReadyState" });
            @export(ServerWebSocket.getRemoteAddress, .{ .name = "ServerWebSocketPrototype__getRemoteAddress" });
            @export(ServerWebSocket.isSubscribed, .{ .name = "ServerWebSocketPrototype__isSubscribed" });
            @export(ServerWebSocket.publish, .{ .name = "ServerWebSocketPrototype__publish" });
            @export(ServerWebSocket.publishBinary, .{ .name = "ServerWebSocketPrototype__publishBinary" });
            @export(ServerWebSocket.publishBinaryWithoutTypeChecks, .{ .name = "ServerWebSocketPrototype__publishBinaryWithoutTypeChecks" });
            @export(ServerWebSocket.publishText, .{ .name = "ServerWebSocketPrototype__publishText" });
            @export(ServerWebSocket.publishTextWithoutTypeChecks, .{ .name = "ServerWebSocketPrototype__publishTextWithoutTypeChecks" });
            @export(ServerWebSocket.send, .{ .name = "ServerWebSocketPrototype__send" });
            @export(ServerWebSocket.sendBinary, .{ .name = "ServerWebSocketPrototype__sendBinary" });
            @export(ServerWebSocket.sendBinaryWithoutTypeChecks, .{ .name = "ServerWebSocketPrototype__sendBinaryWithoutTypeChecks" });
            @export(ServerWebSocket.sendText, .{ .name = "ServerWebSocketPrototype__sendText" });
            @export(ServerWebSocket.sendTextWithoutTypeChecks, .{ .name = "ServerWebSocketPrototype__sendTextWithoutTypeChecks" });
            @export(ServerWebSocket.setBinaryType, .{ .name = "ServerWebSocketPrototype__setBinaryType" });
            @export(ServerWebSocket.setData, .{ .name = "ServerWebSocketPrototype__setData" });
            @export(ServerWebSocket.subscribe, .{ .name = "ServerWebSocketPrototype__subscribe" });
            @export(ServerWebSocket.unsubscribe, .{ .name = "ServerWebSocketPrototype__unsubscribe" });
        }
    }
};
pub const JSTextDecoder = struct {
    const TextDecoder = Classes.TextDecoder;
    const GetterType = fn (*TextDecoder, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*TextDecoder, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*TextDecoder, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*TextDecoder {
        JSC.markBinding(@src());
        return TextDecoder__fromJS(value);
    }

    extern fn TextDecoderPrototype__encodingSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for encoding on TextDecoder
    /// This value will be visited by the garbage collector.
    pub fn encodingSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        TextDecoderPrototype__encodingSetCachedValue(thisValue, globalObject, value);
    }

    /// Get the TextDecoder constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return TextDecoder__getConstructor(globalObject);
    }

    /// Create a new instance of TextDecoder
    pub fn toJS(this: *TextDecoder, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = TextDecoder__create(globalObject, this);
            std.debug.assert(value__.as(TextDecoder).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return TextDecoder__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of TextDecoder.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*TextDecoder) bool {
        JSC.markBinding(@src());
        return TextDecoder__dangerouslySetPtr(value, ptr);
    }

    extern fn TextDecoder__fromJS(JSC.JSValue) ?*TextDecoder;
    extern fn TextDecoder__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn TextDecoder__create(globalObject: *JSC.JSGlobalObject, ptr: ?*TextDecoder) JSC.JSValue;

    extern fn TextDecoder__dangerouslySetPtr(JSC.JSValue, ?*TextDecoder) bool;

    comptime {
        if (@TypeOf(TextDecoder.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*TextDecoder)) {
            @compileLog("TextDecoder.constructor is not a constructor");
        }

        if (@TypeOf(TextDecoder.finalize) != (fn (*TextDecoder) callconv(.C) void)) {
            @compileLog("TextDecoder.finalize is not a finalizer");
        }

        if (@TypeOf(TextDecoder.decode) != CallbackType)
            @compileLog("Expected TextDecoder.decode to be a callback");
        if (@TypeOf(TextDecoder.getEncoding) != GetterType)
            @compileLog("Expected TextDecoder.getEncoding to be a getter");

        if (@TypeOf(TextDecoder.getFatal) != GetterType)
            @compileLog("Expected TextDecoder.getFatal to be a getter");

        if (!JSC.is_bindgen) {
            @export(TextDecoder.constructor, .{ .name = "TextDecoderClass__construct" });
            @export(TextDecoder.decode, .{ .name = "TextDecoderPrototype__decode" });
            @export(TextDecoder.finalize, .{ .name = "TextDecoderClass__finalize" });
            @export(TextDecoder.getEncoding, .{ .name = "TextDecoderPrototype__getEncoding" });
            @export(TextDecoder.getFatal, .{ .name = "TextDecoderPrototype__getFatal" });
        }
    }
};
pub const JSRequest = struct {
    const Request = Classes.Request;
    const GetterType = fn (*Request, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*Request, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*Request, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*Request {
        JSC.markBinding(@src());
        return Request__fromJS(value);
    }

    extern fn RequestPrototype__bodySetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for body on Request
    /// This value will be visited by the garbage collector.
    pub fn bodySetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        RequestPrototype__bodySetCachedValue(thisValue, globalObject, value);
    }

    extern fn RequestPrototype__headersSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for headers on Request
    /// This value will be visited by the garbage collector.
    pub fn headersSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        RequestPrototype__headersSetCachedValue(thisValue, globalObject, value);
    }

    extern fn RequestPrototype__urlSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for url on Request
    /// This value will be visited by the garbage collector.
    pub fn urlSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        RequestPrototype__urlSetCachedValue(thisValue, globalObject, value);
    }

    /// Get the Request constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return Request__getConstructor(globalObject);
    }

    /// Create a new instance of Request
    pub fn toJS(this: *Request, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = Request__create(globalObject, this);
            std.debug.assert(value__.as(Request).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return Request__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of Request.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*Request) bool {
        JSC.markBinding(@src());
        return Request__dangerouslySetPtr(value, ptr);
    }

    extern fn Request__fromJS(JSC.JSValue) ?*Request;
    extern fn Request__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn Request__create(globalObject: *JSC.JSGlobalObject, ptr: ?*Request) JSC.JSValue;

    extern fn Request__dangerouslySetPtr(JSC.JSValue, ?*Request) bool;

    comptime {
        if (@TypeOf(Request.estimatedSize) != (fn (*Request) callconv(.C) usize)) {
            @compileLog("Request.estimatedSize is not a size function");
        }

        if (@TypeOf(Request.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*Request)) {
            @compileLog("Request.constructor is not a constructor");
        }

        if (@TypeOf(Request.finalize) != (fn (*Request) callconv(.C) void)) {
            @compileLog("Request.finalize is not a finalizer");
        }

        if (@TypeOf(Request.getArrayBuffer) != CallbackType)
            @compileLog("Expected Request.getArrayBuffer to be a callback");
        if (@TypeOf(Request.getBlob) != CallbackType)
            @compileLog("Expected Request.getBlob to be a callback");
        if (@TypeOf(Request.getBody) != GetterType)
            @compileLog("Expected Request.getBody to be a getter");

        if (@TypeOf(Request.getBodyUsed) != GetterType)
            @compileLog("Expected Request.getBodyUsed to be a getter");

        if (@TypeOf(Request.getCache) != GetterType)
            @compileLog("Expected Request.getCache to be a getter");

        if (@TypeOf(Request.doClone) != CallbackType)
            @compileLog("Expected Request.doClone to be a callback");
        if (@TypeOf(Request.getCredentials) != GetterType)
            @compileLog("Expected Request.getCredentials to be a getter");

        if (@TypeOf(Request.getDestination) != GetterType)
            @compileLog("Expected Request.getDestination to be a getter");

        if (@TypeOf(Request.getHeaders) != GetterType)
            @compileLog("Expected Request.getHeaders to be a getter");

        if (@TypeOf(Request.getIntegrity) != GetterType)
            @compileLog("Expected Request.getIntegrity to be a getter");

        if (@TypeOf(Request.getJSON) != CallbackType)
            @compileLog("Expected Request.getJSON to be a callback");
        if (@TypeOf(Request.getMethod) != GetterType)
            @compileLog("Expected Request.getMethod to be a getter");

        if (@TypeOf(Request.getMode) != GetterType)
            @compileLog("Expected Request.getMode to be a getter");

        if (@TypeOf(Request.getRedirect) != GetterType)
            @compileLog("Expected Request.getRedirect to be a getter");

        if (@TypeOf(Request.getReferrer) != GetterType)
            @compileLog("Expected Request.getReferrer to be a getter");

        if (@TypeOf(Request.getReferrerPolicy) != GetterType)
            @compileLog("Expected Request.getReferrerPolicy to be a getter");

        if (@TypeOf(Request.getText) != CallbackType)
            @compileLog("Expected Request.getText to be a callback");
        if (@TypeOf(Request.getUrl) != GetterType)
            @compileLog("Expected Request.getUrl to be a getter");

        if (!JSC.is_bindgen) {
            @export(Request.constructor, .{ .name = "RequestClass__construct" });
            @export(Request.doClone, .{ .name = "RequestPrototype__doClone" });
            @export(Request.estimatedSize, .{ .name = "Request__estimatedSize" });
            @export(Request.finalize, .{ .name = "RequestClass__finalize" });
            @export(Request.getArrayBuffer, .{ .name = "RequestPrototype__getArrayBuffer" });
            @export(Request.getBlob, .{ .name = "RequestPrototype__getBlob" });
            @export(Request.getBody, .{ .name = "RequestPrototype__getBody" });
            @export(Request.getBodyUsed, .{ .name = "RequestPrototype__getBodyUsed" });
            @export(Request.getCache, .{ .name = "RequestPrototype__getCache" });
            @export(Request.getCredentials, .{ .name = "RequestPrototype__getCredentials" });
            @export(Request.getDestination, .{ .name = "RequestPrototype__getDestination" });
            @export(Request.getHeaders, .{ .name = "RequestPrototype__getHeaders" });
            @export(Request.getIntegrity, .{ .name = "RequestPrototype__getIntegrity" });
            @export(Request.getJSON, .{ .name = "RequestPrototype__getJSON" });
            @export(Request.getMethod, .{ .name = "RequestPrototype__getMethod" });
            @export(Request.getMode, .{ .name = "RequestPrototype__getMode" });
            @export(Request.getRedirect, .{ .name = "RequestPrototype__getRedirect" });
            @export(Request.getReferrer, .{ .name = "RequestPrototype__getReferrer" });
            @export(Request.getReferrerPolicy, .{ .name = "RequestPrototype__getReferrerPolicy" });
            @export(Request.getText, .{ .name = "RequestPrototype__getText" });
            @export(Request.getUrl, .{ .name = "RequestPrototype__getUrl" });
        }
    }
};
pub const JSResponse = struct {
    const Response = Classes.Response;
    const GetterType = fn (*Response, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*Response, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*Response, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*Response {
        JSC.markBinding(@src());
        return Response__fromJS(value);
    }

    extern fn ResponsePrototype__bodySetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for body on Response
    /// This value will be visited by the garbage collector.
    pub fn bodySetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        ResponsePrototype__bodySetCachedValue(thisValue, globalObject, value);
    }

    extern fn ResponsePrototype__headersSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for headers on Response
    /// This value will be visited by the garbage collector.
    pub fn headersSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        ResponsePrototype__headersSetCachedValue(thisValue, globalObject, value);
    }

    extern fn ResponsePrototype__statusTextSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for statusText on Response
    /// This value will be visited by the garbage collector.
    pub fn statusTextSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        ResponsePrototype__statusTextSetCachedValue(thisValue, globalObject, value);
    }

    extern fn ResponsePrototype__urlSetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

    /// Set the cached value for url on Response
    /// This value will be visited by the garbage collector.
    pub fn urlSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        ResponsePrototype__urlSetCachedValue(thisValue, globalObject, value);
    }

    /// Get the Response constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return Response__getConstructor(globalObject);
    }

    /// Create a new instance of Response
    pub fn toJS(this: *Response, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = Response__create(globalObject, this);
            std.debug.assert(value__.as(Response).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return Response__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of Response.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*Response) bool {
        JSC.markBinding(@src());
        return Response__dangerouslySetPtr(value, ptr);
    }

    extern fn Response__fromJS(JSC.JSValue) ?*Response;
    extern fn Response__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn Response__create(globalObject: *JSC.JSGlobalObject, ptr: ?*Response) JSC.JSValue;

    extern fn Response__dangerouslySetPtr(JSC.JSValue, ?*Response) bool;

    comptime {
        if (@TypeOf(Response.estimatedSize) != (fn (*Response) callconv(.C) usize)) {
            @compileLog("Response.estimatedSize is not a size function");
        }

        if (@TypeOf(Response.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*Response)) {
            @compileLog("Response.constructor is not a constructor");
        }

        if (@TypeOf(Response.finalize) != (fn (*Response) callconv(.C) void)) {
            @compileLog("Response.finalize is not a finalizer");
        }

        if (@TypeOf(Response.getArrayBuffer) != CallbackType)
            @compileLog("Expected Response.getArrayBuffer to be a callback");
        if (@TypeOf(Response.getBlob) != CallbackType)
            @compileLog("Expected Response.getBlob to be a callback");
        if (@TypeOf(Response.getBody) != GetterType)
            @compileLog("Expected Response.getBody to be a getter");

        if (@TypeOf(Response.getBodyUsed) != GetterType)
            @compileLog("Expected Response.getBodyUsed to be a getter");

        if (@TypeOf(Response.doClone) != CallbackType)
            @compileLog("Expected Response.doClone to be a callback");
        if (@TypeOf(Response.getHeaders) != GetterType)
            @compileLog("Expected Response.getHeaders to be a getter");

        if (@TypeOf(Response.getJSON) != CallbackType)
            @compileLog("Expected Response.getJSON to be a callback");
        if (@TypeOf(Response.getOK) != GetterType)
            @compileLog("Expected Response.getOK to be a getter");

        if (@TypeOf(Response.getRedirected) != GetterType)
            @compileLog("Expected Response.getRedirected to be a getter");

        if (@TypeOf(Response.getStatus) != GetterType)
            @compileLog("Expected Response.getStatus to be a getter");

        if (@TypeOf(Response.getStatusText) != GetterType)
            @compileLog("Expected Response.getStatusText to be a getter");

        if (@TypeOf(Response.getText) != CallbackType)
            @compileLog("Expected Response.getText to be a callback");
        if (@TypeOf(Response.getResponseType) != GetterType)
            @compileLog("Expected Response.getResponseType to be a getter");

        if (@TypeOf(Response.getURL) != GetterType)
            @compileLog("Expected Response.getURL to be a getter");

        if (@TypeOf(Response.constructError) != StaticCallbackType)
            @compileLog("Expected Response.constructError to be a static callback");
        if (@TypeOf(Response.constructJSON) != StaticCallbackType)
            @compileLog("Expected Response.constructJSON to be a static callback");
        if (@TypeOf(Response.constructRedirect) != StaticCallbackType)
            @compileLog("Expected Response.constructRedirect to be a static callback");
        if (!JSC.is_bindgen) {
            @export(Response.constructError, .{ .name = "ResponseClass__constructError" });
            @export(Response.constructJSON, .{ .name = "ResponseClass__constructJSON" });
            @export(Response.constructor, .{ .name = "ResponseClass__construct" });
            @export(Response.constructRedirect, .{ .name = "ResponseClass__constructRedirect" });
            @export(Response.doClone, .{ .name = "ResponsePrototype__doClone" });
            @export(Response.estimatedSize, .{ .name = "Response__estimatedSize" });
            @export(Response.finalize, .{ .name = "ResponseClass__finalize" });
            @export(Response.getArrayBuffer, .{ .name = "ResponsePrototype__getArrayBuffer" });
            @export(Response.getBlob, .{ .name = "ResponsePrototype__getBlob" });
            @export(Response.getBody, .{ .name = "ResponsePrototype__getBody" });
            @export(Response.getBodyUsed, .{ .name = "ResponsePrototype__getBodyUsed" });
            @export(Response.getHeaders, .{ .name = "ResponsePrototype__getHeaders" });
            @export(Response.getJSON, .{ .name = "ResponsePrototype__getJSON" });
            @export(Response.getOK, .{ .name = "ResponsePrototype__getOK" });
            @export(Response.getRedirected, .{ .name = "ResponsePrototype__getRedirected" });
            @export(Response.getResponseType, .{ .name = "ResponsePrototype__getResponseType" });
            @export(Response.getStatus, .{ .name = "ResponsePrototype__getStatus" });
            @export(Response.getStatusText, .{ .name = "ResponsePrototype__getStatusText" });
            @export(Response.getText, .{ .name = "ResponsePrototype__getText" });
            @export(Response.getURL, .{ .name = "ResponsePrototype__getURL" });
        }
    }
};
pub const JSBlob = struct {
    const Blob = Classes.Blob;
    const GetterType = fn (*Blob, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn (*Blob, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn (*Blob, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*Blob {
        JSC.markBinding(@src());
        return Blob__fromJS(value);
    }

    /// Get the Blob constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return Blob__getConstructor(globalObject);
    }

    /// Create a new instance of Blob
    pub fn toJS(this: *Blob, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = Blob__create(globalObject, this);
            std.debug.assert(value__.as(Blob).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return Blob__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of Blob.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*Blob) bool {
        JSC.markBinding(@src());
        return Blob__dangerouslySetPtr(value, ptr);
    }

    extern fn Blob__fromJS(JSC.JSValue) ?*Blob;
    extern fn Blob__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn Blob__create(globalObject: *JSC.JSGlobalObject, ptr: ?*Blob) JSC.JSValue;

    extern fn Blob__dangerouslySetPtr(JSC.JSValue, ?*Blob) bool;

    comptime {
        if (@TypeOf(Blob.constructor) != (fn (*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*Blob)) {
            @compileLog("Blob.constructor is not a constructor");
        }

        if (@TypeOf(Blob.finalize) != (fn (*Blob) callconv(.C) void)) {
            @compileLog("Blob.finalize is not a finalizer");
        }

        if (@TypeOf(Blob.getArrayBuffer) != CallbackType)
            @compileLog("Expected Blob.getArrayBuffer to be a callback");
        if (@TypeOf(Blob.getJSON) != CallbackType)
            @compileLog("Expected Blob.getJSON to be a callback");
        if (@TypeOf(Blob.getSize) != GetterType)
            @compileLog("Expected Blob.getSize to be a getter");

        if (@TypeOf(Blob.getSlice) != CallbackType)
            @compileLog("Expected Blob.getSlice to be a callback");
        if (@TypeOf(Blob.getStream) != CallbackType)
            @compileLog("Expected Blob.getStream to be a callback");
        if (@TypeOf(Blob.getText) != CallbackType)
            @compileLog("Expected Blob.getText to be a callback");
        if (@TypeOf(Blob.getType) != GetterType)
            @compileLog("Expected Blob.getType to be a getter");

        if (@TypeOf(Blob.setType) != SetterType)
            @compileLog("Expected Blob.setType to be a setter");
        if (@TypeOf(Blob.getWriter) != CallbackType)
            @compileLog("Expected Blob.getWriter to be a callback");
        if (!JSC.is_bindgen) {
            @export(Blob.constructor, .{ .name = "BlobClass__construct" });
            @export(Blob.finalize, .{ .name = "BlobClass__finalize" });
            @export(Blob.getArrayBuffer, .{ .name = "BlobPrototype__getArrayBuffer" });
            @export(Blob.getJSON, .{ .name = "BlobPrototype__getJSON" });
            @export(Blob.getSize, .{ .name = "BlobPrototype__getSize" });
            @export(Blob.getSlice, .{ .name = "BlobPrototype__getSlice" });
            @export(Blob.getStream, .{ .name = "BlobPrototype__getStream" });
            @export(Blob.getText, .{ .name = "BlobPrototype__getText" });
            @export(Blob.getType, .{ .name = "BlobPrototype__getType" });
            @export(Blob.getWriter, .{ .name = "BlobPrototype__getWriter" });
            @export(Blob.setType, .{ .name = "BlobPrototype__setType" });
        }
    }
};

comptime {
    _ = JSTCPSocket;
    _ = JSTLSSocket;
    _ = JSListener;
    _ = JSSubprocess;
    _ = JSSHA1;
    _ = JSMD5;
    _ = JSMD4;
    _ = JSSHA224;
    _ = JSSHA512;
    _ = JSSHA384;
    _ = JSSHA256;
    _ = JSSHA512_256;
    _ = JSServerWebSocket;
    _ = JSTextDecoder;
    _ = JSRequest;
    _ = JSResponse;
    _ = JSBlob;
}
