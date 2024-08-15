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
// Necessary for the stdint include
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#else /* _WIN32 */
#include <mstcpip.h>
#endif

#if defined(__APPLE__)
extern int Bun__doesMacOSVersionSupportSendRecvMsgX();
#endif


/* We need to emulate sendmmsg, recvmmsg on platform who don't have it */
int bsd_sendmmsg(LIBUS_SOCKET_DESCRIPTOR fd, struct udp_sendbuf* sendbuf, int flags) {
#if defined(_WIN32)// || defined(__APPLE__)
    for (int i = 0; i < sendbuf->num; i++) {
        while (1) {
            int ret = 0;
            struct sockaddr *addr = (struct sockaddr *)sendbuf->addresses[i];
            if (!addr || addr->sa_family == AF_UNSPEC) {
                ret = send(fd, sendbuf->payloads[i], sendbuf->lengths[i], flags);
            } else if (addr->sa_family == AF_INET) {
                socklen_t len = sizeof(struct sockaddr_in);
                ret = sendto(fd, sendbuf->payloads[i], sendbuf->lengths[i], flags, addr, len);
            } else if (addr->sa_family == AF_INET6) {
                socklen_t len = sizeof(struct sockaddr_in6);
                ret = sendto(fd, sendbuf->payloads[i], sendbuf->lengths[i], flags, addr, len);
            } else {
                errno = EAFNOSUPPORT;
                return -1;
            }
            int err = WSAGetLastError();
            if (ret < 0) {
                if (err == WSAEINTR) continue;
                if (err == WSAEWOULDBLOCK) return i;
                return ret;
            }
            break;
        }
    }
    return sendbuf->num;
#elif defined(__APPLE__)
    // sendmsg_x does not support addresses.
    if (!sendbuf->has_empty && !sendbuf->has_addresses && Bun__doesMacOSVersionSupportSendRecvMsgX()) {
        while (1) {
            int ret = sendmsg_x(fd, sendbuf->msgvec, sendbuf->num, flags);
            if (ret >= 0) return ret;
            // If we receive EMMSGSIZE, we should use the fallback code.
            if (errno == EMSGSIZE) break;
            if (errno != EINTR) return ret;
        }
    }

    for (size_t i = 0, count = sendbuf->num; i < count; i++) {
        while (1) {
            ssize_t ret = sendmsg(fd, &sendbuf->msgvec[i].msg_hdr, flags);
            if (ret < 0) {
                if (errno == EINTR) continue;
                if (errno == EAGAIN || errno == EWOULDBLOCK) return i;
                return ret;
            }
            break;
        }
    }

    return sendbuf->num;
#else
    while (1) {
        int ret = sendmmsg(fd, sendbuf->msgvec, sendbuf->num, flags | MSG_NOSIGNAL);
        if (ret >= 0 || errno != EINTR) return ret;
    }
#endif
}

int bsd_recvmmsg(LIBUS_SOCKET_DESCRIPTOR fd, struct udp_recvbuf *recvbuf, int flags) {
#if defined(_WIN32)
    socklen_t addr_len = sizeof(struct sockaddr_storage);
    while (1) {
        ssize_t ret = recvfrom(fd, recvbuf->buf, LIBUS_RECV_BUFFER_LENGTH, flags, (struct sockaddr *)&recvbuf->addr, &addr_len);
        if (ret < 0) {
            if (WSAGetLastError() == WSAEINTR) continue;
            return ret;
        }
        recvbuf->recvlen = ret;
        return 1;
    }
#elif defined(__APPLE__)
    if (Bun__doesMacOSVersionSupportSendRecvMsgX()) {
        while (1) {
            int ret = recvmsg_x(fd, recvbuf->msgvec, LIBUS_UDP_RECV_COUNT, flags);
            if (ret >= 0 || errno != EINTR) return ret;
        }
    }

    for (int i = 0; i < LIBUS_UDP_RECV_COUNT; ++i) {
        while (1) {
            ssize_t ret = recvmsg(fd, &recvbuf->msgvec[i].msg_hdr, flags);
            if (ret < 0) {
                if (errno == EINTR) continue;
                if (errno == EAGAIN || errno == EWOULDBLOCK) return i;
                return ret;
            }
            recvbuf->msgvec[i].msg_len = ret;
            break;
        }
    }
    return LIBUS_UDP_RECV_COUNT;
#else
    while (1) {
        int ret = recvmmsg(fd, (struct mmsghdr *)&recvbuf->msgvec, LIBUS_UDP_RECV_COUNT, flags, 0);
        if (ret >= 0 || errno != EINTR) return ret;
    }
#endif
}

void bsd_udp_setup_recvbuf(struct udp_recvbuf *recvbuf, void *databuf, size_t databuflen) {
#if defined(_WIN32)
    recvbuf->buf = databuf;
    recvbuf->buflen = databuflen;
#else
    // assert(databuflen > LIBUS_UDP_MAX_SIZE * LIBUS_UDP_RECV_COUNT);
    memset(recvbuf, 0, sizeof(struct udp_recvbuf));
    for (size_t i = 0; i < LIBUS_UDP_RECV_COUNT; i++) {
        recvbuf->iov[i].iov_base = (char*)databuf + i * LIBUS_UDP_MAX_SIZE;
        recvbuf->iov[i].iov_len = LIBUS_UDP_MAX_SIZE;

        struct msghdr mh = {};
        memset(&mh, 0, sizeof(struct msghdr));
        mh.msg_name = &recvbuf->addr[i];
        mh.msg_namelen = sizeof(struct sockaddr_storage);
        mh.msg_iov = &recvbuf->iov[i];
        mh.msg_iovlen = 1;
        mh.msg_control = recvbuf->control[i];
        mh.msg_controllen = sizeof(recvbuf->control[i]);
        recvbuf->msgvec[i].msg_hdr = mh;
    }
#endif
}

int bsd_udp_setup_sendbuf(struct udp_sendbuf *buf, size_t bufsize, void** payloads, size_t* lengths, void** addresses, int num) {
#if defined(_WIN32)
    buf->payloads = payloads;
    buf->lengths = lengths;
    buf->addresses = addresses;
    buf->num = num;
    return num;
#else
    // TODO: can we skip empty messages altogether? Do we really need to send 0-length messages?
    buf->has_empty = 0;

    // sendmsg_x docs states it does not support addresses.
    buf->has_addresses = 0;

    struct mmsghdr *msgvec = buf->msgvec;
    // todo check this math
    size_t count = (bufsize - sizeof(struct udp_sendbuf)) / (sizeof(struct mmsghdr) + sizeof(struct iovec));
    if (count > num) {
        count = num;
    }
    struct iovec *iov = (struct iovec *) (msgvec + count);
    for (int i = 0; i < count; i++) {
        struct sockaddr *addr = (struct sockaddr *)addresses[i];
        socklen_t addr_len = 0;
        if (addr) {
            addr_len = addr->sa_family == AF_INET ? sizeof(struct sockaddr_in) 
                     : addr->sa_family == AF_INET6 ? sizeof(struct sockaddr_in6) 
                     : 0;
            if (addr_len > 0) {
                buf->has_addresses = 1;
            }
        }
        iov[i].iov_base = payloads[i];
        iov[i].iov_len = lengths[i];
        msgvec[i].msg_hdr.msg_name = addresses[i];
        msgvec[i].msg_hdr.msg_namelen = addr_len;
        msgvec[i].msg_hdr.msg_control = NULL;
        msgvec[i].msg_hdr.msg_controllen = 0;
        msgvec[i].msg_hdr.msg_iov = iov + i;
        msgvec[i].msg_hdr.msg_iovlen = 1;
        msgvec[i].msg_hdr.msg_flags = 0;
        msgvec[i].msg_len = 0;


        if (lengths[i] == 0) {
            buf->has_empty = 1;
        }
    }
    buf->num = count;
    return count;
#endif
}

// this one is needed for knowing the destination addr of udp packet
// an udp socket can only bind to one port, and that port never changes
// this function returns ONLY the IP address, not any port
int bsd_udp_packet_buffer_local_ip(struct udp_recvbuf *msgvec, int index, char *ip) {
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

char *bsd_udp_packet_buffer_peer(struct udp_recvbuf *msgvec, int index) {
#if defined(_WIN32)
    return (char *)&msgvec->addr;
#else
    return ((struct mmsghdr *) msgvec)[index].msg_hdr.msg_name;
#endif
}

char *bsd_udp_packet_buffer_payload(struct udp_recvbuf *msgvec, int index) {
#if defined(_WIN32)
    return msgvec->buf;
#else
    return ((struct mmsghdr *) msgvec)[index].msg_hdr.msg_iov[0].iov_base;
#endif
}

int bsd_udp_packet_buffer_payload_length(struct udp_recvbuf *msgvec, int index) {
#if defined(_WIN32)
    return msgvec->recvlen;
#else
    return ((struct mmsghdr *) msgvec)[index].msg_len;
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

static LIBUS_SOCKET_DESCRIPTOR win32_set_nonblocking(LIBUS_SOCKET_DESCRIPTOR fd) {
#if _WIN32
    if (fd != LIBUS_SOCKET_ERROR) {
        // libuv will set non-blocking, but only on poll init!
        // we need it to be set on connect as well
        DWORD yes = 1;
        ioctlsocket(fd, FIONBIO, &yes);
    }
    return fd;
#else
    return fd;
#endif
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
#if defined(SOCK_CLOEXEC) && defined(SOCK_NONBLOCK)
    int flags = SOCK_CLOEXEC | SOCK_NONBLOCK;
    LIBUS_SOCKET_DESCRIPTOR created_fd = socket(domain, type | flags, protocol);
    return apple_no_sigpipe(created_fd);
#else
    LIBUS_SOCKET_DESCRIPTOR created_fd = socket(domain, type, protocol);
    return bsd_set_nonblocking(apple_no_sigpipe(created_fd));
#endif
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

    while (1) {
        addr->len = sizeof(addr->mem);

#if defined(SOCK_CLOEXEC) && defined(SOCK_NONBLOCK)
    // Linux, FreeBSD
    accepted_fd = accept4(fd, (struct sockaddr *) addr, &addr->len, SOCK_CLOEXEC | SOCK_NONBLOCK);
#else
    // Windows, OS X
    accepted_fd = accept(fd, (struct sockaddr *) addr, &addr->len);
#endif

        if (UNLIKELY(IS_EINTR(accepted_fd))) {
            continue;
        }

        /* We cannot rely on addr since it is not initialized if failed */
        if (accepted_fd == LIBUS_SOCKET_ERROR) {
            return LIBUS_SOCKET_ERROR;
        }

        break;
    }

    internal_finalize_bsd_addr(addr);

#if defined(SOCK_CLOEXEC) && defined(SOCK_NONBLOCK)
// skip the extra fcntl calls.
    return accepted_fd;
#else
    return bsd_set_nonblocking(apple_no_sigpipe(accepted_fd));
#endif
}

ssize_t bsd_recv(LIBUS_SOCKET_DESCRIPTOR fd, void *buf, int length, int flags) {
    while (1) {
        ssize_t ret = recv(fd, buf, length, flags);

        if (UNLIKELY(IS_EINTR(ret))) {
            continue;
        }

        return ret;
    }
}

#if !defined(_WIN32)
#include <sys/uio.h>

ssize_t bsd_write2(LIBUS_SOCKET_DESCRIPTOR fd, const char *header, int header_length, const char *payload, int payload_length) {
    struct iovec chunks[2];

    chunks[0].iov_base = (char *)header;
    chunks[0].iov_len = header_length;
    chunks[1].iov_base = (char *)payload;
    chunks[1].iov_len = payload_length;

    while (1) {
        ssize_t written = writev(fd, chunks, 2);

        if (UNLIKELY(IS_EINTR(written))) {
            continue;
        }

        return written;
    }
}
#else
ssize_t bsd_write2(LIBUS_SOCKET_DESCRIPTOR fd, const char *header, int header_length, const char *payload, int payload_length) {
    ssize_t written = bsd_send(fd, header, header_length, 0);
    if (written == header_length) {
        ssize_t second_write = bsd_send(fd, payload, payload_length, 0);
        if (second_write > 0) {
            written += second_write;
        }
    }
    return written;
}
#endif

ssize_t bsd_send(LIBUS_SOCKET_DESCRIPTOR fd, const char *buf, int length, int msg_more) {
    while (1) {
    // MSG_MORE (Linux), MSG_PARTIAL (Windows), TCP_NOPUSH (BSD)

#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0
#endif

        #ifdef MSG_MORE
            // for Linux we do not want signals
            ssize_t rc = send(fd, buf, length, ((msg_more != 0) * MSG_MORE) | MSG_NOSIGNAL | MSG_DONTWAIT);
        #else
            // use TCP_NOPUSH
            ssize_t rc = send(fd, buf, length, MSG_NOSIGNAL | MSG_DONTWAIT);
        #endif

        if (UNLIKELY(IS_EINTR(rc))) {
            continue;
        }

        return rc;
    }
}

int bsd_would_block() {
#ifdef _WIN32
    return WSAGetLastError() == WSAEWOULDBLOCK;
#else
    return errno == EWOULDBLOCK;// || errno == EAGAIN;
#endif
}

static int us_internal_bind_and_listen(LIBUS_SOCKET_DESCRIPTOR listenFd, struct sockaddr *listenAddr, socklen_t listenAddrLength, int backlog) {
    int result;
    do 
        result = bind(listenFd, listenAddr, listenAddrLength);
    while (IS_EINTR(result));

    if (result == -1) {
        return -1;
    }

    do 
        result = listen(listenFd, backlog);
    while (IS_EINTR(result));

    return result;
}

inline __attribute__((always_inline)) LIBUS_SOCKET_DESCRIPTOR bsd_bind_listen_fd(
    LIBUS_SOCKET_DESCRIPTOR listenFd,
    struct addrinfo *listenAddr,
    int port,
    int options
) {

     if ((options & LIBUS_LISTEN_EXCLUSIVE_PORT)) {
#if _WIN32
        int optval2 = 1;
        setsockopt(listenFd, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (void *) &optval2, sizeof(optval2));
#endif
    } else {
      #if defined(SO_REUSEPORT)
        int optval2 = 1;
        setsockopt(listenFd, SOL_SOCKET, SO_REUSEPORT, (void *) &optval2, sizeof(optval2));  
        #endif
    }

#if defined(SO_REUSEADDR)
    int optval3 = 1;
    setsockopt(listenFd, SOL_SOCKET, SO_REUSEADDR, (void *) &optval3, sizeof(optval3));
#endif

#ifdef IPV6_V6ONLY
    int disabled = 0;
    setsockopt(listenFd, IPPROTO_IPV6, IPV6_V6ONLY, (void *) &disabled, sizeof(disabled));
#endif

    if (us_internal_bind_and_listen(listenFd, listenAddr->ai_addr, (socklen_t) listenAddr->ai_addrlen, 512)) {
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

static LIBUS_SOCKET_DESCRIPTOR bsd_create_unix_socket_address(const char *path, size_t path_len, int* dirfd_linux_workaround_for_unix_path_len, struct sockaddr_un *server_address, size_t* addrlen) {
    memset(server_address, 0, sizeof(struct sockaddr_un));
    server_address->sun_family = AF_UNIX;

    if (path_len == 0) {
        #if defined(_WIN32)
            // simulate ENOENT
            SetLastError(ERROR_PATH_NOT_FOUND);
        #else
            errno = ENOENT;
        #endif
        return LIBUS_SOCKET_ERROR;
    }

    *addrlen = sizeof(struct sockaddr_un);

    #if defined(__linux__)
        // Unix socket addresses have a maximum length of 108 bytes on Linux
        // As a workaround, we can use /proc/self/fd/ as a directory to shorten the path
        if (path_len >= sizeof(server_address->sun_path) && path[0] != '\0') {
            size_t dirname_len = path_len;
            // get the basename
            while (dirname_len > 1 && path[dirname_len - 1] != '/') {
                dirname_len--;
            }

            // if the path is just a single character, or the path is too long, we cannot use this method
            if (dirname_len < 2 || (path_len - dirname_len + 1) >= sizeof(server_address->sun_path)) {
                errno = ENAMETOOLONG;
                return LIBUS_SOCKET_ERROR;
            }

            char dirname_buf[4096];
            if (dirname_len + 1 > sizeof(dirname_buf)) {
                errno = ENAMETOOLONG;
                return LIBUS_SOCKET_ERROR;
            }

            memcpy(dirname_buf, path, dirname_len);
            dirname_buf[dirname_len] = 0;

            int socket_dir_fd = open(dirname_buf, O_CLOEXEC | O_PATH | O_DIRECTORY, 0700);
            if (socket_dir_fd == -1) {
                errno = ENAMETOOLONG;
                return LIBUS_SOCKET_ERROR;
            }

            int sun_path_len = snprintf(server_address->sun_path, sizeof(server_address->sun_path), "/proc/self/fd/%d/%s", socket_dir_fd, path + dirname_len);
            if (sun_path_len >= sizeof(server_address->sun_path) || sun_path_len < 0) {
                close(socket_dir_fd);
                errno = ENAMETOOLONG;
                return LIBUS_SOCKET_ERROR;
            }

            *dirfd_linux_workaround_for_unix_path_len = socket_dir_fd;
            return 0;
        } else if (path_len < sizeof(server_address->sun_path)) {
            memcpy(server_address->sun_path, path, path_len);

            // abstract domain sockets
            if (server_address->sun_path[0] == 0) {
                *addrlen = offsetof(struct sockaddr_un, sun_path) + path_len;
            }

            return 0;
        }
    #endif

    if (path_len >= sizeof(server_address->sun_path)) {
        #if defined(_WIN32)
            // simulate ENAMETOOLONG
            SetLastError(ERROR_FILENAME_EXCED_RANGE);    
        #else
            errno = ENAMETOOLONG;
        #endif
        
        return LIBUS_SOCKET_ERROR;
    }

    memcpy(server_address->sun_path, path, path_len);
    return 0;
}

static LIBUS_SOCKET_DESCRIPTOR internal_bsd_create_listen_socket_unix(const char* path, int options, struct sockaddr_un* server_address, size_t addrlen) {
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

#ifdef _WIN32
    _unlink(path);
#else
    unlink(path);
#endif

    if (us_internal_bind_and_listen(listenFd, (struct sockaddr *) server_address, (socklen_t) addrlen, 512)) {
        #if defined(_WIN32)
          int shouldSimulateENOENT = WSAGetLastError() == WSAENETDOWN;
        #endif
        bsd_close_socket(listenFd);
        #if defined(_WIN32)
            if (shouldSimulateENOENT) {
                SetLastError(ERROR_PATH_NOT_FOUND);
            }
        #endif
        return LIBUS_SOCKET_ERROR;
    }

    return listenFd;
}

LIBUS_SOCKET_DESCRIPTOR bsd_create_listen_socket_unix(const char *path, size_t len, int options) {
    int dirfd_linux_workaround_for_unix_path_len = -1;
    struct sockaddr_un server_address;
    size_t addrlen = 0;
    if (bsd_create_unix_socket_address(path, len, &dirfd_linux_workaround_for_unix_path_len, &server_address, &addrlen)) {
        return LIBUS_SOCKET_ERROR;
    }

    LIBUS_SOCKET_DESCRIPTOR listenFd = internal_bsd_create_listen_socket_unix(path, options, &server_address, addrlen);

#if defined(__linux__)
    if (dirfd_linux_workaround_for_unix_path_len != -1) {
        close(dirfd_linux_workaround_for_unix_path_len);
    }
#endif

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
    struct addrinfo *listenAddr = NULL;
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
                //printf("Error setting IPv4 pktinfo!\n");
            }
        } else {
            //printf("Error setting IPv6 pktinfo!\n");
        }
    }

    /* These are used for getting the ECN */
    if (setsockopt(listenFd, IPPROTO_IPV6, IPV6_RECVTCLASS, (void *) &enabled, sizeof(enabled)) == -1) {
        if (errno == 92) {
            if (setsockopt(listenFd, IPPROTO_IP, IP_RECVTOS, (void *) &enabled, sizeof(enabled)) != 0) {
                //printf("Error setting IPv4 ECN!\n");
            }
        } else {
            //printf("Error setting IPv6 ECN!\n");
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

int bsd_connect_udp_socket(LIBUS_SOCKET_DESCRIPTOR fd, const char *host, int port) {
    struct addrinfo hints, *result;
    memset(&hints, 0, sizeof(struct addrinfo));

    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_DGRAM;

    char port_string[16];
    snprintf(port_string, 16, "%d", port);

    if (getaddrinfo(host, port_string, &hints, &result)) {
        return -1;
    }

    if (result == NULL) {
        return -1;
    }

    for (struct addrinfo *rp = result; rp != NULL; rp = rp->ai_next) {
        if (connect(fd, rp->ai_addr, rp->ai_addrlen) == 0) {
            freeaddrinfo(result);
            return 0;
        }
    }

    freeaddrinfo(result);
    return (int)LIBUS_SOCKET_ERROR;
}

int bsd_disconnect_udp_socket(LIBUS_SOCKET_DESCRIPTOR fd) {
    struct sockaddr addr;
    memset(&addr, 0, sizeof(addr));
    addr.sa_family = AF_UNSPEC;
    #ifdef __APPLE__
    addr.sa_len = sizeof(addr);
    #endif

    int res = connect(fd, &addr, sizeof(addr));
    // EAFNOSUPPORT is harmless in this case - we just want to disconnect
    if (res == 0 || 
#ifdef _WIN32
    WSAGetLastError() == WSAEAFNOSUPPORT
#else
    errno == EAFNOSUPPORT
#endif
    ) {
        return 0;
    } else {
        return -1;
    }
}

// int bsd_udp_packet_buffer_ecn(void *msgvec, int index) {

// #if defined(_WIN32) || defined(__APPLE__)
//     errno = ENOSYS;
//     return -1;
// #else
//     // we should iterate all control messages once, after recvmmsg and then only fetch them with these functions
//     struct msghdr *mh = &((struct mmsghdr *) msgvec)[index].msg_hdr;
//     for (struct cmsghdr *cmsg = CMSG_FIRSTHDR(mh); cmsg != NULL; cmsg = CMSG_NXTHDR(mh, cmsg)) {
//         // do we need to get TOS from ipv6 also?
//         if (cmsg->cmsg_level == IPPROTO_IP) {
//             if (cmsg->cmsg_type == IP_TOS) {
//                 uint8_t tos = *(uint8_t *)CMSG_DATA(cmsg);
//                 return tos & 3;
//             }
//         }

//         if (cmsg->cmsg_level == IPPROTO_IPV6) {
//             if (cmsg->cmsg_type == IPV6_TCLASS) {
//                 // is this correct?
//                 uint8_t tos = *(uint8_t *)CMSG_DATA(cmsg);
//                 return tos & 3;
//             }
//         }
//     }
// #endif

//     //printf("We got no ECN!\n");
//     return 0; // no ecn defaults to 0
// }

static int bsd_do_connect_raw(LIBUS_SOCKET_DESCRIPTOR fd, struct sockaddr *addr, size_t namelen)
{
#ifdef _WIN32
    while (1) {
        if (connect(fd, (struct sockaddr *)addr, namelen) == 0) {
            return 0;
        }

        int err = WSAGetLastError();
        switch (err) {
            case WSAEINPROGRESS:
            case WSAEWOULDBLOCK:
            case WSAEALREADY: {
                return 0;
            }
            case WSAEINTR: {
                continue;
            }
            default: {
                return err;
            }
        }
    }

    
#else
    int r;
     do {
        errno = 0;
        r = connect(fd, (struct sockaddr *)addr, namelen);
    } while (IS_EINTR(r));
    
    // connect() can return -1 with an errno of 0.
    // the errno is the correct one in that case.
    if (r == -1 && errno != 0) {
        if (errno == EINPROGRESS) {
            return 0;
        }

        return errno;
    }
    
    return 0;
#endif
}

#ifdef _WIN32

static int convert_null_addr(const struct sockaddr_storage *addr, struct sockaddr_storage* result) {
    // 1. check that all addrinfo results are 0.0.0.0 or ::
    if (addr->ss_family == AF_INET) {
        struct sockaddr_in *addr4 = (struct sockaddr_in *) addr;
        if (addr4->sin_addr.s_addr == htonl(INADDR_ANY)) {
            memcpy(result, addr, sizeof(struct sockaddr_in));
            ((struct sockaddr_in *) result)->sin_addr.s_addr = htonl(INADDR_LOOPBACK);
            return 1;
        }
    } else if (addr->ss_family == AF_INET6) {
        struct sockaddr_in6 *addr6 = (struct sockaddr_in6 *) addr;
        if (memcmp(&addr6->sin6_addr, &in6addr_any, sizeof(struct in6_addr)) == 0) {
            memcpy(result, addr, sizeof(struct sockaddr_in6));
            memcpy(&((struct sockaddr_in6 *) result)->sin6_addr, &in6addr_loopback, sizeof(struct in6_addr));
            return 1;
        }
    }
    return 0;
} 

static int is_loopback(struct sockaddr_storage *sockaddr) {
    if (sockaddr->ss_family == AF_INET) {
        struct sockaddr_in *addr = (struct sockaddr_in *) sockaddr;
        return addr->sin_addr.s_addr == htonl(INADDR_LOOPBACK);
    } else if (sockaddr->ss_family == AF_INET6) {
        struct sockaddr_in6 *addr = (struct sockaddr_in6 *) sockaddr;
        return memcmp(&addr->sin6_addr, &in6addr_loopback, sizeof(struct in6_addr)) == 0;
    } else {
        return 0;
    }
}
#endif

LIBUS_SOCKET_DESCRIPTOR bsd_create_connect_socket(struct sockaddr_storage *addr, int options) {
    LIBUS_SOCKET_DESCRIPTOR fd = bsd_create_socket(addr->ss_family, SOCK_STREAM, 0);
    if (fd == LIBUS_SOCKET_ERROR) {
        return LIBUS_SOCKET_ERROR;
    }

#ifdef _WIN32
    win32_set_nonblocking(fd);

    // On windows we can't connect to the null address directly. 
    // To match POSIX behavior, we need to connect to localhost instead.
    struct sockaddr_storage converted;
    if (convert_null_addr(addr, &converted)) {
        addr = &converted;
    }

    // This sets the socket to fail quickly if no connection can be established to localhost,
    // instead of waiting for the default 2 seconds. This is necessary because we always try to connect
    // using IPv6 first, but it's possible that whatever we want to connect to is only listening on IPv4.
    // see https://github.com/libuv/libuv/blob/bf61390769068de603e6deec8e16623efcbe761a/src/win/tcp.c#L806
    TCP_INITIAL_RTO_PARAMETERS retransmit_ioctl;
    DWORD bytes;
    if (is_loopback(addr)) {
        memset(&retransmit_ioctl, 0, sizeof(retransmit_ioctl));
        retransmit_ioctl.Rtt = TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS;
        retransmit_ioctl.MaxSynRetransmissions = TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS;
        WSAIoctl(fd,
                SIO_TCP_INITIAL_RTO,
                &retransmit_ioctl,
                sizeof(retransmit_ioctl),
                NULL,
                0,
                &bytes,
                NULL,
                NULL);
    }

#endif
    int rc = bsd_do_connect_raw(fd, (struct sockaddr*) addr, addr->ss_family == AF_INET ? sizeof(struct sockaddr_in) : sizeof(struct sockaddr_in6));

    if (rc != 0) {
        bsd_close_socket(fd);
        return LIBUS_SOCKET_ERROR;
    }
    return fd;
}

static LIBUS_SOCKET_DESCRIPTOR internal_bsd_create_connect_socket_unix(const char *server_path, size_t len, int options, struct sockaddr_un* server_address, const size_t addrlen) {
    LIBUS_SOCKET_DESCRIPTOR fd = bsd_create_socket(AF_UNIX, SOCK_STREAM, 0);

    if (fd == LIBUS_SOCKET_ERROR) {
        return LIBUS_SOCKET_ERROR;
    }

    win32_set_nonblocking(fd);

    if (bsd_do_connect_raw(fd, (struct sockaddr *)server_address, addrlen) != 0) {
        bsd_close_socket(fd);
        return LIBUS_SOCKET_ERROR;
    }

    return fd;
}

LIBUS_SOCKET_DESCRIPTOR bsd_create_connect_socket_unix(const char *server_path, size_t len, int options) {
    struct sockaddr_un server_address;
    size_t addrlen = 0;
    int dirfd_linux_workaround_for_unix_path_len = -1;
    if (bsd_create_unix_socket_address(server_path, len, &dirfd_linux_workaround_for_unix_path_len, &server_address, &addrlen)) {
        return LIBUS_SOCKET_ERROR;
    }

    LIBUS_SOCKET_DESCRIPTOR fd = internal_bsd_create_connect_socket_unix(server_path, len, options, &server_address, addrlen);

    #if defined(__linux__)
    if (dirfd_linux_workaround_for_unix_path_len != -1) {
        close(dirfd_linux_workaround_for_unix_path_len);
    }
    #endif

    return fd;
}
