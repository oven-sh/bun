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
#include <uws/src/WebSocketContext.h>
struct us_socket_t;
struct us_socket_context_t;

namespace WebCore {

class ScriptExecutionContext : public CanMakeWeakPtr<ScriptExecutionContext> {

public:
    ScriptExecutionContext(JSC::VM* vm, JSC::JSGlobalObject* globalObject)
        : m_vm(vm)
        , m_globalObject(globalObject)
    {
    }
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

    JSC::JSGlobalObject* jsGlobalObject()
    {
        return m_globalObject;
    }

    template<bool isSSL>
    us_socket_context_t* webSocketContext();

    template<bool isSSL, bool isServer>
    uWS::WebSocketContext<isSSL, isServer, ScriptExecutionContext*>* connnectedWebSocketContext();

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

    us_socket_context_t* m_ssl_client_websockets_ctx = nullptr;
    us_socket_context_t* m_client_websockets_ctx = nullptr;

    uWS::WebSocketContext<true, false, ScriptExecutionContext*>* m_ssl_client_websockets_ctx = nullptr;
    uWS::WebSocketContext<true, true, ScriptExecutionContext*>* m_client_websockets_ctx = nullptr;
};
}