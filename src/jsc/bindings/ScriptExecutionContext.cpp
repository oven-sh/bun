#include "root.h"
#include "headers.h"
#include "ScriptExecutionContext.h"
#include "ActiveDOMObject.h"
#include "ContextDestructionObserver.h"

#include "libusockets.h"
#include "_libusockets.h"
#include "BunClientData.h"
#include "BunWorkerGlobalScope.h"
#include "EventLoopTask.h"
#include "Performance.h"
#include "ZigGlobalObject.h"
#include <wtf/SetForScope.h>
#include <wtf/Threading.h>
extern "C" void Bun__startLoop(us_loop_t* loop);

namespace WebCore {
static constexpr ScriptExecutionContextIdentifier INITIAL_IDENTIFIER_INTERNAL = 1;

static std::atomic<unsigned> lastUniqueIdentifier = INITIAL_IDENTIFIER_INTERNAL;

#if ASSERT_ENABLED
static ScriptExecutionContextIdentifier initialIdentifier()
{
    static bool hasCalledInitialIdentifier = false;
    ASSERT_WITH_MESSAGE(!hasCalledInitialIdentifier, "ScriptExecutionContext::initialIdentifier() cannot be called more than once. Use generateIdentifier() instead.");
    hasCalledInitialIdentifier = true;
    return INITIAL_IDENTIFIER_INTERNAL;
}
#else
static ScriptExecutionContextIdentifier initialIdentifier()
{
    return INITIAL_IDENTIFIER_INTERNAL;
}
#endif

#if ENABLE(MALLOC_BREAKDOWN)
DEFINE_ALLOCATOR_WITH_HEAP_IDENTIFIER(ScriptExecutionContext);
#endif

ScriptExecutionContext::ScriptExecutionContext(JSC::VM* vm, Zig::GlobalObject* globalObject)
    : m_vm(vm)
    , m_globalObject(globalObject)
    , m_bunVM(WebCore::clientData(*vm)->bunVM)
    , m_vmHandle(WebCore::clientData(*vm)->vmHandle)
    , m_identifier(initialIdentifier())
    , m_contextThreadUID(Thread::currentSingleton().uid())
{
    relaxAdoptionRequirement();
    addToContextsMap();
}

ScriptExecutionContext::ScriptExecutionContext(JSC::VM* vm, Zig::GlobalObject* globalObject, ScriptExecutionContextIdentifier identifier)
    : m_vm(vm)
    , m_globalObject(globalObject)
    , m_bunVM(WebCore::clientData(*vm)->bunVM)
    , m_vmHandle(WebCore::clientData(*vm)->vmHandle)
    , m_identifier(identifier == std::numeric_limits<int32_t>::max() ? ++lastUniqueIdentifier : identifier)
    , m_contextThreadUID(Thread::currentSingleton().uid())
{
    relaxAdoptionRequirement();
    addToContextsMap();
}

static Lock allScriptExecutionContextsMapLock;
static HashMap<ScriptExecutionContextIdentifier, ScriptExecutionContext*>& allScriptExecutionContextsMap() WTF_REQUIRES_LOCK(allScriptExecutionContextsMapLock)
{
    static NeverDestroyed<HashMap<ScriptExecutionContextIdentifier, ScriptExecutionContext*>> contexts;
    ASSERT(allScriptExecutionContextsMapLock.isLocked());
    return contexts;
}

ScriptExecutionContext* ScriptExecutionContext::getScriptExecutionContext(ScriptExecutionContextIdentifier identifier)
{
    if (identifier == 0) {
        return nullptr;
    }
    Locker locker { allScriptExecutionContextsMapLock };
    return allScriptExecutionContextsMap().getOptional(identifier).value_or(nullptr);
}

JSGlobalObject* ScriptExecutionContext::globalObject()
{
    return m_globalObject;
}

JSGlobalObject* ScriptExecutionContext::jsGlobalObject()
{
    return m_globalObject;
}

extern "C" void Bun__VM__queueTask(void* bunVM, EventLoopTask*);
extern "C" void Bun__VmHandle__queueTaskConcurrently(::BunVmHandle*, EventLoopTask*);

// JS thread (this context's thread): MessagePort / BroadcastChannel / worker global scope
// keep-alives. Direct, so a ref taken before teardown is still released during it.
void ScriptExecutionContext::refEventLoop()
{
    Bun__eventLoop__refKeepAlive(m_bunVM, 1);
}
void ScriptExecutionContext::unrefEventLoop()
{
    Bun__eventLoop__refKeepAlive(m_bunVM, -1);
}

ScriptExecutionContext::~ScriptExecutionContext()
{
    checkConsistency();

#if ASSERT_ENABLED
    {
        Locker locker { allScriptExecutionContextsMapLock };
        ASSERT_WITH_MESSAGE(!allScriptExecutionContextsMap().contains(m_identifier), "A ScriptExecutionContext subclass instance implementing postTask should have already removed itself from the map");
    }
    m_inScriptExecutionContextDestructor = true;
#endif // ASSERT_ENABLED

    while (RefPtr destructionObserver = m_destructionObservers.takeAny())
        destructionObserver->contextDestroyed();

#if ASSERT_ENABLED
    m_inScriptExecutionContextDestructor = false;
#endif // ASSERT_ENABLED
}

void ScriptExecutionContext::forEachActiveDOMObject(NOESCAPE const Function<ShouldContinue(ActiveDOMObject&)>& apply) const
{
    // It is not allowed to run arbitrary script or construct new ActiveDOMObjects while we are iterating over ActiveDOMObjects.
    // A RELEASE_ASSERT will fire if this happens, but it's important to code
    // stop() functions so it will not happen!
    SetForScope activeDOMObjectAdditionForbiddenScope(m_activeDOMObjectAdditionForbidden, true);

    // Make a frozen copy of the objects so we can iterate while new ones might be destroyed.
    auto possibleActiveDOMObjects = copyToVectorOf<WeakPtr<ActiveDOMObject>>(m_activeDOMObjects);
    for (auto& weakActiveDOMObject : possibleActiveDOMObjects) {
        RefPtr activeDOMObject = weakActiveDOMObject.get();
        if (activeDOMObject && apply(*activeDOMObject) == ShouldContinue::No)
            break;
    }
}

void ScriptExecutionContext::stopActiveDOMObjects()
{
    checkConsistency();

    if (m_activeDOMObjectsAreStopped)
        return;
    m_activeDOMObjectsAreStopped = true;

    forEachActiveDOMObject([](auto& activeDOMObject) {
        activeDOMObject.stop();
        return ShouldContinue::Yes;
    });
}

void ScriptExecutionContext::suspendActiveDOMObjectIfNeeded(ActiveDOMObject& activeDOMObject)
{
    ASSERT(m_activeDOMObjects.contains(activeDOMObject));
    if (m_activeDOMObjectsAreStopped)
        activeDOMObject.stop();
}

void ScriptExecutionContext::didCreateActiveDOMObject(ActiveDOMObject& activeDOMObject)
{
    // The m_activeDOMObjectAdditionForbidden check is a RELEASE_ASSERT because of the
    // consequences of having an ActiveDOMObject that is not correctly reflected in the set.
    // If we do have one of those, it can possibly be a security vulnerability. So we'd
    // rather have a crash than continue running with the set possibly compromised.
    ASSERT(!m_inScriptExecutionContextDestructor);
    RELEASE_ASSERT(!m_activeDOMObjectAdditionForbidden);
    m_activeDOMObjects.add(activeDOMObject);
}

void ScriptExecutionContext::willDestroyActiveDOMObject(ActiveDOMObject& activeDOMObject)
{
    m_activeDOMObjects.remove(activeDOMObject);
}

bool ScriptExecutionContext::postTaskTo(ScriptExecutionContextIdentifier identifier, Function<void(ScriptExecutionContext&)>&& task)
{
    Locker locker { allScriptExecutionContextsMapLock };
    auto* context = allScriptExecutionContextsMap().get(identifier);

    if (!context)
        return false;

    // A permanently-terminating context never drains its concurrent queue, so a task
    // enqueued during teardown would leak its captured refs (e.g. notifyPeerClosed
    // pinning the MessagePortPipe) — drop it. Gate on the worker-teardown flag, not
    // VM::hasTerminationRequest(), which node:vm {timeout}/{breakOnSigint} sets transiently.
    if (context->isTerminating())
        return false;

    context->postTaskConcurrently(WTF::move(task));
    return true;
}

void ScriptExecutionContext::didCreateDestructionObserver(ContextDestructionObserver& observer)
{
#if ASSERT_ENABLED
    ASSERT(!m_inScriptExecutionContextDestructor);
#endif // ASSERT_ENABLED
    m_destructionObservers.add(observer);
}

void ScriptExecutionContext::willDestroyDestructionObserver(ContextDestructionObserver& observer)
{
    m_destructionObservers.remove(observer);
}

bool ScriptExecutionContext::isJSExecutionForbidden()
{
    return !m_vm || m_vm->executionForbidden();
}

void ScriptExecutionContext::prepareForDestruction()
{
    ASSERT(isContextThread());
    ASSERT(m_globalObject);

    stopActiveDOMObjects();

    // Event listeners would keep DOMWrapperWorld objects alive for too long. Also, they have references to JS objects,
    // which become dangling once Heap is destroyed.
    removeAllEventListeners();
}

void ScriptExecutionContext::removeAllEventListeners()
{
    m_globalObject->globalEventScope->removeAllEventListeners();
    if (RefPtr performance = m_globalObject->existingPerformance()) {
        performance->removeAllEventListeners();
        performance->removeAllObservers();
    }
}

void ScriptExecutionContext::globalObjectDestroyed()
{
    ASSERT(isContextThread());
    // A global collected on a live VM (ShadowRealm, a retired `bun test --isolate` global) never
    // went through prepareForDestruction(); its context-owned targets still hold listeners and the
    // Performance <-> PerformanceObserver cycle.
    removeAllEventListeners();
    removeFromContextsMap();
    m_globalObject = nullptr;
    m_vm = nullptr;
}

bool ScriptExecutionContext::isContextThread()
{
    return m_contextThreadUID == Thread::currentSingleton().uid();
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
            context->postTaskConcurrently(WTF::move(task));
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

    context->postTaskConcurrently(WTF::move(task));
    return true;
}

ScriptExecutionContext* ScriptExecutionContext::getMainThreadScriptExecutionContext()
{
    Locker locker { allScriptExecutionContextsMapLock };
    return allScriptExecutionContextsMap().get(1);
}

void ScriptExecutionContext::checkConsistency() const
{
#if ASSERT_ENABLED
    for (auto& destructionObserver : m_destructionObservers)
        ASSERT(destructionObserver.scriptExecutionContext() == this);

    // This can run on a GC thread.
    for (SUPPRESS_UNCOUNTED_LOCAL auto& activeDOMObject : m_activeDOMObjects) {
        ASSERT(activeDOMObject.scriptExecutionContext() == this);
        activeDOMObject.assertSuspendIfNeededWasCalled();
    }
#endif // ASSERT_ENABLED
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

void ScriptExecutionContext::markTerminating()
{
    // postTaskTo() holds this lock across its isTerminating() check and
    // postTaskConcurrently() enqueue. Taking it here establishes an ordering
    // with every concurrent poster: either its whole critical section ran
    // before ours (task enqueued, and the caller's subsequent concurrent-queue
    // drain will see it), or ours ran first (poster observes true and drops
    // the task instead of enqueueing onto a queue that will never drain).
    Locker locker { allScriptExecutionContextsMapLock };
    m_isTerminating.store(true, std::memory_order_release);
}

ScriptExecutionContext* executionContext(JSC::JSGlobalObject* globalObject)
{
    if (!globalObject || !globalObject->inherits<JSDOMGlobalObject>())
        return nullptr;
    return uncheckedDowncast<JSDOMGlobalObject>(globalObject)->scriptExecutionContext();
}

void ScriptExecutionContext::postTaskConcurrently(Function<void(ScriptExecutionContext&)>&& lambda)
{
    Bun__VmHandle__queueTaskConcurrently(m_vmHandle, new EventLoopTask(WTF::move(lambda)));
}
// Executes the task on context's thread asynchronously.
void ScriptExecutionContext::postTask(Function<void(ScriptExecutionContext&)>&& lambda)
{
    Bun__VM__queueTask(m_bunVM, new EventLoopTask(WTF::move(lambda)));
}
// Executes the task on context's thread asynchronously.
void ScriptExecutionContext::postTask(EventLoopTask* task)
{
    Bun__VM__queueTask(m_bunVM, task);
}

// Native bindings
extern "C" ScriptExecutionContextIdentifier ScriptExecutionContextIdentifier__forGlobalObject(JSC::JSGlobalObject* globalObject)
{
    return defaultGlobalObject(globalObject)->scriptExecutionContext()->identifier();
}

extern "C" JSC::JSGlobalObject* ScriptExecutionContextIdentifier__getGlobalObject(ScriptExecutionContextIdentifier id)
{
    auto* context = ScriptExecutionContext::getScriptExecutionContext(id);
    if (!context) return nullptr;
    return context->globalObject();
}

} // namespace WebCore
