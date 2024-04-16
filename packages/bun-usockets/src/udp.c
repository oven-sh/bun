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

#include "libusockets.h"
#include "internal/internal.h"

#include <string.h>

int us_udp_packet_buffer_ecn(struct us_udp_packet_buffer_t *buf, int index) {
    return bsd_udp_packet_buffer_ecn(buf, index);
}

int us_udp_packet_buffer_local_ip(struct us_udp_packet_buffer_t *buf, int index, char *ip) {
    return bsd_udp_packet_buffer_local_ip(buf, index, ip);
}

char *us_udp_packet_buffer_peer(struct us_udp_packet_buffer_t *buf, int index) {
    return bsd_udp_packet_buffer_peer(buf, index);
}

char *us_udp_packet_buffer_payload(struct us_udp_packet_buffer_t *buf, int index) {
    return bsd_udp_packet_buffer_payload(buf, index);
}

int us_udp_packet_buffer_payload_length(struct us_udp_packet_buffer_t *buf, int index) {
    return bsd_udp_packet_buffer_payload_length(buf, index);
}

// what should we return? number of sent datagrams?
int us_udp_socket_send(struct us_udp_socket_t *s, struct us_udp_packet_buffer_t *buf, int num) {
    if (num == 0) return 0;
    int fd = us_poll_fd((struct us_poll_t *) s);

    int sent = bsd_sendmmsg(fd, buf, num, 0);
    if (sent < 0) {
        // TODO return appropriate error
        return 0;
    } else if (sent < num) {
        us_poll_change((struct us_poll_t *) s, s->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
        return sent;
    } else {
        return sent;
    }
}

int us_udp_socket_receive(struct us_udp_socket_t *s, struct us_udp_packet_buffer_t *buf) {
    int fd = us_poll_fd((struct us_poll_t *) s);
    return bsd_recvmmsg(fd, buf, LIBUS_UDP_MAX_NUM, 0, 0);
}

void us_udp_buffer_set_packet_payload(struct us_udp_packet_buffer_t *send_buf, int index, int offset, void *payload, int length, void *peer_addr) {
    bsd_udp_buffer_set_packet_payload(send_buf, index, offset, payload, length, peer_addr);
}

struct us_udp_packet_buffer_t *us_create_udp_packet_buffer() {
    return (struct us_udp_packet_buffer_t *) bsd_create_udp_packet_buffer();
}

int us_udp_socket_bound_port(struct us_udp_socket_t *s) {
    return ((struct us_udp_socket_t *) s)->port;
}

void us_udp_socket_bound_ip(struct us_udp_socket_t *s, char *buf, int *length) {
  struct bsd_addr_t addr;
  if (bsd_local_addr(us_poll_fd((struct us_poll_t *)s), &addr) || *length < bsd_addr_get_ip_length(&addr)) {
    *length = 0;
  } else {
    *length = bsd_addr_get_ip_length(&addr);
    memcpy(buf, bsd_addr_get_ip(&addr), *length);
  }
}

void *us_udp_socket_user(struct us_udp_socket_t *s) {
    struct us_udp_socket_t *udp = (struct us_udp_socket_t *) s;

    return udp->user;
}

void us_udp_socket_close(struct us_udp_socket_t *s) {
  struct us_poll_t *p = (struct us_poll_t *) s;
//   us_poll_stop(p, s->loop);
//   bsd_close_socket(us_poll_fd(p));
    s->closed = 1;
    // change to writable poll to trigger cleanup on next loop cycle
    us_poll_change(p, s->loop, LIBUS_SOCKET_WRITABLE);
}

void us_udp_socket_connect(struct us_udp_socket_t *s, struct bsd_addr_t *addr) {
    
}

struct us_udp_socket_t *us_create_udp_socket(
    struct us_loop_t *loop, 
    struct us_udp_packet_buffer_t *buf, 
    void (*data_cb)(struct us_udp_socket_t *, struct us_udp_packet_buffer_t *, int), 
    void (*drain_cb)(struct us_udp_socket_t *), 
    const char *host, 
    unsigned short port, 
    void *user
) {
    
    LIBUS_SOCKET_DESCRIPTOR fd = bsd_create_udp_socket(host, port);
    if (fd == LIBUS_SOCKET_ERROR) {
        return 0;
    }

    /* If buf is 0 then create one here */
    if (!buf) {
        buf = us_create_udp_packet_buffer();
    }

    int ext_size = 0;
    int fallthrough = 0;

    struct us_poll_t *p = us_create_poll(loop, fallthrough, sizeof(struct us_udp_socket_t) + ext_size);
    us_poll_init(p, fd, POLL_TYPE_UDP);

    struct us_udp_socket_t *udp = (struct us_udp_socket_t *)p;

    /* Get and store the port once */
    struct bsd_addr_t tmp;
    bsd_local_addr(fd, &tmp);
    udp->port = bsd_addr_get_port(&tmp);
    udp->loop = loop;

    /* There is no udp socket context, only user data */
    /* This should really be ext like everything else */
    udp->user = user;

    udp->on_data = data_cb;
    udp->receive_buf = buf;
    udp->on_drain = drain_cb;

    us_poll_start((struct us_poll_t *) udp, udp->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
    
    return (struct us_udp_socket_t *) udp;
}