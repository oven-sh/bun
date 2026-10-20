// Like count.c, and attributes each counted instruction to a symbol.
// usage: hist <entry-hex> <symbols-file: "hexaddr name" sorted by address>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#define MAX_CPU 256
static uint64_t *addrs; static char **names; static uint64_t *hits; static size_t nsym;
static size_t find(uint64_t pc) {
  size_t lo = 0, hi = nsym;
  while (lo + 1 < hi) { size_t mid = (lo + hi) / 2; if (addrs[mid] <= pc) lo = mid; else hi = mid; }
  return lo;
}
int main(int argc, char **argv) {
  uint64_t entry = strtoull(argv[1], 0, 16);
  FILE *f = fopen(argv[2], "r");
  size_t cap = 1 << 20; addrs = malloc(cap * 8); names = malloc(cap * sizeof(char *));
  static char line[1 << 16];
  while (fgets(line, sizeof line, f)) {
    if (nsym == cap) { cap *= 2; addrs = realloc(addrs, cap * 8); names = realloc(names, cap * sizeof(char *)); }
    char *sp = strchr(line, ' '); if (!sp) continue;
    addrs[nsym] = strtoull(line, 0, 16);
    size_t len = strlen(sp + 1); if (len && sp[len] == '\n') sp[len] = 0;
    names[nsym] = strdup(sp + 1); nsym++;
  }
  hits = calloc(nsym, 8);
  static uint64_t prev[MAX_CPU], callsite[MAX_CPU];
  static int counting[MAX_CPU];
  while (fgets(line, sizeof line, stdin)) {
    if (strncmp(line, "Trace ", 6) != 0) continue;
    char *p = line + 6;
    int cpu = (int)strtol(p, &p, 10);
    if (cpu < 0 || cpu >= MAX_CPU) continue;
    char *slash = strchr(p, '/');
    if (!slash) continue;
    uint64_t pc = strtoull(slash + 1, 0, 16);
    if (!counting[cpu]) {
      if (pc == entry) { counting[cpu] = 1; callsite[cpu] = prev[cpu]; hits[find(pc)]++; }
    } else if (pc > callsite[cpu] && pc <= callsite[cpu] + 8) {
      counting[cpu] = 0;
    } else {
      hits[find(pc)]++;
    }
    prev[cpu] = pc;
  }
  for (size_t i = 0; i < nsym; i++) if (hits[i]) printf("%llu\t%s\n", (unsigned long long)hits[i], names[i]);
  return 0;
}
