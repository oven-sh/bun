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
    LIBUS_LISTEN_DEFAULT,
    /* We exclusively own this port, do not share it */
    LIBUS_LISTEN_EXCLUSIVE_PORT
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
//struct us_udp_socket_t *us_create_udp_socket(struct us_loop_t *loop, void (*read_cb)(struct us_udp_socket_t *), unsigned short port);

//struct us_udp_socket_t *us_create_udp_socket(struct us_loop_t *loop, void (*data_cb)(struct us_udp_socket_t *, struct us_udp_packet_buffer_t *, int), void (*drain_cb)(struct us_udp_socket_t *), char *host, unsigned short port);

struct us_udp_socket_t *us_create_udp_socket(struct us_loop_t *loop, void (*data_cb)(struct us_udp_socket_t *, void *, int), void (*drain_cb)(struct us_udp_socket_t *), void (*close_cb)(struct us_udp_socket_t *), const char *host, unsigned short port, void *user);

void us_udp_socket_close(struct us_udp_socket_t *s);

/* This one is ugly, should be ext! not user */
void *us_udp_socket_user(struct us_udp_socket_t *s);

/* Binds the UDP socket to an interface and port */
int us_udp_socket_bind(struct us_udp_socket_t *s, const char *hostname, unsigned int port);

/* Public interfaces for timers */

/* Create a new high precision, low performance timer. May fail and return null */
struct us_timer_t *us_create_timer(struct us_loop_t *loop, int fallthrough, unsigned int ext_size);

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
    long error;
    const char* code;
    const char* reason;
};

struct us_socket_events_t {
    struct us_socket_t *(*on_open)(struct us_socket_t *, int is_client, char *ip, int ip_length);
    struct us_socket_t *(*on_data)(struct us_socket_t *, char *data, int length);
    struct us_socket_t *(*on_writable)(struct us_socket_t *);
    struct us_socket_t *(*on_close)(struct us_socket_t *, int code, void *reason);
    //void (*on_timeout)(struct us_socket_context *);
    struct us_socket_t *(*on_timeout)(struct us_socket_t *);
    struct us_socket_t *(*on_long_timeout)(struct us_socket_t *);
    struct us_socket_t *(*on_end)(struct us_socket_t *);
    struct us_connecting_socket_t *(*on_connect_error)(struct us_connecting_socket_t *, int code);
    struct us_socket_t *(*on_connecting_socket_error)(struct us_socket_t *, int code);
    void (*on_handshake)(struct us_socket_t*, int success, struct us_bun_verify_error_t verify_error, void* custom_data);
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
unsigned short us_socket_context_timestamp(int ssl, struct us_socket_context_t *context);

/* Adds SNI domain and cert in asn1 format */
void us_socket_context_add_server_name(int ssl, struct us_socket_context_t *context, const char *hostname_pattern, struct us_socket_context_options_t options, void *user);
void us_bun_socket_context_add_server_name(int ssl, struct us_socket_context_t *context, const char *hostname_pattern, struct us_bun_socket_context_options_t options, void *user);
void us_socket_context_remove_server_name(int ssl, struct us_socket_context_t *context, const char *hostname_pattern);
void us_socket_context_on_server_name(int ssl, struct us_socket_context_t *context, void (*cb)(struct us_socket_context_t *, const char *hostname));
void *us_socket_server_name_userdata(int ssl, struct us_socket_t *s);
void *us_socket_context_find_server_name_userdata(int ssl, struct us_socket_context_t *context, const char *hostname_pattern);

/* Returns the underlying SSL native handle, such as SSL_CTX or nullptr */
void *us_socket_context_get_native_handle(int ssl, struct us_socket_context_t *context);

/* A socket context holds shared callbacks and user data extension for associated sockets */
struct us_socket_context_t *us_create_socket_context(int ssl, struct us_loop_t *loop,
    int ext_size, struct us_socket_context_options_t options);
struct us_socket_context_t *us_create_bun_socket_context(int ssl, struct us_loop_t *loop,
    int ext_size, struct us_bun_socket_context_options_t options);

/* Delete resources allocated at creation time. */
void us_socket_context_free(int ssl, struct us_socket_context_t *context);
struct us_bun_verify_error_t us_socket_verify_error(int ssl, struct us_socket_t *context);
/* Setters of various async callbacks */
void us_socket_context_on_open(int ssl, struct us_socket_context_t *context,
    struct us_socket_t *(*on_open)(struct us_socket_t *s, int is_client, char *ip, int ip_length));
void us_socket_context_on_close(int ssl, struct us_socket_context_t *context,
    struct us_socket_t *(*on_close)(struct us_socket_t *s, int code, void *reason));
void us_socket_context_on_data(int ssl, struct us_socket_context_t *context,
    struct us_socket_t *(*on_data)(struct us_socket_t *s, char *data, int length));
void us_socket_context_on_writable(int ssl, struct us_socket_context_t *context,
    struct us_socket_t *(*on_writable)(struct us_socket_t *s));
void us_socket_context_on_timeout(int ssl, struct us_socket_context_t *context,
    struct us_socket_t *(*on_timeout)(struct us_socket_t *s));
void us_socket_context_on_long_timeout(int ssl, struct us_socket_context_t *context,
    struct us_socket_t *(*on_timeout)(struct us_socket_t *s));
/* This one is only used for when a connecting socket fails in a late stage. */
void us_socket_context_on_connect_error(int ssl, struct us_socket_context_t *context,
    struct us_connecting_socket_t *(*on_connect_error)(struct us_connecting_socket_t *s, int code));
void us_socket_context_on_socket_connect_error(int ssl, struct us_socket_context_t *context,
    struct us_socket_t *(*on_connect_error)(struct us_socket_t *s, int code));

void us_socket_context_on_handshake(int ssl, struct us_socket_context_t *context, void (*on_handshake)(struct us_socket_t *, int success, struct us_bun_verify_error_t verify_error, void* custom_data), void* custom_data);

/* Emitted when a socket has been half-closed */
void us_socket_context_on_end(int ssl, struct us_socket_context_t *context, struct us_socket_t *(*on_end)(struct us_socket_t *s));

/* Returns user data extension for this socket context */
void *us_socket_context_ext(int ssl, struct us_socket_context_t *context);

/* Closes all open sockets, including listen sockets. Does not invalidate the socket context. */
void us_socket_context_close(int ssl, struct us_socket_context_t *context);

/* Listen for connections. Acts as the main driving cog in a server. Will call set async callbacks. */
struct us_listen_socket_t *us_socket_context_listen(int ssl, struct us_socket_context_t *context,
    const char *host, int port, int options, int socket_ext_size);

struct us_listen_socket_t *us_socket_context_listen_unix(int ssl, struct us_socket_context_t *context,
    const char *path, size_t pathlen, int options, int socket_ext_size);

/* listen_socket.c/.h */
void us_listen_socket_close(int ssl, struct us_listen_socket_t *ls);

/*
    Returns one of 
    - struct us_socket_t * - indicated by the value at on_connecting being set to 1
      This is the fast path where the DNS result is available immediately and only a single remote
      address is available
    - struct us_connecting_socket_t * - indicated by the value at on_connecting being set to 0
      This is the slow path where we must either go through DNS resolution or create multiple sockets
      per the happy eyeballs algorithm
*/
void *us_socket_context_connect(int ssl, struct us_socket_context_t *context,
    const char *host, int port, int options, int socket_ext_size, int *is_connecting);

struct us_socket_t *us_socket_context_connect_unix(int ssl, struct us_socket_context_t *context,
    const char *server_path, size_t pathlen, int options, int socket_ext_size);

/* Is this socket established? Can be used to check if a connecting socket has fired the on_open event yet.
 * Can also be used to determine if a socket is a listen_socket or not, but you probably know that already. */
int us_socket_is_established(int ssl, struct us_socket_t *s);

void us_connecting_socket_free(struct us_connecting_socket_t *c);

/* Cancel a connecting socket. Can be used together with us_socket_timeout to limit connection times.
 * Entirely destroys the socket - this function works like us_socket_close but does not trigger on_close event since
 * you never got the on_open event first. */
void us_connecting_socket_close(int ssl, struct us_connecting_socket_t *c);

/* Returns the loop for this socket context. */
struct us_loop_t *us_socket_context_loop(int ssl, struct us_socket_context_t *context);

/* Invalidates passed socket, returning a new resized socket which belongs to a different socket context.
 * Used mainly for "socket upgrades" such as when transitioning from HTTP to WebSocket. */
struct us_socket_t *us_socket_context_adopt_socket(int ssl, struct us_socket_context_t *context, struct us_socket_t *s, int ext_size);

/* Create a child socket context which acts much like its own socket context with its own callbacks yet still relies on the
 * parent socket context for some shared resources. Child socket contexts should be used together with socket adoptions and nothing else. */
struct us_socket_context_t *us_create_child_socket_context(int ssl, struct us_socket_context_t *context, int context_ext_size);

/* Public interfaces for loops */

/* Returns a new event loop with user data extension */
struct us_loop_t *us_create_loop(void *hint, void (*wakeup_cb)(struct us_loop_t *loop),
    void (*pre_cb)(struct us_loop_t *loop), void (*post_cb)(struct us_loop_t *loop), unsigned int ext_size);

/* Frees the loop immediately */
void us_loop_free(struct us_loop_t *loop);

/* Returns the loop user data extension */
void *us_loop_ext(struct us_loop_t *loop);

/* Blocks the calling thread and drives the event loop until no more non-fallthrough polls are scheduled */
void us_loop_run(struct us_loop_t *loop);


/* Signals the loop from any thread to wake up and execute its wakeup handler from the loop's own running thread.
 * This is the only fully thread-safe function and serves as the basis for thread safety */
void us_wakeup_loop(struct us_loop_t *loop);

/* Hook up timers in existing loop */
void us_loop_integrate(struct us_loop_t *loop);

/* Returns the loop iteration number */
long long us_loop_iteration_number(struct us_loop_t *loop);

/* Public interfaces for polls */

/* A fallthrough poll does not keep the loop running, it falls through */
struct us_poll_t *us_create_poll(struct us_loop_t *loop, int fallthrough, unsigned int ext_size);

/* After stopping a poll you must manually free the memory */
void us_poll_free(struct us_poll_t *p, struct us_loop_t *loop);

/* Associate this poll with a socket descriptor and poll type */
void us_poll_init(struct us_poll_t *p, LIBUS_SOCKET_DESCRIPTOR fd, int poll_type);

/* Start, change and stop polling for events */
void us_poll_start(struct us_poll_t *p, struct us_loop_t *loop, int events);
void us_poll_change(struct us_poll_t *p, struct us_loop_t *loop, int events);
void us_poll_stop(struct us_poll_t *p, struct us_loop_t *loop);

/* Return what events we are polling for */
int us_poll_events(struct us_poll_t *p);

/* Returns the user data extension of this poll */
void *us_poll_ext(struct us_poll_t *p);

/* Get associated socket descriptor from a poll */
LIBUS_SOCKET_DESCRIPTOR us_poll_fd(struct us_poll_t *p);

/* Resize an active poll */
struct us_poll_t *us_poll_resize(struct us_poll_t *p, struct us_loop_t *loop, unsigned int ext_size);

/* Public interfaces for sockets */

/* Returns the underlying native handle for a socket, such as SSL or file descriptor.
 * In the case of file descriptor, the value of pointer is fd. */
void *us_socket_get_native_handle(int ssl, struct us_socket_t *s);

/* Write up to length bytes of data. Returns actual bytes written.
 * Will call the on_writable callback of active socket context on failure to write everything off in one go.
 * Set hint msg_more if you have more immediate data to write. */
int us_socket_write(int ssl, struct us_socket_t *s, const char *data, int length, int msg_more);

/* Special path for non-SSL sockets. Used to send header and payload in one go. Works like us_socket_write. */
int us_socket_write2(int ssl, struct us_socket_t *s, const char *header, int header_length, const char *payload, int payload_length);

/* Set a low precision, high performance timer on a socket. A socket can only have one single active timer
 * at any given point in time. Will remove any such pre set timer */
void us_socket_timeout(int ssl, struct us_socket_t *s, unsigned int seconds);

/* Set a low precision, high performance timer on a socket. Suitable for per-minute precision. */
void us_socket_long_timeout(int ssl, struct us_socket_t *s, unsigned int minutes);

/* Return the user data extension of this socket */
void *us_socket_ext(int ssl, struct us_socket_t *s);
void *us_connecting_socket_ext(int ssl, struct us_connecting_socket_t *c);

/* Return the socket context of this socket */
struct us_socket_context_t *us_socket_context(int ssl, struct us_socket_t *s);

/* Withdraw any msg_more status and flush any pending data */
void us_socket_flush(int ssl, struct us_socket_t *s);

/* Shuts down the connection by sending FIN and/or close_notify */
void us_socket_shutdown(int ssl, struct us_socket_t *s);

/* Shuts down the connection in terms of read, meaning next event loop
 * iteration will catch the socket being closed. Can be used to defer closing
 * to next event loop iteration. */
void us_socket_shutdown_read(int ssl, struct us_socket_t *s);

/* Returns whether the socket has been shut down or not */
int us_socket_is_shut_down(int ssl, struct us_socket_t *s);

/* Returns whether this socket has been closed. Only valid if memory has not yet been released. */
int us_socket_is_closed(int ssl, struct us_socket_t *s);

/* Immediately closes the socket */
struct us_socket_t *us_socket_close(int ssl, struct us_socket_t *s, int code, void *reason);

/* Returns local port or -1 on failure. */
int us_socket_local_port(int ssl, struct us_socket_t *s);

/* Copy remote (IP) address of socket, or fail with zero length. */
void us_socket_remote_address(int ssl, struct us_socket_t *s, char *buf, int *length);
void us_socket_local_address(int ssl, struct us_socket_t *s, char *buf, int *length);

/* Bun extras */
struct us_socket_t *us_socket_pair(struct us_socket_context_t *ctx, int socket_ext_size, LIBUS_SOCKET_DESCRIPTOR* fds);
struct us_socket_t *us_socket_from_fd(struct us_socket_context_t *ctx, int socket_ext_size, LIBUS_SOCKET_DESCRIPTOR fd);
struct us_socket_t *us_socket_attach(int ssl, LIBUS_SOCKET_DESCRIPTOR client_fd, struct us_socket_context_t *ctx, int flags, int socket_ext_size);
struct us_socket_t *us_socket_wrap_with_tls(int ssl, struct us_socket_t *s, struct us_bun_socket_context_options_t options, struct us_socket_events_t events, int socket_ext_size);
int us_socket_raw_write(int ssl, struct us_socket_t *s, const char *data, int length, int msg_more);
struct us_socket_t* us_socket_open(int ssl, struct us_socket_t * s, int is_client, char* ip, int ip_length);
int us_raw_root_certs(struct us_cert_string_t**out);
unsigned int us_get_remote_address_info(char *buf, struct us_socket_t *s, const char **dest, int *port, int *is_ipv6);
int us_socket_get_error(int ssl, struct us_socket_t *s);

void us_socket_ref(struct us_socket_t *s);
void us_socket_unref(struct us_socket_t *s);

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
