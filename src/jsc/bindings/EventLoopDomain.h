#pragma once

#include "root.h"
#include "BunClientData.h"
#include <JavaScriptCore/Strong.h>
#include <wtf/Vector.h>
#include <wtf/text/SymbolImpl.h>

namespace JSC {
class JSGlobalObject;
class Symbol;
class VM;
}

namespace Bun {

// Domain runs, JS side.
//
// A *domain run* turns Bun's one event loop from inside a synchronous frame while
// admitting only work born since the run started (the driver and the model are
// in src/runtime/domain_run.rs and src/io/run_epoch.rs). A run is named by its
// start epoch. Microtasks and nextTicks learn theirs from the async context they
// capture — the slot AsyncLocalStorage uses: a context array that carries a
// domain is `[sentinel, startEpoch, ...alsPairs]`, where `sentinel` is a Symbol
// over a per-VM private uid user code can never obtain — and JSC's microtask
// queue stamps every task queued during a run (MicrotaskQueue::DomainDrain).
//
// A *strict* run (spawnSync) executes no JavaScript of its own, so it sets up
// no context at all: everything queued before it is simply older than it. A
// *permissive* run executes arbitrary code of its own; its ambient context is
// the bare `[sentinel, start]`, so what that code registers and queues carries
// the run, and callbacks it dispatches on others' behalf are overlaid with it
// (contextForInvocation).

struct DomainRunEntry {
    uint32_t start;
    bool permissive;
    // Permissive runs only:
    JSC::Strong<JSC::Unknown> savedContext; // ambient context at entry, restored on exit
    JSC::Strong<JSC::Unknown> savedDomainSlot; // tuple field 1 at entry, restored on exit
    JSC::Strong<JSC::Unknown> bareContext; // [sentinel, start]
};

class EventLoopDomains {
    WTF_MAKE_TZONE_ALLOCATED(EventLoopDomains);

public:
    EventLoopDomains();

    WTF::SymbolImpl& sentinelUid() { return m_sentinelUid.get(); }
    // Start epoch of the innermost run (0 = none); mirrors runs().last() so the
    // no-run fast paths below are two loads.
    uint32_t activeStart() const { return m_activeStart; }

    void push(DomainRunEntry&&);
    DomainRunEntry pop();
    const DomainRunEntry* innermost() const { return m_runs.isEmpty() ? nullptr : &m_runs.last(); }
    // Innermost run that has a context of its own (permissive), if any.
    const DomainRunEntry* innermostWithContext() const;

private:
    Ref<WTF::SymbolImpl> m_sentinelUid;
    Vector<DomainRunEntry, 4> m_runs;
    uint32_t m_activeStart { 0 };
};

inline EventLoopDomains& eventLoopDomains(JSC::VM& vm)
{
    return WebCore::clientData(vm)->eventLoopDomains();
}

// The per-global Symbol cell over the VM's sentinel uid.
JSC::Symbol* domainSentinel(JSC::JSGlobalObject*);
uint32_t domainOfContext(JSC::JSGlobalObject*, JSC::JSValue context);
// Domain named by the context that is current right now (0 if none).
uint32_t currentDomain(JSC::JSGlobalObject*);
// Innermost run's start epoch (0 if no run is active).
inline uint32_t activeRunDomain(JSC::VM& vm) { return eventLoopDomains(vm).activeStart(); }

// A copy of `context` whose domain pair names `domain` (replacing an existing pair).
JSC::JSValue contextWithDomain(JSC::JSGlobalObject*, JSC::JSValue context, uint32_t domain);

// What "no particular context" means right now: the innermost permissive run's
// bare `[sentinel, start]`, else undefined. Used wherever the context is reset
// wholesale.
JSC::JSValue baseContextSlow(JSC::JSGlobalObject*);
inline JSC::JSValue baseContext(JSC::JSGlobalObject* globalObject)
{
    if (!activeRunDomain(globalObject->vm())) [[likely]]
        return JSC::jsUndefined();
    return baseContextSlow(globalObject);
}

// The context to install when invoking a callback that captured `captured`.
// During a permissive run the callback is being dispatched by the run — it is
// one of the run's consequences — so it runs under the run's domain and whatever
// it schedules is admitted, whichever domain (if any) it was registered under.
JSC::JSValue contextForInvocationSlow(JSC::JSGlobalObject*, JSC::JSValue captured);
inline JSC::JSValue contextForInvocation(JSC::JSGlobalObject* globalObject, JSC::JSValue captured)
{
    if (!activeRunDomain(globalObject->vm())) [[likely]]
        return captured;
    return contextForInvocationSlow(globalObject, captured);
}

void enterDomainRun(JSC::JSGlobalObject*, uint32_t start, bool permissive);
void exitDomainRun(JSC::JSGlobalObject*);
// Call `function` (no arguments) under the innermost (permissive) run's entry
// context: what was current when the run was entered plus the run's domain — for
// the entering frame's own continuation, as opposed to callbacks dispatched on
// others' behalf. Returns the empty value iff the call threw.
JSC::JSValue callInEntryContext(JSC::JSGlobalObject*, JSC::JSValue function);

} // namespace Bun
