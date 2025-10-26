const bun = @import("bun");
const jsc = bun.jsc;

pub const JSWebSocketServerContext = opaque {
    pub fn create(
        globalObject: *jsc.JSGlobalObject,
        onOpen: jsc.JSValue,
        onMessage: jsc.JSValue,
        onClose: jsc.JSValue,
        onDrain: jsc.JSValue,
        onError: jsc.JSValue,
        onPing: jsc.JSValue,
        onPong: jsc.JSValue,
        server: jsc.JSValue,
        app: ?*anyopaque,
        vm: *jsc.VirtualMachine,
        ssl: bool,
        publishToSelf: bool,
    ) jsc.JSValue {
        return Bun__JSWebSocketServerContext__create(
            globalObject,
            onOpen,
            onMessage,
            onClose,
            onDrain,
            onError,
            onPing,
            onPong,
            server,
            app,
            vm,
            ssl,
            publishToSelf,
        );
    }

    pub fn fromJS(value: jsc.JSValue) ?*JSWebSocketServerContext {
        return Bun__JSWebSocketServerContext__fromJS(value);
    }

    pub fn setOnOpen(this: *JSWebSocketServerContext, globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
        Bun__JSWebSocketServerContext__setOnOpen(this, globalObject, value);
    }

    pub fn setOnMessage(this: *JSWebSocketServerContext, globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
        Bun__JSWebSocketServerContext__setOnMessage(this, globalObject, value);
    }

    pub fn setOnClose(this: *JSWebSocketServerContext, globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
        Bun__JSWebSocketServerContext__setOnClose(this, globalObject, value);
    }

    pub fn setOnDrain(this: *JSWebSocketServerContext, globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
        Bun__JSWebSocketServerContext__setOnDrain(this, globalObject, value);
    }

    pub fn setOnError(this: *JSWebSocketServerContext, globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
        Bun__JSWebSocketServerContext__setOnError(this, globalObject, value);
    }

    pub fn setOnPing(this: *JSWebSocketServerContext, globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
        Bun__JSWebSocketServerContext__setOnPing(this, globalObject, value);
    }

    pub fn setOnPong(this: *JSWebSocketServerContext, globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
        Bun__JSWebSocketServerContext__setOnPong(this, globalObject, value);
    }

    pub fn setServer(this: *JSWebSocketServerContext, globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
        Bun__JSWebSocketServerContext__setServer(this, globalObject, value);
    }

    pub fn getOnOpen(this: *JSWebSocketServerContext) jsc.JSValue {
        return Bun__JSWebSocketServerContext__getOnOpen(this);
    }

    pub fn getOnMessage(this: *JSWebSocketServerContext) jsc.JSValue {
        return Bun__JSWebSocketServerContext__getOnMessage(this);
    }

    pub fn getOnClose(this: *JSWebSocketServerContext) jsc.JSValue {
        return Bun__JSWebSocketServerContext__getOnClose(this);
    }

    pub fn getOnDrain(this: *JSWebSocketServerContext) jsc.JSValue {
        return Bun__JSWebSocketServerContext__getOnDrain(this);
    }

    pub fn getOnError(this: *JSWebSocketServerContext) jsc.JSValue {
        return Bun__JSWebSocketServerContext__getOnError(this);
    }

    pub fn getOnPing(this: *JSWebSocketServerContext) jsc.JSValue {
        return Bun__JSWebSocketServerContext__getOnPing(this);
    }

    pub fn getOnPong(this: *JSWebSocketServerContext) jsc.JSValue {
        return Bun__JSWebSocketServerContext__getOnPong(this);
    }

    pub fn getServer(this: *JSWebSocketServerContext) jsc.JSValue {
        return Bun__JSWebSocketServerContext__getServer(this);
    }

    pub fn setApp(this: *JSWebSocketServerContext, app: ?*anyopaque) void {
        Bun__JSWebSocketServerContext__setApp(this, app);
    }

    pub fn getApp(this: *JSWebSocketServerContext) ?*anyopaque {
        return Bun__JSWebSocketServerContext__getApp(this);
    }

    pub fn setVM(this: *JSWebSocketServerContext, vm: *jsc.VirtualMachine) void {
        Bun__JSWebSocketServerContext__setVM(this, vm);
    }

    pub fn getVM(this: *JSWebSocketServerContext) *jsc.VirtualMachine {
        return @ptrCast(@alignCast(Bun__JSWebSocketServerContext__getVM(this)));
    }

    pub fn setSSL(this: *JSWebSocketServerContext, ssl: bool) void {
        Bun__JSWebSocketServerContext__setSSL(this, ssl);
    }

    pub fn getSSL(this: *JSWebSocketServerContext) bool {
        return Bun__JSWebSocketServerContext__getSSL(this);
    }

    pub fn setPublishToSelf(this: *JSWebSocketServerContext, publish_to_self: bool) void {
        Bun__JSWebSocketServerContext__setPublishToSelf(this, publish_to_self);
    }

    pub fn getPublishToSelf(this: *JSWebSocketServerContext) bool {
        return Bun__JSWebSocketServerContext__getPublishToSelf(this);
    }

    pub fn getActiveConnections(this: *JSWebSocketServerContext) usize {
        return Bun__JSWebSocketServerContext__getActiveConnections(this);
    }

    pub fn incrementActiveConnections(this: *JSWebSocketServerContext) void {
        Bun__JSWebSocketServerContext__incrementActiveConnections(this);
    }

    pub fn decrementActiveConnections(this: *JSWebSocketServerContext) void {
        Bun__JSWebSocketServerContext__decrementActiveConnections(this);
    }
};

extern "C" fn Bun__JSWebSocketServerContext__create(
    *jsc.JSGlobalObject,
    jsc.JSValue, // onOpen
    jsc.JSValue, // onMessage
    jsc.JSValue, // onClose
    jsc.JSValue, // onDrain
    jsc.JSValue, // onError
    jsc.JSValue, // onPing
    jsc.JSValue, // onPong
    jsc.JSValue, // server
    ?*anyopaque, // app
    *jsc.VirtualMachine, // vm
    bool, // ssl
    bool, // publishToSelf
) jsc.JSValue;
extern "C" fn Bun__JSWebSocketServerContext__fromJS(jsc.JSValue) ?*JSWebSocketServerContext;
extern "C" fn Bun__JSWebSocketServerContext__setOnOpen(*JSWebSocketServerContext, *jsc.JSGlobalObject, jsc.JSValue) void;
extern "C" fn Bun__JSWebSocketServerContext__setOnMessage(*JSWebSocketServerContext, *jsc.JSGlobalObject, jsc.JSValue) void;
extern "C" fn Bun__JSWebSocketServerContext__setOnClose(*JSWebSocketServerContext, *jsc.JSGlobalObject, jsc.JSValue) void;
extern "C" fn Bun__JSWebSocketServerContext__setOnDrain(*JSWebSocketServerContext, *jsc.JSGlobalObject, jsc.JSValue) void;
extern "C" fn Bun__JSWebSocketServerContext__setOnError(*JSWebSocketServerContext, *jsc.JSGlobalObject, jsc.JSValue) void;
extern "C" fn Bun__JSWebSocketServerContext__setOnPing(*JSWebSocketServerContext, *jsc.JSGlobalObject, jsc.JSValue) void;
extern "C" fn Bun__JSWebSocketServerContext__setOnPong(*JSWebSocketServerContext, *jsc.JSGlobalObject, jsc.JSValue) void;
extern "C" fn Bun__JSWebSocketServerContext__setServer(*JSWebSocketServerContext, *jsc.JSGlobalObject, jsc.JSValue) void;
extern "C" fn Bun__JSWebSocketServerContext__getOnOpen(*JSWebSocketServerContext) jsc.JSValue;
extern "C" fn Bun__JSWebSocketServerContext__getOnMessage(*JSWebSocketServerContext) jsc.JSValue;
extern "C" fn Bun__JSWebSocketServerContext__getOnClose(*JSWebSocketServerContext) jsc.JSValue;
extern "C" fn Bun__JSWebSocketServerContext__getOnDrain(*JSWebSocketServerContext) jsc.JSValue;
extern "C" fn Bun__JSWebSocketServerContext__getOnError(*JSWebSocketServerContext) jsc.JSValue;
extern "C" fn Bun__JSWebSocketServerContext__getOnPing(*JSWebSocketServerContext) jsc.JSValue;
extern "C" fn Bun__JSWebSocketServerContext__getOnPong(*JSWebSocketServerContext) jsc.JSValue;
extern "C" fn Bun__JSWebSocketServerContext__getServer(*JSWebSocketServerContext) jsc.JSValue;
extern "C" fn Bun__JSWebSocketServerContext__setApp(*JSWebSocketServerContext, ?*anyopaque) void;
extern "C" fn Bun__JSWebSocketServerContext__getApp(*JSWebSocketServerContext) ?*anyopaque;
extern "C" fn Bun__JSWebSocketServerContext__setVM(*JSWebSocketServerContext, *jsc.VirtualMachine) void;
extern "C" fn Bun__JSWebSocketServerContext__getVM(*JSWebSocketServerContext) *anyopaque;
extern "C" fn Bun__JSWebSocketServerContext__setSSL(*JSWebSocketServerContext, bool) void;
extern "C" fn Bun__JSWebSocketServerContext__getSSL(*JSWebSocketServerContext) bool;
extern "C" fn Bun__JSWebSocketServerContext__setPublishToSelf(*JSWebSocketServerContext, bool) void;
extern "C" fn Bun__JSWebSocketServerContext__getPublishToSelf(*JSWebSocketServerContext) bool;
extern "C" fn Bun__JSWebSocketServerContext__getActiveConnections(*JSWebSocketServerContext) usize;
extern "C" fn Bun__JSWebSocketServerContext__incrementActiveConnections(*JSWebSocketServerContext) void;
extern "C" fn Bun__JSWebSocketServerContext__decrementActiveConnections(*JSWebSocketServerContext) void;
