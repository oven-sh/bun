#pragma once

#include <cstdint>

namespace Bun {

// The functions of node:diagnostics_channel that native code publishes through. A realm has one only while somebody is subscribed to
// a channel behind it: see Zig::GlobalObject::diagnosticsHook().
enum class DiagnosticsHook : uint8_t {
    ConsoleLog,
    ConsoleInfo,
    ConsoleDebug,
    ConsoleWarn,
    ConsoleError,
    ModuleRequire,
    ModuleImport,
    ProcessExecve,
    SqliteQuery,
    Request,
    WebSocket,
    Count,
};

// Keep these in sync with internal/undici_channels.ts and FetchTrace.rs
enum class RequestEvent : uint8_t {
    WantedChunks,
    Create,
    Connecting,
    HeadSent,
    BodyChunkSent,
    BodySent,
    ResponseHead,
    BodyChunkReceived,
    ResponseEnd,
    Error,
    Abort,
};

enum class WebSocketEvent : uint8_t {
    Open,
    Close,
    SocketError,
    TLSError,
    Ping,
    Pong,
};

}
