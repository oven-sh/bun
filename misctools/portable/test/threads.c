// Test program for the portable image: real libc, threads, locks, thread-local
// variables, heap, files and clocks. It is linked once (static-pie, musl) and
// the same bytes run on every host.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define THREADS 8
#define ROUNDS 200000

static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t ready = PTHREAD_COND_INITIALIZER;
static int go;
static uint64_t shared_total;

static _Thread_local uint64_t tl_counter;
static _Thread_local char tl_name[32] = "unset";

static uint64_t mix(uint64_t x) {
  x ^= x >> 33; x *= 0xff51afd7ed558ccdull; x ^= x >> 33; x *= 0xc4ceb9fe1a85ec53ull; x ^= x >> 33;
  return x;
}

static void *worker(void *arg) {
  long id = (long)arg;
  snprintf(tl_name, sizeof tl_name, "worker-%ld", id);
  pthread_mutex_lock(&lock);
  while (!go) pthread_cond_wait(&ready, &lock);
  pthread_mutex_unlock(&lock);

  void *blocks[64] = {0};
  uint64_t h = id;
  for (int i = 0; i < ROUNDS; i++) {
    h = mix(h + i);
    int slot = h & 63;
    free(blocks[slot]);
    size_t n = 16 + (h >> 8) % 2000;
    blocks[slot] = malloc(n);
    memset(blocks[slot], (int)h, n);
    tl_counter += ((unsigned char *)blocks[slot])[n - 1];
  }
  for (int i = 0; i < 64; i++) free(blocks[i]);

  pthread_mutex_lock(&lock);
  shared_total += tl_counter;
  pthread_mutex_unlock(&lock);
  char expect[32];
  snprintf(expect, sizeof expect, "worker-%ld", id);
  return (void *)(intptr_t)(strcmp(expect, tl_name) == 0);
}

static double now_ms(clockid_t c) {
  struct timespec t;
  clock_gettime(c, &t);
  return t.tv_sec * 1e3 + t.tv_nsec / 1e6;
}

int main(int argc, char **argv) {
  double t0 = now_ms(CLOCK_MONOTONIC);
  pthread_t th[THREADS];
  for (long i = 0; i < THREADS; i++)
    if (pthread_create(&th[i], 0, worker, (void *)i)) { perror("pthread_create"); return 1; }
  pthread_mutex_lock(&lock);
  go = 1;
  pthread_cond_broadcast(&ready);
  pthread_mutex_unlock(&lock);
  int names_ok = 0;
  for (int i = 0; i < THREADS; i++) {
    void *r;
    pthread_join(th[i], &r);
    names_ok += (int)(intptr_t)r;
  }

  const char *path = argc > 1 ? argv[1] : "m2-probe.tmp";
  int fd = open(path, O_CREAT | O_TRUNC | O_WRONLY, 0644);
  if (fd < 0) { perror("open for write"); return 1; }
  char line[128];
  int n = snprintf(line, sizeof line, "total=%llu\n", (unsigned long long)shared_total);
  if (write(fd, line, n) != n) { perror("write"); return 1; }
  close(fd);
  char back[128] = {0};
  fd = open(path, O_RDONLY);
  if (fd < 0) { perror("open for read"); return 1; }
  ssize_t got = read(fd, back, sizeof back - 1);
  close(fd);
  unlink(path);
  int file_ok = got == n && !memcmp(line, back, n) && access(path, F_OK) == -1 && errno == ENOENT;

  time_t wall = time(0);
  printf("m2: threads=%d total=%llu thread_locals_ok=%d/%d main_tls=%s file_roundtrip=%d wall_year_ok=%d pid_ok=%d elapsed_ms=%.0f env_PROBE=%s argc=%d\n",
         THREADS, (unsigned long long)shared_total, names_ok, THREADS, tl_name, file_ok,
         wall > 1700000000, getpid() > 0, now_ms(CLOCK_MONOTONIC) - t0,
         getenv("PROBE") ? getenv("PROBE") : "(null)", argc);
  return names_ok == THREADS && file_ok ? 42 : 1;
}
