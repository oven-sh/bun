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

int us_socket_local_port(struct us_socket_t *s) {
    struct bsd_addr_t addr;
    if (bsd_local_addr(us_poll_fd(&s->p), &addr)) {
        return -1;
    } else {
        return bsd_addr_get_port(&addr);
    }
}

int us_socket_remote_port(struct us_socket_t *s) {
    struct bsd_addr_t addr;
    if (bsd_remote_addr(us_poll_fd(&s->p), &addr)) {
        return -1;
    } else {
        return bsd_addr_get_port(&addr);
    }
}

void us_socket_shutdown_read(struct us_socket_t *s) {
    /* This syscall is idempotent so no extra check is needed */
    bsd_shutdown_socket_read(us_poll_fd((struct us_poll_t *) s));
}

void us_connecting_socket_shutdown_read(struct us_connecting_socket_t *c) {
    c->shutdown_read = 1;
}

void us_socket_remote_address(struct us_socket_t *s, char *buf, int *length) {
    struct bsd_addr_t addr;
    if (bsd_remote_addr(us_poll_fd(&s->p), &addr) || *length < bsd_addr_get_ip_length(&addr)) {
        *length = 0;
    } else {
        *length = bsd_addr_get_ip_length(&addr);
        memcpy(buf, bsd_addr_get_ip(&addr), *length);
    }
}

void us_socket_local_address(struct us_socket_t *s, char *buf, int *length) {
    struct bsd_addr_t addr;
    if (bsd_local_addr(us_poll_fd(&s->p), &addr) || *length < bsd_addr_get_ip_length(&addr)) {
        *length = 0;
    } else {
        *length = bsd_addr_get_ip_length(&addr);
        memcpy(buf, bsd_addr_get_ip(&addr), *length);
    }
}

struct us_socket_group_t *us_socket_group(struct us_socket_t *s) {
    return s->group;
}

unsigned char us_socket_kind(struct us_socket_t *s) {
    return s->kind;
}

void us_socket_set_kind(struct us_socket_t *s, unsigned char kind) {
    s->kind = kind;
}

void us_socket_set_ssl_raw_tap(struct us_socket_t *s, int enabled) {
    s->ssl_raw_tap = !!enabled;
}

int us_socket_is_tls(struct us_socket_t *s) {
    return s->ssl != NULL;
}

struct us_socket_group_t *us_connecting_socket_group(struct us_connecting_socket_t *c) {
    return c->group;
}

unsigned char us_connecting_socket_kind(struct us_connecting_socket_t *c) {
    return c->kind;
}

void us_socket_timeout(struct us_socket_t *s, unsigned int seconds) {
    if (seconds) {
        s->timeout = ((unsigned int)s->group->timestamp + ((seconds + 3) >> 2)) % 240;
    } else {
        s->timeout = 255;
    }
}

void us_connecting_socket_timeout(struct us_connecting_socket_t *c, unsigned int seconds) {
    if (seconds) {
        c->timeout = ((unsigned int)c->group->timestamp + ((seconds + 3) >> 2)) % 240;
    } else {
        c->timeout = 255;
    }
}

void us_socket_long_timeout(struct us_socket_t *s, unsigned int minutes) {
    if (minutes) {
        s->long_timeout = ((unsigned int)s->group->long_timestamp + minutes) % 240;
    } else {
        s->long_timeout = 255;
    }
}

void us_connecting_socket_long_timeout(struct us_connecting_socket_t *c, unsigned int minutes) {
    if (minutes) {
        c->long_timeout = ((unsigned int)c->group->long_timestamp + minutes) % 240;
    } else {
        c->long_timeout = 255;
    }
}

void us_socket_flush(struct us_socket_t *s) {
    if (!us_socket_is_shut_down(s)) {
        bsd_socket_flush(us_poll_fd((struct us_poll_t *) s));
    }
}

int us_socket_is_closed(struct us_socket_t *s) {
    return s->flags.is_closed;
}

int us_socket_is_ssl_handshake_finished(struct us_socket_t *s) {
    if (s->ssl) {
        return us_internal_ssl_is_handshake_finished(s);
    }
    return 1;
}

int us_socket_ssl_handshake_callback_has_fired(struct us_socket_t *s) {
    if (s->ssl) {
        return us_internal_ssl_handshake_callback_has_fired(s);
    }
    return 1;
}

int us_connecting_socket_is_closed(struct us_connecting_socket_t *c) {
    return c->closed;
}

int us_socket_is_established(struct us_socket_t *s) {
    /* Everything that is not POLL_TYPE_SEMI_SOCKET is established */
    return us_internal_poll_type((struct us_poll_t *) s) != POLL_TYPE_SEMI_SOCKET;
}

/* Detach c from its group + drop the borrowed SSL_CTX ref, but leave c
 * allocated. After this, c->group is NULL and the embedding owner may safely
 * deinit; the only remaining link is into a loop-owned list. */
static void us_internal_connecting_socket_detach(struct us_connecting_socket_t *c, struct us_loop_t *loop) {
    if (c->group) {
        us_internal_socket_group_unlink_connecting_socket(c->group, c);
        c->group = NULL;
    }
    if (c->ssl_ctx) {
        us_internal_ssl_ctx_unref(c->ssl_ctx);
        c->ssl_ctx = NULL;
    }
    (void)loop;
}

void us_connecting_socket_free(struct us_connecting_socket_t *c) {
    // we can't just free c immediately, as it may be enqueued in the dns_ready_head list
    // instead, we move it to a close list and free it after the iteration
    if (c->scheduled_for_free) {
        /* Already on closed_connecting_head. Re-enqueueing would — if another
         * node was pushed in between — turn the close list into a cycle and
         * make us_internal_free_closed_sockets a double-free loop. detach()
         * is itself idempotent (group/ssl_ctx NULL'd on first call). */
        return;
    }
    c->scheduled_for_free = 1;
    us_internal_connecting_socket_detach(c, c->loop);
    /* Use the dedicated close-list link, NOT c->next — that field belongs to
     * dns_ready_head and may still be the only pointer to the rest of an
     * in-progress drain snapshot. */
    c->next_closed = c->loop->data.closed_connecting_head;
    c->loop->data.closed_connecting_head = c;
}

void us_connecting_socket_close(struct us_connecting_socket_t *c) {
    if (c->closed) return;
    c->closed = 1;
    for (struct us_socket_t *s = c->connecting_head; s; s = s->connect_next) {
        us_internal_socket_group_unlink_socket(s->group, s);

        us_poll_stop((struct us_poll_t *) s, s->group->loop);
        bsd_close_socket(us_poll_fd((struct us_poll_t *) s));

        /* Link this socket to the close-list and let it be deleted after this iteration */
        s->next = s->group->loop->data.closed_head;
        s->group->loop->data.closed_head = s;

        /* Mark the socket as closed */
        s->flags.is_closed = 1;
    }
    if (!c->error) {
        // if we have no error, we have to set that we were aborted aka we called close
        c->error = ECONNABORTED;
    }
    struct us_socket_group_t *group = c->group;

    if (c->pending_resolve_callback) {
        // The DNS callback has not been drained. Try to remove c from the
        // request's notify list so it never fires. Returns 0 if the result is
        // already set (the callback has fired or is about to), in which case
        // after_resolve will see c->closed and finish teardown.
        if (c->addrinfo_req && Bun__addrinfo_cancel(c->addrinfo_req, c)) {
#ifdef _WIN32
            group->loop->uv_loop->active_handles--;
#else
            group->loop->num_polls--;
#endif
            c->pending_resolve_callback = 0;
            Bun__addrinfo_freeRequest(c->addrinfo_req, 0);
            c->addrinfo_req = 0;
            us_dispatch_connecting_error(c, c->error);
            us_connecting_socket_free(c);
        } else {
            /* Can't cancel — the resolve callback is already queued. Detach
             * from the group NOW so the owner can deinit; after_resolve will
             * see c->closed and only push c to the loop's closed list without
             * touching the (possibly freed) group. Balance the keep-alive here
             * for the same reason. */
#ifdef _WIN32
            group->loop->uv_loop->active_handles--;
#else
            group->loop->num_polls--;
#endif
            us_dispatch_connecting_error(c, c->error);
            us_internal_connecting_socket_detach(c, group->loop);
        }
        return;
    }

    if (c->addrinfo_req) {
        Bun__addrinfo_freeRequest(c->addrinfo_req, c->error == ECONNREFUSED);
        c->addrinfo_req = 0;
    }
    us_dispatch_connecting_error(c, c->error);
    us_connecting_socket_free(c);
}

/* Tear the fd down + dispatch on_close. Bypasses the SSL layer entirely —
 * the public us_socket_close() routes through us_internal_ssl_close() first
 * so a client-initiated close sends close_notify and (with code==0) waits for
 * the peer's, instead of slamming the fd shut and racing the peer's
 * handshake/secureConnection event. openssl.c re-enters here once that
 * graceful path is done. */
struct us_socket_t *us_internal_socket_close_raw(struct us_socket_t *s, int code, void *reason) {
    if (!us_socket_is_closed(s)) {
        struct us_loop_t *loop = s->group->loop;

        if (s->flags.low_prio_state == 1) {
            /* Unlink this socket from the low-priority queue */
            if (!s->prev) loop->data.low_prio_head = s->next;
            else s->prev->next = s->next;

            if (s->next) s->next->prev = s->prev;

            s->prev = 0;
            s->next = 0;
            s->flags.low_prio_state = 0;
            s->group->low_prio_count--;
            /* Mirror the else branch: if this was the last thing keeping the
             * group linked, drop it from the loop now rather than waiting for
             * the next link/unlink to notice. */
            us_internal_group_maybe_unlink(s->group);
        } else {
            us_internal_socket_group_unlink_socket(s->group, s);
        }
        #ifdef LIBUS_USE_KQUEUE
            // kqueue automatically removes the fd from the set on close
            // we can skip the system call for that case
            us_internal_loop_update_pending_ready_polls(loop, (struct us_poll_t *)s, 0, us_poll_events((struct us_poll_t*)s), 0);
        #else
            /* Disable any instance of us in the pending ready poll list */
            us_poll_stop((struct us_poll_t *) s, loop);
        #endif

        if (code == LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET) {
            // Prevent entering TIME_WAIT state when forcefully closing
            struct linger l = { 1, 0 };
            setsockopt(us_poll_fd((struct us_poll_t *)s), SOL_SOCKET, SO_LINGER, (const char*)&l, sizeof(l));
        }

        bsd_close_socket(us_poll_fd((struct us_poll_t *) s));

        /* Mark the socket as closed */
        s->flags.is_closed = 1;

        /* call the callback */
        struct us_socket_t *res = s;
        if (!(us_internal_poll_type(&s->p) & POLL_TYPE_SEMI_SOCKET)) {
            res = s->ssl ? us_internal_ssl_on_close(s, code, reason)
                         : us_dispatch_close(s, code, reason);
        }
        /* SEMI_SOCKET: never-opened connect — owner is notified via
         * on_connect_error from the connect path (after_open / close_all),
         * not here. Dispatching here would double-fire on the natural path
         * (after_open → handler.close → close_raw). */

        us_internal_ssl_detach(s);

        /* Link this socket to the close-list and let it be deleted after this iteration */
        s->next = loop->data.closed_head;
        loop->data.closed_head = s;

        /* preserve the return value from on_close if its called */
        return res;
    }

    return s;
}

struct us_socket_t *us_socket_close(struct us_socket_t *s, int code, void *reason) {
    if (s->ssl && !us_socket_is_closed(s)) {
        return us_internal_ssl_close(s, code, reason);
    }
    return us_internal_socket_close_raw(s, code, reason);
}

// This function is the same as us_socket_close but:
// - does not emit on_close event
// - does not close
struct us_socket_t *us_socket_detach(struct us_socket_t *s) {
    if (!us_socket_is_closed(s)) {
        struct us_loop_t *loop = s->group->loop;

        if (s->flags.low_prio_state == 1) {
            /* Unlink this socket from the low-priority queue */
            if (!s->prev) loop->data.low_prio_head = s->next;
            else s->prev->next = s->next;

            if (s->next) s->next->prev = s->prev;

            s->prev = 0;
            s->next = 0;
            s->flags.low_prio_state = 0;
            s->group->low_prio_count--;
            /* Mirror the else branch: if this was the last thing keeping the
             * group linked, drop it from the loop now rather than waiting for
             * the next link/unlink to notice. */
            us_internal_group_maybe_unlink(s->group);
        } else {
            us_internal_socket_group_unlink_socket(s->group, s);
        }
        us_poll_stop((struct us_poll_t *) s, loop);

        us_internal_ssl_detach(s);

        /* Link this socket to the close-list and let it be deleted after this iteration */
        s->next = loop->data.closed_head;
        loop->data.closed_head = s;

        /* Mark the socket as closed */
        s->flags.is_closed = 1;

        return s;
    }
    return s;
}

struct us_socket_t *us_socket_pair(struct us_socket_group_t *group, unsigned char kind, int socket_ext_size, LIBUS_SOCKET_DESCRIPTOR *fds) {
#if defined(LIBUS_USE_LIBUV) || defined(WIN32)
    return 0;
#else
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, fds) != 0) {
        return 0;
    }

    return us_socket_from_fd(group, kind, NULL, socket_ext_size, fds[0], 0);
#endif
}

int us_socket_write2(struct us_socket_t *s, const char *header, int header_length, const char *payload, int payload_length) {
    if (us_socket_is_closed(s) || us_socket_is_shut_down(s)) {
        return 0;
    }

    int written = bsd_write2(us_poll_fd(&s->p), header, header_length, payload, payload_length);
    if (written != header_length + payload_length) {
        us_poll_change(&s->p, s->group->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
    }

    return written < 0 ? 0 : written;
}

struct us_socket_t *us_socket_from_fd(struct us_socket_group_t *group, unsigned char kind, struct ssl_ctx_st *ssl_ctx, int socket_ext_size, LIBUS_SOCKET_DESCRIPTOR fd, int ipc) {
#if defined(LIBUS_USE_LIBUV) || defined(WIN32)
    return 0;
#else
    struct us_poll_t *p1 = us_create_poll(group->loop, 0, sizeof(struct us_socket_t) + socket_ext_size);
    us_poll_init(p1, fd, POLL_TYPE_SOCKET);
    int rc = us_poll_start_rc(p1, group->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
    if (rc != 0) {
        us_poll_free(p1, group->loop);
        return 0;
    }

    struct us_socket_t *s = (struct us_socket_t *) p1;
    s->group = group;
    s->kind = kind;
    s->ssl = NULL;
    s->timeout = 255;
    s->long_timeout = 255;
    s->flags.low_prio_state = 0;
    s->flags.allow_half_open = 0;
    s->flags.is_paused = 0;
    s->flags.is_ipc = ipc;
    s->flags.is_closed = 0;
    s->flags.adopted = 0;
    s->connect_state = NULL;

    /* We always use nodelay */
    bsd_socket_nodelay(fd, 1);
    apple_no_sigpipe(fd);
    bsd_set_nonblocking(fd);
    us_internal_socket_group_link_socket(group, s);

    /* Bun.connect({fd, tls}) hands us an already-connected fd that should
     * speak TLS from the first byte (no STARTTLS). Mirror connect_resolved_dns
     * — attach SSL here so the caller's onOpen()/startTLSHandshake() see
     * s->ssl set. The IPC path passes ssl_ctx == NULL. */
    if (ssl_ctx) {
        us_internal_ssl_attach(s, ssl_ctx, 1, NULL, NULL);
    }

    return s;
#endif
}

void *us_socket_get_native_handle(struct us_socket_t *s) {
    if (s->ssl) {
        return us_internal_ssl_get_native_handle(s);
    }
    return (void *) (uintptr_t) us_poll_fd((struct us_poll_t *) s);
}

void *us_connecting_socket_get_native_handle(struct us_connecting_socket_t *c) {
    return (void *) (uintptr_t) -1;
}

int us_socket_write(struct us_socket_t *s, const char *data, int length) {
    if (s->ssl) {
        return us_internal_ssl_write(s, data, length);
    }
    if (us_socket_is_closed(s) || us_socket_is_shut_down(s)) {
        return 0;
    }

    int written = bsd_send(us_poll_fd(&s->p), data, length);
    if (written != length) {
        s->flags.last_write_failed = 1;
        us_poll_change(&s->p, s->group->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
    }

    return written < 0 ? 0 : written;
}

int us_socket_raw_write(struct us_socket_t *s, const char *data, int length) {
    /* Bypass-TLS path: openssl.c uses this to flush close_notify *after*
     * SSL_shutdown() has marked the SSL layer shut down, so checking
     * us_socket_is_shut_down() here would deadlock the alert in userspace.
     * Gate only on fd close and TCP-level FIN. */
    if (us_socket_is_closed(s) ||
        us_internal_poll_type(&s->p) == POLL_TYPE_SOCKET_SHUT_DOWN) {
        return 0;
    }

    int written = bsd_send(us_poll_fd(&s->p), data, length);
    if (written != length) {
        s->flags.last_write_failed = 1;
        us_poll_change(&s->p, s->group->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
    }

    return written < 0 ? 0 : written;
}

#if !defined(_WIN32)
/* Send a message with data and an attached file descriptor, for use in IPC. Returns the number of bytes written. If that
    number is less than the length, the file descriptor was not sent. */
int us_socket_ipc_write_fd(struct us_socket_t *s, const char *data, int length, int fd) {
    if (us_socket_is_closed(s) || us_socket_is_shut_down(s)) {
        return 0;
    }

    struct msghdr msg = {0};
    struct iovec iov = {0};
    char cmsgbuf[CMSG_SPACE(sizeof(int))];

    iov.iov_base = (void *) data;
    iov.iov_len = length;

    msg.msg_iov = &iov;
    msg.msg_iovlen = 1;
    msg.msg_control = cmsgbuf;
    msg.msg_controllen = CMSG_SPACE(sizeof(int));

    struct cmsghdr *cmsg = CMSG_FIRSTHDR(&msg);
    cmsg->cmsg_level = SOL_SOCKET;
    cmsg->cmsg_type = SCM_RIGHTS;
    cmsg->cmsg_len = CMSG_LEN(sizeof(int));

    *(int *) CMSG_DATA(cmsg) = fd;

    int sent = bsd_sendmsg(us_poll_fd(&s->p), &msg, 0);

    if (sent != length) {
        s->flags.last_write_failed = 1;
        us_poll_change(&s->p, s->group->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
    }

    return sent < 0 ? 0 : sent;
}
#endif

void *us_socket_ext(struct us_socket_t *s) {
    return s + 1;
}

void *us_connecting_socket_ext(struct us_connecting_socket_t *c) {
    return c + 1;
}

int us_socket_is_shut_down(struct us_socket_t *s) {
    if (s->ssl) {
        return us_internal_ssl_is_shut_down(s);
    }
    return us_internal_poll_type(&s->p) == POLL_TYPE_SOCKET_SHUT_DOWN;
}

int us_connecting_socket_is_shut_down(struct us_connecting_socket_t *c) {
    return c->shutdown;
}

void us_internal_socket_raw_shutdown(struct us_socket_t *s) {
    /* Todo: should we emit on_close if calling shutdown on an already half-closed socket?
     * We need more states in that case, we need to track RECEIVED_FIN
     * so far, the app has to track this and call close as needed */
    if (!us_socket_is_closed(s) && us_internal_poll_type(&s->p) != POLL_TYPE_SOCKET_SHUT_DOWN) {
        us_internal_poll_set_type(&s->p, POLL_TYPE_SOCKET_SHUT_DOWN);
        us_poll_change(&s->p, s->group->loop, us_poll_events(&s->p) & LIBUS_SOCKET_READABLE);
        bsd_shutdown_socket(us_poll_fd((struct us_poll_t *) s));
    }
}

void us_socket_shutdown(struct us_socket_t *s) {
    if (s->ssl) {
        us_internal_ssl_shutdown(s);
        return;
    }
    us_internal_socket_raw_shutdown(s);
}

void us_connecting_socket_shutdown(struct us_connecting_socket_t *c) {
    c->shutdown = 1;
}

int us_connecting_socket_get_error(struct us_connecting_socket_t *c) {
    return c->error;
}

struct us_socket_t *us_socket_open(struct us_socket_t *s, int is_client, char *ip, int ip_length) {
    if (s->ssl) {
        return us_internal_ssl_on_open(s, is_client, ip, ip_length);
    }
    return us_dispatch_open(s, is_client, ip, ip_length);
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
    uv_ref((uv_handle_t *) s->p.uv_p);
#endif
    // do nothing if not using libuv
}

void us_socket_nodelay(struct us_socket_t *s, int enabled) {
    if (!us_socket_is_shut_down(s)) {
        bsd_socket_nodelay(us_poll_fd((struct us_poll_t *) s), enabled);
    }
}

/// Returns 0 on success. Returned error values depend on the platform.
/// - on posix, returns `errno`
/// - on windows, when libuv is used, returns a UV err code
/// - on windows, LIBUS_USE_LIBUV is set, returns `WSAGetLastError()`
/// - on windows, otherwise returns result of `WSAGetLastError`
int us_socket_keepalive(us_socket_r s, int enabled, unsigned int delay) {
    if (!us_socket_is_shut_down(s)) {
        return bsd_socket_keepalive(us_poll_fd((struct us_poll_t *) s), enabled, delay);
    }
    return 0;
}

void us_socket_unref(struct us_socket_t *s) {
#ifdef LIBUS_USE_LIBUV
    uv_unref((uv_handle_t *) s->p.uv_p);
#endif
    // do nothing if not using libuv
}

struct us_loop_t *us_connecting_socket_get_loop(struct us_connecting_socket_t *c) {
    return c->loop;
}

void us_socket_pause(struct us_socket_t *s) {
    if (s->flags.is_paused) return;
    // closed cannot be paused because it is already closed
    if (us_socket_is_closed(s)) return;
    // we are readable and writable so we can just pause readable side
    us_poll_change(&s->p, s->group->loop, LIBUS_SOCKET_WRITABLE);
    s->flags.is_paused = 1;
}

void us_socket_resume(struct us_socket_t *s) {
    if (!s->flags.is_paused) return;
    s->flags.is_paused = 0;
    // closed cannot be resumed
    if (us_socket_is_closed(s)) return;

    if (us_socket_is_shut_down(s)) {
        // we already sent FIN so we resume only readable side we are read-only
        us_poll_change(&s->p, s->group->loop, LIBUS_SOCKET_READABLE);
        return;
    }
    // we are readable and writable so we resume everything
    us_poll_change(&s->p, s->group->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
}
