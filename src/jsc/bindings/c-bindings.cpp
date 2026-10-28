// when we don't want to use @cInclude, we can just stick wrapper functions here
#include "root.h"
#include <cstdio>
#include <cstdlib>

#if !OS(WINDOWS)
#include <wtf/WTFConfig.h>
#include <sys/resource.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <signal.h>
#include <unistd.h>
#include <atomic>
#include <cerrno>
#include <cstring>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <pthread.h>
#include <termios.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#if OS(DARWIN)
#include <mach-o/loader.h>
#endif
#if defined(BUN_SAFE_STACK)
#include <climits>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#if ENABLE(AOT_GUARDED_PAGES)
#include <wtf/WTFConfig.h>
#endif
#endif
#else
#include <uv.h>
#include <windows.h>
#include <corecrt_io.h>
#include <atomic>
#include <new>
#include <wtf/Threading.h>
#endif // !OS(WINDOWS)

// Runs before Output and the Windows env block are initialized, so it uses the CRT.
extern "C" [[noreturn]] void bun_abort_missing_simd()
{
#if CPU(X86_64)
    fputs("error: this CPU is missing SSE4.2 support, which Bun requires.\n"
          "  If this is a VM, enable host CPU passthrough (e.g. -cpu host for QEMU/KVM).\n",
        stderr);
#else
    fputs("error: this CPU is missing SIMD support that Bun requires.\n", stderr);
#endif
    if (const char* forced = getenv("SIMDUTF_FORCE_IMPLEMENTATION")) {
        fprintf(stderr, "  note: SIMDUTF_FORCE_IMPLEMENTATION is set to \"%s\"\n", forced);
    }
    fflush(stderr);
    exit(134);
}

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
#if defined(O_EXEC) && !OS(LINUX)
    // musl defines O_EXEC as O_PATH, which opens any file.
    int fd = open(path, O_EXEC | O_CLOEXEC | O_NONBLOCK | O_NOCTTY, 0);
    if (fd < 0)
        return false;
    close(fd);
    return true;
#endif // defined(O_EXEC) && !OS(LINUX)

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

// Host CPU count, ignoring sched_getaffinity and cgroup cpu.max (unlike WTF::numberOfProcessorCores).
// Used to size os.cpus() so it matches the native cpus() result count.
extern "C" int32_t bun_sysconf__SC_NPROCESSORS_ONLN()
{
#if OS(WINDOWS)
    SYSTEM_INFO sysinfo;
    GetSystemInfo(&sysinfo);
    return sysinfo.dwNumberOfProcessors;
#else
    return sysconf(_SC_NPROCESSORS_ONLN);
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

// Accurate per-process memory footprint, in bytes. Returns 0 when the platform has no accessor; the
// JS caller falls back to process.memoryUsage.rss().
//
// Darwin:  task_info(TASK_VM_INFO).phys_footprint — Activity Monitor's number;
//          counts dirty + compressed, NOT reusable.
// Linux:   /proc/self/smaps_rollup Pss: — proportional set size, attributes
//          shared pages by share count instead of fully to every mapper.
// Windows: GetProcessMemoryInfo PrivateUsage — commit charge for this process.
#if OS(DARWIN)
extern "C" int getRSS(size_t* rss);
extern "C" size_t Bun__memoryFootprint()
{
    size_t footprint = 0;
    if (getRSS(&footprint) != 0) return 0;
    return footprint;
}
#elif OS(LINUX)
extern "C" size_t Bun__memoryFootprint()
{
    // smaps_rollup (Linux ≥4.14) is one read instead of walking every VMA.
    int fd;
    do {
        fd = open("/proc/self/smaps_rollup", O_RDONLY | O_CLOEXEC);
    } while (fd == -1 && errno == EINTR);
    if (fd == -1) return 0;

    char buf[2048];
    ssize_t n;
    do {
        n = read(fd, buf, sizeof(buf) - 1);
    } while (n == -1 && errno == EINTR);
    close(fd);
    if (n <= 0) return 0;
    buf[n] = '\0';

    // Look for "\nPss: <n> kB". Anchor on the newline so "Pss_Anon:" /
    // "Pss_File:" / "SwapPss:" don't match.
    const char* p = strstr(buf, "\nPss:");
    if (!p) return 0;
    p += sizeof("\nPss:") - 1;
    while (*p == ' ' || *p == '\t')
        p++;
    size_t kb = static_cast<size_t>(strtoull(p, nullptr, 10));
    return kb * 1024;
}
#elif OS(WINDOWS)
#include <psapi.h>
extern "C" size_t Bun__memoryFootprint()
{
    PROCESS_MEMORY_COUNTERS_EX pmc;
    if (!GetProcessMemoryInfo(GetCurrentProcess(),
            reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&pmc), sizeof(pmc)))
        return 0;
    return static_cast<size_t>(pmc.PrivateUsage);
}
#else
extern "C" size_t Bun__memoryFootprint()
{
    return 0;
}
#endif

#if OS(WINDOWS)
#define MS_PER_SEC 1000ULL // MS = milliseconds
#define US_PER_MS 1000ULL // US = microseconds
#define NS_PER_US 1000ULL // NS = nanoseconds

#define NS_PER_SEC (MS_PER_SEC * US_PER_MS * NS_PER_US)

extern "C" void clock_gettime_monotonic(int64_t* tv_sec, int64_t* tv_nsec)
{
    // C++11 thread-safe static init: Timespec::now() runs on multiple threads.
    // QueryPerformanceFrequency is documented to always succeed on Windows XP+.
    static const LARGE_INTEGER ticksPerSec = [] {
        LARGE_INTEGER f;
        QueryPerformanceFrequency(&f);
        return f;
    }();

    LARGE_INTEGER ticks;
    QueryPerformanceCounter(&ticks);

    *tv_sec = (int64_t)(ticks.QuadPart / ticksPerSec.QuadPart);
    *tv_nsec = (int64_t)(((ticks.QuadPart % ticksPerSec.QuadPart) * NS_PER_SEC) / ticksPerSec.QuadPart);
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

#if OS(LINUX) || OS(FREEBSD)

#include <sys/syscall.h>

#ifndef CLOSE_RANGE_CLOEXEC
#define CLOSE_RANGE_CLOEXEC (1U << 2)
#endif

#if OS(LINUX)
#ifndef __NR_close_range
// True for architectures we support:
// - arch/arm64/include/asm/unistd32.h
// - include/uapi/asm-generic/unistd.h
// Not true for:
// - DEC Alpha AXP (Alpha architecture)
#define __NR_close_range 436
#endif

// close_range is glibc > 2.33, which is very new
extern "C" ssize_t bun_close_range(unsigned int start, unsigned int end, unsigned int flags)
{
    return syscall(__NR_close_range, start, end, flags);
}

#if CPU(X86_64) || CPU(ARM64)
#include <atomic>
#include <ucontext.h>

#ifndef SYS_SECCOMP
#define SYS_SECCOMP 1
#endif

extern "C" void Bun__onPosixSignal(int signalNumber);

static std::atomic<bool> forwardSIGSYSToJS { false };

// A SECCOMP_RET_TRAP policy (Android) reports a blocked syscall with SIGSYS instead of an
// errno. Turn it into the ENOSYS return that the callers (close_range, pidfd_open, ...) handle.
static void onSIGSYS(int sig, siginfo_t* info, void* context)
{
    if (info->si_code == SYS_SECCOMP && context) {
        ucontext_t* uc = static_cast<ucontext_t*>(context);
#if CPU(X86_64)
        uc->uc_mcontext.gregs[REG_RAX] = -ENOSYS;
#else
        uc->uc_mcontext.regs[0] = static_cast<unsigned long long>(-ENOSYS);
#endif
        return;
    }

    // Otherwise it was sent with kill(2).
    if (forwardSIGSYSToJS.load(std::memory_order_relaxed)) {
        Bun__onPosixSignal(sig);
        return;
    }
    signal(sig, SIG_DFL);
    raise(sig);
}

static void installSIGSYSHandler()
{
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_sigaction = onSIGSYS;
    // SA_RESTART matches installForwardSignalHandler, for a SIGSYS sent with kill(2).
    sa.sa_flags = SA_SIGINFO | SA_ONSTACK | SA_RESTART;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGSYS, &sa, nullptr);
}

// BunProcess.cpp routes process.on("SIGSYS") through onSIGSYS instead of replacing it.
// Returns false on targets without onSIGSYS, where the caller installs its own handler.
extern "C" bool Bun__forwardSIGSYSToJS(bool enabled)
{
    forwardSIGSYSToJS.store(enabled, std::memory_order_relaxed);
    if (enabled)
        installSIGSYSHandler();
    return true;
}
#else
static void installSIGSYSHandler()
{
}

extern "C" bool Bun__forwardSIGSYSToJS(bool)
{
    return false;
}
#endif // CPU(X86_64) || CPU(ARM64)
#else // OS(FREEBSD)
// FreeBSD 12.2+ libc has close_range; 14.0+ supports CLOSE_RANGE_CLOEXEC
// (same value 1<<2 as Linux). Passing flags through means execveZ-failure
// recovery keeps fds open (CLOEXEC) instead of closing them outright.
extern "C" ssize_t bun_close_range(unsigned int start, unsigned int end, unsigned int flags)
{
    return close_range(start, end, flags);
}
#endif

#endif // OS(LINUX) || OS(FREEBSD)

#if !OS(WINDOWS)

static void unset_cloexec(int fd)
{
    int flags = fcntl(fd, F_GETFD, 0);
    if (flags == -1) {
        return;
    }
    flags &= ~FD_CLOEXEC;
    fcntl(fd, F_SETFD, flags);
}

#if OS(LINUX)
#include <dirent.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/Vector.h>

static WTF::Vector<int>& inheritedFileDescriptors()
{
    static NeverDestroyed<WTF::Vector<int>> descriptors;
    return descriptors.get();
}

extern "C" void bun_remember_inherited_file_descriptors()
{
    DIR* directory = opendir("/proc/self/fd");
    if (!directory)
        return;
    while (struct dirent* entry = readdir(directory)) {
        char* end = nullptr;
        long fd = strtol(entry->d_name, &end, 10);
        if (end != entry->d_name && *end == '\0' && fd >= 3 && fd <= INT_MAX && fd != dirfd(directory))
            inheritedFileDescriptors().append(static_cast<int>(fd));
    }
    closedir(directory);
}
#endif

extern "C" void on_before_reload_process_posix([[maybe_unused]] bool closeInheritedFileDescriptors)
{
    unset_cloexec(STDIN_FILENO);
    unset_cloexec(STDOUT_FILENO);
    unset_cloexec(STDERR_FILENO);

#if OS(LINUX) || OS(FREEBSD)
    // close all file descriptors except stdin, stdout, stderr and possibly IPC.
    // if you're passing additional file descriptors to Bun, you're probably not passing more than 8.
    // If this fails, it's ultimately okay, we're just trying our best to avoid leaking file descriptors.
    if (closeInheritedFileDescriptors)
        bun_close_range(3, ~0U, CLOSE_RANGE_CLOEXEC);
#endif
#if OS(LINUX)
    if (!closeInheritedFileDescriptors) {
        for (int fd : inheritedFileDescriptors())
            unset_cloexec(fd);
    }
#endif

    // Preserve the IPC channel to the parent across the execve: NODE_CHANNEL_FD survives in
    // environ and the reloaded image re-attaches to it; CLOEXEC'd, the parent stops receiving
    // 'message' events after the first reload.
    if (const char* s = getenv("NODE_CHANNEL_FD")) {
        char* end = nullptr;
        long fd = strtol(s, &end, 10);
        if (end != s && *end == '\0' && fd >= 3 && fd <= INT_MAX)
            unset_cloexec(static_cast<int>(fd));
    }

    // Reset caught dispositions so a SIGTERM arriving between here and execve isn't queued-then-
    // lost. Inherited SIG_IGN is left alone. SIGSEGV/SIGBUS/SIGSYS/RT/sigThreadSuspendResume are left
    // for execve to reset atomically — resetting them here races JSC's sampler/GC threads fatally.
    struct sigaction sa {};
    sa.sa_handler = SIG_DFL;
    sigemptyset(&sa.sa_mask);
    for (int s = 1; s < NSIG; s++) {
        if (s == SIGKILL || s == SIGSTOP || s == SIGSEGV || s == SIGBUS)
            continue;
#if OS(LINUX)
        if (s == g_wtfConfig.sigThreadSuspendResume || s == SIGSYS)
            continue;
#endif
#ifdef SIGRTMIN
        if (s >= SIGRTMIN)
            break;
#endif
        struct sigaction old {};
        if (sigaction(s, nullptr, &old) != 0)
            continue;
        if (old.sa_handler == SIG_IGN || old.sa_handler == SIG_DFL)
            continue;
        sigaction(s, &sa, nullptr);
    }

    sigset_t signal_set;
    sigemptyset(&signal_set);
    sigprocmask(SIG_SETMASK, &signal_set, nullptr);
}

#if OS(LINUX)
// Linked in with -Wl,--wrap=execve -Wl,--wrap=pthread_create (scripts/build/flags.ts).
// While a thread is inside execve(2), until de_thread() has killed the other threads or the
// exec has failed, the kernel fails every clone(CLONE_FS) in the process with EAGAIN
// (fs/exec.c check_unsafe_exec, kernel/fork.c copy_fs). WTF::Thread::create aborts on a
// failed pthread_create, which killed --watch reloads. A pthread_create EAGAIN that overlaps
// an exec of this process is retried instead. `execve_generation` counts execs ever started
// so one that began and ended inside a single pthread_create is still seen; it is bumped
// after `threads_in_execve` and read before it.
static std::atomic<int> threads_in_execve { 0 };
static std::atomic<unsigned> execve_generation { 0 };
// The clone(CLONE_VM) child of posix_spawn_bun execs in this address space and never returns
// to undo a count, so only the pid recorded in bun_initialize_process counts its execs.
static pid_t execve_counting_pid = 0;

extern "C" int __real_execve(const char*, char* const[], char* const[]);
extern "C" int __real_pthread_create(pthread_t*, const pthread_attr_t*, void* (*)(void*), void*);

#if defined(BUN_SAFE_STACK)
extern "C" __attribute__((visibility("default"))) thread_local void* __safestack_unsafe_stack_ptr = nullptr;

namespace {

constexpr size_t unsafeStackGuardSize = 256 * 1024;
constexpr size_t unsafeStackDefaultSize = 8 * 1024 * 1024;
constexpr size_t unsafeStackPageSize = 4096;

struct UnsafeStack {
    void* mapping;
    size_t mappingSize;
    void* (*routine)(void*);
    void* argument;
    pid_t process;
    pid_t thread;
    int destructorRoundsLeft;
    UnsafeStack* next;
};

pthread_key_t unsafeStackKey;
pthread_mutex_t retiredUnsafeStacksLock = PTHREAD_MUTEX_INITIALIZER;
UnsafeStack* retiredUnsafeStacks = nullptr;

#if ENABLE(AOT_GUARDED_PAGES)
// What the system places by itself shares one random base: an address of an array on this stack would give away the stack with the return addresses and the C library.
// Runs before the C library's own initializers too: it asks the kernel itself for the random number.
void* mapAtRandomAddress(size_t mappingSize)
{
    constexpr uintptr_t lowestRandomAddress = 64ull << 30;
    constexpr uintptr_t highestRandomAddress = 124ull << 40;
    constexpr unsigned maxDraws = 16;
    if (WTF::isAddressRandomizationDisabled())
        return MAP_FAILED;
    uintptr_t numberOfSlots = (highestRandomAddress - lowestRandomAddress - mappingSize) / unsafeStackPageSize;
    for (unsigned draw = 0; draw < maxDraws; ++draw) {
        uint64_t random;
        if (syscall(SYS_getrandom, &random, sizeof(random), 0) != sizeof(random))
            break;
        void* requestedAddress = reinterpret_cast<void*>(lowestRandomAddress + random % numberOfSlots * unsafeStackPageSize);
        void* mapping = mmap(requestedAddress, mappingSize, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE, -1, 0);
        if (mapping == MAP_FAILED || mapping == requestedAddress)
            return mapping;
        munmap(mapping, mappingSize);
    }
    return MAP_FAILED;
}
#endif

void* mapUnsafeStack(size_t size, size_t& mappingSize)
{
    size = (size + unsafeStackPageSize - 1) & ~(unsafeStackPageSize - 1);
    mappingSize = size + 2 * unsafeStackGuardSize;
    void* mapping = MAP_FAILED;
#if ENABLE(AOT_GUARDED_PAGES)
    mapping = mapAtRandomAddress(mappingSize);
#endif
    if (mapping == MAP_FAILED)
        mapping = mmap(nullptr, mappingSize, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE, -1, 0);
    if (mapping == MAP_FAILED)
        return nullptr;
    if (mprotect(static_cast<char*>(mapping) + unsafeStackGuardSize, size, PROT_READ | PROT_WRITE)) {
        munmap(mapping, mappingSize);
        return nullptr;
    }
    return mapping;
}

void* topOfUnsafeStack(void* mapping, size_t mappingSize)
{
    return static_cast<char*>(mapping) + mappingSize - unsafeStackGuardSize;
}

void releaseUnsafeStack(UnsafeStack* stack)
{
    munmap(stack->mapping, stack->mappingSize);
    free(stack);
}

bool threadIsGone(const UnsafeStack* stack)
{
    return stack->process != getpid() || (syscall(SYS_tgkill, stack->process, stack->thread, 0) == -1 && errno == ESRCH);
}

void retireUnsafeStack(void* value)
{
    auto* stack = static_cast<UnsafeStack*>(value);
    if (--stack->destructorRoundsLeft > 0) {
        pthread_setspecific(unsafeStackKey, stack);
        return;
    }
    pthread_mutex_lock(&retiredUnsafeStacksLock);
    UnsafeStack** link = &retiredUnsafeStacks;
    while (UnsafeStack* each = *link) {
        if (threadIsGone(each)) {
            *link = each->next;
            releaseUnsafeStack(each);
        } else
            link = &each->next;
    }
    stack->next = retiredUnsafeStacks;
    retiredUnsafeStacks = stack;
    pthread_mutex_unlock(&retiredUnsafeStacksLock);
}

void* startWithUnsafeStack(void* value)
{
    auto* stack = static_cast<UnsafeStack*>(value);
    stack->process = getpid();
    stack->thread = static_cast<pid_t>(syscall(SYS_gettid));
    __safestack_unsafe_stack_ptr = topOfUnsafeStack(stack->mapping, stack->mappingSize);
    pthread_setspecific(unsafeStackKey, stack);
    return stack->routine(stack->argument);
}

UnsafeStack* makeUnsafeStack(const pthread_attr_t* attributes, void* (*routine)(void*), void* argument)
{
    size_t size = 0;
    pthread_attr_t defaults;
    if (attributes)
        pthread_attr_getstacksize(attributes, &size);
    else if (!pthread_attr_init(&defaults)) {
        pthread_attr_getstacksize(&defaults, &size);
        pthread_attr_destroy(&defaults);
    }
    auto* stack = static_cast<UnsafeStack*>(malloc(sizeof(UnsafeStack)));
    if (!stack)
        return nullptr;
    *stack = { nullptr, 0, routine, argument, 0, 0, PTHREAD_DESTRUCTOR_ITERATIONS, nullptr };
    stack->mapping = mapUnsafeStack(size ? size : unsafeStackDefaultSize, stack->mappingSize);
    if (!stack->mapping) {
        free(stack);
        return nullptr;
    }
    return stack;
}

// Runs before the C library's own initializers: it formats nothing.
[[noreturn]] void abortBecauseOf(const char* call, int error)
{
    char digits[12];
    char* first = digits + sizeof(digits);
    for (unsigned rest = static_cast<unsigned>(error); first == digits + sizeof(digits) || rest; rest /= 10)
        *--first = static_cast<char>('0' + rest % 10);
    const struct iovec sentence[] = {
        { const_cast<char*>("error: the main thread got no second stack: "), 44 },
        { const_cast<char*>(call), strlen(call) },
        { const_cast<char*>(" failed with errno "), 19 },
        { first, static_cast<size_t>(digits + sizeof(digits) - first) },
        { const_cast<char*>("\n"), 1 },
    };
    [[maybe_unused]] ssize_t written = writev(STDERR_FILENO, sentence, 5);
    abort();
}

void giveMainThreadItsUnsafeStack()
{
    struct rlimit limit;
    size_t size = !getrlimit(RLIMIT_STACK, &limit) && limit.rlim_cur != RLIM_INFINITY ? limit.rlim_cur : unsafeStackDefaultSize;
    size_t mappingSize;
    void* mapping = mapUnsafeStack(size, mappingSize);
    if (!mapping)
        abortBecauseOf("mmap or mprotect", errno);
    if (int error = pthread_key_create(&unsafeStackKey, retireUnsafeStack))
        abortBecauseOf("pthread_key_create", error);
    __safestack_unsafe_stack_ptr = topOfUnsafeStack(mapping, mappingSize);
}

__attribute__((section(".preinit_array"), used)) void (*unsafeStackInitializer)() = giveMainThreadItsUnsafeStack;

} // namespace
#endif

extern "C" int __wrap_execve(const char* path, char* const argv[], char* const envp[])
{
    if (getpid() != execve_counting_pid)
        return __real_execve(path, argv, envp);
    threads_in_execve.fetch_add(1, std::memory_order_seq_cst);
    execve_generation.fetch_add(1, std::memory_order_seq_cst);
    int rc = __real_execve(path, argv, envp);
    // Only reached when execve failed and the old image keeps running.
    threads_in_execve.fetch_sub(1, std::memory_order_seq_cst);
    return rc;
}

// The attempt bound keeps a real limit, hit while an exec never completes, from looping forever.
static int createThreadUnlessExecIsInFlight(pthread_t* thread, const pthread_attr_t* attr, void* (*start_routine)(void*), void* arg)
{
    for (int attempt = 0;; attempt++) {
        unsigned generation = execve_generation.load(std::memory_order_seq_cst);
        bool execInFlight = threads_in_execve.load(std::memory_order_seq_cst) > 0;
        int rc = __real_pthread_create(thread, attr, start_routine, arg);
        if (rc != EAGAIN || attempt >= 1000)
            return rc;
        if (!execInFlight && threads_in_execve.load(std::memory_order_seq_cst) == 0
            && execve_generation.load(std::memory_order_seq_cst) == generation) {
            // No exec overlapped this attempt: a real limit.
            return rc;
        }
        usleep(1000);
    }
}

extern "C" int __wrap_pthread_create(pthread_t* thread, const pthread_attr_t* attr, void* (*start_routine)(void*), void* arg)
{
#if defined(BUN_SAFE_STACK)
    UnsafeStack* stack = makeUnsafeStack(attr, start_routine, arg);
    if (!stack)
        return EAGAIN;
    int rc = createThreadUnlessExecIsInFlight(thread, attr, startWithUnsafeStack, stack);
    if (rc)
        releaseUnsafeStack(stack);
    return rc;
#else
    return createThreadUnlessExecIsInFlight(thread, attr, start_routine, arg);
#endif
}
#endif // OS(LINUX)

#endif // !OS(WINDOWS)

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
// Whether Bun itself has modified the termios of each stdio fd during this
// process's lifetime (e.g. via process.stdin.setRawMode). Used to decide
// whether the exit-time termios restore should fire when Bun is acting as a
// pipeline producer (stdout is a pipe). See #29592 — writing our startup
// snapshot back to a shared /dev/pts device clobbers raw mode set on the
// same device by a downstream consumer (less, fzf, fx, ...).
//
// `volatile sig_atomic_t` because bun_restore_stdio() reads this from signal
// context (onExitSignal, SIGINT/SIGTERM) while Bun__ttySetMode() writes it
// from normal execution; sig_atomic_t is the only integral type POSIX
// guarantees can be accessed atomically across that boundary.
extern "C" volatile sig_atomic_t bun_stdio_modified[3] = { 0, 0, 0 };
#endif

extern "C" void bun_restore_stdio()
{

#if !OS(WINDOWS)

    // Only suppress the restore when Bun is a pipeline producer (stdout is a
    // pipe, not a TTY) and it didn't touch termios itself. That's the #29592
    // case — a downstream consumer on the same /dev/pts/* device has already
    // taken over termios and writing our startup snapshot back clobbers it.
    //
    // For the interactive-wrapper case (stdout IS a TTY, e.g. `bun run vim`
    // where the child put the terminal into raw mode and then crashed), we
    // keep the unconditional restore so the shell prompt comes back cooked.
    // Same for the crash-handler, --watch reload, and signal-death paths in
    // run_command / bunx / lifecycle_script_runner — those are all cases
    // where Bun is the foreground session owner and the startup snapshot is
    // the state the user expects back.
    const bool pipeline_producer = bun_stdio_tty[1] == 0;

    // restore stdio
    for (int32_t fd = 0; fd < 3; fd++) {
        if (!bun_stdio_tty[fd])
            continue;
        if (pipeline_producer && !bun_stdio_modified[fd])
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
// Implemented by bun_core::Global::raise_default_action.
extern "C" [[noreturn]] void Bun__raiseDefaultAction(int sig);

extern "C" void onExitSignal(int sig)
{
    bun_restore_stdio();
    Bun__raiseDefaultAction(sig);
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

// Held, never released, across ExitProcess: a WTF suspender it kills between
// SuspendThread and ResumeThread of this thread would leave it suspended forever.
extern "C" void Bun__lockThreadSuspensionForExit()
{
    static std::atomic<DWORD> owner { 0 };
    DWORD self = GetCurrentThreadId();
    DWORD expected = 0;
    if (!owner.compare_exchange_strong(expected, self, std::memory_order_acq_rel)) {
        // Re-entered on the thread that already holds the lock.
        if (expected == self)
            return;
        // Another thread's exit holds it and is about to terminate this thread.
        for (;;)
            SleepEx(INFINITE, FALSE);
    }
    alignas(WTF::ThreadSuspendLocker) static unsigned char storage[sizeof(WTF::ThreadSuspendLocker)];
    new (storage) WTF::ThreadSuspendLocker();
}
#endif

extern "C" int32_t bun_is_stdio_null[3] = { 0, 0, 0 };

#if OS(DARWIN)
extern "C" int __cxa_atexit(void (*)(void*), void*, void*);
extern "C" struct mach_header __dso_handle;
#endif

#if OS(LINUX) || OS(DARWIN) || OS(FREEBSD)
static NEVER_INLINE void openDevNullIfStdioIsClosed(int fd)
{
    // Don't use isatty() here. It also fails with EBADF on an open O_PATH descriptor.
    if (fcntl(fd, F_GETFD) != -1 || errno != EBADF)
        return;

    bun_is_stdio_null[fd] = 1;
    int devNullFd;
    do {
        devNullFd = open("/dev/null", O_RDWR | O_CLOEXEC, 0);
    } while (devNullFd < 0 && errno == EINTR);

    // Every lower fd is open, so open() must return `fd`.
    if (devNullFd != fd) [[unlikely]]
        abort();
}
#endif

extern "C" void bun_initialize_process()
{
#if OS(DARWIN)
    if (JSC::Bun__removableFeatureState.isTrimmed || JSC::Bun__removableFeatureState.removedRangeCount) [[unlikely]]
        Bun__prepareTrimmedExecutable();
#endif

    // Disable printf() buffering. We buffer it ourselves.
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);

#if OS(LINUX)
    // A seccomp policy may trap bun_close_range.
    installSIGSYSHandler();

    // Prevent leaking inherited file descriptors on Linux
    // This is less of an issue for macOS due to posix_spawn
    // This is best effort, not all linux kernels support close_range or CLOSE_RANGE_CLOEXEC
    // To avoid breaking --watch, we skip stdin, stdout, stderr and IPC.
    bun_close_range(4, ~0U, CLOSE_RANGE_CLOEXEC);

    execve_counting_pid = getpid();
#endif

#if OS(LINUX) || OS(DARWIN) || OS(FREEBSD)

    bool anyTTYs = false;

    for (int fd = 0; fd < 3; fd++) {
        int result = isatty(fd);
        if (result == 0) {
            if (errno == EBADF) [[unlikely]] {
                openDevNullIfStdioIsClosed(fd);
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
    // atexit() on macOS dladdr()s the handler, a linear walk of this executable's
    // symbol table (~0.5ms with symbols). __cxa_atexit lands on the same LIFO
    // list without the lookup, as the compiler does for static destructors.
    __cxa_atexit([](void*) { Bun__onExit(); }, nullptr, &__dso_handle);
#elif ASAN_ENABLED
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
#if OS(LINUX) || OS(FREEBSD)
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

extern "C" [[ZIG_EXPORT(nothrow)]] size_t Bun__ramSize()
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
#if OS(LINUX) || OS(DARWIN) || OS(FREEBSD)
#include <signal.h>
#include <pthread.h>
#include <wtf/Lock.h>

// The handler below can run on any thread while the spawning thread stores the pid.
extern "C" std::atomic<int64_t> Bun__currentSyncPID { 0 }; // `AtomicI64` on the Rust side.
static_assert(std::atomic<int64_t>::is_always_lock_free);
static std::atomic<int> Bun__pendingSignalToSend { 0 };
static struct sigaction previous_actions[NSIG];
// Bun.openInEditor runs spawnSync on detached threads, so register and unregister can overlap.
static WTF::Lock signalForwardingLock;
static int signalForwardingDepth = 0;

// npm's signal list minus SIGIOT/SIGPOLL (aliases of SIGABRT/SIGIO; listing both would overwrite previous_actions[N])
// and minus SIGSYS, which the kernel raises for the process's own syscall.
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
    M(SIGQUIT);                  \
    M(SIGIO);

#if OS(LINUX)
// SIGPWR is intentionally excluded: JSC uses it for GC thread suspend/resume
// (see wtf/posix/ThreadingPOSIX.cpp); overriding it here breaks GC.
#define FOR_EACH_LINUX_ONLY_SIGNAL(M) \
    M(SIGSTKFLT);

#endif

#if OS(DARWIN) || OS(FREEBSD)
#define FOR_EACH_SIGNAL(M) FOR_EACH_POSIX_SIGNAL(M)
#endif

#if OS(LINUX)
#define FOR_EACH_SIGNAL(M)   \
    FOR_EACH_POSIX_SIGNAL(M) \
    FOR_EACH_LINUX_ONLY_SIGNAL(M)
#endif

// The spawning thread stores the pid, then reads the pending signal. The handler stores the signal, then loads
// the pid. At least one of them sees the other's store, and the exchange ensures only one of them sends the signal.
extern "C" void Bun__sendPendingSignalIfNecessary()
{
    int sig = Bun__pendingSignalToSend.exchange(0);
    int64_t pid = Bun__currentSyncPID.load();
    if (sig == 0 || pid == 0)
        return;

    kill(pid, sig);
}

extern "C" void Bun__registerSignalsForForwarding()
{
    WTF::Locker locker { signalForwardingLock };
    if (signalForwardingDepth++ != 0)
        return;

    Bun__pendingSignalToSend.store(0);
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sigemptyset(&sa.sa_mask);
    // Not SA_RESETHAND: a nested runner sees the signal more than once and must not die on a repeat delivery.
    sa.sa_flags = 0;
    sa.sa_handler = [](int sig) {
        int64_t pid = Bun__currentSyncPID.load();
        if (pid == 0) {
            Bun__pendingSignalToSend.store(sig);
            pid = Bun__currentSyncPID.load();
            if (pid == 0 || Bun__pendingSignalToSend.exchange(0) == 0)
                return;
        }

        kill(pid, sig);
    };

#define REGISTER_SIGNAL(SIG)                                 \
    if (sigaction(SIG, &sa, &previous_actions[SIG]) == -1) { \
    }

    FOR_EACH_SIGNAL(REGISTER_SIGNAL)

#undef REGISTER_SIGNAL
}

extern "C" void Bun__unregisterSignalsForForwarding()
{
    Bun__currentSyncPID.store(0);

    WTF::Locker locker { signalForwardingLock };
    if (--signalForwardingDepth != 0)
        return;

#define UNREGISTER_SIGNAL(SIG)                                \
    if (sigaction(SIG, &previous_actions[SIG], NULL) == -1) { \
    }

    FOR_EACH_SIGNAL(UNREGISTER_SIGNAL)
    memset(previous_actions, 0, sizeof(previous_actions));
#undef UNREGISTER_SIGNAL
}

#endif

#if OS(LINUX) || OS(DARWIN) || OS(FREEBSD)
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

#endif // OS(DARWIN) signpost code

#if OS(DARWIN) || defined(__linux__) || defined(__FreeBSD__)

#if OS(DARWIN)
// exe_format/macho.rs expands the __BUN segment in place at this alignment
// (the page size on Apple Silicon).
#define BLOB_HEADER_ALIGNMENT (16 * 1024)
#else
// ELF: the section holds only this 8-byte header; exe_format/elf.rs places the
// --compile payload at a page-aligned vaddr itself. A larger alignment raises
// the RW PT_LOAD's p_align past the page size, which makes it overlap the
// previous segment under strict-p_align loaders like UPX's stub (#40752).
#define BLOB_HEADER_ALIGNMENT 8
#endif

extern "C" {
struct BlobHeader {
    uint64_t size; // 64-bit to ensure data[] starts at 8-byte aligned offset (required for bytecode cache)
    uint8_t data[];
} __attribute__((aligned(BLOB_HEADER_ALIGNMENT)));
}

#if OS(DARWIN)

#include <mach-o/getsect.h>
#include <mach-o/ldsyms.h>

extern "C" BlobHeader __attribute__((section("__BUN,__bun"))) BUN_COMPILED = { 0, 0 };

extern "C" uint64_t* Bun__getStandaloneModuleGraphMachoLength()
{
    // A corrupt file can claim any length, so check it against the section size from the load command.
    unsigned long sectionSize = 0;
    uint8_t* sectionData = getsectiondata(&_mh_execute_header, "__BUN", "__bun", &sectionSize);
    if (!sectionData || sectionSize < sizeof(uint64_t)) return nullptr;
    if (BUN_COMPILED.size > sectionSize - sizeof(uint64_t)) return nullptr;
    return &BUN_COMPILED.size;
}

#else // __linux__ / __FreeBSD__ — both ELF, same .bun section approach

extern "C" BlobHeader __attribute__((section(".bun"), aligned(BLOB_HEADER_ALIGNMENT), used)) BUN_COMPILED = { 0 };

extern "C" uint64_t* Bun__getStandaloneModuleGraphELFVaddr()
{
    return &BUN_COMPILED.size;
}

#endif // OS(DARWIN) / __linux__

#elif defined(_WIN32)
// Windows PE section handling
#include <windows.h>
#include <winnt.h>

static uint64_t* pe_section_size = nullptr;
static uint8_t* pe_section_data = nullptr;

// Helper function to find and map the .bun section
static bool initializePESection()
{
    if (pe_section_size != nullptr) return true;

    HMODULE hModule = GetModuleHandleA(NULL);
    if (!hModule) return false;

    PIMAGE_DOS_HEADER dosHeader = (PIMAGE_DOS_HEADER)hModule;
    if (dosHeader->e_magic != IMAGE_DOS_SIGNATURE) return false;

    PIMAGE_NT_HEADERS ntHeaders = (PIMAGE_NT_HEADERS)((BYTE*)hModule + dosHeader->e_lfanew);
    if (ntHeaders->Signature != IMAGE_NT_SIGNATURE) return false;

    PIMAGE_SECTION_HEADER sectionHeader = IMAGE_FIRST_SECTION(ntHeaders);

    for (int i = 0; i < ntHeaders->FileHeader.NumberOfSections; i++) {
        if (memcmp(sectionHeader->Name, ".bun\0\0\0\0", 8) == 0) {
            // Found the .bun section
            // Section format: 8 bytes size (uint64_t) + data
            // A corrupt file can claim any length, but only VirtualSize bytes are mapped.
            uint64_t sectionSize = sectionHeader->Misc.VirtualSize;
            if (sectionSize < sizeof(uint64_t)) return false;

            BYTE* sectionData = (BYTE*)hModule + sectionHeader->VirtualAddress;
            uint64_t embeddedLength;
            memcpy(&embeddedLength, sectionData, sizeof(embeddedLength));
            if (embeddedLength > sectionSize - sizeof(uint64_t)) return false;

            pe_section_size = (uint64_t*)sectionData;
            pe_section_data = sectionData + sizeof(uint64_t); // Skip size (8)
            return true;
        }
        sectionHeader++;
    }

    return false;
}

extern "C" uint64_t Bun__getStandaloneModuleGraphPELength()
{
    if (!initializePESection()) return 0;
    return pe_section_size ? *pe_section_size : 0;
}

extern "C" uint8_t* Bun__getStandaloneModuleGraphPEData()
{
    if (!initializePESection()) return nullptr;
    return pe_section_data;
}

#endif
