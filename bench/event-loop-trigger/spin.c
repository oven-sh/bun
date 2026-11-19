// LD_PRELOAD: a client that never sleeps in epoll, so the server's send() has nobody to wake.
#define _GNU_SOURCE
#include <sys/epoll.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

static long long now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000000000LL + ts.tv_nsec;
}

static int spin(int ep, struct epoll_event *events, int max, long long timeout_ns) {
    const long long deadline = now_ns() + timeout_ns;
    int n;
    do {
        n = syscall(SYS_epoll_pwait, ep, events, max, 0, NULL, 0);
    } while (!n && (timeout_ns < 0 || now_ns() < deadline));
    return n;
}

int epoll_wait(int ep, struct epoll_event *events, int max, int timeout_ms) {
    return spin(ep, events, max, timeout_ms * 1000000LL);
}

int epoll_pwait2(int ep, struct epoll_event *events, int max, const struct timespec *timeout, const sigset_t *mask) {
    return spin(ep, events, max, timeout ? timeout->tv_sec * 1000000000LL + timeout->tv_nsec : -1);
}
