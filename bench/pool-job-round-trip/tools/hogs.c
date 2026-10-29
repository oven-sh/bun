// CPU contention from other programs: <count> busy threads of normal priority, free to run on any CPU of <cpulist>.
//   hogs <count> <cpulist> -- cmd args...     runs cmd (which keeps its own affinity), then stops
#define _GNU_SOURCE
#include <pthread.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
static cpu_set_t set;
static void *burn(void *arg) {
  pthread_setaffinity_np(pthread_self(), sizeof set, &set);
  volatile unsigned long x = 0;
  for (;;) x++;
}
int main(int argc, char **argv) {
  if (argc < 5 || strcmp(argv[3], "--")) { fprintf(stderr, "usage: %s count cpulist -- cmd...\n", argv[0]); return 2; }
  int count = atoi(argv[1]);
  CPU_ZERO(&set);
  char *dup = strdup(argv[2]), *tok, *save;
  for (tok = strtok_r(dup, ",", &save); tok; tok = strtok_r(NULL, ",", &save)) {
    int a, b; if (sscanf(tok, "%d-%d", &a, &b) != 2) a = b = atoi(tok);
    for (int i = a; i <= b; i++) CPU_SET(i, &set);
  }
  pid_t pid = fork();
  if (pid == 0) { execvp(argv[4], argv + 4); perror("exec"); _exit(127); }
  for (int i = 0; i < count; i++) { pthread_t t; pthread_create(&t, NULL, burn, NULL); }
  int st; waitpid(pid, &st, 0);
  return WIFEXITED(st) ? WEXITSTATUS(st) : 1;
}
