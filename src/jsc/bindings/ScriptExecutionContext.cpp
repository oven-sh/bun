#include "root.h"
#include "headers.h"
#include "ScriptExecutionContext.h"
#include "ContextDestructionObserver.h"

#include "libusockets.h"
#include "_libusockets.h"
#include "BunClientData.h"
#include "EventLoopTask.h"
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

ScriptExecutionContext::ScriptExecutionContext(JSC::VM* vm, JSC::JSGlobalObject* globalObject)
    : m_vm(vm)
    , m_globalObject(globalObject)
    , m_identifier(initialIdentifier())
    , m_contextThreadUID(Thread::currentSingleton().uid())
{
    relaxAdoptionRequirement();
    addToContextsMap();
}

ScriptExecutionContext::ScriptExecutionContext(JSC::VM* vm, JSC::JSGlobalObject* globalObject, ScriptExecutionContextIdentifier identifier)
    : m_vm(vm)
    , m_globalObject(globalObject)
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

// Like the overload above (including the isTerminating() gate — a grandchild's
// dispatchExit can observe its parent context between markTerminating() and
// removeFromContextsMap()), except `betweenLookupAndEnqueue()` runs after the
// target context is found-live but before the task is enqueued (i.e. before
// the target thread can observe / run / destroy it). The map lock is held
// across the callback. Used by `Worker::dispatchExit` so the worker thread can
// release its create-time ref while the lambda's captured `Ref` is still owned
// by the worker-thread stack — once enqueued, the parent could run and destroy
// it before the calling frame resumes, making any later `deref()` on the worker
// thread potentially the last (~Worker on the wrong thread, EventListenerMap
// thread-UID assert).
bool ScriptExecutionContext::postTaskTo(ScriptExecutionContextIdentifier identifier, NOESCAPE const WTF::Function<void()>& betweenLookupAndEnqueue, Function<void(ScriptExecutionContext&)>&& task)
{
    Locker locker { allScriptExecutionContextsMapLock };
    auto* context = allScriptExecutionContextsMap().get(identifier);

    if (!context)
        return false;

    if (context->isTerminating())
        return false;

    betweenLookupAndEnqueue();
    context->postTaskConcurrently(WTF::move(task));
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
    // This can legitimately run during context teardown: a ContextDestructionObserver
    // (e.g. a MessagePort kept alive by a pending message-dispatch task) may have its
    // last ref released from within ~ScriptExecutionContext. remove() is safe during
    // teardown (the set is drained one element at a time, not iterated concurrently).
    m_destructionObservers.remove(&observer);
}

bool ScriptExecutionContext::isJSExecutionForbidden()
{
    return !m_vm || m_vm->executionForbidden();
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
    for (auto* destructionObserver : m_destructionObservers)
        ASSERT(destructionObserver->scriptExecutionContext() == this);
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
    auto* task = new EventLoopTask(WTF::move(lambda));
    static_cast<Zig::GlobalObject*>(m_globalObject)->queueTaskConcurrently(task);
}
// Executes the task on context's thread asynchronously.
void ScriptExecutionContext::postTask(Function<void(ScriptExecutionContext&)>&& lambda)
{
    auto* task = new EventLoopTask(WTF::move(lambda));
    static_cast<Zig::GlobalObject*>(m_globalObject)->queueTask(task);
}
// Executes the task on context's thread asynchronously.
void ScriptExecutionContext::postTask(EventLoopTask* task)
{
    static_cast<Zig::GlobalObject*>(m_globalObject)->queueTask(task);
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

extern "C" void ScriptExecutionContext__markTerminating(JSC::JSGlobalObject* globalObject)
{
    if (auto* context = defaultGlobalObject(globalObject)->scriptExecutionContext())
        context->markTerminating();
}

} // namespace WebCore
