// Fourth test program for the portable image: one request after the other, with the
// answer that Linux gives. The same image runs on Linux by itself, where every check has
// to pass because the kernel is the measure, and under the hosts, which have to give the
// same answers. Exit code 42 means pass, and every check that fails is printed.
//
//   requests.img direct <scratch file>            on Linux
//   requests.img hosted <scratch file>            under a host that delivers signals (x86-64)
//   requests.img hosted-quiet <scratch file>      under a host that delivers none (arm64):
//                                                 the checks that need a handler are left out
//
// What it is for: the paths of the hosts that the big image does not take, above all the
// translations that only differ from the identity on macOS and Windows.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <sched.h>
#include <setjmp.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/sysinfo.h>
#include <sys/time.h>
#include <sys/uio.h>
#include <sys/utsname.h>
#include <time.h>
#include <ucontext.h>
#include <unistd.h>

static int failures, checks;
static void check(int ok, const char *name) {
  checks++;
  if (ok) return;
  failures++;
  printf("requests: FAILED %s (errno %d)\n", name, errno);
}

static double now(clockid_t clock) {
  struct timespec t;
  if (clock_gettime(clock, &t)) return -1;
  return t.tv_sec + t.tv_nsec / 1e9;
}

/* ---- faults ---- */
static sigjmp_buf back;
static volatile int fault_signal, fault_code, fault_skip, fault_expected;
static volatile uintptr_t fault_address, fault_pc;
static void on_fault(int sig, siginfo_t *info, void *context) {
  ucontext_t *uc = context;
  fault_signal = sig;
  fault_code = info->si_code;
  fault_address = (uintptr_t)info->si_addr;
#if defined(__x86_64__)
  fault_pc = (uintptr_t)uc->uc_mcontext.gregs[REG_RIP];
  if (fault_skip >= 0) {
    uc->uc_mcontext.gregs[REG_RIP] += fault_skip;
    return;
  }
#else
  fault_pc = uc->uc_mcontext.pc;
#endif
  /* A fault outside of faults(): there is nowhere to go back to. */
  if (!fault_expected) {
    char line[200];
    int n = snprintf(line, sizeof line, "requests: FAILED a fault that no check expects: signal %d, code %d, address %#lx, after %d checks\n", sig, fault_code, (unsigned long)fault_address, checks);
    if (n > 0 && write(1, line, (size_t)n) < 0) _exit(1);
    _exit(1);
  }
  fault_expected = 0;
  siglongjmp(back, 1);
}
/* 1 if the access faulted, and then fault_* say how. */
static int faults(volatile char *p, int write) {
  fault_signal = fault_code = 0;
  fault_skip = -1;
  if (sigsetjmp(back, 1)) return 1;
  fault_expected = 1;
  if (write) *p = 1;
  else (void)*p;
  fault_expected = 0;
  return 0;
}

#if defined(__x86_64__)
/* Each of them returns 7 after its instruction was stepped over by the handler. */
int fault_ud2(void), fault_divide(void), fault_int3(void), fault_hlt(void);
extern char fault_ud2_at[], fault_divide_at[], fault_int3_at[], fault_hlt_at[];
__asm__(".text\n"
        "fault_ud2: mov $7, %eax\n fault_ud2_at: ud2\n ret\n"
        "fault_divide: mov $7, %eax\n xor %edx, %edx\n xor %ecx, %ecx\n fault_divide_at: idiv %ecx\n mov $7, %eax\n ret\n"
        "fault_int3: mov $7, %eax\n fault_int3_at: int3\n ret\n"
        "fault_hlt: mov $7, %eax\n fault_hlt_at: hlt\n ret\n");
static const unsigned char code_42[] = {0xb8, 0x2a, 0x00, 0x00, 0x00, 0xc3}; /* mov $42, %eax; ret */
#else
static const uint32_t code_42[] = {0x52800540, 0xd65f03c0}; /* mov w0, #42; ret */
#endif

static void files(const char *path, int hosted) {
  char buf[64], other[64];
  unlink(path);
  int fd = open(path, O_CREAT | O_EXCL | O_RDWR, 0644);
  check(fd >= 0, "open O_CREAT|O_EXCL");
  check(open(path, O_CREAT | O_EXCL | O_RDWR, 0644) == -1 && errno == EEXIST, "open O_EXCL of a file that exists is EEXIST");
  check(write(fd, "0123456789", 10) == 10, "write");
  check(pwrite(fd, "AB", 2, 4) == 2 && lseek(fd, 0, SEEK_CUR) == 10, "pwrite leaves the position");
  check(pread(fd, buf, 4, 3) == 4 && !memcmp(buf, "3AB6", 4) && lseek(fd, 0, SEEK_CUR) == 10, "pread leaves the position");
  check(lseek(fd, -3, SEEK_END) == 7 && read(fd, buf, 8) == 3 && !memcmp(buf, "789", 3) && read(fd, buf, 8) == 0, "lseek SEEK_END, read to the end");
  struct iovec out[2] = {{"xy", 2}, {"z!", 2}}, in[2] = {{buf, 3}, {other, 8}};
  check(lseek(fd, 0, SEEK_SET) == 0 && writev(fd, out, 2) == 4, "writev");
  check(lseek(fd, 0, SEEK_SET) == 0 && readv(fd, in, 2) == 10 && !memcmp(buf, "xyz", 3) && !memcmp(other, "!AB6789", 7), "readv");
  struct stat st;
  check(!fstat(fd, &st) && S_ISREG(st.st_mode) && st.st_size == 10 && st.st_mtime > 1700000000, "fstat of a file");
  check(!ftruncate(fd, 4) && !fstat(fd, &st) && st.st_size == 4, "ftruncate");
  check(!stat(path, &st) && S_ISREG(st.st_mode) && st.st_size == 4, "stat of a file");
  check(!access(path, F_OK) && !access(path, R_OK | W_OK), "access");
  check(readlink(path, buf, sizeof buf) == -1 && errno == EINVAL, "readlink of a file is EINVAL");
  int copy = dup(fd), high = fcntl(fd, F_DUPFD, 100), at = dup2(fd, 77);
  check(copy > fd && high >= 100 && at == 77, "dup, F_DUPFD, dup2");
  check(lseek(copy, 1, SEEK_SET) == 1 && lseek(fd, 0, SEEK_CUR) == 1 && read(high, buf, 1) == 1 && buf[0] == 'y' && lseek(at, 0, SEEK_CUR) == 2, "the copies share the position");
  check(!close(copy) && !close(high) && !close(at) && lseek(fd, 0, SEEK_CUR) == 2, "close of the copies");
  check(fcntl(fd, F_GETFD) == 0 && !fcntl(fd, F_SETFD, FD_CLOEXEC) && fcntl(fd, F_GETFD) == FD_CLOEXEC, "F_SETFD, F_GETFD");
  check((fcntl(fd, F_GETFL) & O_ACCMODE) == O_RDWR, "F_GETFL");
  check(!close(fd) && close(fd) == -1 && errno == EBADF, "close, and close again is EBADF");
  fd = open(path, O_WRONLY | O_APPEND);
  check(fd >= 0 && (fcntl(fd, F_GETFL) & O_APPEND) && lseek(fd, 0, SEEK_SET) == 0 && write(fd, "++", 2) == 2 && !fstat(fd, &st) && st.st_size == 6, "O_APPEND writes at the end");
  close(fd);

  check(getcwd(buf, 2) == 0 && errno == ERANGE, "getcwd into a buffer that is too small is ERANGE");
  char cwd[4096];
  check(getcwd(cwd, sizeof cwd) == cwd && cwd[0] == '/', "getcwd");
  check(!stat(cwd, &st) && S_ISDIR(st.st_mode), "stat of the working directory");
  fd = open(cwd, O_RDONLY | O_DIRECTORY);
  check(fd >= 0 && !fstat(fd, &st) && S_ISDIR(st.st_mode), "open of a directory");
  close(fd);
  check(open(path, O_RDONLY | O_DIRECTORY) == -1 && errno == ENOTDIR, "O_DIRECTORY of a file is ENOTDIR");
  check(open("no/such/file", O_RDONLY) == -1 && errno == ENOENT && stat("no/such/file", &st) == -1 && errno == ENOENT && access("no/such/file", F_OK) == -1 && errno == ENOENT,
        "a file that does not exist is ENOENT");
  if (hosted) check(open("/proc/self/status", O_RDONLY) == -1 && errno == ENOENT && access("/sys/kernel", F_OK) == -1 && errno == ENOENT, "/proc and /sys do not exist under a host");

  fd = open("/dev/null", O_RDWR);
  check(fd >= 0 && write(fd, "gone", 4) == 4 && read(fd, buf, 4) == 0 && !fstat(fd, &st) && S_ISCHR(st.st_mode), "/dev/null");
  close(fd);
  fd = open("/dev/urandom", O_RDONLY);
  memset(buf, 0, 32);
  memset(other, 0, 32);
  check(fd >= 0 && read(fd, buf, 32) == 32 && memcmp(buf, other, 32) && !fstat(fd, &st) && S_ISCHR(st.st_mode), "/dev/urandom");
  close(fd);

  fd = open(path, O_RDONLY);
  char *map = mmap(0, 6, PROT_READ, MAP_PRIVATE, fd, 0);
  check(map != MAP_FAILED && !memcmp(map, "xyz!++", 6), "mmap of a file");
  if (map != MAP_FAILED) munmap(map, 6);
  close(fd);
  check(!unlink(path) && access(path, F_OK) == -1 && errno == ENOENT && unlink(path) == -1 && errno == ENOENT, "unlink");
}

static void times(void) {
  check(now(CLOCK_REALTIME) > 1700000000.0, "CLOCK_REALTIME");
  double m0 = now(CLOCK_MONOTONIC), p0 = now(CLOCK_PROCESS_CPUTIME_ID), t0 = now(CLOCK_THREAD_CPUTIME_ID);
  volatile unsigned long spin = 0;
  while (now(CLOCK_THREAD_CPUTIME_ID) - t0 < 0.03 && spin < 4000000000ul) spin++;
  check(m0 >= 0 && now(CLOCK_MONOTONIC) > m0, "CLOCK_MONOTONIC goes on");
  check(p0 >= 0 && t0 >= 0 && now(CLOCK_PROCESS_CPUTIME_ID) > p0 && now(CLOCK_THREAD_CPUTIME_ID) >= t0 + 0.03, "the clocks of processor time go on with work");
  struct timespec res = {0, 0};
  check(!clock_getres(CLOCK_MONOTONIC, &res) && res.tv_sec == 0 && res.tv_nsec > 0 && !clock_getres(CLOCK_REALTIME, &res) && res.tv_nsec > 0, "clock_getres");
  check(clock_gettime(1234, &res) == -1 && errno == EINVAL, "a clock that does not exist is EINVAL");
  struct timespec pause = {0, 30000000};
  m0 = now(CLOCK_MONOTONIC);
  check(!nanosleep(&pause, 0) && now(CLOCK_MONOTONIC) - m0 >= 0.029, "nanosleep");
  struct timespec until;
  clock_gettime(CLOCK_MONOTONIC, &until);
  m0 = until.tv_sec + until.tv_nsec / 1e9;
  until.tv_nsec += 30000000;
  if (until.tv_nsec >= 1000000000) { until.tv_nsec -= 1000000000; until.tv_sec++; }
  check(!clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &until, 0) && now(CLOCK_MONOTONIC) - m0 >= 0.029, "clock_nanosleep until a point of time");
  clock_gettime(CLOCK_MONOTONIC, &until);
  until.tv_sec -= 1;
  m0 = now(CLOCK_MONOTONIC);
  check(!clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &until, 0) && now(CLOCK_MONOTONIC) - m0 < 0.5, "clock_nanosleep until a point that has passed");
  struct timeval tv;
  check(!gettimeofday(&tv, 0) && tv.tv_sec > 1700000000 && tv.tv_usec >= 0 && tv.tv_usec < 1000000, "gettimeofday");
}

static void system_requests(void) {
  struct utsname u;
  check(!uname(&u) && !strcmp(u.sysname, "Linux") && u.machine[0] && u.release[0], "uname");
  struct rusage r;
  /* Some kernels report no memory at all here (seen: 0 in a container), so 0 is an answer. */
  check(!getrusage(RUSAGE_SELF, &r) && r.ru_maxrss >= 0 && r.ru_utime.tv_sec >= 0 && r.ru_utime.tv_usec >= 0 && r.ru_utime.tv_usec < 1000000, "getrusage");
  check(!getrusage(RUSAGE_THREAD, &r) && r.ru_utime.tv_sec >= 0, "getrusage of the thread");
  struct rlimit l;
  check(!getrlimit(RLIMIT_NOFILE, &l) && l.rlim_cur >= 64 && l.rlim_cur <= l.rlim_max, "getrlimit of open files");
  check(!getrlimit(RLIMIT_STACK, &l) && l.rlim_cur >= 65536, "getrlimit of the stack");
  check(getrlimit(1234, &l) == -1 && errno == EINVAL, "a limit that does not exist is EINVAL");
  struct sysinfo s;
  check(!sysinfo(&s) && s.totalram > 0 && s.mem_unit > 0 && (unsigned long long)s.freeram <= (unsigned long long)s.totalram, "sysinfo");
  check(sysconf(_SC_NPROCESSORS_ONLN) >= 1 && sysconf(_SC_PAGESIZE) >= 4096, "sysconf: processors and page size");
  cpu_set_t set;
  check(!sched_getaffinity(0, sizeof set, &set) && CPU_COUNT(&set) == sysconf(_SC_NPROCESSORS_ONLN), "sched_getaffinity");
  check(getpid() > 0 && gettid() == getpid() && getppid() > 0, "getpid, gettid of the main thread, getppid");
  check(!sched_yield(), "sched_yield");
  unsigned char random_bytes[64] = {0}, zero[64] = {0};
  check(getentropy(random_bytes, sizeof random_bytes) == 0 && memcmp(random_bytes, zero, sizeof zero), "getentropy");
  stack_t stack, old;
  static char signal_stack[65536];
  stack.ss_sp = signal_stack;
  stack.ss_size = sizeof signal_stack;
  stack.ss_flags = 0;
  check(!sigaltstack(&stack, &old) && (old.ss_flags & SS_DISABLE) && !sigaltstack(0, &old) && old.ss_sp == (void *)signal_stack && old.ss_size == sizeof signal_stack, "sigaltstack");
  stack.ss_flags = SS_DISABLE;
  check(!sigaltstack(&stack, 0) && !sigaltstack(0, &old) && (old.ss_flags & SS_DISABLE), "sigaltstack, off again");
  /* SIGURG and SIGCHLD: their default is that nothing happens. */
  check(!kill(getpid(), SIGURG) && !raise(SIGCHLD) && !kill(getpid(), 0), "signals that are ignored by default");
}

/* Two mappings that are neighbours: the first ends where the second starts. Linux does
   not care where a mapping ends. A host that keeps reservations, which Windows makes it
   do, has to cut every request that goes over the border in two. */
static unsigned char *neighbours(size_t first, size_t second, int flags) {
  size_t slack = 1 << 20;
  unsigned char *area = mmap(0, first + second + slack, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if (area == MAP_FAILED) return 0;
  unsigned char *n = (unsigned char *)(((uintptr_t)area + slack - 1) & ~(uintptr_t)(slack - 1));
  munmap(area, first + second + slack);
  if (mmap(n, first, PROT_READ | PROT_WRITE, flags | MAP_FIXED_NOREPLACE, -1, 0) != (void *)n) return 0;
  if (mmap(n + first, second, PROT_READ | PROT_WRITE, flags | MAP_FIXED_NOREPLACE, -1, 0) != (void *)(n + first)) return 0;
  return n;
}
static void borders(int handlers) {
  size_t page = (size_t)sysconf(_SC_PAGESIZE), border = 1 << 20;
  unsigned char *n = neighbours(border, border, MAP_PRIVATE | MAP_ANONYMOUS);
  check(n != 0, "two mappings that are neighbours");
  if (n) {
    memset(n, 0x77, 2 * border);
    check(!mprotect(n + border - 2 * page, 4 * page, PROT_READ) && n[border - 1] == 0x77 && n[border] == 0x77, "mprotect over the border of two mappings keeps the content");
    if (handlers)
      check(faults((char *)n + border - 1, 1) && fault_code == SEGV_ACCERR && faults((char *)n + border, 1) && fault_code == SEGV_ACCERR, "both sides of the border are read only");
    check(!mprotect(n + border - 2 * page, 4 * page, PROT_READ | PROT_WRITE), "mprotect back over the border");
    n[border - 1] = 1;
    n[border] = 2;
    check(n[border - 1] == 1 && n[border] == 2, "both sides of the border can be written again");
    check(!madvise(n + border - 2 * page, 4 * page, MADV_DONTNEED) && !n[border - 2 * page] && !n[border - 1] && !n[border] && !n[border + 2 * page - 1] &&
            n[border - 2 * page - 1] == 0x77 && n[border + 2 * page] == 0x77,
          "MADV_DONTNEED over the border: zero pages on both sides, the neighbours stay");
    memset(n + border - 2 * page, 0x78, 4 * page);
    check(mmap(n + border - page, 2 * page, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_FIXED, -1, 0) == (void *)(n + border - page) && !n[border - 1] && !n[border] &&
            n[border - page - 1] == 0x78 && n[border + page] == 0x78,
          "MAP_FIXED over the border: zero pages, the neighbours stay");
    check(!munmap(n + border - page, 2 * page) && n[border - page - 1] == 0x78 && n[border + page] == 0x78, "munmap over the border leaves the neighbours");
    if (handlers) check(faults((char *)n + border, 0) && fault_code == SEGV_MAPERR, "nothing is mapped at the border after that");
    check(!munmap(n, 2 * border), "munmap of both neighbours in one request");
  }

  /* Address space that is used where it is touched, as the allocators of the big image have
     it. The host commits in pieces of 1 MiB there, and this border is inside of one. */
  size_t large = ((size_t)64 << 20) + 65536, other = (size_t)64 << 20;
  n = neighbours(large, other, MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE);
  check(n != 0, "two large neighbours with MAP_NORESERVE");
  if (n) {
    if (handlers) check(!faults((char *)n + large - 1, 1) && !faults((char *)n + large, 1), "first touch of the pages at the border of two mappings");
    else n[large - 1] = n[large] = 1;
    check(n[large - 1] == 1 && n[large] == 1 && !n[large - 2] && !n[large + 1], "the pages at the border have what was written");
    check(!munmap(n, large + other), "munmap of the large neighbours");
  }
  n = neighbours(border, border, MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE);
  check(n != 0, "two neighbours with MAP_NORESERVE");
  if (n) {
    int fd = open("/dev/urandom", O_RDONLY);
    check(fd >= 0 && read(fd, n + border - 3 * page, 6 * page) == (ssize_t)(6 * page), "read() into pages on both sides of a border that were never touched");
    close(fd);
    check(!munmap(n, 2 * border), "munmap of the neighbours");
  }
}

/* What a handler changes in the mask of its context is the mask of the thread afterwards. */
static void on_signal_block_other(int sig, siginfo_t *info, void *context) {
  ucontext_t *uc = context;
  (void)sig; (void)info;
  sigaddset(&uc->uc_sigmask, SIGUSR2);
}
static void masks(void) {
  struct sigaction sa;
  sigset_t now, other;
  memset(&sa, 0, sizeof sa);
  sa.sa_sigaction = on_signal_block_other;
  sa.sa_flags = SA_SIGINFO;
  sigemptyset(&other);
  sigaddset(&other, SIGUSR2);
  check(!sigprocmask(SIG_UNBLOCK, &other, 0) && !sigaction(SIGUSR1, &sa, 0) && !raise(SIGUSR1) && !sigprocmask(SIG_BLOCK, 0, &now) && sigismember(&now, SIGUSR2) == 1 &&
          sigismember(&now, SIGUSR1) == 0,
        "a handler blocks a signal in its context, and the thread has it blocked afterwards");
  check(!sigprocmask(SIG_UNBLOCK, &other, 0) && !sigprocmask(SIG_BLOCK, 0, &now) && sigismember(&now, SIGUSR2) == 0, "unblocked again");
  signal(SIGUSR1, SIG_DFL);
}

static void memory(int handlers) {
  size_t page = (size_t)sysconf(_SC_PAGESIZE), size = 64 * page;
  unsigned char *p = mmap(0, size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  check(p != MAP_FAILED, "mmap");
  if (p == MAP_FAILED) return;
  int zero = 1;
  for (size_t i = 0; i < size; i += 509) zero &= !p[i];
  check(zero, "a new mapping is zero");
  memset(p, 0x5a, size);
  check(!madvise(p + 8 * page, 8 * page, MADV_DONTNEED) && p[8 * page] == 0 && p[16 * page - 1] == 0 && p[8 * page - 1] == 0x5a && p[16 * page] == 0x5a, "MADV_DONTNEED gives zero pages and leaves the neighbours");
  p[8 * page] = 1;
  check(p[8 * page] == 1, "a page is usable after MADV_DONTNEED");
  check(mmap(p + 24 * page, 8 * page, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_FIXED, -1, 0) == (void *)(p + 24 * page) && p[24 * page] == 0 && p[32 * page - 1] == 0 &&
          p[24 * page - 1] == 0x5a && p[32 * page] == 0x5a,
        "MAP_FIXED inside of a mapping gives zero pages and leaves the neighbours");
  check(!mprotect(p + 40 * page, page, PROT_READ) && p[40 * page] == 0x5a, "mprotect to read only keeps the content");
  if (handlers) {
    check(faults((char *)p + 40 * page + 5, 1) && fault_signal == SIGSEGV && fault_code == SEGV_ACCERR && fault_address == (uintptr_t)p + 40 * page + 5, "a write to a page that is read only: SIGSEGV, SEGV_ACCERR");
    check(!faults((char *)p + 40 * page + 5, 0), "a read of a page that is read only");
  }
  check(!mprotect(p + 40 * page, page, PROT_NONE) && !mprotect(p + 40 * page, page, PROT_READ | PROT_WRITE) && p[40 * page] == 0x5a, "mprotect to no access and back keeps the content");
  check(!munmap(p + 48 * page, 8 * page) && p[48 * page - 1] == 0x5a && p[56 * page] == 0x5a, "munmap of a part leaves the neighbours");
  if (handlers) check(faults((char *)p + 50 * page, 0) && fault_signal == SIGSEGV && fault_code == SEGV_MAPERR && fault_address == (uintptr_t)p + 50 * page, "a read where the part was: SIGSEGV, SEGV_MAPERR");
  check(mprotect(p + 44 * page, 8 * page, PROT_READ) == -1 && errno == ENOMEM, "mprotect over a hole is ENOMEM");
  check(!munmap(p, size), "munmap of the rest, the hole included");

  /* What the allocators and the JIT of the big image do: much address space, little of it used. */
  size_t big = (size_t)4 << 30;
  unsigned char *b = mmap(0, big, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE, -1, 0);
  check(b != MAP_FAILED, "mmap of 4 GiB with MAP_NORESERVE");
  if (b != MAP_FAILED) {
    int ok = 1;
    for (size_t at = 0; at < big; at += big / 5 + 12345) {
      ok &= b[at] == 0;
      b[at] = (unsigned char)(at >> 20 | 1);
    }
    for (size_t at = 0; at < big; at += big / 5 + 12345) ok &= b[at] == (unsigned char)(at >> 20 | 1);
    check(ok, "pages of it, far from each other");
    /* The kernel of the host writes into a page that nothing has touched yet. */
    int fd = open("/dev/urandom", O_RDONLY);
    check(fd >= 0 && read(fd, b + big / 2 + 100, 3 * page) == (ssize_t)(3 * page), "read() into pages that were never touched");
    close(fd);
    struct timespec *ts = (void *)(b + big / 3);
    check(!clock_gettime(CLOCK_MONOTONIC, ts) && ts->tv_sec + ts->tv_nsec > 0, "clock_gettime() into a page that was never touched");
    check(!munmap(b, big), "munmap of the 4 GiB");
  }
  unsigned char *r = mmap(0, 64 << 20, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  check(r != MAP_FAILED && !mprotect(r + (8 << 20), 1 << 20, PROT_READ | PROT_WRITE), "reserve without access, then a part with access");
  if (r != MAP_FAILED) {
    memset(r + (8 << 20), 0x33, 1 << 20);
    check(r[(8 << 20) + 4097] == 0x33, "the part is usable");
    if (handlers) check(faults((char *)r + (9 << 20), 0) && fault_code == SEGV_ACCERR, "after the part: SIGSEGV, SEGV_ACCERR");
    check(!madvise(r + (8 << 20), 1 << 20, MADV_DONTNEED) && !mprotect(r + (8 << 20), 1 << 20, PROT_NONE) && !mprotect(r + (8 << 20), 1 << 20, PROT_READ | PROT_WRITE) && r[(8 << 20) + 4097] == 0,
          "decommit the way of JavaScriptCore (MADV_DONTNEED, no access), commit again: zero");
    munmap(r, 64 << 20);
  }
  /* More ranges than the first table of a host holds: every second page is read only. */
  size_t many = 3000;
  unsigned char *m = mmap(0, many * page, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  check(m != MAP_FAILED, "mmap for many ranges");
  if (m != MAP_FAILED) {
    int kept = 1, protected = 1;
    for (size_t i = 0; i < many; i++) m[i * page] = (unsigned char)(i % 251);
    for (size_t i = 1; i < many; i += 2) protected &= !mprotect(m + i * page, page, PROT_READ);
    for (size_t i = 0; i < many; i++) kept &= m[i * page] == (unsigned char)(i % 251);
    check(protected && kept, "3000 ranges that differ from their neighbours, and the content stays");
    if (handlers) check(faults((char *)m + (many - 1) * page, 1) && fault_code == SEGV_ACCERR && !faults((char *)m + (many - 2) * page, 1), "the last two of them are what was asked for");
    check(!munmap(m, many * page), "munmap of all of them in one request");
  }
  unsigned char *x = mmap(0, 1 << 20, PROT_READ | PROT_WRITE | PROT_EXEC, MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE, -1, 0);
  check(x != MAP_FAILED, "mmap with read, write and execute");
  if (x != MAP_FAILED) {
    memcpy(x + 70000, code_42, sizeof code_42);
    __builtin___clear_cache((char *)x + 70000, (char *)x + 70000 + sizeof code_42);
    check(((int (*)(void))(x + 70000))() == 42, "code that was written at run time runs");
    munmap(x, 1 << 20);
  }
}

static void fault_kinds(void) {
#if defined(__x86_64__)
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_sigaction = on_fault;
  sa.sa_flags = SA_SIGINFO;
  check(!sigaction(SIGILL, &sa, 0) && !sigaction(SIGFPE, &sa, 0) && !sigaction(SIGTRAP, &sa, 0), "sigaction for SIGILL, SIGFPE, SIGTRAP");
  fault_signal = 0;
  fault_skip = 2;
  check(fault_ud2() == 7 && fault_signal == SIGILL && fault_code == ILL_ILLOPN && fault_address == (uintptr_t)fault_ud2_at && fault_pc == (uintptr_t)fault_ud2_at, "ud2: SIGILL, ILL_ILLOPN, at the instruction");
  fault_signal = 0;
  fault_skip = 2;
  check(fault_divide() == 7 && fault_signal == SIGFPE && fault_code == FPE_INTDIV && fault_address == (uintptr_t)fault_divide_at && fault_pc == (uintptr_t)fault_divide_at, "division by zero: SIGFPE, FPE_INTDIV, at the instruction");
  fault_signal = 0;
  fault_skip = 0;
  check(fault_int3() == 7 && fault_signal == SIGTRAP && fault_code == SI_KERNEL && fault_pc == (uintptr_t)fault_int3_at + 1, "int3: SIGTRAP, SI_KERNEL, after the instruction");
  fault_signal = 0;
  fault_skip = 1;
  check(fault_hlt() == 7 && fault_signal == SIGSEGV && fault_code == SI_KERNEL && fault_address == 0 && fault_pc == (uintptr_t)fault_hlt_at, "hlt: SIGSEGV, SI_KERNEL, no address, at the instruction");
  signal(SIGILL, SIG_DFL);
  signal(SIGFPE, SIG_DFL);
  signal(SIGTRAP, SIG_DFL);
#endif
}

int main(int argc, char **argv) {
  const char *mode = argc > 1 ? argv[1] : "direct", *path = argc > 2 ? argv[2] : "requests.tmp";
  int hosted = strcmp(mode, "direct") != 0, handlers = strcmp(mode, "hosted-quiet") != 0;
  if (handlers) {
    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_sigaction = on_fault;
    sa.sa_flags = SA_SIGINFO;
    check(!sigaction(SIGSEGV, &sa, 0) && !sigaction(SIGBUS, &sa, 0), "sigaction for SIGSEGV");
  }
  files(path, hosted);
  times();
  system_requests();
  if (handlers) masks();
  memory(handlers);
  borders(handlers);
  if (handlers) fault_kinds();
  printf("requests: mode=%s checks=%d failures=%d\n", mode, checks, failures);
  return failures ? 1 : 42;
}
