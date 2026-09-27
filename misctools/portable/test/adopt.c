// Test program for the portable image: threads that the image did not create.
//
// On Windows a callback of the image runs on threads of libuv's pool, of the pool of Windows, on the
// thread of a console control handler. Such a thread has no thread pointer of the image. The function
// that is entered checks the slot of the thread pointer and adopts the thread (libc/patch_musl.ts,
// bun_adopt.c). Who makes the threads here, by the second argument:
//   threads   threads that end when they have made their calls
//             the Linux test host   its library of tests (test_threads), which calls the callback the
//                                   way Windows calls one: with the calling convention of Windows, on a
//                                   thread of its own
//             a Windows host        Windows: CreateThread of kernel32, which the image calls by itself
//   pool      threads of a pool, which do not end when the work returns
//             the Linux test host   its library of tests (test_submit)
//             a Windows host        the thread pool of Windows: TrySubmitThreadpoolCallback of kernel32
//
// Who writes the check:
//   the source        `callback`: what bun_portable_macros::win_abi writes into a function of Rust
//   the compiler      `listed_callback`, and `bun_test::Callbacks::listed` of adopt_cpp.cpp: C and C++
//                     whose source has no check. adopt.list names them, and the compiler is given the
//                     list (build.ts): it calls the check of the C library at their entry.
//   nobody            `unlisted_callback`, `bun_test::Callbacks::unlisted`, and `callback` with no-check
//
//   adopt.img [source|listed|listed-cpp] [threads|pool]   exit code 42 and one line that starts with "adopt: "
//   adopt.img no-check|unlisted|unlisted-cpp [threads|pool]
//                                              nothing checks: a thread of the host that runs the callback
//                                              has to stop the program, which shows that the check is
//                                              what makes the other runs pass
//
// What the line says of the threads that were adopted, and what is expected:
//   threads   adopted_now=0 adopted_ever=8 destructors=8. The maker waits for the end of its threads, and a
//             thread that ends leaves the image: it is not adopted any more, and the destructors of its keys
//             have run.
//   pool      adopted_now=8 adopted_ever=8 destructors=0. The work has returned and the threads are still
//             there, they are the pool's: each is adopted still, and its keys are its own until it ends. A
//             pool may end a thread that has no work at any time. Such a thread has left the image as
//             every thread does that ends, so what holds is adopted_now + destructors = 8, and
//             adopted_now is above 0 as long as the pool has kept one of them.
#define _GNU_SOURCE
#include <errno.h>
#include <pthread.h>
#include <sched.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

extern unsigned long __bun_tp_offset;
void __bun_thread_adopt(void);
void __bun_thread_enter(void);
unsigned long __bun_adopted_threads(unsigned long *ever);
void *__bun_host_lookup(const char *library, const char *symbol);

// What the host calls has the calling convention of Windows, which arm64 shares with the image.
#if defined(__x86_64__)
#define WIN64 __attribute__((ms_abi))
#else
#define WIN64
#endif
typedef WIN64 long long Callback(void *context, long long thread, long long call);
typedef WIN64 long long TestThreads(Callback *callback, void *context, long long threads, long long calls);
// adopt_cpp.cpp
Callback *adopt_cpp_callback(int listed);
long long adopt_work(void *context, long long thread, long long call);

#define HOST_THREADS 8
#define CALLS 50
#define IMAGE_THREADS 4

static int check = 1;
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static long long shared_calls;
static pthread_key_t key;
static volatile int destructors_ran;
static volatile int stop_image_threads;
static volatile int image_threads_at_work;

static _Thread_local long long calls_on_this_thread;
static _Thread_local char name_of_this_thread[32] = "unset";

// What an entry of the image does first. x86-64: a load of the slot and a branch, gs is the thread's
// on every host. arm64: the register is the host's choice, and the C library has the check.
static inline void enter(void) {
#if defined(__x86_64__)
  void *thread_pointer;
  __asm__("mov %%gs:(%1), %0" : "=r"(thread_pointer) : "r"(__bun_tp_offset));
  if (__builtin_expect(!thread_pointer, 0)) __bun_thread_adopt();
#else
  __bun_thread_enter();
#endif
}

static void destructor(void *value) {
  // The thread still has its thread-locals when its keys are taken.
  if (strncmp(name_of_this_thread, "host-", 5) == 0) __sync_fetch_and_add(&destructors_ran, 1);
  free(value);
}

// What a callback does: everything of it needs the thread pointer.
long long adopt_work(void *context, long long thread, long long call) {
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

  // The stack of the thread, which the thread's maker made: this frame is on it.
  pthread_attr_t attributes;
  void *stack = 0;
  size_t stack_size = 0;
  if (pthread_getattr_np(pthread_self(), &attributes) || pthread_attr_getstack(&attributes, &stack, &stack_size)) return -9000000;
  pthread_attr_destroy(&attributes);
  if ((char *)&attributes < (char *)stack || (char *)&attributes >= (char *)stack + stack_size) return -9000000;

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

WIN64 static long long callback(void *context, long long thread, long long call) {
  if (check) enter();
  return adopt_work(context, thread, call);
}

WIN64 static long long listed_callback(void *context, long long thread, long long call) {
  return adopt_work(context, thread, call);
}

WIN64 static long long unlisted_callback(void *context, long long thread, long long call) {
  return adopt_work(context, thread, call);
}

// A thread of the image, at work while the threads of the host enter: it takes the allocator and the
// lock that they take.
static void *image_thread(void *arg) {
  long long rounds = 0;
  do {
    void *block = malloc(64 + (size_t)(rounds % 1000));
    pthread_mutex_lock(&lock);
    rounds++;
    pthread_mutex_unlock(&lock);
    free(block);
    if (rounds == 1) __sync_fetch_and_add(&image_threads_at_work, 1);
  } while (!stop_image_threads);
  return (void *)(intptr_t)(rounds > 0 && !strcmp(name_of_this_thread, "unset") && arg == (void *)&lock);
}

// On a Windows host the threads are made by Windows: CreateThread of kernel32 starts each of them in
// windows_thread, which Windows enters the way it enters a callback. It touches nothing of the thread
// before the callback that is tested has run.
unsigned long __bun_host_os(void);
typedef WIN64 unsigned WindowsStart(void *argument);
typedef WIN64 void *WindowsCreateThread(void *security, size_t stack, WindowsStart *start, void *argument, unsigned flags, unsigned *id);
typedef WIN64 unsigned WindowsWaitForSingleObject(void *handle, unsigned milliseconds);
typedef WIN64 int WindowsCloseHandle(void *handle);
struct windows_thread {
  Callback *callback;
  void *context, *handle;
  long long number, calls, result;
};
WIN64 static unsigned windows_thread(void *argument) {
  struct windows_thread *t = argument;
  for (long long call = 0; call < t->calls; call++) t->result += t->callback(t->context, t->number, call);
  return 0;
}
WIN64 static long long windows_test_threads(Callback *callback, void *context, long long threads, long long calls) {
  WindowsCreateThread *create = (WindowsCreateThread *)__bun_host_lookup("kernel32", "CreateThread");
  WindowsWaitForSingleObject *wait = (WindowsWaitForSingleObject *)__bun_host_lookup("kernel32", "WaitForSingleObject");
  WindowsCloseHandle *close_handle = (WindowsCloseHandle *)__bun_host_lookup("kernel32", "CloseHandle");
  if (!create || !wait || !close_handle || threads < 1 || threads > 64) return -1;
  static struct windows_thread t[64];
  long long started = 0, result = 0;
  for (; started < threads; started++) {
    t[started] = (struct windows_thread){.callback = callback, .context = context, .number = started, .calls = calls};
    t[started].handle = create(0, 0, windows_thread, &t[started], 0, 0);
    if (!t[started].handle) break;
  }
  for (long long i = 0; i < started; i++) {
    // The thread has ended, and what Windows runs at the end of a thread has run, when the wait returns.
    wait(t[i].handle, 0xffffffffu);
    close_handle(t[i].handle);
    result += t[i].result;
  }
  return started == threads ? result : -1;
}

// The threads of a pool. A job is what one thread of the other makers does: its calls, one after the other,
// with its number. The test wants every job on a thread of its own (what a call leaves in the thread-locals
// is what the next call of the job finds), and a pool runs a job on any thread that has no work. So a job
// keeps its thread, after its first call, until every job has made its first call: the pool has to come up
// with a thread for each. The first call is the first thing of the image that the thread runs.
typedef WIN64 void PoolWork(void *instance, void *argument);
typedef WIN64 int PoolSubmit(PoolWork *work, void *argument, void *environment);
typedef WIN64 int PoolMayRunLong(void *instance);
struct pool_job {
  Callback *callback;
  void *context;
  long long number, calls, jobs, result;
};
static PoolSubmit *pool_submit;
static PoolMayRunLong *pool_may_run_long;
static volatile int pool_jobs_in, pool_jobs_done;

static void nap(void) {
  struct timespec t = {0, 1000000};
  nanosleep(&t, 0);
}
static long long seconds_now(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec;
}
WIN64 static void pool_work(void *instance, void *argument) {
  struct pool_job *job = argument;
  // Windows is told that this work takes its time (CallbackMayRunLong of kernel32): the pool gives the next
  // job another thread. A function of Windows, nothing of the image.
  if (pool_may_run_long) pool_may_run_long(instance);
  job->result += job->callback(job->context, job->number, 0);
  __sync_fetch_and_add(&pool_jobs_in, 1);
  while (pool_jobs_in < job->jobs) nap();
  for (long long call = 1; call < job->calls; call++) job->result += job->callback(job->context, job->number, call);
  __sync_fetch_and_add(&pool_jobs_done, 1);
}
WIN64 static long long pool_test_threads(Callback *callback, void *context, long long threads, long long calls) {
  static struct pool_job jobs[64];
  if (threads < 1 || threads > 64) return -1;
  for (long long i = 0; i < threads; i++) {
    jobs[i] = (struct pool_job){.callback = callback, .context = context, .number = i, .calls = calls, .jobs = threads};
    if (!pool_submit(pool_work, &jobs[i], 0)) return -1;
  }
  // The work has returned when the job is counted. The thread has not ended, and nobody waits for that.
  for (long long until = seconds_now() + 60; pool_jobs_done < threads; nap()) {
    if (seconds_now() < until) continue;
    fprintf(stderr, "adopt: after 60 s the pool has begun %d of %lld jobs and ended %d\n", pool_jobs_in, threads, pool_jobs_done);
    return -1;
  }
  long long result = 0;
  for (long long i = 0; i < threads; i++) result += jobs[i].result;
  return result;
}

int main(int argc, char **argv) {
  const char *who = argc > 1 ? argv[1] : "source";
  const char *maker = argc > 2 ? argv[2] : "threads";
  int pool = !strcmp(maker, "pool");
  if (!pool && strcmp(maker, "threads")) return 2;
  Callback *entered = callback;
  if (!strcmp(who, "no-check")) check = 0;
  else if (!strcmp(who, "listed")) entered = listed_callback;
  else if (!strcmp(who, "unlisted")) entered = unlisted_callback;
  else if (!strcmp(who, "listed-cpp")) entered = adopt_cpp_callback(1);
  else if (!strcmp(who, "unlisted-cpp")) entered = adopt_cpp_callback(0);
  else if (strcmp(who, "source")) return 2;
  if (pthread_key_create(&key, destructor)) return 1;
  TestThreads *test_threads = 0;
  if (pool) {
    pool_submit = (PoolSubmit *)__bun_host_lookup("bun_host_test", "test_submit");
    if (!pool_submit && __bun_host_os() == 2) {
      pool_submit = (PoolSubmit *)__bun_host_lookup("kernel32", "TrySubmitThreadpoolCallback");
      pool_may_run_long = (PoolMayRunLong *)__bun_host_lookup("kernel32", "CallbackMayRunLong");
    }
    if (pool_submit) test_threads = pool_test_threads;
  } else {
    test_threads = (TestThreads *)__bun_host_lookup("bun_host_test", "test_threads");
    if (!test_threads && __bun_host_os() == 2) test_threads = windows_test_threads;
  }

  if (!test_threads) {
    // No host, or a host without the library of tests: every thread is the image's. The check finds a
    // thread pointer, and the callback is an ordinary function.
    unsigned long ever = 0;
    long long sum = 0;
    for (long long call = 0; call < CALLS; call++) sum += entered(&shared_calls, 0, call);
    unsigned long now = __bun_adopted_threads(&ever);
    int ok = sum == CALLS * (CALLS - 1) / 2 && now == 0 && ever == 0 && shared_calls == CALLS;
    printf("adopt: mode=direct check=%s calls=%lld sum=%lld adopted_now=%lu adopted_ever=%lu\n", who, shared_calls, sum, now, ever);
    return ok ? 42 : 1;
  }

  pthread_t image_threads[IMAGE_THREADS];
  for (int i = 0; i < IMAGE_THREADS; i++)
    if (pthread_create(&image_threads[i], 0, image_thread, &lock)) return 1;
  while (image_threads_at_work < IMAGE_THREADS) sched_yield();
  long long sum = test_threads(entered, &shared_calls, HOST_THREADS, CALLS);
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
  int destructors = destructors_ran;
  // See the top of this file: the threads of a pool are still there, the others have ended.
  int have_left = pool ? now > 0 && now + (unsigned long)destructors == HOST_THREADS : now == 0 && destructors == HOST_THREADS;
  int ok = sum == expected && have_left && ever == HOST_THREADS && shared_calls == HOST_THREADS * CALLS && image_threads_ok == IMAGE_THREADS &&
           !strcmp(name_of_this_thread, "unset");
  printf("adopt: mode=%s check=%s threads=%d calls=%lld sum=%lld expected=%lld adopted_now=%lu adopted_ever=%lu destructors=%d image_threads_ok=%d/%d main_tls=%s\n",
         pool ? "pool" : "hosted", who, HOST_THREADS, shared_calls, sum, expected, now, ever, destructors, image_threads_ok, IMAGE_THREADS, name_of_this_thread);
  return ok ? 42 : 1;
}
