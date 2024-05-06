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

#if defined(__APPLE__) && defined(__aarch64__)
#define HAS_MSGX
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
            if (ret < 0) {
                if (errno == EINTR) continue;
                if (errno == EAGAIN || errno == EWOULDBLOCK) return i;
                return ret;
            }
            break;
        }
    }
    return sendbuf->num;
#elif defined(__APPLE__)
    // TODO figure out why sendmsg_x fails when one of the messages is empty
    // so that we can get rid of this code.
    // One of the weird things is that once a non-empty message has been sent on the socket,
    // empty messages start working as well. Bizzare.
#ifdef HAS_MSGX
    if (sendbuf->has_empty) {
#endif
        for (int i = 0; i < sendbuf->num; i++) {
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
#ifdef HAS_MSGX
    }
    while (1) {
        int ret = sendmsg_x(fd, sendbuf->msgvec, sendbuf->num, flags);
        if (ret >= 0 || errno != EINTR) return ret;
    }
#endif
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
            if (errno == EINTR) continue;
            return ret;
        }
        recvbuf->recvlen = ret;
        return 1;
    }
#elif defined(__APPLE__)
#ifdef HAS_MSGX
    while (1) {
        int ret = recvmsg_x(fd, recvbuf->msgvec, LIBUS_UDP_RECV_COUNT, flags);
        if (ret >= 0 || errno != EINTR) return ret;
    }
#else
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
#endif
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

    for (int i = 0; i < LIBUS_UDP_RECV_COUNT; i++) {
        recvbuf->iov[i].iov_base = (char*)databuf + i * LIBUS_UDP_MAX_SIZE;
        recvbuf->iov[i].iov_len = LIBUS_UDP_MAX_SIZE;

        recvbuf->msgvec[i].msg_hdr.msg_name = &recvbuf->addr[i];
        recvbuf->msgvec[i].msg_hdr.msg_namelen = sizeof(struct sockaddr_storage);

        recvbuf->msgvec[i].msg_hdr.msg_iov = &recvbuf->iov[i];
        recvbuf->msgvec[i].msg_hdr.msg_iovlen = 1;

        recvbuf->msgvec[i].msg_hdr.msg_control = recvbuf->control[i];
        recvbuf->msgvec[i].msg_hdr.msg_controllen = 256;
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
    buf->has_empty = 0;
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

#if defined(SOCK_CLOEXEC) && defined(SOCK_NONBLOCK)
// skip the extra fcntl calls.
    return accepted_fd;
#else
    return bsd_set_nonblocking(apple_no_sigpipe(accepted_fd));
#endif
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
    #if /*defined(__linux__) &&*/ defined(SO_REUSEPORT)
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

static int bsd_create_unix_socket_address(const char *path, size_t path_len, int* dirfd_linux_workaround_for_unix_path_len, struct sockaddr_un *server_address, size_t* addrlen) {
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

    if (bind(listenFd, (struct sockaddr *)server_address, addrlen) || listen(listenFd, 512)) {
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
    return LIBUS_SOCKET_ERROR;
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
    if (res == 0 || errno == EAFNOSUPPORT) {
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
#ifdef _WIN32
    // The caller (sometimes) uses NULL to indicate localhost. This works fine with getaddrinfo, but not with WSAConnectByName
    if (!host) {
        host = "localhost";
    } else if (strcmp(host, "0.0.0.0") == 0 || strcmp(host, "::") == 0 || strcmp(host, "[::]") == 0) {
        // windows disallows connecting to 0.0.0.0. To emulate POSIX behavior, we connect to localhost instead
        // Also see https://docs.libuv.org/en/v1.x/tcp.html#c.uv_tcp_connect
        host = "localhost";
    }
    // On windows we use WSAConnectByName to speed up connecting to localhost
    // The other implementation also works on windows, but is slower
    char port_string[16];
    snprintf(port_string, 16, "%d", port);
    SOCKET s = socket(AF_INET6, SOCK_STREAM, 0);
    if (s == INVALID_SOCKET) {
        return LIBUS_SOCKET_ERROR;
    }

    // https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-wsaconnectbynamea#remarks
    DWORD zero = 0;
    if (SOCKET_ERROR == setsockopt(s, IPPROTO_IPV6, IPV6_V6ONLY, (const char*)&zero, sizeof(DWORD))) {
        closesocket(s);
        return LIBUS_SOCKET_ERROR;
    }
    if (source_host) {
        struct addrinfo *interface_result;
        if (!getaddrinfo(source_host, NULL, NULL, &interface_result)) {
            int ret = bind(s, interface_result->ai_addr, (socklen_t) interface_result->ai_addrlen);
            freeaddrinfo(interface_result);
            if (ret == SOCKET_ERROR) {
                closesocket(s);
                return LIBUS_SOCKET_ERROR;
            }
        }
    }
    SOCKADDR_STORAGE local;
    SOCKADDR_STORAGE remote;
    DWORD local_len = sizeof(local);
    DWORD remote_len = sizeof(remote);
    if (FALSE == WSAConnectByNameA(s, host, port_string, &local_len, (SOCKADDR*)&local, &remote_len, (SOCKADDR*)&remote, NULL, NULL)) {
        closesocket(s);
        return LIBUS_SOCKET_ERROR;
    }

    // See
    // - https://stackoverflow.com/questions/60591081/getpeername-always-fails-with-error-code-wsaenotconn
    // - https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-wsaconnectbynamea#remarks
    //
    // When the WSAConnectByName function returns TRUE, the socket s is in the default state for a connected socket. 
    // The socket s does not enable previously set properties or options until SO_UPDATE_CONNECT_CONTEXT is set on the socket. 
    // Use the setsockopt function to set the SO_UPDATE_CONNECT_CONTEXT option.
    //
    if (SOCKET_ERROR == setsockopt( s, SOL_SOCKET, SO_UPDATE_CONNECT_CONTEXT, NULL, 0 )) {
        closesocket(s);
        return LIBUS_SOCKET_ERROR;
    }
    return s;
#else
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
#endif
}

static LIBUS_SOCKET_DESCRIPTOR internal_bsd_create_connect_socket_unix(const char *server_path, size_t len, int options, struct sockaddr_un* server_address, const size_t addrlen) {
    LIBUS_SOCKET_DESCRIPTOR fd = bsd_create_socket(AF_UNIX, SOCK_STREAM, 0);

    if (fd == LIBUS_SOCKET_ERROR) {
        return LIBUS_SOCKET_ERROR;
    }

    if (connect(fd, (struct sockaddr *)server_address, addrlen) != 0 && errno != EINPROGRESS) {
        #if defined(_WIN32)
          int shouldSimulateENOENT = WSAGetLastError() == WSAENETDOWN;
        #endif
        bsd_close_socket(fd);
        #if defined(_WIN32)
            if (shouldSimulateENOENT) {
                SetLastError(ERROR_PATH_NOT_FOUND);
            }
        #endif
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
