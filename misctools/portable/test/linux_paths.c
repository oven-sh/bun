// Second test program for the portable image: the parts of the libc patch and of the
// hosts that threads.c does not reach. Exit code 42 means pass.
//
//   linux_paths.img direct           on a Linux host: everything below
//   linux_paths.img hosted           under a host without processes and signals (the arm64
//                                    hosts): vfork has to fail with ENOSYS, sigaction has to
//                                    succeed, no signal is sent and no thread is created
//   linux_paths.img hosted-signals   under a host that delivers signals (the x86-64 hosts):
//                                    as direct, but vfork has to fail with ENOSYS and no
//                                    thread is cancelled
//
//   vfork          the child runs and exits, the parent goes on (direct)
//   signal         a handler runs for raise() and returns
//   cancel         a thread that is blocked in read() is cancelled (direct)
//   main_tls       emulated TLS of the main thread
//   tls_align      thread locals that ask for more alignment than the allocator of the libc
//                  gives (64 and 4096): address and first content, in the main thread and,
//                  where the mode has threads, in a second one
//   stack          pthread_getattr_np() of the main thread: a local variable is inside of the
//                  bounds. Under a host the limit of the stack (getrlimit) is their size
//   mask           a blocked signal stays pending and arrives when it is unblocked
//   thread_signal  pthread_kill() reaches a thread that is blocked in a lock, in that thread
//   fault          a read of a page without access: SIGSEGV with the address and SEGV_ACCERR.
//                  The handler changes program counter, first argument register and stack
//                  pointer, and the thread goes on in the function that the handler chose
//   maperr         the same for an address where nothing is mapped: SEGV_MAPERR
#define _GNU_SOURCE
#include <errno.h>
#include <pthread.h>
#include <semaphore.h>
#include <setjmp.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <ucontext.h>
#include <unistd.h>

static volatile sig_atomic_t got_signal;
static _Thread_local int tl_value = 7;
static _Thread_local _Alignas(64) unsigned char tl_line[64] = {3, 1, 4};
static _Thread_local _Alignas(4096) long tl_page = 0x5eed;
static int pipe_fd[2];

/* volatile: the compiler knows what alignment was asked for, and would not look. */
__attribute__((noinline)) static int aligned_to(void *volatile p, uintptr_t alignment) { return !((uintptr_t)p & (alignment - 1)); }
static int tls_aligned(void) {
  return aligned_to(tl_line, 64) && aligned_to(&tl_page, 4096) && tl_line[0] == 3 && tl_line[2] == 4 && !tl_line[63] && tl_page == 0x5eed;
}

static void on_signal(int sig, siginfo_t *info, void *context) {
  (void)info; (void)context;
  got_signal = sig;
}

static void *blocked_reader(void *arg) {
  (void)arg;
  char c;
  tl_value = 9;
  read(pipe_fd[0], &c, 1); /* cancellation point, nobody writes */
  return 0;
}

static sem_t waiter_ready, waiter_go;
static volatile int waiter_tid, handler_tid, waiter_tls;
static void on_thread_signal(int sig) {
  (void)sig;
  handler_tid = gettid();
}
static void *waiter(void *arg) {
  (void)arg;
  waiter_tid = gettid();
  waiter_tls = tls_aligned();
  tl_page++;
  sem_post(&waiter_ready);
  while (sem_wait(&waiter_go) && errno == EINTR) {}
  return 0;
}

static jmp_buf back;
static volatile long landed_with;
static volatile uintptr_t fault_address;
static volatile int fault_code, fault_signal;
static void landing(long value) {
  landed_with = value;
  longjmp(back, 1);
}
static void on_fault(int sig, siginfo_t *info, void *context) {
  ucontext_t *uc = context;
  fault_signal = sig;
  fault_code = info->si_code;
  fault_address = (uintptr_t)info->si_addr;
#if defined(__x86_64__)
  uc->uc_mcontext.gregs[REG_RIP] = (greg_t)(uintptr_t)landing;
  uc->uc_mcontext.gregs[REG_RDI] = 1234;
  uc->uc_mcontext.gregs[REG_RSP] = (uc->uc_mcontext.gregs[REG_RSP] & ~15ll) - 8; /* as after a call */
#else
  uc->uc_mcontext.pc = (uintptr_t)landing;
  uc->uc_mcontext.regs[0] = 1234;
#endif
}
__attribute__((noinline)) static int read_byte(volatile char *p) { return *p; }

static int wait_for(volatile int *value) {
  for (int i = 0; i < 400 && !*value; i++) {
    struct timespec pause = {0, 5000000};
    nanosleep(&pause, 0);
  }
  return *value;
}

int main(int argc, char **argv) {
  const char *mode = argc > 1 ? argv[1] : "direct";
  int direct = !strcmp(mode, "direct"), signals = direct || !strcmp(mode, "hosted-signals");
  int vfork_ok, signal_ok, cancel_ok = 1, stack_ok, mask_ok = 1, thread_signal_ok = 1, fault_ok = 1, maperr_ok = 1;
  int tls_align_ok = tls_aligned();

  volatile int marker = 1;
  errno = 0;
  pid_t pid = vfork();
  if (pid == 0) _exit(7);
  if (!direct) {
    vfork_ok = pid == -1 && errno == ENOSYS;
  } else {
    int status = 0;
    vfork_ok = pid > 0 && waitpid(pid, &status, 0) == pid && WIFEXITED(status) && WEXITSTATUS(status) == 7 && marker == 1;
  }

  pthread_attr_t attr;
  void *stack_low = 0;
  size_t stack_size = 0;
  struct rlimit limit = {0, 0};
  stack_ok = !pthread_getattr_np(pthread_self(), &attr) && !pthread_attr_getstack(&attr, &stack_low, &stack_size) && !getrlimit(RLIMIT_STACK, &limit);
  stack_ok = stack_ok && (char *)&marker >= (char *)stack_low && (char *)&marker < (char *)stack_low + stack_size && stack_size >= 65536;
  /* A host made the stack and knows its size. On Linux the bounds are what the libc finds by
     probing, and nothing ties them to the limit. */
  if (!direct) stack_ok = stack_ok && limit.rlim_cur == stack_size;

  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_sigaction = on_signal;
  sa.sa_flags = SA_SIGINFO;
  signal_ok = sigaction(SIGUSR1, &sa, 0) == 0;
  if (signals) {
    raise(SIGUSR1);
    signal_ok = signal_ok && got_signal == SIGUSR1;

    sigset_t block, pending, before;
    sigemptyset(&block);
    sigaddset(&block, SIGUSR1);
    got_signal = 0;
    mask_ok = !sigprocmask(SIG_BLOCK, &block, &before) && !raise(SIGUSR1) && got_signal == 0 && !sigpending(&pending) && sigismember(&pending, SIGUSR1) == 1;
    mask_ok = mask_ok && !sigprocmask(SIG_SETMASK, &before, 0) && got_signal == SIGUSR1;

    pthread_t thread;
    struct sigaction ts;
    memset(&ts, 0, sizeof ts);
    ts.sa_handler = on_thread_signal;
    thread_signal_ok = !sem_init(&waiter_ready, 0, 0) && !sem_init(&waiter_go, 0, 0) && !sigaction(SIGUSR2, &ts, 0) && !pthread_create(&thread, 0, waiter, 0);
    if (thread_signal_ok) {
      while (sem_wait(&waiter_ready) && errno == EINTR) {}
      struct timespec pause = {0, 50000000};
      nanosleep(&pause, 0); /* so that the thread is in its lock */
      thread_signal_ok = !pthread_kill(thread, SIGUSR2) && wait_for(&handler_tid) == waiter_tid && waiter_tid != gettid();
      sem_post(&waiter_go);
      thread_signal_ok = !pthread_join(thread, 0) && thread_signal_ok;
      /* The thread had objects of its own: what it changed is not seen here. */
      tls_align_ok = tls_align_ok && waiter_tls && tls_aligned();
    }

    struct sigaction fa;
    memset(&fa, 0, sizeof fa);
    fa.sa_sigaction = on_fault;
    fa.sa_flags = SA_SIGINFO;
    char *page = mmap(0, 4096, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    fault_ok = page != MAP_FAILED && !sigaction(SIGSEGV, &fa, 0);
    if (fault_ok) {
      if (!setjmp(back)) {
        read_byte(page + 10);
        fault_ok = 0;
      } else fault_ok = landed_with == 1234 && fault_signal == SIGSEGV && fault_address == (uintptr_t)page + 10 && fault_code == SEGV_ACCERR;
      munmap(page, 4096);
      landed_with = 0;
      if (!setjmp(back)) {
        read_byte(page + 20);
        maperr_ok = 0;
      } else maperr_ok = landed_with == 1234 && fault_signal == SIGSEGV && fault_address == (uintptr_t)page + 20 && fault_code == SEGV_MAPERR;
    }
    signal(SIGSEGV, SIG_DFL);
  }
  if (direct) {
    /* Both orders end in a cancelled thread. The pause makes it likely that
       the thread is inside read() when the cancellation arrives. */
    pthread_t reader;
    void *result = 0;
    cancel_ok = pipe(pipe_fd) == 0 && pthread_create(&reader, 0, blocked_reader, 0) == 0;
    if (cancel_ok) {
      struct timespec pause = {0, 100000000};
      nanosleep(&pause, 0);
      cancel_ok = pthread_cancel(reader) == 0 && pthread_join(reader, &result) == 0 && result == PTHREAD_CANCELED;
    }
  }

  printf("linux_paths: mode=%s vfork=%d signal=%d cancel=%d main_tls=%d stack=%d mask=%d thread_signal=%d fault=%d maperr=%d tls_align=%d\n",
         mode, vfork_ok, signal_ok, cancel_ok, tl_value, stack_ok, mask_ok, thread_signal_ok, fault_ok, maperr_ok, tls_align_ok);
  return vfork_ok && signal_ok && cancel_ok && tl_value == 7 && stack_ok && mask_ok && thread_signal_ok && fault_ok && maperr_ok && tls_align_ok ? 42 : 1;
}
