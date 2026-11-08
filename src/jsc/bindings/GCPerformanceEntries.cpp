#include "root.h"

#include "GCPerformanceEntries.h"

#include "BunClientData.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/WeakInlines.h>

extern "C" uint64_t Bun__readOriginTimerWithoutFakeTimers(void* bunVM);
extern "C" void Bun__VM__setGCPerformanceEntriesWait(void* bunVM, bool);

namespace Bun {

using namespace JSC;

GCPerformanceEntries::GCPerformanceEntries(VM& vm)
    : m_vm(vm)
    , m_bunVM(WebCore::clientData(vm)->bunVM)
{
}

GCPerformanceEntries::~GCPerformanceEntries()
{
    // GlobalObject::prepareForDestruction() has stopped it.
    ASSERT(!m_recordsCollections);
}

void GCPerformanceEntries::didFinishCollection(JSContextGroupRef, void* self)
{
    auto& entries = *static_cast<GCPerformanceEntries*>(self);
    auto& heap = entries.m_vm.heap;
    bool isFullCollection = heap.lastCollectionScope() == CollectionScope::Full;
    // JSC's own figures for the collection that has ended: how long its cycle was, and when it ended.
    Seconds cycle = isFullCollection ? heap.lastFullGCLength() : heap.lastEdenGCLength();
    auto start = heap.lastGCBoundaryTime() - cycle;
    if (start < entries.m_recordsSince)
        return;
    // The program waits for all of a collection that it forced (JSC__VM__runGC). Any other stops it for a part of the cycle only. The first stop begins a moment before JSC starts to time the cycle, hence the bound.
    bool forced = heap.lastCollectionWasForced();
    entries.m_records.append({ start, forced ? cycle : std::min(cycle, heap.lastCollectionPause()), isFullCollection, forced });
    // No wake: the entry waits for the next turn that the loop makes.
    Bun__VM__setGCPerformanceEntriesWait(entries.m_bunVM, true);
}

void GCPerformanceEntries::setRecordsCollections(bool recordsCollections)
{
    if (recordsCollections == m_recordsCollections)
        return;
    m_recordsCollections = recordsCollections;
    if (recordsCollections) {
        m_recordsSince = MonotonicTime::now();
        m_vm.heap.addGCCompletionCallback(completionCallback());
    } else
        m_vm.heap.removeGCCompletionCallback(completionCallback());
}

void GCPerformanceEntries::setListener(JSGlobalObject* realm, JSObject* listener)
{
    m_listeners.removeAllMatching([&](auto& existing) { return !existing || existing->globalObject() == realm; });
    if (listener)
        m_listeners.append(Weak<JSObject>(listener));
    // The records stay: as in Node, the observers that exist when a record reaches JS get its entry.
    setRecordsCollections(!m_listeners.isEmpty());
}

void GCPerformanceEntries::discardRecords()
{
    m_records.clear();
    Bun__VM__setGCPerformanceEntriesWait(m_bunVM, false);
}

void GCPerformanceEntries::stop()
{
    m_listeners.clear();
    setRecordsCollections(false);
    discardRecords();
}

// https://github.com/nodejs/node/blob/v26.12.1/src/node_perf.cc#L208-L241
void GCPerformanceEntries::callListeners()
{
    Records records = std::exchange(m_records, {});
    Bun__VM__setGCPerformanceEntriesWait(m_bunVM, false);

    // A listener can end with a call of setListener(), and its realm can be collected.
    MarkedArgumentBuffer listeners;
    for (auto& listener : m_listeners) {
        if (listener)
            listeners.append(listener.get());
    }
    if (listeners.size() != m_listeners.size()) {
        m_listeners.removeAllMatching([](auto& existing) { return !existing; });
        setRecordsCollections(!m_listeners.isEmpty());
    }

    // The clock of performance.now() (the real one, also under fake timers, as in Node) and the clock of the records, read together, put each start on the timeline of the first.
    auto* clientData = WebCore::clientData(m_vm);
    double performanceNow = static_cast<double>(Bun__readOriginTimerWithoutFakeTimers(clientData->bunVM)) / 1000000.0;
    auto now = MonotonicTime::now();

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(m_vm);
    for (unsigned i = 0; i < records.size(); ++i) {
        auto& record = records[i];
        MarkedArgumentBuffer arguments;
        arguments.append(jsNumber(std::max(0.0, performanceNow - (now - record.start).milliseconds())));
        arguments.append(jsNumber(record.duration.milliseconds()));
        arguments.append(jsBoolean(record.isFullCollection));
        arguments.append(jsBoolean(record.forced));
        for (unsigned j = 0; j < listeners.size(); ++j) {
            // A listener of 'uncaughtException' can ask for the stop too, in the report below.
            if (clientData->isStoppingOrStopped(m_vm)) [[unlikely]]
                return;
            auto* listener = asObject(listeners.at(j));
            auto* realm = listener->globalObject();
            JSC::profiledCall(realm, ProfilingReason::API, listener, JSC::getCallData(listener), jsUndefined(), arguments);
            auto* exception = scope.exception();
            if (!exception) [[likely]]
                continue;
            if (scope.tryClearException()) {
                Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(realm, exception);
                if (!scope.exception()) [[likely]]
                    continue;
            }
            // A termination ends the hand-off. Where it leaves the VM running (the deadline of a node:vm run), the record in hand and those behind it are handed over again in a later turn: none is lost, and a listener can get one twice.
            records.removeAt(0, i);
            records.appendVector(m_records);
            m_records = WTF::move(records);
            Bun__VM__setGCPerformanceEntriesWait(m_bunVM, true);
            return;
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

// From EventLoop::tick_immediate_tasks (event_loop.rs), which calls it only while records wait.
extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__GCPerformanceEntries__handOff(Zig::GlobalObject* globalObject)
{
    WebCore::clientData(globalObject->vm())->gcPerformanceEntries->callListeners();
}

} // namespace Bun
