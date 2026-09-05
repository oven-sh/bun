#include "root.h"
#include "headers.h"
#include "ScriptExecutionContext.h"
#include "ActiveDOMObject.h"
#include "ContextDestructionObserver.h"

#include "libusockets.h"
#include "_libusockets.h"
#include "BunClientData.h"
#include "GlobalEventScope.h"
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
extern "C" void Bun__VM__queueTaskAfterYield(void* bunVM, EventLoopTask*);
extern "C" void Bun__VmHandle__queueTaskConcurrently(const ::BunVmHandleRef*, EventLoopTask*);

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

    while (auto* destructionObserver = m_destructionObservers.takeAny())
        destructionObserver->contextDestroyed();

#if ASSERT_ENABLED
    m_inScriptExecutionContextDestructor = false;
#endif // ASSERT_ENABLED
}

void ScriptExecutionContext::forEachActiveDOMObject(NOESCAPE const Function<void(ActiveDOMObject&)>& apply) const
{
    // It is not allowed to run arbitrary script or construct new ActiveDOMObjects while we are iterating over ActiveDOMObjects.
    // A RELEASE_ASSERT will fire if this happens, but it's important to code
    // stop() functions so it will not happen!
    SetForScope activeDOMObjectAdditionForbiddenScope(m_activeDOMObjectAdditionForbidden, true);

    // Make a frozen copy of the objects so we can iterate while new ones might be destroyed.
    auto possibleActiveDOMObjects = copyToVectorOf<WeakPtr<ActiveDOMObject>>(m_activeDOMObjects);
    for (auto& weakActiveDOMObject : possibleActiveDOMObjects) {
        RefPtr activeDOMObject = weakActiveDOMObject.get();
        if (activeDOMObject)
            apply(*activeDOMObject);
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

bool ScriptExecutionContext::postTaskTo(ScriptExecutionContextIdentifier identifier, BunLoopKind loopKind, Function<void(ScriptExecutionContext&)>&& task)
{
    // The map lock covers the lookup only. The context may be destroyed the moment the
    // lock is released, so nothing of it is used afterwards except a count taken on its
    // VM handle, and the post goes through that: queued while the VM accepts posts,
    // deleted unrun once it does not (and anything queued during its teardown is
    // released unrun by that teardown). Posting inside the critical section would make
    // every other context's lookup wait on this VM's queue.
    const BunVmHandleRef* retained = nullptr;
    {
        Locker locker { allScriptExecutionContextsMapLock };
        auto* context = allScriptExecutionContextsMap().get(identifier);
        if (!context || context->isTerminating())
            return false;
        retained = Bun__VmHandle__retainRef(context->m_vmHandle);
    }
    Bun__VmHandle__postAndRelease(retained, new EventLoopTask(WTF::move(task)), loopKind);
    return true;
}

void ScriptExecutionContext::didCreateDestructionObserver(ContextDestructionObserver& observer)
{
#if ASSERT_ENABLED
    ASSERT(!m_inScriptExecutionContextDestructor);
#endif // ASSERT_ENABLED
    m_destructionObservers.add(&observer);
}

void ScriptExecutionContext::willDestroyDestructionObserver(ContextDestructionObserver& observer)
{
    m_destructionObservers.remove(&observer);
}

bool ScriptExecutionContext::isJSExecutionForbidden()
{
    return !m_vm || WebCore::clientData(*m_vm)->isStoppingOrStopped(*m_vm);
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
    const BunVmHandleRef* retained = nullptr;
    {
        Locker locker { allScriptExecutionContextsMapLock };
        context = allScriptExecutionContextsMap().get(identifier);
        if (!context)
            return false;
        if (!context->isContextThread())
            retained = Bun__VmHandle__retainRef(context->m_vmHandle);
    }
    if (retained) {
        // Off its thread: as postTaskTo(), through the handle, outside the lock.
        Bun__VmHandle__postAndRelease(retained, new EventLoopTask(WTF::move(task)), BunLoopKind::Regular);
        return true;
    }
    // On its own thread the context cannot be destroyed under us.
    task(*context);
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
    for (auto* destructionObserver : m_destructionObservers)
        ASSERT(destructionObserver->scriptExecutionContext() == this);

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
    // An early-out for postTaskTo(): from here posts to this context are pointless. Not
    // a fence — a poster that looked us up just before this still posts, and the VM
    // handle deals with it (queued and released unrun by the teardown, or refused and
    // deleted once the handle is closed).
    m_isTerminating.store(true, std::memory_order_release);
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
// Same thread; runs on the next loop iteration, after I/O and timers have had a turn.
void ScriptExecutionContext::postTaskAfterYield(Function<void(ScriptExecutionContext&)>&& lambda)
{
    Bun__VM__queueTaskAfterYield(m_bunVM, new EventLoopTask(WTF::move(lambda)));
}

// Native bindings
extern "C" JSC::JSGlobalObject* ScriptExecutionContextIdentifier__getGlobalObject(ScriptExecutionContextIdentifier id)
{
    auto* context = ScriptExecutionContext::getScriptExecutionContext(id);
    if (!context) return nullptr;
    return context->globalObject();
}

} // namespace WebCore
