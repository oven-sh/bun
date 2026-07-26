#pragma once

#include "root.h"

#include "JavaScriptCore/Watchdog.h"

namespace Bun {

// Arms the JSC Watchdog for one node:vm `{timeout}` evaluation and records,
// via ShouldTerminateCallback, whether the watchdog itself fired. Lets
// checkForTermination tell its own timeout apart from a foreign termination
// (worker.terminate(), process.exit(), an enclosing evaluation's watchdog).
class NodeVMWatchdogScope {
    WTF_MAKE_NONCOPYABLE(NodeVMWatchdogScope);
    WTF_MAKE_NONMOVABLE(NodeVMWatchdogScope);

public:
    NodeVMWatchdogScope(JSC::VM& vm, double milliseconds)
        : m_vm(vm)
        , m_enclosing(s_innermost)
    {
        JSC::JSLockHolder locker(vm);
        JSC::Watchdog& dog = vm.ensureWatchdog();
        dog.enteredVM();
        m_previousLimit = dog.getTimeLimit();
        WTF::Seconds limit = WTF::Seconds::fromMilliseconds(milliseconds);
        if (!m_previousLimit.isInfinity() && m_previousLimit < limit)
            limit = m_previousLimit;
        m_milliseconds = limit.milliseconds();
        dog.setTimeLimit(limit, &didFire, this, nullptr);
        s_innermost = this;
    }

    ~NodeVMWatchdogScope() { disarm(); }

    void disarm()
    {
        if (std::exchange(m_disarmed, true))
            return;
        s_innermost = m_enclosing;
        m_vm.watchdog()->setTimeLimit(m_previousLimit, m_enclosing ? &didFire : nullptr, m_enclosing, nullptr);
    }

    bool timedOut() const { return m_timedOut; }
    double milliseconds() const { return m_milliseconds; }

private:
    static bool didFire(JSC::JSGlobalObject*, void* self, void*)
    {
        static_cast<NodeVMWatchdogScope*>(self)->m_timedOut = true;
        return true;
    }

    static thread_local NodeVMWatchdogScope* s_innermost;

    JSC::VM& m_vm;
    NodeVMWatchdogScope* m_enclosing;
    WTF::Seconds m_previousLimit { WTF::Seconds::infinity() };
    double m_milliseconds { 0 };
    bool m_timedOut { false };
    bool m_disarmed { false };
};

} // namespace Bun
