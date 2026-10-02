#define _XOPEN_SOURCE 700
#define _DARWIN_C_SOURCE
#include <fcntl.h>
#include <pthread.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/ucontext.h>
#include <time.h>
#include <unistd.h>

enum { capacity = 1 << 16 };
static struct { uint64_t pc, lr, x0, x1, x2; } samples[capacity];
static _Atomic uint64_t written;
static _Atomic int recording;
static pthread_t mainThread;
static const char* out;
static const char* start;

static void handler(int signal, siginfo_t* info, void* context)
{
    (void)signal; (void)info;
    if (!atomic_load_explicit(&recording, memory_order_relaxed))
        return;
    ucontext_t* uc = context;
    uint64_t at = atomic_load_explicit(&written, memory_order_relaxed);
    samples[at % capacity].pc = __darwin_arm_thread_state64_get_pc(uc->uc_mcontext->__ss);
    samples[at % capacity].lr = __darwin_arm_thread_state64_get_lr(uc->uc_mcontext->__ss);
    samples[at % capacity].x0 = uc->uc_mcontext->__ss.__x[0];
    samples[at % capacity].x1 = uc->uc_mcontext->__ss.__x[1];
    samples[at % capacity].x2 = uc->uc_mcontext->__ss.__x[2];
    atomic_store_explicit(&written, at + 1, memory_order_release);
}

static void* sampler(void* unused)
{
    (void)unused;
    int fd = open(out, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    uint64_t flushed = 0;
    struct timespec interval = { 0, 1000000 };
    for (unsigned tick = 0;; ++tick) {
        nanosleep(&interval, NULL);
        if (!atomic_load(&recording)) {
            struct stat st;
            if (!(tick % 16) && !stat(start, &st))
                atomic_store(&recording, 1);
            continue;
        }
        pthread_kill(mainThread, SIGPROF);
        if (tick % 128)
            continue;
        uint64_t end = atomic_load_explicit(&written, memory_order_acquire);
        char line[128];
        for (; flushed < end; ++flushed) {
            int n = snprintf(line, sizeof line, "%llx %llx %llx %llx %llx\n", samples[flushed % capacity].pc, samples[flushed % capacity].lr, samples[flushed % capacity].x0, samples[flushed % capacity].x1, samples[flushed % capacity].x2);
            if (write(fd, line, n) < 0)
                return NULL;
        }
    }
}

__attribute__((constructor)) static void initialize(void)
{
    const char* name = getenv("LRPROBE_NAME");
    out = getenv("LRPROBE_OUT");
    start = getenv("LRPROBE_START");
    unsetenv("DYLD_INSERT_LIBRARIES");
    if (!name || !out || !start || strncmp(getprogname(), name, strlen(name)))
        return;
    out = strdup(out);
    start = strdup(start);
    unsetenv("LRPROBE_OUT");
    mainThread = pthread_self();
    struct sigaction action;
    memset(&action, 0, sizeof action);
    action.sa_sigaction = handler;
    action.sa_flags = SA_SIGINFO | SA_RESTART;
    sigemptyset(&action.sa_mask);
    sigaction(SIGPROF, &action, NULL);
    pthread_t thread;
    pthread_create(&thread, NULL, sampler, NULL);
    pthread_detach(thread);
}
