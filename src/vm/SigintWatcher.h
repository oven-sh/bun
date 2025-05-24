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

        ~GlobalObjectHolder()
        {
            for (auto* receiver : m_receivers) {
                get().unregisterReceiver(receiver);
            }

            if (m_globalObject) {
                get().unregisterGlobalObject(m_globalObject);
                get().deref();
            }
        }

        GlobalObjectHolder(const GlobalObjectHolder&) = delete;
        GlobalObjectHolder(GlobalObjectHolder&& other)
            : m_globalObject(std::exchange(other.m_globalObject, nullptr))
            , m_receivers(WTFMove(other.m_receivers))
        {
        }

        GlobalObjectHolder& operator=(const GlobalObjectHolder&) = delete;
        GlobalObjectHolder& operator=(GlobalObjectHolder&& other)
        {
            m_globalObject = std::exchange(other.m_globalObject, nullptr);
            m_receivers = WTFMove(other.m_receivers);
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

    template<typename... Ts>
    ALWAYS_INLINE static GlobalObjectHolder hold(Ts*... held)
    {
        return { held... };
    }

private:
    RefPtr<WTF::Thread> m_thread;
    std::atomic_bool m_installed = false;
    std::atomic_flag m_waiting {};
    Semaphore m_semaphore;
    WTF::Lock m_globalObjectsMutex;
    WTF::Lock m_receiversMutex;
    WTF::Vector<JSC::JSGlobalObject*> m_globalObjects;
    WTF::Vector<SigintReceiver*> m_receivers;
    uint32_t m_refCount = 0;

    bool signalAll();
};

} // namespace Bun
