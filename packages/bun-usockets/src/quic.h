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

/* One name/value pair pointing into stream-owned storage. */
struct us_quic_header_t {
    const char *name;
    unsigned int name_len;
    const char *value;
    unsigned int value_len;
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
    us_quic_socket_context_t *ctx, const char *host, int port,
    unsigned int stream_ext_size);

void us_quic_listen_socket_close(us_quic_listen_socket_t *ls);
int us_quic_listen_socket_port(us_quic_listen_socket_t *ls);
int us_quic_listen_socket_local_address(us_quic_listen_socket_t *ls, char *buf, int len);

/* Connection-level callbacks */
void us_quic_socket_context_on_open(us_quic_socket_context_t *ctx,
    void (*on_open)(us_quic_socket_t *));
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

/* WebTransport (draft-ietf-webtrans-http3). es_webtransport_server /
 * es_datagrams are flipped unconditionally in us_create_quic_socket_context
 * (lsquic snapshots settings at engine_new), so these registrations only
 * arm the callbacks. on_wt_stream_data fires for client-initiated bidi
 * streams that opened with the 0x41 signal value; `session` is the CONNECT
 * stream (looked up via Session ID), or NULL if the session arrived later /
 * was already closed. on_datagram fires for raw QUIC DATAGRAM payloads with
 * the Quarter Stream ID prefix already stripped. */
void us_quic_socket_context_on_wt_stream_data(us_quic_socket_context_t *ctx,
    void (*on_wt_data)(us_quic_stream_t *, us_quic_stream_t *session,
        const char *, unsigned int, int fin));
/* Fires once for each 0x41 bidi stream when it closes (FIN or RESET).
 * `session` is resolved at close time (NULL if already gone). */
void us_quic_socket_context_on_wt_stream_close(us_quic_socket_context_t *ctx,
    void (*on_wt_close)(us_quic_stream_t *, us_quic_stream_t *session));
void us_quic_socket_context_on_datagram(us_quic_socket_context_t *ctx,
    void (*on_datagram)(us_quic_stream_t *session, const char *, unsigned int));

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
void us_quic_stream_shutdown_read(us_quic_stream_t *s);
void us_quic_stream_close(us_quic_stream_t *s);
int us_quic_stream_has_unacked(us_quic_stream_t *s);

void *us_quic_stream_ext(us_quic_stream_t *s);
us_quic_socket_t *us_quic_stream_socket(us_quic_stream_t *s);
us_quic_socket_context_t *us_quic_stream_context(us_quic_stream_t *s);
unsigned long long us_quic_stream_id(us_quic_stream_t *s);

/* Promote a CONNECT stream to a WebTransport session: links it into the
 * connection's session list so incoming WT bidi streams and datagrams can
 * be routed by Session ID. Call once, after sending the 2xx HEADERS. */
void us_quic_stream_set_webtransport_session(us_quic_stream_t *s);
/* Queue a QUIC DATAGRAM with the session's Quarter Stream ID prefix. The
 * payload is copied; total (prefix + len) must fit in one frame, i.e. ~1200
 * bytes after QUIC packet overhead. Returns -1 if the session is closed or
 * len exceeds MTU; -2 if the per-session queue would exceed max_queued
 * (the only case that should trigger closeOnBackpressureLimit); otherwise
 * the per-session queued byte count *before* this enqueue (0 ⇒ first in
 * queue, caller may report SUCCESS rather than BACKPRESSURE). */
int us_quic_stream_send_datagram(us_quic_stream_t *session,
    const char *data, unsigned int len, unsigned int max_queued);
/* Outstanding queued bytes (for getBufferedAmount); 0 once on_dg_write
 * has consumed everything we queued. */
unsigned int us_quic_stream_datagram_buffered(us_quic_stream_t *session);

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
