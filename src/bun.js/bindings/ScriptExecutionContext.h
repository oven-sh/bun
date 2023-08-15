#pragma once

#include "root.h"
#include "ActiveDOMObject.h"
#include "ContextDestructionObserver.h"
#include "BunBroadcastChannelRegistry.h"
#include <wtf/CrossThreadTask.h>
#include <wtf/Function.h>
#include <wtf/HashSet.h>
#include <wtf/ObjectIdentifier.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>
#include <wtf/CompletionHandler.h>
#include "CachedScript.h"
#include "wtf/URL.h"

namespace uWS {
template<bool isServer, bool isClient, typename UserData>
struct WebSocketContext;
}

#ifndef ZIG_GLOBAL_OBJECT_DEFINED
#include "ZigGlobalObject.h"
#endif

struct us_socket_t;
struct us_socket_context_t;
struct us_loop_t;

namespace WebCore {

class WebSocket;
class MessagePort;

class ScriptExecutionContext;

class EventLoopTask {
    WTF_MAKE_ISO_ALLOCATED(EventLoopTask);

public:
    enum CleanupTaskTag { CleanupTask };

    template<typename T, typename = typename std::enable_if<!std::is_base_of<EventLoopTask, T>::value && std::is_convertible<T, Function<void(ScriptExecutionContext&)>>::value>::type>
    EventLoopTask(T task)
        : m_task(WTFMove(task))
        , m_isCleanupTask(false)
    {
    }

    EventLoopTask(Function<void()>&& task)
        : m_task([task = WTFMove(task)](ScriptExecutionContext&) { task(); })
        , m_isCleanupTask(false)
    {
    }

    template<typename T, typename = typename std::enable_if<std::is_convertible<T, Function<void(ScriptExecutionContext&)>>::value>::type>
    EventLoopTask(CleanupTaskTag, T task)
        : m_task(WTFMove(task))
        , m_isCleanupTask(true)
    {
    }

    void performTask(ScriptExecutionContext& context)
    {
        m_task(context);
        delete this;
    }
    bool isCleanupTask() const { return m_isCleanupTask; }

protected:
    Function<void(ScriptExecutionContext&)> m_task;
    bool m_isCleanupTask;
};

using ScriptExecutionContextIdentifier = uint32_t;

class ScriptExecutionContext : public CanMakeWeakPtr<ScriptExecutionContext> {
    WTF_MAKE_ISO_ALLOCATED(ScriptExecutionContext);

public:
    ScriptExecutionContext(JSC::VM* vm, JSC::JSGlobalObject* globalObject)
        : m_vm(vm)
        , m_globalObject(globalObject)
        , m_identifier(0)
        , m_broadcastChannelRegistry(BunBroadcastChannelRegistry::create())
    {
        regenerateIdentifier();
    }

    ScriptExecutionContext(JSC::VM* vm, JSC::JSGlobalObject* globalObject, ScriptExecutionContextIdentifier identifier)
        : m_vm(vm)
        , m_globalObject(globalObject)
        , m_identifier(identifier)
        , m_broadcastChannelRegistry(BunBroadcastChannelRegistry::create())
    {
        addToContextsMap();
    }

    ~ScriptExecutionContext();

    static ScriptExecutionContextIdentifier generateIdentifier();

    JSC::JSGlobalObject* jsGlobalObject()
    {
        return m_globalObject;
    }

    template<bool isSSL>
    us_socket_context_t* webSocketContext()
    {
        if constexpr (isSSL) {
            return this->webSocketContextSSL();
        } else {
            return this->webSocketContextNoSSL();
        }
    }

    static ScriptExecutionContext* getScriptExecutionContext(ScriptExecutionContextIdentifier identifier);
    void refEventLoop();
    void unrefEventLoop();

    const WTF::URL& url() const
    {
        return m_url;
    }
    bool isMainThread() const { return static_cast<unsigned>(m_identifier) == 1; }
    bool activeDOMObjectsAreSuspended() { return false; }
    bool activeDOMObjectsAreStopped() { return false; }
    bool isContextThread();
    bool isDocument() { return false; }
    bool isWorkerGlobalScope() { return true; }
    bool isJSExecutionForbidden() { return false; }
    void reportException(const String& errorMessage, int lineNumber, int columnNumber, const String& sourceURL, JSC::Exception* exception, RefPtr<void*>&&, CachedScript* = nullptr, bool = false)
    {
    }
    // void reportUnhandledPromiseRejection(JSC::JSGlobalObject&, JSC::JSPromise&, RefPtr<Inspector::ScriptCallStack>&&)
    // {
    // }

#if ENABLE(WEB_CRYPTO)
    // These two methods are used when CryptoKeys are serialized into IndexedDB. As a side effect, it is also
    // used for things that utilize the same structure clone algorithm, for example, message passing between
    // worker and document.

    // For now these will return false. In the future, we will want to implement these similar to how WorkerGlobalScope.cpp does.
    // virtual bool wrapCryptoKey(const Vector<uint8_t>& key, Vector<uint8_t>& wrappedKey) = 0;
    // virtual bool unwrapCryptoKey(const Vector<uint8_t>& wrappedKey, Vector<uint8_t>& key) = 0;
    bool wrapCryptoKey(const Vector<uint8_t>& key, Vector<uint8_t>& wrappedKey) { return false; }
    bool unwrapCryptoKey(const Vector<uint8_t>& wrappedKey, Vector<uint8_t>& key) { return false; }
#endif

    WEBCORE_EXPORT static bool postTaskTo(ScriptExecutionContextIdentifier identifier, Function<void(ScriptExecutionContext&)>&& task);
    WEBCORE_EXPORT static bool ensureOnContextThread(ScriptExecutionContextIdentifier, Function<void(ScriptExecutionContext&)>&& task);
    WEBCORE_EXPORT static bool ensureOnMainThread(Function<void(ScriptExecutionContext&)>&& task);

    WEBCORE_EXPORT JSC::JSGlobalObject* globalObject();

    void didCreateDestructionObserver(ContextDestructionObserver&);
    void willDestroyDestructionObserver(ContextDestructionObserver&);

    void processMessageWithMessagePortsSoon(CompletionHandler<void()>&&);
    void createdMessagePort(MessagePort&);
    void destroyedMessagePort(MessagePort&);

    void dispatchMessagePortEvents();
    void checkConsistency() const;

    void regenerateIdentifier();
    void addToContextsMap();
    void removeFromContextsMap();

    void postTaskConcurrently(Function<void(ScriptExecutionContext&)>&& lambda)
    {
        auto* task = new EventLoopTask(WTFMove(lambda));
        reinterpret_cast<Zig::GlobalObject*>(m_globalObject)->queueTaskConcurrently(task);
    } // Executes the task on context's thread asynchronously.

    void postTask(Function<void(ScriptExecutionContext&)>&& lambda)
    {
        auto* task = new EventLoopTask(WTFMove(lambda));
        reinterpret_cast<Zig::GlobalObject*>(m_globalObject)->queueTask(task);
    } // Executes the task on context's thread asynchronously.
    void postTask(EventLoopTask* task)
    {
        reinterpret_cast<Zig::GlobalObject*>(m_globalObject)->queueTask(task);
    } // Executes the task on context's thread asynchronously.

    void postTaskOnTimeout(EventLoopTask* task, Seconds timeout)
    {
        reinterpret_cast<Zig::GlobalObject*>(m_globalObject)->queueTaskOnTimeout(task, static_cast<int>(timeout.milliseconds()));
    } // Executes the task on context's thread asynchronously.
    void postTaskOnTimeout(Function<void(ScriptExecutionContext&)>&& lambda, Seconds timeout)
    {
        auto* task = new EventLoopTask(WTFMove(lambda));
        postTaskOnTimeout(task, timeout);
    }

    template<typename... Arguments>
    void postCrossThreadTask(Arguments&&... arguments)
    {
        postTask([crossThreadTask = createCrossThreadTask(arguments...)](ScriptExecutionContext&) mutable {
            crossThreadTask.performTask();
        });
    }

    JSC::VM& vm() { return *m_vm; }
    ScriptExecutionContextIdentifier identifier() const { return m_identifier; }

    bool isWorker = false;
    void setGlobalObject(JSC::JSGlobalObject* globalObject)
    {
        m_globalObject = globalObject;
        m_vm = &globalObject->vm();
    }

    BunBroadcastChannelRegistry& broadcastChannelRegistry() { return m_broadcastChannelRegistry; }

private:
    JSC::VM* m_vm = nullptr;
    JSC::JSGlobalObject* m_globalObject = nullptr;
    WTF::URL m_url = WTF::URL();
    ScriptExecutionContextIdentifier m_identifier;

    HashSet<MessagePort*> m_messagePorts;
    HashSet<ContextDestructionObserver*> m_destructionObservers;
    Vector<CompletionHandler<void()>> m_processMessageWithMessagePortsSoonHandlers;
    Ref<BunBroadcastChannelRegistry> m_broadcastChannelRegistry;

    bool m_willProcessMessageWithMessagePortsSoon { false };

    us_socket_context_t* webSocketContextSSL();
    us_socket_context_t* webSocketContextNoSSL();
    us_socket_context_t* connectedWebSocketKindClientSSL();
    us_socket_context_t* connectedWebSocketKindClient();

    us_socket_context_t* m_ssl_client_websockets_ctx = nullptr;
    us_socket_context_t* m_client_websockets_ctx = nullptr;

    us_socket_context_t* m_connected_ssl_client_websockets_ctx = nullptr;
    us_socket_context_t* m_connected_client_websockets_ctx = nullptr;

public:
    template<bool isSSL, bool isServer>
    us_socket_context_t* connectedWebSocketContext()
    {
        if constexpr (isSSL) {
            if (!m_connected_ssl_client_websockets_ctx) {
                m_connected_ssl_client_websockets_ctx = connectedWebSocketKindClientSSL();
            }

            return m_connected_ssl_client_websockets_ctx;
        } else {
            if (!m_connected_client_websockets_ctx) {
                m_connected_client_websockets_ctx = connectedWebSocketKindClient();
            }

            return m_connected_client_websockets_ctx;
        }
    }
};

ScriptExecutionContext* executionContext(JSC::JSGlobalObject*);

}