// Minimal "perf sched record": CPU-wide context-switch recorder built on perf_event_open.
// usage: ctxsw <cpulist e.g. 0-3> <out.txt> -- cmd args...
// Output lines (CLOCK_MONOTONIC ns):
//   S <time> <cpu> <prev_tid> <next_tid> <P|V>     one per context switch (P: prev was preempted)
//   C <tid> <comm>                                  thread names
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/perf_event.h>
#include <sched.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define PAGES 4096 /* 16 MiB of data per CPU */
struct ring { int fd; struct perf_event_mmap_page *meta; char *data; uint64_t size; int cpu; };
static int parse_cpus(const char *s, int *out) {
  int n = 0; char *dup = strdup(s), *tok, *save;
  for (tok = strtok_r(dup, ",", &save); tok; tok = strtok_r(NULL, ",", &save)) {
    int a, b; if (sscanf(tok, "%d-%d", &a, &b) == 2) { for (int i = a; i <= b; i++) out[n++] = i; } else out[n++] = atoi(tok);
  }
  free(dup); return n;
}
int main(int argc, char **argv) {
  if (argc < 5 || strcmp(argv[3], "--")) { fprintf(stderr, "usage: %s cpulist out -- cmd...\n", argv[0]); return 2; }
  int cpus[256]; int ncpu = parse_cpus(argv[1], cpus);
  struct ring *rings = calloc(ncpu, sizeof *rings);
  long ps = sysconf(_SC_PAGESIZE);
  for (int i = 0; i < ncpu; i++) {
    struct perf_event_attr a; memset(&a, 0, sizeof a);
    a.size = sizeof a; a.type = PERF_TYPE_SOFTWARE; a.config = PERF_COUNT_SW_DUMMY;
    a.sample_type = PERF_SAMPLE_TID | PERF_SAMPLE_TIME | PERF_SAMPLE_CPU; a.sample_id_all = 1;
    a.context_switch = 1; a.comm = 1; a.use_clockid = 1; a.clockid = CLOCK_MONOTONIC; a.disabled = 1;
    a.watermark = 1; a.wakeup_watermark = PAGES * ps / 2;
    int fd = syscall(SYS_perf_event_open, &a, -1, cpus[i], -1, 0);
    if (fd < 0) { perror("perf_event_open"); return 1; }
    void *m = mmap(NULL, (1 + PAGES) * ps, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (m == MAP_FAILED) { perror("mmap"); return 1; }
    rings[i] = (struct ring){fd, m, (char *)m + ps, (uint64_t)PAGES * ps, cpus[i]};
  }
  pid_t pid = fork();
  if (pid == 0) {
    cpu_set_t s; CPU_ZERO(&s); for (int i = 0; i < ncpu; i++) CPU_SET(cpus[i], &s);
    sched_setaffinity(0, sizeof s, &s);
    execvp(argv[4], argv + 4); perror("exec"); _exit(127);
  }
  for (int i = 0; i < ncpu; i++) ioctl(rings[i].fd, PERF_EVENT_IOC_ENABLE, 0);
  int child_pid = pid;
  int status; waitpid(pid, &status, 0);
  for (int i = 0; i < ncpu; i++) ioctl(rings[i].fd, PERF_EVENT_IOC_DISABLE, 0);
  FILE *out = fopen(argv[2], "w");
  fprintf(out, "P %d\n", child_pid);
  uint64_t lost = 0;
  for (int i = 0; i < ncpu; i++) {
    struct ring *r = &rings[i];
    uint64_t head = __atomic_load_n(&r->meta->data_head, __ATOMIC_ACQUIRE), tail = r->meta->data_tail;
    while (tail < head) {
      char buf[4096]; struct perf_event_header h;
      for (size_t k = 0; k < sizeof h; k++) ((char *)&h)[k] = r->data[(tail + k) % r->size];
      if (h.size > sizeof buf) break;
      for (size_t k = 0; k < h.size; k++) buf[k] = r->data[(tail + k) % r->size];
      tail += h.size;
      char *p = buf + sizeof h;
      if (h.type == PERF_RECORD_SWITCH_CPU_WIDE) {
        uint32_t np_pid, np_tid, s_pid, s_tid, s_cpu; uint64_t t;
        memcpy(&np_pid, p, 4); memcpy(&np_tid, p + 4, 4); memcpy(&s_pid, p + 8, 4); memcpy(&s_tid, p + 12, 4);
        memcpy(&t, p + 16, 8); memcpy(&s_cpu, p + 24, 4);
        (void)np_pid; (void)s_pid;
        if (h.misc & PERF_RECORD_MISC_SWITCH_OUT)
          fprintf(out, "S %llu %u %u %u %c\n", (unsigned long long)t, s_cpu, s_tid, np_tid, (h.misc & PERF_RECORD_MISC_SWITCH_OUT_PREEMPT) ? 'P' : 'V');
      } else if (h.type == PERF_RECORD_COMM) {
        uint32_t c_pid, c_tid; memcpy(&c_pid, p, 4); memcpy(&c_tid, p + 4, 4);
        fprintf(out, "C %u %s\n", c_tid, p + 8);
      } else if (h.type == PERF_RECORD_LOST) { uint64_t id, n; memcpy(&id, p, 8); memcpy(&n, p + 8, 8); lost += n; }
    }
  }
  if (lost) fprintf(stderr, "ctxsw: lost %llu records\n", (unsigned long long)lost);
  fclose(out);
  return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
