// Keeps the CPUs in a list from going idle: one SCHED_IDLE busy thread pinned to each.
// A SCHED_IDLE task gives way to any normal task at once, and the scheduler still treats its CPU as free
// for placement, so this stands in for a machine whose idle CPUs wake at once (no halt, no deep C-state).
//   keepawake <cpulist> -- cmd args...     runs cmd, then stops
#define _GNU_SOURCE
#include <pthread.h>
#include <sched.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
static void *burn(void *arg) {
  int cpu = (int)(long)arg;
  cpu_set_t s; CPU_ZERO(&s); CPU_SET(cpu, &s);
  pthread_setaffinity_np(pthread_self(), sizeof s, &s);
  struct sched_param p = {0};
  if (sched_setscheduler(0, SCHED_IDLE, &p)) perror("SCHED_IDLE");
  for (;;) __builtin_ia32_pause();
}
int main(int argc, char **argv) {
  if (argc < 4 || strcmp(argv[2], "--")) { fprintf(stderr, "usage: %s cpulist -- cmd...\n", argv[0]); return 2; }
  char *dup = strdup(argv[1]), *tok, *save;
  for (tok = strtok_r(dup, ",", &save); tok; tok = strtok_r(NULL, ",", &save)) {
    int a, b; if (sscanf(tok, "%d-%d", &a, &b) != 2) a = b = atoi(tok);
    for (int i = a; i <= b; i++) { pthread_t t; pthread_create(&t, NULL, burn, (void *)(long)i); }
  }
  usleep(50000);
  pid_t pid = fork();
  if (pid == 0) { execvp(argv[3], argv + 3); perror("exec"); _exit(127); }
  int st; waitpid(pid, &st, 0);
  return WIFEXITED(st) ? WEXITSTATUS(st) : 1;
}
