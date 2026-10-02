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
#include <dirent.h>

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

static long n_mkdirat, n_open_dir, n_open_file, n_symlinkat, n_unlinkat, n_fstatat, n_close, n_write, n_failed, n_openat2, n_peak_fds;
#ifndef SYS_openat2
#define SYS_openat2 437
#endif
int main(int argc, char **argv) {
  if (argc < 2) return 2;
  int summary = getenv("ST_SUMMARY") != NULL;
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
        else if (nr == SYS_openat2) name = "openat2";
        unsigned long long how[3] = {0, 0, 0};
        if (nr == SYS_openat2) {
          for (int i = 0; i < 3; i++) { errno = 0; how[i] = (unsigned long long)ptrace(PTRACE_PEEKDATA, pid, regs.rdx + 8 * i, 0); }
          regs.rdx = how[0];
        }
        if (nr == SYS_close) n_close++;
        if (nr == SYS_write || nr == SYS_pwrite64) n_write++;
        if (name && dirfd != AT_FDCWD) {
          long ret = (long)regs.rax;
          if (ret < 0) n_failed++;
          if (nr == SYS_mkdirat) n_mkdirat++;
          else if (nr == SYS_openat || nr == SYS_openat2) {
            if (nr == SYS_openat2) n_openat2++;
            if (regs.rdx & (O_PATH | O_DIRECTORY)) n_open_dir++; else n_open_file++;
            if (getenv("ST_FDS") && ret >= 0) {
              char d[64]; snprintf(d, sizeof d, "/proc/%d/fd", pid);
              long n = 0; DIR *dp = opendir(d); if (dp) { while (readdir(dp)) n++; closedir(dp); n -= 2; }
              if (n > n_peak_fds) n_peak_fds = n;
            }
          }
          else if (nr == SYS_symlinkat) n_symlinkat++;
          else if (nr == SYS_unlinkat) n_unlinkat++;
          else if (nr == SYS_newfstatat) n_fstatat++;
          if (summary) goto next;
          read_str(pid, p, path, sizeof(path));
          if (nr == SYS_openat2)
            fprintf(stderr, "ST %s(%d, \"%s\", 0%lo, resolve=0x%llx) = %ld\n", name, dirfd, path, (unsigned long)regs.rdx, how[2], ret);
          else if (nr == SYS_openat)
            fprintf(stderr, "ST %s(%d, \"%s\", 0%lo) = %ld\n", name, dirfd, path, (unsigned long)regs.rdx, ret);
          else
            fprintf(stderr, "ST %s(%d, \"%s\") = %ld\n", name, dirfd, path, ret);
        }
      }
    next:
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
  fprintf(stderr, "STSUM mkdirat=%ld open_dir=%ld open_file=%ld (openat2=%ld) symlinkat=%ld unlinkat=%ld fstatat=%ld failed=%ld peak_fds=%ld | all close=%ld write=%ld\n",
          n_mkdirat, n_open_dir, n_open_file, n_openat2, n_symlinkat, n_unlinkat, n_fstatat, n_failed, n_peak_fds, n_close, n_write);
  return exit_code;
}
