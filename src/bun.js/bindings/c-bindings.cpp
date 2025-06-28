// when we don't want to use @cInclude, we can just stick wrapper functions here
#include "root.h"
#include <cstdio>

#if !OS(WINDOWS)
#include <sys/resource.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <signal.h>
#include <unistd.h>
#include <cstring>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <termios.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#else
#include <uv.h>
#include <windows.h>
#include <corecrt_io.h>
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
    [[maybe_unused]] auto _ = write(STDERR_FILENO, buf, strlen(buf));
}
#endif

// Error condition is encoded as max int32_t.
// The only error in this function is ESRCH (no process found)
extern "C" int32_t get_process_priority(int32_t pid)
{
#if OS(WINDOWS)
    int priority = 0;
    if (uv_os_getpriority(pid, &priority))
        return std::numeric_limits<int32_t>::max();
    return priority;
#else
    errno = 0;
    int priority = getpriority(PRIO_PROCESS, pid);
    if (priority == -1 && errno != 0)
        return std::numeric_limits<int32_t>::max();
    return priority;
#endif // OS(WINDOWS)
}

extern "C" int32_t set_process_priority(int32_t pid, int32_t priority)
{
#if OS(WINDOWS)
    return uv_os_setpriority(pid, priority);
#else
    return setpriority(PRIO_PROCESS, pid, priority);
#endif // OS(WINDOWS)
}

#if !OS(WINDOWS)
extern "C" bool is_executable_file(const char* path)
{
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
}
#endif

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

#elif OS(DARWIN)

extern "C" void dump_zone_malloc_stats()
{
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

extern "C" void windows_enable_stdio_inheritance()
{
    HANDLE handle;

    handle = GetStdHandle(STD_INPUT_HANDLE);
    if (handle != NULL && handle != INVALID_HANDLE_VALUE)
        SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 1);

    handle = GetStdHandle(STD_OUTPUT_HANDLE);
    if (handle != NULL && handle != INVALID_HANDLE_VALUE)
        SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 1);

    handle = GetStdHandle(STD_ERROR_HANDLE);
    if (handle != NULL && handle != INVALID_HANDLE_VALUE)
        SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 1);
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
// https://github.com/oven-sh/bun/issues/9669
#ifdef __NR_close_range
    return syscall(__NR_close_range, start, end, flags);
#else
    return ENOSYS;
#endif
}

static void unset_cloexec(int fd)
{
    int flags = fcntl(fd, F_GETFD, 0);
    if (flags == -1) {
        return;
    }
    flags &= ~FD_CLOEXEC;
    fcntl(fd, F_SETFD, flags);
}

extern "C" void on_before_reload_process_linux()
{
    unset_cloexec(STDIN_FILENO);
    unset_cloexec(STDOUT_FILENO);
    unset_cloexec(STDERR_FILENO);

    // close all file descriptors except stdin, stdout, stderr and possibly IPC.
    // if you're passing additional file descriptors to Bun, you're probably not passing more than 8.
    // If this fails, it's ultimately okay, we're just trying our best to avoid leaking file descriptors.
    bun_close_range(3, ~0U, CLOSE_RANGE_CLOEXEC);

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
    bool never_index;
    uint16_t hpack_index;
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
    output->never_index = (hdr.flags & LSXPACK_NEVER_INDEX) != 0;
    if (hdr.hpack_index != LSHPACK_HDR_UNKNOWN && hdr.hpack_index <= LSHPACK_HDR_WWW_AUTHENTICATE) {
        output->hpack_index = hdr.hpack_index - 1;
    } else {
        output->hpack_index = 255;
    }
    return s - src;
}

void lshpack_wrapper_deinit(lshpack_wrapper* self)
{
    lshpack_dec_cleanup(&self->dec);
    lshpack_enc_cleanup(&self->enc);
    self->free(self);
}
}

#if OS(LINUX)

#include <linux/fs.h>

static inline void make_pos_h_l(unsigned long* pos_h, unsigned long* pos_l,
    off_t offset)
{
#if __BITS_PER_LONG == 64
    *pos_l = offset;
    *pos_h = 0;
#else
    *pos_l = offset & 0xffffffff;
    *pos_h = ((uint64_t)offset) >> 32;
#endif
}
extern "C" ssize_t sys_preadv2(int fd, const struct iovec* iov, int iovcnt,
    off_t offset, unsigned int flags)
{
    return syscall(SYS_preadv2, fd, iov, iovcnt, offset, offset >> 32, RWF_NOWAIT);
}
extern "C" ssize_t sys_pwritev2(int fd, const struct iovec* iov, int iovcnt,
    off_t offset, unsigned int flags)
{
    unsigned long pos_l, pos_h;

    make_pos_h_l(&pos_h, &pos_l, offset);
    return syscall(__NR_pwritev2, fd, iov, iovcnt, pos_l, pos_h, flags);
}
#else
extern "C" ssize_t preadv2(int fd, const struct iovec* iov, int iovcnt,
    off_t offset, unsigned int flags)
{
    errno = ENOSYS;
    return -1;
}
extern "C" ssize_t pwritev2(int fd, const struct iovec* iov, int iovcnt,
    off_t offset, unsigned int flags)
{
    errno = ENOSYS;
    return -1;
}

#endif

extern "C" void Bun__onExit();
extern "C" int32_t bun_stdio_tty[3];
#if !OS(WINDOWS)
static termios termios_to_restore_later[3];
#endif

extern "C" void bun_restore_stdio()
{

#if !OS(WINDOWS)

    // restore stdio
    for (int32_t fd = 0; fd < 3; fd++) {
        if (!bun_stdio_tty[fd])
            continue;

        sigset_t sa;
        int err;

        // We might be a background job that doesn't own the TTY so block SIGTTOU
        // before making the tcsetattr() call, otherwise that signal suspends us.
        sigemptyset(&sa);
        sigaddset(&sa, SIGTTOU);

        pthread_sigmask(SIG_BLOCK, &sa, nullptr);
        do
            err = tcsetattr(fd, TCSANOW, &termios_to_restore_later[fd]);
        while (err == -1 && errno == EINTR);
        pthread_sigmask(SIG_UNBLOCK, &sa, nullptr);
    }
#endif
}

#if !OS(WINDOWS)
extern "C" void onExitSignal(int sig)
{
    bun_restore_stdio();
    signal(sig, SIG_DFL);
    raise(sig);
}
#endif

#if OS(WINDOWS)
extern "C" void Bun__restoreWindowsStdio();
BOOL WINAPI Ctrlhandler(DWORD signal)
{

    if (signal == CTRL_C_EVENT) {
        Bun__restoreWindowsStdio();
        SetConsoleCtrlHandler(Ctrlhandler, FALSE);
    }

    return FALSE;
}

extern "C" void Bun__setCTRLHandler(BOOL add)
{
    SetConsoleCtrlHandler(Ctrlhandler, add);
}
#endif

extern "C" int32_t bun_is_stdio_null[3] = { 0, 0, 0 };

extern "C" void bun_initialize_process()
{
    // Disable printf() buffering. We buffer it ourselves.
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);

#if OS(LINUX)
    // Prevent leaking inherited file descriptors on Linux
    // This is less of an issue for macOS due to posix_spawn
    // This is best effort, not all linux kernels support close_range or CLOSE_RANGE_CLOEXEC
    // To avoid breaking --watch, we skip stdin, stdout, stderr and IPC.
    bun_close_range(4, ~0U, CLOSE_RANGE_CLOEXEC);
#endif

#if OS(LINUX) || OS(DARWIN)

    int devNullFd_ = -1;
    bool anyTTYs = false;

    const auto setDevNullFd = [&](int target_fd) -> void {
        bun_is_stdio_null[target_fd] = 1;
        if (devNullFd_ == -1) {
            do {
                devNullFd_ = open("/dev/null", O_RDWR | O_CLOEXEC, 0);
            } while (devNullFd_ < 0 and errno == EINTR);
        };

        if (devNullFd_ == target_fd) {
            devNullFd_ = -1;
            return;
        }

        ASSERT(devNullFd_ != -1);
        int err;
        do {
            err = dup2(devNullFd_, target_fd);
        } while (err < 0 && errno == EINTR);

        if (err != 0) [[unlikely]] {
            abort();
        }
    };

    for (int fd = 0; fd < 3; fd++) {
        int result = isatty(fd);
        if (result == 0) {
            if (errno == EBADF) [[unlikely]] {
                // the fd is invalid, let's make sure it's always valid
                setDevNullFd(fd);
            }
        } else {
            bun_stdio_tty[fd] = 1;
            int err = 0;

            do {
                err = tcgetattr(fd, &termios_to_restore_later[fd]);
            } while (err == -1 && errno == EINTR);

            if (err == 0) [[likely]] {
                anyTTYs = true;
            }
        }
    }

    ASSERT(devNullFd_ == -1 || devNullFd_ > 2);
    if (devNullFd_ > 2) {
        close(devNullFd_);
    }

    // Restore TTY state on exit
    if (anyTTYs) {
        struct sigaction sa;
        memset(&sa, 0, sizeof(sa));
        sigemptyset(&sa.sa_mask);

        sa.sa_flags = SA_RESETHAND;
        sa.sa_handler = onExitSignal;

        sigaction(SIGTERM, &sa, nullptr);
        sigaction(SIGINT, &sa, nullptr);
    }
#elif OS(WINDOWS)
    for (int fd = 0; fd <= 2; ++fd) {
        auto handle = reinterpret_cast<HANDLE>(uv_get_osfhandle(fd));
        if (handle == INVALID_HANDLE_VALUE || GetFileType(handle) == FILE_TYPE_UNKNOWN) {
            // Ignore _close result. If it fails or not depends on used Windows
            // version. We will just check _open result.
            _close(fd);
            bun_is_stdio_null[fd] = 1;
            if (fd != _open("nul", O_RDWR)) {
                RELEASE_ASSERT_NOT_REACHED();
            } else {
                switch (fd) {
                case 0: {
                    SetStdHandle(STD_INPUT_HANDLE, uv_get_osfhandle(fd));
                    ASSERT(GetStdHandle(STD_INPUT_HANDLE) == uv_get_osfhandle(fd));
                    break;
                }
                case 1: {
                    SetStdHandle(STD_OUTPUT_HANDLE, uv_get_osfhandle(fd));
                    ASSERT(GetStdHandle(STD_OUTPUT_HANDLE) == uv_get_osfhandle(fd));
                    break;
                }
                case 2: {
                    SetStdHandle(STD_ERROR_HANDLE, uv_get_osfhandle(fd));
                    ASSERT(GetStdHandle(STD_ERROR_HANDLE) == uv_get_osfhandle(fd));
                    break;
                }
                default: {
                    ASSERT_NOT_REACHED();
                }
                }
            }
        }
    }

    // add ctrl+c handler on windows
    Bun__setCTRLHandler(1);
#endif

#if OS(DARWIN)
    atexit(Bun__onExit);
#elif !OS(WINDOWS)
    at_quick_exit(Bun__onExit);
#endif
}

#if OS(WINDOWS)
extern "C" int32_t open_as_nonblocking_tty(int32_t fd, int32_t mode)
{
    RELEASE_ASSERT_NOT_REACHED();
}

#else

static bool can_open_as_nonblocking_tty(int32_t fd)
{
    int result;
#if OS(LINUX) || OS(FreeBSD)
    int dummy = 0;

    result = ioctl(fd, TIOCGPTN, &dummy) != 0;
#elif OS(DARWIN)

    char dummy[256];

    result = ioctl(fd, TIOCPTYGNAME, &dummy) != 0;

#else

#error "TODO"

#endif

    return result;
}

extern "C" int32_t open_as_nonblocking_tty(int32_t fd, int32_t mode)
{
    if (!can_open_as_nonblocking_tty(fd)) {
        return -1;
    }

    char pathbuf[PATH_MAX + 1];
    if (ttyname_r(fd, pathbuf, sizeof(pathbuf)) != 0) {
        return -1;
    }

    return open(pathbuf, mode | O_NONBLOCK | O_NOCTTY | O_CLOEXEC);
}

#endif

extern "C" size_t Bun__ramSize()
{
    // This value is cached internally.
    return WTF::ramSize();
}

#if !OS(WINDOWS)

extern "C" void Bun__disableSOLinger(int fd)
{
    struct linger l = { 1, 0 };
    setsockopt(fd, SOL_SOCKET, SO_LINGER, &l, sizeof(l));
}

#else

#include <winsock2.h>

extern "C" void Bun__disableSOLinger(SOCKET fd)
{
    struct linger l = { 1, 0 };
    setsockopt(fd, SOL_SOCKET, SO_LINGER, (char*)&l, sizeof(l));
}

#endif

extern "C" int ffi_vprintf(const char* fmt, va_list ap)
{
    int ret = vfprintf(stderr, fmt, ap);
    fflush(stderr);
    return ret;
}

extern "C" int ffi_vfprintf(FILE* stream, const char* fmt, va_list ap)
{
    int ret = vfprintf(stream, fmt, ap);
    fflush(stream);
    return ret;
}

extern "C" int ffi_printf(const char* __restrict fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    int r = vprintf(fmt, ap);
    va_end(ap);
    fflush(stdout);
    return r;
}

extern "C" int ffi_fprintf(FILE* stream, const char* fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    int r = vfprintf(stream, fmt, ap);
    va_end(ap);
    fflush(stream);
    return r;
}

extern "C" int ffi_scanf(const char* fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    int r = vscanf(fmt, ap);
    va_end(ap);
    return r;
}

extern "C" int ffi_fscanf(FILE* stream, const char* fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    int r = vfscanf(stream, fmt, ap);
    va_end(ap);
    return r;
}

extern "C" int ffi_vsscanf(const char* str, const char* fmt, va_list ap)
{
    va_list ap_copy;
    va_copy(ap_copy, ap);
    int result = vsscanf(str, fmt, ap_copy);
    va_end(ap_copy);
    return result;
}

extern "C" int ffi_sscanf(const char* str, const char* fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    int r = vsscanf(str, fmt, ap);
    va_end(ap);
    return r;
}

extern "C" FILE* ffi_fopen(const char* path, const char* mode)
{
    return fopen(path, mode);
}

extern "C" int ffi_fclose(FILE* file)
{
    return fclose(file);
}

extern "C" int ffi_fgetc(FILE* file)
{
    return fgetc(file);
}

extern "C" int ffi_fputc(int c, FILE* file)
{
    return fputc(c, file);
}

extern "C" int ffi_ungetc(int c, FILE* file)
{
    return ungetc(c, file);
}

extern "C" int ffi_feof(FILE* file)
{
    return feof(file);
}

extern "C" int ffi_fseek(FILE* file, long offset, int whence)
{
    return fseek(file, offset, whence);
}

extern "C" long ffi_ftell(FILE* file)
{
    return ftell(file);
}

extern "C" int ffi_fflush(FILE* file)
{
    return fflush(file);
}

extern "C" int ffi_fileno(FILE* file)
{
    return fileno(file);
}

// Handle signals in bun.spawnSync.
// If we receive a signal, we want to forward the signal to the child process.
#if OS(LINUX) || OS(DARWIN)
#include <signal.h>
#include <pthread.h>

// Note: We only ever use bun.spawnSync on the main thread.
extern "C" int64_t Bun__currentSyncPID = 0;
static int Bun__pendingSignalToSend = 0;
static struct sigaction previous_actions[NSIG];

// This list of signals is copied from npm.
// https://github.com/npm/cli/blob/fefd509992a05c2dfddbe7bc46931c42f1da69d7/workspaces/arborist/lib/signals.js#L26-L57
#define FOR_EACH_POSIX_SIGNAL(M) \
    M(SIGABRT);                  \
    M(SIGALRM);                  \
    M(SIGHUP);                   \
    M(SIGINT);                   \
    M(SIGTERM);                  \
    M(SIGVTALRM);                \
    M(SIGXCPU);                  \
    M(SIGXFSZ);                  \
    M(SIGUSR2);                  \
    M(SIGTRAP);                  \
    M(SIGSYS);                   \
    M(SIGQUIT);                  \
    M(SIGIOT);                   \
    M(SIGIO);

#if OS(LINUX)
#define FOR_EACH_LINUX_ONLY_SIGNAL(M) \
    M(SIGPOLL);                       \
    M(SIGPWR);                        \
    M(SIGSTKFLT);

#endif

#if OS(DARWIN)
#define FOR_EACH_SIGNAL(M) FOR_EACH_POSIX_SIGNAL(M)
#endif

#if OS(LINUX)
#define FOR_EACH_SIGNAL(M)   \
    FOR_EACH_POSIX_SIGNAL(M) \
    FOR_EACH_LINUX_ONLY_SIGNAL(M)
#endif

static void Bun__forwardSignalFromParentToChildAndRestorePreviousAction(pid_t pid, int sig)
{
    sigset_t restore_mask;
    sigset_t mask;
    sigemptyset(&mask);
    sigaddset(&mask, sig);
    sigemptyset(&restore_mask);
    sigaddset(&restore_mask, sig);
    pthread_sigmask(SIG_BLOCK, &mask, &restore_mask);
    kill(pid, sig);
    pthread_sigmask(SIG_UNBLOCK, &restore_mask, nullptr);
}

extern "C" void Bun__sendPendingSignalIfNecessary()
{
    int sig = Bun__pendingSignalToSend;
    Bun__pendingSignalToSend = 0;
    int pid = Bun__currentSyncPID;
    if (sig == 0 || pid == 0)
        return;

    Bun__forwardSignalFromParentToChildAndRestorePreviousAction(pid, sig);
}

extern "C" void Bun__registerSignalsForForwarding()
{
    Bun__pendingSignalToSend = 0;
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = SA_RESETHAND;
    sa.sa_handler = [](int sig) {
        if (Bun__currentSyncPID == 0) {
            Bun__pendingSignalToSend = sig;
            return;
        }

        Bun__forwardSignalFromParentToChildAndRestorePreviousAction(Bun__currentSyncPID, sig);
    };

#define REGISTER_SIGNAL(SIG)                                 \
    if (sigaction(SIG, &sa, &previous_actions[SIG]) == -1) { \
    }

    FOR_EACH_SIGNAL(REGISTER_SIGNAL)

#undef REGISTER_SIGNAL
}

extern "C" void Bun__unregisterSignalsForForwarding()
{
    Bun__currentSyncPID = 0;

#define UNREGISTER_SIGNAL(SIG)                                \
    if (sigaction(SIG, &previous_actions[SIG], NULL) == -1) { \
    }

    FOR_EACH_SIGNAL(UNREGISTER_SIGNAL)
    memset(previous_actions, 0, sizeof(previous_actions));
#undef UNREGISTER_SIGNAL
}

#endif

#if OS(LINUX) || OS(DARWIN)
#include <paths.h>

extern "C" const char* BUN_DEFAULT_PATH_FOR_SPAWN = _PATH_DEFPATH;
#elif OS(WINDOWS)
extern "C" const char* BUN_DEFAULT_PATH_FOR_SPAWN = "C:\\Windows\\System32;C:\\Windows;";
#else
extern "C" const char* BUN_DEFAULT_PATH_FOR_SPAWN = "/usr/bin:/bin";
#endif

#if OS(DARWIN)
#include <os/signpost.h>
#include "generated_perf_trace_events.h"

// The event names have to be compile-time constants.
// So we trick the compiler into thinking they are by using a macro.
extern "C" void Bun__signpost_emit(os_log_t log, os_signpost_type_t type, os_signpost_id_t spid, int trace_event_id)
{
#define EMIT_SIGNPOST(name, id)                                 \
    case id:                                                    \
        os_signpost_emit_with_type(log, type, spid, #name, ""); \
        break;

    switch (trace_event_id) {
        FOR_EACH_TRACE_EVENT(EMIT_SIGNPOST)
    default: {
        ASSERT_NOT_REACHED_WITH_MESSAGE("Invalid trace event id. Please run scripts/generate-perf-trace-events.sh to update the list of trace events.");
    }
    }
}

#undef EMIT_SIGNPOST
#undef FOR_EACH_TRACE_EVENT

#define BLOB_HEADER_ALIGNMENT 16 * 1024

extern "C" {
struct BlobHeader {
    uint32_t size;
    uint8_t data[];
} __attribute__((aligned(BLOB_HEADER_ALIGNMENT)));
}

extern "C" BlobHeader __attribute__((section("__BUN,__bun"))) BUN_COMPILED = { 0, 0 };

extern "C" uint32_t* Bun__getStandaloneModuleGraphMachoLength()
{
    return &BUN_COMPILED.size;
}
#endif
