#include "Semaphore.h"

namespace Bun {

Semaphore::Semaphore(unsigned int value)
{
#if OS(WINDOWS)
    // Like libuv: counting semaphore, abort on failure (callers cannot
    // recover from a semaphore that does not exist).
    m_semaphore = CreateSemaphoreW(nullptr, value, INT_MAX, nullptr);
    RELEASE_ASSERT(m_semaphore);
#elif OS(DARWIN)
    semaphore_create(mach_task_self(), &m_semaphore, SYNC_POLICY_FIFO, value);
#else
    sem_init(&m_semaphore, 0, value);
#endif
}

Semaphore::~Semaphore()
{
#if OS(WINDOWS)
    CloseHandle(m_semaphore);
#elif OS(DARWIN)
    semaphore_destroy(mach_task_self(), m_semaphore);
#else
    sem_destroy(&m_semaphore);
#endif
}

bool Semaphore::signal()
{
#if OS(WINDOWS)
    return ReleaseSemaphore(m_semaphore, 1, nullptr);
#elif OS(DARWIN)
    return semaphore_signal(m_semaphore) == KERN_SUCCESS;
#else
    return sem_post(&m_semaphore) == 0;
#endif
}

bool Semaphore::wait()
{
#if OS(WINDOWS)
    return WaitForSingleObject(m_semaphore, INFINITE) == WAIT_OBJECT_0;
#elif OS(DARWIN)
    return semaphore_wait(m_semaphore) == KERN_SUCCESS;
#else
    return sem_wait(&m_semaphore) == 0;
#endif
}

} // namespace Bun
