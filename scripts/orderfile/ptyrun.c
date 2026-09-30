// Runs a command on a pseudo-terminal, used by scripts/orderfile/generate.ts.
//
// bun takes a different path on a terminal than on a pipe — isatty, TIOCGWINSZ,
// raw mode, readline's line editor and its cursor escapes — and nothing but a
// real pty reaches it. So one workload runs under this.
//
//   cc -O2 -o ptyrun ptyrun.c -lutil
//   printf 'hi\n' | ./ptyrun bun cli.js
//
// Our stdin is typed into the terminal and the child's output is forwarded to
// ours, so a workload looks the same to the caller either way. Exits with the
// child's status.
//
// PTYRUN_PRELOAD becomes the child's LD_PRELOAD (DYLD_INSERT_LIBRARIES on
// macOS). The tracer belongs in the binary being traced and nowhere else, and
// it drops itself from the environment once loaded, so it is handed down here
// rather than inherited.
//
// The child leads a session of its own, so a signal sent to our process group
// does not reach it, and a child that ignores SIGHUP outlives us. SIGTERM is
// how the generator stops a run: it becomes SIGKILL for the child's process
// group, and we exit once the child has.
//
// We are done when the child is, not when the terminal closes: a descendant
// that left the child's session (setsid, a daemon) may hold the terminal open
// for as long as it likes. On linux we adopt such descendants and kill them
// on the way out; elsewhere they are left running.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#if defined(__linux__)
#include <dirent.h>
#include <sys/prctl.h>
#endif
#if defined(__APPLE__)
#include <util.h>
#define PRELOAD_VAR "DYLD_INSERT_LIBRARIES"
#else
#include <pty.h>
#define PRELOAD_VAR "LD_PRELOAD"
#endif

#define EOT 4 // ^D: how a terminal says end-of-input

// How long leaving may take once we were told to stop, or have to leave without
// the child having exited. Less than the generator gives us before its SIGKILL.
#define LEAVE_GRACE_S 1
#define LEAVE_GRACE_MS (LEAVE_GRACE_S * 1000)

static volatile sig_atomic_t child_group;
static volatile sig_atomic_t stopping;
static long long stop_deadline; // written by on_terminate before `stopping`, read by main after it
static int wake[2]; // written by the signal handlers, polled by main

/** For a write whose failure changes nothing: the child's exit is what ends us, not the terminal's. */
static void ignore(ssize_t result)
{
    (void)result;
}

static long long now_ms(void)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return now.tv_sec * 1000LL + now.tv_nsec / 1000000;
}

static void kill_child(void)
{
    if (child_group <= 0) return;
    // Its group, and the child itself in case it has not become the group's leader yet.
    kill(-(pid_t)child_group, SIGKILL);
    kill((pid_t)child_group, SIGKILL);
}

static void on_terminate(int signal)
{
    (void)signal;
    int saved = errno;
    // The grace runs from here, not from when main gets to notice: we may have
    // arrived just before main entered a write that then blocks, with no signal
    // left to interrupt it. SIGALRM is that signal, when the grace is over.
    if (!stopping) stop_deadline = now_ms() + LEAVE_GRACE_MS;
    stopping = 1;
    kill_child();
    alarm(LEAVE_GRACE_S);
    ignore(write(wake[1], "", 1));
    errno = saved;
}

/** SIGCHLD and SIGALRM: main looks at what happened, once it is out of whatever it was blocked in. */
static void on_wake(int signal)
{
    int saved = errno;
    // Again and again: main may not have been in the write yet that this one was for.
    if (signal == SIGALRM && stopping) alarm(LEAVE_GRACE_S);
    ignore(write(wake[1], "", 1)); // full means main has plenty to wake up for
    errno = saved;
}

/**
 * write(2) until all of it is written. The handlers are not restarted, so a
 * SIGCHLD in the middle of a blocked write is an EINTR or a short count, and
 * what was read from the terminal must not be lost to it. Gives up once we are
 * told to stop: nobody reads a stopped run's output, and its reader may be the
 * one stopping us.
 */
static int write_all(int fd, const char *bytes, size_t size)
{
    while (size > 0 && !stopping) {
        ssize_t n = write(fd, bytes, size);
        if (n < 0 && errno != EINTR) return -1;
        if (n > 0) {
            bytes += n;
            size -= (size_t)n;
        }
    }
    return 0;
}

/** Waits for a signal handler to have written to `wake`, until `deadline`. */
static void wait_for_signal(long long deadline)
{
    struct pollfd fd = { .fd = wake[0], .events = POLLIN };
    long long left = deadline - now_ms();
    char buffer[64];
    if (left > 0 && poll(&fd, 1, (int)left) > 0) ignore(read(wake[0], buffer, sizeof buffer));
}

#if defined(__linux__)
/**
 * Kills and reaps everything we adopted as a subreaper: what the child started
 * and left behind, in whatever session. Whatever those leave behind is adopted
 * in turn, so this goes round until we have no children left, or `deadline`;
 * once whatever is left of the deadline, so that what we adopted is at least
 * told to go.
 */
static void kill_adopted(long long deadline)
{
    // Only if /proc is this pid namespace's: in another's, the numbers are other processes.
    int self = (int)getpid(), proc_self = 0;
    FILE *own = fopen("/proc/self/stat", "r");
    if (own) {
        if (fscanf(own, "%d", &proc_self) != 1) proc_self = 0;
        fclose(own);
    }
    if (proc_self != self) return;
    do {
        DIR *proc = opendir("/proc");
        if (!proc) return;
        struct dirent *entry;
        while ((entry = readdir(proc))) {
            pid_t pid = (pid_t)atoi(entry->d_name);
            if (pid <= 0) continue;
            char path[64], stat[512];
            snprintf(path, sizeof path, "/proc/%d/stat", (int)pid);
            int fd = open(path, O_RDONLY | O_CLOEXEC);
            if (fd < 0) continue;
            ssize_t n = read(fd, stat, sizeof stat - 1);
            close(fd);
            if (n <= 0) continue;
            stat[n] = 0;
            // "pid (comm) state ppid …", and comm may itself hold spaces and parentheses.
            char *comm_end = strrchr(stat, ')');
            int parent;
            if (comm_end && sscanf(comm_end + 1, " %*c %d", &parent) == 1 && parent == self) kill(pid, SIGKILL);
        }
        closedir(proc);
        // Every one that is ready, so that a workload's many orphans cost one scan and not one each.
        pid_t done;
        while ((done = waitpid(-1, NULL, WNOHANG)) > 0) {
        }
        if (done < 0) return; // ECHILD: none left
        wait_for_signal(deadline);
    } while (now_ms() < deadline);
}
#endif

int main(int argc, char **argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: ptyrun <command> [args...]\n");
        return 2;
    }

    if (pipe(wake) != 0) {
        perror("pipe");
        return 2;
    }
    for (int i = 0; i < 2; i++) {
        fcntl(wake[i], F_SETFL, O_NONBLOCK);
        fcntl(wake[i], F_SETFD, FD_CLOEXEC);
    }
#if defined(__linux__)
    prctl(PR_SET_CHILD_SUBREAPER, 1);
#endif

    // Not restarted: a handler has to be able to get main out of a read or a
    // write. SIGTERM is held back until there is a child to pass it on to.
    struct sigaction action;
    memset(&action, 0, sizeof action);
    sigemptyset(&action.sa_mask);
    sigset_t terminate, before;
    sigemptyset(&terminate);
    sigaddset(&terminate, SIGTERM);
    sigprocmask(SIG_BLOCK, &terminate, &before);
    action.sa_handler = on_terminate;
    sigaction(SIGTERM, &action, NULL);
    action.sa_handler = on_wake;
    sigaction(SIGCHLD, &action, NULL);
    sigaction(SIGALRM, &action, NULL);
    // A reader that went away is an EPIPE to leave by, like any other reason: not
    // a death that skips the child and what it left behind.
    signal(SIGPIPE, SIG_IGN);

    struct winsize window = { .ws_row = 24, .ws_col = 80 };
    int master = -1;
    pid_t child = forkpty(&master, NULL, NULL, &window);
    if (child < 0) {
        perror("forkpty");
        return 2;
    }
    if (child == 0) {
        sigprocmask(SIG_SETMASK, &before, NULL); // the mask survives exec
        signal(SIGPIPE, SIG_DFL); // and so does an ignored signal
        const char *preload = getenv("PTYRUN_PRELOAD");
        if (preload && *preload) setenv(PRELOAD_VAR, preload, 1);
        execvp(argv[1], &argv[1]);
        perror(argv[1]);
        _exit(127);
    }
    child_group = child;
    sigprocmask(SIG_SETMASK, &before, NULL);

    // Drain the child's output — a full pty buffer would block it — and type
    // whatever arrives on our stdin into the terminal, until the child is gone.
    char buffer[8192];
    struct pollfd fds[3] = { { .fd = master, .events = POLLIN },
        { .fd = STDIN_FILENO, .events = POLLIN },
        { .fd = wake[0], .events = POLLIN } };
    int status = 0;
    int reaped = 0;
    long long deadline = 0; // none until we are told to stop
    while (!reaped) {
        if (stopping) deadline = stop_deadline;
        if (deadline && now_ms() >= deadline) break; // a child that SIGKILL has not ended is not worth waiting for
        long long left = deadline ? deadline - now_ms() : -1;
        int ready = poll(fds, 3, deadline && left < 0 ? 0 : (int)left);
        if (ready < 0 && errno != EINTR) break;
        if (ready <= 0) continue;
        if (fds[0].revents) {
            ssize_t n = read(master, buffer, sizeof buffer);
            if (n > 0) {
                if (write_all(STDOUT_FILENO, buffer, (size_t)n) != 0) break;
            } else if (n == 0 || errno != EINTR) {
                // EIO once every holder of the terminal has closed it, which is not ours to wait for.
                fds[0].fd = -1;
            }
        }
        if (fds[1].revents) {
            ssize_t n = read(STDIN_FILENO, buffer, sizeof buffer);
            if (n > 0) {
                if (write_all(master, buffer, (size_t)n) != 0) fds[1].fd = -1;
            } else if (n == 0 || errno != EINTR) {
                // Out of input. Closing the master instead would SIGHUP the child.
                char eof = EOT;
                fds[1].fd = -1;
                ignore(write(master, &eof, 1));
            }
        }
        if (fds[2].revents) {
            ignore(read(wake[0], buffer, sizeof buffer));
            pid_t done = waitpid(child, &status, WNOHANG);
            if (done == child) reaped = 1;
            else if (done < 0) break;
        }
    }

    // Leaving for any other reason than the child's exit: it does not outlive us.
    deadline = stopping ? stop_deadline : now_ms() + LEAVE_GRACE_MS;
    if (!reaped) {
        kill_child();
        while (!reaped && now_ms() < deadline) {
            if (waitpid(child, &status, WNOHANG) == child) reaped = 1;
            else wait_for_signal(deadline);
        }
    }
    child_group = 0; // the id is free to be someone else's now

    // What the child wrote last is still in the terminal. Only what is there
    // now: a descendant may go on writing for as long as it lives.
    fcntl(master, F_SETFL, O_NONBLOCK);
    for (size_t drained = 0; !stopping && drained < (1u << 20);) {
        ssize_t n = read(master, buffer, sizeof buffer);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0 || write_all(STDOUT_FILENO, buffer, (size_t)n) != 0) break;
        drained += (size_t)n;
    }
#if defined(__linux__)
    // A grace of its own when there is time: the drain above may have waited on a slow reader.
    kill_adopted(stopping ? stop_deadline : now_ms() + LEAVE_GRACE_MS);
#endif
    // A child we had to kill was signaled, and one that is still there has no status.
    return reaped && WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
