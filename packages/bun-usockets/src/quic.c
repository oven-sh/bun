#include "quic.h"

#ifdef LIBUS_USE_QUIC

#include "internal/internal.h"
#include "lsquic.h"
#include "lsxpack_header.h"
#include <openssl/ssl.h>

#include <assert.h>
#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/ip.h>

extern SSL_CTX *create_ssl_context_from_bun_options(
    struct us_bun_socket_context_options_t options,
    enum create_bun_socket_error_t *err);

#define US_QUIC_READ_BUF (16 * 1024)

/* Incoming header set: contiguous storage + index. Created before the
 * stream object exists (lsquic decodes headers ahead of on_new_stream),
 * so it lives standalone until on_read claims it via lsquic_stream_get_hset. */
struct us_quic_hset {
    char *buf;
    unsigned int len, cap;
    struct lsxpack_header scratch;
    struct us_quic_header_t *headers;
    unsigned int count, hcap;
};

struct us_quic_sni {
    char *name;
    SSL_CTX *ctx;
};

struct us_quic_socket_context_s {
    struct us_loop_t *loop;
    lsquic_engine_t *engine;
    struct lsquic_engine_settings settings;
    SSL_CTX *ssl_ctx;
    struct us_quic_sni *sni;
    unsigned int sni_count, sni_cap;
    struct us_timer_t *timer;
    int processing;
    int closing;
    unsigned int stream_ext_size;
    /* Listen sockets stay reachable as lsquic peer_ctx after the UDP fd
     * closes; defer freeing until the engine itself is torn down. `listeners`
     * tracks live ones so context_free can close any the caller never did. */
    struct us_quic_listen_socket_s *listeners;
    struct us_quic_listen_socket_s *closed_listeners;

    void (*on_open)(us_quic_socket_t *);
    void (*on_close)(us_quic_socket_t *);
    void (*on_stream_open)(us_quic_stream_t *, int);
    void (*on_stream_headers)(us_quic_stream_t *);
    void (*on_stream_data)(us_quic_stream_t *, const char *, unsigned int, int);
    void (*on_stream_writable)(us_quic_stream_t *);
    void (*on_stream_close)(us_quic_stream_t *);

    char read_buf[US_QUIC_READ_BUF];
    /* ext follows */
};

struct us_quic_listen_socket_s {
    struct us_udp_socket_t *udp;
    us_quic_socket_context_t *ctx;
    struct sockaddr_storage local;
    struct us_quic_listen_socket_s *next; /* live list, then reused for closed list */
};

struct us_quic_socket_s {
    lsquic_conn_t *conn;
    us_quic_socket_context_t *ctx;
    /* ext follows */
};

struct us_quic_stream_s {
    lsquic_stream_t *stream;
    us_quic_socket_context_t *ctx;
    struct us_quic_hset *hset;
    int headers_delivered;
    int fin_delivered;
    /* ext follows */
};

/* ───── timer / process driver ───── */

static void us_quic_rearm(us_quic_socket_context_t *ctx);

static void us_quic_process(us_quic_socket_context_t *ctx) {
    if (ctx->processing || !ctx->engine) return;
    ctx->processing = 1;
    lsquic_engine_process_conns(ctx->engine);
    ctx->processing = 0;
    us_quic_rearm(ctx);
}

static void us_quic_timer_cb(struct us_timer_t *t) {
    us_quic_socket_context_t *ctx = *(us_quic_socket_context_t **) us_timer_ext(t);
    us_quic_process(ctx);
}

static void us_quic_rearm(us_quic_socket_context_t *ctx) {
    if (!ctx->engine || !ctx->timer) return;
    int diff;
    if (lsquic_engine_earliest_adv_tick(ctx->engine, &diff)) {
        int ms = diff <= 0 ? 1 : (diff / 1000) + 1;
        us_timer_set(ctx->timer, us_quic_timer_cb, ms, 0);
    }
}

/* ───── packets out ───── */

static inline socklen_t sa_len(const struct sockaddr *sa) {
    return sa->sa_family == AF_INET6 ? sizeof(struct sockaddr_in6) : sizeof(struct sockaddr_in);
}

static int us_quic_send_one(int fd, const struct lsquic_out_spec *spec) {
    struct msghdr msg;
    memset(&msg, 0, sizeof(msg));
    msg.msg_name = (void *) spec->dest_sa;
    msg.msg_namelen = sa_len(spec->dest_sa);
    msg.msg_iov = spec->iov;
    msg.msg_iovlen = spec->iovlen;
    ssize_t r;
    do { r = sendmsg(fd, &msg, 0); } while (r < 0 && errno == EINTR);
    return r < 0 ? -1 : 1;
}

/* lsquic hands back packets in batches; on Linux push them through one
 * sendmmsg() so a 32-packet flight is a single syscall. macOS's sendmsg_x
 * can't carry per-datagram addresses (which QUIC needs), so it falls back to
 * the per-packet path along with everything else non-Linux. The recv side
 * already goes through bsd_recvmmsg in loop.c. */
static int us_quic_packets_out(void *out_ctx, const struct lsquic_out_spec *specs, unsigned n) {
    (void) out_ctx;
    unsigned sent = 0;

#if defined(__linux__)
    enum { BATCH = 64 };
    struct mmsghdr mm[BATCH];
    while (sent < n) {
        us_quic_listen_socket_t *ls = (us_quic_listen_socket_t *) specs[sent].peer_ctx;
        if (!ls->udp) { errno = EBADF; break; }
        int fd = us_poll_fd((struct us_poll_t *) ls->udp);
        unsigned k = 0;
        while (k < BATCH && sent + k < n && specs[sent + k].peer_ctx == (void *) ls) {
            const struct lsquic_out_spec *sp = &specs[sent + k];
            memset(&mm[k], 0, sizeof(mm[k]));
            mm[k].msg_hdr.msg_name = (void *) sp->dest_sa;
            mm[k].msg_hdr.msg_namelen = sa_len(sp->dest_sa);
            mm[k].msg_hdr.msg_iov = sp->iov;
            mm[k].msg_hdr.msg_iovlen = sp->iovlen;
            k++;
        }
        int r;
        do { r = sendmmsg(fd, mm, k, 0); } while (r < 0 && errno == EINTR);
        if (r < 0) break;
        sent += (unsigned) r;
        if ((unsigned) r < k) break;
    }
#else
    for (; sent < n; sent++) {
        us_quic_listen_socket_t *ls = (us_quic_listen_socket_t *) specs[sent].peer_ctx;
        if (!ls->udp) { errno = EBADF; break; }
        if (us_quic_send_one(us_poll_fd((struct us_poll_t *) ls->udp), &specs[sent]) < 0) break;
    }
#endif

    if (sent < n) {
        if (errno != EAGAIN && errno != EWOULDBLOCK) errno = EAGAIN;
        us_quic_listen_socket_t *ls = (us_quic_listen_socket_t *) specs[sent].peer_ctx;
        if (ls->udp) {
            us_poll_change((struct us_poll_t *) ls->udp, ls->ctx->loop,
                LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
        }
    }
    return (int) sent;
}

/* ───── UDP callbacks ───── */

static void us_quic_udp_on_data(struct us_udp_socket_t *u, void *recvbuf, int npackets) {
    us_quic_listen_socket_t *ls = (us_quic_listen_socket_t *) us_udp_socket_user(u);
    us_quic_socket_context_t *ctx = ls->ctx;
    if (!ctx->engine) return;
    for (int i = 0; i < npackets; i++) {
        char *payload = us_udp_packet_buffer_payload((struct us_udp_packet_buffer_t *) recvbuf, i);
        int len = us_udp_packet_buffer_payload_length((struct us_udp_packet_buffer_t *) recvbuf, i);
        struct sockaddr *peer = (struct sockaddr *) us_udp_packet_buffer_peer((struct us_udp_packet_buffer_t *) recvbuf, i);
        lsquic_engine_packet_in(ctx->engine, (unsigned char *) payload, (size_t) len,
            (struct sockaddr *) &ls->local, peer, ls, 0);
    }
    us_quic_process(ctx);
}

static void us_quic_udp_on_drain(struct us_udp_socket_t *u) {
    us_quic_listen_socket_t *ls = (us_quic_listen_socket_t *) us_udp_socket_user(u);
    if (ls->ctx->engine) {
        lsquic_engine_send_unsent_packets(ls->ctx->engine);
        us_quic_rearm(ls->ctx);
    }
}

static void us_quic_udp_on_close(struct us_udp_socket_t *u) {
    us_quic_listen_socket_t *ls = (us_quic_listen_socket_t *) us_udp_socket_user(u);
    us_quic_socket_context_t *ctx = ls->ctx;
    /* lsquic still holds `ls` as peer_ctx for every connection accepted on
     * this socket; freeing now would UAF in packets_out / get_ssl_ctx on the
     * next timer tick. Mark the fd gone, unlink from the live list, and defer
     * the free to context_free. */
    ls->udp = NULL;
    for (us_quic_listen_socket_t **pp = &ctx->listeners; *pp; pp = &(*pp)->next) {
        if (*pp == ls) { *pp = ls->next; break; }
    }
    ls->next = ctx->closed_listeners;
    ctx->closed_listeners = ls;
}

/* ───── SSL ───── */

/* Exact match, then `*.tail` wildcards (matches "a.tail" but not "tail"). */
static SSL_CTX *us_quic_match_sni(us_quic_socket_context_t *ctx, const char *sni) {
    if (!sni) return ctx->ssl_ctx;
    size_t sl = strlen(sni);
    for (unsigned i = 0; i < ctx->sni_count; i++) {
        if (strcmp(ctx->sni[i].name, sni) == 0) return ctx->sni[i].ctx;
    }
    for (unsigned i = 0; i < ctx->sni_count; i++) {
        const char *n = ctx->sni[i].name;
        if (n[0] == '*' && n[1] == '.') {
            size_t tl = strlen(n + 1);
            if (sl > tl && memcmp(sni + sl - tl, n + 1, tl) == 0) return ctx->sni[i].ctx;
        }
    }
    return ctx->ssl_ctx;
}

static SSL_CTX *us_quic_get_ssl_ctx(void *peer_ctx, const struct sockaddr *local) {
    (void) local;
    us_quic_listen_socket_t *ls = (us_quic_listen_socket_t *) peer_ctx;
    return ls->ctx->ssl_ctx;
}

static SSL_CTX *us_quic_lookup_cert(void *cert_ctx, const struct sockaddr *local, const char *sni) {
    (void) local;
    us_quic_socket_context_t *ctx = (us_quic_socket_context_t *) cert_ctx;
    return us_quic_match_sni(ctx, sni);
}

static int us_quic_alpn_select(SSL *ssl, const unsigned char **out, unsigned char *outlen,
                               const unsigned char *in, unsigned int inlen, void *arg) {
    (void) ssl; (void) arg;
    /* Walk the client's ALPN list (1-byte length-prefixed entries) and pick
     * the first h3 variant. lsquic only speaks h3/h3-29/h3-27 in HTTP mode. */
    for (unsigned int i = 0; i + 1 <= inlen; ) {
        unsigned int n = in[i];
        if (i + 1 + n > inlen) break;
        const unsigned char *p = in + i + 1;
        if ((n == 2 && p[0] == 'h' && p[1] == '3') ||
            (n >= 3 && p[0] == 'h' && p[1] == '3' && p[2] == '-')) {
            *out = p;
            *outlen = (unsigned char) n;
            return SSL_TLSEXT_ERR_OK;
        }
        i += 1 + n;
    }
    return SSL_TLSEXT_ERR_ALERT_FATAL;
}

/* ───── header-set interface ───── */

static void *us_quic_hsi_create(void *hsi_ctx, lsquic_stream_t *s, int is_push) {
    (void) hsi_ctx; (void) s; (void) is_push;
    return calloc(1, sizeof(struct us_quic_hset));
}

static struct lsxpack_header *us_quic_hsi_prepare(void *hset_p, struct lsxpack_header *hdr, size_t space) {
    struct us_quic_hset *h = (struct us_quic_hset *) hset_p;
    if (space > 64 * 1024) return NULL;
    unsigned int need = h->len + (unsigned int) space;
    if (need > h->cap) {
        unsigned int ncap = h->cap ? h->cap : 512;
        while (ncap < need) ncap *= 2;
        char *nb = (char *) realloc(h->buf, ncap);
        if (!nb) return NULL;
        h->buf = nb;
        h->cap = ncap;
    }
    if (hdr == NULL) {
        hdr = &h->scratch;
        lsxpack_header_prepare_decode(hdr, h->buf, h->len, space);
    } else {
        /* Resize: lsqpack already wrote part of name/value into the previous
         * buffer; only the storage may move. Preserve offsets, repoint buf,
         * and report the larger window via val_len. */
        hdr->buf = h->buf;
        hdr->val_len = (lsxpack_strlen_t) space;
    }
    return hdr;
}

static int us_quic_hsi_process(void *hset_p, struct lsxpack_header *hdr) {
    struct us_quic_hset *h = (struct us_quic_hset *) hset_p;
    if (hdr == NULL) return 0; /* end of headers */
    if (h->count == h->hcap) {
        unsigned int ncap = h->hcap ? h->hcap * 2 : 16;
        struct us_quic_header_t *nh = (struct us_quic_header_t *)
            realloc(h->headers, ncap * sizeof(*nh));
        if (!nh) return -1;
        h->headers = nh;
        h->hcap = ncap;
    }
    /* lsxpack wrote name+value into h->buf at h->len; record offsets, then
     * advance len so the next header lands after this one. We store offsets
     * (cast to pointer-sized) and resolve them after the buffer stops moving. */
    h->headers[h->count].name = (const char *)(uintptr_t) hdr->name_offset;
    h->headers[h->count].name_len = hdr->name_len;
    h->headers[h->count].value = (const char *)(uintptr_t) hdr->val_offset;
    h->headers[h->count].value_len = hdr->val_len;
    h->count++;
    h->len = (unsigned int) hdr->val_offset + hdr->val_len + hdr->dec_overhead;
    return 0;
}

static void us_quic_hset_finalize(struct us_quic_hset *h) {
    for (unsigned int i = 0; i < h->count; i++) {
        h->headers[i].name = h->buf + (uintptr_t) h->headers[i].name;
        h->headers[i].value = h->buf + (uintptr_t) h->headers[i].value;
    }
}

static void us_quic_hset_free(struct us_quic_hset *h) {
    if (!h) return;
    free(h->buf);
    free(h->headers);
    free(h);
}

static void us_quic_hsi_discard(void *hset_p) {
    us_quic_hset_free((struct us_quic_hset *) hset_p);
}

/* ───── stream interface ───── */

static lsquic_conn_ctx_t *us_quic_on_new_conn(void *if_ctx, lsquic_conn_t *conn) {
    us_quic_socket_context_t *ctx = (us_quic_socket_context_t *) if_ctx;
    if (ctx->closing) {
        lsquic_conn_close(conn);
        return NULL;
    }
    us_quic_socket_t *qs = (us_quic_socket_t *) calloc(1, sizeof(us_quic_socket_t));
    if (!qs) return NULL;
    qs->conn = conn;
    qs->ctx = ctx;
    if (ctx->on_open) ctx->on_open(qs);
    return (lsquic_conn_ctx_t *) qs;
}

static void us_quic_on_conn_closed(lsquic_conn_t *conn) {
    us_quic_socket_t *qs = (us_quic_socket_t *) lsquic_conn_get_ctx(conn);
    if (!qs) return;
    if (qs->ctx->on_close) qs->ctx->on_close(qs);
    lsquic_conn_set_ctx(conn, NULL);
    free(qs);
}

static lsquic_stream_ctx_t *us_quic_on_new_stream(void *if_ctx, lsquic_stream_t *stream) {
    us_quic_socket_context_t *ctx = (us_quic_socket_context_t *) if_ctx;
    if (stream == NULL) return NULL; /* going-away */
    us_quic_stream_t *s = (us_quic_stream_t *)
        calloc(1, sizeof(us_quic_stream_t) + ctx->stream_ext_size);
    if (!s) { lsquic_stream_close(stream); return NULL; }
    s->stream = stream;
    s->ctx = ctx;
    if (ctx->on_stream_open) ctx->on_stream_open(s, 0);
    lsquic_stream_wantread(stream, 1);
    return (lsquic_stream_ctx_t *) s;
}

static void us_quic_on_read(lsquic_stream_t *stream, lsquic_stream_ctx_t *h) {
    us_quic_stream_t *s = (us_quic_stream_t *) h;
    us_quic_socket_context_t *ctx = s->ctx;

    if (!s->headers_delivered) {
        struct us_quic_hset *hset = (struct us_quic_hset *) lsquic_stream_get_hset(stream);
        if (hset) {
            us_quic_hset_finalize(hset);
            s->hset = hset;
            s->headers_delivered = 1;
            if (ctx->on_stream_headers) ctx->on_stream_headers(s);
            /* on_stream_headers may have closed us */
            if (!s->stream) return;
        }
    }

    ssize_t r;
    while ((r = lsquic_stream_read(stream, ctx->read_buf, US_QUIC_READ_BUF)) > 0) {
        if (ctx->on_stream_data)
            ctx->on_stream_data(s, ctx->read_buf, (unsigned int) r, 0);
        if (!s->stream) return;
    }
    if (r == 0 && !s->fin_delivered) {
        s->fin_delivered = 1;
        lsquic_stream_wantread(stream, 0);
        lsquic_stream_shutdown(stream, 0);
        if (ctx->on_stream_data) ctx->on_stream_data(s, ctx->read_buf, 0, 1);
    }
}

static void us_quic_on_write(lsquic_stream_t *stream, lsquic_stream_ctx_t *h) {
    us_quic_stream_t *s = (us_quic_stream_t *) h;
    lsquic_stream_wantwrite(stream, 0);
    if (s->ctx->on_stream_writable) s->ctx->on_stream_writable(s);
}

static void us_quic_on_close(lsquic_stream_t *stream, lsquic_stream_ctx_t *h) {
    (void) stream;
    us_quic_stream_t *s = (us_quic_stream_t *) h;
    if (!s) return;
    if (s->ctx->on_stream_close) s->ctx->on_stream_close(s);
    s->stream = NULL;
    us_quic_hset_free(s->hset);
    free(s);
}

static void us_quic_on_reset(lsquic_stream_t *stream, lsquic_stream_ctx_t *h, int how) {
    (void) how;
    /* Reset triggers on_close shortly after; nothing extra to do here. */
    if (h && stream) lsquic_stream_close(stream);
}

/* ───── public API ───── */

static const struct lsquic_stream_if us_quic_stream_if = {
    .on_new_conn = us_quic_on_new_conn,
    .on_conn_closed = us_quic_on_conn_closed,
    .on_new_stream = us_quic_on_new_stream,
    .on_read = us_quic_on_read,
    .on_write = us_quic_on_write,
    .on_close = us_quic_on_close,
    .on_reset = us_quic_on_reset,
};

static const struct lsquic_hset_if us_quic_hset_if = {
    .hsi_create_header_set = us_quic_hsi_create,
    .hsi_prepare_decode = us_quic_hsi_prepare,
    .hsi_process_header = us_quic_hsi_process,
    .hsi_discard_header_set = us_quic_hsi_discard,
    .hsi_flags = 0,
};

static int us_quic_log_buf(void *ctx, const char *buf, size_t len) {
    (void) ctx;
    fwrite(buf, 1, len, stderr);
    fputc('\n', stderr);
    return 0;
}
static const struct lsquic_logger_if us_quic_logger = { us_quic_log_buf };

static void us_quic_global_init_once(void) {
    lsquic_global_init(LSQUIC_GLOBAL_SERVER);
    if (getenv("BUN_DEBUG_lsquic")) {
        lsquic_logger_init(&us_quic_logger, NULL, LLTS_HHMMSSUS);
        lsquic_set_log_level("debug");
    }
}

static void us_quic_prepare_ssl_ctx(SSL_CTX *ssl) {
    SSL_CTX_set_min_proto_version(ssl, TLS1_3_VERSION);
    SSL_CTX_set_max_proto_version(ssl, TLS1_3_VERSION);
    SSL_CTX_set_alpn_select_cb(ssl, us_quic_alpn_select, NULL);
    SSL_CTX_set_early_data_enabled(ssl, 0);
}

us_quic_socket_context_t *us_create_quic_socket_context(
    struct us_loop_t *loop, struct us_bun_socket_context_options_t options,
    unsigned int ext_size, unsigned int idle_timeout_s)
{
    static pthread_once_t once = PTHREAD_ONCE_INIT;
    pthread_once(&once, us_quic_global_init_once);

    enum create_bun_socket_error_t ssl_err = 0;
    SSL_CTX *ssl = create_ssl_context_from_bun_options(options, &ssl_err);
    if (!ssl) return NULL;
    us_quic_prepare_ssl_ctx(ssl);

    us_quic_socket_context_t *ctx = (us_quic_socket_context_t *)
        calloc(1, sizeof(us_quic_socket_context_t) + ext_size);
    if (!ctx) { SSL_CTX_free(ssl); return NULL; }
    ctx->loop = loop;
    ctx->ssl_ctx = ssl;

    lsquic_engine_init_settings(&ctx->settings, LSENG_HTTP_SERVER);
    ctx->settings.es_versions = LSQUIC_DF_VERSIONS & LSQUIC_IETF_VERSIONS;
    ctx->settings.es_ecn = 0;
    /* QPACK can expand small dynamic-table refs into large header lists; cap
     * the post-decode size at the same order as uWS H1's MAX_FALLBACK_SIZE so
     * a single request can't run hsi_prepare to OOM. */
    ctx->settings.es_max_header_list_size = 16 * 1024;
    ctx->settings.es_init_max_streams_bidi = 100;
    if (idle_timeout_s) ctx->settings.es_idle_timeout = idle_timeout_s > 600 ? 600 : idle_timeout_s;

    struct lsquic_engine_api api;
    memset(&api, 0, sizeof(api));
    api.ea_settings = &ctx->settings;
    api.ea_stream_if = &us_quic_stream_if;
    api.ea_stream_if_ctx = ctx;
    api.ea_packets_out = us_quic_packets_out;
    api.ea_packets_out_ctx = ctx;
    api.ea_get_ssl_ctx = us_quic_get_ssl_ctx;
    api.ea_lookup_cert = us_quic_lookup_cert;
    api.ea_cert_lu_ctx = ctx;
    api.ea_hsi_if = &us_quic_hset_if;
    api.ea_hsi_ctx = ctx;

    ctx->engine = lsquic_engine_new(LSENG_HTTP_SERVER, &api);
    if (!ctx->engine) {
        SSL_CTX_free(ssl);
        free(ctx);
        return NULL;
    }

    ctx->timer = us_create_timer(loop, 1, sizeof(us_quic_socket_context_t *));
    if (!ctx->timer) {
        lsquic_engine_destroy(ctx->engine);
        SSL_CTX_free(ssl);
        free(ctx);
        return NULL;
    }
    *(us_quic_socket_context_t **) us_timer_ext(ctx->timer) = ctx;

    return ctx;
}

int us_quic_socket_context_add_server_name(us_quic_socket_context_t *ctx,
    const char *hostname, struct us_bun_socket_context_options_t options)
{
    enum create_bun_socket_error_t ssl_err = 0;
    SSL_CTX *ssl = create_ssl_context_from_bun_options(options, &ssl_err);
    if (!ssl) return -1;
    us_quic_prepare_ssl_ctx(ssl);
    if (ctx->sni_count == ctx->sni_cap) {
        unsigned ncap = ctx->sni_cap ? ctx->sni_cap * 2 : 4;
        struct us_quic_sni *n = (struct us_quic_sni *) realloc(ctx->sni, ncap * sizeof(*n));
        if (!n) { SSL_CTX_free(ssl); return -1; }
        ctx->sni = n; ctx->sni_cap = ncap;
    }
    char *name = strdup(hostname);
    if (!name) { SSL_CTX_free(ssl); return -1; }
    ctx->sni[ctx->sni_count].name = name;
    ctx->sni[ctx->sni_count].ctx = ssl;
    ctx->sni_count++;
    return 0;
}

void us_quic_socket_context_shutdown(us_quic_socket_context_t *ctx) {
    if (!ctx || ctx->closing || !ctx->engine) return;
    ctx->closing = 1;
    /* GOAWAY every conn and flush; the timer keeps ticking so in-flight
     * streams drain. New conns are rejected in on_new_conn while closing. */
    lsquic_engine_cooldown(ctx->engine);
    lsquic_engine_send_unsent_packets(ctx->engine);
    us_quic_process(ctx);
}

void us_quic_socket_context_free(us_quic_socket_context_t *ctx) {
    if (!ctx) return;
    ctx->closing = 1;
    /* Close any UDP fds the caller never closed (graceful drain leaves them
     * open); on_close moves each into closed_listeners for the loop below. */
    while (ctx->listeners) us_udp_socket_close(ctx->listeners->udp);
    if (ctx->timer) { us_timer_close(ctx->timer, 1); ctx->timer = NULL; }
    if (ctx->engine) { lsquic_engine_destroy(ctx->engine); ctx->engine = NULL; }
    if (ctx->ssl_ctx) { SSL_CTX_free(ctx->ssl_ctx); ctx->ssl_ctx = NULL; }
    for (unsigned i = 0; i < ctx->sni_count; i++) {
        free(ctx->sni[i].name);
        SSL_CTX_free(ctx->sni[i].ctx);
    }
    free(ctx->sni);
    for (us_quic_listen_socket_t *ls = ctx->closed_listeners; ls; ) {
        us_quic_listen_socket_t *next = ls->next;
        free(ls);
        ls = next;
    }
    free(ctx);
}

void *us_quic_socket_context_ext(us_quic_socket_context_t *ctx) { return ctx + 1; }
struct us_loop_t *us_quic_socket_context_loop(us_quic_socket_context_t *ctx) { return ctx->loop; }

us_quic_listen_socket_t *us_quic_socket_context_listen(
    us_quic_socket_context_t *ctx, const char *host, int port,
    unsigned int stream_ext_size)
{
    ctx->stream_ext_size = stream_ext_size;

    us_quic_listen_socket_t *ls = (us_quic_listen_socket_t *) calloc(1, sizeof(*ls));
    if (!ls) return NULL;
    ls->ctx = ctx;

    int err = 0;
    ls->udp = us_create_udp_socket(ctx->loop,
        us_quic_udp_on_data, us_quic_udp_on_drain, us_quic_udp_on_close, NULL,
        host, (unsigned short) port, 0, &err, ls);
    if (!ls->udp) { free(ls); return NULL; }

    /* Record actual bound address — packet_in needs sa_local. */
    socklen_t sl = sizeof(ls->local);
    getsockname(us_poll_fd((struct us_poll_t *) ls->udp), (struct sockaddr *) &ls->local, &sl);

    ls->next = ctx->listeners;
    ctx->listeners = ls;
    us_quic_rearm(ctx);
    return ls;
}

void us_quic_listen_socket_close(us_quic_listen_socket_t *ls) {
    if (!ls || !ls->udp) return;
    /* Ask lsquic to send CONNECTION_CLOSE on every live connection before the
     * fd disappears; otherwise clients sit out their idle timeout. */
    if (ls->ctx->engine) {
        lsquic_engine_cooldown(ls->ctx->engine);
        lsquic_engine_send_unsent_packets(ls->ctx->engine);
    }
    us_udp_socket_close(ls->udp);
}

int us_quic_listen_socket_port(us_quic_listen_socket_t *ls) {
    return us_udp_socket_bound_port(ls->udp);
}

#define DEF_CB(name, sig) \
    void us_quic_socket_context_##name(us_quic_socket_context_t *ctx, sig) { ctx->name = cb; }
DEF_CB(on_open, void (*cb)(us_quic_socket_t *))
DEF_CB(on_close, void (*cb)(us_quic_socket_t *))
DEF_CB(on_stream_open, void (*cb)(us_quic_stream_t *, int))
DEF_CB(on_stream_headers, void (*cb)(us_quic_stream_t *))
DEF_CB(on_stream_data, void (*cb)(us_quic_stream_t *, const char *, unsigned int, int))
DEF_CB(on_stream_writable, void (*cb)(us_quic_stream_t *))
DEF_CB(on_stream_close, void (*cb)(us_quic_stream_t *))
#undef DEF_CB

int us_quic_stream_write(us_quic_stream_t *s, const char *data, unsigned int len) {
    if (!s->stream) return -1;
    ssize_t w = lsquic_stream_write(s->stream, data, len);
    if (w >= 0 && (unsigned int) w < len) lsquic_stream_wantwrite(s->stream, 1);
    if (w >= 0) lsquic_stream_flush(s->stream);
    return (int) w;
}

void us_quic_stream_want_read(us_quic_stream_t *s, int want) {
    if (s->stream) lsquic_stream_wantread(s->stream, want);
}

void us_quic_stream_want_write(us_quic_stream_t *s, int want) {
    if (s->stream) lsquic_stream_wantwrite(s->stream, want);
}

int us_quic_stream_send_informational(us_quic_stream_t *s, const char *status3) {
    if (!s->stream) return -1;
    char buf[10];
    memcpy(buf, ":status", 7);
    memcpy(buf + 7, status3, 3);
    struct lsxpack_header xh;
    lsxpack_header_set_offset2(&xh, buf, 0, 7, 7, 3);
    lsquic_http_headers_t lh = { .count = 1, .headers = &xh };
    return lsquic_stream_send_headers(s->stream, &lh, 0);
}

int us_quic_stream_send_headers(us_quic_stream_t *s,
    const struct us_quic_header_t *headers, unsigned int count, int end_stream)
{
    if (!s->stream) return -1;

    /* lsxpack_header addresses name+value as offsets into a single buffer,
     * so each pair has to be contiguous. The caller hands us arbitrary
     * pointers, so flatten here. */
    size_t total = 0;
    for (unsigned int i = 0; i < count; i++)
        total += headers[i].name_len + headers[i].value_len;

    char stackbuf[1024];
    char *buf = total <= sizeof(stackbuf) ? stackbuf : (char *) malloc(total);
    struct lsxpack_header stackh[32];
    struct lsxpack_header *xh = count <= 32 ? stackh
        : (struct lsxpack_header *) calloc(count, sizeof(*xh));
    if (!buf || !xh) {
        if (buf != stackbuf) free(buf);
        if (xh != stackh) free(xh);
        return -1;
    }

    size_t off = 0;
    for (unsigned int i = 0; i < count; i++) {
        const struct us_quic_header_t *h = &headers[i];
        memcpy(buf + off, h->name, h->name_len);
        memcpy(buf + off + h->name_len, h->value, h->value_len);
        lsxpack_header_set_offset2(&xh[i], buf, off, h->name_len,
            off + h->name_len, h->value_len);
        off += h->name_len + h->value_len;
    }

    lsquic_http_headers_t lh = { .count = (int) count, .headers = xh };
    int r = lsquic_stream_send_headers(s->stream, &lh, end_stream);
    if (buf != stackbuf) free(buf);
    if (xh != stackh) free(xh);
    if (end_stream && r == 0) lsquic_stream_shutdown(s->stream, 1);
    return r;
}

void us_quic_stream_shutdown(us_quic_stream_t *s) {
    if (s->stream) {
        lsquic_stream_flush(s->stream);
        lsquic_stream_shutdown(s->stream, 1);
    }
}

void us_quic_stream_shutdown_read(us_quic_stream_t *s) {
    if (s->stream) lsquic_stream_shutdown(s->stream, 0);
}

void us_quic_stream_close(us_quic_stream_t *s) {
    if (s->stream) lsquic_stream_close(s->stream);
}

int us_quic_stream_has_unacked(us_quic_stream_t *s) {
    return s->stream ? lsquic_stream_has_unacked_data(s->stream) : 0;
}

void *us_quic_stream_ext(us_quic_stream_t *s) { return s + 1; }

us_quic_socket_t *us_quic_stream_socket(us_quic_stream_t *s) {
    if (!s->stream) return NULL;
    return (us_quic_socket_t *) lsquic_conn_get_ctx(lsquic_stream_conn(s->stream));
}

us_quic_socket_context_t *us_quic_stream_context(us_quic_stream_t *s) { return s->ctx; }

void us_quic_stream_kick(us_quic_stream_t *s) { us_quic_process(s->ctx); }

unsigned int us_quic_stream_header_count(us_quic_stream_t *s) {
    return s->hset ? s->hset->count : 0;
}

const struct us_quic_header_t *us_quic_stream_header(us_quic_stream_t *s, unsigned int i) {
    return s->hset && i < s->hset->count ? &s->hset->headers[i] : NULL;
}

void *us_quic_socket_ext(us_quic_socket_t *s) { return s + 1; }
us_quic_socket_context_t *us_quic_socket_context(us_quic_socket_t *s) { return s->ctx; }

void us_quic_socket_remote_address(us_quic_socket_t *s, char *buf, int *len, int *port, int *is_ipv6) {
    const struct sockaddr *local, *peer;
    *len = 0; *port = 0; *is_ipv6 = 0;
    if (lsquic_conn_get_sockaddr(s->conn, &local, &peer) != 0) return;
    if (peer->sa_family == AF_INET6) {
        const struct sockaddr_in6 *a = (const struct sockaddr_in6 *) peer;
        *port = ntohs(a->sin6_port);
        if (IN6_IS_ADDR_V4MAPPED(&a->sin6_addr)) {
            *len = 4; memcpy(buf, (const char *) &a->sin6_addr + 12, 4);
        } else {
            *is_ipv6 = 1; *len = 16; memcpy(buf, &a->sin6_addr, 16);
        }
    } else {
        const struct sockaddr_in *a = (const struct sockaddr_in *) peer;
        *port = ntohs(a->sin_port);
        *len = 4; memcpy(buf, &a->sin_addr, 4);
    }
}

void us_quic_socket_close(us_quic_socket_t *s) { if (s->conn) lsquic_conn_close(s->conn); }

#endif /* LIBUS_USE_QUIC */
