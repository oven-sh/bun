#pragma once

#include "engine/support/FastMalloc.h"
#include "engine/support/Noncopyable.h"

#include <csignal>

extern "C" void* Support__ThreadSuspendLocker__lock();
extern "C" void Support__ThreadSuspendLocker__unlock(void*);

namespace WTF {

// The engine suspends no thread while it lasts.
class ThreadSuspendLocker {
    WTF_MAKE_NONCOPYABLE(ThreadSuspendLocker);
    WTF_MAKE_TZONE_ALLOCATED(ThreadSuspendLocker);

public:
    ThreadSuspendLocker() = default;
    ~ThreadSuspendLocker() { Support__ThreadSuspendLocker__unlock(m_guard); }

private:
    void* const m_guard { Support__ThreadSuspendLocker__lock() };
};

#if OS(LINUX)
struct Config {
    int sigThreadSuspendResume;
};
#endif

}

using WTF::ThreadSuspendLocker;

#if OS(LINUX)
// `bun_engine_platform::suspend::SIGNAL`
inline constexpr WTF::Config g_wtfConfig { SIGPWR };
#endif
