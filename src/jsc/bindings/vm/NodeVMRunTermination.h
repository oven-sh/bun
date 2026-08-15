#pragma once

#include "root.h"

#include "SigintReceiver.h"

#include <JavaScriptCore/TerminationDeadline.h>
#include <JavaScriptCore/ThrowScope.h>
#include <optional>

namespace Bun {

// One node:vm run — a Script, a module evaluation, or an afterEvaluate microtask checkpoint — that
// its `timeout` and/or `breakOnSigint` options may cut short. Both work by requesting the VM's
// termination from another thread while the run is on the stack (JSC::VM::addTerminationDeadline's
// timer, SigintWatcher's signal thread); the run unwinds with the TerminationException like any
// terminated script, and finish() then decides whose termination that was: this run's — withdrawn
// (JSC::VM::cancelTermination) and turned into ERR_SCRIPT_EXECUTION_TIMEOUT / _INTERRUPTED — or
// someone else's (an enclosing run's, or the VM's own worker terminate() / process.exit()), which is
// left in place for the caller to propagate. The timeout is wall-clock, as in Node.
class NodeVMRunTermination final : private SigintReceiver {
    WTF_MAKE_NONCOPYABLE(NodeVMRunTermination);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    // `realm`: the realm being run; its VM is what the timeout / a SIGINT terminates.
    NodeVMRunTermination(JSC::JSGlobalObject* realm, std::optional<Seconds> timeout, bool breakOnSigint);
    ~NodeVMRunTermination();

    // Call once, right after the run (and any microtask checkpoint it bounds). If the run was cut short
    // by its own timeout or SIGINT and the VM is not being stopped as a whole: the microtasks the run left
    // for `microtaskContext` (its own queue if it has one — pass it only if that queue's checkpoint ran —
    // else its share of the VM's queue; nullptr: none) have been discarded, the termination withdrawn, and
    // the ERR_SCRIPT_EXECUTION_* error thrown on `scope` from `errorRealm`. Otherwise nothing is touched
    // and whatever is pending — an ordinary exception, or a termination that is not this run's — is the
    // caller's to propagate. Either way the caller follows with RETURN_IF_EXCEPTION.
    void finish(JSC::JSGlobalObject* errorRealm, JSC::ThrowScope&, JSC::JSGlobalObject* microtaskContext);

    bool hasTimeout() const { return m_timeout.has_value(); }
    NodeVMRunTermination* enclosing() const { return m_enclosing; }

private:
    void withdraw(); // stop listening: nothing of this run's can fire once it returns
    bool timedOut() const { return m_deadline && m_deadline->didFire(); }
    bool wasCutShort() const { return timedOut() || m_sigintReceived; }

    const std::optional<Seconds> m_timeout;
    RefPtr<JSC::TerminationDeadline> m_deadline;
    bool m_listeningForSigint { false };
    // The run this one is nested in, if any: runs nest on the stack, so the innermost is tracked per thread.
    NodeVMRunTermination* const m_enclosing;
    bool m_withdrawn { false };
};

} // namespace Bun
