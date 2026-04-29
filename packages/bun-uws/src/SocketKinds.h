#pragma once
/* C++ mirror of `src/deps/uws/SocketKind.zig` ordinals for the uWS server
 * kinds. The Zig dispatcher routes these through `group->vtable`, so the only
 * load-bearing requirement is that they don't collide with `invalid = 0` and
 * stay in sync with the Zig enum. */
enum : unsigned char {
    US_SOCKET_KIND_DYNAMIC      = 1,
    US_SOCKET_KIND_UWS_HTTP     = 19,
    US_SOCKET_KIND_UWS_HTTP_TLS = 20,
    US_SOCKET_KIND_UWS_WS       = 21,
    US_SOCKET_KIND_UWS_WS_TLS   = 22,
};
