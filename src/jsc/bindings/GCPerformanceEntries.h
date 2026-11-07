#pragma once

#include "root.h"

#include <JavaScriptCore/HeapObserver.h>
#include <JavaScriptCore/Weak.h>
#include <wtf/Lock.h>
#include <wtf/MonotonicTime.h>
#include <wtf/RefCounted.h>
#include <wtf/SharedTask.h>
#include <wtf/Vector.h>

namespace Bun {

// The 'gc' entries of node:perf_hooks. JSC calls a heap observer inside the collection, on either thread, so the records wait for the event loop of the JS thread: EventLoop::tick_immediate_tasks (event_loop.rs) hands them over.
class GCPerformanceEntries final : public RefCounted<GCPerformanceEntries>, public JSC::HeapObserver {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(GCPerformanceEntries);

public:
    static Ref<GCPerformanceEntries> create(JSC::VM& vm) { return adoptRef(*new GCPerformanceEntries(vm)); }
    ~GCPerformanceEntries() final;

    // Everything public is for the JS thread.

    // One listener for each realm, and null removes it. The heap is observed while there is one.
    void setListener(JSC::JSGlobalObject* realm, JSC::JSObject* listener);
    void discardRecords();
    void stop();

    bool observesHeap() const { return m_observesHeap; }
    // For the request of a synchronous collection: what tells which record is its own.
    RefPtr<WTF::SharedTask<void()>> willCollectSynchronously();
    // After a synchronous collection that the program asked for, and the sweep that follows it.
    void didForceCollection();
    // Gives the records that wait to the listeners.
    void callListeners();

private:
    explicit GCPerformanceEntries(JSC::VM&);

    void willGarbageCollect() final;
    void didGarbageCollect(JSC::CollectionScope) final;
    void setObservesHeap(bool);

    struct Record {
        WTF::MonotonicTime start;
        WTF::Seconds duration;
        bool isFullCollection { false };
        bool forced { false };
    };
    // With inline room for the few of one turn, the observer allocates nothing.
    using Records = WTF::Vector<Record, 4>;

    JSC::VM& m_vm;
    void* m_bunVM;
    WTF::Vector<JSC::Weak<JSC::JSObject>, 1> m_listeners;
    bool m_observesHeap { false };
    std::optional<WTF::MonotonicTime> m_collectionStart;
    RefPtr<WTF::SharedTask<void()>> m_synchronousCollectionDidEnd;
    WTF::Lock m_lock;
    Records m_records WTF_GUARDED_BY_LOCK(m_lock);
    // One past the record of the last synchronous collection, or 0.
    unsigned m_synchronousRecordEnd WTF_GUARDED_BY_LOCK(m_lock) { 0 };
};

JSC_DECLARE_HOST_FUNCTION(jsFunctionSetGCPerformanceEntryListener);

} // namespace Bun
