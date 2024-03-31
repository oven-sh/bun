/*
 * Authored by Alex Hultman, 2018-2019.
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

#ifndef BSD_H
#define BSD_H

// top-most wrapper of bsd-like syscalls

// holds everything you need from the bsd/winsock interfaces, only included by internal libusockets.h
// here everything about the syscalls are inline-wrapped and included

#include "libusockets.h"

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
#define SETSOCKOPT_PTR_TYPE const char *
#define LIBUS_SOCKET_ERROR INVALID_SOCKET
#else
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
/* For socklen_t */
#include <sys/socket.h>
#define SETSOCKOPT_PTR_TYPE int *
#define LIBUS_SOCKET_ERROR -1
#endif

#define LIBUS_UDP_MAX_SIZE (64 * 1024)
#define LIBUS_UDP_MAX_NUM 1024

struct bsd_addr_t {
    struct sockaddr_storage mem;
    socklen_t len;
    char *ip;
    int ip_length;
    int port;
};

int bsd_sendmmsg(LIBUS_SOCKET_DESCRIPTOR fd, void *msgvec, unsigned int vlen, int flags);
int bsd_recvmmsg(LIBUS_SOCKET_DESCRIPTOR fd, void *msgvec, unsigned int vlen, int flags, void *timeout);
int bsd_udp_packet_buffer_payload_length(void *msgvec, int index);
char *bsd_udp_packet_buffer_payload(void *msgvec, int index);
char *bsd_udp_packet_buffer_peer(void *msgvec, int index);
int bsd_udp_packet_buffer_local_ip(void *msgvec, int index, char *ip);
int bsd_udp_packet_buffer_ecn(void *msgvec, int index);
void *bsd_create_udp_packet_buffer();
void bsd_udp_buffer_set_packet_payload(struct us_udp_packet_buffer_t *send_buf, int index, int offset, void *payload, int length, void *peer_addr);

LIBUS_SOCKET_DESCRIPTOR apple_no_sigpipe(LIBUS_SOCKET_DESCRIPTOR fd);
LIBUS_SOCKET_DESCRIPTOR bsd_set_nonblocking(LIBUS_SOCKET_DESCRIPTOR fd);
void bsd_socket_nodelay(LIBUS_SOCKET_DESCRIPTOR fd, int enabled);
void bsd_socket_flush(LIBUS_SOCKET_DESCRIPTOR fd);
LIBUS_SOCKET_DESCRIPTOR bsd_create_socket(int domain, int type, int protocol);

void bsd_close_socket(LIBUS_SOCKET_DESCRIPTOR fd);
void bsd_shutdown_socket(LIBUS_SOCKET_DESCRIPTOR fd);
void bsd_shutdown_socket_read(LIBUS_SOCKET_DESCRIPTOR fd);

void internal_finalize_bsd_addr(struct bsd_addr_t *addr);

int bsd_local_addr(LIBUS_SOCKET_DESCRIPTOR fd, struct bsd_addr_t *addr);
int bsd_remote_addr(LIBUS_SOCKET_DESCRIPTOR fd, struct bsd_addr_t *addr);

char *bsd_addr_get_ip(struct bsd_addr_t *addr);
int bsd_addr_get_ip_length(struct bsd_addr_t *addr);

int bsd_addr_get_port(struct bsd_addr_t *addr);

// called by dispatch_ready_poll
LIBUS_SOCKET_DESCRIPTOR bsd_accept_socket(LIBUS_SOCKET_DESCRIPTOR fd, struct bsd_addr_t *addr);

int bsd_recv(LIBUS_SOCKET_DESCRIPTOR fd, void *buf, int length, int flags);
int bsd_send(LIBUS_SOCKET_DESCRIPTOR fd, const char *buf, int length, int msg_more);
int bsd_write2(LIBUS_SOCKET_DESCRIPTOR fd, const char *header, int header_length, const char *payload, int payload_length);
int bsd_would_block();

// return LIBUS_SOCKET_ERROR or the fd that represents listen socket
// listen both on ipv6 and ipv4
LIBUS_SOCKET_DESCRIPTOR bsd_create_listen_socket(const char *host, int port, int options);

LIBUS_SOCKET_DESCRIPTOR bsd_create_listen_socket_unix(const char *path, size_t pathlen, int options);

/* Creates an UDP socket bound to the hostname and port */
LIBUS_SOCKET_DESCRIPTOR bsd_create_udp_socket(const char *host, int port);

LIBUS_SOCKET_DESCRIPTOR bsd_create_connect_socket(const char *host, int port, const char *source_host, int options);

LIBUS_SOCKET_DESCRIPTOR bsd_create_connect_socket_unix(const char *server_path, size_t pathlen, int options);

#ifndef MSG_DONTWAIT
#define MSG_DONTWAIT 0
#endif

#endif // BSD_H
