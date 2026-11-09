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

// The clock of the records and the clock of performance.now() have one source on every target, so they differ by a constant. It is taken where two reads of the first were closest around a read of the second.
static MonotonicTime readPerformanceOrigin(void* bunVM)
{
    MonotonicTime origin;
    Seconds narrowest = Seconds::infinity();
    for (unsigned attempt = 0; attempt < 32 && narrowest > Seconds::fromNanoseconds(200); ++attempt) {
        auto before = MonotonicTime::now();
        auto sinceOrigin = Seconds::fromNanoseconds(static_cast<double>(Bun__readOriginTimerWithoutFakeTimers(bunVM)));
        auto between = MonotonicTime::now() - before;
        if (between < narrowest) {
            narrowest = between;
            origin = before + between / 2 - sinceOrigin;
        }
    }
    return origin;
}

GCPerformanceEntries::GCPerformanceEntries(VM& vm)
    : m_vm(vm)
    , m_bunVM(WebCore::clientData(vm)->bunVM)
    , m_performanceOrigin(readPerformanceOrigin(m_bunVM))
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
    // The pause is the time for which the collection kept the program from running: its stops, and all of it where the program waited for it. The first stop begins a moment before JSC starts to time the cycle, hence the bound.
    entries.m_records.append({ start, std::min(cycle, heap.lastCollectionPause()), isFullCollection, heap.lastCollectionWasForced() });
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

    auto* clientData = WebCore::clientData(m_vm);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(m_vm);
    for (unsigned i = 0; i < records.size(); ++i) {
        auto& record = records[i];
        MarkedArgumentBuffer arguments;
        // On the timeline of the real performance.now(), also under fake timers, as in Node.
        arguments.append(jsNumber((record.start - m_performanceOrigin).milliseconds()));
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
