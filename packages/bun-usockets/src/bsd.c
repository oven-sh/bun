/*
 * Authored by Alex Hultman, 2018-2021.
 * Intellectual property of third-party.

 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* Todo: this file should lie in networking/bsd.c */

#define __APPLE_USE_RFC_3542

#include "libusockets.h"
#include "internal/internal.h"

#include <stdio.h>
#include <stdlib.h>

#ifndef _WIN32
//#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <netdb.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#endif

/* Internal structure of packet buffer */
struct us_internal_udp_packet_buffer {
#if defined(_WIN32) || defined(__APPLE__)
    char *buf[LIBUS_UDP_MAX_NUM];
    size_t len[LIBUS_UDP_MAX_NUM];
    struct sockaddr_storage addr[LIBUS_UDP_MAX_NUM];
#else
    struct mmsghdr msgvec[LIBUS_UDP_MAX_NUM];
    struct iovec iov[LIBUS_UDP_MAX_NUM];
    struct sockaddr_storage addr[LIBUS_UDP_MAX_NUM];
    char control[LIBUS_UDP_MAX_NUM][256];
#endif
};

/* We need to emulate sendmmsg, recvmmsg on platform who don't have it */
int bsd_sendmmsg(LIBUS_SOCKET_DESCRIPTOR fd, void *msgvec, unsigned int vlen, int flags) {
#if defined(__APPLE__)

struct mmsghdr {
    struct msghdr msg_hdr;  /* Message header */
    unsigned int  msg_len;  /* Number of bytes transmitted */
};

    struct mmsghdr *hdrs = (struct mmsghdr *) msgvec;

    for (int i = 0; i < vlen; i++) {
        int ret = sendmsg(fd, &hdrs[i].msg_hdr, flags);
        if (ret == -1) {
            if (i) {
                return i;
            } else {
                return -1;
            }
        } else {
            hdrs[i].msg_len = ret;
        }
    }

    return vlen;

#elif defined(_WIN32)

    struct us_internal_udp_packet_buffer *packet_buffer = (struct us_internal_udp_packet_buffer *) msgvec;

    /* Let's just use sendto here */
    /* Winsock does not have sendmsg, while macOS has, however, we simply use sendto since both macOS and Winsock has it.
     * Besides, you should use Linux either way to get best performance with the sendmmsg */


    // while we do not get error, send next

    for (int i = 0; i < LIBUS_UDP_MAX_NUM; i++) {
        // need to support ipv6 addresses also!
        int ret = sendto(fd, packet_buffer->buf[i], packet_buffer->len[i], flags, (struct sockaddr *)&packet_buffer->addr[i], sizeof(struct sockaddr_in));

        if (ret == -1) {
            // if we fail then we need to buffer up, no that's not our problem
            // we do need to register poll out though and have a callback for it
            return i;
        }

        //printf("sendto: %d\n", ret);
    }

    return LIBUS_UDP_MAX_NUM; // one message
#else
    return sendmmsg(fd, (struct mmsghdr *)msgvec, vlen, flags | MSG_NOSIGNAL);
#endif
}

int bsd_recvmmsg(LIBUS_SOCKET_DESCRIPTOR fd, void *msgvec, unsigned int vlen, int flags, void *timeout) {
#if defined(_WIN32) || defined(__APPLE__)
    struct us_internal_udp_packet_buffer *packet_buffer = (struct us_internal_udp_packet_buffer *) msgvec;


    for (int i = 0; i < LIBUS_UDP_MAX_NUM; i++) {
        socklen_t addr_len = sizeof(struct sockaddr_storage);
        int ret = recvfrom(fd, packet_buffer->buf[i], LIBUS_UDP_MAX_SIZE, flags, (struct sockaddr *)&packet_buffer->addr[i], &addr_len);

        if (ret == -1) {
            return i;
        }

        packet_buffer->len[i] = ret;
    }

    return LIBUS_UDP_MAX_NUM;
#else
    // we need to set controllen for ip packet
    for (int i = 0; i < vlen; i++) {
        ((struct mmsghdr *)msgvec)[i].msg_hdr.msg_controllen = 256;
    }

    return recvmmsg(fd, (struct mmsghdr *)msgvec, vlen, flags, 0);
#endif
}

// this one is needed for knowing the destination addr of udp packet
// an udp socket can only bind to one port, and that port never changes
// this function returns ONLY the IP address, not any port
int bsd_udp_packet_buffer_local_ip(void *msgvec, int index, char *ip) {
#if defined(_WIN32) || defined(__APPLE__)
    return 0; // not supported
#else
    struct msghdr *mh = &((struct mmsghdr *) msgvec)[index].msg_hdr;
    for (struct cmsghdr *cmsg = CMSG_FIRSTHDR(mh); cmsg != NULL; cmsg = CMSG_NXTHDR(mh, cmsg)) {
        // ipv6 or ipv4
        if (cmsg->cmsg_level == IPPROTO_IP && cmsg->cmsg_type == IP_PKTINFO) {
            struct in_pktinfo *pi = (struct in_pktinfo *) CMSG_DATA(cmsg);
            memcpy(ip, &pi->ipi_addr, 4);
            return 4;
        }

        if (cmsg->cmsg_level == IPPROTO_IPV6 && cmsg->cmsg_type == IPV6_PKTINFO) {
            struct in6_pktinfo *pi6 = (struct in6_pktinfo *) CMSG_DATA(cmsg);
            memcpy(ip, &pi6->ipi6_addr, 16);
            return 16;
        }
    }

    return 0; // no length

#endif
}

char *bsd_udp_packet_buffer_peer(void *msgvec, int index) {
#if defined(_WIN32) || defined(__APPLE__)
    struct us_internal_udp_packet_buffer *packet_buffer = (struct us_internal_udp_packet_buffer *) msgvec;
    return (char *)&packet_buffer->addr[index];
#else
    return ((struct mmsghdr *) msgvec)[index].msg_hdr.msg_name;
#endif
}

char *bsd_udp_packet_buffer_payload(void *msgvec, int index) {
#if defined(_WIN32) || defined(__APPLE__)
    struct us_internal_udp_packet_buffer *packet_buffer = (struct us_internal_udp_packet_buffer *) msgvec;
    return packet_buffer->buf[index];
#else
    return ((struct mmsghdr *) msgvec)[index].msg_hdr.msg_iov[0].iov_base;
#endif
}

int bsd_udp_packet_buffer_payload_length(void *msgvec, int index) {
#if defined(_WIN32) || defined(__APPLE__)
    struct us_internal_udp_packet_buffer *packet_buffer = (struct us_internal_udp_packet_buffer *) msgvec;
    return packet_buffer->len[index];
#else
    return ((struct mmsghdr *) msgvec)[index].msg_len;
#endif
}

void bsd_udp_buffer_set_packet_payload(struct us_udp_packet_buffer_t *send_buf, int index, int offset, void *payload, int length, void *peer_addr) {
#if defined(_WIN32) || defined(__APPLE__)
    struct us_internal_udp_packet_buffer *packet_buffer = (struct us_internal_udp_packet_buffer *) send_buf;

    memcpy(packet_buffer->buf[index], payload, length);
    memcpy(&packet_buffer->addr[index], peer_addr, sizeof(struct sockaddr_storage));

    packet_buffer->len[index] = length;
#else
    //printf("length: %d, offset: %d\n", length, offset);

    struct mmsghdr *ss = (struct mmsghdr *) send_buf;

    // copy the peer address
    memcpy(ss[index].msg_hdr.msg_name, peer_addr, /*ss[index].msg_hdr.msg_namelen*/ sizeof(struct sockaddr_in));

    // set control length to 0
    ss[index].msg_hdr.msg_controllen = 0;

    // copy the payload
    
    ss[index].msg_hdr.msg_iov->iov_len = length + offset;


    memcpy(((char *) ss[index].msg_hdr.msg_iov->iov_base) + offset, payload, length);
#endif
}

/* The maximum UDP payload size is 64kb, but in IPV6 you can have jumbopackets larger than so.
 * We do not support those jumbo packets currently, but will safely ignore them.
 * Any sane sender would assume we don't support them if we consistently drop them.
 * Therefore a udp_packet_buffer_t will be 64 MB in size (64kb * 1024). */
void *bsd_create_udp_packet_buffer() {
#if defined(_WIN32) || defined(__APPLE__)
    struct us_internal_udp_packet_buffer *b = malloc(sizeof(struct us_internal_udp_packet_buffer) + LIBUS_UDP_MAX_SIZE * LIBUS_UDP_MAX_NUM);

    for (int i = 0; i < LIBUS_UDP_MAX_NUM; i++) {
        b->buf[i] = ((char *) b) + sizeof(struct us_internal_udp_packet_buffer) + LIBUS_UDP_MAX_SIZE * i;
    }

    return (struct us_udp_packet_buffer_t *) b;
#else
    /* Allocate 64kb times 1024 */
    struct us_internal_udp_packet_buffer *b = malloc(sizeof(struct us_internal_udp_packet_buffer) + LIBUS_UDP_MAX_SIZE * LIBUS_UDP_MAX_NUM);

    for (int n = 0; n < LIBUS_UDP_MAX_NUM; ++n) {

        b->iov[n].iov_base = &((char *) (b + 1))[n * LIBUS_UDP_MAX_SIZE];
        b->iov[n].iov_len = LIBUS_UDP_MAX_SIZE;

        b->msgvec[n].msg_hdr = (struct msghdr) {
            .msg_name       = &b->addr,
            .msg_namelen    = sizeof (struct sockaddr_storage),

            .msg_iov        = &b->iov[n],
            .msg_iovlen     = 1,

            .msg_control    = b->control[n],
            .msg_controllen = 256,
        };
    }

    return (struct us_udp_packet_buffer_t *) b;
#endif
}

LIBUS_SOCKET_DESCRIPTOR apple_no_sigpipe(LIBUS_SOCKET_DESCRIPTOR fd) {
#ifdef __APPLE__
    if (fd != LIBUS_SOCKET_ERROR) {
        int no_sigpipe = 1;
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, (void *) &no_sigpipe, sizeof(int));
    }
#endif
    return fd;
}

LIBUS_SOCKET_DESCRIPTOR bsd_set_nonblocking(LIBUS_SOCKET_DESCRIPTOR fd) {
#ifdef _WIN32
    /* Libuv will set windows sockets as non-blocking */
#elif defined(__APPLE__)
    fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK  | O_CLOEXEC);
#else
    fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK);
#endif
    return fd;
}

void bsd_socket_nodelay(LIBUS_SOCKET_DESCRIPTOR fd, int enabled) {
    setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, (void *) &enabled, sizeof(enabled));
}

void bsd_socket_flush(LIBUS_SOCKET_DESCRIPTOR fd) {
    // Linux TCP_CORK has the same underlying corking mechanism as with MSG_MORE
#ifdef TCP_CORK
    int enabled = 0;
    setsockopt(fd, IPPROTO_TCP, TCP_CORK, (void *) &enabled, sizeof(int));
#endif
}

LIBUS_SOCKET_DESCRIPTOR bsd_create_socket(int domain, int type, int protocol) {
    // returns INVALID_SOCKET on error
    int flags = 0;
#if defined(SOCK_CLOEXEC) && defined(SOCK_NONBLOCK)
    flags = SOCK_CLOEXEC | SOCK_NONBLOCK;
#endif

    LIBUS_SOCKET_DESCRIPTOR created_fd = socket(domain, type | flags, protocol);

    return bsd_set_nonblocking(apple_no_sigpipe(created_fd));
}

void bsd_close_socket(LIBUS_SOCKET_DESCRIPTOR fd) {
#ifdef _WIN32
    closesocket(fd);
#else
    close(fd);
#endif
}

void bsd_shutdown_socket(LIBUS_SOCKET_DESCRIPTOR fd) {
#ifdef _WIN32
    shutdown(fd, SD_SEND);
#else
    shutdown(fd, SHUT_WR);
#endif
}

void bsd_shutdown_socket_read(LIBUS_SOCKET_DESCRIPTOR fd) {
#ifdef _WIN32
    shutdown(fd, SD_RECEIVE);
#else
    shutdown(fd, SHUT_RD);
#endif
}

void internal_finalize_bsd_addr(struct bsd_addr_t *addr) {
    // parse, so to speak, the address
    if (addr->mem.ss_family == AF_INET6) {
        addr->ip = (char *) &((struct sockaddr_in6 *) addr)->sin6_addr;
        addr->ip_length = sizeof(struct in6_addr);
        addr->port = ntohs(((struct sockaddr_in6 *) addr)->sin6_port);
    } else if (addr->mem.ss_family == AF_INET) {
        addr->ip = (char *) &((struct sockaddr_in *) addr)->sin_addr;
        addr->ip_length = sizeof(struct in_addr);
        addr->port = ntohs(((struct sockaddr_in *) addr)->sin_port);
    } else {
        addr->ip_length = 0;
        addr->port = -1;
    }
}

int bsd_local_addr(LIBUS_SOCKET_DESCRIPTOR fd, struct bsd_addr_t *addr) {
    addr->len = sizeof(addr->mem);
    if (getsockname(fd, (struct sockaddr *) &addr->mem, &addr->len)) {
        return -1;
    }
    internal_finalize_bsd_addr(addr);
    return 0;
}

int bsd_remote_addr(LIBUS_SOCKET_DESCRIPTOR fd, struct bsd_addr_t *addr) {
    addr->len = sizeof(addr->mem);
    if (getpeername(fd, (struct sockaddr *) &addr->mem, &addr->len)) {
        return -1;
    }
    internal_finalize_bsd_addr(addr);
    return 0;
}

char *bsd_addr_get_ip(struct bsd_addr_t *addr) {
    return addr->ip;
}

int bsd_addr_get_ip_length(struct bsd_addr_t *addr) {
    return addr->ip_length;
}

int bsd_addr_get_port(struct bsd_addr_t *addr) {
    return addr->port;
}

// called by dispatch_ready_poll
LIBUS_SOCKET_DESCRIPTOR bsd_accept_socket(LIBUS_SOCKET_DESCRIPTOR fd, struct bsd_addr_t *addr) {
    LIBUS_SOCKET_DESCRIPTOR accepted_fd;
    addr->len = sizeof(addr->mem);

#if defined(SOCK_CLOEXEC) && defined(SOCK_NONBLOCK)
    // Linux, FreeBSD
    accepted_fd = accept4(fd, (struct sockaddr *) addr, &addr->len, SOCK_CLOEXEC | SOCK_NONBLOCK);
#else
    // Windows, OS X
    accepted_fd = accept(fd, (struct sockaddr *) addr, &addr->len);

#endif

    /* We cannot rely on addr since it is not initialized if failed */
    if (accepted_fd == LIBUS_SOCKET_ERROR) {
        return LIBUS_SOCKET_ERROR;
    }

    internal_finalize_bsd_addr(addr);

    return bsd_set_nonblocking(apple_no_sigpipe(accepted_fd));
}

int bsd_recv(LIBUS_SOCKET_DESCRIPTOR fd, void *buf, int length, int flags) {
    return recv(fd, buf, length, flags);
}

#if !defined(_WIN32)
#include <sys/uio.h>

int bsd_write2(LIBUS_SOCKET_DESCRIPTOR fd, const char *header, int header_length, const char *payload, int payload_length) {
    struct iovec chunks[2];

    chunks[0].iov_base = (char *)header;
    chunks[0].iov_len = header_length;
    chunks[1].iov_base = (char *)payload;
    chunks[1].iov_len = payload_length;

    return writev(fd, chunks, 2);
}
#else
int bsd_write2(LIBUS_SOCKET_DESCRIPTOR fd, const char *header, int header_length, const char *payload, int payload_length) {
    int written = bsd_send(fd, header, header_length, 0);
    if (written == header_length) {
        int second_write = bsd_send(fd, payload, payload_length, 0);
        if (second_write > 0) {
            written += second_write;
        }
    }
    return written;
}
#endif

int bsd_send(LIBUS_SOCKET_DESCRIPTOR fd, const char *buf, int length, int msg_more) {

    // MSG_MORE (Linux), MSG_PARTIAL (Windows), TCP_NOPUSH (BSD)

#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0
#endif

#ifdef MSG_MORE

    // for Linux we do not want signals
    return send(fd, buf, length, ((msg_more != 0) * MSG_MORE) | MSG_NOSIGNAL | MSG_DONTWAIT);

#else

    // use TCP_NOPUSH

    return send(fd, buf, length, MSG_NOSIGNAL | MSG_DONTWAIT);

#endif
}

int bsd_would_block() {
#ifdef _WIN32
    return WSAGetLastError() == WSAEWOULDBLOCK;
#else
    return errno == EWOULDBLOCK;// || errno == EAGAIN;
#endif
}

inline __attribute__((always_inline)) LIBUS_SOCKET_DESCRIPTOR bsd_bind_listen_fd(
    LIBUS_SOCKET_DESCRIPTOR listenFd,
    struct addrinfo *listenAddr,
    int port,
    int options
) {

    if (port != 0) {
        /* Otherwise, always enable SO_REUSEPORT and SO_REUSEADDR _unless_ options specify otherwise */
#ifdef _WIN32
        if (options & LIBUS_LISTEN_EXCLUSIVE_PORT) {
            int optval2 = 1;
            setsockopt(listenFd, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (void *) &optval2, sizeof(optval2));
        } else {
            int optval3 = 1;
            setsockopt(listenFd, SOL_SOCKET, SO_REUSEADDR, (void *) &optval3, sizeof(optval3));
        }
#else
    #if /*defined(__linux) &&*/ defined(SO_REUSEPORT)
        if (!(options & LIBUS_LISTEN_EXCLUSIVE_PORT)) {
            int optval = 1;
            setsockopt(listenFd, SOL_SOCKET, SO_REUSEPORT, (void *) &optval, sizeof(optval));
        }
    #endif
        int enabled = 1;
        setsockopt(listenFd, SOL_SOCKET, SO_REUSEADDR, (void *) &enabled, sizeof(enabled));
#endif

    }

#ifdef IPV6_V6ONLY
    int disabled = 0;
    setsockopt(listenFd, IPPROTO_IPV6, IPV6_V6ONLY, (void *) &disabled, sizeof(disabled));
#endif

    if (bind(listenFd, listenAddr->ai_addr, (socklen_t) listenAddr->ai_addrlen) || listen(listenFd, 512)) {
        return LIBUS_SOCKET_ERROR;
    }

    return listenFd;
}

// return LIBUS_SOCKET_ERROR or the fd that represents listen socket
// listen both on ipv6 and ipv4
LIBUS_SOCKET_DESCRIPTOR bsd_create_listen_socket(const char *host, int port, int options) {
    struct addrinfo hints, *result;
    memset(&hints, 0, sizeof(struct addrinfo));

    hints.ai_flags = AI_PASSIVE;
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;

    char port_string[16];
    snprintf(port_string, 16, "%d", port);

    if (getaddrinfo(host, port_string, &hints, &result)) {
        return LIBUS_SOCKET_ERROR;
    }

    LIBUS_SOCKET_DESCRIPTOR listenFd = LIBUS_SOCKET_ERROR;
    struct addrinfo *listenAddr;
    for (struct addrinfo *a = result; a != NULL; a = a->ai_next) {
        if (a->ai_family == AF_INET6) {
            listenFd = bsd_create_socket(a->ai_family, a->ai_socktype, a->ai_protocol);
            if (listenFd == LIBUS_SOCKET_ERROR) {
                continue;
            }

            listenAddr = a;
            if (bsd_bind_listen_fd(listenFd, listenAddr, port, options) != LIBUS_SOCKET_ERROR) {
                freeaddrinfo(result);
                return listenFd;
            }

            bsd_close_socket(listenFd);
        }
    }

    for (struct addrinfo *a = result; a != NULL; a = a->ai_next) {
        if (a->ai_family == AF_INET) {
            listenFd = bsd_create_socket(a->ai_family, a->ai_socktype, a->ai_protocol);
            if (listenFd == LIBUS_SOCKET_ERROR) {
                continue;
            }

            listenAddr = a;
            if (bsd_bind_listen_fd(listenFd, listenAddr, port, options) != LIBUS_SOCKET_ERROR) {
                freeaddrinfo(result);
                return listenFd;
            }

            bsd_close_socket(listenFd);
        }
    }

    freeaddrinfo(result);
    return LIBUS_SOCKET_ERROR;
}

#ifndef _WIN32
#include <sys/un.h>
#else
#include <afunix.h>
#include <io.h>
#endif
#include <sys/stat.h>
#include <stddef.h>
LIBUS_SOCKET_DESCRIPTOR bsd_create_listen_socket_unix(const char *path, int options) {

    LIBUS_SOCKET_DESCRIPTOR listenFd = LIBUS_SOCKET_ERROR;

    listenFd = bsd_create_socket(AF_UNIX, SOCK_STREAM, 0);

    if (listenFd == LIBUS_SOCKET_ERROR) {
        return LIBUS_SOCKET_ERROR;
    }

#ifndef _WIN32
    // 700 permission by default
    fchmod(listenFd, S_IRWXU);
#else
    _chmod(path, S_IREAD | S_IWRITE | S_IEXEC);
#endif

    struct sockaddr_un server_address;
    memset(&server_address, 0, sizeof(server_address));
    server_address.sun_family = AF_UNIX;
    strcpy(server_address.sun_path, path);
    int size = offsetof(struct sockaddr_un, sun_path) + strlen(server_address.sun_path);
#ifdef _WIN32
    _unlink(path);
#else
    unlink(path);
#endif

    if (bind(listenFd, (struct sockaddr *)&server_address, size) || listen(listenFd, 512)) {
        bsd_close_socket(listenFd);
        return LIBUS_SOCKET_ERROR;
    }

    return listenFd;
}

LIBUS_SOCKET_DESCRIPTOR bsd_create_udp_socket(const char *host, int port) {
    struct addrinfo hints, *result;
    memset(&hints, 0, sizeof(struct addrinfo));

    hints.ai_flags = AI_PASSIVE;
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_DGRAM;

    char port_string[16];
    snprintf(port_string, 16, "%d", port);

    if (getaddrinfo(host, port_string, &hints, &result)) {
        return LIBUS_SOCKET_ERROR;
    }

    LIBUS_SOCKET_DESCRIPTOR listenFd = LIBUS_SOCKET_ERROR;
    struct addrinfo *listenAddr;
    for (struct addrinfo *a = result; a && listenFd == LIBUS_SOCKET_ERROR; a = a->ai_next) {
        if (a->ai_family == AF_INET6) {
            listenFd = bsd_create_socket(a->ai_family, a->ai_socktype, a->ai_protocol);
            listenAddr = a;
        }
    }

    for (struct addrinfo *a = result; a && listenFd == LIBUS_SOCKET_ERROR; a = a->ai_next) {
        if (a->ai_family == AF_INET) {
            listenFd = bsd_create_socket(a->ai_family, a->ai_socktype, a->ai_protocol);
            listenAddr = a;
        }
    }

    if (listenFd == LIBUS_SOCKET_ERROR) {
        freeaddrinfo(result);
        return LIBUS_SOCKET_ERROR;
    }

    if (port != 0) {
        /* Should this also go for UDP? */
        int enabled = 1;
        setsockopt(listenFd, SOL_SOCKET, SO_REUSEADDR, (void *) &enabled, sizeof(enabled));
    }
    
#ifdef IPV6_V6ONLY
    int disabled = 0;
    setsockopt(listenFd, IPPROTO_IPV6, IPV6_V6ONLY, (void *) &disabled, sizeof(disabled));
#endif

    /* We need destination address for udp packets in both ipv6 and ipv4 */

/* On FreeBSD this option seems to be called like so */
#ifndef IPV6_RECVPKTINFO
#define IPV6_RECVPKTINFO IPV6_PKTINFO
#endif

    int enabled = 1;
    if (setsockopt(listenFd, IPPROTO_IPV6, IPV6_RECVPKTINFO, (void *) &enabled, sizeof(enabled)) == -1) {
        if (errno == 92) {
            if (setsockopt(listenFd, IPPROTO_IP, IP_PKTINFO, (void *) &enabled, sizeof(enabled)) != 0) {
                printf("Error setting IPv4 pktinfo!\n");
            }
        } else {
            printf("Error setting IPv6 pktinfo!\n");
        }
    }

    /* These are used for getting the ECN */
    if (setsockopt(listenFd, IPPROTO_IPV6, IPV6_RECVTCLASS, (void *) &enabled, sizeof(enabled)) == -1) {
        if (errno == 92) {
            if (setsockopt(listenFd, IPPROTO_IP, IP_RECVTOS, (void *) &enabled, sizeof(enabled)) != 0) {
                printf("Error setting IPv4 ECN!\n");
            }
        } else {
            printf("Error setting IPv6 ECN!\n");
        }
    }

    /* We bind here as well */
    if (bind(listenFd, listenAddr->ai_addr, (socklen_t) listenAddr->ai_addrlen)) {
        bsd_close_socket(listenFd);
        freeaddrinfo(result);
        return LIBUS_SOCKET_ERROR;
    }

    freeaddrinfo(result);
    return listenFd;
}

int bsd_udp_packet_buffer_ecn(void *msgvec, int index) {

#if defined(_WIN32) || defined(__APPLE__)
    printf("ECN not supported!\n");
#else
    // we should iterate all control messages once, after recvmmsg and then only fetch them with these functions
    struct msghdr *mh = &((struct mmsghdr *) msgvec)[index].msg_hdr;
    for (struct cmsghdr *cmsg = CMSG_FIRSTHDR(mh); cmsg != NULL; cmsg = CMSG_NXTHDR(mh, cmsg)) {
        // do we need to get TOS from ipv6 also?
        if (cmsg->cmsg_level == IPPROTO_IP) {
            if (cmsg->cmsg_type == IP_TOS) {
                uint8_t tos = *(uint8_t *)CMSG_DATA(cmsg);
                return tos & 3;
            }
        }

        if (cmsg->cmsg_level == IPPROTO_IPV6) {
            if (cmsg->cmsg_type == IPV6_TCLASS) {
                // is this correct?
                uint8_t tos = *(uint8_t *)CMSG_DATA(cmsg);
                return tos & 3;
            }
        }
    }
#endif

    printf("We got no ECN!\n");

    return 0; // no ecn defaults to 0
}

static int bsd_do_connect_raw(struct addrinfo *rp, int fd)
{
     do {
        if (connect(fd, rp->ai_addr, rp->ai_addrlen) == 0 || errno == EINPROGRESS) {
            return 0;
        }
    } while (errno == EINTR);

    return LIBUS_SOCKET_ERROR;
}

static int bsd_do_connect(struct addrinfo *rp, int *fd)
{
    while (rp != NULL) {
        if (bsd_do_connect_raw(rp, *fd) == 0) {
            return 0;
        }

        rp = rp->ai_next;
        bsd_close_socket(*fd);

        if (rp == NULL) {
            return LIBUS_SOCKET_ERROR;
        }

        int resultFd = bsd_create_socket(rp->ai_family, rp->ai_socktype, rp->ai_protocol);
        if (resultFd < 0) {
            return LIBUS_SOCKET_ERROR;
        }
        *fd = resultFd;
    }

    return LIBUS_SOCKET_ERROR;
}

LIBUS_SOCKET_DESCRIPTOR bsd_create_connect_socket(const char *host, int port, const char *source_host, int options) {
    struct addrinfo hints, *result;
    memset(&hints, 0, sizeof(struct addrinfo));
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;

    char port_string[16];
    snprintf(port_string, 16, "%d", port);

    if (getaddrinfo(host, port_string, &hints, &result) != 0) {
        return LIBUS_SOCKET_ERROR;
    }

    LIBUS_SOCKET_DESCRIPTOR fd = bsd_create_socket(result->ai_family, result->ai_socktype, result->ai_protocol);
    if (fd == LIBUS_SOCKET_ERROR) {
        freeaddrinfo(result);
        return LIBUS_SOCKET_ERROR;
    }

    if (source_host) {
        struct addrinfo *interface_result;
        if (!getaddrinfo(source_host, NULL, NULL, &interface_result)) {
            int ret = bind(fd, interface_result->ai_addr, (socklen_t) interface_result->ai_addrlen);
            freeaddrinfo(interface_result);
            if (ret == LIBUS_SOCKET_ERROR) {
                bsd_close_socket(fd);
                freeaddrinfo(result);
                return LIBUS_SOCKET_ERROR;
            }
        }

        if (bsd_do_connect_raw(result, fd) != 0) {
            bsd_close_socket(fd);
            freeaddrinfo(result);
            return LIBUS_SOCKET_ERROR;
        }
    } else {
        if (bsd_do_connect(result, &fd) != 0) {
            freeaddrinfo(result);
            return LIBUS_SOCKET_ERROR;
        }
    }
    
    
    freeaddrinfo(result);
    return fd;
}

LIBUS_SOCKET_DESCRIPTOR bsd_create_connect_socket_unix(const char *server_path, int options) {

    struct sockaddr_un server_address;
    memset(&server_address, 0, sizeof(server_address));
    server_address.sun_family = AF_UNIX;
    strcpy(server_address.sun_path, server_path);
    int size = offsetof(struct sockaddr_un, sun_path) + strlen(server_address.sun_path);

    LIBUS_SOCKET_DESCRIPTOR fd = bsd_create_socket(AF_UNIX, SOCK_STREAM, 0);

    if (fd == LIBUS_SOCKET_ERROR) {
        return LIBUS_SOCKET_ERROR;
    }

    if (connect(fd, (struct sockaddr *)&server_address, size) != 0 && errno != EINPROGRESS) {
        bsd_close_socket(fd);
        return LIBUS_SOCKET_ERROR;
    }

    return fd;
}
