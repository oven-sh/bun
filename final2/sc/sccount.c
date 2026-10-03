// Counts one syscall number across all threads of a command (ptrace, PTRACE_O_TRACECLONE).
//   cc -O2 -o sccount sccount.c ; sccount <syscall-nr> <binary> [args...]
#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/ptrace.h>
#include <sys/types.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc < 3) return 2;
  long wanted = atol(argv[1]);
  pid_t child = fork();
  if (child == 0) {
    ptrace(PTRACE_TRACEME, 0, 0, 0);
    raise(SIGSTOP);
    execvp(argv[2], argv + 2);
    _exit(127);
  }
  int status;
  waitpid(child, &status, 0);
  ptrace(PTRACE_SETOPTIONS, child, 0, PTRACE_O_TRACESYSGOOD | PTRACE_O_TRACECLONE | PTRACE_O_TRACEFORK | PTRACE_O_TRACEVFORK | PTRACE_O_EXITKILL);
  ptrace(PTRACE_SYSCALL, child, 0, 0);
  long count = 0;
  int live = 1;
  // entry/exit toggle per thread id (small table)
  static pid_t ids[4096]; static char inside[4096]; int n = 0;
  while (live > 0) {
    pid_t pid = waitpid(-1, &status, __WALL);
    if (pid < 0) break;
    if (WIFEXITED(status) || WIFSIGNALED(status)) { if (pid == child) break; continue; }
    int sig = WSTOPSIG(status);
    int deliver = 0;
    if (sig == (SIGTRAP | 0x80)) {
      int i; for (i = 0; i < n; i++) if (ids[i] == pid) break;
      if (i == n && n < 4096) { ids[n] = pid; inside[n] = 0; n++; }
      if (i < 4096) {
        if (!inside[i]) {
          struct user_regs_struct regs;
          if (ptrace(PTRACE_GETREGS, pid, 0, &regs) == 0 && (long)regs.orig_rax == wanted) count++;
        }
        inside[i] = !inside[i];
      }
    } else if (sig == SIGTRAP && (status >> 16)) {
      // clone/fork event: the new thread stops by itself and is continued when it reports
    } else if (sig == SIGSTOP || sig == SIGTRAP) {
      deliver = 0;
    } else {
      deliver = sig;
    }
    ptrace(PTRACE_SYSCALL, pid, 0, deliver);
  }
  fprintf(stderr, "%ld\n", count);
  return 0;
}
