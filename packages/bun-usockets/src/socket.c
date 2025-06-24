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
#include <errno.h>
#ifndef WIN32
#include <fcntl.h>
#endif

/* Shared with SSL */

int us_socket_local_port(int ssl, struct us_socket_t *s) {
    struct bsd_addr_t addr;
    if (bsd_local_addr(us_poll_fd(&s->p), &addr)) {
        return -1;
    } else {
        return bsd_addr_get_port(&addr);
    }
}

int us_socket_remote_port(int ssl, struct us_socket_t *s) {
    struct bsd_addr_t addr;
    if (bsd_remote_addr(us_poll_fd(&s->p), &addr)) {
        return -1;
    } else {
        return bsd_addr_get_port(&addr);
    }
}

void us_socket_shutdown_read(int ssl, struct us_socket_t *s) {
    /* This syscall is idempotent so no extra check is needed */
    bsd_shutdown_socket_read(us_poll_fd((struct us_poll_t *) s));
}

void us_connecting_socket_shutdown_read(int ssl, struct us_connecting_socket_t *c) {
    c->shutdown_read = 1;
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

void us_socket_local_address(int ssl, struct us_socket_t *s, char *buf, int *length) {
    struct bsd_addr_t addr;
    if (bsd_local_addr(us_poll_fd(&s->p), &addr) || *length < bsd_addr_get_ip_length(&addr)) {
        *length = 0;
    } else {
        *length = bsd_addr_get_ip_length(&addr);
        memcpy(buf, bsd_addr_get_ip(&addr), *length);
    }
}

struct us_socket_context_t *us_socket_context(int ssl, struct us_socket_t *s) {
    return s->context;
}

struct us_socket_context_t *us_connecting_socket_context(int ssl, struct us_connecting_socket_t *c) {
    return c->context;
}

void us_socket_timeout(int ssl, struct us_socket_t *s, unsigned int seconds) {
    if (seconds) {
        s->timeout = ((unsigned int)s->context->timestamp + ((seconds + 3) >> 2)) % 240;
    } else {
        s->timeout = 255;
    }
}

void us_connecting_socket_timeout(int ssl, struct us_connecting_socket_t *c, unsigned int seconds) {
    if (seconds) {
        c->timeout = ((unsigned int)c->context->timestamp + ((seconds + 3) >> 2)) % 240;
    } else {
        c->timeout = 255;
    }
}

void us_socket_long_timeout(int ssl, struct us_socket_t *s, unsigned int minutes) {
    if (minutes) {
        s->long_timeout = ((unsigned int)s->context->long_timestamp + minutes) % 240;
    } else {
        s->long_timeout = 255;
    }
}

void us_connecting_socket_long_timeout(int ssl, struct us_connecting_socket_t *c, unsigned int minutes) {
    if (minutes) {
        c->long_timeout = ((unsigned int)c->context->long_timestamp + minutes) % 240;
    } else {
        c->long_timeout = 255;
    }
}

void us_socket_flush(int ssl, struct us_socket_t *s) {
    if (!us_socket_is_shut_down(0, s)) {
        bsd_socket_flush(us_poll_fd((struct us_poll_t *) s));
    }
}

int us_socket_is_closed(int ssl, struct us_socket_t *s) {
    if(ssl) {
        return us_internal_ssl_socket_is_closed((struct us_internal_ssl_socket_t *) s);
    }
    return s->prev == (struct us_socket_t *) s->context;
}

int us_connecting_socket_is_closed(int ssl, struct us_connecting_socket_t *c) {
    return c->closed;
}

int us_socket_is_established(int ssl, struct us_socket_t *s) {
    /* Everything that is not POLL_TYPE_SEMI_SOCKET is established */
    return us_internal_poll_type((struct us_poll_t *) s) != POLL_TYPE_SEMI_SOCKET;
}

void us_connecting_socket_free(int ssl, struct us_connecting_socket_t *c) {
    // we can't just free c immediately, as it may be enqueued in the dns_ready_head list
    // instead, we move it to a close list and free it after the iteration
    us_internal_socket_context_unlink_connecting_socket(ssl, c->context, c);

    c->next = c->context->loop->data.closed_connecting_head;
    c->context->loop->data.closed_connecting_head = c;
}

void us_connecting_socket_close(int ssl, struct us_connecting_socket_t *c) {
    if (c->closed) return;
    c->closed = 1;
    for (struct us_socket_t *s = c->connecting_head; s; s = s->connect_next) {
        us_internal_socket_context_unlink_socket(ssl, s->context, s);

        us_poll_stop((struct us_poll_t *) s, s->context->loop);
        bsd_close_socket(us_poll_fd((struct us_poll_t *) s));

        /* Link this socket to the close-list and let it be deleted after this iteration */
        s->next = s->context->loop->data.closed_head;
        s->context->loop->data.closed_head = s;

        /* Any socket with prev = context is marked as closed */
        s->prev = (struct us_socket_t *) s->context;
    }
    if(!c->error) {
        // if we have no error, we have to set that we were aborted aka we called close
        c->error = ECONNABORTED;
    }
    c->context->on_connect_error(c, c->error);
    if(c->addrinfo_req) {
        Bun__addrinfo_freeRequest(c->addrinfo_req, c->error == ECONNREFUSED);
        c->addrinfo_req = 0;
    }
    // we can only schedule the socket to be freed if there is no pending callback
    // otherwise, the callback will see that the socket is closed and will free it
    if (!c->pending_resolve_callback) {
        us_connecting_socket_free(ssl, c);
    }
}

struct us_socket_t *us_socket_close(int ssl, struct us_socket_t *s, int code, void *reason) {
    if(ssl) {
        return (struct us_socket_t *)us_internal_ssl_socket_close((struct us_internal_ssl_socket_t *) s, code, reason);
    }

    if (!us_socket_is_closed(0, s)) {
        /* make sure the context is alive until the callback ends */
        us_socket_context_ref(ssl, s->context);

        if (s->flags.low_prio_state == 1) {
            /* Unlink this socket from the low-priority queue */
            if (!s->prev) s->context->loop->data.low_prio_head = s->next;
            else s->prev->next = s->next;

            if (s->next) s->next->prev = s->prev;

            s->prev = 0;
            s->next = 0;
            s->flags.low_prio_state = 0;
            us_socket_context_unref(ssl, s->context);
        } else {
            us_internal_socket_context_unlink_socket(ssl, s->context, s);
        }
        #ifdef LIBUS_USE_KQUEUE
            // kqueue automatically removes the fd from the set on close
            // we can skip the system call for that case
            us_internal_loop_update_pending_ready_polls(s->context->loop, (struct us_poll_t *)s, 0, us_poll_events((struct us_poll_t*)s), 0);
        #else
            /* Disable any instance of us in the pending ready poll list */
            us_poll_stop((struct us_poll_t *) s, s->context->loop);
        #endif

        if (code == LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET) {
            // Prevent entering TIME_WAIT state when forcefully closing
            struct linger l = { 1, 0 };
            setsockopt(us_poll_fd((struct us_poll_t *)s), SOL_SOCKET, SO_LINGER, (const char*)&l, sizeof(l));
        }

        bsd_close_socket(us_poll_fd((struct us_poll_t *) s));


        /* Any socket with prev = context is marked as closed */
        s->prev = (struct us_socket_t *) s->context;

        /* mark it as closed and call the callback */
        struct us_socket_t *res = s;
        if (!(us_internal_poll_type(&s->p) & POLL_TYPE_SEMI_SOCKET)) {
            res = s->context->on_close(s, code, reason);
        }

        /* Link this socket to the close-list and let it be deleted after this iteration */
        s->next = s->context->loop->data.closed_head;
        s->context->loop->data.closed_head = s;

        /* unref the context after the callback ends */
        us_socket_context_unref(ssl, s->context);

        /* preserve the return value from on_close if its called */
        return res;
    }

    return s;
}

// This function is the same as us_socket_close but:
// - does not emit on_close event
// - does not close
struct us_socket_t *us_socket_detach(int ssl, struct us_socket_t *s) {
    if (!us_socket_is_closed(0, s)) {
        if (s->flags.low_prio_state == 1) {
            /* Unlink this socket from the low-priority queue */
            if (!s->prev) s->context->loop->data.low_prio_head = s->next;
            else s->prev->next = s->next;

            if (s->next) s->next->prev = s->prev;

            s->prev = 0;
            s->next = 0;
            s->flags.low_prio_state = 0;
            us_socket_context_unref(ssl, s->context);

        } else {
            us_internal_socket_context_unlink_socket(ssl, s->context, s);
        }
        us_poll_stop((struct us_poll_t *) s, s->context->loop);

        /* Link this socket to the close-list and let it be deleted after this iteration */
        s->next = s->context->loop->data.closed_head;
        s->context->loop->data.closed_head = s;

        /* Any socket with prev = context is marked as closed */
        s->prev = (struct us_socket_t *) s->context;

        return s;
    }
    return s;
}

struct us_socket_t *us_socket_pair(struct us_socket_context_t *ctx, int socket_ext_size, LIBUS_SOCKET_DESCRIPTOR* fds) {
#if defined(LIBUS_USE_LIBUV) || defined(WIN32)
    return 0;
#else
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, fds) != 0) {
        return 0;
    }

    return us_socket_from_fd(ctx, socket_ext_size, fds[0], 0);
#endif
}

/* This is not available for SSL sockets as it makes no sense. */
int us_socket_write2(int ssl, struct us_socket_t *s, const char *header, int header_length, const char *payload, int payload_length) {
    if (us_socket_is_closed(ssl, s) || us_socket_is_shut_down(ssl, s)) {
        return 0;
    }

    int written = bsd_write2(us_poll_fd(&s->p), header, header_length, payload, payload_length);
    if (written != header_length + payload_length) {
        us_poll_change(&s->p, s->context->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
    }

    return written < 0 ? 0 : written;
}

struct us_socket_t *us_socket_from_fd(struct us_socket_context_t *ctx, int socket_ext_size, LIBUS_SOCKET_DESCRIPTOR fd, int ipc) {
#if defined(LIBUS_USE_LIBUV) || defined(WIN32)
    return 0;
#else
    struct us_poll_t *p1 = us_create_poll(ctx->loop, 0, sizeof(struct us_socket_t) + socket_ext_size);
    us_poll_init(p1, fd, POLL_TYPE_SOCKET);
    int rc = us_poll_start_rc(p1, ctx->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
    if (rc != 0) {
        us_poll_free(p1, ctx->loop);
        return 0;
    }

    struct us_socket_t *s = (struct us_socket_t *) p1;
    s->context = ctx;
    s->timeout = 255;
    s->long_timeout = 255;
    s->flags.low_prio_state = 0;
    s->flags.allow_half_open = 0;
    s->flags.is_paused = 0;
    s->flags.is_ipc = 0;
    s->flags.is_ipc = ipc;
    s->connect_state = NULL;

    /* We always use nodelay */
    bsd_socket_nodelay(fd, 1);
    apple_no_sigpipe(fd);
    bsd_set_nonblocking(fd);
    us_internal_socket_context_link_socket(ctx, s);

    return s;
#endif
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

void *us_connecting_socket_get_native_handle(int ssl, struct us_connecting_socket_t *c) {
#ifndef LIBUS_NO_SSL
    // returns the ssl context
    if (ssl) {
        return *(void **)(c + 1);
    }
#endif
    return (void *) (uintptr_t) -1;
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

#if !defined(_WIN32)
/* Send a message with data and an attached file descriptor, for use in IPC. Returns the number of bytes written. If that
    number is less than the length, the file descriptor was not sent. */
int us_socket_ipc_write_fd(struct us_socket_t *s, const char* data, int length, int fd) {
    if (us_socket_is_closed(0, s) || us_socket_is_shut_down(0, s)) {
        return 0;
    }

    struct msghdr msg = {0};
    struct iovec iov = {0};
    char cmsgbuf[CMSG_SPACE(sizeof(int))];

    iov.iov_base = (void*)data;
    iov.iov_len = length;

    msg.msg_iov = &iov;
    msg.msg_iovlen = 1;
    msg.msg_control = cmsgbuf;
    msg.msg_controllen = CMSG_SPACE(sizeof(int));

    struct cmsghdr *cmsg = CMSG_FIRSTHDR(&msg);
    cmsg->cmsg_level = SOL_SOCKET;
    cmsg->cmsg_type = SCM_RIGHTS;
    cmsg->cmsg_len = CMSG_LEN(sizeof(int));

    *(int *)CMSG_DATA(cmsg) = fd;

    int sent = bsd_sendmsg(us_poll_fd(&s->p), &msg, 0);

    if (sent != length) {
        s->context->loop->data.last_write_failed = 1;
        us_poll_change(&s->p, s->context->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
    }

    return sent < 0 ? 0 : sent;
}
#endif

void *us_socket_ext(int ssl, struct us_socket_t *s) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return us_internal_ssl_socket_ext((struct us_internal_ssl_socket_t *) s);
    }
#endif

    return s + 1;
}

void *us_connecting_socket_ext(int ssl, struct us_connecting_socket_t *c) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return us_internal_connecting_ssl_socket_ext(c);
    }
#endif

    return c + 1;
}

int us_socket_is_shut_down(int ssl, struct us_socket_t *s) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return us_internal_ssl_socket_is_shut_down((struct us_internal_ssl_socket_t *) s);
    }
#endif
    return us_internal_poll_type(&s->p) == POLL_TYPE_SOCKET_SHUT_DOWN;
}

int us_connecting_socket_is_shut_down(int ssl, struct us_connecting_socket_t *c) {
    return c->shutdown;
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

void us_connecting_socket_shutdown(int ssl, struct us_connecting_socket_t *c) {
    c->shutdown = 1;
}

int us_connecting_socket_get_error(int ssl, struct us_connecting_socket_t *c) {
    return c->error;
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

unsigned int us_get_local_address_info(char *buf, struct us_socket_t *s, const char **dest, int *port, int *is_ipv6)
{
    struct bsd_addr_t addr;
    if (bsd_local_addr(us_poll_fd(&s->p), &addr)) {
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

void us_socket_ref(struct us_socket_t *s) {
#ifdef LIBUS_USE_LIBUV
    uv_ref((uv_handle_t*)s->p.uv_p);
#endif
    // do nothing if not using libuv
}

void us_socket_nodelay(struct us_socket_t *s, int enabled) {
    if (!us_socket_is_shut_down(0, s)) {
        bsd_socket_nodelay(us_poll_fd((struct us_poll_t *) s), enabled);
    }
}

/// Returns 0 on success. Returned error values depend on the platform.
/// - on posix, returns `errno`
/// - on windows, when libuv is used, returns a UV err code
/// - on windows, LIBUS_USE_LIBUV is set, returns `WSAGetLastError()`
/// - on windows, otherwise returns result of `WSAGetLastError`
int us_socket_keepalive(us_socket_r s, int enabled, unsigned int delay){
    if (!us_socket_is_shut_down(0, s)) {
        return bsd_socket_keepalive(us_poll_fd((struct us_poll_t *) s), enabled, delay);
    }
    return 0;
}

void us_socket_unref(struct us_socket_t *s) {
#ifdef LIBUS_USE_LIBUV
    uv_unref((uv_handle_t*)s->p.uv_p);
#endif
    // do nothing if not using libuv
}

struct us_loop_t *us_connecting_socket_get_loop(struct us_connecting_socket_t *c) {
    return c->context->loop;
}

void us_socket_pause(int ssl, struct us_socket_t *s) {
    if(s->flags.is_paused) return;
    // closed cannot be paused because it is already closed
    if(us_socket_is_closed(ssl, s)) return;
    // we are readable and writable so we can just pause readable side
    us_poll_change(&s->p, s->context->loop, LIBUS_SOCKET_WRITABLE);
    s->flags.is_paused = 1;
}

void us_socket_resume(int ssl, struct us_socket_t *s) {
    if(!s->flags.is_paused) return;
    s->flags.is_paused = 0;
    // closed cannot be resumed
    if(us_socket_is_closed(ssl, s)) return;

    if(us_socket_is_shut_down(ssl, s)) {
      // we already sent FIN so we resume only readable side we are read-only
      us_poll_change(&s->p, s->context->loop, LIBUS_SOCKET_READABLE);
      return;
    }
    // we are readable and writable so we resume everything
    us_poll_change(&s->p, s->context->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
  }
