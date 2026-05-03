/*
 * Authored by Alex Hultman, 2018-2021.
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
// clang-format off
#include "libusockets.h"
#include "internal/internal.h"
#include "quic.h"
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#ifndef WIN32
#include <sys/ioctl.h>
#endif
#ifdef __linux__
#include <netinet/in.h>
#include <linux/errqueue.h>
#endif

#if __has_include("wtf/Platform.h")
#include "wtf/Platform.h"
#elif !defined(ASSERT_ENABLED)
#if defined(BUN_DEBUG) || defined(__has_feature) && __has_feature(address_sanitizer) || defined(__SANITIZE_ADDRESS__)
#define ASSERT_ENABLED 1
#else
#define ASSERT_ENABLED 0
#endif
#endif

#if ASSERT_ENABLED
extern const size_t Bun__lock__size;
#endif

extern void Bun__internal_ensureDateHeaderTimerIsEnabled(struct us_loop_t *loop);

void sweep_timer_cb(struct us_internal_callback_t *cb);

// when the sweep timer is disabled, we don't need to do anything
void sweep_timer_noop(struct us_timer_t *timer) {}

void us_internal_enable_sweep_timer(struct us_loop_t *loop) {
    loop->data.sweep_timer_count++;
    if (loop->data.sweep_timer_count == 1) {
        us_timer_set(loop->data.sweep_timer, (void (*)(struct us_timer_t *)) sweep_timer_cb, LIBUS_TIMEOUT_GRANULARITY * 1000, LIBUS_TIMEOUT_GRANULARITY * 1000);
        Bun__internal_ensureDateHeaderTimerIsEnabled(loop);
    }
}

void us_internal_disable_sweep_timer(struct us_loop_t *loop) {
    loop->data.sweep_timer_count--;
    if (loop->data.sweep_timer_count == 0) {
        us_timer_set(loop->data.sweep_timer, (void (*)(struct us_timer_t *)) sweep_timer_noop, 0, 0);
    }
}

/* The loop has 2 fallthrough polls */
void us_internal_loop_data_init(struct us_loop_t *loop, void (*wakeup_cb)(struct us_loop_t *loop),
    void (*pre_cb)(struct us_loop_t *loop), void (*post_cb)(struct us_loop_t *loop)) {
    // We allocate with calloc, so we only need to initialize the specific fields in use.
    loop->data.sweep_timer = us_create_timer(loop, 1, 0);
    loop->data.sweep_timer_count = 0;
    loop->data.recv_buf = malloc(LIBUS_RECV_BUFFER_LENGTH + LIBUS_RECV_BUFFER_PADDING * 2);
    loop->data.send_buf = malloc(LIBUS_SEND_BUFFER_LENGTH);
    loop->data.pre_cb = pre_cb;
    loop->data.post_cb = post_cb;
    loop->data.wakeup_async = us_internal_create_async(loop, 1, 0);
    us_internal_async_set(loop->data.wakeup_async, (void (*)(struct us_internal_async *)) wakeup_cb);
#if ASSERT_ENABLED
    if (Bun__lock__size != sizeof(loop->data.mutex)) {
        BUN_PANIC("The size of the mutex must match the size of the lock");
    }
#endif
}

void us_internal_loop_data_free(struct us_loop_t *loop) {
#ifndef LIBUS_NO_SSL
    us_internal_free_loop_ssl_data(loop);
#endif

    free(loop->data.recv_buf);
    free(loop->data.send_buf);

    us_timer_close(loop->data.sweep_timer, 0);
    if (loop->data.quic_timer) us_timer_close(loop->data.quic_timer, 0);
    us_internal_async_close(loop->data.wakeup_async);
}

void us_wakeup_loop(struct us_loop_t *loop) {
#ifndef LIBUS_USE_LIBUV
    __atomic_fetch_add(&loop->pending_wakeups, 1, __ATOMIC_RELEASE);
#endif
    us_internal_async_wakeup(loop->data.wakeup_async);
}

void us_internal_loop_link_group(struct us_loop_t *loop, struct us_socket_group_t *group) {
    /* Insert this group as the head of loop */
    group->next = loop->data.head;
    group->prev = 0;
    if (loop->data.head) {
        loop->data.head->prev = group;
    }
    loop->data.head = group;
}

/* Unlink is called before the embedding owner frees its storage */
void us_internal_loop_unlink_group(struct us_loop_t *loop, struct us_socket_group_t *group) {
    /* If a timeout callback in us_internal_timer_sweep deinits the current group,
     * advance the sweep iterator before group->next is cleared — otherwise the sweep
     * walks into freed storage and skips active groups. */
    if (group == loop->data.iterator) {
        loop->data.iterator = group->next;
    }
    if (loop->data.head == group) {
        loop->data.head = group->next;
        if (loop->data.head) {
            loop->data.head->prev = 0;
        }
    } else {
        group->prev->next = group->next;
        if (group->next) {
            group->next->prev = group->prev;
        }
    }
}

/* Teardown helper: close every socket in every group currently linked to this
 * loop. Covers Listener/uWS-App-owned groups that the Zig RareData group list
 * doesn't know about — without this, an accepted us_socket_t whose group is
 * embedded in a still-live Listener leaks at process.exit() (LSAN: 88-byte
 * us_create_poll from loop.c:375). closeAll may unlink the group it's called
 * on, so cache `next` before each call. Returns 1 if anything was linked. */
int us_loop_close_all_groups(struct us_loop_t *loop) {
    struct us_socket_group_t *g = loop->data.head;
    int any = 0;
    while (g) {
        struct us_socket_group_t *next = g->next;
        /* Only connecting/connected sockets are stranded — listen sockets are
         * 1:1 owned by a Zig Listener / uWS App that holds a raw pointer and
         * closes them in finalize(). Closing them here turns that into a UAF
         * after drainClosedSockets(). */
        if (g->head_sockets || g->head_connecting_sockets || g->low_prio_count) {
            us_socket_group_close_all_ex(g, /* also_listeners */ 0);
            any = 1;
        }
        /* close_all → unlink may have spliced our cached `next` out too (an
         * on_close handler closing a different group's last socket); re-read
         * from the loop head if `next` is no longer linked. */
        if (next && !next->linked) next = loop->data.head;
        g = next;
    }
    return any;
}

/* This functions should never run recursively */
void us_internal_timer_sweep(struct us_loop_t *loop) {
    struct us_internal_loop_data_t *loop_data = &loop->data;
    /* For all socket groups in this loop */
    loop_data->iterator = loop_data->head;
    while (loop_data->iterator) {

        struct us_socket_group_t *group = loop_data->iterator;

        /* Update this group's timestamps (this could be moved to loop and done once) */
        group->global_tick++;
        unsigned char short_ticks = group->timestamp = group->global_tick % 240;
        unsigned char long_ticks = group->long_timestamp = (group->global_tick / 15) % 240;

        /* Begin at head */
        struct us_socket_t *s = group->head_sockets;
        while (s) {
            /* Seek until end or timeout found (tightest loop) */
            while (1) {
                /* We only read from 1 random cache line here */
                if (short_ticks == s->timeout || long_ticks == s->long_timeout) {
                    break;
                }

                /* Did we reach the end without a find? */
                if ((s = s->next) == 0) {
                    goto next_group;
                }
            }

            /* Here we have a timeout to emit (slow path) */
            group->iterator = s;

            if (short_ticks == s->timeout) {
                s->timeout = 255;
                us_dispatch_timeout(s);
            }
            /* A timeout handler may have closed every socket and the owner may
             * have deinit'd the embedding group in response (release builds —
             * deinit() asserts iterator==NULL in debug). loop_data->iterator
             * would have been advanced past `group` by unlink_group(); if so,
             * `group` is freed storage and we must not touch it again. */
            if (loop_data->iterator != group) goto outer_continue;

            if (group->iterator == s && long_ticks == s->long_timeout) {
                s->long_timeout = 255;
                us_dispatch_long_timeout(s);
            }
            if (loop_data->iterator != group) goto outer_continue;

            /* Check for unlink / link (if the event handler did not modify the chain, we step 1) */
            if (s == group->iterator) {
                s = s->next;
            } else {
                /* The iterator was changed by event handler */
                s = group->iterator;
            }
        }
        next_group:
        /* Only safe to write back / step ->next if the group survived dispatch. */
        group->iterator = 0;
        loop_data->iterator = group->next;
        outer_continue:;
    }
}

/* We do not want to block the loop with tons and tons of CPU-intensive work for SSL handshakes.
 * Spread it out during many loop iterations, prioritizing already open connections, they are far
 * easier on CPU */
static const int MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION = 5;

void us_internal_handle_low_priority_sockets(struct us_loop_t *loop) {
    struct us_internal_loop_data_t *loop_data = &loop->data;
    struct us_socket_t *s;

    loop_data->low_prio_budget = MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION;

    for (s = loop_data->low_prio_head; s && loop_data->low_prio_budget > 0; s = loop_data->low_prio_head, loop_data->low_prio_budget--) {
        /* Unlink this socket from the low-priority queue */
        loop_data->low_prio_head = s->next;
        if (s->next) s->next->prev = 0;
        s->next = 0;
        s->group->low_prio_count--;

        if(us_socket_is_closed(s)) {
            s->flags.low_prio_state = 2;
            continue;
        }

        us_internal_socket_group_link_socket(s->group, s);
        us_poll_change(&s->p, s->group->loop, us_poll_events(&s->p) | LIBUS_SOCKET_READABLE);

        s->flags.low_prio_state = 2;
    }
}

// Called when DNS resolution completes
// Does not wake up the loop.
void us_internal_dns_callback(struct us_connecting_socket_t *c, void* addrinfo_req) {
    (void)addrinfo_req; /* already stored on c by us_socket_group_connect */
    struct us_loop_t *loop = c->loop;
    Bun__lock(&loop->data.mutex);
    c->next = loop->data.dns_ready_head;
    loop->data.dns_ready_head = c;
    Bun__unlock(&loop->data.mutex);
}

// Called when DNS resolution completes
// Wakes up the loop.
// Can be caleld from any thread.
void us_internal_dns_callback_threadsafe(struct us_connecting_socket_t *c, void* addrinfo_req) {
    struct us_loop_t *loop = c->loop;
    us_internal_dns_callback(c, addrinfo_req);
    us_wakeup_loop(loop);
}

void us_internal_drain_pending_dns_resolve(struct us_loop_t *loop, struct us_connecting_socket_t *s) {
    while (s) {
        struct us_connecting_socket_t *next = s->next;
        us_internal_socket_after_resolve(s);
        s = next;
    }
}

int us_internal_handle_dns_results(struct us_loop_t *loop) {
    Bun__lock(&loop->data.mutex);
    struct us_connecting_socket_t *s = loop->data.dns_ready_head;
    loop->data.dns_ready_head = NULL;
    Bun__unlock(&loop->data.mutex);
    us_internal_drain_pending_dns_resolve(loop, s);
    return s != NULL;
}

/* Note: Properly takes the linked list and timeout sweep into account */
void us_internal_free_closed_sockets(struct us_loop_t *loop) {
    /* Free all closed sockets (maybe it is better to reverse order?) */
    for (struct us_socket_t *s = loop->data.closed_head; s; ) {
        struct us_socket_t *next = s->next;
        s->prev = s->next = 0;
        us_poll_free((struct us_poll_t *) s, loop);
        s = next;
    }
    loop->data.closed_head = NULL;

    for (struct us_udp_socket_t *s = loop->data.closed_udp_head; s; ) {
        struct us_udp_socket_t *next = s->next;
        us_poll_free((struct us_poll_t *) s, loop);
        s = next;
    }
    loop->data.closed_udp_head = NULL;

    for (struct us_connecting_socket_t *s = loop->data.closed_connecting_head; s; ) {
        struct us_connecting_socket_t *next = s->next;
        us_free(s);
        s = next;
    }
    loop->data.closed_connecting_head = NULL;
}

void sweep_timer_cb(struct us_internal_callback_t *cb) {
    us_internal_timer_sweep(cb->loop);
}

long long us_loop_iteration_number(struct us_loop_t *loop) {
    return loop->data.iteration_nr;
}

/* These may have somewhat different meaning depending on the underlying event library */
void us_internal_loop_pre(struct us_loop_t *loop) {
    loop->data.iteration_nr++;
    us_internal_handle_dns_results(loop);
    us_internal_handle_low_priority_sockets(loop);
    loop->data.pre_cb(loop);
#ifdef LIBUS_USE_QUIC
    /* Flush stream writes that JS tasks made before this tick (timers,
     * immediates, promise resolutions outside on_read) so they go out
     * before epoll blocks. loop_post handles what this iteration receives. */
    if (loop->data.quic_head) us_quic_loop_process(loop);
#endif
}

void us_internal_loop_post(struct us_loop_t *loop) {
    us_internal_handle_dns_results(loop);
#ifdef LIBUS_USE_QUIC
    if (loop->data.quic_head) us_quic_loop_process(loop);
#endif
    /* A poll callback may re-enter the loop (e.g. expect().toThrow() →
     * waitForPromise → us_loop_run_bun_tick). The inner tick must not free
     * closed sockets: the outer tick's dispatch is mid-iteration and may still
     * hold a pointer to one (it reads s->flags right after on_data returns).
     * Defer to the outermost tick's loop_post. */
    if (loop->data.tick_depth <= 1) {
        us_internal_free_closed_sockets(loop);
    }
    loop->data.post_cb(loop);
}

#ifdef WIN32
#define us_ioctl ioctlsocket
#else
#define us_ioctl ioctl
#endif

void us_internal_dispatch_ready_poll(struct us_poll_t *p, int error, int eof, int events) {
    switch (us_internal_poll_type(p)) {
    case POLL_TYPE_CALLBACK: {
            struct us_internal_callback_t *cb = (struct us_internal_callback_t *) p;
            /* Timers, asyncs should accept (read), while UDP sockets should obviously not */
            if (!cb->leave_poll_ready) {
                /* Let's just have this macro to silence the CodeQL alert regarding empty function when using libuv */
    #ifndef LIBUS_USE_LIBUV
                us_internal_accept_poll_event(p);
    #endif
            }
            cb->cb(cb->cb_expects_the_loop ? (struct us_internal_callback_t *) cb->loop : (struct us_internal_callback_t *) &cb->p);
            break;
        }
    case POLL_TYPE_SEMI_SOCKET: {
            /* Both connect and listen sockets are semi-sockets
             * but they poll for different events */
            if (us_poll_events(p) == LIBUS_SOCKET_WRITABLE) {
                us_internal_socket_after_open((struct us_socket_t *) p, error || eof);
            } else {
                struct us_listen_socket_t *listen_socket = (struct us_listen_socket_t *) p;
                struct us_socket_group_t *accept_group = listen_socket->accept_group;
                struct us_loop_t *loop = accept_group->loop;
                struct bsd_addr_t addr;

                LIBUS_SOCKET_DESCRIPTOR client_fd = bsd_accept_socket(us_poll_fd(p), &addr);
                if (client_fd == LIBUS_SOCKET_ERROR) {
                    /* Todo: start timer here */

                } else {

                    /* Todo: stop timer if any */

                    do {
                        struct us_poll_t *accepted_p = us_create_poll(loop, 0, sizeof(struct us_socket_t) - sizeof(struct us_poll_t) + listen_socket->socket_ext_size);
                        us_poll_init(accepted_p, client_fd, POLL_TYPE_SOCKET);
                        us_poll_start(accepted_p, loop, LIBUS_SOCKET_READABLE);

                        struct us_socket_t *s = (struct us_socket_t *) accepted_p;

                        s->group = accept_group;
                        s->kind = listen_socket->accept_kind;
                        s->ssl = NULL;
                        s->connect_state = NULL;
                        s->timeout = 255;
                        s->long_timeout = 255;
                        s->flags.low_prio_state = 0;
                        s->flags.allow_half_open = listen_socket->s.flags.allow_half_open;
                        s->flags.is_paused = 0;
                        s->flags.is_ipc = 0;
                        s->flags.is_closed = 0;
                        s->flags.adopted = 0;

                        /* We always use nodelay */
                        bsd_socket_nodelay(client_fd, 1);

                        us_internal_socket_group_link_socket(accept_group, s);

                        if (listen_socket->ssl_ctx) {
                            us_internal_ssl_attach(s, listen_socket->ssl_ctx, /*is_client*/ 0, NULL, listen_socket);
                            us_internal_ssl_on_open(s, 0, bsd_addr_get_ip(&addr), bsd_addr_get_ip_length(&addr));
                        } else {
                            us_dispatch_open(s, 0, bsd_addr_get_ip(&addr), bsd_addr_get_ip_length(&addr));
                        }
                        /* After socket adoption, track the new socket; the old one becomes invalid */
                        if(s && s->flags.adopted && s->prev) {
                            s = s->prev;
                        }

                        /* When the kernel deferred the accept until data arrived (TCP_DEFER_ACCEPT
                         * on Linux, SO_ACCEPTFILTER on FreeBSD), the request/ClientHello is already
                         * in the buffer. Dispatch readable now instead of returning to epoll just to
                         * learn what we already know. The POLL_TYPE_SOCKET handler tolerates
                         * EWOULDBLOCK for the rare case where the defer timed out with no data. */
                        if (listen_socket->deferred_accept && s && !us_socket_is_closed(s)) {
                            us_internal_dispatch_ready_poll((struct us_poll_t *) s, 0, 0, LIBUS_SOCKET_READABLE);
                        }

                        /* Exit accept loop if listen socket was closed in on_open or the request handler */
                        if (us_socket_is_closed(&listen_socket->s)) {
                            break;
                        }

                    } while ((client_fd = bsd_accept_socket(us_poll_fd(p), &addr)) != LIBUS_SOCKET_ERROR);
                }
            }
        break;
    }
    case POLL_TYPE_SOCKET_SHUT_DOWN:
    case POLL_TYPE_SOCKET: {
            /* We should only use s, no p after this point */
            struct us_socket_t *s = (struct us_socket_t *) p;
            /* After socket adoption, track the new socket; the old one becomes invalid */
            if(s && s->flags.adopted && s->prev) {
                s = s->prev;
            }
            /* The group can change after calling a callback but the loop is always the same */
            struct us_loop_t* loop = s->group->loop;
            if (events & LIBUS_SOCKET_WRITABLE && !error) {
                s->flags.last_write_failed = 0;
                #ifdef LIBUS_USE_KQUEUE
                /* Kqueue EVFILT_WRITE is one-shot so the filter is removed after delivery.
                 * Clear POLLING_OUT to reflect this.
                 * Keep POLLING_IN from the poll's own state, NOT from `events`: kqueue delivers
                 * each filter as a separate kevent, so a pure EVFILT_WRITE event won't have
                 * LIBUS_SOCKET_READABLE set even though the socket is still registered for reads. */
                p->state.poll_type = us_internal_poll_type(p) | (p->state.poll_type & POLL_TYPE_POLLING_IN);
                #endif

                s = s->ssl ? us_internal_ssl_on_writable(s) : us_dispatch_writable(s);
                /* After socket adoption, track the new socket; the old one becomes invalid */
                if(s && s->flags.adopted && s->prev) {
                    s = s->prev;
                }

                if (!s || us_socket_is_closed(s)) {
                    return;
                }

                /* If we have no failed write or if we shut down, then stop polling for more writable */
                if (!s->flags.last_write_failed || us_socket_is_shut_down(s)) {
                    us_poll_change(&s->p, loop, us_poll_events(&s->p) & LIBUS_SOCKET_READABLE);
                } else {
                    #ifdef LIBUS_USE_KQUEUE
                    /* Kqueue one-shot writable needs to be re-registered */
                    us_poll_change(&s->p, loop, us_poll_events(&s->p) | LIBUS_SOCKET_WRITABLE);
                    #endif
                }
            }

            if (events & LIBUS_SOCKET_READABLE) {
                /* Contexts may prioritize down sockets that are currently readable, e.g. when SSL handshake has to be done.
                 * SSL handshakes are CPU intensive, so we limit the number of handshakes per loop iteration, and move the rest
                 * to the low-priority queue */
                struct us_socket_flags* flags = &s->flags;
                /* Only the SSL handshake gate ever returns low-prio. The
                 * non-SSL arm dispatched a full vtable lookup just to read
                 * NULL — no Zig handler defines isLowPrio and every C++ vtable
                 * sets is_low_prio = nullptr — so it's been dropped. */
                if (s->ssl && us_internal_ssl_is_low_prio(s)) {
                    if (flags->low_prio_state == 2) {
                        flags->low_prio_state = 0; /* Socket has been delayed and now it's time to process incoming data for one iteration */
                    } else if (loop->data.low_prio_budget > 0) {
                        loop->data.low_prio_budget--; /* Still having budget for this iteration - do normal processing */
                    } else {
                        struct us_poll_t* poll = &s->p;
                        us_poll_change(poll, loop, us_poll_events(poll) & LIBUS_SOCKET_WRITABLE);
                        struct us_socket_group_t *g = s->group;
                        /* Queued sockets aren't in head_sockets while parked, so
                         * the group's emptiness check needs this counter to know
                         * the owner can't deinit yet. Bump BEFORE unlinking so
                         * maybe_unlink() inside it still sees the group as
                         * non-empty. */
                        g->low_prio_count++;
                        us_internal_socket_group_unlink_socket(g, s);

                        /* Link this socket to the low-priority queue - we use a LIFO queue, to prioritize newer clients that are
                         * maybe not already timeouted - sounds unfair, but works better in real-life with smaller client-timeouts
                         * under high load */
                        s->prev = 0;
                        s->next = loop->data.low_prio_head;
                        if (s->next) s->next->prev = s;
                        loop->data.low_prio_head = s;

                        flags->low_prio_state = 1;

                        break;
                    }
                }

                size_t repeat_recv_count = 0;

                do {
                    #ifdef _WIN32
                      const int recv_flags = MSG_PUSH_IMMEDIATE;
                    #else
                      const int recv_flags = MSG_DONTWAIT;
                    #endif

                    int length;
                    #if !defined(_WIN32)
                    if(s->flags.is_ipc) {
                        struct msghdr msg = {0};
                        struct iovec iov = {0};
                        char cmsg_buf[CMSG_SPACE(sizeof(int))];

                        iov.iov_base = loop->data.recv_buf + LIBUS_RECV_BUFFER_PADDING;
                        iov.iov_len = LIBUS_RECV_BUFFER_LENGTH;

                        msg.msg_flags = 0;
                        msg.msg_iov = &iov;
                        msg.msg_iovlen = 1;
                        msg.msg_name = NULL;
                        msg.msg_namelen = 0;
                        msg.msg_controllen = CMSG_LEN(sizeof(int));
                        msg.msg_control = cmsg_buf;

                        length = bsd_recvmsg(us_poll_fd(&s->p), &msg, recv_flags);

                        // Extract file descriptor if present
                        if (length > 0 && msg.msg_controllen > 0) {
                            struct cmsghdr *cmsg_ptr = CMSG_FIRSTHDR(&msg);
                            if (cmsg_ptr && cmsg_ptr->cmsg_level == SOL_SOCKET && cmsg_ptr->cmsg_type == SCM_RIGHTS) {
                                int fd = *(int *)CMSG_DATA(cmsg_ptr);
                                s = us_dispatch_fd(s, fd);
                                if (!s || us_socket_is_closed(s)) {
                                    break;
                                }
                            }
                        }
                    }else{
                    #endif
                        length = bsd_recv(us_poll_fd(&s->p), loop->data.recv_buf + LIBUS_RECV_BUFFER_PADDING, LIBUS_RECV_BUFFER_LENGTH, recv_flags);
                    #if !defined(_WIN32)
                    }
                    #endif

                    if (length > 0) {
                        s = s->ssl ? us_internal_ssl_on_data(s, loop->data.recv_buf + LIBUS_RECV_BUFFER_PADDING, length)
                                   : us_dispatch_data(s, loop->data.recv_buf + LIBUS_RECV_BUFFER_PADDING, length);
                        /* After socket adoption, track the new socket; the old one becomes invalid */
                        if(s && s->flags.adopted && s->prev) {
                            s = s->prev;
                        }
                        // loop->num_ready_polls isn't accessible on Windows.
                        #ifndef WIN32
                        // rare case: we're reading a lot of data, there's more to be read, and either:
                        // - the socket has hung up, so we will never get more data from it (only applies to macOS, as macOS will send the event the same tick but Linux will not.)
                        // - the event loop isn't very busy, so we can read multiple times in a row
                        #define LOOP_ISNT_VERY_BUSY_THRESHOLD 25
                        if (
                            s && length >= (LIBUS_RECV_BUFFER_LENGTH - 24 * 1024) && length <= LIBUS_RECV_BUFFER_LENGTH &&
                            (error || loop->num_ready_polls < LOOP_ISNT_VERY_BUSY_THRESHOLD) &&
                            !us_socket_is_closed(s)
                        ) {
                            repeat_recv_count += error == 0;

                            // When not hung up, read a maximum of 10 times to avoid starving other sockets
                            // We don't bother with ioctl(FIONREAD) because we've set MSG_DONTWAIT
                            if (!(repeat_recv_count > 10 && loop->num_ready_polls > 2)) {
                                continue;
                            }
                        }
                        #undef LOOP_ISNT_VERY_BUSY_THRESHOLD
                        #endif
                    } else if (!length) {
                        eof = 1; // lets handle EOF in the same place
                        break;
                    } else if (length == LIBUS_SOCKET_ERROR && !bsd_would_block()) {
                        /* Peer-initiated TCP error (RST etc.) — go straight to
                         * raw-close. us_socket_close() would route through
                         * us_internal_ssl_close() now that s->ssl is the
                         * discriminator, and that path fires
                         * on_handshake(ECONNRESET) for HANDSHAKE_PENDING — fine
                         * for app-initiated close, wrong here: a Happy-Eyeballs
                         * loser leg RSTing a server's accepted socket would
                         * surface as `tlsClientError` → uncaught in node:http2.
                         * main called us_socket_close(ssl=0, …) at every loop
                         * close site for exactly this reason. */
                        s = us_internal_socket_close_raw(s, LIBUS_ERR, NULL);
                        return;
                    }

                    break;
                } while (s);
            }

            if(eof && s) {
                if (UNLIKELY(us_socket_is_closed(s))) {
                    // Do not call on_end after the socket has been closed
                    return;
                }
                if (us_socket_is_shut_down(s)) {
                    /* We got FIN back after sending it */
                    s = us_internal_socket_close_raw(s, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, NULL);
                    return;
                }
                if(s->flags.allow_half_open) {
                    /* We got a Error but is EOF and we allow half open so stop polling for readable and keep going*/
                    us_poll_change(&s->p, loop, us_poll_events(&s->p) & LIBUS_SOCKET_WRITABLE);
                    s = s->ssl ? us_internal_ssl_on_end(s) : us_dispatch_end(s);
                } else {
                    /* We dont allow half open just emit end and close the socket */
                    s = s->ssl ? us_internal_ssl_on_end(s) : us_dispatch_end(s);
                    s = us_internal_socket_close_raw(s, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, NULL);
                    return;
                }
            }
            /* Such as epollerr or EV_ERROR */
            if (error && s) {
                /* Peer-initiated error event — same rationale as the recv-error
                 * branch above: bypass us_internal_ssl_close so on_handshake
                 * isn't fired for a passive close. */
                s = us_internal_socket_close_raw(s, error, NULL);
                return;
            }
            break;
        }
        case POLL_TYPE_UDP: {
            struct us_udp_socket_t *u = (struct us_udp_socket_t *) p;
            if (u->closed) {
                break;
            }

#if defined(__linux__)
            /* On Linux with IP_RECVERR, EPOLLERR fires when an ICMP error
             * (port unreachable, host unreachable, TTL exceeded, ...) is
             * queued on the socket's error queue. For an *unconnected* UDP
             * socket regular recvmmsg does NOT dequeue these — only
             * recvmsg(MSG_ERRQUEUE) does — so EPOLLERR stays level-triggered
             * until we drain it explicitly. Do that here, surfacing each
             * errno via on_recv_error; the socket stays open. On other
             * platforms (kqueue EV_ERROR, Windows) an error event is fatal —
             * preserve close-on-error there. */
            int recv_error_surfaced = 0;
            int recv_would_block_only = 0;
            if (error) {
                struct msghdr eh; char ectrl[512]; char ebuf[1];
                struct iovec eiov = { ebuf, sizeof(ebuf) };
                while (!u->closed) {
                    memset(&eh, 0, sizeof(eh));
                    eh.msg_iov = &eiov; eh.msg_iovlen = 1;
                    eh.msg_control = ectrl; eh.msg_controllen = sizeof(ectrl);
                    if (recvmsg(us_poll_fd(p), &eh, MSG_ERRQUEUE) < 0) break;
                    recv_error_surfaced = 1;
                    if (u->on_recv_error) {
                        /* The queued ICMP error is in sock_extended_err,
                         * not errno. */
                        int ee = 0;
                        for (struct cmsghdr *cm = CMSG_FIRSTHDR(&eh); cm; cm = CMSG_NXTHDR(&eh, cm)) {
                            if ((cm->cmsg_level == IPPROTO_IP   && cm->cmsg_type == IP_RECVERR) ||
                                (cm->cmsg_level == IPPROTO_IPV6 && cm->cmsg_type == IPV6_RECVERR)) {
                                ee = ((struct sock_extended_err *) CMSG_DATA(cm))->ee_errno;
                                break;
                            }
                        }
                        u->on_recv_error(u, ee ? ee : ECONNREFUSED);
                    }
                }
            }
#endif

            if ((events & LIBUS_SOCKET_READABLE) && !u->closed) {

                do {
                    struct udp_recvbuf recvbuf;
                    bsd_udp_setup_recvbuf(&recvbuf, u->loop->data.recv_buf, LIBUS_RECV_BUFFER_LENGTH);
                    int npackets = bsd_recvmmsg(us_poll_fd(p), &recvbuf, MSG_DONTWAIT);
                    if (npackets > 0) {
                        u->on_data(u, &recvbuf, npackets);
                    } else {
                        if (npackets == LIBUS_SOCKET_ERROR) {
                            if (!bsd_would_block()) {
#if defined(__linux__)
                                int recv_err = errno;
                                recv_error_surfaced = 1;
                                if (u->on_recv_error) {
                                    u->on_recv_error(u, recv_err);
                                }
#else
                                /* non-Linux: fall through and close below */
                                error = 1;
#endif
                            }
#if defined(__linux__)
                            else {
                                recv_would_block_only = 1;
                            }
#endif
                        } else {
                            // 0 messages received, we are done
                            // this case can happen if either:
                            // - the total number of messages pending was not divisible by 8
                            // - recvmsg() was used instead of recvmmsg() and there was no message to read.
                        }

                        break;
                    }
                } while (!u->closed);
            }

            if (events & LIBUS_SOCKET_WRITABLE && !u->closed) {
                /* Clear WRITABLE before on_drain so a callback that re-arms it
                 * (e.g. QUIC packets_out hitting EAGAIN) keeps the re-arm. We
                 * still default to one-shot drain semantics for callers that
                 * don't touch the poll mask. Not gated on !error: a queued
                 * ICMP error must not leave WRITABLE armed (level-triggered
                 * EPOLLOUT + EPOLLERR would spin the loop). */
                us_poll_change(&u->p, u->loop, us_poll_events(&u->p) & LIBUS_SOCKET_READABLE);
                u->on_drain(u);
                if (u->closed) {
                    break;
                }
            }

#if defined(__linux__)
            /* Only close on EPOLLERR if we didn't surface the real errno
             * via recvmmsg + on_recv_error above AND recv wasn't just
             * EAGAIN (which means the error queue is already drained,
             * leaving a residual EPOLLERR). Otherwise the socket stays
             * open so the user can keep sending/receiving after a
             * transient ICMP error. */
            if (error && !recv_error_surfaced && !recv_would_block_only && !u->closed) {
                us_udp_socket_close(u);
            }
#else
            if (error && !u->closed) {
                us_udp_socket_close(u);
            }
#endif
            break;
        }
    }
}

/* Integration only requires the timer to be set up, but not automatically enabled */
void us_loop_integrate(struct us_loop_t *loop) {
    /* Timer is now controlled dynamically by socket count, not enabled automatically */
}

void *us_loop_ext(struct us_loop_t *loop) {
    return loop + 1;
}

#undef us_ioctl
