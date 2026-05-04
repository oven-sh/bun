#pragma once
#include <stdint.h>
#include <stdbool.h>

// This must match the layout of WebSocketDeflate.Params in WebSocketDeflate.zig
typedef struct {
    uint8_t server_max_window_bits;
    uint8_t client_max_window_bits;
    uint8_t server_no_context_takeover;
    uint8_t client_no_context_takeover;
} PerMessageDeflateParams;
