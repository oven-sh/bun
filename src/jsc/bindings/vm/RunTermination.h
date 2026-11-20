#pragma once

#include "root.h"

namespace Bun {

// A run on the stack that another thread may cut short by requesting its VM's termination
// (JSC::VM::notifyNeedTermination): a node:vm run with a `timeout` or `breakOnSigint`, or a bun:test callback
// with a timeout. The run unwinds with the TerminationException like any terminated script, and the run's
// scope then withdraws the request, beneath the frame that would take it for the VM's stop
// (Bun::takeTerminationOutsideScript). JSC::VM::cancelTermination() cannot tell requests apart, so runs that
// nest on the stack are tracked per thread, innermost first, and one that withdraws asks the runs around it.
class RunTermination {
    WTF_MAKE_NONCOPYABLE(RunTermination);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    bool isNodeVMRun() const { return m_kind == Kind::NodeVMRun; }

protected:
    enum class Kind : uint8_t {
        NodeVMRun,
        TestCallback,
    };

    RunTermination(JSC::VM&, Kind);
    ~RunTermination();

    // This run's own request has been made. Final once the run no longer listens for one.
    bool wasCutShort() const;
    // The nearest run this one is nested in whose own request has been made.
    const RunTermination* enclosingRunCutShort() const;
    // After this run's request: withdraws whatever termination is pending on the VM. False if the VM is being
    // stopped as a whole (worker terminate(), process.exit()): that request is indistinguishable from this
    // run's and wins, so it is left pending, or made again if it went with the withdrawal.
    bool withdrawTermination();

    JSC::VM& m_vm;

private:
    const Kind m_kind;
    RunTermination* const m_enclosing;
};

} // namespace Bun
