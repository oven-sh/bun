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
#define _GNU_SOURCE
#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <util.h>
#define PRELOAD_VAR "DYLD_INSERT_LIBRARIES"
#else
#include <pty.h>
#define PRELOAD_VAR "LD_PRELOAD"
#endif

#define EOT 4 // ^D: how a terminal says end-of-input

static volatile sig_atomic_t child_group;

static void on_terminate(int signal)
{
    (void)signal;
    if (child_group <= 0) return;
    // Its group, and the child itself in case it has not become the group's leader yet.
    kill(-(pid_t)child_group, SIGKILL);
    kill((pid_t)child_group, SIGKILL);
}

int main(int argc, char **argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: ptyrun <command> [args...]\n");
        return 2;
    }

    // Held back until there is a child to pass it on to.
    sigset_t terminate, before;
    sigemptyset(&terminate);
    sigaddset(&terminate, SIGTERM);
    sigprocmask(SIG_BLOCK, &terminate, &before);
    signal(SIGTERM, on_terminate);

    struct winsize window = { .ws_row = 24, .ws_col = 80 };
    int master = -1;
    pid_t child = forkpty(&master, NULL, NULL, &window);
    if (child < 0) {
        perror("forkpty");
        return 2;
    }
    if (child == 0) {
        sigprocmask(SIG_SETMASK, &before, NULL); // the mask survives exec
        const char *preload = getenv("PTYRUN_PRELOAD");
        if (preload && *preload) setenv(PRELOAD_VAR, preload, 1);
        execvp(argv[1], &argv[1]);
        perror(argv[1]);
        _exit(127);
    }
    child_group = child;
    sigprocmask(SIG_SETMASK, &before, NULL);

    // Drain the child's output — a full pty buffer would block it — and type
    // whatever arrives on our stdin into the terminal.
    char buffer[8192];
    struct pollfd fds[2] = { { .fd = master, .events = POLLIN }, { .fd = STDIN_FILENO, .events = POLLIN } };
    for (;;) {
        if (poll(fds, 2, -1) < 0) {
            if (errno == EINTR) continue;
            break;
        }
        if (fds[0].revents) {
            ssize_t n = read(master, buffer, sizeof buffer);
            if (n <= 0) break; // EIO once the child has closed its side
            if (write(STDOUT_FILENO, buffer, (size_t)n) < 0) break;
        }
        if (fds[1].revents) {
            ssize_t n = read(STDIN_FILENO, buffer, sizeof buffer);
            if (n > 0) {
                if (write(master, buffer, (size_t)n) < 0) break;
            } else {
                // Out of input. Closing the master instead would SIGHUP the child.
                char eof = EOT;
                fds[1].fd = -1;
                if (write(master, &eof, 1) < 0) break;
            }
        }
    }

    int status = 0;
    pid_t reaped = waitpid(child, &status, 0);
    child_group = 0; // the id is free to be someone else's now
    if (reaped < 0) {
        perror("waitpid");
        return 2;
    }
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
