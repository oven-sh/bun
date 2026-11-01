// Counts user instructions, user cycles and page faults of a command: for its main thread alone and for all threads.
// Usage: pcount <cmd> [args...]  -> one JSON line on stderr
#define _GNU_SOURCE
#include <linux/perf_event.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

static int open_counter(pid_t pid, uint32_t type, uint64_t config, int inherit)
{
    struct perf_event_attr attr;
    memset(&attr, 0, sizeof(attr));
    attr.type = type;
    attr.size = sizeof(attr);
    attr.config = config;
    attr.disabled = 1;
    attr.exclude_kernel = 1;
    attr.exclude_hv = 1;
    attr.inherit = inherit;
    attr.enable_on_exec = 1;
    return (int)syscall(SYS_perf_event_open, &attr, pid, -1, -1, 0);
}

int main(int argc, char** argv)
{
    int gate[2];
    if (argc < 2 || pipe(gate) != 0) return 2;
    pid_t pid = fork();
    if (pid == 0) {
        char byte;
        close(gate[1]);
        read(gate[0], &byte, 1);
        close(gate[0]);
        execvp(argv[1], argv + 1);
        _exit(127);
    }
    const char* names[6] = { "js_instructions", "js_cycles", "js_faults", "all_instructions", "all_cycles", "all_faults" };
    int fds[6];
    for (int i = 0; i < 6; i++) {
        int inherit = i >= 3;
        int which = i % 3;
        fds[i] = which == 2 ? open_counter(pid, PERF_TYPE_SOFTWARE, PERF_COUNT_SW_PAGE_FAULTS, inherit)
                            : open_counter(pid, PERF_TYPE_HARDWARE, which == 0 ? PERF_COUNT_HW_INSTRUCTIONS : PERF_COUNT_HW_CPU_CYCLES, inherit);
        if (fds[i] < 0) { perror("perf_event_open"); kill(pid, 9); return 2; }
    }
    close(gate[0]);
    write(gate[1], "x", 1);
    close(gate[1]);
    int status = 0;
    waitpid(pid, &status, 0);
    fprintf(stderr, "{");
    for (int i = 0; i < 6; i++) {
        uint64_t count = 0;
        read(fds[i], &count, sizeof(count));
        fprintf(stderr, "%s\"%s\":%llu", i ? "," : "", names[i], (unsigned long long)count);
    }
    fprintf(stderr, "}\n");
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
