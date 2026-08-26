#pragma once
#include <stdint.h>
#include <stdbool.h>

// This must match the layout of Params in src/http_jsc/websocket_client/WebSocketDeflate.rs
typedef struct {
    uint8_t server_max_window_bits;
    uint8_t client_max_window_bits;
    uint8_t server_no_context_takeover;
    uint8_t client_no_context_takeover;
} PerMessageDeflateParams;
