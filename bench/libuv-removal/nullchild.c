// Minimal benchmark child for spawn benchmarks (Windows).
// - No args: exit 0 immediately (cheapest possible child).
// - argv[1] = N: write N bytes of 'x' to stdout in 64KiB chunks, then exit 0.
// Build (done automatically by the bench scripts if missing):
//   clang -O2 nullchild.c -o nullchild.exe
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char** argv) {
  if (argc > 1) {
    long long n = atoll(argv[1]);
    static char chunk[65536];
    memset(chunk, 'x', sizeof(chunk));
    while (n > 0) {
      size_t want = n > (long long)sizeof(chunk) ? sizeof(chunk) : (size_t)n;
      size_t wrote = fwrite(chunk, 1, want, stdout);
      if (wrote == 0) return 1;
      n -= (long long)wrote;
    }
    fflush(stdout);
  }
  return 0;
}
