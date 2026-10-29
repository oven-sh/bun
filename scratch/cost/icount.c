/* Scratch.  Counts the instructions that a program executes inside given address ranges (the code of one object
 * file).  It single-steps the program only while it is inside the ranges.  Outside of them the program runs free:
 * breakpoints at the start of every range, and at the return address of every call that leaves the ranges, stop it
 * when it comes back.  The program runs with address-space randomization off, so a non-PIE binary has the
 * addresses of its link map.
 *
 *   icount <ranges file> <program> [args...]
 *
 * The ranges file has one "lo hi" pair of hex addresses per line (hi is exclusive).  Each range has to start with
 * an instruction: with -ffunction-sections, the sections of the link map are such ranges.
 * Prints: in=<instructions inside the ranges> entries=<times the program came into the ranges> status=<exit status>
 */
#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/personality.h>
#include <sys/ptrace.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>

struct range { unsigned long lo, hi; };
struct bp { unsigned long addr, orig; unsigned pending; int entry; };

static struct range *ranges;
static size_t n_ranges;
static unsigned long all_lo = ~0UL, all_hi;
static struct bp *bps;
static size_t n_bps, cap_bps;
static pid_t pid;

static int
by_lo (const void *a, const void *b)
{
    const struct range *x = a, *y = b;
    return x->lo < y->lo ? -1 : x->lo > y->lo;
}

static int
inside (unsigned long addr)
{
    size_t a = 0, b = n_ranges;
    if (addr < all_lo || addr >= all_hi)
        return 0;
    while (a < b)
    {
        size_t m = (a + b) / 2;
        if (addr < ranges[m].lo)
            b = m;
        else if (addr >= ranges[m].hi)
            a = m + 1;
        else
            return 1;
    }
    return 0;
}

static unsigned long
peek (unsigned long addr)
{
    errno = 0;
    unsigned long word = (unsigned long) ptrace(PTRACE_PEEKTEXT, pid, addr, 0);
    if (errno)
    {
        perror("peek");
        exit(3);
    }
    return word;
}

static struct bp *
find_bp (unsigned long addr)
{
    for (size_t i = 0; i < n_bps; ++i)
        if (bps[i].addr == addr)
            return &bps[i];
    return NULL;
}

static struct bp *
add_bp (unsigned long addr, int entry)
{
    struct bp *bp = find_bp(addr);
    if (!bp)
    {
        if (n_bps == cap_bps)
            bps = realloc(bps, (cap_bps = cap_bps ? cap_bps * 2 : 256) * sizeof(*bps));
        bp = &bps[n_bps++];
        *bp = (struct bp) { addr, 0, 0, 0 };
    }
    if (entry)
        bp->entry = 1;
    else
        ++bp->pending;
    return bp;
}

/* The program's text is the original while it is single-stepped, and has the breakpoints while it runs free */
static void
insert_all (void)
{
    for (size_t i = 0; i < n_bps; ++i)
        if (bps[i].entry || bps[i].pending)
        {
            bps[i].orig = peek(bps[i].addr);
            ptrace(PTRACE_POKETEXT, pid, bps[i].addr, (bps[i].orig & ~0xffUL) | 0xcc);
        }
}

static void
remove_all (void)
{
    /* In reverse, so that overlapping words get their first content back */
    for (size_t i = n_bps; i-- > 0; )
        if (bps[i].entry || bps[i].pending)
            ptrace(PTRACE_POKETEXT, pid, bps[i].addr, bps[i].orig);
}

enum kind { OTHER, CALL, JMP, RET };

static enum kind
kind_of (unsigned long addr)
{
    unsigned long word = peek(addr);
    unsigned char b[8];
    size_t i = 0;
    for (size_t k = 0; k < 8; ++k)
        b[k] = (unsigned char) (word >> (8 * k));
    while (i < 4 && ((b[i] >= 0x40 && b[i] <= 0x4f) || b[i] == 0x66 || b[i] == 0xf2
                    || b[i] == 0xf3 || b[i] == 0x2e || b[i] == 0x3e || b[i] == 0x64 || b[i] == 0x65))
        ++i;
    switch (b[i])
    {
    case 0xe8: return CALL;
    case 0xe9: case 0xeb: return JMP;
    case 0xc3: case 0xc2: case 0xcb: case 0xca: return RET;
    case 0xff:
        switch ((b[i + 1] >> 3) & 7)
        {
        case 2: case 3: return CALL;
        case 4: case 5: return JMP;
        }
        return OTHER;
    }
    return OTHER;
}

int
main (int argc, char **argv)
{
    struct user_regs_struct regs;
    unsigned long lo, hi;
    unsigned long long in = 0, entries = 0;
    size_t cap = 0;
    int status;
    FILE *f;

    if (argc < 3)
        return 2;
    f = fopen(argv[1], "r");
    if (!f)
        return 2;
    while (2 == fscanf(f, "%lx %lx", &lo, &hi))
    {
        if (n_ranges == cap)
            ranges = realloc(ranges, (cap = cap ? cap * 2 : 64) * sizeof(*ranges));
        ranges[n_ranges++] = (struct range) { lo, hi };
        if (lo < all_lo) all_lo = lo;
        if (hi > all_hi) all_hi = hi;
    }
    fclose(f);
    qsort(ranges, n_ranges, sizeof(*ranges), by_lo);

    pid = fork();
    if (pid == 0)
    {
        personality(ADDR_NO_RANDOMIZE);
        ptrace(PTRACE_TRACEME, 0, 0, 0);
        execv(argv[2], argv + 2);
        _exit(127);
    }
    if (waitpid(pid, &status, 0) < 0 || !WIFSTOPPED(status))
        return 3;
    for (size_t i = 0; i < n_ranges; ++i)
        add_bp(ranges[i].lo, 1);

    for (;;)
    {
        /* The program runs free until it is inside the ranges */
        int sig = 0;
        insert_all();
        for (;;)
        {
            if (ptrace(PTRACE_CONT, pid, 0, sig) < 0 || waitpid(pid, &status, 0) < 0)
                goto done;
            if (!WIFSTOPPED(status))
                goto done;
            if (WSTOPSIG(status) == SIGTRAP)
                break;
            sig = WSTOPSIG(status);     /* One of the program's own signals */
        }
        remove_all();
        ptrace(PTRACE_GETREGS, pid, 0, &regs);
        struct bp *bp = find_bp(regs.rip - 1);
        if (!bp)
        {
            fprintf(stderr, "stop at %llx is no breakpoint\n", (unsigned long long) regs.rip);
            goto done;
        }
        if (bp->pending)
            --bp->pending;
        regs.rip -= 1;
        ptrace(PTRACE_SETREGS, pid, 0, &regs);
        ++entries;

        /* Inside: one instruction at a time */
        unsigned long rip = regs.rip;
        for (;;)
        {
            const unsigned long prev = rip;
            if (ptrace(PTRACE_SINGLESTEP, pid, 0, 0) < 0 || waitpid(pid, &status, 0) < 0)
                goto done;
            ++in;
            if (!WIFSTOPPED(status))
                goto done;
            if (WSTOPSIG(status) != SIGTRAP)
            {
                fprintf(stderr, "signal %d inside the ranges\n", WSTOPSIG(status));
                ptrace(PTRACE_CONT, pid, 0, WSTOPSIG(status));
                waitpid(pid, &status, 0);
                goto done;
            }
            ptrace(PTRACE_GETREGS, pid, 0, &regs);
            rip = regs.rip;
            if (inside(rip))
                continue;
            /* It left.  After a call, and after a jump that is a tail call, the top of the stack is a return
             * address.  If that address is inside the ranges, the program comes back there.
             */
            const enum kind kind = kind_of(prev);
            if (kind == CALL || kind == JMP)
            {
                const unsigned long ra = peek(regs.rsp);
                if (inside(ra))
                    add_bp(ra, 0);
            }
            break;
        }
    }

  done:
    printf("in=%llu entries=%llu status=%d\n", in, entries,
        WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status));
    return 0;
}
