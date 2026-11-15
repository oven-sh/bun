// LD_PRELOAD=pages-64k.so <program>: the program lives as under a kernel with pages of 64 KB, as far as user space can tell. See pages-64k.test.ts.
// It is told that a page has 64 KB. mmap answers at multiples of 64 KB and takes whole pages. An address or a file offset that is not at a page's edge is refused
// with EINVAL, and a length is rounded up to whole pages, so a protection spills over whatever shares the page: all as that kernel does.
// /proc/self/statm, opened through open(), counts in pages of 64 KB.
// Not imitated: how the kernel itself maps the executable and the stack, brk, system calls made without libc, and /proc/self/pagemap, which has a word for each page
// of the real kernel. `bun build --compile` reads that file to find the pages it has written, so `bun build` stays outside.
// PAGES64K_LOG=1: it says that it is there, and every refusal goes to stderr with the caller's address.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/auxv.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <unistd.h>

#define PAGE 65536ul
static int logs(void) { static int known = -1; if (known < 0) known = getenv("PAGES64K_LOG") != NULL; return known; }
static void refuse(const char* what, const void* address, size_t length, long offset, void* caller)
{
    if (!logs()) return;
    char line[200];
    int n = snprintf(line, sizeof line, "pages64k: EINVAL %s(%p, %zu, offset %ld) from %p\n", what, address, length, offset, caller);
    if (n > 0) (void)!write(2, line, n);
}
__attribute__((constructor)) static void sayItIsThere(void)
{
    static const char said[] = "pages64k: a page has 65536 bytes\n";
    if (logs()) (void)!write(2, said, sizeof said - 1);
}
static size_t whole(size_t length) { return (length + PAGE - 1) & ~(PAGE - 1); }
// `bun build ..` stays outside, so that a whole test runner can be started under LD_PRELOAD: its builds are real, its programs live on 64 KB pages.
static int isOutside(void)
{
    static int known = -1;
    if (known >= 0) return known;
    char line[512]; int fd = syscall(SYS_openat, -100, "/proc/self/cmdline", 0, 0); long n = fd >= 0 ? syscall(SYS_read, fd, line, sizeof line - 1) : 0;
    if (fd >= 0) syscall(SYS_close, fd);
    known = 0;
    if (n > 0) { line[n] = 0; size_t first = strlen(line) + 1; if ((long)first < n && !strcmp(line + first, "build")) known = 1; }
    return known;
}

long sysconf(int name)
{
    static long (*real)(int);
    if (!real) real = dlsym(RTLD_NEXT, "sysconf");
    return name == _SC_PAGESIZE && !isOutside() ? (long)PAGE : real(name);
}
int getpagesize(void) { return isOutside() ? 4096 : PAGE; }
unsigned long getauxval(unsigned long type)
{
    static unsigned long (*real)(unsigned long);
    if (!real) real = dlsym(RTLD_NEXT, "getauxval");
    return type == AT_PAGESZ && !isOutside() ? PAGE : real(type);
}

// The kernel's own counts, each in pages of 64 KB, in a file of their own.
int open(const char* path, int flags, ...)
{
    int mode = 0;
    if (flags & (O_CREAT | O_TMPFILE)) { va_list arguments; va_start(arguments, flags); mode = va_arg(arguments, int); va_end(arguments); }
    int fd = syscall(SYS_openat, AT_FDCWD, path, flags, mode);
    if (fd < 0 || strcmp(path, "/proc/self/statm") || isOutside()) return fd;
    char counts[256], recounted[256];
    long length = syscall(SYS_read, fd, counts, sizeof counts - 1);
    int copy = length > 0 ? syscall(SYS_memfd_create, "statm", (flags & O_CLOEXEC) ? MFD_CLOEXEC : 0) : -1;
    if (copy < 0) { syscall(SYS_lseek, fd, 0, SEEK_SET); return fd; }
    syscall(SYS_close, fd);
    counts[length] = 0;
    size_t written = 0;
    for (char* at = counts; *at >= '0' && *at <= '9';) {
        unsigned long pages = strtoul(at, &at, 10);
        written += snprintf(recounted + written, sizeof recounted - written, "%lu%c", (pages * 4096 + PAGE - 1) / PAGE, *at == ' ' ? ' ' : '\n');
        if (*at == ' ') at++;
    }
    (void)!write(copy, recounted, written);
    syscall(SYS_lseek, copy, 0, SEEK_SET);
    return copy;
}
#if defined(__GLIBC__)
int open64(const char* path, int flags, ...)
{
    int mode = 0;
    if (flags & (O_CREAT | O_TMPFILE)) { va_list arguments; va_start(arguments, flags); mode = va_arg(arguments, int); va_end(arguments); }
    return open(path, flags, mode);
}
#endif

static void* rawMap(void* a, size_t l, int p, int f, int fd, off_t o) { return (void*)syscall(SYS_mmap, a, l, p, f, fd, o); }

void* mmap(void* address, size_t length, int protection, int flags, int fd, off_t offset)
{
    void* caller = __builtin_return_address(0);
    if (isOutside()) return rawMap(address, length, protection, flags, fd, offset);
    if (!length || (offset & (PAGE - 1)) || ((flags & (MAP_FIXED | MAP_FIXED_NOREPLACE)) && ((uintptr_t)address & (PAGE - 1)))) {
        refuse("mmap", address, length, offset, caller);
        errno = EINVAL;
        return MAP_FAILED;
    }
    size_t size = whole(length);
    if (flags & (MAP_FIXED | MAP_FIXED_NOREPLACE)) {
        if (fd < 0 || (flags & MAP_ANONYMOUS))
            return rawMap(address, size, protection, flags, fd, offset);
        // Behind the end of a file the rest of the last page reads as zeros.
        return rawMap(address, length, protection, flags, fd, offset);
    }
    // Room for the mapping at a multiple of the page, then the mapping itself over it.
    uint8_t* room = rawMap((void*)((uintptr_t)address & ~(PAGE - 1)), size + PAGE, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE, -1, 0);
    if (room == MAP_FAILED)
        return MAP_FAILED;
    uint8_t* start = (uint8_t*)(((uintptr_t)room + PAGE - 1) & ~(PAGE - 1));
    if (start > room) syscall(SYS_munmap, room, start - room);
    if (room + size + PAGE > start + size) syscall(SYS_munmap, start + size, room + size + PAGE - (start + size));
    void* result = rawMap(start, (fd < 0 || (flags & MAP_ANONYMOUS)) ? size : length, protection, flags | MAP_FIXED, fd, offset);
    if (result == MAP_FAILED) { int e = errno; syscall(SYS_munmap, start, size); errno = e; }
    return result;
}
#if defined(__GLIBC__)
void* mmap64(void* a, size_t l, int p, int f, int fd, off_t o) { return mmap(a, l, p, f, fd, o); }
#endif

#define ON_PAGES(name, number, ...) \
    if (isOutside()) return syscall(number, address, length, ##__VA_ARGS__); \
    if ((uintptr_t)address & (PAGE - 1)) { refuse(name, address, length, 0, __builtin_return_address(0)); errno = EINVAL; return -1; } \
    return syscall(number, address, whole(length), ##__VA_ARGS__);
int munmap(void* address, size_t length) { if (!length) { errno = EINVAL; return -1; } ON_PAGES("munmap", SYS_munmap) }
int mprotect(void* address, size_t length, int protection) { ON_PAGES("mprotect", SYS_mprotect, protection) }
int madvise(void* address, size_t length, int advice) { ON_PAGES("madvise", SYS_madvise, advice) }
int posix_madvise(void* address, size_t length, int advice) { (void)address; (void)length; (void)advice; return 0; }
int msync(void* address, size_t length, int flags) { ON_PAGES("msync", SYS_msync, flags) }
void* mremap(void* address, size_t oldLength, size_t newLength, int flags, ...)
{
    va_list arguments; va_start(arguments, flags); void* to = va_arg(arguments, void*); va_end(arguments);
    if (isOutside()) return (void*)syscall(SYS_mremap, address, oldLength, newLength, flags, to);
    if ((uintptr_t)address & (PAGE - 1)) { refuse("mremap", address, oldLength, 0, __builtin_return_address(0)); errno = EINVAL; return MAP_FAILED; }
    if ((flags & MREMAP_MAYMOVE) && !(flags & MREMAP_FIXED)) {
        // A move must land on a page's edge too: room first, then a fixed move.
        void* room = mmap(NULL, newLength, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE, -1, 0);
        if (room == MAP_FAILED) return MAP_FAILED;
        return (void*)syscall(SYS_mremap, address, whole(oldLength), whole(newLength), flags | MREMAP_FIXED, room);
    }
    return (void*)syscall(SYS_mremap, address, whole(oldLength), whole(newLength), flags, to);
}
