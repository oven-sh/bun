// LD_PRELOAD page-fault tracer used by scripts/orderfile/generate.ts.
//
// mprotect(PROT_NONE)s the traced executable's text+rodata mappings, then
// unprotects exactly one page per SIGSEGV. The faulting pages are the pages
// the program really executes/reads, with none of the kernel's fault-around
// speculation (which maps 16 pages per fault and is what makes bun's RSS
// ~3x its true working set).
//
// The record is streamed into an mmap(MAP_SHARED) window over the output file
// so it survives whatever exit path the traced program takes — bun does not
// run atexit handlers. Layout: u64 count, then `count` u64 page addresses in
// first-touch order.
//
//   cc -O2 -shared -fPIC -o pagetrace.so pagetrace.c -ldl
//   BUN_PAGETRACE_BIN=build/release/bun-profile \
//   BUN_PAGETRACE_OUT=/tmp/trace.bin \
//   LD_PRELOAD=./pagetrace.so build/release/bun-profile -e 'console.log(1)'
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

#define MAX_REGIONS 8
#define MAX_HITS (1 << 20)

static struct {
    uintptr_t start, end;
} regions[MAX_REGIONS];
static int region_count = 0;
static uint64_t *record = NULL; // record[0] = count, record[1..] = page addresses
static int armed = 0;

static int in_traced_region(uintptr_t page)
{
    for (int i = 0; i < region_count; i++)
        if (page >= regions[i].start && page < regions[i].end) return 1;
    return 0;
}

static void on_fault(int sig, siginfo_t *si, void *ucontext)
{
    (void)sig;
    (void)ucontext;
    uintptr_t page = (uintptr_t)si->si_addr & ~(uintptr_t)0xfff;
    if (!in_traced_region(page)) {
        // Not ours: restore the default handler and let the real crash happen.
        signal(SIGSEGV, SIG_DFL);
        return;
    }
    uint64_t n = record[0];
    if (n < MAX_HITS - 1) {
        record[1 + n] = page;
        record[0] = n + 1;
    }
    mprotect((void *)page, 4096, PROT_READ | PROT_EXEC);
}

// Bun installs its own SIGSEGV/SIGBUS handlers (crash reporter, JIT traps).
// Swallow those registrations while tracing so ours stays in place.
typedef int (*sigaction_fn)(int, const struct sigaction *, struct sigaction *);

int sigaction(int signum, const struct sigaction *act, struct sigaction *old)
{
    static sigaction_fn real = NULL;
    if (!real) real = (sigaction_fn)dlsym(RTLD_NEXT, "sigaction");
    if (armed && (signum == SIGSEGV || signum == SIGBUS)) {
        if (old) memset(old, 0, sizeof(*old));
        return 0;
    }
    return real(signum, act, old);
}

__attribute__((constructor(101))) static void pagetrace_init(void)
{
    const char *binary = getenv("BUN_PAGETRACE_BIN");
    const char *out = getenv("BUN_PAGETRACE_OUT");
    if (!binary || !out) return;

    int fd = open(out, O_CREAT | O_TRUNC | O_RDWR, 0644);
    if (fd < 0) return;
    if (ftruncate(fd, (off_t)MAX_HITS * 8) != 0) {
        close(fd);
        return;
    }
    record = mmap(NULL, (size_t)MAX_HITS * 8, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (record == MAP_FAILED) {
        record = NULL;
        return;
    }

    FILE *maps = fopen("/proc/self/maps", "r");
    if (!maps) return;
    char line[1024];
    while (fgets(line, sizeof line, maps)) {
        unsigned long start, end;
        char perms[8], path[768];
        path[0] = 0;
        if (sscanf(line, "%lx-%lx %7s %*s %*s %*s %767s", &start, &end, perms, path) < 4) continue;
        if (!strstr(path, binary)) continue;
        int executable = perms[2] == 'x';
        int read_only = perms[0] == 'r' && perms[1] == '-' && perms[2] == '-';
        if ((executable || read_only) && region_count < MAX_REGIONS) {
            regions[region_count].start = start;
            regions[region_count].end = end;
            region_count++;
        }
    }
    fclose(maps);
    if (!region_count) return;

    static char altstack[256 * 1024];
    stack_t ss = { .ss_sp = altstack, .ss_size = sizeof altstack, .ss_flags = 0 };
    sigaltstack(&ss, NULL);

    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_sigaction = on_fault;
    sa.sa_flags = SA_SIGINFO | SA_ONSTACK | SA_NODEFER;
    sigemptyset(&sa.sa_mask);
    sigaction_fn real = (sigaction_fn)dlsym(RTLD_NEXT, "sigaction");
    real(SIGSEGV, &sa, NULL);
    real(SIGBUS, &sa, NULL);

    armed = 1;
    for (int i = 0; i < region_count; i++)
        mprotect((void *)regions[i].start, regions[i].end - regions[i].start, PROT_NONE);
}
