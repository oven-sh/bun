// Second test program for the portable image: the parts of the libc patch that
// threads.c does not reach. Exit code 42 means pass.
//
//   linux_paths.img direct    on a Linux host: vfork, a signal handler that returns
//                             (sigaction, restore), cancellation of a thread that is
//                             blocked in a syscall (syscall_cp), emulated TLS of the
//                             main thread
//   linux_paths.img hosted    under a host without processes and signals: vfork has
//                             to fail with ENOSYS, sigaction has to succeed, and no
//                             thread is created
#define _GNU_SOURCE
#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t got_signal;
static _Thread_local int tl_value = 7;
static int pipe_fd[2];

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

int main(int argc, char **argv) {
  int hosted = argc > 1 && !strcmp(argv[1], "hosted");
  int vfork_ok, signal_ok, cancel_ok = 1;

  volatile int marker = 1;
  errno = 0;
  pid_t pid = vfork();
  if (pid == 0) _exit(7);
  if (hosted) {
    vfork_ok = pid == -1 && errno == ENOSYS;
  } else {
    int status = 0;
    vfork_ok = pid > 0 && waitpid(pid, &status, 0) == pid && WIFEXITED(status) && WEXITSTATUS(status) == 7 && marker == 1;
  }

  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_sigaction = on_signal;
  sa.sa_flags = SA_SIGINFO;
  signal_ok = sigaction(SIGUSR1, &sa, 0) == 0;
  if (!hosted) {
    raise(SIGUSR1);
    signal_ok = signal_ok && got_signal == SIGUSR1;

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

  printf("linux_paths: mode=%s vfork=%d signal=%d cancel=%d main_tls=%d\n", hosted ? "hosted" : "direct", vfork_ok, signal_ok, cancel_ok, tl_value);
  return vfork_ok && signal_ok && cancel_ok && tl_value == 7 ? 42 : 1;
}
