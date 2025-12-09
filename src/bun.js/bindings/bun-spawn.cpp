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

// Raw exit syscall that doesn't go through libc.
// This avoids potential deadlocks when forking from a multi-threaded process,
// as _exit() may try to acquire locks held by threads that don't exist in the child.
static inline void rawExit(int status)
{
#if OS(LINUX)
    syscall(__NR_exit_group, status);
#else
    _exit(status);
#endif
}

extern "C" ssize_t posix_spawn_bun(
    int* pid,
    const char* path,
    const bun_spawn_request_t* request,
    char* const argv[],
    char* const envp[])
{
    sigset_t blockall, oldmask;
    int res = 0, cs = 0;

#if OS(DARWIN)
    // On macOS, we use fork() which requires a self-pipe trick to detect exec failures.
    // Create a pipe for child-to-parent error communication.
    // The write end has O_CLOEXEC so it's automatically closed on successful exec.
    // If exec fails, child writes errno to the pipe.
    int errpipe[2];
    if (pipe(errpipe) == -1) {
        return errno;
    }
    // Set cloexec on write end so it closes on successful exec
    fcntl(errpipe[1], F_SETFD, FD_CLOEXEC);
#endif

    sigfillset(&blockall);
    sigprocmask(SIG_SETMASK, &blockall, &oldmask);
    pthread_setcancelstate(PTHREAD_CANCEL_DISABLE, &cs);

#if OS(LINUX)
    // On Linux, use vfork() for performance. The parent is suspended until
    // the child calls exec or _exit, so we can detect exec failure via the
    // child's exit status without needing the self-pipe trick.
    // While POSIX restricts vfork children to only calling _exit() or exec*(),
    // Linux's vfork() is more permissive and allows the setup we need
    // (setsid, ioctl, dup2, etc.) before exec.
    volatile int child_errno = 0;
    pid_t child = vfork();
#else
    // On macOS, we must use fork() because vfork() is more strictly enforced.
    // This code path should only be used for PTY spawns on macOS.
    pid_t child = fork();
#endif

#if OS(DARWIN)
    const auto childFailed = [&]() -> ssize_t {
        int err = errno;
        // Write errno to pipe so parent can read it
        (void)write(errpipe[1], &err, sizeof(err));
        close(errpipe[1]);
        closeRangeOrLoop(0, INT_MAX, false);
        rawExit(127);

        // should never be reached
        return -1;
    };
#else
    const auto childFailed = [&]() -> ssize_t {
        // With vfork(), we share memory with the parent, so we can communicate
        // the error directly via a volatile variable. The parent will see this
        // value after we call _exit().
        child_errno = errno;
        rawExit(127);

        // should never be reached
        return -1;
    };
#endif

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
        rawExit(127);

        // should never be reached.
        return -1;
    };

    if (child == 0) {
#if OS(DARWIN)
        // Close read end in child
        close(errpipe[0]);
#endif
        return startChild();
    }

#if OS(DARWIN)
    // macOS fork() path: use self-pipe trick to detect exec failure
    // Parent: close write end
    close(errpipe[1]);

    if (child != -1) {
        // Try to read error from child. The pipe read end is blocking.
        // - If exec succeeds: write end closes due to O_CLOEXEC, read() returns 0
        // - If exec fails: child writes errno, then exits, read() returns sizeof(int)
        int child_err = 0;
        ssize_t n;

        // Retry read on EINTR - signals are blocked but some may still interrupt
        do {
            n = read(errpipe[0], &child_err, sizeof(child_err));
        } while (n == -1 && errno == EINTR);

        close(errpipe[0]);

        if (n == sizeof(child_err)) {
            // Child failed to exec - it wrote errno and exited
            // Reap the zombie child process
            waitpid(child, NULL, 0);
            res = child_err;
        } else if (n == 0) {
            // Exec succeeded (pipe closed with no data written)
            // Don't wait - the child is now running as a new process
            res = 0;
            if (pid) {
                *pid = child;
            }
        } else {
            // read() failed or partial read - something went wrong
            // Reap child and report error
            waitpid(child, NULL, 0);
            res = (n == -1) ? errno : EIO;
        }
    } else {
        // fork() failed
        close(errpipe[0]);
        res = errno;
    }
#else
    // Linux vfork() path: parent resumes after child calls exec or _exit
    // We can detect exec failure via the volatile child_errno variable
    if (child != -1) {
        if (child_errno != 0) {
            // Child failed to exec - it set child_errno and called _exit()
            // Reap the zombie child process
            wait4(child, NULL, 0, NULL);
            res = child_errno;
        } else {
            // Exec succeeded
            res = 0;
            if (pid) {
                *pid = child;
            }
        }
    } else {
        // vfork() failed
        res = errno;
    }
#endif

    sigprocmask(SIG_SETMASK, &oldmask, 0);
    pthread_setcancelstate(cs, 0);

    return res;
}

#endif
