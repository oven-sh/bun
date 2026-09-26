// POSIX host for the portable image (x86-64 and arm64): macOS, and Linux as a test host.
// The image keeps the Linux ABI. This host maps it, builds the start stack and
// answers Linux syscall numbers with the native libc. On macOS it translates
// flags, clock ids and errno values. On Linux the same control flow runs with
// identity translations ("hosted" mode), which lets most of it be tested here.
// The host has the architecture of the image.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/uio.h>
#include <time.h>
#include <unistd.h>

#ifdef __APPLE__
#include <sys/random.h>
#define MAP_ANON_HOST MAP_ANON
int __ulock_wait(uint32_t operation, void *addr, uint64_t value, uint32_t timeout_us);
int __ulock_wake(uint32_t operation, void *addr, uint64_t wake_value);
#else
#include <sys/syscall.h>
#define MAP_ANON_HOST MAP_ANONYMOUS
#endif

#define AT_BUN_HOST 0x62756e00
extern char **environ;

/* Linux syscall numbers and flag values of the architecture of the image.
   A request that an architecture does not have is negative here: it never arrives. */
#if defined(__x86_64__)
enum {
  N_read = 0, N_write = 1, N_open = 2, N_close = 3, N_lseek = 8, N_mmap = 9, N_mprotect = 10, N_munmap = 11, N_brk = 12,
  N_rt_sigaction = 13, N_rt_sigprocmask = 14, N_ioctl = 16, N_readv = 19, N_writev = 20, N_access = 21, N_sched_yield = 24,
  N_mremap = 25, N_madvise = 28, N_nanosleep = 35, N_getpid = 39, N_exit = 60, N_unlink = 87, N_sigaltstack = 131,
  N_arch_prctl = 158, N_gettid = 186, N_tkill = 200, N_futex = 202, N_set_tid_address = 218, N_clock_gettime = 228,
  N_clock_nanosleep = 230, N_exit_group = 231, N_tgkill = 234, N_openat = 257, N_unlinkat = 263, N_faccessat = 269,
  N_set_robust_list = 273, N_getrandom = 318,
};
#define L_O_DIRECTORY 0x10000
#elif defined(__aarch64__)
enum {
  N_ioctl = 29, N_unlinkat = 35, N_faccessat = 48, N_openat = 56, N_close = 57, N_lseek = 62, N_read = 63, N_write = 64,
  N_readv = 65, N_writev = 66, N_exit = 93, N_exit_group = 94, N_set_tid_address = 96, N_futex = 98, N_set_robust_list = 99,
  N_nanosleep = 101, N_clock_gettime = 113, N_clock_nanosleep = 115, N_sched_yield = 124, N_tkill = 130, N_tgkill = 131,
  N_sigaltstack = 132, N_rt_sigaction = 134, N_rt_sigprocmask = 135, N_getpid = 172, N_gettid = 178, N_brk = 214,
  N_munmap = 215, N_mremap = 216, N_mmap = 222, N_mprotect = 226, N_madvise = 233, N_getrandom = 278,
  N_open = -1, N_access = -2, N_unlink = -3, N_arch_prctl = -4,
};
#define L_O_DIRECTORY 0x4000
#else
#error "host_posix.c: x86-64 or arm64"
#endif
/* BUN_SYS_set_tp, a request of the image that is not a Linux syscall: set the
   thread pointer. aarch64 images send it (Linux has no syscall for that
   there), x86-64 images send arch_prctl. */
#define N_set_tp 0x62756e01

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
};

static pthread_key_t tp_key, thread_key;
static int trace;

/* ---- thread pointer slot ---- */
#if defined(__APPLE__)
/* macOS: the slot is a pthread key. The keys of a thread are an array at the
   thread register: gs on x86-64, tpidrro_el0 without its low 3 bits on arm64
   (xnu, libsyscall/os/tsd.h). main() checks that before it starts the image. */
#define HOST_OS 3
static unsigned long slot_offset(void) { return (unsigned long)tp_key * 8; }
static void slot_set(void *tp) { pthread_setspecific(tp_key, tp); }
static void *thread_x18(void) { return 0; }
static void slot_release(void) {}
#elif defined(__x86_64__)
/* Linux test host: glibc owns fs, so the slot is the first word of a block that gs points at. */
#define HOST_OS 3
static unsigned long slot_offset(void) { return 0; }
static void slot_set(void *tp) {
  void **block = pthread_getspecific(tp_key);
  if (!block) {
    block = calloc(8, sizeof *block);
    pthread_setspecific(tp_key, block);
    syscall(SYS_arch_prctl, 0x1001, block);
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
#define HOST_OS (macos_tp ? 3 : 2)
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

/* ---- translation, Linux ABI on the left ---- */
enum { L_ENOENT = 2, L_EIO = 5, L_EBADF = 9, L_EAGAIN = 11, L_ENOMEM = 12, L_EACCES = 13, L_EEXIST = 17, L_EINVAL = 22, L_ENOTTY = 25, L_ENOSYS = 38, L_ETIMEDOUT = 110, L_EINTR = 4 };
static long to_linux_errno(int e) {
  switch (e) {
    case EAGAIN: return -L_EAGAIN;
    case ETIMEDOUT: return -L_ETIMEDOUT;
    case ENOSYS: return -L_ENOSYS;
    default: return e > 0 && e < 35 ? -e : -L_EIO; /* 1..34 agree between Linux and the BSDs */
  }
}
static long ret(long r) { return r < 0 ? to_linux_errno(errno) : r; }
static int host_open_flags(long f) {
  int h = (int)(f & 3);
  if (f & 0x40) h |= O_CREAT;
  if (f & 0x80) h |= O_EXCL;
  if (f & 0x200) h |= O_TRUNC;
  if (f & 0x400) h |= O_APPEND;
  if (f & 0x800) h |= O_NONBLOCK;
  if (f & 0x80000) h |= O_CLOEXEC;
  if (f & L_O_DIRECTORY) h |= O_DIRECTORY;
  return h;
}
static int host_map_flags(long f) {
  int h = 0;
  if (f & 1) h |= MAP_SHARED;
  if (f & 2) h |= MAP_PRIVATE;
  if (f & 0x10) h |= MAP_FIXED;
  if (f & 0x20) h |= MAP_ANON_HOST;
  return h;
}
static clockid_t host_clock(long c) {
  switch (c) {
    case 0: return CLOCK_REALTIME;
    case 2: return CLOCK_PROCESS_CPUTIME_ID;
    case 3: return CLOCK_THREAD_CPUTIME_ID;
    default: return CLOCK_MONOTONIC;
  }
}
struct l_timespec { long sec, nsec; };

static long host_futex(int *addr, long op, int val, const struct l_timespec *timeout) {
  int cmd = op & 127;
#ifdef __APPLE__
  if (cmd == 0) {
    uint32_t us = 0;
    if (timeout) {
      long long t = timeout->sec * 1000000ll + (timeout->nsec + 999) / 1000;
      us = t <= 0 ? 1 : t > 0xfffffffe ? 0xfffffffe : (uint32_t)t;
    }
    int r = __ulock_wait(1 | 0x1000000, addr, (uint32_t)val, us);
    if (r >= 0) return 0;
    return r == -ETIMEDOUT ? -L_ETIMEDOUT : r == -EINTR ? -L_EINTR : -L_EAGAIN;
  }
  if (cmd == 1 || cmd == 3 || cmd == 4) {
    int all = cmd != 1 || val != 1;
    __ulock_wake(1 | 0x1000000 | (all ? 0x100 : 0), addr, 0);
    return val > 0 ? 1 : 0;
  }
  return -L_ENOSYS;
#else
  if (cmd == 3 || cmd == 4) { cmd = 1; val = 0x7fffffff; }
  struct timespec ts, *tp = 0;
  if (timeout && cmd == 0) { ts.tv_sec = timeout->sec; ts.tv_nsec = timeout->nsec; tp = &ts; }
  return ret(syscall(SYS_futex, addr, cmd, val, tp, 0, 0));
#endif
}

/* ---- threads ---- */
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
  if (t->unmap_base) munmap(t->unmap_base, t->unmap_size);
  int *ctid = t->ctid;
  free(t);
  slot_release();
  if (ctid) {
    *ctid = 0;
    host_futex(ctid, 1, 0x7fffffff, 0);
  }
  return 0;
}
__attribute__((used)) static long host_thread_create(ImageThreadFn fn, void *stack, long flags, void *arg, int *ptid, void *tls, int *ctid) {
  FORGET_X18();
#if X18_HOST
  if (macos_tp) return -L_EAGAIN;
#endif
  static int next_tid = 1000;
  struct host_thread *t = calloc(1, sizeof *t);
  if (!t) return -L_ENOMEM;
  t->fn = fn; t->arg = arg; t->tls = tls; t->stack_top = stack;
  t->ctid = flags & 0x200000 ? ctid : 0;
  int tid = __sync_add_and_fetch(&next_tid, 1);
  if (flags & 0x100000) *ptid = tid;
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setstacksize(&attr, 1 << 20);
  pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
  pthread_t th;
  int e = pthread_create(&th, &attr, thread_main, t);
  pthread_attr_destroy(&attr);
  if (e) { free(t); return -L_EAGAIN; }
  return tid;
}
static void leave_thread(void *base, unsigned long size) {
  struct host_thread *t = pthread_getspecific(thread_key);
  if (!t) pthread_exit(0);
  t->unmap_base = base;
  t->unmap_size = size;
  return_to_host(&t->ctx);
}
__attribute__((used)) static void host_thread_exit(void *base, unsigned long size) { leave_thread(base, size); }

/* ---- syscalls ---- */
__attribute__((used)) static long host_syscall(long n, long a, long b, long c, long d, long e, long f) {
  FORGET_X18();
  long r;
  switch (n) {
    case N_read: r = ret(read((int)a, (void *)b, (size_t)c)); break;
    case N_write: r = ret(write((int)a, (void *)b, (size_t)c)); break;
    case N_open: r = ret(open((const char *)a, host_open_flags(b), (mode_t)c)); break;
    case N_openat: r = ret(openat((int)a == -100 ? AT_FDCWD : (int)a, (const char *)b, host_open_flags(c), (mode_t)d)); break;
    case N_close: r = a > 2 ? ret(close((int)a)) : 0; break;
    case N_lseek: r = ret(lseek((int)a, (off_t)b, (int)c)); break;
    case N_mmap: {
      void *p = mmap((void *)a, (size_t)b, (int)(c & 7), host_map_flags(d), (int)e, (off_t)f);
      r = p == MAP_FAILED ? to_linux_errno(errno) : (long)p;
      break;
    }
    case N_mprotect: r = ret(mprotect((void *)a, (size_t)b, (int)(c & 7))); break;
    case N_munmap: r = ret(munmap((void *)a, (size_t)b)); break;
    case N_brk: r = -L_ENOSYS; break;
    case N_mremap: r = -L_ENOMEM; break;
    case N_madvise: r = 0; break;
    case N_rt_sigaction: case N_rt_sigprocmask: case N_sigaltstack: case N_set_robust_list: r = 0; break;
    case N_ioctl:
      if (b == 0x5413 && isatty((int)a)) { unsigned short *w = (void *)c; w[0] = 24; w[1] = 80; w[2] = w[3] = 0; r = 0; }
      else r = -L_ENOTTY;
      break;
    case N_readv: r = ret(readv((int)a, (void *)b, (int)c)); break;
    case N_writev: r = ret(writev((int)a, (void *)b, (int)c)); break;
    case N_access: r = ret(access((const char *)a, (int)b)); break;
    case N_faccessat: r = ret(access((const char *)b, (int)c)); break;
    case N_unlink: r = ret(unlink((const char *)a)); break;
    case N_unlinkat: r = ret(unlink((const char *)b)); break;
    case N_sched_yield: sched_yield(); r = 0; break;
    case N_nanosleep: case N_clock_nanosleep: {
      const struct l_timespec *t = (void *)(n == N_nanosleep ? a : c);
      struct timespec ts = {t->sec, t->nsec};
      nanosleep(&ts, 0);
      r = 0;
      break;
    }
    case N_getpid: r = getpid(); break;
    case N_gettid: case N_set_tid_address: r = (long)(uintptr_t)pthread_self() & 0x3fffffff; break;
    case N_arch_prctl:
      if (a == 0x1002) { slot_set((void *)b); r = 0; } else r = -L_EINVAL;
      break;
    case N_set_tp: slot_set((void *)a); r = 0; break;
    case N_futex: r = host_futex((int *)a, b, (int)c, (void *)d); break;
    case N_clock_gettime: {
      struct timespec ts;
      r = ret(clock_gettime(host_clock(a), &ts));
      ((struct l_timespec *)b)->sec = ts.tv_sec;
      ((struct l_timespec *)b)->nsec = ts.tv_nsec;
      break;
    }
    case N_getrandom: {
      size_t done = 0;
      while (done < (size_t)b) { size_t k = (size_t)b - done > 256 ? 256 : (size_t)b - done; if (getentropy((char *)a + done, k)) break; done += k; }
      r = (long)done;
      break;
    }
    case N_exit: leave_thread(0, 0); r = 0; break;
    case N_exit_group: _exit((int)a);
    case N_tkill: case N_tgkill: _exit(134);
    default: r = -L_ENOSYS; break;
  }
  if (trace && (r == -L_ENOSYS || trace > 1)) fprintf(stderr, "[host] syscall %ld(%#lx, %#lx, %#lx) = %ld\n", n, a, b, c, r);
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
typedef struct { unsigned char ident[16]; uint16_t type, machine; uint32_t version; uint64_t entry, phoff, shoff; uint32_t flags; uint16_t ehsize, phentsize, phnum, shentsize, shnum, shstrndx; } Ehdr;
typedef struct { uint32_t type, flags; uint64_t offset, vaddr, paddr, filesz, memsz, align; } Phdr;
#if defined(__x86_64__)
#define IMAGE_MACHINE 62
#else
#define IMAGE_MACHINE 183
#endif

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: host <image> [args]\n"); return 2; }
  trace = getenv("BUN_HOST_TRACE") ? atoi(getenv("BUN_HOST_TRACE")) : 0;
#if X18_HOST
  macos_tp = getenv("BUN_HOST_TEST") && !strcmp(getenv("BUN_HOST_TEST"), "macos-tp");
#endif
  int fd = open(argv[1], O_RDONLY);
  struct stat st;
  if (fd < 0 || fstat(fd, &st)) { perror(argv[1]); return 2; }
  register_signature(fd, st.st_size);
  unsigned char *file = mmap(0, st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
  if (file == MAP_FAILED) { perror("map image file"); return 2; }
  Ehdr *eh = (Ehdr *)file;
  if (eh->machine != IMAGE_MACHINE) { fprintf(stderr, "host: %s is an image for another processor (ELF machine %d, this host runs %d)\n", argv[1], eh->machine, IMAGE_MACHINE); return 2; }
  Phdr *ph = (Phdr *)(file + eh->phoff);
  uint64_t top = 0;
  for (int i = 0; i < eh->phnum; i++)
    if (ph[i].type == 1 && ph[i].vaddr + ph[i].memsz > top) top = ph[i].vaddr + ph[i].memsz;
  top = (top + 0xffff) & ~0xffffull;
  /* Read-only and executable segments are mapped from the file: no copy,
     shared between processes. Writable segments are small and are copied. */
  unsigned char *base = mmap(0, top, PROT_NONE, MAP_PRIVATE | MAP_ANON_HOST, -1, 0);
  if (base == MAP_FAILED) { perror("reserve image"); return 2; }
  long host_page = sysconf(_SC_PAGESIZE);
  size_t mapped_bytes = 0, copied_bytes = 0;
  const char *code_is = "mapped from the file";
  for (int i = 0; i < eh->phnum; i++) {
    if (ph[i].type != 1) continue;
    if ((ph[i].vaddr | ph[i].offset) & (host_page - 1)) { fprintf(stderr, "host: segment %d is not aligned to the host page\n", i); return 2; }
    size_t mem = (ph[i].memsz + host_page - 1) & ~(host_page - 1);
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

  size_t stack_size = 8u << 20;
  char *stack = mmap(0, stack_size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON_HOST, -1, 0);
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
  /* AT_PAGESZ (6) is the page of the host: musl for aarch64 has no fixed page size, and macOS on arm64 has 16 KiB pages. */
  uint64_t aux[] = {3, (uint64_t)(uintptr_t)(base + eh->phoff), 4, sizeof(Phdr), 5, eh->phnum, 6, (uint64_t)host_page, 7, 0, 9, (uint64_t)(uintptr_t)(base + eh->entry),
                    11, 0, 12, 0, 13, 0, 14, 0, 23, 0, 25, (uint64_t)(uintptr_t)random_bytes, AT_BUN_HOST, (uint64_t)(uintptr_t)&host, 0, 0};
  memcpy(v, aux, sizeof aux);
  if (trace) fprintf(stderr, "[host] image %lld bytes at %p, host table os %lu, thread slot offset %#lx, host page %ld\n", (long long)st.st_size, (void *)base, host.os, host.tcb_offset, host_page);
  fflush(0);
  enter_image(base + eh->entry, vec, thread_x18());
  return 0;
}
