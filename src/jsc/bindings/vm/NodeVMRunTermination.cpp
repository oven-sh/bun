#include "NodeVMRunTermination.h"

#include "BunClientData.h"
#include "ErrorCode.h"

#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <wtf/Condition.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/Threading.h>
#include <wtf/Vector.h>
#include <wtf/text/MakeString.h>

namespace Bun {

// The process-wide timer thread: sleeps until the earliest registered deadline, requests the
// termination of the VM of every deadline that has passed, and forgets them. A withdrawn deadline is
// removed at once, so nothing accrues however long the timeouts or however many the runs.
class DeadlineThread {
public:
    static DeadlineThread& singleton()
    {
        static LazyNeverDestroyed<DeadlineThread> thread;
        static std::once_flag once;
        std::call_once(once, [] { thread.construct(); });
        return thread;
    }

    void add(Ref<NodeVMRunTermination::Deadline>&& deadline)
    {
        Locker locker { m_lock };
        m_deadlines.append(WTF::move(deadline));
        if (!m_thread) {
            m_thread = Thread::create("node:vm timeout"_s, [this] { run(); }, ThreadType::Unknown, Thread::QOS::UserInteractive);
        }
        m_condition.notifyOne();
    }

    void remove(NodeVMRunTermination::Deadline& deadline)
    {
        Locker locker { m_lock };
        m_deadlines.removeFirstMatching([&](auto& d) { return d.ptr() == &deadline; });
    }

    DeadlineThread() = default;

private:
    void run()
    {
        Locker locker { m_lock };
        for (;;) {
            if (m_deadlines.isEmpty()) {
                m_condition.wait(m_lock);
                continue;
            }
            MonotonicTime earliest = MonotonicTime::infinity();
            for (auto& d : m_deadlines)
                earliest = std::min(earliest, d->at);
            MonotonicTime now = MonotonicTime::now();
            if (now < earliest) {
                m_condition.waitUntil(m_lock, earliest);
                continue;
            }
            m_deadlines.removeAllMatching([&](auto& d) {
                if (now < d->at)
                    return false;
                Locker deadlineLocker { d->lock };
                if (d->vm) {
                    d->fired = true;
                    d->vm->notifyNeedTermination();
                }
                return true;
            });
        }
    }

    WTF::Lock m_lock;
    WTF::Condition m_condition;
    Vector<Ref<NodeVMRunTermination::Deadline>> m_deadlines WTF_GUARDED_BY_LOCK(m_lock);
    RefPtr<Thread> m_thread WTF_GUARDED_BY_LOCK(m_lock);
};

static thread_local NodeVMRunTermination* s_innermostRunOnThisThread = nullptr;
static thread_local unsigned s_timeoutsArmedOnThisThread = 0;

NodeVMRunTermination::NodeVMRunTermination(JSC::VM& vm, std::optional<double> timeoutMs, SigintReceiver* sigintReceiver)
    : m_vm(vm)
    , m_timeoutMs(timeoutMs)
    , m_sigintReceiver(sigintReceiver)
    , m_enclosing(std::exchange(s_innermostRunOnThisThread, this))
{
    if (m_sigintReceiver)
        m_sigintReceiver->setSigintReceived(false);
    if (!m_timeoutMs && !m_sigintReceiver)
        return;
    // Both requests come from another thread: the TerminationException object they will need must
    // already exist.
    vm.ensureTerminationException();
    if (!m_timeoutMs)
        return;
    m_deadline = adoptRef(*new Deadline(MonotonicTime::now() + Seconds::fromMilliseconds(*m_timeoutMs), vm));
    ++s_timeoutsArmedOnThisThread;
    DeadlineThread::singleton().add(*m_deadline);
}

NodeVMRunTermination::~NodeVMRunTermination()
{
    // An early return that skipped finish() must still not leave the deadline aimed at the VM.
    if (!m_finished)
        withdrawDeadline();
    ASSERT(s_innermostRunOnThisThread == this);
    s_innermostRunOnThisThread = m_enclosing;
}

bool NodeVMRunTermination::withdrawDeadline()
{
    if (!m_deadline)
        return false;
    bool fired;
    {
        Locker locker { m_deadline->lock };
        m_deadline->vm = nullptr;
        fired = m_deadline->fired;
    }
    if (!fired)
        DeadlineThread::singleton().remove(*m_deadline);
    m_deadline = nullptr;
    --s_timeoutsArmedOnThisThread;
    return fired;
}

bool NodeVMRunTermination::cutShort()
{
    if (m_sigintReceiver && m_sigintReceiver->getSigintReceived())
        return true;
    if (!m_deadline)
        return false;
    Locker locker { m_deadline->lock };
    return m_deadline->fired;
}

bool NodeVMRunTermination::timeoutArmedOnCurrentThread()
{
    return s_timeoutsArmedOnThisThread;
}

bool NodeVMRunTermination::finish(JSC::JSGlobalObject* errorGlobalObject, JSC::ThrowScope& scope, JSC::JSGlobalObject* contextGlobalObject)
{
    ASSERT(!m_finished);
    m_finished = true;
    JSC::VM& vm = m_vm;

    bool timedOut = withdrawDeadline();
    bool interrupted = m_sigintReceiver && m_sigintReceiver->getSigintReceived();
    if (m_sigintReceiver)
        m_sigintReceiver->setSigintReceived(false);
    if (!timedOut && !interrupted)
        return false;

    // We asked for the termination that is pending in one of its three forms (trap not yet acted on;
    // acted on: request set and TerminationException thrown; exception meanwhile taken by a catch
    // scope). Take all of it back...
    vm.traps().clearTrap(JSC::VMTraps::NeedTermination);
    // ...unless the VM has meanwhile been asked to stop as a whole, whose request this equally is.
    if (!WebCore::clientData(vm)->scriptAllowed()) {
        vm.notifyNeedTermination();
        return false;
    }
    if (contextGlobalObject)
        vm.drainMicrotasksForGlobalObject(contextGlobalObject);
    {
        // The TerminationException if it is still pending, or whatever the cut-short run threw
        // instead: the timeout / interrupt error replaces it, as in Node.
        auto top = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        if (top.exception())
            top.clearException();
    }
    vm.clearHasTerminationRequest();

    if (interrupted)
        throwError(errorGlobalObject, scope, ErrorCode::ERR_SCRIPT_EXECUTION_INTERRUPTED, "Script execution was interrupted by `SIGINT`"_s);
    else
        throwError(errorGlobalObject, scope, ErrorCode::ERR_SCRIPT_EXECUTION_TIMEOUT, makeString("Script execution timed out after "_s, *m_timeoutMs, "ms"_s));

    // A run this one is nested in may have been cut short as well by now (its own deadline, its own
    // SIGINT); its request was indistinguishable from ours and went with it, so make it again — after
    // building the error above, which a pending trap would have cut short. That error is then just
    // what the enclosing script sees while it unwinds.
    for (auto* run = m_enclosing; run; run = run->m_enclosing) {
        if (run->cutShort()) {
            vm.notifyNeedTermination();
            break;
        }
    }
    return true;
}

} // namespace Bun
