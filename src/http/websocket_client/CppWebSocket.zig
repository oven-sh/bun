/// This is the wrapper between Zig and C++ for WebSocket client functionality. It corresponds to the `WebCore::WebSocket` class (WebSocket.cpp).
///
/// Each method in this interface ensures proper JavaScript event loop integration by entering
/// and exiting the event loop around C++ function calls, maintaining proper execution context.
///
/// The external C++ functions are imported and wrapped with Zig functions that handle
/// the event loop management automatically.
///
/// Note: This is specifically for WebSocket client implementations, not for server-side WebSockets.
pub const CppWebSocket = opaque {
    extern fn WebSocket__didConnect(
        websocket_context: *CppWebSocket,
        socket: *uws.Socket,
        buffered_data: ?[*]u8,
        buffered_len: usize,
    ) void;
    extern fn WebSocket__didAbruptClose(websocket_context: *CppWebSocket, reason: ErrorCode) void;
    extern fn WebSocket__didClose(websocket_context: *CppWebSocket, code: u16, reason: *const bun.String) void;
    extern fn WebSocket__didReceiveText(websocket_context: *CppWebSocket, clone: bool, text: *const JSC.ZigString) void;
    extern fn WebSocket__didReceiveBytes(websocket_context: *CppWebSocket, bytes: [*]const u8, byte_len: usize, opcode: u8) void;
    extern fn WebSocket__rejectUnauthorized(websocket_context: *CppWebSocket) bool;
    pub fn didAbruptClose(this: *CppWebSocket, reason: ErrorCode) void {
        const loop = JSC.VirtualMachine.get().eventLoop();
        loop.enter();
        defer loop.exit();
        WebSocket__didAbruptClose(this, reason);
    }
    pub fn didClose(this: *CppWebSocket, code: u16, reason: *bun.String) void {
        const loop = JSC.VirtualMachine.get().eventLoop();
        loop.enter();
        defer loop.exit();
        WebSocket__didClose(this, code, reason);
    }
    pub fn didReceiveText(this: *CppWebSocket, clone: bool, text: *const JSC.ZigString) void {
        const loop = JSC.VirtualMachine.get().eventLoop();
        loop.enter();
        defer loop.exit();
        WebSocket__didReceiveText(this, clone, text);
    }
    pub fn didReceiveBytes(this: *CppWebSocket, bytes: [*]const u8, byte_len: usize, opcode: u8) void {
        const loop = JSC.VirtualMachine.get().eventLoop();
        loop.enter();
        defer loop.exit();
        WebSocket__didReceiveBytes(this, bytes, byte_len, opcode);
    }
    pub fn rejectUnauthorized(this: *CppWebSocket) bool {
        const loop = JSC.VirtualMachine.get().eventLoop();
        loop.enter();
        defer loop.exit();
        return WebSocket__rejectUnauthorized(this);
    }
    pub fn didConnect(this: *CppWebSocket, socket: *uws.Socket, buffered_data: ?[*]u8, buffered_len: usize) void {
        const loop = JSC.VirtualMachine.get().eventLoop();
        loop.enter();
        defer loop.exit();
        WebSocket__didConnect(this, socket, buffered_data, buffered_len);
    }
    extern fn WebSocket__incrementPendingActivity(websocket_context: *CppWebSocket) void;
    extern fn WebSocket__decrementPendingActivity(websocket_context: *CppWebSocket) void;
    pub fn ref(this: *CppWebSocket) void {
        JSC.markBinding(@src());
        WebSocket__incrementPendingActivity(this);
    }

    pub fn unref(this: *CppWebSocket) void {
        JSC.markBinding(@src());
        WebSocket__decrementPendingActivity(this);
    }
};

const uws = bun.uws;
const JSC = bun.JSC;
const ErrorCode = @import("../websocket_client.zig").ErrorCode;
const bun = @import("bun");
