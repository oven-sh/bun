#include "root.h"

#include "GCPerformanceEntries.h"

#include "BunClientData.h"
#include "EventLoopTask.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/WeakInlines.h>

extern "C" uint64_t Bun__readOriginTimerWithoutFakeTimers(void* bunVM);
extern "C" bool Bun__VM__isEventLoopKeptAlive(void* bunVM);
extern "C" bool Bun__VM__isEventLoopKeptAliveBehindItsTasks(void* bunVM);
extern "C" bool Bun__VM__hasPendingTasks(void* bunVM);
extern "C" void Bun__VM__queueTask(void* bunVM, WebCore::EventLoopTask*);

namespace Bun {

using namespace JSC;

GCPerformanceEntries::GCPerformanceEntries(VM& vm)
    : JSRunLoopTimer(vm)
    , m_vm(vm)
{
}

GCPerformanceEntries::~GCPerformanceEntries()
{
    if (m_observesHeap)
        m_vm.heap.removeObserver(this);
}

void GCPerformanceEntries::willGarbageCollect()
{
    m_collectionStart = MonotonicTime::now();
}

void GCPerformanceEntries::didGarbageCollect(CollectionScope scope)
{
    // A collection that was under way when the first observer came has no start, and so no duration.
    auto start = std::exchange(m_collectionStart, std::nullopt);
    if (!start)
        return;
    {
        Locker locker { m_lock };
        m_records.append({ *start, MonotonicTime::now() - *start, scope == CollectionScope::Full, false });
    }
    setTimeUntilFire(0_s);
    // A timer that is due does not end a wait of the JS thread in the loop. Another thread that ends the collection wakes it here. When it ends one itself, eventLoopWillWait() decides before its next wait.
    if (auto* vmHandle = WebCore::clientData(m_vm)->vmHandle; vmHandle && !m_vm.currentThreadIsHoldingAPILock())
        Bun__VmHandle__wake(vmHandle);
}

bool GCPerformanceEntries::eventLoopWillWait(bool canWaitWithoutHeapAccess)
{
    bool isCollecting = canWaitWithoutHeapAccess && m_collectionStart;
    if (isCollecting) {
        // The phase that waits for this thread runs now, and it can be the last one. The rest runs on the collector thread during the wait, and does not wait for the loop to wake.
        m_vm.heap.stopIfNecessary();
        isCollecting = !!m_collectionStart;
    }
    bool hasRecords;
    {
        Locker locker { m_lock };
        hasRecords = !m_records.isEmpty();
    }
    if (!hasRecords && !isCollecting)
        return false;
    auto* clientData = WebCore::clientData(m_vm);
    if (!Bun__VM__isEventLoopKeptAlive(clientData->bunVM)) {
        // Nothing else holds the loop, so these reach no observer: a process that exits here has delivered none either.
        cancelTimer();
        Locker locker { m_lock };
        m_records.clear();
        m_synchronousRecordEnd = 0;
        return false;
    }
    if (hasRecords) {
        if (auto* vmHandle = clientData->vmHandle)
            Bun__VmHandle__wake(vmHandle);
        return false;
    }
    return true;
}

RefPtr<SharedTask<void()>> GCPerformanceEntries::willCollectSynchronously()
{
    {
        Locker locker { m_lock };
        m_synchronousRecordEnd = 0;
    }
    if (!m_synchronousCollectionDidEnd) {
        // A request runs it in the end phase of its own collection, right after didGarbageCollect().
        m_synchronousCollectionDidEnd = createSharedTask<void()>([this] {
            Locker locker { m_lock };
            m_synchronousRecordEnd = m_records.size();
        });
    }
    return m_synchronousCollectionDidEnd;
}

void GCPerformanceEntries::didForceCollection()
{
    Locker locker { m_lock };
    if (auto end = std::exchange(m_synchronousRecordEnd, 0)) {
        auto& record = m_records[end - 1];
        record.forced = true;
        // As in Node, the entry lasts nearly as long as the call: the sweep after the collection is part of it.
        record.duration = MonotonicTime::now() - record.start;
    }
}

void GCPerformanceEntries::setObservesHeap(bool observesHeap)
{
    if (observesHeap == m_observesHeap)
        return;
    m_observesHeap = observesHeap;
    // This observer gets no start of a collection that is under way now, or no end of it.
    m_collectionStart = std::nullopt;
    if (observesHeap)
        m_vm.heap.addObserver(this);
    else
        m_vm.heap.removeObserver(this);
}

void GCPerformanceEntries::setListener(JSGlobalObject* realm, JSObject* listener)
{
    m_listeners.removeAllMatching([&](auto& existing) { return !existing || existing->globalObject() == realm; });
    if (listener)
        m_listeners.append(Weak<JSObject>(listener));
    // The records stay: as in Node, the observers that exist when a record reaches JS get its entry.
    setObservesHeap(!m_listeners.isEmpty());
}

void GCPerformanceEntries::discardRecords()
{
    cancelTimer();
    // A collection that is under way now gets no record either.
    m_collectionStart = std::nullopt;
    Locker locker { m_lock };
    m_records.clear();
    m_synchronousRecordEnd = 0;
}

void GCPerformanceEntries::stop()
{
    m_listeners.clear();
    setObservesHeap(false);
    discardRecords();
}

// https://github.com/nodejs/node/blob/v26.12.1/src/node_perf.cc#L208-L241
void GCPerformanceEntries::doWork(VM& vm)
{
    cancelTimer();
    auto* bunVM = WebCore::clientData(vm)->bunVM;
    // An entry reaches its observers from a ref'd immediate, and a collection must not keep the loop alive: the hand-off waits for a turn that something else asks for.
    if (Bun__VM__hasPendingTasks(bunVM))
        queueHandOff(HandOff::GoBehindQueuedTasks);
    else if (Bun__VM__isEventLoopKeptAliveBehindItsTasks(bunVM))
        queueHandOff(HandOff::CallListeners);
    else
        setTimeUntilFire(0_s);
}

void GCPerformanceEntries::queueHandOff(HandOff step)
{
    Bun__VM__queueTask(WebCore::clientData(m_vm)->bunVM, new WebCore::EventLoopTask([protectedThis = Ref { *this }, step](WebCore::ScriptExecutionContext&) {
        protectedThis->handOff(step);
    }));
}

void GCPerformanceEntries::handOff(HandOff step)
{
    auto* bunVM = WebCore::clientData(m_vm)->bunVM;
    switch (step) {
    case HandOff::GoBehindQueuedTasks:
        // A queued task can be the doing of the collection itself (the cleanup of a FinalizationRegistry), and it holds the loop until it has run. The timer runs before the tick takes the tasks of other threads, so this task is ahead of those, and goes behind them here.
        if (Bun__VM__hasPendingTasks(bunVM)) {
            queueHandOff(HandOff::AskBehindQueuedTasks);
            return;
        }
        [[fallthrough]];
    case HandOff::AskBehindQueuedTasks:
        if (!Bun__VM__isEventLoopKeptAliveBehindItsTasks(bunVM)) {
            setTimeUntilFire(0_s);
            return;
        }
        [[fallthrough]];
    case HandOff::CallListeners:
        callListeners();
    }
}

void GCPerformanceEntries::callListeners()
{
    Records records;
    {
        Locker locker { m_lock };
        records.swap(m_records);
        m_synchronousRecordEnd = 0;
    }
    if (records.isEmpty())
        return;

    // A listener can end with a call of setListener(), and its realm can be collected.
    MarkedArgumentBuffer listeners;
    for (auto& listener : m_listeners) {
        if (listener)
            listeners.append(listener.get());
    }
    if (listeners.size() != m_listeners.size()) {
        m_listeners.removeAllMatching([](auto& existing) { return !existing; });
        setObservesHeap(!m_listeners.isEmpty());
    }

    // The clock of performance.now() (the real one, also under fake timers, as in Node) and the clock of the records, read together, put each start on the timeline of the first.
    auto* clientData = WebCore::clientData(m_vm);
    double performanceNow = static_cast<double>(Bun__readOriginTimerWithoutFakeTimers(clientData->bunVM)) / 1000000.0;
    auto now = MonotonicTime::now();

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(m_vm);
    for (unsigned i = 0; i < listeners.size(); ++i) {
        auto* listener = asObject(listeners.at(i));
        auto* realm = listener->globalObject();
        auto callData = JSC::getCallData(listener);
        for (auto& record : records) {
            // A listener of 'uncaughtException' can ask for the stop too, in the report below.
            if (clientData->isStoppingOrStopped(m_vm)) [[unlikely]]
                return;
            MarkedArgumentBuffer arguments;
            arguments.append(jsNumber(std::max(0.0, performanceNow - (now - record.start).milliseconds())));
            arguments.append(jsNumber(record.duration.milliseconds()));
            arguments.append(jsBoolean(record.isFullCollection));
            arguments.append(jsBoolean(record.forced));
            JSC::profiledCall(realm, ProfilingReason::API, listener, callData, jsUndefined(), arguments);
            if (auto* exception = scope.exception()) [[unlikely]] {
                // The tick that runs this task takes a termination, and the report of an error can end with one.
                if (!scope.tryClearException())
                    return;
                Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(realm, exception);
                if (scope.exception()) [[unlikely]]
                    return;
            }
        }
    }
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionSetGCPerformanceEntryListener, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue listener = callFrame->argument(0);
    if (!listener.isUndefined() && !listener.isCallable())
        return throwVMTypeError(globalObject, scope, "The listener must be a function or undefined"_s);
    auto& entries = WebCore::clientData(vm)->gcPerformanceEntries;
    if (!entries) {
        if (listener.isUndefined())
            return JSValue::encode(jsUndefined());
        entries = GCPerformanceEntries::create(vm);
    }
    entries->setListener(globalObject, listener.isUndefined() ? nullptr : asObject(listener));
    return JSValue::encode(jsUndefined());
}

} // namespace Bun
