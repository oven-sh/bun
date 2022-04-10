#pragma once

#include "root.h"
#include <wtf/CrossThreadTask.h>
#include <wtf/Function.h>
#include <wtf/HashSet.h>
#include <wtf/ObjectIdentifier.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>
#include "CachedScript.h"
#include "wtf/URL.h"
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
    const WTF::URL& url() const { return m_url; }
    bool activeDOMObjectsAreSuspended() { return false; }
    bool activeDOMObjectsAreStopped() { return false; }
    bool isContextThread() { return true; }
    bool isDocument() { return false; }
    bool isWorkerGlobalScope() { return true; }
    bool isJSExecutionForbidden() { return false; }

    EventLoopTaskGroup& eventLoop() { return m_eventLoop; }

    void reportException(const String& errorMessage, int lineNumber, int columnNumber, const String& sourceURL, JSC::Exception* exception, RefPtr<void*>&&, CachedScript* = nullptr, bool = false)
    {
    }
    void reportUnhandledPromiseRejection(JSC::JSGlobalObject&, JSC::JSPromise&, RefPtr<Inspector::ScriptCallStack>&&)
    {
    }
    // Called from the constructor and destructors of ActiveDOMObject.
    void didCreateActiveDOMObject(ActiveDOMObject&);
    void willDestroyActiveDOMObject(ActiveDOMObject&);

    // Called after the construction of an ActiveDOMObject to synchronize suspend state.
    void suspendActiveDOMObjectIfNeeded(ActiveDOMObject&);

    void didCreateDestructionObserver(ContextDestructionObserver&);
    void willDestroyDestructionObserver(ContextDestructionObserver&);

    // MessagePort is conceptually a kind of ActiveDOMObject, but it needs to be tracked separately for message dispatch.
    void processMessageWithMessagePortsSoon();
    void dispatchMessagePortEvents();
    void createdMessagePort(MessagePort&);
    void destroyedMessagePort(MessagePort&);

    ReasonForSuspension reasonForSuspendingActiveDOMObjects() const { return m_reasonForSuspendingActiveDOMObjects; }

    bool hasPendingActivity() const;
    void removeFromContextsMap();
    void removeRejectedPromiseTracker();
    void regenerateIdentifier();

    void postTask(Task&&)
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

    enum class ShouldContinue { No,
        Yes };
    void forEachActiveDOMObject(const Function<ShouldContinue(ActiveDOMObject&)>&) const;
    RejectedPromiseTracker& ensureRejectedPromiseTrackerSlow();
    HashSet<MessagePort*> m_messagePorts;
    HashSet<ContextDestructionObserver*> m_destructionObservers;
    HashSet<ActiveDOMObject*> m_activeDOMObjects;
    std::unique_ptr<RejectedPromiseTracker> m_rejectedPromiseTracker;

    ReasonForSuspension m_reasonForSuspendingActiveDOMObjects { static_cast<ReasonForSuspension>(-1) };
    bool m_activeDOMObjectsAreSuspended { false };
    bool m_activeDOMObjectsAreStopped { false };
    bool m_inDispatchErrorEvent { false };
    mutable bool m_activeDOMObjectAdditionForbidden { false };
    bool m_willprocessMessageWithMessagePortsSoon { false };
};
}