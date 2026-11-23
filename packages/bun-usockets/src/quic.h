/* The HTTP/3 server, which src/uws_sys/quic/server.rs implements. */
#ifndef US_QUIC_H
#define US_QUIC_H

#define LIBUS_USE_QUIC 1

#include "libusockets.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct us_quic_socket_context_s us_quic_socket_context_t;
typedef struct us_quic_listen_socket_s us_quic_listen_socket_t;

/* Names a request stream. The functions do nothing once it is closed. */
typedef struct {
    const void *engine;
    uint32_t connection[2];
    uint64_t id;
} us_quic_stream_t;

/* `qpack_index` is that of an entry with this name in the static table of QPACK, or -1. */
struct us_quic_header_t {
    const char *name;
    unsigned int name_len;
    const char *value;
    unsigned int value_len;
    int qpack_index;
};

/* Fields a request may have, pseudo-headers included. */
#define US_QUIC_MAX_REQUEST_FIELDS 200

struct us_quic_callbacks_t {
    /* Returns what the other callbacks get. */
    void *(*on_open)(void *user, const us_quic_stream_t *stream);
    /* The headers are valid until it returns. They are incomplete if there were more than the limits allow. */
    void (*on_headers)(void *response, const struct us_quic_header_t *headers, unsigned int count, bool incomplete);
    void (*on_data)(void *response, const char *data, unsigned int len, bool fin);
    void (*on_writable)(void *response);
    void (*on_close)(void *response);
};

us_quic_socket_context_t *us_create_quic_socket_context(
    struct us_loop_t *loop, const struct us_bun_socket_context_options_t *options, unsigned int idle_timeout_s,
    size_t max_header_size, const struct us_quic_callbacks_t *callbacks, void *user);

/* Sends GOAWAY on every connection and accepts no more. The requests in flight are still served.
 * `on_drained` is called when there are no connections left, which can be before this returns.
 * Ahead of that, it is called with `is_over` unset if the peers of those that are left seem to be gone. */
void us_quic_socket_context_shutdown(us_quic_socket_context_t *ctx, void (*on_drained)(void *user, bool is_over), void *user);
void us_quic_socket_context_free(us_quic_socket_context_t *ctx);

/* Names match as on a TCP listener. */
bool us_quic_socket_context_add_server_name(us_quic_socket_context_t *ctx,
    const char *hostname, const struct us_bun_socket_context_options_t *options);

/* It lives as long as the context. */
us_quic_listen_socket_t *us_quic_socket_context_listen(
    us_quic_socket_context_t *ctx, const char *host, int port, int flags);

void us_quic_listen_socket_close(us_quic_listen_socket_t *ls);
int us_quic_listen_socket_port(us_quic_listen_socket_t *ls);
/* Returns the length of the address, 4 or 16. */
int us_quic_listen_socket_local_address(us_quic_listen_socket_t *ls, char (*ip)[16]);

/* Returns how many bytes it took. If not all, on_writable follows. */
size_t us_quic_stream_write(const us_quic_stream_t *s, const char *data, size_t len);
void us_quic_stream_want_read(const us_quic_stream_t *s, bool want);
void us_quic_stream_want_write(const us_quic_stream_t *s);
void us_quic_stream_send_headers(const us_quic_stream_t *s,
    const struct us_quic_header_t *headers, unsigned int count, bool end_stream);
void us_quic_stream_shutdown(const us_quic_stream_t *s);
void us_quic_stream_shutdown_read(const us_quic_stream_t *s);
/* Resets the stream if the response is not complete. */
void us_quic_stream_close(const us_quic_stream_t *s);
/* For how long the connection has to last without a word from the application. 0 is for ever. */
void us_quic_stream_timeout(const us_quic_stream_t *s, unsigned int seconds);
/* Returns the length of the address: 4, 16, or 0 if the connection is gone. */
int us_quic_stream_remote_address(const us_quic_stream_t *s, char (*ip)[16], int *port);

/* For when loop->data.quic_drivers is set. */
void us_quic_loop_process(struct us_loop_t *loop);

#ifdef __cplusplus
}
#endif

#endif /* US_QUIC_H */
