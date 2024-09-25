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

// int us_udp_packet_buffer_ecn(struct us_udp_packet_buffer_t *buf, int index) {
//     return bsd_udp_packet_buffer_ecn((struct udp_recvbuf *)buf, index);
// }

int us_udp_packet_buffer_local_ip(struct us_udp_packet_buffer_t *buf, int index, char *ip) {
    return bsd_udp_packet_buffer_local_ip((struct udp_recvbuf *)buf, index, ip);
}

char *us_udp_packet_buffer_peer(struct us_udp_packet_buffer_t *buf, int index) {
    return bsd_udp_packet_buffer_peer((struct udp_recvbuf *)buf, index);
}

char *us_udp_packet_buffer_payload(struct us_udp_packet_buffer_t *buf, int index) {
    return bsd_udp_packet_buffer_payload((struct udp_recvbuf *)buf, index);
}

int us_udp_packet_buffer_payload_length(struct us_udp_packet_buffer_t *buf, int index) {
    return bsd_udp_packet_buffer_payload_length((struct udp_recvbuf *)buf, index);
}

int us_udp_socket_send(struct us_udp_socket_t *s, void** payloads, size_t* lengths, void** addresses, int num) {
    if (num == 0) return 0;
    int fd = us_poll_fd((struct us_poll_t *) s);

    struct udp_sendbuf *buf = (struct udp_sendbuf *)s->loop->data.send_buf;

    int total_sent = 0;
    while (total_sent < num) {
        int count = bsd_udp_setup_sendbuf(buf, LIBUS_SEND_BUFFER_LENGTH, payloads, lengths, addresses, num);
        payloads += count;
        lengths += count;
        addresses += count;
        num -= count;
        // TODO nohang flag?
        int sent = bsd_sendmmsg(fd, buf, MSG_DONTWAIT);
        if (sent < 0) { 
            return sent;
        }
        total_sent += sent;
        if (0 <= sent && sent < num) {
            // if we couldn't send all packets, register a writable event so we can call the drain callback
            us_poll_change((struct us_poll_t *) s, s->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
        }
    }
    return total_sent;
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

void us_udp_socket_remote_ip(struct us_udp_socket_t *s, char *buf, int *length) {
  struct bsd_addr_t addr;
  if (bsd_remote_addr(us_poll_fd((struct us_poll_t *)s), &addr) || *length < bsd_addr_get_ip_length(&addr)) {
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
    struct us_loop_t *loop = s->loop;
    struct us_poll_t *p = (struct us_poll_t *) s;
    us_poll_stop(p, loop);
    bsd_close_socket(us_poll_fd(p));
    s->closed = 1;
    s->next = loop->data.closed_udp_head;
    loop->data.closed_udp_head = s;
    s->on_close(s);
}

int us_udp_socket_connect(struct us_udp_socket_t *s, const char* host, unsigned short port) {
    return bsd_connect_udp_socket(us_poll_fd((struct us_poll_t *)s), host, port);
}

int us_udp_socket_disconnect(struct us_udp_socket_t *s) {
    return bsd_disconnect_udp_socket(us_poll_fd((struct us_poll_t *)s));
}

struct us_udp_socket_t *us_create_udp_socket(
    struct us_loop_t *loop, 
    void (*data_cb)(struct us_udp_socket_t *, void *, int), 
    void (*drain_cb)(struct us_udp_socket_t *), 
    void (*close_cb)(struct us_udp_socket_t *),
    const char *host, 
    unsigned short port, 
    void *user
) {

    LIBUS_SOCKET_DESCRIPTOR fd = bsd_create_udp_socket(host, port);
    if (fd == LIBUS_SOCKET_ERROR) {
        return 0;
    }

    int ext_size = 0;
    int fallthrough = 0;

    struct us_poll_t *p = us_create_poll(loop, fallthrough, sizeof(struct us_udp_socket_t) + ext_size);
    us_poll_init(p, fd, POLL_TYPE_UDP);

    struct us_udp_socket_t *udp = (struct us_udp_socket_t *)p;

    /* Get and store the port once */
    struct bsd_addr_t tmp = {0};
    bsd_local_addr(fd, &tmp);
    udp->port = bsd_addr_get_port(&tmp);
    udp->loop = loop;

    /* There is no udp socket context, only user data */
    /* This should really be ext like everything else */
    udp->user = user;

    udp->closed = 0;
    udp->connected = 0;
    udp->on_data = data_cb;
    udp->on_drain = drain_cb;
    udp->on_close = close_cb;
    udp->next = NULL;

    us_poll_start((struct us_poll_t *) udp, udp->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
    
    return (struct us_udp_socket_t *) udp;
}