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
// clang-format off
#pragma once
#ifndef INTERNAL_H
#define INTERNAL_H

#if defined(_MSC_VER)
#ifndef __cplusplus
#define alignas(x) __declspec(align(x))
#endif

#include <BaseTsd.h>
typedef SSIZE_T ssize_t;

#else
#include <stdalign.h>
#endif

#if defined(LIBUS_USE_KQUEUE) && defined(__APPLE__)
#include <mach/mach.h>
#endif

#if defined(__FreeBSD__)
/* arm64 FreeBSD's <machine/_align.h> casts to u_long but <sys/socket.h>
 * (via <sys/_types.h>) reaches it without including <sys/types.h> first. */
#include <sys/types.h>
#endif

#if defined(LIBUS_USE_EPOLL) || defined(LIBUS_USE_KQUEUE)
#define LIBUS_MAX_READY_POLLS 1024

void us_internal_loop_update_pending_ready_polls(struct us_loop_t *loop,
                                                 struct us_poll_t *old_poll,
                                                 struct us_poll_t *new_poll,
                                                 int old_events,
                                                 int new_events);
#endif

/* We only have one networking implementation so far */
#include "internal/networking/bsd.h"

/* We have many different eventing implementations */
#if defined(LIBUS_USE_EPOLL) || defined(LIBUS_USE_KQUEUE)
#include "internal/eventing/epoll_kqueue.h"
#endif

#ifdef LIBUS_USE_LIBUV
#include "internal/eventing/libuv.h"
#endif

#ifndef LIKELY
#define LIKELY(cond) __builtin_expect((_Bool)(cond), 1)
#define UNLIKELY(cond) __builtin_expect((_Bool)(cond), 0)
#endif

extern void __attribute__((__noreturn__)) Bun__panic(const char *message, size_t length);
#define BUN_PANIC(message) Bun__panic(message, sizeof(message) - 1)

#ifdef _WIN32
#define IS_EINTR(rc) (rc == SOCKET_ERROR && WSAGetLastError() == WSAEINTR)
#define LIBUS_ERR WSAGetLastError()
#else
#include <errno.h>
#define IS_EINTR(rc) (rc == -1 && errno == EINTR)
#define LIBUS_ERR errno
#endif
#include <stdbool.h>
/* Poll type and what it polls for */
enum {
  /* Three first bits */
  POLL_TYPE_SOCKET = 0,
  POLL_TYPE_SOCKET_SHUT_DOWN = 1,
  POLL_TYPE_SEMI_SOCKET = 2,
  POLL_TYPE_CALLBACK = 3,
  POLL_TYPE_UDP = 4,

  /* Two last bits */
  POLL_TYPE_POLLING_OUT = 8,
  POLL_TYPE_POLLING_IN = 16,
};

#define POLL_TYPE_BITSIZE 5 // make sure to update epoll_kqueue.h if you change this
#define POLL_TYPE_KIND_MASK 0b111
#define POLL_TYPE_POLLING_MASK 0b11000
#define POLL_TYPE_MASK (POLL_TYPE_KIND_MASK | POLL_TYPE_POLLING_MASK)

/* Bun APIs implemented in Zig */
void Bun__lock(zig_mutex_t *lock);
void Bun__unlock(zig_mutex_t *lock);

struct addrinfo_request;
struct addrinfo_result_entry {
    struct addrinfo info;
    struct sockaddr_storage _storage;
};
struct addrinfo_result {
    struct addrinfo_result_entry* entries;
    int error;
};

/* Dispatch — defined out-of-library (Zig: src/deps/uws/dispatch.zig). loop.c
 * never reads s->group->vtable directly; it calls these and the closed-world
 * switch on s->kind decides whether to direct-call into Zig/C++ or fall back
 * to the vtable. Signatures match the vtable entries exactly. */
extern struct us_socket_t *us_dispatch_open(us_socket_r s, int is_client, char *ip, int ip_length);
extern struct us_socket_t *us_dispatch_data(us_socket_r s, char *data, int length);
extern struct us_socket_t *us_dispatch_fd(us_socket_r s, int fd);
extern struct us_socket_t *us_dispatch_writable(us_socket_r s);
extern struct us_socket_t *us_dispatch_close(us_socket_r s, int code, void *reason);
extern struct us_socket_t *us_dispatch_timeout(us_socket_r s);
extern struct us_socket_t *us_dispatch_long_timeout(us_socket_r s);
extern struct us_socket_t *us_dispatch_end(us_socket_r s);
extern struct us_socket_t *us_dispatch_connect_error(us_socket_r s, int code);
extern struct us_connecting_socket_t *us_dispatch_connecting_error(struct us_connecting_socket_t *c, int code);
extern void us_dispatch_handshake(us_socket_r s, int success, struct us_bun_verify_error_t err);
extern int us_dispatch_is_low_prio(us_socket_r s);

extern int Bun__addrinfo_get(struct us_loop_t* loop, const char* host, uint16_t port,  struct addrinfo_request** ptr);
extern int Bun__addrinfo_set(struct addrinfo_request* ptr, struct us_connecting_socket_t* socket);
extern int Bun__addrinfo_cancel(struct addrinfo_request* ptr, struct us_connecting_socket_t* socket);
extern void Bun__addrinfo_freeRequest(struct addrinfo_request* addrinfo_req, int error);
extern struct addrinfo_result *Bun__addrinfo_getRequestResult(struct addrinfo_request* addrinfo_req);


/* Loop related */
void us_internal_dispatch_ready_poll(struct us_poll_t *p, int error, int eof, int events);
void us_internal_timer_sweep(us_loop_r loop);
void us_internal_enable_sweep_timer(struct us_loop_t *loop);
void us_internal_disable_sweep_timer(struct us_loop_t *loop);
void us_internal_free_closed_sockets(us_loop_r loop);
void us_internal_loop_link_group(struct us_loop_t *loop, struct us_socket_group_t *group);
void us_internal_loop_unlink_group(struct us_loop_t *loop, struct us_socket_group_t *group);
void us_internal_loop_data_init(struct us_loop_t *loop,
                                void (*wakeup_cb)(us_loop_r loop),
                                void (*pre_cb)(us_loop_r loop),
                                void (*post_cb)(us_loop_r loop));
void us_internal_loop_data_free(us_loop_r loop);
void us_internal_loop_pre(us_loop_r loop);
void us_internal_loop_post(us_loop_r loop);

/* Asyncs (old) */
struct us_internal_async *us_internal_create_async(struct us_loop_t *loop,
                                                   int fallthrough,
                                                   unsigned int ext_size);
void us_internal_async_close(struct us_internal_async *a);
void us_internal_async_set(struct us_internal_async *a,
                           void (*cb)(struct us_internal_async *));
void us_internal_async_wakeup(struct us_internal_async *a);

/* Eventing related */
size_t us_internal_accept_poll_event(struct us_poll_t *p);
int us_internal_poll_type(struct us_poll_t *p);
void us_internal_poll_set_type(struct us_poll_t *p, int poll_type);

/* SSL loop data */
void us_internal_init_loop_ssl_data(us_loop_r loop);
void us_internal_free_loop_ssl_data(us_loop_r loop);

/* Socket context related */
void us_internal_socket_group_link_socket(us_socket_group_r group, us_socket_r s);
void us_internal_socket_group_unlink_socket(us_socket_group_r group, us_socket_r s);

void us_internal_socket_after_resolve(struct us_connecting_socket_t *s);
void us_internal_socket_after_open(us_socket_r s, int error);
/* Common header for the per-socket SSL state. The actual layout is private to
 * openssl.c (renegotiation counters etc. follow), but loop.c/socket.c need to
 * test `s->ssl != NULL` and read handshake_state. */
struct us_ssl_socket_data_t;
struct us_ssl_socket_data_t *us_internal_ssl_data_create(us_socket_r s, void /* us_ssl_ctx_t */ *ssl_ctx, int is_client, const char *sni);
void us_internal_ssl_data_free(struct us_ssl_socket_data_t *ssl);

/* TLS-layer event hooks. loop.c calls these instead of us_dispatch_* when
 * s->ssl != NULL; they decrypt/encrypt and re-dispatch the plaintext. */
struct us_socket_t *us_internal_ssl_on_open(us_socket_r s, int is_client, char *ip, int ip_length);
struct us_socket_t *us_internal_ssl_on_data(us_socket_r s, char *data, int length);
struct us_socket_t *us_internal_ssl_on_writable(us_socket_r s);
struct us_socket_t *us_internal_ssl_on_close(us_socket_r s, int code, void *reason);
struct us_socket_t *us_internal_ssl_on_end(us_socket_r s);
int us_internal_ssl_is_low_prio(us_socket_r s);

int us_internal_ssl_is_handshake_finished(us_socket_r s);
int us_internal_ssl_handshake_callback_has_fired(us_socket_r s);
int us_internal_ssl_is_shut_down(us_socket_r s);
void us_internal_ssl_shutdown(us_socket_r s);
int us_internal_ssl_write(us_socket_r s, const char *data, int length);
void *us_internal_ssl_get_native_handle(us_socket_r s);
struct us_bun_verify_error_t us_internal_ssl_verify_error(us_socket_r s);
void *us_internal_ssl_sni_userdata(us_socket_r s);
void us_internal_ssl_handshake_abort(us_socket_r s);
/* SSL_CTX_free(ls->ssl_ctx) + sni_free(ls->sni). Called from us_listen_socket_close. */
void us_internal_listen_socket_ssl_free(struct us_listen_socket_t *ls);
/* Opaque SSL_CTX_up_ref/SSL_CTX_free so context.c needn't include OpenSSL. */
void us_internal_ssl_ctx_up_ref(void *ssl_ctx);
void us_internal_ssl_ctx_unref(void *ssl_ctx);
/* TCP-level FIN, bypassing the SSL layer (used by ssl_on_end). */
void us_internal_socket_raw_shutdown(us_socket_r s);

int us_internal_handle_dns_results(us_loop_r loop);

/* Sockets are polls */

struct us_socket_flags {
    /* If true, the readable side is paused */
    bool is_paused: 1;
    /* Allow to stay alive after FIN/EOF */
    bool allow_half_open: 1;
    /* 0 = not in low-prio queue, 1 = is in low-prio queue, 2 = was in low-prio queue in this iteration */
    unsigned char low_prio_state: 2;
    /* If true, the socket should be read using readmsg to support receiving file descriptors */
    bool is_ipc: 1;
    /* If true, the socket has been closed */
    bool is_closed: 1;
    /* If true, the socket was reallocated during adoption */
    bool adopted: 1;
    /* If true, the last write to this socket failed (would block) */
    bool last_write_failed: 1;

} __attribute__((packed));

struct us_socket_t {
  alignas(LIBUS_EXT_ALIGNMENT) struct us_poll_t p;
  unsigned char timeout;
  unsigned char long_timeout;
  struct us_socket_flags flags;
  /* enum SocketKind. Selects the static dispatch arm in us_dispatch_*. */
  unsigned char kind;

  struct us_socket_group_t *group;
  /* NULL for plain TCP. Allocated by us_internal_ssl_data_create() in
   * adopt_tls / connect-with-ssl_ctx / accept-with-ssl_ctx. */
  struct us_ssl_socket_data_t *ssl;
  struct us_socket_t *prev, *next;
  struct us_socket_t *connect_next;
  struct us_connecting_socket_t *connect_state;
};

#if defined(LIBUS_USE_EPOLL) || defined(LIBUS_USE_KQUEUE)
_Static_assert(sizeof(struct us_socket_flags) == 1, "us_socket_flags grew");
#endif

struct us_connecting_socket_t {
    alignas(LIBUS_EXT_ALIGNMENT) struct addrinfo_request *addrinfo_req;
    struct us_socket_group_t *group;
    /* SSL_CTX to apply on open (borrowed; up_ref'd while in flight). */
    void *ssl_ctx;
    // this is used to track all dns resolutions in this connection
    struct us_connecting_socket_t *next;
    struct us_socket_t *connecting_head;
    int options;
    int socket_ext_size;
    unsigned int closed : 1, shutdown : 1, shutdown_read : 1, pending_resolve_callback : 1;
    unsigned char timeout;
    unsigned char long_timeout;
    unsigned char kind;
    uint16_t port;
    int error;
    struct addrinfo *addrinfo_head;
    // this is used to track pending connecting sockets in the context
    struct us_connecting_socket_t* next_pending;
    struct us_connecting_socket_t* prev_pending;
};

struct us_udp_socket_t {
    alignas(LIBUS_EXT_ALIGNMENT) struct us_poll_t p;
    void (*on_data)(struct us_udp_socket_t *, void *, int);
    void (*on_drain)(struct us_udp_socket_t *);
    void (*on_close)(struct us_udp_socket_t *);
    /* Called when recvmmsg returns an error (other than EAGAIN). The socket
     * is NOT closed — caller decides whether to close. Used to surface ICMP
     * errors delivered via IP_RECVERR on Linux (ECONNREFUSED, etc.). */
    void (*on_recv_error)(struct us_udp_socket_t *, int err);
    void *user;
    struct us_loop_t *loop;
    /* An UDP socket can only ever be bound to one single port regardless of how
     * many interfaces it may listen to. Therefore we cache the port after creation
     * and use it to build a proper and full sockaddr_in or sockaddr_in6 for every received packet */
    uint16_t port;
    uint16_t closed : 1;
    uint16_t connected : 1;
    struct us_udp_socket_t *next;
};

#if defined(LIBUS_USE_KQUEUE) && defined(__APPLE__)
/* Internal callback types are polls just like sockets */
struct us_internal_callback_t {
  alignas(LIBUS_EXT_ALIGNMENT) struct us_poll_t p;
  struct us_loop_t *loop;
  int cb_expects_the_loop;
  int leave_poll_ready;
  void (*cb)(struct us_internal_callback_t *cb);
  mach_port_t port;
  void *machport_buf;
};

#else

struct us_internal_callback_t {
  alignas(LIBUS_EXT_ALIGNMENT) struct us_poll_t p;
  struct us_loop_t *loop;
  int cb_expects_the_loop;
  int leave_poll_ready;
  void (*cb)(struct us_internal_callback_t *cb);
  unsigned has_added_timer_to_event_loop;
};

#endif

#if __cplusplus
extern "C" {
#endif
int us_internal_raw_root_certs(struct us_cert_string_t **out);

#if __cplusplus
}
#endif

/* Listen sockets are sockets, with their own embedded group for the listener
 * itself (for the accept-readable poll) plus the accepted-socket parameters
 * stamped on every accept(). The accepted sockets are linked into whatever
 * group was passed to us_socket_group_listen() — typically the embedding
 * server's group, NOT this struct. */
struct us_listen_socket_t {
  alignas(LIBUS_EXT_ALIGNMENT) struct us_socket_t s;
  /* Group accepted sockets are linked into. Distinct from s.group (which is
   * the listener's own poll group). Usually the same pointer in practice. */
  struct us_socket_group_t *accept_group;
  /* SSL_CTX for accepted sockets. Borrowed; up_ref'd on listen, freed on
   * close. NULL → plain TCP. */
  void *ssl_ctx;
  /* SNI hostname → {SSL_CTX*, user*} tree. Owned. */
  void *sni;
  void (*on_server_name)(struct us_listen_socket_t *, const char *hostname);
  unsigned int socket_ext_size;
  /* kind to stamp on accepted sockets. */
  unsigned char accept_kind;
  /* Set when TCP_DEFER_ACCEPT/SO_ACCEPTFILTER was successfully applied. */
  unsigned char deferred_accept;
};

void us_internal_socket_group_link_connecting_socket(us_socket_group_r group, struct us_connecting_socket_t *c);
void us_internal_socket_group_unlink_connecting_socket(us_socket_group_r group, struct us_connecting_socket_t *c);

int us_raw_root_certs(struct us_cert_string_t **out);

#endif // INTERNAL_H
