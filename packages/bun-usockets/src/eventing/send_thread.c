/* Takes send() out from between the handlers of a busy loop. See us_socket_write_soon.
 *
 * Queued sends leave in batches, which keeps both the kernel's code and ours in cache for longer. A second thread
 * bounds how long a slow handler holds them up. While the loop is saturated and there is a CPU to spare, that thread
 * sends them as they come. */

#include "libusockets.h"
#include "internal/internal.h"
#include "internal/fault_inject.h"

#ifdef LIBUS_USE_EPOLL

#include <errno.h>
#include <linux/futex.h>
#include <pthread.h>
#include <sched.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#define NUM_SENDS 512
#define ARENA_SIZE (512 * 1024)
#define MAX_PARALLEL_LENGTH (32 * 1024)
#define MAX_BATCHED_LENGTH (4 * 1024)
#define MAX_BATCH 64
/* us_poll_t::read_ahead has 5 bits. */
#define NUM_READS 31
/* How many more sends a tick has to promise to be worth waking the thread for. */
#define WORTH_WAKING 4
#define WORTH_ENDING_A_DOZE 8

#define US 1000ULL
#define MS 1000000ULL
#define BATCH_AGE_NS (200 * US)
#define WATCH_NS (1 * MS)
#define SPIN_NS (50 * US)
#define WINDOW_NS (10 * MS)
#define LEFTOVER_NS (10000 * MS)
#define MIN_BACKOFF_NS (100 * MS)
#define MAX_BACKOFF_NS (10000 * MS)

enum { SEND_FREE, SEND_QUEUED, SEND_CLAIMED, SEND_DONE };

struct us_send_t {
    /* Whoever moves it from SEND_QUEUED to SEND_CLAIMED calls send(). */
    alignas(64) unsigned int state;
    int fd;
    int length;
    /* Bytes, or -errno. */
    int result;
    /* A FIN follows. */
    int is_last;
    /* Of such a send: the second to set it, out of the sender and the loop closing the socket, closes `fd`. */
    unsigned int done_with_fd;
    const char *data;
    /* NULL once it closed. */
    struct us_socket_t *socket;
    us_unsent_cb unsent;
};

enum { AWAKE, PARKED, WATCHING };

struct us_send_thread_t {
    struct us_send_t sends[NUM_SENDS];

    /* These count up for good. `tail` is written by the loop, `head` by both. */
    alignas(64) unsigned int tail;
    alignas(64) unsigned int head;

    alignas(64) unsigned int sleep;
    unsigned int parallel;
    /* In parallel, with too little to send to spin for it: woken for several sends at a time. */
    unsigned int dozes;
    unsigned int stop;

    /* The thread's own, read once per window. */
    alignas(64) uint64_t slept_ns, spun_ns, asleep_since, sent;

    /* The loop's own. Everything in front of `settled` is SEND_FREE. */
    alignas(64) unsigned int settled;
    unsigned int arena_used;
    int has_thread, active, saw_burst;
    uint64_t batch_started;
    uint64_t wait_started, waited_ns;
    struct {
        uint64_t started, loop_cpu, thread_cpu, slept, spun, sent;
        unsigned int tail;
    } window;
    uint64_t parallel_since, no_parallel_until, backoff_ns;
    int contended_windows;
    clockid_t thread_clock;
    pthread_t thread;
    struct us_send_thread_t *next;

    struct {
        /* NULL once taken, or closed. */
        struct us_socket_t *socket;
        /* Bytes, or -errno. */
        int result;
    } reads[NUM_READS];
    int read_ahead_to;

    char arena[ARENA_SIZE];
    char read_buffers[NUM_READS][LIBUS_RECV_BUFFER_PADDING + LIBUS_READ_AHEAD_LENGTH + LIBUS_RECV_BUFFER_PADDING];
};

static enum {
    MODE_OFF,
    /* "auto" */
    MODE_AUTO,
    /* "batch" and "parallel": for every send, whatever it costs. */
    MODE_BATCH,
    MODE_PARALLEL,
} mode;
static int has_several_cpus;

static pthread_mutex_t all_lock = PTHREAD_MUTEX_INITIALIZER;
static struct us_send_thread_t *all;

extern void Bun__atexit(void (*)(void));
extern int WTF__numberOfProcessorCores(void);

#define LOAD(x) __atomic_load_n(&(x), __ATOMIC_SEQ_CST)
#define STORE(x, value) __atomic_store_n(&(x), (value), __ATOMIC_SEQ_CST)

static inline void cpu_relax(void) {
#if defined(__x86_64__)
    __builtin_ia32_pause();
#elif defined(__aarch64__)
    __asm__ __volatile__("isb");
#endif
}

static uint64_t clock_ns(clockid_t clock) {
    struct timespec ts = {0, 0};
    clock_gettime(clock, &ts);
    return (uint64_t) ts.tv_sec * 1000000000ULL + (uint64_t) ts.tv_nsec;
}

static void run(struct us_send_t *op) {
    unsigned int queued = SEND_QUEUED;
    if (!__atomic_compare_exchange_n(&op->state, &queued, SEND_CLAIMED, 0, __ATOMIC_ACQUIRE, __ATOMIC_RELAXED)) return;
    ssize_t rc;
    do {
        rc = send(op->fd, op->data, (size_t) op->length, MSG_NOSIGNAL | MSG_DONTWAIT | (op->is_last ? MSG_MORE : 0));
    } while (rc == -1 && errno == EINTR);
    op->result = rc < 0 ? -errno : (int) rc;
    if (op->is_last && rc == op->length) {
        /* Even ahead of close(), which drops what MSG_MORE holds back if there is unread input. */
        shutdown(op->fd, SHUT_WR);
        if (__atomic_exchange_n(&op->done_with_fd, 1, __ATOMIC_SEQ_CST)) close(op->fd);
    }
    __atomic_store_n(&op->state, SEND_DONE, __ATOMIC_RELEASE);
}

static int run_next(struct us_send_thread_t *t) {
    unsigned int head = LOAD(t->head);
    if (head == LOAD(t->tail)) return 0;
    if (__atomic_compare_exchange_n(&t->head, &head, head + 1, 0, __ATOMIC_SEQ_CST, __ATOMIC_RELAXED)) {
        run(&t->sends[head % NUM_SENDS]);
    }
    return 1;
}

static void wait_for(struct us_send_t *op) {
    run(op);
    for (int spins = 0; __atomic_load_n(&op->state, __ATOMIC_ACQUIRE) == SEND_CLAIMED; spins++) {
        if (spins < 200) cpu_relax();
        else sched_yield();
    }
}

static void wake(struct us_send_thread_t *t) {
    if (__atomic_exchange_n(&t->sleep, AWAKE, __ATOMIC_SEQ_CST) != AWAKE) {
        syscall(SYS_futex, &t->sleep, FUTEX_WAKE_PRIVATE, 1, NULL, NULL, 0);
    }
}

static void thread_sleep(struct us_send_thread_t *t, unsigned int how) {
    static const struct timespec watch = {0, WATCH_NS};
    const uint64_t since = us_internal_monotonic_ns();
    STORE(t->asleep_since, since);
    STORE(t->sleep, how);
    if (!LOAD(t->stop) && (how == WATCHING ? !LOAD(t->parallel) || LOAD(t->dozes) : LOAD(t->head) == LOAD(t->tail))) {
        syscall(SYS_futex, &t->sleep, FUTEX_WAIT_PRIVATE, how, how == WATCHING ? &watch : NULL, NULL, 0);
    }
    STORE(t->sleep, AWAKE);
    STORE(t->asleep_since, 0);
    STORE(t->slept_ns, t->slept_ns + (us_internal_monotonic_ns() - since));
}

static int thread_spin(struct us_send_thread_t *t) {
    const uint64_t since = us_internal_monotonic_ns();
    uint64_t now = since;
    int has_work = 0;
    while (!has_work && now - since < SPIN_NS) {
        for (int i = 0; i < 16 && !has_work; i++) {
            cpu_relax();
            has_work = LOAD(t->head) != LOAD(t->tail);
        }
        now = us_internal_monotonic_ns();
    }
    STORE(t->spun_ns, t->spun_ns + (now - since));
    return has_work;
}

static void *thread_main(void *arg) {
    struct us_send_thread_t *t = arg;
    while (!LOAD(t->stop)) {
        if (LOAD(t->parallel)) {
            uint64_t sent = 0;
            while (run_next(t)) sent++;
            STORE(t->sent, t->sent + sent);
            if (!LOAD(t->dozes)) {
                if (!thread_spin(t)) thread_sleep(t, PARKED);
                continue;
            }
        }
        const unsigned int overdue = LOAD(t->tail);
        thread_sleep(t, WATCHING);
        while ((int) (overdue - LOAD(t->head)) > 0) run_next(t);
        if (LOAD(t->tail) == overdue) thread_sleep(t, PARKED);
    }
    return NULL;
}

void us_send_everything_queued(void) {
    pthread_mutex_lock(&all_lock);
    for (struct us_send_thread_t *t = all; t; t = t->next) {
        for (int i = 0; i < NUM_SENDS; i++) wait_for(&t->sends[i]);
    }
    pthread_mutex_unlock(&all_lock);
}

static void read_mode(void) {
    const char *name = getenv("BUN_USOCKETS_SEND");
    if (!name) return;
    if (!strcmp(name, "batch")) mode = MODE_BATCH;
    else if (!strcmp(name, "auto")) mode = MODE_AUTO;
    else if (!strcmp(name, "parallel")) mode = MODE_PARALLEL;
    else fprintf(stderr, "warn: ignoring BUN_USOCKETS_SEND=%s\n", name);
    if (!mode) return;
    has_several_cpus = WTF__numberOfProcessorCores() > 1;
    Bun__atexit(us_send_everything_queued);
}

void us_internal_send_thread_init(void) {
    static pthread_once_t once = PTHREAD_ONCE_INIT;
    pthread_once(&once, read_mode);
}

static struct us_send_thread_t *create(struct us_loop_t *loop) {
    struct us_send_thread_t *t;
    if (posix_memalign((void **) &t, 64, sizeof(*t))) return NULL;
    memset(t, 0, offsetof(struct us_send_thread_t, arena));
    t->parallel = mode == MODE_PARALLEL;
    t->backoff_ns = MIN_BACKOFF_NS;
    pthread_mutex_lock(&all_lock);
    t->next = all;
    all = t;
    pthread_mutex_unlock(&all_lock);
    return loop->send_thread = t;
}

static void activate(struct us_send_thread_t *t) {
    if (!t->has_thread) {
        sigset_t blocked, old;
        sigfillset(&blocked);
        pthread_sigmask(SIG_SETMASK, &blocked, &old);
        t->has_thread = pthread_create(&t->thread, NULL, thread_main, t) == 0;
        pthread_sigmask(SIG_SETMASK, &old, NULL);
        if (!t->has_thread) return;
        pthread_setname_np(t->thread, "Bun Send");
        pthread_getcpuclockid(t->thread, &t->thread_clock);
    }
    t->active = 1;
}

void us_internal_send_thread_free(struct us_loop_t *loop) {
    struct us_send_thread_t *t = loop->send_thread;
    if (!t) return;
    pthread_mutex_lock(&all_lock);
    struct us_send_thread_t **link = &all;
    while (*link != t) link = &(*link)->next;
    *link = t->next;
    pthread_mutex_unlock(&all_lock);
    while (run_next(t)) {}
    if (t->has_thread) {
        STORE(t->stop, 1);
        wake(t);
        pthread_join(t->thread, NULL);
    }
    free(t);
}

/* What the kernel refused of the last send of a socket that has closed since. */
struct leftover {
    struct us_internal_callback_t poll;
    uint64_t deadline;
    int offset, length;
    char data[];
};

static void send_leftover(struct us_internal_callback_t *poll) {
    struct leftover *l = (struct leftover *) poll;
    const int fd = us_poll_fd(&poll->p);
    const ssize_t sent = bsd_send(fd, l->data + l->offset, l->length - l->offset);
    if (sent > 0) l->offset += sent;
    if (l->offset == l->length) {
        shutdown(fd, SHUT_WR);
    } else if ((sent >= 0 || bsd_would_block() || bsd_send_is_transient_error()) && us_internal_monotonic_ns() < l->deadline) {
        return;
    } else {
        setsockopt(fd, SOL_SOCKET, SO_LINGER, &(struct linger) {1, 0}, sizeof(struct linger));
    }
    us_poll_stop(&poll->p, poll->loop);
    close(fd);
    us_poll_free(&poll->p, poll->loop);
}

static void keep_leftover(struct us_loop_t *loop, int fd, const char *data, int length) {
    struct leftover *l = (struct leftover *) us_create_poll(loop, 0, sizeof(*l) - sizeof(struct us_poll_t) + (size_t) length);
    us_poll_init(&l->poll.p, fd, POLL_TYPE_CALLBACK);
    l->poll.loop = loop;
    l->poll.cb_expects_the_loop = 0;
    l->poll.leave_poll_ready = 1;
    l->poll.cb = send_leftover;
    l->deadline = us_internal_monotonic_ns() + LEFTOVER_NS;
    l->offset = 0;
    l->length = length;
    memcpy(l->data, data, (size_t) length);
    if (us_poll_start_rc(&l->poll.p, loop, LIBUS_SOCKET_WRITABLE) != 0) {
        l->deadline = 0;
        send_leftover(&l->poll);
    }
}

/* Returns whether the kernel refused some of it. */
static int settle(struct us_loop_t *loop, struct us_send_t *op) {
    wait_for(op);
    __atomic_store_n(&op->state, SEND_FREE, __ATOMIC_RELAXED);
    struct us_socket_t *s = op->socket;
    if (s) s->p.send_in_flight = 0;
    if (LIKELY(op->result == op->length)) return 0;
    const int written = op->result < 0 ? 0 : op->result;
    if (!s) {
        keep_leftover(loop, op->fd, op->data + written, op->length - written);
        return 1;
    }
    s->p.fin_sent = 0;
    op->unsent(s, op->data + written, op->length - written);
    errno = -op->result;
    us_internal_socket_send_was_short(s, op->result < 0 ? -1 : written);
    return 1;
}

int us_internal_socket_settle(struct us_socket_t *s) {
    struct us_loop_t *loop = s->group->loop;
    s->p.settled_early_at = (unsigned char) loop->data.iteration_nr;
    return settle(loop, &loop->send_thread->sends[s->p.send_in_flight - 1]);
}

int us_internal_socket_close_fd_soon(struct us_socket_t *s) {
    if (!s->p.send_in_flight) return 0;
    struct us_send_t *op = &s->group->loop->send_thread->sends[s->p.send_in_flight - 1];
    s->p.send_in_flight = 0;
    op->socket = NULL;
    return !__atomic_exchange_n(&op->done_with_fd, 1, __ATOMIC_SEQ_CST);
}

static void settle_all(struct us_loop_t *loop) {
    struct us_send_thread_t *t = loop->send_thread;
    while (t->settled != t->tail) {
        while (run_next(t)) {}
        struct us_send_t *op = &t->sends[t->settled++ % NUM_SENDS];
        if (__atomic_load_n(&op->state, __ATOMIC_RELAXED) != SEND_FREE) settle(loop, op);
    }
    t->arena_used = 0;
}

static void choose_how_to_send(struct us_send_thread_t *t, uint64_t now) {
    const uint64_t asleep_since = LOAD(t->asleep_since);
    const uint64_t loop_cpu = clock_ns(CLOCK_THREAD_CPUTIME_ID), thread_cpu = t->has_thread ? clock_ns(t->thread_clock) : 0;
    const uint64_t slept = LOAD(t->slept_ns) + (asleep_since && asleep_since < now ? now - asleep_since : 0);
    const uint64_t spun = LOAD(t->spun_ns), sent = LOAD(t->sent);

    const int64_t wall = now - t->window.started, tenth = wall / 10, waited = t->waited_ns;
    const int64_t loop_ran = loop_cpu - t->window.loop_cpu, thread_ran = thread_cpu - t->window.thread_cpu;
    if (t->parallel) {
        /* Neither running nor asleep: waiting for a CPU. */
        const int64_t preempted = (wall - loop_ran - waited) + (wall - thread_ran - (int64_t) (slept - t->window.slept));
        const int64_t thread_worked = thread_ran - (int64_t) (spun - t->window.spun);
        t->contended_windows = preempted > 2 * tenth ? t->contended_windows + 1 : 0;
        if (t->contended_windows == 2) {
            if (now - t->parallel_since > 1000 * MS) t->backoff_ns = MIN_BACKOFF_NS;
            t->no_parallel_until = now + t->backoff_ns;
            if (t->backoff_ns < MAX_BACKOFF_NS) t->backoff_ns *= 2;
            STORE(t->parallel, 0);
        } else if (!t->contended_windows && wall - waited + thread_worked < 7 * tenth) {
            STORE(t->parallel, 0);
            t->active = 0;
        } else if (sent != t->window.sent) {
            const int64_t all_sends = thread_worked / (int64_t) (sent - t->window.sent) * (t->tail - t->window.tail);
            STORE(t->dozes, all_sends * 10 < (loop_ran + thread_worked) * 4);
        }
    } else if (waited > (t->active ? 4 : 2) * tenth) {
        t->active = 0;
    } else {
        activate(t);
        if (t->active && has_several_cpus && loop_ran > 8 * tenth && now >= t->no_parallel_until) {
            t->parallel_since = now;
            t->contended_windows = 0;
            STORE(t->dozes, 0);
            STORE(t->parallel, 1);
            wake(t);
        }
    }

    t->window.started = now;
    t->window.loop_cpu = loop_cpu;
    t->window.thread_cpu = thread_cpu;
    t->window.slept = slept;
    t->window.spun = spun;
    t->window.sent = sent;
    t->window.tail = t->tail;
    t->waited_ns = 0;
}

void us_internal_send_thread_before_wait(struct us_loop_t *loop) {
    const int sends = loop->sends_last_tick = loop->sends_this_tick;
    loop->sends_this_tick = 0;
    struct us_send_thread_t *t = loop->send_thread;
    if (!t && (sends <= WORTH_WAKING || !(t = create(loop)))) return;
    settle_all(loop);
    if (mode != MODE_AUTO) return;

    /* No clocks are read while ticks are too small to batch anything. */
    if (sends > WORTH_WAKING) t->saw_burst = 1;
    if (!t->window.started && !t->saw_burst) return;
    const uint64_t now = t->wait_started = us_internal_monotonic_ns();
    if (now - t->window.started >= WINDOW_NS) {
        if (!t->window.started) t->waited_ns = now;
        choose_how_to_send(t, now);
        if (!t->active && !t->saw_burst) t->window.started = t->wait_started = 0;
        t->saw_burst = 0;
    }
}

void us_internal_send_thread_after_wait(struct us_loop_t *loop) {
    struct us_send_thread_t *t = loop->send_thread;
    if (t && t->wait_started) t->waited_ns += us_internal_monotonic_ns() - t->wait_started;
}

void us_internal_loop_read_ahead(struct us_loop_t *loop) {
    struct us_send_thread_t *t = loop->send_thread;
    if (loop->current_ready_poll == 0) t->read_ahead_to = 0;
    /* In a nested tick, a handler further up may still be reading from a buffer. */
    if (loop->current_ready_poll < t->read_ahead_to || !t->active || loop->data.tick_depth != 1) return;
#if defined(LIBUS_SOCKET_FAULT_INJECTION) && LIBUS_SOCKET_FAULT_INJECTION
    if (__atomic_load_n(&us_fault_armed, __ATOMIC_ACQUIRE)) return;
#endif
    int i = loop->current_ready_poll;
    for (int index = 0; i < loop->num_ready_polls; i++) {
        struct us_socket_t *s = loop->ready_polls[i].data.ptr;
        if (!s || (uintptr_t) s >> 48 || !s->p.may_read_ahead || s->p.read_ahead || loop->ready_polls[i].events != EPOLLIN ||
            us_poll_events(&s->p) != LIBUS_SOCKET_READABLE) {
            continue;
        }
        while (index < NUM_READS && t->reads[index].socket) index++;
        if (index == NUM_READS) break;
        const ssize_t length = bsd_recv(us_poll_fd(&s->p), t->read_buffers[index] + LIBUS_RECV_BUFFER_PADDING, LIBUS_READ_AHEAD_LENGTH, MSG_DONTWAIT);
        t->reads[index].socket = s;
        t->reads[index].result = length < 0 ? -errno : (int) length;
        s->p.read_ahead = index + 1;
    }
    t->read_ahead_to = i;
}

int us_internal_socket_take_read_ahead(struct us_socket_t *s, char **data) {
    struct us_send_thread_t *t = s->group->loop->send_thread;
    const int index = s->p.read_ahead - 1, result = t->reads[index].result;
    s->p.read_ahead = 0;
    t->reads[index].socket = NULL;
    *data = t->read_buffers[index] + LIBUS_RECV_BUFFER_PADDING;
    if (result >= 0) return result;
    errno = -result;
    return -1;
}

int us_internal_loop_dispatch_reads_ahead(struct us_loop_t *loop) {
    struct us_send_thread_t *t = loop->send_thread;
    int ran_handlers = 0;
    for (int i = 0; t && i < NUM_READS; i++) {
        if (!t->reads[i].socket) continue;
        us_internal_dispatch_ready_poll(&t->reads[i].socket->p, 0, 0, LIBUS_SOCKET_READABLE);
        ran_handlers = 1;
    }
    return ran_handlers;
}

int us_internal_socket_raw_write_soon(struct us_socket_t *s, const char *data, size_t length, us_unsent_cb unsent, int is_last) {
    if (!mode || s->p.send_in_flight) return 0;
#if defined(LIBUS_SOCKET_FAULT_INJECTION) && LIBUS_SOCKET_FAULT_INJECTION
    if (__atomic_load_n(&us_fault_armed, __ATOMIC_ACQUIRE)) return 0;
#endif
    struct us_loop_t *loop = s->group->loop;
    struct us_send_thread_t *t = loop->send_thread;
    if (length > MAX_PARALLEL_LENGTH) return 0;

    const int sends = ++loop->sends_this_tick;
    if (mode == MODE_AUTO) {
        if (!t || !t->active || s->p.settled_early_at == (unsigned char) loop->data.iteration_nr) return 0;
        int to_come = loop->num_ready_polls - loop->current_ready_poll - 1;
        if (to_come < loop->sends_last_tick - sends) to_come = loop->sends_last_tick - sends;
        if (to_come < sends / 4) to_come = sends / 4;
        if (to_come < (LOAD(t->sleep) == PARKED ? WORTH_WAKING : 1)) return 0;
    } else if (!t || !t->active) {
        if (!t && !(t = create(loop))) return 0;
        activate(t);
        if (!t->active) return 0;
    }
    if (!t->parallel && length > MAX_BATCHED_LENGTH) return 0;

    if (t->tail - t->settled == NUM_SENDS || t->arena_used + length > ARENA_SIZE) settle_all(loop);

    const unsigned int index = t->tail % NUM_SENDS;
    struct us_send_t *op = &t->sends[index];
    op->data = memcpy(t->arena + t->arena_used, data, length);
    t->arena_used += (length + 63) & ~63u;
    op->fd = us_poll_fd(&s->p);
    op->length = (int) length;
    op->is_last = is_last;
    op->done_with_fd = 0;
    op->socket = s;
    op->unsent = unsent;
    s->p.send_in_flight = (unsigned short) (index + 1);
    s->p.has_written = 1;
    __atomic_store_n(&op->state, SEND_QUEUED, __ATOMIC_RELEASE);
    STORE(t->tail, t->tail + 1);
    const unsigned int sleep = LOAD(t->sleep);
    if (sleep == PARKED || (sleep == WATCHING && t->parallel && t->tail - LOAD(t->head) >= WORTH_ENDING_A_DOZE)) wake(t);

    if (!t->parallel) {
        const unsigned int queued = t->tail - LOAD(t->head);
        const uint64_t now = us_internal_monotonic_ns();
        if (queued == 1) t->batch_started = now;
        if (queued >= MAX_BATCH || now - t->batch_started > BATCH_AGE_NS) {
            while (run_next(t)) {}
        }
    }
    return 1;
}

#else

void us_send_everything_queued(void) {}

#endif
