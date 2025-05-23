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

SigintWatcher SigintWatcher::s_instance;

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

    m_thread = std::thread([this] {
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
        ASSERT(m_thread.get_id() != std::this_thread::get_id());

#if OS(WINDOWS)
        SetConsoleCtrlHandler(WindowsCtrlHandler, false);
#else
        struct sigaction action;
        memset(&action, 0, sizeof(struct sigaction));
        action.sa_handler = SIG_DFL;
        sigemptyset(&action.sa_mask);
        sigaddset(&action.sa_mask, SIGINT);
        action.sa_flags = SA_RESTART;
        sigaction(SIGINT, &action, nullptr);
#endif

        m_semaphore.signal();
        m_thread.join();
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

    std::unique_lock lock(m_globalObjectsMutex);
    m_globalObjects.appendIfNotContains(globalObject);
}

void SigintWatcher::unregisterGlobalObject(JSGlobalObject* globalObject)
{
    if (globalObject == nullptr) {
        return;
    }

    std::unique_lock lock(m_globalObjectsMutex);

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

    std::unique_lock lock(m_receiversMutex);
    m_receivers.appendIfNotContains(module);
}

void SigintWatcher::unregisterReceiver(SigintReceiver* module)
{
    std::unique_lock lock(m_receiversMutex);

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
    return s_instance;
}

bool SigintWatcher::signalAll()
{
    {
        std::unique_lock lock(m_receiversMutex);
        for (auto* receiver : m_receivers) {
            receiver->setSigintReceived();
        }
    }

    std::unique_lock lock(m_globalObjectsMutex);

    if (m_globalObjects.isEmpty()) {
        return false;
    }

    for (JSGlobalObject* globalObject : m_globalObjects) {
        globalObject->vm().notifyNeedTermination();
    }

    return true;
}

} // namespace Bun
