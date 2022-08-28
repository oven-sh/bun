#include "system_memory.h"

#include <stdint.h>

#if __APPLE__
#include <mach/mach.h>
#include <sys/resource.h>
#include <sys/sysctl.h>
#include <unistd.h>

extern "C" uint64_t getFreeMemoryDarwin_B() {
  vm_statistics_data_t info;
  mach_msg_type_number_t count = sizeof(info) / sizeof(integer_t);

  if (host_statistics(mach_host_self(), HOST_VM_INFO,
                      (host_info_t)&info, &count) != KERN_SUCCESS) {
    return 0;
  }

  return (uint64_t) info.free_count * sysconf(_SC_PAGESIZE);
}
#else
// Implemented in zig
extern "C" uint64_t getFreeMemoryDarwin_B() {
  return (uint64_t) 0;
}
#endif