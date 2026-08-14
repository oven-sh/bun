#pragma once

#include "root.h"
#include <JavaScriptCore/Strong.h>
#include <wtf/Vector.h>
#include <wtf/text/SymbolImpl.h>

namespace JSC {
class JSGlobalObject;
class Symbol;
class VM;
}

namespace Bun {

// Scheduling domains and domain runs.
//
// Every schedulable item is attributed to a *domain*: a process-unique integer
// naming the domain run that was current when the item was scheduled (contexts
// name no domain during ordinary, root, execution). Attribution rides in the
// async-context slot that AsyncLocalStorage uses: a context array that carries a
// domain is `[sentinel, domainId, ...alsPairs]`, where `sentinel` is a Symbol
// over a per-VM private uid that user code can never obtain. Because promise
// reactions, awaits, queueMicrotask, nextTick and every AsyncContextFrame-wrapped
// native callback already capture the current context at registration, they
// carry their domain with no further plumbing.
//
// A *domain run* of domain D turns Bun's one event loop while admitting only D's
// items; everything else that surfaces is parked and handed back in order when
// the run exits (the driver is src/runtime/domain_run.rs). Runs nest as a stack;
// the innermost run's domain is the *active run domain* (0 when no run is
// active), which is also what `vm.drainMicrotasks()` consults so that every
// checkpoint is run-aware.

struct DomainRunEntry {
    uint32_t domain;
    uint32_t outerRunDomain;
    bool outerAdmitsLoaderJobs;
    JSC::Strong<JSC::Unknown> savedContext; // context current when the run was entered (restored on exit)
    JSC::Strong<JSC::Unknown> bareContext; // [sentinel, domain]: the run's domain and nothing else
};

class EventLoopDomains {
    WTF_MAKE_TZONE_ALLOCATED(EventLoopDomains);

public:
    EventLoopDomains();
    ~EventLoopDomains();

    WTF::SymbolImpl& sentinelUid() { return m_sentinelUid.get(); }
    Vector<DomainRunEntry, 4>& runs() { return m_runs; }

private:
    Ref<WTF::SymbolImpl> m_sentinelUid;
    Vector<DomainRunEntry, 4> m_runs;
};

EventLoopDomains& eventLoopDomains(JSC::VM&);

// The per-global Symbol cell over the VM's sentinel uid. Lives in field 1 of the
// global's async-context tuple so builtins can read it as
// `$getInternalField($asyncContext, 1)`.
JSC::Symbol* domainSentinel(JSC::JSGlobalObject*);

uint32_t allocateDomain(JSC::JSGlobalObject*);
uint32_t domainOfContext(JSC::JSGlobalObject*, JSC::JSValue context);
// Domain named by the context that is current right now (0 if none).
uint32_t currentDomain(JSC::JSGlobalObject*);
// Innermost domain run's domain (0 if no run is active).
uint32_t activeRunDomain(JSC::JSGlobalObject*);
// `callback` is what a native API stored: an AsyncContextFrame (→ its captured
// context's domain) or a bare function (→ 0).
uint32_t domainOfCallback(JSC::JSGlobalObject*, JSC::JSValue callback);

// A copy of `context` whose domain pair names `domain` (added at the front if
// absent). `context` itself when it already names `domain`.
JSC::JSValue contextWithDomain(JSC::JSGlobalObject*, JSC::JSValue context, uint32_t domain);
// Make `domain` the current context's domain; returns the previous context for restoreContext().
JSC::JSValue enterDomain(JSC::JSGlobalObject*, uint32_t domain);
void restoreContext(JSC::JSGlobalObject*, JSC::JSValue previous);

// What "no particular context" means right now: undefined outside a run, the bare
// `[sentinel, activeRunDomain]` inside one (the run's domain, none of the entering
// frame's AsyncLocalStorage values). Used wherever the context is reset wholesale.
JSC::JSValue baseContext(JSC::JSGlobalObject*);
// The context to install when invoking a callback that captured `captured`: during
// a run, a captured context that names no domain is overlaid with the active run's
// domain, because a callback the run dispatches is one of the run's consequences
// and whatever it schedules must be admitted by the run.
JSC::JSValue contextForInvocation(JSC::JSGlobalObject*, JSC::JSValue captured);

// `admitsLoaderJobs`: whether module-loader microtasks (which cannot be attributed)
// run inside this run — a run that may await an import needs them; a run that
// cannot depend on one (spawnSync) keeps them out.
void enterDomainRun(JSC::JSGlobalObject*, uint32_t domain, bool admitsLoaderJobs);
void exitDomainRun(JSC::JSGlobalObject*);
// Call `function` (no arguments) under the innermost run's entry context: what was
// current when the run was entered, plus the run's domain — for the entering
// frame's own continuation, as opposed to callbacks dispatched on others' behalf.
JSC::JSValue callInEntryContext(JSC::JSGlobalObject*, JSC::JSValue function);

// Drain this domain's microtasks (and, transitively, whatever they queue for it).
void drainMicrotasksInDomain(JSC::JSGlobalObject*, uint32_t domain);

} // namespace Bun
