// Test program for the portable image: threads that the image did not create.
//
// On Windows a callback of the image runs on threads of libuv's pool, of the pool of Windows, on the
// thread of a console control handler. Such a thread has no thread pointer of the image. The function
// that is entered checks the slot of the thread pointer and adopts the thread (libc/patch_musl.ts,
// bun_adopt.c). Here the threads are made by the library of tests of the Linux test host, which calls
// the callback the way Windows calls one: with the calling convention of Windows, on a thread of its own.
//
//   adopt.img                 exit code 42 and one line that starts with "adopt: "
//   adopt.img no-check        the callback does not check: a thread of the host that runs it has to stop
//                             the program, which shows that the check is what makes the other run pass
#define _GNU_SOURCE
#include <errno.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

extern unsigned long __bun_tp_offset;
void __bun_thread_adopt(void);
unsigned long __bun_adopted_threads(unsigned long *ever);
void *__bun_host_lookup(const char *library, const char *symbol);

#define WIN64 __attribute__((ms_abi))
typedef WIN64 long long Callback(void *context, long long thread, long long call);
typedef WIN64 long long TestThreads(Callback *callback, void *context, long long threads, long long calls);

#define HOST_THREADS 8
#define CALLS 50
#define IMAGE_THREADS 4

static int check = 1;
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static long long shared_calls;
static pthread_key_t key;
static volatile int destructors_ran;
static volatile int stop_image_threads;

static _Thread_local long long calls_on_this_thread;
static _Thread_local char name_of_this_thread[32] = "unset";

// What an entry of the image does first: a load of the slot and a branch.
static inline void enter(void) {
  void *thread_pointer;
  __asm__("mov %%gs:(%1), %0" : "=r"(thread_pointer) : "r"(__bun_tp_offset));
  if (__builtin_expect(!thread_pointer, 0)) __bun_thread_adopt();
}

static void destructor(void *value) {
  // The thread still has its thread-locals when its keys are taken.
  if (strncmp(name_of_this_thread, "host-", 5) == 0) __sync_fetch_and_add(&destructors_ran, 1);
  free(value);
}

WIN64 static long long callback(void *context, long long thread, long long call) {
  if (check) enter();
  if (context != (void *)&shared_calls) return -1000000;

  // errno is in the thread structure.
  char byte;
  errno = 0;
  if (read(-1, &byte, 1) != -1 || errno != EBADF) return -2000000;

  // A thread-local that only this thread counts.
  if (calls_on_this_thread != call) return -3000000;
  calls_on_this_thread++;
  if (call == 0) {
    if (strcmp(name_of_this_thread, "unset")) return -4000000;
    snprintf(name_of_this_thread, sizeof name_of_this_thread, "host-%lld", thread);
    if (pthread_setspecific(key, malloc(64))) return -5000000;
  }
  char expected[32];
  snprintf(expected, sizeof expected, "host-%lld", thread);
  if (strcmp(name_of_this_thread, expected) || !pthread_getspecific(key)) return -6000000;

  // The allocator, and a lock that the threads of the image take too.
  size_t size = 100 + (size_t)(thread * 37 + call * 11) % 5000;
  unsigned char *block = malloc(size);
  if (!block) return -7000000;
  memset(block, (int)call, size);
  int last = block[size - 1];
  free(block);
  if (last != (int)(call & 255)) return -8000000;
  pthread_mutex_lock(&lock);
  shared_calls++;
  pthread_mutex_unlock(&lock);
  return thread * 100 + call;
}

static void *image_thread(void *arg) {
  long long rounds = 0;
  while (!stop_image_threads) {
    void *block = malloc(64 + (size_t)(rounds % 1000));
    pthread_mutex_lock(&lock);
    rounds++;
    pthread_mutex_unlock(&lock);
    free(block);
  }
  return (void *)(intptr_t)(rounds > 0 && !strcmp(name_of_this_thread, "unset") && arg == (void *)&lock);
}

int main(int argc, char **argv) {
  if (argc > 1 && !strcmp(argv[1], "no-check")) check = 0;
  if (pthread_key_create(&key, destructor)) return 1;
  TestThreads *test_threads = (TestThreads *)__bun_host_lookup("bun_host_test", "test_threads");

  if (!test_threads) {
    // No host, or a host without the library of tests: every thread is the image's. The check finds a
    // thread pointer, and the callback is an ordinary function.
    unsigned long ever = 0;
    long long sum = 0;
    for (long long call = 0; call < CALLS; call++) sum += callback(&shared_calls, 0, call);
    unsigned long now = __bun_adopted_threads(&ever);
    int ok = sum == CALLS * (CALLS - 1) / 2 && now == 0 && ever == 0 && shared_calls == CALLS;
    printf("adopt: mode=direct calls=%lld sum=%lld adopted_now=%lu adopted_ever=%lu\n", shared_calls, sum, now, ever);
    return ok ? 42 : 1;
  }

  pthread_t image_threads[IMAGE_THREADS];
  for (int i = 0; i < IMAGE_THREADS; i++)
    if (pthread_create(&image_threads[i], 0, image_thread, &lock)) return 1;
  long long sum = test_threads(callback, &shared_calls, HOST_THREADS, CALLS);
  stop_image_threads = 1;
  int image_threads_ok = 0;
  for (int i = 0; i < IMAGE_THREADS; i++) {
    void *result;
    pthread_join(image_threads[i], &result);
    image_threads_ok += (int)(intptr_t)result;
  }
  unsigned long ever = 0;
  unsigned long now = __bun_adopted_threads(&ever);
  long long expected = 100ll * CALLS * (HOST_THREADS * (HOST_THREADS - 1) / 2) + (long long)HOST_THREADS * (CALLS * (CALLS - 1) / 2);
  int ok = sum == expected && now == 0 && ever == HOST_THREADS && destructors_ran == HOST_THREADS &&
           shared_calls == HOST_THREADS * CALLS && image_threads_ok == IMAGE_THREADS && !strcmp(name_of_this_thread, "unset");
  printf("adopt: mode=hosted threads=%d calls=%lld sum=%lld expected=%lld adopted_now=%lu adopted_ever=%lu destructors=%d image_threads_ok=%d/%d main_tls=%s\n",
         HOST_THREADS, shared_calls, sum, expected, now, ever, destructors_ran, image_threads_ok, IMAGE_THREADS, name_of_this_thread);
  return ok ? 42 : 1;
}
