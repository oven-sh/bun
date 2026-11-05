#include "root.h"

#include "GCPerformanceEntries.h"

#include "BunClientData.h"
#include "EventLoopTask.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/GlobalObjectMethodTable.h>
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/WeakInlines.h>

extern "C" uint64_t Bun__readOriginTimer(void* bunVM);
extern "C" bool Bun__VM__isEventLoopKeptAlive(void* bunVM);
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
}

RefPtr<SharedTask<void()>> GCPerformanceEntries::willCollectSynchronously()
{
    {
        Locker locker { m_lock };
        m_synchronousRecordEnd = 0;
    }
    if (!m_observesHeap)
        return nullptr;
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
        // As in Node, the entry lasts as long as the call: the sweep after the collection is part of it.
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
    // An entry reaches its observers from a ref'd immediate, and a collection must not keep the loop alive: wait for a turn that something else asks for.
    if (!Bun__VM__isEventLoopKeptAlive(bunVM)) {
        setTimeUntilFire(0_s);
        return;
    }
    Bun__VM__queueTask(bunVM, new WebCore::EventLoopTask([&vm](WebCore::ScriptExecutionContext&) {
        if (RefPtr entries = WebCore::clientData(vm)->gcPerformanceEntries)
            entries->callListeners();
    }));
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

    // performance.now() and the clock of the records, read together, put each start on the timeline of the first.
    double performanceNow = static_cast<double>(Bun__readOriginTimer(WebCore::clientData(m_vm)->bunVM)) / 1000000.0;
    auto now = MonotonicTime::now();

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(m_vm);
    for (unsigned i = 0; i < listeners.size(); ++i) {
        auto* listener = asObject(listeners.at(i));
        auto* realm = listener->globalObject();
        // Stopped once the VM's stop was requested.
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
                // The tick that runs this task takes a termination.
                if (m_vm.hasPendingTerminationException())
                    return;
                scope.clearException();
                Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(realm, exception);
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

extern "C" void Bun__GCPerformanceEntries__didForceCollection(JSC::VM* vm)
{
    if (auto* entries = WebCore::clientData(*vm)->gcPerformanceEntries.get())
        entries->didForceCollection();
}

} // namespace Bun
