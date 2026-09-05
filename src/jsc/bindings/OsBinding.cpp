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

// Darwin has no per-process memory cgroup equivalent that libuv consults, so
// uv_get_available_memory() == uv_get_free_memory() there.
extern "C" uint64_t Bun__Os__getAvailableMemory(void)
{
    return Bun__Os__getFreeMemory();
}
#endif

#if OS(LINUX)
#include <wtf/RAMSize.h>
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

// Read a short file (cgroup control file, /proc/self/cgroup) into buf and
// NUL-terminate. Returns 0 on success, -1 on any failure. Matches libuv's
// uv__slurp.
static int bunSlurp(const char* filename, char* buf, size_t len)
{
    int fd;
    ssize_t n;

    do {
        fd = open(filename, O_RDONLY | O_CLOEXEC);
    } while (fd == -1 && errno == EINTR);
    if (fd == -1) {
        return -1;
    }

    do {
        n = read(fd, buf, len - 1);
    } while (n == -1 && errno == EINTR);
    close(fd);

    if (n < 0) {
        return -1;
    }
    buf[n] = '\0';
    return 0;
}

// Read a single decimal uint64 from a cgroup control file. 0 = couldn't read.
static uint64_t bunReadCgroupUint64(const char* filename)
{
    char buf[32];
    uint64_t rc = 0;
    if (bunSlurp(filename, buf, sizeof(buf)) == 0) {
        sscanf(buf, "%" SCNu64, &rc);
    }
    return rc;
}

// Current cgroup memory usage for this process. Matches libuv's
// uv__get_cgroup_current_memory: cgroup v2 reads memory.current under the
// path from /proc/self/cgroup's "0::/<path>" line; cgroup v1 reads
// memory.usage_in_bytes under the :memory: controller's mount path.
static uint64_t bunGetCgroupCurrentMemory(void)
{
    char buf[1024];
    char filename[4097];

    if (bunSlurp("/proc/self/cgroup", buf, sizeof(buf)) != 0) {
        return 0;
    }

    if (strncmp(buf, "0::/", 4) == 0) {
        char* p = buf + strlen("0::/");
        int n = static_cast<int>(strcspn(p, "\n"));
        snprintf(filename, sizeof(filename), "/sys/fs/cgroup/%.*s/memory.current", n, p);
        return bunReadCgroupUint64(filename);
    }

    // cgroup v1: locate the :memory: controller line.
    char* p = strchr(buf, ':');
    while (p != nullptr && strncmp(p, ":memory:", 8) != 0) {
        p = strchr(p, '\n');
        if (p != nullptr) {
            p = strchr(p, ':');
        }
    }
    if (p != nullptr) {
        p += strlen(":memory:/");
        int n = static_cast<int>(strcspn(p, "\n"));
        snprintf(filename, sizeof(filename), "/sys/fs/cgroup/memory/%.*s/memory.usage_in_bytes", n, p);
        uint64_t current = bunReadCgroupUint64(filename);
        if (current != 0) {
            return current;
        }
    }
    return bunReadCgroupUint64("/sys/fs/cgroup/memory/memory.usage_in_bytes");
}

// Matches libuv's uv_get_available_memory: when the process runs under a
// cgroup memory limit, return the remaining budget (limit - current usage);
// otherwise fall back to host MemAvailable. The limit is WTF::ramSize(),
// the same cgroup-aware value process.constrainedMemory() returns, so
// availableMemory() <= constrainedMemory() holds by construction.
extern "C" uint64_t Bun__Os__getAvailableMemory(void)
{
    uint64_t constrained = static_cast<uint64_t>(WTF::ramSize());

    struct sysinfo info;
    if (constrained == 0 || sysinfo(&info) != 0) {
        return Bun__Os__getFreeMemory();
    }
    uint64_t total = static_cast<uint64_t>(info.totalram) * info.mem_unit;
    if (constrained >= total) {
        return Bun__Os__getFreeMemory();
    }

    uint64_t current = bunGetCgroupCurrentMemory();
    if (constrained < current) {
        return 0;
    }
    return constrained - current;
}
#endif

#if OS(WINDOWS)
extern "C" uint64_t uv_get_available_memory(void);

extern "C" uint64_t Bun__Os__getFreeMemory(void)
{
    return uv_get_available_memory();
}

extern "C" uint64_t Bun__Os__getAvailableMemory(void)
{
    return uv_get_available_memory();
}
#endif

#if OS(FREEBSD)
#include <sys/types.h>
#include <sys/sysctl.h>
#include <unistd.h>

// Matches libuv's uv_get_free_memory for FreeBSD: free pages × pagesize.
extern "C" uint64_t Bun__Os__getFreeMemory(void)
{
    int free_pages = 0;
    size_t len = sizeof(free_pages);
    if (sysctlbyname("vm.stats.vm.v_free_count", &free_pages, &len, nullptr, 0) != 0) {
        return 0;
    }
    return static_cast<uint64_t>(free_pages) * sysconf(_SC_PAGESIZE);
}

extern "C" uint64_t Bun__Os__getAvailableMemory(void)
{
    return Bun__Os__getFreeMemory();
}
#endif
