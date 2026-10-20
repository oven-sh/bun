// Reads a `qemu-x86_64 -one-insn-per-tb -d exec,nochain` trace on stdin.
// Counts the instructions that a thread runs from the entry of a function to the return to its caller.
// usage: count <entry-hex>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#define MAX_CPU 256
int main(int argc, char **argv) {
  uint64_t entry = strtoull(argv[1], 0, 16);
  static uint64_t prev[MAX_CPU], callsite[MAX_CPU], count[MAX_CPU];
  static int counting[MAX_CPU];
  static char line[1 << 12];
  uint64_t total_lines = 0;
  while (fgets(line, sizeof line, stdin)) {
    if (strncmp(line, "Trace ", 6) != 0) continue;
    total_lines++;
    char *p = line + 6;
    int cpu = (int)strtol(p, &p, 10);
    if (cpu < 0 || cpu >= MAX_CPU) continue;
    char *slash = strchr(p, '/');
    if (!slash) continue;
    uint64_t pc = strtoull(slash + 1, 0, 16);
    if (!counting[cpu]) {
      if (pc == entry) {
        counting[cpu] = 1;
        count[cpu] = 1;
        callsite[cpu] = prev[cpu];
      }
    } else if (pc > callsite[cpu] && pc <= callsite[cpu] + 8) {
      counting[cpu] = 0;
      printf("%llu\n", (unsigned long long)count[cpu]);
    } else {
      count[cpu]++;
    }
    prev[cpu] = pc;
  }
  fprintf(stderr, "lines=%llu\n", (unsigned long long)total_lines);
  return 0;
}
