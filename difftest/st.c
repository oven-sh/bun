// Minimal strace for the *at calls that take a directory fd other than AT_FDCWD.
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <errno.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ptrace.h>
#include <sys/wait.h>
#include <sys/user.h>
#include <sys/syscall.h>

static void read_str(pid_t pid, unsigned long addr, char *out, size_t cap) {
  size_t n = 0;
  while (n + sizeof(long) < cap) {
    errno = 0;
    long w = ptrace(PTRACE_PEEKDATA, pid, addr + n, 0);
    if (errno) break;
    memcpy(out + n, &w, sizeof(long));
    if (memchr(&w, 0, sizeof(long))) { n += strlen((char *)&w); out[n] = 0; return; }
    n += sizeof(long);
  }
  out[n] = 0;
}

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
  static unsigned char in_sys[4194304];
  static char pending[4194304 / 64][0]; (void)pending;
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
      struct user_regs_struct regs;
      if (in_sys[idx] && ptrace(PTRACE_GETREGS, pid, 0, &regs) == 0) {
        long nr = regs.orig_rax;
        int dirfd = (int)regs.rdi;
        char path[4200];
        const char *name = NULL;
        unsigned long p = regs.rsi;
        if (nr == SYS_mkdirat) name = "mkdirat";
        else if (nr == SYS_openat) name = "openat";
        else if (nr == SYS_unlinkat) name = "unlinkat";
        else if (nr == SYS_newfstatat) name = "newfstatat";
        else if (nr == SYS_symlinkat) { name = "symlinkat"; dirfd = (int)regs.rsi; p = regs.rdx; }
        if (name && dirfd != AT_FDCWD) {
          read_str(pid, p, path, sizeof(path));
          long ret = (long)regs.rax;
          if (nr == SYS_openat)
            fprintf(stderr, "ST %s(%d, \"%s\", 0%lo) = %ld\n", name, dirfd, path, (unsigned long)regs.rdx, ret);
          else
            fprintf(stderr, "ST %s(%d, \"%s\") = %ld\n", name, dirfd, path, ret);
        }
      }
      in_sys[idx] = !in_sys[idx];
    } else if (sig == SIGTRAP) {
      int ev = status >> 16;
      if (ev == PTRACE_EVENT_CLONE || ev == PTRACE_EVENT_FORK || ev == PTRACE_EVENT_VFORK) live++;
    } else if (sig == SIGSTOP) {
    } else {
      inject = sig;
    }
    ptrace(PTRACE_SYSCALL, pid, 0, inject);
  }
  return exit_code;
}
