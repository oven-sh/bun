// Counts the user-space instructions of the first call of one native function on the main thread, callees
// included: from its entry to the return to its caller, with single steps.
//   cc -O2 -o ifunc ifunc.c
//   ifunc <function-address-hex> <binary> [args...]
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
    fprintf(stderr, "usage: ifunc <function-address-hex> <binary> [args...]\n");
    return 2;
  }
  unsigned long entry = strtoul(argv[1], NULL, 16);
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
  errno = 0;
  long original = ptrace(PTRACE_PEEKTEXT, child, (void *)entry, 0);
  if (errno) die("PEEKTEXT");
  if (ptrace(PTRACE_POKETEXT, child, (void *)entry, (void *)((original & ~0xffL) | 0xcc)) < 0) die("POKETEXT");
  int pending = 0;
  struct user_regs_struct regs;
  for (;;) {
    if (ptrace(PTRACE_CONT, child, 0, (void *)(long)pending) < 0) die("PTRACE_CONT");
    if (waitpid(child, &status, 0) < 0) die("waitpid");
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      fprintf(stderr, "ifunc: the process ended before the function was called\n");
      return 1;
    }
    int sig = WSTOPSIG(status);
    if (sig == SIGTRAP) {
      if (ptrace(PTRACE_GETREGS, child, 0, &regs) < 0) die("GETREGS");
      if (regs.rip == entry + 1) {
        if (ptrace(PTRACE_POKETEXT, child, (void *)entry, (void *)original) < 0) die("POKETEXT restore");
        regs.rip = entry;
        if (ptrace(PTRACE_SETREGS, child, 0, &regs) < 0) die("SETREGS");
        break;
      }
      pending = 0;
    } else {
      pending = sig;
    }
  }
  unsigned long entryRsp = regs.rsp;
  errno = 0;
  unsigned long returnAddress = ptrace(PTRACE_PEEKDATA, child, (void *)entryRsp, 0);
  if (errno) die("PEEKDATA");
  unsigned long long count = 0;
  pending = 0;
  for (;;) {
    if (ptrace(PTRACE_SINGLESTEP, child, 0, (void *)(long)pending) < 0) die("PTRACE_SINGLESTEP");
    if (waitpid(child, &status, 0) < 0) die("waitpid");
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      fprintf(stderr, "ifunc: the process ended inside the function\n");
      return 1;
    }
    int sig = WSTOPSIG(status);
    if (sig != SIGTRAP) {
      pending = sig;
      continue;
    }
    pending = 0;
    count++;
    if (ptrace(PTRACE_GETREGS, child, 0, &regs) < 0) die("GETREGS");
    if (regs.rip == returnAddress && regs.rsp == entryRsp + 8) break;
  }
  printf("%llu\n", count);
  kill(child, SIGKILL);
  waitpid(child, &status, 0);
  return 0;
}
