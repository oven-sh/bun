#include "root.h"

#if OS(LINUX)

#include <fcntl.h>
#include <cstring>
#include <signal.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <sys/fcntl.h>
#include <sys/signal.h>
#include <sys/syscall.h>
#include <sys/resource.h>

extern char** environ;

#ifndef CLOSE_RANGE_CLOEXEC
#define CLOSE_RANGE_CLOEXEC (1U << 2)
#endif

extern "C" ssize_t bun_close_range(unsigned int start, unsigned int end, unsigned int flags);

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
    pid_t child = vfork();

    const auto childFailed = [&]() -> ssize_t {
        res = errno;
        status = res;
        bun_close_range(0, ~0U, 0);
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

        // Make "detached" work
        if (request->detached) {
            setsid();
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

        if (bun_close_range(current_max_fd + 1, ~0U, CLOSE_RANGE_CLOEXEC) != 0) {
            bun_close_range(current_max_fd + 1, ~0U, 0);
        }
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