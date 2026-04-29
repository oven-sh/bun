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
#ifndef us_calloc
#define us_calloc calloc
#endif

#ifndef us_malloc
#define us_malloc malloc
#endif

#ifndef us_realloc
#define us_realloc realloc
#endif

#ifndef us_free
#define us_free free
#endif

#ifndef LIBUSOCKETS_H
#define LIBUSOCKETS_H

#ifdef BUN_DEBUG
#define nonnull_arg
#else
#define nonnull_arg _Nonnull
#endif

#ifdef BUN_DEBUG
#define nonnull_fn_decl
#else
#ifndef nonnull_fn_decl
#define nonnull_fn_decl __attribute__((nonnull))
#endif
#endif

#define us_loop_r struct us_loop_t *nonnull_arg
#define us_socket_r struct us_socket_t *nonnull_arg
#define us_poll_r struct us_poll_t *nonnull_arg
#define us_socket_group_r struct us_socket_group_t *nonnull_arg


/* 512kb shared receive buffer */
#define LIBUS_RECV_BUFFER_LENGTH 524288

/* Small 16KB shared send buffer for UDP packet metadata */
#define LIBUS_SEND_BUFFER_LENGTH (1 << 14)
/* A timeout granularity of 4 seconds means give or take 4 seconds from set timeout */
#define LIBUS_TIMEOUT_GRANULARITY 4
/* 32 byte padding of receive buffer ends */
#define LIBUS_RECV_BUFFER_PADDING 32
/* Guaranteed alignment of extension memory */
#define LIBUS_EXT_ALIGNMENT 16
#define ALLOW_SERVER_RENEGOTIATION 0

#define LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN 0
#define LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET 1

/* Define what a socket descriptor is based on platform */
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#define _WINSOCK_DEPRECATED_NO_WARNINGS
#include <winsock2.h>
#define LIBUS_SOCKET_DESCRIPTOR SOCKET
#else
#define LIBUS_SOCKET_DESCRIPTOR int
#endif

/* <stdint.h> pulls in glibc's <features.h>, which locks the feature-test
 * macros for the rest of the TU. bsd.h needs _GNU_SOURCE for mmsghdr/accept4
 * but is included after us, so set it here before any system header. */
#if !defined(_WIN32) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE
#endif

#include "stddef.h"
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
    /* No meaning, default listen option */
    LIBUS_LISTEN_DEFAULT = 0,
    /* We exclusively own this port, do not share it */
    LIBUS_LISTEN_EXCLUSIVE_PORT = 1,
    /* Allow socket to keep writing after readable side closes */
    LIBUS_SOCKET_ALLOW_HALF_OPEN = 2,
    /* Setting reusePort allows multiple sockets on the same host to bind to the same port. Incoming connections are distributed by the operating system to listening sockets. This option is available only on some platforms, such as Linux 3.9+, DragonFlyBSD 3.6+, FreeBSD 12.0+, Solaris 11.4, and AIX 7.2.5+*/
    LIBUS_LISTEN_REUSE_PORT = 4,
    /* Setting ipv6Only will disable dual-stack support, i.e., binding to host :: won't make 0.0.0.0 be bound.*/
    LIBUS_SOCKET_IPV6_ONLY = 8,
    LIBUS_LISTEN_REUSE_ADDR = 16,
    LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE = 32,
    /* Ask the kernel to defer accept() until the client has sent data (TCP_DEFER_ACCEPT on
     * Linux, SO_ACCEPTFILTER "dataready" on FreeBSD). When set, accepted sockets are
     * dispatched as readable immediately, skipping a round-trip through the event loop.
     * Safe for HTTP/TLS where the client always sends first; do not use for protocols where
     * the server sends the first bytes. */
    LIBUS_LISTEN_DEFER_ACCEPT = 64,
};

/* Library types publicly available */
struct us_socket_t;
struct us_connecting_socket_t;
struct us_timer_t;
struct us_socket_group_t;
struct us_socket_vtable_t;
struct us_listen_socket_t;
struct us_loop_t;
struct us_poll_t;
struct us_udp_socket_t;
struct us_udp_packet_buffer_t;


struct us_cert_string_t {
    const char* str;
    size_t len;
};

/* Public interface for UDP sockets */

/* Peeks data and length of UDP payload */
char *us_udp_packet_buffer_payload(struct us_udp_packet_buffer_t *buf, int index);
int us_udp_packet_buffer_payload_length(struct us_udp_packet_buffer_t *buf, int index);

/* Returns 1 if the received datagram was truncated (larger than recv buffer),
 * 0 otherwise. Backed by MSG_TRUNC in msg_hdr.msg_flags on POSIX. */
int us_udp_packet_buffer_truncated(struct us_udp_packet_buffer_t *buf, int index);

/* Copies out local (received destination) ip (4 or 16 bytes) of received packet */
int us_udp_packet_buffer_local_ip(struct us_udp_packet_buffer_t *buf, int index, char *ip);

/* Get the bound port in host byte order */
int us_udp_socket_bound_port(struct us_udp_socket_t *s);

/* Peeks peer addr (sockaddr) of received packet */
char *us_udp_packet_buffer_peer(struct us_udp_packet_buffer_t *buf, int index);

/* Peeks ECN of received packet */
// int us_udp_packet_buffer_ecn(struct us_udp_packet_buffer_t *buf, int index);

/* Receives a set of packets into specified packet buffer */
int us_udp_socket_receive(struct us_udp_socket_t *s, struct us_udp_packet_buffer_t *buf);

void us_udp_buffer_set_packet_payload(struct us_udp_packet_buffer_t *send_buf, int index, int offset, void *payload, int length, void *peer_addr);

int us_udp_socket_send(struct us_udp_socket_t *s, void** payloads, size_t* lengths, void** addresses, int num);

/* Allocates a packet buffer that is reuable per thread. Mutated by us_udp_socket_receive. */
struct us_udp_packet_buffer_t *us_create_udp_packet_buffer();

/* Creates a (heavy-weight) UDP socket with a user space ring buffer. Again, this one is heavy weight and
 * shoud be reused. One entire QUIC server can be implemented using only one single UDP socket so weight
 * is not a concern as is the case for TCP sockets which are 1-to-1 with TCP connections. */
//struct us_udp_socket_t *us_create_udp_socket(us_loop_r loop, void (*read_cb)(struct us_udp_socket_t *), unsigned short port);

//struct us_udp_socket_t *us_create_udp_socket(us_loop_r loop, void (*data_cb)(struct us_udp_socket_t *, struct us_udp_packet_buffer_t *, int), void (*drain_cb)(struct us_udp_socket_t *), char *host, unsigned short port);

struct us_udp_socket_t *us_create_udp_socket(us_loop_r loop, void (*data_cb)(struct us_udp_socket_t *, void *, int), void (*drain_cb)(struct us_udp_socket_t *), void (*close_cb)(struct us_udp_socket_t *), void (*recv_error_cb)(struct us_udp_socket_t *, int), const char *host, unsigned short port, int flags, int *err, void *user);

void us_udp_socket_close(struct us_udp_socket_t *s);

int us_udp_socket_set_broadcast(struct us_udp_socket_t *s, int enabled);

/* This one is ugly, should be ext! not user */
void *us_udp_socket_user(struct us_udp_socket_t *s);

/* Binds the UDP socket to an interface and port */
int us_udp_socket_bind(struct us_udp_socket_t *s, const char *hostname, unsigned int port);

/* Public interfaces for timers */

/* Create a new high precision, low performance timer. May fail and return null */
struct us_timer_t *us_create_timer(us_loop_r loop, int fallthrough, unsigned int ext_size);

/* Returns user data extension for this timer */
void *us_timer_ext(struct us_timer_t *timer);

/* */
void us_timer_close(struct us_timer_t *timer, int fallthrough);

/* Arm a timer with a delay from now and eventually a repeat delay.
 * Specify 0 as repeat delay to disable repeating. Specify both 0 to disarm. */
void us_timer_set(struct us_timer_t *timer, void (*cb)(struct us_timer_t *t), int ms, int repeat_ms);

/* Returns the loop for this timer */
struct us_loop_t *us_timer_loop(struct us_timer_t *t);

/* ──────────────────────────────────────────────────────────────────────────
 * Socket groups & dispatch
 *
 * A us_socket_group_t is the timeout-sweep / iteration list-head for a set of
 * sockets that share lifetime (per-kind on a VM, per-server, per-SNI). Groups
 * are EMBEDDED in their owner — never separately heap-allocated — and linked
 * into the loop only while non-empty (zero loop overhead for unused kinds).
 *
 * Event dispatch is by socket->kind: loop.c hands raw bytes to us_dispatch_*
 * (defined in Zig/C++), which switches on kind into the right handler with the
 * ext already typed. The vtable on the group is for the few kinds whose
 * handlers must remain indirect (uWS C++); Zig kinds compile to direct calls
 * and never read it.
 *
 * TLS is per-socket (`s->ssl`), not per-group. SSL_CTX is owned externally
 * (SecureContext / listener) and passed to listen/connect/adopt.
 * ────────────────────────────────────────────────────────────────────────── */

struct us_bun_verify_error_t {
    int error;
    const char* code;
    const char* reason;
};

/* Immutable callback table. ~20 instances total (one per kind), all static
 * const / .rodata. Nullable entries are skipped by dispatch. */
struct us_socket_vtable_t {
    struct us_socket_t *(*on_open)(us_socket_r, int is_client, char *ip, int ip_length);
    struct us_socket_t *(*on_data)(us_socket_r, char *data, int length);
    struct us_socket_t *(*on_fd)(us_socket_r, int fd);
    struct us_socket_t *(*on_writable)(us_socket_r);
    struct us_socket_t *(*on_close)(us_socket_r, int code, void *reason);
    struct us_socket_t *(*on_timeout)(us_socket_r);
    struct us_socket_t *(*on_long_timeout)(us_socket_r);
    struct us_socket_t *(*on_end)(us_socket_r);
    struct us_socket_t *(*on_connect_error)(us_socket_r, int code);
    struct us_connecting_socket_t *(*on_connecting_error)(struct us_connecting_socket_t *, int code);
    void (*on_handshake)(us_socket_r, int success, struct us_bun_verify_error_t, void *custom_data);
    int (*is_low_prio)(us_socket_r);
};

/* Mutable list-head + sweep state. Zero-initialise then us_socket_group_init().
 * `ext` is the owner pointer recovered by handlers (server*, app*, vm*). */
struct us_socket_group_t {
    struct us_loop_t *loop;
    const struct us_socket_vtable_t *vtable;
    void *ext;
    struct us_socket_t *head_sockets;
    struct us_connecting_socket_t *head_connecting_sockets;
    struct us_listen_socket_t *head_listen_sockets;
    struct us_socket_t *iterator;
    struct us_socket_group_t *prev, *next;
    uint32_t global_tick;
    /* Sockets currently parked in loop->data.low_prio_head with s->group == this.
     * They are NOT in head_sockets while queued, so close_all/deinit must
     * account for them separately. */
    uint16_t low_prio_count;
    unsigned char timestamp;
    unsigned char long_timestamp;
    unsigned char linked;
};

/* Initialise an embedded group. Does NOT link into the loop — that happens
 * lazily on first socket add. Idempotent. vtable/ext may be NULL (Zig kinds
 * use neither). */
void us_socket_group_init(us_socket_group_r group, us_loop_r loop,
    const struct us_socket_vtable_t *vtable, void *ext) __attribute__((nonnull(1, 2)));

/* Unlinks from loop and asserts the socket list is empty. The owner is about
 * to free the embedding storage. */
void us_socket_group_deinit(us_socket_group_r group) nonnull_fn_decl;

/* Close every socket in the group (fires on_close for each). Used by server
 * shutdown. The group itself stays valid. */
void us_socket_group_close_all(us_socket_group_r group) nonnull_fn_decl;

unsigned short us_socket_group_timestamp(us_socket_group_r group) nonnull_fn_decl;
struct us_loop_t *us_socket_group_loop(us_socket_group_r group) nonnull_fn_decl __attribute((returns_nonnull));
void *us_socket_group_ext(us_socket_group_r group) nonnull_fn_decl;
struct us_socket_group_t *us_socket_group_next(us_socket_group_r group) nonnull_fn_decl;

/* Move an open socket between groups / kinds, optionally resizing its ext.
 * Replaces us_socket_context_adopt_socket + us_create_child_socket_context.
 * Returns the (possibly relocated) socket. */
struct us_socket_t *us_socket_adopt(us_socket_r s, us_socket_group_r group,
    unsigned char kind, int old_ext_size, int ext_size) nonnull_fn_decl;

/* Same, but also attaches a fresh SSL* built from ssl_ctx (which is up_ref'd
 * for the lifetime of the socket). Used for STARTTLS / Bun.connect upgrade.
 * sni may be NULL. */
struct us_socket_t *us_socket_adopt_tls(us_socket_r s, us_socket_group_r group,
    unsigned char kind, void /* SSL_CTX */ *ssl_ctx, const char *sni,
    int old_ext_size, int ext_size) __attribute__((nonnull(1, 2, 4)));
/* Send ClientHello after adopt_tls. Separate so the caller can repoint the
 * ext slot before any dispatch can fire. */
void us_socket_start_tls_handshake(us_socket_r s) nonnull_fn_decl;

/* ── Listen ───────────────────────────────────────────────────────────────
 * The listener owns: an embedded group for accepted sockets, the SSL_CTX
 * (borrowed ref, optional), the SNI tree (optional), and the kind to stamp on
 * accepted sockets. */
struct us_listen_socket_t *us_socket_group_listen(us_socket_group_r group,
    unsigned char kind, void /* SSL_CTX */ *ssl_ctx,
    const char *host, int port, int options, int socket_ext_size, int *error)
    __attribute__((nonnull(1, 8)));  /* ssl_ctx, host nullable */
struct us_listen_socket_t *us_socket_group_listen_unix(us_socket_group_r group,
    unsigned char kind, void /* SSL_CTX */ *ssl_ctx,
    const char *path, size_t pathlen, int options, int socket_ext_size, int *error)
    __attribute__((nonnull(1, 4, 8)));  /* ssl_ctx nullable */
void us_listen_socket_close(struct us_listen_socket_t *ls) nonnull_fn_decl;

/* SNI: tree hangs off the listen socket. ssl_ctx is up_ref'd; user is opaque
 * (uWS stores a per-domain HttpRouter*). user may be NULL. */
int us_listen_socket_add_server_name(struct us_listen_socket_t *ls,
    const char *hostname_pattern, void /* SSL_CTX */ *ssl_ctx, void *user)
    __attribute__((nonnull(1, 2, 3)));
void us_listen_socket_remove_server_name(struct us_listen_socket_t *ls,
    const char *hostname_pattern) nonnull_fn_decl;
void *us_listen_socket_find_server_name_userdata(struct us_listen_socket_t *ls,
    const char *hostname_pattern) nonnull_fn_decl;
void us_listen_socket_on_server_name(struct us_listen_socket_t *ls,
    void (*cb)(struct us_listen_socket_t *, const char *hostname)) nonnull_fn_decl;
void *us_socket_server_name_userdata(us_socket_r s);

/* ── Connect ──────────────────────────────────────────────────────────────
 * Returns either us_socket_t* (fast path, *is_connecting=1) or
 * us_connecting_socket_t* (DNS / happy-eyeballs in flight, *is_connecting=0).
 * ssl_ctx may be NULL for plain TCP. */
void *us_socket_group_connect(us_socket_group_r group, unsigned char kind,
    void /* SSL_CTX */ *ssl_ctx, const char *host, int port, int options,
    int socket_ext_size, int *is_connecting)
    __attribute__((nonnull(1, 4, 8)));  /* ssl_ctx nullable */
struct us_socket_t *us_socket_group_connect_unix(us_socket_group_r group,
    unsigned char kind, void /* SSL_CTX */ *ssl_ctx,
    const char *server_path, size_t pathlen, int options, int socket_ext_size)
    __attribute__((nonnull(1, 4)));  /* ssl_ctx nullable */

int us_socket_is_established(us_socket_r s) nonnull_fn_decl;
void us_connecting_socket_free(struct us_connecting_socket_t *c) nonnull_fn_decl;
void us_connecting_socket_close(struct us_connecting_socket_t *c) nonnull_fn_decl;
void us_connecting_socket_timeout(struct us_connecting_socket_t *c, unsigned int seconds) nonnull_fn_decl;
void us_connecting_socket_long_timeout(struct us_connecting_socket_t *c, unsigned int minutes) nonnull_fn_decl;
void us_connecting_socket_shutdown(struct us_connecting_socket_t *c) nonnull_fn_decl;
void us_connecting_socket_shutdown_read(struct us_connecting_socket_t *c) nonnull_fn_decl;
int us_connecting_socket_is_shut_down(struct us_connecting_socket_t *c) nonnull_fn_decl;
int us_connecting_socket_is_closed(struct us_connecting_socket_t *c) nonnull_fn_decl;
int us_connecting_socket_get_error(struct us_connecting_socket_t *c) nonnull_fn_decl;
void *us_connecting_socket_get_native_handle(struct us_connecting_socket_t *c) nonnull_fn_decl;
struct us_loop_t *us_connecting_socket_get_loop(struct us_connecting_socket_t *c) nonnull_fn_decl;
struct us_socket_group_t *us_connecting_socket_group(struct us_connecting_socket_t *c) nonnull_fn_decl;
unsigned char us_connecting_socket_kind(struct us_connecting_socket_t *c) nonnull_fn_decl;

struct us_bun_verify_error_t us_socket_verify_error(struct us_socket_t *s);

/* ── SSL_CTX construction ─────────────────────────────────────────────────
 * The expensive bit (cert/key/CA parse, cipher list, DH params) is decoupled
 * from sockets entirely. Build once per SecureContext / config, share across
 * every connect/listen/upgrade. */

struct us_bun_socket_context_options_t {
    const char *key_file_name;
    const char *cert_file_name;
    const char *passphrase;
    const char *dh_params_file_name;
    const char *ca_file_name;
    const char *ssl_ciphers;
    int ssl_prefer_low_memory_usage;
    const char * const *key;
    unsigned int key_count;
    const char * const *cert;
    unsigned int cert_count;
    const char * const *ca;
    unsigned int ca_count;
    unsigned int secure_options;
    int reject_unauthorized;
    int request_cert;
    unsigned int client_renegotiation_limit;
    unsigned int client_renegotiation_window;
};

enum create_bun_socket_error_t {
    CREATE_BUN_SOCKET_ERROR_NONE = 0,
    CREATE_BUN_SOCKET_ERROR_LOAD_CA_FILE,
    CREATE_BUN_SOCKET_ERROR_INVALID_CA_FILE,
    CREATE_BUN_SOCKET_ERROR_INVALID_CA,
    CREATE_BUN_SOCKET_ERROR_INVALID_CIPHERS,
};

/* Build an SSL_CTX from options. Returns the BoringSSL SSL_CTX*; caller owns
 * one reference and releases with SSL_CTX_free() (no wrapper struct — the
 * SSL_CTX's own refcount is the refcount). The strdup'd passphrase is freed
 * inside this call once private-key load completes, so a plain SSL_CTX_free()
 * is sufficient on every path.
 *
 * Policy that BoringSSL doesn't natively store (client renegotiation limits)
 * is attached as SSL_CTX ex_data; verify mode (reject_unauthorized /
 * request_cert) is encoded via SSL_CTX_set_verify() and recoverable from the
 * SSL_CTX itself.
 *
 * All `void *ssl_ctx` parameters elsewhere in this header are raw `SSL_CTX*`. */
void /* SSL_CTX */ *us_ssl_ctx_from_options(
    struct us_bun_socket_context_options_t options, int is_client,
    enum create_bun_socket_error_t *err);
/* SSL_CTX_up_ref / SSL_CTX_free without an OpenSSL include — for C++ callers
 * (uWS App.h) that hold ssl_ctx as void*. */
void us_internal_ssl_ctx_up_ref(void *ssl_ctx);
void us_internal_ssl_ctx_unref(void *ssl_ctx);
long us_ssl_ctx_live_count(void);

/* Public interfaces for loops */

/* Returns a new event loop with user data extension */
struct us_loop_t *us_create_loop(void *hint, void (*wakeup_cb)(us_loop_r loop),
    void (*pre_cb)(us_loop_r loop), void (*post_cb)(us_loop_r loop), unsigned int ext_size);

/* Frees the loop immediately */
void us_loop_free(us_loop_r loop) nonnull_fn_decl;

/* Returns the loop user data extension */
void *us_loop_ext(us_loop_r loop) nonnull_fn_decl;

/* Blocks the calling thread and drives the event loop until no more non-fallthrough polls are scheduled */
void us_loop_run(us_loop_r loop) nonnull_fn_decl;


/* Signals the loop from any thread to wake up and execute its wakeup handler from the loop's own running thread.
 * This is the only fully thread-safe function and serves as the basis for thread safety */
void us_wakeup_loop(us_loop_r loop) nonnull_fn_decl;

/* Hook up timers in existing loop */
void us_loop_integrate(us_loop_r loop) nonnull_fn_decl;

/* Returns the loop iteration number */
long long us_loop_iteration_number(us_loop_r loop) nonnull_fn_decl;

/* Public interfaces for polls */

/* A fallthrough poll does not keep the loop running, it falls through */
struct us_poll_t *us_create_poll(us_loop_r loop, int fallthrough, unsigned int ext_size);

/* After stopping a poll you must manually free the memory */
void us_poll_free(us_poll_r p, struct us_loop_t *loop);

/* Associate this poll with a socket descriptor and poll type */
void us_poll_init(us_poll_r p, LIBUS_SOCKET_DESCRIPTOR fd, int poll_type);

/* Start, change and stop polling for events */
void us_poll_start(us_poll_r p, us_loop_r loop, int events) nonnull_fn_decl;
/* Returns 0 if successful */
int us_poll_start_rc(us_poll_r p, us_loop_r loop, int events) nonnull_fn_decl;
void us_poll_change(us_poll_r p, us_loop_r loop, int events) nonnull_fn_decl;
void us_poll_stop(us_poll_r p, struct us_loop_t *loop) nonnull_fn_decl;

/* Return what events we are polling for */
int us_poll_events(us_poll_r p) nonnull_fn_decl;

/* Returns the user data extension of this poll */
void *us_poll_ext(us_poll_r p) nonnull_fn_decl;

/* Get associated socket descriptor from a poll */
LIBUS_SOCKET_DESCRIPTOR us_poll_fd(us_poll_r p) nonnull_fn_decl;

/* Resize an active poll */
struct us_poll_t *us_poll_resize(us_poll_r p, us_loop_r loop, unsigned int old_ext_size, unsigned int ext_size) nonnull_fn_decl;

/* ── Public interfaces for sockets ────────────────────────────────────────
 * No `int ssl` selector — TLS is per-socket (`s->ssl != NULL`). */

/* SSL* if TLS, else (void*)(intptr_t)fd. */
void *us_socket_get_native_handle(us_socket_r s) nonnull_fn_decl;

/* Plaintext write (TLS-encrypts if `s->ssl`). Returns bytes accepted; on
 * partial write the next on_writable will fire. */
int us_socket_write(us_socket_r s, const char *nonnull_arg data, int length) nonnull_fn_decl;
int us_socket_write2(us_socket_r s, const char *header, int header_length, const char *payload, int payload_length) nonnull_fn_decl;
/* Bypass TLS — write raw bytes to the fd even if `s->ssl` is set. */
int us_socket_raw_write(us_socket_r s, const char *data, int length);

void us_socket_timeout(us_socket_r s, unsigned int seconds) nonnull_fn_decl;
void us_socket_long_timeout(us_socket_r s, unsigned int minutes) nonnull_fn_decl;

void *us_socket_ext(us_socket_r s) nonnull_fn_decl;
void *us_connecting_socket_ext(struct us_connecting_socket_t *c) nonnull_fn_decl;

struct us_socket_group_t *us_socket_group(us_socket_r s) nonnull_fn_decl __attribute__((returns_nonnull));
unsigned char us_socket_kind(us_socket_r s) nonnull_fn_decl;
void us_socket_set_kind(us_socket_r s, unsigned char kind) nonnull_fn_decl;
void us_socket_set_ssl_raw_tap(us_socket_r s, int enabled) nonnull_fn_decl;

void us_socket_flush(us_socket_r s) nonnull_fn_decl;
void us_socket_shutdown(us_socket_r s) nonnull_fn_decl;
void us_socket_shutdown_read(us_socket_r s) nonnull_fn_decl;
int us_socket_is_shut_down(us_socket_r s) nonnull_fn_decl;
int us_socket_is_closed(us_socket_r s) nonnull_fn_decl;
int us_socket_is_tls(us_socket_r s) nonnull_fn_decl;
int us_socket_is_ssl_handshake_finished(us_socket_r s) nonnull_fn_decl;
int us_socket_ssl_handshake_callback_has_fired(us_socket_r s) nonnull_fn_decl;

struct us_socket_t *us_socket_close(us_socket_r s, int code, void *reason) __attribute__((nonnull(1)));

int us_socket_local_port(us_socket_r s) nonnull_fn_decl;
int us_socket_remote_port(us_socket_r s) nonnull_fn_decl;
void us_socket_remote_address(us_socket_r s, char *nonnull_arg buf, int *nonnull_arg length) nonnull_fn_decl;
void us_socket_local_address(us_socket_r s, char *nonnull_arg buf, int *nonnull_arg length) nonnull_fn_decl;

struct us_socket_t *us_socket_detach(us_socket_r s) nonnull_fn_decl;
int us_socket_ipc_write_fd(us_socket_r s, const char *data, int length, int fd) nonnull_fn_decl;
void us_socket_sendfile_needs_more(us_socket_r s) nonnull_fn_decl;
void *us_listen_socket_ext(struct us_listen_socket_t *ls) nonnull_fn_decl;
LIBUS_SOCKET_DESCRIPTOR us_listen_socket_get_fd(struct us_listen_socket_t *ls) nonnull_fn_decl;
int us_listen_socket_port(struct us_listen_socket_t *ls) nonnull_fn_decl;
struct us_socket_group_t *us_listen_socket_group(struct us_listen_socket_t *ls) nonnull_fn_decl;
LIBUS_SOCKET_DESCRIPTOR us_socket_get_fd(us_socket_r s) nonnull_fn_decl;

/* Bun extras */
struct us_socket_t *us_socket_pair(us_socket_group_r group, unsigned char kind, int socket_ext_size, LIBUS_SOCKET_DESCRIPTOR *fds) nonnull_fn_decl;
struct us_socket_t *us_socket_from_fd(us_socket_group_r group, unsigned char kind, void /* SSL_CTX */ *ssl_ctx, int socket_ext_size, LIBUS_SOCKET_DESCRIPTOR fd, int ipc)
    __attribute__((nonnull(1)));  /* ssl_ctx nullable */
struct us_socket_t *us_socket_open(struct us_socket_t *s, int is_client, char *ip, int ip_length);
int us_raw_root_certs(struct us_cert_string_t **out);
unsigned int us_get_remote_address_info(char *buf, us_socket_r s, const char **dest, int *port, int *is_ipv6);
unsigned int us_get_local_address_info(char *buf, us_socket_r s, const char **dest, int *port, int *is_ipv6);
int us_socket_get_error(us_socket_r s);

void us_socket_ref(us_socket_r s);
void us_socket_unref(us_socket_r s);

void us_socket_nodelay(us_socket_r s, int enabled);
int us_socket_keepalive(us_socket_r s, int enabled, unsigned int delay);
void us_socket_resume(us_socket_r s);
void us_socket_pause(us_socket_r s);

#ifdef __cplusplus
}
#endif

/* Decide what eventing system to use by default */
#if !defined(LIBUS_USE_EPOLL) && !defined(LIBUS_USE_LIBUV) && !defined(LIBUS_USE_GCD) && !defined(LIBUS_USE_KQUEUE) && !defined(LIBUS_USE_ASIO)
#if defined(_WIN32)
#define LIBUS_USE_LIBUV
#elif defined(__APPLE__) || defined(__FreeBSD__)
#define LIBUS_USE_KQUEUE
#else
#define LIBUS_USE_EPOLL
#endif
#endif

#endif // LIBUSOCKETS_H
