#include "NodeVM.h"
#include "SigintWatcher.h"

#if OS(WINDOWS)
#include <windows.h>
#endif

extern "C" void Bun__onPosixSignal(int signalNumber);
extern "C" void Bun__ensureSignalHandler();

namespace Bun {

#if OS(WINDOWS)
// Defined in c-bindings.cpp - non-zero when we're waiting for a sync child process
extern "C" int64_t Bun__currentSyncPID;
// Defined in c-bindings.cpp - for async subprocess Ctrl+C handling
extern "C" int64_t Bun__getActiveSubprocessCount();
extern "C" void Bun__setPendingCtrlC();

static BOOL WindowsCtrlHandler(DWORD signal)
{
    if (signal == CTRL_C_EVENT) {
        // If we're waiting for a sync child process, don't terminate the parent.
        // The child will receive CTRL_C_EVENT directly from Windows and handle it.
        // This matches POSIX behavior where the parent forwards the signal to the child
        // and waits for the child to exit.
        if (Bun__currentSyncPID != 0) {
            return true; // Absorb the event, don't terminate parent
        }
        
        // If we have active async subprocesses, let them handle Ctrl+C.
        // Mark pending so parent can exit after child exits.
        if (Bun__getActiveSubprocessCount() > 0) {
            Bun__setPendingCtrlC();
            return true; // Absorb the event, don't terminate parent
        }
        
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
    if (m_refCount++ == 0) {
        install();
    }
}

void SigintWatcher::deref()
{
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
        globalObject->vm().notifyNeedTermination();
    }

    return true;
}

} // namespace Bun
