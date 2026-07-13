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
#include <sys/sysinfo.h>
#include <inttypes.h>
#include <stdio.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <climits>

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

// Read a single decimal uint64 from a cgroup control file. cgroup v2's literal
// "max\n" maps to UINT64_MAX; 0 means "could not read".
static uint64_t bunReadCgroupUint64(const char* filename)
{
    char buf[32];
    if (bunSlurp(filename, buf, sizeof(buf)) != 0) {
        return 0;
    }
    uint64_t rc = 0;
    if (sscanf(buf, "%" SCNu64, &rc) == 1) {
        return rc;
    }
    if (strcmp(buf, "max\n") == 0) {
        return UINT64_MAX;
    }
    return 0;
}

// Locate the :memory: controller's mount path in a cgroup v1 /proc/self/cgroup
// buffer. Returns a pointer to the path (past its leading '/') and its length
// via *n, or NULL if the memory controller line wasn't found.
static char* bunCgroup1FindMemoryController(char* buf, int* n)
{
    char* p = strchr(buf, ':');
    while (p != nullptr && strncmp(p, ":memory:", 8) != 0) {
        p = strchr(p, '\n');
        if (p != nullptr) {
            p = strchr(p, ':');
        }
    }
    if (p != nullptr) {
        p += strlen(":memory:/");
        *n = static_cast<int>(strcspn(p, "\n"));
    }
    return p;
}

static void bunGetCgroup1MemoryLimits(char* buf, uint64_t* high, uint64_t* max)
{
    char filename[4097];
    int n;

    *high = 0;
    *max = 0;

    char* p = bunCgroup1FindMemoryController(buf, &n);
    if (p != nullptr) {
        snprintf(filename, sizeof(filename), "/sys/fs/cgroup/memory/%.*s/memory.soft_limit_in_bytes", n, p);
        *high = bunReadCgroupUint64(filename);
        snprintf(filename, sizeof(filename), "/sys/fs/cgroup/memory/%.*s/memory.limit_in_bytes", n, p);
        *max = bunReadCgroupUint64(filename);
    }
    if (*high == 0 || *max == 0) {
        *high = bunReadCgroupUint64("/sys/fs/cgroup/memory/memory.soft_limit_in_bytes");
        *max = bunReadCgroupUint64("/sys/fs/cgroup/memory/memory.limit_in_bytes");
    }

    // cgroup v1 reports "unlimited" as LONG_MAX rounded down to a page.
    uint64_t cgroup1Max = static_cast<uint64_t>(LONG_MAX) & ~static_cast<uint64_t>(sysconf(_SC_PAGESIZE) - 1);
    if (*high == cgroup1Max) {
        *high = UINT64_MAX;
    }
    if (*max == cgroup1Max) {
        *max = UINT64_MAX;
    }
}

static void bunGetCgroup2MemoryLimits(char* buf, uint64_t* high, uint64_t* max)
{
    char path[4097];
    char filename[4097];
    char* p = buf + strlen("0::/");
    int n = static_cast<int>(strcspn(p, "\n"));
    snprintf(path, sizeof(path), "/sys/fs/cgroup/%.*s", n, p);

    *high = UINT64_MAX;
    *max = UINT64_MAX;

    // cgroup v2 limits are hierarchical: walk from the leaf to the root and
    // keep the tightest limit seen at any level.
    while (strncmp(path, "/sys/fs/cgroup", sizeof("/sys/fs/cgroup") - 1) == 0) {
        uint64_t v;
        snprintf(filename, sizeof(filename), "%s/memory.max", path);
        v = bunReadCgroupUint64(filename);
        if (v > 0 && v < *max) {
            *max = v;
        }
        snprintf(filename, sizeof(filename), "%s/memory.high", path);
        v = bunReadCgroupUint64(filename);
        if (v > 0 && v < *high) {
            *high = v;
        }
        if (strcmp(path, "/sys/fs/cgroup") == 0) {
            break;
        }
        char* lastSlash = strrchr(path, '/');
        if (lastSlash == nullptr) {
            break;
        }
        *lastSlash = '\0';
    }
}

static uint64_t bunGetCgroupConstrainedMemory(char* buf)
{
    uint64_t high;
    uint64_t max;
    if (strncmp(buf, "0::/", 4) != 0) {
        bunGetCgroup1MemoryLimits(buf, &high, &max);
    } else {
        bunGetCgroup2MemoryLimits(buf, &high, &max);
    }
    if (high == 0 || max == 0) {
        return 0;
    }
    uint64_t result = high < max ? high : max;
    if (result == UINT64_MAX) {
        return 0;
    }
    return result;
}

static uint64_t bunGetCgroupCurrentMemory(char* buf)
{
    char filename[4097];
    if (strncmp(buf, "0::/", 4) == 0) {
        char* p = buf + strlen("0::/");
        int n = static_cast<int>(strcspn(p, "\n"));
        snprintf(filename, sizeof(filename), "/sys/fs/cgroup/%.*s/memory.current", n, p);
        return bunReadCgroupUint64(filename);
    }
    int n;
    char* p = bunCgroup1FindMemoryController(buf, &n);
    if (p != nullptr) {
        snprintf(filename, sizeof(filename), "/sys/fs/cgroup/memory/%.*s/memory.usage_in_bytes", n, p);
        uint64_t current = bunReadCgroupUint64(filename);
        if (current != 0) {
            return current;
        }
    }
    return bunReadCgroupUint64("/sys/fs/cgroup/memory/memory.usage_in_bytes");
}

// Matches libuv's uv_get_available_memory (vendor/libuv/src/unix/linux.c):
// when the process runs under a cgroup memory limit, return the remaining
// budget (limit - current usage). When there is no limit, or the limit is
// larger than physical RAM, fall back to host MemAvailable. This is the
// value Node.js documents for process.availableMemory().
extern "C" uint64_t Bun__Os__getAvailableMemory(void)
{
    char buf[1024];
    if (bunSlurp("/proc/self/cgroup", buf, sizeof(buf)) != 0) {
        return Bun__Os__getFreeMemory();
    }

    uint64_t constrained = bunGetCgroupConstrainedMemory(buf);
    if (constrained == 0) {
        return Bun__Os__getFreeMemory();
    }

    struct sysinfo info;
    if (sysinfo(&info) == 0) {
        uint64_t total = static_cast<uint64_t>(info.totalram) * info.mem_unit;
        if (constrained > total) {
            return Bun__Os__getFreeMemory();
        }
    }

    uint64_t current = bunGetCgroupCurrentMemory(buf);
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
