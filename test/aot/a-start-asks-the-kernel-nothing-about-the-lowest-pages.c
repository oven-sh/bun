// LD_PRELOAD=<this library> LOW_PAGES_HOST=<host> <program>: the program meets what one of these hosts answers about the lowest pages of its address space, and every
// call that names an address below 16 KB goes to stderr. See a-start-asks-the-kernel-nothing-about-the-lowest-pages.test.ts.
// On both hosts /proc/sys/vm/mmap_min_addr says 4096, whatever it says on this machine.
// - kernel-before-4.17: RHEL 7 and CentOS 7 (Linux 3.10). The kernel does not know MAP_FIXED_NOREPLACE and ignores the flag, so the address is a hint. It raises a
//   hint below the floor of its security module to that floor (round_hint_to_min() in mm/mmap.c, CONFIG_LSM_MMAP_MIN_ADDR=65536).
// - filtered-mincore: a sandbox whose seccomp filter refuses mincore with EPERM, and a process that may not map page 0. AWS Lambda is one.
// Not imitated: system calls made without libc, and what SELinux refuses on RHEL 7.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifndef MAP_FIXED_NOREPLACE
#define MAP_FIXED_NOREPLACE 0x100000
#endif
#define FLOOR_OF_HINTS 65536ul
#define LOW 16384ul

enum { Unknown, KernelBefore4_17, FilteredMincore };
static int host(void)
{
    static int known = Unknown;
    if (known == Unknown) {
        const char* name = getenv("LOW_PAGES_HOST");
        known = name && !strcmp(name, "filtered-mincore") ? FilteredMincore : KernelBefore4_17;
    }
    return known;
}

static void say(const char* what, const void* address)
{
    char line[120];
    int length = snprintf(line, sizeof line, "low-pages: %s(%p)\n", what, address);
    if (length > 0) (void)!write(2, line, length);
}

void* mmap(void* address, size_t length, int protection, int flags, int fd, off_t offset)
{
    int isFixed = flags & (MAP_FIXED | MAP_FIXED_NOREPLACE);
    if ((uintptr_t)address < LOW && (address || isFixed))
        say("mmap", address);
    if (host() == KernelBefore4_17) {
        flags &= ~MAP_FIXED_NOREPLACE;
        if (!(flags & MAP_FIXED) && address && (uintptr_t)address < FLOOR_OF_HINTS)
            address = (void*)FLOOR_OF_HINTS;
    } else if (isFixed && !address) {
        errno = EPERM;
        return MAP_FAILED;
    }
    return (void*)syscall(SYS_mmap, address, length, protection, flags, fd, offset);
}
#if defined(__GLIBC__)
void* mmap64(void* address, size_t length, int protection, int flags, int fd, off_t offset) { return mmap(address, length, protection, flags, fd, offset); }
#endif

int munmap(void* address, size_t length)
{
    if ((uintptr_t)address < LOW)
        say("munmap", address);
    return syscall(SYS_munmap, address, length);
}

int mincore(void* address, size_t length, unsigned char* residency)
{
    if ((uintptr_t)address < LOW)
        say("mincore", address);
    if (host() == FilteredMincore) {
        errno = EPERM;
        return -1;
    }
    return syscall(SYS_mincore, address, length, residency);
}

static FILE* opened(const char* name, const char* path, const char* mode)
{
    if (!strcmp(path, "/proc/sys/vm/mmap_min_addr")) {
        static const char said[] = "low-pages: /proc/sys/vm/mmap_min_addr says 4096\n";
        (void)!write(2, said, sizeof said - 1);
        static char floor[] = "4096\n";
        return fmemopen(floor, sizeof floor - 1, "r");
    }
    FILE* (*real)(const char*, const char*) = dlsym(RTLD_NEXT, name);
    return real(path, mode);
}
FILE* fopen(const char* path, const char* mode) { return opened("fopen", path, mode); }
#if defined(__GLIBC__)
FILE* fopen64(const char* path, const char* mode) { return opened("fopen64", path, mode); }
#endif
