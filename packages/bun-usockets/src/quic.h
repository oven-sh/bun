/*
 * QUIC / HTTP/3 transport for usockets, backed by lsquic.
 *
 * One us_quic_socket_context_t per server (engine + UDP socket + timer + SSL).
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

struct us_quic_socket_context_s;
struct us_quic_listen_socket_s;
struct us_quic_socket_s;
struct us_quic_stream_s;

typedef struct us_quic_socket_context_s us_quic_socket_context_t;
typedef struct us_quic_listen_socket_s us_quic_listen_socket_t;
typedef struct us_quic_socket_s us_quic_socket_t;
typedef struct us_quic_stream_s us_quic_stream_t;

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

/* Process-wide lsquic init. Must be called once before the first
 * us_create_quic_socket_context; the C++ layer (uws_h3_create_app) does this
 * via a thread-safe static local so quic.c stays free of pthread/call_once. */
void us_quic_global_init(void);

us_quic_socket_context_t *us_create_quic_socket_context(
    struct us_loop_t *loop, struct us_bun_socket_context_options_t options,
    unsigned int ext_size, unsigned int idle_timeout_s);

/* Send GOAWAY on every connection and stop accepting new ones; the engine and
 * timer keep running so in-flight streams drain. */
void us_quic_socket_context_shutdown(us_quic_socket_context_t *ctx);
void us_quic_socket_context_free(us_quic_socket_context_t *ctx);

/* Register an additional SSL_CTX for the given SNI hostname (exact or `*.`). */
int us_quic_socket_context_add_server_name(us_quic_socket_context_t *ctx,
    const char *hostname, struct us_bun_socket_context_options_t options);

void *us_quic_socket_context_ext(us_quic_socket_context_t *ctx);
struct us_loop_t *us_quic_socket_context_loop(us_quic_socket_context_t *ctx);

us_quic_listen_socket_t *us_quic_socket_context_listen(
    us_quic_socket_context_t *ctx, const char *host, int port, int flags,
    unsigned int stream_ext_size);

void us_quic_listen_socket_close(us_quic_listen_socket_t *ls);
int us_quic_listen_socket_port(us_quic_listen_socket_t *ls);
int us_quic_listen_socket_local_address(us_quic_listen_socket_t *ls, char *buf, int len);

/* Client engine: one shared lsquic engine for all outbound connections on
 * `loop`. Per-connection cert verification is decided at connect time. */
us_quic_socket_context_t *us_create_quic_client_context(
    struct us_loop_t *loop, unsigned int ext_size,
    unsigned int conn_ext_size, unsigned int stream_ext_size);

struct us_quic_pending_connect_s;
struct addrinfo_request;

/* Open a QUIC connection to `host:port`. `host` may be an IP literal or
 * hostname; literals and DNS-cache hits connect synchronously (return 1,
 * *out_qs set). Uncached hostnames return 0 with *out_pending set — caller
 * registers a Bun__addrinfo callback and invokes
 * us_quic_pending_connect_resolved() once it fires. -1 on error. `sni` is
 * the TLS ServerNameIndication; `reject_unauthorized` is per-connection. */
int us_quic_socket_context_connect(
    us_quic_socket_context_t *ctx, const char *host, int port, const char *sni,
    int reject_unauthorized, us_quic_socket_t **out_qs,
    struct us_quic_pending_connect_s **out_pending, void *user);

void *us_quic_pending_connect_user(struct us_quic_pending_connect_s *pc);
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
void us_quic_socket_context_on_open(us_quic_socket_context_t *ctx,
    void (*on_open)(us_quic_socket_t *));
/* Fires once the TLS handshake completes (client only). ok=0 means the
 * handshake failed; on_close follows shortly. */
void us_quic_socket_context_on_hsk_done(us_quic_socket_context_t *ctx,
    void (*on_hsk_done)(us_quic_socket_t *, int ok));
/* Peer sent GOAWAY: no new streams will be accepted; in-flight ones drain. */
void us_quic_socket_context_on_goaway(us_quic_socket_context_t *ctx,
    void (*on_goaway)(us_quic_socket_t *));
void us_quic_socket_context_on_close(us_quic_socket_context_t *ctx,
    void (*on_close)(us_quic_socket_t *));

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
 * (may be < len under flow-control backpressure). */
int us_quic_stream_write(us_quic_stream_t *s, const char *data, unsigned int len);
void us_quic_stream_want_read(us_quic_stream_t *s, int want);
void us_quic_stream_want_write(us_quic_stream_t *s, int want);
int us_quic_stream_send_headers(us_quic_stream_t *s,
    const struct us_quic_header_t *headers, unsigned int count, int end_stream);
/* Send a 1xx interim HEADERS frame (`:status` only); the final response
 * header block follows separately. */
int us_quic_stream_send_informational(us_quic_stream_t *s, const char *status3);
void us_quic_stream_shutdown(us_quic_stream_t *s);
void us_quic_stream_flush(us_quic_stream_t *s);
void us_quic_stream_shutdown_read(us_quic_stream_t *s);
void us_quic_stream_close(us_quic_stream_t *s);
void us_quic_stream_reset(us_quic_stream_t *s);
int us_quic_stream_has_unacked(us_quic_stream_t *s);

void *us_quic_stream_ext(us_quic_stream_t *s);
us_quic_socket_t *us_quic_stream_socket(us_quic_stream_t *s);
us_quic_socket_context_t *us_quic_stream_context(us_quic_stream_t *s);

/* Drive every QUIC engine on `loop` and re-arm the per-loop fallthrough
 * timer to the soonest earliest_adv_tick. Called from us_internal_loop_post
 * and from drainMicrotasks; cheap when quic_head is NULL. */
void us_quic_loop_process(struct us_loop_t *loop);
/* Flush only if a stream wrote since the last process_conns. */
void us_quic_loop_flush_if_pending(struct us_loop_t *loop);

/* Incoming headers — valid from on_stream_headers until on_stream_close. */
unsigned int us_quic_stream_header_count(us_quic_stream_t *s);
const struct us_quic_header_t *us_quic_stream_header(us_quic_stream_t *s, unsigned int i);

/* Connection accessors */
void *us_quic_socket_ext(us_quic_socket_t *s);
us_quic_socket_context_t *us_quic_socket_context(us_quic_socket_t *s);
void us_quic_socket_remote_address(us_quic_socket_t *s, char *buf, int *len, int *port, int *is_ipv6);
void us_quic_socket_close(us_quic_socket_t *s);

#ifdef __cplusplus
}
#endif

#endif /* US_QUIC_H */
