#pragma once

#include "root.h"
#include "ActiveDOMObject.h"
#include <wtf/CrossThreadTask.h>
#include <wtf/Function.h>
#include <wtf/HashSet.h>
#include <wtf/ObjectIdentifier.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>
#include "CachedScript.h"
#include "wtf/URL.h"

namespace uWS {
template<bool isServer, bool isClient, typename UserData>
struct WebSocketContext;

}
struct us_socket_t;
struct us_socket_context_t;
struct us_loop_t;

namespace WebCore {

class WebSocket;

class ScriptExecutionContext : public CanMakeWeakPtr<ScriptExecutionContext> {
public:
    class Task {
        WTF_MAKE_FAST_ALLOCATED;

    public:
        enum CleanupTaskTag { CleanupTask };

        template<typename T, typename = typename std::enable_if<!std::is_base_of<Task, T>::value && std::is_convertible<T, Function<void(ScriptExecutionContext&)>>::value>::type>
        Task(T task)
            : m_task(WTFMove(task))
            , m_isCleanupTask(false)
        {
        }

        Task(Function<void()>&& task)
            : m_task([task = WTFMove(task)](ScriptExecutionContext&) { task(); })
            , m_isCleanupTask(false)
        {
        }

        template<typename T, typename = typename std::enable_if<std::is_convertible<T, Function<void(ScriptExecutionContext&)>>::value>::type>
        Task(CleanupTaskTag, T task)
            : m_task(WTFMove(task))
            , m_isCleanupTask(true)
        {
        }

        void performTask(ScriptExecutionContext& context) { m_task(context); }
        bool isCleanupTask() const { return m_isCleanupTask; }

    protected:
        Function<void(ScriptExecutionContext&)> m_task;
        bool m_isCleanupTask;
    };

public:
    ScriptExecutionContext(JSC::VM* vm, JSC::JSGlobalObject* globalObject)
        : m_vm(vm)
        , m_globalObject(globalObject)
    {
    }

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

    const WTF::URL& url() const { return m_url; }
    bool activeDOMObjectsAreSuspended() { return false; }
    bool activeDOMObjectsAreStopped() { return false; }
    bool isContextThread() { return true; }
    bool isDocument() { return false; }
    bool isWorkerGlobalScope() { return true; }
    bool isJSExecutionForbidden() { return false; }
    void reportException(const String& errorMessage, int lineNumber, int columnNumber, const String& sourceURL, JSC::Exception* exception, RefPtr<void*>&&, CachedScript* = nullptr, bool = false)
    {
    }
    // void reportUnhandledPromiseRejection(JSC::JSGlobalObject&, JSC::JSPromise&, RefPtr<Inspector::ScriptCallStack>&&)
    // {
    // }

    void postTask(Task&& task)
    {

    } // Executes the task on context's thread asynchronously.

    template<typename... Arguments>
    void postCrossThreadTask(Arguments&&... arguments)
    {
        postTask([crossThreadTask = createCrossThreadTask(arguments...)](ScriptExecutionContext&) mutable {
            crossThreadTask.performTask();
        });
    }

    JSC::VM& vm() { return *m_vm; }

private:
    JSC::VM* m_vm = nullptr;
    JSC::JSGlobalObject* m_globalObject = nullptr;
    WTF::URL m_url = WTF::URL();

    us_socket_context_t* webSocketContextSSL();
    us_socket_context_t* webSocketContextNoSSL();
    uWS::WebSocketContext<true, false, WebSocket*>* connectedWebSocketKindClientSSL();
    uWS::WebSocketContext<false, false, WebSocket*>* connectedWebSocketKindClient();

    us_socket_context_t* m_ssl_client_websockets_ctx = nullptr;
    us_socket_context_t* m_client_websockets_ctx = nullptr;

    uWS::WebSocketContext<true, false, WebSocket*>* m_connected_ssl_client_websockets_ctx = nullptr;
    uWS::WebSocketContext<false, false, WebSocket*>* m_connected_client_websockets_ctx = nullptr;

public:
    template<bool isSSL, bool isServer>
    uWS::WebSocketContext<isSSL, isServer, WebSocket*>* connnectedWebSocketContext()
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
}