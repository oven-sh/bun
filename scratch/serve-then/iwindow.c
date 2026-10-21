// iwindow: count the user-space instructions that the main thread of a program executes
// between the entry of a function and the return of that call.
//
//   iwindow <entry-addr-hex> <first-hit> <last-hit> -- cmd args...
//
// For hits first..last of the entry address it prints "WINDOW hit=<n> instructions=<count>".
// Method: ptrace breakpoints at the entry and at the return address of that activation, and a
// perf_event_open(PERF_COUNT_HW_INSTRUCTIONS, exclude_kernel) counter on the main thread that is
// enabled only inside the window. The program runs at full speed inside the window.
// The binary must not be PIE (addresses are used as they are in the file).
#define _GNU_SOURCE
#include <errno.h>
#include <linux/perf_event.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/ptrace.h>
#include <sys/syscall.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>

static pid_t child;
static int pending_sig;

static void die(const char* what)
{
    fprintf(stderr, "iwindow: %s: %s\n", what, strerror(errno));
    if (child > 0)
        kill(child, SIGKILL);
    exit(2);
}
static long peek(unsigned long addr)
{
    errno = 0;
    long v = ptrace(PTRACE_PEEKTEXT, child, (void*)addr, 0);
    if (errno)
        die("PEEKTEXT");
    return v;
}
static void poke(unsigned long addr, long v)
{
    if (ptrace(PTRACE_POKETEXT, child, (void*)addr, (void*)v) < 0)
        die("POKETEXT");
}
static void set_bp(unsigned long addr, long* saved)
{
    *saved = peek(addr);
    poke(addr, (*saved & ~0xffL) | 0xcc);
}
static void cont(void)
{
    int sig = pending_sig;
    pending_sig = 0;
    if (ptrace(PTRACE_CONT, child, 0, (void*)(long)sig) < 0)
        die("CONT");
}
// Returns 0 when the child is gone.
static int wait_stop(int* sig)
{
    int st;
    while (waitpid(child, &st, 0) < 0) {
        if (errno != EINTR)
            die("waitpid");
    }
    if (WIFEXITED(st) || WIFSIGNALED(st)) {
        fprintf(stderr, "WINDOW exit status=%d\n", WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st));
        return 0;
    }
    *sig = WSTOPSIG(st);
    return 1;
}
static void step_over(void)
{
    for (;;) {
        int sig = pending_sig;
        pending_sig = 0;
        if (ptrace(PTRACE_SINGLESTEP, child, 0, (void*)(long)sig) < 0)
            die("SINGLESTEP");
        if (!wait_stop(&sig))
            exit(0);
        if (sig == SIGTRAP)
            return;
        pending_sig = sig;
    }
}

int main(int argc, char** argv)
{
    if (argc < 6 || strcmp(argv[4], "--")) {
        fprintf(stderr, "usage: iwindow <entry-addr-hex> <first-hit> <last-hit> -- cmd args...\n");
        return 2;
    }
    unsigned long entry = strtoul(argv[1], 0, 16);
    long first = atol(argv[2]), last = atol(argv[3]);

    child = fork();
    if (child < 0)
        die("fork");
    if (child == 0) {
        ptrace(PTRACE_TRACEME, 0, 0, 0);
        execvp(argv[5], argv + 5);
        perror("exec");
        _exit(127);
    }
    int sig;
    if (!wait_stop(&sig))
        return 2;

    struct perf_event_attr pe;
    memset(&pe, 0, sizeof(pe));
    pe.type = PERF_TYPE_HARDWARE;
    pe.size = sizeof(pe);
    pe.config = PERF_COUNT_HW_INSTRUCTIONS;
    pe.disabled = 1;
    pe.exclude_kernel = 1;
    pe.exclude_hv = 1;
    int fd = syscall(SYS_perf_event_open, &pe, child, -1, -1, 0);
    if (fd < 0)
        die("perf_event_open");

    long saved_entry = 0, saved_ret = 0;
    unsigned long ret_addr = 0, entry_rsp = 0;
    long hit = 0;
    int measuring = 0;
    set_bp(entry, &saved_entry);
    cont();

    for (;;) {
        if (!wait_stop(&sig))
            break;
        if (sig != SIGTRAP) {
            pending_sig = sig;
            cont();
            continue;
        }
        struct user_regs_struct regs;
        if (ptrace(PTRACE_GETREGS, child, 0, &regs) < 0)
            die("GETREGS");
        if (!measuring && regs.rip - 1 == entry && hit < last) {
            hit++;
            poke(entry, saved_entry);
            regs.rip = entry;
            if (ptrace(PTRACE_SETREGS, child, 0, &regs) < 0)
                die("SETREGS");
            if (hit >= first) {
                entry_rsp = regs.rsp;
                ret_addr = (unsigned long)peek(regs.rsp);
                set_bp(ret_addr, &saved_ret);
                measuring = 1;
                ioctl(fd, PERF_EVENT_IOC_RESET, 0);
                ioctl(fd, PERF_EVENT_IOC_ENABLE, 0);
            } else {
                step_over();
                set_bp(entry, &saved_entry);
            }
            cont();
        } else if (measuring && regs.rip - 1 == ret_addr) {
            if (regs.rsp != entry_rsp + 8) {
                // Another activation that returns to the same address: step over it.
                poke(ret_addr, saved_ret);
                regs.rip = ret_addr;
                if (ptrace(PTRACE_SETREGS, child, 0, &regs) < 0)
                    die("SETREGS");
                step_over();
                set_bp(ret_addr, &saved_ret);
                cont();
                continue;
            }
            ioctl(fd, PERF_EVENT_IOC_DISABLE, 0);
            uint64_t count = 0;
            if (read(fd, &count, sizeof(count)) != sizeof(count))
                die("read counter");
            poke(ret_addr, saved_ret);
            regs.rip = ret_addr;
            if (ptrace(PTRACE_SETREGS, child, 0, &regs) < 0)
                die("SETREGS");
            measuring = 0;
            fprintf(stderr, "WINDOW hit=%ld instructions=%llu\n", hit, (unsigned long long)count);
            if (hit < last)
                set_bp(entry, &saved_entry);
            cont();
        } else {
            cont();
        }
    }
    return 0;
}
