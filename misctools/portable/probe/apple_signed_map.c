// Can a region of a non-Mach-O file be mapped executable, file-backed, on
// Apple Silicon? Each probe runs in a forked child because a code-signing
// violation kills the process.
//
//   sigmap build <container> <code MiB>      write the test container
//   sigmap run   <container> [slice.dylib]   run the probes (macOS only)
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <unistd.h>

#define PREFIX_SIZE 0x10000u  /* junk before the code, starts with MZ */
#define SIG_PAGE 4096u
#define MARKER 0x45424f52504e5542ull /* "BUNPROBE" */

/* ---- SHA-256 ---- */
typedef struct { uint32_t h[8]; uint64_t n; uint8_t buf[64]; size_t fill; } Sha;
static const uint32_t K[64] = {
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
#define ROR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))
static void sha_block(Sha *s, const uint8_t *p) {
  uint32_t w[64], a[8];
  for (int i = 0; i < 16; i++) w[i] = (uint32_t)p[4 * i] << 24 | (uint32_t)p[4 * i + 1] << 16 | (uint32_t)p[4 * i + 2] << 8 | p[4 * i + 3];
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = ROR(w[i - 15], 7) ^ ROR(w[i - 15], 18) ^ (w[i - 15] >> 3), s1 = ROR(w[i - 2], 17) ^ ROR(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  memcpy(a, s->h, sizeof a);
  for (int i = 0; i < 64; i++) {
    uint32_t t1 = a[7] + (ROR(a[4], 6) ^ ROR(a[4], 11) ^ ROR(a[4], 25)) + ((a[4] & a[5]) ^ (~a[4] & a[6])) + K[i] + w[i];
    uint32_t t2 = (ROR(a[0], 2) ^ ROR(a[0], 13) ^ ROR(a[0], 22)) + ((a[0] & a[1]) ^ (a[0] & a[2]) ^ (a[1] & a[2]));
    memmove(a + 1, a, 7 * sizeof a[0]);
    a[4] += t1;
    a[0] = t1 + t2;
  }
  for (int i = 0; i < 8; i++) s->h[i] += a[i];
}
static void sha256(const uint8_t *p, size_t n, uint8_t out[32]) {
  Sha s = {{0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19}, 0, {0}, 0};
  size_t full = n / 64;
  for (size_t i = 0; i < full; i++) sha_block(&s, p + 64 * i);
  uint8_t tail[128] = {0};
  size_t rest = n - 64 * full, len = rest < 56 ? 64 : 128;
  memcpy(tail, p + 64 * full, rest);
  tail[rest] = 0x80;
  uint64_t bits = (uint64_t)n * 8;
  for (int i = 0; i < 8; i++) tail[len - 1 - i] = (uint8_t)(bits >> (8 * i));
  sha_block(&s, tail);
  if (len == 128) sha_block(&s, tail + 64);
  for (int i = 0; i < 8; i++) { out[4 * i] = s.h[i] >> 24; out[4 * i + 1] = s.h[i] >> 16; out[4 * i + 2] = s.h[i] >> 8; out[4 * i + 3] = s.h[i]; }
}

static void be32(uint8_t *p, uint32_t v) { p[0] = v >> 24; p[1] = v >> 16; p[2] = v >> 8; p[3] = v; }
static void be64(uint8_t *p, uint64_t v) { be32(p, v >> 32); be32(p + 4, (uint32_t)v); }

/* Ad-hoc signature (SuperBlob with one CodeDirectory) over `code`. */
static uint8_t *build_signature(const uint8_t *code, size_t code_len, size_t *out_len) {
  static const char ident[] = "bun.portable.image";
  uint32_t slots = (uint32_t)((code_len + SIG_PAGE - 1) / SIG_PAGE);
  uint32_t ident_off = 88, hash_off = ident_off + sizeof ident;
  uint32_t cd_len = hash_off + slots * 32, total = 20 + cd_len;
  uint8_t *b = calloc(1, total), *cd = b + 20;
  be32(b, 0xfade0cc0); be32(b + 4, total); be32(b + 8, 1); be32(b + 12, 0); be32(b + 16, 20);
  be32(cd, 0xfade0c02); be32(cd + 4, cd_len); be32(cd + 8, 0x20400); be32(cd + 12, 0x20002);
  be32(cd + 16, hash_off); be32(cd + 20, ident_off); be32(cd + 24, 0); be32(cd + 28, slots);
  be32(cd + 32, (uint32_t)code_len);
  cd[36] = 32; cd[37] = 2; cd[38] = 0; cd[39] = 12;
  be64(cd + 64, 0); be64(cd + 72, code_len); be64(cd + 80, 0);
  memcpy(cd + ident_off, ident, sizeof ident);
  for (uint32_t i = 0; i < slots; i++) {
    size_t at = (size_t)i * SIG_PAGE, n = code_len - at < SIG_PAGE ? code_len - at : SIG_PAGE;
    sha256(code + at, n, cd + hash_off + 32 * i);
  }
  *out_len = total;
  return b;
}

static void put_probe(uint8_t *at) {
  uint64_t m = MARKER;
  memcpy(at, &m, 8);
#if defined(__x86_64__)
  static const uint8_t fn[] = {0xb8, 42, 0, 0, 0, 0xc3};
#else
  static const uint8_t fn[] = {0x40, 0x05, 0x80, 0x52, 0xc0, 0x03, 0x5f, 0xd6}; /* mov w0,#42 ; ret */
#endif
  memcpy(at + 8, fn, sizeof fn);
}

/* Trailer at the end of the container: code_off, code_len, sig_off, sig_len. */
static int build(const char *path, size_t code_mib) {
  size_t code_len = code_mib << 20, sig_len;
  uint8_t *code = malloc(code_len);
  uint32_t x = 0x12345678;
  for (size_t i = 0; i < code_len; i += 4) { x = x * 1664525u + 1013904223u; memcpy(code + i, &x, 4); }
  for (size_t at = 0; at < code_len; at += 0x4000) put_probe(code + at);
  uint8_t *sig = build_signature(code, code_len, &sig_len);
  uint8_t *prefix = calloc(1, PREFIX_SIZE);
  memcpy(prefix, "MZqFpD='\n", 9);
  uint64_t trailer[4] = {PREFIX_SIZE, code_len, PREFIX_SIZE + code_len, sig_len};
  FILE *f = fopen(path, "wb");
  if (!f) { perror(path); return 1; }
  fwrite(prefix, 1, PREFIX_SIZE, f);
  fwrite(code, 1, code_len, f);
  fwrite(sig, 1, sig_len, f);
  fwrite(trailer, 1, sizeof trailer, f);
  fclose(f);
  printf("built %s: code at %#x, %zu bytes, signature %zu bytes\n", path, PREFIX_SIZE, code_len, sig_len);
  return 0;
}

#ifdef __APPLE__
#include <libkern/OSCacheControl.h>
#include <pthread.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/wait.h>

static double now_ms(void) { struct timeval t; gettimeofday(&t, 0); return t.tv_sec * 1e3 + t.tv_usec / 1e3; }
typedef int (*Probe)(void);
static int call_all(uint8_t *base, size_t len) {
  int sum = 0;
  for (size_t at = 0; at < len; at += 0x4000) {
    uint64_t m;
    memcpy(&m, base + at, 8);
    if (m != MARKER) return -1;
    sum += ((Probe)(base + at + 8))();
  }
  return sum;
}

static uint64_t T[4];
static const char *container;

static int probe_unsigned_file_map(void) {
  int fd = open(container, O_RDONLY);
  uint8_t *p = mmap(0, T[1], PROT_READ | PROT_EXEC, MAP_PRIVATE, fd, T[0]);
  if (p == MAP_FAILED) { printf("mmap failed errno=%d (%s)\n", errno, strerror(errno)); return 3; }
  printf("mmap ok, calling... "); fflush(stdout);
  printf("sum=%d\n", call_all(p, T[1]));
  return 0;
}
static int probe_copy_mprotect(void) {
  int fd = open(container, O_RDONLY);
  double a = now_ms();
  uint8_t *p = mmap(0, T[1], PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
  if (p == MAP_FAILED || pread(fd, p, T[1], T[0]) != (ssize_t)T[1]) { printf("copy failed errno=%d\n", errno); return 3; }
  if (mprotect(p, T[1], PROT_READ | PROT_EXEC)) { printf("mprotect(RX) failed errno=%d (%s)\n", errno, strerror(errno)); return 4; }
  sys_icache_invalidate(p, T[1]);
  double b = now_ms();
  printf("load %.1f ms, calling... ", b - a); fflush(stdout);
  printf("sum=%d, first call pass %.1f ms\n", call_all(p, T[1]), now_ms() - b);
  return 0;
}
static int probe_copy_map_jit(void) {
  int fd = open(container, O_RDONLY);
  double a = now_ms();
  uint8_t *p = mmap(0, T[1], PROT_READ | PROT_WRITE | PROT_EXEC, MAP_PRIVATE | MAP_ANON | MAP_JIT, -1, 0);
  if (p == MAP_FAILED) { printf("mmap(MAP_JIT) failed errno=%d (%s)\n", errno, strerror(errno)); return 3; }
#if defined(__aarch64__)
  pthread_jit_write_protect_np(0);
#endif
  if (pread(fd, p, T[1], T[0]) != (ssize_t)T[1]) { printf("pread failed errno=%d\n", errno); return 3; }
#if defined(__aarch64__)
  pthread_jit_write_protect_np(1);
#endif
  sys_icache_invalidate(p, T[1]);
  double b = now_ms();
  printf("load %.1f ms, calling... ", b - a); fflush(stdout);
  printf("sum=%d, first call pass %.1f ms\n", call_all(p, T[1]), now_ms() - b);
  return 0;
}
static int signed_map(const char *path, uint64_t slice, uint64_t blob_rel, uint64_t blob_len, uint64_t map_off, uint64_t map_len) {
  int fd = open(path, O_RDONLY);
  double a = now_ms();
  fsignatures_t fs = {(off_t)slice, (void *)(uintptr_t)blob_rel, (size_t)blob_len};
  if (fcntl(fd, F_ADDFILESIGS_RETURN, &fs) == -1) { printf("F_ADDFILESIGS_RETURN failed errno=%d (%s)\n", errno, strerror(errno)); return 3; }
  uint64_t covered = (uint64_t)fs.fs_file_start;
  uint8_t *p = mmap(0, map_len, PROT_READ | PROT_EXEC, MAP_PRIVATE, fd, map_off);
  if (p == MAP_FAILED) { printf("signature accepted (covers to %#llx), mmap failed errno=%d (%s)\n", (unsigned long long)covered, errno, strerror(errno)); return 4; }
  double b = now_ms();
  printf("signature accepted (covers to %#llx), map %.2f ms, calling... ", (unsigned long long)covered, b - a); fflush(stdout);
  int sum = -1;
  for (size_t at = 0; at + 16 <= map_len; at += 8) {
    uint64_t m;
    memcpy(&m, p + at, 8);
    if (m == MARKER) { sum = at % 0x4000 == 0 && map_len > 0x8000 && path == container ? call_all(p, map_len) : ((Probe)(p + at + 8))(); break; }
  }
  printf("sum=%d, first call pass %.1f ms\n", sum, now_ms() - b);
  return 0;
}
static int probe_signed_file_map(void) { return signed_map(container, T[0], T[2] - T[0], T[3], T[0], T[1]); }

static const char *dylib_container;
static uint64_t D[4]; /* slice offset, sig dataoff, sig size, text filesize */
static int probe_signed_dylib_slice(void) { return signed_map(dylib_container, D[0], D[1], D[2], D[0], D[3]); }

static void run(const char *name, int (*fn)(void)) {
  printf("%-34s ", name); fflush(stdout);
  pid_t pid = fork();
  if (!pid) { int rc = fn(); fflush(stdout); _exit(rc); }
  int st;
  waitpid(pid, &st, 0);
  if (WIFSIGNALED(st)) printf("-> KILLED by signal %d (%s)\n", WTERMSIG(st), strsignal(WTERMSIG(st)));
  else if (WEXITSTATUS(st)) printf("   [exit %d]\n", WEXITSTATUS(st));
}

static int prepare_dylib_container(const char *dylib, const char *out) {
  FILE *f = fopen(dylib, "rb");
  if (!f) return -1;
  fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
  uint8_t *d = malloc(n);
  fread(d, 1, n, f); fclose(f);
  uint32_t ncmds; memcpy(&ncmds, d + 16, 4);
  size_t off = 32;
  for (uint32_t i = 0; i < ncmds; i++) {
    uint32_t cmd, size; memcpy(&cmd, d + off, 4); memcpy(&size, d + off + 4, 4);
    if (cmd == 0x19 && !strcmp((char *)d + off + 8, "__TEXT")) memcpy(&D[3], d + off + 48, 8);
    if (cmd == 0x1d) { uint32_t a, b; memcpy(&a, d + off + 8, 4); memcpy(&b, d + off + 12, 4); D[1] = a; D[2] = b; }
    off += size;
  }
  D[0] = PREFIX_SIZE;
  uint8_t *prefix = calloc(1, PREFIX_SIZE);
  memcpy(prefix, "MZqFpD='\n", 9);
  f = fopen(out, "wb");
  fwrite(prefix, 1, PREFIX_SIZE, f); fwrite(d, 1, n, f); fclose(f);
  return D[2] ? 0 : -1;
}

static int run_all(const char *path, const char *dylib) {
  container = path;
  int fd = open(path, O_RDONLY);
  struct stat st; fstat(fd, &st);
  pread(fd, T, sizeof T, st.st_size - sizeof T);
  printf("container %s: code %llu MiB at %#llx, page size %d\n", path, (unsigned long long)(T[1] >> 20), (unsigned long long)T[0], getpagesize());
  run("1 unsigned file map, exec", probe_unsigned_file_map);
  run("2 copy to anon, mprotect RX", probe_copy_mprotect);
  run("3 copy to MAP_JIT memory", probe_copy_map_jit);
  run("4 own signature, file map, exec", probe_signed_file_map);
  run("4 again (signature now cached)", probe_signed_file_map);
  if (dylib) {
    static char out[1024];
    snprintf(out, sizeof out, "%s.slice", path);
    dylib_container = out;
    if (!prepare_dylib_container(dylib, out)) run("5 ld-signed dylib as slice", probe_signed_dylib_slice);
    else printf("5 skipped: could not read %s\n", dylib);
    unlink(out);
  }
  return 0;
}
#endif

int main(int argc, char **argv) {
  if (argc >= 4 && !strcmp(argv[1], "build")) return build(argv[2], strtoul(argv[3], 0, 10));
#ifdef __APPLE__
  if (argc >= 3 && !strcmp(argv[1], "run")) return run_all(argv[2], argc > 3 ? argv[3] : 0);
#endif
  fprintf(stderr, "usage: sigmap build <container> <code MiB> | sigmap run <container> [dylib]\n");
  return 2;
}
