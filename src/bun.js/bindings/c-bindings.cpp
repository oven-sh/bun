// when we don't want to use @cInclude, we can just stick wrapper functions here
#include <sys/resource.h>
#include <cstdint>

extern "C" int32_t get_process_priority(uint32_t pid)
{
    return getpriority(PRIO_PROCESS, pid);
}

extern "C" int32_t set_process_priority(uint32_t pid, int32_t priority)
{
    return setpriority(PRIO_PROCESS, pid, priority);
}