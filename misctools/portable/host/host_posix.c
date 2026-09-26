// POSIX host for the portable image (x86-64): macOS, and Linux as a test host.
// The image keeps the Linux ABI. This host maps it, builds the start stack and
// answers Linux syscall numbers with the native libc. On macOS it translates
// flags, clock ids and errno values. On Linux the same control flow runs with
// identity translations ("hosted" mode), which lets most of it be tested here.
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
#include <linux/futex.h>
#define MAP_ANON_HOST MAP_ANONYMOUS
#endif

#define AT_BUN_HOST 0x62756e00
#define PAGE 4096ull
extern char **environ;

typedef int (*ImageThreadFn)(void *);
struct bun_host {
  unsigned long os, tcb_offset;
  long (*syscall)(long, long, long, long, long, long, long);
  long (*thread_create)(ImageThreadFn, void *, long, void *, int *, void *, int *);
  void (*thread_exit)(void *, unsigned long);
};
struct context { void *rbx, *rbp, *r12, *r13, *r14, *r15, *rsp; };
struct host_thread {
  struct context ctx;
  ImageThreadFn fn;
  void *arg, *tls, *stack_top;
  int *ctid;
  void *unmap_base;
  size_t unmap_size;
};

static pthread_key_t tp_key, thread_key;
static int trace;

__attribute__((naked)) static void enter_image_stack(struct context *save, void *sp, void (*fn)(void *), void *arg) {
  __asm__("mov %rbx, 0(%rdi)\n mov %rbp, 8(%rdi)\n mov %r12, 16(%rdi)\n mov %r13, 24(%rdi)\n"
          "mov %r14, 32(%rdi)\n mov %r15, 40(%rdi)\n mov %rsp, 48(%rdi)\n"
          "mov %rsi, %rsp\n mov %rcx, %rdi\n xor %ebp, %ebp\n call *%rdx\n ud2\n");
}
__attribute__((naked)) static void return_to_host(struct context *save) {
  __asm__("mov 0(%rdi), %rbx\n mov 8(%rdi), %rbp\n mov 16(%rdi), %r12\n mov 24(%rdi), %r13\n"
          "mov 32(%rdi), %r14\n mov 40(%rdi), %r15\n mov 48(%rdi), %rsp\n ret\n");
}

/* ---- thread pointer slot ---- */
#ifdef __APPLE__
static unsigned long slot_offset(void) { return (unsigned long)tp_key * 8; }
static void slot_set(void *tp) { pthread_setspecific(tp_key, tp); }
#else
/* Linux test host: glibc owns fs, so the slot is the first word of a block that gs points at. */
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
#endif
static void *slot_read(unsigned long off) {
  void *v;
  __asm__("mov %%gs:(%1), %0" : "=r"(v) : "r"(off));
  return v;
}

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
  if (f & 0x10000) h |= O_DIRECTORY;
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
  t->fn(t->arg);
  return_to_host(&t->ctx);
}
static void *thread_main(void *p) {
  struct host_thread *t = p;
  pthread_setspecific(thread_key, t);
  slot_set(t->tls);
  enter_image_stack(&t->ctx, (void *)((uintptr_t)t->stack_top & ~15ull), on_image_stack, t);
  if (t->unmap_base) munmap(t->unmap_base, t->unmap_size);
  int *ctid = t->ctid;
  free(t);
  if (ctid) {
    *ctid = 0;
    host_futex(ctid, 1, 0x7fffffff, 0);
  }
  return 0;
}
static long host_thread_create(ImageThreadFn fn, void *stack, long flags, void *arg, int *ptid, void *tls, int *ctid) {
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
static void host_thread_exit(void *base, unsigned long size) { leave_thread(base, size); }

/* ---- syscalls ---- */
static long host_syscall(long n, long a, long b, long c, long d, long e, long f) {
  long r;
  switch (n) {
    case 0: r = ret(read((int)a, (void *)b, (size_t)c)); break;
    case 1: r = ret(write((int)a, (void *)b, (size_t)c)); break;
    case 2: r = ret(open((const char *)a, host_open_flags(b), (mode_t)c)); break;
    case 257: r = ret(openat((int)a == -100 ? AT_FDCWD : (int)a, (const char *)b, host_open_flags(c), (mode_t)d)); break;
    case 3: r = a > 2 ? ret(close((int)a)) : 0; break;
    case 8: r = ret(lseek((int)a, (off_t)b, (int)c)); break;
    case 9: {
      void *p = mmap((void *)a, (size_t)b, (int)(c & 7), host_map_flags(d), (int)e, (off_t)f);
      r = p == MAP_FAILED ? to_linux_errno(errno) : (long)p;
      break;
    }
    case 10: r = ret(mprotect((void *)a, (size_t)b, (int)(c & 7))); break;
    case 11: r = ret(munmap((void *)a, (size_t)b)); break;
    case 12: r = -L_ENOSYS; break;
    case 25: r = -L_ENOMEM; break;
    case 28: r = 0; break;
    case 13: case 14: case 131: case 273: r = 0; break;
    case 16:
      if (b == 0x5413 && isatty((int)a)) { unsigned short *w = (void *)c; w[0] = 24; w[1] = 80; w[2] = w[3] = 0; r = 0; }
      else r = -L_ENOTTY;
      break;
    case 19: r = ret(readv((int)a, (void *)b, (int)c)); break;
    case 20: r = ret(writev((int)a, (void *)b, (int)c)); break;
    case 21: r = ret(access((const char *)a, (int)b)); break;
    case 269: r = ret(access((const char *)b, (int)c)); break;
    case 87: r = ret(unlink((const char *)a)); break;
    case 263: r = ret(unlink((const char *)b)); break;
    case 24: sched_yield(); r = 0; break;
    case 35: case 230: {
      const struct l_timespec *t = (void *)(n == 35 ? a : c);
      struct timespec ts = {t->sec, t->nsec};
      nanosleep(&ts, 0);
      r = 0;
      break;
    }
    case 39: r = getpid(); break;
    case 186: case 218: r = (long)(uintptr_t)pthread_self() & 0x3fffffff; break;
    case 158:
      if (a == 0x1002) { slot_set((void *)b); r = 0; } else r = -L_EINVAL;
      break;
    case 202: r = host_futex((int *)a, b, (int)c, (void *)d); break;
    case 228: {
      struct timespec ts;
      r = ret(clock_gettime(host_clock(a), &ts));
      ((struct l_timespec *)b)->sec = ts.tv_sec;
      ((struct l_timespec *)b)->nsec = ts.tv_nsec;
      break;
    }
    case 318: {
      size_t done = 0;
      while (done < (size_t)b) { size_t k = (size_t)b - done > 256 ? 256 : (size_t)b - done; if (getentropy((char *)a + done, k)) break; done += k; }
      r = (long)done;
      break;
    }
    case 60: leave_thread(0, 0); r = 0; break;
    case 231: _exit((int)a);
    case 200: case 234: _exit(134);
    default: r = -L_ENOSYS; break;
  }
  if (trace && (r == -L_ENOSYS || trace > 1)) fprintf(stderr, "[host] syscall %ld(%#lx, %#lx, %#lx) = %ld\n", n, a, b, c, r);
  return r;
}

/* ---- image loading and start ---- */
typedef struct { unsigned char ident[16]; uint16_t type, machine; uint32_t version; uint64_t entry, phoff, shoff; uint32_t flags; uint16_t ehsize, phentsize, phnum, shentsize, shnum, shstrndx; } Ehdr;
typedef struct { uint32_t type, flags; uint64_t offset, vaddr, paddr, filesz, memsz, align; } Phdr;

__attribute__((naked)) static void enter_image(void *entry, void *sp) {
  __asm__("mov %rsi, %rsp\n xor %ebp, %ebp\n xor %edx, %edx\n jmp *%rdi\n");
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: host <image> [args]\n"); return 2; }
  trace = getenv("BUN_HOST_TRACE") ? atoi(getenv("BUN_HOST_TRACE")) : 0;
  int fd = open(argv[1], O_RDONLY);
  struct stat st;
  if (fd < 0 || fstat(fd, &st)) { perror(argv[1]); return 2; }
  unsigned char *file = mmap(0, st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
  if (file == MAP_FAILED) { perror("map image file"); return 2; }
  Ehdr *eh = (Ehdr *)file;
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
  host.os = 3;
  host.tcb_offset = slot_offset();
  host.syscall = host_syscall;
  host.thread_create = host_thread_create;
  host.thread_exit = host_thread_exit;
  slot_set((void *)0x1122334455667788ull);
  if (slot_read(host.tcb_offset) != (void *)0x1122334455667788ull) { fprintf(stderr, "host: thread slot is not readable through gs at offset %#lx\n", host.tcb_offset); return 2; }

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
  uint64_t aux[] = {3, (uint64_t)(uintptr_t)(base + eh->phoff), 4, sizeof(Phdr), 5, eh->phnum, 6, PAGE, 7, 0, 9, (uint64_t)(uintptr_t)(base + eh->entry),
                    11, 0, 12, 0, 13, 0, 14, 0, 23, 0, 25, (uint64_t)(uintptr_t)random_bytes, AT_BUN_HOST, (uint64_t)(uintptr_t)&host, 0, 0};
  memcpy(v, aux, sizeof aux);
  if (trace) fprintf(stderr, "[host] image %lld bytes at %p, thread slot offset %#lx, host page %ld\n", (long long)st.st_size, (void *)base, host.tcb_offset, host_page);
  fflush(0);
  enter_image(base + eh->entry, vec);
  return 0;
}
