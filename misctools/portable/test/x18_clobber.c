// Negative control of the x18 checks (aarch64): an image that writes x18 on purpose.
// Every check that says "the image never writes x18" has to report this one.
//
//   x18_clobber.img request    writes x18, then asks the host for something
//   x18_clobber.img fault      writes x18, then runs into a fault that has a handler
//   x18_clobber.img thread     the same as request, on a second thread
//   x18_clobber.img detached   writes x18 on a detached thread, which asks for nothing more
//                              than its end (the thread_exit of the host table)
//   x18_clobber.img keep       control of the control: x18 is read and written back as it
//                              was, on the main thread, on a thread that is joined and on a
//                              detached one, and everything has to pass
//
// On Linux by itself x18 is a register like the others: every mode ends with 42. Under a
// host that keeps something in x18 (the arm64 Linux test host, Windows) the first three
// modes must not get that far: the Linux test host ends the process with exit code 96.
// test/check_aarch64.ts has to find the writes in the file.
#define _GNU_SOURCE
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>
#include <time.h>
#include <unistd.h>

static volatile int handled;
static void on_fault(int sig, siginfo_t *info, void *context) {
  (void)sig; (void)info; (void)context;
  handled = 1;
  _exit(42);
}
__attribute__((noinline)) static void clobber(void) { __asm__ __volatile__("mov x18, #0x1234"); }
__attribute__((noinline)) static void keep(void) { __asm__ __volatile__("mov x9, x18\n mov x18, x9" : : : "x9"); }
__attribute__((noinline)) static int read_byte(volatile char *p) { return *p; }
static void *on_thread(void *arg) {
  (void)arg;
  clobber();
  return (void *)(long)getpid();
}
static volatile int detached_ran;
static void *keeps(void *arg) {
  (void)arg;
  keep();
  detached_ran = 1;
  return (void *)(long)getpid();
}
static void *ends_with_another_x18(void *arg) {
  (void)arg;
  detached_ran = 1;
  clobber();
  return 0;
}
/* A detached thread ends by itself, and nothing tells the image that the host has seen its
   end. So the image waits until the thread has run, and `pauses` times 5 ms more for the
   end of it. The run that must fail is ended by the host inside of that time. */
static int run_detached(void *(*fn)(void *), int pauses) {
  pthread_t thread;
  pthread_attr_t attr;
  struct timespec pause = {0, 5000000};
  /* The thread that was joined before has set it too. */
  detached_ran = 0;
  if (pthread_attr_init(&attr) || pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED) || pthread_create(&thread, &attr, fn, 0)) return 0;
  for (int i = 0; i < 12000 && !detached_ran; i++) nanosleep(&pause, 0);
  for (int i = 0; i < pauses; i++) nanosleep(&pause, 0);
  return detached_ran;
}

int main(int argc, char **argv) {
  const char *mode = argc > 1 ? argv[1] : "request";
  if (!strcmp(mode, "keep")) {
    pthread_t thread;
    void *result = 0;
    keep();
    int joined = !pthread_create(&thread, 0, keeps, 0) && !pthread_join(thread, &result) && (long)result > 0;
    int detached = run_detached(keeps, 400);
    printf("x18_clobber: mode=keep pid_ok=%d joined=%d detached=%d\n", getpid() > 0, joined, detached);
    return joined && detached ? 42 : 1;
  }
  if (!strcmp(mode, "detached")) {
    int ran = run_detached(ends_with_another_x18, 2000);
    printf("x18_clobber: mode=detached ran=%d\n", ran);
    return ran ? 42 : 1;
  }
  if (!strcmp(mode, "fault")) {
    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_sigaction = on_fault;
    sa.sa_flags = SA_SIGINFO;
    char *page = mmap(0, 4096, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (page == MAP_FAILED || sigaction(SIGSEGV, &sa, 0)) return 1;
    clobber();
    read_byte(page);
    return 1;
  }
  if (!strcmp(mode, "thread")) {
    pthread_t thread;
    void *result = 0;
    if (pthread_create(&thread, 0, on_thread, 0) || pthread_join(thread, &result)) return 1;
    printf("x18_clobber: mode=thread pid_ok=%d\n", (long)result > 0);
    return 42;
  }
  clobber();
  printf("x18_clobber: mode=request pid_ok=%d\n", getpid() > 0);
  return 42;
}
