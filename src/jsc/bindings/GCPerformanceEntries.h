#pragma once

#include "root.h"

#include <JavaScriptCore/HeapObserver.h>
#include <JavaScriptCore/JSRunLoopTimer.h>
#include <JavaScriptCore/Weak.h>
#include <wtf/Lock.h>
#include <wtf/MonotonicTime.h>
#include <wtf/Vector.h>

namespace Bun {

// The source of node:perf_hooks' 'gc' entries. One per VM, made by its first 'gc' observer (JSVMClientData::gcPerformanceEntries).
//
// JSC notifies a heap observer inside the collection: on the JS thread in the middle of an allocation, or on the
// collector thread while the JS thread is parked. So the observer half only takes the two timestamps, and the timer
// half hands the records to JS at the JS thread's next tick, as Node's unrefed immediate does
// (https://github.com/nodejs/node/blob/v26.12.1/src/node_perf.cc#L208-L241).
class GCPerformanceEntries final : public JSC::JSRunLoopTimer, public JSC::HeapObserver {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(GCPerformanceEntries);

public:
    static Ref<GCPerformanceEntries> create(JSC::VM& vm) { return adoptRef(*new GCPerformanceEntries(vm)); }
    ~GCPerformanceEntries() final;

    // Everything public is for the JS thread.

    // `listener` is node:perf_hooks' emitGCEntry of `realm`, or null once the realm has no 'gc' observer. The heap is
    // observed while a realm has one.
    void setListener(JSC::JSGlobalObject* realm, JSC::JSObject* listener);
    // The VM is going away: nothing more is recorded or handed to JS.
    void stop();

    // How many collections were recorded so far.
    uint64_t recordedCount();
    // For the caller of a synchronous collection that the program asked for, with the count from before it. Such a
    // request is not merged into another one and returns when its own collection has ended, so that collection is
    // the last one recorded meanwhile.
    void markLastRecordForced(uint64_t countBefore);

private:
    explicit GCPerformanceEntries(JSC::VM&);

    void willGarbageCollect() final;
    void didGarbageCollect(JSC::CollectionScope) final;
    void doWork(JSC::VM&) final;
    void setObservesHeap(bool);

    struct Record {
        WTF::MonotonicTime start;
        WTF::Seconds duration;
        bool isFullCollection { false };
        bool forced { false };
    };

    JSC::VM& m_vm;
    // The module of each realm keeps its function alive.
    WTF::Vector<JSC::Weak<JSC::JSObject>, 1> m_listeners;
    bool m_observesHeap { false };
    // Set in the begin phase of a collection and taken in its end phase.
    std::optional<WTF::MonotonicTime> m_collectionStart;
    WTF::Lock m_lock;
    WTF::Vector<Record> m_records WTF_GUARDED_BY_LOCK(m_lock);
    uint64_t m_recordedCount WTF_GUARDED_BY_LOCK(m_lock) { 0 };
};

JSC_DECLARE_HOST_FUNCTION(jsFunctionSetGCPerformanceEntryListener);

} // namespace Bun
