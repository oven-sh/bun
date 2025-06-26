#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Mirrors the Zig Params struct for C++ compatibility
typedef struct WebSocketDeflateParams {
    uint8_t server_max_window_bits;
    uint8_t client_max_window_bits;
    bool server_no_context_takeover;
    bool client_no_context_takeover;
} WebSocketDeflateParams;

#ifdef __cplusplus
}
#endif