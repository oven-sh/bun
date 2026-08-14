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

// Scheduling domains and scoped event-loop runs.
//
// Every schedulable item is attributed to a *domain*: a process-unique integer
// naming the scoped run that was current when the item was scheduled (contexts
// name no domain during ordinary, root, execution). Attribution rides in the async-context slot that
// AsyncLocalStorage uses: a context array that carries a domain is
// `[sentinel, domainId, ...alsPairs]`, where `sentinel` is a Symbol over a
// per-VM private uid that user code can never obtain. Because promise
// reactions, awaits, queueMicrotask, nextTick and every AsyncContextFrame-wrapped
// native callback already capture the current context at registration, they
// carry their domain with no further plumbing.
//
// A *scoped run* of domain D turns Bun's one event loop while admitting only
// D's items; everything else that surfaces is parked and handed back in order
// when the run exits. Runs nest as a stack; the innermost run's domain is the
// *active run domain* (0 when no run is active), which is also what
// `vm.drainMicrotasks()` consults so that every checkpoint is run-aware.

struct ScopedRunEntry {
    uint32_t domain;
    uint32_t outerRunDomain;
    JSC::Strong<JSC::Unknown> savedContext; // context current when the run was entered
    JSC::Strong<JSC::Unknown> runContext; // savedContext with the domain pair set to `domain`
};

class EventLoopDomains {
    WTF_MAKE_TZONE_ALLOCATED(EventLoopDomains);

public:
    EventLoopDomains();
    ~EventLoopDomains();

    WTF::SymbolImpl& sentinelUid() { return m_sentinelUid.get(); }
    Vector<ScopedRunEntry, 4>& runs() { return m_runs; }

private:
    Ref<WTF::SymbolImpl> m_sentinelUid;
    Vector<ScopedRunEntry, 4> m_runs;
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
// Innermost scoped run's domain (0 if no run is active).
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

// What "no particular context" means right now: undefined outside a run, the
// run's entry context inside one. Used wherever the context is reset wholesale.
JSC::JSValue baseContext(JSC::JSGlobalObject*);
// The context to install when invoking a callback that captured `captured`: during
// a run, a captured context that names no domain is overlaid with the active run's
// domain, because a callback the run dispatches is one of the run's consequences
// and whatever it schedules must be admitted by the run.
JSC::JSValue contextForInvocation(JSC::JSGlobalObject*, JSC::JSValue captured);

void enterScopedRun(JSC::JSGlobalObject*, uint32_t domain);
void exitScopedRun(JSC::JSGlobalObject*);

// Drain this domain's microtasks (and, transitively, whatever they queue for it).
void drainMicrotasksInDomain(JSC::JSGlobalObject*, uint32_t domain);

} // namespace Bun
