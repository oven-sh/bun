// Counts user-space instructions of a command and its descendants with perf_event_open.
#define _GNU_SOURCE
#include <linux/perf_event.h>
#include <sys/syscall.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <stdlib.h>
#include <errno.h>
int main(int argc, char **argv) {
  struct perf_event_attr a; memset(&a, 0, sizeof a);
  a.type = PERF_TYPE_HARDWARE; a.size = sizeof a; a.config = PERF_COUNT_HW_INSTRUCTIONS;
  a.disabled = 1; a.exclude_kernel = 1; a.exclude_hv = 1; a.inherit = 1; a.enable_on_exec = 1;
  int p[2]; pipe(p);
  pid_t pid = fork();
  if (pid == 0) { char c; close(p[1]); read(p[0], &c, 1); execvp(argv[1], argv + 1); perror("exec"); _exit(127); }
  int fd = syscall(SYS_perf_event_open, &a, pid, -1, -1, 0);
  if (fd < 0) { fprintf(stderr, "perf_event_open: %s\n", strerror(errno)); kill(pid, 9); return 2; }
  close(p[0]); write(p[1], "x", 1); close(p[1]);
  int st; waitpid(pid, &st, 0);
  uint64_t n = 0; read(fd, &n, sizeof n);
  fprintf(stderr, "instructions:u %llu\n", (unsigned long long)n);
  return WIFEXITED(st) ? WEXITSTATUS(st) : 1;
}
