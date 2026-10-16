// Minimal ptrace syscall logger for x86_64 Linux: follows forks, logs path syscalls.
// usage: sysl <outfile> cmd args...
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ptrace.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>

#define MAXP 4096
struct proc {
  pid_t pid;
  int in_syscall;
  long nr;
  char path[4096];
  long flags;
  long total;
  int started;
};
static struct proc procs[MAXP];
static int nprocs;

static struct proc *get(pid_t pid) {
  for (int i = 0; i < nprocs; i++)
    if (procs[i].pid == pid) return &procs[i];
  if (nprocs == MAXP) exit(99);
  struct proc *p = &procs[nprocs++];
  memset(p, 0, sizeof *p);
  p->pid = pid;
  return p;
}

static void read_str(pid_t pid, unsigned long addr, char *out, size_t cap) {
  out[0] = 0;
  if (!addr) return;
  struct iovec local = {out, cap - 1};
  struct iovec remote = {(void *)addr, cap - 1};
  ssize_t n = process_vm_readv(pid, &local, 1, &remote, 1, 0);
  if (n <= 0) {
    // page boundary: read up to the end of the page
    size_t to_end = 4096 - (addr & 4095);
    if (to_end > cap - 1) to_end = cap - 1;
    local.iov_len = remote.iov_len = to_end;
    n = process_vm_readv(pid, &local, 1, &remote, 1, 0);
    if (n <= 0) {
      strcpy(out, "?");
      return;
    }
  }
  out[n] = 0;
  out[strnlen(out, n)] = 0;
}

struct sc {
  long nr;
  const char *name;
  int path_arg; // index of the path argument
  int flags_arg; // index of the flags argument, -1 for none
};
static const struct sc table[] = {
    {2, "open", 0, 1},        {257, "openat", 1, 2},     {437, "openat2", 1, -1},  {4, "stat", 0, -1},
    {6, "lstat", 0, -1},      {262, "newfstatat", 1, -1}, {332, "statx", 1, -1},    {21, "access", 0, -1},
    {269, "faccessat", 1, -1}, {439, "faccessat2", 1, -1}, {89, "readlink", 0, -1},  {267, "readlinkat", 1, -1},
    {80, "chdir", 0, -1},     {83, "mkdir", 0, -1},      {258, "mkdirat", 1, -1},  {87, "unlink", 0, -1},
    {263, "unlinkat", 1, -1}, {82, "rename", 0, -1},     {264, "renameat", 1, -1}, {316, "renameat2", 1, -1},
    {59, "execve", 0, -1},    {88, "symlink", 1, -1},    {266, "symlinkat", 2, -1}, {86, "link", 1, -1},
    {265, "linkat", 3, -1},   {90, "chmod", 0, -1},      {268, "fchmodat", 1, -1}, {76, "truncate", 0, -1},
};

static const struct sc *find(long nr) {
  for (size_t i = 0; i < sizeof table / sizeof table[0]; i++)
    if (table[i].nr == nr) return &table[i];
  return NULL;
}

int main(int argc, char **argv) {
  if (argc < 3) return 2;
  FILE *out = fopen(argv[1], "w");
  if (!out) return 2;
  pid_t child = fork();
  if (child == 0) {
    ptrace(PTRACE_TRACEME, 0, 0, 0);
    raise(SIGSTOP);
    execvp(argv[2], argv + 2);
    _exit(127);
  }
  int status;
  waitpid(child, &status, 0);
  long opts = PTRACE_O_TRACESYSGOOD | PTRACE_O_TRACEFORK | PTRACE_O_TRACEVFORK | PTRACE_O_TRACECLONE |
              PTRACE_O_TRACEEXEC | PTRACE_O_EXITKILL;
  ptrace(PTRACE_SETOPTIONS, child, 0, opts);
  ptrace(PTRACE_SYSCALL, child, 0, 0);
  int exit_code = 0;
  get(child)->started = 1;
  for (;;) {
    pid_t pid = waitpid(-1, &status, __WALL);
    if (pid < 0) {
      if (errno == ECHILD) break;
      continue;
    }
    struct proc *p = get(pid);
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      fprintf(out, "%d EXIT total=%ld\n", pid, p->total);
      if (pid == child) exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
      continue;
    }
    if (!WIFSTOPPED(status)) continue;
    int sig = WSTOPSIG(status);
    int deliver = 0;
    if (sig == (SIGTRAP | 0x80)) {
      struct user_regs_struct regs;
      if (ptrace(PTRACE_GETREGS, pid, 0, &regs) == 0) {
        if (!p->in_syscall) {
          p->in_syscall = 1;
          p->nr = regs.orig_rax;
          p->total++;
          const struct sc *s = find(p->nr);
          p->path[0] = 0;
          p->flags = -1;
          if (s) {
            unsigned long args[6] = {regs.rdi, regs.rsi, regs.rdx, regs.r10, regs.r8, regs.r9};
            read_str(pid, args[s->path_arg], p->path, sizeof p->path);
            if (s->flags_arg >= 0) p->flags = args[s->flags_arg];
          }
        } else {
          p->in_syscall = 0;
          const struct sc *s = find(p->nr);
          if (s && !(p->nr == 59 && (long)regs.rax == 0)) {
            long ret = (long)regs.rax;
            if (p->flags >= 0)
              fprintf(out, "%d %s %ld %s flags=0%lo\n", pid, s->name, ret, p->path, p->flags);
            else
              fprintf(out, "%d %s %ld %s\n", pid, s->name, ret, p->path);
          }
        }
      }
    } else if (sig == SIGTRAP) {
      int event = status >> 16;
      if (event == PTRACE_EVENT_FORK || event == PTRACE_EVENT_VFORK || event == PTRACE_EVENT_CLONE) {
        unsigned long newpid;
        ptrace(PTRACE_GETEVENTMSG, pid, 0, &newpid);
        fprintf(out, "%d FORK %lu\n", pid, newpid);
      } else if (event == PTRACE_EVENT_EXEC) {
        fprintf(out, "%d execve 0 %s\n", pid, p->path);
      }
    } else if (sig == SIGSTOP && !p->started) {
      p->started = 1; // the initial stop of an auto-attached tracee
    } else {
      deliver = sig;
    }
    ptrace(PTRACE_SYSCALL, pid, 0, deliver);
  }
  fclose(out);
  return exit_code;
}
