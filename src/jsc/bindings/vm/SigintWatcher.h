#pragma once

#include "root.h"

#include "Semaphore.h"
#include "SigintReceiver.h"

#include <atomic>

namespace Bun {

template<typename T>
concept SigintHoldable = std::derived_from<T, JSC::JSGlobalObject> || std::derived_from<T, SigintReceiver>;

class SigintWatcher {
public:
    SigintWatcher();
    ~SigintWatcher();

    void install();
    void uninstall();
    void signalReceived();
    void registerGlobalObject(JSC::JSGlobalObject* globalObject);
    void unregisterGlobalObject(JSC::JSGlobalObject* globalObject);
    void registerReceiver(SigintReceiver* module);
    void unregisterReceiver(SigintReceiver* module);
    /** Installs the signal handler if it's not already installed and increments the ref count. */
    void ref();
    /** Decrements the ref count and uninstalls the signal handler if the ref count reaches 0. */
    void deref();

    static SigintWatcher& get();

    class GlobalObjectHolder {
    public:
        template<typename... Ts>
        ALWAYS_INLINE GlobalObjectHolder(Ts*... held)
        {
            (assign(held), ...);
        }

        // The realm before the receivers: signalAll() flags receivers and then notifies realms, so a SIGINT that
        // still reaches this realm has already been recorded on its receivers.
        ~GlobalObjectHolder()
        {
            if (m_globalObject) {
                get().unregisterGlobalObject(m_globalObject);
            }

            for (auto* receiver : m_receivers) {
                get().unregisterReceiver(receiver);
            }

            if (m_globalObject) {
                get().deref();
            }
        }

        GlobalObjectHolder(const GlobalObjectHolder&) = delete;
        GlobalObjectHolder(GlobalObjectHolder&& other)
            : m_globalObject(std::exchange(other.m_globalObject, nullptr))
            , m_receivers(WTF::move(other.m_receivers))
        {
        }

        GlobalObjectHolder& operator=(const GlobalObjectHolder&) = delete;
        GlobalObjectHolder& operator=(GlobalObjectHolder&& other)
        {
            m_globalObject = std::exchange(other.m_globalObject, nullptr);
            m_receivers = WTF::move(other.m_receivers);
            return *this;
        }

        void ALWAYS_INLINE assign(SigintHoldable auto* ptr)
        {
            using T = std::remove_pointer_t<decltype(ptr)>;
            if constexpr (std::derived_from<T, JSC::JSGlobalObject>) {
                if ((m_globalObject = ptr)) {
                    get().ref();
                    get().registerGlobalObject(m_globalObject);
                }
            } else if constexpr (std::derived_from<T, SigintReceiver>) {
                m_receivers.append(ptr);
                get().registerReceiver(ptr);
            } else {
                static_assert(false, "Invalid held type");
            }
        }

    private:
        JSC::JSGlobalObject* m_globalObject = nullptr;
        WTF::Vector<SigintReceiver*, 4> m_receivers;
    };

private:
    RefPtr<WTF::Thread> m_thread;
    std::atomic_bool m_installed = false;
    std::atomic_flag m_waiting {};
    Semaphore m_semaphore;
    WTF::Lock m_globalObjectsMutex;
    WTF::Lock m_receiversMutex;
    // Guards m_refCount and the install()/uninstall() transitions it drives;
    // ref()/deref() are called concurrently from worker threads.
    WTF::Lock m_refCountMutex;
    WTF::Vector<JSC::JSGlobalObject*> m_globalObjects;
    WTF::Vector<SigintReceiver*> m_receivers;
    uint32_t m_refCount = 0;

    bool signalAll();
};

} // namespace Bun
