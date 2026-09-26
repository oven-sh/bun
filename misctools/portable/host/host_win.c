// Windows host for the portable image (x86-64).
// It maps the image, builds a Linux-style start stack, and serves the image's
// OS requests: Linux syscall numbers come in with the System V calling
// convention and are answered with Win32. The image itself is never modified.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SYSV __attribute__((sysv_abi))
#define AT_BUN_HOST 0x62756e00
#define PAGE 4096ull

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
};

static DWORD tp_slot, thread_slot;
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
static HANDLE fd_handle(long long fd) { return fd >= 0 && fd < 1024 ? fds[fd] : 0; }
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
__attribute__((naked)) static void switch_and_call(void *sp, void (*fn)(void *), void *arg) {
  __asm__("mov %rcx, %rsp\n"
          "sub $32, %rsp\n"
          "mov %r8, %rcx\n"
          "xor %ebp, %ebp\n"
          "call *%rdx\n"
          "ud2\n");
}
static void set_stack_fields(void *base, void *limit, void *dealloc) {
  NT_TIB *tib = (NT_TIB *)NtCurrentTeb();
  tib->StackBase = base;
  tib->StackLimit = limit;
  *(void **)((char *)tib + 0x1478) = dealloc;
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
  t->orig_dealloc = *(void **)((char *)tib + 0x1478);
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
    case 0: r = host_rw(a, (char *)b, (size_t)c, 0); break;
    case 1: r = host_rw(a, (char *)b, (size_t)c, 1); break;
    case 2: r = host_open((const char *)a, b); break;
    case 257: r = host_open((const char *)b, c); break;
    case 3: {
      HANDLE h = fd_handle(a);
      if (!h) { r = -L_EBADF; break; }
      if (a > 2) { CloseHandle(h); fds[a] = 0; }
      r = 0;
      break;
    }
    case 8: {
      LARGE_INTEGER to, out;
      to.QuadPart = b;
      r = SetFilePointerEx(fd_handle(a), to, &out, (DWORD)c) ? out.QuadPart : win_error();
      break;
    }
    case 9: r = host_mmap((char *)a, (size_t)b, c, d, (int)e); break;
    case 10: r = host_mprotect((char *)a, (size_t)b, c); break;
    case 11: r = host_munmap((char *)a, (size_t)b); break;
    case 12: r = -L_ENOSYS; break;
    case 25: r = -L_ENOMEM; break;
    case 28: r = 0; break;
    case 13: case 14: case 131: case 273: r = 0; break;
    case 16: {
      DWORD mode;
      if (b == 0x5413 && fd_handle(a) && GetConsoleMode(fd_handle(a), &mode)) { unsigned short *w = (void *)c; w[0] = 24; w[1] = 80; w[2] = w[3] = 0; r = 0; }
      else r = -L_ENOTTY;
      break;
    }
    case 19: r = host_rwv(a, (struct l_iovec *)b, c, 0); break;
    case 20: r = host_rwv(a, (struct l_iovec *)b, c, 1); break;
    case 21: case 269: {
      wchar_t w[4096];
      const char *path = (const char *)(n == 21 ? a : b);
      r = to_wide(path, w, 4096) && GetFileAttributesW(w) != INVALID_FILE_ATTRIBUTES ? 0 : -L_ENOENT;
      break;
    }
    case 87: case 263: {
      wchar_t w[4096];
      const char *path = (const char *)(n == 87 ? a : b);
      r = to_wide(path, w, 4096) && DeleteFileW(w) ? 0 : win_error();
      break;
    }
    case 24: SwitchToThread(); r = 0; break;
    case 35: Sleep(to_ms((void *)a)); r = 0; break;
    case 230: Sleep(to_ms((void *)c)); r = 0; break;
    case 39: r = GetCurrentProcessId(); break;
    case 186: r = GetCurrentThreadId(); break;
    case 218: r = GetCurrentThreadId(); break;
    case 158:
      if (a == 0x1002) { TlsSetValue(tp_slot, (void *)b); r = 0; } else r = -L_EINVAL;
      break;
    case 202: r = host_futex((int *)a, b, (int)c, (void *)d); break;
    case 228: r = host_clock_gettime(a, (void *)b); break;
    case 318: r = SystemFunction036((void *)a, (ULONG)b) ? b : -L_EIO; break;
    case 60: leave_thread(0, 0); r = 0; break;
    case 231: fflush(0); ExitProcess((UINT)a); r = 0; break;
    case 200: case 234: fflush(0); ExitProcess(134); r = 0; break;
    default: r = -L_ENOSYS; break;
  }
  if (trace && (r == -L_ENOSYS || trace > 1)) fprintf(stderr, "[host] syscall %lld(%#llx, %#llx, %#llx) = %lld\n", n, a, b, c, r);
  return r;
}

/* ---- image loading and start ---- */
typedef struct { unsigned char ident[16]; uint16_t type, machine; uint32_t version; uint64_t entry, phoff, shoff; uint32_t flags; uint16_t ehsize, phentsize, phnum, shentsize, shnum, shstrndx; } Ehdr;
typedef struct { uint32_t type, flags; uint64_t offset, vaddr, paddr, filesz, memsz, align; } Phdr;

__attribute__((naked)) static void enter_image(void *entry, void *sp) {
  __asm__("mov %rdx, %rsp\n"
          "xor %ebp, %ebp\n"
          "xor %edx, %edx\n"
          "jmp *%rcx\n");
}

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
  if (tp_slot >= 64) { fprintf(stderr, "host: no low TLS slot\n"); return 2; }
  static struct bun_host host;
  host.os = 2;
  host.tcb_offset = 0x1480 + 8ull * tp_slot;
  host.syscall = host_syscall;
  host.thread_create = host_thread_create;
  host.thread_exit = host_thread_exit;

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
                    11, 0, 12, 0, 13, 0, 14, 0, 23, 0, 25, (uint64_t)(uintptr_t)random_bytes, AT_BUN_HOST, (uint64_t)(uintptr_t)&host, 0, 0};
  memcpy(v, aux, sizeof aux);

  if (trace) fprintf(stderr, "[host] image %ld bytes at %p, entry %p, thread slot offset %#llx\n", size, base, base + eh->entry, host.tcb_offset);
  fflush(0);
  set_stack_fields(stack + stack_size, stack, stack);
  enter_image(base + eh->entry, vec);
  return 0;
}
