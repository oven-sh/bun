#include "root.h"

#include "GCPerformanceEntries.h"

#include "BunClientData.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/GlobalObjectMethodTable.h>
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/WeakInlines.h>

extern "C" uint64_t Bun__readOriginTimer(void* bunVM);
extern "C" bool Bun__VM__isEventLoopKeptAlive(void* bunVM);

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
        ++m_recordedCount;
    }
    setTimeUntilFire(0_s);
}

uint64_t GCPerformanceEntries::recordedCount()
{
    Locker locker { m_lock };
    return m_recordedCount;
}

void GCPerformanceEntries::markLastRecordForced(uint64_t countBefore)
{
    Locker locker { m_lock };
    if (m_recordedCount != countBefore && !m_records.isEmpty())
        m_records.last().forced = true;
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
    // The records stay. As in Node, the observers that exist when a collection reaches JS get its entry.
    setObservesHeap(!m_listeners.isEmpty());
}

void GCPerformanceEntries::stop()
{
    m_listeners.clear();
    setObservesHeap(false);
    cancelTimer();
    Locker locker { m_lock };
    m_records.clear();
}

void GCPerformanceEntries::doWork(VM& vm)
{
    cancelTimer();
    auto* clientData = WebCore::clientData(vm);
    if (!clientData->scriptAllowed())
        return;
    // The immediate that delivers an entry to its observers keeps the event loop alive, and a collection must not
    // (`beforeExit` would fire again for one). So the records wait for a turn that something else asks for.
    if (!Bun__VM__isEventLoopKeptAlive(clientData->bunVM)) {
        setTimeUntilFire(0_s);
        return;
    }

    Records records;
    {
        Locker locker { m_lock };
        records.swap(m_records);
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

    // performance.now() and the clock of the records, read together, put each start on the timeline of the first.
    double performanceNow = static_cast<double>(Bun__readOriginTimer(clientData->bunVM)) / 1000000.0;
    auto now = MonotonicTime::now();

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    for (unsigned i = 0; i < listeners.size(); ++i) {
        auto* listener = asObject(listeners.at(i));
        auto* realm = listener->globalObject();
        // A realm that `bun test --isolate` retired reports Stopped.
        if (realm->globalObjectMethodTable()->scriptExecutionStatus(realm, listener) != ScriptExecutionStatus::Running)
            continue;
        auto callData = JSC::getCallData(listener);
        for (auto& record : records) {
            MarkedArgumentBuffer arguments;
            arguments.append(jsNumber(std::max(0.0, performanceNow - (now - record.start).milliseconds())));
            arguments.append(jsNumber(record.duration.milliseconds()));
            arguments.append(jsBoolean(record.isFullCollection));
            arguments.append(jsBoolean(record.forced));
            JSC::profiledCall(realm, ProfilingReason::API, listener, callData, jsUndefined(), arguments);
            if (auto* exception = scope.exception()) [[unlikely]] {
                if (vm.isTerminationException(exception)) {
                    Bun::takeTerminationOutsideScript(vm, scope);
                    return;
                }
                scope.clearException();
                Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(realm, exception);
            }
        }
    }
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionSetGCPerformanceEntryListener, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto& entries = WebCore::clientData(vm)->gcPerformanceEntries;
    auto* listener = callFrame->argument(0).getObject();
    if (!entries) {
        if (!listener)
            return JSValue::encode(jsUndefined());
        entries = GCPerformanceEntries::create(vm);
    }
    entries->setListener(globalObject, listener);
    return JSValue::encode(jsUndefined());
}

extern "C" uint64_t Bun__GCPerformanceEntries__recordedCount(JSC::VM* vm)
{
    auto* entries = WebCore::clientData(*vm)->gcPerformanceEntries.get();
    return entries ? entries->recordedCount() : 0;
}

extern "C" void Bun__GCPerformanceEntries__markLastRecordForced(JSC::VM* vm, uint64_t countBefore)
{
    if (auto* entries = WebCore::clientData(*vm)->gcPerformanceEntries.get())
        entries->markLastRecordForced(countBefore);
}

} // namespace Bun
