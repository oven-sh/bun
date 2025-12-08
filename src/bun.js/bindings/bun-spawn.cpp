#include "root.h"

#if OS(LINUX) || OS(DARWIN)

#include <fcntl.h>
#include <cstring>
#include <signal.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <sys/ioctl.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/resource.h>

#if OS(LINUX)
#include <sys/syscall.h>
#endif

extern char** environ;

#ifndef CLOSE_RANGE_CLOEXEC
#define CLOSE_RANGE_CLOEXEC (1U << 2)
#endif

#if OS(LINUX)
extern "C" ssize_t bun_close_range(unsigned int start, unsigned int end, unsigned int flags);
#endif

// Helper: get max fd from system, clamped to sane limits and optionally to 'end' parameter
static inline int getMaxFd(int start, int end)
{
#if OS(LINUX)
    int maxfd = static_cast<int>(sysconf(_SC_OPEN_MAX));
#elif OS(DARWIN)
    int maxfd = getdtablesize();
#else
    int maxfd = 1024;
#endif
    if (maxfd < 0 || maxfd > 65536) maxfd = 1024;
    // Respect the end parameter if it's a valid bound (not INT_MAX sentinel)
    if (end >= start && end < INT_MAX) {
        maxfd = std::min(maxfd, end + 1); // +1 because end is inclusive
    }
    return maxfd;
}

// Loop-based fallback for closing/cloexec fds
static inline void closeRangeLoop(int start, int end, bool cloexec_only)
{
    int maxfd = getMaxFd(start, end);
    for (int fd = start; fd < maxfd; fd++) {
        if (cloexec_only) {
            int current_flags = fcntl(fd, F_GETFD);
            if (current_flags >= 0) {
                fcntl(fd, F_SETFD, current_flags | FD_CLOEXEC);
            }
        } else {
            close(fd);
        }
    }
}

// Platform-specific close range implementation
static inline void closeRangeOrLoop(int start, int end, bool cloexec_only)
{
#if OS(LINUX)
    unsigned int flags = cloexec_only ? CLOSE_RANGE_CLOEXEC : 0;
    if (bun_close_range(start, end, flags) == 0) {
        return;
    }
    // Fallback for older kernels or when close_range fails
#endif
    closeRangeLoop(start, end, cloexec_only);
}

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
    int mode;
} bun_spawn_request_file_action_t;

typedef struct bun_spawn_file_action_list_t {
    const bun_spawn_request_file_action_t* ptr;
    size_t len;
} bun_spawn_file_action_list_t;

typedef struct bun_spawn_request_t {
    const char* chdir;
    bool detached;
    bun_spawn_file_action_list_t actions;
    int pty_slave_fd; // -1 if not using PTY, otherwise the slave fd to set as controlling terminal
} bun_spawn_request_t;

extern "C" ssize_t posix_spawn_bun(
    int* pid,
    const char* path,
    const bun_spawn_request_t* request,
    char* const argv[],
    char* const envp[])
{
    volatile int status = 0;
    sigset_t blockall, oldmask;
    int res = 0, cs = 0;
    sigfillset(&blockall);
    sigprocmask(SIG_SETMASK, &blockall, &oldmask);
    pthread_setcancelstate(PTHREAD_CANCEL_DISABLE, &cs);

    // Use fork() for POSIX compliance. While vfork() would be faster,
    // POSIX restricts vfork children to only calling _exit() or exec*(),
    // but we need to do complex setup (setsid, ioctl, dup2, etc.) before exec.
    pid_t child = fork();

    const auto childFailed = [&]() -> ssize_t {
        res = errno;
        status = res;
        closeRangeOrLoop(0, INT_MAX, false);
        _exit(127);

        // should never be reached
        return -1;
    };

    const auto startChild = [&]() -> ssize_t {
        sigset_t childmask = oldmask;

        // Reset signals
        struct sigaction sa = { 0 };
        sa.sa_handler = SIG_DFL;
        for (int i = 0; i < NSIG; i++) {
            sigaction(i, &sa, 0);
        }

        // Make "detached" work, or set up PTY as controlling terminal
        if (request->detached || request->pty_slave_fd >= 0) {
            setsid();
        }

        // Set PTY slave as controlling terminal for proper job control.
        // TIOCSCTTY may fail if the terminal is already the controlling terminal
        // of another session. This is non-fatal - the process can still run,
        // just without proper job control.
        if (request->pty_slave_fd >= 0) {
            (void)ioctl(request->pty_slave_fd, TIOCSCTTY, 0);
        }

        int current_max_fd = 0;

        if (request->chdir) {
            if (chdir(request->chdir) != 0) {
                return childFailed();
            }
        }

        const auto& actions = request->actions;

        for (size_t i = 0; i < actions.len; i++) {
            const bun_spawn_request_file_action_t& action = actions.ptr[i];
            switch (action.type) {
            case FileActionType::Close: {
                close(action.fds[0]);
                break;
            }
            case FileActionType::Dup2: {
                // Note: If oldfd is a valid file descriptor, and newfd has the same
                // value as oldfd, then dup2() does nothing, and returns newfd.
                if (action.fds[0] == action.fds[1]) {
                    int prevErrno = errno;
                    errno = 0;

                    // Remove the O_CLOEXEC flag
                    // If we don't do this, then the process will have an already-closed file descriptor
                    int mask = fcntl(action.fds[0], F_GETFD, 0);
                    mask &= ~FD_CLOEXEC;
                    fcntl(action.fds[0], F_SETFD, mask);

                    if (errno != 0) {
                        return childFailed();
                    }

                    // Restore errno
                    errno = prevErrno;
                } else {
                    // dup2 creates a new file descriptor without O_CLOEXEC set
                    if (dup2(action.fds[0], action.fds[1]) == -1) {
                        return childFailed();
                    }
                }

                current_max_fd = std::max(current_max_fd, action.fds[1]);
                break;
            }
            case FileActionType::Open: {
                int opened = -1;
                opened = open(action.path, action.flags, action.mode);

                if (opened == -1) {
                    return childFailed();
                }

                if (opened != -1) {
                    if (dup2(opened, action.fds[0]) == -1) {
                        close(opened);
                        return childFailed();
                    }
                    current_max_fd = std::max(current_max_fd, action.fds[0]);
                    if (close(opened)) {
                        return childFailed();
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

        sigprocmask(SIG_SETMASK, &childmask, 0);
        if (!envp)
            envp = environ;

        // Close all fds > current_max_fd, preferring cloexec if available
        closeRangeOrLoop(current_max_fd + 1, INT_MAX, true);

        if (execve(path, argv, envp) == -1) {
            return childFailed();
        }
        _exit(127);

        // should never be reached.
        return -1;
    };

    if (child == 0) {
        return startChild();
    }

    if (child != -1) {
        res = status;

        if (!res) {
            if (pid) {
                *pid = child;
            }
        } else {
            wait4(child, 0, 0, 0);
        }
    } else {
        res = errno;
    }

    sigprocmask(SIG_SETMASK, &oldmask, 0);
    pthread_setcancelstate(cs, 0);

    return res;
}

#endif
