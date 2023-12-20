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
#include <io.h>
#include <uv.h>
#endif // !OS(WINDOWS)

extern "C" void bun_warn_avx_missing(const char* url)
{
#if CPU(X86_64)
#if !OS(WINDOWS)
    __builtin_cpu_init();
    if (__builtin_cpu_supports("avx")) {
        return;
    }
#else // OS(WINDOWS)
    int cpuInfo[4];
    __cpuid(cpuInfo, 1);

    bool osUsesXSAVE_XRSTORE = cpuInfo[2] & (1 << 27) || false;
    bool cpuAVXSuport = cpuInfo[2] & (1 << 28) || false;

    if (osUsesXSAVE_XRSTORE && cpuAVXSuport) {
        // Check if the OS will save the YMM registers
        unsigned long long xcrFeatureMask = _xgetbv(_XCR_XFEATURE_ENABLED_MASK);
        if (xcrFeatureMask & 0x6)
            return;
    }
#endif // !OS(WINDOWS)
    static constexpr const char* str = "warn: CPU lacks AVX support, strange crashes may occur. Reinstall Bun or use *-baseline build:\n  ";
    const size_t len = strlen(str);
    char buf[512];
    strcpy(buf, str);
    strcpy(buf + len, url);
    strcpy(buf + len + strlen(url), "\n\0");
#if !OS(WINDOWS)
    write(STDERR_FILENO, buf, strlen(buf));
#else // OS(WINDOWS)
    _write(2, buf, strlen(buf));
#endif // !OS(WINDOWS)
    return;
#endif // CPU(X86_64)
    RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("never should call bun_supports_avx() on non-x86_64");
}

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
