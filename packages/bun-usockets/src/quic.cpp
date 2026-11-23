/* What src/uws_sys/quic needs from the operating system and from BoringSSL's X.509 code. */

#define __APPLE_USE_RFC_3542

#include "quic.h"

#include "internal/internal.h"
#include "internal/fault_inject.h"
#include "crypto/root_certs_header.h"
#include "crypto/sni_tree.h"
#include <openssl/aes.h>
#include <openssl/ssl.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>

#include <errno.h>
#include <string.h>
#ifndef _WIN32
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/ip.h>
#include <netinet/udp.h>
#include <arpa/inet.h>
#else
#include <ws2tcpip.h>
#endif

#if defined(__linux__) && !defined(UDP_GRO)
#define UDP_SEGMENT 103
#define UDP_GRO 104
#endif

extern "C" {

extern SSL_CTX *us_ssl_ctx_build_raw(
    struct us_bun_socket_context_options_t options,
    enum create_bun_socket_error_t *err);
extern int us_ssl_ctx_set_verify_signature_algorithms(SSL_CTX *ctx);
extern int us_x509_verify_cert(X509_STORE_CTX *ctx, int purpose);

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

struct us_quic_envelope_t {
    struct us_quic_address_t local, peer;
    /* Not 0 if the kernel has joined datagrams of this length, but for the last one, which can be shorter. */
    int segment_len;
};

/* `local` is left alone where the system does not tell. */
void us_quic_read_envelope(struct udp_recvbuf *buf, int index, struct us_quic_envelope_t *out) {
    us_quic_address_from((struct sockaddr *) bsd_udp_packet_buffer_peer(buf, index), &out->peer);
#ifdef __linux__
    struct msghdr *message = &buf->msgvec[index].msg_hdr;
    for (struct cmsghdr *it = CMSG_FIRSTHDR(message); it; it = CMSG_NXTHDR(message, it)) {
        if (it->cmsg_level == IPPROTO_UDP && it->cmsg_type == UDP_GRO) {
            memcpy(&out->segment_len, CMSG_DATA(it), sizeof(int));
        } else if (it->cmsg_level == IPPROTO_IP && it->cmsg_type == IP_PKTINFO) {
            memcpy(out->local.ip, CMSG_DATA(it) + offsetof(struct in_pktinfo, ipi_addr), 4);
        } else if (it->cmsg_level == IPPROTO_IPV6 && it->cmsg_type == IPV6_PKTINFO) {
            struct in6_pktinfo info;
            memcpy(&info, CMSG_DATA(it), sizeof(info));
            memcpy(out->local.ip, &info.ipi6_addr, 16);
            out->local.scope_id = IN6_IS_ADDR_LINKLOCAL(&info.ipi6_addr) ? info.ipi6_ifindex : 0;
        }
    }
#endif
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

static_assert(LIBUS_UDP_RECV_COUNT == 8, "update the constant in src/uws_sys/quic/io.rs");

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

void us_quic_stop_reading(struct us_udp_socket_t *udp) {
    udp->has_read_enough = 1;
}

/* With a callback from the start, the errors of earlier datagrams would be queued. */
void us_quic_ignore_receive_errors(struct us_udp_socket_t *udp) {
    udp->on_recv_error = [](struct us_udp_socket_t *, int, int) {};
}

/* Returns whether us_quic_message_t::segment_len is understood. ECN is not used, so it need not be reported. */
bool us_quic_enable_offload(struct us_udp_socket_t *udp) {
#ifdef __linux__
    int value = 0;
    socklen_t len = sizeof(value);
    setsockopt(us_poll_fd(&udp->p), IPPROTO_IP, IP_RECVTOS, &value, len);
    setsockopt(us_poll_fd(&udp->p), IPPROTO_IPV6, IPV6_RECVTCLASS, &value, len);
    value = 1;
    setsockopt(us_poll_fd(&udp->p), IPPROTO_UDP, UDP_GRO, &value, len);
    return getsockopt(us_poll_fd(&udp->p), IPPROTO_UDP, UDP_SEGMENT, &value, &len) == 0;
#else
    (void) udp;
    return false;
#endif
}

struct us_quic_message_t {
    struct us_quic_address_t local, peer;
    uint32_t start, len;
    /* Not 0 for the kernel to cut it into datagrams of this length. */
    uint16_t segment_len;
};

static_assert(sizeof(us_quic_address_t) == 24 && offsetof(us_quic_address_t, is_ipv6) == 22 &&
    sizeof(us_quic_envelope_t) == 52 && offsetof(us_quic_envelope_t, peer) == 24 &&
    sizeof(us_quic_message_t) == 60 && offsetof(us_quic_message_t, peer) == 24 &&
    offsetof(us_quic_message_t, len) == 52 && offsetof(us_quic_message_t, segment_len) == 56 &&
    sizeof(us_quic_header_t) == 32 && offsetof(us_quic_header_t, qpack_index) == 28 &&
    sizeof(us_quic_stream_t) == 24 && US_QUIC_MAX_REQUEST_FIELDS == 200, "update src/uws_sys/quic");

#ifdef __linux__
#define US_QUIC_SEND_BATCH 64

static void us_quic_add_control(struct msghdr *message, int level, int type, const void *data, size_t len) {
    struct cmsghdr *it = (struct cmsghdr *) ((char *) message->msg_control + message->msg_controllen);
    memset(it, 0, CMSG_SPACE(len));
    it->cmsg_len = CMSG_LEN(len);
    it->cmsg_level = level;
    it->cmsg_type = type;
    memcpy(CMSG_DATA(it), data, len);
    message->msg_controllen += CMSG_SPACE(len);
}

static void us_quic_add_source(struct msghdr *message, const struct us_quic_address_t *source) {
    if (source->is_ipv6) {
        struct in6_pktinfo info = {};
        memcpy(&info.ipi6_addr, source->ip, 16);
        info.ipi6_ifindex = source->scope_id;
        if (IN6_IS_ADDR_UNSPECIFIED(&info.ipi6_addr)) return;
        us_quic_add_control(message, IPPROTO_IPV6, IPV6_PKTINFO, &info, sizeof(info));
    } else {
        struct in_pktinfo info = {};
        memcpy(&info.ipi_spec_dst, source->ip, 4);
        if (info.ipi_spec_dst.s_addr == INADDR_ANY) return;
        us_quic_add_control(message, IPPROTO_IP, IP_PKTINFO, &info, sizeof(info));
    }
}
#endif

/* Returns how many were sent, or -1 with errno set. */
static int us_quic_try_send(LIBUS_SOCKET_DESCRIPTOR fd, bool names_source, const char *bytes,
    const struct us_quic_message_t *messages, size_t count) {
    ssize_t r = 0;
#ifndef _WIN32
    int unused = 0;
    if (US_FAULT_CHECK(US_FAULT_SENDMSG, fd, r, unused)) return r < 0 ? -1 : 1;
    (void) unused;
#endif
#ifdef __linux__
    struct {
        union us_quic_sockaddr_t peer;
        struct iovec iov;
        alignas(struct cmsghdr) char control[CMSG_SPACE(sizeof(struct in6_pktinfo)) + CMSG_SPACE(sizeof(uint16_t))];
    } parts[US_QUIC_SEND_BATCH];
    struct mmsghdr headers[US_QUIC_SEND_BATCH];
    unsigned int n = (unsigned int) std::min<size_t>(count, US_QUIC_SEND_BATCH);
    for (unsigned int i = 0; i < n; i++) {
        struct msghdr *header = &headers[i].msg_hdr;
        headers[i] = {};
        parts[i].iov = {(void *) (bytes + messages[i].start), messages[i].len};
        header->msg_name = &parts[i].peer;
        header->msg_namelen = us_quic_address_to(&messages[i].peer, &parts[i].peer);
        header->msg_iov = &parts[i].iov;
        header->msg_iovlen = 1;
        header->msg_control = parts[i].control;
        if (names_source) us_quic_add_source(header, &messages[i].local);
        if (messages[i].segment_len) {
            us_quic_add_control(header, IPPROTO_UDP, UDP_SEGMENT, &messages[i].segment_len, sizeof(uint16_t));
        }
    }
    do { r = sendmmsg(fd, headers, n, 0); } while (r < 0 && errno == EINTR);
    return (int) r;
#else
    /* sendmsg_x of macOS takes no address for each datagram. */
    (void) names_source; (void) count;
    union us_quic_sockaddr_t peer;
    socklen_t peer_len = us_quic_address_to(&messages->peer, &peer);
    do { r = sendto(fd, bytes + messages->start, messages->len, 0, &peer.any, peer_len); } while (IS_EINTR(r));
    return r < 0 ? -1 : 1;
#endif
}

/* Returns how many were sent, 0 if on_drain follows, or the negated error if the first one was refused.
 * ENOBUFS counts as a refusal, as the socket stays writable.
 * `names_source` is for a socket that is not bound to one address. */
int us_quic_send(struct us_udp_socket_t *udp, bool names_source, const char *bytes,
    const struct us_quic_message_t *messages, size_t count) {
    int sent = us_quic_try_send(us_poll_fd(&udp->p), names_source, bytes, messages, count);
#ifdef _WIN32
    if (sent > 0 || !bsd_would_block()) return sent;
#else
    if (sent > 0) return sent;
    if (!bsd_would_block()) return -errno;
#endif
    us_poll_change(&udp->p, udp->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
    return 0;
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
static_assert(sizeof(AES_KEY) == 244 && alignof(AES_KEY) == 4, "update the type in src/quic_tls/primitives.rs");

static void us_quic_require_tls13(SSL_CTX *ssl) {
    SSL_CTX_set_min_proto_version(ssl, TLS1_3_VERSION);
    SSL_CTX_set_max_proto_version(ssl, TLS1_3_VERSION);
    SSL_CTX_clear_options(ssl, SSL_OP_NO_TLSv1_3);
}

/* `default_ctx` is for a context that takes over from it by SNI. */
SSL_CTX *us_quic_create_server_ssl_ctx(const struct us_bun_socket_context_options_t *options, const SSL_CTX *default_ctx) {
    enum create_bun_socket_error_t err = CREATE_BUN_SOCKET_ERROR_NONE;
    SSL_CTX *ssl = us_ssl_ctx_build_raw(*options, &err);
    if (!ssl) return NULL;
    us_quic_require_tls13(ssl);
    SSL_CTX_set_early_data_enabled(ssl, 0);
    us_ssl_ctx_set_sni_policy(ssl, options->request_cert, options->reject_unauthorized);
    int mode = SSL_CTX_get_verify_mode(ssl) | (default_ctx ? SSL_CTX_get_verify_mode(default_ctx) : 0);
    SSL_CTX_set_verify(ssl, mode, mode & SSL_VERIFY_FAIL_IF_NO_PEER_CERT
        ? [](int ok, X509_STORE_CTX *) { return ok; }
        : SSL_CTX_get_verify_callback(ssl));
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
