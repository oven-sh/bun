// Counts the instructions that the main thread of a program executes between two marker
// system calls: pread64(fd, buf, 1, 987654321) starts the count, pread64(fd, buf, 1, 987654322) stops it.
// Usage: icstep <program> [args...]   (prints one number per start/stop pair)
#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/ptrace.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>

#define START 987654321
#define STOP 987654322

int main(int argc, char** argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: icstep <program> [args...]\n");
        return 2;
    }
    pid_t pid = fork();
    if (pid == 0) {
        ptrace(PTRACE_TRACEME, 0, 0, 0);
        raise(SIGSTOP);
        execvp(argv[1], argv + 1);
        perror("execvp");
        _exit(127);
    }
    int status;
    waitpid(pid, &status, 0);
    ptrace(PTRACE_SETOPTIONS, pid, 0, PTRACE_O_TRACESYSGOOD | PTRACE_O_EXITKILL);

    int counting = 0;
    unsigned long long count = 0;
    int sig = 0;
    for (;;) {
        if (ptrace(counting ? PTRACE_SINGLESTEP : PTRACE_SYSCALL, pid, 0, sig) < 0) {
            perror("ptrace");
            return 1;
        }
        sig = 0;
        if (waitpid(pid, &status, 0) < 0) {
            perror("waitpid");
            return 1;
        }
        if (WIFEXITED(status) || WIFSIGNALED(status))
            break;
        if (!WIFSTOPPED(status))
            continue;
        int stopsig = WSTOPSIG(status);
        struct user_regs_struct regs;
        if (counting) {
            if (stopsig != SIGTRAP) {
                sig = stopsig;
                continue;
            }
            count++;
            ptrace(PTRACE_GETREGS, pid, 0, &regs);
            if ((long long)regs.orig_rax == SYS_pread64 && regs.r10 == STOP) {
                printf("%llu\n", count);
                fflush(stdout);
                counting = 0;
                count = 0;
            }
        } else {
            if (stopsig == (SIGTRAP | 0x80)) {
                ptrace(PTRACE_GETREGS, pid, 0, &regs);
                if ((long long)regs.orig_rax == SYS_pread64 && regs.r10 == START && (long long)regs.rax != -ENOSYS)
                    counting = 1;
            } else if (stopsig != SIGTRAP) {
                sig = stopsig;
            }
        }
    }
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
