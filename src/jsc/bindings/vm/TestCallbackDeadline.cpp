#include "TestCallbackDeadline.h"

#include "BunClientData.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/VM.h>
#include <wtf/Condition.h>
#include <wtf/Lock.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/Threading.h>

extern "C" JSC::EncodedJSValue Bun__JSValue__call(JSC::JSGlobalObject*, JSC::EncodedJSValue function, JSC::EncodedJSValue thisValue, size_t argumentCount, const JSC::EncodedJSValue* arguments);
// Any thread: JSC::VM::notifyNeedTermination() on the handle's VM, unless that VM is gone.
extern "C" void Bun__VmHandle__notifyNeedTermination(const BunVmHandleRef*);
#if OS(WINDOWS)
extern "C" void clock_gettime_monotonic(int64_t* seconds, int64_t* nanoseconds);
#else
extern "C" uint64_t us_internal_monotonic_ns(void);
#endif

namespace Bun {

using namespace JSC;

// bun_core::Timespec's clock.
static uint64_t monotonicNanoseconds()
{
#if OS(WINDOWS)
    int64_t seconds = 0;
    int64_t nanoseconds = 0;
    clock_gettime_monotonic(&seconds, &nanoseconds);
    return static_cast<uint64_t>(seconds) * 1'000'000'000 + static_cast<uint64_t>(nanoseconds);
#else
    return us_internal_monotonic_ns();
#endif
}

// The thread that requests the termination when the deadline of the callback on the VM's stack passes. There
// is one, for the VM that first arms it: a process runs its test callbacks on one VM.
//
// A suite arms and disarms once per callback, so each is one atomic operation on m_state and neither takes
// the lock. The thread is woken only for a deadline earlier than the one it sleeps until, so with one timeout
// for every test it wakes once per timeout, not once per callback.
class TestCallbackDeadlineWatch {
    WTF_MAKE_NONCOPYABLE(TestCallbackDeadlineWatch);

public:
    static TestCallbackDeadlineWatch& singleton(VM& vm)
    {
        static NeverDestroyed<TestCallbackDeadlineWatch> watch(vm);
        return watch;
    }

    explicit TestCallbackDeadlineWatch(VM& vm)
        : m_vm(WebCore::clientData(vm)->vmHandle)
    {
        // The thread's request needs the exception object to exist.
        vm.ensureTerminationException();
        Thread::create("TestTimeout"_s, [this] { run(); })->detach();
    }

    // What disarm() takes, or 0 if it is not armed: `vm` is not this watch's VM.
    uint64_t arm(VM& vm, uint64_t deadline)
    {
        if (WebCore::clientData(vm)->vmHandle != m_vm) [[unlikely]]
            return 0;
        deadline = std::max<uint64_t>(deadline, EarliestDeadline);
        uint64_t idle = Idle;
        if (!m_state.compare_exchange_strong(idle, deadline)) [[unlikely]] {
            // Test callbacks do not nest (RunTestsTask::call).
            ASSERT_NOT_REACHED();
            return 0;
        }
        // The thread publishes m_sleepingUntil and then reads m_state again before it sleeps, so either this
        // sees the later time it is about to sleep until, or it sees this deadline.
        if (deadline < m_sleepingUntil.load()) [[unlikely]] {
            // Taken so that the notification cannot come between the thread's last look and its sleep.
            {
                Locker locker { m_lock };
            }
            m_condition.notifyOne();
        }
        return deadline;
    }

    // Whether the deadline passed first. Either way the thread requests nothing more for it once this returns.
    bool disarm(uint64_t deadline)
    {
        uint64_t state = deadline;
        if (m_state.compare_exchange_strong(state, Idle)) [[likely]]
            return false;
        // The thread is making the request: a withdrawal before it has been made would leave it pending.
        while (state != Fired) {
            Thread::yield();
            state = m_state.load();
        }
        m_state.store(Idle);
        return true;
    }

    // The armed deadline has passed and the request is made, or is being made.
    bool hasFired() const
    {
        uint64_t state = m_state.load();
        return state == Firing || state == Fired;
    }

private:
    // m_state is one of these, or the armed deadline.
    static constexpr uint64_t Idle = 0;
    static constexpr uint64_t Firing = 1;
    static constexpr uint64_t Fired = 2;
    static constexpr uint64_t EarliestDeadline = 3;
    static constexpr uint64_t Never = std::numeric_limits<uint64_t>::max();

    void run()
    {
        Locker locker { m_lock };
        while (true) {
            uint64_t state = m_state.load();
            uint64_t deadline = state >= EarliestDeadline ? state : Never;
            m_sleepingUntil.store(deadline);
            if (m_state.load() != state)
                continue;
            if (deadline == Never) {
                m_condition.wait(m_lock);
                continue;
            }
            uint64_t now = monotonicNanoseconds();
            if (now < deadline) {
                m_condition.waitFor(m_lock, Seconds::fromNanoseconds(deadline - now));
                continue;
            }
            // The callback disarms only from this state or from Fired, so its VM is running it until then.
            if (!m_state.compare_exchange_strong(state, Firing))
                continue;
            Bun__VmHandle__notifyNeedTermination(m_vm.get());
            m_state.store(Fired);
        }
    }

    const RefPtr<const BunVmHandleRef> m_vm;
    std::atomic<uint64_t> m_state { Idle };
    std::atomic<uint64_t> m_sleepingUntil { 0 };
    Lock m_lock;
    Condition m_condition;
};

TestCallbackDeadline::TestCallbackDeadline(JSGlobalObject* globalObject, uint64_t deadline)
    : RunTermination(globalObject->vm(), Kind::TestCallback)
{
    // A callback that a debugger paused past its deadline is not cut short when it resumes.
    if (globalObject->hasDebugger()) [[unlikely]]
        return;
    auto& watch = TestCallbackDeadlineWatch::singleton(m_vm);
    m_armedFor = watch.arm(m_vm, deadline);
    if (m_armedFor) [[likely]]
        m_watch = &watch;
}

TestCallbackDeadline::~TestCallbackDeadline()
{
    ASSERT(!m_watch);
}

bool TestCallbackDeadline::fired() const
{
    return m_watch ? m_watch->hasFired() : m_fired;
}

bool TestCallbackDeadline::finish()
{
    if (auto* watch = std::exchange(m_watch, nullptr))
        m_fired = watch->disarm(m_armedFor);
    if (!m_fired) [[likely]]
        return false;
    // A request that came after everything had returned unwound nothing.
    bool unwound = m_vm.hasPendingTerminationException();
    return withdrawTermination() && unwound;
}

} // namespace Bun

// bun_jsc::JSValue::call_with_test_deadline reads it.
enum class TestCallbackOutcome : uint8_t {
    // The callback returned, or threw (then the result is empty and the exception is pending).
    Completed = 0,
    // The deadline cut the callback or its checkpoint short. Nothing is pending.
    CutShort = 1,
    // The VM is stopping, and the checkpoint found nothing pending to say so.
    Stopped = 2,
};

// Bun__JSValue__call and the microtask checkpoint after it, for a bun:test callback whose timeout ends at
// `deadline` (nanoseconds on bun_core::Timespec's clock). `afterCall` runs between the two.
//
// `deadlineCoversCheckpoint`: the checkpoint runs under the deadline as well. A termination there discards
// every queued microtask (JSC::MicrotaskQueue::drainImpl), so the caller asks for it only when all of them
// are the callback's own.
extern "C" JSC::EncodedJSValue Bun__TestCallback__callWithDeadline(Zig::GlobalObject* globalObject, JSC::EncodedJSValue callback, JSC::EncodedJSValue thisValue,
    size_t argumentCount, const JSC::EncodedJSValue* arguments, uint64_t deadline, bool deadlineCoversCheckpoint,
    void (*afterCall)(void*), void* afterCallContext, TestCallbackOutcome* outcome)
{
    using CheckpointException = Zig::GlobalObject::CheckpointException;
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    *outcome = TestCallbackOutcome::Completed;

    Bun::TestCallbackDeadline timeLimit(globalObject, deadline);
    JSC::EncodedJSValue result = Bun__JSValue__call(globalObject, callback, thisValue, argumentCount, arguments);
    afterCall(afterCallContext);
    bool threw = !!scope.exception();
    uint8_t terminating = 0;
    if (deadlineCoversCheckpoint && !threw) [[likely]] {
        vm.finalizeSynchronousJSExecution();
        terminating = globalObject->drainMicrotasks(CheckpointException::LeftPending);
    }
    if (timeLimit.finish()) [[unlikely]] {
        *outcome = TestCallbackOutcome::CutShort;
        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsUndefined()));
    }
    if (threw) [[unlikely]]
        RELEASE_AND_RETURN(scope, {});

    if (!deadlineCoversCheckpoint) {
        vm.finalizeSynchronousJSExecution();
        terminating = globalObject->drainMicrotasks();
    } else if (auto* exception = scope.exception()) [[unlikely]] {
        // The termination of a VM that is being stopped.
        if (vm.isTerminationException(exception))
            RELEASE_AND_RETURN(scope, {});
        // Only reported now: reporting can run user code outside of script, where a termination is the VM's stop.
        auto top = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        (void)top.tryClearException();
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
    }
    if (terminating) [[unlikely]]
        *outcome = TestCallbackOutcome::Stopped;
    RELEASE_AND_RETURN(scope, result);
}
