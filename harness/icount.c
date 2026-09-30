// Counts the user-space instructions the main thread executes between calls of one native function (the marker).
//   cc -O2 -o icount icount.c
//   icount <marker-address-hex> <intervals> <binary> [args...]
// The marker is Bun::functionBunNanoseconds: its address comes from `nm -C bun-profile` (bun and bun-profile have
// the same code at the same addresses). The process runs at full speed until the marker is entered for the first
// time, then it is single-stepped with ptrace. One line per interval: the number of instructions from one entry
// of the marker to the next. After <intervals> intervals the process runs free again.
// No PMU is needed (perf_event_open is not permitted in this container). Other threads are not traced.
#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
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
  if (argc < 4) {
    fprintf(stderr, "usage: icount <marker-address-hex> <intervals> <binary> [args...]\n");
    return 2;
  }
  unsigned long marker = strtoul(argv[1], NULL, 16);
  long intervals = atol(argv[2]);
  pid_t child = fork();
  if (child < 0) die("fork");
  if (child == 0) {
    personality(ADDR_NO_RANDOMIZE);
    if (ptrace(PTRACE_TRACEME, 0, 0, 0) < 0) die("PTRACE_TRACEME");
    execv(argv[3], argv + 3);
    die("execv");
  }
  int status;
  if (waitpid(child, &status, 0) < 0 || !WIFSTOPPED(status)) die("no stop at exec");
  errno = 0;
  long original = ptrace(PTRACE_PEEKTEXT, child, (void *)marker, 0);
  if (errno) die("PEEKTEXT");
  if (ptrace(PTRACE_POKETEXT, child, (void *)marker, (void *)((original & ~0xffL) | 0xcc)) < 0) die("POKETEXT");
  int pending = 0;
  // full speed until the breakpoint
  for (;;) {
    if (ptrace(PTRACE_CONT, child, 0, (void *)(long)pending) < 0) die("PTRACE_CONT");
    if (waitpid(child, &status, 0) < 0) die("waitpid");
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      fprintf(stderr, "icount: the process ended before the marker was called\n");
      return 1;
    }
    int sig = WSTOPSIG(status);
    if (sig == SIGTRAP) {
      struct user_regs_struct regs;
      if (ptrace(PTRACE_GETREGS, child, 0, &regs) < 0) die("GETREGS");
      if (regs.rip == marker + 1) {
        if (ptrace(PTRACE_POKETEXT, child, (void *)marker, (void *)original) < 0) die("POKETEXT restore");
        regs.rip = marker;
        if (ptrace(PTRACE_SETREGS, child, 0, &regs) < 0) die("SETREGS");
        break;
      }
      pending = 0;
    } else {
      pending = sig;
    }
  }
  // single steps from here on; the stop above is at the entry of the marker
  unsigned long long count = 0;
  long done = 0;
  pending = 0;
  while (done < intervals) {
    if (ptrace(PTRACE_SINGLESTEP, child, 0, (void *)(long)pending) < 0) die("PTRACE_SINGLESTEP");
    if (waitpid(child, &status, 0) < 0) die("waitpid");
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      fprintf(stderr, "icount: the process ended after %ld intervals\n", done);
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
    if (rip == marker) {
      printf("%llu\n", count);
      fflush(stdout);
      count = 0;
      done++;
    }
  }
  if (ptrace(PTRACE_DETACH, child, 0, 0) < 0) die("PTRACE_DETACH");
  if (waitpid(child, &status, 0) < 0) die("waitpid");
  return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
