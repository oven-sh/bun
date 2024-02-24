// when we don't want to use @cInclude, we can just stick wrapper functions here
#include "root.h"
#include <cstdint>

#if !OS(WINDOWS)
#include <sys/resource.h>
#include <sys/fcntl.h>
#include <sys/stat.h>
#include <sys/signal.h>
#include <unistd.h>
#include <cstring>
#else
#include <uv.h>
#include <windows.h>
#endif // !OS(WINDOWS)
#include <lshpack.h>

#if CPU(X86_64) && !OS(WINDOWS)
extern "C" void bun_warn_avx_missing(const char* url)
{
    __builtin_cpu_init();
    if (__builtin_cpu_supports("avx")) {
        return;
    }

    static constexpr const char* str = "warn: CPU lacks AVX support, strange crashes may occur. Reinstall Bun or use *-baseline build:\n  ";
    const size_t len = strlen(str);

    char buf[512];
    strcpy(buf, str);
    strcpy(buf + len, url);
    strcpy(buf + len + strlen(url), "\n\0");
    write(STDERR_FILENO, buf, strlen(buf));
}
#else
extern "C" void bun_warn_avx_missing(char* url)
{
}
#endif // CPU(X86_64)

extern "C" int32_t get_process_priority(uint32_t pid)
{
#if OS(WINDOWS)
    int priority = 0;
    if (uv_os_getpriority(pid, &priority))
        return 0;
    return priority;
#else
    return getpriority(PRIO_PROCESS, pid);
#endif // OS(WINDOWS)
}

extern "C" int32_t set_process_priority(uint32_t pid, int32_t priority)
{
#if OS(WINDOWS)
    return uv_os_setpriority(pid, priority);
#else
    return setpriority(PRIO_PROCESS, pid, priority);
#endif // OS(WINDOWS)
}

extern "C" bool is_executable_file(const char* path)
{
#if OS(WINDOWS)
    return false;
#else

#if defined(O_EXEC)
    // O_EXEC is macOS specific
    int fd = open(path, O_EXEC | O_CLOEXEC, 0);
    if (fd < 0)
        return false;
    close(fd);
    return true;
#endif // defined(O_EXEC)

    struct stat st;
    if (stat(path, &st) != 0)
        return false;

    // regular file and user can execute
    return S_ISREG(st.st_mode) && (st.st_mode & S_IXUSR);
#endif // OS(WINDOWS)
}

extern "C" void bun_ignore_sigpipe()
{
#if !OS(WINDOWS)
    // ignore SIGPIPE
    signal(SIGPIPE, SIG_IGN);
#endif
}
extern "C" ssize_t bun_sysconf__SC_CLK_TCK()
{
#ifdef __APPLE__
    return sysconf(_SC_CLK_TCK);
#else
    return 0;
#endif
}

#if OS(DARWIN) && BUN_DEBUG
#include <malloc/malloc.h>

extern "C" void dump_zone_malloc_stats()
{
    vm_address_t* zones;
    unsigned count;

    // Zero out the structures in case a zone is missing
    malloc_statistics_t stats;
    stats.blocks_in_use = 0;
    stats.size_in_use = 0;
    stats.max_size_in_use = 0;
    stats.size_allocated = 0;

    malloc_get_all_zones(mach_task_self(), 0, &zones, &count);
    for (unsigned i = 0; i < count; i++) {
        if (const char* name = malloc_get_zone_name(reinterpret_cast<malloc_zone_t*>(zones[i]))) {
            printf("%s:\n", name);
            malloc_zone_statistics(reinterpret_cast<malloc_zone_t*>(zones[i]), &stats);
            printf("  blocks_in_use:   %u\n", stats.blocks_in_use);
            printf("  size_in_use:     %zu\n", stats.size_in_use);
            printf("  max_size_in_use: %zu\n", stats.max_size_in_use);
            printf("  size_allocated:  %zu\n", stats.size_allocated);
            printf("\n");
        }
    }
}

#endif

#if OS(WINDOWS)
#define MS_PER_SEC 1000ULL // MS = milliseconds
#define US_PER_MS 1000ULL // US = microseconds
#define HNS_PER_US 10ULL // HNS = hundred-nanoseconds (e.g., 1 hns = 100 ns)
#define NS_PER_US 1000ULL

#define HNS_PER_SEC (MS_PER_SEC * US_PER_MS * HNS_PER_US)
#define NS_PER_HNS (100ULL) // NS = nanoseconds
#define NS_PER_SEC (MS_PER_SEC * US_PER_MS * NS_PER_US)

extern "C" int clock_gettime_monotonic(int64_t* tv_sec, int64_t* tv_nsec)
{
    static LARGE_INTEGER ticksPerSec;
    LARGE_INTEGER ticks;

    if (!ticksPerSec.QuadPart) {
        QueryPerformanceFrequency(&ticksPerSec);
        if (!ticksPerSec.QuadPart) {
            errno = ENOTSUP;
            return -1;
        }
    }

    QueryPerformanceCounter(&ticks);

    *tv_sec = (int64_t)(ticks.QuadPart / ticksPerSec.QuadPart);
    *tv_nsec = (int64_t)(((ticks.QuadPart % ticksPerSec.QuadPart) * NS_PER_SEC) / ticksPerSec.QuadPart);

    return 0;
}
#endif

#if OS(LINUX)

#include <sys/syscall.h>

#ifndef CLOSE_RANGE_CLOEXEC
#define CLOSE_RANGE_CLOEXEC (1U << 2)
#endif

// close_range is glibc > 2.33, which is very new
extern "C" ssize_t bun_close_range(unsigned int start, unsigned int end, unsigned int flags)
{
    return syscall(__NR_close_range, start, end, flags);
}

extern "C" void on_before_reload_process_linux()
{
    // close all file descriptors except stdin, stdout, stderr and possibly IPC.
    // if you're passing additional file descriptors to Bun, you're probably not passing more than 8.
    // If this fails, it's ultimately okay, we're just trying our best to avoid leaking file descriptors.
    bun_close_range(8, ~0U, CLOSE_RANGE_CLOEXEC);

    // reset all signals to default
    sigset_t signal_set;
    sigemptyset(&signal_set);
    sigprocmask(SIG_SETMASK, &signal_set, nullptr);
}

#endif

#define LSHPACK_MAX_HEADER_SIZE 65536

static thread_local char shared_header_buffer[LSHPACK_MAX_HEADER_SIZE];

extern "C" {
typedef void* (*lshpack_wrapper_alloc)(size_t size);
typedef void (*lshpack_wrapper_free)(void*);
typedef struct {
    struct lshpack_enc enc;
    struct lshpack_dec dec;
    lshpack_wrapper_free free;
} lshpack_wrapper;

typedef struct {
    const char* name;
    size_t name_len;
    const char* value;
    size_t value_len;
} lshpack_header;

lshpack_wrapper* lshpack_wrapper_init(lshpack_wrapper_alloc alloc, lshpack_wrapper_free free, unsigned max_capacity)
{
    lshpack_wrapper* coders = (lshpack_wrapper*)alloc(sizeof(lshpack_wrapper));
    if (!coders)
        return nullptr;
    coders->free = free;
    if (lshpack_enc_init(&coders->enc) != 0)
        return nullptr;
    lshpack_dec_init(&coders->dec);
    lshpack_enc_set_max_capacity(&coders->enc, max_capacity);
    lshpack_dec_set_max_capacity(&coders->dec, max_capacity);
    return coders;
}

size_t lshpack_wrapper_encode(lshpack_wrapper* self,
    const unsigned char* name, size_t name_len,
    const unsigned char* val, size_t val_len,
    int never_index,
    unsigned char* buffer, size_t buffer_len, size_t buffer_offset)
{
    if (name_len + val_len > LSHPACK_MAX_HEADER_SIZE)
        return 0;

    lsxpack_header_t hdr;
    memset(&hdr, 0, sizeof(lsxpack_header_t));
    memcpy(&shared_header_buffer[0], name, name_len);
    memcpy(&shared_header_buffer[name_len], val, val_len);
    lsxpack_header_set_offset2(&hdr, &shared_header_buffer[0], 0, name_len, name_len, val_len);
    if (never_index) {
        hdr.indexed_type = 2;
    }
    auto* start = buffer + buffer_offset;
    auto* ptr = lshpack_enc_encode(&self->enc, start, buffer + buffer_len, &hdr);
    if (!ptr)
        return 0;
    return ptr - start;
}

size_t lshpack_wrapper_decode(lshpack_wrapper* self,
    const unsigned char* src, size_t src_len,
    lshpack_header* output)
{
    lsxpack_header_t hdr;
    memset(&hdr, 0, sizeof(lsxpack_header_t));
    lsxpack_header_prepare_decode(&hdr, &shared_header_buffer[0], 0, LSHPACK_MAX_HEADER_SIZE);

    const unsigned char* s = src;

    auto rc = lshpack_dec_decode(&self->dec, &s, s + src_len, &hdr);
    if (rc != 0)
        return 0;

    output->name = lsxpack_header_get_name(&hdr);
    output->name_len = hdr.name_len;
    output->value = lsxpack_header_get_value(&hdr);
    output->value_len = hdr.val_len;
    return s - src;
}

void lshpack_wrapper_deinit(lshpack_wrapper* self)
{
    lshpack_dec_cleanup(&self->dec);
    lshpack_enc_cleanup(&self->enc);
    self->free(self);
}
}