#include "TimeoutWatchdog.h"

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/VMTraps.h>
#include <JavaScriptCore/WaiterListManager.h>
#include <JavaScriptCore/ExceptionScope.h>

namespace Bun {

TimeoutWatchdog::TimeoutWatchdog(JSC::VM& vm, std::optional<int64_t> timeoutMs)
    : m_vm(vm)
{
    if (!timeoutMs)
        return;

    // throwTerminationException() (reached via handleTraps / Atomics.wait
    // Terminated) asserts this exists; allocate it on the mutator thread.
    vm.ensureTerminationException();

    auto deadline = MonotonicTime::now() + Seconds::fromMilliseconds(static_cast<double>(*timeoutMs));
    m_thread = WTF::Thread::create("node:vm timeout"_s, [this, deadline] {
        Locker locker { m_lock };
        while (!m_disarmed) {
            if (m_cond.waitUntil(m_lock, deadline))
                continue;
            if (m_disarmed)
                return;
            fire();
            // Re-assert until disarmed: a nested scope's clearTerminationState
            // can wipe the request this watchdog installed, and a lost notify
            // can land between the waiter's predicate check and parking.
            while (!m_disarmed) {
                if (m_cond.waitUntil(m_lock, MonotonicTime::now() + 1_ms))
                    continue;
                fire();
            }
            return;
        }
    });
}

TimeoutWatchdog::~TimeoutWatchdog()
{
    disarm();
}

void TimeoutWatchdog::disarm()
{
    if (!m_thread)
        return;
    {
        Locker locker { m_lock };
        m_disarmed = true;
    }
    m_cond.notifyOne();
    m_thread->waitForCompletion();
    m_thread = nullptr;
}

void TimeoutWatchdog::fire()
{
    m_fired.store(true, std::memory_order_release);
    // waitForSync's loop predicate is !vm.hasTerminationRequest(); set it
    // before the notify so a woken Atomics.wait returns Terminated.
    m_vm.setHasTerminationRequest();
    // Raise NeedTermination so running JS exits at the next back-edge, and
    // notify the sync waiter unconditionally (requestThreadStopIfNeeded skips
    // its own notify when a thread-stop is already pending).
    m_vm.notifyNeedTermination();
    m_vm.syncWaiter()->condition().notifyOne();
}

void TimeoutWatchdog::clearTerminationState(JSC::VM& vm)
{
    if (vm.hasPendingTerminationException()) {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        scope.clearException();
    }
    vm.clearHasTerminationRequest();
    vm.traps().clearTrap(JSC::VMTraps::NeedTermination);
    vm.traps().clearTrap(JSC::VMTraps::NeedWatchdogCheck);
}

} // namespace Bun
