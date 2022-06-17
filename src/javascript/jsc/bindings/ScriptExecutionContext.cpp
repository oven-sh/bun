
#include "ScriptExecutionContext.h"
#include <uws/uSockets/src/libusockets.h>
#include <uws/src/Loop.h>

extern "C" void Bun__startLoop(us_loop_t* loop);

namespace WebCore {

template<bool isSSL>
us_socket_context_t* webSocketContext()
{
    if constexpr (isSSL) {
        if (!m_ssl_client_websockets_ctx) {
            us_loop_t* loop = (us_loop_t*)uWs::Loop::get();
            us_socket_context_options_t opts;
            memset(&opts, 0, sizeof(us_socket_context_t));
            this->m_ssl_client_websockets_ctx = us_create_socket_context(1, loop, sizeof(*ScriptExecutionContext), opts);
            *us_socket_context_ext(m_ssl_client_websockets_ctx) = this;
            WebSocketStream::registerHTTPContext(this, m_ssl_client_websockets_ctx, loop);
        }

        return m_ssl_client_websockets_ctx;
    } else {
        if (!m_client_websockets_ctx) {
            us_loop_t* loop = (us_loop_t*)uWs::Loop::get();
            us_socket_context_options_t opts;
            memset(&opts, 0, sizeof(us_socket_context_t));
            this->m_client_websockets_ctx = us_create_socket_context(0, loop, sizeof(*ScriptExecutionContext), opts);
            *us_socket_context_ext(m_client_websockets_ctx) = this;
            SecureWebSocketStream::registerHTTPContext(this, m_client_websockets_ctx, loop);
        }

        return m_client_websockets_ctx;
    }
}

template<bool isSSL, bool isServer>
uWS::WebSocketContext<isSSL, isServer, ScriptExecutionContext*>*
{
    if constexpr (isSSL) {
        if (!m_connected_ssl_client_websockets_ctx) {
            // should be the parent
            RELEASE_ASSERT(m_ssl_client_websockets_ctx);
            m_connected_client_websockets_ctx = SecureWebSocketStream::registerClientContext(this, webSocketContext<isSSL>(), loop);
        }

        return m_connected_ssl_client_websockets_ctx;
    } else {
        if (!m_connected_client_websockets_ctx) {
            // should be the parent
            RELEASE_ASSERT(m_client_websockets_ctx);
            m_connected_client_websockets_ctx = WebSocketStream::registerClientContext(this, webSocketContext<isSSL>(), loop);
        }

        return m_connected_client_websockets_ctx;
    }
}

}