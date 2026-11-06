#pragma once

#include "root.h"

#include <JavaScriptCore/HeapObserver.h>
#include <JavaScriptCore/JSRunLoopTimer.h>
#include <JavaScriptCore/Weak.h>
#include <wtf/Lock.h>
#include <wtf/MonotonicTime.h>
#include <wtf/Vector.h>

namespace Bun {

// The 'gc' entries of node:perf_hooks. JSC calls a heap observer inside the collection, on either thread, so a timer takes the records to the JS thread.
class GCPerformanceEntries final : public JSC::JSRunLoopTimer, public JSC::HeapObserver {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(GCPerformanceEntries);

public:
    static Ref<GCPerformanceEntries> create(JSC::VM& vm) { return adoptRef(*new GCPerformanceEntries(vm)); }
    ~GCPerformanceEntries() final;

    // Everything public is for the JS thread.

    // One listener for each realm, and null removes it. The heap is observed while there is one.
    void setListener(JSC::JSGlobalObject* realm, JSC::JSObject* listener);
    void discardRecords();
    void stop();

    // After a synchronous collection that the program asked for, and the sweep that follows it.
    void didForceCollection();
    // Right before this thread waits in the event loop, with or without access to the heap.
    void eventLoopWillWait();
    // The records of some collections have not reached the listeners yet.
    bool hasRecords();

private:
    explicit GCPerformanceEntries(JSC::VM&);

    void willGarbageCollect() final;
    void didGarbageCollect(JSC::CollectionScope) final;
    void doWork(JSC::VM&) final;
    void setObservesHeap(bool);
    // What the task of a hand-off does first: see doWork().
    enum class HandOff : uint8_t {
        GoBehindQueuedTasks,
        AskBehindQueuedTasks,
        CallListeners,
    };
    void queueHandOff(HandOff);
    void handOff(HandOff);
    void callListeners();

    struct Record {
        WTF::MonotonicTime start;
        WTF::Seconds duration;
        bool isFullCollection { false };
        bool forced { false };
    };
    // With inline room for the few of one turn, the observer allocates nothing.
    using Records = WTF::Vector<Record, 4>;

    JSC::VM& m_vm;
    WTF::Vector<JSC::Weak<JSC::JSObject>, 1> m_listeners;
    bool m_observesHeap { false };
    std::optional<WTF::MonotonicTime> m_collectionStart;
    WTF::Lock m_lock;
    Records m_records WTF_GUARDED_BY_LOCK(m_lock);
    // The timer is due 1 ms after the first record that waits. A later collection does not move it.
    bool m_timerIsArmed WTF_GUARDED_BY_LOCK(m_lock) { false };
    // eventLoopWillWait() has woken the loop since the timer was last armed.
    bool m_hasWokenLoopForTimer WTF_GUARDED_BY_LOCK(m_lock) { false };
};

JSC_DECLARE_HOST_FUNCTION(jsFunctionSetGCPerformanceEntryListener);

} // namespace Bun
