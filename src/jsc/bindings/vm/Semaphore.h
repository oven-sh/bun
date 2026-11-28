#pragma once

#include "root.h"

#if OS(WINDOWS)
#include <wtf/Condition.h>
#include <wtf/Lock.h>
#elif OS(DARWIN)
#include <mach/task.h>
#include <mach/semaphore.h>
#else
#include <semaphore.h>
#endif

namespace Bun {

class Semaphore {
public:
    Semaphore(unsigned int value);
    ~Semaphore();

    bool signal();
    bool wait();

private:
#if OS(WINDOWS)
    WTF::Lock m_lock;
    WTF::Condition m_condition;
    unsigned int m_value WTF_GUARDED_BY_LOCK(m_lock);
#elif OS(DARWIN)
    semaphore_t m_semaphore;
#else
    sem_t m_semaphore;
#endif
};

} // namespace Bun
