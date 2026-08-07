#include "config.h"
#include <JavaScriptCore/VM.h>
#include "JSCTaskScheduler.h"
#include "BunClientData.h"
#include <JavaScriptCore/JSFinalizationRegistry.h>
#include <JavaScriptCore/StrongInlines.h>
#include <JavaScriptCore/WeakMapImplInlines.h>
#include <JavaScriptCore/JSCInlines.h>

using Ticket = JSC::DeferredWorkTimer::Ticket;
using Task = JSC::DeferredWorkTimer::Task;

namespace Bun {
using namespace JSC;

extern "C" void Bun__queueJSCDeferredWorkTaskConcurrently(void* bunVM, void* task);
extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);

class JSCDeferredWorkTask {
public:
    JSCDeferredWorkTask(Ref<Ticket> ticket, Task&& task)
        : ticket(WTF::move(ticket))
        , task(WTF::move(task))
    {
    }

    Ref<Ticket> ticket;
    Task task;
    ~JSCDeferredWorkTask()
    {
    }

    JSC::VM& vm() const { return ticket->scriptExecutionOwner()->vm(); }

    WTF_MAKE_TZONE_ALLOCATED(JSCDeferredWorkTask);
};

// Drop `ticket` from whichever pending set holds it. Caller holds m_lock; the
// event-loop ref is balanced after the caller releases the lock.
static bool dropPendingTicketLocked(Bun::JSCTaskScheduler& scheduler, Ticket* ticket) WTF_REQUIRES_LOCK(scheduler.m_lock)
{
    bool isKeepingEventLoopAlive = scheduler.m_pendingTicketsKeepingEventLoopAlive.removeIf([ticket](auto pendingTicket) {
        return pendingTicket.ptr() == ticket;
    });
    // -- At this point, ticket may be an invalid pointer.
    if (!isKeepingEventLoopAlive) {
        scheduler.m_pendingTicketsOther.removeIf([ticket](auto pendingTicket) {
            return pendingTicket.ptr() == ticket;
        });
    }
    return isKeepingEventLoopAlive;
}

void JSCTaskScheduler::onAddPendingWork(WebCore::JSVMClientData* clientData, Ref<Ticket>&& ticket, JSC::DeferredWorkTimer::WorkType kind)
{
    auto& scheduler = clientData->deferredWorkTimer;
    Locker<Lock> holder { scheduler.m_lock };
    if (scheduler.m_isShuttingDown) [[unlikely]]
        return;
    if (kind == DeferredWorkTimer::WorkType::ImminentlyScheduled) {
        Bun__eventLoop__incrementRefConcurrently(clientData->bunVM, 1);
        scheduler.m_pendingTicketsKeepingEventLoopAlive.add(WTF::move(ticket));
    } else {
        scheduler.m_pendingTicketsOther.add(WTF::move(ticket));
    }
}
void JSCTaskScheduler::onScheduleWorkSoon(WebCore::JSVMClientData* clientData, Ref<Ticket>&& ticket, Task&& task)
{
    auto& scheduler = clientData->deferredWorkTimer;
    Locker<Lock> holder { scheduler.m_lock };
    // The event loop is past its last tick; a JSCDeferredWorkTask enqueued now
    // would never run and its ConcurrentTask wrapper would leak once the Bun
    // VirtualMachine box is dealloc'd. Reached from ~VM -> WaiterListManager::
    // unregister -> Waiter::cancelAndClear for every outstanding
    // Atomics.waitAsync on a terminating worker, and from collectNow ->
    // JSFinalizationRegistry::finalizeUnconditionally. Balance onAddPendingWork
    // so the ticket-set entry and event-loop ref are released. The lock is held
    // across the check and the enqueue so the transition in markShuttingDown
    // cannot race a cross-thread Atomics.notify.
    if (scheduler.m_isShuttingDown) [[unlikely]] {
        bool wasKeepingAlive = dropPendingTicketLocked(scheduler, ticket.ptr());
        holder.unlockEarly();
        if (wasKeepingAlive)
            Bun__eventLoop__incrementRefConcurrently(clientData->bunVM, -1);
        return;
    }
    auto* job = new JSCDeferredWorkTask(WTF::move(ticket), WTF::move(task));
    Bun__queueJSCDeferredWorkTaskConcurrently(clientData->bunVM, job);
}

void JSCTaskScheduler::onCancelPendingWork(WebCore::JSVMClientData* clientData, Ticket& ticket)
{
    auto* bunVM = clientData->bunVM;
    auto& scheduler = clientData->deferredWorkTimer;

    Locker<Lock> holder { scheduler.m_lock };
    bool wasKeepingAlive = dropPendingTicketLocked(scheduler, &ticket);
    holder.unlockEarly();
    if (wasKeepingAlive)
        Bun__eventLoop__incrementRefConcurrently(bunVM, -1);
}

void JSCTaskScheduler::rootFinalizationRegistry(JSC::VM& vm, JSC::JSFinalizationRegistry* registry)
{
    ASSERT(vm.currentThreadIsHoldingAPILock());
    auto result = m_rootedFinalizationRegistries.add(registry, JSC::Strong<JSC::JSObject>());
    if (result.isNewEntry)
        result.iterator->value.set(vm, registry);
}

void JSCTaskScheduler::unrootFinalizationRegistryIfDrained(JSC::JSFinalizationRegistry* registry)
{
    if (!m_rootedFinalizationRegistries.contains(registry))
        return;
    {
        Locker cellLocker { registry->cellLock() };
        if (registry->liveCount(cellLocker) || registry->deadCount(cellLocker))
            return;
    }
    m_rootedFinalizationRegistries.remove(registry);
}

static void runPendingWork(void* bunVM, Bun::JSCTaskScheduler& scheduler, JSCDeferredWorkTask* job)
{
    Locker<Lock> holder { scheduler.m_lock };
    auto pendingTicket = scheduler.m_pendingTicketsKeepingEventLoopAlive.take(job->ticket);
    if (!pendingTicket) {
        pendingTicket = scheduler.m_pendingTicketsOther.take(job->ticket);
    } else {
        Bun__eventLoop__incrementRefConcurrently(bunVM, -1);
    }
    holder.unlockEarly();

    if (pendingTicket && !pendingTicket->isCancelled()) {
        job->task(job->ticket.get());
        if (auto* registry = dynamicDowncast<JSC::JSFinalizationRegistry>(job->ticket->target()))
            scheduler.unrootFinalizationRegistryIfDrained(registry);
    }

    delete job;
}

extern "C" void Bun__runDeferredWork(Bun::JSCDeferredWorkTask* job)
{
    auto& vm = job->vm();
    auto clientData = WebCore::clientData(vm);

    runPendingWork(clientData->bunVM, clientData->deferredWorkTimer, job);
}

// Flip m_isShuttingDown from the owning JS thread before the final concurrent-
// task drain. Any onScheduleWorkSoon that serializes before this under m_lock
// has its enqueue visible to the drain; any that serializes after drops.
extern "C" void Bun__JSCTaskScheduler__markShuttingDown(JSC::JSGlobalObject* globalObject)
{
    if (auto* clientData = WebCore::clientData(JSC::getVM(globalObject))) {
        clientData->deferredWorkTimer.m_rootedFinalizationRegistries.clear();
        clientData->deferredWorkTimer.markShuttingDown();
    }
}

ALWAYS_INLINE static JSFinalizationRegistry* getFinalizationRegistry(VM& vm, JSGlobalObject* globalObject, JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value.isObject()) [[unlikely]] {
        throwTypeError(globalObject, scope, "Called FinalizationRegistry function on non-object"_s);
        return nullptr;
    }
    if (auto* registry = dynamicDowncast<JSFinalizationRegistry>(asObject(value))) [[likely]]
        return registry;
    throwTypeError(globalObject, scope, "Called FinalizationRegistry function on a non-FinalizationRegistry object"_s);
    return nullptr;
}

JSC_DEFINE_HOST_FUNCTION(bunProtoFuncFinalizationRegistryRegister, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* registry = getFinalizationRegistry(vm, globalObject, callFrame->thisValue());
    RETURN_IF_EXCEPTION(scope, {});

    JSValue target = callFrame->argument(0);
    if (!canBeHeldWeakly(target)) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "register requires an object or a non-registered symbol as the target"_s);

    JSValue holdings = callFrame->argument(1);
    if (target == holdings) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "register expects the target object and the holdings parameter are not the same. Otherwise, the target can never be collected"_s);

    JSValue unregisterToken = callFrame->argument(2);
    if (!unregisterToken.isUndefined() && !canBeHeldWeakly(unregisterToken)) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "register requires an object or a non-registered symbol as the unregistration token"_s);

    registry->registerTarget(vm, target.asCell(), holdings, unregisterToken);

    if (auto* clientData = WebCore::clientData(vm))
        clientData->deferredWorkTimer.rootFinalizationRegistry(vm, registry);
    return encodedJSUndefined();
}

JSC_DEFINE_HOST_FUNCTION(bunProtoFuncFinalizationRegistryUnregister, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* registry = getFinalizationRegistry(vm, globalObject, callFrame->thisValue());
    RETURN_IF_EXCEPTION(scope, {});

    JSValue token = callFrame->argument(0);
    if (!canBeHeldWeakly(token)) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "unregister requires an object or a non-registered symbol as the unregistration token"_s);

    bool result = registry->unregister(vm, token.asCell());
    if (result) {
        if (auto* clientData = WebCore::clientData(vm))
            clientData->deferredWorkTimer.unrootFinalizationRegistryIfDrained(registry);
    }
    return JSValue::encode(jsBoolean(result));
}

void installFinalizationRegistryPrototypeHooks(JSC::JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    JSObject* prototype = globalObject->finalizationRegistryStructure()->storedPrototypeObject();
    prototype->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "register"_s), 2, bunProtoFuncFinalizationRegistryRegister, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(PropertyAttribute::DontEnum));
    prototype->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "unregister"_s), 1, bunProtoFuncFinalizationRegistryUnregister, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(PropertyAttribute::DontEnum));
}

// Reclaim a queued-but-never-dispatched job during shutdown. Called while the
// JSC VM is still alive, so ~Ref<Ticket> and the captured Task lambda may
// safely touch TZone-allocated / JSC-owned state. Mirrors runPendingWork's
// ticket take() so the pending set and event-loop ref stay balanced.
extern "C" void Bun__deleteDeferredWorkTask(Bun::JSCDeferredWorkTask* job)
{
    if (auto* clientData = WebCore::clientData(job->vm())) {
        auto& scheduler = clientData->deferredWorkTimer;
        Locker<Lock> holder { scheduler.m_lock };
        bool wasKeepingAlive = dropPendingTicketLocked(scheduler, job->ticket.ptr());
        holder.unlockEarly();
        if (wasKeepingAlive)
            Bun__eventLoop__incrementRefConcurrently(clientData->bunVM, -1);
    }
    delete job;
}

}
