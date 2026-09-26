// POSIX host for the portable image (x86-64 and arm64): macOS, and Linux as a test host.
// The image keeps the Linux ABI. This host maps it, builds the start stack and
// answers Linux syscall numbers with the native libc. Every structure that the
// image sees is declared in linux_abi.h and filled field by field: on macOS
// the native ones differ, on Linux they happen to agree, and both take the same
// way through the translation functions ("hosted" mode, which lets most of this
// file be tested on Linux). The host has the architecture of the image.
//
// Environment:
//   BUN_HOST_TRACE=1|2     1: every request that the host refuses, 2: every request
//   BUN_HOST_COUNTS=file   at exit: how often every request number arrived
//   BUN_HOST_PATHS=file    every path that the image hands over, with the answer
//   BUN_HOST_FORWARD=1     linux only, for taking stock: a request that the host does not
//                          know goes to the kernel as it is. The counts tell which ones did.
//   BUN_HOST_SECCOMP=0     linux x86-64 only: do not install the filter that kills the
//                          process when code outside of the host issues a syscall
//   BUN_HOST_TEST=winmem   run the memory model of the Windows host (memory.h) on top of
//                          mmap and mprotect
//   BUN_HOST_TEST=overlay  linux: discard pages (MADV_DONTNEED) the way the macOS branch does
//   BUN_HOST_TEST=macos-tp arm64 linux only, see "x18" below
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/uio.h>
#include <sys/utsname.h>
#include <time.h>
#include <unistd.h>

#ifdef __APPLE__
#include <sys/random.h>
#if __has_include(<sys/sysctl.h>)
#include <sys/sysctl.h>
#endif
#define MAP_ANON_HOST MAP_ANON
int __ulock_wait(uint32_t operation, void *addr, uint64_t value, uint32_t timeout_us);
int __ulock_wake(uint32_t operation, void *addr, uint64_t wake_value);
#else
#include <sched.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/sysinfo.h>
#define MAP_ANON_HOST MAP_ANONYMOUS
#endif

#include "linux_abi.h"

extern char **environ;

typedef int (*ImageThreadFn)(void *);
typedef long HostSyscall(long, long, long, long, long, long, long);
typedef long HostThreadCreate(ImageThreadFn, void *, long, void *, int *, void *, int *);
typedef void HostThreadExit(void *, unsigned long);
struct bun_host {
  unsigned long os, tcb_offset;
  HostSyscall *syscall;
  HostThreadCreate *thread_create;
  HostThreadExit *thread_exit;
};

/* Signals reach the image on x86-64. The arm64 image gets its handlers
   recorded and never called, as before. */
#if defined(__x86_64__)
#define DELIVERS_SIGNALS 1
#else
#define DELIVERS_SIGNALS 0
#endif

/* ---- stack switch ---- */
#if defined(__x86_64__)
struct context { void *rbx, *rbp, *r12, *r13, *r14, *r15, *rsp; };

__attribute__((naked)) static void enter_image_stack(struct context *save, void *sp, void (*fn)(void *), void *arg) {
  __asm__("mov %rbx, 0(%rdi)\n mov %rbp, 8(%rdi)\n mov %r12, 16(%rdi)\n mov %r13, 24(%rdi)\n"
          "mov %r14, 32(%rdi)\n mov %r15, 40(%rdi)\n mov %rsp, 48(%rdi)\n"
          "mov %rsi, %rsp\n mov %rcx, %rdi\n xor %ebp, %ebp\n call *%rdx\n ud2\n");
}
__attribute__((naked)) static void return_to_host(struct context *save) {
  __asm__("mov 0(%rdi), %rbx\n mov 8(%rdi), %rbp\n mov 16(%rdi), %r12\n mov 24(%rdi), %r13\n"
          "mov 32(%rdi), %r14\n mov 40(%rdi), %r15\n mov 48(%rdi), %rsp\n ret\n");
}
/* x18 is for the arm64 linux test host. */
__attribute__((naked)) static void enter_image(void *entry, void *sp, void *x18) {
  __asm__("mov %rsi, %rsp\n xor %ebp, %ebp\n xor %edx, %edx\n jmp *%rdi\n");
}
#else
/* What a callee keeps: x19 to x28, x29, x30 (the way back), sp, and d8 to d15. */
struct context { void *x19_to_x30[12], *sp; uint64_t d8_to_d15[8]; };

__attribute__((naked)) static void enter_image_stack(struct context *save, void *sp, void (*fn)(void *), void *arg) {
  __asm__("stp x19, x20, [x0, #0]\n stp x21, x22, [x0, #16]\n stp x23, x24, [x0, #32]\n stp x25, x26, [x0, #48]\n"
          "stp x27, x28, [x0, #64]\n stp x29, x30, [x0, #80]\n mov x9, sp\n str x9, [x0, #96]\n"
          "stp d8, d9, [x0, #104]\n stp d10, d11, [x0, #120]\n stp d12, d13, [x0, #136]\n stp d14, d15, [x0, #152]\n"
          "mov sp, x1\n mov x0, x3\n mov x29, #0\n blr x2\n brk #1\n");
}
__attribute__((naked)) static void return_to_host(struct context *save) {
  __asm__("ldp x19, x20, [x0, #0]\n ldp x21, x22, [x0, #16]\n ldp x23, x24, [x0, #32]\n ldp x25, x26, [x0, #48]\n"
          "ldp x27, x28, [x0, #64]\n ldp x29, x30, [x0, #80]\n ldr x9, [x0, #96]\n mov sp, x9\n"
          "ldp d8, d9, [x0, #104]\n ldp d10, d11, [x0, #120]\n ldp d12, d13, [x0, #136]\n ldp d14, d15, [x0, #152]\n"
          "ret\n");
}
#endif

/* ---- x18, arm64 linux test host only ----
   On Windows arm64 x18 is the TEB, and the image reads its thread pointer at
   [x18 + tcb_offset] (host table os = 2). That path is tested here, on linux,
   where the libc of the host owns tpidr_el0: every thread has a block that
   stands for the TEB, and x18 holds its address while image code runs.

   Windows keeps x18 for us. Linux does not: x18 is a scratch register there,
   so the code of this host and of its libc may overwrite it. The image never
   writes it (-ffixed-x18). So this host loads x18 at the two places where it
   enters image code (enter_image for the main thread, call_image for the
   others), and the three functions of the host table are entered through a
   shim (IMAGE_ENTRY) that keeps x18 in its frame and puts it back before it
   returns into image code.

   So that a missing reload cannot go unseen, the host functions overwrite x18
   themselves (FORGET_X18) as soon as they run. */
#if defined(__aarch64__) && !defined(__APPLE__)
#define X18_HOST 1
#define IMAGE_ENTRY(name) \
  __attribute__((naked)) static void name##_entry(void) { \
    __asm__("stp x29, x30, [sp, #-32]!\n mov x29, sp\n str x18, [sp, #16]\n bl " #name "\n" \
            "ldr x18, [sp, #16]\n ldp x29, x30, [sp], #32\n ret\n"); \
  }
#define FORGET_X18() __asm__ __volatile__("mov x18, #0xdead" : : : "x18")
__attribute__((naked)) static void enter_image(void *entry, void *sp, void *x18) {
  __asm__("mov x18, x2\n mov sp, x1\n mov x29, #0\n mov x30, #0\n br x0\n");
}
/* The image function returns to the caller of call_image. */
__attribute__((naked)) static int call_image(ImageThreadFn fn, void *arg, void *x18) {
  __asm__("mov x18, x2\n mov x16, x0\n mov x0, x1\n br x16\n");
}
#else
#define X18_HOST 0
#define FORGET_X18() ((void)0)
static int call_image(ImageThreadFn fn, void *arg, void *x18) { (void)x18; return fn(arg); }
#if defined(__aarch64__)
__attribute__((naked)) static void enter_image(void *entry, void *sp, void *x18) {
  __asm__("mov sp, x1\n mov x29, #0\n mov x30, #0\n br x0\n");
}
#endif
#endif

struct host_thread {
  struct context ctx;
  ImageThreadFn fn;
  void *arg, *tls, *stack_top;
  int *ctid;
  void *unmap_base;
  size_t unmap_size;
  void *x18;
  int tid;
  struct l_stack altstack;
  uintptr_t fault_address;
  int fault_repeats;
  unsigned sent; /* bit n: this host sent signal n of the host to the thread, and it has not arrived yet */
};

static pthread_key_t tp_key, thread_key;
static int trace, forward_unknown, test_winmem, test_overlay;
static long host_page;
static int main_tid;
static struct host_thread main_thread;
static uintptr_t image_base, image_end, main_stack_low, main_stack_high;

/* Not stdio: the host may be inside of stdio when a signal handler of the image asks for something. */
__attribute__((format(printf, 1, 2))) static void host_log(const char *format, ...) {
  char line[1024];
  va_list ap;
  va_start(ap, format);
  int n = vsnprintf(line, sizeof line, format, ap);
  va_end(ap);
  if (n > (int)sizeof line - 1) n = sizeof line - 1;
  if (n > 0 && write(2, line, (size_t)n) < 0) return;
}

/* ---- thread pointer slot ---- */
#if defined(__APPLE__)
/* macOS: the slot is a pthread key. The keys of a thread are an array at the
   thread register: gs on x86-64, tpidrro_el0 without its low 3 bits on arm64
   (xnu, libsyscall/os/tsd.h). main() checks that before it starts the image. */
#define HOST_OS BUN_OS_MACOS
static unsigned long slot_offset(void) { return (unsigned long)tp_key * 8; }
static void slot_set(void *tp) { pthread_setspecific(tp_key, tp); }
static void *thread_x18(void) { return 0; }
static void slot_release(void) {}
#elif defined(__x86_64__)
/* Linux test host: glibc owns fs, so the slot is the first word of a block that gs points at. */
#define HOST_OS BUN_OS_MACOS
static unsigned long slot_offset(void) { return 0; }
static void slot_set(void *tp) {
  void **block = pthread_getspecific(tp_key);
  if (!block) {
    block = calloc(8, sizeof *block);
    pthread_setspecific(tp_key, block);
    syscall(SYS_arch_prctl, L_ARCH_SET_GS, block);
  }
  block[0] = tp;
}
static void *thread_x18(void) { return 0; }
static void slot_release(void) {}
#else
/* Linux test host, arm64: the block stands for a Windows TEB, and the slot is
   where TlsSlots[5] is in a TEB. See "x18" above.

   BUN_HOST_TEST=macos-tp runs the macOS way to read the thread pointer
   instead (host table os = 3), for an image that stays on one thread. Linux
   keeps nothing in tpidrro_el0, so there is one slot for the process, and
   its offset is its distance from what the register holds. */
#define HOST_OS (macos_tp ? BUN_OS_MACOS : BUN_OS_WINDOWS)
#define BLOCK_SIZE (0x1480 + 64 * 8)
static int macos_tp;
static void *macos_tp_slot;
static uintptr_t key_array(void);
static unsigned long slot_offset(void) { return macos_tp ? (uintptr_t)&macos_tp_slot - key_array() : 0x1480 + 5 * 8; }
static void *thread_x18(void) {
  void *block = pthread_getspecific(tp_key);
  if (!block) {
    block = calloc(1, BLOCK_SIZE);
    pthread_setspecific(tp_key, block);
  }
  return block;
}
static void slot_set(void *tp) {
  if (macos_tp) macos_tp_slot = tp;
  else *(void **)((char *)thread_x18() + slot_offset()) = tp;
}
static void slot_release(void) {
  free(pthread_getspecific(tp_key));
  pthread_setspecific(tp_key, 0);
}
#endif

/* Reads the slot the way the image does. */
#if defined(__x86_64__)
static void *slot_read(unsigned long off) {
  void *v;
  __asm__("mov %%gs:(%1), %0" : "=r"(v) : "r"(off));
  return v;
}
#else
static uintptr_t key_array(void) {
  uintptr_t base;
  __asm__("mrs %0, tpidrro_el0" : "=r"(base));
  return base & ~7ul; /* macOS 11 keeps the cpu number in the low 3 bits, later versions keep them 0 */
}
static void *slot_read(unsigned long off) {
#if X18_HOST
  if (!macos_tp) return *(void **)((char *)thread_x18() + off);
#endif
  return *(void **)(key_array() + off);
}
#endif

/* ---- what arrived, for the report ---- */
enum { COUNT_LINUX = 1024, COUNT_SLOTS = COUNT_LINUX + 256 };
static unsigned long counts[COUNT_SLOTS], refused[COUNT_SLOTS], forwarded[COUNT_SLOTS];
static unsigned long futex_ops[16], madvise_advice[32], lazy_commits, signals_delivered[L_NSIG];
/* Linux only: faults for which classify_fault() of this host and the kernel said different things. */
static unsigned long fault_mismatches;
/* BUN_HOST_TEST=winmem: calls of a primitive of the memory model that Windows would refuse,
   see "reservations" below. */
static unsigned long block_violations;
static int paths_fd = -1;

/* For a build that measures (test/coverage.ts): called before the process ends by _exit(). */
void (*bun_host_before_exit)(void);

static int count_slot(long n) {
  if (n >= 0 && n < COUNT_LINUX) return (int)n;
  if ((n & ~0xffl) == AT_BUN_HOST) return COUNT_LINUX + (int)(n & 0xff);
  return COUNT_SLOTS - 1;
}
static long slot_number(int slot) { return slot < COUNT_LINUX ? slot : slot == COUNT_SLOTS - 1 ? -1 : AT_BUN_HOST + (slot - COUNT_LINUX); }
static void count(unsigned long *table, long n) { __atomic_fetch_add(&table[count_slot(n)], 1, __ATOMIC_RELAXED); }
static void write_counts(void) {
  const char *path = getenv("BUN_HOST_COUNTS");
  if (!path) return;
  FILE *f = fopen(path, "w");
  if (!f) return;
  for (int i = 0; i < COUNT_SLOTS; i++) {
    long n = slot_number(i);
    if (counts[i]) fprintf(f, "request %ld %s %lu\n", n, l_request_name(n), counts[i]);
    if (refused[i]) fprintf(f, "refused %ld %s %lu\n", n, l_request_name(n), refused[i]);
    if (forwarded[i]) fprintf(f, "forwarded %ld %s %lu\n", n, l_request_name(n), forwarded[i]);
  }
  for (int i = 0; i < 16; i++)
    if (futex_ops[i]) fprintf(f, "detail futex_op %d %lu\n", i, futex_ops[i]);
  for (int i = 0; i < 32; i++)
    if (madvise_advice[i]) fprintf(f, "detail madvise_advice %d %lu\n", i, madvise_advice[i]);
  for (int i = 0; i < L_NSIG; i++)
    if (signals_delivered[i]) fprintf(f, "detail signal_delivered %d %lu\n", i, signals_delivered[i]);
  if (lazy_commits) fprintf(f, "detail lazy_commits 0 %lu\n", lazy_commits);
  if (fault_mismatches) fprintf(f, "detail fault_mismatches 0 %lu\n", fault_mismatches);
  if (test_winmem) fprintf(f, "detail block_violations 0 %lu\n", block_violations);
  fclose(f);
}
static void log_path(long n, const char *path, long result) {
  if (paths_fd < 0) return;
  char line[1200];
  int k = snprintf(line, sizeof line, "%s %s %ld\n", l_request_name(n), path, result);
  if (k > (int)sizeof line - 1) k = sizeof line - 1;
  if (write(paths_fd, line, (size_t)k) < 0) return;
}

/* ---- translation, Linux ABI on the left ---- */
static long to_linux_errno(int e) {
  switch (e) {
#define E(x) case x: return -L_##x;
    E(EPERM) E(ENOENT) E(ESRCH) E(EINTR) E(EIO) E(ENXIO) E(E2BIG) E(ENOEXEC) E(EBADF) E(ECHILD) E(EAGAIN) E(ENOMEM)
    E(EACCES) E(EFAULT) E(EBUSY) E(EEXIST) E(EXDEV) E(ENODEV) E(ENOTDIR) E(EISDIR) E(EINVAL) E(ENFILE) E(EMFILE)
    E(ENOTTY) E(ETXTBSY) E(EFBIG) E(ENOSPC) E(ESPIPE) E(EROFS) E(EMLINK) E(EPIPE) E(EDOM) E(ERANGE) E(EDEADLK)
    E(ENAMETOOLONG) E(ENOLCK) E(ENOSYS) E(ENOTEMPTY) E(ELOOP) E(EOVERFLOW) E(ENOTSUP) E(ETIMEDOUT)
#undef E
    default: return -L_EIO;
  }
}
static long ret(long r) { return r < 0 ? to_linux_errno(errno) : r; }
static int host_open_flags(long f) {
  int h = 0;
  switch (f & L_O_ACCMODE) {
    case 0: h = O_RDONLY; break;
    case 1: h = O_WRONLY; break;
    default: h = O_RDWR; break;
  }
  if (f & L_O_CREAT) h |= O_CREAT;
  if (f & L_O_EXCL) h |= O_EXCL;
  if (f & L_O_NOCTTY) h |= O_NOCTTY;
  if (f & L_O_TRUNC) h |= O_TRUNC;
  if (f & L_O_APPEND) h |= O_APPEND;
  if (f & L_O_NONBLOCK) h |= O_NONBLOCK;
  if (f & L_O_CLOEXEC) h |= O_CLOEXEC;
  if (f & L_O_DIRECTORY) h |= O_DIRECTORY;
  if (f & L_O_NOFOLLOW) h |= O_NOFOLLOW;
  return h;
}
static long linux_status_flags(int h) {
  long f = 0;
  switch (h & O_ACCMODE) {
    case O_RDONLY: f = 0; break;
    case O_WRONLY: f = 1; break;
    default: f = 2; break;
  }
  if (h & O_APPEND) f |= L_O_APPEND;
  if (h & O_NONBLOCK) f |= L_O_NONBLOCK;
  return f;
}
static int host_dirfd(long fd) { return (int)fd == L_AT_FDCWD ? AT_FDCWD : (int)fd; }
static uint32_t linux_mode(mode_t m) {
  uint32_t type = S_ISREG(m) ? L_S_IFREG : S_ISDIR(m) ? L_S_IFDIR : S_ISLNK(m) ? L_S_IFLNK : S_ISCHR(m) ? L_S_IFCHR
                : S_ISBLK(m) ? L_S_IFBLK : S_ISFIFO(m) ? L_S_IFIFO : S_ISSOCK(m) ? L_S_IFSOCK : 0;
  return type | (uint32_t)(m & 07777);
}
static void to_linux_stat(const struct stat *s, struct l_stat *out) {
  memset(out, 0, sizeof *out);
  out->dev = (uint64_t)s->st_dev;
  out->ino = (uint64_t)s->st_ino;
  out->nlink = (uint32_t)s->st_nlink;
  out->mode = linux_mode(s->st_mode);
  out->uid = (uint32_t)s->st_uid;
  out->gid = (uint32_t)s->st_gid;
  out->rdev = (uint64_t)s->st_rdev;
  out->size = (int64_t)s->st_size;
  out->blksize = (int32_t)s->st_blksize;
  out->blocks = (int64_t)s->st_blocks;
#ifdef __APPLE__
  out->atim.sec = s->st_atimespec.tv_sec; out->atim.nsec = s->st_atimespec.tv_nsec;
  out->mtim.sec = s->st_mtimespec.tv_sec; out->mtim.nsec = s->st_mtimespec.tv_nsec;
  out->ctim.sec = s->st_ctimespec.tv_sec; out->ctim.nsec = s->st_ctimespec.tv_nsec;
#else
  out->atim.sec = s->st_atim.tv_sec; out->atim.nsec = s->st_atim.tv_nsec;
  out->mtim.sec = s->st_mtim.tv_sec; out->mtim.nsec = s->st_mtim.tv_nsec;
  out->ctim.sec = s->st_ctim.tv_sec; out->ctim.nsec = s->st_ctim.tv_nsec;
#endif
}
static int host_clock(long c, clockid_t *out) {
  switch (c) {
    case L_CLOCK_REALTIME: case L_CLOCK_REALTIME_COARSE: *out = CLOCK_REALTIME; return 0;
    case L_CLOCK_MONOTONIC: case L_CLOCK_MONOTONIC_COARSE: case L_CLOCK_BOOTTIME: *out = CLOCK_MONOTONIC; return 0;
    case L_CLOCK_MONOTONIC_RAW:
#ifdef CLOCK_MONOTONIC_RAW
      *out = CLOCK_MONOTONIC_RAW;
#else
      *out = CLOCK_MONOTONIC;
#endif
      return 0;
    case L_CLOCK_PROCESS_CPUTIME_ID: *out = CLOCK_PROCESS_CPUTIME_ID; return 0;
    case L_CLOCK_THREAD_CPUTIME_ID: *out = CLOCK_THREAD_CPUTIME_ID; return 0;
    default: return -1;
  }
}
static void to_linux_timespec(const struct timespec *t, struct l_timespec *out) { out->sec = t->tv_sec; out->nsec = t->tv_nsec; }
static struct timespec host_timespec(const struct l_timespec *t) {
  struct timespec ts;
  ts.tv_sec = (time_t)t->sec;
  ts.tv_nsec = (long)t->nsec;
  return ts;
}

/* Signal numbers. Linux has 64, and the first 31 have a counterpart on every
   POSIX system, under another number on macOS. Two of them do not exist on macOS:
   SIGSTKFLT and SIGPWR (which JavaScriptCore in bun uses to suspend a thread for
   the garbage collector). They travel as two macOS signals that Linux does not
   have, SIGEMT and SIGINFO. Above 31 nothing can be sent on macOS, and glibc
   keeps 32 and 33 to itself on the Linux test host. */
static int host_signal(int sig) {
  switch (sig) {
#define S(x) case L_##x: return x;
    S(SIGHUP) S(SIGINT) S(SIGQUIT) S(SIGILL) S(SIGTRAP) S(SIGABRT) S(SIGBUS) S(SIGFPE) S(SIGKILL) S(SIGUSR1)
    S(SIGSEGV) S(SIGUSR2) S(SIGPIPE) S(SIGALRM) S(SIGTERM) S(SIGCHLD) S(SIGCONT) S(SIGSTOP) S(SIGTSTP) S(SIGTTIN)
    S(SIGTTOU) S(SIGURG) S(SIGXCPU) S(SIGXFSZ) S(SIGVTALRM) S(SIGPROF) S(SIGWINCH) S(SIGIO) S(SIGSYS)
#undef S
#ifdef __APPLE__
    case L_SIGSTKFLT: return SIGEMT;
    case L_SIGPWR: return SIGINFO;
#else
    case L_SIGSTKFLT: return SIGSTKFLT;
    case L_SIGPWR: return SIGPWR;
#endif
    default:
#if defined(__linux__) && defined(SIGRTMIN)
      if (sig >= SIGRTMIN && sig <= SIGRTMAX) return sig;
#endif
      return -1;
  }
}
__attribute__((unused)) static int linux_signal(int hsig) {
  for (int sig = 1; sig < L_NSIG; sig++)
    if (host_signal(sig) == hsig) return sig;
  return -1;
}
static void to_host_sigset(l_sigset set, sigset_t *out) {
  sigemptyset(out);
  for (int sig = 1; sig < L_NSIG; sig++)
    if ((set >> (sig - 1) & 1) && host_signal(sig) > 0) sigaddset(out, host_signal(sig));
}
static l_sigset to_linux_sigset(const sigset_t *set) {
  l_sigset out = 0;
  for (int sig = 1; sig < L_NSIG; sig++)
    if (host_signal(sig) > 0 && sigismember(set, host_signal(sig)) == 1) out |= 1ull << (sig - 1);
  return out;
}

/* ---- memory ---- */
#define MEMORY_PAGE host_page
static pthread_mutex_t memory_mutex = PTHREAD_MUTEX_INITIALIZER;
static sigset_t memory_saved_mask;
/* No handler of the image runs on a thread that holds the lock: such a handler
   may touch memory, and the fault handler takes this lock. */
static void memory_lock(void) {
  sigset_t all, saved;
  sigfillset(&all);
  pthread_sigmask(SIG_BLOCK, &all, &saved);
  pthread_mutex_lock(&memory_mutex);
  memory_saved_mask = saved;
}
static void memory_unlock(void) {
  sigset_t saved = memory_saved_mask;
  pthread_mutex_unlock(&memory_mutex);
  pthread_sigmask(SIG_SETMASK, &saved, 0);
}
static void *table_alloc(size_t bytes) {
  void *p = mmap(0, bytes, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON_HOST, -1, 0);
  return p == MAP_FAILED ? 0 : p;
}
static void table_free(void *p, size_t bytes) { munmap(p, bytes); }
static int host_prot(uint32_t prot) {
  return (prot & L_PROT_READ ? PROT_READ : 0) | (prot & L_PROT_WRITE ? PROT_WRITE : 0) | (prot & L_PROT_EXEC ? PROT_EXEC : 0);
}

/* The primitives of the model with what POSIX has (BUN_HOST_TEST=winmem). Reserved
   address space is a mapping without access, on a 64 KiB boundary like a block of
   VirtualAlloc. Decommit puts a new mapping without access in the place of the
   pages, so what was in them is gone.

   Windows takes one call of commit, decommit or protect for pages of one reservation
   only. mprotect and mmap do not mind, so the reservations are written down here, apart
   from the table of the model, and a call that Windows would refuse is refused and
   counted. A run that had such a call ends with exit code 98. */
static struct { uintptr_t base, size; } reservations[65536];
static size_t reservation_count;
static uintptr_t reserve_next;
static void reservation_add(uintptr_t base, size_t size) {
  if (reservation_count == sizeof reservations / sizeof *reservations) {
    static const char message[] = "host: too many reservations for the books of the test\n";
    if (write(2, message, sizeof message - 1) < 0) _exit(97);
    _exit(97);
  }
  reservations[reservation_count].base = base;
  reservations[reservation_count++].size = size;
}
static void reservation_remove(uintptr_t base) {
  for (size_t i = 0; i < reservation_count; i++)
    if (reservations[i].base == base) {
      reservations[i] = reservations[--reservation_count];
      return;
    }
}
static int in_one_reservation(uintptr_t start, size_t bytes) {
  for (size_t i = 0; i < reservation_count; i++)
    if (start >= reservations[i].base && start + bytes <= reservations[i].base + reservations[i].size) return 1;
  __atomic_fetch_add(&block_violations, 1, __ATOMIC_RELAXED);
  return 0;
}
static uintptr_t os_reserve(uintptr_t hint, size_t bytes) {
  const int flags = MAP_PRIVATE | MAP_ANON_HOST | MAP_NORESERVE;
  if (hint) {
#ifdef MAP_FIXED_NOREPLACE
    void *p = mmap((void *)hint, bytes, PROT_NONE, flags | MAP_FIXED_NOREPLACE, -1, 0);
#else
    void *p = mmap((void *)hint, bytes, PROT_NONE, flags, -1, 0);
#endif
    if (p == MAP_FAILED) return 0;
    if ((uintptr_t)p == hint) {
      reservation_add(hint, bytes);
      return hint;
    }
    munmap(p, bytes);
    return 0;
  }
  /* Right after the reservation before, if that is free: Windows hands out the lowest
     address that fits, so reservations are neighbours there more often than not. */
#ifdef MAP_FIXED_NOREPLACE
  if (reserve_next) {
    void *next = mmap((void *)reserve_next, bytes, PROT_NONE, flags | MAP_FIXED_NOREPLACE, -1, 0);
    if (next == (void *)reserve_next) {
      reserve_next += bytes;
      reservation_add((uintptr_t)next, bytes);
      return (uintptr_t)next;
    }
    if (next != MAP_FAILED) munmap(next, bytes);
  }
#endif
  char *p = mmap(0, bytes + 0x10000, PROT_NONE, flags, -1, 0);
  if (p == MAP_FAILED) return 0;
  char *base = (char *)(((uintptr_t)p + 0xffff) & ~(uintptr_t)0xffff);
  if (base > p) munmap(p, (size_t)(base - p));
  if (base + bytes < p + bytes + 0x10000) munmap(base + bytes, (size_t)(p + bytes + 0x10000 - (base + bytes)));
  reserve_next = (uintptr_t)base + bytes;
  reservation_add((uintptr_t)base, bytes);
  return (uintptr_t)base;
}
static void os_release(uintptr_t base, size_t bytes) {
  reservation_remove(base);
  munmap((void *)base, bytes);
}
static long long os_commit(uintptr_t start, size_t bytes, uint32_t prot) {
  if (!in_one_reservation(start, bytes)) return -L_EINVAL;
  return ret(mprotect((void *)start, bytes, host_prot(prot)));
}
static void os_decommit(uintptr_t start, size_t bytes) {
  if (!in_one_reservation(start, bytes)) return;
  mmap((void *)start, bytes, PROT_NONE, MAP_PRIVATE | MAP_ANON_HOST | MAP_NORESERVE | MAP_FIXED, -1, 0);
}
static long long os_protect(uintptr_t start, size_t bytes, uint32_t prot) {
  if (!in_one_reservation(start, bytes)) return -L_EINVAL;
  return ret(mprotect((void *)start, bytes, host_prot(prot)));
}

#include "memory.h"

/* What the host hands to the kernel has to be committed: the kernel does not ask model_fault(). */
static void touch(const void *p, size_t bytes) {
  if (test_winmem && p) model_touch((uintptr_t)p, bytes);
}
/* readv and writev: the vector of the image becomes a vector of the host. */
static long host_vector(int fd, const struct l_iovec *v, long n, int write) {
  struct iovec h[64];
  if (n < 0) return -L_EINVAL;
  if (n > 64) n = 64; /* fewer bytes than asked for is an answer that readv and writev may give */
  touch(v, (size_t)n * sizeof *v);
  for (long i = 0; i < n; i++) {
    touch((void *)(uintptr_t)v[i].base, (size_t)v[i].len);
    h[i].iov_base = (void *)(uintptr_t)v[i].base;
    h[i].iov_len = (size_t)v[i].len;
  }
  return ret(write ? writev(fd, h, (int)n) : readv(fd, h, (int)n));
}

/* Pages of anonymous memory become zero pages: a new mapping takes their place, with the
   protection that the table has for them. macOS needs that, MADV_DONTNEED keeps the content there. */
static void discard_by_overlay(uintptr_t addr, size_t len) {
  uintptr_t end = addr + page_up(len);
  memory_lock();
  for (size_t i = region_index(addr); i < region_count && regions[i].start < end; i++) {
    uintptr_t a = regions[i].start > addr ? regions[i].start : addr, b = regions[i].end < end ? regions[i].end : end;
    if (regions[i].flags & R_ANON) mmap((void *)a, b - a, host_prot(regions[i].prot), MAP_PRIVATE | MAP_ANON_HOST | MAP_NORESERVE | MAP_FIXED, -1, 0);
    else madvise((void *)a, b - a, MADV_DONTNEED);
  }
  memory_unlock();
}
static long native_map(uintptr_t addr, size_t len, uint32_t prot, long flags, int fd, off_t offset) {
  int h = 0;
  if (flags & L_MAP_HUGETLB) return -L_ENOMEM;
  if (flags & L_MAP_SHARED) h |= MAP_SHARED;
  if (flags & L_MAP_PRIVATE) h |= MAP_PRIVATE;
  if (flags & L_MAP_FIXED) h |= MAP_FIXED;
  if (flags & L_MAP_ANONYMOUS) h |= MAP_ANON_HOST;
  if (flags & L_MAP_NORESERVE) h |= MAP_NORESERVE;
  if (flags & L_MAP_FIXED_NOREPLACE) {
#ifdef MAP_FIXED_NOREPLACE
    h |= MAP_FIXED_NOREPLACE;
#else
    memory_lock();
    int taken = region_overlaps(addr, addr + page_up(len));
    memory_unlock();
    if (taken) return -L_EEXIST;
    h |= MAP_FIXED;
#endif
  }
  void *p = mmap((void *)addr, len, host_prot(prot), h, flags & L_MAP_ANONYMOUS ? -1 : fd, offset);
  if (p == MAP_FAILED) return to_linux_errno(errno);
  memory_lock();
  region_set((uintptr_t)p, (uintptr_t)p + page_up(len), prot, (flags & L_MAP_ANONYMOUS ? R_ANON : R_FILE) | R_COMMITTED);
  memory_unlock();
  return (long)p;
}
/* The model has no files. A mapping of a file that cannot be written through is memory with a copy. */
static long model_map_file(uintptr_t addr, size_t len, uint32_t prot, long flags, int fd, off_t offset) {
  if ((flags & L_MAP_SHARED) && (prot & L_PROT_WRITE)) return -L_ENODEV;
  long r = (long)model_map(addr, len, L_PROT_READ | L_PROT_WRITE, flags & ~(long)L_MAP_NORESERVE, R_FILE);
  if (r < 0) return r;
  for (size_t done = 0; done < len;) {
    ssize_t k = pread(fd, (char *)r + done, len - done, offset + (off_t)done);
    if (k <= 0) break;
    done += (size_t)k;
  }
  if (prot != (L_PROT_READ | L_PROT_WRITE)) model_protect((uintptr_t)r, len, prot);
  return r;
}
static long host_mmap(uintptr_t addr, size_t len, uint32_t prot, long flags, int fd, off_t offset) {
  if (!test_winmem) return native_map(addr, len, prot, flags, fd, offset);
  if (flags & L_MAP_HUGETLB) return -L_ENOMEM;
  if (!(flags & L_MAP_ANONYMOUS)) return model_map_file(addr, len, prot, flags, fd, offset);
  return (long)model_map(addr, len, prot, flags, R_ANON);
}
static long host_munmap(uintptr_t addr, size_t len) {
  if (test_winmem) return (long)model_unmap(addr, len);
  if (munmap((void *)addr, len)) return to_linux_errno(errno);
  memory_lock();
  region_clear(addr, addr + page_up(len));
  memory_unlock();
  return 0;
}
static long host_mprotect(uintptr_t addr, size_t len, uint32_t prot) {
  if (test_winmem) return (long)model_protect(addr, len, prot);
  if (mprotect((void *)addr, len, host_prot(prot))) return to_linux_errno(errno);
  uintptr_t end = addr + page_up(len);
  memory_lock();
  if (!region_split(addr) && !region_split(end)) {
    size_t first = region_index(addr), i = first;
    for (; i < region_count && regions[i].start < end; i++) regions[i].prot = prot;
    region_join(first, i);
  }
  memory_unlock();
  return 0;
}
static long host_madvise(uintptr_t addr, size_t len, long advice) {
  if (advice >= 0 && advice < 32) __atomic_fetch_add(&madvise_advice[advice], 1, __ATOMIC_RELAXED);
  switch (advice) {
    case L_MADV_DONTNEED:
      if (test_winmem) return (long)model_discard(addr, len);
#ifdef __APPLE__
      discard_by_overlay(addr, len);
      return 0;
#else
      if (test_overlay) {
        discard_by_overlay(addr, len);
        return 0;
      }
      return ret(madvise((void *)addr, len, MADV_DONTNEED));
#endif
    /* Hints and settings that change nothing that the image can see. */
    case L_MADV_NORMAL: case L_MADV_RANDOM: case L_MADV_SEQUENTIAL: case L_MADV_WILLNEED: case L_MADV_DONTFORK:
    case L_MADV_DOFORK: case L_MADV_NOHUGEPAGE: case L_MADV_DONTDUMP: case L_MADV_DODUMP:
      return 0;
    /* MADV_FREE and MADV_HUGEPAGE: the image has to take another way. */
    default:
      return -L_EINVAL;
  }
}

/* ---- files ---- */
/* Linux keeps information about the system in files under /proc and /sys. No other
   system has them, so on every host, the Linux test host too, they do not exist. */
static int refused_path(const char *p) {
  return !strncmp(p, "/proc/", 6) || !strcmp(p, "/proc") || !strncmp(p, "/sys/", 5) || !strcmp(p, "/sys");
}
static long host_open(long n, long dirfd, const char *path, long flags, long mode) {
  long r = refused_path(path) ? -L_ENOENT : ret(openat(host_dirfd(dirfd), path, host_open_flags(flags), (mode_t)mode));
  log_path(n, path, r);
  return r;
}
static long host_stat(long n, long dirfd, const char *path, struct l_stat *out, long flags) {
  struct stat s;
  long r;
  if ((flags & L_AT_EMPTY_PATH) && !*path) r = ret(fstat((int)dirfd, &s));
  else if (refused_path(path)) r = -L_ENOENT;
  else r = ret(fstatat(host_dirfd(dirfd), path, &s, flags & L_AT_SYMLINK_NOFOLLOW ? AT_SYMLINK_NOFOLLOW : 0));
  if (!r) {
    touch(out, sizeof *out);
    to_linux_stat(&s, out);
  }
  if (*path) log_path(n, path, r);
  return r;
}
static long host_access(long n, long dirfd, const char *path, long mode) {
  int h = (mode & 4 ? R_OK : 0) | (mode & 2 ? W_OK : 0) | (mode & 1 ? X_OK : 0);
  long r = refused_path(path) ? -L_ENOENT : ret(faccessat(host_dirfd(dirfd), path, h ? h : F_OK, 0));
  log_path(n, path, r);
  return r;
}
static long host_readlink(long n, long dirfd, const char *path, char *buf, size_t size) {
  touch(buf, size);
  long r = refused_path(path) ? -L_ENOENT : ret(readlinkat(host_dirfd(dirfd), path, buf, size));
  log_path(n, path, r);
  return r;
}
static long host_unlink(long n, long dirfd, const char *path, long flags) {
  long r = refused_path(path) ? -L_ENOENT : ret(unlinkat(host_dirfd(dirfd), path, flags & L_AT_REMOVEDIR ? AT_REMOVEDIR : 0));
  log_path(n, path, r);
  return r;
}
static long host_getcwd(char *buf, size_t size) {
  char here[4096];
  if (!getcwd(here, sizeof here)) return to_linux_errno(errno);
  size_t n = strlen(here) + 1;
  if (n > size) return -L_ERANGE;
  touch(buf, n);
  memcpy(buf, here, n);
  return (long)n;
}
static long host_fcntl(int fd, long cmd, long arg) {
  switch (cmd) {
    case L_F_GETFD: return ret(fcntl(fd, F_GETFD)) > 0 ? L_FD_CLOEXEC : 0;
    case L_F_SETFD: return ret(fcntl(fd, F_SETFD, arg & L_FD_CLOEXEC ? FD_CLOEXEC : 0));
    case L_F_GETFL: {
      int h = fcntl(fd, F_GETFL);
      return h < 0 ? to_linux_errno(errno) : linux_status_flags(h);
    }
    case L_F_SETFL: return ret(fcntl(fd, F_SETFL, host_open_flags(arg) & (O_APPEND | O_NONBLOCK)));
    case L_F_DUPFD: return ret(fcntl(fd, F_DUPFD, (int)arg));
    case L_F_DUPFD_CLOEXEC: return ret(fcntl(fd, F_DUPFD_CLOEXEC, (int)arg));
    default: return -L_EINVAL;
  }
}
static long host_ioctl(int fd, unsigned long request, void *arg) {
  switch (request) {
    case L_TIOCGWINSZ: {
      struct winsize w;
      if (ioctl(fd, TIOCGWINSZ, &w)) return to_linux_errno(errno);
      struct l_winsize *out = arg;
      touch(out, sizeof *out);
      out->row = w.ws_row; out->col = w.ws_col; out->xpixel = w.ws_xpixel; out->ypixel = w.ws_ypixel;
      return 0;
    }
    default:
      return isatty(fd) ? -L_EINVAL : -L_ENOTTY;
  }
}

/* ---- futex ---- */
static long host_futex(int *addr, long op, int val, const struct l_timespec *timeout) {
  int cmd = op & 127;
  __atomic_fetch_add(&futex_ops[cmd & 15], 1, __ATOMIC_RELAXED);
  touch(addr, sizeof *addr);
#ifdef __APPLE__
  if (cmd == L_FUTEX_WAIT) {
    uint32_t us = 0;
    if (timeout) {
      long long t = timeout->sec * 1000000ll + (timeout->nsec + 999) / 1000;
      us = t <= 0 ? 1 : t > 0xfffffffe ? 0xfffffffe : (uint32_t)t;
    }
    int r = __ulock_wait(1 | 0x1000000, addr, (uint32_t)val, us);
    if (r >= 0) return 0;
    return r == -ETIMEDOUT ? -L_ETIMEDOUT : r == -EINTR ? -L_EINTR : -L_EAGAIN;
  }
  if (cmd == L_FUTEX_WAKE || cmd == L_FUTEX_REQUEUE || cmd == L_FUTEX_CMP_REQUEUE) {
    int all = cmd != L_FUTEX_WAKE || val != 1;
    __ulock_wake(1 | 0x1000000 | (all ? 0x100 : 0), addr, 0);
    return val > 0 ? 1 : 0;
  }
  return -L_ENOSYS;
#else
  /* Requeue is answered by waking every waiter, which is what the macOS branch can do. */
  if (cmd == L_FUTEX_REQUEUE || cmd == L_FUTEX_CMP_REQUEUE) { cmd = L_FUTEX_WAKE; val = 0x7fffffff; }
  if (cmd != L_FUTEX_WAIT && cmd != L_FUTEX_WAKE) return -L_ENOSYS;
  struct timespec ts, *tp = 0;
  if (timeout && cmd == L_FUTEX_WAIT) { ts = host_timespec(timeout); tp = &ts; }
  return ret(syscall(SYS_futex, addr, cmd, val, tp, 0, 0));
#endif
}

/* ---- the system ---- */
static long processors(void) {
#ifdef __APPLE__
  int n = 0;
  size_t size = sizeof n;
  if (sysctlbyname("hw.logicalcpu", &n, &size, 0, 0) || n < 1) n = 1;
  return n;
#else
  cpu_set_t set;
  CPU_ZERO(&set);
  if (sched_getaffinity(0, sizeof set, &set)) return 1;
  int n = CPU_COUNT(&set);
  return n < 1 ? 1 : n;
#endif
}
/* The answer has the form that the kernel gives: a mask of processors. Which ones they
   are is nothing that the image can use, so the first n bits are set. */
static long host_getaffinity(size_t size, unsigned char *mask) {
  size_t bytes = size > 128 ? 128 : size & ~(size_t)7;
  if (!bytes) return -L_EINVAL;
  long n = processors();
  touch(mask, bytes);
  memset(mask, 0, bytes);
  for (long i = 0; i < n && i < (long)bytes * 8; i++) mask[i / 8] |= (unsigned char)(1 << (i % 8));
  return (long)bytes;
}
static long host_sysinfo(struct l_sysinfo *out) {
  touch(out, sizeof *out);
  memset(out, 0, sizeof *out);
  out->mem_unit = 1;
#ifdef __APPLE__
  uint64_t memory = 0;
  size_t size = sizeof memory;
  if (sysctlbyname("hw.memsize", &memory, &size, 0, 0)) return to_linux_errno(errno);
  uint32_t free_pages = 0;
  size = sizeof free_pages;
  if (sysctlbyname("vm.page_free_count", &free_pages, &size, 0, 0)) free_pages = 0;
  struct timeval boot = {0, 0}, now;
  size = sizeof boot;
  sysctlbyname("kern.boottime", &boot, &size, 0, 0);
  gettimeofday(&now, 0);
  out->uptime = now.tv_sec - boot.tv_sec;
  out->totalram = memory;
  out->freeram = (uint64_t)free_pages * (uint64_t)host_page;
  out->procs = 1;
#else
  struct sysinfo s;
  if (sysinfo(&s)) return to_linux_errno(errno);
  uint64_t unit = s.mem_unit ? s.mem_unit : 1;
  out->uptime = s.uptime;
  for (int i = 0; i < 3; i++) out->loads[i] = s.loads[i];
  out->totalram = s.totalram * unit;
  out->freeram = s.freeram * unit;
  out->sharedram = s.sharedram * unit;
  out->bufferram = s.bufferram * unit;
  out->totalswap = s.totalswap * unit;
  out->freeswap = s.freeswap * unit;
  out->procs = s.procs;
#endif
  return 0;
}
static uint64_t linux_limit(rlim_t v) { return v == RLIM_INFINITY ? L_RLIM_INFINITY : (uint64_t)v; }
static long host_getrlimit(long resource, struct l_rlimit *out) {
  if (!out) return 0;
  touch(out, sizeof *out);
  struct rlimit r;
  switch (resource) {
    /* The stack of the main thread is the one that the host made. */
    case L_RLIMIT_STACK: out->cur = out->max = main_stack_high - main_stack_low; return 0;
    case L_RLIMIT_NOFILE:
      if (getrlimit(RLIMIT_NOFILE, &r)) return to_linux_errno(errno);
      out->cur = linux_limit(r.rlim_cur);
      out->max = linux_limit(r.rlim_max);
      return 0;
    case L_RLIMIT_CORE: out->cur = out->max = 0; return 0;
    case L_RLIMIT_CPU: case L_RLIMIT_FSIZE: case L_RLIMIT_DATA: case L_RLIMIT_RSS: case L_RLIMIT_NPROC:
    case L_RLIMIT_MEMLOCK: case L_RLIMIT_AS:
      out->cur = out->max = L_RLIM_INFINITY;
      return 0;
    default: return -L_EINVAL;
  }
}
static long host_getrusage(long who, struct l_rusage *out) {
  struct rusage u;
  int h = RUSAGE_SELF;
  if (who == L_RUSAGE_CHILDREN) h = RUSAGE_CHILDREN;
#ifdef RUSAGE_THREAD
  if (who == L_RUSAGE_THREAD) h = RUSAGE_THREAD;
#endif
  if (getrusage(h, &u)) return to_linux_errno(errno);
  touch(out, sizeof *out);
  memset(out, 0, sizeof *out);
  out->utime.sec = u.ru_utime.tv_sec; out->utime.usec = u.ru_utime.tv_usec;
  out->stime.sec = u.ru_stime.tv_sec; out->stime.usec = u.ru_stime.tv_usec;
#ifdef __APPLE__
  out->maxrss = u.ru_maxrss / 1024; /* bytes on macOS, KiB on Linux */
#else
  out->maxrss = u.ru_maxrss;
#endif
  out->minflt = u.ru_minflt; out->majflt = u.ru_majflt;
  out->inblock = u.ru_inblock; out->oublock = u.ru_oublock;
  out->nvcsw = u.ru_nvcsw; out->nivcsw = u.ru_nivcsw;
  return 0;
}
/* The image was built for Linux and may ask which one. */
static long host_uname(struct l_utsname *out) {
  touch(out, sizeof *out);
  memset(out, 0, sizeof *out);
  strcpy(out->sysname, "Linux");
  if (gethostname(out->nodename, sizeof out->nodename - 1)) strcpy(out->nodename, "localhost");
  strcpy(out->release, "6.1.0-bun-host");
  strcpy(out->version, "#1");
#if defined(__x86_64__)
  strcpy(out->machine, "x86_64");
#else
  strcpy(out->machine, "aarch64");
#endif
  strcpy(out->domainname, "(none)");
  return 0;
}
static long host_prctl(long option, long a) {
  switch (option) {
    case L_PR_SET_NAME: {
      /* The name of the thread is for tools that look at the process. On macOS it stays
         unset: pthread_setname_np() has other parameters there than in every other libc. */
#ifndef __APPLE__
      char name[16];
      strncpy(name, (const char *)a, sizeof name - 1);
      name[sizeof name - 1] = 0;
      prctl(PR_SET_NAME, name);
#else
      (void)a;
#endif
      return 0;
    }
    /* PR_SET_VMA gives a name to a mapping, for /proc/<pid>/maps. A kernel that was built
       without that answers EINVAL too. */
    default: return -L_EINVAL;
  }
}
static long host_getrandom(unsigned char *buf, size_t size) {
  touch(buf, size);
  size_t done = 0;
  while (done < size) {
    size_t k = size - done > 256 ? 256 : size - done;
    if (getentropy(buf + done, k)) break;
    done += k;
  }
  return (long)done;
}
static long host_sleep(const struct l_timespec *request, struct l_timespec *remaining) {
  struct timespec ts = host_timespec(request), left = {0, 0};
  if (!nanosleep(&ts, &left)) return 0;
  long r = to_linux_errno(errno);
  if (remaining && r == -L_EINTR) {
    touch(remaining, sizeof *remaining);
    to_linux_timespec(&left, remaining);
  }
  return r;
}
/* With TIMER_ABSTIME the time is a point of the clock, and the host sleeps for what is left. */
static long host_clock_sleep(long clock, long flags, const struct l_timespec *request, struct l_timespec *remaining) {
  if (!(flags & 1)) return host_sleep(request, remaining);
  clockid_t h;
  struct timespec now;
  if (host_clock(clock, &h) || clock_gettime(h, &now)) return -L_EINVAL;
  struct l_timespec left = {request->sec - now.tv_sec, request->nsec - now.tv_nsec};
  if (left.nsec < 0) { left.nsec += 1000000000; left.sec--; }
  return left.sec < 0 ? 0 : host_sleep(&left, 0);
}

/* ---- threads ---- */
/* Thread ids of the image are numbers of the host: the main thread has the process id (so
   that gettid() == getpid() holds for it as on Linux), the others count up from there.
   musl keeps a thread id in 30 bits of its locks. */
struct thread_slot { int tid; pthread_t thread; struct host_thread *state; };
static struct thread_slot threads[4096];
static int thread_count, next_tid;
static pthread_mutex_t threads_mutex = PTHREAD_MUTEX_INITIALIZER;

/* A handler of the image may ask for a thread (tkill), so no handler runs while the lock is held. */
static void threads_lock(sigset_t *saved) {
  sigset_t all;
  sigfillset(&all);
  pthread_sigmask(SIG_BLOCK, &all, saved);
  pthread_mutex_lock(&threads_mutex);
}
static void threads_unlock(const sigset_t *saved) {
  pthread_mutex_unlock(&threads_mutex);
  pthread_sigmask(SIG_SETMASK, saved, 0);
}
static struct host_thread *this_thread(void) {
  struct host_thread *t = pthread_getspecific(thread_key);
  return t ? t : &main_thread;
}
static void on_image_stack(void *p) {
  struct host_thread *t = p;
  call_image(t->fn, t->arg, t->x18);
  return_to_host(&t->ctx);
}
static void *thread_main(void *p) {
  struct host_thread *t = p;
  pthread_setspecific(thread_key, t);
  slot_set(t->tls);
  t->x18 = thread_x18();
  enter_image_stack(&t->ctx, (void *)((uintptr_t)t->stack_top & ~15ull), on_image_stack, t);
  /* From here on the thread is on the stack that the host gave it, and nobody can send it a signal. */
  sigset_t saved;
  threads_lock(&saved);
  for (int i = 0; i < thread_count; i++)
    if (threads[i].tid == t->tid) {
      threads[i] = threads[--thread_count];
      break;
    }
  threads_unlock(&saved);
  if (t->unmap_base) {
    if (test_winmem) model_unmap((uintptr_t)t->unmap_base, t->unmap_size);
    else host_munmap((uintptr_t)t->unmap_base, t->unmap_size);
  }
  int *ctid = t->ctid;
  free(t);
  slot_release();
  if (ctid) {
    *ctid = 0;
    host_futex(ctid, L_FUTEX_WAKE, 0x7fffffff, 0);
  }
  return 0;
}
__attribute__((used)) static long host_thread_create(ImageThreadFn fn, void *stack, long flags, void *arg, int *ptid, void *tls, int *ctid) {
  FORGET_X18();
  count(counts, N_clone);
#if X18_HOST
  if (macos_tp) return -L_EAGAIN;
#endif
  struct host_thread *t = calloc(1, sizeof *t);
  if (!t) return -L_ENOMEM;
  t->fn = fn; t->arg = arg; t->tls = tls; t->stack_top = stack;
  t->ctid = flags & L_CLONE_CHILD_CLEARTID ? ctid : 0;
  t->altstack.flags = L_SS_DISABLE;
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setstacksize(&attr, 1 << 20);
  pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
  sigset_t saved;
  threads_lock(&saved);
  long r = -L_EAGAIN;
  if (thread_count < (int)(sizeof threads / sizeof *threads)) {
    next_tid = next_tid >= 0x3ffffff0 ? main_tid + 1 : next_tid + 1;
    t->tid = next_tid;
    if (flags & L_CLONE_PARENT_SETTID) *ptid = t->tid;
    /* The thread starts with the signals blocked that are blocked here, which is all of them.
       The libc of the image sets the mask of a new thread itself. */
    if (!pthread_create(&threads[thread_count].thread, &attr, thread_main, t)) {
      threads[thread_count].state = t;
      threads[thread_count++].tid = t->tid;
      r = t->tid;
    }
  }
  threads_unlock(&saved);
  pthread_attr_destroy(&attr);
  if (r < 0) free(t);
  return r;
}
static void leave_thread(void *base, unsigned long size) {
  struct host_thread *t = pthread_getspecific(thread_key);
  if (!t) pthread_exit(0);
  t->unmap_base = base;
  t->unmap_size = size;
  return_to_host(&t->ctx);
}
__attribute__((used)) static void host_thread_exit(void *base, unsigned long size) { leave_thread(base, size); }

/* ---- signals ---- */
static struct l_k_sigaction image_actions[L_NSIG];
static pthread_t main_pthread;
__attribute__((unused)) static int syscall_filter_installed;
static long error_code(int e) { return e ? to_linux_errno(e) : 0; }

#if DELIVERS_SIGNALS
/* The machine context of the host, read and written through one set of names.
   macOS: the structures of xnu (bsd/sys/_types/_ucontext.h, mach/i386/_structs.h) are
   declared here under names of this file, so that nothing depends on how a header of the
   SDK spells them. If the SDK is there, the sizes are compared below. */
#ifdef __APPLE__
struct mac_exception_state { uint16_t trapno, cpu; uint32_t err; uint64_t faultvaddr; };
struct mac_thread_state { uint64_t rax, rbx, rcx, rdx, rdi, rsi, rbp, rsp, r8, r9, r10, r11, r12, r13, r14, r15, rip, rflags, cs, fs, gs; };
struct mac_float_state { int32_t reserved[2]; uint8_t fxsave[512]; int32_t reserved1; };
struct mac_mcontext { struct mac_exception_state es; struct mac_thread_state ss; struct mac_float_state fs; };
struct mac_ucontext {
  int32_t onstack;
  uint32_t sigmask;
  struct { void *sp; uint64_t size; int32_t flags; } stack;
  struct mac_ucontext *link;
  uint64_t mcsize;
  struct mac_mcontext *mcontext;
};
_Static_assert(offsetof(struct mac_mcontext, ss) == 16 && offsetof(struct mac_mcontext, fs) == 184 && offsetof(struct mac_ucontext, mcontext) == 48, "machine context of macOS x86-64");
#if __has_include(<mach/i386/_structs.h>)
_Static_assert(sizeof(struct mac_thread_state) == sizeof(struct __darwin_x86_thread_state64) && sizeof(struct mac_float_state) == sizeof(struct __darwin_x86_float_state64) && offsetof(struct mac_ucontext, mcontext) == offsetof(ucontext_t, uc_mcontext), "machine context of macOS x86-64, compared with the SDK");
#endif
typedef struct mac_ucontext host_context;
#define HOST_REGISTERS(X, c) \
  X(R8, (c)->mcontext->ss.r8) X(R9, (c)->mcontext->ss.r9) X(R10, (c)->mcontext->ss.r10) X(R11, (c)->mcontext->ss.r11) \
  X(R12, (c)->mcontext->ss.r12) X(R13, (c)->mcontext->ss.r13) X(R14, (c)->mcontext->ss.r14) X(R15, (c)->mcontext->ss.r15) \
  X(RDI, (c)->mcontext->ss.rdi) X(RSI, (c)->mcontext->ss.rsi) X(RBP, (c)->mcontext->ss.rbp) X(RBX, (c)->mcontext->ss.rbx) \
  X(RDX, (c)->mcontext->ss.rdx) X(RAX, (c)->mcontext->ss.rax) X(RCX, (c)->mcontext->ss.rcx) X(RSP, (c)->mcontext->ss.rsp) \
  X(RIP, (c)->mcontext->ss.rip) X(EFL, (c)->mcontext->ss.rflags)
static long context_trap(host_context *c) { return c->mcontext->es.trapno; }
static long context_error(host_context *c) { return c->mcontext->es.err; }
static uintptr_t context_fault_address(host_context *c) { return c->mcontext->es.faultvaddr; }
static void *context_fxsave(host_context *c) { return c->mcontext->fs.fxsave; }
static uint64_t context_segments(host_context *c) { return (c->mcontext->ss.cs & 0xffff) | (c->mcontext->ss.gs & 0xffff) << 16 | (c->mcontext->ss.fs & 0xffff) << 32; }
static void context_get_mask(host_context *c, sigset_t *out) {
  sigemptyset(out);
  for (int s = 1; s < 32; s++)
    if (c->sigmask >> (s - 1) & 1) sigaddset(out, s);
}
static void context_set_mask(host_context *c, const sigset_t *in) {
  uint32_t mask = 0;
  for (int s = 1; s < 32; s++)
    if (sigismember(in, s) == 1) mask |= 1u << (s - 1);
  c->sigmask = mask;
}
#else
typedef ucontext_t host_context;
#define HOST_REGISTERS(X, c) \
  X(R8, (c)->uc_mcontext.gregs[REG_R8]) X(R9, (c)->uc_mcontext.gregs[REG_R9]) X(R10, (c)->uc_mcontext.gregs[REG_R10]) \
  X(R11, (c)->uc_mcontext.gregs[REG_R11]) X(R12, (c)->uc_mcontext.gregs[REG_R12]) X(R13, (c)->uc_mcontext.gregs[REG_R13]) \
  X(R14, (c)->uc_mcontext.gregs[REG_R14]) X(R15, (c)->uc_mcontext.gregs[REG_R15]) X(RDI, (c)->uc_mcontext.gregs[REG_RDI]) \
  X(RSI, (c)->uc_mcontext.gregs[REG_RSI]) X(RBP, (c)->uc_mcontext.gregs[REG_RBP]) X(RBX, (c)->uc_mcontext.gregs[REG_RBX]) \
  X(RDX, (c)->uc_mcontext.gregs[REG_RDX]) X(RAX, (c)->uc_mcontext.gregs[REG_RAX]) X(RCX, (c)->uc_mcontext.gregs[REG_RCX]) \
  X(RSP, (c)->uc_mcontext.gregs[REG_RSP]) X(RIP, (c)->uc_mcontext.gregs[REG_RIP]) X(EFL, (c)->uc_mcontext.gregs[REG_EFL])
static long context_trap(host_context *c) { return (long)c->uc_mcontext.gregs[REG_TRAPNO]; }
static long context_error(host_context *c) { return (long)c->uc_mcontext.gregs[REG_ERR]; }
static uintptr_t context_fault_address(host_context *c) { return (uintptr_t)c->uc_mcontext.gregs[REG_CR2]; }
static void *context_fxsave(host_context *c) { return c->uc_mcontext.fpregs; }
static uint64_t context_segments(host_context *c) { return (uint64_t)c->uc_mcontext.gregs[REG_CSGSFS]; }
static void context_get_mask(host_context *c, sigset_t *out) { *out = c->uc_sigmask; }
static void context_set_mask(host_context *c, const sigset_t *in) { c->uc_sigmask = *in; }
#endif

/* A fault of the processor as Linux reports it, from the trap number and from where the
   address is. macOS reports some of them under other signals (a page without access is
   SIGBUS there, and so is a general protection fault). On Linux the result has to be what
   the kernel said, which is counted as a check of this function. */
enum { TRAP_DIVIDE = 0, TRAP_DEBUG = 1, TRAP_BREAKPOINT = 3, TRAP_OVERFLOW = 4, TRAP_OPCODE = 6, TRAP_PROTECTION = 13, TRAP_PAGE = 14, TRAP_X87 = 16, TRAP_SIMD = 19 };
static int classify_fault(long trap, uintptr_t address, int *code, uintptr_t *reported) {
  *reported = address;
  switch (trap) {
    case TRAP_PAGE: {
      memory_lock();
      struct region *r = region_at(address);
      uint32_t flags = r ? r->flags : 0;
      memory_unlock();
      *code = flags ? L_SEGV_ACCERR : L_SEGV_MAPERR;
      return L_SIGSEGV;
    }
    case TRAP_PROTECTION: *code = L_SI_KERNEL; *reported = 0; return L_SIGSEGV;
    case TRAP_OPCODE: *code = L_ILL_ILLOPN; return L_SIGILL;
    case TRAP_DIVIDE: *code = L_FPE_INTDIV; return L_SIGFPE;
    case TRAP_OVERFLOW: *code = L_SI_KERNEL; *reported = 0; return L_SIGSEGV;
    case TRAP_X87: case TRAP_SIMD: *code = 0; return L_SIGFPE;
    case TRAP_DEBUG: *code = L_TRAP_TRACE; return L_SIGTRAP;
    case TRAP_BREAKPOINT: *code = L_SI_KERNEL; *reported = 0; return L_SIGTRAP;
    default: return 0;
  }
}
static int is_fault(int hsig) { return hsig == SIGSEGV || hsig == SIGBUS || hsig == SIGILL || hsig == SIGFPE || hsig == SIGTRAP; }

static void native_handler(int hsig, siginfo_t *hinfo, void *hcontext) {
  int saved_errno = errno;
  host_context *hc = hcontext;
  struct host_thread *t = this_thread();
  int sig = linux_signal(hsig);
  struct l_siginfo info;
  memset(&info, 0, sizeof info);

  /* Somebody sent the signal, or the processor reports a fault. A signal that this host sent
     is marked at the thread (macOS has faults without a code, which look like sent ones). */
  int sent = hinfo->si_code == SI_USER || hinfo->si_code == SI_QUEUE;
#ifndef __APPLE__
  if (hinfo->si_code < 0) sent = 1;
#endif
  if (hsig < 32 && (__atomic_fetch_and(&t->sent, ~(1u << hsig), __ATOMIC_SEQ_CST) & (1u << hsig))) sent = 1;
  int fault = is_fault(hsig) && !sent;
  if (fault) {
    uintptr_t address = hsig == SIGSEGV || hsig == SIGBUS ? context_fault_address(hc) : (uintptr_t)hinfo->si_addr, reported;
    long trap = context_trap(hc), error = context_error(hc);
    if (test_winmem && trap == TRAP_PAGE) {
      /* The page may be one that the model has not committed yet. The same address again
         and again would mean that table and system disagree. */
      int again = t->fault_address == address ? t->fault_repeats + 1 : 0;
      t->fault_address = address;
      t->fault_repeats = again;
      if (again < 8 && model_fault(address, !!(error & 2), !!(error & 16))) {
        __atomic_fetch_add(&lazy_commits, 1, __ATOMIC_RELAXED);
        errno = saved_errno;
        return;
      }
    }
    int code = 0, classified = classify_fault(trap, address, &code, &reported);
    if (classified) {
#ifndef __APPLE__
      if ((classified != sig || (code && code != hinfo->si_code)) && !test_winmem) __atomic_fetch_add(&fault_mismatches, 1, __ATOMIC_RELAXED);
#endif
      sig = classified;
      info.code = code;
      info.u.fault.addr = reported;
    } else {
      info.code = hinfo->si_code;
      info.u.fault.addr = (uintptr_t)hinfo->si_addr;
    }
  } else {
    info.code = hinfo->si_code == SI_USER ? L_SI_USER : L_SI_TKILL;
    info.u.kill.pid = (int32_t)hinfo->si_pid;
    info.u.kill.uid = (uint32_t)hinfo->si_uid;
  }
  info.signo = sig;

  struct l_k_sigaction action;
  action = sig > 0 ? image_actions[sig] : (struct l_k_sigaction){0, 0, 0, 0};
  if (action.handler == L_SIG_DFL || action.handler == L_SIG_IGN) {
    /* Nobody of the image wants it. A fault comes again when this returns, and then it ends the process. */
    if (fault) signal(hsig, SIG_DFL);
    errno = saved_errno;
    return;
  }
  if (action.flags & L_SA_RESETHAND) image_actions[sig].handler = L_SIG_DFL;
  if (sig < L_NSIG) __atomic_fetch_add(&signals_delivered[sig], 1, __ATOMIC_RELAXED);

  struct l_ucontext uc;
  memset(&uc, 0, offsetof(struct l_ucontext, fpregs_mem));
  uc.stack = t->altstack;
#define REGISTER_IN(name, field) uc.mcontext.gregs[L_REG_##name] = (int64_t)(field);
  HOST_REGISTERS(REGISTER_IN, hc)
#undef REGISTER_IN
  uc.mcontext.gregs[L_REG_CSGSFS] = (int64_t)context_segments(hc);
  uc.mcontext.gregs[L_REG_ERR] = context_error(hc);
  uc.mcontext.gregs[L_REG_TRAPNO] = context_trap(hc);
  uc.mcontext.gregs[L_REG_CR2] = fault ? (int64_t)info.u.fault.addr : 0;
  if (context_fxsave(hc)) memcpy(&uc.fpregs_mem, context_fxsave(hc), sizeof uc.fpregs_mem);
  else memset(&uc.fpregs_mem, 0, sizeof uc.fpregs_mem);
  uc.mcontext.fpregs = (uint64_t)(uintptr_t)&uc.fpregs_mem;
  sigset_t mask;
  context_get_mask(hc, &mask);
  uc.sigmask = to_linux_sigset(&mask);
  l_sigset mask_before = uc.sigmask;

  ((void (*)(int, struct l_siginfo *, struct l_ucontext *))(uintptr_t)action.handler)(sig, &info, &uc);

  /* What the handler changed is what the thread goes on with: the WebAssembly fault handler
     of JavaScriptCore sets the program counter, the libc sets the signal mask. */
#define REGISTER_OUT(name, field) (field) = (__typeof__(field))uc.mcontext.gregs[L_REG_##name];
  HOST_REGISTERS(REGISTER_OUT, hc)
#undef REGISTER_OUT
  if (context_fxsave(hc)) memcpy(context_fxsave(hc), &uc.fpregs_mem, sizeof uc.fpregs_mem);
  if (uc.sigmask != mask_before) {
    to_host_sigset(uc.sigmask, &mask);
    context_set_mask(hc, &mask);
  }
  errno = saved_errno;
}
#endif

static long host_sigaction(int sig, const struct l_k_sigaction *act, struct l_k_sigaction *old) {
  if (sig < 1 || sig >= L_NSIG || sig == L_SIGKILL || sig == L_SIGSTOP) return -L_EINVAL;
  long r = 0;
  sigset_t saved;
  threads_lock(&saved);
  struct l_k_sigaction before = image_actions[sig];
  if (act) {
    image_actions[sig] = *act;
#if DELIVERS_SIGNALS
    int hsig = host_signal(sig);
    /* A signal that this host cannot deliver is recorded, and that is all. */
    if (hsig > 0) {
      struct sigaction sa;
      memset(&sa, 0, sizeof sa);
      if (act->handler == L_SIG_DFL) sa.sa_handler = SIG_DFL;
      else if (act->handler == L_SIG_IGN) sa.sa_handler = SIG_IGN;
      else {
        sa.sa_sigaction = native_handler;
        sa.sa_flags = SA_SIGINFO;
        if (act->flags & L_SA_ONSTACK) sa.sa_flags |= SA_ONSTACK;
        if (act->flags & L_SA_RESTART) sa.sa_flags |= SA_RESTART;
        if (act->flags & L_SA_NODEFER) sa.sa_flags |= SA_NODEFER;
        if (act->flags & L_SA_RESETHAND) sa.sa_flags |= (int)SA_RESETHAND;
        to_host_sigset(act->mask, &sa.sa_mask);
      }
      /* With the memory model the host keeps the handler for faults of pages: it commits there.
         And it keeps the handler that reports a syscall from outside of the host. */
      int keep = test_winmem && (hsig == SIGSEGV || hsig == SIGBUS) && sa.sa_sigaction != native_handler;
      if (hsig == SIGSYS && syscall_filter_installed) keep = 1;
      if (!keep && sigaction(hsig, &sa, 0)) r = to_linux_errno(errno);
#ifdef __APPLE__
      /* macOS reports what Linux calls SIGSEGV as SIGBUS in some cases, see classify_fault(). */
      if (!keep && !r && hsig == SIGSEGV && sigaction(SIGBUS, &sa, 0)) r = to_linux_errno(errno);
#endif
    }
#endif
    if (r) image_actions[sig] = before;
  }
  threads_unlock(&saved);
  if (old && !r) {
    touch(old, sizeof *old);
    *old = before;
  }
  return r;
}
static long host_sigprocmask(long how, const l_sigset *set, l_sigset *old) {
  sigset_t h, before;
  int host_how = how == L_SIG_BLOCK ? SIG_BLOCK : how == L_SIG_UNBLOCK ? SIG_UNBLOCK : SIG_SETMASK;
  if (set && (how < L_SIG_BLOCK || how > L_SIG_SETMASK)) return -L_EINVAL;
  if (set) to_host_sigset(*set, &h);
  int e = pthread_sigmask(host_how, set ? &h : 0, &before);
  if (e) return to_linux_errno(e);
  if (old) {
    touch(old, sizeof *old);
    *old = to_linux_sigset(&before);
  }
  return 0;
}
static long host_sigaltstack(const struct l_stack *stack, struct l_stack *old) {
  struct host_thread *t = this_thread();
  if (old) {
    touch(old, sizeof *old);
    *old = t->altstack;
  }
  if (!stack) return 0;
  stack_t h;
  memset(&h, 0, sizeof h);
  h.ss_sp = (void *)(uintptr_t)stack->sp;
  h.ss_size = (size_t)stack->size;
  h.ss_flags = stack->flags & L_SS_DISABLE ? SS_DISABLE : 0;
  if (sigaltstack(&h, 0)) return to_linux_errno(errno);
  t->altstack = *stack;
  return 0;
}
static long host_sigsuspend(const l_sigset *set) {
  sigset_t h;
  to_host_sigset(*set, &h);
  sigsuspend(&h);
  return -L_EINTR;
}
static long host_sigpending(l_sigset *out) {
  sigset_t h;
  if (sigpending(&h)) return to_linux_errno(errno);
  touch(out, sizeof *out);
  *out = to_linux_sigset(&h);
  return 0;
}
/* tid 0: the process. */
static long host_kill(int tid, int sig) {
  if (sig < 0 || sig >= L_NSIG) return -L_EINVAL;
  int hsig = sig ? host_signal(sig) : 0;
  if (hsig < 0) return -L_ENOSYS;
#if !DELIVERS_SIGNALS
  if (sig && image_actions[sig].handler > L_SIG_IGN) return -L_ENOSYS;
#endif
  if (!tid) return ret(kill(getpid(), hsig));
  long r = -L_ESRCH;
  sigset_t saved;
  threads_lock(&saved);
  struct host_thread *target = 0;
  pthread_t handle = main_pthread;
  if (tid == main_tid) target = &main_thread;
  for (int i = 0; i < thread_count && !target; i++)
    if (threads[i].tid == tid) {
      target = threads[i].state;
      handle = threads[i].thread;
    }
  if (target) {
    if (hsig > 0 && hsig < 32) __atomic_fetch_or(&target->sent, 1u << hsig, __ATOMIC_SEQ_CST);
    r = error_code(pthread_kill(handle, hsig));
  }
  threads_unlock(&saved);
  return r;
}

/* ---- syscalls ---- */
static long dispatch(long n, long a, long b, long c, long d, long e, long f) {
  switch (n) {
    case N_read: touch((void *)b, (size_t)c); return ret(read((int)a, (void *)b, (size_t)c));
    case N_write: touch((void *)b, (size_t)c); return ret(write((int)a, (void *)b, (size_t)c));
    case N_pread64: touch((void *)b, (size_t)c); return ret(pread((int)a, (void *)b, (size_t)c, (off_t)d));
    case N_pwrite64: touch((void *)b, (size_t)c); return ret(pwrite((int)a, (void *)b, (size_t)c, (off_t)d));
    case N_readv: return host_vector((int)a, (void *)b, c, 0);
    case N_writev: return host_vector((int)a, (void *)b, c, 1);
    case N_open: return host_open(n, L_AT_FDCWD, (const char *)a, b, c);
    case N_openat: return host_open(n, a, (const char *)b, c, d);
    case N_close: return a > 2 ? ret(close((int)a)) : 0;
    case N_lseek: return ret(lseek((int)a, (off_t)b, (int)c));
    case N_stat: return host_stat(n, L_AT_FDCWD, (const char *)a, (void *)b, 0);
    case N_lstat: return host_stat(n, L_AT_FDCWD, (const char *)a, (void *)b, L_AT_SYMLINK_NOFOLLOW);
    case N_fstat: return host_stat(n, a, "", (void *)b, L_AT_EMPTY_PATH);
    case N_newfstatat: return host_stat(n, a, (const char *)b, (void *)c, d);
    case N_access: return host_access(n, L_AT_FDCWD, (const char *)a, b);
    case N_faccessat: case N_faccessat2: return host_access(n, a, (const char *)b, c);
    case N_readlink: return host_readlink(n, L_AT_FDCWD, (const char *)a, (char *)b, (size_t)c);
    case N_readlinkat: return host_readlink(n, a, (const char *)b, (char *)c, (size_t)d);
    case N_unlink: return host_unlink(n, L_AT_FDCWD, (const char *)a, 0);
    case N_unlinkat: return host_unlink(n, a, (const char *)b, c);
    case N_getcwd: return host_getcwd((char *)a, (size_t)b);
    case N_fcntl: return host_fcntl((int)a, b, c);
    case N_ioctl: return host_ioctl((int)a, (unsigned long)b, (void *)c);
    case N_dup: return ret(dup((int)a));
    case N_dup2: return ret(dup2((int)a, (int)b));
    case N_dup3: return a == b ? -L_EINVAL : ret(dup2((int)a, (int)b));
    case N_ftruncate: return ret(ftruncate((int)a, (off_t)b));
    case N_fsync: case N_fdatasync: return ret(fsync((int)a));
    case N_umask: return (long)umask((mode_t)a);

    case N_mmap: return host_mmap((uintptr_t)a, (size_t)b, (uint32_t)c & 7, d, (int)e, (off_t)f);
    case N_mprotect: return host_mprotect((uintptr_t)a, (size_t)b, (uint32_t)c & 7);
    case N_munmap: return host_munmap((uintptr_t)a, (size_t)b);
    case N_madvise: return host_madvise((uintptr_t)a, (size_t)b, c);
    /* The libc of the image has no program break and moves no mapping: it asks for new ones. */
    case N_brk: return -L_ENOSYS;
    case N_mremap: return -L_ENOMEM;
    case N_main_stack:
      ((uint64_t *)a)[0] = main_stack_low;
      ((uint64_t *)a)[1] = main_stack_high;
      return 0;

    case N_rt_sigaction: return d == 8 ? host_sigaction((int)a, (void *)b, (void *)c) : -L_EINVAL;
    case N_rt_sigprocmask: return d == 8 ? host_sigprocmask(a, (void *)b, (void *)c) : -L_EINVAL;
    case N_rt_sigsuspend: return host_sigsuspend((void *)a);
    case N_rt_sigpending: return host_sigpending((void *)a);
    case N_sigaltstack: return host_sigaltstack((void *)a, (void *)b);
    case N_tkill: return a > 0 ? host_kill((int)a, (int)b) : -L_EINVAL;
    case N_tgkill: return a == main_tid && b > 0 ? host_kill((int)b, (int)c) : -L_ESRCH;
    case N_kill: return a == main_tid || a == 0 ? host_kill(0, (int)b) : -L_ESRCH;
    case N_rt_sigreturn:
      /* The host calls a handler of the image as a function and goes on when it returns.
         Nothing jumps to the restorer that the libc registers. */
      host_log("host: rt_sigreturn, and no signal frame of a kernel is there\n");
      _exit(70);

    case N_sched_yield: sched_yield(); return 0;
    case N_nanosleep: return host_sleep((void *)a, (void *)b);
    case N_clock_nanosleep: return host_clock_sleep(a, b, (void *)c, (void *)d);
    case N_clock_gettime: case N_clock_getres: {
      clockid_t clock;
      struct timespec ts;
      if (host_clock(a, &clock)) return -L_EINVAL;
      if (n == N_clock_gettime ? clock_gettime(clock, &ts) : clock_getres(clock, &ts)) return to_linux_errno(errno);
      if (b) {
        touch((void *)b, sizeof(struct l_timespec));
        to_linux_timespec(&ts, (void *)b);
      }
      return 0;
    }
    case N_gettimeofday: {
      struct timeval tv;
      gettimeofday(&tv, 0);
      if (a) {
        touch((void *)a, sizeof(struct l_timeval));
        ((struct l_timeval *)a)->sec = tv.tv_sec;
        ((struct l_timeval *)a)->usec = tv.tv_usec;
      }
      return 0;
    }
    case N_futex: return host_futex((int *)a, b, (int)c, (void *)d);

    case N_getpid: return main_tid;
    case N_getppid: return getppid();
    case N_gettid: return this_thread()->tid;
    case N_set_tid_address: this_thread()->ctid = (int *)a; return this_thread()->tid;
    case N_getuid: return getuid();
    case N_geteuid: return geteuid();
    case N_getgid: return getgid();
    case N_getegid: return getegid();
    case N_arch_prctl:
      if (a != L_ARCH_SET_FS) return -L_EINVAL;
      slot_set((void *)b);
      return 0;
    case N_set_tp: slot_set((void *)a); return 0;
    /* Robust mutexes are a matter between the libc and the Linux kernel. The list of a
       thread that ends is walked by the libc itself (pthread_exit). */
    case N_set_robust_list: return 0;
    case N_prctl: return host_prctl(a, b);
    case N_uname: return host_uname((void *)a);
    case N_sysinfo: return host_sysinfo((void *)a);
    case N_sched_getaffinity: return a == 0 || a == main_tid || a == this_thread()->tid ? host_getaffinity((size_t)b, (void *)c) : -L_ESRCH;
    /* The processor and the memory node of the thread: the allocator asks, to keep memory near. */
    case N_getcpu:
      if (a) *(uint32_t *)a = 0;
      if (b) *(uint32_t *)b = 0;
      return 0;
    case N_getrlimit: return host_getrlimit(a, (void *)b);
    case N_prlimit64: return (a && a != main_tid) ? -L_ESRCH : c ? -L_EPERM : host_getrlimit(b, (void *)d);
    case N_setrlimit: return -L_EPERM;
    case N_getrusage: return host_getrusage(a, (void *)b);
    case N_getrandom: return host_getrandom((void *)a, (size_t)b);

    /* One process: the host starts no other. */
    case N_fork: case N_vfork: case N_clone: case N_execve: case N_wait4: return -L_ENOSYS;
    case N_exit: leave_thread(0, 0); return 0;
    case N_exit_group:
      write_counts();
      if (bun_host_before_exit) bun_host_before_exit();
      if (block_violations) {
        host_log("host: %lu calls of a primitive of the memory model were for pages of more than one reservation\n", block_violations);
        _exit(98);
      }
      _exit((int)a);
    default:
      break;
  }
#ifdef __linux__
  if (forward_unknown) {
    count(forwarded, n);
    long r = syscall(n, a, b, c, d, e, f);
    return r < 0 ? -(long)errno : r;
  }
#endif
  count(refused, n);
  return -L_ENOSYS;
}
__attribute__((used)) static long host_syscall(long n, long a, long b, long c, long d, long e, long f) {
  FORGET_X18();
  count(counts, n);
  if (trace > 2) host_log("[host] %s(%#lx, %#lx, %#lx, %#lx) ...\n", l_request_name(n), a, b, c, d);
  long r = dispatch(n, a, b, c, d, e, f);
  if (trace > 1 || (trace && r == -L_ENOSYS)) host_log("[host] %ld %s(%#lx, %#lx, %#lx, %#lx) = %ld\n", n, l_request_name(n), a, b, c, d, r);
  return r;
}

#if X18_HOST
IMAGE_ENTRY(host_syscall)
IMAGE_ENTRY(host_thread_create)
IMAGE_ENTRY(host_thread_exit)
#define TABLE_ENTRY(name) name##_entry
#else
#define TABLE_ENTRY(name) name
#endif

/* ---- linux x86-64: nobody but the host issues a syscall ----
   A hosted run on Linux proves little by itself: a syscall instruction of the image
   would simply work. So the kernel gets a filter (seccomp) that lets a syscall pass only
   when the instruction is in code that was executable before the image was mapped: this
   program, its libc, the vdso. From anywhere else (the image, the memory of the JIT) it is
   SIGSYS, and the host ends the process with a message and exit code 99. */
static int host_code_count;
#if defined(__linux__) && defined(__x86_64__)
struct filter_insn { uint16_t code; uint8_t jt, jf; uint32_t k; };
struct filter_program { uint16_t len; struct filter_insn *insns; };
static struct { uintptr_t start, end; } host_code[64];

static void find_host_code(void) {
  FILE *maps = fopen("/proc/self/maps", "r");
  char line[512];
  while (maps && fgets(line, sizeof line, maps)) {
    unsigned long start, end;
    char perms[8];
    if (sscanf(line, "%lx-%lx %7s", &start, &end, perms) == 3 && perms[2] == 'x' && host_code_count < 64) {
      host_code[host_code_count].start = start;
      host_code[host_code_count++].end = end + 16; /* the address that the filter sees is the one after the instruction */
    }
  }
  if (maps) fclose(maps);
}
static void on_foreign_syscall(int sig, siginfo_t *info, void *context) {
  (void)sig; (void)context;
  uintptr_t at = (uintptr_t)info->si_call_addr;
  if (at >= image_base && at < image_end) host_log("host: the image issued syscall %d itself, at image offset %#lx\n", info->si_syscall, (unsigned long)(at - image_base));
  else host_log("host: syscall %d was issued at %#lx, which is neither the host nor the image\n", info->si_syscall, (unsigned long)at);
  if (bun_host_before_exit) bun_host_before_exit();
  _exit(99);
}
static int install_syscall_filter(void) {
  enum { LOAD = 0x20, JEQ = 0x15, JGT = 0x25, JGE = 0x35, RET = 0x06, IP_LOW = 8, IP_HIGH = 12, PER_RANGE = 11 };
  static struct filter_insn insns[64 * 11 + 1];
  int n = 0;
  for (int i = 0; i < host_code_count; i++) {
    uint32_t lo_hi = (uint32_t)(host_code[i].start >> 32), lo_lo = (uint32_t)host_code[i].start;
    uint32_t hi_hi = (uint32_t)(host_code[i].end >> 32), hi_lo = (uint32_t)host_code[i].end;
    struct filter_insn range[PER_RANGE] = {
      {LOAD, 0, 0, IP_HIGH},
      {JGT, 9, 0, hi_hi},   /* above: next range */
      {JGE, 0, 8, lo_hi},   /* below: next range */
      {JEQ, 0, 3, lo_hi},   /* not the first 4 GiB of the range: the low half is free */
      {LOAD, 0, 0, IP_LOW},
      {JGE, 0, 5, lo_lo},   /* below: next range */
      {LOAD, 0, 0, IP_HIGH},
      {JEQ, 0, 2, hi_hi},   /* not the last 4 GiB of the range: inside */
      {LOAD, 0, 0, IP_LOW},
      {JGE, 1, 0, hi_lo},   /* at or after the end: next range */
      {RET, 0, 0, 0x7fff0000}, /* allow */
    };
    memcpy(insns + n, range, sizeof range);
    n += PER_RANGE;
  }
  insns[n++] = (struct filter_insn){RET, 0, 0, 0x00030000}; /* trap: SIGSYS */
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_sigaction = on_foreign_syscall;
  sa.sa_flags = SA_SIGINFO;
  sigaction(SIGSYS, &sa, 0);
  struct filter_program program = {(uint16_t)n, insns};
  if (prctl(38 /* PR_SET_NO_NEW_PRIVS */, 1, 0, 0, 0)) return -1;
  return prctl(22 /* PR_SET_SECCOMP */, 2 /* SECCOMP_MODE_FILTER */, &program);
}
#else
static void find_host_code(void) {}
static int install_syscall_filter(void) { return 1; }
#endif

/* ---- code signature, macOS on arm64 ----
   Apple Silicon maps file pages executable only if a code signature covers
   them. tools/apple_sign.py appended one for the whole image and a trailer
   that says where it is: 5 x u64, code_off, code_len, sig_off, sig_len, magic.
   Registered as in probe/apple_signed_map.c, before anything is mapped. */
#if defined(__APPLE__) && defined(__aarch64__)
static void register_signature(int fd, off_t size) {
  uint64_t t[5];
  if (size < (off_t)sizeof t || pread(fd, t, sizeof t, size - (off_t)sizeof t) != (ssize_t)sizeof t || memcmp(&t[4], "BUNSIG01", 8)) {
    fprintf(stderr, "host: the image has no code signature\n");
    return;
  }
  fsignatures_t fs = {(off_t)t[0], (void *)(uintptr_t)(t[2] - t[0]), (size_t)t[3]};
  if (fcntl(fd, F_ADDFILESIGS_RETURN, &fs) == -1) fprintf(stderr, "host: the code signature of the image was refused (%s)\n", strerror(errno));
  else if (trace) fprintf(stderr, "[host] code signature registered, it covers the file up to %#llx\n", (unsigned long long)fs.fs_file_start);
}
#else
static void register_signature(int fd, off_t size) { (void)fd; (void)size; }
#endif

/* ---- image loading and start ---- */
int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: host <image> [args]\n"); return 2; }
  find_host_code();
  trace = getenv("BUN_HOST_TRACE") ? atoi(getenv("BUN_HOST_TRACE")) : 0;
  const char *test = getenv("BUN_HOST_TEST") ? getenv("BUN_HOST_TEST") : "";
#ifdef __linux__
  forward_unknown = getenv("BUN_HOST_FORWARD") && atoi(getenv("BUN_HOST_FORWARD"));
  test_winmem = !strcmp(test, "winmem");
  test_overlay = !strcmp(test, "overlay");
#endif
#if X18_HOST
  macos_tp = !strcmp(test, "macos-tp");
#endif
  (void)test;
  if (getenv("BUN_HOST_PATHS")) paths_fd = open(getenv("BUN_HOST_PATHS"), O_WRONLY | O_CREAT | O_TRUNC | O_APPEND | O_CLOEXEC, 0644);
  if (paths_fd >= 0 && paths_fd < 1000) {
    /* Out of the way of the numbers that the image expects for its own files. */
    int high = fcntl(paths_fd, F_DUPFD_CLOEXEC, 1000);
    if (high >= 0) { close(paths_fd); paths_fd = high; }
  }
  host_page = sysconf(_SC_PAGESIZE);
  main_pthread = pthread_self();
  main_tid = next_tid = (int)getpid();
  main_thread.tid = main_tid;
  main_thread.altstack.flags = L_SS_DISABLE;

  int fd = open(argv[1], O_RDONLY);
  struct stat st;
  if (fd < 0 || fstat(fd, &st)) { perror(argv[1]); return 2; }
  register_signature(fd, st.st_size);
  unsigned char *file = mmap(0, (size_t)st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
  if (file == MAP_FAILED) { perror("map image file"); return 2; }
  Ehdr *eh = (Ehdr *)file;
  if (eh->machine != IMAGE_MACHINE) { fprintf(stderr, "host: %s is an image for another processor (ELF machine %d, this host runs %d)\n", argv[1], eh->machine, IMAGE_MACHINE); return 2; }
  Phdr *ph = (Phdr *)(file + eh->phoff);
  uint64_t top = 0;
  for (int i = 0; i < eh->phnum; i++)
    if (ph[i].type == 1 && ph[i].vaddr + ph[i].memsz > top) top = ph[i].vaddr + ph[i].memsz;
  top = (top + 0xffff) & ~0xffffull;
  /* Read-only and executable segments are mapped from the file: no copy,
     shared between processes. Writable segments are small and are copied.
     The image starts on a 64 KiB boundary, as it does in the Windows host. */
  unsigned char *area = mmap(0, top + 0x10000, PROT_NONE, MAP_PRIVATE | MAP_ANON_HOST, -1, 0);
  if (area == MAP_FAILED) { perror("reserve image"); return 2; }
  unsigned char *base = (unsigned char *)(((uintptr_t)area + 0xffff) & ~(uintptr_t)0xffff);
  if (base > area) munmap(area, (size_t)(base - area));
  munmap(base + top, (size_t)(area + 0x10000 - base));
  image_base = (uintptr_t)base;
  image_end = image_base + top;
  size_t mapped_bytes = 0, copied_bytes = 0;
  const char *code_is = "mapped from the file";
  for (int i = 0; i < eh->phnum; i++) {
    if (ph[i].type != 1) continue;
    if ((ph[i].vaddr | ph[i].offset) & (uint64_t)(host_page - 1)) { fprintf(stderr, "host: segment %d is not aligned to the host page\n", i); return 2; }
    size_t mem = (ph[i].memsz + (uint64_t)host_page - 1) & ~((uint64_t)host_page - 1);
    int prot = PROT_READ | (ph[i].flags & 1 ? PROT_EXEC : 0);
    if (!(ph[i].flags & 2)) {
      void *p = mmap(base + ph[i].vaddr, mem, prot, MAP_PRIVATE | MAP_FIXED, fd, (off_t)ph[i].offset);
      if (p != MAP_FAILED) { mapped_bytes += ph[i].filesz; continue; }
      if (trace) fprintf(stderr, "[host] file mapping with prot %d refused (%s), copying\n", prot, strerror(errno));
      if (ph[i].flags & 1) code_is = "copied (file mapping refused)";
    }
    void *p = mmap(base + ph[i].vaddr, mem, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_FIXED | MAP_ANON_HOST, -1, 0);
    if (p == MAP_FAILED) { perror("map segment"); return 2; }
    memcpy(p, file + ph[i].offset, ph[i].filesz);
    copied_bytes += ph[i].filesz;
    if (!(ph[i].flags & 2) && mprotect(p, mem, prot)) { perror("protect segment"); return 2; }
  }
  /* The image changes the protection of parts of itself (JavaScriptCore makes its
     configuration read only: two ranges in the data segment), so its segments are ranges
     of the table like everything that it maps later. */
  memory_lock();
  for (int i = 0; i < eh->phnum; i++) {
    if (ph[i].type != 1) continue;
    uintptr_t start = image_base + ph[i].vaddr;
    uint32_t prot = L_PROT_READ | (ph[i].flags & 2 ? L_PROT_WRITE : 0) | (ph[i].flags & 1 ? L_PROT_EXEC : 0);
    region_set(start, start + page_up(ph[i].memsz), prot, (ph[i].flags & 2 ? R_ANON : R_FILE) | R_COMMITTED);
  }
  memory_unlock();
  /* The Windows host has one reservation (or one view of the file) for every segment. */
  for (int i = 0; i < eh->phnum && test_winmem; i++) {
    if (ph[i].type != 1) continue;
    uintptr_t start = image_base + ph[i].vaddr;
    if (start & (MEMORY_GRANULARITY - 1)) { fprintf(stderr, "host: segment %d is not aligned to 64 KiB\n", i); return 2; }
    reservation_add(start, page_up(ph[i].memsz));
    if (model_adopt(start, granule_up(ph[i].memsz))) return 2;
  }
  uint64_t entry = eh->entry, phoff = eh->phoff, phnum = eh->phnum;
  munmap(file, (size_t)st.st_size);
  close(fd);
  if (trace) fprintf(stderr, "[host] code is %s, %zu bytes mapped from the file, %zu bytes copied\n", code_is, mapped_bytes, copied_bytes);

  pthread_key_create(&tp_key, 0);
  pthread_key_create(&thread_key, 0);
  static struct bun_host host;
  host.os = HOST_OS;
  host.tcb_offset = slot_offset();
  host.syscall = (HostSyscall *)TABLE_ENTRY(host_syscall);
  host.thread_create = (HostThreadCreate *)TABLE_ENTRY(host_thread_create);
  host.thread_exit = (HostThreadExit *)TABLE_ENTRY(host_thread_exit);
  slot_set((void *)0x1122334455667788ull);
  if (slot_read(host.tcb_offset) != (void *)0x1122334455667788ull) { fprintf(stderr, "host: thread slot is not readable at offset %#lx of the thread register\n", host.tcb_offset); return 2; }

  /* The stack of the main thread. The image asks for its bounds (N_main_stack), and for
     its size as the limit of the stack (getrlimit). */
  size_t stack_size = 8u << 20;
  char *stack = test_winmem ? (char *)model_map(0, stack_size, L_PROT_READ | L_PROT_WRITE, L_MAP_PRIVATE | L_MAP_ANONYMOUS, R_ANON | R_MAIN_STACK)
                            : mmap(0, stack_size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON_HOST, -1, 0);
  if (stack == MAP_FAILED || (test_winmem && (intptr_t)stack < 0)) { fprintf(stderr, "host: no memory for the stack\n"); return 2; }
  main_stack_low = (uintptr_t)stack;
  main_stack_high = main_stack_low + stack_size;
  if (!test_winmem) {
    memory_lock();
    region_set(main_stack_low, main_stack_high, L_PROT_READ | L_PROT_WRITE, R_ANON | R_COMMITTED | R_MAIN_STACK);
    memory_unlock();
  }
#if DELIVERS_SIGNALS
  if (test_winmem) {
    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_sigaction = native_handler;
    sa.sa_flags = SA_SIGINFO | SA_NODEFER;
    sigaction(SIGSEGV, &sa, 0);
    sigaction(SIGBUS, &sa, 0);
  }
#endif

  char *cursor = stack + stack_size - 262144;
  uint64_t *vec = (uint64_t *)(stack + stack_size - 262144 - 131072), *v = vec;
  static unsigned char random_bytes[16];
  if (getentropy(random_bytes, 16)) return 2;
  *v++ = (uint64_t)(argc - 1);
  for (int i = 1; i < argc; i++) { size_t n = strlen(argv[i]) + 1; memcpy(cursor, argv[i], n); *v++ = (uint64_t)(uintptr_t)cursor; cursor += n; }
  *v++ = 0;
  for (char **e = environ; *e && v - vec < 8000; e++) {
    size_t n = strlen(*e) + 1;
    if (cursor + n > stack + stack_size - 64) break;
    memcpy(cursor, *e, n);
    *v++ = (uint64_t)(uintptr_t)cursor;
    cursor += n;
  }
  *v++ = 0;
  /* AT_PAGESZ is the page of the host: musl for aarch64 has no fixed page size, and macOS on arm64 has 16 KiB pages. */
  uint64_t aux[] = {L_AT_PHDR, (uint64_t)(uintptr_t)(base + phoff), L_AT_PHENT, sizeof(Phdr), L_AT_PHNUM, phnum, L_AT_PAGESZ, (uint64_t)host_page,
                    L_AT_BASE, 0, L_AT_ENTRY, (uint64_t)(uintptr_t)(base + entry), L_AT_UID, 0, L_AT_EUID, 0, L_AT_GID, 0, L_AT_EGID, 0,
                    L_AT_SECURE, 0, L_AT_RANDOM, (uint64_t)(uintptr_t)random_bytes, AT_BUN_HOST, (uint64_t)(uintptr_t)&host, L_AT_NULL, 0};
  memcpy(v, aux, sizeof aux);
  if (trace) fprintf(stderr, "[host] image %lld bytes at %p to %p, host table os %lu, thread slot offset %#lx, host page %ld, forwarding %s, memory %s\n", (long long)st.st_size, (void *)base, (void *)image_end, host.os,
                     host.tcb_offset, host_page, forward_unknown ? "ON" : "off", test_winmem ? "by the model of the Windows host" : test_overlay ? "of the system, pages are discarded by a new mapping" : "of the system");
  const char *seccomp = getenv("BUN_HOST_SECCOMP");
  if (!(seccomp && !atoi(seccomp))) {
    int r = install_syscall_filter();
    if (r < 0) { fprintf(stderr, "host: the syscall filter was refused (%s). BUN_HOST_SECCOMP=0 runs without it\n", strerror(errno)); return 2; }
    syscall_filter_installed = !r;
    if (trace && !r) fprintf(stderr, "[host] syscall filter installed, %d ranges of host code\n", host_code_count);
  }
  fflush(0);
  enter_image(base + entry, vec, thread_x18());
  return 0;
}
