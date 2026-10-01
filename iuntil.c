// Counts the user-space instructions that the main thread executes from exec until it first enters one native
// function (the marker), with single steps.
//   cc -O2 -o iuntil iuntil.c
//   iuntil <marker-address-hex> <binary> [args...]
#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/personality.h>
#include <sys/ptrace.h>
#include <sys/types.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>

static void die(const char *what) {
  perror(what);
  exit(2);
}

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: iuntil <marker-address-hex> <binary> [args...]\n");
    return 2;
  }
  unsigned long marker = strtoul(argv[1], NULL, 16);
  pid_t child = fork();
  if (child < 0) die("fork");
  if (child == 0) {
    personality(ADDR_NO_RANDOMIZE);
    if (ptrace(PTRACE_TRACEME, 0, 0, 0) < 0) die("PTRACE_TRACEME");
    execv(argv[2], argv + 2);
    die("execv");
  }
  int status;
  if (waitpid(child, &status, 0) < 0 || !WIFSTOPPED(status)) die("no stop at exec");
  unsigned long long count = 0;
  int pending = 0;
  for (;;) {
    if (ptrace(PTRACE_SINGLESTEP, child, 0, (void *)(long)pending) < 0) die("PTRACE_SINGLESTEP");
    if (waitpid(child, &status, 0) < 0) die("waitpid");
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      fprintf(stderr, "iuntil: the process ended before the marker\n");
      return 1;
    }
    int sig = WSTOPSIG(status);
    if (sig != SIGTRAP) {
      pending = sig;
      continue;
    }
    pending = 0;
    count++;
    errno = 0;
    unsigned long rip = ptrace(PTRACE_PEEKUSER, child, (void *)__builtin_offsetof(struct user_regs_struct, rip), 0);
    if (errno) die("PEEKUSER");
    if (rip == marker) break;
  }
  printf("%llu\n", count);
  kill(child, SIGKILL);
  waitpid(child, &status, 0);
  return 0;
}
