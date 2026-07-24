#pragma once

#include "root.h"

#include <wtf/Condition.h>
#include <wtf/Lock.h>
#include <wtf/Threading.h>

namespace Bun {

// Wall-clock watchdog for node:vm's `timeout`. On fire it requests VM
// termination and wakes a blocked Atomics.wait; the destructor joins the
// worker, so instances are stack-allocated bracketing JSC::evaluate.
class TimeoutWatchdog {
    WTF_MAKE_NONCOPYABLE(TimeoutWatchdog);

public:
    TimeoutWatchdog(JSC::VM& vm, std::optional<int64_t> timeoutMs);
    ~TimeoutWatchdog();

    void disarm();
    bool didFire() const { return m_fired.load(std::memory_order_acquire); }

    // Clears request flag, trap bits, and pending termination exception.
    // Call from the mutator thread after evaluate returns.
    static void clearTerminationState(JSC::VM&);

private:
    void fire();

    JSC::VM& m_vm;
    WTF::Lock m_lock;
    WTF::Condition m_cond;
    std::atomic<bool> m_fired { false };
    bool m_disarmed WTF_GUARDED_BY_LOCK(m_lock) { false };
    RefPtr<WTF::Thread> m_thread;
};

} // namespace Bun
