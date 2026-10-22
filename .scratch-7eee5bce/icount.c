#define _GNU_SOURCE
#include <linux/perf_event.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>
// Counts the user-mode instructions of a command and its threads. Prints "ICOUNT n" on stderr.
int main(int argc, char** argv)
{
    struct perf_event_attr pe;
    memset(&pe, 0, sizeof pe);
    pe.type = PERF_TYPE_HARDWARE;
    pe.size = sizeof pe;
    pe.config = PERF_COUNT_HW_INSTRUCTIONS;
    pe.disabled = 1;
    pe.exclude_kernel = 1;
    pe.exclude_hv = 1;
    pe.inherit = 1;
    pe.enable_on_exec = 1;
    pid_t pid = fork();
    if (pid == 0) {
        raise(SIGSTOP);
        execvp(argv[1], argv + 1);
        _exit(127);
    }
    int status;
    waitpid(pid, &status, WUNTRACED);
    int fd = syscall(SYS_perf_event_open, &pe, pid, -1, -1, 0);
    if (fd < 0) {
        perror("perf_event_open");
        kill(pid, SIGKILL);
        return 1;
    }
    kill(pid, SIGCONT);
    waitpid(pid, &status, 0);
    uint64_t count = 0;
    if (read(fd, &count, sizeof count) != sizeof count)
        return 1;
    fprintf(stderr, "ICOUNT %llu\n", (unsigned long long)count);
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
