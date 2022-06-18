#include "root.h"

#include "WebSocketStream.h"
#include "ScriptExecutionContext.h"
#include <uws/src/App.h>
#include <uws/uSockets/src/libusockets.h>

namespace WebCore {

template<bool SSL, bool isServer>
void registerHTTPContextForWebSocket(ScriptExecutionContext* script, us_socket_context_t* ctx, us_loop_t* loop)
{
    if constexpr (!isServer) {
        if constexpr (SSL) {
            Bun__SecureWebSocketUpgradeClient__register(script->jsGlobalObject(), loop, ctx);
        } else {
            Bun__WebSocketUpgradeClient__register(script->jsGlobalObject(), loop, ctx);
        }
    } else {
        RELEASE_ASSERT_NOT_REACHED();
    }
}

template<bool SSL, bool isServer>
uWS::WebSocketContext<SSL, isServer, ScriptExecutionContext*>* registerWebSocketClientContext(ScriptExecutionContext* script, us_socket_context_t* parent)
{
    uWS::Loop* loop = uWS::Loop::get();
    uWS::WebSocketContext<SSL, isServer, ScriptExecutionContext*>* ctx = uWS::WebSocketContext<SSL, isServer>::create(loop, parent, nullptr);
    auto* opts = ctx->getExt();
    ScriptExecutionContext** scriptCtx = ctx->getUserData();
    *scriptCtx = script;

    /* Maximum message size we can receive */
    static unsigned int maxPayloadLength = 128 * 1024 * 1024;
    /* 2 minutes timeout is good */
    static unsigned short idleTimeout = 120;
    /* 64kb backpressure is probably good */
    static unsigned int maxBackpressure = 128 * 1024 * 1024;
    static bool closeOnBackpressureLimit = false;
    /* This one depends on kernel timeouts and is a bad default */
    static bool resetIdleTimeoutOnSend = false;
    /* A good default, esp. for newcomers */
    static bool sendPingsAutomatically = true;
    /* Maximum socket lifetime in seconds before forced closure (defaults to disabled) */
    static unsigned short maxLifetime = 0;

    opts->maxPayloadLength = maxPayloadLength;
    opts->maxBackpressure = maxBackpressure;
    opts->closeOnBackpressureLimit = closeOnBackpressureLimit;
    opts->resetIdleTimeoutOnSend = resetIdleTimeoutOnSend;
    opts->sendPingsAutomatically = sendPingsAutomatically;
    // opts->compression = compression;
    // TODO:
    opts->compression = false;

    opts->openHandler = [](uWS::WebSocket<SSL, isServer, WebCore::WebSocket>* ws) {
        auto* webSocket = ws->getUserData();
        webSocket->didOpen();
    };

    opts->messageHandler = [](uWS::WebSocket<SSL, isServer, WebCore::WebSocket>* ws, std::string_view input, uWS::OpCode opCode) {
        auto* webSocket = ws->getUserData();
        if (opCode == uWS::OpCode::BINARY) {
            webSocket->didReceiveBinaryData({ input.data(), input.length() });
        } else {
            webSocket->didReceiveMessage(WTF::String::fromUTF8(input.data(), input.length()));
        }
    };

    // pts->drainHandler = [](uWS::WebSocket<SSL, isServer, WebCore::WebSocket>* ws, std::string_view input, uWS::OpCode opCode) {
    //     auto* webSocket = ws->getUserData();
    //     webSocket->didReceiveData(input.data(), input.length());
    // };

    opts->closeHandler = [](uWS::WebSocket<SSL, isServer, WebCore::WebSocket>* ws, int code, std::string_view message) {
        auto* webSocket = ws->getUserData();
        webSocket->didClose(
            ws->getBufferedAmount(),
            code,
            WTF::String::fromUTF8(
                message.data(),
                message.length()));
    };

    return ctx;
}

}