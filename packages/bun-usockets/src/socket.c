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
#include <string.h>
#include <stdint.h>

/* Shared with SSL */

int us_socket_local_port(int ssl, struct us_socket_t *s) {
    struct bsd_addr_t addr;
    if (bsd_local_addr(us_poll_fd(&s->p), &addr)) {
        return -1;
    } else {
        return bsd_addr_get_port(&addr);
    }
}

void us_socket_shutdown_read(int ssl, struct us_socket_t *s) {
    /* This syscall is idempotent so no extra check is needed */
    bsd_shutdown_socket_read(us_poll_fd((struct us_poll_t *) s));
}

void us_socket_remote_address(int ssl, struct us_socket_t *s, char *buf, int *length) {
    struct bsd_addr_t addr;
    if (bsd_remote_addr(us_poll_fd(&s->p), &addr) || *length < bsd_addr_get_ip_length(&addr)) {
        *length = 0;
    } else {
        *length = bsd_addr_get_ip_length(&addr);
        memcpy(buf, bsd_addr_get_ip(&addr), *length);
    }
}

struct us_socket_context_t *us_socket_context(int ssl, struct us_socket_t *s) {
    return s->context;
}

void us_socket_timeout(int ssl, struct us_socket_t *s, unsigned int seconds) {
    if (seconds) {
        s->timeout = ((unsigned int)s->context->timestamp + ((seconds + 3) >> 2)) % 240;
    } else {
        s->timeout = 255;
    }
}

void us_socket_long_timeout(int ssl, struct us_socket_t *s, unsigned int minutes) {
    if (minutes) {
        s->long_timeout = ((unsigned int)s->context->long_timestamp + minutes) % 240;
    } else {
        s->long_timeout = 255;
    }
}

void us_socket_flush(int ssl, struct us_socket_t *s) {
    if (!us_socket_is_shut_down(0, s)) {
        bsd_socket_flush(us_poll_fd((struct us_poll_t *) s));
    }
}

int us_socket_is_closed(int ssl, struct us_socket_t *s) {
    return s->prev == (struct us_socket_t *) s->context;
}

int us_socket_is_established(int ssl, struct us_socket_t *s) {
    /* Everything that is not POLL_TYPE_SEMI_SOCKET is established */
    return us_internal_poll_type((struct us_poll_t *) s) != POLL_TYPE_SEMI_SOCKET;
}

/* Exactly the same as us_socket_close but does not emit on_close event */
struct us_socket_t *us_socket_close_connecting(int ssl, struct us_socket_t *s) {
    if (!us_socket_is_closed(0, s)) {
        us_internal_socket_context_unlink_socket(s->context, s);
        us_poll_stop((struct us_poll_t *) s, s->context->loop);
        bsd_close_socket(us_poll_fd((struct us_poll_t *) s));

        /* Link this socket to the close-list and let it be deleted after this iteration */
        s->next = s->context->loop->data.closed_head;
        s->context->loop->data.closed_head = s;

        /* Any socket with prev = context is marked as closed */
        s->prev = (struct us_socket_t *) s->context;

        //return s->context->on_close(s, code, reason);
    }
    return s;
}

/* Same as above but emits on_close */
struct us_socket_t *us_socket_close(int ssl, struct us_socket_t *s, int code, void *reason) {
    if (!us_socket_is_closed(0, s)) {
        if (s->low_prio_state == 1) {
            /* Unlink this socket from the low-priority queue */
            if (!s->prev) s->context->loop->data.low_prio_head = s->next;
            else s->prev->next = s->next;

            if (s->next) s->next->prev = s->prev;

            s->prev = 0;
            s->next = 0;
            s->low_prio_state = 0;
        } else {
            us_internal_socket_context_unlink_socket(s->context, s);
        }
        #ifdef LIBUS_USE_KQUEUE
            // kqueue automatically removes the fd from the set on close
            // we can skip the system call for that case
            us_internal_loop_update_pending_ready_polls(s->context->loop, (struct us_poll_t *)s, 0, us_poll_events((struct us_poll_t*)s), 0);
        #else
            /* Disable any instance of us in the pending ready poll list */
            us_poll_stop((struct us_poll_t *) s, s->context->loop);
        #endif
        bsd_close_socket(us_poll_fd((struct us_poll_t *) s));

        /* Link this socket to the close-list and let it be deleted after this iteration */
        s->next = s->context->loop->data.closed_head;
        s->context->loop->data.closed_head = s;

        /* Any socket with prev = context is marked as closed */
        s->prev = (struct us_socket_t *) s->context;

        return s->context->on_close(s, code, reason);
    }
    return s;
}

struct us_socket_t *us_socket_pair(struct us_socket_context_t *ctx, int socket_ext_size, LIBUS_SOCKET_DESCRIPTOR* fds) {
#ifdef LIBUS_USE_LIBUV
    return 0;
#endif 
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, fds) != 0) {
        return 0;
    }

    return us_socket_from_fd(ctx, socket_ext_size, fds[0]);
}


struct us_socket_t *us_socket_from_fd(struct us_socket_context_t *ctx, int socket_ext_size, LIBUS_SOCKET_DESCRIPTOR fd) {
#ifdef LIBUS_USE_LIBUV
    return 0;
#endif
    struct us_poll_t *p1 = us_create_poll(ctx->loop, 0, sizeof(struct us_socket_t) + socket_ext_size);
    us_poll_init(p1, fd, POLL_TYPE_SOCKET);
    us_poll_start(p1, ctx->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);

    struct us_socket_t *s = (struct us_socket_t *) p1;
    s->context = ctx;
    s->timeout = 0;
    s->long_timeout = 0;
    s->low_prio_state = 0;

    /* We always use nodelay */
    bsd_socket_nodelay(fd, 1);

    us_internal_socket_context_link_socket(ctx, s);

    if (ctx->on_open) {
        ctx->on_open(s, 0, 0, 0);
    }

    return s;
}


/* Not shared with SSL */

void *us_socket_get_native_handle(int ssl, struct us_socket_t *s) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return us_internal_ssl_socket_get_native_handle((struct us_internal_ssl_socket_t *) s);
    }
#endif

    return (void *) (uintptr_t) us_poll_fd((struct us_poll_t *) s);
}

int us_socket_write(int ssl, struct us_socket_t *s, const char *data, int length, int msg_more) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return us_internal_ssl_socket_write((struct us_internal_ssl_socket_t *) s, data, length, msg_more);
    }
#endif

    if (us_socket_is_closed(ssl, s) || us_socket_is_shut_down(ssl, s)) {
        return 0;
    }

    int written = bsd_send(us_poll_fd(&s->p), data, length, msg_more);
    if (written != length) {
        s->context->loop->data.last_write_failed = 1;
        us_poll_change(&s->p, s->context->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
    }

    return written < 0 ? 0 : written;
}

void *us_socket_ext(int ssl, struct us_socket_t *s) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return us_internal_ssl_socket_ext((struct us_internal_ssl_socket_t *) s);
    }
#endif

    return s + 1;
}

int us_socket_is_shut_down(int ssl, struct us_socket_t *s) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return us_internal_ssl_socket_is_shut_down((struct us_internal_ssl_socket_t *) s);
    }
#endif

    return us_internal_poll_type(&s->p) == POLL_TYPE_SOCKET_SHUT_DOWN;
}

void us_socket_shutdown(int ssl, struct us_socket_t *s) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        us_internal_ssl_socket_shutdown((struct us_internal_ssl_socket_t *) s);
        return;
    }
#endif

    /* Todo: should we emit on_close if calling shutdown on an already half-closed socket?
     * We need more states in that case, we need to track RECEIVED_FIN
     * so far, the app has to track this and call close as needed */
    if (!us_socket_is_closed(ssl, s) && !us_socket_is_shut_down(ssl, s)) {
        us_internal_poll_set_type(&s->p, POLL_TYPE_SOCKET_SHUT_DOWN);
        us_poll_change(&s->p, s->context->loop, us_poll_events(&s->p) & LIBUS_SOCKET_READABLE);
        bsd_shutdown_socket(us_poll_fd((struct us_poll_t *) s));
    }
}

/* 
    Note: this assumes that the socket is non-TLS and will be adopted and wrapped with a new TLS context
          context ext will not be copied to the new context, new context will contain us_wrapped_socket_context_t on ext
*/
struct us_socket_t *us_socket_wrap_with_tls(int ssl, struct us_socket_t *s, struct us_bun_socket_context_options_t options, struct us_socket_events_t events, int socket_ext_size) {
    // only accepts non-TLS sockets
    if (ssl) {
        return NULL; 
    }

    return(struct us_socket_t *) us_internal_ssl_socket_wrap_with_tls(s, options, events, socket_ext_size);
}  

// if a TLS socket calls this, it will start SSL call open event and TLS handshake if required
// will have no effect if the socket is closed or is not TLS
struct us_socket_t* us_socket_open(int ssl, struct us_socket_t * s, int is_client, char* ip, int ip_length) {
    if (ssl) {
        return(struct us_socket_t *) us_internal_ssl_socket_open((struct us_internal_ssl_socket_t *)s, is_client, ip, ip_length);
    }
    return s;
}

int us_socket_raw_write(int ssl, struct us_socket_t *s, const char *data, int length, int msg_more) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return us_internal_ssl_socket_raw_write((struct us_internal_ssl_socket_t *) s, data, length, msg_more);
    }
#endif
 // non-TLS is always raw
 return us_socket_write(ssl, s, data, length, msg_more);
}

unsigned int us_get_remote_address_info(char *buf, struct us_socket_t *s, const char **dest, int *port, int *is_ipv6)
{
    // This function is manual inlining + modification of
    //      us_socket_remote_address
    //      AsyncSocket::getRemoteAddress
    // To get { ip, port, is_ipv6 } for Bun.serve().requestIP()
    struct bsd_addr_t addr;
    if (bsd_remote_addr(us_poll_fd(&s->p), &addr)) {
        return 0;
    }

    int length = bsd_addr_get_ip_length(&addr);
    if (!length) {
        return 0;
    }

    memcpy(buf, bsd_addr_get_ip(&addr), length);
    *port = bsd_addr_get_port(&addr);

    return length;
}