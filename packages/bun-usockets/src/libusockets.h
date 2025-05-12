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
#define us_socket_context_r struct us_socket_context_t *nonnull_arg


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

#include "stddef.h"

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
};

/* Library types publicly available */
struct us_socket_t;
struct us_connecting_socket_t;
struct us_timer_t;
struct us_socket_context_t;
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

struct us_udp_socket_t *us_create_udp_socket(us_loop_r loop, void (*data_cb)(struct us_udp_socket_t *, void *, int), void (*drain_cb)(struct us_udp_socket_t *), void (*close_cb)(struct us_udp_socket_t *), const char *host, unsigned short port, int flags, int *err, void *user);

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

/* Public interfaces for contexts */

struct us_socket_context_options_t {
    const char *key_file_name;
    const char *cert_file_name;
    const char *passphrase;
    const char *dh_params_file_name;
    const char *ca_file_name;
    const char *ssl_ciphers;
    int ssl_prefer_low_memory_usage; /* Todo: rename to prefer_low_memory_usage and apply for TCP as well */
};

struct us_bun_verify_error_t {
    int error;
    const char* code;
    const char* reason;
};

struct us_socket_events_t {
    struct us_socket_t *(*on_open)(us_socket_r, int is_client, char *ip, int ip_length);
    struct us_socket_t *(*on_data)(us_socket_r, char *data, int length);
    struct us_socket_t *(*on_writable)(us_socket_r);
    struct us_socket_t *(*on_close)(us_socket_r, int code, void *reason);
    //void (*on_timeout)(struct us_socket_context *);
    struct us_socket_t *(*on_timeout)(us_socket_r);
    struct us_socket_t *(*on_long_timeout)(us_socket_r);
    struct us_socket_t *(*on_end)(us_socket_r);
    struct us_connecting_socket_t *(*on_connect_error)(struct us_connecting_socket_t *, int code);
    struct us_socket_t *(*on_connecting_socket_error)(us_socket_r, int code);
    void (*on_handshake)(us_socket_r, int success, struct us_bun_verify_error_t verify_error, void* custom_data);
};


struct us_bun_socket_context_options_t {
    const char *key_file_name;
    const char *cert_file_name;
    const char *passphrase;
    const char *dh_params_file_name;
    const char *ca_file_name;
    const char *ssl_ciphers;
    int ssl_prefer_low_memory_usage; /* Todo: rename to prefer_low_memory_usage and apply for TCP as well */
    const char **key;
    unsigned int key_count;
    const char **cert;
    unsigned int cert_count;
    const char **ca;
    unsigned int ca_count;
    unsigned int secure_options;
    int reject_unauthorized;
    int request_cert;
    unsigned int client_renegotiation_limit;
    unsigned int client_renegotiation_window;
};

/* Return 15-bit timestamp for this context */
unsigned short us_socket_context_timestamp(int ssl, us_socket_context_r context) nonnull_fn_decl;

/* Adds SNI domain and cert in asn1 format */
void us_socket_context_add_server_name(int ssl, us_socket_context_r context, const char *hostname_pattern, struct us_socket_context_options_t options, void *user);
int us_bun_socket_context_add_server_name(int ssl, us_socket_context_r context, const char *hostname_pattern, struct us_bun_socket_context_options_t options, void *user);
void us_socket_context_remove_server_name(int ssl, us_socket_context_r context, const char *hostname_pattern);
void us_socket_context_on_server_name(int ssl, us_socket_context_r context, void (*cb)(us_socket_context_r context, const char *hostname));
void *us_socket_server_name_userdata(int ssl, us_socket_r s);
void *us_socket_context_find_server_name_userdata(int ssl, us_socket_context_r context, const char *hostname_pattern);

/* Returns the underlying SSL native handle, such as SSL_CTX or nullptr */
void *us_socket_context_get_native_handle(int ssl, us_socket_context_r context);

/* A socket context holds shared callbacks and user data extension for associated sockets */
struct us_socket_context_t *us_create_socket_context(int ssl, us_loop_r loop,
    int ext_size, struct us_socket_context_options_t options) nonnull_fn_decl;

enum create_bun_socket_error_t {
  CREATE_BUN_SOCKET_ERROR_NONE = 0,
  CREATE_BUN_SOCKET_ERROR_LOAD_CA_FILE,
  CREATE_BUN_SOCKET_ERROR_INVALID_CA_FILE,
  CREATE_BUN_SOCKET_ERROR_INVALID_CA,
};

struct us_socket_context_t *us_create_bun_ssl_socket_context(struct us_loop_t *loop,
    int ext_size, struct us_bun_socket_context_options_t options, enum create_bun_socket_error_t *err);
struct us_socket_context_t *us_create_bun_nossl_socket_context(struct us_loop_t *loop,
    int ext_size);

/* Delete resources allocated at creation time (will call unref now and only free when ref count == 0). */
void us_socket_context_free(int ssl, us_socket_context_r context) nonnull_fn_decl;
void us_socket_context_ref(int ssl, us_socket_context_r context) nonnull_fn_decl;
void us_socket_context_unref(int ssl, us_socket_context_r context) nonnull_fn_decl;

struct us_bun_verify_error_t us_socket_verify_error(int ssl, struct us_socket_t *context);
/* Setters of various async callbacks */
void us_socket_context_on_open(int ssl, us_socket_context_r context,
    struct us_socket_t *(*on_open)(us_socket_r s, int is_client, char *ip, int ip_length));
void us_socket_context_on_close(int ssl, us_socket_context_r context,
    struct us_socket_t *(*on_close)(us_socket_r s, int code, void *reason));
void us_socket_context_on_data(int ssl, us_socket_context_r context,
    struct us_socket_t *(*on_data)(us_socket_r s, char *data, int length));
void us_socket_context_on_fd(int ssl, us_socket_context_r context,
    struct us_socket_t *(*on_fd)(us_socket_r s, int fd));
void us_socket_context_on_writable(int ssl, us_socket_context_r context,
    struct us_socket_t *(*on_writable)(us_socket_r s));
void us_socket_context_on_timeout(int ssl, us_socket_context_r context,
    struct us_socket_t *(*on_timeout)(us_socket_r s));
void us_socket_context_on_long_timeout(int ssl, us_socket_context_r context,
    struct us_socket_t *(*on_timeout)(us_socket_r s));
/* This one is only used for when a connecting socket fails in a late stage. */
void us_socket_context_on_connect_error(int ssl, us_socket_context_r context,
    struct us_connecting_socket_t *(*on_connect_error)(struct us_connecting_socket_t *s, int code));
void us_socket_context_on_socket_connect_error(int ssl, us_socket_context_r context,
    struct us_socket_t *(*on_connect_error)(us_socket_r s, int code));

void us_socket_context_on_handshake(int ssl, us_socket_context_r context, void (*on_handshake)(struct us_socket_t *, int success, struct us_bun_verify_error_t verify_error, void* custom_data), void* custom_data);

/* Emitted when a socket has been half-closed */
void us_socket_context_on_end(int ssl, us_socket_context_r context, struct us_socket_t *(*on_end)(us_socket_r s));

/* Returns user data extension for this socket context */
void *us_socket_context_ext(int ssl, us_socket_context_r context);

/* Closes all open sockets, including listen sockets. Does not invalidate the socket context. */
void us_socket_context_close(int ssl, us_socket_context_r context);

/* Listen for connections. Acts as the main driving cog in a server. Will call set async callbacks. */
struct us_listen_socket_t *us_socket_context_listen(int ssl, us_socket_context_r context,
    const char *host, int port, int options, int socket_ext_size, int* error);

struct us_listen_socket_t *us_socket_context_listen_unix(int ssl, us_socket_context_r context,
    const char *path, size_t pathlen, int options, int socket_ext_size, int* error);

/* listen_socket.c/.h */
void us_listen_socket_close(int ssl, struct us_listen_socket_t *ls) nonnull_fn_decl;

/*
    Returns one of
    - struct us_socket_t * - indicated by the value at on_connecting being set to 1
      This is the fast path where the DNS result is available immediately and only a single remote
      address is available
    - struct us_connecting_socket_t * - indicated by the value at on_connecting being set to 0
      This is the slow path where we must either go through DNS resolution or create multiple sockets
      per the happy eyeballs algorithm
*/
void *us_socket_context_connect(int ssl, struct us_socket_context_t * nonnull_arg context,
    const char *host, int port, int options, int socket_ext_size, int *is_connecting) __attribute__((nonnull(2)));

struct us_socket_t *us_socket_context_connect_unix(int ssl, us_socket_context_r context,
    const char *server_path, size_t pathlen, int options, int socket_ext_size) __attribute__((nonnull(2)));

/* Is this socket established? Can be used to check if a connecting socket has fired the on_open event yet.
 * Can also be used to determine if a socket is a listen_socket or not, but you probably know that already. */
int us_socket_is_established(int ssl, us_socket_r s) nonnull_fn_decl;

void us_connecting_socket_free(int ssl, struct us_connecting_socket_t *c) nonnull_fn_decl;

/* Cancel a connecting socket. Can be used together with us_socket_timeout to limit connection times.
 * Entirely destroys the socket - this function works like us_socket_close but does not trigger on_close event since
 * you never got the on_open event first. */
void us_connecting_socket_close(int ssl, struct us_connecting_socket_t *c) nonnull_fn_decl;

/* Returns the loop for this socket context. */
struct us_loop_t *us_socket_context_loop(int ssl, us_socket_context_r context) nonnull_fn_decl __attribute((returns_nonnull));

/* Invalidates passed socket, returning a new resized socket which belongs to a different socket context.
 * Used mainly for "socket upgrades" such as when transitioning from HTTP to WebSocket. */
struct us_socket_t *us_socket_context_adopt_socket(int ssl, us_socket_context_r context, us_socket_r s, int ext_size);

struct us_socket_t *us_socket_upgrade_to_tls(us_socket_r s, us_socket_context_r new_context, const char *sni);

/* Create a child socket context which acts much like its own socket context with its own callbacks yet still relies on the
 * parent socket context for some shared resources. Child socket contexts should be used together with socket adoptions and nothing else. */
struct us_socket_context_t *us_create_child_socket_context(int ssl, us_socket_context_r context, int context_ext_size);

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
struct us_poll_t *us_poll_resize(us_poll_r p, us_loop_r loop, unsigned int ext_size) nonnull_fn_decl;

/* Public interfaces for sockets */

/* Returns the underlying native handle for a socket, such as SSL or file descriptor.
 * In the case of file descriptor, the value of pointer is fd. */
void *us_socket_get_native_handle(int ssl, us_socket_r s) nonnull_fn_decl;

/* Write up to length bytes of data. Returns actual bytes written.
 * Will call the on_writable callback of active socket context on failure to write everything off in one go.
 * Set hint msg_more if you have more immediate data to write. */
int us_socket_write(int ssl, us_socket_r s, const char * nonnull_arg data, int length, int msg_more) nonnull_fn_decl;

/* Special path for non-SSL sockets. Used to send header and payload in one go. Works like us_socket_write. */
int us_socket_write2(int ssl, us_socket_r s, const char *header, int header_length, const char *payload, int payload_length) nonnull_fn_decl;

/* Set a low precision, high performance timer on a socket. A socket can only have one single active timer
 * at any given point in time. Will remove any such pre set timer */
void us_socket_timeout(int ssl, us_socket_r s, unsigned int seconds) nonnull_fn_decl;

/* Set a low precision, high performance timer on a socket. Suitable for per-minute precision. */
void us_socket_long_timeout(int ssl, us_socket_r s, unsigned int minutes) nonnull_fn_decl;

/* Return the user data extension of this socket */
void *us_socket_ext(int ssl, us_socket_r s) nonnull_fn_decl;
void *us_connecting_socket_ext(int ssl, struct us_connecting_socket_t *c) nonnull_fn_decl;

/* Return the socket context of this socket */
struct us_socket_context_t *us_socket_context(int ssl, us_socket_r s) nonnull_fn_decl __attribute__((returns_nonnull));

/* Withdraw any msg_more status and flush any pending data */
void us_socket_flush(int ssl, us_socket_r s) nonnull_fn_decl;

/* Shuts down the connection by sending FIN and/or close_notify */
void us_socket_shutdown(int ssl, us_socket_r s) nonnull_fn_decl;

/* Shuts down the connection in terms of read, meaning next event loop
 * iteration will catch the socket being closed. Can be used to defer closing
 * to next event loop iteration. */
void us_socket_shutdown_read(int ssl, us_socket_r s) nonnull_fn_decl;

/* Returns whether the socket has been shut down or not */
int us_socket_is_shut_down(int ssl, us_socket_r s) nonnull_fn_decl;

/* Returns whether this socket has been closed. Only valid if memory has not yet been released. */
int us_socket_is_closed(int ssl, us_socket_r s) nonnull_fn_decl;

/* Immediately closes the socket */
struct us_socket_t *us_socket_close(int ssl, us_socket_r s, int code, void *reason) __attribute__((nonnull(2)));

/* Returns local port or -1 on failure. */
int us_socket_local_port(int ssl, us_socket_r s) nonnull_fn_decl;

/* Copy remote (IP) address of socket, or fail with zero length. */
void us_socket_remote_address(int ssl, us_socket_r s, char *nonnull_arg buf, int *nonnull_arg length) nonnull_fn_decl;
void us_socket_local_address(int ssl, us_socket_r s, char *nonnull_arg buf, int *nonnull_arg length) nonnull_fn_decl;

/* Bun extras */
struct us_socket_t *us_socket_pair(struct us_socket_context_t *ctx, int socket_ext_size, LIBUS_SOCKET_DESCRIPTOR* fds);
struct us_socket_t *us_socket_from_fd(struct us_socket_context_t *ctx, int socket_ext_size, LIBUS_SOCKET_DESCRIPTOR fd, int ipc);
struct us_socket_t *us_socket_wrap_with_tls(int ssl, us_socket_r s, struct us_bun_socket_context_options_t options, struct us_socket_events_t events, int socket_ext_size);
int us_socket_raw_write(int ssl, us_socket_r s, const char *data, int length, int msg_more);
struct us_socket_t* us_socket_open(int ssl, struct us_socket_t * s, int is_client, char* ip, int ip_length);
int us_raw_root_certs(struct us_cert_string_t**out);
unsigned int us_get_remote_address_info(char *buf, us_socket_r s, const char **dest, int *port, int *is_ipv6);
unsigned int us_get_local_address_info(char *buf, us_socket_r s, const char **dest, int *port, int *is_ipv6);
int us_socket_get_error(int ssl, us_socket_r s);

void us_socket_ref(us_socket_r s);
void us_socket_unref(us_socket_r s);

void us_socket_nodelay(us_socket_r s, int enabled);
int us_socket_keepalive(us_socket_r s, int enabled, unsigned int delay);
void us_socket_resume(int ssl, us_socket_r s);
void us_socket_pause(int ssl, us_socket_r s);

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
