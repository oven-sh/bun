#include "NodeVM.h"
#include "SigintWatcher.h"

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
                if (!signalInnermost()) {
                    Bun__onPosixSignal(SIGINT);
                }
#else
                signalInnermost();
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

void SigintWatcher::registerReceiver(NodeVMRunTermination* receiver)
{
    WTF::Locker transition(m_installMutex);
    bool wasEmpty;
    {
        WTF::Locker lock(m_receiversMutex);
        wasEmpty = m_receivers.isEmpty();
        m_receivers.append(receiver);
    }
    if (wasEmpty)
        install();
}

void SigintWatcher::unregisterReceiver(NodeVMRunTermination* receiver)
{
    WTF::Locker transition(m_installMutex);
    bool nowEmpty;
    {
        WTF::Locker lock(m_receiversMutex);
        auto index = m_receivers.reverseFind(receiver);
        ASSERT(index != notFound);
        if (index == notFound)
            return;
        m_receivers.removeAt(index);
        nowEmpty = m_receivers.isEmpty();
    }
    // Not under m_receiversMutex: uninstall() joins the signal thread, which takes it in signalInnermost().
    if (nowEmpty)
        uninstall();
}

SigintWatcher& SigintWatcher::get()
{
    static SigintWatcher instance;
    return instance;
}

// As in Node (SigintWatchdogHelper::InformWatchdogsAboutSignal): one SIGINT interrupts the innermost run.
bool SigintWatcher::signalInnermost()
{
    WTF::Locker lock(m_receiversMutex);
    if (m_receivers.isEmpty())
        return false;
    auto* receiver = m_receivers.last();
    receiver->setSigintReceived();
    receiver->vm().notifyNeedTermination();
    return true;
}

} // namespace Bun
