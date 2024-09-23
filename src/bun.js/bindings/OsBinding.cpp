#include "root.h"

#if OS(DARWIN)
#include <mach/vm_types.h>
#include <mach/mach_host.h>
#include <mach/mach_init.h>
#include <mach/message.h>
#include <mach/vm_statistics.h>
#include <unistd.h>

// Adapted from libuv darwin uv_get_free_memory, MIT
extern "C" uint64_t Bun__Os__getFreeMemory(void)
{
    vm_statistics_data_t info;
    mach_msg_type_number_t count = sizeof(info) / sizeof(integer_t);

    if (host_statistics(mach_host_self(), HOST_VM_INFO,
            (host_info_t)&info, &count)
        != KERN_SUCCESS) {
        return 0;
    }

    return (uint64_t)info.free_count * sysconf(_SC_PAGESIZE);
}
#endif
