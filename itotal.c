// Counts the user-space instructions that the main thread executes from exec to exit, with single steps.
//   cc -O2 -o itotal itotal.c
//   itotal <binary> [args...]
// Other threads are not traced.
#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/personality.h>
#include <sys/ptrace.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static void die(const char *what) {
  perror(what);
  exit(2);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: itotal <binary> [args...]\n");
    return 2;
  }
  pid_t child = fork();
  if (child < 0) die("fork");
  if (child == 0) {
    personality(ADDR_NO_RANDOMIZE);
    if (ptrace(PTRACE_TRACEME, 0, 0, 0) < 0) die("PTRACE_TRACEME");
    execv(argv[1], argv + 1);
    die("execv");
  }
  int status;
  if (waitpid(child, &status, 0) < 0 || !WIFSTOPPED(status)) die("no stop at exec");
  unsigned long long count = 0;
  int pending = 0;
  for (;;) {
    if (ptrace(PTRACE_SINGLESTEP, child, 0, (void *)(long)pending) < 0) die("PTRACE_SINGLESTEP");
    if (waitpid(child, &status, 0) < 0) die("waitpid");
    if (WIFEXITED(status) || WIFSIGNALED(status)) break;
    int sig = WSTOPSIG(status);
    if (sig != SIGTRAP) {
      pending = sig;
      continue;
    }
    pending = 0;
    count++;
  }
  fprintf(stderr, "%llu\n", count);
  return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
