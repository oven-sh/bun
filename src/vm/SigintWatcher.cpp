#include "NodeVM.h"
#include "SigintWatcher.h"

extern "C" void Bun__onPosixSignal(int signalNumber);

namespace Bun {

SigintWatcher SigintWatcher::s_instance;

SigintWatcher::SigintWatcher()
    : m_semaphore(1)
{
    m_globalObjects.reserve(16);
}

SigintWatcher::~SigintWatcher()
{
    uninstall();
}

void SigintWatcher::install()
{
    if (m_installed.exchange(true)) {
        return;
    }

    m_thread = std::thread([this] {
        while (m_installed.load()) {
            bool success = m_semaphore.wait();
            ASSERT(success);
            if (m_waiting.test_and_set()) {
                m_waiting.clear();
                if (!signalAll()) {
                }
                Bun__onPosixSignal(SIGINT);
            } else {
                m_waiting.clear();
            }
        }
    });
}

void SigintWatcher::uninstall()
{
    if (m_installed.exchange(false)) {
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

void SigintWatcher::registerGlobalObject(NodeVMGlobalObject* globalObject)
{
    std::unique_lock lock(m_globalObjectsMutex);

    m_globalObjects.push_back(globalObject);
}

void SigintWatcher::unregisterGlobalObject(NodeVMGlobalObject* globalObject)
{
    std::unique_lock lock(m_globalObjectsMutex);

    auto iter = std::find(m_globalObjects.begin(), m_globalObjects.end(), globalObject);

    if (iter == m_globalObjects.end()) {
        return;
    }

    std::swap(*iter, m_globalObjects.back());
    m_globalObjects.pop_back();
}

SigintWatcher& SigintWatcher::get()
{
    return s_instance;
}

bool SigintWatcher::signalAll()
{
    std::unique_lock lock(m_globalObjectsMutex);

    if (m_globalObjects.empty()) {
        return false;
    }

    for (NodeVMGlobalObject* globalObject : m_globalObjects) {
        globalObject->sigintReceived();
    }

    return true;
}

} // namespace Bun
