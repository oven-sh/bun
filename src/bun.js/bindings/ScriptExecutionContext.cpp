#include "root.h"
#include "headers.h"
#include "ScriptExecutionContext.h"

#include "webcore/WebSocket.h"
#include "libusockets.h"
#include "_libusockets.h"

extern "C" void Bun__startLoop(us_loop_t* loop);

namespace WebCore {

static unsigned lastUniqueIdentifier = 0;

static Lock allScriptExecutionContextsMapLock;
static HashMap<ScriptExecutionContextIdentifier, ScriptExecutionContext*>& allScriptExecutionContextsMap() WTF_REQUIRES_LOCK(allScriptExecutionContextsMapLock)
{
    static NeverDestroyed<HashMap<ScriptExecutionContextIdentifier, ScriptExecutionContext*>> contexts;
    ASSERT(allScriptExecutionContextsMapLock.isLocked());
    return contexts;
}

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
        us_loop_t* loop = (us_loop_t*)uws_get_loop();
        us_bun_socket_context_options_t opts;
        memset(&opts, 0, sizeof(us_bun_socket_context_options_t));
        this->m_ssl_client_websockets_ctx = us_create_bun_socket_context(1, loop, sizeof(size_t), opts);
        void** ptr = reinterpret_cast<void**>(us_socket_context_ext(1, m_ssl_client_websockets_ctx));
        *ptr = this;
        registerHTTPContextForWebSocket<true, false>(this, m_ssl_client_websockets_ctx, loop);
    }

    return m_ssl_client_websockets_ctx;
}

bool ScriptExecutionContext::postTaskTo(ScriptExecutionContextIdentifier identifier, Function<void(ScriptExecutionContext&)>&& task)
{
    Locker locker { allScriptExecutionContextsMapLock };
    auto* context = allScriptExecutionContextsMap().get(identifier);

    if (!context)
        return false;

    context->postTaskConcurrently(WTFMove(task));
    return true;
}

us_socket_context_t* ScriptExecutionContext::webSocketContextNoSSL()
{
    if (!m_client_websockets_ctx) {
        us_loop_t* loop = (us_loop_t*)uws_get_loop();
        us_bun_socket_context_options_t opts;
        memset(&opts, 0, sizeof(us_bun_socket_context_options_t));
        this->m_client_websockets_ctx = us_create_bun_socket_context(0, loop, sizeof(size_t), opts);
        void** ptr = reinterpret_cast<void**>(us_socket_context_ext(0, m_client_websockets_ctx));
        *ptr = this;
        registerHTTPContextForWebSocket<false, false>(this, m_client_websockets_ctx, loop);
    }

    return m_client_websockets_ctx;
}

template<bool SSL>
static us_socket_context_t* registerWebSocketClientContext(ScriptExecutionContext* script, us_socket_context_t* parent)
{
    us_loop_t* loop = (us_loop_t*)uws_get_loop();
    if constexpr (SSL) {
        us_socket_context_t* child = us_create_child_socket_context(1, parent, sizeof(size_t));
        Bun__WebSocketClientTLS__register(script->jsGlobalObject(), loop, child);
        return child;
    } else {
        us_socket_context_t* child = us_create_child_socket_context(0, parent, sizeof(size_t));
        Bun__WebSocketClient__register(script->jsGlobalObject(), loop, child);
        return child;
    }
}

us_socket_context_t* ScriptExecutionContext::connectedWebSocketKindClient()
{
    return registerWebSocketClientContext<false>(this, webSocketContextNoSSL());
}
us_socket_context_t* ScriptExecutionContext::connectedWebSocketKindClientSSL()
{
    return registerWebSocketClientContext<true>(this, webSocketContextSSL());
}

void ScriptExecutionContext::regenerateIdentifier()
{
    Locker locker { allScriptExecutionContextsMapLock };

    ASSERT(allScriptExecutionContextsMap().contains(m_identifier));
    allScriptExecutionContextsMap().remove(m_identifier);

    m_identifier = ++lastUniqueIdentifier;

    ASSERT(!allScriptExecutionContextsMap().contains(m_identifier));
    allScriptExecutionContextsMap().add(m_identifier, this);
}

void ScriptExecutionContext::addToContextsMap()
{
    Locker locker { allScriptExecutionContextsMapLock };
    ASSERT(!allScriptExecutionContextsMap().contains(m_identifier));
    allScriptExecutionContextsMap().add(m_identifier, this);
}

void ScriptExecutionContext::removeFromContextsMap()
{
    Locker locker { allScriptExecutionContextsMapLock };
    ASSERT(allScriptExecutionContextsMap().contains(m_identifier));
    allScriptExecutionContextsMap().remove(m_identifier);
}

}
