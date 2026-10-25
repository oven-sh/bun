/*
 * QUIC / HTTP/3 transport for usockets, backed by lsquic.
 *
 * One us_quic_socket_context_t per server (driver + SSL).
 * No global state — multiple contexts can coexist on the same loop.
 *
 * The header-set API is per-stream: incoming headers are owned by the stream
 * and live until on_stream_close fires; outgoing headers are buffered by the
 * C++ layer and flushed in one us_quic_stream_send_headers() call.
 */
#ifndef US_QUIC_H
#define US_QUIC_H

#define LIBUS_USE_QUIC 1

#include "libusockets.h"

#ifdef __cplusplus
extern "C" {
#endif

struct us_quic_driver_s;
struct us_quic_udp_s;
struct us_quic_socket_context_s;
struct us_quic_socket_s;
struct us_quic_stream_s;

typedef struct us_quic_driver_s us_quic_driver_t;
typedef struct us_quic_udp_s us_quic_udp_t;
typedef struct us_quic_socket_context_s us_quic_socket_context_t;
typedef struct us_quic_socket_s us_quic_socket_t;
typedef struct us_quic_stream_s us_quic_stream_t;

struct sockaddr;
struct lsquic_engine;
struct lsquic_engine_settings;
struct lsquic_stream_if;
struct lsquic_hset_if;
struct lsquic_conn;
struct lsquic_stream;
struct lsquic_http_headers;

/* ───── Driver: what every lsquic engine in Bun runs on (the HTTP/3 contexts below, and node:quic) ───── */

/* Before `loop` polls, after it has dispatched what the poll returned, and after a microtask drain. */
enum us_quic_pass_point { US_QUIC_BEFORE_POLL, US_QUIC_AFTER_POLL, US_QUIC_AFTER_MICROTASKS };

/* Runs the owner's engines if they have work. Returns the µs until they want the next pass, or -1. It may free the driver. */
typedef int (*us_quic_pass_fn)(us_quic_driver_t *d, enum us_quic_pass_point point);

/* `pass` runs at each point, but after a microtask drain only if the driver is pending. */
us_quic_driver_t *us_quic_driver_create(struct us_loop_t *loop, us_quic_pass_fn pass, void *owner);
/* Closes the driver's UDP sockets and destroys its engines. `pass` keeps running. */
void us_quic_driver_close(us_quic_driver_t *d);
void us_quic_driver_free(us_quic_driver_t *d);
void *us_quic_driver_owner(us_quic_driver_t *d);
/* `flags` are LSENG_*. lsquic copies `settings`. The driver owns the engine. */
struct lsquic_engine *us_quic_driver_add_engine(us_quic_driver_t *d, unsigned flags,
    const struct lsquic_engine_settings *settings,
    const struct lsquic_stream_if *stream_if, void *stream_if_ctx,
    const struct lsquic_hset_if *hset_if, void *hset_ctx,
    struct ssl_ctx_st *(*lookup_cert)(void *, const struct sockaddr *, const char *), void *lookup_cert_ctx);
/* lsquic_engine_process_conns on every engine. Does nothing while an engine is on the stack. */
void us_quic_driver_process(us_quic_driver_t *d);
/* The soonest lsquic_engine_earliest_adv_tick in µs from now, or -1. */
int us_quic_driver_next_tick_us(us_quic_driver_t *d);
/* The owner queued work in an engine. us_quic_driver_process clears it. */
void us_quic_driver_set_pending(us_quic_driver_t *d);
int us_quic_driver_is_pending(us_quic_driver_t *d);
/* What a server engine starts a handshake with, before SNI. Borrowed. */
void us_quic_driver_set_ssl_ctx(us_quic_driver_t *d, struct ssl_ctx_st *ssl_ctx);

/* A UDP socket for the driver's engines, and the `peer_ctx` of every lsquic_engine_packet_in call for it. Its user data is the us_quic_udp_t. */
us_quic_udp_t *us_quic_udp_create(us_quic_driver_t *d, const char *host, int port, int flags, int *err,
    void (*on_data)(struct us_udp_socket_t *, void *, int),
    void (*on_recv_error)(struct us_udp_socket_t *, int, int));
void *us_quic_udp_owner(us_quic_udp_t *qu);
/* NULL once the fd has closed. */
struct us_udp_socket_t *us_quic_udp_socket(us_quic_udp_t *qu);
/* The bound address, which is the `sa_local` of every lsquic_engine_packet_in call for this socket. */
const struct sockaddr *us_quic_udp_local(us_quic_udp_t *qu);
/* Adds every datagram this socket sends to the two counters, which must outlive the driver's engines. */
void us_quic_udp_count_sent(us_quic_udp_t *qu, uint64_t *packets, uint64_t *bytes);
/* lsquic_engine_connect from this socket. `ssl_ctx` is borrowed. */
struct lsquic_conn *us_quic_udp_connect(us_quic_udp_t *qu, struct lsquic_engine *engine, const struct sockaddr *peer,
    struct ssl_ctx_st *ssl_ctx, void *conn_ctx, const char *sni, const unsigned char *session_resume, size_t session_resume_len);

/* lsquic_stream_send_headers. lsquic holds one outgoing header block per stream
 * and refuses the next one while an earlier block is still unsent. Nothing was
 * queued: send the same block again from the stream's write event. 0 is sent,
 * -1 is a hard failure. */
#define US_QUIC_SEND_HEADERS_RETRY 1
int us_quic_send_header_block(struct lsquic_stream *s, const struct lsquic_http_headers *headers, int end_stream);

/* ───── HTTP/3 contexts ───── */

/* One name/value pair pointing into stream-owned storage. `qpack_index` is
 * an optional `enum lsqpack_tnv` hint (0..98) the caller may set on outgoing
 * headers so the QPACK encoder can skip its name-hash lookup; -1 = no hint.
 * Always -1 on incoming headers. */
struct us_quic_header_t {
    const char *name;
    unsigned int name_len;
    const char *value;
    unsigned int value_len;
    int qpack_index;
};

us_quic_socket_context_t *us_create_quic_socket_context(
    struct us_loop_t *loop, struct us_bun_socket_context_options_t options,
    unsigned int ext_size, unsigned int idle_timeout_s);

/* Send GOAWAY on every connection and stop accepting new ones; the engine and
 * timer keep running so in-flight streams drain. The UDP socket closes with
 * the last connection, and on_released reports it. */
void us_quic_socket_context_shutdown(us_quic_socket_context_t *ctx);
/* 1 once the context has no open UDP socket and no connection left. */
int us_quic_socket_context_is_released(us_quic_socket_context_t *ctx);
void us_quic_socket_context_free(us_quic_socket_context_t *ctx);

/* Register an additional SSL_CTX for the given SNI hostname. Names match as on a TCP listener. */
int us_quic_socket_context_add_server_name(us_quic_socket_context_t *ctx,
    const char *hostname, struct us_bun_socket_context_options_t options);

void *us_quic_socket_context_ext(us_quic_socket_context_t *ctx);
struct us_loop_t *us_quic_socket_context_loop(us_quic_socket_context_t *ctx);

us_quic_udp_t *us_quic_socket_context_listen(
    us_quic_socket_context_t *ctx, const char *host, int port, int flags,
    unsigned int stream_ext_size);

void us_quic_listen_socket_close(us_quic_udp_t *ls);
int us_quic_listen_socket_port(us_quic_udp_t *ls);
int us_quic_listen_socket_local_address(us_quic_udp_t *ls, char *buf, int len);

/* Client engine: one shared lsquic engine for all outbound connections on
 * `loop`. Per-connection cert verification is decided at connect time. */
us_quic_socket_context_t *us_create_quic_client_context(
    struct us_loop_t *loop, unsigned int ext_size,
    unsigned int conn_ext_size, unsigned int stream_ext_size);

struct us_quic_pending_connect_s;
struct addrinfo_request;

/* Limits `ssl_ctx`, which us_ssl_ctx_build_raw made, to TLS 1.3 and installs the verify step that reads each connection's reject_unauthorized. */
void us_quic_prepare_client_ssl_ctx(struct ssl_ctx_st *ssl_ctx);

/* Open a QUIC connection to `host:port`. `host` may be an IP literal or
 * hostname; literals and DNS-cache hits connect synchronously (return 1,
 * *out_qs set). Uncached hostnames return 0 with *out_pending set — caller
 * registers a Bun__addrinfo callback and invokes
 * us_quic_pending_connect_resolved() once it fires. -1 on error. `sni` is
 * the TLS ServerNameIndication; `reject_unauthorized` is per-connection.
 * `ssl_ctx` (borrowed) went through us_quic_prepare_client_ssl_ctx, or is NULL for the default trust store and no client certificate. */
int us_quic_socket_context_connect(
    us_quic_socket_context_t *ctx, const char *host, int port, const char *sni,
    int reject_unauthorized, struct ssl_ctx_st *ssl_ctx,
    us_quic_socket_t **out_qs,
    struct us_quic_pending_connect_s **out_pending);

struct addrinfo_request *us_quic_pending_connect_addrinfo(
    struct us_quic_pending_connect_s *pc);
us_quic_socket_t *us_quic_pending_connect_resolved(
    struct us_quic_pending_connect_s *pc);
void us_quic_pending_connect_cancel(struct us_quic_pending_connect_s *pc);

/* Request a new bidirectional stream; on_stream_open(is_client=1) fires when
 * lsquic has a stream ID to hand out (immediately if under the peer's
 * MAX_STREAMS, otherwise once credit arrives). */
void us_quic_socket_make_stream(us_quic_socket_t *s);
unsigned us_quic_socket_streams_avail(us_quic_socket_t *s);
int us_quic_socket_status(us_quic_socket_t *s, char *buf, unsigned int len);

/* Connection-level callbacks */
/* Fires once the TLS handshake completes (client only). ok=0 means the
 * handshake failed; on_close follows shortly. */
void us_quic_socket_context_on_hsk_done(us_quic_socket_context_t *ctx,
    void (*on_hsk_done)(us_quic_socket_t *, int ok));
/* Peer sent GOAWAY: no new streams will be accepted; in-flight ones drain. */
void us_quic_socket_context_on_goaway(us_quic_socket_context_t *ctx,
    void (*on_goaway)(us_quic_socket_t *));
void us_quic_socket_context_on_close(us_quic_socket_context_t *ctx,
    void (*on_close)(us_quic_socket_t *));
/* us_quic_socket_context_is_released became true. Runs after the close(2), and
 * can run inside lsquic_engine_process_conns, so it must not enter the engine
 * or free the context. us_quic_socket_context_free doesn't report. A context
 * with this hook closes its connections if its last UDP socket goes first. */
void us_quic_socket_context_on_released(us_quic_socket_context_t *ctx,
    void (*on_released)(us_quic_socket_context_t *));

/* Stream-level callbacks */
void us_quic_socket_context_on_stream_open(us_quic_socket_context_t *ctx,
    void (*on_open)(us_quic_stream_t *, int is_client));
void us_quic_socket_context_on_stream_headers(us_quic_socket_context_t *ctx,
    void (*on_headers)(us_quic_stream_t *));
void us_quic_socket_context_on_stream_data(us_quic_socket_context_t *ctx,
    void (*on_data)(us_quic_stream_t *, const char *, unsigned int, int fin));
void us_quic_socket_context_on_stream_writable(us_quic_socket_context_t *ctx,
    void (*on_writable)(us_quic_stream_t *));
void us_quic_socket_context_on_stream_close(us_quic_socket_context_t *ctx,
    void (*on_close)(us_quic_stream_t *));

/* Stream I/O. Read happens via on_stream_data; write returns bytes accepted
 * (may be < len under flow-control backpressure). -1 isn't backpressure: the
 * send half is reset or finished, so no later write succeeds. */
int us_quic_stream_write(us_quic_stream_t *s, const char *data, unsigned int len);
/* Receive backpressure, see lsquic_stream_hold_window() in lsquic.h. */
void us_quic_stream_hold_window(us_quic_stream_t *s, int hold);
/* -1 when the send half is finished (a FIN or a RESET_STREAM is out): no on_stream_writable follows. */
int us_quic_stream_want_write(us_quic_stream_t *s);
/* Returns as us_quic_send_header_block does. The write event after
 * US_QUIC_SEND_HEADERS_RETRY (behind a 1xx) is on_stream_writable. */
int us_quic_stream_send_headers(us_quic_stream_t *s,
    const struct us_quic_header_t *headers, unsigned int count, int end_stream);
/* Send a 1xx interim HEADERS frame (`:status` only); the final response
 * header block follows separately. */
int us_quic_stream_send_informational(us_quic_stream_t *s, const char *status3);
void us_quic_stream_shutdown(us_quic_stream_t *s);
void us_quic_stream_shutdown_read(us_quic_stream_t *s);
void us_quic_stream_close(us_quic_stream_t *s);
void us_quic_stream_reset(us_quic_stream_t *s, uint64_t error_code);
/* RFC 9114 §8.1: a message this endpoint can't send or can't finish. */
#define US_QUIC_H3_INTERNAL_ERROR 0x102
/* RFC 9114 §8.1: the server did no application processing. */
#define US_QUIC_H3_REQUEST_REJECTED 0x10B
/* RFC 9114 §4.1.2: a malformed message. */
#define US_QUIC_H3_MESSAGE_ERROR 0x10E
/* The code of the last RESET_STREAM or STOP_SENDING on the stream, 0 without one.
 * on_stream_close can still read it. */
uint64_t us_quic_stream_reset_code(us_quic_stream_t *s);
/* The peer sent RESET_STREAM. on_stream_close can still read it. */
int us_quic_stream_reset_received(us_quic_stream_t *s);
/* The server did not process a request above the id in its GOAWAY (RFC 9114 §5.2).
 * The RFC says the same of the request at the id, but servers on stock lsquic name
 * the last request they accepted. on_stream_close can still read it. */
int us_quic_stream_refused_by_goaway(us_quic_stream_t *s);

void *us_quic_stream_ext(us_quic_stream_t *s);
us_quic_socket_t *us_quic_stream_socket(us_quic_stream_t *s);
us_quic_socket_context_t *us_quic_stream_context(us_quic_stream_t *s);

/* Runs every driver on `loop` and stores the soonest next tick. Called from us_internal_loop_pre and us_internal_loop_post. */
void us_quic_loop_process(struct us_loop_t *loop, enum us_quic_pass_point point);
/* Runs the drivers that are pending. Called after a microtask drain. */
void us_quic_loop_flush_if_pending(struct us_loop_t *loop);

/* Incoming headers — valid from on_stream_headers until on_stream_close. */
unsigned int us_quic_stream_header_count(us_quic_stream_t *s);
const struct us_quic_header_t *us_quic_stream_header(us_quic_stream_t *s, unsigned int i);
/* Fields a request may have, pseudo-headers included. */
#define US_QUIC_MAX_REQUEST_FIELDS 200
/* The header set exceeds the size or the field count this endpoint accepts and is incomplete. */
int us_quic_stream_headers_too_large(us_quic_stream_t *s);

/* Connection accessors */
void *us_quic_socket_ext(us_quic_socket_t *s);
void us_quic_socket_remote_address(us_quic_socket_t *s, char *buf, int *len, int *port, int *is_ipv6);
void us_quic_socket_close(us_quic_socket_t *s);

#ifdef __cplusplus
}
#endif

#endif /* US_QUIC_H */
