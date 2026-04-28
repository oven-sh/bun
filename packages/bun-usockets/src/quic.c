#include "quic.h"

#include "internal/internal.h"
#if defined(_WIN32) && !defined(WIN32)
/* lsquic.h gates on WIN32 (not _WIN32) to pick <vc_compat.h> over <sys/uio.h>. */
#define WIN32 1
#endif
/* lsquic gates es_webtransport_server / lsquic_stream_*webtransport* behind
 * this. The lsquic build flips it via -D in scripts/build/deps/lsquic.ts; it
 * has to be repeated for any TU that includes lsquic.h. */
#ifndef LSQUIC_WEBTRANSPORT_SERVER_SUPPORT
#define LSQUIC_WEBTRANSPORT_SERVER_SUPPORT 1
#endif
#include "lsquic.h"
#include "lsxpack_header.h"
#include <openssl/ssl.h>

#include <errno.h>
#include <stdlib.h>
#include <string.h>
#ifndef _WIN32
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/ip.h>
#endif

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

/* One QUIC DATAGRAM queued on a connection. The Quarter Stream ID varint
 * is already prepended so on_dg_write is a single memcpy. */
struct us_quic_dgram {
    struct us_quic_dgram *next;
    struct us_quic_stream_s *session;
    unsigned int len;
    /* payload follows */
};

struct us_quic_socket_context_s {
    struct us_loop_t *loop;
    lsquic_engine_t *engine;
    struct lsquic_engine_settings settings;
    SSL_CTX *ssl_ctx;
    struct us_quic_sni *sni;
    unsigned int sni_count, sni_cap;
    int processing;
    int closing;
    unsigned int conn_count;
    /* Stream bytes written since the last process_conns. Once this exceeds
     * roughly one full sendmmsg(64) batch, flush immediately instead of
     * waiting for loop_post — keeps large bodies streaming while small
     * responses still batch. */
    unsigned int pending_write_bytes;
    struct us_quic_socket_context_s *next; /* loop->data.quic_head list */
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
    void (*on_wt_stream_data)(us_quic_stream_t *, us_quic_stream_t *, const char *, unsigned int, int);
    void (*on_wt_stream_close)(us_quic_stream_t *, us_quic_stream_t *);
    void (*on_datagram)(us_quic_stream_t *, const char *, unsigned int);

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
    /* WebTransport sessions on this connection (intrusive list of CONNECT
     * streams via wt_next_on_conn). Scanned on incoming WT bidi streams and
     * datagrams to resolve Session ID; size bounded by
     * es_max_webtransport_server_streams so a linear walk is fine. */
    struct us_quic_stream_s *wt_sessions;
    /* Outgoing datagram FIFO; on_dg_write pops from head. dgram_bytes
     * is summed across all sessions on the conn. */
    struct us_quic_dgram *dgram_head, *dgram_tail;
    unsigned int dgram_bytes;
    /* ext follows */
};

struct us_quic_stream_s {
    lsquic_stream_t *stream;
    us_quic_socket_context_t *ctx;
    struct us_quic_hset *hset;
    int headers_delivered;
    int fin_delivered;
    /* WebTransport bookkeeping. wt_kind: 0 = HTTP, 1 = CONNECT session,
     * 2 = client bidi data stream. wt_session_id is the CONNECT stream id
     * for kind 2 (cached so we can route after resolve). */
    unsigned char wt_kind;
    lsquic_stream_id_t wt_session_id;
    struct us_quic_stream_s *wt_next_on_conn; /* session list link for kind 1 */
    unsigned int wt_dgram_bytes;              /* per-session buffered datagram bytes */
    /* ext follows */
};

/* ───── process driver ─────
 *
 * lsquic_engine_process_conns is the only call that turns queued stream
 * writes into UDP packets and runs the protocol state machine. It is driven
 * from two places, neither per-write:
 *
 *   1. us_internal_loop_pre / us_internal_loop_post (loop.c) — pre flushes
 *      writes JS made before the I/O wait (timers, immediates, resolved
 *      promises); post runs once after all polls are dispatched, covering
 *      the reactive path (packets arrived → handler ran → response written).
 *   2. lsquic's time-driven state (RTO retransmit, delayed ACK, idle
 *      timeout): the min earliest_adv_tick across engines is written to
 *      loop->data.quic_next_tick_us; Bun's getTimeout() folds it into the
 *      epoll_pwait2 timeout. No timerfd, no scheduling syscall.
 *
 * There is no per-write kick. Http3Response writes call lsquic_stream_write
 * and return; the bytes go out at the next driver tick. Because process_conns
 * never runs from inside an Http3Response method, on_close cannot fire and
 * free the stream while a method is still touching it.
 */

#ifdef LIBUS_USE_LIBUV
static void us_quic_on_timer(struct us_timer_t *t) {
    us_quic_loop_process(us_timer_loop(t));
}
#endif

void us_quic_loop_process(struct us_loop_t *loop) {
    int min_diff = 0, have_tick = 0;
    for (us_quic_socket_context_t *ctx = loop->data.quic_head; ctx; ctx = ctx->next) {
        if (ctx->processing || !ctx->engine) continue;
        ctx->processing = 1;
        ctx->pending_write_bytes = 0;
        lsquic_engine_process_conns(ctx->engine);
        ctx->processing = 0;
        int diff;
        if (lsquic_engine_earliest_adv_tick(ctx->engine, &diff)) {
            if (!have_tick || diff < min_diff) min_diff = diff;
            have_tick = 1;
        }
    }
    /* Relative µs from now (≤0 means "tick due"). On epoll/kqueue,
     * getTimeout() in Timer.zig folds this into the epoll_pwait2 timeout —
     * no timerfd. On libuv there's no equivalent hook into the poll
     * timeout, so arm a fallthrough uv_timer instead. */
    loop->data.quic_next_tick_us = have_tick ? (min_diff < 0 ? 0 : min_diff) : -1;
#ifdef LIBUS_USE_LIBUV
    if (have_tick) {
        if (!loop->data.quic_timer)
            loop->data.quic_timer = us_create_timer(loop, 1, 0);
        int ms = min_diff <= 0 ? 1 : (min_diff + 999) / 1000;
        us_timer_set(loop->data.quic_timer, us_quic_on_timer, ms, 0);
    }
#endif
}

/* Called after the deferred-task queue drains. Only does work when a
 * stream wrote since the last process_conns; the common case is one
 * pointer walk and return. */
void us_quic_loop_flush_if_pending(struct us_loop_t *loop) {
    for (us_quic_socket_context_t *ctx = loop->data.quic_head; ctx; ctx = ctx->next) {
        if (ctx->pending_write_bytes && !ctx->processing) {
            us_quic_loop_process(loop);
            return;
        }
    }
}

static void us_quic_process(us_quic_socket_context_t *ctx) {
    if (ctx->processing || !ctx->engine) return;
    ctx->processing = 1;
    lsquic_engine_process_conns(ctx->engine);
    ctx->processing = 0;
}

/* ───── packets out ───── */

static inline socklen_t sa_len(const struct sockaddr *sa) {
    return sa->sa_family == AF_INET6 ? sizeof(struct sockaddr_in6) : sizeof(struct sockaddr_in);
}

static int us_quic_send_one(LIBUS_SOCKET_DESCRIPTOR fd, const struct lsquic_out_spec *spec) {
#ifdef _WIN32
    /* Winsock has no sendmsg; sendto takes one buffer. iovlen is 1 for every
     * post-handshake packet; coalesced Initial+Handshake during the
     * handshake can be 2-3 iovecs but a QUIC datagram never exceeds one MTU,
     * so flatten into a small stack buffer. */
    const char *buf;
    int len;
    char flat[2048];
    if (spec->iovlen == 1) {
        buf = (const char *) spec->iov[0].iov_base;
        len = (int) spec->iov[0].iov_len;
    } else {
        size_t off = 0;
        for (size_t i = 0; i < spec->iovlen; i++) {
            if (off + spec->iov[i].iov_len > sizeof(flat)) { errno = EMSGSIZE; return -1; }
            memcpy(flat + off, spec->iov[i].iov_base, spec->iov[i].iov_len);
            off += spec->iov[i].iov_len;
        }
        buf = flat;
        len = (int) off;
    }
    int r = sendto(fd, buf, len, 0, spec->dest_sa, sa_len(spec->dest_sa));
    if (r < 0) {
        errno = (WSAGetLastError() == WSAEWOULDBLOCK) ? EAGAIN : EIO;
        return -1;
    }
    return 1;
#else
    struct msghdr msg;
    memset(&msg, 0, sizeof(msg));
    msg.msg_name = (void *) spec->dest_sa;
    msg.msg_namelen = sa_len(spec->dest_sa);
    msg.msg_iov = spec->iov;
    msg.msg_iovlen = spec->iovlen;
    ssize_t r;
    do { r = sendmsg(fd, &msg, 0); } while (r < 0 && errno == EINTR);
    return r < 0 ? -1 : 1;
#endif
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
        /* lsquic only treats EAGAIN/EWOULDBLOCK as backpressure; map any
         * other transient send error (ENOBUFS, EMSGSIZE on a stray jumbo
         * batch, EPERM from a firewall) to EAGAIN so the engine pauses and
         * retries via on_drain → send_unsent_packets instead of dropping
         * the connection. */
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
    /* Don't process here — let loop_post run a single process_conns after
     * every poll has been dispatched so all of this iteration's writes go
     * out in one sendmmsg batch instead of one per recvmmsg burst. */
}

static void us_quic_udp_on_drain(struct us_udp_socket_t *u) {
    us_quic_listen_socket_t *ls = (us_quic_listen_socket_t *) us_udp_socket_user(u);
    if (ls->ctx->engine) lsquic_engine_send_unsent_packets(ls->ctx->engine);
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
    /* QUIC connections share one UDP fd, so they aren't real polls. Count
     * each as a virtual poll so the loop stays alive while conns are open —
     * the same invariant H1 gets from each TCP socket being a us_poll_t.
     * libuv loop liveness is per-handle (uv_ref) rather than per-poll-count;
     * the listen socket's uv_poll_t already keeps the loop alive until
     * conn_count drops to 0 and we close it. */
#ifndef LIBUS_USE_LIBUV
    ctx->loop->num_polls++;
#endif
    ctx->conn_count++;
    if (ctx->on_open) ctx->on_open(qs);
    return (lsquic_conn_ctx_t *) qs;
}

static void us_quic_on_conn_closed(lsquic_conn_t *conn) {
    us_quic_socket_t *qs = (us_quic_socket_t *) lsquic_conn_get_ctx(conn);
    if (!qs) return;
    us_quic_socket_context_t *ctx = qs->ctx;
    if (ctx->on_close) ctx->on_close(qs);
    lsquic_conn_set_ctx(conn, NULL);
    for (struct us_quic_dgram *d = qs->dgram_head; d; ) {
        struct us_quic_dgram *next = d->next;
        free(d);
        d = next;
    }
    free(qs);
#ifndef LIBUS_USE_LIBUV
    ctx->loop->num_polls--;
#endif
    ctx->conn_count--;
    /* During graceful drain the UDP fd is the only thing left holding the
     * loop; release it when the last conn closes so the process can exit. */
    if (ctx->closing && ctx->conn_count == 0) {
        while (ctx->listeners) us_udp_socket_close(ctx->listeners->udp);
    }
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

static us_quic_stream_t *us_quic_find_wt_session(us_quic_socket_t *qs, lsquic_stream_id_t id) {
    if (!qs) return NULL;
    for (us_quic_stream_t *s = qs->wt_sessions; s; s = s->wt_next_on_conn)
        if (lsquic_stream_id(s->stream) == id) return s;
    return NULL;
}

static void us_quic_on_read(lsquic_stream_t *stream, lsquic_stream_ctx_t *h) {
    us_quic_stream_t *s = (us_quic_stream_t *) h;
    us_quic_socket_context_t *ctx = s->ctx;

    if (!s->headers_delivered) {
        /* lsquic's hq filter parses the 0x41 + Session ID prefix on the first
         * read, marks the stream as a WT bidi stream, and disables HTTP
         * framing — there is no header set to claim. Route subsequent reads
         * to the WT data callback instead of the HTTP body path. */
        if (s->wt_kind == 0 && lsquic_stream_is_webtransport_client_bidi_stream(stream)) {
            s->wt_kind = 2;
            s->headers_delivered = 1;
            s->wt_session_id = (lsquic_stream_id_t)
                lsquic_stream_get_webtransport_session_stream_id(stream);
        } else {
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
    }

    /* Re-resolve the session on every read instead of caching across calls:
     * the CONNECT stream can close mid-transfer and there's no back-pointer
     * to invalidate. The session list is bounded (≤16) so the walk is cheap. */
    us_quic_stream_t *session = NULL;
    if (s->wt_kind == 2) {
        us_quic_socket_t *qs = (us_quic_socket_t *) lsquic_conn_get_ctx(lsquic_stream_conn(stream));
        session = us_quic_find_wt_session(qs, s->wt_session_id);
    }

    ssize_t r;
    while ((r = lsquic_stream_read(stream, ctx->read_buf, US_QUIC_READ_BUF)) > 0) {
        if (s->wt_kind == 2) {
            if (ctx->on_wt_stream_data)
                ctx->on_wt_stream_data(s, session, ctx->read_buf, (unsigned int) r, 0);
        } else if (ctx->on_stream_data) {
            ctx->on_stream_data(s, ctx->read_buf, (unsigned int) r, 0);
        }
        if (!s->stream) return;
    }
    if (r == 0 && !s->fin_delivered) {
        s->fin_delivered = 1;
        lsquic_stream_wantread(stream, 0);
        lsquic_stream_shutdown(stream, 0);
        if (s->wt_kind == 2) {
            if (ctx->on_wt_stream_data)
                ctx->on_wt_stream_data(s, session, ctx->read_buf, 0, 1);
        } else if (ctx->on_stream_data) {
            ctx->on_stream_data(s, ctx->read_buf, 0, 1);
        }
    }
}

static void us_quic_on_write(lsquic_stream_t *stream, lsquic_stream_ctx_t *h) {
    us_quic_stream_t *s = (us_quic_stream_t *) h;
    lsquic_stream_wantwrite(stream, 0);
    if (s->ctx->on_stream_writable) s->ctx->on_stream_writable(s);
    /* lsquic_stream_send_headers stashes the QPACK block and writes it from
     * dispatch_write_events into sm_buf, then hands control back here. With
     * a body the next lsquic_stream_write packs it alongside; without one
     * (WebTransport 200, future 1xx-then-wait) it sits buffered. Flush so a
     * STREAM frame is generated regardless. No-op when already flushed. */
    if (s->stream) lsquic_stream_flush(stream);
}

static void us_quic_on_close(lsquic_stream_t *stream, lsquic_stream_ctx_t *h) {
    (void) stream;
    us_quic_stream_t *s = (us_quic_stream_t *) h;
    if (!s) return;
    if (s->wt_kind == 1) {
        /* Unlink from the connection's session list and drop any datagrams
         * we queued for it before the C++ layer learns the session is gone. */
        us_quic_socket_t *qs = us_quic_stream_socket(s);
        if (qs) {
            for (us_quic_stream_t **pp = &qs->wt_sessions; *pp; pp = &(*pp)->wt_next_on_conn) {
                if (*pp == s) { *pp = s->wt_next_on_conn; break; }
            }
            for (struct us_quic_dgram **pp = &qs->dgram_head; *pp; ) {
                struct us_quic_dgram *d = *pp;
                if (d->session == s) {
                    *pp = d->next;
                    qs->dgram_bytes -= d->len;
                    free(d);
                } else pp = &d->next;
            }
            qs->dgram_tail = NULL;
            for (struct us_quic_dgram *d = qs->dgram_head; d; d = d->next) qs->dgram_tail = d;
        }
    }
    if (s->wt_kind == 2) {
        /* RESET_STREAM never delivers fin=1, so the C++ layer's reassembly
         * entry survives. Give it a chance to drop the entry before the
         * stream id is recycled. */
        us_quic_socket_t *qs = us_quic_stream_socket(s);
        us_quic_stream_t *session = qs ? us_quic_find_wt_session(qs, s->wt_session_id) : NULL;
        if (s->ctx->on_wt_stream_close) s->ctx->on_wt_stream_close(s, session);
    }
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

/* ───── datagrams (RFC 9221 frame, RFC 9297 HTTP wrapping) ───── */

/* QUIC varint: read a single value from [p,end). Returns bytes consumed, or
 * 0 if truncated. */
static unsigned int us_quic_varint_read(const unsigned char *p, const unsigned char *end, uint64_t *out) {
    if (p >= end) return 0;
    unsigned int len = 1u << (*p >> 6);
    if ((unsigned int)(end - p) < len) return 0;
    uint64_t v = *p & 0x3f;
    for (unsigned int i = 1; i < len; i++) v = (v << 8) | p[i];
    *out = v;
    return len;
}

static unsigned int us_quic_varint_write(unsigned char *p, uint64_t v) {
    if (v < 64) { p[0] = (unsigned char) v; return 1; }
    if (v < 16384) { p[0] = (unsigned char)(0x40 | (v >> 8)); p[1] = (unsigned char) v; return 2; }
    if (v < 1073741824) {
        p[0] = (unsigned char)(0x80 | (v >> 24)); p[1] = (unsigned char)(v >> 16);
        p[2] = (unsigned char)(v >> 8);           p[3] = (unsigned char) v;
        return 4;
    }
    p[0] = (unsigned char)(0xc0 | (v >> 56));
    for (int i = 1; i < 8; i++) p[i] = (unsigned char)(v >> (8 * (7 - i)));
    return 8;
}

static ssize_t us_quic_on_dg_write(lsquic_conn_t *conn, void *buf, size_t sz) {
    us_quic_socket_t *qs = (us_quic_socket_t *) lsquic_conn_get_ctx(conn);
    if (!qs) return -1;
    /* lsquic's contract: nw >= 0 means "wrote nw bytes" (no skip semantics),
     * so 0 would serialise an empty DATAGRAM frame — invalid HTTP/3 datagram
     * (no Quarter-Stream-ID). Pop oversize entries until one fits or the
     * queue empties; only ever return >0 or -1. */
    for (;;) {
        struct us_quic_dgram *d = qs->dgram_head;
        if (!d) { lsquic_conn_want_datagram_write(conn, 0); return -1; }
        qs->dgram_head = d->next;
        if (!qs->dgram_head) qs->dgram_tail = NULL;
        qs->dgram_bytes -= d->len;
        if (d->session) d->session->wt_dgram_bytes -= d->len;
        if (d->len <= sz) {
            memcpy(buf, d + 1, d->len);
            ssize_t r = (ssize_t) d->len;
            free(d);
            if (qs->dgram_head) lsquic_conn_want_datagram_write(conn, 1);
            return r;
        }
        free(d);
    }
}

static void us_quic_on_datagram(lsquic_conn_t *conn, const void *buf, size_t sz) {
    us_quic_socket_t *qs = (us_quic_socket_t *) lsquic_conn_get_ctx(conn);
    if (!qs || !qs->ctx->on_datagram) return;
    /* RFC 9297 §2.1: payload is Quarter Stream ID varint + HTTP Datagram
     * Payload. Session ID is QSID * 4 (client-initiated bidi). */
    uint64_t qsid;
    unsigned int n = us_quic_varint_read((const unsigned char *) buf,
        (const unsigned char *) buf + sz, &qsid);
    if (!n) return;
    us_quic_stream_t *session = us_quic_find_wt_session(qs, (lsquic_stream_id_t)(qsid * 4));
    if (!session) return;
    qs->ctx->on_datagram(session, (const char *) buf + n, (unsigned int)(sz - n));
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
    .on_dg_write = us_quic_on_dg_write,
    .on_datagram = us_quic_on_datagram,
};

static const struct lsquic_hset_if us_quic_hset_if = {
    .hsi_create_header_set = us_quic_hsi_create,
    .hsi_prepare_decode = us_quic_hsi_prepare,
    .hsi_process_header = us_quic_hsi_process,
    .hsi_discard_header_set = us_quic_hsi_discard,
    .hsi_flags = 0,
};

#ifdef BUN_DEBUG
#include <stdio.h>
static int us_quic_log_buf(void *ctx, const char *buf, size_t len) {
    (void) ctx;
    fwrite(buf, 1, len, stderr);
    fputc('\n', stderr);
    return 0;
}
static const struct lsquic_logger_if us_quic_logger = { us_quic_log_buf };
#endif

/* Called once via a thread-safe static local in uws_h3_create_app
 * (libuwsockets_h3.cpp), so quic.c stays free of pthread/call_once. */
void us_quic_global_init(void) {
    lsquic_global_init(LSQUIC_GLOBAL_SERVER);
#ifdef BUN_DEBUG
    if (getenv("BUN_DEBUG_lsquic")) {
        lsquic_logger_init(&us_quic_logger, NULL, LLTS_HHMMSSUS);
        lsquic_set_log_level("debug");
    }
#endif
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
    /* Static-table-only response encoding: skips the per-header dynamic
     * table search (lsqpack_enc_encode + XXH32 + header_out_dynamic_entry
     * were ~8% of a hello-world profile). Clients still get correct
     * responses; the wire is a few bytes larger per uncommon header. */
    ctx->settings.es_qpack_enc_max_size = 0;
    ctx->settings.es_qpack_enc_max_blocked = 0;
    /* We never set per-stream priority; with this off, lsquic skips the RFC
     * 9218 scheduler and the patched determine_bpt short-circuits the O(N)
     * stream-hash walk on every write. */
    ctx->settings.es_ext_http_prio = 0;
    /* WebTransport: lsquic copies es_* at engine_new time, so flip these
     * unconditionally. Harmless when no wt() route is registered — the
     * SETTINGS frame advertises support, but on_datagram drops anything that
     * doesn't match a registered session and the 0x41 prefix path falls
     * through to a no-op on_wt_stream_data. */
    ctx->settings.es_webtransport_server = 1;
    ctx->settings.es_max_webtransport_server_streams = 16;
    ctx->settings.es_datagrams = 1;
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

    ctx->next = loop->data.quic_head;
    loop->data.quic_head = ctx;

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
    /* GOAWAY every conn and flush; loop_post keeps ticking so in-flight
     * streams drain. New conns are rejected in on_new_conn while closing. */
    lsquic_engine_cooldown(ctx->engine);
    lsquic_engine_send_unsent_packets(ctx->engine);
    us_quic_process(ctx);
    /* Nothing to drain — release the UDP fd now so the loop can exit. */
    if (ctx->conn_count == 0) {
        while (ctx->listeners) us_udp_socket_close(ctx->listeners->udp);
    }
}

void us_quic_socket_context_free(us_quic_socket_context_t *ctx) {
    if (!ctx) return;
    ctx->closing = 1;
    struct us_loop_t *loop = ctx->loop;
    for (us_quic_socket_context_t **pp = &loop->data.quic_head; *pp; pp = &(*pp)->next) {
        if (*pp == ctx) { *pp = ctx->next; break; }
    }
    if (!loop->data.quic_head) loop->data.quic_next_tick_us = -1;
    /* Close any UDP fds the caller never closed (graceful drain leaves them
     * open); on_close moves each into closed_listeners for the loop below. */
    while (ctx->listeners) us_udp_socket_close(ctx->listeners->udp);
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

int us_quic_listen_socket_local_address(us_quic_listen_socket_t *ls, char *buf, int len) {
    if (ls->local.ss_family == AF_INET6) {
        if (len < 16) return 0;
        memcpy(buf, &((struct sockaddr_in6 *) &ls->local)->sin6_addr, 16);
        return 16;
    }
    if (len < 4) return 0;
    memcpy(buf, &((struct sockaddr_in *) &ls->local)->sin_addr, 4);
    return 4;
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
DEF_CB(on_datagram, void (*cb)(us_quic_stream_t *, const char *, unsigned int))
#undef DEF_CB

void us_quic_socket_context_on_wt_stream_data(us_quic_socket_context_t *ctx,
    void (*cb)(us_quic_stream_t *, us_quic_stream_t *, const char *, unsigned int, int)) {
    ctx->on_wt_stream_data = cb;
}
void us_quic_socket_context_on_wt_stream_close(us_quic_socket_context_t *ctx,
    void (*cb)(us_quic_stream_t *, us_quic_stream_t *)) {
    ctx->on_wt_stream_close = cb;
}

int us_quic_stream_write(us_quic_stream_t *s, const char *data, unsigned int len) {
    if (!s->stream) return -1;
    ssize_t w = lsquic_stream_write(s->stream, data, len);
    if (w >= 0 && (unsigned int) w < len) lsquic_stream_wantwrite(s->stream, 1);
    /* pending_write_bytes is the gate for drainQuicIfNecessary / loop_pre.
     * Don't call us_quic_loop_process here — process_conns inside an
     * Http3Response method could free this stream via on_close. */
    if (w > 0) s->ctx->pending_write_bytes += (unsigned int) w;
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
    if (r == 0) {
        if (end_stream) lsquic_stream_shutdown(s->stream, 1);
        /* Mark the context dirty so drainQuicIfNecessary picks up header-only
         * responses (204/304) that never call us_quic_stream_write. */
        s->ctx->pending_write_bytes += (unsigned int) total + 1;
    }
    return r;
}

void us_quic_stream_shutdown(us_quic_stream_t *s) {
    if (s->stream) lsquic_stream_shutdown(s->stream, 1);
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

unsigned long long us_quic_stream_id(us_quic_stream_t *s) {
    return s->stream ? (unsigned long long) lsquic_stream_id(s->stream) : (unsigned long long) -1;
}

void us_quic_stream_set_webtransport_session(us_quic_stream_t *s) {
    if (!s->stream || s->wt_kind == 1) return;
    lsquic_stream_set_webtransport_session(s->stream);
    s->wt_kind = 1;
    /* The 200 HEADERS we just queued via lsquic_stream_send_headers gets
     * stashed and written from lsquic's internal header-block on_write,
     * which then restores our callback but leaves the bytes sitting in
     * sm_buf with wantwrite cleared. Re-arm wantwrite so us_quic_on_write
     * runs once afterwards and flushes them — otherwise the client never
     * sees the 2xx and the session looks half-open. */
    lsquic_stream_wantwrite(s->stream, 1);
    us_quic_socket_t *qs = us_quic_stream_socket(s);
    if (!qs) return;
    s->wt_next_on_conn = qs->wt_sessions;
    qs->wt_sessions = s;
}

int us_quic_stream_send_datagram(us_quic_stream_t *session,
    const char *data, unsigned int len, unsigned int max_queued)
{
    if (!session->stream || session->wt_kind != 1) return -1;
    us_quic_socket_t *qs = us_quic_stream_socket(session);
    if (!qs) return -1;
    /* Prepend Quarter Stream ID (CONNECT stream id / 4). */
    unsigned char prefix[8];
    unsigned int plen = us_quic_varint_write(prefix,
        (uint64_t) lsquic_stream_id(session->stream) / 4);
    unsigned int total = plen + len;
    /* lsquic offers an MTU-bounded buffer in on_dg_write; anything larger is
     * dropped there, so reject up front. 1200 is the QUIC default initial
     * max_udp_payload_size minus headers — conservative but predictable. */
    if (total > 1200) return -1;
    if (max_queued && session->wt_dgram_bytes + total > max_queued) return -2;
    struct us_quic_dgram *d = (struct us_quic_dgram *) malloc(sizeof(*d) + total);
    if (!d) return -1;
    d->next = NULL;
    d->session = session;
    d->len = total;
    memcpy(d + 1, prefix, plen);
    memcpy((char *)(d + 1) + plen, data, len);
    if (qs->dgram_tail) qs->dgram_tail->next = d; else qs->dgram_head = d;
    qs->dgram_tail = d;
    qs->dgram_bytes += total;
    int prev = (int) session->wt_dgram_bytes;
    session->wt_dgram_bytes += total;
    lsquic_conn_want_datagram_write(qs->conn, 1);
    /* Same flush gating as stream writes: bytes go out at the next
     * process_conns, not inline. */
    session->ctx->pending_write_bytes += total;
    return prev;
}

unsigned int us_quic_stream_datagram_buffered(us_quic_stream_t *session) {
    return session->wt_dgram_bytes;
}


unsigned int us_quic_stream_header_count(us_quic_stream_t *s) {
    return s->hset ? s->hset->count : 0;
}

const struct us_quic_header_t *us_quic_stream_header(us_quic_stream_t *s, unsigned int i) {
    return s->hset && i < s->hset->count ? &s->hset->headers[i] : NULL;
}

/* No per-conn ext is allocated (Http3Context only needs per-stream ext). */
void *us_quic_socket_ext(us_quic_socket_t *s) { (void) s; return NULL; }
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
