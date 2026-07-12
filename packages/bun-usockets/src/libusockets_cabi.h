/*
 * Accessor seam for surviving C/C++ consumers of the Rust bun_usockets crate
 * (uWS App.h/HttpContext.h, quic.c). Implemented in src/usockets/cabi.rs;
 * keeps us_socket_t / us_listen_socket_t / us_loop_t fully opaque here.
 */
#pragma once
#ifndef LIBUSOCKETS_CABI_H
#define LIBUSOCKETS_CABI_H

#include "libusockets.h"

#ifdef _WIN32
#include <ws2tcpip.h>
#else
#include <sys/socket.h>
#include <netdb.h>
#endif

/* Poll-event flags handed to us_poll_change (quic.c backpressure). ABI: the
 * values are per-backend (cabi-surface.md §9.3.7) — mirror the eventing
 * headers exactly; never hardcode. */
#ifndef LIBUS_SOCKET_READABLE
#if defined(LIBUS_USE_LIBUV)
#include <uv.h>
#define LIBUS_SOCKET_READABLE UV_READABLE
#define LIBUS_SOCKET_WRITABLE UV_WRITABLE
#elif defined(LIBUS_USE_EPOLL)
#include <sys/epoll.h>
#define LIBUS_SOCKET_READABLE EPOLLIN
#define LIBUS_SOCKET_WRITABLE EPOLLOUT
#else /* kqueue: private bitfield, translated per-call by the backend */
#define LIBUS_SOCKET_READABLE 1
#define LIBUS_SOCKET_WRITABLE 2
#endif
#endif

#ifndef LIBUS_SOCKET_ERROR
#ifdef _WIN32
#define LIBUS_SOCKET_ERROR INVALID_SOCKET
#else
#define LIBUS_SOCKET_ERROR -1
#endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* Group socket-list walk (App.h::closeIdle). Close-safe only if the caller
 * caches us_socket_next(s) before closing s. */
struct us_socket_t *us_socket_group_head_socket(us_socket_group_r group);
struct us_socket_t *us_socket_next(us_socket_r s);

/* Drops the listen socket's loop keep-alive (HttpContext.h::listen{,_unix}). */
void us_listen_socket_unref(struct us_listen_socket_t *ls);

/* quic.c loop-field accessors. quic_head is the us_quic_socket_context_s
 * list; quic_next_tick_us is the relative-µs engine deadline folded into the
 * poll wait (-1 = none). poll_count_add keeps the loop alive per live conn. */
#ifndef LIBUS_USE_LIBUV
void us_loop_poll_count_add(us_loop_r loop, int delta);
#endif
void *us_internal_loop_quic_head(us_loop_r loop);
void us_internal_loop_quic_head_set(us_loop_r loop, void *head);
void us_internal_loop_quic_next_tick_set(us_loop_r loop, long long relative_us);
#ifdef LIBUS_USE_LIBUV
struct us_timer_t;
struct us_timer_t *us_internal_loop_quic_timer(us_loop_r loop);
void us_internal_loop_quic_timer_set(us_loop_r loop, struct us_timer_t *timer);
#endif

/* The poll embedded first in us_udp_socket_t (replaces quic.c's raw cast). */
struct us_poll_t *us_udp_socket_poll(struct us_udp_socket_t *s);

/* Raw-socket probe helpers (quic.c route probing; formerly networking/bsd.h). */
LIBUS_SOCKET_DESCRIPTOR bsd_create_socket(int domain, int type, int protocol, int *err);
void bsd_close_socket(LIBUS_SOCKET_DESCRIPTOR fd);

/* Bun DNS glue used by quic.c (Rust exports; formerly internal/internal.h). */
struct addrinfo_request;
#ifndef LIBUS_ADDRINFO_RESULT_DEFINED
#define LIBUS_ADDRINFO_RESULT_DEFINED
struct addrinfo_result_entry {
    struct addrinfo info;
    struct sockaddr_storage _storage;
};
struct addrinfo_result {
    struct addrinfo_result_entry *entries;
    int error;
};
#endif
extern int Bun__addrinfo_get(struct us_loop_t *loop, const char *host, uint16_t port, struct addrinfo_request **ptr);
extern void Bun__addrinfo_freeRequest(struct addrinfo_request *addrinfo_req, int error);
extern struct addrinfo_result *Bun__addrinfo_getRequestResult(struct addrinfo_request *addrinfo_req);

#ifdef __cplusplus
}
#endif

#endif /* LIBUSOCKETS_CABI_H */
