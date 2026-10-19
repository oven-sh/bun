#pragma once

#include "root.h"

#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/TerminationDeadline.h>
#include <JavaScriptCore/ThrowScope.h>
#include <atomic>
#include <optional>

namespace JSC {
class CyclicModuleRecord;
}

namespace Bun {

class NodeVMGlobalObject;

// One node:vm run — a Script, a module evaluation, or an afterEvaluate microtask checkpoint — that
// its `timeout` and/or `breakOnSigint` options may cut short. Both work by requesting the VM's
// termination from another thread while the run is on the stack (JSC::VM::addTerminationDeadline's
// timer, SigintWatcher's signal thread); the run unwinds with the TerminationException like any
// terminated script, and finish() then decides whose termination that was: this run's — withdrawn
// (JSC::VM::cancelTermination) and turned into ERR_SCRIPT_EXECUTION_TIMEOUT / _INTERRUPTED — or
// someone else's (an enclosing run's, or the VM's own worker terminate() / process.exit()), which is
// left in place for the caller to propagate. The timeout is wall-clock, as in Node.
class NodeVMRunTermination final {
    WTF_MAKE_NONCOPYABLE(NodeVMRunTermination);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    // `realm`: the realm being run; its VM is what the timeout / a SIGINT terminates.
    NodeVMRunTermination(JSC::JSGlobalObject* realm, std::optional<Seconds> timeout, bool breakOnSigint);
    ~NodeVMRunTermination();

    // Call once, right after the run (and any microtask checkpoint it bounds). If the run was cut short
    // by its own timeout or SIGINT and the VM is not being stopped as a whole, the termination is
    // withdrawn and the ERR_SCRIPT_EXECUTION_* error thrown on `scope`. Otherwise nothing is touched and
    // whatever is pending — an ordinary exception, or a termination that is not this run's — is the
    // caller's to propagate. Either way the caller follows with RETURN_IF_EXCEPTION.
    // `moduleOfRun` is the module that the run evaluated: see NodeVMModule::errorModulesCutShort().
    void finish(JSC::ThrowScope&, JSC::CyclicModuleRecord* moduleOfRun = nullptr);

    // For the run that a termination belongs to: the termination unwound a microtask checkpoint of `context`.
    static void noteCheckpointCutShort(NodeVMGlobalObject* context);

    // SigintWatcher's signal thread, under its lock: record the SIGINT, then request m_vm's termination.
    JSC::VM& vm() const { return m_vm; }
    void setSigintReceived() { m_sigintReceived = true; }

private:
    void disarm(); // stop listening: nothing of this run's can fire once it returns
    void addCheckpointCutShort(JSC::JSValue context);
    void handCheckpointsCutShortToEnclosingRun();
    bool timedOut() const { return m_deadline && m_deadline->didFire(); }
    bool wasCutShort() const { return timedOut() || m_sigintReceived; }
    const NodeVMRunTermination* enclosingRunCutShort() const;

    JSC::VM& m_vm;
    JSC::JSGlobalObject* const m_realm;
    const std::optional<Seconds> m_timeout;
    std::atomic<bool> m_sigintReceived { false }; // read on this thread only once disarm()ed
    RefPtr<JSC::TerminationDeadline> m_deadline;
    bool m_listeningForSigint { false };
    // The run this one is nested in, if any: runs nest on the stack, so the innermost is tracked per thread.
    NodeVMRunTermination* const m_enclosing;
    // The contexts of noteCheckpointCutShort(). A run that an enclosing run cut short hands them to that run.
    std::optional<JSC::MarkedArgumentBuffer> m_checkpointsCutShort;
    bool m_finished { false };
};

} // namespace Bun
