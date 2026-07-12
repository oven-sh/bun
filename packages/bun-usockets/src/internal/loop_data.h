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

#ifndef LOOP_DATA_H
#define LOOP_DATA_H

#include <stdint.h>

#if defined(__APPLE__)
#include <os/lock.h>
typedef os_unfair_lock zig_mutex_t;
#elif defined(__linux__) || defined(__FreeBSD__)
typedef uint32_t zig_mutex_t;
#elif defined(_WIN32)
// SRWLOCK
typedef void* zig_mutex_t;
#else
#error "Unsupported platform"
#endif

// IMPORTANT: When changing this, don't forget to update the Rust mirror in src/uws_sys/InternalLoopData.rs as well!
struct us_quic_socket_context_s;

struct us_internal_loop_data_t {
#ifdef LIBUS_USE_LIBUV
    struct us_timer_t *sweep_timer;
#else
    /* Absolute monotonic ns of the next sweep, or -1. Folded into the poll
     * timeout — no timerfd, no EVFILT_TIMER. */
    long long sweep_next_tick_ns;
#endif
    int sweep_timer_count;
    struct us_internal_async *wakeup_async;
    struct us_socket_group_t *head;
    /* QUIC engines on this loop. us_quic_loop_process walks the list from
     * loop_post / drainMicrotasks; the lazy fallthrough timer only wakes the
     * loop for lsquic's time-driven state (RTO, ACK delay) — its callback
     * just calls us_quic_loop_process. */
    struct us_quic_socket_context_s *quic_head;
    /* µs until lsquic next wants process_conns (min earliest_adv_tick
     * across engines), or -1 for "no deadline". Written by
     * us_quic_loop_process from loop_post; read by Bun's getTimeout() to
     * bound the epoll_pwait2 timeout. No timerfd, no scheduling syscall —
     * the gap between loop_post and getTimeout is sub-µs so storing the
     * relative diff is precise enough. */
    long long quic_next_tick_us;
#ifdef LIBUS_USE_LIBUV
    /* A fallthrough us_timer_t armed to quic_next_tick_us so the uv loop wakes
     * for lsquic's time-driven state. POSIX folds the deadline into the
     * epoll_pwait2 timeout via getTimeout() instead. */
    struct us_timer_t *quic_timer;
#endif
    struct us_socket_group_t *iterator;
    char *recv_buf;
    char *send_buf;
    void *ssl_data;
    void (*pre_cb)(struct us_loop_t *);
    void (*post_cb)(struct us_loop_t *);
    struct us_udp_socket_t *closed_udp_head;
    struct us_socket_t *closed_head;
    struct us_socket_t *low_prio_head;
    int low_prio_budget;
    struct us_connecting_socket_t *dns_ready_head;
    struct us_connecting_socket_t *closed_connecting_head;
    zig_mutex_t mutex;
    void *parent_ptr;
    char parent_tag;
    /* We do not care if this flips or not, it doesn't matter */
    size_t iteration_nr;
    void* jsc_vm;
    /* Reentrancy depth of us_loop_run_bun_tick. When >1, we are inside a
     * nested tick (e.g. waitForPromise from a poll callback). Freeing closed
     * sockets must be deferred to the outermost tick so the outer dispatch
     * doesn't read a freed poll. */
    int tick_depth;
    /* Monotonic timestamp (ns) captured when the loop was created; the origin
     * for event-loop-utilization. Set once in us_internal_loop_data_init. */
    uint64_t creation_monotonic_ns;
    /* Accumulated time (ns) the loop spent blocked in the event provider
     * (epoll_pwait2 / kevent64). Written with __atomic_* by the owning thread
     * in us_loop_run_bun_tick; read atomically by any thread (the parent reads
     * a worker's counter for Worker.performance.eventLoopUtilization()). On
     * Windows the idle time comes from uv_metrics_idle_time() instead, so this
     * field is left at zero there. */
    uint64_t idle_time_ns;
    /* Monotonic timestamp (ns) of an in-progress provider wait, or 0 when not
     * waiting. Lets a cross-thread reader credit the currently-blocked wait to
     * idle instead of active (mirrors libuv's provider_entry_time). Written
     * with __atomic_* by the owning thread around the epoll/kevent syscall;
     * unused on Windows (uv_metrics_idle_time already accounts for it). */
    uint64_t idle_entry_ns;
};

#endif // LOOP_DATA_H
