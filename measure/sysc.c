// Counts the syscalls of a command and its threads (not of the processes it spawns), like strace -c.
#define _GNU_SOURCE
#include <sys/ptrace.h>
#include <sys/wait.h>
#include <sys/user.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <errno.h>
static long counts[512];
#define MAXT 4096
static int in_sys[MAXT]; static pid_t tids[MAXT]; static int nt;
static int *slot(pid_t t) { for (int i = 0; i < nt; i++) if (tids[i] == t) return &in_sys[i]; tids[nt] = t; in_sys[nt] = 0; return &in_sys[nt++]; }
int main(int argc, char **argv) {
  pid_t pid = fork();
  if (pid == 0) { ptrace(PTRACE_TRACEME, 0, 0, 0); raise(SIGSTOP); execvp(argv[1], argv + 1); _exit(127); }
  int st; waitpid(pid, &st, 0);
  ptrace(PTRACE_SETOPTIONS, pid, 0, PTRACE_O_TRACESYSGOOD | PTRACE_O_TRACECLONE | PTRACE_O_TRACEEXEC);
  ptrace(PTRACE_SYSCALL, pid, 0, 0);
  int code = 0;
  for (;;) {
    pid_t t = waitpid(-1, &st, __WALL);
    if (t < 0) break;
    if (WIFEXITED(st) || WIFSIGNALED(st)) { if (t == pid) { code = WIFEXITED(st) ? WEXITSTATUS(st) : 1; break; } continue; }
    int sig = 0;
    if (WIFSTOPPED(st)) {
      int s = WSTOPSIG(st);
      if (s == (SIGTRAP | 0x80)) {
        int *in = slot(t);
        if (!*in) { struct user_regs_struct r; if (ptrace(PTRACE_GETREGS, t, 0, &r) == 0 && r.orig_rax < 512) counts[r.orig_rax]++; }
        *in = !*in;
      } else if (s == SIGTRAP && (st >> 16) != 0) { /* clone/exec event */ }
      else if (s == SIGSTOP && (st >> 16) == 0) { /* new thread's initial stop, or a real SIGSTOP */ }
      else sig = s;
    }
    ptrace(PTRACE_SYSCALL, t, 0, sig);
  }
  static const struct { int n; const char *name; } names[] = { {0,"read"},{1,"write"},{7,"poll"},{19,"readv"},{45,"recvfrom"},{47,"recvmsg"},{232,"epoll_wait"},{233,"epoll_ctl"},{281,"epoll_pwait"},{441,"epoll_pwait2"},{271,"ppoll"},{202,"futex"},{9,"mmap"},{11,"munmap"},{28,"madvise"},{17,"pread64"},{44,"sendto"},{46,"sendmsg"},{20,"writev"},{3,"close"} };
  long total = 0; for (int i = 0; i < 512; i++) total += counts[i];
  fprintf(stderr, "SYSC total=%ld", total);
  for (unsigned i = 0; i < sizeof names / sizeof *names; i++) if (counts[names[i].n]) fprintf(stderr, " %s=%ld", names[i].name, counts[names[i].n]);
  fprintf(stderr, "\n");
  return code;
}
