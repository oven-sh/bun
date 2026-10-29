// Wake latency of a sleeping thread on another CPU, as a function of how long it slept.
// S (sender, CPU a) busy-waits D us, then FUTEX_WAKEs W (CPU b). Reports the median of:
//   lat  = time from just before the wake call to W running again
//   call = time the FUTEX_WAKE syscall took on the sender
#define _GNU_SOURCE
#include <linux/futex.h>
#include <pthread.h>
#include <sched.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

static inline uint64_t now_ns(void) { struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts); return (uint64_t)ts.tv_sec * 1000000000ull + ts.tv_nsec; }
static void pin(int cpu) { cpu_set_t s; CPU_ZERO(&s); CPU_SET(cpu, &s); sched_setaffinity(0, sizeof s, &s); }
static _Atomic uint32_t word;
static _Atomic uint64_t t_woke;
static _Atomic int stop;
static int cpu_w;
static void *waiter(void *arg) {
  pin(cpu_w);
  for (;;) {
    while (atomic_load(&word) == 0) syscall(SYS_futex, &word, FUTEX_WAIT_PRIVATE, 0, NULL, NULL, 0);
    uint64_t t = now_ns();
    if (atomic_load(&stop)) return NULL;
    atomic_store(&word, 0);
    atomic_store(&t_woke, t);
  }
}
static int cmp(const void *a, const void *b) { uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b; return x < y ? -1 : x > y; }
int main(int argc, char **argv) {
  int cpu_s = argc > 1 ? atoi(argv[1]) : 0; cpu_w = argc > 2 ? atoi(argv[2]) : 1;
  int n = argc > 3 ? atoi(argv[3]) : 400;
  pin(cpu_s);
  pthread_t th; pthread_create(&th, NULL, waiter, NULL);
  static const int ds[] = {0, 2, 5, 10, 20, 50, 100, 150, 200, 300, 500, 1000, 3000, 10000};
  uint64_t *lat = malloc(sizeof(uint64_t) * n), *call = malloc(sizeof(uint64_t) * n);
  for (unsigned k = 0; k < sizeof ds / sizeof ds[0]; k++) {
    int reps = ds[k] >= 3000 ? n / 8 : n;
    for (int i = 0; i < reps; i++) {
      // let W park, then keep this CPU busy for D us
      uint64_t t0 = now_ns();
      while (now_ns() - t0 < (uint64_t)ds[k] * 1000 + 3000) ;
      atomic_store(&t_woke, 0);
      uint64_t a = now_ns();
      atomic_store(&word, 1);
      syscall(SYS_futex, &word, FUTEX_WAKE_PRIVATE, 1, NULL, NULL, 0);
      uint64_t b = now_ns();
      uint64_t w;
      while ((w = atomic_load(&t_woke)) == 0) ;
      lat[i] = w - a; call[i] = b - a;
    }
    qsort(lat, reps, sizeof(uint64_t), cmp); qsort(call, reps, sizeof(uint64_t), cmp);
    printf("slept~%6dus  wake-latency p50=%6.1fus p90=%6.1fus   wake-call p50=%5.1fus p90=%5.1fus\n", ds[k] + 3,
           lat[reps / 2] / 1e3, lat[reps * 9 / 10] / 1e3, call[reps / 2] / 1e3, call[reps * 9 / 10] / 1e3);
  }
  atomic_store(&stop, 1); atomic_store(&word, 1); syscall(SYS_futex, &word, FUTEX_WAKE_PRIVATE, 1, NULL, NULL, 0);
  pthread_join(th, NULL);
  return 0;
}
