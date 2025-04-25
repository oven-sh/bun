#pragma once

#include "root.h"
#include "Semaphore.h"

#include <atomic>
#include <mutex>
#include <thread>
#include <vector>

namespace Bun {

class NodeVMGlobalObject;

class SigintWatcher {
public:
    SigintWatcher();
    ~SigintWatcher();

    void install();
    void uninstall();
    void signalReceived();
    void registerGlobalObject(NodeVMGlobalObject* globalObject);
    void unregisterGlobalObject(NodeVMGlobalObject* globalObject);

    static SigintWatcher& get();

private:
    std::thread m_thread;
    std::atomic_bool m_installed = false;
    std::atomic_flag m_waiting = false;
    Semaphore m_semaphore;
    std::mutex m_globalObjectsMutex;
    std::vector<NodeVMGlobalObject*> m_globalObjects;

    bool signalAll();

    static SigintWatcher s_instance;
};

} // namespace Bun
