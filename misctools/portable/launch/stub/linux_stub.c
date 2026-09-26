// Linux loader stub for a packed portable image (x86-64 and arm64).
//
//   stub <container> [args]
//
// The container is the one packed file (tools/pack.ts): a PE executable for
// Windows, a shell script for sh, with the ELF image inside it at a 64 KiB
// boundary and a BUNPACK1 table of contents in its last 128 bytes. The shell
// header of the container writes this stub into a per-user cache directory and
// execs it with the path of the container.
//
// The stub maps the image out of the container file by offset, builds the
// System V start stack, and jumps to the entry point. No host table arrives,
// so the image issues real Linux syscalls from then on.
//
// Freestanding, not linked against any libc: the stub has to run on any Linux
// machine, and the patched musl of the image is the libc of the image, not of
// the stub. It needs the start stack as the kernel hands it over, to pass the
// environment and the auxiliary vector on to the image. Syscalls are inline,
// the two memory functions below are the only "library" code.
#include <stdint.h>

typedef uint64_t u64;
typedef int64_t i64;

/* ---- syscalls ---- */
#if defined(__x86_64__)
enum { SYS_read = 0, SYS_write = 1, SYS_close = 3, SYS_lseek = 8, SYS_mmap = 9, SYS_pread64 = 17, SYS_exit_group = 231, SYS_openat = 257 };
static i64 sys6(i64 n, i64 a, i64 b, i64 c, i64 d, i64 e, i64 f) {
  i64 r;
  register i64 r10 __asm__("r10") = d, r8 __asm__("r8") = e, r9 __asm__("r9") = f;
  __asm__ __volatile__("syscall" : "=a"(r) : "a"(n), "D"(a), "S"(b), "d"(c), "r"(r10), "r"(r8), "r"(r9) : "rcx", "r11", "memory");
  return r;
}
__attribute__((naked)) static void enter_image(void *entry, void *sp) {
  __asm__("mov %rsi, %rsp\n xor %ebp, %ebp\n xor %edx, %edx\n jmp *%rdi\n");
}
__attribute__((naked)) void _start(void) {
  __asm__("xor %ebp, %ebp\n mov %rsp, %rdi\n and $-16, %rsp\n call stub_main\n hlt\n");
}
#elif defined(__aarch64__)
enum { SYS_read = 63, SYS_write = 64, SYS_close = 57, SYS_lseek = 62, SYS_mmap = 222, SYS_pread64 = 67, SYS_exit_group = 94, SYS_openat = 56 };
static i64 sys6(i64 n, i64 a, i64 b, i64 c, i64 d, i64 e, i64 f) {
  register i64 x8 __asm__("x8") = n, x0 __asm__("x0") = a, x1 __asm__("x1") = b, x2 __asm__("x2") = c;
  register i64 x3 __asm__("x3") = d, x4 __asm__("x4") = e, x5 __asm__("x5") = f;
  __asm__ __volatile__("svc #0" : "+r"(x0) : "r"(x1), "r"(x2), "r"(x3), "r"(x4), "r"(x5), "r"(x8) : "memory");
  return x0;
}
__attribute__((naked)) static void enter_image(void *entry, void *sp) {
  __asm__("mov sp, x1\n mov x29, #0\n mov x30, #0\n br x0\n");
}
__attribute__((naked)) void _start(void) {
  __asm__("mov x0, sp\n mov x29, #0\n b stub_main\n");
}
#else
#error "linux_stub.c: x86-64 or arm64"
#endif

#define O_RDONLY 0
#define O_CLOEXEC 0x80000
#define AT_FDCWD (-100)
#define PROT_READ 1
#define PROT_WRITE 2
#define PROT_EXEC 4
#define MAP_PRIVATE 2
#define MAP_FIXED 0x10
#define MAP_ANONYMOUS 0x20
#define MAP_FAILED ((void *)-1)

static i64 sys_write(int fd, const void *buf, u64 n) { return sys6(SYS_write, fd, (i64)(uintptr_t)buf, (i64)n, 0, 0, 0); }
static i64 sys_pread(int fd, void *buf, u64 n, u64 at) { return sys6(SYS_pread64, fd, (i64)(uintptr_t)buf, (i64)n, (i64)at, 0, 0); }
static void *sys_mmap(void *addr, u64 len, int prot, int flags, int fd, u64 off) {
  return (void *)sys6(SYS_mmap, (i64)(uintptr_t)addr, (i64)len, prot, flags, fd, (i64)off);
}

void *memcpy(void *to, const void *from, u64 n) {
  char *d = to;
  const char *s = from;
  for (u64 i = 0; i < n; i++) d[i] = s[i];
  return to;
}
void *memset(void *to, int c, u64 n) {
  char *d = to;
  for (u64 i = 0; i < n; i++) d[i] = (char)c;
  return to;
}

/* ---- messages, no libc ---- */
static u64 str_len(const char *s) {
  u64 n = 0;
  while (s[n]) n++;
  return n;
}
/* say("a", "b", 0): one write to stderr, so that concurrent starts do not interleave. */
static void say(const char *first, ...) {
  char line[512];
  u64 at = 0;
  __builtin_va_list ap;
  __builtin_va_start(ap, first);
  for (const char *s = first; s; s = __builtin_va_arg(ap, const char *)) {
    u64 n = str_len(s);
    if (n > sizeof line - at - 1) n = sizeof line - at - 1;
    memcpy(line + at, s, n);
    at += n;
  }
  __builtin_va_end(ap);
  line[at++] = '\n';
  sys_write(2, line, at);
}
static const char *hex(u64 v, char out[19]) {
  out[0] = '0';
  out[1] = 'x';
  int n = 1;
  for (u64 t = v; t >= 16; t >>= 4) n++;
  out[2 + n] = 0;
  for (int i = n; i >= 0; i--, v >>= 4) out[2 + i] = "0123456789abcdef"[v & 15];
  return out;
}
__attribute__((noreturn)) static void fail(const char *a, const char *b, const char *c) {
  say("bun-portable: ", a, b, c, 0);
  sys6(SYS_exit_group, 127, 0, 0, 0, 0, 0);
  __builtin_unreachable();
}

/* ---- the container and the image ---- */
#define TOC_SIZE 128
#define TOC_MAGIC 0x314b4341504e5542ull /* "BUNPACK1" */
struct toc {
  u64 magic;
  uint32_t version, toc_size;
  u64 file_size, arch, header_size, image_off, image_len;
  u64 code_off, code_len, sig_off, sig_len;
  u64 stub_linux_off, stub_linux_len, stub_macos_off, stub_macos_len;
  u64 magic_end;
};

typedef struct {
  unsigned char ident[16];
  uint16_t type, machine;
  uint32_t version;
  u64 entry, phoff, shoff;
  uint32_t flags;
  uint16_t ehsize, phentsize, phnum, shentsize, shnum, shstrndx;
} Ehdr;
typedef struct {
  uint32_t type, flags;
  u64 offset, vaddr, paddr, filesz, memsz, align;
} Phdr;
#if defined(__x86_64__)
#define IMAGE_MACHINE 62
#define IMAGE_MACHINE_NAME "x86-64"
#else
#define IMAGE_MACHINE 183
#define IMAGE_MACHINE_NAME "arm64"
#endif

enum { AT_NULL = 0, AT_PHDR = 3, AT_PHENT = 4, AT_PHNUM = 5, AT_PAGESZ = 6, AT_BASE = 7, AT_ENTRY = 9, AT_EXECFN = 31 };

/* The image is mapped from the file, never copied: every process that runs the
   same container shares its code and read-only pages. Writable segments are
   private file pages (copy on write), the way the kernel loads an ELF file. */
void stub_main(u64 *stack) {
  i64 argc = (i64)stack[0];
  char **argv = (char **)(stack + 1);
  char **envp = argv + argc + 1;
  u64 *auxv;
  {
    char **e = envp;
    while (*e) e++;
    auxv = (u64 *)(e + 1);
  }
  if (argc < 2) fail("usage: ", argv[0], " <container> [args]");
  const char *path = argv[1];

  u64 page = 4096;
  for (u64 *a = auxv; a[0]; a += 2)
    if (a[0] == AT_PAGESZ && a[1]) page = a[1];

  int fd = (int)sys6(SYS_openat, AT_FDCWD, (i64)(uintptr_t)path, O_RDONLY | O_CLOEXEC, 0, 0, 0);
  if (fd < 0) fail("cannot open ", path, "");

  /* The table of contents is the last TOC_SIZE bytes of the container. */
  struct toc toc;
  i64 size = sys6(SYS_lseek, fd, 0, 2 /* SEEK_END */, 0, 0, 0);
  if (size < TOC_SIZE || sys_pread(fd, &toc, sizeof toc, (u64)size - TOC_SIZE) != sizeof toc ||
      toc.magic != TOC_MAGIC || toc.magic_end != TOC_MAGIC)
    fail(path, " has no table of contents: it is not a packed portable image", "");
  if (toc.arch != IMAGE_MACHINE) {
    char n[19];
    fail(path, " holds an image for another processor, this stub runs " IMAGE_MACHINE_NAME ", ELF machine ", hex(toc.arch, n));
  }

  /* ELF header and program headers of the image. */
  union {
    Ehdr eh;
    char bytes[4096];
  } head;
  if (sys_pread(fd, head.bytes, sizeof head.bytes, toc.image_off) < 64) fail("cannot read the image in ", path, "");
  Ehdr *eh = &head.eh;
  if (eh->ident[0] != 0x7f || eh->ident[1] != 'E' || eh->ident[2] != 'L' || eh->ident[3] != 'F' || eh->machine != IMAGE_MACHINE)
    fail("the image in ", path, " is not an ELF file for this processor");
  if (eh->phoff + (u64)eh->phnum * eh->phentsize > sizeof head.bytes) fail("the program headers of the image in ", path, " are too far in");
  Phdr *ph = (Phdr *)(head.bytes + eh->phoff);

  u64 top = 0;
  for (int i = 0; i < eh->phnum; i++)
    if (ph[i].type == 1 && ph[i].vaddr + ph[i].memsz > top) top = ph[i].vaddr + ph[i].memsz;
  top = (top + page - 1) & ~(page - 1);
  char *base = sys_mmap(0, top, 0 /* PROT_NONE */, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if ((u64)(uintptr_t)base > (u64)-4096) fail("cannot reserve ", path, " image space");

  for (int i = 0; i < eh->phnum; i++) {
    if (ph[i].type != 1) continue;
    u64 off = toc.image_off + ph[i].offset;
    if ((ph[i].vaddr | off) & (page - 1)) fail("a segment of the image in ", path, " is not aligned to the page of this machine");
    int prot = (ph[i].flags & 4 ? PROT_READ : 0) | (ph[i].flags & 2 ? PROT_WRITE : 0) | (ph[i].flags & 1 ? PROT_EXEC : 0);
    u64 file_end = (ph[i].filesz + page - 1) & ~(page - 1);
    if (ph[i].filesz) {
      void *p = sys_mmap(base + ph[i].vaddr, file_end, prot, MAP_PRIVATE | MAP_FIXED, fd, off);
      if (p == MAP_FAILED || p != base + ph[i].vaddr) fail("cannot map a segment of the image in ", path, "");
      /* The bytes after the segment data in its last page belong to other
         parts of the container: zero them, as the kernel does. */
      if ((ph[i].flags & 2) && ph[i].memsz > ph[i].filesz) memset(base + ph[i].vaddr + ph[i].filesz, 0, file_end - ph[i].filesz);
    }
    u64 mem_end = (ph[i].memsz + page - 1) & ~(page - 1);
    if (mem_end > file_end) {
      void *p = sys_mmap(base + ph[i].vaddr + file_end, mem_end - file_end, prot, MAP_PRIVATE | MAP_FIXED | MAP_ANONYMOUS, -1, 0);
      if (p == MAP_FAILED) fail("cannot map the zero part of a segment of the image in ", path, "");
    }
  }
  sys6(SYS_close, fd, 0, 0, 0, 0, 0);

  /* The start stack of the image: argv[0] is the container, then its own
     arguments. The environment strings and the auxiliary vector of this
     process are passed on as they are, with the entries that name the image
     replaced. No AT_BUN_HOST: the image talks to the kernel. */
  u64 env_count = 0, aux_count = 0;
  for (char **e = envp; *e; e++) env_count++;
  for (u64 *a = auxv; a[0]; a += 2) aux_count++;
  u64 words = 1 + (u64)argc /* argv without argv[0], and its NULL */ + env_count + 1 + 2 * (aux_count + 6 + 1);
  u64 *vec = __builtin_alloca(words * 8 + 16);
  vec = (u64 *)(((uintptr_t)vec + 15) & ~(uintptr_t)15);
  u64 *v = vec;
  *v++ = (u64)(argc - 1);
  for (i64 i = 1; i < argc; i++) *v++ = (u64)(uintptr_t)argv[i];
  *v++ = 0;
  for (char **e = envp; *e; e++) *v++ = (u64)(uintptr_t)*e;
  *v++ = 0;
  for (u64 *a = auxv; a[0]; a += 2) {
    switch (a[0]) {
      case AT_PHDR: case AT_PHENT: case AT_PHNUM: case AT_BASE: case AT_ENTRY: case AT_EXECFN: continue;
      default: break;
    }
    *v++ = a[0];
    *v++ = a[1];
  }
  *v++ = AT_PHDR;  *v++ = (u64)(uintptr_t)(base + eh->phoff);
  *v++ = AT_PHENT; *v++ = eh->phentsize;
  *v++ = AT_PHNUM; *v++ = eh->phnum;
  *v++ = AT_BASE;  *v++ = 0;
  *v++ = AT_ENTRY; *v++ = (u64)(uintptr_t)(base + eh->entry);
  *v++ = AT_EXECFN; *v++ = (u64)(uintptr_t)path;
  *v++ = AT_NULL;  *v++ = 0;

  enter_image(base + eh->entry, vec);
  fail("the image in ", path, " did not start");
}
