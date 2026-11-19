/* What src/uws_sys/quic needs from the operating system and from BoringSSL's X.509 code. */

#include "quic.h"

#include "internal/internal.h"
#include "internal/fault_inject.h"
#include "crypto/root_certs_header.h"
#include "crypto/sni_tree.h"
#include <openssl/ssl.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>

#include <errno.h>
#include <string.h>
#ifndef _WIN32
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/ip.h>
#include <arpa/inet.h>
#else
#include <ws2tcpip.h>
#endif

extern "C" {

extern SSL_CTX *us_ssl_ctx_build_raw(
    struct us_bun_socket_context_options_t options,
    enum create_bun_socket_error_t *err);
extern int us_ssl_ctx_set_verify_signature_algorithms(SSL_CTX *ctx);
extern int us_x509_verify_cert(X509_STORE_CTX *ctx, int purpose);
extern struct us_bun_verify_error_t us_ssl_socket_verify_error_from_ssl(SSL *ssl);

/* ───── addresses ───── */

struct us_quic_address_t {
    unsigned char ip[16];
    uint32_t scope_id;
    uint16_t port;
    bool is_ipv6;
};

union us_quic_sockaddr_t {
    struct sockaddr any;
    struct sockaddr_in v4;
    struct sockaddr_in6 v6;
};

static void us_quic_address_from(const struct sockaddr *from, struct us_quic_address_t *to) {
    to->is_ipv6 = from->sa_family == AF_INET6;
    if (to->is_ipv6) {
        const struct sockaddr_in6 *v6 = (const struct sockaddr_in6 *) from;
        memcpy(to->ip, &v6->sin6_addr, 16);
        to->scope_id = v6->sin6_scope_id;
        to->port = ntohs(v6->sin6_port);
    } else {
        const struct sockaddr_in *v4 = (const struct sockaddr_in *) from;
        memcpy(to->ip, &v4->sin_addr, 4);
        to->port = ntohs(v4->sin_port);
    }
}

static socklen_t us_quic_address_to(const struct us_quic_address_t *from, union us_quic_sockaddr_t *to) {
    memset(to, 0, sizeof(*to));
    if (from->is_ipv6) {
        to->v6.sin6_family = AF_INET6;
        memcpy(&to->v6.sin6_addr, from->ip, 16);
        to->v6.sin6_scope_id = from->scope_id;
        to->v6.sin6_port = htons(from->port);
        return sizeof(to->v6);
    }
    to->v4.sin_family = AF_INET;
    memcpy(&to->v4.sin_addr, from->ip, 4);
    to->v4.sin_port = htons(from->port);
    return sizeof(to->v4);
}

void us_quic_peer_address(struct us_udp_packet_buffer_t *buf, int index, struct us_quic_address_t *out) {
    us_quic_address_from((struct sockaddr *) us_udp_packet_buffer_peer(buf, index), out);
}

void us_quic_local_address(struct us_udp_socket_t *udp, struct us_quic_address_t *out) {
    struct sockaddr_storage local = {};
    socklen_t len = sizeof(local);
    getsockname(us_poll_fd((struct us_poll_t *) udp), (struct sockaddr *) &local, &len);
    us_quic_address_from((struct sockaddr *) &local, out);
}

bool us_quic_parse_address(const char *host, struct us_quic_address_t *out) {
    struct sockaddr_storage parsed;
    if (!Bun__parseIpAddress(host, 0, &parsed)) return false;
    us_quic_address_from((struct sockaddr *) &parsed, out);
    return true;
}

bool us_quic_resolved_address(struct addrinfo_request *lookup, unsigned int index, struct us_quic_address_t *out) {
    struct addrinfo_result res = Bun__addrinfo_getRequestResult(lookup);
    if (res.error || !res.entries) return false;
    struct addrinfo *ai = &res.entries->info;
    while (ai && index--) ai = ai->ai_next;
    if (ai) us_quic_address_from(ai->ai_addr, out);
    return ai;
}

/* A datagram to an address without a route would just get lost. */
bool us_quic_is_routable(const struct us_quic_address_t *address) {
    union us_quic_sockaddr_t peer;
    socklen_t len = us_quic_address_to(address, &peer);
    int err = 0;
    us_fd_t probe{bsd_create_socket(peer.any.sa_family, SOCK_DGRAM, 0, &err)};
    if (!probe) return true;
#ifdef _WIN32
    /* Winsock's connect() does not look up a route for a datagram socket. */
    SOCKADDR_STORAGE local; DWORD got = 0;
    return WSAIoctl(probe.get(), SIO_ROUTING_INTERFACE_QUERY, &peer, len, &local, sizeof(local), &got, NULL, NULL) == 0;
#else
    return connect(probe.get(), &peer.any, len) == 0;
#endif
}

/* ───── UDP ───── */

/* RFC 9000 §14. IP_PMTUDISC_PROBE also ignores the path MTU that the kernel has cached, as QUIC probes by itself.
 * A dual-stack socket needs both options. */
void us_quic_set_dontfrag(struct us_udp_socket_t *udp) {
    LIBUS_SOCKET_DESCRIPTOR fd = us_poll_fd((struct us_poll_t *) udp);
    int on;
    /* ws2ipdef.h defines IP_MTU_DISCOVER too, but there it is per destination. */
#if defined(_WIN32)
    on = 1;
    setsockopt(fd, IPPROTO_IP, IP_DONTFRAGMENT, (const char *) &on, sizeof(on));
    setsockopt(fd, IPPROTO_IPV6, IPV6_DONTFRAG, (const char *) &on, sizeof(on));
#else
#if defined(IP_MTU_DISCOVER)
    on = IP_PMTUDISC_PROBE;
    setsockopt(fd, IPPROTO_IP, IP_MTU_DISCOVER, &on, sizeof(on));
#elif defined(IP_DONTFRAG)
    on = 1;
    setsockopt(fd, IPPROTO_IP, IP_DONTFRAG, &on, sizeof(on));
#endif
#if defined(IPV6_MTU_DISCOVER)
    on = IP_PMTUDISC_PROBE;
    setsockopt(fd, IPPROTO_IPV6, IPV6_MTU_DISCOVER, &on, sizeof(on));
#elif defined(IPV6_DONTFRAG)
    on = 1;
    setsockopt(fd, IPPROTO_IPV6, IPV6_DONTFRAG, &on, sizeof(on));
#endif
#endif
    (void) on;
}

/* Datagrams of segment_len bytes, but for the last one, which can be shorter. */
struct us_quic_run_t {
    const char *data;
    size_t len;
    size_t segment_len;
    struct us_quic_address_t peer;
};

struct us_quic_datagram_t {
    const char *data;
    size_t len;
    const struct sockaddr *peer;
    socklen_t peer_len;
};

#define US_QUIC_SEND_BATCH 64

/* Returns how many were sent, or -1 with errno set. */
static int us_quic_try_send(LIBUS_SOCKET_DESCRIPTOR fd, const struct us_quic_datagram_t *datagrams, unsigned int n) {
#ifdef _WIN32
    (void) n;
    if (sendto(fd, datagrams->data, (int) datagrams->len, 0, datagrams->peer, datagrams->peer_len) >= 0) return 1;
    int wsa = WSAGetLastError();
    errno = wsa == WSAEWOULDBLOCK ? EAGAIN : wsa == WSAENOBUFS ? ENOBUFS : wsa == WSAEMSGSIZE ? EMSGSIZE : EIO;
    return -1;
#else
    ssize_t r = 0; int unused = 0;
    if (US_FAULT_CHECK(US_FAULT_SENDMSG, fd, r, unused)) return r < 0 ? -1 : 1;
    (void) unused;
#ifdef __linux__
    struct mmsghdr messages[US_QUIC_SEND_BATCH];
    struct iovec iov[US_QUIC_SEND_BATCH];
    for (unsigned int i = 0; i < n; i++) {
        iov[i] = {(void *) datagrams[i].data, datagrams[i].len};
        messages[i] = {};
        messages[i].msg_hdr.msg_name = (void *) datagrams[i].peer;
        messages[i].msg_hdr.msg_namelen = datagrams[i].peer_len;
        messages[i].msg_hdr.msg_iov = &iov[i];
        messages[i].msg_hdr.msg_iovlen = 1;
    }
    do { r = sendmmsg(fd, messages, n, 0); } while (r < 0 && errno == EINTR);
    return (int) r;
#else
    /* sendmsg_x of macOS takes no address for each datagram. */
    (void) n;
    do { r = sendto(fd, datagrams->data, datagrams->len, 0, datagrams->peer, datagrams->peer_len); } while (r < 0 && errno == EINTR);
    return r < 0 ? -1 : 1;
#endif
#endif
}

static bool us_quic_would_block(int err) {
    return err == EAGAIN || err == EWOULDBLOCK || err == ENOBUFS;
}

/* Returns how many are done with. What the kernel refuses for good is as if it got lost on the way. */
static unsigned int us_quic_send_datagrams(struct us_udp_socket_t *udp, const struct us_quic_datagram_t *datagrams, unsigned int n) {
    LIBUS_SOCKET_DESCRIPTOR fd = us_poll_fd((struct us_poll_t *) udp);
    unsigned int done = 0;
    while (done < n) {
        int r = us_quic_try_send(fd, datagrams + done, n - done);
        /* udp(7): the error can be that of an earlier datagram to another peer, and is cleared by now. */
        if (r < 0 && !us_quic_would_block(errno) && errno != EMSGSIZE) r = us_quic_try_send(fd, datagrams + done, n - done);
        if (r < 0 && us_quic_would_block(errno)) {
            us_poll_change((struct us_poll_t *) udp, udp->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
            break;
        }
        done += r < 0 ? 1 : (unsigned int) r;
    }
    return done;
}

/* Returns how many bytes are done with. If not all, on_drain follows. */
size_t us_quic_send(struct us_udp_socket_t *udp, const struct us_quic_run_t *runs, size_t count) {
    union us_quic_sockaddr_t peers[US_QUIC_SEND_BATCH];
    struct us_quic_datagram_t datagrams[US_QUIC_SEND_BATCH];
    size_t done = 0, run = 0, offset = 0;
    while (run < count) {
        unsigned int n = 0;
        for (unsigned int p = 0; run < count && n < US_QUIC_SEND_BATCH; p++) {
            const struct us_quic_run_t *r = &runs[run];
            socklen_t peer_len = us_quic_address_to(&r->peer, &peers[p]);
            while (offset < r->len && n < US_QUIC_SEND_BATCH) {
                size_t len = std::min(r->segment_len, r->len - offset);
                datagrams[n++] = {r->data + offset, len, &peers[p].any, peer_len};
                offset += len;
            }
            if (offset == r->len) {
                run++;
                offset = 0;
            }
        }
        unsigned int sent = us_quic_send_datagrams(udp, datagrams, n);
        for (unsigned int i = 0; i < sent; i++) done += datagrams[i].len;
        if (sent < n) break;
    }
    return done;
}

#ifdef LIBUS_USE_LIBUV
/* libuv has no hook into the timeout of its poll. */
void us_quic_loop_set_timer(struct us_loop_t *loop, int ms) {
    if (!loop->data.quic_timer) loop->data.quic_timer = us_create_timer(loop, 1, 0);
    us_timer_set(loop->data.quic_timer, [](struct us_timer_t *t) { us_quic_loop_process(us_timer_loop(t)); }, ms, 0);
}
#endif

/* ───── TLS ───── */

static_assert(ssl_compliance_policy_fips_202205 == 1 && ssl_compliance_policy_wpa3_192_202304 == 3 &&
    ssl_early_data_unknown == 0 && ssl_early_data_disabled == 1 && ssl_early_data_no_session_offered == 5 &&
    X509_V_FLAG_CRL_CHECK == 0x4 && X509_V_FLAG_CRL_CHECK_ALL == 0x8 &&
    X509_V_FLAG_IGNORE_EXPIRED_TRUST_ANCHORS == 0x40000000,
    "update the constants in src/runtime/node/quic/tls.rs");
static_assert(SSL_ERROR_EARLY_DATA_REJECTED == 15 && SSL_SESS_CACHE_CLIENT == 1 && ssl_verify_ok == 0 &&
    ssl_verify_invalid == 1 && ssl_encryption_initial == 0 && ssl_encryption_early_data == 1 &&
    ssl_encryption_handshake == 2 && ssl_encryption_application == 3 && sizeof(SSL_QUIC_METHOD) == 5 * sizeof(void *),
    "update the constants in src/quic_tls/session.rs");

static void us_quic_require_tls13(SSL_CTX *ssl) {
    SSL_CTX_set_min_proto_version(ssl, TLS1_3_VERSION);
    SSL_CTX_set_max_proto_version(ssl, TLS1_3_VERSION);
}

/* `default_ctx` is for a context that takes over from it by SNI. */
SSL_CTX *us_quic_create_server_ssl_ctx(const struct us_bun_socket_context_options_t *options, const SSL_CTX *default_ctx) {
    enum create_bun_socket_error_t err = CREATE_BUN_SOCKET_ERROR_NONE;
    SSL_CTX *ssl = us_ssl_ctx_build_raw(*options, &err);
    if (!ssl) return NULL;
    us_quic_require_tls13(ssl);
    SSL_CTX_set_early_data_enabled(ssl, 0);
    us_ssl_ctx_set_sni_policy(ssl, options->request_cert, options->reject_unauthorized);
    if (default_ctx) {
        SSL_CTX_set_verify(ssl, SSL_CTX_get_verify_mode(ssl) | SSL_CTX_get_verify_mode(default_ctx),
            SSL_CTX_get_verify_callback(ssl));
    }
    return ssl;
}

using us_quic_server_names_t = sni_node<us_ssl_ctx_ptr>;

us_quic_server_names_t *us_quic_create_server_names() { return new us_quic_server_names_t; }
void us_quic_server_names_free(us_quic_server_names_t *names) { delete names; }

void us_quic_server_names_add(us_quic_server_names_t *names, const char *name, SSL_CTX *owned) {
    names->add(name, us_ssl_ctx_ptr{owned});
}

/* Returns a new reference. */
SSL_CTX *us_quic_server_names_find(const us_quic_server_names_t *names, const char *name, size_t len) {
    const us_ssl_ctx_ptr *match = names->find({name, len});
    if (!match) return NULL;
    SSL_CTX_up_ref(match->get());
    return match->get();
}

bool us_quic_is_client_authorized(SSL_CTX *default_ctx, SSL *ssl) {
    bool enforce = us_ssl_ctx_reject_unauthorized(default_ctx) || us_ssl_ctx_reject_unauthorized(SSL_get_SSL_CTX(ssl));
    return !enforce || us_ssl_socket_verify_error_from_ssl(ssl).error == 0;
}

SSL_CTX *us_quic_create_client_ssl_ctx() {
    us_ssl_ctx_ptr ssl{SSL_CTX_new(TLS_method())};
    if (!ssl) return NULL;
    us_quic_require_tls13(ssl.get());
    X509_VERIFY_PARAM_set_flags(SSL_CTX_get0_param(ssl.get()), X509_V_FLAG_IGNORE_EXPIRED_TRUST_ANCHORS);
    SSL_CTX_set_cert_store(ssl.get(), us_get_default_ca_store());
    if (!us_ssl_ctx_set_verify_signature_algorithms(ssl.get())) return NULL;
    return ssl.release();
}

bool us_quic_is_server_authorized(SSL *ssl, const char *hostname) {
    STACK_OF(X509) *chain = SSL_get_peer_full_cert_chain(ssl);
    if (!chain || sk_X509_num(chain) == 0) return false;
    X509 *leaf = sk_X509_value(chain, 0);
    X509_STORE *store = SSL_CTX_get_cert_store(SSL_get_SSL_CTX(ssl));
    us_unique_ptr<X509_STORE_CTX, X509_STORE_CTX_free> vctx{X509_STORE_CTX_new()};
    if (!vctx || X509_STORE_CTX_init(vctx.get(), store, leaf, chain) != 1) return false;
    X509_STORE_CTX_set_default(vctx.get(), "ssl_server");
    if (us_x509_verify_cert(vctx.get(), X509_PURPOSE_SSL_SERVER) != 1) return false;
    unsigned char addr[16];
    return (inet_pton(AF_INET, hostname, addr) == 1 || inet_pton(AF_INET6, hostname, addr) == 1
        ? X509_check_ip_asc(leaf, hostname, 0)
        : X509_check_host(leaf, hostname, strlen(hostname), X509_CHECK_FLAG_NO_PARTIAL_WILDCARDS, NULL)) == 1;
}

}
