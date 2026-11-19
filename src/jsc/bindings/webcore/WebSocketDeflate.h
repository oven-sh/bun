#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

// This must match the layout of Params in src/http_jsc/websocket_client/WebSocketDeflate.rs
typedef struct {
    uint8_t server_max_window_bits;
    uint8_t client_max_window_bits;
    uint8_t server_no_context_takeover;
    uint8_t client_no_context_takeover;
} PerMessageDeflateParams;

// This must match the layout of ConnectedOptions in src/http_jsc/websocket_client.rs
typedef struct {
    // Max size of one message in bytes, after reassembly and decompression. 0 = no limit.
    size_t max_payload_length;
    bool auto_pong;
    // The `ws` module owns this socket. Text messages are delivered as bytes through WebSocket__didReceiveBytes with opcode 1,
    // WebSocket__didDrain is called, and the module runs its own closing handshake timeout.
    bool ws_mode;
    bool skip_utf8_validation;
    bool is_server;
} WebSocketConnectedOptions;
