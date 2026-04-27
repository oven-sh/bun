// h3blast — an HTTP/3 load generator built on lsquic.
//
// Design: one process, N worker threads. Each worker owns one UDP socket,
// one lsquic client engine, and C/N QUIC connections. Each connection keeps
// `streams` request streams in flight at all times. Workers batch UDP I/O
// with sendmmsg/recvmmsg and drive the lsquic timer wheel via epoll. The
// main thread samples per-worker counters at ~10 Hz to render a live TUI,
// then prints a final report with HdrHistogram percentiles.

#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <netdb.h>
#include <netinet/in.h>
#include <pthread.h>
#include <signal.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/timerfd.h>
#include <sys/uio.h>
#include <time.h>
#include <unistd.h>

#include <lsquic.h>
#include <lsxpack_header.h>
#include <openssl/ssl.h>
#include <hdr/hdr_histogram.h>

#define H3B_VERSION "0.1.0"

#define MAX_HEADERS 32
#define RECV_BATCH 64
#define RECV_PKT_SZ 1500
#define SEND_BATCH 1024

// ───────────────────────── ANSI helpers ─────────────────────────

static int g_isatty;
// Colors are %s arguments everywhere so we can blank them at runtime.
static const char *RST = "", *DIM = "", *BLD = "";
static const char *RED = "", *GRN = "", *YLW = "";
static const char *BLU = "", *MAG = "", *CYN = "", *GRY = "";

static void enable_color(void) {
    RST = "\x1b[0m"; DIM = "\x1b[2m"; BLD = "\x1b[1m";
    RED = "\x1b[31m"; GRN = "\x1b[32m"; YLW = "\x1b[33m";
    BLU = "\x1b[34m"; MAG = "\x1b[35m"; CYN = "\x1b[36m"; GRY = "\x1b[90m";
}

static int log_buf(void *ctx, const char *buf, size_t len) {
    return (int)fwrite(buf, 1, len, ctx);
}
static const struct lsquic_logger_if g_logger_if = { .log_buf = log_buf };

// ───────────────────────── shared types ─────────────────────────

struct kv {
    const char *name;
    const char *value;
};

struct config {
    char host[256];
    char port[16];
    char path[2048];
    char authority[300];
    const char *method;
    int threads;
    int connections;
    int streams;
    double duration_s;
    uint64_t max_requests;
    size_t body_len;
    const char *body;
    struct kv extra_headers[MAX_HEADERS];
    int n_extra_headers;
    bool insecure;
    bool quiet;
    bool json;
    bool no_color;
    double warmup_s;
    int sndbuf;
    int rcvbuf;
};

struct worker;

struct conn_ctx {
    struct worker *w;
    lsquic_conn_t *conn;
    unsigned in_flight;
    unsigned target_streams;
    bool handshake_ok;
};

struct stream_ctx {
    struct stream_ctx *next_free;
    struct conn_ctx *c;
    uint64_t start_ns;
    size_t body_off;
    int status;
    bool headers_sent;
    bool counted;
};

struct worker {
    int id;
    pthread_t thread;
    const struct config *cfg;

    int fd;
    int epfd;
    int timerfd;
    struct sockaddr_storage local_sa;
    struct sockaddr_storage peer_sa;
    socklen_t peer_sa_len;

    lsquic_engine_t *engine;
    SSL_CTX *ssl_ctx;
    struct conn_ctx *conns;
    int n_conns;
    struct stream_ctx *sc_free;

    char hdr_buf[4096];
    struct lsxpack_header xhdrs[MAX_HEADERS + 6];
    struct lsquic_http_headers req_headers;

    struct hdr_histogram *hist;

    bool blocked;
    bool stopping;
    char errbuf[256];

    // hot counters — read by main thread without locking
    _Atomic uint64_t req_done;
    _Atomic uint64_t req_2xx;
    _Atomic uint64_t req_3xx;
    _Atomic uint64_t req_4xx;
    _Atomic uint64_t req_5xx;
    _Atomic uint64_t req_other;
    _Atomic uint64_t req_err;
    _Atomic uint64_t bytes_rx;
    _Atomic uint64_t bytes_tx;
    _Atomic uint64_t udp_rx;
    _Atomic uint64_t udp_tx;
    _Atomic uint64_t conns_open;
    _Atomic uint64_t handshake_fail;
};

static volatile sig_atomic_t g_stop;
static volatile sig_atomic_t g_warm;   // set once warmup window has passed
static struct sockaddr_storage g_peer_sa;
static socklen_t g_peer_sa_len;

// ───────────────────────── util ─────────────────────────

static void die(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    fprintf(stderr, "%s%serror%s ", RED, BLD, RST);
    vfprintf(stderr, fmt, ap);
    fputc('\n', stderr);
    va_end(ap);
    exit(1);
}

static uint64_t now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
}

static void on_sigint(int sig) {
    (void)sig;
    if (g_stop) {
        if (g_isatty) write(STDERR_FILENO, "\x1b[?7h\x1b[?25h", 12);
        _exit(130);
    }
    g_stop = 1;
}

static void human_bytes(double n, char *out, size_t outlen) {
    const char *u[] = {"B", "KB", "MB", "GB", "TB"};
    int i = 0;
    while (n >= 1024.0 && i < 4) { n /= 1024.0; i++; }
    snprintf(out, outlen, "%.2f %s", n, u[i]);
}

static void fmt_thousands(uint64_t n, char *out, size_t outlen) {
    char tmp[32];
    int len = snprintf(tmp, sizeof(tmp), "%" PRIu64, n);
    int j = 0;
    for (int i = 0; i < len && (size_t)j < outlen - 1; i++) {
        if (i > 0 && (len - i) % 3 == 0) out[j++] = ',';
        out[j++] = tmp[i];
    }
    out[j] = 0;
}

static void human_count(double n, char *out, size_t outlen) {
    if (n >= 1e9) snprintf(out, outlen, "%.2fB", n / 1e9);
    else if (n >= 1e6) snprintf(out, outlen, "%.2fM", n / 1e6);
    else if (n >= 1e3) snprintf(out, outlen, "%.2fk", n / 1e3);
    else snprintf(out, outlen, "%.0f", n);
}

static void human_latency(double us, char *out, size_t outlen) {
    if (us < 1000.0) snprintf(out, outlen, "%.0fµs", us);
    else if (us < 1e6) snprintf(out, outlen, "%.2fms", us / 1000.0);
    else snprintf(out, outlen, "%.2fs", us / 1e6);
}

// ───────────────────────── header set (response) ─────────────────────────
//
// We only care about :status, so the header-set "object" is just an int*.
// Decode buffer is per-worker scratch (single-threaded inside a worker).

struct hset {
    int status;
    struct lsxpack_header xhdr;
    char buf[512];
};

static void *hsi_create(void *ctx, lsquic_stream_t *s, int is_push) {
    (void)ctx; (void)s; (void)is_push;
    struct hset *h = malloc(sizeof(*h));
    if (h) h->status = 0;
    return h;
}

static struct lsxpack_header *hsi_prepare(void *hset, struct lsxpack_header *xhdr, size_t space) {
    struct hset *h = hset;
    if (space > sizeof(h->buf)) return NULL;
    if (!xhdr) xhdr = &h->xhdr;
    lsxpack_header_prepare_decode(xhdr, h->buf, 0, sizeof(h->buf));
    return xhdr;
}

static int hsi_process(void *hset, struct lsxpack_header *xhdr) {
    if (!xhdr) return 0;
    struct hset *h = hset;
    if (h->status == 0 && xhdr->name_len == 7 &&
        0 == memcmp(xhdr->buf + xhdr->name_offset, ":status", 7)) {
        int s = 0;
        const char *v = xhdr->buf + xhdr->val_offset;
        for (unsigned i = 0; i < xhdr->val_len; i++) s = s * 10 + (v[i] - '0');
        h->status = s;
    }
    return 0;
}

static void hsi_discard(void *hset) { free(hset); }

static const struct lsquic_hset_if g_hset_if = {
    .hsi_create_header_set = hsi_create,
    .hsi_prepare_decode = hsi_prepare,
    .hsi_process_header = hsi_process,
    .hsi_discard_header_set = hsi_discard,
    .hsi_flags = 0,
};

// ───────────────────────── packets out ─────────────────────────

static int packets_out(void *ctx, const struct lsquic_out_spec *specs, unsigned count) {
    struct worker *w = ctx;
    struct mmsghdr m[SEND_BATCH];
    unsigned sent_total = 0;

    while (sent_total < count) {
        unsigned n = count - sent_total;
        if (n > SEND_BATCH) n = SEND_BATCH;
        for (unsigned i = 0; i < n; i++) {
            const struct lsquic_out_spec *s = &specs[sent_total + i];
            m[i].msg_hdr.msg_name = (void *)s->dest_sa;
            m[i].msg_hdr.msg_namelen = (s->dest_sa->sa_family == AF_INET)
                ? sizeof(struct sockaddr_in) : sizeof(struct sockaddr_in6);
            m[i].msg_hdr.msg_iov = s->iov;
            m[i].msg_hdr.msg_iovlen = s->iovlen;
            m[i].msg_hdr.msg_control = NULL;
            m[i].msg_hdr.msg_controllen = 0;
            m[i].msg_hdr.msg_flags = 0;
        }
        int s = sendmmsg(w->fd, m, n, 0);
        if (s < (int)n) {
            if (s > 0) {
                for (int i = 0; i < s; i++)
                    atomic_fetch_add_explicit(&w->bytes_tx, m[i].msg_len, memory_order_relaxed);
                sent_total += (unsigned)s;
            }
            w->blocked = true;
            if (sent_total == 0) {
                errno = (errno == 0) ? EAGAIN : errno;
                return -1;
            }
            errno = EAGAIN;
            return (int)sent_total;
        }
        for (int i = 0; i < s; i++)
            atomic_fetch_add_explicit(&w->bytes_tx, m[i].msg_len, memory_order_relaxed);
        sent_total += (unsigned)s;
    }
    return (int)sent_total;
}

// ───────────────────────── stream callbacks ─────────────────────────

static void conn_pump(struct conn_ctx *cc) {
    if (!cc->handshake_ok || !cc->conn || cc->w->stopping) return;
    // lsquic_conn_make_stream queues a pending stream when no credits are
    // available and fires on_new_stream once MAX_STREAMS arrives, so we
    // deliberately don't gate on n_avail_streams here.
    while (cc->in_flight + lsquic_conn_n_pending_streams(cc->conn) < cc->target_streams)
        lsquic_conn_make_stream(cc->conn);
}

static lsquic_conn_ctx_t *on_new_conn(void *ctx, lsquic_conn_t *conn) {
    (void)ctx;
    struct conn_ctx *cc = (struct conn_ctx *)lsquic_conn_get_ctx(conn);
    cc->conn = conn;
    atomic_fetch_add_explicit(&cc->w->conns_open, 1, memory_order_relaxed);
    return (lsquic_conn_ctx_t *)cc;
}

static void on_hsk_done(lsquic_conn_t *conn, enum lsquic_hsk_status status) {
    struct conn_ctx *cc = (struct conn_ctx *)lsquic_conn_get_ctx(conn);
    if (status == LSQ_HSK_OK || status == LSQ_HSK_RESUMED_OK) {
        cc->handshake_ok = true;
        conn_pump(cc);
    } else {
        atomic_fetch_add_explicit(&cc->w->handshake_fail, 1, memory_order_relaxed);
    }
}

static void on_conn_closed(lsquic_conn_t *conn) {
    struct conn_ctx *cc = (struct conn_ctx *)lsquic_conn_get_ctx(conn);
    if (!cc) return;
    struct worker *w = cc->w;
    atomic_fetch_sub_explicit(&w->conns_open, 1, memory_order_relaxed);
    if (!cc->handshake_ok && !w->stopping && w->errbuf[0] == 0) {
        char buf[200];
        lsquic_conn_status(conn, buf, sizeof(buf));
        snprintf(w->errbuf, sizeof(w->errbuf), "conn closed: %s", buf);
    }
    lsquic_conn_set_ctx(conn, NULL);
    cc->conn = NULL;
}

static lsquic_stream_ctx_t *on_new_stream(void *ctx, lsquic_stream_t *stream) {
    (void)ctx;
    if (!stream) return NULL;
    struct conn_ctx *cc = (struct conn_ctx *)lsquic_conn_get_ctx(lsquic_stream_conn(stream));
    struct worker *w = cc->w;
    struct stream_ctx *sc = w->sc_free;
    if (sc) w->sc_free = sc->next_free;
    else sc = malloc(sizeof(*sc));
    sc->c = cc;
    sc->start_ns = now_ns();
    sc->body_off = 0;
    sc->status = 0;
    sc->headers_sent = false;
    sc->counted = false;
    cc->in_flight++;
    lsquic_stream_wantwrite(stream, 1);
    return (lsquic_stream_ctx_t *)sc;
}

static void on_write(lsquic_stream_t *stream, lsquic_stream_ctx_t *h) {
    struct stream_ctx *sc = (struct stream_ctx *)h;
    struct worker *w = sc->c->w;
    const struct config *cfg = w->cfg;

    if (!sc->headers_sent) {
        sc->headers_sent = true;
        if (lsquic_stream_send_headers(stream, &w->req_headers, 0) != 0) {
            lsquic_stream_close(stream);
            return;
        }
    }
    if (cfg->body_len > sc->body_off) {
        ssize_t n = lsquic_stream_write(stream, cfg->body + sc->body_off, cfg->body_len - sc->body_off);
        if (n < 0) { lsquic_stream_close(stream); return; }
        sc->body_off += (size_t)n;
        if (sc->body_off < cfg->body_len) return;
    }
    lsquic_stream_shutdown(stream, 1);
    lsquic_stream_wantread(stream, 1);
}

static void record_done(struct stream_ctx *sc, bool ok) {
    if (sc->counted) return;
    sc->counted = true;
    if (!g_warm) return;
    struct worker *w = sc->c->w;
    uint64_t lat_us = (now_ns() - sc->start_ns) / 1000;
    if (ok) {
        hdr_record_value(w->hist, (int64_t)lat_us);
        atomic_fetch_add_explicit(&w->req_done, 1, memory_order_relaxed);
        int s = sc->status;
        if (s >= 200 && s < 300) atomic_fetch_add_explicit(&w->req_2xx, 1, memory_order_relaxed);
        else if (s >= 300 && s < 400) atomic_fetch_add_explicit(&w->req_3xx, 1, memory_order_relaxed);
        else if (s >= 400 && s < 500) atomic_fetch_add_explicit(&w->req_4xx, 1, memory_order_relaxed);
        else if (s >= 500 && s < 600) atomic_fetch_add_explicit(&w->req_5xx, 1, memory_order_relaxed);
        else atomic_fetch_add_explicit(&w->req_other, 1, memory_order_relaxed);
    } else {
        atomic_fetch_add_explicit(&w->req_err, 1, memory_order_relaxed);
    }
}

static void on_read(lsquic_stream_t *stream, lsquic_stream_ctx_t *h) {
    struct stream_ctx *sc = (struct stream_ctx *)h;
    struct worker *w = sc->c->w;

    if (sc->status == 0) {
        struct hset *hs = lsquic_stream_get_hset(stream);
        if (hs) {
            sc->status = hs->status;
            free(hs);
        }
    }

    unsigned char buf[16384];
    for (;;) {
        ssize_t n = lsquic_stream_read(stream, buf, sizeof(buf));
        if (n > 0) {
            atomic_fetch_add_explicit(&w->bytes_rx, (uint64_t)n, memory_order_relaxed);
            continue;
        }
        if (n == 0) {
            record_done(sc, true);
            lsquic_stream_shutdown(stream, 0);
            lsquic_stream_wantread(stream, 0);
            return;
        }
        if (errno == EWOULDBLOCK) return;
        record_done(sc, false);
        lsquic_stream_close(stream);
        return;
    }
}

static void on_close(lsquic_stream_t *stream, lsquic_stream_ctx_t *h) {
    (void)stream;
    if (!h) return;
    struct stream_ctx *sc = (struct stream_ctx *)h;
    struct conn_ctx *cc = sc->c;
    if (!sc->counted && !cc->w->stopping) record_done(sc, false);
    cc->in_flight--;
    sc->next_free = cc->w->sc_free;
    cc->w->sc_free = sc;
    conn_pump(cc);
}

static const struct lsquic_stream_if g_stream_if = {
    .on_new_conn = on_new_conn,
    .on_conn_closed = on_conn_closed,
    .on_new_stream = on_new_stream,
    .on_read = on_read,
    .on_write = on_write,
    .on_close = on_close,
    .on_hsk_done = on_hsk_done,
};

// ───────────────────────── worker setup ─────────────────────────

static struct ssl_ctx_st *get_ssl_ctx(void *peer_ctx, const struct sockaddr *unused) {
    (void)unused;
    return ((struct worker *)peer_ctx)->ssl_ctx;
}

static void worker_build_headers(struct worker *w) {
    const struct config *cfg = w->cfg;
    char *p = w->hdr_buf;
    int n = 0;

#define PUSH(NAME, VAL) do { \
        size_t no = (size_t)(p - w->hdr_buf); size_t nl = strlen(NAME); \
        memcpy(p, (NAME), nl); p += nl; \
        size_t vo = (size_t)(p - w->hdr_buf); size_t vl = strlen(VAL); \
        memcpy(p, (VAL), vl); p += vl; \
        lsxpack_header_set_offset2(&w->xhdrs[n], w->hdr_buf, no, nl, vo, vl); \
        n++; \
    } while (0)

    PUSH(":method", cfg->method);
    PUSH(":scheme", "https");
    PUSH(":path", cfg->path);
    PUSH(":authority", cfg->authority);
    PUSH("user-agent", "h3blast/" H3B_VERSION);
    for (int i = 0; i < cfg->n_extra_headers; i++)
        PUSH(cfg->extra_headers[i].name, cfg->extra_headers[i].value);
    if (cfg->body_len) {
        char clen[32];
        snprintf(clen, sizeof(clen), "%zu", cfg->body_len);
        PUSH("content-length", clen);
    }
#undef PUSH

    w->req_headers.count = n;
    w->req_headers.headers = w->xhdrs;
}

static int worker_socket(struct worker *w) {
    int fd = socket(g_peer_sa.ss_family, SOCK_DGRAM | SOCK_NONBLOCK, 0);
    if (fd < 0) return -1;

    if (w->cfg->sndbuf) setsockopt(fd, SOL_SOCKET, SO_SNDBUF, &w->cfg->sndbuf, sizeof(int));
    if (w->cfg->rcvbuf) setsockopt(fd, SOL_SOCKET, SO_RCVBUF, &w->cfg->rcvbuf, sizeof(int));

    struct sockaddr_storage local = {0};
    local.ss_family = g_peer_sa.ss_family;
    socklen_t llen = (local.ss_family == AF_INET) ? sizeof(struct sockaddr_in) : sizeof(struct sockaddr_in6);
    if (bind(fd, (struct sockaddr *)&local, llen) < 0) { close(fd); return -1; }
    getsockname(fd, (struct sockaddr *)&w->local_sa, &llen);

    w->fd = fd;
    memcpy(&w->peer_sa, &g_peer_sa, sizeof(g_peer_sa));
    w->peer_sa_len = g_peer_sa_len;
    return 0;
}

static void worker_recv(struct worker *w) {
    static __thread unsigned char bufs[RECV_BATCH][RECV_PKT_SZ];
    static __thread struct iovec iovs[RECV_BATCH];
    static __thread struct sockaddr_storage peers[RECV_BATCH];
    static __thread struct mmsghdr msgs[RECV_BATCH];

    for (;;) {
        for (int i = 0; i < RECV_BATCH; i++) {
            iovs[i].iov_base = bufs[i];
            iovs[i].iov_len = RECV_PKT_SZ;
            msgs[i].msg_hdr.msg_name = &peers[i];
            msgs[i].msg_hdr.msg_namelen = sizeof(peers[i]);
            msgs[i].msg_hdr.msg_iov = &iovs[i];
            msgs[i].msg_hdr.msg_iovlen = 1;
            msgs[i].msg_hdr.msg_control = NULL;
            msgs[i].msg_hdr.msg_controllen = 0;
            msgs[i].msg_hdr.msg_flags = 0;
        }
        int n = recvmmsg(w->fd, msgs, RECV_BATCH, 0, NULL);
        if (n <= 0) break;
        atomic_fetch_add_explicit(&w->udp_rx, (uint64_t)n, memory_order_relaxed);
        for (int i = 0; i < n; i++) {
            lsquic_engine_packet_in(w->engine, bufs[i], msgs[i].msg_len,
                (struct sockaddr *)&w->local_sa, (struct sockaddr *)&peers[i], w, 0);
        }
        if (n < RECV_BATCH) break;
    }
}

static void worker_schedule(struct worker *w) {
    int diff;
    struct itimerspec its = {0};
    if (lsquic_engine_earliest_adv_tick(w->engine, &diff)) {
        if (diff <= 0) diff = 1;
        its.it_value.tv_sec = diff / 1000000;
        its.it_value.tv_nsec = (diff % 1000000) * 1000;
    } else {
        its.it_value.tv_sec = 1;
    }
    timerfd_settime(w->timerfd, 0, &its, NULL);
}

static void *worker_main(void *arg) {
    struct worker *w = arg;
    const struct config *cfg = w->cfg;

    if (worker_socket(w) < 0) {
        snprintf(w->errbuf, sizeof(w->errbuf), "socket: %s", strerror(errno));
        return NULL;
    }

    w->ssl_ctx = SSL_CTX_new(TLS_method());
    SSL_CTX_set_min_proto_version(w->ssl_ctx, TLS1_3_VERSION);
    SSL_CTX_set_max_proto_version(w->ssl_ctx, TLS1_3_VERSION);
    SSL_CTX_set_session_cache_mode(w->ssl_ctx, SSL_SESS_CACHE_CLIENT);

    hdr_init(1, 60 * 1000 * 1000, 3, &w->hist);
    worker_build_headers(w);

    struct lsquic_engine_settings settings;
    lsquic_engine_init_settings(&settings, LSENG_HTTP);
    settings.es_versions = (1u << LSQVER_I001);
    settings.es_ecn = 0;
    settings.es_ql_bits = 0;
    settings.es_cc_algo = 3; // BBRv1

    char err[200];
    if (lsquic_engine_check_settings(&settings, LSENG_HTTP, err, sizeof(err)) != 0) {
        snprintf(w->errbuf, sizeof(w->errbuf), "settings: %s", err);
        return NULL;
    }

    struct lsquic_engine_api api = {0};
    api.ea_settings = &settings;
    api.ea_stream_if = &g_stream_if;
    api.ea_stream_if_ctx = w;
    api.ea_packets_out = packets_out;
    api.ea_packets_out_ctx = w;
    api.ea_get_ssl_ctx = get_ssl_ctx;
    api.ea_hsi_if = &g_hset_if;
    api.ea_hsi_ctx = w;

    w->engine = lsquic_engine_new(LSENG_HTTP, &api);
    if (!w->engine) {
        snprintf(w->errbuf, sizeof(w->errbuf), "lsquic_engine_new failed");
        return NULL;
    }

    w->conns = calloc((size_t)w->n_conns, sizeof(struct conn_ctx));
    for (int i = 0; i < w->n_conns; i++) {
        w->conns[i].w = w;
        w->conns[i].target_streams = (unsigned)cfg->streams;
        lsquic_conn_t *c = lsquic_engine_connect(w->engine, N_LSQVER,
            (struct sockaddr *)&w->local_sa, (struct sockaddr *)&w->peer_sa,
            w, (lsquic_conn_ctx_t *)&w->conns[i],
            cfg->host, 0, NULL, 0, NULL, 0);
        if (!c) {
            snprintf(w->errbuf, sizeof(w->errbuf), "lsquic_engine_connect failed");
            return NULL;
        }
    }

    w->epfd = epoll_create1(0);
    w->timerfd = timerfd_create(CLOCK_MONOTONIC, TFD_NONBLOCK);
    struct epoll_event ev;
    ev.events = EPOLLIN; ev.data.fd = w->fd;
    epoll_ctl(w->epfd, EPOLL_CTL_ADD, w->fd, &ev);
    ev.events = EPOLLIN; ev.data.fd = w->timerfd;
    epoll_ctl(w->epfd, EPOLL_CTL_ADD, w->timerfd, &ev);

    lsquic_engine_process_conns(w->engine);
    worker_schedule(w);

    struct epoll_event evs[4];
    while (!g_stop) {
        int n = epoll_wait(w->epfd, evs, 4, 100);
        for (int i = 0; i < n; i++) {
            if (evs[i].data.fd == w->fd) {
                if (evs[i].events & EPOLLIN) worker_recv(w);
                if (evs[i].events & EPOLLOUT) {
                    w->blocked = false;
                    ev.events = EPOLLIN; ev.data.fd = w->fd;
                    epoll_ctl(w->epfd, EPOLL_CTL_MOD, w->fd, &ev);
                    lsquic_engine_send_unsent_packets(w->engine);
                }
            } else if (evs[i].data.fd == w->timerfd) {
                uint64_t exp;
                while (read(w->timerfd, &exp, sizeof(exp)) > 0) {}
            }
        }
        lsquic_engine_process_conns(w->engine);
        if (w->blocked) {
            ev.events = EPOLLIN | EPOLLOUT; ev.data.fd = w->fd;
            epoll_ctl(w->epfd, EPOLL_CTL_MOD, w->fd, &ev);
        }
        worker_schedule(w);
    }

    // graceful shutdown
    w->stopping = true;
    for (int i = 0; i < w->n_conns; i++)
        if (w->conns[i].conn) lsquic_conn_close(w->conns[i].conn);
    uint64_t deadline = now_ns() + 500ull * 1000 * 1000;
    while (lsquic_engine_has_unsent_packets(w->engine) && now_ns() < deadline) {
        lsquic_engine_send_unsent_packets(w->engine);
        lsquic_engine_process_conns(w->engine);
    }

    lsquic_engine_destroy(w->engine);
    SSL_CTX_free(w->ssl_ctx);
    close(w->timerfd);
    close(w->epfd);
    close(w->fd);
    return NULL;
}

// ───────────────────────── TUI ─────────────────────────

static const char *spinner_frames[] = {"⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"};

static int g_cols = 72;

static int term_cols(void) {
    struct winsize ws;
    if (ioctl(STDERR_FILENO, TIOCGWINSZ, &ws) == 0 && ws.ws_col > 20)
        g_cols = ws.ws_col > 120 ? 120 : ws.ws_col;
    return g_cols;
}

static void draw_bar(FILE *f, double frac, int width) {
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    int filled = (int)(frac * width);
    for (int i = 0; i < width; i++) fprintf(f, "%s%s", i < filled ? CYN : GRY, i < filled ? "━" : "─");
    fputs(RST, f);
}

static void hr(FILE *f, int w) {
    fputs(GRY, f);
    for (int i = 0; i < w; i++) fputs("─", f);
    fprintf(f, "%s\n", RST);
}

struct snapshot {
    uint64_t done, err, s2, s3, s4, s5, so, rx, tx, conns, hsk_fail;
};

static void collect(struct worker *ws, int n, struct snapshot *out) {
    memset(out, 0, sizeof(*out));
    for (int i = 0; i < n; i++) {
        out->done += atomic_load_explicit(&ws[i].req_done, memory_order_relaxed);
        out->err += atomic_load_explicit(&ws[i].req_err, memory_order_relaxed);
        out->s2 += atomic_load_explicit(&ws[i].req_2xx, memory_order_relaxed);
        out->s3 += atomic_load_explicit(&ws[i].req_3xx, memory_order_relaxed);
        out->s4 += atomic_load_explicit(&ws[i].req_4xx, memory_order_relaxed);
        out->s5 += atomic_load_explicit(&ws[i].req_5xx, memory_order_relaxed);
        out->so += atomic_load_explicit(&ws[i].req_other, memory_order_relaxed);
        out->rx += atomic_load_explicit(&ws[i].bytes_rx, memory_order_relaxed);
        out->tx += atomic_load_explicit(&ws[i].bytes_tx, memory_order_relaxed);
        out->conns += atomic_load_explicit(&ws[i].conns_open, memory_order_relaxed);
        out->hsk_fail += atomic_load_explicit(&ws[i].handshake_fail, memory_order_relaxed);
    }
}

static int g_live_lines;

static void render_live(const struct config *cfg, struct worker *ws, int nw,
                        const struct snapshot *cur, const struct snapshot *prev,
                        double dt, double elapsed, double run_for, int spin) {
    if (!g_isatty || cfg->quiet) return;
    FILE *f = stderr;

    int cols = term_cols();
    int barw = cols - 30; if (barw < 8) barw = 8; if (barw > 50) barw = 50;
    int wbar = cols - 22; if (wbar < 6) wbar = 6; if (wbar > 40) wbar = 40;

    // Rewind and erase the previous frame in one shot — robust to wrapped lines.
    if (g_live_lines) fprintf(f, "\r\x1b[%dA\x1b[J", g_live_lines);

    double rps = dt > 0 ? (double)(cur->done - prev->done) / dt : 0;
    double rxps = dt > 0 ? (double)(cur->rx - prev->rx) / dt : 0;
    double txps = dt > 0 ? (double)(cur->tx - prev->tx) / dt : 0;
    char b_rx[32], b_tx[32], b_rps[32], b_total[32];
    human_bytes(rxps, b_rx, sizeof(b_rx));
    human_bytes(txps, b_tx, sizeof(b_tx));
    human_count(rps, b_rps, sizeof(b_rps));
    human_count((double)cur->done, b_total, sizeof(b_total));

    static double peak_rps;
    if (rps > peak_rps) peak_rps = rps;
    char b_peak[32]; human_count(peak_rps, b_peak, sizeof(b_peak));

    fprintf(f, "  %s%s┃%s %sh3blast%s  %s %s%s:%s%s%s\n",
            BLD, CYN, RST, BLD, RST, cfg->method, DIM, cfg->host, cfg->port, cfg->path, RST);
    fprintf(f, "  %s%s┃%s %dt · %dc · %dm\n\n",
            BLD, CYN, RST, cfg->threads, cfg->connections, cfg->streams);

    fprintf(f, "  %s%s%s  %s%s%12s%s %sreq/s%s   %speak %s%s\n",
            CYN, spinner_frames[spin % 10], RST,
            BLD, GRN, b_rps, RST, DIM, RST, DIM, b_peak, RST);

    fprintf(f, "     %s↓%s %-10s %s↑%s %-10s %sconns%s %-3" PRIu64 " %stotal%s %s\n",
            CYN, RST, b_rx, MAG, RST, b_tx,
            DIM, RST, cur->conns, DIM, RST, b_total);

    fputs("     ", f);
    if (run_for > 0) {
        draw_bar(f, elapsed / run_for, barw);
        fprintf(f, "  %s%.1fs/%.0fs%s%s\n", DIM, elapsed, run_for, g_warm ? "" : " warmup", RST);
    } else {
        fprintf(f, "%s%.1fs%s\n", DIM, elapsed, RST);
    }

    fprintf(f, "     %s2xx%s %-9" PRIu64 " %s4xx%s %-7" PRIu64 " %s5xx%s %-7" PRIu64 " %serr%s %" PRIu64 "\n",
            GRN, RST, cur->s2, YLW, RST, cur->s4,
            RED, RST, cur->s5, RED, RST, cur->err);

    int show_workers = nw > 1 ? (nw < 12 ? nw : 12) : 0;
    if (show_workers) {
        double max_rps = 1;
        static double last_done[256];
        double wrps[256];
        for (int i = 0; i < nw; i++) {
            double d = (double)atomic_load_explicit(&ws[i].req_done, memory_order_relaxed);
            wrps[i] = dt > 0 ? (d - last_done[i]) / dt : 0;
            last_done[i] = d;
            if (wrps[i] > max_rps) max_rps = wrps[i];
        }
        for (int i = 0; i < show_workers; i++) {
            char r[32]; human_count(wrps[i], r, sizeof(r));
            fprintf(f, "     %sw%-2d%s ", DIM, i, RST);
            draw_bar(f, wrps[i] / max_rps, wbar);
            fprintf(f, " %s%7s/s%s\n", DIM, r, RST);
        }
    }

    g_live_lines = 7 + show_workers;
    fflush(f);
}

static void render_final(const struct config *cfg, struct worker *ws, int nw,
                         const struct snapshot *s, double elapsed) {
    FILE *f = stdout;
    struct hdr_histogram *agg;
    hdr_init(1, 60 * 1000 * 1000, 3, &agg);
    for (int i = 0; i < nw; i++)
        if (ws[i].hist) hdr_add(agg, ws[i].hist);

    double rps = elapsed > 0 ? (double)s->done / elapsed : 0;

    if (cfg->json) {
        printf("{\"url\":\"https://%s%s\",\"method\":\"%s\","
               "\"threads\":%d,\"connections\":%d,\"streams\":%d,"
               "\"duration_s\":%.3f,\"requests\":%" PRIu64 ",\"errors\":%" PRIu64 ","
               "\"req_per_sec\":%.2f,\"bytes_rx\":%" PRIu64 ",\"bytes_tx\":%" PRIu64 ","
               "\"throughput_bps\":%.2f,"
               "\"status\":{\"2xx\":%" PRIu64 ",\"3xx\":%" PRIu64 ",\"4xx\":%" PRIu64
               ",\"5xx\":%" PRIu64 ",\"other\":%" PRIu64 "},"
               "\"latency_us\":{\"min\":%" PRId64 ",\"mean\":%.2f,\"stdev\":%.2f,"
               "\"p50\":%" PRId64 ",\"p75\":%" PRId64 ",\"p90\":%" PRId64
               ",\"p99\":%" PRId64 ",\"p999\":%" PRId64 ",\"max\":%" PRId64 "}}\n",
               cfg->authority, cfg->path, cfg->method,
               cfg->threads, cfg->connections, cfg->streams,
               elapsed, s->done, s->err, rps, s->rx, s->tx,
               elapsed > 0 ? (double)s->rx / elapsed : 0,
               s->s2, s->s3, s->s4, s->s5, s->so,
               s->done ? hdr_min(agg) : 0,
               s->done ? hdr_mean(agg) : 0.0,
               s->done ? hdr_stddev(agg) : 0.0,
               hdr_value_at_percentile(agg, 50.0),
               hdr_value_at_percentile(agg, 75.0),
               hdr_value_at_percentile(agg, 90.0),
               hdr_value_at_percentile(agg, 99.0),
               hdr_value_at_percentile(agg, 99.9),
               hdr_max(agg));
        hdr_close(agg);
        return;
    }

    int cols = g_isatty ? term_cols() : 72;
    int hrw = cols - 4; if (hrw > 60) hrw = 60; if (hrw < 20) hrw = 20;
    int barmax = hrw - 22; if (barmax < 6) barmax = 6;

    char b_rx[32], b_tx[32], b_rxps[32], b_total[32];
    fmt_thousands(s->done, b_total, sizeof(b_total));
    human_bytes((double)s->rx, b_rx, sizeof(b_rx));
    human_bytes((double)s->tx, b_tx, sizeof(b_tx));
    human_bytes(elapsed > 0 ? (double)s->rx / elapsed : 0, b_rxps, sizeof(b_rxps));

    fprintf(f, "  %s%s┃%s %sh3blast%s  %s %s%s:%s%s%s\n",
            BLD, CYN, RST, BLD, RST,
            cfg->method, DIM, cfg->host, cfg->port, cfg->path, RST);
    fprintf(f, "  %s%s┃%s %d thread%s · %d connection%s · %d stream%s\n\n",
            BLD, CYN, RST,
            cfg->threads, cfg->threads == 1 ? "" : "s",
            cfg->connections, cfg->connections == 1 ? "" : "s",
            cfg->streams, cfg->streams == 1 ? "" : "s");

    char rps_full[32];
    fmt_thousands((uint64_t)rps, rps_full, sizeof(rps_full));
    fprintf(f, "  ");
    hr(f, hrw);
    fprintf(f, "    %s%s%s%s %sreq/s%s\n", BLD, GRN, rps_full, RST, DIM, RST);
    fprintf(f, "  ");
    hr(f, hrw);
    fprintf(f, "\n  %s%-10s%s %s in %.2fs\n", DIM, "requests", RST, b_total, elapsed);
    fprintf(f, "  %s%-10s%s ↓ %s (%s/s)  ↑ %s\n\n", DIM, "transfer", RST, b_rx, b_rxps, b_tx);

    fprintf(f, "  %sLatency%s\n  ", BLD, RST);
    hr(f, hrw);
    struct { const char *label; double pct; } rows[] = {
        {"min", 0}, {"p50", 50}, {"p75", 75}, {"p90", 90},
        {"p99", 99}, {"p99.9", 99.9}, {"max", 100},
    };
    int64_t maxv = hdr_max(agg);
    if (s->done == 0) maxv = 0;
    for (size_t i = 0; i < sizeof(rows)/sizeof(rows[0]); i++) {
        int64_t v = 0;
        if (s->done == 0) { /* leave at 0 */ }
        else if (rows[i].pct == 0) v = hdr_min(agg);
        else if (rows[i].pct == 100) v = hdr_max(agg);
        else v = hdr_value_at_percentile(agg, rows[i].pct);
        char lat[32]; human_latency((double)v, lat, sizeof(lat));
        int barw = maxv > 0 ? (int)((double)v / (double)maxv * barmax) : 0;
        fprintf(f, "  %s%-7s%s %s%-9s%s ", DIM, rows[i].label, RST, BLD, lat, RST);
        fputs(CYN, f);
        for (int j = 0; j < barw; j++) fputs("▇", f);
        fprintf(f, "%s\n", RST);
    }
    char mean[32], stdd[32];
    human_latency(s->done ? hdr_mean(agg) : 0, mean, sizeof(mean));
    human_latency(s->done ? hdr_stddev(agg) : 0, stdd, sizeof(stdd));
    fprintf(f, "  %s%-7s%s %-9s %s± %s%s\n", DIM, "mean", RST, mean, DIM, stdd, RST);

    fprintf(f, "\n  %sStatus%s\n  ", BLD, RST);
    hr(f, hrw);
    struct { const char *l; const char *c; uint64_t n; } st[] = {
        {"2xx", GRN, s->s2}, {"3xx", BLU, s->s3},
        {"4xx", YLW, s->s4}, {"5xx", RED, s->s5},
        {"other", GRY, s->so}, {"errors", RED, s->err},
    };
    uint64_t total = s->done + s->err;
    for (size_t i = 0; i < sizeof(st)/sizeof(st[0]); i++) {
        if (st[i].n == 0 && i > 0) continue;
        double pct = total ? 100.0 * (double)st[i].n / (double)total : 0;
        int barw = (int)(pct / 100.0 * barmax);
        fprintf(f, "  %s%-7s%s %-10" PRIu64 " %s%5.1f%%%s  %s",
                DIM, st[i].l, RST, st[i].n, DIM, pct, RST, st[i].c);
        for (int j = 0; j < barw; j++) fputs("▇", f);
        fprintf(f, "%s\n", RST);
    }
    if (s->hsk_fail)
        fprintf(f, "  %s%-7s%s %" PRIu64 "\n", RED, "hsk-fail", RST, s->hsk_fail);

    fprintf(f, "\n");
    hdr_close(agg);
}

// ───────────────────────── CLI ─────────────────────────

static void usage(const char *argv0) {
    fprintf(stderr, "\n  %sh3blast%s %s — HTTP/3 load generator (lsquic %s)\n\n"
                    "  %s%s%s [options] <url>\n\n",
            BLD, RST, H3B_VERSION, LSQUIC_VERSION_STR, BLD, argv0, RST);
#define OPT(s, d) fprintf(stderr, "  %s%-24s%s %s\n", CYN, s, RST, d)
    OPT("-t, --threads N",     "worker threads               (default 1)");
    OPT("-c, --connections N", "QUIC connections, total      (default 1)");
    OPT("-m, --streams N",     "concurrent streams per conn  (default 1)");
    OPT("-d, --duration SEC",  "run for SEC seconds          (default 10)");
    OPT("-n, --requests N",    "stop after N total requests");
    OPT("-X, --method M",      "HTTP method                  (default GET)");
    OPT("-H, --header 'k: v'", "add request header (repeatable)");
    OPT("-b, --body STR",      "request body");
    OPT("    --body-file PATH","request body from file");
    OPT("    --warmup SEC",    "discard stats from first SEC seconds");
    OPT("    --sndbuf BYTES",  "SO_SNDBUF");
    OPT("    --rcvbuf BYTES",  "SO_RCVBUF");
    OPT("    --json",          "machine-readable summary, no live UI");
    OPT("    --no-color",      "disable ANSI colors");
    OPT("-q, --quiet",         "no live UI");
    OPT("    --version",       "print version and exit");
    OPT("-h, --help",          "show this help");
#undef OPT
    fprintf(stderr, "\n  %sH3BLAST_DEBUG=<level>%s    lsquic log level (debug, info, …)\n\n",
            DIM, RST);
}

static bool parse_url(const char *url, struct config *cfg) {
    const char *p = url;
    if (strncmp(p, "https://", 8) == 0) p += 8;
    else if (strncmp(p, "http://", 7) == 0) p += 7;

    const char *host_start = p;
    const char *host_end;
    if (*p == '[') {
        host_start++;
        host_end = strchr(p, ']');
        if (!host_end) return false;
        p = host_end + 1;
    } else {
        while (*p && *p != ':' && *p != '/') p++;
        host_end = p;
    }
    size_t hl = (size_t)(host_end - host_start);
    if (hl >= sizeof(cfg->host)) return false;
    memcpy(cfg->host, host_start, hl); cfg->host[hl] = 0;

    if (*p == ':') {
        p++;
        const char *ps = p;
        while (*p && *p != '/') p++;
        size_t pl = (size_t)(p - ps);
        if (pl >= sizeof(cfg->port)) return false;
        memcpy(cfg->port, ps, pl); cfg->port[pl] = 0;
    } else {
        strcpy(cfg->port, "443");
    }

    if (*p == 0) strcpy(cfg->path, "/");
    else snprintf(cfg->path, sizeof(cfg->path), "%s", p);

    if (strcmp(cfg->port, "443") == 0)
        snprintf(cfg->authority, sizeof(cfg->authority), "%s", cfg->host);
    else
        snprintf(cfg->authority, sizeof(cfg->authority), "%s:%s", cfg->host, cfg->port);
    return true;
}

static int parse_args(int argc, char **argv, struct config *cfg) {
    cfg->method = "GET";
    cfg->threads = 1;
    cfg->connections = 1;
    cfg->streams = 1;
    cfg->duration_s = 10.0;
    cfg->insecure = true;

    const char *url = NULL;
    for (int i = 1; i < argc; i++) {
        const char *a = argv[i];
        #define NEXT() ({ if (++i >= argc) die("missing value for %s", a); argv[i]; })
        if (!strcmp(a, "-t") || !strcmp(a, "--threads")) cfg->threads = atoi(NEXT());
        else if (!strcmp(a, "-c") || !strcmp(a, "--connections")) cfg->connections = atoi(NEXT());
        else if (!strcmp(a, "-m") || !strcmp(a, "--streams")) cfg->streams = atoi(NEXT());
        else if (!strcmp(a, "-d") || !strcmp(a, "--duration")) cfg->duration_s = atof(NEXT());
        else if (!strcmp(a, "-n") || !strcmp(a, "--requests")) { cfg->max_requests = strtoull(NEXT(), NULL, 10); cfg->duration_s = 0; }
        else if (!strcmp(a, "-X") || !strcmp(a, "--method")) cfg->method = NEXT();
        else if (!strcmp(a, "-b") || !strcmp(a, "--body")) { cfg->body = NEXT(); cfg->body_len = strlen(cfg->body); }
        else if (!strcmp(a, "--body-file")) {
            const char *path = NEXT();
            FILE *bf = fopen(path, "rb");
            if (!bf) die("cannot open %s: %s", path, strerror(errno));
            fseek(bf, 0, SEEK_END); long sz = ftell(bf); fseek(bf, 0, SEEK_SET);
            char *buf = malloc((size_t)sz);
            fread(buf, 1, (size_t)sz, bf); fclose(bf);
            cfg->body = buf; cfg->body_len = (size_t)sz;
        }
        else if (!strcmp(a, "-H") || !strcmp(a, "--header")) {
            if (cfg->n_extra_headers >= MAX_HEADERS) die("too many -H headers");
            char *h = strdup(NEXT());
            char *colon = strchr(h, ':');
            if (!colon) die("bad header (need 'name: value'): %s", h);
            *colon = 0; colon++;
            while (*colon == ' ') colon++;
            for (char *c = h; *c; c++) if (*c >= 'A' && *c <= 'Z') *c += 32;
            cfg->extra_headers[cfg->n_extra_headers++] = (struct kv){h, colon};
        }
        else if (!strcmp(a, "--json")) { cfg->json = true; cfg->quiet = true; }
        else if (!strcmp(a, "--no-color") || !strcmp(a, "--plain")) cfg->no_color = true;
        else if (!strcmp(a, "--warmup")) cfg->warmup_s = atof(NEXT());
        else if (!strcmp(a, "-k") || !strcmp(a, "--insecure")) cfg->insecure = true;
        else if (!strcmp(a, "--version")) { printf("h3blast %s (lsquic %s)\n", H3B_VERSION, LSQUIC_VERSION_STR); exit(0); }
        else if (!strcmp(a, "--sndbuf")) cfg->sndbuf = atoi(NEXT());
        else if (!strcmp(a, "--rcvbuf")) cfg->rcvbuf = atoi(NEXT());
        else if (!strcmp(a, "-q") || !strcmp(a, "--quiet")) cfg->quiet = true;
        else if (!strcmp(a, "-h") || !strcmp(a, "--help")) { usage(argv[0]); exit(0); }
        else if (a[0] == '-') die("unknown option: %s", a);
        else url = a;
        #undef NEXT
    }
    if (!url) { usage(argv[0]); die("missing <url>"); }
    if (!parse_url(url, cfg)) die("could not parse url: %s", url);
    if (cfg->threads < 1) cfg->threads = 1;
    if (cfg->connections < cfg->threads) cfg->connections = cfg->threads;
    if (cfg->streams < 1) cfg->streams = 1;
    return 0;
}

// ───────────────────────── main ─────────────────────────

int main(int argc, char **argv) {
    g_isatty = isatty(STDERR_FILENO) && isatty(STDOUT_FILENO);
    if (g_isatty && !getenv("NO_COLOR")) enable_color();

    struct config cfg = {0};
    parse_args(argc, argv, &cfg);
    if (cfg.no_color || cfg.json) { RST=DIM=BLD=RED=GRN=YLW=BLU=MAG=CYN=GRY=""; }
    if (cfg.json || cfg.quiet) g_isatty = 0;

    // resolve
    struct addrinfo hints = {0}, *res;
    hints.ai_socktype = SOCK_DGRAM;
    int rc = getaddrinfo(cfg.host, cfg.port, &hints, &res);
    if (rc != 0) die("getaddrinfo(%s:%s): %s", cfg.host, cfg.port, gai_strerror(rc));
    memcpy(&g_peer_sa, res->ai_addr, res->ai_addrlen);
    g_peer_sa_len = res->ai_addrlen;
    freeaddrinfo(res);

    if (lsquic_global_init(LSQUIC_GLOBAL_CLIENT) != 0)
        die("lsquic_global_init failed");

    const char *dbg = getenv("H3BLAST_DEBUG");
    if (dbg) {
        lsquic_logger_init(&g_logger_if, stderr, LLTS_HHMMSSUS);
        lsquic_set_log_level(dbg);
    }

    signal(SIGINT, on_sigint);
    signal(SIGTERM, on_sigint);
    signal(SIGPIPE, SIG_IGN);

    int nw = cfg.threads;
    struct worker *ws = calloc((size_t)nw, sizeof(struct worker));
    int conns_left = cfg.connections;
    for (int i = 0; i < nw; i++) {
        ws[i].id = i;
        ws[i].cfg = &cfg;
        ws[i].n_conns = conns_left / (nw - i);
        conns_left -= ws[i].n_conns;
    }

    if (g_isatty && !cfg.quiet) fputs("\n\x1b[?7l\x1b[?25l", stderr);
    if (cfg.warmup_s <= 0) g_warm = 1;

    for (int i = 0; i < nw; i++)
        pthread_create(&ws[i].thread, NULL, worker_main, &ws[i]);

    uint64_t start = now_ns();
    uint64_t stats_start = start;
    struct snapshot prev = {0}, cur;
    uint64_t last = start;
    int spin = 0;
    double run_for = cfg.duration_s + cfg.warmup_s;

    for (;;) {
        usleep(100 * 1000);
        uint64_t t = now_ns();
        double elapsed = (double)(t - start) / 1e9;
        double dt = (double)(t - last) / 1e9;
        last = t;
        if (!g_warm && elapsed >= cfg.warmup_s) {
            g_warm = 1;
            stats_start = t;
        }
        collect(ws, nw, &cur);
        render_live(&cfg, ws, nw, &cur, &prev, dt, elapsed, run_for, spin++);
        prev = cur;

        if (g_stop) break;
        if (cfg.duration_s > 0 && elapsed >= run_for) { g_stop = 1; break; }
        if (cfg.max_requests && cur.done >= cfg.max_requests) { g_stop = 1; break; }
        if (cur.hsk_fail >= (uint64_t)cfg.connections && cur.done == 0 && elapsed > 1) { g_stop = 1; break; }
    }

    for (int i = 0; i < nw; i++) pthread_join(ws[i].thread, NULL);

    if (g_isatty && !cfg.quiet) {
        if (g_live_lines) fprintf(stderr, "\r\x1b[%dA\x1b[J", g_live_lines);
        fputs("\x1b[?7h\x1b[?25h", stderr);
    }

    double elapsed = (double)(now_ns() - stats_start) / 1e9;
    collect(ws, nw, &cur);

    for (int i = 0; i < nw; i++)
        if (ws[i].errbuf[0]) fprintf(stderr, "  %sw%d%s %s\n", RED, i, RST, ws[i].errbuf);

    render_final(&cfg, ws, nw, &cur, elapsed);

    lsquic_global_cleanup();
    return (cur.done == 0) ? 1 : 0;
}
