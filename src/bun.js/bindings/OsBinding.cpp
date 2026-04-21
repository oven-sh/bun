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

    if (host_statistics(mach_host_self(), HOST_VM_INFO, (host_info_t)&info, &count) != KERN_SUCCESS) {
        return 0;
    }
    return (uint64_t)info.free_count * sysconf(_SC_PAGESIZE);
}
#endif

#if OS(LINUX)
#include <sys/sysinfo.h>
#include <inttypes.h>
#include <stdio.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>

// Read a numeric field (in kB) from /proc/meminfo, matching libuv's
// uv__read_proc_meminfo. Returns the value in bytes, or 0 on failure.
static uint64_t bunReadProcMeminfo(const char* what)
{
    char buf[4096]; // Large enough to hold all of /proc/meminfo.
    int fd;
    ssize_t n = 0;
    size_t off = 0;
    bool readError = false;

    do {
        fd = open("/proc/meminfo", O_RDONLY | O_CLOEXEC);
    } while (fd == -1 && errno == EINTR);
    if (fd == -1) {
        return 0;
    }

    while (off < sizeof(buf) - 1) {
        do {
            n = read(fd, buf + off, sizeof(buf) - 1 - off);
        } while (n == -1 && errno == EINTR);
        if (n == 0) {
            break; // EOF
        }
        if (n < 0) {
            readError = true;
            break;
        }
        off += static_cast<size_t>(n);
    }
    close(fd);

    if (readError) {
        return 0;
    }
    buf[off] = '\0';

    const char* p = strstr(buf, what);
    if (p == nullptr) {
        return 0;
    }
    p += strlen(what);

    uint64_t rc = 0;
    if (sscanf(p, "%" SCNu64 " kB", &rc) != 1) {
        return 0;
    }
    return rc * 1024;
}

// Matches libuv's uv_get_free_memory (vendor/libuv/src/unix/linux.c): prefer
// MemAvailable from /proc/meminfo (kernel's estimate of memory available for
// new allocations, including reclaimable page cache) and only fall back to
// sysinfo.freeram (which excludes page cache) when /proc/meminfo cannot be
// read. This matches Node.js's os.freemem() behaviour.
extern "C" uint64_t Bun__Os__getFreeMemory(void)
{
    uint64_t rc = bunReadProcMeminfo("MemAvailable:");
    if (rc != 0) {
        return rc;
    }

    struct sysinfo info;
    if (sysinfo(&info) == 0) {
        return static_cast<uint64_t>(info.freeram) * info.mem_unit;
    }
    return 0;
}
#endif

#if OS(WINDOWS)
extern "C" uint64_t uv_get_available_memory(void);

extern "C" uint64_t Bun__Os__getFreeMemory(void)
{
    return uv_get_available_memory();
}
#endif
