#include "internal/internal.h"
#include "lsquic.h"
#include "lsxpack_header.h"
#include <openssl/ssl.h>
#include <stdlib.h>
#include <string.h>

struct us_nq_vtable {
    void *owner;
    void *(*on_new_conn)(void *owner, lsquic_conn_t *c);
    void (*on_hsk_done)(void *conn_ctx, int status);
    void (*on_hsk_confirmed)(void *conn_ctx);
    void (*on_goaway_received)(void *conn_ctx);
    void (*on_conn_closed)(void *conn_ctx);
    void (*on_conncloseframe)(void *conn_ctx, int app_error, uint64_t code,
                              const char *reason, int reason_len);
    void (*on_new_token)(void *conn_ctx, const unsigned char *token,
                         size_t token_size);
    void (*on_sess_resume)(void *conn_ctx, const unsigned char *blob,
                           size_t blob_size);
    void *(*on_new_stream)(void *owner, lsquic_stream_t *s);
    void (*on_stream_read)(void *stream_ctx, lsquic_stream_t *s);
    void (*on_stream_write)(void *stream_ctx, lsquic_stream_t *s);
    void (*on_stream_close)(void *stream_ctx, lsquic_stream_t *s);
    void (*on_stream_reset)(void *stream_ctx, int how, uint64_t error_code);
    ssize_t (*on_dg_write)(void *conn_ctx, void *buf, size_t buf_sz);
    void (*on_datagram)(void *conn_ctx, const void *buf, size_t sz);
    void (*on_datagram_status)(void *conn_ctx, unsigned count, int acked);
    void (*on_early_data_failed)(void *conn_ctx);
    void (*on_path_switch)(void *conn_ctx, int validated, int is_preferred,
                           const struct sockaddr *new_local,
                           const struct sockaddr *new_peer,
                           const struct sockaddr *old_local,
                           const struct sockaddr *old_peer);
    void (*on_origin)(void *conn_ctx, const unsigned char *chunk, size_t len,
                      int fin);
    SSL_CTX *(*get_ssl_ctx)(void *owner, const struct sockaddr *local);
    SSL_CTX *(*get_client_ssl_ctx)(void *owner, const struct sockaddr *local);
    SSL_CTX *(*lookup_cert)(void *owner, const struct sockaddr *local,
                            const char *sni);
    int (*packets_out)(void *owner, const struct lsquic_out_spec *specs,
                       unsigned n);
    void (*on_mini_conn_failed)(void *owner, const struct sockaddr *peer_sa,
                                uint64_t error_code);
};

static lsquic_conn_ctx_t *nq_on_new_conn(void *if_ctx, lsquic_conn_t *c) {
    void *existing = (void *) lsquic_conn_get_ctx(c);
    if (existing) return (lsquic_conn_ctx_t *) existing;
    struct us_nq_vtable *vt = if_ctx;
    return (lsquic_conn_ctx_t *) vt->on_new_conn(vt->owner, c);
}
static void nq_on_conn_closed(lsquic_conn_t *c) {
    void *ctx = (void *) lsquic_conn_get_ctx(c);
    lsquic_conn_set_ctx(c, NULL);
    if (ctx) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) ctx;
        vt->on_conn_closed(ctx);
    }
}
static void nq_on_hsk_done(lsquic_conn_t *c, enum lsquic_hsk_status s) {
    void *ctx = (void *) lsquic_conn_get_ctx(c);
    if (ctx) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) ctx;
        vt->on_hsk_done(ctx, (int) s);
    }
}
static void nq_on_mini_conn_failed(void *if_ctx, const struct sockaddr *peer_sa,
                                   uint64_t error_code) {
    struct us_nq_vtable *vt = if_ctx;
    vt->on_mini_conn_failed(vt->owner, peer_sa, error_code);
}
static void nq_on_hsk_confirmed(lsquic_conn_t *c) {
    void *ctx = (void *) lsquic_conn_get_ctx(c);
    if (ctx) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) ctx;
        vt->on_hsk_confirmed(ctx);
    }
}
static void nq_on_goaway_received(lsquic_conn_t *c) {
    void *ctx = (void *) lsquic_conn_get_ctx(c);
    if (ctx) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) ctx;
        vt->on_goaway_received(ctx);
    }
}
static void nq_on_conncloseframe(lsquic_conn_t *c, int app_error, uint64_t code,
                                 const char *reason, int reason_len) {
    void *ctx = (void *) lsquic_conn_get_ctx(c);
    if (ctx) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) ctx;
        vt->on_conncloseframe(ctx, app_error, code, reason, reason_len);
    }
}
static void nq_on_new_token(lsquic_conn_t *c, const unsigned char *t, size_t n) {
    void *ctx = (void *) lsquic_conn_get_ctx(c);
    if (ctx) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) ctx;
        vt->on_new_token(ctx, t, n);
    }
}
static void nq_on_sess_resume(lsquic_conn_t *c, const unsigned char *b, size_t n) {
    void *ctx = (void *) lsquic_conn_get_ctx(c);
    if (ctx) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) ctx;
        vt->on_sess_resume(ctx, b, n);
    }
}
static lsquic_stream_ctx_t *nq_on_new_stream(void *if_ctx, lsquic_stream_t *s) {
    struct us_nq_vtable *vt = if_ctx;
    return (lsquic_stream_ctx_t *) vt->on_new_stream(vt->owner, s);
}
static void nq_on_read(lsquic_stream_t *s, lsquic_stream_ctx_t *h) {
    if (h) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) h;
        vt->on_stream_read(h, s);
    }
}
static void nq_on_write(lsquic_stream_t *s, lsquic_stream_ctx_t *h) {
    if (h) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) h;
        vt->on_stream_write(h, s);
    }
}
static void nq_on_stream_close(lsquic_stream_t *s, lsquic_stream_ctx_t *h) {
    if (h) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) h;
        vt->on_stream_close(h, s);
    }
}
static void nq_on_reset(lsquic_stream_t *s, lsquic_stream_ctx_t *h, int how) {
    if (h) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) h;
        vt->on_stream_reset(h, how, lsquic_stream_get_error_code(s));
    }
}
static ssize_t nq_on_dg_write(lsquic_conn_t *c, void *buf, size_t sz) {
    void *ctx = (void *) lsquic_conn_get_ctx(c);
    /* -1 is "nothing written": lsquic frames any return >= 0, so 0 would put
     * an empty DATAGRAM frame on the wire. */
    if (!ctx) return -1;
    struct us_nq_vtable *vt = *(struct us_nq_vtable **) ctx;
    return vt->on_dg_write(ctx, buf, sz);
}
static void nq_on_datagram(lsquic_conn_t *c, const void *buf, size_t sz) {
    void *ctx = (void *) lsquic_conn_get_ctx(c);
    if (ctx) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) ctx;
        vt->on_datagram(ctx, buf, sz);
    }
}
static void nq_on_datagram_status(lsquic_conn_t *c, unsigned count, int acked) {
    void *ctx = (void *) lsquic_conn_get_ctx(c);
    if (ctx) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) ctx;
        vt->on_datagram_status(ctx, count, acked);
    }
}
static void nq_on_early_data_failed(lsquic_conn_t *c) {
    void *ctx = (void *) lsquic_conn_get_ctx(c);
    if (ctx) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) ctx;
        vt->on_early_data_failed(ctx);
    }
}
static void nq_on_origin(lsquic_conn_t *c, const unsigned char *chunk,
                         size_t len, int fin) {
    void *ctx = (void *) lsquic_conn_get_ctx(c);
    if (ctx) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) ctx;
        vt->on_origin(ctx, chunk, len, fin);
    }
}
static void nq_on_path_switch(lsquic_conn_t *c, int validated, int is_preferred,
                              const struct sockaddr *new_local,
                              const struct sockaddr *new_peer,
                              const struct sockaddr *old_local,
                              const struct sockaddr *old_peer) {
    void *ctx = (void *) lsquic_conn_get_ctx(c);
    if (ctx) {
        struct us_nq_vtable *vt = *(struct us_nq_vtable **) ctx;
        vt->on_path_switch(ctx, validated, is_preferred, new_local, new_peer,
                           old_local, old_peer);
    }
}

#define US_NQ_HSET_MIN_BUF 256

struct nq_hset {
    struct lsxpack_header xhdr;
    char *decode_buf;
    size_t decode_cap;
    char *pairs;
    size_t pairs_len;
    size_t pairs_cap;
    unsigned max_pairs;
    unsigned max_bytes;
    unsigned n_pairs;
    size_t total_bytes;
};

#define NQ_HSI_CTX_PACK(pairs, bytes) \
    ((void *) (((uintptr_t) ((pairs) & 0xffffu) << 32) | (uintptr_t) (uint32_t) (bytes)))

static void *nq_hsi_create_header_set(void *ctx, lsquic_stream_t *s,
                                      int is_push) {
    (void) s; (void) is_push;
    struct nq_hset *h = calloc(1, sizeof(struct nq_hset));
    if (h) {
        h->max_pairs = (unsigned) (((uintptr_t) ctx >> 32) & 0xffffu);
        h->max_bytes = (unsigned) (uint32_t) (uintptr_t) ctx;
    }
    return h;
}
static struct lsxpack_header *nq_hsi_prepare_decode(void *hset,
                                                    struct lsxpack_header *hdr,
                                                    size_t space) {
    struct nq_hset *h = hset;
    if (space > LSXPACK_MAX_STRLEN)
        return NULL;
    if (space > h->decode_cap) {
        size_t want = space < US_NQ_HSET_MIN_BUF ? US_NQ_HSET_MIN_BUF : space;
        char *nb = realloc(h->decode_buf, want);
        if (!nb) return NULL;
        h->decode_buf = nb;
        h->decode_cap = want;
    }
    if (hdr) {
        hdr->buf = h->decode_buf;
        hdr->val_len = (lsxpack_strlen_t) h->decode_cap;
        return hdr;
    }
    lsxpack_header_prepare_decode(&h->xhdr, h->decode_buf, 0, h->decode_cap);
    return &h->xhdr;
}
static int nq_hsi_process_header(void *hset, struct lsxpack_header *hdr) {
    struct nq_hset *h = hset;
    if (!hdr)
        return 0;
    /* Dropped per Node's DefaultApplication semantics. */
    if (h->max_pairs && h->n_pairs >= h->max_pairs)
        return 0;
    if (h->max_bytes
            && h->total_bytes + hdr->name_len + hdr->val_len > h->max_bytes)
        return 0;
    h->n_pairs++;
    h->total_bytes += (size_t) hdr->name_len + hdr->val_len;
    const char *name = lsxpack_header_get_name(hdr);
    const char *val = lsxpack_header_get_value(hdr);
    /* RFC 9114 4.1.2 makes such a field invalid. */
    if ((hdr->name_len && memchr(name, 0, hdr->name_len))
            || (hdr->val_len && memchr(val, 0, hdr->val_len)))
        return -1;
    size_t need = h->pairs_len + (size_t) hdr->name_len + 1
                + (size_t) hdr->val_len + 1;
    if (need > h->pairs_cap) {
        size_t want = h->pairs_cap ? h->pairs_cap * 2 : US_NQ_HSET_MIN_BUF;
        while (want < need) want *= 2;
        char *nb = realloc(h->pairs, want);
        if (!nb) return -1;
        h->pairs = nb;
        h->pairs_cap = want;
    }
    if (hdr->name_len)
        memcpy(h->pairs + h->pairs_len, name, hdr->name_len);
    h->pairs_len += hdr->name_len;
    h->pairs[h->pairs_len++] = 0;
    if (hdr->val_len)
        memcpy(h->pairs + h->pairs_len, val, hdr->val_len);
    h->pairs_len += hdr->val_len;
    h->pairs[h->pairs_len++] = 0;
    return 0;
}
static void nq_hsi_discard_header_set(void *hset) {
    struct nq_hset *h = hset;
    if (!h) return;
    free(h->decode_buf);
    free(h->pairs);
    free(h);
}

static const struct lsquic_hset_if nq_hset_if = {
    .hsi_create_header_set = nq_hsi_create_header_set,
    .hsi_prepare_decode = nq_hsi_prepare_decode,
    .hsi_process_header = nq_hsi_process_header,
    .hsi_discard_header_set = nq_hsi_discard_header_set,
    .hsi_flags = 0,
};

const char *us_nq_hset_pairs(void *hset, size_t *len) {
    struct nq_hset *h = hset;
    *len = h ? h->pairs_len : 0;
    return h ? h->pairs : NULL;
}
void us_nq_hset_free(void *hset) { nq_hsi_discard_header_set(hset); }

#define US_NQ_MAX_HEADERS 128
int us_nq_stream_send_headers(lsquic_stream_t *s, const char *buf, size_t len,
                              int expected, int eos) {
    struct lsxpack_header hdrs[US_NQ_MAX_HEADERS];
    int count = 0;
    size_t i = 0;
    if (expected < 0 || expected > US_NQ_MAX_HEADERS) return -1;
    while (i < len) {
        /* The caller's pair count is authoritative: latin1 encoding of the
         * NUL-joined buffer maps U+0100-style code points onto the delimiter,
         * which would otherwise splice extra headers out of one user value
         * (node/src/node_http_common-inl.h bails the same way on n >= count_). */
        if (count >= expected) return -1;
        size_t name_off = i;
        while (i < len && buf[i]) i++;
        size_t name_len = i - name_off;
        if (i >= len) break;
        i++;
        size_t val_off = i;
        while (i < len && buf[i]) i++;
        size_t val_len = i - val_off;
        if (i >= len) break;
        i++;
        unsigned char flags = (i < len) ? (unsigned char) buf[i++] : 0;
        if (name_len > LSXPACK_MAX_STRLEN || val_len > LSXPACK_MAX_STRLEN)
            return -1;
        lsxpack_header_set_offset2(&hdrs[count], buf, name_off, name_len,
                                   val_off, val_len);
        if (flags & 1) {
            hdrs[count].flags = LSXPACK_NEVER_INDEX;
            hdrs[count].indexed_type = 2;
        }
        count++;
    }
    if (count != expected) return -1;
    lsquic_http_headers_t list = { count, hdrs };
    return lsquic_stream_send_headers(s, &list, eos);
}

static const struct lsquic_stream_if nq_stream_if = {
    .on_new_conn = nq_on_new_conn,
    .on_conn_closed = nq_on_conn_closed,
    .on_new_stream = nq_on_new_stream,
    .on_read = nq_on_read,
    .on_write = nq_on_write,
    .on_close = nq_on_stream_close,
    .on_hsk_done = nq_on_hsk_done,
    .on_hsk_confirmed = nq_on_hsk_confirmed,
    .on_mini_conn_failed = nq_on_mini_conn_failed,
    .on_goaway_received = nq_on_goaway_received,
    .on_new_token = nq_on_new_token,
    .on_sess_resume_info = nq_on_sess_resume,
    .on_reset = nq_on_reset,
    .on_conncloseframe_received = nq_on_conncloseframe,
    .on_dg_write = nq_on_dg_write,
    .on_datagram = nq_on_datagram,
    .on_datagram_status = nq_on_datagram_status,
    .on_early_data_failed = nq_on_early_data_failed,
    .on_path_switch = nq_on_path_switch,
    .on_origin = nq_on_origin,
};

static SSL_CTX *nq_get_ssl_ctx(void *peer_ctx, const struct sockaddr *local) {
    struct us_nq_vtable *vt = *(struct us_nq_vtable **) peer_ctx;
    return vt->get_ssl_ctx(vt->owner, local);
}
static SSL_CTX *nq_get_client_ssl_ctx(void *peer_ctx, const struct sockaddr *local) {
    struct us_nq_vtable *vt = *(struct us_nq_vtable **) peer_ctx;
    return vt->get_client_ssl_ctx(vt->owner, local);
}
static SSL_CTX *nq_lookup_cert(void *cert_ctx, const struct sockaddr *local,
                               const char *sni) {
    struct us_nq_vtable *vt = cert_ctx;
    return vt->lookup_cert(vt->owner, local, sni);
}
static int nq_packets_out(void *out_ctx, const struct lsquic_out_spec *specs,
                          unsigned n) {
    struct us_nq_vtable *vt = out_ctx;
    return vt->packets_out(vt->owner, specs, n);
}

static int nq_log_buf(void *ctx, const char *buf, size_t len) {
    (void) ctx;
    fwrite(buf, 1, len, stderr);
    fputc('\n', stderr);
    return 0;
}
static const struct lsquic_logger_if nq_logger = { nq_log_buf };

void us_nq_enable_logging(const char *level) {
    lsquic_logger_init(&nq_logger, NULL, LLTS_HHMMSSUS);
    lsquic_set_log_level(level);
}

size_t us_nq_vtable_size(void) { return sizeof(struct us_nq_vtable); }

struct us_nq_tp {
    uint64_t initial_max_stream_data_bidi_local;
    uint64_t initial_max_stream_data_bidi_remote;
    uint64_t initial_max_stream_data_uni;
    uint64_t initial_max_data;
    uint64_t initial_max_streams_bidi;
    uint64_t initial_max_streams_uni;
    uint64_t max_idle_timeout;
    uint64_t max_udp_payload_size;
    uint64_t ack_delay_exponent;
    uint64_t max_ack_delay;
    uint64_t active_connection_id_limit;
    uint64_t max_datagram_frame_size;
    int      disable_active_migration;
    char     initial_scid[2 * MAX_CID_LEN + 1];
    char     retry_scid[2 * MAX_CID_LEN + 1];
    char     original_dcid[2 * MAX_CID_LEN + 1];
};

extern int lsquic_conn_transport_params(const lsquic_conn_t *c, int peer,
                                        struct us_nq_tp *out);

int us_nq_conn_transport_params(const lsquic_conn_t *c, int peer,
                                struct us_nq_tp *out) {
    return lsquic_conn_transport_params(c, peer, out);
}

size_t us_nq_tp_size(void) { return sizeof(struct us_nq_tp); }

size_t us_nq_settings_size(void) { return sizeof(struct lsquic_engine_settings); }

void us_nq_settings_init(struct lsquic_engine_settings *s, int is_server,
                         int is_http) {
    unsigned flags = (is_server ? LSENG_SERVER : 0) | (is_http ? LSENG_HTTP : 0);
    lsquic_engine_init_settings(s, flags);
    s->es_versions = (1u << LSQVER_I001) | (1u << LSQVER_I002);
    s->es_ecn = 0;
    /* Static-table-only encoding, as quic.c does. The dynamic table also makes
     * the decoder stream carry acks, and lsquic delays a server's MAX_STREAMS
     * grant while that stream has unsent data (lsquic_qdh_arm_if_unsent). */
    s->es_qpack_enc_max_size = 0;
    s->es_qpack_enc_max_blocked = 0;
}

#define NQ_SET(field, ctype) \
    void us_nq_settings_set_##field(struct lsquic_engine_settings *s, ctype v) { s->es_##field = v; }
NQ_SET(idle_timeout, unsigned)
NQ_SET(idle_timeout_ms, unsigned)
NQ_SET(delayed_acks, int)
NQ_SET(handshake_to, unsigned long)
NQ_SET(ping_period, unsigned)
NQ_SET(ping_period_us, uint64_t)
NQ_SET(init_max_data, unsigned)
NQ_SET(init_max_stream_data_bidi_local, unsigned)
NQ_SET(init_max_stream_data_bidi_remote, unsigned)
NQ_SET(init_max_stream_data_uni, unsigned)
NQ_SET(init_max_streams_bidi, unsigned)
NQ_SET(init_max_streams_uni, unsigned)
NQ_SET(max_udp_payload_size_rx, unsigned short)
NQ_SET(datagrams, int)
NQ_SET(h3_datagram, int)
NQ_SET(send_prst, int)
NQ_SET(honor_prst, int)
NQ_SET(sreset_burst, unsigned)
NQ_SET(sreset_rate, double)
NQ_SET(h3_connect_protocol, int)
/* RFC 9000 sec 18.2 preferred_address: 4-byte IPv4 + 2-byte port + 16-byte
 * IPv6 + 2-byte port. Excludes the CID/reset-token tail, which lsquic fills. */
#define US_NQ_PREFERRED_ADDRESS_LEN 24
void us_nq_settings_set_preferred_address(
        struct lsquic_engine_settings *s,
        const unsigned char addr[US_NQ_PREFERRED_ADDRESS_LEN]) {
    memcpy(s->es_preferred_address, addr, US_NQ_PREFERRED_ADDRESS_LEN);
}
/* The blob is NOT copied — the caller keeps it alive for the engine's
 * lifetime (it lives on the Rust QuicEndpoint). */
void us_nq_settings_set_origin_blob(struct lsquic_engine_settings *s,
                                    const unsigned char *blob, size_t len) {
    s->es_origin_blob = blob;
    s->es_origin_blob_len = len;
}
NQ_SET(max_datagram_frame_size, unsigned short)
NQ_SET(max_h3_header_pairs, unsigned short)
NQ_SET(max_h3_header_bytes, unsigned)
NQ_SET(allow_migration, int)
NQ_SET(scid_len, unsigned)
NQ_SET(silent_close, int)
NQ_SET(cc_algo, unsigned)
NQ_SET(delay_onclose, int)

#define NQ_GET(f, ty) \
    ty us_nq_settings_get_##f(const struct lsquic_engine_settings *s) { return s->es_##f; }
NQ_GET(init_max_data, unsigned)
NQ_GET(init_max_stream_data_bidi_local, unsigned)
NQ_GET(init_max_stream_data_bidi_remote, unsigned)
NQ_GET(init_max_stream_data_uni, unsigned)
NQ_GET(init_max_streams_bidi, unsigned)
NQ_GET(init_max_streams_uni, unsigned)
NQ_GET(idle_timeout, unsigned)
NQ_GET(idle_timeout_ms, unsigned)
NQ_GET(max_udp_payload_size_rx, unsigned short)
NQ_GET(allow_migration, int)
NQ_GET(datagrams, int)
NQ_GET(max_datagram_frame_size, unsigned short)
#undef NQ_SET

/* `vt` must outlive the engine; `settings` is copied by lsquic. */
lsquic_engine_t *us_nq_engine_new(int is_server, int is_http,
                                  struct us_nq_vtable *vt,
                                  const struct lsquic_engine_settings *settings,
                                  const char *alpn) {
    struct lsquic_engine_api api;
    memset(&api, 0, sizeof(api));
    api.ea_settings = settings;
    api.ea_stream_if = &nq_stream_if;
    api.ea_stream_if_ctx = vt;
    api.ea_packets_out = nq_packets_out;
    api.ea_packets_out_ctx = vt;
    api.ea_get_ssl_ctx = is_server ? nq_get_ssl_ctx : nq_get_client_ssl_ctx;
    if (is_server) {
        api.ea_lookup_cert = nq_lookup_cert;
        api.ea_cert_lu_ctx = vt;
    }
    api.ea_alpn = alpn;
    unsigned flags = is_server ? LSENG_SERVER : 0;
    if (is_http) {
        flags |= LSENG_HTTP;
        api.ea_hsi_if = &nq_hset_if;
        api.ea_hsi_ctx = NQ_HSI_CTX_PACK(settings->es_max_h3_header_pairs,
                                         settings->es_max_h3_header_bytes);
    }
    return lsquic_engine_new(flags, &api);
}

const struct sockaddr *us_nq_spec_dest(const struct lsquic_out_spec *s) { return s->dest_sa; }
const struct sockaddr *us_nq_spec_local(const struct lsquic_out_spec *s) { return s->local_sa; }
void *us_nq_spec_peer_ctx(const struct lsquic_out_spec *s) { return s->peer_ctx; }
const struct iovec *us_nq_spec_iov(const struct lsquic_out_spec *s, size_t *n) {
    *n = s->iovlen;
    return s->iov;
}
size_t us_nq_spec_stride(void) { return sizeof(struct lsquic_out_spec); }

void us_nq_stream_reset(lsquic_stream_t *s, uint64_t code) {
    /* RFC 9000 §3.1 allows RST in Data Sent state. */
    lsquic_stream_force_reset_ext(s, code);
}

/* ───── node:quic loop driver ─────
 *
 * The corking model quic.c uses for Bun.serve's HTTP/3 listener: JS marks the
 * endpoint pending and one pass runs per loop turn, so a burst of writes is
 * one engine pass and one sendmmsg batch instead of one per call.
 */

struct us_nq_driver_s {
    struct us_nq_driver_s *next;
    void *owner;
    int pending;
};

/* endpoint.rs: the full process pass (engines + event dispatch). */
extern void Bun__nodeQuic__processEndpoint(void *owner);

void us_nq_loop_register(struct us_loop_t *loop, struct us_nq_driver_s *d,
                         void *owner) {
    d->owner = owner;
    d->pending = 0;
    d->next = loop->data.nq_head;
    loop->data.nq_head = d;
}

void us_nq_loop_unregister(struct us_loop_t *loop, struct us_nq_driver_s *d) {
    struct us_nq_driver_s **pp = &loop->data.nq_head;
    while (*pp) {
        /* Leave d->next intact: an in-progress walk holds it as its
         * successor, and clearing it would end that pass early. Nothing else
         * reads it, and register() overwrites it. */
        if (*pp == d) { *pp = d->next; return; }
        pp = &(*pp)->next;
    }
}

/* endpoint.rs: full pass, but session close events are held for the next
 * loop point -- dispatching a close in the middle of a running microtask
 * chain is an interleaving node never produces. */
extern void Bun__nodeQuic__drainEndpoint(void *owner);

/* Runs from the microtask drain: keeps the chain's packets and non-close
 * events moving without ending sessions mid-chain. */
void us_nq_loop_drain(struct us_loop_t *loop) {
    struct us_nq_driver_s *d = loop->data.nq_head;
    while (d) {
        struct us_nq_driver_s *next = d->next;
        if (d->pending) {
            d->pending = 0;
            if (d->owner) Bun__nodeQuic__drainEndpoint(d->owner);
        }
        d = next;
    }
}

void us_nq_loop_flush_if_pending(struct us_loop_t *loop) {
    struct us_nq_driver_s *d = loop->data.nq_head;
    while (d) {
        /* The pass runs JS, which can destroy the endpoint and unlink `d`;
         * take the successor first. */
        struct us_nq_driver_s *next = d->next;
        if (d->pending) {
            d->pending = 0;
            if (d->owner) Bun__nodeQuic__processEndpoint(d->owner);
        }
        d = next;
    }
}

