#pragma once

#include "root.h"

#include <JavaScriptCore/GCCompletionCallback.h>
#include <JavaScriptCore/Weak.h>
#include <wtf/MonotonicTime.h>
#include <wtf/RefCounted.h>
#include <wtf/Vector.h>

namespace Bun {

// The 'gc' entries of node:perf_hooks. JSC calls a GC completion callback on the JS thread, once for each collection and before the next one begins. The records then wait for the event loop: EventLoop::tick_immediate_tasks (event_loop.rs) hands them over.
class GCPerformanceEntries final : public RefCounted<GCPerformanceEntries> {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(GCPerformanceEntries);

public:
    static Ref<GCPerformanceEntries> create(JSC::VM& vm) { return adoptRef(*new GCPerformanceEntries(vm)); }
    ~GCPerformanceEntries();

    // One listener for each realm, and null removes it. Collections are recorded while there is one.
    void setListener(JSC::JSGlobalObject* realm, JSC::JSObject* listener);
    void discardRecords();
    void stop();

    // Gives the records that wait to the listeners.
    void callListeners();

private:
    explicit GCPerformanceEntries(JSC::VM&);

    static void didFinishCollection(JSContextGroupRef, void* self);
    JSC::GCCompletionCallback completionCallback() { return { didFinishCollection, this }; }
    void setRecordsCollections(bool);

    struct Record {
        WTF::MonotonicTime start;
        WTF::Seconds duration;
        bool isFullCollection { false };
        bool forced { false };
    };
    // With inline room for the few of one turn, a collection allocates nothing here.
    using Records = WTF::Vector<Record, 4>;

    JSC::VM& m_vm;
    void* m_bunVM;
    WTF::Vector<JSC::Weak<JSC::JSObject>, 1> m_listeners;
    bool m_recordsCollections { false };
    // When the first listener came. As in Node, a collection that was under way then has no entry.
    WTF::MonotonicTime m_recordsSince;
    Records m_records;
};

JSC_DECLARE_HOST_FUNCTION(jsFunctionSetGCPerformanceEntryListener);

} // namespace Bun
