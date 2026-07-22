// Function-entry tracer for scripts/orderfile/generate.ts.
//
// Records the exact functions a run executes, in first-entry order, by planting
// a breakpoint (x86-64 INT3 / arm64 BRK) at every function's first instruction
// and restoring it the first time it fires. Finer than pagetrace.c's page
// granularity: a page trace lists every function that shares a page with a hot
// one, so a cold function lands at the front of .text just for being a
// neighbour. This lists only functions that actually ran.
//
// The executable mapping is replaced with a copy we hold a writable alias to,
// so the signal handler can restore an instruction without a writable+executable
// page. Linux uses a memfd; macOS promotes the mapping to COW and remaps a
// writable view of the same pages.
//
// The record is an mmap(MAP_SHARED) window over the output file so it survives
// whatever exit path the traced program takes. Layout: five header words then
// `count` u64 link-time addresses in first-entry order.
//
// Function starts are read from a file the generator writes (`nm` addresses),
// not from the loaded symbol table: the linker strips most local symbols from
// .dynsym, and .symtab isn't a loaded segment.
//
//   linux: cc -O2 -shared -fPIC -o functrace.so functrace.c -ldl
//   macos: cc -O2 -dynamiclib -fPIC -o functrace.dylib functrace.c
//   BUN_FUNCTRACE_STARTS=/tmp/starts.bin BUN_FUNCTRACE_OUT=/tmp/trace.bin
//     LD_PRELOAD=./functrace.so build/release/bun-profile -e 'console.log(1)'
#if !(defined(__linux__) && (defined(__x86_64__) || defined(__aarch64__))) && \
    !(defined(__APPLE__) && defined(__aarch64__))
#error "functrace.c builds on linux x86-64/arm64 or macOS arm64"
#endif

#define _GNU_SOURCE
#define _DARWIN_C_SOURCE
#define _XOPEN_SOURCE 700
#include <dlfcn.h>
#include <pthread.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <ucontext.h>
#include <unistd.h>

#if defined(__linux__)
#include <link.h>
#include <sys/syscall.h>
#else
#include <libkern/OSCacheControl.h>
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#endif

#if defined(__x86_64__)
typedef uint8_t insn_t;
#define BREAKPOINT ((insn_t)0xcc) // INT3
#else
typedef uint32_t insn_t;
#define BREAKPOINT ((insn_t)0xd4200000) // BRK #0
#endif

#define MAX_REGIONS 8
#define STARTS_HEADER_WORDS 3 // u64 magic, version, count
#define TRACE_HEADER_WORDS 5  // u64 magic, version, slide, starts, count
#define STARTS_MAGIC UINT64_C(0x4e55425354525453) // "STRTSBUN" little-endian
#define TRACE_MAGIC UINT64_C(0x4e55424543415254)  // "TRACEBUN" little-endian
#define FILE_VERSION UINT64_C(1)

typedef int (*sigaction_fn)(int, const struct sigaction *, struct sigaction *);

static struct {
    uintptr_t start, end;
    uint8_t *rw; // same bytes, writable
} regions[MAX_REGIONS];
static int region_count = 0;

static uintptr_t slide = 0;
static uintptr_t *starts = NULL; // runtime addresses, sorted
static insn_t *originals = NULL; // instruction that was at starts[i]
static uint8_t *seen = NULL;
static size_t start_count = 0;
static uint64_t *record = NULL;
static int armed = 0;

static int region_of(uintptr_t a)
{
    for (int i = 0; i < region_count; i++)
        if (a >= regions[i].start && a < regions[i].end) return i;
    return -1;
}

static size_t find_start(uintptr_t a)
{
    size_t lo = 0, hi = start_count;
    while (lo < hi) {
        size_t mid = lo + (hi - lo) / 2;
        if (starts[mid] < a) lo = mid + 1;
        else hi = mid;
    }
    return (lo < start_count && starts[lo] == a) ? lo : SIZE_MAX;
}

static void sync_icache(uintptr_t rx, void *rw, size_t n)
{
#if defined(__APPLE__)
    (void)rw;
    sys_icache_invalidate((void *)rx, n);
#elif defined(__aarch64__)
    // The memfd is visible at two virtual addresses. Clean the data cache
    // through the one we wrote, then invalidate the instruction cache through
    // the one that executes.
    __builtin___clear_cache((char *)rw, (char *)rw + n);
    __builtin___clear_cache((char *)rx, (char *)rx + n);
#else
    (void)rx;
    (void)rw;
    (void)n;
#endif
}

// ─── sigaction interposer ───────────────────────────────────────────────────
// bun installs SIGILL for its crash reporter, and user code can register
// SIGTRAP. Swallow registrations for the signals our breakpoints raise while
// armed so nothing replaces the handler.

static int swallow_signal(int sig)
{
#if defined(__APPLE__)
    // arm64 BRK arrives as SIGTRAP on recent kernels and SIGILL on older ones.
    return sig == SIGTRAP || sig == SIGILL;
#else
    return sig == SIGTRAP;
#endif
}

#if defined(__linux__)
static sigaction_fn real_sigaction;

int sigaction(int sig, const struct sigaction *act, struct sigaction *old)
{
    if (!real_sigaction) real_sigaction = (sigaction_fn)dlsym(RTLD_NEXT, "sigaction");
    if (armed && swallow_signal(sig)) {
        if (old) memset(old, 0, sizeof *old);
        return 0;
    }
    return real_sigaction(sig, act, old);
}

// mimalloc's scavenger (and any library that wants a quiet background thread)
// blocks every signal on it. A blocked synchronous SIGTRAP cannot be delivered,
// and the kernel's answer is to reset the handler to SIG_DFL and kill the
// process — so the first breakpoint that thread touches ends the trace. Strip
// our signals from anything anyone blocks.
typedef int (*sigmask_fn)(int, const sigset_t *, sigset_t *);

static int pass_sigmask(sigmask_fn real, int how, const sigset_t *set, sigset_t *old)
{
    if (!armed || !set || how == SIG_UNBLOCK) return real(how, set, old);
    sigset_t copy = *set;
    sigdelset(&copy, SIGTRAP);
    return real(how, &copy, old);
}

int pthread_sigmask(int how, const sigset_t *set, sigset_t *old)
{
    static sigmask_fn real;
    if (!real) real = (sigmask_fn)dlsym(RTLD_NEXT, "pthread_sigmask");
    return pass_sigmask(real, how, set, old);
}

int sigprocmask(int how, const sigset_t *set, sigset_t *old)
{
    static sigmask_fn real;
    if (!real) real = (sigmask_fn)dlsym(RTLD_NEXT, "sigprocmask");
    return pass_sigmask(real, how, set, old);
}
#else
static int interposed_sigaction(int sig, const struct sigaction *act, struct sigaction *old)
{
    if (armed && swallow_signal(sig)) {
        if (old) memset(old, 0, sizeof *old);
        return 0;
    }
    // dyld interposition does not redirect this dylib's own calls, so this
    // reaches the real libSystem sigaction without recursion.
    return sigaction(sig, act, old);
}

typedef int (*sigmask_fn)(int, const sigset_t *, sigset_t *);

static int pass_sigmask(sigmask_fn real, int how, const sigset_t *set, sigset_t *old)
{
    if (!armed || !set || how == SIG_UNBLOCK) return real(how, set, old);
    sigset_t copy = *set;
    sigdelset(&copy, SIGTRAP);
    sigdelset(&copy, SIGILL);
    return real(how, &copy, old);
}

static int interposed_pthread_sigmask(int how, const sigset_t *set, sigset_t *old)
{
    return pass_sigmask(pthread_sigmask, how, set, old);
}

static int interposed_sigprocmask(int how, const sigset_t *set, sigset_t *old)
{
    return pass_sigmask(sigprocmask, how, set, old);
}

// dyld resolves the traced binary's calls through this table rather than by
// symbol name, so nothing in the binary needs to call dlsym.
__attribute__((used, section("__DATA,__interpose"))) static struct {
    const void *replacement;
    const void *original;
} interposers[] = {
    { (const void *)interposed_sigaction, (const void *)sigaction },
    // mimalloc's scavenger blocks every signal on its background thread. A
    // blocked synchronous SIGTRAP cannot be delivered; the kernel's answer is
    // to kill the process, which ends the trace at the first breakpoint that
    // thread touches. Strip our signals from anything anyone blocks.
    { (const void *)interposed_pthread_sigmask, (const void *)pthread_sigmask },
    { (const void *)interposed_sigprocmask, (const void *)sigprocmask },
};
#endif

// ─── signal handler ─────────────────────────────────────────────────────────

static void on_trap(int sig, siginfo_t *si, void *uc)
{
    (void)si;
    ucontext_t *ctx = (ucontext_t *)uc;
#if defined(__linux__) && defined(__x86_64__)
    // INT3 reports the address after the one-byte instruction.
    uintptr_t pc = (uintptr_t)ctx->uc_mcontext.gregs[REG_RIP];
    uintptr_t at = pc - 1;
#elif defined(__linux__) && defined(__aarch64__)
    uintptr_t pc = (uintptr_t)ctx->uc_mcontext.pc;
    uintptr_t at = pc;
#else
    uintptr_t pc = (uintptr_t)ctx->uc_mcontext->__ss.__pc;
    uintptr_t at = pc;
#endif
    size_t i = find_start(at);
#if defined(__aarch64__)
    // Older kernels report the instruction after BRK; try both.
    if (i == SIZE_MAX && pc >= sizeof(insn_t)) {
        at = pc - sizeof(insn_t);
        i = find_start(at);
    }
#endif
    int r = region_of(at);
    if (i == SIZE_MAX || r < 0) {
        // Not ours: let the default disposition handle it so a real trap still
        // crashes instead of spinning here.
        armed = 0;
        signal(sig, SIG_DFL);
        return;
    }

    insn_t *rw = (insn_t *)(regions[r].rw + (at - regions[r].start));
    __atomic_store_n(rw, originals[i], __ATOMIC_RELEASE);
    sync_icache(at, rw, sizeof *rw);

    // Several threads can hit the same start before the restore lands; only
    // the first records it.
    if (__atomic_exchange_n(&seen[i], 1, __ATOMIC_RELAXED) == 0) {
        uint64_t n = __atomic_fetch_add(&record[4], 1, __ATOMIC_RELAXED);
        if (n < start_count) record[TRACE_HEADER_WORDS + n] = at - slide;
    }
#if defined(__linux__) && defined(__x86_64__)
    ctx->uc_mcontext.gregs[REG_RIP] = (greg_t)at;
#elif defined(__linux__) && defined(__aarch64__)
    ctx->uc_mcontext.pc = at;
#else
    ctx->uc_mcontext->__ss.__pc = at;
#endif
}

// ─── executable discovery and remapping ─────────────────────────────────────

static uintptr_t page_align_down(uintptr_t a, uintptr_t p) { return a & ~(p - 1); }
static uintptr_t page_align_up(uintptr_t a, uintptr_t p) { return (a + p - 1) & ~(p - 1); }

#if defined(__linux__)
static int find_image(struct dl_phdr_info *info, size_t _sz, void *_data)
{
    (void)_sz;
    (void)_data;
    if (info->dlpi_name[0] != '\0') return 0; // the main executable has no name here
    slide = (uintptr_t)info->dlpi_addr;
    long page = sysconf(_SC_PAGESIZE);
    for (ElfW(Half) i = 0; i < info->dlpi_phnum; i++) {
        const ElfW(Phdr) *ph = &info->dlpi_phdr[i];
        if (ph->p_type != PT_LOAD || !(ph->p_flags & PF_X) || region_count == MAX_REGIONS) continue;
        uintptr_t start = slide + (uintptr_t)ph->p_vaddr;
        regions[region_count].start = page_align_down(start, (uintptr_t)page);
        regions[region_count].end = page_align_up(start + (uintptr_t)ph->p_memsz, (uintptr_t)page);
        region_count++;
    }
    return 1;
}

static int remap_executable(void)
{
    // Copy each executable segment into a memfd, map it RX over the original
    // address, and keep a separate RW alias. The signal handler writes through
    // the alias so no page is ever writable and executable at once.
    for (int i = 0; i < region_count; i++) {
        size_t n = regions[i].end - regions[i].start;
        int fd = (int)syscall(SYS_memfd_create, "bun-functrace", 1u /* MFD_CLOEXEC */);
        if (fd < 0 || ftruncate(fd, (off_t)n) != 0) return -1;
        void *rw = mmap(NULL, n, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
        if (rw == MAP_FAILED) return -1;
        memcpy(rw, (const void *)regions[i].start, n);
        if (mmap((void *)regions[i].start, n, PROT_READ | PROT_EXEC, MAP_SHARED | MAP_FIXED, fd, 0) == MAP_FAILED)
            return -1;
        close(fd);
        regions[i].rw = rw;
        sync_icache(regions[i].start, rw, n);
    }
    return 0;
}
#else
static int remap_executable(void)
{
    uintptr_t seg_start = 0, seg_end = 0; // page-aligned __TEXT, the span we remap
    long page = sysconf(_SC_PAGESIZE);
    uint32_t count = _dyld_image_count();
    for (uint32_t i = 0; i < count; i++) {
        const struct mach_header_64 *mh = (const struct mach_header_64 *)_dyld_get_image_header(i);
        if (!mh || mh->magic != MH_MAGIC_64 || mh->filetype != MH_EXECUTE) continue;
        slide = (uintptr_t)_dyld_get_image_vmaddr_slide(i);
        const uint8_t *lc = (const uint8_t *)(mh + 1);
        for (uint32_t c = 0; c < mh->ncmds; c++) {
            const struct load_command *cmd = (const struct load_command *)lc;
            if (cmd->cmd == LC_SEGMENT_64) {
                const struct segment_command_64 *seg = (const struct segment_command_64 *)cmd;
                // The __TEXT segment holds the Mach-O header and read-only
                // sections alongside __text; nm lists __mh_execute_header as T,
                // and patching it replaces the magic number dyld re-reads. Only
                // the __text section is code.
                if (strncmp(seg->segname, SEG_TEXT, sizeof seg->segname) != 0) {
                    lc += cmd->cmdsize;
                    continue;
                }
                seg_start = page_align_down(slide + (uintptr_t)seg->vmaddr, (uintptr_t)page);
                seg_end = page_align_up(slide + (uintptr_t)seg->vmaddr + (uintptr_t)seg->vmsize, (uintptr_t)page);
                const struct section_64 *sect = (const struct section_64 *)(seg + 1);
                for (uint32_t s = 0; s < seg->nsects; s++) {
                    if (strncmp(sect[s].sectname, SECT_TEXT, sizeof sect[s].sectname) != 0) continue;
                    regions[region_count].start = slide + (uintptr_t)sect[s].addr;
                    regions[region_count].end = regions[region_count].start + (uintptr_t)sect[s].size;
                    region_count++;
                }
            }
            lc += cmd->cmdsize;
        }
        break;
    }
    if (!region_count) return -1;

    // VM_PROT_COPY promotes the file-backed pages to anonymous COW copies we
    // can write. RWX is refused on __TEXT even with COPY (maxprot stays r-x),
    // so the segment goes RW while the alias is set up — this code is in the
    // dylib's own __TEXT, so nothing executing right now loses its X bit — and
    // back to RX before this function returns either way, so an early return
    // anywhere later still leaves the executable runnable. Writes after that
    // go through the RW alias; the original stays RX.
    size_t n = seg_end - seg_start;
    kern_return_t kr =
        mach_vm_protect(mach_task_self(), seg_start, n, FALSE, VM_PROT_READ | VM_PROT_WRITE | VM_PROT_COPY);
    if (kr != KERN_SUCCESS) return -1;
    // Same physical pages, second virtual address: writes through either are
    // visible at both. FALSE = shared, not a fresh copy.
    mach_vm_address_t alias = 0;
    vm_prot_t cur = 0, max = 0;
    int ok = mach_vm_remap(mach_task_self(), &alias, n, 0, VM_FLAGS_ANYWHERE, mach_task_self(), seg_start, FALSE, &cur,
                           &max, VM_INHERIT_NONE) == KERN_SUCCESS &&
             mach_vm_protect(mach_task_self(), alias, n, FALSE, VM_PROT_READ | VM_PROT_WRITE) == KERN_SUCCESS;
    if (mach_vm_protect(mach_task_self(), seg_start, n, FALSE, VM_PROT_READ | VM_PROT_EXECUTE) != KERN_SUCCESS)
        return -1;
    if (!ok) return -1;
    for (int i = 0; i < region_count; i++) regions[i].rw = (uint8_t *)alias + (regions[i].start - seg_start);
    return 0;
}
#endif

// ─── setup ──────────────────────────────────────────────────────────────────

static int cmp_uintptr(const void *a, const void *b)
{
    uintptr_t x = *(const uintptr_t *)a, y = *(const uintptr_t *)b;
    return (x > y) - (x < y);
}

static int read_starts(const char *path)
{
    int fd = open(path, O_RDONLY | O_CLOEXEC);
    struct stat st;
    if (fd < 0 || fstat(fd, &st) != 0 || st.st_size < (off_t)(STARTS_HEADER_WORDS * 8)) return -1;
    const uint64_t *w = mmap(NULL, (size_t)st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
    close(fd);
    if (w == MAP_FAILED) return -1;
    uint64_t n = w[2];
    if (w[0] != STARTS_MAGIC || w[1] != FILE_VERSION || n == 0 || n > ((uint64_t)st.st_size / 8) - STARTS_HEADER_WORDS)
        return -1;

    starts = calloc((size_t)n, sizeof *starts);
    if (!starts) return -1;
    for (size_t i = 0; i < (size_t)n; i++) {
        uintptr_t a = slide + (uintptr_t)w[STARTS_HEADER_WORDS + i];
        // Drop anything that doesn't land in our own text: the generator may have
        // listed a symbol the linker dead-stripped, and patching outside the
        // remapped regions would write into whatever happens to be there.
        if (region_of(a) < 0 || a % sizeof(insn_t) != 0) continue;
        starts[start_count++] = a;
    }
    munmap((void *)w, (size_t)st.st_size);
    if (!start_count) return -1;

    qsort(starts, start_count, sizeof *starts, cmp_uintptr);
    // Drop duplicates, and anything whose first instruction is already a
    // breakpoint: JSC's LLInt places int3/brk at never-taken bytecode labels,
    // and restoring a breakpoint to a breakpoint loops forever.
    size_t unique = 0;
    for (size_t i = 0; i < start_count; i++) {
        if (unique != 0 && starts[unique - 1] == starts[i]) continue;
        if (*(const insn_t *)starts[i] == BREAKPOINT) continue;
        starts[unique++] = starts[i];
    }
    start_count = unique;
    return 0;
}

static int install_breakpoints(void)
{
    originals = calloc(start_count, sizeof *originals);
    seen = calloc(start_count, sizeof *seen);
    if (!originals || !seen) return -1;
    for (size_t i = 0; i < start_count; i++) {
        int r = region_of(starts[i]);
        insn_t *p = (insn_t *)(regions[r].rw + (starts[i] - regions[r].start));
        originals[i] = *p;
        *p = BREAKPOINT;
    }
    for (int r = 0; r < region_count; r++)
        sync_icache(regions[r].start, regions[r].rw, regions[r].end - regions[r].start);
    return 0;
}

static int open_record(const char *path)
{
    size_t bytes = (TRACE_HEADER_WORDS + start_count) * 8;
    int fd = open(path, O_CREAT | O_TRUNC | O_RDWR, 0644);
    if (fd < 0 || ftruncate(fd, (off_t)bytes) != 0) return -1;
    void *map = mmap(NULL, bytes, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (map == MAP_FAILED) return -1;
    record = map;
    record[0] = TRACE_MAGIC;
    record[1] = FILE_VERSION;
    record[2] = slide;
    record[3] = start_count;
    return 0;
}

__attribute__((constructor(101))) static void functrace_init(void)
{
    const char *starts_env = getenv("BUN_FUNCTRACE_STARTS");
    const char *out_env = getenv("BUN_FUNCTRACE_OUT");
    if (!starts_env || !out_env) return;
    // unsetenv below may invalidate what getenv returned.
    char starts_path[1024], out_path[1024];
    snprintf(starts_path, sizeof starts_path, "%s", starts_env);
    snprintf(out_path, sizeof out_path, "%s", out_env);

    // Take ourselves out of the environment so a child exec'd by the workload
    // (lifecycle scripts, shells) does not re-arm over the trace this process
    // is still writing. ptyrun hands the preload down to the one process that
    // should have it.
#if defined(__linux__)
    unsetenv("LD_PRELOAD");
#else
    unsetenv("DYLD_INSERT_LIBRARIES");
#endif
    unsetenv("BUN_FUNCTRACE_STARTS");
    unsetenv("BUN_FUNCTRACE_OUT");

#if defined(__linux__)
    dl_iterate_phdr(find_image, NULL);
    if (!region_count) return;
    if (remap_executable() != 0) return;
#else
    if (remap_executable() != 0) return;
#endif
    if (read_starts(starts_path) != 0) return;
    // The record backs every trap, so it must exist before the first breakpoint
    // can fire: `install_breakpoints()` is the point of no return.
    if (open_record(out_path) != 0) return;

    static char altstack[256 * 1024];
    stack_t ss = { .ss_sp = altstack, .ss_size = sizeof altstack, .ss_flags = 0 };
    sigaltstack(&ss, NULL);

    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_sigaction = on_trap;
    sa.sa_flags = SA_SIGINFO | SA_ONSTACK | SA_NODEFER;
    sigemptyset(&sa.sa_mask);
#if defined(__linux__)
    real_sigaction = (sigaction_fn)dlsym(RTLD_NEXT, "sigaction");
    if (!real_sigaction) return;
    real_sigaction(SIGTRAP, &sa, NULL);
#else
    sigaction(SIGTRAP, &sa, NULL);
    sigaction(SIGILL, &sa, NULL);
#endif

    if (install_breakpoints() != 0) return;
    armed = 1;
}
