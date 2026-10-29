// LD_PRELOAD shim: counts the calls a process makes through libc that matter for a pool round trip,
// and prints the totals to the file named by COUNTS_OUT when the process exits.
//   futex wake / futex wait (libc syscall()), sched_yield(), 8-byte write() and read() (eventfd wakeups)
// Columns: main thread, work pool threads ("Bun Pool"), other threads.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <linux/futex.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/mman.h>
enum { WAKE, WAIT, YIELD, WRITE8, READ8, KINDS };
static _Atomic unsigned long local[KINDS][3];
static _Atomic unsigned long (*n)[3] = local;
static __thread int cls = -1;
static pid_t main_tid;
static long raw6(long nr, long a, long b, long c, long d, long e, long f) {
  long ret; register long r10 __asm__("r10") = d; register long r8 __asm__("r8") = e; register long r9 __asm__("r9") = f;
  __asm__ volatile("syscall" : "=a"(ret) : "a"(nr), "D"(a), "S"(b), "d"(c), "r"(r10), "r"(r8), "r"(r9) : "rcx", "r11", "memory");
  return ret;
}
static inline int my_class(void) {
  if (cls < 0) {
    if (raw6(SYS_gettid, 0, 0, 0, 0, 0, 0) == main_tid) cls = 0;
    else { char name[17] = {0}; prctl(PR_GET_NAME, name, 0, 0, 0); if (!strncmp(name, "Bun Pool", 8)) cls = 1; else return 2; }
  }
  return cls;
}
static inline void count(int kind) { atomic_fetch_add_explicit(&n[kind][my_class()], 1, memory_order_relaxed); }
// The counters live in the file: the process may exit without running destructors.
__attribute__((constructor)) static void init(void) {
  main_tid = raw6(SYS_gettid, 0, 0, 0, 0, 0, 0);
  const char *path = getenv("COUNTS_OUT"); if (!path) return;
  int fd = open(path, O_RDWR | O_CREAT | O_TRUNC, 0644); if (fd < 0) return;
  if (ftruncate(fd, 4096)) return;
  void *m = mmap(NULL, 4096, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0); if (m == MAP_FAILED) return;
  n = m; close(fd);
}
long syscall(long nr, ...) {
  va_list ap; va_start(ap, nr);
  long a = va_arg(ap, long), b = va_arg(ap, long), c = va_arg(ap, long), d = va_arg(ap, long), e = va_arg(ap, long), f = va_arg(ap, long);
  va_end(ap);
  if (nr == SYS_futex) {
    int op = (int)b & FUTEX_CMD_MASK;
    if (op == FUTEX_WAKE || op == FUTEX_WAKE_BITSET) count(WAKE);
    else if (op == FUTEX_WAIT || op == FUTEX_WAIT_BITSET) count(WAIT);
  }
  long ret = raw6(nr, a, b, c, d, e, f);
  if (ret < 0 && ret > -4096) { extern int *__errno_location(void); *__errno_location() = (int)-ret; return -1; }
  return ret;
}
int sched_yield(void) { count(YIELD); return (int)raw6(SYS_sched_yield, 0, 0, 0, 0, 0, 0); }
ssize_t write(int fd, const void *buf, size_t len) {
  if (len == 8) count(WRITE8);
  long ret = raw6(SYS_write, fd, (long)buf, (long)len, 0, 0, 0);
  if (ret < 0) { extern int *__errno_location(void); *__errno_location() = (int)-ret; return -1; }
  return ret;
}
ssize_t read(int fd, void *buf, size_t len) {
  if (len == 8) count(READ8);
  long ret = raw6(SYS_read, fd, (long)buf, (long)len, 0, 0, 0);
  if (ret < 0) { extern int *__errno_location(void); *__errno_location() = (int)-ret; return -1; }
  return ret;
}
