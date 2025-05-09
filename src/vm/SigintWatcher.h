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
    /** Installs the signal handler if it's not already installed and increments the ref count. */
    void ref();
    /** Decrements the ref count and uninstalls the signal handler if the ref count reaches 0. */
    void deref();

    static SigintWatcher& get();

    class GlobalObjectHolder {
    public:
        GlobalObjectHolder(NodeVMGlobalObject* globalObject)
            : m_globalObject(globalObject)
        {
            if (m_globalObject) {
                get().ref();
                get().registerGlobalObject(globalObject);
            }
        }

        ~GlobalObjectHolder()
        {
            if (m_globalObject) {
                get().unregisterGlobalObject(m_globalObject);
                get().deref();
            }
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
        NodeVMGlobalObject* m_globalObject = nullptr;
    };

    static GlobalObjectHolder hold(NodeVMGlobalObject* globalObject)
    {
        return { globalObject };
    }

private:
    std::thread m_thread;
    std::atomic_bool m_installed = false;
    std::atomic_flag m_waiting = false;
    Semaphore m_semaphore;
    std::mutex m_globalObjectsMutex;
    WTF::Vector<NodeVMGlobalObject*> m_globalObjects;
    uint32_t m_refCount = 0;

    bool signalAll();

    static SigintWatcher s_instance;
};

} // namespace Bun
