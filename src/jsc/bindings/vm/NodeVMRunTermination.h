#pragma once

#include "root.h"

#include "SigintReceiver.h"
#include "SigintWatcher.h"

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
    // `sigintRealm`: the realm being run, whose VM a SIGINT interrupts (only used with breakOnSigint).
    NodeVMRunTermination(JSC::JSGlobalObject* sigintRealm, std::optional<Seconds> timeout, bool breakOnSigint);
    ~NodeVMRunTermination();

    // Call once, right after the run (and any microtask checkpoint it bounds). If the run was cut short
    // by its own timeout or SIGINT and the VM is not being stopped as a whole: the termination has been
    // withdrawn, `microtaskContext`'s (the vm context's) queued microtasks discarded, and the
    // ERR_SCRIPT_EXECUTION_* error thrown on `scope` from `errorRealm`. Otherwise nothing is touched and
    // whatever is pending — an ordinary exception, or a termination that is not this run's — is the
    // caller's to propagate. Either way the caller follows with RETURN_IF_EXCEPTION.
    void finish(JSC::JSGlobalObject* errorRealm, JSC::ThrowScope&, JSC::JSGlobalObject* microtaskContext);

private:
    void withdraw(); // stop listening: nothing of this run's can fire once it returns
    bool wasCutShort() const; // this run's deadline fired or its SIGINT arrived

    JSC::VM& m_vm;
    const std::optional<Seconds> m_timeout;
    RefPtr<JSC::TerminationDeadline> m_deadline;
    std::optional<SigintWatcher::GlobalObjectHolder> m_sigintHold;
    NodeVMRunTermination* const m_enclosing; // the run this one is nested in on this thread, if any
    bool m_withdrawn { false };
    bool m_timedOut { false };
};

} // namespace Bun
