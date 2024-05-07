#include "root.h"
#include "headers.h"
#include "ScriptExecutionContext.h"
#include "MessagePort.h"

#include "webcore/WebSocket.h"
#include "libusockets.h"
#include "_libusockets.h"
#include "BunClientData.h"

extern "C" void Bun__startLoop(us_loop_t* loop);

namespace WebCore {

static std::atomic<unsigned> lastUniqueIdentifier = 0;

WTF_MAKE_ISO_ALLOCATED_IMPL(EventLoopTask);
WTF_MAKE_ISO_ALLOCATED_IMPL(ScriptExecutionContext);

static Lock allScriptExecutionContextsMapLock;
static HashMap<ScriptExecutionContextIdentifier, ScriptExecutionContext*>& allScriptExecutionContextsMap() WTF_REQUIRES_LOCK(allScriptExecutionContextsMapLock)
{
    static NeverDestroyed<HashMap<ScriptExecutionContextIdentifier, ScriptExecutionContext*>> contexts;
    ASSERT(allScriptExecutionContextsMapLock.isLocked());
    return contexts;
}

ScriptExecutionContext* ScriptExecutionContext::getScriptExecutionContext(ScriptExecutionContextIdentifier identifier)
{
    Locker locker { allScriptExecutionContextsMapLock };
    return allScriptExecutionContextsMap().get(identifier);
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

JSGlobalObject* ScriptExecutionContext::globalObject()
{
    return m_globalObject;
}

us_socket_context_t* ScriptExecutionContext::webSocketContextSSL()
{
    if (!m_ssl_client_websockets_ctx) {
        us_loop_t* loop = (us_loop_t*)uws_get_loop();
        us_bun_socket_context_options_t opts;
        memset(&opts, 0, sizeof(us_bun_socket_context_options_t));
        // adds root ca
        opts.request_cert = true;
        // but do not reject unauthorized
        opts.reject_unauthorized = false;
        this->m_ssl_client_websockets_ctx = us_create_bun_socket_context(1, loop, sizeof(size_t), opts);
        void** ptr = reinterpret_cast<void**>(us_socket_context_ext(1, m_ssl_client_websockets_ctx));
        *ptr = this;
        registerHTTPContextForWebSocket<true, false>(this, m_ssl_client_websockets_ctx, loop);
    }

    return m_ssl_client_websockets_ctx;
}
extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);

void ScriptExecutionContext::refEventLoop()
{
    Bun__eventLoop__incrementRefConcurrently(WebCore::clientData(vm())->bunVM, 1);
}
void ScriptExecutionContext::unrefEventLoop()
{
    Bun__eventLoop__incrementRefConcurrently(WebCore::clientData(vm())->bunVM, -1);
}

ScriptExecutionContext::~ScriptExecutionContext()
{
    checkConsistency();

    {
        Locker locker { allScriptExecutionContextsMapLock };
        ASSERT_WITH_MESSAGE(!allScriptExecutionContextsMap().contains(m_identifier), "A ScriptExecutionContext subclass instance implementing postTask should have already removed itself from the map");
    }

    auto postMessageCompletionHandlers = WTFMove(m_processMessageWithMessagePortsSoonHandlers);
    for (auto& completionHandler : postMessageCompletionHandlers)
        completionHandler();

    while (auto* destructionObserver = m_destructionObservers.takeAny())
        destructionObserver->contextDestroyed();
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

void ScriptExecutionContext::didCreateDestructionObserver(ContextDestructionObserver& observer)
{
    // ASSERT(!m_inScriptExecutionContextDestructor);
    m_destructionObservers.add(&observer);
}

void ScriptExecutionContext::willDestroyDestructionObserver(ContextDestructionObserver& observer)
{
    m_destructionObservers.remove(&observer);
}

bool ScriptExecutionContext::isJSExecutionForbidden()
{
    return !m_vm || m_vm->executionForbidden();
}

extern "C" void* Bun__getVM();

bool ScriptExecutionContext::isContextThread()
{
    auto clientData = WebCore::clientData(vm());
    return clientData && clientData->bunVM == Bun__getVM();
}

bool ScriptExecutionContext::ensureOnContextThread(ScriptExecutionContextIdentifier identifier, Function<void(ScriptExecutionContext&)>&& task)
{
    ScriptExecutionContext* context = nullptr;
    {
        Locker locker { allScriptExecutionContextsMapLock };
        context = allScriptExecutionContextsMap().get(identifier);

        if (!context)
            return false;

        if (!context->isContextThread()) {
            context->postTaskConcurrently(WTFMove(task));
            return true;
        }
    }

    task(*context);
    return true;
}

bool ScriptExecutionContext::ensureOnMainThread(Function<void(ScriptExecutionContext&)>&& task)
{
    auto* context = ScriptExecutionContext::getMainThreadScriptExecutionContext();

    if (!context) {
        return false;
    }

    context->postTaskConcurrently(WTFMove(task));
    return true;
}

ScriptExecutionContext* ScriptExecutionContext::getMainThreadScriptExecutionContext()
{
    Locker locker { allScriptExecutionContextsMapLock };
    return allScriptExecutionContextsMap().get(1);
}

void ScriptExecutionContext::processMessageWithMessagePortsSoon(CompletionHandler<void()>&& completionHandler)
{
    ASSERT(isContextThread());
    m_processMessageWithMessagePortsSoonHandlers.append(WTFMove(completionHandler));

    if (m_willProcessMessageWithMessagePortsSoon) {
        return;
    }

    m_willProcessMessageWithMessagePortsSoon = true;

    postTask([](ScriptExecutionContext& context) {
        context.dispatchMessagePortEvents();
    });
}

void ScriptExecutionContext::dispatchMessagePortEvents()
{
    ASSERT(isContextThread());
    checkConsistency();

    ASSERT(m_willProcessMessageWithMessagePortsSoon);
    m_willProcessMessageWithMessagePortsSoon = false;

    auto completionHandlers = std::exchange(m_processMessageWithMessagePortsSoonHandlers, Vector<CompletionHandler<void()>> {});

    // Make a frozen copy of the ports so we can iterate while new ones might be added or destroyed.
    for (auto* messagePort : copyToVector(m_messagePorts)) {
        // The port may be destroyed, and another one created at the same address,
        // but this is harmless. The worst that can happen as a result is that
        // dispatchMessages() will be called needlessly.
        if (m_messagePorts.contains(messagePort) && messagePort->started())
            messagePort->dispatchMessages();
    }

    for (auto& completionHandler : completionHandlers)
        completionHandler();
}

void ScriptExecutionContext::checkConsistency() const
{
    // for (auto* messagePort : m_messagePorts)
    //     ASSERT(messagePort->scriptExecutionContext() == this);

    // for (auto* destructionObserver : m_destructionObservers)
    //     ASSERT(destructionObserver->scriptExecutionContext() == this);

    // for (auto* activeDOMObject : m_activeDOMObjects) {
    //     ASSERT(activeDOMObject->scriptExecutionContext() == this);
    //     activeDOMObject->assertSuspendIfNeededWasCalled();
    // }
}

void ScriptExecutionContext::createdMessagePort(MessagePort& messagePort)
{
    ASSERT(isContextThread());

    m_messagePorts.add(&messagePort);
}

void ScriptExecutionContext::destroyedMessagePort(MessagePort& messagePort)
{
    ASSERT(isContextThread());

    m_messagePorts.remove(&messagePort);
}

us_socket_context_t* ScriptExecutionContext::webSocketContextNoSSL()
{
    if (!m_client_websockets_ctx) {
        us_loop_t* loop = (us_loop_t*)uws_get_loop();
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

ScriptExecutionContextIdentifier ScriptExecutionContext::generateIdentifier()
{
    return ++lastUniqueIdentifier;
}

void ScriptExecutionContext::regenerateIdentifier()
{

    m_identifier = ++lastUniqueIdentifier;

    addToContextsMap();
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

ScriptExecutionContext* executionContext(JSC::JSGlobalObject* globalObject)
{
    if (!globalObject || !globalObject->inherits<JSDOMGlobalObject>())
        return nullptr;
    return JSC::jsCast<JSDOMGlobalObject*>(globalObject)->scriptExecutionContext();
}

void ScriptExecutionContext::postTaskConcurrently(Function<void(ScriptExecutionContext&)>&& lambda)
{
    auto* task = new EventLoopTask(WTFMove(lambda));
    reinterpret_cast<Zig::GlobalObject*>(m_globalObject)->queueTaskConcurrently(task);
}
// Executes the task on context's thread asynchronously.
void ScriptExecutionContext::postTask(Function<void(ScriptExecutionContext&)>&& lambda)
{
    auto* task = new EventLoopTask(WTFMove(lambda));
    reinterpret_cast<Zig::GlobalObject*>(m_globalObject)->queueTask(task);
}
// Executes the task on context's thread asynchronously.
void ScriptExecutionContext::postTask(EventLoopTask* task)
{
    reinterpret_cast<Zig::GlobalObject*>(m_globalObject)->queueTask(task);
}
// Executes the task on context's thread asynchronously.
void ScriptExecutionContext::postTaskOnTimeout(EventLoopTask* task, Seconds timeout)
{
    reinterpret_cast<Zig::GlobalObject*>(m_globalObject)->queueTaskOnTimeout(task, static_cast<int>(timeout.milliseconds()));
}
// Executes the task on context's thread asynchronously.
void ScriptExecutionContext::postTaskOnTimeout(Function<void(ScriptExecutionContext&)>&& lambda, Seconds timeout)
{
    auto* task = new EventLoopTask(WTFMove(lambda));
    postTaskOnTimeout(task, timeout);
}

}
