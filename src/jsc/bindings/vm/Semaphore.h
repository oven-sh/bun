#pragma once

#include "root.h"

#if OS(WINDOWS)
#include <uv.h>
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
    uv_sem_t m_semaphore;
#elif OS(DARWIN)
    semaphore_t m_semaphore;
#else
    sem_t m_semaphore;
#endif
};

} // namespace Bun
