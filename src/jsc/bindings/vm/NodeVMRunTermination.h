#pragma once

#include "root.h"

#include "SigintReceiver.h"

#include <JavaScriptCore/ThrowScope.h>
#include <optional>
#include <wtf/Lock.h>
#include <wtf/ThreadSafeRefCounted.h>

namespace Bun {

// One node:vm run — a Script, a module evaluation, or an afterEvaluate microtask checkpoint — that
// its `timeout` and/or `breakOnSigint` options may cut short. Both work by requesting the VM's
// termination (JSC::VM::notifyNeedTermination) from another thread while the run is on the stack;
// the run then unwinds with the TerminationException like any terminated script.
//
// The timeout is wall-clock, as in Node (JSC's own Watchdog budgets CPU time, and its deadline
// bookkeeping cannot be retired while the caller is still inside the VM), armed by the constructor
// and disarmed by finish(). finish() then decides whose termination is pending: this run's (it
// requested one) — consumed and turned into ERR_SCRIPT_EXECUTION_TIMEOUT / _INTERRUPTED — or the
// VM's own (worker terminate() / process.exit()), which is left for the caller to propagate.
class NodeVMRunTermination {
    WTF_MAKE_NONCOPYABLE(NodeVMRunTermination);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    NodeVMRunTermination(JSC::VM&, std::optional<double> timeoutMs, SigintReceiver*);
    ~NodeVMRunTermination();

    // Call once, right after the run (and any microtask checkpoint it bounds). Returns true if the
    // run was cut short by its own timeout or SIGINT: everything that request left behind has been
    // taken back and the ERR_SCRIPT_EXECUTION_* error thrown on `scope` (from `errorGlobalObject`'s
    // realm), and `contextGlobalObject`'s (the vm context's) queued microtasks discarded. Returns
    // false otherwise; whatever is then pending — an ordinary exception, or the VM's own termination —
    // is the caller's to propagate.
    bool finish(JSC::JSGlobalObject* errorGlobalObject, JSC::ThrowScope&, JSC::JSGlobalObject* contextGlobalObject);

    // Whether any run with a timeout is on this thread's stack (Bun.spawnSync must then not block the
    // thread outright).
    static bool timeoutArmedOnCurrentThread();

private:
    struct TimerState : public ThreadSafeRefCounted<TimerState> {
        WTF::Lock lock;
        JSC::VM* vm WTF_GUARDED_BY_LOCK(lock) { nullptr }; // null once disarmed
        bool fired WTF_GUARDED_BY_LOCK(lock) { false };
    };

    bool disarm(); // returns whether the timer requested a termination

    JSC::VM& m_vm;
    std::optional<double> m_timeoutMs;
    SigintReceiver* m_sigintReceiver;
    RefPtr<TimerState> m_timer;
    bool m_finished { false };
};

} // namespace Bun
