#include "root.h"

#if OS(LINUX) || OS(DARWIN) || OS(FREEBSD)

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
#include <grp.h>
#include <atomic>
#include <errno.h>

#if OS(LINUX)
#include <sys/syscall.h>
#include <sys/prctl.h>
#endif

#if OS(DARWIN)
#include <libproc.h>
#endif

extern char** environ;

#ifndef CLOSE_RANGE_CLOEXEC
#define CLOSE_RANGE_CLOEXEC (1U << 2)
#endif

#if OS(LINUX)
extern "C" ssize_t bun_close_range(unsigned int start, unsigned int end, unsigned int flags);
#endif

// Highest open fd in this process, or -1 if the scan is unusable.
extern "C" int bun_highest_open_fd()
{
#if OS(LINUX)
    int dir = open("/proc/self/fd", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dir < 0) return -1;
    struct linux_dirent64 {
        uint64_t d_ino;
        int64_t d_off;
        uint16_t d_reclen;
        uint8_t d_type;
        char d_name[];
    };
    alignas(linux_dirent64) char buf[4096];
    int highest = -1;
    for (;;) {
        long n = syscall(SYS_getdents64, dir, buf, sizeof(buf));
        if (n <= 0) break;
        for (long off = 0; off < n;) {
            auto* ent = reinterpret_cast<linux_dirent64*>(buf + off);
            off += ent->d_reclen;
            const char* p = ent->d_name;
            if (*p < '0' || *p > '9') continue;
            int fd = 0;
            while (*p >= '0' && *p <= '9')
                fd = fd * 10 + (*p++ - '0');
            if (*p != '\0') continue;
            if (fd > highest) highest = fd;
        }
    }
    close(dir);
    return (highest < dir) ? -1 : highest;
#elif OS(DARWIN)
    int n = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, nullptr, 0);
    if (n <= 0) return -1;
    n += 32 * (int)sizeof(struct proc_fdinfo);
    struct proc_fdinfo* fds = (struct proc_fdinfo*)malloc(n);
    if (!fds) return -1;
    n = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, fds, n);
    int highest = -1;
    for (int i = 0; i < n / (int)sizeof(struct proc_fdinfo); i++)
        if (fds[i].proc_fd > highest) highest = fds[i].proc_fd;
    free(fds);
    return highest;
#else
    return -1;
#endif
}

#if OS(LINUX)
// Cached close_range(2) capability. The (~0U, ~0U) probe is a no-op range
// above any fd table: 5.11+ -> 0, 5.9/5.10 -> EINVAL (flag), <5.9 -> ENOSYS.
enum : int { kCloseRangeUnknown = 0,
    kCloseRangeCloexec = 1,
    kCloseRangePlain = 2,
    kCloseRangeNone = 3 };
static std::atomic<int> s_closeRangeCapability { kCloseRangeUnknown };

static int closeRangeCapability()
{
    int cap = s_closeRangeCapability.load(std::memory_order_relaxed);
    if (cap != kCloseRangeUnknown) return cap;
    if (bun_close_range(~0U, ~0U, CLOSE_RANGE_CLOEXEC) == 0)
        cap = kCloseRangeCloexec;
    else if (errno != EINVAL)
        cap = kCloseRangeNone;
    else if (bun_close_range(~0U, ~0U, 0) == 0)
        cap = kCloseRangePlain;
    else
        cap = kCloseRangeNone;
    s_closeRangeCapability.store(cap, std::memory_order_relaxed);
    return cap;
}
#endif

// Loop-based fallback. open_fd_hint (-1 = unknown) bounds this best-effort
// sweep at the parent's highest open fd; Bun-owned fds are O_CLOEXEC already.
static inline void closeRangeLoop(int start, int end, bool cloexec_only, int open_fd_hint)
{
    int maxfd;
    if (open_fd_hint >= 0) {
        maxfd = open_fd_hint + 1;
    } else {
#if OS(LINUX)
        maxfd = static_cast<int>(sysconf(_SC_OPEN_MAX));
#else
        maxfd = getdtablesize();
#endif
        if (maxfd < 0 || maxfd > 65536) maxfd = 65536;
    }
    if (end >= start && end < INT_MAX)
        maxfd = std::min(maxfd, end + 1);
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

// kCloseRangePlain closes outright even when cloexec_only: the vfork child
// is about to exec, so the effect is the same and Linux uses no errpipe.
static inline void closeRangeOrLoop(int start, int end, bool cloexec_only, int cap, int open_fd_hint)
{
#if OS(LINUX)
    if (cap == kCloseRangeCloexec) {
        if (bun_close_range(start, end, cloexec_only ? CLOSE_RANGE_CLOEXEC : 0) == 0)
            return;
    } else if (cap == kCloseRangePlain) {
        if (bun_close_range(start, end, 0) == 0)
            return;
    }
#else
    (void)cap;
#endif
    closeRangeLoop(start, end, cloexec_only, open_fd_hint);
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
    bool new_process_group; // setpgid(0, 0) so kill(-pid, sig) reaches descendants
    bun_spawn_file_action_list_t actions;
    int pty_slave_fd; // -1 if not using PTY, otherwise the slave fd to set as controlling terminal
    int linux_pdeathsig; // 0 = unset; otherwise signal delivered to child when parent thread dies
    uint32_t uid; // setuid(uid) in the child before exec when set_uid is true
    uint32_t gid; // setgid(gid) in the child before exec when set_gid is true
    bool set_uid;
    bool set_gid;
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

    // Resolve the fd-sweep strategy in the parent: opendir/readdir are not
    // async-signal-safe, so the forked child must not call them.
#if OS(LINUX)
    const int close_range_cap = closeRangeCapability();
    const int open_fd_hint = (close_range_cap == kCloseRangeNone) ? bun_highest_open_fd() : -1;
#else
    const int close_range_cap = 0;
    const int open_fd_hint = bun_highest_open_fd();
#endif

#if OS(DARWIN) || OS(FREEBSD)
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
#if !OS(ANDROID)
    pthread_setcancelstate(PTHREAD_CANCEL_DISABLE, &cs);
#endif

#if OS(LINUX)
    // On Linux, use vfork() for performance. The parent is suspended until
    // the child calls exec or _exit, so we can detect exec failure via the
    // child's exit status without needing the self-pipe trick.
    // While POSIX restricts vfork children to only calling _exit() or exec*(),
    // Linux's vfork() is more permissive and allows the setup we need
    // (setsid, ioctl, dup2, etc.) before exec.
    volatile int child_errno = 0;
    // The vfork child shares this mm, and set*id in the child resets the
    // mm-wide "dumpable" flag to /proc/sys/fs/suid_dumpable (commit_creds).
    // Save it so the parent can restore it once vfork returns, like Go's
    // forkAndExecInChild1 and systemd's safe_fork_full do.
    int saved_dumpable = (request->set_uid || request->set_gid) ? prctl(PR_GET_DUMPABLE, 0, 0, 0, 0) : -1;
    pid_t child = vfork();
#else
    // On macOS, we must use fork() because vfork() is more strictly enforced.
    // This code path should only be used for PTY spawns on macOS.
    pid_t child = fork();
#endif

#if OS(DARWIN) || OS(FREEBSD)
    const auto childFailed = [&]() -> ssize_t {
        int err = errno;
        // Write errno to pipe so parent can read it
        (void)write(errpipe[1], &err, sizeof(err));
        close(errpipe[1]);
        closeRangeOrLoop(0, INT_MAX, false, close_range_cap, open_fd_hint);
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
        } else if (request->new_process_group) {
            setpgid(0, 0);
        }

#if OS(LINUX)
        // PR_SET_PDEATHSIG persists across exec, so any executable inherits it.
        // Under vfork the parent is suspended, so there is no race between
        // vfork returning and this prctl taking effect.
        if (request->linux_pdeathsig != 0) {
            prctl(PR_SET_PDEATHSIG, request->linux_pdeathsig, 0, 0, 0);
        }
#endif

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

        // libuv order: setgroups (best-effort) -> setgid -> setuid, just before exec.
        // Linux MUST use raw syscalls here: this is a vfork child sharing the parent's
        // memory, and glibc's set*id wrappers broadcast SIGSETXID to every (parent) thread.
        if (request->set_uid || request->set_gid) {
            int savedErrno = errno;
#if OS(LINUX)
            (void)syscall(SYS_setgroups, 0, (const gid_t*)NULL);
#else
            (void)setgroups(0, NULL);
#endif
            errno = savedErrno;
        }

#if OS(LINUX)
        if (request->set_gid && syscall(SYS_setgid, (gid_t)request->gid) != 0) {
            return childFailed();
        }
        if (request->set_uid && syscall(SYS_setuid, (uid_t)request->uid) != 0) {
            return childFailed();
        }
        // The kernel clears PR_SET_PDEATHSIG when the effective uid/gid changes
        // (prctl(2)), so re-arm it after dropping credentials.
        if (request->linux_pdeathsig != 0 && (request->set_uid || request->set_gid)) {
            prctl(PR_SET_PDEATHSIG, request->linux_pdeathsig, 0, 0, 0);
        }
#else
        if (request->set_gid && setgid((gid_t)request->gid) != 0) {
            return childFailed();
        }
        if (request->set_uid && setuid((uid_t)request->uid) != 0) {
            return childFailed();
        }
#endif

        sigprocmask(SIG_SETMASK, &childmask, 0);
        if (!envp)
            envp = environ;

        // Close all fds > current_max_fd, preferring cloexec if available
        closeRangeOrLoop(current_max_fd + 1, INT_MAX, true, close_range_cap, open_fd_hint);

        if (execve(path, argv, envp) == -1) {
            return childFailed();
        }
        rawExit(127);

        // should never be reached.
        return -1;
    };

    if (child == 0) {
#if OS(DARWIN) || OS(FREEBSD)
        // Close read end in child
        close(errpipe[0]);
#endif
        return startChild();
    }

#if OS(DARWIN) || OS(FREEBSD)
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

    // PR_SET_DUMPABLE only accepts SUID_DUMP_DISABLE (0) / SUID_DUMP_USER (1);
    // a saved value of 2 (suid_dumpable=2) means it was already the reset value.
    if (saved_dumpable == 0 || saved_dumpable == 1) {
        (void)prctl(PR_SET_DUMPABLE, saved_dumpable, 0, 0, 0);
    }
#endif

    sigprocmask(SIG_SETMASK, &oldmask, 0);
#if !OS(ANDROID)
    pthread_setcancelstate(cs, 0);
#else
    (void)cs;
#endif

    return res;
}

#endif
