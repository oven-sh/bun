#pragma once

#include <cstdint>

namespace Bun {

enum class WebSocketErrorCode : int32_t {
    cancel = 1,
    invalid_response = 2,
    expected_101_status_code = 3,
    missing_upgrade_header = 4,
    missing_connection_header = 5,
    missing_websocket_accept_header = 6,
    invalid_upgrade_header = 7,
    invalid_connection_header = 8,
    invalid_websocket_version = 9,
    mismatch_websocket_accept_header = 10,
    missing_client_protocol = 11,
    mismatch_client_protocol = 12,
    timeout = 13,
    closed = 14,
    failed_to_write = 15,
    failed_to_connect = 16,
    headers_too_large = 17,
    ended = 18,
    failed_to_allocate_memory = 19,
    control_frame_is_fragmented = 20,
    invalid_control_frame = 21,
    compression_unsupported = 22,
    invalid_compressed_data = 23,
    compression_failed = 24,
    unexpected_mask_from_server = 25,
    expected_control_frame = 26,
    unsupported_control_frame = 27,
    unexpected_opcode = 28,
    invalid_utf8 = 29,
    tls_handshake_failed = 30,
    message_too_big = 31,
    protocol_error = 32,
    // Proxy error codes
    proxy_connect_failed = 33,
    proxy_authentication_required = 34,
    proxy_connection_refused = 35,
    proxy_tunnel_failed = 36,
};

}
