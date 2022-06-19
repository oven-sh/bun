#include "root.h"
#include "headers.h"
#include "ScriptExecutionContext.h"

#include "webcore/WebSocket.h"

#include <uws/src/App.h>

extern "C" void Bun__startLoop(us_loop_t* loop);

namespace WebCore {

template<bool SSL, bool isServer>
static void registerHTTPContextForWebSocket(ScriptExecutionContext* script, us_socket_context_t* ctx, us_loop_t* loop)
{
    if constexpr (!isServer) {
        if constexpr (SSL) {
            Bun__WebSocketHTTPSClient__register(script->jsGlobalObject(), loop, ctx);
        } else {
            Bun__WebSocketHTTPClient__register(script->jsGlobalObject(), loop, ctx);
        }
    } else {
        RELEASE_ASSERT_NOT_REACHED();
    }
}

us_socket_context_t* ScriptExecutionContext::webSocketContextSSL()
{
    if (!m_ssl_client_websockets_ctx) {
        us_loop_t* loop = (us_loop_t*)uWS::Loop::get();
        us_socket_context_options_t opts;
        memset(&opts, 0, sizeof(us_socket_context_options_t));
        this->m_ssl_client_websockets_ctx = us_create_socket_context(1, loop, sizeof(size_t), opts);
        void** ptr = reinterpret_cast<void**>(us_socket_context_ext(1, m_ssl_client_websockets_ctx));
        *ptr = this;
        registerHTTPContextForWebSocket<true, false>(this, m_ssl_client_websockets_ctx, loop);
    }

    return m_ssl_client_websockets_ctx;
}

us_socket_context_t* ScriptExecutionContext::webSocketContextNoSSL()
{
    if (!m_client_websockets_ctx) {
        us_loop_t* loop = (us_loop_t*)uWS::Loop::get();
        us_socket_context_options_t opts;
        memset(&opts, 0, sizeof(us_socket_context_options_t));
        this->m_client_websockets_ctx = us_create_socket_context(0, loop, sizeof(size_t), opts);
        void** ptr = reinterpret_cast<void**>(us_socket_context_ext(0, m_client_websockets_ctx));
        *ptr = this;
        registerHTTPContextForWebSocket<false, false>(this, m_client_websockets_ctx, loop);
    }

    return m_client_websockets_ctx;
}

template<bool SSL>
static uWS::WebSocketContext<SSL, false, WebCore::WebSocket*>* registerWebSocketClientContext(ScriptExecutionContext* script, us_socket_context_t* parent)
{
    uWS::Loop* loop = uWS::Loop::get();
    uWS::WebSocketContext<SSL, false, WebCore::WebSocket*>* ctx = uWS::WebSocketContext<SSL, false, WebCore::WebSocket*>::createClient(loop, parent);

    auto* opts = ctx->getExt();

    /* Maximum message size we can receive */
    unsigned int maxPayloadLength = 16 * 1024;
    /* 2 minutes timeout is good */
    unsigned short idleTimeout = 120;
    /* 64kb backpressure is probably good */
    unsigned int maxBackpressure = 64 * 1024;
    bool closeOnBackpressureLimit = false;
    /* This one depends on kernel timeouts and is a bad default */
    bool resetIdleTimeoutOnSend = false;
    /* A good default, esp. for newcomers */
    bool sendPingsAutomatically = false;
    /* Maximum socket lifetime in seconds before forced closure (defaults to disabled) */
    unsigned short maxLifetime = 0;

    opts->maxPayloadLength = maxPayloadLength;
    opts->maxBackpressure = maxBackpressure;
    opts->closeOnBackpressureLimit = closeOnBackpressureLimit;
    opts->resetIdleTimeoutOnSend = resetIdleTimeoutOnSend;
    opts->sendPingsAutomatically = sendPingsAutomatically;
    // opts->compression = compression;
    // TODO:
    opts->compression = uWS::CompressOptions::DISABLED;

    opts->openHandler = [](uWS::WebSocket<SSL, false, WebCore::WebSocket*>* ws) {
        WebCore::WebSocket* webSocket = *ws->getUserData();
        webSocket->didConnect();
    };

    opts->messageHandler = [](uWS::WebSocket<SSL, false, WebCore::WebSocket*>* ws, std::string_view input, uWS::OpCode opCode) {
        WebCore::WebSocket* webSocket = *ws->getUserData();
        if (opCode == uWS::OpCode::BINARY) {
            webSocket->didReceiveBinaryData({ const_cast<unsigned char*>(reinterpret_cast<const unsigned char*>(input.data())), input.length() });
        } else {
            webSocket->didReceiveMessage(WTF::String::fromUTF8(input.data(), input.length()));
        }
    };

    // pts->drainHandler = [](uWS::WebSocket<SSL, false, WebCore::WebSocket>* ws, std::string_view input, uWS::OpCode opCode) {
    //    WebCore::WebSocket* webSocket = *ws->getUserData();
    //     webSocket->didReceiveData(input.data(), input.length());
    // };

    opts->closeHandler = [](uWS::WebSocket<SSL, false, WebCore::WebSocket*>* ws, int code, std::string_view message) {
        WebCore::WebSocket* webSocket = *ws->getUserData();
        webSocket->didClose(
            ws->getBufferedAmount(),
            code,
            WTF::String::fromUTF8(
                message.data(),
                message.length()));
    };

    return ctx;
}

uWS::WebSocketContext<false, false, WebSocket*>* ScriptExecutionContext::connectedWebSocketKindClient()
{
    return registerWebSocketClientContext<false>(this, webSocketContextNoSSL());
}
uWS::WebSocketContext<true, false, WebSocket*>* ScriptExecutionContext::connectedWebSocketKindClientSSL()
{
    return registerWebSocketClientContext<true>(this, webSocketContextSSL());
}

}