// Windows host for the portable image (x86-64 and arm64).
// It maps the image, builds a Linux-style start stack, and serves the image's
// OS requests: Linux syscall numbers come in with the calling convention of
// the image and are answered with Win32. The image itself is never modified.
// The host has the architecture of the image. Every structure that the image
// sees is declared in linux_abi.h, the memory of the image is kept by memory.h.
//
// Build with clang for the MSVC target, in a developer prompt of Visual Studio (it needs
// the Windows SDK and the UCRT):
//   clang -O2 --target=x86_64-pc-windows-msvc -o host.exe host\host_win.c
//   clang -O2 --target=aarch64-pc-windows-msvc -o host.exe host\host_win.c
// Only documented Win32 and the C library. One thing is not from the documentation: where
// the TEB keeps the slots of TlsAlloc, see TEB_TLS_SLOTS.
//
// Environment:
//   BUN_HOST_TRACE=1|2     1: every request that the host refuses, 2: every request
//   BUN_HOST_COUNTS=file   at exit: how often every request number arrived
//   BUN_HOST_PATHS=file    every path that the image hands over, with the answer
//
// Signals (x86-64). Windows has none. Faults of the processor arrive as exceptions: a
// vectored handler turns them into the Linux siginfo and ucontext and calls the
// handler that the image registered. A signal that the image sends to a thread
// (tkill, tgkill) is kept as pending at the thread and taken by the thread itself:
// at the end of the request that it is in, in a wait, or, when the thread runs code
// of the image, after this host has stopped it and pointed it to signal_landing().
// See "signals to a thread" below.
#define WIN32_LEAN_AND_MEAN
#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <bcrypt.h>
#include <psapi.h>
#include <intrin.h>
#if defined(__x86_64__)
#include <immintrin.h>
#endif
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#pragma comment(lib, "synchronization.lib") /* WaitOnAddress, WakeByAddressSingle, WakeByAddressAll */
#pragma comment(lib, "bcrypt.lib")          /* BCryptGenRandom */

#include "linux_abi.h"

/* Calling convention of the image. arm64: the image is AAPCS64 as on Linux, the host
   is AAPCS64 as on Windows. For the functions of the host table the two agree: up to
   7 integer or pointer arguments in x0 to x6, the result in x0, x19 to x28 and d8 to
   d15 kept by the callee. They differ for variadic functions and in x18, which is the
   TEB here: the image is built with -ffixed-x18 and no host table function is variadic. */
#if defined(__x86_64__)
#define SYSV __attribute__((sysv_abi))
#define DELIVERS_FAULTS 1
#else
#define SYSV
#define DELIVERS_FAULTS 0
#endif
#define PAGE 4096ull

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
};

struct host_thread {
  ImageThreadFn fn;
  void *arg, *tls, *stack_top;
  int *ctid;
  void *landing_sp, *unmap_base;
  size_t unmap_size;
  void *orig_base, *orig_limit, *orig_dealloc;
  int tid;
  struct l_stack altstack;
  uintptr_t fault_address;
  int fault_repeats;
  /* Signals. mask: what the thread blocks, written by the thread only. pending: what was
     sent and not taken yet, bit n - 1 for signal n. in_host: the thread is inside of a
     request (or has not reached the image yet) and looks at pending by itself.
     waiting_on: the address that it waits on in WaitOnAddress. */
  HANDLE handle, wake;
  l_sigset mask, restore;
  int suspended;
  volatile LONG64 pending;
  volatile LONG in_host;
  void *volatile waiting_on;
};

static DWORD tp_slot, thread_slot;
static int trace, main_tid;
static volatile LONG next_tid;
static LARGE_INTEGER qpc_freq;
static struct host_thread main_thread;
static uintptr_t image_base, image_end, main_stack_low, main_stack_high;

static void host_log(const char *format, ...) {
  char line[1024];
  va_list ap;
  va_start(ap, format);
  int n = vsnprintf(line, sizeof line, format, ap);
  va_end(ap);
  if (n > (int)sizeof line - 1) n = sizeof line - 1;
  DWORD done;
  if (n > 0) WriteFile(GetStdHandle(STD_ERROR_HANDLE), line, (DWORD)n, &done, 0);
}
static struct host_thread *this_thread(void) {
  struct host_thread *t = TlsGetValue(thread_slot);
  return t ? t : &main_thread;
}
/* Signals that the thread can take now. The functions that wait ask, and hand over to take_signals(). */
static l_sigset signals_ready(struct host_thread *t) { return (l_sigset)t->pending & ~t->mask; }
static int take_signals(struct host_thread *t);
static long long precise_ms(void) {
  LARGE_INTEGER c;
  QueryPerformanceCounter(&c);
  return (long long)(c.QuadPart / qpc_freq.QuadPart * 1000 + c.QuadPart % qpc_freq.QuadPart * 1000 / qpc_freq.QuadPart);
}

/* ---- what arrived, for the report ---- */
enum { COUNT_LINUX = 1024, COUNT_SLOTS = COUNT_LINUX + 256 };
static volatile LONG64 counts[COUNT_SLOTS], refused[COUNT_SLOTS];
static volatile LONG64 futex_ops[16], madvise_advice[32], lazy_commits, signals_delivered[L_NSIG];
static HANDLE paths_file = INVALID_HANDLE_VALUE;

static int count_slot(long long n) {
  if (n >= 0 && n < COUNT_LINUX) return (int)n;
  if ((n & ~0xffll) == AT_BUN_HOST) return COUNT_LINUX + (int)(n & 0xff);
  return COUNT_SLOTS - 1;
}
static long long slot_number(int slot) { return slot < COUNT_LINUX ? slot : slot == COUNT_SLOTS - 1 ? -1 : AT_BUN_HOST + (slot - COUNT_LINUX); }
static void count(volatile LONG64 *table, long long n) { InterlockedIncrement64(&table[count_slot(n)]); }
static void write_counts(void) {
  const char *path = getenv("BUN_HOST_COUNTS");
  if (!path) return;
  FILE *f = fopen(path, "wb");
  if (!f) {
    host_log("host: cannot write %s\n", path);
    return;
  }
  for (int i = 0; i < COUNT_SLOTS; i++) {
    long long n = slot_number(i);
    if (counts[i]) fprintf(f, "request %lld %s %lld\n", n, l_request_name(n), (long long)counts[i]);
    if (refused[i]) fprintf(f, "refused %lld %s %lld\n", n, l_request_name(n), (long long)refused[i]);
  }
  for (int i = 0; i < 16; i++)
    if (futex_ops[i]) fprintf(f, "detail futex_op %d %lld\n", i, (long long)futex_ops[i]);
  for (int i = 0; i < 32; i++)
    if (madvise_advice[i]) fprintf(f, "detail madvise_advice %d %lld\n", i, (long long)madvise_advice[i]);
  for (int i = 0; i < L_NSIG; i++)
    if (signals_delivered[i]) fprintf(f, "detail signal_delivered %d %lld\n", i, (long long)signals_delivered[i]);
  if (lazy_commits) fprintf(f, "detail lazy_commits 0 %lld\n", (long long)lazy_commits);
  fclose(f);
}
static void log_path(long long n, const char *path, long long result) {
  if (paths_file == INVALID_HANDLE_VALUE) return;
  char line[1200];
  int k = snprintf(line, sizeof line, "%s %s %lld\n", l_request_name(n), path, result);
  if (k > (int)sizeof line - 1) k = sizeof line - 1;
  DWORD done;
  WriteFile(paths_file, line, (DWORD)k, &done, 0);
}
/* For a build that measures (test/coverage.ts): called before the process ends. */
void (*bun_host_before_exit)(void);
static UINT console_code_page;
static void leave_process(int code) {
  write_counts();
  if (bun_host_before_exit) bun_host_before_exit();
  fflush(0);
  if (console_code_page) SetConsoleOutputCP(console_code_page);
  TerminateProcess(GetCurrentProcess(), (UINT)code);
  for (;;) Sleep(1000);
}

/* ---- errno ---- */
static long long win_error(void) {
  switch (GetLastError()) {
    case ERROR_FILE_NOT_FOUND: case ERROR_PATH_NOT_FOUND: case ERROR_INVALID_NAME: case ERROR_BAD_PATHNAME:
    case ERROR_INVALID_DRIVE: case ERROR_BAD_NETPATH: case ERROR_BAD_NET_NAME: return -L_ENOENT;
    case ERROR_ACCESS_DENIED: case ERROR_SHARING_VIOLATION: case ERROR_LOCK_VIOLATION: return -L_EACCES;
    case ERROR_FILE_EXISTS: case ERROR_ALREADY_EXISTS: return -L_EEXIST;
    case ERROR_NOT_ENOUGH_MEMORY: case ERROR_OUTOFMEMORY: case ERROR_COMMITMENT_LIMIT: return -L_ENOMEM;
    case ERROR_INVALID_HANDLE: return -L_EBADF;
    case ERROR_DIRECTORY: return -L_ENOTDIR;
    case ERROR_DIR_NOT_EMPTY: return -L_ENOTEMPTY;
    case ERROR_TOO_MANY_OPEN_FILES: return -L_EMFILE;
    case ERROR_DISK_FULL: case ERROR_HANDLE_DISK_FULL: return -L_ENOSPC;
    case ERROR_BROKEN_PIPE: case ERROR_NO_DATA: return -L_EPIPE;
    case ERROR_INVALID_PARAMETER: case ERROR_NEGATIVE_SEEK: return -L_EINVAL;
    case ERROR_NOACCESS: return -L_EFAULT;
    case ERROR_FILENAME_EXCED_RANGE: return -L_ENAMETOOLONG;
    case ERROR_NOT_SUPPORTED: case ERROR_CALL_NOT_IMPLEMENTED: return -L_ENOSYS;
    default: return -L_EIO;
  }
}

/* ---- memory ---- */
#define MEMORY_PAGE PAGE
static SRWLOCK memory_srw = SRWLOCK_INIT;
static void memory_lock(void) { AcquireSRWLockExclusive(&memory_srw); }
static void memory_unlock(void) { ReleaseSRWLockExclusive(&memory_srw); }
static void *table_alloc(size_t bytes) { return VirtualAlloc(0, bytes, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE); }
static void table_free(void *p, size_t bytes) { (void)bytes; VirtualFree(p, 0, MEM_RELEASE); }
static DWORD win_prot(uint32_t prot) {
  switch (prot & 7) {
    case 0: return PAGE_NOACCESS;
    case L_PROT_READ: return PAGE_READONLY;
    case L_PROT_WRITE: case L_PROT_READ | L_PROT_WRITE: return PAGE_READWRITE;
    case L_PROT_EXEC: return PAGE_EXECUTE;
    case L_PROT_READ | L_PROT_EXEC: return PAGE_EXECUTE_READ;
    default: return PAGE_EXECUTE_READWRITE;
  }
}
/* The five primitives of the model. A block is a reservation of VirtualAlloc: it starts on a
   64 KiB boundary and MEM_RELEASE frees all of it. */
static uintptr_t os_reserve(uintptr_t hint, size_t bytes) { return (uintptr_t)VirtualAlloc((void *)hint, bytes, MEM_RESERVE, PAGE_NOACCESS); }
static void os_release(uintptr_t base, size_t bytes) { (void)bytes; VirtualFree((void *)base, 0, MEM_RELEASE); }
static long long os_commit(uintptr_t start, size_t bytes, uint32_t prot) { return VirtualAlloc((void *)start, bytes, MEM_COMMIT, win_prot(prot)) ? 0 : win_error(); }
static void os_decommit(uintptr_t start, size_t bytes) { VirtualFree((void *)start, bytes, MEM_DECOMMIT); }
static long long os_protect(uintptr_t start, size_t bytes, uint32_t prot) {
  DWORD old;
  return VirtualProtect((void *)start, bytes, win_prot(prot), &old) ? 0 : win_error();
}

#include "memory.h"

/* What the host hands to the kernel has to be committed: a system call does not run the
   exception handler of the host, it fails with ERROR_NOACCESS. */
static void touch(const void *p, size_t bytes) {
  if (p) model_touch((uintptr_t)p, bytes);
}
static long long host_madvise(uintptr_t addr, size_t len, long long advice) {
  if (advice >= 0 && advice < 32) InterlockedIncrement64(&madvise_advice[advice]);
  switch (advice) {
    case L_MADV_DONTNEED: return model_discard(addr, len);
    case L_MADV_NORMAL: case L_MADV_RANDOM: case L_MADV_SEQUENTIAL: case L_MADV_WILLNEED: case L_MADV_DONTFORK:
    case L_MADV_DOFORK: case L_MADV_NOHUGEPAGE: case L_MADV_DONTDUMP: case L_MADV_DODUMP:
      return 0;
    default:
      return -L_EINVAL;
  }
}

/* ---- files ---- */
enum { FD_COUNT = 1024, FD_FILE = 1, FD_RANDOM = 2 };
struct host_fd { HANDLE handle; int kind; long long flags; int cloexec; };
static struct host_fd fds[FD_COUNT];
static SRWLOCK fd_lock = SRWLOCK_INIT;

static struct host_fd *fd_at(long long fd) { return fd >= 0 && fd < FD_COUNT && fds[fd].kind ? &fds[fd] : 0; }
static long long fd_put(HANDLE h, int kind, long long flags, long long from) {
  AcquireSRWLockExclusive(&fd_lock);
  for (long long i = from; i < FD_COUNT; i++)
    if (!fds[i].kind) {
      fds[i].handle = h;
      fds[i].kind = kind;
      fds[i].flags = flags;
      fds[i].cloexec = !!(flags & L_O_CLOEXEC);
      ReleaseSRWLockExclusive(&fd_lock);
      return i;
    }
  ReleaseSRWLockExclusive(&fd_lock);
  if (kind == FD_FILE) CloseHandle(h);
  return -L_EMFILE;
}

/* Paths of the image, which thinks in the way of Linux.
     /proc, /sys      do not exist
     /dev/null        NUL
     /dev/urandom     a file of the host, see FD_RANDOM
     /C:/a/b          C:\a\b. getcwd() hands out this form, because the libc of the image
                      takes a working directory that does not start with "/" for an error
     anything else    as it is. Windows takes "/" for "\", and a path that starts with one
                      of them is on the drive of the working directory */
enum { PATH_REFUSED = -1, PATH_FILE = 0, PATH_RANDOM = 1 };
static int host_path(const char *path, wchar_t *out, int capacity) {
  if (!strncmp(path, "/proc/", 6) || !strcmp(path, "/proc") || !strncmp(path, "/sys/", 5) || !strcmp(path, "/sys")) return PATH_REFUSED;
  if (!strcmp(path, "/dev/urandom") || !strcmp(path, "/dev/random")) return PATH_RANDOM;
  if (!strcmp(path, "/dev/null")) path = "NUL";
  else if (!strcmp(path, "/dev/tty")) path = "CON";
  else if (path[0] == '/' && ((path[1] | 32) >= 'a' && (path[1] | 32) <= 'z') && path[2] == ':' && (path[3] == '/' || !path[3])) path++;
  int n = MultiByteToWideChar(CP_UTF8, 0, path, -1, out, capacity - 2);
  if (n <= 0) return PATH_REFUSED;
  for (wchar_t *c = out; *c; c++)
    if (*c == L'/') *c = L'\\';
  /* "C:" alone is the working directory of the drive, the image means its root. */
  if (n == 3 && out[1] == L':') { out[2] = L'\\'; out[3] = 0; }
  return PATH_FILE;
}
static long long host_open(long long n, const char *path, long long flags) {
  wchar_t w[4096];
  long long r;
  int kind = host_path(path, w, 4096);
  if (kind == PATH_REFUSED) r = -L_ENOENT;
  else if (kind == PATH_RANDOM) r = fd_put(0, FD_RANDOM, flags, 3);
  else {
    DWORD access = (flags & 3) == 0 ? GENERIC_READ : (flags & 3) == 1 ? GENERIC_WRITE : GENERIC_READ | GENERIC_WRITE;
    int creat = !!(flags & L_O_CREAT), excl = !!(flags & L_O_EXCL), trunc = !!(flags & L_O_TRUNC);
    DWORD how = creat && excl ? CREATE_NEW : creat && trunc ? CREATE_ALWAYS : creat ? OPEN_ALWAYS : trunc ? TRUNCATE_EXISTING : OPEN_EXISTING;
    /* FILE_FLAG_BACKUP_SEMANTICS: a directory can be opened, as open() of Linux does. */
    HANDLE h = CreateFileW(w, access, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, 0, how, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_BACKUP_SEMANTICS, 0);
    if (h == INVALID_HANDLE_VALUE) r = win_error();
    else {
      BY_HANDLE_FILE_INFORMATION info;
      int directory = GetFileInformationByHandle(h, &info) && (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY);
      if ((flags & L_O_DIRECTORY) && !directory) { CloseHandle(h); r = -L_ENOTDIR; }
      else if (directory && (flags & 3)) { CloseHandle(h); r = -L_EISDIR; }
      else r = fd_put(h, FD_FILE, flags, 3);
    }
  }
  log_path(n, path, r);
  return r;
}
static long long host_close(long long fd) {
  AcquireSRWLockExclusive(&fd_lock);
  struct host_fd *f = fd_at(fd);
  if (!f) { ReleaseSRWLockExclusive(&fd_lock); return -L_EBADF; }
  /* 0, 1 and 2 stay what they are for the host itself. */
  if (fd > 2) {
    if (f->kind == FD_FILE) CloseHandle(f->handle);
    f->kind = 0;
    f->handle = 0;
  }
  ReleaseSRWLockExclusive(&fd_lock);
  return 0;
}
static long long host_dup(long long fd, long long to, long long from, int cloexec) {
  struct host_fd *f = fd_at(fd);
  if (!f) return -L_EBADF;
  HANDLE copy = 0;
  if (f->kind == FD_FILE && !DuplicateHandle(GetCurrentProcess(), f->handle, GetCurrentProcess(), &copy, 0, FALSE, DUPLICATE_SAME_ACCESS)) return win_error();
  long long flags = (f->flags & ~(long long)L_O_CLOEXEC) | (cloexec ? L_O_CLOEXEC : 0);
  if (to < 0) return fd_put(copy, f->kind, flags, from);
  if (to >= FD_COUNT) { if (copy) CloseHandle(copy); return -L_EBADF; }
  AcquireSRWLockExclusive(&fd_lock);
  if (fds[to].kind == FD_FILE && to > 2) CloseHandle(fds[to].handle);
  fds[to].handle = copy;
  fds[to].kind = f->kind;
  fds[to].flags = flags;
  fds[to].cloexec = cloexec;
  ReleaseSRWLockExclusive(&fd_lock);
  return to;
}
static int random_bytes_of_system(unsigned char *buf, ULONG size) {
  return BCryptGenRandom(0, buf, size, BCRYPT_USE_SYSTEM_PREFERRED_RNG) >= 0;
}
static long long host_random(unsigned char *buf, size_t size) {
  touch(buf, size);
  for (size_t done = 0; done < size;) {
    ULONG k = size - done > 0x10000000 ? 0x10000000 : (ULONG)(size - done);
    if (!random_bytes_of_system(buf + done, k)) return done ? (long long)done : -L_EIO;
    done += k;
  }
  return (long long)size;
}
/* offset < 0: at the position of the file, which moves. Otherwise at the offset, and the
   position stays (pread, pwrite). */
static long long host_rw(long long fd, char *buf, size_t len, int write, long long offset) {
  struct host_fd *f = fd_at(fd);
  if (!f) return -L_EBADF;
  if (f->kind == FD_RANDOM) return write ? (long long)len : host_random((unsigned char *)buf, len);
  touch(buf, len);
  DWORD done = 0, n = len > 0x40000000 ? 0x40000000 : (DWORD)len;
  LARGE_INTEGER zero, before;
  zero.QuadPart = 0;
  OVERLAPPED at, *where = 0;
  if (offset >= 0) {
    if (!SetFilePointerEx(f->handle, zero, &before, FILE_CURRENT)) return -L_ESPIPE;
    memset(&at, 0, sizeof at);
    at.Offset = (DWORD)offset;
    at.OffsetHigh = (DWORD)(offset >> 32);
    where = &at;
  } else if (write && (f->flags & L_O_APPEND)) SetFilePointerEx(f->handle, zero, 0, FILE_END);
  BOOL ok = write ? WriteFile(f->handle, buf, n, &done, where) : ReadFile(f->handle, buf, n, &done, where);
  DWORD error = GetLastError();
  if (offset >= 0) SetFilePointerEx(f->handle, before, 0, FILE_BEGIN);
  if (!ok) {
    if (!write && (error == ERROR_BROKEN_PIPE || error == ERROR_HANDLE_EOF)) return 0;
    SetLastError(error);
    return win_error();
  }
  return done;
}
static long long host_rwv(long long fd, struct l_iovec *v, long long n, int write) {
  long long total = 0;
  touch(v, (size_t)n * sizeof *v);
  for (long long i = 0; i < n; i++) {
    if (!v[i].len) continue;
    long long r = host_rw(fd, (char *)(uintptr_t)v[i].base, (size_t)v[i].len, write, -1);
    if (r < 0) return total ? total : r;
    total += r;
    if ((uint64_t)r < v[i].len) break;
  }
  return total;
}
static long long host_lseek(long long fd, long long offset, long long whence) {
  struct host_fd *f = fd_at(fd);
  if (!f) return -L_EBADF;
  if (f->kind != FD_FILE || GetFileType(f->handle) != FILE_TYPE_DISK) return -L_ESPIPE;
  if (whence < 0 || whence > 2) return -L_EINVAL;
  LARGE_INTEGER to, out;
  to.QuadPart = offset;
  return SetFilePointerEx(f->handle, to, &out, (DWORD)whence) ? out.QuadPart : win_error();
}
/* 100 ns since 1601 to seconds and nanoseconds since 1970. */
static struct l_timespec unix_time(FILETIME ft) {
  unsigned long long t = ((unsigned long long)ft.dwHighDateTime << 32 | ft.dwLowDateTime);
  struct l_timespec ts = {0, 0};
  if (t < 116444736000000000ull) return ts;
  t -= 116444736000000000ull;
  ts.sec = (int64_t)(t / 10000000);
  ts.nsec = (int64_t)(t % 10000000) * 100;
  return ts;
}
static long long stat_handle(HANDLE h, struct l_stat *out) {
  struct l_stat s;
  memset(&s, 0, sizeof s);
  s.blksize = 4096;
  s.nlink = 1;
  DWORD type = GetFileType(h);
  if (type == FILE_TYPE_CHAR) s.mode = L_S_IFCHR | 0620;
  else if (type == FILE_TYPE_PIPE) s.mode = L_S_IFIFO | 0600;
  else {
    BY_HANDLE_FILE_INFORMATION info;
    if (!GetFileInformationByHandle(h, &info)) return win_error();
    int writable = !(info.dwFileAttributes & FILE_ATTRIBUTE_READONLY);
    if (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) s.mode = L_S_IFDIR | (writable ? 0755 : 0555);
    else s.mode = L_S_IFREG | (writable ? 0644 : 0444);
    s.dev = info.dwVolumeSerialNumber;
    s.ino = (uint64_t)info.nFileIndexHigh << 32 | info.nFileIndexLow;
    s.nlink = info.nNumberOfLinks;
    s.size = (int64_t)((uint64_t)info.nFileSizeHigh << 32 | info.nFileSizeLow);
    s.blocks = (s.size + 511) / 512;
    s.atim = unix_time(info.ftLastAccessTime);
    s.mtim = unix_time(info.ftLastWriteTime);
    s.ctim = unix_time(info.ftCreationTime);
  }
  touch(out, sizeof *out);
  *out = s;
  return 0;
}
static long long host_fstat(long long fd, struct l_stat *out) {
  struct host_fd *f = fd_at(fd);
  if (!f) return -L_EBADF;
  if (f->kind == FD_RANDOM) {
    struct l_stat s;
    memset(&s, 0, sizeof s);
    s.mode = L_S_IFCHR | 0666;
    s.nlink = 1;
    s.blksize = 4096;
    touch(out, sizeof *out);
    *out = s;
    return 0;
  }
  return stat_handle(f->handle, out);
}
static long long host_stat(long long n, const char *path, struct l_stat *out) {
  wchar_t w[4096];
  long long r;
  int kind = host_path(path, w, 4096);
  if (kind == PATH_REFUSED) r = -L_ENOENT;
  else if (kind == PATH_RANDOM) {
    memset(out, 0, sizeof *out);
    out->mode = L_S_IFCHR | 0666;
    out->nlink = 1;
    r = 0;
  } else {
    HANDLE h = CreateFileW(w, FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, 0, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_BACKUP_SEMANTICS, 0);
    if (h == INVALID_HANDLE_VALUE) r = win_error();
    else {
      r = stat_handle(h, out);
      CloseHandle(h);
    }
  }
  log_path(n, path, r);
  return r;
}
static long long host_access(long long n, const char *path, long long mode) {
  wchar_t w[4096];
  long long r = 0;
  int kind = host_path(path, w, 4096);
  if (kind == PATH_REFUSED) r = -L_ENOENT;
  else if (kind == PATH_FILE) {
    DWORD attributes = GetFileAttributesW(w);
    if (attributes == INVALID_FILE_ATTRIBUTES) r = win_error();
    else if ((mode & 2) && (attributes & FILE_ATTRIBUTE_READONLY) && !(attributes & FILE_ATTRIBUTE_DIRECTORY)) r = -L_EACCES;
  }
  log_path(n, path, r);
  return r;
}
/* Links of Windows are not handed out as links: every path that exists is a file or a directory. */
static long long host_readlink(long long n, const char *path) {
  wchar_t w[4096];
  int kind = host_path(path, w, 4096);
  long long r = kind == PATH_REFUSED ? -L_ENOENT : kind == PATH_FILE && GetFileAttributesW(w) == INVALID_FILE_ATTRIBUTES ? win_error() : -L_EINVAL;
  log_path(n, path, r);
  return r;
}
static long long host_unlink(long long n, const char *path, long long flags) {
  wchar_t w[4096];
  long long r;
  if (host_path(path, w, 4096) != PATH_FILE) r = -L_ENOENT;
  else r = (flags & L_AT_REMOVEDIR ? RemoveDirectoryW(w) : DeleteFileW(w)) ? 0 : win_error();
  log_path(n, path, r);
  return r;
}
static long long host_getcwd(char *buf, size_t size) {
  wchar_t w[4096];
  char here[3 * 4096 + 2];
  DWORD n = GetCurrentDirectoryW(4096, w);
  if (!n || n >= 4096) return -L_ENOENT;
  here[0] = '/';
  int k = WideCharToMultiByte(CP_UTF8, 0, w, -1, here + 1, (int)sizeof here - 1, 0, 0);
  if (k <= 0) return -L_ENOENT;
  for (char *c = here; *c; c++)
    if (*c == '\\') *c = '/';
  size_t length = strlen(here);
  if (length > 3 && here[length - 1] == '/') here[--length] = 0;
  if (length + 1 > size) return -L_ERANGE;
  touch(buf, length + 1);
  memcpy(buf, here, length + 1);
  return (long long)length + 1;
}
static long long host_fcntl(long long fd, long long cmd, long long arg) {
  struct host_fd *f = fd_at(fd);
  if (!f) return -L_EBADF;
  switch (cmd) {
    case L_F_GETFD: return f->cloexec ? L_FD_CLOEXEC : 0;
    case L_F_SETFD: f->cloexec = !!(arg & L_FD_CLOEXEC); return 0;
    case L_F_GETFL: return f->flags & (L_O_ACCMODE | L_O_APPEND | L_O_NONBLOCK);
    case L_F_SETFL: f->flags = (f->flags & ~(long long)(L_O_APPEND | L_O_NONBLOCK)) | (arg & (L_O_APPEND | L_O_NONBLOCK)); return 0;
    case L_F_DUPFD: return host_dup(fd, -1, arg, 0);
    case L_F_DUPFD_CLOEXEC: return host_dup(fd, -1, arg, 1);
    default: return -L_EINVAL;
  }
}
static long long host_ioctl(long long fd, unsigned long long request, void *arg) {
  struct host_fd *f = fd_at(fd);
  if (!f) return -L_EBADF;
  DWORD mode;
  int console = f->kind == FD_FILE && GetFileType(f->handle) == FILE_TYPE_CHAR && GetConsoleMode(f->handle, &mode);
  if (!console) return -L_ENOTTY;
  if (request != L_TIOCGWINSZ) return -L_EINVAL;
  struct l_winsize size = {24, 80, 0, 0};
  CONSOLE_SCREEN_BUFFER_INFO info;
  if (GetConsoleScreenBufferInfo(f->handle, &info)) {
    size.row = (uint16_t)(info.srWindow.Bottom - info.srWindow.Top + 1);
    size.col = (uint16_t)(info.srWindow.Right - info.srWindow.Left + 1);
  }
  touch(arg, sizeof size);
  memcpy(arg, &size, sizeof size);
  return 0;
}
/* The model has no files. A mapping of a file that cannot be written through is memory with a copy. */
static long long host_mmap(uintptr_t addr, size_t len, uint32_t prot, long long flags, long long fd, long long offset) {
  if (flags & L_MAP_HUGETLB) return -L_ENOMEM;
  if (flags & L_MAP_ANONYMOUS) return model_map(addr, len, prot, flags, R_ANON);
  if ((flags & L_MAP_SHARED) && (prot & L_PROT_WRITE)) return -L_ENODEV;
  if (!fd_at(fd) || fd_at(fd)->kind != FD_FILE) return -L_EBADF;
  long long r = model_map(addr, len, L_PROT_READ | L_PROT_WRITE, flags & ~(long long)L_MAP_NORESERVE, R_FILE);
  if (r < 0) return r;
  for (size_t done = 0; done < len;) {
    long long k = host_rw(fd, (char *)(uintptr_t)r + done, len - done, 0, offset + (long long)done);
    if (k <= 0) break;
    done += (size_t)k;
  }
  if (prot != (L_PROT_READ | L_PROT_WRITE)) model_protect((uintptr_t)r, len, prot);
  return r;
}

/* ---- time ---- */
static struct l_timespec from_100ns(unsigned long long t) {
  struct l_timespec ts = {(int64_t)(t / 10000000), (int64_t)(t % 10000000) * 100};
  return ts;
}
static unsigned long long filetime(FILETIME ft) { return (unsigned long long)ft.dwHighDateTime << 32 | ft.dwLowDateTime; }
static long long host_clock(long long clock, struct l_timespec *out, int resolution) {
  struct l_timespec ts = {0, 100};
  FILETIME created, ended, kernel, user;
  switch (clock) {
    case L_CLOCK_REALTIME: case L_CLOCK_REALTIME_COARSE:
      if (!resolution) {
        GetSystemTimePreciseAsFileTime(&user);
        ts = unix_time(user);
      }
      break;
    case L_CLOCK_MONOTONIC: case L_CLOCK_MONOTONIC_RAW: case L_CLOCK_MONOTONIC_COARSE: case L_CLOCK_BOOTTIME:
      if (resolution) {
        ts.nsec = 1000000000ll / qpc_freq.QuadPart;
        if (ts.nsec < 1) ts.nsec = 1;
      } else {
        LARGE_INTEGER c;
        QueryPerformanceCounter(&c);
        ts.sec = c.QuadPart / qpc_freq.QuadPart;
        ts.nsec = (c.QuadPart % qpc_freq.QuadPart) * 1000000000ll / qpc_freq.QuadPart;
      }
      break;
    case L_CLOCK_PROCESS_CPUTIME_ID:
      if (!resolution) {
        if (!GetProcessTimes(GetCurrentProcess(), &created, &ended, &kernel, &user)) return win_error();
        ts = from_100ns(filetime(kernel) + filetime(user));
      }
      break;
    case L_CLOCK_THREAD_CPUTIME_ID:
      if (!resolution) {
        if (!GetThreadTimes(GetCurrentThread(), &created, &ended, &kernel, &user)) return win_error();
        ts = from_100ns(filetime(kernel) + filetime(user));
      }
      break;
    default: return -L_EINVAL;
  }
  if (out) {
    touch(out, sizeof *out);
    *out = ts;
  }
  return 0;
}
static DWORD to_ms(const struct l_timespec *t) {
  if (!t) return INFINITE;
  long long ms = t->sec * 1000 + (t->nsec + 999999) / 1000000;
  return ms < 0 ? 0 : ms > 0x7ffffffe ? 0x7ffffffe : (DWORD)ms;
}
/* A signal for the thread ends the sleep: EINTR, and what is left of the time. */
static long long host_sleep(const struct l_timespec *request, struct l_timespec *remaining) {
  struct host_thread *t = this_thread();
  long long total = to_ms(request), start = precise_ms();
  for (;;) {
    long long left = total - (precise_ms() - start);
    if (take_signals(t)) {
      if (remaining) {
        touch(remaining, sizeof *remaining);
        remaining->sec = left > 0 ? left / 1000 : 0;
        remaining->nsec = left > 0 ? left % 1000 * 1000000 : 0;
      }
      return -L_EINTR;
    }
    if (left <= 0) return 0;
    WaitForSingleObject(t->wake, (DWORD)left);
  }
}
static long long host_clock_sleep(long long clock, long long flags, const struct l_timespec *request, struct l_timespec *remaining) {
  if (!(flags & 1)) return host_sleep(request, remaining);
  struct l_timespec now, left;
  long long r = host_clock(clock, &now, 0);
  if (r) return r;
  left.sec = request->sec - now.sec;
  left.nsec = request->nsec - now.nsec;
  if (left.nsec < 0) { left.nsec += 1000000000; left.sec--; }
  return left.sec < 0 ? 0 : host_sleep(&left, 0);
}
static long long host_futex(int *addr, long long op, int val, const struct l_timespec *timeout) {
  int cmd = (int)(op & 127);
  InterlockedIncrement64(&futex_ops[cmd & 15]);
  touch(addr, sizeof *addr);
  switch (cmd) {
    case L_FUTEX_WAIT: {
      /* WaitOnAddress cannot be ended from outside, except by a wake on the address. So the
         thread says where it waits, the sender of a signal wakes that address, and because
         that wake can come a moment too early the wait is cut into pieces of 100 ms. */
      struct host_thread *t = this_thread();
      long long total = timeout ? (long long)to_ms(timeout) : -1, start = precise_ms();
      for (;;) {
        t->waiting_on = addr;
        if (signals_ready(t)) {
          t->waiting_on = 0;
          take_signals(t);
          return -L_EINTR;
        }
        if (*addr != val) {
          t->waiting_on = 0;
          return -L_EAGAIN;
        }
        long long left = total < 0 ? 100 : total - (precise_ms() - start);
        if (left <= 0) {
          t->waiting_on = 0;
          return -L_ETIMEDOUT;
        }
        BOOL woken = WaitOnAddress(addr, &val, sizeof val, left > 100 ? 100 : (DWORD)left);
        DWORD error = GetLastError();
        t->waiting_on = 0;
        if (woken) return take_signals(t) ? -L_EINTR : 0;
        if (error != ERROR_TIMEOUT) return -L_EAGAIN;
      }
    }
    case L_FUTEX_WAKE:
      if (val == 1) WakeByAddressSingle(addr); else WakeByAddressAll(addr);
      return val > 0 ? 1 : 0;
    /* Requeue is answered by waking every waiter. */
    case L_FUTEX_REQUEUE: case L_FUTEX_CMP_REQUEUE:
      WakeByAddressAll(addr);
      return 1;
    default:
      return -L_ENOSYS;
  }
}

/* ---- the system ---- */
static long processors(void) {
  DWORD_PTR process, system;
  long n = 0;
  if (GetProcessAffinityMask(GetCurrentProcess(), &process, &system))
    for (; process; process &= process - 1) n++;
  return n < 1 ? 1 : n;
}
static long long host_getaffinity(size_t size, unsigned char *mask) {
  size_t bytes = size > 128 ? 128 : size & ~(size_t)7;
  if (!bytes) return -L_EINVAL;
  long n = processors();
  touch(mask, bytes);
  memset(mask, 0, bytes);
  for (long i = 0; i < n && i < (long)bytes * 8; i++) mask[i / 8] |= (unsigned char)(1 << (i % 8));
  return (long long)bytes;
}
static long long host_sysinfo(struct l_sysinfo *out) {
  MEMORYSTATUSEX m;
  m.dwLength = sizeof m;
  if (!GlobalMemoryStatusEx(&m)) return win_error();
  struct l_sysinfo s;
  memset(&s, 0, sizeof s);
  s.uptime = (int64_t)(GetTickCount64() / 1000);
  s.totalram = m.ullTotalPhys;
  s.freeram = m.ullAvailPhys;
  s.totalswap = m.ullTotalPageFile > m.ullTotalPhys ? m.ullTotalPageFile - m.ullTotalPhys : 0;
  s.freeswap = m.ullAvailPageFile > m.ullAvailPhys ? m.ullAvailPageFile - m.ullAvailPhys : 0;
  s.procs = 1;
  s.mem_unit = 1;
  touch(out, sizeof *out);
  *out = s;
  return 0;
}
static long long host_getrlimit(long long resource, struct l_rlimit *out) {
  if (!out) return 0;
  struct l_rlimit r = {L_RLIM_INFINITY, L_RLIM_INFINITY};
  switch (resource) {
    /* The stack of the main thread is the one that the host made. */
    case L_RLIMIT_STACK: r.cur = r.max = main_stack_high - main_stack_low; break;
    case L_RLIMIT_NOFILE: r.cur = r.max = FD_COUNT; break;
    case L_RLIMIT_CORE: r.cur = r.max = 0; break;
    case L_RLIMIT_CPU: case L_RLIMIT_FSIZE: case L_RLIMIT_DATA: case L_RLIMIT_RSS: case L_RLIMIT_NPROC:
    case L_RLIMIT_MEMLOCK: case L_RLIMIT_AS:
      break;
    default: return -L_EINVAL;
  }
  touch(out, sizeof *out);
  *out = r;
  return 0;
}
static long long host_getrusage(long long who, struct l_rusage *out) {
  FILETIME created, ended, kernel, user;
  BOOL ok = who == L_RUSAGE_THREAD ? GetThreadTimes(GetCurrentThread(), &created, &ended, &kernel, &user) : GetProcessTimes(GetCurrentProcess(), &created, &ended, &kernel, &user);
  if (!ok) return win_error();
  struct l_rusage u;
  memset(&u, 0, sizeof u);
  if (who != L_RUSAGE_CHILDREN) {
    u.utime.sec = (int64_t)(filetime(user) / 10000000); u.utime.usec = (int64_t)(filetime(user) % 10000000) / 10;
    u.stime.sec = (int64_t)(filetime(kernel) / 10000000); u.stime.usec = (int64_t)(filetime(kernel) % 10000000) / 10;
    PROCESS_MEMORY_COUNTERS counters;
    counters.cb = sizeof counters;
    if (GetProcessMemoryInfo(GetCurrentProcess(), &counters, sizeof counters)) {
      u.maxrss = (int64_t)(counters.PeakWorkingSetSize / 1024);
      u.majflt = counters.PageFaultCount;
    }
  }
  touch(out, sizeof *out);
  *out = u;
  return 0;
}
/* The image was built for Linux and may ask which one. */
static long long host_uname(struct l_utsname *out) {
  touch(out, sizeof *out);
  memset(out, 0, sizeof *out);
  strcpy(out->sysname, "Linux");
  DWORD size = sizeof out->nodename - 1;
  if (!GetComputerNameA(out->nodename, &size)) strcpy(out->nodename, "localhost");
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
static long long host_prctl(long long option, long long a) {
  if (option != L_PR_SET_NAME) return -L_EINVAL;
  /* Windows 10 1607 and later have names for threads. */
  typedef HRESULT WINAPI SetDescription(HANDLE, PCWSTR);
  SetDescription *set = (SetDescription *)(void *)GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "SetThreadDescription");
  wchar_t name[32];
  char narrow[16];
  strncpy(narrow, (const char *)a, sizeof narrow - 1);
  narrow[sizeof narrow - 1] = 0;
  if (set && MultiByteToWideChar(CP_UTF8, 0, narrow, -1, name, 32) > 0) set(GetCurrentThread(), name);
  return 0;
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
/* The threads of the image, for the sender of a signal. */
static struct host_thread *threads[4096];
static int thread_count;
static SRWLOCK threads_lock = SRWLOCK_INIT;

static void finish_thread(void *p) {
  struct host_thread *t = p;
  set_stack_fields(t->orig_base, t->orig_limit, t->orig_dealloc);
  AcquireSRWLockExclusive(&threads_lock);
  for (int i = 0; i < thread_count; i++)
    if (threads[i] == t) {
      threads[i] = threads[--thread_count];
      break;
    }
  ReleaseSRWLockExclusive(&threads_lock);
  CloseHandle(t->handle);
  CloseHandle(t->wake);
  if (t->unmap_base) model_unmap((uintptr_t)t->unmap_base, t->unmap_size);
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
  t->in_host = 1;
  t->unmap_base = unmap_base;
  t->unmap_size = unmap_size;
  switch_and_call(t->landing_sp, finish_thread, t);
}
static void on_image_stack(void *p) {
  struct host_thread *t = p;
  t->in_host = 0;
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
  /* Windows is told where the stack is: the range of the table that the stack pointer of the
     new thread is in. A stack has to be committed memory, the exception dispatcher writes to
     it before any handler runs: what may still be lazy is committed here, 1 MiB of it at most. */
  uintptr_t top = (uintptr_t)t->stack_top, low = top - 0x20000, high = top;
  memory_lock();
  struct region *r = region_at(top - 1);
  if (r) {
    low = r->start;
    high = r->end;
  }
  memory_unlock();
  model_touch(low > top - (1u << 20) ? low : top - (1u << 20), top - (low > top - (1u << 20) ? low : top - (1u << 20)));
  set_stack_fields((void *)high, (void *)low, (void *)low);
  reserve[0] = 0;
  switch_and_call((void *)(top & ~15ull), on_image_stack, t);
  return 0;
}
static SYSV long long create_thread(ImageThreadFn fn, void *stack, long long flags, void *arg, int *ptid, void *tls, int *ctid);
static SYSV long long host_thread_create(ImageThreadFn fn, void *stack, long long flags, void *arg, int *ptid, void *tls, int *ctid) {
  struct host_thread *t = this_thread();
  LONG outer = InterlockedExchange(&t->in_host, 1);
  long long r = create_thread(fn, stack, flags, arg, ptid, tls, ctid);
  if (!outer) t->in_host = 0;
  return r;
}
static SYSV long long create_thread(ImageThreadFn fn, void *stack, long long flags, void *arg, int *ptid, void *tls, int *ctid) {
  count(counts, N_clone);
  struct host_thread *t = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof *t);
  if (!t) return -L_ENOMEM;
  t->fn = fn; t->arg = arg; t->tls = tls; t->stack_top = stack;
  t->ctid = flags & L_CLONE_CHILD_CLEARTID ? ctid : 0;
  t->altstack.flags = L_SS_DISABLE;
  /* Thread ids of the image: the main thread has the process id, the others count up from
     there. The libc of the image keeps a thread id in 30 bits of its locks. */
  t->tid = (int)(InterlockedIncrement(&next_tid) & 0x3fffffff);
  /* As after clone: the mask of the thread that made it. The libc of the image blocks the
     signals around the creation, and the new thread sets its own mask first of all. */
  t->mask = this_thread()->mask;
  t->in_host = 1;
  t->wake = CreateEventW(0, FALSE, FALSE, 0);
  t->handle = t->wake ? CreateThread(0, 1 << 20, thread_main, t, CREATE_SUSPENDED, 0) : 0;
  int tid = t->tid;
  AcquireSRWLockExclusive(&threads_lock);
  int full = thread_count == (int)(sizeof threads / sizeof *threads);
  if (t->handle && !full) threads[thread_count++] = t;
  ReleaseSRWLockExclusive(&threads_lock);
  if (!t->handle || full) {
    if (t->handle) {
      TerminateThread(t->handle, 0);
      CloseHandle(t->handle);
    }
    if (t->wake) CloseHandle(t->wake);
    HeapFree(GetProcessHeap(), 0, t);
    return -L_EAGAIN;
  }
  if (flags & L_CLONE_PARENT_SETTID) *ptid = tid;
  ResumeThread(t->handle);
  return tid;
}
static SYSV void host_thread_exit(void *base, unsigned long long size) { leave_thread(base, size); }

/* ---- signals ---- */
static struct l_k_sigaction image_actions[L_NSIG];
static SRWLOCK actions_lock = SRWLOCK_INIT;

static const char *signal_name(int sig) {
  switch (sig) {
    case L_SIGSEGV: return "SIGSEGV";
    case L_SIGBUS: return "SIGBUS";
    case L_SIGILL: return "SIGILL";
    case L_SIGFPE: return "SIGFPE";
    case L_SIGTRAP: return "SIGTRAP";
    case L_SIGABRT: return "SIGABRT";
    default: return "signal";
  }
}
static int ignored_by_default(int sig) { return sig == L_SIGCHLD || sig == L_SIGURG || sig == L_SIGWINCH || sig == L_SIGCONT; }
/* The default action of the other signals. */
static void end_by_signal(int sig) {
  host_log("host: the image ends with signal %d (%s)\n", sig, signal_name(sig));
  leave_process(128 + sig);
}

#if DELIVERS_FAULTS
typedef SYSV void (*ImageHandler)(int, struct l_siginfo *, struct l_ucontext *);
#define HOST_REGISTERS(X, c) \
  X(R8, (c)->R8) X(R9, (c)->R9) X(R10, (c)->R10) X(R11, (c)->R11) X(R12, (c)->R12) X(R13, (c)->R13) X(R14, (c)->R14) \
  X(R15, (c)->R15) X(RDI, (c)->Rdi) X(RSI, (c)->Rsi) X(RBP, (c)->Rbp) X(RBX, (c)->Rbx) X(RDX, (c)->Rdx) X(RAX, (c)->Rax) \
  X(RCX, (c)->Rcx) X(RSP, (c)->Rsp) X(RIP, (c)->Rip) X(EFL, (c)->EFlags)

/* Calls the handler that the image registered for the signal, with the Linux structures, and
   takes over what the handler changed in them. 0: the image has no handler for it.
   fxsave: the 512 bytes of the x87 and SSE state that belong to the context. */
static int deliver(int sig, int code, uintptr_t address, int fault, CONTEXT *context, void *fxsave) {
  struct host_thread *t = this_thread();
  AcquireSRWLockShared(&actions_lock);
  struct l_k_sigaction action = image_actions[sig];
  ReleaseSRWLockShared(&actions_lock);
  if (action.handler == L_SIG_DFL || action.handler == L_SIG_IGN) return 0;
  if (action.flags & L_SA_RESETHAND) image_actions[sig].handler = L_SIG_DFL;
  InterlockedIncrement64(&signals_delivered[sig]);

  struct l_siginfo info;
  memset(&info, 0, sizeof info);
  info.signo = sig;
  info.code = code;
  if (fault) info.u.fault.addr = address;
  else {
    info.u.kill.pid = main_tid;
    info.u.kill.uid = 0;
  }
  struct l_ucontext uc;
  memset(&uc, 0, offsetof(struct l_ucontext, fpregs_mem));
  uc.stack = t->altstack;
#define REGISTER_IN(name, field) uc.mcontext.gregs[L_REG_##name] = (int64_t)(field);
  HOST_REGISTERS(REGISTER_IN, context)
#undef REGISTER_IN
  uc.mcontext.gregs[L_REG_CSGSFS] = (int64_t)((uint64_t)context->SegCs | (uint64_t)context->SegGs << 16 | (uint64_t)context->SegFs << 32);
  uc.mcontext.gregs[L_REG_CR2] = fault ? (int64_t)address : 0;
  memcpy(&uc.fpregs_mem, fxsave, sizeof uc.fpregs_mem);
  uc.mcontext.fpregs = (uint64_t)(uintptr_t)&uc.fpregs_mem;
  /* The mask that the thread has again after the handler. In sigsuspend that is the one
     from before the call, not the one that sigsuspend set for the wait. */
  int suspended = t->suspended;
  uc.sigmask = suspended ? t->restore : t->mask;
  /* While the handler runs, the signal itself and the mask of the action are blocked. */
  t->suspended = 0;
  t->mask |= action.mask | (action.flags & L_SA_NODEFER ? 0 : 1ull << (sig - 1));

  ((ImageHandler)(uintptr_t)action.handler)(sig, &info, &uc);

  t->mask = uc.sigmask;
  if (suspended) t->restore = uc.sigmask;
#define REGISTER_OUT(name, field) (field) = (__typeof__(field))uc.mcontext.gregs[L_REG_##name];
  HOST_REGISTERS(REGISTER_OUT, context)
#undef REGISTER_OUT
  memcpy(fxsave, &uc.fpregs_mem, sizeof uc.fpregs_mem);
  return 1;
}

/* ---- signals to a thread ----
   Linux stops a thread wherever it is and runs the handler on it. Windows has SuspendThread,
   GetThreadContext and SetThreadContext, which is enough where the thread runs code of the
   image: the host stops it, saves its registers on its stack, and points it to
   signal_landing(), which runs the handlers and goes back to where the thread was. A
   thread that is inside of the host or of Windows is not touched that way (it may hold a
   lock). It is inside of a request then, and it takes its signals by itself: at the end
   of the request, and in every wait (futex, sleep, sigsuspend), which the sender ends.
   JavaScriptCore needs this to stop a thread and look at its stack: the garbage collector
   does that now and then, the sampling profiler all the time, the watchdog to end a loop. */
static l_sigset lowest(l_sigset set) { return set & (~set + 1); }
/* Runs the handlers of the signals that the thread can take. 1 if a handler ran. */
static int deliver_pending(struct host_thread *t, CONTEXT *context, void *fxsave) {
  int ran = 0;
  for (l_sigset ready; (ready = signals_ready(t)) != 0;) {
    l_sigset bit = lowest(ready);
    int sig = 1;
    while (!(bit >> (sig - 1) & 1)) sig++;
    InterlockedAnd64(&t->pending, ~(LONG64)bit);
    AcquireSRWLockShared(&actions_lock);
    uint64_t handler = image_actions[sig].handler;
    ReleaseSRWLockShared(&actions_lock);
    if (handler == L_SIG_IGN || (handler == L_SIG_DFL && ignored_by_default(sig))) continue;
    if (handler == L_SIG_DFL) end_by_signal(sig);
    ran |= deliver(sig, L_SI_TKILL, 0, 0, context, fxsave);
  }
  return ran;
}
/* For a thread that is inside of the host: the context is the one of here. The handler
   sees the stack pointer of the host function, which is below everything that the
   image has on this stack, and that is what a handler that looks at the stack needs. */
static int take_signals(struct host_thread *t) {
  if (!signals_ready(t)) return 0;
  CONTEXT context;
  __attribute__((aligned(16))) unsigned char fxsave[512];
  RtlCaptureContext(&context);
  _fxsave64(fxsave);
  return deliver_pending(t, &context, fxsave);
}

_Static_assert(offsetof(CONTEXT, SegCs) == 0x38 && offsetof(CONTEXT, SegSs) == 0x42 && offsetof(CONTEXT, EFlags) == 0x44 && offsetof(CONTEXT, Rax) == 0x78 &&
               offsetof(CONTEXT, Rcx) == 0x80 && offsetof(CONTEXT, Rdx) == 0x88 && offsetof(CONTEXT, Rbx) == 0x90 && offsetof(CONTEXT, Rsp) == 0x98 &&
               offsetof(CONTEXT, Rbp) == 0xa0 && offsetof(CONTEXT, Rsi) == 0xa8 && offsetof(CONTEXT, Rdi) == 0xb0 && offsetof(CONTEXT, R8) == 0xb8 &&
               offsetof(CONTEXT, R15) == 0xf0 && offsetof(CONTEXT, Rip) == 0xf8, "CONTEXT of x64, signal_landing() has these offsets");
/* Bytes that XSAVE needs for the state that the system has enabled, 0 without XSAVE. */
__attribute__((used)) static uint32_t xsave_size;
__attribute__((used)) static void run_pending_signals(CONTEXT *saved, void *state) {
  /* The handler gets a copy of the x87 and SSE state. What it changes there is not taken
     over: the state of the thread comes back from the XSAVE area as a whole. */
  __attribute__((aligned(16))) unsigned char fxsave[512];
  memcpy(fxsave, state, sizeof fxsave);
  deliver_pending(this_thread(), saved, fxsave);
}
/* Where a stopped thread goes on, see stop_and_point(). rcx: the registers that it had,
   saved on its own stack below where it was. Everything that code of the host, of the
   image and of Windows may change while the handlers run is kept here and put back:
   the vector and floating point registers with XSAVE (all that the system has
   enabled, so AVX too), the others from the saved registers, and iretq sets the
   program counter, the flags and the stack pointer in one step. */
__attribute__((naked, used)) static void signal_landing(void) {
  __asm__("push %rbp\n mov %rsp, %rbp\n push %rbx\n push %r12\n"
          "mov %rcx, %rbx\n"
          "mov xsave_size(%rip), %eax\n cmp $512, %eax\n jae 1f\n mov $512, %eax\n"
          "1: add $64, %rax\n sub %rax, %rsp\n and $-64, %rsp\n mov %rsp, %r12\n"
          "xor %eax, %eax\n mov %rax, 512(%r12)\n mov %rax, 520(%r12)\n mov %rax, 528(%r12)\n mov %rax, 536(%r12)\n"
          "mov %rax, 544(%r12)\n mov %rax, 552(%r12)\n mov %rax, 560(%r12)\n mov %rax, 568(%r12)\n"
          "cmpl $0, xsave_size(%rip)\n je 2f\n mov $-1, %eax\n mov $-1, %edx\n xsave64 (%r12)\n jmp 3f\n"
          "2: fxsave64 (%r12)\n"
          "3: sub $32, %rsp\n mov %rbx, %rcx\n mov %r12, %rdx\n call run_pending_signals\n"
          "cmpl $0, xsave_size(%rip)\n je 4f\n mov $-1, %eax\n mov $-1, %edx\n xrstor64 (%r12)\n jmp 5f\n"
          "4: fxrstor64 (%r12)\n"
          "5: mov %rbx, %rcx\n"
          "movzwl 0x42(%rcx), %eax\n push %rax\n push 0x98(%rcx)\n mov 0x44(%rcx), %eax\n push %rax\n"
          "movzwl 0x38(%rcx), %eax\n push %rax\n push 0xf8(%rcx)\n"
          "mov 0x78(%rcx), %rax\n mov 0x88(%rcx), %rdx\n mov 0x90(%rcx), %rbx\n mov 0xa0(%rcx), %rbp\n mov 0xa8(%rcx), %rsi\n"
          "mov 0xb0(%rcx), %rdi\n mov 0xb8(%rcx), %r8\n mov 0xc0(%rcx), %r9\n mov 0xc8(%rcx), %r10\n mov 0xd0(%rcx), %r11\n"
          "mov 0xd8(%rcx), %r12\n mov 0xe0(%rcx), %r13\n mov 0xe8(%rcx), %r14\n mov 0xf0(%rcx), %r15\n mov 0x80(%rcx), %rcx\n"
          "iretq\n");
}
/* The thread is stopped and runs code of the image: it goes on in signal_landing(). */
static int stop_and_point(struct host_thread *target, CONTEXT *context) {
  uintptr_t below = context->Rsp - 128;
  CONTEXT *saved = (CONTEXT *)((below - sizeof(CONTEXT)) & ~(uintptr_t)63);
  *saved = *context;
  uintptr_t frame = (((uintptr_t)saved - 64) & ~(uintptr_t)15) - 8; /* as after a call */
  *(uintptr_t *)frame = 0;
  CONTEXT go = *context;
  go.ContextFlags = CONTEXT_CONTROL | CONTEXT_INTEGER;
  go.Rip = (DWORD64)(uintptr_t)signal_landing;
  go.Rsp = frame;
  go.Rcx = (DWORD64)(uintptr_t)saved;
  go.EFlags &= ~0x500u; /* direction and trap flag */
  return SetThreadContext(target->handle, &go) != 0;
}
/* One sender at a time: two threads that stop each other would both stay stopped. */
static SRWLOCK sender_lock = SRWLOCK_INIT;
static long long send_to_thread(struct host_thread *target, int sig) {
  l_sigset bit = 1ull << (sig - 1);
  InterlockedOr64(&target->pending, (LONG64)bit);
  SetEvent(target->wake);
  void *waits_on = target->waiting_on;
  if (waits_on) WakeByAddressAll(waits_on);
  for (int attempt = 0; attempt < 5000; attempt++) {
    if (!((l_sigset)target->pending & bit)) return 0;
    int settled = 0;
    AcquireSRWLockExclusive(&sender_lock);
    if (SuspendThread(target->handle) != (DWORD)-1) {
      /* Inside of a request the thread takes the signal by itself, and a signal that it
         blocks waits until it does not. Nothing that takes a lock is called while the
         thread is stopped, except the lock of the table of the memory, which is only
         tried: the thread may be the one that holds it. */
      if (target->in_host || !((l_sigset)target->pending & bit & ~target->mask)) settled = 1;
      else {
        CONTEXT context;
        context.ContextFlags = CONTEXT_CONTROL | CONTEXT_INTEGER;
        if (GetThreadContext(target->handle, &context) && TryAcquireSRWLockExclusive(&memory_srw)) {
          int of_image = region_at((uintptr_t)context.Rip) != 0;
          ReleaseSRWLockExclusive(&memory_srw);
          if (of_image) settled = stop_and_point(target, &context);
        }
      }
      ResumeThread(target->handle);
    }
    ReleaseSRWLockExclusive(&sender_lock);
    if (settled) return 0;
    /* The thread is on its way between the image and the host (or in an exception). */
    Sleep(attempt < 50 ? 0 : 1);
  }
  return 0;
}
#else
static int take_signals(struct host_thread *t) { (void)t; return 0; }
#endif

/* Every exception of the process passes here first. Two kinds are for this host:
   - a page of the image that is reserved and not committed yet: it is committed, and the
     instruction runs again
   - a fault of code of the image (the image itself, or memory that it mapped: the code of
     the JIT): the handler of the image for the Linux signal runs
   Everything else is left to Windows. */
static LONG CALLBACK on_exception(EXCEPTION_POINTERS *e) {
  EXCEPTION_RECORD *record = e->ExceptionRecord;
  CONTEXT *context = e->ContextRecord;
  struct host_thread *t = this_thread();
  int sig = 0, code = 0;
  uintptr_t address = 0;
#if defined(__x86_64__)
  uintptr_t pc = context->Rip;
#else
  uintptr_t pc = context->Pc;
#endif
  switch (record->ExceptionCode) {
    case EXCEPTION_ACCESS_VIOLATION: case EXCEPTION_IN_PAGE_ERROR: {
      if (record->NumberParameters < 2) return EXCEPTION_CONTINUE_SEARCH;
      ULONG_PTR kind = record->ExceptionInformation[0];
      address = record->ExceptionInformation[1];
      /* An address that is none (not canonical) comes as -1. Linux: a fault without address. */
      if (address == (ULONG_PTR)-1 && record->ExceptionCode == EXCEPTION_ACCESS_VIOLATION) {
        sig = L_SIGSEGV; code = L_SI_KERNEL; address = 0;
        break;
      }
      int again = t->fault_address == address ? t->fault_repeats + 1 : 0;
      t->fault_address = address;
      t->fault_repeats = again;
      if (again < 8 && model_fault(address, kind == 1, kind == 8)) {
        InterlockedIncrement64(&lazy_commits);
        return EXCEPTION_CONTINUE_EXECUTION;
      }
      memory_lock();
      struct region *r = region_at(address);
      uint32_t flags = r ? r->flags : 0;
      memory_unlock();
      if (record->ExceptionCode == EXCEPTION_IN_PAGE_ERROR) { sig = L_SIGBUS; code = L_BUS_ADRERR; }
      else { sig = L_SIGSEGV; code = flags ? L_SEGV_ACCERR : L_SEGV_MAPERR; }
      break;
    }
    case EXCEPTION_STACK_OVERFLOW: case EXCEPTION_GUARD_PAGE:
      sig = L_SIGSEGV; code = L_SEGV_ACCERR;
      address = record->NumberParameters >= 2 ? record->ExceptionInformation[1] : 0;
      break;
    /* hlt and the like: a general protection fault on Linux, which is SIGSEGV without address. */
    case EXCEPTION_PRIV_INSTRUCTION: sig = L_SIGSEGV; code = L_SI_KERNEL; break;
    case EXCEPTION_ILLEGAL_INSTRUCTION: sig = L_SIGILL; code = L_ILL_ILLOPN; address = pc; break;
    case EXCEPTION_INT_DIVIDE_BY_ZERO: sig = L_SIGFPE; code = L_FPE_INTDIV; address = pc; break;
    case EXCEPTION_INT_OVERFLOW: sig = L_SIGSEGV; code = L_SI_KERNEL; break;
    case EXCEPTION_FLT_DIVIDE_BY_ZERO: sig = L_SIGFPE; code = L_FPE_FLTDIV; address = pc; break;
    case EXCEPTION_FLT_OVERFLOW: sig = L_SIGFPE; code = L_FPE_FLTOVF; address = pc; break;
    case EXCEPTION_FLT_UNDERFLOW: sig = L_SIGFPE; code = L_FPE_FLTUND; address = pc; break;
    case EXCEPTION_FLT_INEXACT_RESULT: sig = L_SIGFPE; code = L_FPE_FLTRES; address = pc; break;
    case EXCEPTION_FLT_INVALID_OPERATION: case EXCEPTION_FLT_DENORMAL_OPERAND: case EXCEPTION_FLT_STACK_CHECK:
      sig = L_SIGFPE; code = L_FPE_FLTINV; address = pc;
      break;
    case EXCEPTION_BREAKPOINT: sig = L_SIGTRAP; code = L_SI_KERNEL; break;
    case EXCEPTION_SINGLE_STEP: sig = L_SIGTRAP; code = L_TRAP_TRACE; address = pc; break;
    default:
      return EXCEPTION_CONTINUE_SEARCH;
  }
  memory_lock();
  int of_image = region_at(pc) != 0;
  memory_unlock();
  if (!of_image) return EXCEPTION_CONTINUE_SEARCH;
#if DELIVERS_FAULTS
  /* Windows reports a breakpoint at the instruction, Linux after it. */
  if (record->ExceptionCode == EXCEPTION_BREAKPOINT) context->Rip++;
  if (deliver(sig, code, address, 1, context, &context->FltSave)) return EXCEPTION_CONTINUE_EXECUTION;
#endif
  (void)code;
  host_log("host: %s (Windows exception %#lx) at address %#llx, program counter %#llx%s, and the image has no handler for it\n", signal_name(sig),
           (unsigned long)record->ExceptionCode, (unsigned long long)address, (unsigned long long)pc, pc >= image_base && pc < image_end ? " (in the image)" : "");
  if (pc >= image_base && pc < image_end) host_log("host: image offset %#llx\n", (unsigned long long)(pc - image_base));
  leave_process(128 + sig);
  return EXCEPTION_CONTINUE_SEARCH;
}

static long long host_sigaction(int sig, const struct l_k_sigaction *act, struct l_k_sigaction *old) {
  if (sig < 1 || sig >= L_NSIG || sig == L_SIGKILL || sig == L_SIGSTOP) return -L_EINVAL;
  AcquireSRWLockExclusive(&actions_lock);
  struct l_k_sigaction before = image_actions[sig];
  if (act) image_actions[sig] = *act;
  ReleaseSRWLockExclusive(&actions_lock);
  if (old) {
    touch(old, sizeof *old);
    *old = before;
  }
  return 0;
}
/* tid 0: the process, which is the calling thread here. */
static long long host_kill(int tid, int sig) {
  struct host_thread *t = this_thread();
  if (sig < 0 || sig >= L_NSIG) return -L_EINVAL;
  long long r = -L_ESRCH;
  AcquireSRWLockShared(&threads_lock);
  struct host_thread *target = !tid || tid == t->tid ? t : tid == main_tid ? &main_thread : 0;
  for (int i = 0; i < thread_count && !target; i++)
    if (threads[i]->tid == tid) target = threads[i];
  if (target && !sig) r = 0;
  else if (target) {
    AcquireSRWLockShared(&actions_lock);
    uint64_t handler = image_actions[sig].handler;
    ReleaseSRWLockShared(&actions_lock);
    if (handler == L_SIG_IGN || (handler == L_SIG_DFL && ignored_by_default(sig))) r = 0;
    else if (handler == L_SIG_DFL) end_by_signal(sig);
#if DELIVERS_FAULTS
    else if (target == t) {
      InterlockedOr64(&t->pending, (LONG64)(1ull << (sig - 1)));
      r = 0;
    } else r = send_to_thread(target, sig);
#else
    else r = -L_ENOSYS;
#endif
  }
  ReleaseSRWLockShared(&threads_lock);
  /* raise(): the handler has run when the call returns. */
  if (target == t) take_signals(t);
  return r;
}
static long long host_sigprocmask(long long how, const l_sigset *set, l_sigset *old) {
  struct host_thread *t = this_thread();
  l_sigset before = t->mask;
  if (set) {
    l_sigset change = *set & ~(1ull << (L_SIGKILL - 1) | 1ull << (L_SIGSTOP - 1));
    if (how == L_SIG_BLOCK) t->mask |= change;
    else if (how == L_SIG_UNBLOCK) t->mask &= ~change;
    else if (how == L_SIG_SETMASK) t->mask = change;
    else return -L_EINVAL;
  }
  if (old) {
    touch(old, sizeof *old);
    *old = before;
  }
  /* What was sent while it was blocked. */
  take_signals(t);
  return 0;
}
/* Waits until a handler has run for a signal that `set` does not block. */
static long long host_sigsuspend(const l_sigset *set) {
  struct host_thread *t = this_thread();
  t->restore = t->mask;
  t->mask = *set & ~(1ull << (L_SIGKILL - 1) | 1ull << (L_SIGSTOP - 1));
  for (;;) {
    t->suspended = 1;
    if (take_signals(t)) break;
    WaitForSingleObject(t->wake, 100);
  }
  t->suspended = 0;
  t->mask = t->restore;
  return -L_EINTR;
}
static long long host_sigaltstack(const struct l_stack *stack, struct l_stack *old) {
  struct host_thread *t = this_thread();
  if (old) {
    touch(old, sizeof *old);
    *old = t->altstack;
  }
  if (stack) t->altstack = *stack;
  return 0;
}

/* ---- syscalls ---- */
static long long dispatch(long long n, long long a, long long b, long long c, long long d, long long e, long long f) {
  switch (n) {
    case N_read: return host_rw(a, (char *)b, (size_t)c, 0, -1);
    case N_write: return host_rw(a, (char *)b, (size_t)c, 1, -1);
    case N_pread64: return d < 0 ? -L_EINVAL : host_rw(a, (char *)b, (size_t)c, 0, d);
    case N_pwrite64: return d < 0 ? -L_EINVAL : host_rw(a, (char *)b, (size_t)c, 1, d);
    case N_readv: return host_rwv(a, (struct l_iovec *)b, c, 0);
    case N_writev: return host_rwv(a, (struct l_iovec *)b, c, 1);
    case N_open: return host_open(n, (const char *)a, b);
    case N_openat: return host_open(n, (const char *)b, c);
    case N_close: return host_close(a);
    case N_lseek: return host_lseek(a, b, c);
    case N_stat: case N_lstat: return host_stat(n, (const char *)a, (void *)b);
    case N_fstat: return host_fstat(a, (void *)b);
    case N_newfstatat: return (d & L_AT_EMPTY_PATH) && !*(const char *)b ? host_fstat(a, (void *)c) : host_stat(n, (const char *)b, (void *)c);
    case N_access: return host_access(n, (const char *)a, b);
    case N_faccessat: case N_faccessat2: return host_access(n, (const char *)b, c);
    case N_readlink: return host_readlink(n, (const char *)a);
    case N_readlinkat: return host_readlink(n, (const char *)b);
    case N_unlink: return host_unlink(n, (const char *)a, 0);
    case N_unlinkat: return host_unlink(n, (const char *)b, c);
    case N_getcwd: return host_getcwd((char *)a, (size_t)b);
    case N_fcntl: return host_fcntl(a, b, c);
    case N_ioctl: return host_ioctl(a, (unsigned long long)b, (void *)c);
    case N_dup: return host_dup(a, -1, 0, 0);
    case N_dup2: return a == b ? (fd_at(a) ? b : -L_EBADF) : host_dup(a, b, 0, 0);
    case N_dup3: return a == b ? -L_EINVAL : host_dup(a, b, 0, !!(c & L_O_CLOEXEC));
    case N_ftruncate: {
      struct host_fd *file = fd_at(a);
      LARGE_INTEGER to, before;
      to.QuadPart = 0;
      if (!file || file->kind != FD_FILE) return -L_EBADF;
      if (b < 0) return -L_EINVAL;
      /* The end of a file is set where its position is, and the position of the image stays. */
      if (!SetFilePointerEx(file->handle, to, &before, FILE_CURRENT)) return win_error();
      to.QuadPart = b;
      long long r = SetFilePointerEx(file->handle, to, 0, FILE_BEGIN) && SetEndOfFile(file->handle) ? 0 : win_error();
      SetFilePointerEx(file->handle, before, 0, FILE_BEGIN);
      return r;
    }
    case N_fsync: case N_fdatasync: return fd_at(a) ? (fd_at(a)->kind != FD_FILE || FlushFileBuffers(fd_at(a)->handle) ? 0 : win_error()) : -L_EBADF;
    case N_umask: return 022;

    case N_mmap: return host_mmap((uintptr_t)a, (size_t)b, (uint32_t)c & 7, d, (int)e, f);
    case N_mprotect: return model_protect((uintptr_t)a, (size_t)b, (uint32_t)c & 7);
    case N_munmap: return model_unmap((uintptr_t)a, (size_t)b);
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
    case N_rt_sigpending:
      touch((void *)a, sizeof(l_sigset));
      *(l_sigset *)a = (l_sigset)this_thread()->pending;
      return 0;
    case N_sigaltstack: return host_sigaltstack((void *)a, (void *)b);
    case N_tkill: return a > 0 ? host_kill((int)a, (int)b) : -L_EINVAL;
    case N_tgkill: return a == main_tid && b > 0 ? host_kill((int)b, (int)c) : -L_ESRCH;
    case N_kill: return a == main_tid || a == 0 ? host_kill(0, (int)b) : -L_ESRCH;
    case N_rt_sigsuspend: return DELIVERS_FAULTS ? host_sigsuspend((void *)a) : -L_ENOSYS;
    case N_rt_sigreturn:
      host_log("host: rt_sigreturn, and no signal frame of a kernel is there\n");
      leave_process(70);
      return 0;

    case N_sched_yield: SwitchToThread(); return 0;
    case N_nanosleep: return host_sleep((void *)a, (void *)b);
    case N_clock_nanosleep: return host_clock_sleep(a, b, (void *)c, (void *)d);
    case N_clock_gettime: return host_clock(a, (void *)b, 0);
    case N_clock_getres: return host_clock(a, (void *)b, 1);
    case N_gettimeofday: {
      struct l_timespec ts;
      host_clock(L_CLOCK_REALTIME, &ts, 0);
      if (a) {
        touch((void *)a, sizeof(struct l_timeval));
        ((struct l_timeval *)a)->sec = ts.sec;
        ((struct l_timeval *)a)->usec = ts.nsec / 1000;
      }
      return 0;
    }
    case N_futex: return host_futex((int *)a, b, (int)c, (void *)d);

    case N_getpid: return main_tid;
    case N_getppid: return 1;
    case N_gettid: return this_thread()->tid;
    case N_set_tid_address: this_thread()->ctid = (int *)a; return this_thread()->tid;
    case N_getuid: case N_geteuid: case N_getgid: case N_getegid: return 1000;
    case N_arch_prctl:
      if (a != L_ARCH_SET_FS) return -L_EINVAL;
      TlsSetValue(tp_slot, (void *)b);
      return 0;
    case N_set_tp: TlsSetValue(tp_slot, (void *)a); return 0;
    /* Robust mutexes are a matter between the libc and the Linux kernel. The list of a
       thread that ends is walked by the libc itself (pthread_exit). */
    case N_set_robust_list: return 0;
    case N_prctl: return host_prctl(a, b);
    case N_uname: return host_uname((void *)a);
    case N_sysinfo: return host_sysinfo((void *)a);
    case N_sched_getaffinity: return a == 0 || a == main_tid || a == this_thread()->tid ? host_getaffinity((size_t)b, (void *)c) : -L_ESRCH;
    case N_getcpu:
      if (a) *(uint32_t *)a = 0;
      if (b) *(uint32_t *)b = 0;
      return 0;
    case N_getrlimit: return host_getrlimit(a, (void *)b);
    case N_prlimit64: return (a && a != main_tid) ? -L_ESRCH : c ? -L_EPERM : host_getrlimit(b, (void *)d);
    case N_setrlimit: return -L_EPERM;
    case N_getrusage: return host_getrusage(a, (void *)b);
    case N_getrandom: return host_random((void *)a, (size_t)b);

    /* One process: the host starts no other. */
    case N_fork: case N_vfork: case N_clone: case N_execve: case N_wait4: return -L_ENOSYS;
    case N_exit: leave_thread(0, 0); return 0;
    case N_exit_group: leave_process((int)a); return 0;
    default:
      break;
  }
  count(refused, n);
  return -L_ENOSYS;
}
static SYSV long long host_syscall(long long n, long long a, long long b, long long c, long long d, long long e, long long f) {
  struct host_thread *t = this_thread();
  /* A request inside of a handler that runs inside of a request: the outer one is not over. */
  LONG outer = InterlockedExchange(&t->in_host, 1);
  count(counts, n);
  long long r = dispatch(n, a, b, c, d, e, f);
  if (trace > 1 || (trace && r == -L_ENOSYS)) host_log("[host] %lld %s(%#llx, %#llx, %#llx, %#llx) = %lld\n", n, l_request_name(n), a, b, c, d, r);
  if (outer) return r;
  /* Signals that came during the request. The sender looks at in_host after it has set
     the signal as pending, so the look at pending after in_host is 0 misses none. */
  do {
    take_signals(t);
    t->in_host = 0;
  } while (signals_ready(t) && !InterlockedExchange(&t->in_host, 1));
  return r;
}

/* ---- image loading and start ---- */
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
static char *utf8(const wchar_t *w) {
  int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, 0, 0, 0, 0);
  char *s = malloc((size_t)(n > 0 ? n : 1));
  if (n <= 0 || !WideCharToMultiByte(CP_UTF8, 0, w, -1, s, n, 0, 0)) s[0] = 0;
  return s;
}

/* ---- where the image lies in the file ----
   Two forms are started, and this is the only place that tells them apart.

   A bare image file named by argv[1]: its ELF header is at offset 0 and the
   arguments of the image are argv[2] and on. This is how the host is used
   with an image that was built by misctools/portable/build.ts.

   Or the packed form of tools/pack.ts: this .exe IS the container. One file
   that is this Windows host, a shell script for sh, the loader stubs of the
   other systems, and the image at a 64 KiB boundary inside it. Its last 128
   bytes are a table of contents: "BUNPACK1", u32 version, u32 size, then u64
   file_size, arch, header_size, image_off, image_len, code_off, code_len,
   sig_off, sig_len, the stub offsets, and the magic again in the last 8
   bytes. In that form there is no image argument: argv[0] is the name of the
   container and all of argv belongs to the image.

   Either way the image is mapped with views of that one file, at image_off +
   the offset of the segment: nothing is copied out to a second file. */
#define TOC_SIZE 128
static HANDLE open_image_file(const wchar_t *path) {
  return CreateFileW(path, GENERIC_READ | GENERIC_EXECUTE, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, 0, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, 0);
}
static int read_toc(HANDLE file, uint64_t *image_off) {
  unsigned char toc[TOC_SIZE];
  LARGE_INTEGER size, at;
  DWORD got = 0;
  if (!GetFileSizeEx(file, &size) || size.QuadPart < TOC_SIZE) return 0;
  at.QuadPart = size.QuadPart - TOC_SIZE;
  if (!SetFilePointerEx(file, at, 0, FILE_BEGIN) || !ReadFile(file, toc, TOC_SIZE, &got, 0) || got != TOC_SIZE) return 0;
  if (memcmp(toc, "BUNPACK1", 8) || memcmp(toc + TOC_SIZE - 8, "BUNPACK1", 8)) return 0;
  memcpy(image_off, toc + 40, 8);
  return 1;
}

int wmain(int argc, wchar_t **wide) {
  trace = getenv("BUN_HOST_TRACE") ? atoi(getenv("BUN_HOST_TRACE")) : 0;
  QueryPerformanceFrequency(&qpc_freq);
  fds[0].handle = GetStdHandle(STD_INPUT_HANDLE);
  fds[1].handle = GetStdHandle(STD_OUTPUT_HANDLE);
  fds[2].handle = GetStdHandle(STD_ERROR_HANDLE);
  fds[0].kind = fds[1].kind = fds[2].kind = FD_FILE;
  fds[0].flags = 0;
  fds[1].flags = fds[2].flags = 1;
  /* The image writes UTF-8. The console gets its code page back at the end. */
  console_code_page = GetConsoleOutputCP();
  SetConsoleOutputCP(CP_UTF8);
  if (getenv("BUN_HOST_PATHS")) {
    wchar_t w[4096];
    if (host_path(getenv("BUN_HOST_PATHS"), w, 4096) == PATH_FILE) paths_file = CreateFileW(w, FILE_APPEND_DATA, FILE_SHARE_READ, 0, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, 0);
  }
  main_tid = (int)(GetCurrentProcessId() & 0x3fffffff);
  next_tid = main_tid;
  main_thread.tid = main_tid;
  main_thread.altstack.flags = L_SS_DISABLE;
  main_thread.in_host = 1;
  main_thread.wake = CreateEventW(0, FALSE, FALSE, 0);
  if (!main_thread.wake || !DuplicateHandle(GetCurrentProcess(), GetCurrentThread(), GetCurrentProcess(), &main_thread.handle, 0, FALSE, DUPLICATE_SAME_ACCESS)) return 2;
#if DELIVERS_FAULTS
  {
    /* XSAVE, and enabled by the system: the size of the area for what is enabled. */
    int info[4];
    __cpuid(info, 1);
    if ((info[2] >> 26 & 1) && (info[2] >> 27 & 1)) {
      __cpuidex(info, 0xd, 0);
      xsave_size = (uint32_t)info[1];
    }
  }
#endif

  /* ---- where the image lies in the file: see above ---- */
  uint64_t image_off = 0;
  int first_arg = 1;
  const wchar_t *image_path = argc > 1 ? wide[1] : wide[0];
  HANDLE file_handle = INVALID_HANDLE_VALUE;
  {
    wchar_t self[32768];
    DWORD n = GetModuleFileNameW(0, self, 32768);
    if (n && n < 32768) {
      HANDLE mine = open_image_file(self);
      if (mine != INVALID_HANDLE_VALUE) {
        if (read_toc(mine, &image_off)) { file_handle = mine; first_arg = 0; image_path = wide[0]; }
        else CloseHandle(mine);
      }
    }
  }
  if (file_handle == INVALID_HANDLE_VALUE) {
    if (argc < 2) { fprintf(stderr, "usage: host <image> [args]\n"); return 2; }
    file_handle = open_image_file(wide[1]);
  }
  if (file_handle == INVALID_HANDLE_VALUE) { fprintf(stderr, "host: cannot open %s\n", utf8(image_path)); return 2; }
  LARGE_INTEGER file_size;
  GetFileSizeEx(file_handle, &file_size);
  HANDLE mapping = CreateFileMappingW(file_handle, 0, PAGE_EXECUTE_READ, 0, 0, 0);
  if (!mapping) { fprintf(stderr, "host: cannot create an executable file mapping (%lu)\n", GetLastError()); return 2; }
  unsigned char *file = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0);
  if (!file) return 2;
  Ehdr *eh = (Ehdr *)(file + image_off);
  if (eh->machine != IMAGE_MACHINE) { fprintf(stderr, "host: %s is an image for another processor (ELF machine %d, this host runs %d)\n", utf8(image_path), eh->machine, IMAGE_MACHINE); return 2; }
  Phdr *ph = (Phdr *)((unsigned char *)eh + eh->phoff);
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
      uint64_t at = image_off + ph[i].offset; /* its offset in this file */
      if ((ph[i].vaddr | at) & 0xffff) { fprintf(stderr, "host: segment %d is not aligned to 64 KiB\n", i); return 2; }
      size_t mem = (ph[i].memsz + PAGE - 1) & ~(PAGE - 1);
      if (ph[i].flags & 2) {
        unsigned char *p = VirtualAlloc(want + ph[i].vaddr, mem, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
        if (p) { memcpy(p, file + at, ph[i].filesz); copied_bytes += ph[i].filesz; }
        ok = p != 0;
      } else {
        DWORD access = FILE_MAP_READ | (ph[i].flags & 1 ? FILE_MAP_EXECUTE : 0);
        ok = MapViewOfFileEx(mapping, access, (DWORD)(at >> 32), (DWORD)at, ph[i].filesz, want + ph[i].vaddr) != 0;
        mapped_bytes += ph[i].filesz;
      }
    }
    if (ok) base = want;
    else
      for (int i = 0; i < eh->phnum; i++)
        if (ph[i].type == 1 && !UnmapViewOfFile(want + ph[i].vaddr)) VirtualFree(want + ph[i].vaddr, 0, MEM_RELEASE);
  }
  if (!base) { fprintf(stderr, "host: cannot place the image (%lu)\n", GetLastError()); return 2; }
  image_base = (uintptr_t)base;
  image_end = image_base + top;
  if (trace) {
    MEMORY_BASIC_INFORMATION info;
    VirtualQuery(base + eh->entry, &info, sizeof info);
    fprintf(stderr, "[host] code is %s, %zu bytes mapped from the file, %zu bytes copied\n",
            info.Type == MEM_MAPPED ? "a file view (MEM_MAPPED)" : info.Type == MEM_PRIVATE ? "private memory" : "an image section", mapped_bytes, copied_bytes);
  }
  /* The image changes the protection of parts of itself, so its segments are ranges of the
     table like everything that it maps later. */
  memory_lock();
  for (int i = 0; i < eh->phnum; i++) {
    if (ph[i].type != 1) continue;
    uintptr_t start = image_base + ph[i].vaddr;
    uint32_t prot = L_PROT_READ | (ph[i].flags & 2 ? L_PROT_WRITE : 0) | (ph[i].flags & 1 ? L_PROT_EXEC : 0);
    region_set(start, start + page_up(ph[i].memsz), prot, (ph[i].flags & 2 ? R_ANON : R_FILE) | R_COMMITTED);
  }
  memory_unlock();
  /* Every segment is an allocation or a view of its own, so it is a block of its own: no
     call of VirtualProtect goes from one of them into the next. */
  for (int i = 0; i < eh->phnum; i++)
    if (ph[i].type == 1 && model_adopt(image_base + ph[i].vaddr, granule_up(ph[i].memsz))) return 2;
  Phdr *image_ph = (Phdr *)(base + eh->phoff);
  AddVectoredExceptionHandler(1, on_exception);

  tp_slot = TlsAlloc();
  thread_slot = TlsAlloc();
  if (tp_slot >= 64) { fprintf(stderr, "host: no low TLS slot\n"); return 2; }
  static struct bun_host host;
  host.os = BUN_OS_WINDOWS;
  host.tcb_offset = TEB_TLS_SLOTS + 8ull * tp_slot;
  TlsSetValue(tp_slot, (void *)0x1122334455667788ull);
  if (*(void **)((char *)NtCurrentTeb() + host.tcb_offset) != (void *)0x1122334455667788ull) { fprintf(stderr, "host: thread slot %lu is not at offset %#llx of the TEB\n", tp_slot, host.tcb_offset); return 2; }
  host.syscall = host_syscall;
  host.thread_create = host_thread_create;
  host.thread_exit = host_thread_exit;

  /* The stack of the main thread. The image asks for its bounds (N_main_stack), and for
     its size as the limit of the stack (getrlimit). */
  size_t stack_size = 8u << 20;
  long long made = model_map(0, stack_size, L_PROT_READ | L_PROT_WRITE, L_MAP_PRIVATE | L_MAP_ANONYMOUS, R_ANON | R_MAIN_STACK);
  if (made < 0) { fprintf(stderr, "host: no memory for the stack\n"); return 2; }
  char *stack = (char *)(intptr_t)made;
  main_stack_low = (uintptr_t)stack;
  main_stack_high = main_stack_low + stack_size;
  char *strings = stack + stack_size - 262144;
  char *cursor = strings;
  uint64_t *vec = (uint64_t *)(stack + stack_size - 262144 - 131072), *v = vec;
  static unsigned char random_bytes[16];
  if (!random_bytes_of_system(random_bytes, 16)) return 2;

  /* first_arg is 1 for a bare image named by argv[1], 0 in the packed form:
     see "where the image lies in the file" above. */
  *v++ = (uint64_t)(argc - first_arg);
  for (int i = first_arg; i < argc; i++) {
    int n = WideCharToMultiByte(CP_UTF8, 0, wide[i], -1, cursor, (int)(stack + stack_size - cursor - 16), 0, 0);
    if (n <= 0) { fprintf(stderr, "host: the arguments do not fit\n"); return 2; }
    *v++ = (uint64_t)(uintptr_t)cursor;
    cursor += n;
  }
  *v++ = 0;
  wchar_t *env = GetEnvironmentStringsW();
  for (wchar_t *e = env; *e; e += wcslen(e) + 1) {
    if (*e == L'=') continue;
    int n = WideCharToMultiByte(CP_UTF8, 0, e, -1, cursor, (int)(stack + stack_size - cursor - 16), 0, 0);
    if (n <= 0 || v - vec > 8000) break;
    *v++ = (uint64_t)(uintptr_t)cursor;
    cursor += n;
  }
  *v++ = 0;
  uint64_t aux[] = {L_AT_PHDR, (uint64_t)(uintptr_t)image_ph, L_AT_PHENT, sizeof(Phdr), L_AT_PHNUM, eh->phnum, L_AT_PAGESZ, PAGE, L_AT_BASE, 0,
                    L_AT_ENTRY, (uint64_t)(uintptr_t)(base + eh->entry), L_AT_UID, 0, L_AT_EUID, 0, L_AT_GID, 0, L_AT_EGID, 0, L_AT_SECURE, 0,
                    L_AT_RANDOM, (uint64_t)(uintptr_t)random_bytes, AT_BUN_HOST, (uint64_t)(uintptr_t)&host, L_AT_NULL, 0};
  memcpy(v, aux, sizeof aux);

  if (trace) fprintf(stderr, "[host] file %lld bytes, image at %#llx, mapped at %p, entry %p, thread slot offset %#llx\n", (long long)file_size.QuadPart, (unsigned long long)image_off, base, base + eh->entry, host.tcb_offset);
#if DELIVERS_FAULTS
  if (trace) fprintf(stderr, "[host] state of a thread that is stopped for a signal: %s, %u bytes\n", xsave_size ? "XSAVE" : "FXSAVE", xsave_size ? xsave_size : 512);
#endif
  fflush(0);
  set_stack_fields(stack + stack_size, stack, stack);
  main_thread.in_host = 0;
  enter_image(base + eh->entry, vec);
  return 0;
}
