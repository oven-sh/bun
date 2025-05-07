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

    class GlobalObjectHolder {
    public:
        GlobalObjectHolder(NodeVMGlobalObject* globalObject)
            : m_globalObject(globalObject)
        {
            ensureSigintHandler();
            get().registerGlobalObject(globalObject);
        }

        ~GlobalObjectHolder()
        {
            get().unregisterGlobalObject(m_globalObject);
        }

        GlobalObjectHolder(const GlobalObjectHolder&) = delete;
        GlobalObjectHolder(GlobalObjectHolder&& other)
            : m_globalObject(std::exchange(other.m_globalObject, nullptr))
        {
        }

        GlobalObjectHolder& operator=(const GlobalObjectHolder&) = delete;
        GlobalObjectHolder& operator=(GlobalObjectHolder&& other)
        {
            m_globalObject = std::exchange(other.m_globalObject, nullptr);
            return *this;
        }

    private:
        NodeVMGlobalObject* m_globalObject;
    };

    static GlobalObjectHolder hold(NodeVMGlobalObject* globalObject)
    {
        return { globalObject };
    }

    static void ensureSigintHandler();

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
