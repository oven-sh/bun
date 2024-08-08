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
#include <stdlib.h>
#ifndef WIN32
#include <sys/ioctl.h>
#endif

/* The loop has 2 fallthrough polls */
void us_internal_loop_data_init(struct us_loop_t *loop, void (*wakeup_cb)(struct us_loop_t *loop),
    void (*pre_cb)(struct us_loop_t *loop), void (*post_cb)(struct us_loop_t *loop)) {
    loop->data.sweep_timer = us_create_timer(loop, 1, 0);
    loop->data.recv_buf = malloc(LIBUS_RECV_BUFFER_LENGTH + LIBUS_RECV_BUFFER_PADDING * 2);
    loop->data.send_buf = malloc(LIBUS_SEND_BUFFER_LENGTH);
    loop->data.ssl_data = 0;
    loop->data.head = 0;
    loop->data.iterator = 0;
    loop->data.closed_udp_head = 0;
    loop->data.closed_head = 0;
    loop->data.low_prio_head = 0;
    loop->data.low_prio_budget = 0;

    loop->data.pre_cb = pre_cb;
    loop->data.post_cb = post_cb;
    loop->data.iteration_nr = 0;

    loop->data.closed_connecting_head = 0;
    loop->data.dns_ready_head = 0;
    loop->data.mutex = 0;

    loop->data.parent_ptr = 0;
    loop->data.parent_tag = 0;

    loop->data.closed_context_head = 0;

    loop->data.wakeup_async = us_internal_create_async(loop, 1, 0);
    us_internal_async_set(loop->data.wakeup_async, (void (*)(struct us_internal_async *)) wakeup_cb);
}

void us_internal_loop_data_free(struct us_loop_t *loop) {
#ifndef LIBUS_NO_SSL
    us_internal_free_loop_ssl_data(loop);
#endif

    free(loop->data.recv_buf);
    free(loop->data.send_buf);

    us_timer_close(loop->data.sweep_timer, 0);
    us_internal_async_close(loop->data.wakeup_async);
}

void us_wakeup_loop(struct us_loop_t *loop) {
    us_internal_async_wakeup(loop->data.wakeup_async);
}

void us_internal_loop_link(struct us_loop_t *loop, struct us_socket_context_t *context) {
    /* Insert this context as the head of loop */
    context->next = loop->data.head;
    context->prev = 0;
    if (loop->data.head) {
        loop->data.head->prev = context;
    }
    loop->data.head = context;
}

/* Unlink is called before free */
void us_internal_loop_unlink(struct us_loop_t *loop, struct us_socket_context_t *context) {
    if (loop->data.head == context) {
        loop->data.head = context->next;
        if (loop->data.head) {
            loop->data.head->prev = 0;
        }
    } else {
        context->prev->next = context->next;
        if (context->next) {
            context->next->prev = context->prev;
        }
    }
}

/* This functions should never run recursively */
void us_internal_timer_sweep(struct us_loop_t *loop) {
    struct us_internal_loop_data_t *loop_data = &loop->data;
    /* For all socket contexts in this loop */
    for (loop_data->iterator = loop_data->head; loop_data->iterator; loop_data->iterator = loop_data->iterator->next) {

        struct us_socket_context_t *context = loop_data->iterator;

        /* Update this context's timestamps (this could be moved to loop and done once) */
        context->global_tick++;
        unsigned char short_ticks = context->timestamp = context->global_tick % 240;
        unsigned char long_ticks = context->long_timestamp = (context->global_tick / 15) % 240;

        /* Begin at head */
        struct us_socket_t *s = context->head_sockets;
        while (s) {
            /* Seek until end or timeout found (tightest loop) */
            while (1) {
                /* We only read from 1 random cache line here */
                if (short_ticks == s->timeout || long_ticks == s->long_timeout) {
                    break;
                }

                /* Did we reach the end without a find? */
                if ((s = s->next) == 0) {
                    goto next_context;
                }
            }

            /* Here we have a timeout to emit (slow path) */
            context->iterator = s;

            if (short_ticks == s->timeout) {
                s->timeout = 255;
                if (context->on_socket_timeout != NULL) context->on_socket_timeout(s);
            }

            if (context->iterator == s && long_ticks == s->long_timeout) {
                s->long_timeout = 255;
                if (context->on_socket_long_timeout != NULL) context->on_socket_long_timeout(s);
            }   

            /* Check for unlink / link (if the event handler did not modify the chain, we step 1) */
            if (s == context->iterator) {
                s = s->next;
            } else {
                /* The iterator was changed by event handler */
                s = context->iterator;
            }
        }
        /* We always store a 0 to context->iterator here since we are no longer iterating this context */
        next_context:
        context->iterator = 0;
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

        us_internal_socket_context_link_socket(s->context, s);
        us_poll_change(&s->p, us_socket_context(0, s)->loop, us_poll_events(&s->p) | LIBUS_SOCKET_READABLE);

        s->low_prio_state = 2;
    }
}

// Called when DNS resolution completes
// Does not wake up the loop.
void us_internal_dns_callback(struct us_connecting_socket_t *c, void* addrinfo_req) {
    struct us_loop_t *loop = c->context->loop;
    Bun__lock(&loop->data.mutex);
    c->addrinfo_req = addrinfo_req;
    c->next = loop->data.dns_ready_head;
    loop->data.dns_ready_head = c;
    Bun__unlock(&loop->data.mutex);
}

// Called when DNS resolution completes
// Wakes up the loop.
// Can be caleld from any thread.
void us_internal_dns_callback_threadsafe(struct us_connecting_socket_t *c, void* addrinfo_req) {
    struct us_loop_t *loop = c->context->loop;
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
        us_poll_free((struct us_poll_t *) s, loop);
        s = next;
    }
    loop->data.closed_head = 0;

    for (struct us_udp_socket_t *s = loop->data.closed_udp_head; s; ) {
        struct us_udp_socket_t *next = s->next;
        us_poll_free((struct us_poll_t *) s, loop);
        s = next;
    }
    loop->data.closed_udp_head = 0;

    for (struct us_connecting_socket_t *s = loop->data.closed_connecting_head; s; ) {
        struct us_connecting_socket_t *next = s->next;
        us_free(s);
        s = next;
    }
    loop->data.closed_connecting_head = 0;
}

void us_internal_free_closed_contexts(struct us_loop_t *loop) {
    for (struct us_socket_context_t *ctx = loop->data.closed_context_head; ctx; ) {
        struct us_socket_context_t *next = ctx->next;
        us_free(ctx);
        ctx = next;
    }
    loop->data.closed_context_head = 0;
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
}

void us_internal_loop_post(struct us_loop_t *loop) {
    us_internal_handle_dns_results(loop);
    us_internal_free_closed_sockets(loop);
    us_internal_free_closed_contexts(loop);
    loop->data.post_cb(loop);
}

#ifdef WIN32
#define us_ioctl ioctlsocket
#else
#define us_ioctl ioctl
#endif

void us_internal_dispatch_ready_poll(struct us_poll_t *p, int error, int events) {
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
                us_internal_socket_after_open((struct us_socket_t *) p, error);
            } else {
                struct us_listen_socket_t *listen_socket = (struct us_listen_socket_t *) p;
                struct bsd_addr_t addr;

                LIBUS_SOCKET_DESCRIPTOR client_fd = bsd_accept_socket(us_poll_fd(p), &addr);
                if (client_fd == LIBUS_SOCKET_ERROR) {
                    /* Todo: start timer here */

                } else {

                    /* Todo: stop timer if any */

                    do {
                        struct us_poll_t *accepted_p = us_create_poll(us_socket_context(0, &listen_socket->s)->loop, 0, sizeof(struct us_socket_t) - sizeof(struct us_poll_t) + listen_socket->socket_ext_size);
                        us_poll_init(accepted_p, client_fd, POLL_TYPE_SOCKET);
                        us_poll_start(accepted_p, listen_socket->s.context->loop, LIBUS_SOCKET_READABLE);

                        struct us_socket_t *s = (struct us_socket_t *) accepted_p;

                        s->context = listen_socket->s.context;
                        s->connect_state = NULL;
                        s->timeout = 255;
                        s->long_timeout = 255;
                        s->low_prio_state = 0;

                        /* We always use nodelay */
                        bsd_socket_nodelay(client_fd, 1);

                        us_internal_socket_context_link_socket(listen_socket->s.context, s);

                        listen_socket->s.context->on_open(s, 0, bsd_addr_get_ip(&addr), bsd_addr_get_ip_length(&addr));

                        /* Exit accept loop if listen socket was closed in on_open handler */
                        if (us_socket_is_closed(0, &listen_socket->s)) {
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

            if (events & LIBUS_SOCKET_WRITABLE && !error) {
                /* Note: if we failed a write as a socket of one loop then adopted
                 * to another loop, this will be wrong. Absurd case though */
                s->context->loop->data.last_write_failed = 0;

                s = s->context->on_writable(s);

                if (!s || us_socket_is_closed(0, s)) {
                    return;
                }

                /* If we have no failed write or if we shut down, then stop polling for more writable */
                if (!s->context->loop->data.last_write_failed || us_socket_is_shut_down(0, s)) {
                    us_poll_change(&s->p, us_socket_context(0, s)->loop, us_poll_events(&s->p) & LIBUS_SOCKET_READABLE);
                }
            }

            if (events & LIBUS_SOCKET_READABLE) {
                /* Contexts may prioritize down sockets that are currently readable, e.g. when SSL handshake has to be done.
                 * SSL handshakes are CPU intensive, so we limit the number of handshakes per loop iteration, and move the rest
                 * to the low-priority queue */
                if (s->context->is_low_prio(s)) {
                    if (s->low_prio_state == 2) {
                        s->low_prio_state = 0; /* Socket has been delayed and now it's time to process incoming data for one iteration */
                    } else if (s->context->loop->data.low_prio_budget > 0) {
                        s->context->loop->data.low_prio_budget--; /* Still having budget for this iteration - do normal processing */
                    } else {
                        us_poll_change(&s->p, us_socket_context(0, s)->loop, us_poll_events(&s->p) & LIBUS_SOCKET_WRITABLE);
                        us_socket_context_ref(0,  s->context);
                        us_internal_socket_context_unlink_socket(0, s->context, s);

                        /* Link this socket to the low-priority queue - we use a LIFO queue, to prioritize newer clients that are
                         * maybe not already timeouted - sounds unfair, but works better in real-life with smaller client-timeouts
                         * under high load */
                        s->prev = 0;
                        s->next = s->context->loop->data.low_prio_head;
                        if (s->next) s->next->prev = s;
                        s->context->loop->data.low_prio_head = s;

                        s->low_prio_state = 1;

                        break;
                    }
                }

                size_t repeat_recv_count = 0;

                do {
                    const struct us_loop_t* loop = s->context->loop;
                    #ifdef _WIN32
                      const int recv_flags = MSG_PUSH_IMMEDIATE;
                    #else
                      const int recv_flags = MSG_DONTWAIT | MSG_NOSIGNAL;
                    #endif

                    int length = bsd_recv(us_poll_fd(&s->p), loop->data.recv_buf + LIBUS_RECV_BUFFER_PADDING, LIBUS_RECV_BUFFER_LENGTH, recv_flags);

                    if (length > 0) {
                        s = s->context->on_data(s, loop->data.recv_buf + LIBUS_RECV_BUFFER_PADDING, length);
                        // loop->num_ready_polls isn't accessible on Windows.
                        #ifndef WIN32
                        // rare case: we're reading a lot of data, there's more to be read, and either:
                        // - the socket has hung up, so we will never get more data from it (only applies to macOS, as macOS will send the event the same tick but Linux will not.)
                        // - the event loop isn't very busy, so we can read multiple times in a row
                        #define LOOP_ISNT_VERY_BUSY_THRESHOLD 25
                        if (
                            s && length >= (LIBUS_RECV_BUFFER_LENGTH - 24 * 1024) && length <= LIBUS_RECV_BUFFER_LENGTH && 
                            (error || loop->num_ready_polls < LOOP_ISNT_VERY_BUSY_THRESHOLD) && 
                            !us_socket_is_closed(0, s)
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
                        if (us_socket_is_shut_down(0, s)) {
                            /* We got FIN back after sending it */
                            /* Todo: We should give "CLEAN SHUTDOWN" as reason here */
                            s = us_socket_close(0, s, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, NULL);
                            return;
                        } else {
                            /* We got FIN, so stop polling for readable */
                            us_poll_change(&s->p, us_socket_context(0, s)->loop, us_poll_events(&s->p) & LIBUS_SOCKET_WRITABLE);
                            s = s->context->on_end(s);
                        }
                    } else if (length == LIBUS_SOCKET_ERROR && !bsd_would_block()) {
                        /* Todo: decide also here what kind of reason we should give */
                        s = us_socket_close(0, s, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, NULL);
                        return;
                    }

                    break;
                } while (s);
            }

            /* Such as epollerr epollhup */
            if (error && s) {
                /* Todo: decide what code we give here */
                s = us_socket_close(0, s, error, NULL);
                return;
            }
            break;
        }
        case POLL_TYPE_UDP: {
            struct us_udp_socket_t *u = (struct us_udp_socket_t *) p;
            if (u->closed) {
                break;
            }

            if (events & LIBUS_SOCKET_READABLE) {
                do {
                    struct udp_recvbuf recvbuf;
                    bsd_udp_setup_recvbuf(&recvbuf, u->loop->data.recv_buf, LIBUS_RECV_BUFFER_LENGTH);
                    int npackets = bsd_recvmmsg(us_poll_fd(p), &recvbuf, MSG_DONTWAIT);
                    if (npackets > 0) {
                        u->on_data(u, &recvbuf, npackets);
                    } else {
                        if (npackets == LIBUS_SOCKET_ERROR) {
                            // If the error was not EAGAIN, mark the error
                            if (!bsd_would_block()) {
                                error = 1;
                            }
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

            if (events & LIBUS_SOCKET_WRITABLE && !error && !u->closed) {
                u->on_drain(u);
                if (u->closed) {
                    break;
                }
                // We only poll for writable after a read has failed, and only send one drain notification.
                // Otherwise we would receive a writable event on every tick of the event loop.
                us_poll_change(&u->p, u->loop, us_poll_events(&u->p) & LIBUS_SOCKET_READABLE);
            }

            if (error && !u->closed) {
                us_udp_socket_close(u);
            }
            break;
        }
    }
}

/* Integration only requires the timer to be set up */
void us_loop_integrate(struct us_loop_t *loop) {
    us_timer_set(loop->data.sweep_timer, (void (*)(struct us_timer_t *)) sweep_timer_cb, LIBUS_TIMEOUT_GRANULARITY * 1000, LIBUS_TIMEOUT_GRANULARITY * 1000);
}

void *us_loop_ext(struct us_loop_t *loop) {
    return loop + 1;
}

#undef us_ioctl