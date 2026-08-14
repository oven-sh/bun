#pragma once

#include "root.h"
#include "BunClientData.h"
#include <JavaScriptCore/Strong.h>
#include <wtf/Vector.h>

namespace Bun {

// Domain runs, JS side (the driver and the model are src/runtime/domain_run.rs
// and src/io/run_epoch.rs).
//
// Only a *permissive* run — one that executes code of its own while it turns the
// loop — has a JS side: microtasks and nextTicks queued before it started are
// set aside until it exits (JSC's MicrotaskQueue::DrainScope; nextTick's gate
// in ProcessObjectInternals.ts reads the active run from tuple field 1), and
// while it turns the loop the ambient async context is empty, as it is at the
// top of the ordinary loop, so callbacks it dispatches on others' behalf do not
// inherit the entering frame's AsyncLocalStorage values. A *strict* run
// (spawnSync) executes no JavaScript, drains nothing (vm.suppress_microtask_drain)
// and never reaches this file.

class EventLoopDomains {
    WTF_MAKE_TZONE_ALLOCATED(EventLoopDomains);

public:
    EventLoopDomains() = default;

    // Start epoch of the innermost run (0 = none).
    uint32_t active() const { return m_runs.isEmpty() ? 0 : m_runs.last().start; }
    // Bumped by every exit(): a checkpoint that sees it change had a run nested
    // inside it, which may have put back ticks the checkpoint already passed.
    uint32_t exits() const { return m_exits; }

    void enter(JSC::JSGlobalObject*, uint32_t start);
    // The entering frame's own code has run; from here on the run turns the loop.
    void beginLoopPhase(JSC::JSGlobalObject*);
    void exit(JSC::JSGlobalObject*);

private:
    struct Run {
        uint32_t start;
        JSC::Strong<JSC::Unknown> savedActiveSlot; // tuple field 1 at entry
        std::optional<JSC::Strong<JSC::Unknown>> savedContext; // tuple field 0 when the loop phase began
    };
    Vector<Run, 4> m_runs;
    uint32_t m_exits { 0 };
};

inline EventLoopDomains& eventLoopDomains(JSC::VM& vm)
{
    return WebCore::clientData(vm)->eventLoopDomains();
}

inline uint32_t activeRun(JSC::VM& vm)
{
    return eventLoopDomains(vm).active();
}

} // namespace Bun
