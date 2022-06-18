#include "WebSocketStream.h"
#include <uws/uSockets/src/libusockets.h>

namespace WebCore {

template<bool SSL, bool isServer>
WebSocketStreamBase<SSL, isServer>* WebSocketStreamBase<SSL, isServer>::adoptSocket(us_socket_t* socket, ScriptExecutionContext* scriptCtx)
{
    using UserData = WebCore::WebSocket;

    /* Adopting a socket invalidates it, do not rely on it directly to carry any data */
    uWS::WebSocket<SSL, isServer, UserData>* webSocket = (uWS::WebSocket<SSL, isServer, UserData>*)us_socket_context_adopt_socket(SSL,
        (us_socket_context_t*)webSocketContext, (us_socket_t*)this, sizeof(WebSocketData) + sizeof(UserData));

    /* For whatever reason we were corked, update cork to the new socket */
    if (wasCorked) {
        webSocket->AsyncSocket<SSL>::corkUnchecked();
    }

    /* Initialize websocket with any moved backpressure intact */
    webSocket->init(perMessageDeflate, compressOptions, std::move(backpressure));
}

void WebSocketStreamBase::registerHTTPContext(ScriptExecutionContext* script, us_socket_context_t* ctx, us_loop_t* loop)
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
uWS::WebSocketContext* WebSocketStreamBase<SSL, isServer>::registerClientContext(ScriptExecutionContext*, us_socket_context_t* parent)
{
    uWS::Loop* loop = uWS::Loop::get();
    uWS::WebSocketContext<SSL, isServer>* ctx = uWS::WebSocketContext<SSL, isServer>::create(loop, parent, nullptr);
    auto* opts = ctx->getExt();

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