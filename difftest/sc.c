// Minimal `strace -fc`: counts syscalls of a command and all its threads/children.
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <errno.h>
#include <unistd.h>
#include <sys/ptrace.h>
#include <sys/wait.h>
#include <sys/user.h>
#include <sys/syscall.h>

static long counts[1024];
static const struct { int nr; const char *name; } names[] = {
  {SYS_openat, "openat"}, {SYS_openat2, "openat2"}, {SYS_open, "open"}, {SYS_close, "close"},
  {SYS_mkdirat, "mkdirat"}, {SYS_mkdir, "mkdir"}, {SYS_symlinkat, "symlinkat"},
  {SYS_unlinkat, "unlinkat"}, {SYS_write, "write"}, {SYS_pwrite64, "pwrite64"},
  {SYS_newfstatat, "newfstatat"}, {SYS_fstat, "fstat"}, {SYS_statx, "statx"},
  {SYS_ftruncate, "ftruncate"}, {SYS_fallocate, "fallocate"}, {SYS_lseek, "lseek"},
  {SYS_fchmod, "fchmod"}, {SYS_fchmodat, "fchmodat"}, {SYS_utimensat, "utimensat"},
};

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  pid_t child = fork();
  if (child == 0) {
    ptrace(PTRACE_TRACEME, 0, 0, 0);
    raise(SIGSTOP);
    execvp(argv[1], argv + 1);
    perror("execvp");
    _exit(127);
  }
  int status;
  waitpid(child, &status, 0);
  long opts = PTRACE_O_TRACESYSGOOD | PTRACE_O_TRACECLONE | PTRACE_O_TRACEFORK | PTRACE_O_TRACEVFORK | PTRACE_O_EXITKILL;
  if (ptrace(PTRACE_SETOPTIONS, child, 0, opts) != 0) { perror("PTRACE_SETOPTIONS"); return 3; }
  ptrace(PTRACE_SYSCALL, child, 0, 0);
  int live = 1, exit_code = 0;
  // Per-tid "in syscall" toggle: count on syscall-enter stops only.
  static unsigned char in_sys[4194304];
  while (live > 0) {
    pid_t pid = waitpid(-1, &status, __WALL);
    if (pid < 0) { if (errno == ECHILD) break; continue; }
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      if (pid == child) exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
      live--;
      continue;
    }
    if (!WIFSTOPPED(status)) continue;
    int sig = WSTOPSIG(status);
    int inject = 0;
    if (sig == (SIGTRAP | 0x80)) {
      unsigned idx = (unsigned)pid % sizeof(in_sys);
      if (!in_sys[idx]) {
        struct user_regs_struct regs;
        if (ptrace(PTRACE_GETREGS, pid, 0, &regs) == 0 && regs.orig_rax < 1024) counts[regs.orig_rax]++;
      }
      in_sys[idx] = !in_sys[idx];
    } else if (sig == SIGTRAP) {
      int ev = status >> 16;
      if (ev == PTRACE_EVENT_CLONE || ev == PTRACE_EVENT_FORK || ev == PTRACE_EVENT_VFORK) live++;
    } else if (sig == SIGSTOP) {
      // initial stop of a new tracee
    } else {
      inject = sig;
    }
    ptrace(PTRACE_SYSCALL, pid, 0, inject);
  }
  long total = 0;
  for (int i = 0; i < 1024; i++) total += counts[i];
  fprintf(stderr, "SC total=%ld", total);
  for (unsigned i = 0; i < sizeof(names) / sizeof(names[0]); i++)
    if (counts[names[i].nr]) fprintf(stderr, " %s=%ld", names[i].name, counts[names[i].nr]);
  fprintf(stderr, "\n");
  return exit_code;
}
