// Test program for the portable image: memory that no code has touched yet, handed to the system by the
// image ITSELF.
//
// bun's code for Windows calls the functions of Windows directly, through the addresses that lookup() of
// the host table gives it, so the host does not see what memory they are handed. On Windows a page is
// usable after it was committed, and a system call does not run the fault handler of the host, which
// commits a page of a lazy mapping at its first touch: ReadFile into such a page fails with
// ERROR_NOACCESS (998). The host says how its memory behaves (AT_BUN_HOST_MEMORY, host/linux_abi.h), and
// an allocator that reads the entry hands out memory that it has committed. This image is linked with
// the allocator of the image, mimalloc.
//
//   commit.img <a file of at least 64 KiB>
//
// The system call that writes into the memory:
//   ReadFile    a Windows host: kernel32, from lookup()
//   test_fill   the Linux test host: a function of its library "bun_host_test". The host has the kernel
//               write into the buffer and touches nothing before. With BUN_HOST_TEST=winmem a page that
//               is not committed has no access there, and the kernel answers EFAULT (14)
//   pread       no host, and the macOS host
//
// One line for each case: "<name>: ok=<0|1> error=<n>". n is the error of the system, -1 when the system
// wrote fewer bytes than asked for, -2 when the bytes in the buffer are not the ones it wrote. The cases
// that map with MAP_NORESERVE and a protection that allows access, and hand over a page that nothing
// touches, are reported and not counted: that is the mapping that a host which commits cannot serve.
// The last line is "commit: failures=<n> reported=<n>". Exit code 42 when every counted case was ok, 43
// when one was not.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/auxv.h>
#include <sys/mman.h>
#include <unistd.h>

#define AT_BUN_HOST_MEMORY 0x62756e11
#define BUN_OS_WINDOWS 2

unsigned long __bun_host_os(void);
void *__bun_host_lookup(const char *library, const char *symbol);

void *mi_malloc(size_t size);
void *mi_zalloc(size_t size);
void *mi_realloc(void *p, size_t size);
void mi_free(void *p);
void mi_collect(bool force);

// What the host OS is called with has the calling convention of Windows, which arm64 shares with the image.
#if defined(__x86_64__)
#define WIN64 __attribute__((ms_abi))
#else
#define WIN64
#endif

typedef void *HANDLE;
typedef WIN64 int ReadFileFn(HANDLE, void *, uint32_t, uint32_t *, void *);
typedef WIN64 HANDLE CreateFileWFn(const uint16_t *, uint32_t, uint32_t, void *, uint32_t, uint32_t, HANDLE);
typedef WIN64 uint32_t GetLastErrorFn(void);
typedef WIN64 int SetFilePointerExFn(HANDLE, int64_t, int64_t *, uint32_t);
typedef WIN64 long long TestFillFn(void *buffer, long long bytes);

enum { MIB = 1 << 20, PAGE = 4096, LENGTH = 16384, COUNTED = 1, REPORTED = 0 };
enum { FEWER_BYTES = -1, OTHER_BYTES = -2 };

static ReadFileFn *ReadFile;
static GetLastErrorFn *GetLastError;
static SetFilePointerExFn *SetFilePointerEx;
static TestFillFn *test_fill;
static HANDLE handle;
static int fd = -1;
// The first LENGTH bytes of the file, read into memory that is written before.
static unsigned char expected[LENGTH];
static int failures, reported;

// The system writes LENGTH bytes to `buffer`. 0, or the error.
static long request(void *buffer) {
  if (ReadFile) {
    uint32_t got = 0;
    SetFilePointerEx(handle, 0, 0, 0);
    if (!ReadFile(handle, buffer, LENGTH, &got, 0)) return GetLastError();
    return got == LENGTH ? 0 : FEWER_BYTES;
  }
  if (test_fill) {
    long long got = test_fill(buffer, LENGTH);
    return got == LENGTH ? 0 : got < 0 ? (long)-got : FEWER_BYTES;
  }
  ssize_t got = pread(fd, buffer, LENGTH, 0);
  return got == LENGTH ? 0 : got < 0 ? errno : FEWER_BYTES;
}

// What the system wrote is in the buffer: the bytes of the file, or random bytes, which are not all zero.
static int arrived(const unsigned char *buffer) {
  if (!test_fill) return !memcmp(buffer, expected, LENGTH);
  for (int i = 0; i < LENGTH; i++)
    if (buffer[i]) return 1;
  return 0;
}

static long fill(void *buffer) {
  long error = request(buffer);
  return error ? error : arrived(buffer) ? 0 : OTHER_BYTES;
}

static void fill_case(const char *name, void *buffer, int counted) {
  long error = fill(buffer);
  printf("%s: ok=%d error=%ld%s\n", name, !error, error, counted ? "" : " (not counted)");
  if (error) {
    if (counted) failures++;
    else reported++;
  }
}

static void check(const char *name, int ok) {
  printf("%s: ok=%d\n", name, ok);
  if (!ok) failures++;
}

static char *map(int protection, int flags) {
  void *p = mmap(0, 8 * MIB, protection, MAP_PRIVATE | MAP_ANONYMOUS | flags, -1, 0);
  if (p == MAP_FAILED) {
    printf("mmap failed: errno %d\n", errno);
    exit(44);
  }
  return p;
}

static int is_zero(const char *p, size_t bytes) {
  for (size_t i = 0; i < bytes; i++)
    if (p[i]) return 0;
  return 1;
}

// The file for ReadFile. 0, or the exit code.
static int open_on_windows(const char *path) {
  CreateFileWFn *CreateFileW = (CreateFileWFn *)__bun_host_lookup("kernel32", "CreateFileW");
  ReadFile = (ReadFileFn *)__bun_host_lookup("kernel32", "ReadFile");
  GetLastError = (GetLastErrorFn *)__bun_host_lookup("kernel32", "GetLastError");
  SetFilePointerEx = (SetFilePointerExFn *)__bun_host_lookup("kernel32", "SetFilePointerEx");
  if (!CreateFileW || !ReadFile || !GetLastError || !SetFilePointerEx) {
    printf("commit: kernel32 does not have the functions\n");
    return 45;
  }
  static uint16_t wide[1024];
  size_t n = strlen(path);
  if (n >= 1023) return 2;
  for (size_t i = 0; i <= n; i++) wide[i] = (unsigned char)path[i];
  // GENERIC_READ, FILE_SHARE_READ, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL
  handle = CreateFileW(wide, 0x80000000u, 1, 0, 3, 0x80, 0);
  if (handle == (HANDLE)-1) {
    printf("commit: CreateFileW failed: %u\n", GetLastError());
    return 46;
  }
  return 0;
}

int main(int argc, char **argv) {
  setvbuf(stdout, 0, _IOLBF, 0);
  const char *call = "pread";
  if (__bun_host_os() == BUN_OS_WINDOWS) {
    if (argc < 2) return 2;
    int code = open_on_windows(argv[1]);
    if (code) return code;
    call = "ReadFile";
  } else {
    test_fill = (TestFillFn *)__bun_host_lookup("bun_host_test", "test_fill");
    if (test_fill) call = "test_fill";
    else {
      if (argc < 2) return 2;
      fd = open(argv[1], O_RDONLY);
      if (fd < 0) {
        printf("commit: open failed: errno %d\n", errno);
        return 46;
      }
    }
  }
  printf("commit: os=%lu memory=%lu call=%s\n", __bun_host_os(), getauxval(AT_BUN_HOST_MEMORY), call);
  memset(expected, 1, sizeof expected);
  long error = request(expected);
  if (error) {
    printf("commit: the system call fails into memory that is written: error %ld\n", error);
    return 47;
  }

  // Mapped with MAP_NORESERVE and a protection that allows access.
  char *lazy = map(PROT_READ | PROT_WRITE, MAP_NORESERVE);
  fill_case("noreserve, never touched", lazy + 3 * MIB, REPORTED);
  lazy[5 * MIB] = 1;
  fill_case("noreserve, touched before", lazy + 5 * MIB, COUNTED);
  madvise(lazy + 5 * MIB, MIB, MADV_DONTNEED);
  fill_case("noreserve, touched, then MADV_DONTNEED", lazy + 5 * MIB, REPORTED);

  // Mapped without MAP_NORESERVE.
  char *plain = map(PROT_READ | PROT_WRITE, 0);
  fill_case("plain, never touched", plain + 3 * MIB, COUNTED);
  plain[5 * MIB] = 1;
  madvise(plain + 5 * MIB, MIB, MADV_DONTNEED);
  fill_case("plain, touched, then MADV_DONTNEED", plain + 5 * MIB, COUNTED);

  // Reserved with PROT_NONE, made accessible by mprotect: what an allocator does that commits. Its
  // decommit is mprotect(PROT_NONE), then MADV_DONTNEED: the page that was written reads as zero after it.
  char *reserved = map(PROT_NONE, 0);
  mprotect(reserved + 2 * MIB, MIB, PROT_READ | PROT_WRITE);
  fill_case("PROT_NONE, then mprotect", reserved + 2 * MIB + PAGE, COUNTED);
  reserved[2 * MIB] = 1;
  mprotect(reserved + 2 * MIB, MIB, PROT_NONE);
  madvise(reserved + 2 * MIB, MIB, MADV_DONTNEED);
  mprotect(reserved + 2 * MIB, MIB, PROT_READ | PROT_WRITE);
  fill_case("PROT_NONE, mprotect, PROT_NONE + MADV_DONTNEED, mprotect", reserved + 2 * MIB + PAGE, COUNTED);
  check("the page that was written before reads as zero", is_zero(reserved + 2 * MIB, PAGE));
  char *reserved_lazy = map(PROT_NONE, MAP_NORESERVE);
  mprotect(reserved_lazy + 2 * MIB, MIB, PROT_READ | PROT_WRITE);
  fill_case("PROT_NONE + noreserve, then mprotect", reserved_lazy + 2 * MIB + PAGE, COUNTED);

  // The allocator of the image.
  char *block = mi_malloc(8 * MIB);
  fill_case("mi_malloc of 8 MiB, never touched", block + 3 * MIB, COUNTED);
  char *small = mi_malloc(64 * 1024);
  fill_case("mi_malloc of 64 KiB, never touched", small + LENGTH, COUNTED);
  memset(block, 1, 8 * MIB);
  mi_free(block);
  mi_collect(true);
  block = mi_malloc(8 * MIB);
  fill_case("mi_malloc of 8 MiB after free and mi_collect", block + 3 * MIB, COUNTED);
  block = mi_realloc(block, 24 * MIB);
  fill_case("mi_realloc to 24 MiB, the new part", block + 20 * MIB, COUNTED);
  mi_free(block);
  mi_free(small);

  char *zeroed = mi_zalloc(8 * MIB);
  int zero = 1;
  for (size_t i = 0; i < 8 * MIB; i += PAGE) zero &= zeroed[i] == 0;
  check("mi_zalloc of 8 MiB reads as zero", zero);
  mi_free(zeroed);

  // Blocks of many sizes, so that the allocator takes pages that it has not used before, three rounds
  // with everything freed and collected in between.
  static char *blocks[512];
  for (int round = 0; round < 3; round++) {
    int failed = 0, count = 0, fills = 0;
    for (size_t size = 32 * 1024; size <= 4 * MIB; size *= 2) {
      for (int i = 0; i < 24 && count < 512; i++, count++) {
        char *p = blocks[count] = mi_malloc(size);
        failed += !!fill(p + size - LENGTH);
        failed += !!fill(p + (size / 2 & ~(size_t)(PAGE - 1)));
        fills += 2;
      }
    }
    printf("round %d: %d blocks of 32 KiB to 4 MiB, never touched, %d system calls: ok=%d failed=%d\n", round, count,
           fills, !failed, failed);
    if (failed) failures++;
    for (int i = 0; i < count; i++) {
      memset(blocks[i], round + 1, PAGE);
      mi_free(blocks[i]);
    }
    mi_collect(true);
  }

  printf("commit: failures=%d reported=%d\n", failures, reported);
  return failures ? 43 : 42;
}
