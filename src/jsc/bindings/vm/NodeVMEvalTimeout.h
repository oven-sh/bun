#pragma once

#include "root.h"

#include <wtf/Lock.h>
#include <wtf/ThreadSafeRefCounted.h>

namespace Bun {

// Wall-clock deadline for a `node:vm` evaluation that was given the `timeout`
// option. Arms a one-shot timer on a background queue; if it fires while the
// evaluation is still running it requests termination of the in-flight JS
// (VM::notifyNeedTermination), like Node's per-evaluation watchdog thread.
// `disarm()` must be called on the JS thread once the evaluation has returned;
// after that `expired()` reports whether the deadline was hit.
//
// The JSC Watchdog is deliberately not used here. It measures CPU time while
// Node's `timeout` is wall-clock, and it cannot be disarmed: its wall timer
// stays in flight after `setTimeLimit(noTimeLimit)`, and servicing the
// resulting NeedWatchdogCheck trap later restarts the timer with no limit set
// (`ASSERT(hasTimeLimit())` in Watchdog::startTimer) or terminates whatever
// unrelated JS happens to be on the stack.
class NodeVMEvalTimeout {
    WTF_MAKE_NONCOPYABLE(NodeVMEvalTimeout);

public:
    NodeVMEvalTimeout(JSC::VM&, int64_t milliseconds);
    ~NodeVMEvalTimeout();

    // Idempotent. Stops the timer and, if it already fired, consumes the
    // NeedTermination trap it raised so it cannot leak into unrelated JS.
    void disarm();

    // Only meaningful after disarm().
    bool expired() const { return m_expired; }
    int64_t milliseconds() const { return m_milliseconds; }

private:
    // Shared with the timer lambda, which can outlive this stack object.
    struct State : public ThreadSafeRefCounted<State> {
        WTF::Lock lock;
        // Non-null only while armed; disarm() clears it so a late firing
        // never touches a VM that may since have been torn down.
        JSC::VM* vm WTF_GUARDED_BY_LOCK(lock) { nullptr };
        bool expired WTF_GUARDED_BY_LOCK(lock) { false };
    };

    Ref<State> m_state;
    JSC::VM& m_vm;
    int64_t m_milliseconds;
    bool m_armed { true };
    bool m_expired { false };
};

} // namespace Bun
