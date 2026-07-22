/*
 * Authored by Alex Hultman, 2018-2019.
 * Intellectual property of third-party.

 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#include "libusockets.h"
#include "internal/internal.h"
#include <stdlib.h>
#include <time.h>
#if defined(LIBUS_USE_EPOLL) || defined(LIBUS_USE_KQUEUE)

void Bun__internal_dispatch_ready_poll(void* loop, void* poll);
// void Bun__internal_dispatch_ready_poll(void* loop, void* poll) {}

#ifndef WIN32
/* Cannot include this one on Windows */
#include <unistd.h>
#include <stdint.h>
#include <errno.h>
#include <string.h> // memset
#include <mimalloc.h>
#endif

void us_loop_run_bun_tick(struct us_loop_t *loop, const struct timespec* timeout, uint64_t now_ns);

/* Pointer tags are used to indicate a Bun pointer versus a uSockets pointer */
#define UNSET_BITS_49_UNTIL_64 0x0000FFFFFFFFFFFF
#define CLEAR_POINTER_TAG(p) ((void *) ((uintptr_t) (p) & UNSET_BITS_49_UNTIL_64))
#define LIKELY(cond) __builtin_expect((_Bool)(cond), 1)
#define UNLIKELY(cond) __builtin_expect((_Bool)(cond), 0)

#ifdef LIBUS_USE_EPOLL
#define GET_READY_POLL(loop, index) (struct us_poll_t *) loop->ready_polls[index].data.ptr
#define SET_READY_POLL(loop, index, poll) loop->ready_polls[index].data.ptr = (void*)poll
#else
#define GET_READY_POLL(loop, index) (struct us_poll_t *) loop->ready_polls[index].udata
#if defined(__FreeBSD__)
#define SET_READY_POLL(loop, index, poll) loop->ready_polls[index].udata = (void*)poll
#else
#define SET_READY_POLL(loop, index, poll) loop->ready_polls[index].udata = (uint64_t)poll
#endif
#endif

/* Loop */
void us_loop_free(struct us_loop_t *loop) {
    us_internal_loop_data_free(loop);
    close(loop->fd);
    us_free(loop);
}

/* Poll */
struct us_poll_t *us_create_poll(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    if (!fallthrough) {
        loop->num_polls++;
    }
    return CLEAR_POINTER_TAG(us_malloc(sizeof(struct us_poll_t) + ext_size));
}

/* Todo: this one should be us_internal_poll_free */
void us_poll_free(struct us_poll_t *p, struct us_loop_t *loop) {
    loop->num_polls--;
    us_free(p);
}

__attribute__((always_inline)) void *us_poll_ext(struct us_poll_t *p) {
    return p + 1;
}

/* Todo: why have us_poll_create AND us_poll_init!? libuv legacy! */
void us_poll_init(struct us_poll_t *p, LIBUS_SOCKET_DESCRIPTOR fd, int poll_type) {
    p->state.fd = fd;
    p->state.poll_type = poll_type;
}

__attribute__((always_inline)) int us_poll_events(struct us_poll_t *p) {
    return ((p->state.poll_type & POLL_TYPE_POLLING_IN) ? LIBUS_SOCKET_READABLE : 0) | ((p->state.poll_type & POLL_TYPE_POLLING_OUT) ? LIBUS_SOCKET_WRITABLE : 0);
}

__attribute__((always_inline)) LIBUS_SOCKET_DESCRIPTOR us_poll_fd(struct us_poll_t *p) {
    return p->state.fd;
}

/* Returns any of listen socket, socket, shut down socket or callback */
int us_internal_poll_type(struct us_poll_t *p) {
    return p->state.poll_type & POLL_TYPE_KIND_MASK;
}

/* Bug: doesn't really SET, rather read and change, so needs to be inited first! */
void us_internal_poll_set_type(struct us_poll_t *p, int poll_type) {
    p->state.poll_type = poll_type | (p->state.poll_type & POLL_TYPE_POLLING_MASK);
}

#if defined(LIBUS_USE_EPOLL)

#include <sys/syscall.h>
#include <signal.h>
#include <errno.h>
#include <limits.h>

static int has_epoll_pwait2 = -1;

#ifndef SYS_epoll_pwait2
// It's consistent on multiple architectures
// https://github.com/torvalds/linux/blob/9d1ddab261f3e2af7c384dc02238784ce0cf9f98/include/uapi/asm-generic/unistd.h#L795
// https://github.com/google/gvisor/blob/master/test/syscalls/linux/epoll.cc#L48C1-L50C7
#define SYS_epoll_pwait2 441
#endif

extern ssize_t sys_epoll_pwait2(int epfd, struct epoll_event* events, int maxevents,
                              const struct timespec* timeout, const sigset_t* sigmask);


static int bun_epoll_pwait2(int epfd, struct epoll_event *events, int maxevents, const struct timespec *timeout) {
    int ret;
    sigset_t mask;
    sigemptyset(&mask);

    /* For a finite non-zero timeout, track an absolute monotonic deadline so
     * EINTR retries wait for the remaining time (signal(7): epoll_*wait is
     * never restarted by SA_RESTART). NULL and {0,0} are idempotent on retry. */
    uint64_t deadline_ns = 0;
    const int has_deadline = timeout && (timeout->tv_sec | timeout->tv_nsec);
    if (has_deadline) {
        deadline_ns = us_internal_monotonic_ns()
                    + (uint64_t) timeout->tv_sec * 1000000000ULL
                    + (uint64_t) timeout->tv_nsec;
    }

    if (has_epoll_pwait2 != 0) {
        struct timespec remaining_ts;
        const struct timespec *remaining = timeout;
        for (;;) {
            ret = sys_epoll_pwait2(epfd, events, maxevents, remaining, &mask);
            if (LIKELY(ret != -EINTR)) break;
            if (!has_deadline) continue;
            uint64_t now = us_internal_monotonic_ns();
            if (now >= deadline_ns) return 0;
            uint64_t left = deadline_ns - now;
            remaining_ts.tv_sec  = (time_t) (left / 1000000000ULL);
            remaining_ts.tv_nsec = (long)   (left % 1000000000ULL);
            remaining = &remaining_ts;
        }

        if (LIKELY(ret != -ENOSYS && ret != -EPERM && ret != -EOPNOTSUPP && ret != -EACCES && ret != -EFAULT)) {
            return ret;
        }

        has_epoll_pwait2 = 0;
    }

    /* epoll_pwait(2) takes an int millisecond timeout; epoll_pwait2(2) takes a
     * timespec (since Linux 5.11). Round the ns remainder UP so a sub-ms delta
     * waits 1 ms instead of truncating to 0 and busy-spinning. */
    int timeoutMs;
    if (!timeout) {
        timeoutMs = -1;
    } else {
        uint64_t ns = (uint64_t) timeout->tv_sec * 1000000000ULL + (uint64_t) timeout->tv_nsec;
        uint64_t ms = (ns + 999999ULL) / 1000000ULL;
        timeoutMs = ms > (uint64_t) INT_MAX ? INT_MAX : (int) ms;
    }

    for (;;) {
        ret = epoll_pwait(epfd, events, maxevents, timeoutMs, &mask);
        if (!IS_EINTR(ret)) break;
        if (!has_deadline) continue;
        uint64_t now = us_internal_monotonic_ns();
        if (now >= deadline_ns) return 0;
        uint64_t left_ns = deadline_ns - now;
        uint64_t left_ms = (left_ns + 999999ULL) / 1000000ULL;
        timeoutMs = left_ms > (uint64_t) INT_MAX ? INT_MAX : (int) left_ms;
    }

    return ret;
}

extern int Bun__isEpollPwait2SupportedOnLinuxKernel();

#else

/* kevent(2) returns EINTR when a signal is caught (XNU kqueue_scan returns
 * EINTR on THREAD_INTERRUPTED; FreeBSD kqueue_scan maps ERESTART->EINTR), so
 * retry with the remaining time against an absolute monotonic deadline. */
static int bun_kevent64_wait(int kqfd, struct kevent64_s *eventlist, int nevents, unsigned int flags, const struct timespec *timeout) {
    int ret;
    uint64_t deadline_ns = 0;
    const int has_deadline = timeout && (timeout->tv_sec | timeout->tv_nsec);
    if (has_deadline) {
        deadline_ns = us_internal_monotonic_ns()
                    + (uint64_t) timeout->tv_sec * 1000000000ULL
                    + (uint64_t) timeout->tv_nsec;
    }

    struct timespec remaining_ts;
    const struct timespec *remaining = timeout;
    for (;;) {
        ret = kevent64(kqfd, NULL, 0, eventlist, nevents, flags, remaining);
        if (!IS_EINTR(ret)) return ret;
        if (!has_deadline) continue;
        uint64_t now = us_internal_monotonic_ns();
        if (now >= deadline_ns) return 0;
        uint64_t left = deadline_ns - now;
        remaining_ts.tv_sec  = (time_t) (left / 1000000000ULL);
        remaining_ts.tv_nsec = (long)   (left % 1000000000ULL);
        remaining = &remaining_ts;
    }
}

#endif

/* Loop */
struct us_loop_t *us_create_loop(void *hint, void (*wakeup_cb)(struct us_loop_t *loop), void (*pre_cb)(struct us_loop_t *loop), void (*post_cb)(struct us_loop_t *loop), unsigned int ext_size) {
    struct us_loop_t *loop = (struct us_loop_t *) us_calloc(1, sizeof(struct us_loop_t) + ext_size);
    loop->num_polls = 0;
    /* These could be accessed if we close a poll before starting the loop */
    loop->num_ready_polls = 0;
    loop->current_ready_poll = 0;

    loop->bun_polls = 0;

#ifdef LIBUS_USE_EPOLL
    loop->fd = epoll_create1(EPOLL_CLOEXEC);

    if (has_epoll_pwait2 == -1) {
        if (Bun__isEpollPwait2SupportedOnLinuxKernel() == 0) {
            has_epoll_pwait2 = 0;
        }
    }

#else
    loop->fd = kqueue();
#endif

    us_internal_loop_data_init(loop, wakeup_cb, pre_cb, post_cb);
    return loop;
}

/* Shared dispatch loop for both us_loop_run and us_loop_run_bun_tick */
static void us_internal_dispatch_ready_polls(struct us_loop_t *loop) {
#ifdef LIBUS_USE_EPOLL
    for (loop->current_ready_poll = 0; loop->current_ready_poll < loop->num_ready_polls; loop->current_ready_poll++) {
        struct us_poll_t *poll = GET_READY_POLL(loop, loop->current_ready_poll);
        if (LIKELY(poll)) {
            if (CLEAR_POINTER_TAG(poll) != poll) {
                Bun__internal_dispatch_ready_poll(loop, poll);
                continue;
            }
            int events = loop->ready_polls[loop->current_ready_poll].events;
            /* Normalize to 0/1 like the kqueue path's EV_ERROR: the value is
             * forwarded as a libus close code, and a raw EPOLLERR (8) would
             * read as errno 8 (ENOEXEC) in the JS error path. */
            const int error = !!(events & EPOLLERR);
            const int eof = events & EPOLLHUP;
            events &= us_poll_events(poll);
            if (events || error || eof) {
                us_internal_dispatch_ready_poll(poll, error, eof, events);
            }
        }
    }
#else
    /* Kqueue delivers each filter (READ, WRITE, TIMER, etc.) as a separate kevent,
     * so the same fd/poll can appear twice in ready_polls. We coalesce them into a
     * single set of flags per poll before dispatching, matching epoll's behavior
     * where each fd appears once with a combined bitmask. */
    struct kevent_flags {
        uint8_t readable : 1;
        uint8_t writable : 1;
        uint8_t error    : 1;
        uint8_t eof      : 1;
        uint8_t skip     : 1;
        uint8_t _pad     : 3;
    };

    _Static_assert(sizeof(struct kevent_flags) == 1, "kevent_flags must be 1 byte");
    struct kevent_flags coalesced[LIBUS_MAX_READY_POLLS]; /* no zeroing needed — every index is written in the first pass */

    /* First pass: decode kevents and coalesce same-poll entries */
    for (int i = 0; i < loop->num_ready_polls; i++) {
        struct us_poll_t *poll = GET_READY_POLL(loop, i);
        if (!poll || CLEAR_POINTER_TAG(poll) != poll) {
            coalesced[i] = (struct kevent_flags){ .skip = 1 };
            continue;
        }

        const int16_t filter = loop->ready_polls[i].filter;
        const uint16_t flags = loop->ready_polls[i].flags;
        struct kevent_flags bits = {
#if defined(__APPLE__)
            .readable = (filter == EVFILT_READ || filter == EVFILT_MACHPORT),
#else
            .readable = (filter == EVFILT_READ || filter == EVFILT_USER),
#endif
            .writable = (filter == EVFILT_WRITE),
            .error = !!(flags & EV_ERROR),
            .eof = !!(flags & EV_EOF),
        };

        /* Look backward for a prior entry with the same poll to coalesce into.
         * Kqueue returns at most 2 kevents per fd (READ + WRITE). */
        int merged = 0;
        for (int j = i - 1; j >= 0; j--) {
            if (!coalesced[j].skip && GET_READY_POLL(loop, j) == poll) {
                coalesced[j].readable |= bits.readable;
                coalesced[j].writable |= bits.writable;
                coalesced[j].error |= bits.error;
                coalesced[j].eof |= bits.eof;
                coalesced[i] = (struct kevent_flags){ .skip = 1 };
                merged = 1;
                break;
            }
        }
        if (!merged) {
            coalesced[i] = bits;
        }
    }

    /* Second pass: dispatch everything in order — tagged pointers and coalesced events */
    for (loop->current_ready_poll = 0; loop->current_ready_poll < loop->num_ready_polls; loop->current_ready_poll++) {
        struct us_poll_t *poll = GET_READY_POLL(loop, loop->current_ready_poll);
        if (!poll) continue;

        /* Tagged pointers (FilePoll) go through Bun's own dispatch */
        if (CLEAR_POINTER_TAG(poll) != poll) {
            Bun__internal_dispatch_ready_poll(loop, poll);
            continue;
        }

        struct kevent_flags bits = coalesced[loop->current_ready_poll];
        if (bits.skip) continue;

        int events = (bits.readable ? LIBUS_SOCKET_READABLE : 0)
                   | (bits.writable ? LIBUS_SOCKET_WRITABLE : 0);

        events &= us_poll_events(poll);
        if (events || bits.error || bits.eof) {
            us_internal_dispatch_ready_poll(poll, bits.error, bits.eof, events);
        }
    }
#endif
}

/* If the kernel filled our entire buffer, more events are likely already queued.
 * Re-poll non-blocking and dispatch again before running pre/post callbacks, so a
 * single tick covers all pending I/O instead of one 1024-event slice per roundtrip.
 * Conditioned on saturation and capped at 48 iterations — matches libuv's uv__io_poll
 * (vendor/libuv/src/unix/linux.c:1387,1590 and kqueue.c:253,451). */
static void us_internal_drain_ready_polls(struct us_loop_t *loop) {
    int drain_count = 48;
    while (UNLIKELY(loop->num_ready_polls == LIBUS_MAX_READY_POLLS) && --drain_count != 0 && loop->num_polls > 0) {
#ifdef LIBUS_USE_EPOLL
        static const struct timespec zero = {0, 0};
        loop->num_ready_polls = bun_epoll_pwait2(loop->fd, loop->ready_polls, LIBUS_MAX_READY_POLLS, &zero);
#else
        do {
            loop->num_ready_polls = kevent64(loop->fd, NULL, 0, loop->ready_polls, LIBUS_MAX_READY_POLLS, KEVENT_FLAG_IMMEDIATE, NULL);
        } while (IS_EINTR(loop->num_ready_polls));
#endif
        if (loop->num_ready_polls <= 0) {
            loop->num_ready_polls = 0;
            break;
        }
        us_internal_dispatch_ready_polls(loop);
    }
}

/* Bound `timeout` by the socket-timeout sweep deadline (NULL == forever). */
static const struct timespec *us_internal_clamp_to_sweep(struct us_loop_t *loop, const struct timespec *timeout, struct timespec *storage) {
    long long ns = us_internal_sweep_timeout_ns(loop);
    if (ns < 0) {
        return timeout;
    }
    long long sweep_sec = ns / 1000000000LL;
    long long sweep_nsec = ns % 1000000000LL;
    if (timeout && (timeout->tv_sec < sweep_sec ||
                    (timeout->tv_sec == sweep_sec && timeout->tv_nsec <= sweep_nsec))) {
        return timeout;
    }
    storage->tv_sec = (time_t) sweep_sec;
    storage->tv_nsec = (long) sweep_nsec;
    return storage;
}

void us_loop_run(struct us_loop_t *loop) {
    /* While we have non-fallthrough polls we shouldn't fall through */
    while (loop->num_polls) {
        loop->data.tick_depth++;
        /* Emit pre callback */
        us_internal_loop_pre(loop);

        struct timespec sweep_ts;
        const struct timespec *timeout = us_internal_clamp_to_sweep(loop, NULL, &sweep_ts);

        /* Fetch ready polls */
#ifdef LIBUS_USE_EPOLL
        loop->num_ready_polls = bun_epoll_pwait2(loop->fd, loop->ready_polls, LIBUS_MAX_READY_POLLS, timeout);
#else
        loop->num_ready_polls = bun_kevent64_wait(loop->fd, loop->ready_polls, LIBUS_MAX_READY_POLLS, 0, timeout);
#endif

        us_internal_dispatch_ready_polls(loop);
        us_internal_drain_ready_polls(loop);
        us_internal_sweep_if_due(loop);

        /* Emit post callback */
        us_internal_loop_post(loop);
        loop->data.tick_depth--;
    }
}

extern void Bun__JSC_onBeforeWait(void * _Nonnull jsc_vm, uint64_t now_ns);

void us_loop_run_bun_tick(struct us_loop_t *loop, const struct timespec* timeout, uint64_t now_ns) {
    if (loop->num_polls == 0)
        return;

    loop->data.tick_depth++;

    /* Emit pre callback */
    us_internal_loop_pre(loop);

    /* loop_pre runs lsquic_engine_process_conns and stores the soonest
     * earliest_adv_tick. The JS event loop folds this in via src/runtime/timer/mod.rs; other
     * callers of us_loop_run_bun_tick (HTTP thread) pass NULL, so fold it
     * here so QUIC retransmit/idle timers fire without other I/O waking us. */
    struct timespec quic_ts;
    if (loop->data.quic_head && loop->data.quic_next_tick_us >= 0) {
        long long us = loop->data.quic_next_tick_us;
        if (!timeout ||
            (long long) timeout->tv_sec * 1000000 + timeout->tv_nsec / 1000 > us) {
            quic_ts.tv_sec = (time_t)(us / 1000000);
            quic_ts.tv_nsec = (long)((us % 1000000) * 1000);
            timeout = &quic_ts;
        }
    }

    struct timespec sweep_ts;
    timeout = us_internal_clamp_to_sweep(loop, timeout, &sweep_ts);

    const unsigned int had_wakeups = __atomic_exchange_n(&loop->pending_wakeups, 0, __ATOMIC_ACQUIRE);
    const int will_idle_inside_event_loop = had_wakeups == 0 && (!timeout || (timeout->tv_nsec != 0 || timeout->tv_sec != 0));
    /* `now_ns` is the reading the JS side took to pick `timeout`
     * (timer::All::get_timeout), reused here to rate-limit the idle sweep; 0
     * if it had none to share. Nothing measures a deadline against it. */
    if (will_idle_inside_event_loop && loop->data.jsc_vm)
        Bun__JSC_onBeforeWait(loop->data.jsc_vm, now_ns);

    /* The scavenger sweeps our heaps while we are in the kernel. Must come after
     * Bun__JSC_onBeforeWait, which allocates: nothing may touch our heaps until the matching
     * _end. mimalloc paces the sweep itself, so this costs a compare-and-swap per tick.
     * With no scavenger to hand off to, fall back to sweeping inline -- but only on a tick that
     * really parks, and rate-limited, because doing it between ticks is what we are avoiding. */
    const int handed_off = mi_on_thread_idle_start();
    if (!handed_off && will_idle_inside_event_loop) {
        static const uint64_t idle_sweep_interval_ns = 100 * 1000000ULL;
        static _Thread_local uint64_t last_idle_sweep_ns = 0;
        const uint64_t sweep_now_ns = now_ns ? now_ns : us_internal_monotonic_ns();
        if (sweep_now_ns >= last_idle_sweep_ns + idle_sweep_interval_ns) {
            last_idle_sweep_ns = sweep_now_ns;
            mi_on_thread_idle();
        }
    }

    /* Fetch ready polls */
#ifdef LIBUS_USE_EPOLL
    /* A zero timespec already has a fast path in ep_poll (fs/eventpoll.c):
     * it sets timed_out=1 (line 1952) and returns before any scheduler
     * interaction (line 1975). No equivalent of KEVENT_FLAG_IMMEDIATE needed. */
    loop->num_ready_polls = bun_epoll_pwait2(loop->fd, loop->ready_polls, LIBUS_MAX_READY_POLLS, timeout);
#else
    loop->num_ready_polls = bun_kevent64_wait(loop->fd, loop->ready_polls, LIBUS_MAX_READY_POLLS,
        /* When we won't idle (pending wakeups or zero timeout), use KEVENT_FLAG_IMMEDIATE.
         * In XNU's kqueue_scan (bsd/kern/kern_event.c):
         *  - KEVENT_FLAG_IMMEDIATE: returns immediately after kqueue_process() (line 8031)
         *  - Zero timespec without the flag: falls through to assert_wait_deadline (line 8039)
         *    and thread_block (line 8048), doing a full context switch cycle (~14us) even
         *    though the deadline is already in the past. */
        will_idle_inside_event_loop ? 0 : KEVENT_FLAG_IMMEDIATE,
        timeout);
#endif

    /* Before anything can allocate again. */
    if (handed_off)
        mi_on_thread_idle_end();

    us_internal_dispatch_ready_polls(loop);
    us_internal_drain_ready_polls(loop);
    us_internal_sweep_if_due(loop);

    /* Emit post callback */
    us_internal_loop_post(loop);
    loop->data.tick_depth--;
}

void us_internal_loop_update_pending_ready_polls(struct us_loop_t *loop, struct us_poll_t *old_poll, struct us_poll_t *new_poll, int old_events, int new_events) {
#ifdef LIBUS_USE_EPOLL
    /* Epoll only has one ready poll per poll */
    int num_entries_possibly_remaining = 1;
#else
    /* Ready polls may contain same poll twice under kqueue, as one poll may hold two filters */
    int num_entries_possibly_remaining = 2;
#endif

    /* Todo: for kqueue if we track things in us_change_poll it is possible to have a fast path with no seeking in cases of:
    * current poll being us AND we only poll for one thing */

    for (int i = loop->current_ready_poll; i < loop->num_ready_polls && num_entries_possibly_remaining; i++) {
        if (GET_READY_POLL(loop, i) == old_poll) {

            // if new events does not contain the ready events of this poll then remove (no we filter that out later on)
            SET_READY_POLL(loop, i, new_poll);
            
            num_entries_possibly_remaining--;
        }
    }
}

/* Poll */

#ifdef LIBUS_USE_KQUEUE
/* Helper function for setting or updating EVFILT_READ and EVFILT_WRITE */
int kqueue_change(int kqfd, int fd, int old_events, int new_events, void *user_data) {
    struct kevent64_s change_list[2];
    int change_length = 0;

    /* Do they differ in readable? */
    int is_readable =  (new_events & LIBUS_SOCKET_READABLE);
    int is_writable =  (new_events & LIBUS_SOCKET_WRITABLE);
    if ((new_events & LIBUS_SOCKET_READABLE) != (old_events & LIBUS_SOCKET_READABLE)) {
        EV_SET64(&change_list[change_length++], fd, EVFILT_READ, is_readable ? EV_ADD : EV_DELETE, 0, 0, (uint64_t)(void*)user_data, 0, 0);
    }

    if(!is_readable && !is_writable) {
        if(!(old_events & LIBUS_SOCKET_WRITABLE)) {
            // if we are not reading or writing, we need to add writable to receive FIN
            EV_SET64(&change_list[change_length++], fd, EVFILT_WRITE, EV_ADD | EV_ONESHOT, 0, 0, (uint64_t)(void*)user_data, 0, 0);
        }
    } else if ((new_events & LIBUS_SOCKET_WRITABLE) != (old_events & LIBUS_SOCKET_WRITABLE)) {
        /* Do they differ in writable? */
        EV_SET64(&change_list[change_length++], fd, EVFILT_WRITE, (new_events & LIBUS_SOCKET_WRITABLE) ? EV_ADD | EV_ONESHOT : EV_DELETE, 0, 0, (uint64_t)(void*)user_data, 0, 0);
    }
    int ret;
    do {
        ret = kevent64(kqfd, change_list, change_length, change_list, change_length, KEVENT_FLAG_ERROR_EVENTS, NULL);
    } while (IS_EINTR(ret));

    // ret should be 0 in most cases (not guaranteed when removing async)

    /* KEVENT_FLAG_ERROR_EVENTS reports per-filter failures as EV_ERROR entries
     * with the errno in .data; kevent64 itself returns the count and does not
     * set errno. Mirror epoll's contract so us_poll_start_rc callers can read it. */
    if (ret > 0) {
        errno = (int) change_list[0].data;
    }

    return ret;
}
#endif

struct us_poll_t *us_poll_resize(struct us_poll_t *p, struct us_loop_t *loop, unsigned int old_ext_size, unsigned int ext_size) {

    unsigned int old_size = sizeof(struct us_poll_t) + old_ext_size;
    unsigned int new_size = sizeof(struct us_poll_t) + ext_size;
    if(new_size <= old_size) return p;

    struct us_poll_t *new_p = us_calloc(1, new_size);
    memcpy(new_p, p, old_size);

    /* Increment poll count for the new poll - the old poll will be freed separately
     * which decrements the count, keeping the total correct */
    loop->num_polls++;
    
    int events = us_poll_events(p);
#ifdef LIBUS_USE_EPOLL
    /* Hack: forcefully update poll by stripping away already set events */
    new_p->state.poll_type = us_internal_poll_type(new_p);
    us_poll_change(new_p, loop, events);
#else
    /* Forcefully update poll by resetting them with new_p as user data */
    kqueue_change(loop->fd, new_p->state.fd, 0, LIBUS_SOCKET_WRITABLE | LIBUS_SOCKET_READABLE, new_p);
#endif
    /* This is needed for epoll also (us_change_poll doesn't update the old poll) */
    us_internal_loop_update_pending_ready_polls(loop, p, new_p, events, events);

    return new_p;
}

int us_poll_start_rc(struct us_poll_t *p, struct us_loop_t *loop, int events) {
    p->state.poll_type = us_internal_poll_type(p) | ((events & LIBUS_SOCKET_READABLE) ? POLL_TYPE_POLLING_IN : 0) | ((events & LIBUS_SOCKET_WRITABLE) ? POLL_TYPE_POLLING_OUT : 0);

#ifdef LIBUS_USE_EPOLL
    struct epoll_event event;
    if(!(events & LIBUS_SOCKET_READABLE) && !(events & LIBUS_SOCKET_WRITABLE)) {
        /* Polling neither direction (a half-open socket after the peer's FIN):
         * EPOLLHUP and EPOLLERR are always reported even when not requested,
         * which is exactly what the dispatcher's eof/error handling needs to
         * close the socket once both directions are down. Never add
         * EPOLLRDHUP here - the peer's FIN has typically ALREADY arrived, so
         * a level-triggered EPOLLRDHUP would fire on every epoll_wait while
         * the dispatcher (which derives eof from EPOLLHUP only) ignores it,
         * spinning the loop at 100% CPU until the JS side closes the fd. */
        events |= EPOLLHUP | EPOLLERR;
    }
    event.events = events;
    event.data.ptr = p;
    int ret;
    do {
        ret = epoll_ctl(loop->fd, EPOLL_CTL_ADD, p->state.fd, &event);
    } while (IS_EINTR(ret));
    return ret;
#else
    return kqueue_change(loop->fd, p->state.fd, 0, events, p);
#endif
}

void us_poll_start(struct us_poll_t *p, struct us_loop_t *loop, int events) {
    us_poll_start_rc(p, loop, events);
}

void us_poll_change(struct us_poll_t *p, struct us_loop_t *loop, int events) {
    int old_events = us_poll_events(p);
    if (old_events != events) {

        p->state.poll_type = us_internal_poll_type(p) | ((events & LIBUS_SOCKET_READABLE) ? POLL_TYPE_POLLING_IN : 0) | ((events & LIBUS_SOCKET_WRITABLE) ? POLL_TYPE_POLLING_OUT : 0);

#ifdef LIBUS_USE_EPOLL
        struct epoll_event event;
        if(!(events & LIBUS_SOCKET_READABLE) && !(events & LIBUS_SOCKET_WRITABLE)) {
            /* See us_poll_start_rc: EPOLLHUP/EPOLLERR are implicit; never add
             * EPOLLRDHUP for an already-half-closed socket or the loop spins. */
            events |= EPOLLHUP | EPOLLERR;
        }
        event.events = events;
        event.data.ptr = p;
        int rc;
        do {
            rc = epoll_ctl(loop->fd, EPOLL_CTL_MOD, p->state.fd, &event);
        } while (IS_EINTR(rc));
#else
        kqueue_change(loop->fd, p->state.fd, old_events, events, p);
#endif
        /* Set all removed events to null-polls in pending ready poll list */
        us_internal_loop_update_pending_ready_polls(loop, p, p, old_events, events);
    }
}

void us_internal_poll_restart(struct us_poll_t *p, struct us_loop_t *loop) {
    int events = us_poll_events(p);
#ifdef LIBUS_USE_EPOLL
    struct epoll_event event;
    event.events = events;
    event.data.ptr = p;
    int rc;
    do {
        rc = epoll_ctl(loop->fd, EPOLL_CTL_MOD, p->state.fd, &event);
    } while (IS_EINTR(rc));
    if (rc != 0 && errno == ENOENT) {
        do {
            rc = epoll_ctl(loop->fd, EPOLL_CTL_ADD, p->state.fd, &event);
        } while (IS_EINTR(rc));
    }
#else
    /* EV_ADD is idempotent on kqueue. */
    kqueue_change(loop->fd, p->state.fd, 0, events, p);
#endif
}

#if defined(LIBUS_SOCKET_FAULT_INJECTION) && LIBUS_SOCKET_FAULT_INJECTION
void us_internal_poll_simulate_error_stop(struct us_poll_t *p, struct us_loop_t *loop) {
    int old_events = us_poll_events(p);
#ifdef LIBUS_USE_EPOLL
    struct epoll_event event;
    int rc;
    do {
        rc = epoll_ctl(loop->fd, EPOLL_CTL_DEL, p->state.fd, &event);
    } while (IS_EINTR(rc));
#else
    if (old_events) {
        kqueue_change(loop->fd, p->state.fd, old_events, 0, NULL);
    }
#endif
    (void) old_events;
}
#endif

void us_poll_stop(struct us_poll_t *p, struct us_loop_t *loop) {
    int old_events = us_poll_events(p);
    int new_events = 0;
#ifdef LIBUS_USE_EPOLL
    struct epoll_event event;
    int rc;
    do {
         rc = epoll_ctl(loop->fd, EPOLL_CTL_DEL, p->state.fd, &event);
    } while (IS_EINTR(rc));
#else
    if (old_events) {
        kqueue_change(loop->fd, p->state.fd, old_events, new_events, NULL);
    }
#endif

    /* Disable any instance of us in the pending ready poll list */
    us_internal_loop_update_pending_ready_polls(loop, p, 0, old_events, new_events);
}

size_t us_internal_accept_poll_event(struct us_poll_t *p) {
#ifdef LIBUS_USE_EPOLL
    int fd = us_poll_fd(p);
    uint64_t buf;
    ssize_t read_length = 0;
    do {
         read_length = read(fd, &buf, 8);
    } while (IS_EINTR(read_length));
    return buf;
#else
    /* Kqueue has no underlying FD for user events */
    return 0;
#endif
}

/* Async (internal helper for loop's wakeup feature) */
#ifdef LIBUS_USE_EPOLL
struct us_internal_async *us_internal_create_async(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    struct us_poll_t *p = us_create_poll(loop, fallthrough, sizeof(struct us_internal_callback_t) + ext_size);
    memset(p, 0, sizeof(struct us_internal_callback_t) + ext_size);

    int efd = eventfd(0, EFD_NONBLOCK | EFD_CLOEXEC);
    if (efd == -1) {
        // eventfd only fails on EMFILE/ENFILE — the loop is unusable without
        // wakeup_async, and the sole caller doesn't NULL-check. Crash loudly
        // rather than NULL-deref or store -1 as a poll fd.
        BUN_PANIC("eventfd() failed during loop init (out of file descriptors?)");
    }
    us_poll_init(p, efd, POLL_TYPE_CALLBACK);

    struct us_internal_callback_t *cb = (struct us_internal_callback_t *) p;
    cb->loop = loop;
    cb->cb_expects_the_loop = 1;
    cb->leave_poll_ready = 1;  /* Edge-triggered: skip reading eventfd on wakeup */

    return (struct us_internal_async *) cb;
}

// identical code as for timer, make it shared for "callback types"
void us_internal_async_close(struct us_internal_async *a) {
    struct us_internal_callback_t *cb = (struct us_internal_callback_t *) a;

    us_poll_stop(&cb->p, cb->loop);
    close(us_poll_fd(&cb->p));

    /* (regular) sockets are the only polls which are not freed immediately */
    us_poll_free((struct us_poll_t *) a, cb->loop);
}

void us_internal_async_set(struct us_internal_async *a, void (*cb)(struct us_internal_async *)) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) a;

    internal_cb->cb = (void (*)(struct us_internal_callback_t *)) cb;

    us_poll_start((struct us_poll_t *) a, internal_cb->loop, LIBUS_SOCKET_READABLE);
#ifdef LIBUS_USE_EPOLL
    /* Upgrade to edge-triggered to avoid reading the eventfd on each wakeup */
    struct epoll_event event;
    event.events = EPOLLIN | EPOLLET;
    event.data.ptr = (struct us_poll_t *) a;
    epoll_ctl(internal_cb->loop->fd, EPOLL_CTL_MOD,
              us_poll_fd((struct us_poll_t *) a), &event);
#endif
}

void us_internal_async_wakeup(struct us_internal_async *a) {
    int fd = us_poll_fd((struct us_poll_t *) a);
    uint64_t val;
    for (val = 1; ; val = 1) {
        if (write(fd, &val, 8) >= 0) return;
        if (errno == EINTR) continue;
        if (errno == EAGAIN) {
            /* Counter overflow — drain and retry */
            if (read(fd, &val, 8) > 0 || errno == EAGAIN || errno == EINTR) continue;
        }
        break;
    }
}
#elif defined(__APPLE__)

#define MACHPORT_BUF_LEN 1024

struct us_internal_async *us_internal_create_async(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    struct us_internal_callback_t *cb = us_calloc(1, sizeof(struct us_internal_callback_t) + ext_size);
    cb->loop = loop;
    cb->cb_expects_the_loop = 1;
    cb->leave_poll_ready = 0;

    /* Bug: us_internal_poll_set_type does not SET the type, it only CHANGES it */
    cb->p.state.poll_type = POLL_TYPE_POLLING_IN;
    us_internal_poll_set_type((struct us_poll_t *) cb, POLL_TYPE_CALLBACK);

    if (!fallthrough) {
        loop->num_polls++;
    }

    cb->machport_buf = us_malloc(MACHPORT_BUF_LEN);
    mach_port_t self = mach_task_self();
    kern_return_t kr = mach_port_allocate(self, MACH_PORT_RIGHT_RECEIVE, &cb->port);

    if (UNLIKELY(kr != KERN_SUCCESS)) {
        return NULL;
    }

    // Insert a send right into the port since we also use this to send
    kr = mach_port_insert_right(self, cb->port, cb->port, MACH_MSG_TYPE_MAKE_SEND);
    if (UNLIKELY(kr != KERN_SUCCESS)) {
        return NULL;
    }

    // Modify the port queue size to be 1 because we are only
    // using it for notifications and not for any other purpose.
    mach_port_limits_t limits = { .mpl_qlimit = 1 };
    kr = mach_port_set_attributes(self, cb->port, MACH_PORT_LIMITS_INFO, (mach_port_info_t)&limits, MACH_PORT_LIMITS_INFO_COUNT);

    if (UNLIKELY(kr != KERN_SUCCESS)) {
        return NULL;
    }

    return (struct us_internal_async *) cb;
}

// identical code as for timer, make it shared for "callback types"
void us_internal_async_close(struct us_internal_async *a) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) a;

    struct kevent64_s event;
    uint64_t ptr = (uint64_t)(void*)internal_cb;
    EV_SET64(&event, ptr, EVFILT_MACHPORT, EV_DELETE, 0, 0, (uint64_t)(void*)internal_cb, 0,0);

    int ret;
    do {
        ret = kevent64(internal_cb->loop->fd, &event, 1, &event, 1, KEVENT_FLAG_ERROR_EVENTS, NULL);
    } while (IS_EINTR(ret));

    mach_port_deallocate(mach_task_self(), internal_cb->port);
    us_free(internal_cb->machport_buf);

    /* (regular) sockets are the only polls which are not freed immediately */
    us_poll_free((struct us_poll_t *) a, internal_cb->loop);
}

void us_internal_async_set(struct us_internal_async *a, void (*cb)(struct us_internal_async *)) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) a;

    internal_cb->cb = (void (*)(struct us_internal_callback_t *)) cb;

    // EVFILT_MACHPORT benchmarks faster than EVFILT_USER when using multiple threads
    // Very old versions of macOS required them to be portsets instead of ports
    // but that is no longer the case
    // There are not many examples on the internet of using machports this way
    // you can find one in Chromium's codebase.
    struct kevent64_s event;
    event.ident = internal_cb->port;
    event.filter = EVFILT_MACHPORT;
    event.flags = EV_ADD | EV_ENABLE;
    event.fflags = MACH_RCV_MSG | MACH_RCV_OVERWRITE;
    event.ext[0] = (uint64_t)(void*)internal_cb->machport_buf;
    event.ext[1] = MACHPORT_BUF_LEN;
    event.udata = (uint64_t)(void*)internal_cb;

    int ret;
    do {
        ret = kevent64(internal_cb->loop->fd, &event, 1, &event, 1, KEVENT_FLAG_ERROR_EVENTS, NULL);
    } while (IS_EINTR(ret));

    if (UNLIKELY(ret == -1)) {
       abort();
    }
}

void us_internal_async_wakeup(struct us_internal_async *a) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) a;
    mach_msg_header_t msg = {
        .msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0),
        .msgh_size = sizeof(mach_msg_header_t),
        .msgh_remote_port = internal_cb->port,
        .msgh_local_port = MACH_PORT_NULL,
        .msgh_voucher_port = 0,
        .msgh_id = 0,
    };

    mach_msg_return_t kr = mach_msg(
        &msg,
        MACH_SEND_MSG | MACH_SEND_TIMEOUT,
        msg.msgh_size,
        0,
        MACH_PORT_NULL,
        0, // Fail instantly if the port is full
        MACH_PORT_NULL
    );

    switch (kr) {
        case KERN_SUCCESS: {
            break;
        }

        // This means that the send would've blocked because the
        // queue is full. We assume success because the port is full.
        case MACH_SEND_TIMED_OUT: {
            break;
        }

        // No space means it will wake up.
        case MACH_SEND_NO_BUFFER: {
            break;
        }

        default: {
            break;
        }
    }
}
#else
/* FreeBSD: kqueue async wakeup via EVFILT_USER + NOTE_TRIGGER. */
struct us_internal_async *us_internal_create_async(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    struct us_internal_callback_t *cb = us_calloc(1, sizeof(struct us_internal_callback_t) + ext_size);
    cb->loop = loop;
    cb->cb_expects_the_loop = 1;
    cb->leave_poll_ready = 0;

    cb->p.state.poll_type = POLL_TYPE_POLLING_IN;
    us_internal_poll_set_type((struct us_poll_t *) cb, POLL_TYPE_CALLBACK);

    if (!fallthrough) {
        loop->num_polls++;
    }

    return (struct us_internal_async *) cb;
}

void us_internal_async_close(struct us_internal_async *a) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) a;
    struct kevent64_s event;
    EV_SET64(&event, (uintptr_t)internal_cb, EVFILT_USER, EV_DELETE, 0, 0, (uint64_t)(void*)internal_cb, 0, 0);
    int ret;
    do {
        ret = kevent64(internal_cb->loop->fd, &event, 1, &event, 1, KEVENT_FLAG_ERROR_EVENTS, NULL);
    } while (IS_EINTR(ret));

    us_poll_free((struct us_poll_t *) a, internal_cb->loop);
}

void us_internal_async_set(struct us_internal_async *a, void (*cb)(struct us_internal_async *)) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) a;
    internal_cb->cb = (void (*)(struct us_internal_callback_t *)) cb;

    struct kevent64_s event;
    EV_SET64(&event, (uintptr_t)internal_cb, EVFILT_USER, EV_ADD | EV_ENABLE | EV_CLEAR, 0, 0, (uint64_t)(void*)internal_cb, 0, 0);
    int ret;
    do {
        ret = kevent64(internal_cb->loop->fd, &event, 1, &event, 1, KEVENT_FLAG_ERROR_EVENTS, NULL);
    } while (IS_EINTR(ret));

    if (UNLIKELY(ret == -1)) {
        abort();
    }
}

void us_internal_async_wakeup(struct us_internal_async *a) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) a;
    struct kevent64_s event;
    EV_SET64(&event, (uintptr_t)internal_cb, EVFILT_USER, 0, NOTE_TRIGGER, 0, (uint64_t)(void*)internal_cb, 0, 0);
    int ret;
    do {
        /* Submit NOTE_TRIGGER only — no eventlist, otherwise this thread can
         * consume the wakeup it just posted instead of waking the loop thread. */
        ret = kevent64(internal_cb->loop->fd, &event, 1, NULL, 0, KEVENT_FLAG_ERROR_EVENTS, NULL);
    } while (IS_EINTR(ret));
}
#endif

int us_socket_get_error(struct us_socket_t *s) {
    int error = 0;
    socklen_t len = sizeof(error);
    if (getsockopt(us_poll_fd((struct us_poll_t *) s), SOL_SOCKET, SO_ERROR, (char *) &error, &len) == -1) {
        return errno;
    }
    return error;
}

#endif
