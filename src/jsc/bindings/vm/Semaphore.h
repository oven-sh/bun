#pragma once

#include "root.h"

#if OS(DARWIN)
#include <mach/task.h>
#include <mach/semaphore.h>
#elif !OS(WINDOWS)
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
    void* m_semaphore; // HANDLE
#elif OS(DARWIN)
    semaphore_t m_semaphore;
#else
    sem_t m_semaphore;
#endif
};

} // namespace Bun
