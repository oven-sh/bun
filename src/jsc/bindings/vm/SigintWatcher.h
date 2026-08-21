#pragma once

#include "root.h"

#include "Semaphore.h"
#include "NodeVMRunTermination.h"

#include <atomic>

namespace Bun {

class SigintWatcher {
public:
    SigintWatcher();
    ~SigintWatcher();

    void signalReceived();
    // While registered, a SIGINT is recorded on the receiver and its VM's termination requested. The signal
    // handler is installed while at least one receiver is registered.
    void registerReceiver(NodeVMRunTermination*);
    void unregisterReceiver(NodeVMRunTermination*);

    static SigintWatcher& get();

private:
    RefPtr<WTF::Thread> m_thread;
    std::atomic_bool m_installed = false;
    std::atomic_flag m_waiting {};
    Semaphore m_semaphore;
    // Receivers register concurrently from worker threads. m_receiversMutex guards the list (the signal thread
    // takes it too); m_installMutex serialises the install()/uninstall() transitions its emptiness drives.
    WTF::Lock m_receiversMutex;
    WTF::Lock m_installMutex;
    WTF::Vector<NodeVMRunTermination*, 4> m_receivers;

    void install();
    void uninstall();
    bool signalInnermost();
};

} // namespace Bun
