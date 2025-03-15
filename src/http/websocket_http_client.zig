// This code is based on https://github.com/frmdstryr/zhp/blob/a4b5700c289c3619647206144e10fb414113a888/src/websocket.zig
// Thank you @frmdstryr.

// This file is now a wrapper that imports the split components
const websocket_client = @import("websocket_client.zig");

// Re-export from the new files
pub const CppWebSocket = websocket_client.CppWebSocket;
pub const ErrorCode = websocket_client.ErrorCode;
pub const NonUTF8Headers = websocket_client.NonUTF8Headers;
pub const ReceiveState = websocket_client.ReceiveState;
pub const DataType = websocket_client.DataType;
pub const Copy = websocket_client.Copy;
pub const Mask = websocket_client.Mask;

// Re-export WebSocket client implementations
pub const WebSocketHTTPClient = websocket_client.WebSocketHTTPClient;
pub const WebSocketHTTPSClient = websocket_client.WebSocketHTTPSClient;
pub const WebSocketClient = websocket_client.WebSocketClient;
pub const WebSocketClientTLS = websocket_client.WebSocketClientTLS;

// Re-export the factory functions
pub const NewHTTPUpgradeClient = @import("WebsocketHTTPUpgradeClient.zig").NewHTTPUpgradeClient;
pub const NewWebSocketClient = @import("WebSocket.zig").NewWebSocketClient;