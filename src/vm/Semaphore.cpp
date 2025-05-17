#include "Semaphore.h"

namespace Bun {

Semaphore::Semaphore(unsigned int value)
{
#if OS(WINDOWS)
    uv_sem_init(&m_semaphore, value);
#elif OS(DARWIN)
    semaphore_create(mach_task_self(), &m_semaphore, SYNC_POLICY_FIFO, value);
#else
    sem_init(&m_semaphore, 0, value);
#endif
}

Semaphore::~Semaphore()
{
#if OS(WINDOWS)
    uv_sem_destroy(&m_semaphore);
#elif OS(DARWIN)
    semaphore_destroy(mach_task_self(), m_semaphore);
#else
    sem_destroy(&m_semaphore);
#endif
}

bool Semaphore::signal()
{
#if OS(WINDOWS)
    uv_sem_post(&m_semaphore);
    return true;
#elif OS(DARWIN)
    return semaphore_signal(m_semaphore) == KERN_SUCCESS;
#else
    return sem_post(&m_semaphore) == 0;
#endif
}

bool Semaphore::wait()
{
#if OS(WINDOWS)
    uv_sem_wait(&m_semaphore);
    return true;
#elif OS(DARWIN)
    return semaphore_wait(m_semaphore) == KERN_SUCCESS;
#else
    return sem_wait(&m_semaphore) == 0;
#endif
}

} // namespace Bun
