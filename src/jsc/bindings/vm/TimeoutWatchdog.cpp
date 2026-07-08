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

    // The worker thread requests termination via throwTerminationException()
    // (reached from VMTraps::handleTraps / Atomics.wait Terminated). That
    // path asserts the lazily-allocated termination exception exists, so
    // create it now on the mutator thread.
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
            // Keep nudging the sync waiter until the mutator disarms us:
            // the first notify can be lost if it lands between the waiter
            // evaluating its loop predicate and parking (we do not hold the
            // waiter's list lock).
            while (!m_disarmed) {
                if (m_cond.waitUntil(m_lock, MonotonicTime::now() + 1_ms))
                    continue;
                m_vm.syncWaiter()->condition().notifyOne();
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
    // Mark the VM as terminating so WaiterListManager::waitForSync's loop
    // predicate (!vm.hasTerminationRequest()) falls through and a blocked
    // Atomics.wait returns Terminated. m_hasTerminationRequest is a plain
    // bool but the notify below is a full fence and the woken waiter
    // reacquires its list lock (acquire), so the write is observable.
    m_vm.setHasTerminationRequest();
    // Raise NeedTermination so running JS exits at the next back-edge. This
    // path also reaches requestThreadStopIfNeeded which notifies the sync
    // waiter, but that notify is skipped when a thread-stop is already
    // pending, so deliver one unconditionally here as well.
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
