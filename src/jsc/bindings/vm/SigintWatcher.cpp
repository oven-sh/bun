#include "NodeVM.h"
#include "SigintWatcher.h"

#include <JavaScriptCore/WaiterListManager.h>

#if OS(WINDOWS)
#include <windows.h>
#endif

extern "C" void Bun__onPosixSignal(int signalNumber);
extern "C" void Bun__ensureSignalHandler();

namespace Bun {

#if OS(WINDOWS)
static BOOL WindowsCtrlHandler(DWORD signal)
{
    if (signal == CTRL_C_EVENT) {
        SigintWatcher::get().signalReceived();
        return true;
    }

    return false;
}
#endif

SigintWatcher::SigintWatcher()
    : m_semaphore(1)
{
    m_globalObjects.reserveInitialCapacity(16);
}

SigintWatcher::~SigintWatcher()
{
    uninstall();
}

void SigintWatcher::install()
{
#if OS(WINDOWS)
    SetConsoleCtrlHandler(WindowsCtrlHandler, true);
#else
    Bun__ensureSignalHandler();

    struct sigaction action;
    memset(&action, 0, sizeof(struct sigaction));

    action.sa_handler = [](int signalNumber) {
        get().signalReceived();
    };

    sigemptyset(&action.sa_mask);
    sigaddset(&action.sa_mask, SIGINT);
    action.sa_flags = 0;

    sigaction(SIGINT, &action, nullptr);
#endif

    if (m_installed.exchange(true)) {
        return;
    }

    m_thread = WTF::Thread::create("SigintWatcher"_s, [this] {
        while (m_installed.load()) {
            bool success = m_semaphore.wait();
            if (!m_installed) {
                return;
            }
            ASSERT(success);
            if (m_waiting.test_and_set()) {
                m_waiting.clear();
#if !OS(WINDOWS)
                if (!signalAll()) {
                    Bun__onPosixSignal(SIGINT);
                }
#else
                signalAll();
#endif
            } else {
                m_waiting.clear();
            }
        }
    });
}

void SigintWatcher::uninstall()
{
    if (m_installed.exchange(false)) {
        WTF::Thread* currentThread = WTF::Thread::currentMayBeNull();
        ASSERT(!currentThread || m_thread->uid() != currentThread->uid());

#if OS(WINDOWS)
        SetConsoleCtrlHandler(WindowsCtrlHandler, false);
#else
        struct sigaction action;
        memset(&action, 0, sizeof(struct sigaction));
        action.sa_handler = Bun__onPosixSignal;
        sigemptyset(&action.sa_mask);
        sigaddset(&action.sa_mask, SIGINT);
        action.sa_flags = SA_RESTART;
        sigaction(SIGINT, &action, nullptr);
#endif

        m_semaphore.signal();
        m_thread->waitForCompletion();
    }
}

void SigintWatcher::signalReceived()
{
    if (!m_waiting.test_and_set()) {
        bool success = m_semaphore.signal();
        ASSERT(success);
    }
}

void SigintWatcher::registerGlobalObject(JSGlobalObject* globalObject)
{
    if (globalObject == nullptr) {
        return;
    }

    WTF::Locker lock(m_globalObjectsMutex);
    m_globalObjects.appendIfNotContains(globalObject);
}

void SigintWatcher::unregisterGlobalObject(JSGlobalObject* globalObject)
{
    if (globalObject == nullptr) {
        return;
    }

    WTF::Locker lock(m_globalObjectsMutex);

    auto iter = std::find(m_globalObjects.begin(), m_globalObjects.end(), globalObject);
    if (iter == m_globalObjects.end()) {
        return;
    }

    std::swap(*iter, m_globalObjects.last());
    m_globalObjects.removeLast();
}

void SigintWatcher::registerReceiver(SigintReceiver* module)
{
    if (module == nullptr) {
        return;
    }

    WTF::Locker lock(m_receiversMutex);
    m_receivers.appendIfNotContains(module);
}

void SigintWatcher::unregisterReceiver(SigintReceiver* module)
{
    WTF::Locker lock(m_receiversMutex);

    auto iter = std::find(m_receivers.begin(), m_receivers.end(), module);
    if (iter == m_receivers.end()) {
        return;
    }

    std::swap(*iter, m_receivers.last());
    m_receivers.removeLast();
}

void SigintWatcher::ref()
{
    // ref()/deref() race across worker_threads (each worker registers its own
    // global while running vm code with breakOnSigint). The lock makes the
    // count and the paired install()/uninstall() transition atomic; a lost
    // increment would otherwise let one worker's deref() tear down the
    // watcher thread while another worker still holds a reference, and the
    // underflowing count would trip the ASSERT below.
    WTF::Locker locker { m_refCountMutex };
    if (m_refCount++ == 0) {
        install();
    }
}

void SigintWatcher::deref()
{
    WTF::Locker locker { m_refCountMutex };
    ASSERT(m_refCount > 0);
    if (--m_refCount == 0) {
        uninstall();
    }
}

SigintWatcher& SigintWatcher::get()
{
    static SigintWatcher instance;
    return instance;
}

bool SigintWatcher::signalAll()
{
    {
        WTF::Locker lock(m_receiversMutex);
        for (auto* receiver : m_receivers) {
            receiver->setSigintReceived();
        }
    }

    WTF::Locker lock(m_globalObjectsMutex);

    if (m_globalObjects.isEmpty()) {
        return false;
    }

    for (JSGlobalObject* globalObject : m_globalObjects) {
        JSC::VM& vm = globalObject->vm();
        // Atomics.wait's park loop (WaiterListManager::waitForSync) only exits
        // on hasTerminationRequest(); the NeedTermination trap wakes the waiter
        // but is serviced only at safepoints, which a parked thread never reaches.
        vm.setHasTerminationRequest();
        vm.notifyNeedTermination();
        // fireTrap only notifies the sync waiter on the first thread-stop
        // request; if another async trap (a {timeout} watchdog fire) already
        // requested one, the parked waiter would not be woken. POSIX hides
        // this behind the trap SignalSender's retry loop, but that is
        // compiled out on Windows and under usePollingTraps.
        vm.syncWaiter()->condition().notifyOne();
    }

    return true;
}

} // namespace Bun
