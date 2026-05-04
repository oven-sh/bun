#pragma once
/* `src/deps/uws/SocketKind.zig` is the source of truth for these ordinals.
 * The Zig side `@export`s them so the dispatch ABI can't silently drift if
 * the enum is reordered — C++ links against the actual values instead of
 * hand-mirrored literals. */
extern "C" const unsigned char BUN_SOCKET_KIND_DYNAMIC;
extern "C" const unsigned char BUN_SOCKET_KIND_UWS_HTTP;
extern "C" const unsigned char BUN_SOCKET_KIND_UWS_HTTP_TLS;
extern "C" const unsigned char BUN_SOCKET_KIND_UWS_WS;
extern "C" const unsigned char BUN_SOCKET_KIND_UWS_WS_TLS;

#define US_SOCKET_KIND_DYNAMIC      BUN_SOCKET_KIND_DYNAMIC
#define US_SOCKET_KIND_UWS_HTTP     BUN_SOCKET_KIND_UWS_HTTP
#define US_SOCKET_KIND_UWS_HTTP_TLS BUN_SOCKET_KIND_UWS_HTTP_TLS
#define US_SOCKET_KIND_UWS_WS       BUN_SOCKET_KIND_UWS_WS
#define US_SOCKET_KIND_UWS_WS_TLS   BUN_SOCKET_KIND_UWS_WS_TLS
