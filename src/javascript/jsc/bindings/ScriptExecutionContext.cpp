
#include "ScriptExecutionContext.h"
#include <uws/src/App.h>
#include "WebSocketStream.h"

extern "C" void Bun__startLoop(us_loop_t* loop);

namespace WebCore {

template<bool isSSL>
us_socket_context_t* ScriptExecutionContext::webSocketContext()
{
    if constexpr (isSSL) {
        if (!m_ssl_client_websockets_ctx) {
            us_loop_t* loop = (us_loop_t*)uWS::Loop::get();
            us_socket_context_options_t opts;
            memset(&opts, 0, sizeof(us_socket_context_options_t));
            this->m_ssl_client_websockets_ctx = us_create_socket_context(1, loop, sizeof(size_t), opts);
            void** ptr = reinterpret_cast<void**>(us_socket_context_ext(1, m_ssl_client_websockets_ctx));
            *ptr = this;
            registerHTTPContextForWebSocket<isSSL, false>(this, m_ssl_client_websockets_ctx);
        }

        return m_ssl_client_websockets_ctx;
    } else {
        if (!m_client_websockets_ctx) {
            us_loop_t* loop = (us_loop_t*)uWS::Loop::get();
            us_socket_context_options_t opts;
            memset(&opts, 0, sizeof(us_socket_context_options_t));
            this->m_client_websockets_ctx = us_create_socket_context(0, loop, sizeof(size_t), opts);
            void** ptr = reinterpret_cast<void**>(us_socket_context_ext(0, m_client_websockets_ctx));
            *ptr = this;
            registerHTTPContextForWebSocket<isSSL, false>(this, m_client_websockets_ctx);
        }

        return m_client_websockets_ctx;
    }
}

template<bool isSSL, bool isServer>
uWS::WebSocketContext<isSSL, isServer, ScriptExecutionContext*>* ScriptExecutionContext::connnectedWebSocketContext()
{
    if constexpr (isSSL) {
        if (!m_connected_ssl_client_websockets_ctx) {
            // should be the parent
            RELEASE_ASSERT(m_ssl_client_websockets_ctx);
            m_connected_client_websockets_ctx = registerWebSocketClientContext(this, webSocketContext<isSSL>());
        }

        return m_connected_ssl_client_websockets_ctx;
    } else {
        if (!m_connected_client_websockets_ctx) {
            // should be the parent
            RELEASE_ASSERT(m_client_websockets_ctx);
            m_connected_client_websockets_ctx = registerWebSocketClientContext(this, webSocketContext<isSSL>());
        }

        return m_connected_client_websockets_ctx;
    }
}

}