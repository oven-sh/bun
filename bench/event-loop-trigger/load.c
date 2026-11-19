// The loads wrk cannot make.
//   load ws   <port> <connections> <threads> <seconds>          closed-loop 64-byte WebSocket echo
//   load rate <port> <connections> <threads> <seconds> <req/s>  GET /hello at a fixed rate; latency counts from when the request was due
//   load idle <port> <connections>                              opens WebSockets, prints "ready", holds them until killed
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <netinet/tcp.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define STUCK_NS 1000000000 /* unanswered for this long at the end of the run: an error */
#define BUCKETS 2000000 /* 1 µs each; the last one holds everything slower */
#define WS_PAYLOAD 64

struct conn { int fd; int got; uint64_t due; /* 0 with nothing in flight */ };
struct worker { pthread_t thread; int index, count; uint64_t done, stuck, total_us; uint32_t *histogram; };

static enum { WS, RATE, IDLE } mode;
static int port, threads = 1, seconds, rate;
static pthread_barrier_t connected;

static const char get_hello[] = "GET /hello HTTP/1.1\r\nHost: localhost\r\n\r\n";
static const char upgrade[] =
    "GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n";
static const unsigned char ws_frame[6 + WS_PAYLOAD] = {0x82, 0x80 | WS_PAYLOAD}; /* zero mask key */

static uint64_t now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t) ts.tv_sec * 1000000000 + ts.tv_nsec;
}

static void die(const char *what) {
    perror(what);
    exit(1);
}

static void send_all(int fd, const void *data, size_t length) {
    if (write(fd, data, length) != (ssize_t) length) die("write");
}

/* Sends `request` and reads up to `end`. Returns how long the response was. */
static int exchange(int fd, const char *request, const char *status, const char *end) {
    char response[1024];
    size_t length = 0;
    send_all(fd, request, strlen(request));
    while (!memmem(response, length, end, strlen(end))) {
        ssize_t n = read(fd, response + length, sizeof response - length);
        if (n <= 0) die("first exchange");
        length += n;
    }
    if (memcmp(response, status, strlen(status))) { errno = EPROTO; die(status); }
    return length;
}

static void *run(void *arg) {
    struct worker *w = arg;
    struct conn *conns = calloc(w->count, sizeof *conns);
    struct conn **free_conns = calloc(w->count, sizeof *free_conns);
    int num_free = 0, reply_length = 2 + WS_PAYLOAD, ep = epoll_create1(0);
    prctl(PR_SET_TIMERSLACK, 1);

    for (int i = 0; i < w->count; i++) {
        int fd = conns[i].fd = socket(AF_INET, SOCK_STREAM, 0), one = 1;
        struct sockaddr_in addr = {.sin_family = AF_INET, .sin_port = htons(port), .sin_addr.s_addr = htonl(INADDR_LOOPBACK)};
        if (fd < 0 || connect(fd, (struct sockaddr *) &addr, sizeof addr)) die("connect");
        setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
        if (mode == RATE) reply_length = exchange(fd, get_hello, "HTTP/1.1 200", "World!");
        else exchange(fd, upgrade, "HTTP/1.1 101", "\r\n\r\n");
        struct epoll_event event = {.events = EPOLLIN, .data.ptr = &conns[i]};
        epoll_ctl(ep, EPOLL_CTL_ADD, fd, &event);
        free_conns[num_free++] = &conns[i];
    }
    pthread_barrier_wait(&connected);
    if (mode == IDLE) for (;;) pause();

    const uint64_t start = now_ns(), deadline = start + (uint64_t) seconds * 1000000000;
    const uint64_t interval = mode == RATE ? (uint64_t) threads * 1000000000 / rate : 0;
    uint64_t next_due = start + interval * w->index / threads;
    unsigned next_free = 0;
    struct epoll_event events[256];
    for (uint64_t now = start; now < deadline; now = now_ns()) {
        while (num_free && next_due <= now) {
            unsigned pick = next_free++ % num_free;
            struct conn *c = free_conns[pick];
            free_conns[pick] = free_conns[--num_free];
            if (mode == RATE) {
                c->due = next_due;
                next_due += interval;
                send_all(c->fd, get_hello, sizeof get_hello - 1);
            } else {
                c->due = now;
                send_all(c->fd, ws_frame, sizeof ws_frame);
            }
        }
        now = now_ns();
        uint64_t wait = mode == RATE && num_free ? (next_due > now ? next_due - now : 0) : 100000000;
        struct timespec timeout = {wait / 1000000000, wait % 1000000000};
        int n = epoll_pwait2(ep, events, 256, &timeout, NULL);
        for (int i = 0; i < n; i++) {
            struct conn *c = events[i].data.ptr;
            char buffer[1024];
            ssize_t got = recv(c->fd, buffer, sizeof buffer, MSG_DONTWAIT);
            if (got <= 0) die("recv");
            if ((c->got += got) < reply_length) continue;
            c->got = 0;
            uint64_t at = now_ns(), took = (at - c->due) / 1000;
            w->histogram[took < BUCKETS ? took : BUCKETS - 1]++;
            w->total_us += took;
            w->done++;
            if (mode == WS) {
                c->due = at;
                send_all(c->fd, ws_frame, sizeof ws_frame);
            } else {
                c->due = 0;
                free_conns[num_free++] = c;
            }
        }
    }
    for (int i = 0; i < w->count; i++) w->stuck += conns[i].due && conns[i].due + STUCK_NS < deadline;
    return NULL;
}

int main(int argc, char **argv) {
    if (argc < 4) return 2;
    mode = !strcmp(argv[1], "ws") ? WS : !strcmp(argv[1], "rate") ? RATE : IDLE;
    if (argc != (mode == WS ? 6 : mode == RATE ? 7 : 4)) return 2;
    port = atoi(argv[2]);
    int connections = atoi(argv[3]);
    if (mode != IDLE) threads = atoi(argv[4]), seconds = atoi(argv[5]);
    if (mode == RATE) rate = atoi(argv[6]);

    pthread_barrier_init(&connected, NULL, threads + 1);
    struct worker *workers = calloc(threads, sizeof *workers);
    for (int i = 0; i < threads; i++) {
        workers[i].index = i;
        workers[i].count = connections / threads + (i < connections % threads);
        workers[i].histogram = calloc(BUCKETS, sizeof(uint32_t));
        pthread_create(&workers[i].thread, NULL, run, &workers[i]);
    }
    pthread_barrier_wait(&connected);
    if (mode == IDLE) puts("ready"), fflush(stdout);

    uint64_t total = 0, seen = 0, stuck = 0, total_us = 0;
    for (int i = 0; i < threads; i++) {
        pthread_join(workers[i].thread, NULL);
        total += workers[i].done;
        stuck += workers[i].stuck;
        total_us += workers[i].total_us;
    }
    int p50 = -1, p99 = -1;
    for (int b = 0; b < BUCKETS && p99 < 0; b++) {
        for (int i = 0; i < threads; i++) seen += workers[i].histogram[b];
        if (p50 < 0 && seen * 2 >= total) p50 = b;
        if (seen * 100 >= total * 99) p99 = b;
    }
    printf("{\"requests\":%llu,\"seconds\":%d,\"mean\":%f,\"p50\":%d,\"p99\":%d,\"errors\":%llu}\n",
           (unsigned long long) total, seconds, (double) total_us / total, p50, p99, (unsigned long long) stuck);
    return 0;
}
