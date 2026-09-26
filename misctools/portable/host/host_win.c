// Windows host for the portable image (x86-64 and arm64).
// It maps the image, builds a Linux-style start stack, and serves the image's
// OS requests: Linux syscall numbers come in with the calling convention of
// the image and are answered with Win32. The image itself is never modified.
// The host has the architecture of the image.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define AT_BUN_HOST 0x62756e00
#define AT_BUN_HOST_ENTRIES 0x62756e10
#define PAGE 4096ull

/* Calling convention of the image, and the Linux syscall numbers of its
   architecture. A request that an architecture does not have is negative
   here: it never arrives. */
#if defined(__x86_64__)
#define SYSV __attribute__((sysv_abi))
#define IMAGE_MACHINE 62
enum {
  N_read = 0, N_write = 1, N_open = 2, N_close = 3, N_lseek = 8, N_mmap = 9, N_mprotect = 10, N_munmap = 11, N_brk = 12,
  N_rt_sigaction = 13, N_rt_sigprocmask = 14, N_ioctl = 16, N_readv = 19, N_writev = 20, N_access = 21, N_sched_yield = 24,
  N_mremap = 25, N_madvise = 28, N_nanosleep = 35, N_getpid = 39, N_exit = 60, N_unlink = 87, N_sigaltstack = 131,
  N_arch_prctl = 158, N_gettid = 186, N_tkill = 200, N_futex = 202, N_set_tid_address = 218, N_clock_gettime = 228,
  N_clock_nanosleep = 230, N_exit_group = 231, N_tgkill = 234, N_openat = 257, N_unlinkat = 263, N_faccessat = 269,
  N_set_robust_list = 273, N_getrandom = 318,
};
#elif defined(__aarch64__)
/* The image is AAPCS64 as on Linux, the host is AAPCS64 as on Windows. For the
   functions of the host table the two agree: up to 7 integer or pointer
   arguments in x0 to x6, the result in x0, x19 to x28 and d8 to d15 kept by
   the callee. They differ for variadic functions and in x18, which is the TEB
   here: the image is built with -ffixed-x18 and no host table function is
   variadic. */
#define SYSV
#define IMAGE_MACHINE 183
enum {
  N_ioctl = 29, N_unlinkat = 35, N_faccessat = 48, N_openat = 56, N_close = 57, N_lseek = 62, N_read = 63, N_write = 64,
  N_readv = 65, N_writev = 66, N_exit = 93, N_exit_group = 94, N_set_tid_address = 96, N_futex = 98, N_set_robust_list = 99,
  N_nanosleep = 101, N_clock_gettime = 113, N_clock_nanosleep = 115, N_sched_yield = 124, N_tkill = 130, N_tgkill = 131,
  N_sigaltstack = 132, N_rt_sigaction = 134, N_rt_sigprocmask = 135, N_getpid = 172, N_gettid = 178, N_brk = 214,
  N_munmap = 215, N_mremap = 216, N_mmap = 222, N_mprotect = 226, N_madvise = 233, N_getrandom = 278,
  N_open = -1, N_access = -2, N_unlink = -3, N_arch_prctl = -4,
};
#else
#error "host_win.c: x86-64 or arm64"
#endif
/* BUN_SYS_set_tp, a request of the image that is not a Linux syscall: set the
   thread pointer. aarch64 images send it (Linux has no syscall for that
   there), x86-64 images send arch_prctl. */
#define N_set_tp 0x62756e01
/* BUN_SYS_adopt_thread(tp, leave, stack): the calling thread is not one that
   the image created, and it has entered the image. tp becomes its thread
   pointer, and when the thread ends leave(tp) is called on it. stack gets the
   lowest address of the stack of the thread and its size. */
#define N_adopt_thread 0x62756e02

/* Offsets in the TEB, the same on x64 and on arm64. The image reads its thread
   pointer at TEB + TEB_TLS_SLOTS + 8 * slot: through gs on x64, through x18 on
   arm64, which is what NtCurrentTeb() reads. Not from the SDK headers, which
   keep the TEB opaque. For arm64: the Go runtime reads a TlsAlloc slot at
   x18 + 0x1480 + 8 * slot (runtime/sys_windows_arm64.s, TEB_TlsSlots),
   Boost.Context has x18 + 0x1478 as TeDeallocationStack. main() checks the
   slot before it starts the image. */
#define TEB_DEALLOCATION_STACK 0x1478
#define TEB_TLS_SLOTS 0x1480

typedef SYSV int (*ImageThreadFn)(void *);
struct bun_host {
  unsigned long long os, tcb_offset;
  SYSV long long (*syscall)(long long, long long, long long, long long, long long, long long, long long);
  SYSV long long (*thread_create)(ImageThreadFn, void *, long long, void *, int *, void *, int *);
  SYSV void (*thread_exit)(void *, unsigned long long);
  SYSV void *(*lookup)(const char *, const char *);
  unsigned long long native_os;
};
#define BUN_HOST_ENTRIES (sizeof(struct bun_host) / sizeof(unsigned long long))

struct host_thread {
  ImageThreadFn fn;
  void *arg, *tls, *stack_top;
  int *ctid;
  void *landing_sp, *unmap_base;
  size_t unmap_size;
  void *orig_base, *orig_limit, *orig_dealloc;
};

static DWORD tp_slot, thread_slot, adopted_slot;
static int trace;
static LARGE_INTEGER qpc_freq;

/* ---- errno ---- */
enum { L_ENOENT = 2, L_EIO = 5, L_EBADF = 9, L_EAGAIN = 11, L_ENOMEM = 12, L_EACCES = 13, L_EEXIST = 17, L_EINVAL = 22, L_EMFILE = 24, L_ENOTTY = 25, L_ENOSYS = 38, L_ETIMEDOUT = 110 };
static long long win_error(void) {
  switch (GetLastError()) {
    case ERROR_FILE_NOT_FOUND: case ERROR_PATH_NOT_FOUND: case ERROR_INVALID_NAME: return -L_ENOENT;
    case ERROR_ACCESS_DENIED: case ERROR_SHARING_VIOLATION: return -L_EACCES;
    case ERROR_FILE_EXISTS: case ERROR_ALREADY_EXISTS: return -L_EEXIST;
    case ERROR_NOT_ENOUGH_MEMORY: case ERROR_OUTOFMEMORY: case ERROR_COMMITMENT_LIMIT: return -L_ENOMEM;
    case ERROR_INVALID_HANDLE: return -L_EBADF;
    default: return -L_EIO;
  }
}

/* ---- memory ---- */
struct region { char *base; size_t size; };
static struct region regions[8192];
static int region_count;
static SRWLOCK region_lock = SRWLOCK_INIT;

static DWORD win_prot(long long prot) {
  switch (prot & 7) {
    case 0: return PAGE_NOACCESS;
    case 1: return PAGE_READONLY;
    case 2: case 3: return PAGE_READWRITE;
    case 4: return PAGE_EXECUTE;
    case 5: return PAGE_EXECUTE_READ;
    default: return PAGE_EXECUTE_READWRITE;
  }
}
static struct region *find_region(char *p) {
  for (int i = 0; i < region_count; i++)
    if (p >= regions[i].base && p < regions[i].base + regions[i].size) return &regions[i];
  return 0;
}
static long long host_mmap(char *addr, size_t len, long long prot, long long flags, long long fd) {
  if (!(flags & 0x20) || fd != -1) return -L_ENOSYS;
  len = (len + PAGE - 1) & ~(PAGE - 1);
  if (flags & 0x10) {
    AcquireSRWLockShared(&region_lock);
    struct region *r = find_region(addr);
    ReleaseSRWLockShared(&region_lock);
    if (!r || addr + len > r->base + r->size) return -L_ENOMEM;
    VirtualFree(addr, len, MEM_DECOMMIT);
    return VirtualAlloc(addr, len, MEM_COMMIT, win_prot(prot)) ? (long long)(intptr_t)addr : -L_ENOMEM;
  }
  char *p = VirtualAlloc(0, len, MEM_RESERVE | MEM_COMMIT, win_prot(prot));
  if (!p) return -L_ENOMEM;
  AcquireSRWLockExclusive(&region_lock);
  if (region_count == 8192) { ReleaseSRWLockExclusive(&region_lock); VirtualFree(p, 0, MEM_RELEASE); return -L_ENOMEM; }
  regions[region_count++] = (struct region){p, len};
  ReleaseSRWLockExclusive(&region_lock);
  return (long long)(intptr_t)p;
}
static long long host_munmap(char *addr, size_t len) {
  len = (len + PAGE - 1) & ~(PAGE - 1);
  AcquireSRWLockExclusive(&region_lock);
  struct region *r = find_region(addr);
  if (r && r->base == addr && len >= r->size) {
    *r = regions[--region_count];
    ReleaseSRWLockExclusive(&region_lock);
    VirtualFree(addr, 0, MEM_RELEASE);
    return 0;
  }
  ReleaseSRWLockExclusive(&region_lock);
  if (!r) return -L_EINVAL;
  VirtualFree(addr, len, MEM_DECOMMIT);
  return 0;
}
static long long host_mprotect(char *addr, size_t len, long long prot) {
  DWORD old;
  len = (len + PAGE - 1) & ~(PAGE - 1);
  if (VirtualProtect(addr, len, win_prot(prot), &old)) return 0;
  if (VirtualAlloc(addr, len, MEM_COMMIT, win_prot(prot))) return 0;
  return -L_ENOMEM;
}

/* ---- files ---- */
static HANDLE fds[1024];
static SRWLOCK fd_lock = SRWLOCK_INIT;
/* A file descriptor is an int: the upper half of the register it arrives in is not part of it. */
static HANDLE fd_handle(long long wide) { int fd = (int)wide; return fd >= 0 && fd < 1024 ? fds[fd] : 0; }
static long long fd_put(HANDLE h) {
  AcquireSRWLockExclusive(&fd_lock);
  for (int i = 3; i < 1024; i++)
    if (!fds[i]) { fds[i] = h; ReleaseSRWLockExclusive(&fd_lock); return i; }
  ReleaseSRWLockExclusive(&fd_lock);
  CloseHandle(h);
  return -L_EMFILE;
}
static int to_wide(const char *s, wchar_t *out, int cap) { return MultiByteToWideChar(CP_UTF8, 0, s, -1, out, cap); }
static long long host_open(const char *path, long long flags) {
  wchar_t w[32768 / 8];
  if (!to_wide(path, w, sizeof w / sizeof *w)) return -L_ENOENT;
  DWORD access = (flags & 3) == 0 ? GENERIC_READ : (flags & 3) == 1 ? GENERIC_WRITE : GENERIC_READ | GENERIC_WRITE;
  int creat = !!(flags & 0x40), excl = !!(flags & 0x80), trunc = !!(flags & 0x200);
  DWORD how = creat && excl ? CREATE_NEW : creat && trunc ? CREATE_ALWAYS : creat ? OPEN_ALWAYS : trunc ? TRUNCATE_EXISTING : OPEN_EXISTING;
  HANDLE h = CreateFileW(w, access, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, 0, how, FILE_ATTRIBUTE_NORMAL, 0);
  if (h == INVALID_HANDLE_VALUE) return win_error();
  return fd_put(h);
}
static long long host_rw(long long fd, char *buf, size_t len, int write) {
  HANDLE h = fd_handle(fd);
  if (!h) return -L_EBADF;
  DWORD done = 0, n = len > 0x40000000 ? 0x40000000 : (DWORD)len;
  BOOL ok = write ? WriteFile(h, buf, n, &done, 0) : ReadFile(h, buf, n, &done, 0);
  if (!ok) return GetLastError() == ERROR_BROKEN_PIPE || GetLastError() == ERROR_HANDLE_EOF ? 0 : win_error();
  return done;
}
struct l_iovec { char *base; size_t len; };
static long long host_rwv(long long fd, struct l_iovec *v, long long n, int write) {
  long long total = 0;
  for (long long i = 0; i < n; i++) {
    if (!v[i].len) continue;
    long long r = host_rw(fd, v[i].base, v[i].len, write);
    if (r < 0) return total ? total : r;
    total += r;
    if ((size_t)r < v[i].len) break;
  }
  return total;
}

/* ---- time ---- */
struct l_timespec { long long sec, nsec; };
static long long host_clock_gettime(long long clock, struct l_timespec *ts) {
  if (clock == 0) {
    FILETIME ft;
    GetSystemTimePreciseAsFileTime(&ft);
    unsigned long long t = ((unsigned long long)ft.dwHighDateTime << 32 | ft.dwLowDateTime) - 116444736000000000ull;
    ts->sec = t / 10000000; ts->nsec = (t % 10000000) * 100;
    return 0;
  }
  LARGE_INTEGER c;
  QueryPerformanceCounter(&c);
  ts->sec = c.QuadPart / qpc_freq.QuadPart;
  ts->nsec = (c.QuadPart % qpc_freq.QuadPart) * 1000000000ll / qpc_freq.QuadPart;
  return 0;
}
static DWORD to_ms(const struct l_timespec *t) {
  if (!t) return INFINITE;
  long long ms = t->sec * 1000 + (t->nsec + 999999) / 1000000;
  return ms < 0 ? 0 : ms > 0x7ffffffe ? 0x7ffffffe : (DWORD)ms;
}

/* ---- threads ---- */
#if defined(__x86_64__)
__attribute__((naked)) static void switch_and_call(void *sp, void (*fn)(void *), void *arg) {
  __asm__("mov %rcx, %rsp\n"
          "sub $32, %rsp\n"
          "mov %r8, %rcx\n"
          "xor %ebp, %ebp\n"
          "call *%rdx\n"
          "ud2\n");
}
#else
__attribute__((naked)) static void switch_and_call(void *sp, void (*fn)(void *), void *arg) {
  __asm__("mov sp, x0\n"
          "mov x0, x2\n"
          "mov x29, #0\n"
          "blr x1\n"
          "brk #1\n");
}
#endif
static void set_stack_fields(void *base, void *limit, void *dealloc) {
  NT_TIB *tib = (NT_TIB *)NtCurrentTeb();
  tib->StackBase = base;
  tib->StackLimit = limit;
  *(void **)((char *)tib + TEB_DEALLOCATION_STACK) = dealloc;
}
static void finish_thread(void *p) {
  struct host_thread *t = p;
  set_stack_fields(t->orig_base, t->orig_limit, t->orig_dealloc);
  if (t->unmap_base) host_munmap(t->unmap_base, t->unmap_size);
  int *ctid = t->ctid;
  HeapFree(GetProcessHeap(), 0, t);
  if (ctid) {
    *ctid = 0;
    WakeByAddressAll(ctid);
  }
  ExitThread(0);
}
static void leave_thread(void *unmap_base, size_t unmap_size) {
  struct host_thread *t = TlsGetValue(thread_slot);
  if (!t) ExitThread(0);
  t->unmap_base = unmap_base;
  t->unmap_size = unmap_size;
  switch_and_call(t->landing_sp, finish_thread, t);
}
static void on_image_stack(void *p) {
  struct host_thread *t = p;
  t->fn(t->arg);
  leave_thread(0, 0);
}
static DWORD WINAPI thread_main(LPVOID p) {
  struct host_thread *t = p;
  char reserve[65536];
  t->landing_sp = (void *)((uintptr_t)(reserve + sizeof reserve - 512) & ~15ull);
  TlsSetValue(thread_slot, t);
  TlsSetValue(tp_slot, t->tls);
  NT_TIB *tib = (NT_TIB *)NtCurrentTeb();
  t->orig_base = tib->StackBase;
  t->orig_limit = tib->StackLimit;
  t->orig_dealloc = *(void **)((char *)tib + TEB_DEALLOCATION_STACK);
  AcquireSRWLockShared(&region_lock);
  struct region *r = find_region((char *)t->stack_top - 1);
  void *low = r ? (void *)r->base : (void *)((char *)t->stack_top - 0x20000);
  void *high = r ? (void *)(r->base + r->size) : t->stack_top;
  ReleaseSRWLockShared(&region_lock);
  set_stack_fields(high, low, low);
  reserve[0] = 0;
  switch_and_call((void *)((uintptr_t)t->stack_top & ~15ull), on_image_stack, t);
  return 0;
}
static SYSV long long host_thread_create(ImageThreadFn fn, void *stack, long long flags, void *arg, int *ptid, void *tls, int *ctid) {
  struct host_thread *t = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof *t);
  if (!t) return -L_ENOMEM;
  t->fn = fn; t->arg = arg; t->tls = tls; t->stack_top = stack;
  t->ctid = flags & 0x200000 ? ctid : 0;
  DWORD tid;
  HANDLE h = CreateThread(0, 1 << 20, thread_main, t, CREATE_SUSPENDED, &tid);
  if (!h) { HeapFree(GetProcessHeap(), 0, t); return -L_EAGAIN; }
  if (flags & 0x100000) *ptid = (int)tid;
  ResumeThread(h);
  CloseHandle(h);
  return tid;
}
static SYSV void host_thread_exit(void *base, unsigned long long size) { leave_thread(base, size); }

/* ---- threads that the image did not create ----
   A thread of libuv's pool, of the pool of Windows, the thread of a console control handler: it
   runs a callback of the image. The image gives it a thread pointer when it enters
   (BUN_SYS_adopt_thread) and takes it back when the thread ends. Windows tells the end of a
   thread to the callback of a fiber local storage slot that has a value, on the thread that
   ends, while its TEB and the slot of the thread pointer are still there. */
struct adopted_thread {
  void *tp;
  SYSV void (*leave)(void *);
};
static VOID WINAPI adopted_thread_ends(PVOID p) {
  struct adopted_thread *a = p;
  if (!a) return;
  if (trace) fprintf(stderr, "[host] an adopted thread ends, thread pointer %p\n", a->tp);
  a->leave(a->tp);
  TlsSetValue(tp_slot, 0);
  HeapFree(GetProcessHeap(), 0, a);
}
static long long host_adopt_thread(void *tp, void *leave, unsigned long long *stack) {
  struct adopted_thread *a = HeapAlloc(GetProcessHeap(), 0, sizeof *a);
  if (!a) return -L_ENOMEM;
  a->tp = tp;
  a->leave = (SYSV void (*)(void *))leave;
  if (!FlsSetValue(adopted_slot, a)) { HeapFree(GetProcessHeap(), 0, a); return -L_ENOMEM; }
  TlsSetValue(tp_slot, tp);
  if (stack) {
    ULONG_PTR low = 0, high = 0;
    GetCurrentThreadStackLimits(&low, &high);
    stack[0] = low;
    stack[1] = high - low;
  }
  if (trace) fprintf(stderr, "[host] thread %lu is adopted, thread pointer %p\n", GetCurrentThreadId(), tp);
  return 0;
}

/* ---- syscalls ---- */
static long long host_futex(int *addr, long long op, int val, const struct l_timespec *timeout) {
  switch (op & 127) {
    case 0:
      if (*addr != val) return -L_EAGAIN;
      if (WaitOnAddress(addr, &val, sizeof val, to_ms(timeout))) return 0;
      return GetLastError() == ERROR_TIMEOUT ? -L_ETIMEDOUT : -L_EAGAIN;
    case 1:
      if (val == 1) WakeByAddressSingle(addr); else WakeByAddressAll(addr);
      return val > 0 ? 1 : 0;
    case 3: case 4:
      WakeByAddressAll(addr);
      return 1;
    default:
      return -L_ENOSYS;
  }
}
BOOLEAN NTAPI SystemFunction036(PVOID, ULONG);

static SYSV long long host_syscall(long long n, long long a, long long b, long long c, long long d, long long e, long long f) {
  long long r;
  switch (n) {
    case N_read: r = host_rw(a, (char *)b, (size_t)c, 0); break;
    case N_write: r = host_rw(a, (char *)b, (size_t)c, 1); break;
    case N_open: r = host_open((const char *)a, b); break;
    case N_openat: r = host_open((const char *)b, c); break;
    case N_close: {
      HANDLE h = fd_handle(a);
      if (!h) { r = -L_EBADF; break; }
      if ((int)a > 2) { CloseHandle(h); fds[(int)a] = 0; }
      r = 0;
      break;
    }
    case N_lseek: {
      LARGE_INTEGER to, out;
      to.QuadPart = b;
      r = SetFilePointerEx(fd_handle(a), to, &out, (DWORD)c) ? out.QuadPart : win_error();
      break;
    }
    case N_mmap: r = host_mmap((char *)a, (size_t)b, c, d, (int)e); break;
    case N_mprotect: r = host_mprotect((char *)a, (size_t)b, c); break;
    case N_munmap: r = host_munmap((char *)a, (size_t)b); break;
    case N_brk: r = -L_ENOSYS; break;
    case N_mremap: r = -L_ENOMEM; break;
    case N_madvise: r = 0; break;
    case N_rt_sigaction: case N_rt_sigprocmask: case N_sigaltstack: case N_set_robust_list: r = 0; break;
    case N_ioctl: {
      DWORD mode;
      if (b == 0x5413 && fd_handle(a) && GetConsoleMode(fd_handle(a), &mode)) { unsigned short *w = (void *)c; w[0] = 24; w[1] = 80; w[2] = w[3] = 0; r = 0; }
      else r = -L_ENOTTY;
      break;
    }
    case N_readv: r = host_rwv(a, (struct l_iovec *)b, c, 0); break;
    case N_writev: r = host_rwv(a, (struct l_iovec *)b, c, 1); break;
    case N_access: case N_faccessat: {
      wchar_t w[4096];
      const char *path = (const char *)(n == N_access ? a : b);
      r = to_wide(path, w, 4096) && GetFileAttributesW(w) != INVALID_FILE_ATTRIBUTES ? 0 : -L_ENOENT;
      break;
    }
    case N_unlink: case N_unlinkat: {
      wchar_t w[4096];
      const char *path = (const char *)(n == N_unlink ? a : b);
      r = to_wide(path, w, 4096) && DeleteFileW(w) ? 0 : win_error();
      break;
    }
    case N_sched_yield: SwitchToThread(); r = 0; break;
    case N_nanosleep: Sleep(to_ms((void *)a)); r = 0; break;
    case N_clock_nanosleep: Sleep(to_ms((void *)c)); r = 0; break;
    case N_getpid: r = GetCurrentProcessId(); break;
    case N_gettid: r = GetCurrentThreadId(); break;
    case N_set_tid_address: r = GetCurrentThreadId(); break;
    case N_arch_prctl:
      if (a == 0x1002) { TlsSetValue(tp_slot, (void *)b); r = 0; } else r = -L_EINVAL;
      break;
    case N_set_tp: TlsSetValue(tp_slot, (void *)a); r = 0; break;
    case N_adopt_thread: r = host_adopt_thread((void *)a, (void *)b, (unsigned long long *)c); break;
    case N_futex: r = host_futex((int *)a, b, (int)c, (void *)d); break;
    case N_clock_gettime: r = host_clock_gettime(a, (void *)b); break;
    case N_getrandom: r = SystemFunction036((void *)a, (ULONG)b) ? b : -L_EIO; break;
    case N_exit: leave_thread(0, 0); r = 0; break;
    case N_exit_group: fflush(0); ExitProcess((UINT)a); r = 0; break;
    case N_tkill: case N_tgkill: fflush(0); ExitProcess(134); r = 0; break;
    default: r = -L_ENOSYS; break;
  }
  if (trace && (r == -L_ENOSYS || trace > 1)) fprintf(stderr, "[host] syscall %lld(%#llx, %#llx, %#llx) = %lld\n", n, a, b, c, r);
  return r;
}

/* ---- functions of Windows for the image ----
   The entry "lookup" of the host table. The program in the image calls what
   it gets with the calling convention of Windows, so nothing is translated.
   A library is a system DLL, named as in an import table ("kernel32",
   "ntdll", "ws2_32"), and is loaded from the system directory only.
   "libuv" is the libuv that is linked into this host (BUN_HOST_LIBUV, see
   host_win_uv.c): libuv has no DLL.
   "*" is a function whose declaration in bun names no library, because the
   linker of a build for Windows finds it in one of the libraries it always
   searches: the DLLs of those are asked here, in this order. */
#ifdef BUN_HOST_LIBUV
void *bun_host_uv_lookup(const char *symbol);
#else
static void *bun_host_uv_lookup(const char *symbol) { (void)symbol; return 0; }
#endif
static SYSV void *host_lookup(const char *library, const char *symbol) {
  void *address = 0;
  if (!strcmp(library, "libuv")) {
    address = bun_host_uv_lookup(symbol);
  } else if (!strcmp(library, "*")) {
    static const wchar_t *const always[] = {L"kernel32", L"ntdll", L"advapi32", L"ws2_32", L"userenv", L"user32", L"ucrtbase"};
    for (size_t i = 0; !address && i < sizeof always / sizeof *always; i++) {
      HMODULE module = GetModuleHandleW(always[i]);
      if (!module) module = LoadLibraryExW(always[i], 0, LOAD_LIBRARY_SEARCH_SYSTEM32);
      if (module) address = (void *)GetProcAddress(module, symbol);
    }
  } else {
    wchar_t name[260];
    if (to_wide(library, name, 260) > 1) {
      HMODULE module = GetModuleHandleW(name);
      if (!module) module = LoadLibraryExW(name, 0, LOAD_LIBRARY_SEARCH_SYSTEM32);
      if (module) address = (void *)GetProcAddress(module, symbol);
    }
  }
  if (trace && (!address || trace > 1)) fprintf(stderr, "[host] lookup %s!%s = %p\n", library, symbol, address);
  return address;
}

/* ---- image loading and start ---- */
typedef struct { unsigned char ident[16]; uint16_t type, machine; uint32_t version; uint64_t entry, phoff, shoff; uint32_t flags; uint16_t ehsize, phentsize, phnum, shentsize, shnum, shstrndx; } Ehdr;
typedef struct { uint32_t type, flags; uint64_t offset, vaddr, paddr, filesz, memsz, align; } Phdr;

#if defined(__x86_64__)
__attribute__((naked)) static void enter_image(void *entry, void *sp) {
  __asm__("mov %rdx, %rsp\n"
          "xor %ebp, %ebp\n"
          "xor %edx, %edx\n"
          "jmp *%rcx\n");
}
#else
__attribute__((naked)) static void enter_image(void *entry, void *sp) {
  __asm__("mov sp, x1\n"
          "mov x29, #0\n"
          "mov x30, #0\n"
          "br x0\n");
}
#endif

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: host <image> [args]\n"); return 2; }
  trace = getenv("BUN_HOST_TRACE") ? atoi(getenv("BUN_HOST_TRACE")) : 0;
  QueryPerformanceFrequency(&qpc_freq);
  fds[0] = GetStdHandle(STD_INPUT_HANDLE);
  fds[1] = GetStdHandle(STD_OUTPUT_HANDLE);
  fds[2] = GetStdHandle(STD_ERROR_HANDLE);

  wchar_t wpath[4096];
  if (!to_wide(argv[1], wpath, 4096)) return 2;
  HANDLE file_handle = CreateFileW(wpath, GENERIC_READ | GENERIC_EXECUTE, FILE_SHARE_READ | FILE_SHARE_DELETE, 0, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, 0);
  if (file_handle == INVALID_HANDLE_VALUE) { fprintf(stderr, "host: cannot open %s\n", argv[1]); return 2; }
  LARGE_INTEGER file_size;
  GetFileSizeEx(file_handle, &file_size);
  long size = (long)file_size.QuadPart;
  HANDLE mapping = CreateFileMappingW(file_handle, 0, PAGE_EXECUTE_READ, 0, 0, 0);
  if (!mapping) { fprintf(stderr, "host: cannot create an executable file mapping (%lu)\n", GetLastError()); return 2; }
  unsigned char *file = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0);
  if (!file) return 2;
  Ehdr *eh = (Ehdr *)file;
  if (eh->machine != IMAGE_MACHINE) { fprintf(stderr, "host: %s is an image for another processor (ELF machine %d, this host runs %d)\n", argv[1], eh->machine, IMAGE_MACHINE); return 2; }
  Phdr *ph = (Phdr *)(file + eh->phoff);
  uint64_t top = 0;
  for (int i = 0; i < eh->phnum; i++)
    if (ph[i].type == 1 && ph[i].vaddr + ph[i].memsz > top) top = ph[i].vaddr + ph[i].memsz;
  top = (top + 0xffff) & ~0xffffull;

  /* Read-only and executable segments are views of the file: no copy, shared
     between processes. Writable segments are small and are copied. Views and
     allocations start on 64 KiB boundaries, so the image is linked that way. */
  unsigned char *base = 0;
  size_t mapped_bytes = 0, copied_bytes = 0;
  for (int attempt = 0; attempt < 16 && !base; attempt++) {
    unsigned char *want = VirtualAlloc(0, top, MEM_RESERVE, PAGE_NOACCESS);
    if (!want) return 2;
    VirtualFree(want, 0, MEM_RELEASE);
    int ok = 1;
    mapped_bytes = copied_bytes = 0;
    for (int i = 0; i < eh->phnum && ok; i++) {
      if (ph[i].type != 1) continue;
      if ((ph[i].vaddr | ph[i].offset) & 0xffff) { fprintf(stderr, "host: segment %d is not aligned to 64 KiB\n", i); return 2; }
      size_t mem = (ph[i].memsz + PAGE - 1) & ~(PAGE - 1);
      if (ph[i].flags & 2) {
        unsigned char *p = VirtualAlloc(want + ph[i].vaddr, mem, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
        if (p) { memcpy(p, file + ph[i].offset, ph[i].filesz); copied_bytes += ph[i].filesz; }
        ok = p != 0;
      } else {
        DWORD access = FILE_MAP_READ | (ph[i].flags & 1 ? FILE_MAP_EXECUTE : 0);
        ok = MapViewOfFileEx(mapping, access, (DWORD)(ph[i].offset >> 32), (DWORD)ph[i].offset, ph[i].filesz, want + ph[i].vaddr) != 0;
        mapped_bytes += ph[i].filesz;
      }
    }
    if (ok) base = want;
    else
      for (int i = 0; i < eh->phnum; i++)
        if (ph[i].type == 1 && !UnmapViewOfFile(want + ph[i].vaddr)) VirtualFree(want + ph[i].vaddr, 0, MEM_RELEASE);
  }
  if (!base) { fprintf(stderr, "host: cannot place the image (%lu)\n", GetLastError()); return 2; }
  if (trace) {
    MEMORY_BASIC_INFORMATION info;
    VirtualQuery(base + eh->entry, &info, sizeof info);
    fprintf(stderr, "[host] code is %s, %zu bytes mapped from the file, %zu bytes copied\n",
            info.Type == MEM_MAPPED ? "a file view (MEM_MAPPED)" : info.Type == MEM_PRIVATE ? "private memory" : "an image section", mapped_bytes, copied_bytes);
  }
  Phdr *image_ph = (Phdr *)(base + eh->phoff);

  tp_slot = TlsAlloc();
  thread_slot = TlsAlloc();
  adopted_slot = FlsAlloc(adopted_thread_ends);
  if (tp_slot >= 64) { fprintf(stderr, "host: no low TLS slot\n"); return 2; }
  if (adopted_slot == FLS_OUT_OF_INDEXES) { fprintf(stderr, "host: no fiber local storage slot\n"); return 2; }
  static struct bun_host host;
  host.os = 2;
  host.tcb_offset = TEB_TLS_SLOTS + 8ull * tp_slot;
  TlsSetValue(tp_slot, (void *)0x1122334455667788ull);
  if (*(void **)((char *)NtCurrentTeb() + host.tcb_offset) != (void *)0x1122334455667788ull) { fprintf(stderr, "host: thread slot %lu is not at offset %#llx of the TEB\n", tp_slot, host.tcb_offset); return 2; }
  host.syscall = host_syscall;
  host.thread_create = host_thread_create;
  host.thread_exit = host_thread_exit;
  host.lookup = host_lookup;

  size_t stack_size = 8u << 20;
  char *stack = (char *)(intptr_t)host_mmap(0, stack_size, 3, 0x22, -1);
  char *strings = stack + stack_size - 65536;
  char *cursor = strings;
  uint64_t *vec = (uint64_t *)(stack + stack_size - 65536 - 32768), *v = vec;
  static unsigned char random_bytes[16];
  SystemFunction036(random_bytes, 16);

  *v++ = (uint64_t)(argc - 1);
  for (int i = 1; i < argc; i++) { size_t n = strlen(argv[i]) + 1; memcpy(cursor, argv[i], n); *v++ = (uint64_t)(uintptr_t)cursor; cursor += n; }
  *v++ = 0;
  wchar_t *env = GetEnvironmentStringsW();
  for (wchar_t *e = env; *e; e += wcslen(e) + 1) {
    if (*e == L'=') continue;
    int n = WideCharToMultiByte(CP_UTF8, 0, e, -1, cursor, (int)(stack + stack_size - cursor - 16), 0, 0);
    if (n <= 0 || v - vec > 3500) break;
    *v++ = (uint64_t)(uintptr_t)cursor;
    cursor += n;
  }
  *v++ = 0;
  uint64_t aux[] = {3, (uint64_t)(uintptr_t)image_ph, 4, sizeof(Phdr), 5, eh->phnum, 6, PAGE, 7, 0, 9, (uint64_t)(uintptr_t)(base + eh->entry),
                    11, 0, 12, 0, 13, 0, 14, 0, 23, 0, 25, (uint64_t)(uintptr_t)random_bytes, AT_BUN_HOST, (uint64_t)(uintptr_t)&host,
                    AT_BUN_HOST_ENTRIES, BUN_HOST_ENTRIES, 0, 0};
  memcpy(v, aux, sizeof aux);

  if (trace) fprintf(stderr, "[host] image %ld bytes at %p, entry %p, thread slot offset %#llx\n", size, base, base + eh->entry, host.tcb_offset);
  fflush(0);
  set_stack_fields(stack + stack_size, stack, stack);
  enter_image(base + eh->entry, vec);
  return 0;
}
