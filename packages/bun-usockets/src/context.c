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

#include "internal/internal.h"
#include "libusockets.h"
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#ifndef _WIN32
#include <arpa/inet.h>
#include <netinet/in.h>
#endif
#define CONCURRENT_CONNECTIONS 4

#ifdef BUN_DEBUG
#include <assert.h>
#define US_ASSERT(x) assert(x)
#else
#define US_ASSERT(x) ((void)0)
#endif

// clang-format off

/* Forward-declared so this file does not depend on OpenSSL headers. */
/* Opaque SSL_CTX ref helpers — defined in crypto/openssl.c so this file
 * stays free of OpenSSL headers. */

int us_internal_raw_root_certs(struct us_cert_string_t** out);
int us_raw_root_certs(struct us_cert_string_t**out){
    return us_internal_raw_root_certs(out);
}

/* ── Group lifecycle ────────────────────────────────────────────────────── */

void us_socket_group_init(struct us_socket_group_t *group, struct us_loop_t *loop,
                          const struct us_socket_vtable_t *vtable, void *ext) {
    memset(group, 0, sizeof(*group));
    group->loop = loop;
    group->vtable = vtable;
    group->ext = ext;
}

void us_socket_group_deinit(struct us_socket_group_t *group) {
    /* The owner is about to free the embedding storage. Every list head and the
     * low-prio count must be zero or some socket/listener/DNS request still
     * holds s->group / c->group / ls->accept_group into us — that's a UAF the
     * caller must close_all() away first. iterator != NULL means we're inside
     * a dispatch on this very group; the on_close that triggers deinit is fine
     * (unlink_socket already advanced iterator), but a re-entrant deinit from
     * inside on_timeout/on_data would tear the floor out from under the sweep. */
    US_ASSERT(group->head_sockets == NULL);
    US_ASSERT(group->head_connecting_sockets == NULL);
    US_ASSERT(group->head_listen_sockets == NULL);
    US_ASSERT(group->low_prio_count == 0);
    US_ASSERT(group->iterator == NULL);
    if (group->linked) {
        us_internal_loop_unlink_group(group->loop, group);
        group->linked = 0;
    }
}

void us_socket_group_close_all(struct us_socket_group_t *group) {
    /* Listeners first — stops new sockets from being accepted into head_sockets
     * while we're draining it. */
    while (group->head_listen_sockets) {
        us_listen_socket_close(group->head_listen_sockets);
    }

    struct us_connecting_socket_t *c = group->head_connecting_sockets;
    while (c) {
        struct us_connecting_socket_t *nextC = c->next_pending;
        us_connecting_socket_close(c);
        c = nextC;
    }

    struct us_socket_t *s = group->head_sockets;
    while (s) {
        struct us_socket_t *nextS = s->next;
        us_socket_close(s, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, 0);
        s = nextS;
    }

    /* Sockets parked in the loop-wide low-prio queue aren't in head_sockets
     * (the queue reuses prev/next), so they'd survive the walk above and later
     * dereference s->group into freed owner storage. Drain ours out now. */
    if (group->low_prio_count) {
        /* Don't pre-unlink — leave low_prio_state==1 so us_socket_close takes
         * its low-prio branch (which knows the socket is NOT in head_sockets
         * and decrements low_prio_count itself). Walking via *pp survives the
         * close because that branch rewires the list before dispatch. */
        struct us_internal_loop_data_t *ld = &group->loop->data;
        struct us_socket_t *q = ld->low_prio_head;
        while (q) {
            struct us_socket_t *next = q->next;
            if (q->group == group) {
                us_socket_close(q, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, 0);
            }
            q = next;
        }
        US_ASSERT(group->low_prio_count == 0);
    }
}

unsigned short us_socket_group_timestamp(struct us_socket_group_t *group) {
    return group->timestamp;
}

struct us_loop_t *us_socket_group_loop(struct us_socket_group_t *group) {
    return group->loop;
}

void *us_socket_group_ext(struct us_socket_group_t *group) {
    return group->ext;
}

struct us_socket_group_t *us_socket_group_next(struct us_socket_group_t *group) {
    return group->next;
}

/* ── Link / unlink ──────────────────────────────────────────────────────── */

static inline int us_internal_group_is_empty(struct us_socket_group_t *group) {
    return group->head_sockets == NULL
        && group->head_connecting_sockets == NULL
        && group->head_listen_sockets == NULL
        && group->low_prio_count == 0;
}

static inline void us_internal_group_touched(struct us_socket_group_t *group) {
    if (!group->linked) {
        us_internal_loop_link_group(group->loop, group);
        group->linked = 1;
    }
}

void us_internal_group_maybe_unlink(struct us_socket_group_t *group) {
    if (group->linked && us_internal_group_is_empty(group)) {
        us_internal_loop_unlink_group(group->loop, group);
        group->linked = 0;
    }
}

void us_internal_socket_group_link_socket(struct us_socket_group_t *group, struct us_socket_t *s) {
    if (us_socket_is_closed(s)) return;

    s->group = group;
    s->next = group->head_sockets;
    s->prev = 0;
    if (group->head_sockets) {
        group->head_sockets->prev = s;
    }
    group->head_sockets = s;
    us_internal_group_touched(group);
    us_internal_enable_sweep_timer(group->loop);
}

void us_internal_socket_group_unlink_socket(struct us_socket_group_t *group, struct us_socket_t *s) {
    /* We have to properly update the iterator used to sweep sockets for timeouts */
    if (s == group->iterator) {
        group->iterator = s->next;
    }

    struct us_socket_t* prev = s->prev;
    struct us_socket_t* next = s->next;
    if (prev == next) {
        group->head_sockets = 0;
    } else {
        if (prev) {
            prev->next = next;
        } else {
            group->head_sockets = next;
        }
        if (next) {
            next->prev = prev;
        }
    }
    us_internal_disable_sweep_timer(group->loop);
    us_internal_group_maybe_unlink(group);
}

void us_internal_socket_group_link_connecting_socket(struct us_socket_group_t *group, struct us_connecting_socket_t *c) {
    if (c->closed) return;

    c->group = group;
    c->next_pending = group->head_connecting_sockets;
    c->prev_pending = 0;
    if (group->head_connecting_sockets) {
        group->head_connecting_sockets->prev_pending = c;
    }
    group->head_connecting_sockets = c;
    us_internal_group_touched(group);
    us_internal_enable_sweep_timer(group->loop);
}

void us_internal_socket_group_unlink_connecting_socket(struct us_socket_group_t *group, struct us_connecting_socket_t *c) {
    struct us_connecting_socket_t* prev = c->prev_pending;
    struct us_connecting_socket_t* next = c->next_pending;
    if (prev == next) {
        group->head_connecting_sockets = 0;
    } else {
        if (prev) {
            prev->next_pending = next;
        } else {
            group->head_connecting_sockets = next;
        }
        if (next) {
            next->prev_pending = prev;
        }
    }
    us_internal_disable_sweep_timer(group->loop);
    us_internal_group_maybe_unlink(group);
}

/* ── Adopt ──────────────────────────────────────────────────────────────── */

struct us_socket_t *us_socket_adopt(struct us_socket_t *s, struct us_socket_group_t *group,
                                    unsigned char kind, int old_ext_size, int ext_size) {
    if (us_socket_is_closed(s) || us_socket_is_shut_down(s)) {
        return s;
    }
    struct us_socket_group_t *old_group = s->group;
    struct us_loop_t *loop = old_group->loop;

    if (s->flags.low_prio_state != 1) {
        /* This properly updates the iterator if in on_timeout */
        us_internal_socket_group_unlink_socket(old_group, s);
    } else if (old_group != group) {
        /* Stays on the loop-wide low-prio queue, but s->group changes owner —
         * keep both groups' invariants consistent so old_group can deinit. */
        old_group->low_prio_count--;
        group->low_prio_count++;
        us_internal_group_touched(group);
        us_internal_group_maybe_unlink(old_group);
    }

    struct us_connecting_socket_t *c = s->connect_state;
    struct us_socket_t *new_s = s;
    if (ext_size != -1) {
        struct us_poll_t *poll_ref = &s->p;
        new_s = (struct us_socket_t *) us_poll_resize(poll_ref, loop,
            sizeof(struct us_socket_t) - sizeof(struct us_poll_t) + old_ext_size,
            sizeof(struct us_socket_t) - sizeof(struct us_poll_t) + ext_size);
        if (new_s != s) {
            /* Mark the old socket as closed */
            s->flags.is_closed = 1;
            /* Link this socket to the close-list and let it be deleted after this iteration */
            s->next = loop->data.closed_head;
            loop->data.closed_head = s;
            /* Mark the old socket as adopted (reallocated) */
            s->flags.adopted = 1;
            /* Tell the event loop what is the new socket so we can route subsequent events */
            s->prev = new_s;
        }
        if (c) {
            c->connecting_head = new_s;
            c->group = group;
            c->kind = kind;
            us_internal_socket_group_unlink_connecting_socket(old_group, c);
            us_internal_socket_group_link_connecting_socket(group, c);
        }
    }
    new_s->group = group;
    new_s->kind = kind;
    new_s->timeout = 255;
    new_s->long_timeout = 255;

    if (new_s->flags.low_prio_state == 1) {
        /* update pointers in low-priority queue */
        if (!new_s->prev) loop->data.low_prio_head = new_s;
        else new_s->prev->next = new_s;

        if (new_s->next) new_s->next->prev = new_s;
    } else {
        us_internal_socket_group_link_socket(group, new_s);
    }
    return new_s;
}

/* ── Listen ─────────────────────────────────────────────────────────────── */

static void us_internal_init_listen_socket(struct us_listen_socket_t *ls,
                                           struct us_socket_group_t *group,
                                           unsigned char kind, struct ssl_ctx_st *ssl_ctx,
                                           int options, int socket_ext_size) {
    struct us_socket_t *s = &ls->s;
    s->group = group;
    s->kind = 0; /* listener itself never dispatches */
    s->ssl = NULL;
    s->timeout = 255;
    s->long_timeout = 255;
    s->flags.low_prio_state = 0;
    s->flags.is_paused = 0;
    s->flags.is_ipc = 0;
    s->flags.is_closed = 0;
    s->flags.adopted = 0;
    s->flags.allow_half_open = (options & LIBUS_SOCKET_ALLOW_HALF_OPEN);
    s->next = 0;
    s->prev = 0;
    s->connect_state = NULL;
    s->connect_next = NULL;

    ls->accept_group = group;
    ls->accept_kind = kind;
    ls->ssl_ctx = ssl_ctx;
    if (ssl_ctx) us_internal_ssl_ctx_up_ref(ssl_ctx);
    ls->sni = NULL;
    ls->on_server_name = NULL;
    ls->socket_ext_size = socket_ext_size;
    ls->deferred_accept = 0;

    /* Link into the group so close_all() / test-isolation can find it. */
    ls->next = group->head_listen_sockets;
    group->head_listen_sockets = ls;
    us_internal_group_touched(group);
}

struct us_listen_socket_t *us_socket_group_listen(struct us_socket_group_t *group,
        unsigned char kind, struct ssl_ctx_st *ssl_ctx,
        const char *host, int port, int options, int socket_ext_size, int *error) {
    LIBUS_SOCKET_DESCRIPTOR listen_socket_fd = bsd_create_listen_socket(host, port, options, error);
    if (listen_socket_fd == LIBUS_SOCKET_ERROR) {
        return 0;
    }

    struct us_poll_t *p = us_create_poll(group->loop, 0, sizeof(struct us_listen_socket_t));
    us_poll_init(p, listen_socket_fd, POLL_TYPE_SEMI_SOCKET);
    us_poll_start(p, group->loop, LIBUS_SOCKET_READABLE);

    struct us_listen_socket_t *ls = (struct us_listen_socket_t *) p;
    us_internal_init_listen_socket(ls, group, kind, ssl_ctx, options, socket_ext_size);

    if (options & LIBUS_LISTEN_DEFER_ACCEPT) {
        ls->deferred_accept = bsd_set_defer_accept(listen_socket_fd);
    }

    return ls;
}

struct us_listen_socket_t *us_socket_group_listen_unix(struct us_socket_group_t *group,
        unsigned char kind, struct ssl_ctx_st *ssl_ctx,
        const char *path, size_t pathlen, int options, int socket_ext_size, int *error) {
    LIBUS_SOCKET_DESCRIPTOR listen_socket_fd = bsd_create_listen_socket_unix(path, pathlen, options, error);
    if (listen_socket_fd == LIBUS_SOCKET_ERROR) {
        return 0;
    }

    struct us_poll_t *p = us_create_poll(group->loop, 0, sizeof(struct us_listen_socket_t));
    us_poll_init(p, listen_socket_fd, POLL_TYPE_SEMI_SOCKET);
    us_poll_start(p, group->loop, LIBUS_SOCKET_READABLE);

    struct us_listen_socket_t *ls = (struct us_listen_socket_t *) p;
    us_internal_init_listen_socket(ls, group, kind, ssl_ctx, options, socket_ext_size);

    return ls;
}

void us_listen_socket_close(struct us_listen_socket_t *ls) {
    struct us_socket_t *s = &ls->s;
    if (!us_socket_is_closed(s)) {
        struct us_socket_group_t *group = ls->accept_group;
        struct us_loop_t *loop = s->group->loop;
        us_poll_stop((struct us_poll_t *) s, loop);
        bsd_close_socket(us_poll_fd((struct us_poll_t *) s));

        us_internal_listen_socket_ssl_free(ls);

        /* Unlink from group->head_listen_sockets (singly-linked). */
        for (struct us_listen_socket_t **pp = &group->head_listen_sockets; *pp; pp = &(*pp)->next) {
            if (*pp == ls) { *pp = ls->next; break; }
        }
        ls->next = NULL;
        us_internal_group_maybe_unlink(group);

        /* Link this socket to the close-list and let it be deleted after this iteration */
        s->next = loop->data.closed_head;
        loop->data.closed_head = s;
        s->flags.is_closed = 1;
    }
    /* We cannot immediately free a listen socket as we can be inside an accept loop */
}

void *us_listen_socket_ext(struct us_listen_socket_t *ls) {
    return ls + 1;
}

struct us_listen_socket_t *us_socket_group_head_listen_socket(struct us_socket_group_t *group) {
    return group->head_listen_sockets;
}

struct us_listen_socket_t *us_listen_socket_next(struct us_listen_socket_t *ls) {
    return ls->next;
}

LIBUS_SOCKET_DESCRIPTOR us_listen_socket_get_fd(struct us_listen_socket_t *ls) {
    return us_poll_fd(&ls->s.p);
}

int us_listen_socket_port(struct us_listen_socket_t *ls) {
    return us_socket_local_port(&ls->s);
}

struct us_socket_group_t *us_listen_socket_group(struct us_listen_socket_t *ls) {
    return ls->accept_group;
}

/* ── Connect ────────────────────────────────────────────────────────────── */

static inline void us_internal_init_connect_socket(struct us_socket_t *s,
                                                   struct us_socket_group_t *group,
                                                   unsigned char kind, int options) {
    s->group = group;
    s->kind = kind;
    s->ssl = NULL;
    s->timeout = 255;
    s->long_timeout = 255;
    s->flags.low_prio_state = 0;
    s->flags.allow_half_open = (options & LIBUS_SOCKET_ALLOW_HALF_OPEN);
    s->flags.is_paused = 0;
    s->flags.is_ipc = 0;
    s->flags.is_closed = 0;
    s->flags.adopted = 0;
    s->flags.last_write_failed = 0;
    s->connect_state = NULL;
    s->connect_next = NULL;
}

struct us_socket_t *us_socket_group_connect_resolved_dns(struct us_socket_group_t *group,
        unsigned char kind, struct ssl_ctx_st *ssl_ctx,
        struct sockaddr_storage *addr, int options, int socket_ext_size) {
    LIBUS_SOCKET_DESCRIPTOR connect_socket_fd = bsd_create_connect_socket(addr, options);
    if (connect_socket_fd == LIBUS_SOCKET_ERROR) {
        return NULL;
    }

    bsd_socket_nodelay(connect_socket_fd, 1);

    struct us_poll_t *p = us_create_poll(group->loop, 0, sizeof(struct us_socket_t) + socket_ext_size);
    us_poll_init(p, connect_socket_fd, POLL_TYPE_SEMI_SOCKET);
    us_poll_start(p, group->loop, LIBUS_SOCKET_WRITABLE);

    struct us_socket_t *socket = (struct us_socket_t *) p;
    us_internal_init_connect_socket(socket, group, kind, options);

    /* Fast path has no us_connecting_socket_t to stash ssl_ctx on, so attach
     * the SSL state now; on_open will see s->ssl != NULL and route through the
     * TLS layer. */
    if (ssl_ctx) {
        us_internal_ssl_attach(socket, ssl_ctx, 1, NULL, NULL);
    }

    us_internal_socket_group_link_socket(group, socket);
    return socket;
}

static void init_addr_with_port(struct addrinfo* info, int port, struct sockaddr_storage *addr) {
    if (info->ai_family == AF_INET) {
        struct sockaddr_in *addr_in = (struct sockaddr_in *) addr;
        memcpy(addr_in, info->ai_addr, info->ai_addrlen);
        addr_in->sin_port = htons(port);
    } else {
        struct sockaddr_in6 *addr_in6 = (struct sockaddr_in6 *) addr;
        memcpy(addr_in6, info->ai_addr, info->ai_addrlen);
        addr_in6->sin6_port = htons(port);
    }
}

static bool try_parse_ip(const char *ip_str, int port, struct sockaddr_storage *storage) {
    memset(storage, 0, sizeof(struct sockaddr_storage));
    struct sockaddr_in *addr4 = (struct sockaddr_in *)storage;
    if (inet_pton(AF_INET, ip_str, &addr4->sin_addr) == 1) {
        addr4->sin_port = htons(port);
        addr4->sin_family = AF_INET;
#ifdef __APPLE__
        addr4->sin_len = sizeof(struct sockaddr_in);
#endif
        return 1;
    }

    struct sockaddr_in6 *addr6 = (struct sockaddr_in6 *)storage;
    if (inet_pton(AF_INET6, ip_str, &addr6->sin6_addr) == 1) {
        addr6->sin6_port = htons(port);
        addr6->sin6_family = AF_INET6;
#ifdef __APPLE__
        addr6->sin6_len = sizeof(struct sockaddr_in6);
#endif
        return 1;
    }

    return 0;
}

void *us_socket_group_connect(struct us_socket_group_t *group, unsigned char kind,
        struct ssl_ctx_st *ssl_ctx, const char *host, int port, int options,
        int socket_ext_size, int *has_dns_resolved) {
    struct us_loop_t *loop = group->loop;

    struct sockaddr_storage addr;
    if (try_parse_ip(host, port, &addr)) {
        *has_dns_resolved = 1;
        return us_socket_group_connect_resolved_dns(group, kind, ssl_ctx, &addr, options, socket_ext_size);
    }

    struct addrinfo_request *ai_req;
    if (Bun__addrinfo_get(loop, host, (uint16_t)port, &ai_req) == 0) {
        struct addrinfo_result *result = Bun__addrinfo_getRequestResult(ai_req);
        if (result->error) {
            errno = result->error;
            Bun__addrinfo_freeRequest(ai_req, 1);
            return NULL;
        }

        struct addrinfo_result_entry *entries = result->entries;
        if (entries && entries->info.ai_next == NULL) {
            struct sockaddr_storage a;
            init_addr_with_port(&entries->info, port, &a);
            *has_dns_resolved = 1;
            struct us_socket_t *s = us_socket_group_connect_resolved_dns(group, kind, ssl_ctx, &a, options, socket_ext_size);
            Bun__addrinfo_freeRequest(ai_req, s == NULL);
            return s;
        }
    }

    /* CodeRabbit: us_calloc is mimalloc, which aborts on OOM (matches the
     * other 13 unchecked allocations in this library). A NULL-check here would
     * also have to cancel the in-flight ai_req — brittle for an unreachable
     * path. */
    struct us_connecting_socket_t *c = us_calloc(1, sizeof(struct us_connecting_socket_t) + socket_ext_size);
    c->socket_ext_size = socket_ext_size;
    c->options = options;
    c->kind = kind;
    c->loop = loop;
    c->ssl_ctx = ssl_ctx;
    if (ssl_ctx) us_internal_ssl_ctx_up_ref(ssl_ctx);
    c->timeout = 255;
    c->long_timeout = 255;
    c->pending_resolve_callback = 1;
    c->addrinfo_req = ai_req;
    c->port = port;
    us_internal_socket_group_link_connecting_socket(group, c);

#ifdef _WIN32
    loop->uv_loop->active_handles++;
#else
    loop->num_polls++;
#endif

    Bun__addrinfo_set(ai_req, c);

    return c;
}

struct us_socket_t *us_socket_group_connect_unix(struct us_socket_group_t *group,
        unsigned char kind, struct ssl_ctx_st *ssl_ctx,
        const char *server_path, size_t pathlen, int options, int socket_ext_size) {
    LIBUS_SOCKET_DESCRIPTOR connect_socket_fd = bsd_create_connect_socket_unix(server_path, pathlen, options);
    if (connect_socket_fd == LIBUS_SOCKET_ERROR) {
        return 0;
    }

    struct us_poll_t *p = us_create_poll(group->loop, 0, sizeof(struct us_socket_t) + socket_ext_size);
    us_poll_init(p, connect_socket_fd, POLL_TYPE_SEMI_SOCKET);
    us_poll_start(p, group->loop, LIBUS_SOCKET_WRITABLE);

    struct us_socket_t *connect_socket = (struct us_socket_t *) p;
    us_internal_init_connect_socket(connect_socket, group, kind, options);

    if (ssl_ctx) {
        us_internal_ssl_attach(connect_socket, ssl_ctx, 1, NULL, NULL);
    }

    us_internal_socket_group_link_socket(group, connect_socket);
    return connect_socket;
}

int start_connections(struct us_connecting_socket_t *c, int count) {
    int opened = 0;
    struct us_socket_group_t *group = c->group;
    struct us_loop_t *loop = group->loop;
    for (; c->addrinfo_head != NULL && opened < count; c->addrinfo_head = c->addrinfo_head->ai_next) {
        struct sockaddr_storage addr;
        init_addr_with_port(c->addrinfo_head, c->port, &addr);
        LIBUS_SOCKET_DESCRIPTOR connect_socket_fd = bsd_create_connect_socket(&addr, c->options);
        if (connect_socket_fd == LIBUS_SOCKET_ERROR) {
            continue;
        }
        ++opened;
        bsd_socket_nodelay(connect_socket_fd, 1);
        struct us_socket_t *s = (struct us_socket_t *)us_create_poll(loop, 0, sizeof(struct us_socket_t) + c->socket_ext_size);
        us_internal_init_connect_socket(s, group, c->kind, c->options);
        s->timeout = c->timeout;
        s->long_timeout = c->long_timeout;

        us_internal_socket_group_link_socket(group, s);

        memcpy((void *)(s + 1), (void *)(c + 1), c->socket_ext_size);

        s->connect_next = c->connecting_head;
        c->connecting_head = s;
        s->connect_state = c;

        struct us_poll_t *poll = &s->p;
        us_poll_init(poll, connect_socket_fd, POLL_TYPE_SEMI_SOCKET);
        us_poll_start(poll, loop, LIBUS_SOCKET_WRITABLE);
    }
    return opened;
}

void us_internal_socket_after_resolve(struct us_connecting_socket_t *c) {
    /* close_all() may have run between the DNS thread queuing this callback and
     * us reaching it; c->group is NULL'd at close so it can't be touched. The
     * keep-alive (num_polls/active_handles) was already balanced by the close
     * path's Bun__addrinfo_cancel branch. */
    c->pending_resolve_callback = 0;
    if (c->closed) {
        if (c->addrinfo_req) {
            Bun__addrinfo_freeRequest(c->addrinfo_req, 0);
            c->addrinfo_req = 0;
        }
        us_connecting_socket_free(c);
        return;
    }

    struct us_socket_group_t *group = c->group;
#ifdef _WIN32
    group->loop->uv_loop->active_handles--;
#else
    group->loop->num_polls--;
#endif
    struct addrinfo_result *result = Bun__addrinfo_getRequestResult(c->addrinfo_req);
    if (result->error) {
        us_connecting_socket_close(c);
        return;
    }

    c->addrinfo_head = &result->entries->info;

    int opened = start_connections(c, CONCURRENT_CONNECTIONS);
    if (opened == 0) {
        us_connecting_socket_close(c);
    }
}

void us_internal_socket_after_open(struct us_socket_t *s, int error) {
    struct us_connecting_socket_t *c = s->connect_state;
    #if _WIN32
    if (error == 0) {
        if (recv(us_poll_fd((struct us_poll_t*)s), NULL, 0, MSG_PUSH_IMMEDIATE) == SOCKET_ERROR) {
            error = WSAGetLastError();
            switch (error) {
                case WSAEWOULDBLOCK:
                case WSAEINTR: {
                    error = 0;
                    break;
                }
                default: {
                    break;
                }
            }
        }
    }
    #endif
    if (error) {
        if (c) {
            for (struct us_socket_t **next = &c->connecting_head; *next; next = &(*next)->connect_next) {
                if (*next == s) {
                    *next = s->connect_next;
                    break;
                }
            }
            us_socket_close(s, LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET, 0);

            if (c->connecting_head == NULL || c->connecting_head->connect_next == NULL) {
                int opened = start_connections(c, c->connecting_head == NULL ? CONCURRENT_CONNECTIONS : 1);
                if (opened == 0 && c->connecting_head == NULL) {
                    us_connecting_socket_close(c);
                }
            }
        } else {
            us_dispatch_connect_error(s, error);
            // It's expected that close is called by the caller
        }
    } else {
        us_poll_change(&s->p, s->group->loop, LIBUS_SOCKET_READABLE);
        bsd_socket_nodelay(us_poll_fd(&s->p), 1);
        us_internal_poll_set_type(&s->p, POLL_TYPE_SOCKET);
        us_socket_timeout(s, 0);

        if (c) {
            for (struct us_socket_t *next = c->connecting_head; next; next = next->connect_next) {
                if (next != s) {
                    us_socket_close(next, LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET, 0);
                }
            }
            /* Attach TLS now that we know which candidate won. */
            if (c->ssl_ctx) {
                us_internal_ssl_attach(s, c->ssl_ctx, 1, NULL, NULL);
            }
            Bun__addrinfo_freeRequest(c->addrinfo_req, 0);
            us_connecting_socket_free(c);
            s->connect_state = NULL;
        }

        if (s->ssl) {
            us_internal_ssl_on_open(s, 1, 0, 0);
        } else {
            us_dispatch_open(s, 1, 0, 0);
        }
    }
}

/* ── Misc ───────────────────────────────────────────────────────────────── */

struct us_bun_verify_error_t us_socket_verify_error(struct us_socket_t *s) {
    if (s->ssl) {
        return us_internal_ssl_verify_error(s);
    }
    return (struct us_bun_verify_error_t) { .error = 0, .code = NULL, .reason = NULL };
}
