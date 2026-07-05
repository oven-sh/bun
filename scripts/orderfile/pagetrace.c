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
// run atexit handlers. Layout: u64 page size, u64 count, then `count` u64 page
// addresses in first-touch order.
//
//   cc -O2 -shared -fPIC -o pagetrace.so pagetrace.c -ldl
//   BUN_PAGETRACE_BIN=build/release/bun-profile BUN_PAGETRACE_OUT=/tmp/trace.bin
//     LD_PRELOAD=./pagetrace.so build/release/bun-profile -e 'console.log(1)'
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
#define HEADER_WORDS 2 // record[0] = page size, record[1] = count

static struct {
    uintptr_t start, end;
} regions[MAX_REGIONS];
static int region_count = 0;
static uint64_t *record = NULL;
static uintptr_t page_size = 4096;
static int armed = 0;

static int in_traced_region(uintptr_t page)
{
    for (int i = 0; i < region_count; i++)
        if (page >= regions[i].start && page < regions[i].end) return 1;
    return 0;
}

static void on_fault(int sig, siginfo_t *si, void *ucontext)
{
    (void)ucontext;
    uintptr_t page = (uintptr_t)si->si_addr & ~(page_size - 1);
    // Not ours, or we cannot re-map it: restore the default disposition so the
    // re-executed instruction produces a real crash instead of spinning here.
    if (!in_traced_region(page)) {
        signal(sig, SIG_DFL);
        return;
    }
    // Faults arrive on whichever thread touched the page; bun has several.
    uint64_t n = __atomic_fetch_add(&record[1], 1, __ATOMIC_RELAXED);
    if (n < MAX_HITS) record[HEADER_WORDS + n] = page;
    if (mprotect((void *)page, page_size, PROT_READ | PROT_EXEC) != 0) signal(sig, SIG_DFL);
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
    const char *binary_env = getenv("BUN_PAGETRACE_BIN");
    const char *out_env = getenv("BUN_PAGETRACE_OUT");
    if (!binary_env || !out_env) return;

    // unsetenv below may invalidate what getenv just returned.
    char binary[512], out[512];
    snprintf(binary, sizeof binary, "%s", binary_env);
    snprintf(out, sizeof out, "%s", out_env);

    // A traced workload execs other programs — `bun install` runs lifecycle
    // scripts, the cli workload shells out — and LD_PRELOAD is inherited. Take
    // ourselves out of the environment so no child runs this constructor: one
    // that maps the same binary (another bun) would arm itself and clobber the
    // trace this process is still writing. ptyrun hands the preload down to the
    // one child that should have it, so nothing here depends on inheritance.
    unsetenv("LD_PRELOAD");
    unsetenv("BUN_PAGETRACE_BIN");
    unsetenv("BUN_PAGETRACE_OUT");

    long reported = sysconf(_SC_PAGESIZE);
    if (reported > 0) page_size = (uintptr_t)reported;

    // Find the regions before creating the output file. A process that is not
    // the binary under trace has nothing to record, and the file it would
    // create-and-truncate is the one a live trace is recording into.
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

    size_t bytes = (size_t)(HEADER_WORDS + MAX_HITS) * 8;
    int fd = open(out, O_CREAT | O_TRUNC | O_RDWR, 0644);
    if (fd < 0) return;
    if (ftruncate(fd, (off_t)bytes) != 0) {
        close(fd);
        return;
    }
    record = mmap(NULL, bytes, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (record == MAP_FAILED) {
        record = NULL;
        return;
    }
    record[0] = page_size;

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
