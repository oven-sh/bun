#pragma once

#include "engine/support/Function.h"
#include "engine/support/Ref.h"
#include "engine/support/ThreadSafeRefCounted.h"
#include "engine/text/TextForward.h"

extern "C" void Support__initializeMainThread();
extern "C" bool Support__Thread__mayBeGCThread();

namespace WTF {

namespace Detail {
extern thread_local constinit uint32_t idOfCurrentThread;
uint32_t assignIDToCurrentThread();
}

// Not zero, and never that of another thread.
inline uint32_t currentThreadID()
{
    if (uint32_t id = Detail::idOfCurrentThread) [[likely]]
        return id;
    return Detail::assignIDToCurrentThread();
}

inline bool canCurrentThreadIDAccessThreadLocalData(uint32_t id) { return id == currentThreadID(); }

inline void initializeMainThread() { Support__initializeMainThread(); }

class Thread final : public ThreadSafeRefCounted<Thread> {
public:
    static Ref<Thread> create(ASCIILiteral name, Function<void()>&&);
    ~Thread();

    static Thread& currentSingleton()
    {
        if (auto* thread = s_current) [[likely]]
            return *thread;
        return createForCurrentThread();
    }

    static Thread* currentMayBeNull() { return s_current; }
    static bool mayBeGCThread() { return Support__Thread__mayBeGCThread(); }

    uint32_t uid() const { return m_uid; }

    // Once, for a thread from create().
    void waitForCompletion();

private:
    explicit Thread(uint32_t uid)
        : m_uid(uid)
    {
    }

    static Thread& createForCurrentThread();
    static Thread& makeCurrent(Ref<Thread>&&);

    static thread_local constinit Thread* s_current;

    const uint32_t m_uid;
    Function<void()> m_entryPoint;
    void* m_joinHandle { nullptr };
};

}

using WTF::canCurrentThreadIDAccessThreadLocalData;
using WTF::currentThreadID;
using WTF::Thread;
