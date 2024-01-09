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
#include <signal.h>

static int close_range(unsigned int first)
{
    return syscall(__NR_close_range, first, ~0U, 0);
}

extern char** environ;

enum FileActionType : uint8_t {
    None,
    Close,
    Dup2,
    Open,
};

typedef struct bun_spawn_request_file_action_t {
    FileActionType type;
    const char* path;
    int fds[2];
    int flags;
    mode_t mode;
} bun_spawn_request_file_action_t;

typedef struct bun_spawn_file_action_list_t {
    const bun_spawn_request_file_action_t* ptr;
    size_t len;
} bun_spawn_file_action_list_t;

typedef struct bun_spawn_request_t {
    const char* chdir;
    bool detached;
    bun_spawn_file_action_list_t actions;
} bun_spawn_request_t;

extern "C" ssize_t posix_spawn_bun(
    int* pid,
    const bun_spawn_request_t* request,
    char* const argv[],
    char* const envp[])
{
    volatile int status = 0;
    sigset_t blockall, oldmask;
    int child, res, cs, e = errno;
    sigfillset(&blockall);
    sigprocmask(SIG_SETMASK, &blockall, &oldmask);
    pthread_setcancelstate(PTHREAD_CANCEL_DISABLE, &cs);
    const char* path = argv[0];

    if (!(child = vfork())) {
        sigset_t childmask;
        if (request->detached) {
            setsid();
        }

        // POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK
        sigprocmask(SIG_SETMASK, &oldmask, nullptr);

        int current_max_fd = 0;

        if (request->chdir)
            chdir(request->chdir);

        const auto& actions = request->actions;

        for (size_t i = 0; i < actions.len; i++) {
            const bun_spawn_request_file_action_t action = actions.ptr[i];
            switch (action->type) {
            case FileActionType::Close: {
                close(action->fds[0]);
                break;
            }
            case FileActionType::Dup2: {
                if (dup2(action->fds[0], action->fds[1]) == -1) {
                    goto ChildFailed;
                }
                current_max_fd = std::max(current_max_fd, action->fds[1]);
                close(action->fds[0]);
                break;
            }
            case FileActionType::Open: {
                int opened = -1;
                opened = open(action->path, action->flags, action->mode);

                if (opened == -1) {
                    goto ChildFailed;
                }

                if (opened != -1) {
                    if (dup2(opened, action->fds[0]) == -1) {
                        close(opened);
                        goto ChildFailed;
                    }
                    current_max_fd = std::max(current_max_fd, action->fds[0]);
                    if (close(opened)) {
                        goto ChildFailed;
                    }
                }

                break;
            }
            default: {
                __builtin_unreachable();
                break;
            }
            }
        }

        close_range(current_max_fd + 1);
        sigprocmask(SIG_SETMASK, &childmask, 0);
        if (!envp)
            envp = environ;
        execve(path, argv, envp);
        _exit(127);

    ChildFailed:
        res = errno;
        status = res;
        _exit(127);
    }

    if (child != -1) {
        if (!res) {
            res = status;
            *pid = child;
        } else {
            wait4(child, 0, 0, 0);
        }
    }

ParentFailed:
    if (child > 0)
        kill(child, SIGKILL);
    sigprocmask(SIG_SETMASK, &oldmask, 0);
    pthread_setcancelstate(cs, 0);
    errno = e;
    return res;
}

#endif