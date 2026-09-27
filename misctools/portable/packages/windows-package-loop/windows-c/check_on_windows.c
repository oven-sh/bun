// Written by misctools/portable/loop/uv_header.ts. Do not edit.
//
// Compiled on a Windows machine, against the headers of the Windows SDK and of libuv:
//   clang -fsyntax-only -I<libuv>\include check_on_windows.c
// Every line that fails names a declaration of bun_windows_c.h that is not what Windows has.
#include <winsock2.h>
#include <ws2tcpip.h>
#include <mstcpip.h>
#include <afunix.h>
#include <windows.h>
#include <errno.h>
#include <stddef.h>
#include <uv.h>

// A constant is 32 bits wide, with or without a sign: that is what is compared.
#define SAME(name, value) _Static_assert((unsigned)(name) == (unsigned)(value), #name)
_Static_assert(sizeof(SOCKET) == 8 && sizeof(HANDLE) == 8 && sizeof(DWORD) == 4 && sizeof(socklen_t) == 4, "the scalar types");
_Static_assert(INVALID_SOCKET == ~0ull, "INVALID_SOCKET");
SAME(TCP_INITIAL_RTO_UNSPECIFIED_RTT, 0xffff);
SAME(TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS, 0xfe);
SAME(AF_UNSPEC, 0);
SAME(AF_UNIX, 1);
SAME(AF_INET, 2);
SAME(AF_INET6, 23);
SAME(SOCK_STREAM, 1);
SAME(SOCK_DGRAM, 2);
SAME(IPPROTO_IP, 0);
SAME(IPPROTO_TCP, 6);
SAME(IPPROTO_UDP, 17);
SAME(IPPROTO_IPV6, 41);
SAME(INADDR_ANY, 0x00000000u);
SAME(INADDR_LOOPBACK, 0x7f000001u);
SAME(SOL_SOCKET, 0xffff);
SAME(SO_ACCEPTCONN, 0x0002);
SAME(SO_REUSEADDR, 0x0004);
SAME(SO_KEEPALIVE, 0x0008);
SAME(SO_BROADCAST, 0x0020);
SAME(SO_LINGER, 0x0080);
SAME(SO_SNDBUF, 0x1001);
SAME(SO_RCVBUF, 0x1002);
SAME(SO_ERROR, 0x1007);
SAME(SO_TYPE, 0x1008);
SAME(SO_EXCLUSIVEADDRUSE, (~0x0004));
SAME(TCP_NODELAY, 0x0001);
SAME(TCP_KEEPALIVE, 3);
SAME(IP_TOS, 3);
SAME(IP_TTL, 4);
SAME(IP_MULTICAST_IF, 9);
SAME(IP_MULTICAST_TTL, 10);
SAME(IP_MULTICAST_LOOP, 11);
SAME(IP_ADD_MEMBERSHIP, 12);
SAME(IP_DROP_MEMBERSHIP, 13);
SAME(IP_ADD_SOURCE_MEMBERSHIP, 15);
SAME(IP_DROP_SOURCE_MEMBERSHIP, 16);
SAME(IP_PKTINFO, 19);
SAME(IP_RECVTOS, 40);
SAME(IPV6_UNICAST_HOPS, 4);
SAME(IPV6_MULTICAST_IF, 9);
SAME(IPV6_MULTICAST_HOPS, 10);
SAME(IPV6_MULTICAST_LOOP, 11);
SAME(IPV6_ADD_MEMBERSHIP, 12);
SAME(IPV6_JOIN_GROUP, 12);
SAME(IPV6_DROP_MEMBERSHIP, 13);
SAME(IPV6_LEAVE_GROUP, 13);
SAME(IPV6_PKTINFO, 19);
SAME(IPV6_V6ONLY, 27);
SAME(IPV6_TCLASS, 39);
SAME(IPV6_RECVTCLASS, 40);
SAME(MCAST_JOIN_SOURCE_GROUP, 45);
SAME(MCAST_LEAVE_SOURCE_GROUP, 46);
SAME(MSG_OOB, 0x1);
SAME(MSG_PEEK, 0x2);
SAME(MSG_DONTROUTE, 0x4);
SAME(MSG_PUSH_IMMEDIATE, 0x20);
SAME(SD_RECEIVE, 0);
SAME(SD_SEND, 1);
SAME(SD_BOTH, 2);
SAME(FIONBIO, 0x8004667e);
SAME(SOCKET_ERROR, (-1));
SAME(SIO_UDP_CONNRESET, 0x9800000cu);
SAME(SIO_UDP_NETRESET, 0x9800000fu);
SAME(SIO_TCP_INITIAL_RTO, 0x98000011u);
SAME(WSA_FLAG_OVERLAPPED, 0x01);
SAME(WSA_FLAG_NO_HANDLE_INHERIT, 0x80);
SAME(FROM_PROTOCOL_INFO, (-1));
SAME(AI_PASSIVE, 0x00000001);
SAME(AI_CANONNAME, 0x00000002);
SAME(AI_NUMERICHOST, 0x00000004);
SAME(TRUE, 1);
SAME(FALSE, 0);
SAME(HANDLE_FLAG_INHERIT, 0x00000001);
SAME(ERROR_PATH_NOT_FOUND, 3);
SAME(ERROR_FILENAME_EXCED_RANGE, 206);
SAME(UNIX_PATH_MAX, 108);
SAME(WSAEINTR, 10004);
SAME(WSAEBADF, 10009);
SAME(WSAEACCES, 10013);
SAME(WSAEFAULT, 10014);
SAME(WSAEINVAL, 10022);
SAME(WSAEMFILE, 10024);
SAME(WSAEWOULDBLOCK, 10035);
SAME(WSAEINPROGRESS, 10036);
SAME(WSAEALREADY, 10037);
SAME(WSAENOTSOCK, 10038);
SAME(WSAEDESTADDRREQ, 10039);
SAME(WSAEMSGSIZE, 10040);
SAME(WSAEPROTOTYPE, 10041);
SAME(WSAENOPROTOOPT, 10042);
SAME(WSAEPROTONOSUPPORT, 10043);
SAME(WSAESOCKTNOSUPPORT, 10044);
SAME(WSAEOPNOTSUPP, 10045);
SAME(WSAEPFNOSUPPORT, 10046);
SAME(WSAEAFNOSUPPORT, 10047);
SAME(WSAEADDRINUSE, 10048);
SAME(WSAEADDRNOTAVAIL, 10049);
SAME(WSAENETDOWN, 10050);
SAME(WSAENETUNREACH, 10051);
SAME(WSAENETRESET, 10052);
SAME(WSAECONNABORTED, 10053);
SAME(WSAECONNRESET, 10054);
SAME(WSAENOBUFS, 10055);
SAME(WSAEISCONN, 10056);
SAME(WSAENOTCONN, 10057);
SAME(WSAESHUTDOWN, 10058);
SAME(WSAETIMEDOUT, 10060);
SAME(WSAECONNREFUSED, 10061);
SAME(WSAEHOSTDOWN, 10064);
SAME(WSAEHOSTUNREACH, 10065);
SAME(EPERM, 1);
SAME(ENOENT, 2);
SAME(ESRCH, 3);
SAME(EINTR, 4);
SAME(EIO, 5);
SAME(ENXIO, 6);
SAME(E2BIG, 7);
SAME(ENOEXEC, 8);
SAME(EBADF, 9);
SAME(ECHILD, 10);
SAME(EAGAIN, 11);
SAME(ENOMEM, 12);
SAME(EACCES, 13);
SAME(EFAULT, 14);
SAME(EBUSY, 16);
SAME(EEXIST, 17);
SAME(EXDEV, 18);
SAME(ENODEV, 19);
SAME(ENOTDIR, 20);
SAME(EISDIR, 21);
SAME(EINVAL, 22);
SAME(ENFILE, 23);
SAME(EMFILE, 24);
SAME(ENOTTY, 25);
SAME(EFBIG, 27);
SAME(ENOSPC, 28);
SAME(ESPIPE, 29);
SAME(EROFS, 30);
SAME(EMLINK, 31);
SAME(EPIPE, 32);
SAME(EDOM, 33);
SAME(ERANGE, 34);
SAME(EDEADLK, 36);
SAME(ENAMETOOLONG, 38);
SAME(ENOLCK, 39);
SAME(ENOSYS, 40);
SAME(ENOTEMPTY, 41);
SAME(EILSEQ, 42);
SAME(EADDRINUSE, 100);
SAME(EADDRNOTAVAIL, 101);
SAME(EAFNOSUPPORT, 102);
SAME(EALREADY, 103);
SAME(EBADMSG, 104);
SAME(ECANCELED, 105);
SAME(ECONNABORTED, 106);
SAME(ECONNREFUSED, 107);
SAME(ECONNRESET, 108);
SAME(EDESTADDRREQ, 109);
SAME(EHOSTUNREACH, 110);
SAME(EIDRM, 111);
SAME(EINPROGRESS, 112);
SAME(EISCONN, 113);
SAME(ELOOP, 114);
SAME(EMSGSIZE, 115);
SAME(ENETDOWN, 116);
SAME(ENETRESET, 117);
SAME(ENETUNREACH, 118);
SAME(ENOBUFS, 119);
SAME(ENODATA, 120);
SAME(ENOLINK, 121);
SAME(ENOMSG, 122);
SAME(ENOPROTOOPT, 123);
SAME(ENOSR, 124);
SAME(ENOSTR, 125);
SAME(ENOTCONN, 126);
SAME(ENOTRECOVERABLE, 127);
SAME(ENOTSOCK, 128);
SAME(ENOTSUP, 129);
SAME(EOPNOTSUPP, 130);
SAME(EOVERFLOW, 132);
SAME(EOWNERDEAD, 133);
SAME(EPROTO, 134);
SAME(EPROTONOSUPPORT, 135);
SAME(EPROTOTYPE, 136);
SAME(ETIME, 137);
SAME(ETIMEDOUT, 138);
SAME(ETXTBSY, 139);
SAME(EWOULDBLOCK, 140);
SAME(UV_READABLE, 1);
SAME(UV_WRITABLE, 2);
SAME(UV_DISCONNECT, 4);
SAME(UV_PRIORITIZED, 8);
SAME(UV_RUN_DEFAULT, 0);
SAME(UV_RUN_ONCE, 1);
SAME(UV_RUN_NOWAIT, 2);
SAME(UV_POLL, 8);
SAME(UV_EOF, -4095);
_Static_assert(sizeof(struct in_addr) == 4, "struct in_addr");
_Static_assert(offsetof(struct in_addr, S_un) == 0, "struct in_addr.S_un");
_Static_assert(sizeof(struct in6_addr) == 16, "struct in6_addr");
_Static_assert(offsetof(struct in6_addr, u) == 0, "struct in6_addr.u");
_Static_assert(sizeof(struct sockaddr) == 16, "struct sockaddr");
_Static_assert(offsetof(struct sockaddr, sa_family) == 0, "struct sockaddr.sa_family");
_Static_assert(offsetof(struct sockaddr, sa_data) == 2, "struct sockaddr.sa_data");
_Static_assert(sizeof(struct sockaddr_in) == 16, "struct sockaddr_in");
_Static_assert(offsetof(struct sockaddr_in, sin_family) == 0, "struct sockaddr_in.sin_family");
_Static_assert(offsetof(struct sockaddr_in, sin_port) == 2, "struct sockaddr_in.sin_port");
_Static_assert(offsetof(struct sockaddr_in, sin_addr) == 4, "struct sockaddr_in.sin_addr");
_Static_assert(offsetof(struct sockaddr_in, sin_zero) == 8, "struct sockaddr_in.sin_zero");
_Static_assert(sizeof(struct sockaddr_in6) == 28, "struct sockaddr_in6");
_Static_assert(offsetof(struct sockaddr_in6, sin6_family) == 0, "struct sockaddr_in6.sin6_family");
_Static_assert(offsetof(struct sockaddr_in6, sin6_port) == 2, "struct sockaddr_in6.sin6_port");
_Static_assert(offsetof(struct sockaddr_in6, sin6_flowinfo) == 4, "struct sockaddr_in6.sin6_flowinfo");
_Static_assert(offsetof(struct sockaddr_in6, sin6_addr) == 8, "struct sockaddr_in6.sin6_addr");
_Static_assert(offsetof(struct sockaddr_in6, sin6_scope_id) == 24, "struct sockaddr_in6.sin6_scope_id");
_Static_assert(sizeof(struct sockaddr_storage) == 128, "struct sockaddr_storage");
_Static_assert(offsetof(struct sockaddr_storage, ss_family) == 0, "struct sockaddr_storage.ss_family");
_Static_assert(sizeof(struct sockaddr_un) == 110, "struct sockaddr_un");
_Static_assert(offsetof(struct sockaddr_un, sun_family) == 0, "struct sockaddr_un.sun_family");
_Static_assert(offsetof(struct sockaddr_un, sun_path) == 2, "struct sockaddr_un.sun_path");
_Static_assert(sizeof(struct addrinfo) == 48, "struct addrinfo");
_Static_assert(offsetof(struct addrinfo, ai_flags) == 0, "struct addrinfo.ai_flags");
_Static_assert(offsetof(struct addrinfo, ai_family) == 4, "struct addrinfo.ai_family");
_Static_assert(offsetof(struct addrinfo, ai_socktype) == 8, "struct addrinfo.ai_socktype");
_Static_assert(offsetof(struct addrinfo, ai_protocol) == 12, "struct addrinfo.ai_protocol");
_Static_assert(offsetof(struct addrinfo, ai_addrlen) == 16, "struct addrinfo.ai_addrlen");
_Static_assert(offsetof(struct addrinfo, ai_canonname) == 24, "struct addrinfo.ai_canonname");
_Static_assert(offsetof(struct addrinfo, ai_addr) == 32, "struct addrinfo.ai_addr");
_Static_assert(offsetof(struct addrinfo, ai_next) == 40, "struct addrinfo.ai_next");
_Static_assert(sizeof(struct linger) == 4, "struct linger");
_Static_assert(offsetof(struct linger, l_onoff) == 0, "struct linger.l_onoff");
_Static_assert(offsetof(struct linger, l_linger) == 2, "struct linger.l_linger");
_Static_assert(sizeof(struct ip_mreq) == 8, "struct ip_mreq");
_Static_assert(offsetof(struct ip_mreq, imr_multiaddr) == 0, "struct ip_mreq.imr_multiaddr");
_Static_assert(offsetof(struct ip_mreq, imr_interface) == 4, "struct ip_mreq.imr_interface");
_Static_assert(sizeof(struct ip_mreq_source) == 12, "struct ip_mreq_source");
_Static_assert(offsetof(struct ip_mreq_source, imr_multiaddr) == 0, "struct ip_mreq_source.imr_multiaddr");
_Static_assert(offsetof(struct ip_mreq_source, imr_sourceaddr) == 4, "struct ip_mreq_source.imr_sourceaddr");
_Static_assert(offsetof(struct ip_mreq_source, imr_interface) == 8, "struct ip_mreq_source.imr_interface");
_Static_assert(sizeof(struct ipv6_mreq) == 20, "struct ipv6_mreq");
_Static_assert(offsetof(struct ipv6_mreq, ipv6mr_multiaddr) == 0, "struct ipv6_mreq.ipv6mr_multiaddr");
_Static_assert(offsetof(struct ipv6_mreq, ipv6mr_interface) == 16, "struct ipv6_mreq.ipv6mr_interface");
_Static_assert(sizeof(struct group_source_req) == 264, "struct group_source_req");
_Static_assert(offsetof(struct group_source_req, gsr_interface) == 0, "struct group_source_req.gsr_interface");
_Static_assert(offsetof(struct group_source_req, gsr_group) == 8, "struct group_source_req.gsr_group");
_Static_assert(offsetof(struct group_source_req, gsr_source) == 136, "struct group_source_req.gsr_source");
_Static_assert(sizeof(WSABUF) == 16, "WSABUF");
_Static_assert(offsetof(WSABUF, len) == 0, "WSABUF.len");
_Static_assert(offsetof(WSABUF, buf) == 8, "WSABUF.buf");
_Static_assert(sizeof(TCP_INITIAL_RTO_PARAMETERS) == 4, "TCP_INITIAL_RTO_PARAMETERS");
_Static_assert(offsetof(TCP_INITIAL_RTO_PARAMETERS, Rtt) == 0, "TCP_INITIAL_RTO_PARAMETERS.Rtt");
_Static_assert(offsetof(TCP_INITIAL_RTO_PARAMETERS, MaxSynRetransmissions) == 2, "TCP_INITIAL_RTO_PARAMETERS.MaxSynRetransmissions");
_Static_assert(sizeof(WSAPROTOCOL_INFOW) == 628, "WSAPROTOCOL_INFOW");
_Static_assert(sizeof(INIT_ONCE) == 8, "INIT_ONCE");
_Static_assert(offsetof(INIT_ONCE, Ptr) == 0, "INIT_ONCE.Ptr");
_Static_assert(sizeof(uv_loop_t) == 472 && _Alignof(uv_loop_t) == 8, "uv_loop_t");
_Static_assert(offsetof(uv_loop_t, data) == 0, "uv_loop_t.data");
_Static_assert(offsetof(uv_loop_t, active_handles) == 8, "uv_loop_t.active_handles");
_Static_assert(sizeof(uv_handle_t) == 96 && _Alignof(uv_handle_t) == 8, "uv_handle_t");
_Static_assert(offsetof(uv_handle_t, data) == 0, "uv_handle_t.data");
_Static_assert(offsetof(uv_handle_t, loop) == 8, "uv_handle_t.loop");
_Static_assert(offsetof(uv_handle_t, type) == 16, "uv_handle_t.type");
_Static_assert(sizeof(uv_poll_t) == 416 && _Alignof(uv_poll_t) == 8, "uv_poll_t");
_Static_assert(offsetof(uv_poll_t, data) == 0, "uv_poll_t.data");
_Static_assert(offsetof(uv_poll_t, loop) == 8, "uv_poll_t.loop");
_Static_assert(offsetof(uv_poll_t, type) == 16, "uv_poll_t.type");
_Static_assert(sizeof(uv_timer_t) == 160 && _Alignof(uv_timer_t) == 8, "uv_timer_t");
_Static_assert(offsetof(uv_timer_t, data) == 0, "uv_timer_t.data");
_Static_assert(offsetof(uv_timer_t, loop) == 8, "uv_timer_t.loop");
_Static_assert(offsetof(uv_timer_t, type) == 16, "uv_timer_t.type");
_Static_assert(sizeof(uv_async_t) == 224 && _Alignof(uv_async_t) == 8, "uv_async_t");
_Static_assert(offsetof(uv_async_t, data) == 0, "uv_async_t.data");
_Static_assert(offsetof(uv_async_t, loop) == 8, "uv_async_t.loop");
_Static_assert(offsetof(uv_async_t, type) == 16, "uv_async_t.type");
_Static_assert(sizeof(uv_prepare_t) == 120 && _Alignof(uv_prepare_t) == 8, "uv_prepare_t");
_Static_assert(offsetof(uv_prepare_t, data) == 0, "uv_prepare_t.data");
_Static_assert(offsetof(uv_prepare_t, loop) == 8, "uv_prepare_t.loop");
_Static_assert(offsetof(uv_prepare_t, type) == 16, "uv_prepare_t.type");
_Static_assert(sizeof(uv_check_t) == 120 && _Alignof(uv_check_t) == 8, "uv_check_t");
_Static_assert(offsetof(uv_check_t, data) == 0, "uv_check_t.data");
_Static_assert(offsetof(uv_check_t, loop) == 8, "uv_check_t.loop");
_Static_assert(offsetof(uv_check_t, type) == 16, "uv_check_t.type");

// The functions: each one has to be declared by these headers. The comment is the type that
// bun_windows_c.h calls it with, for the eye: the compiler does not compare it.
static void *bun_check_uv_loop_new = (void *)uv_loop_new;
// libuv: uv_loop_t * uv_loop_new(void)
static void *bun_check_uv_loop_delete = (void *)uv_loop_delete;
// libuv: void uv_loop_delete(uv_loop_t *)
static void *bun_check_uv_run = (void *)uv_run;
// libuv: int32_t uv_run(uv_loop_t *, int32_t)
static void *bun_check_uv_now = (void *)uv_now;
// libuv: uint64_t uv_now(const uv_loop_t *)
static void *bun_check_uv_update_time = (void *)uv_update_time;
// libuv: void uv_update_time(uv_loop_t *)
static void *bun_check_uv_ref = (void *)uv_ref;
// libuv: void uv_ref(uv_handle_t *)
static void *bun_check_uv_unref = (void *)uv_unref;
// libuv: void uv_unref(uv_handle_t *)
static void *bun_check_uv_close = (void *)uv_close;
// libuv: void uv_close(uv_handle_t *, uv_close_cb)
static void *bun_check_uv_is_closing = (void *)uv_is_closing;
// libuv: int32_t uv_is_closing(const uv_handle_t *)
static void *bun_check_uv_poll_init_socket = (void *)uv_poll_init_socket;
// libuv: int32_t uv_poll_init_socket(uv_loop_t *, uv_poll_t *, SOCKET)
static void *bun_check_uv_poll_start = (void *)uv_poll_start;
// libuv: int32_t uv_poll_start(uv_poll_t *, int32_t, uv_poll_cb)
static void *bun_check_uv_poll_stop = (void *)uv_poll_stop;
// libuv: int32_t uv_poll_stop(uv_poll_t *)
static void *bun_check_uv_timer_init = (void *)uv_timer_init;
// libuv: int32_t uv_timer_init(uv_loop_t *, uv_timer_t *)
static void *bun_check_uv_timer_start = (void *)uv_timer_start;
// libuv: int32_t uv_timer_start(uv_timer_t *, uv_timer_cb, uint64_t, uint64_t)
static void *bun_check_uv_timer_stop = (void *)uv_timer_stop;
// libuv: int32_t uv_timer_stop(uv_timer_t *)
static void *bun_check_uv_prepare_init = (void *)uv_prepare_init;
// libuv: int32_t uv_prepare_init(uv_loop_t *, uv_prepare_t *)
static void *bun_check_uv_prepare_start = (void *)uv_prepare_start;
// libuv: int32_t uv_prepare_start(uv_prepare_t *, uv_prepare_cb)
static void *bun_check_uv_prepare_stop = (void *)uv_prepare_stop;
// libuv: int32_t uv_prepare_stop(uv_prepare_t *)
static void *bun_check_uv_check_init = (void *)uv_check_init;
// libuv: int32_t uv_check_init(uv_loop_t *, uv_check_t *)
static void *bun_check_uv_check_start = (void *)uv_check_start;
// libuv: int32_t uv_check_start(uv_check_t *, uv_check_cb)
static void *bun_check_uv_check_stop = (void *)uv_check_stop;
// libuv: int32_t uv_check_stop(uv_check_t *)
static void *bun_check_uv_async_init = (void *)uv_async_init;
// libuv: int32_t uv_async_init(uv_loop_t *, uv_async_t *, uv_async_cb)
static void *bun_check_uv_async_send = (void *)uv_async_send;
// libuv: int32_t uv_async_send(uv_async_t *)
static void *bun_check_WSAGetLastError = (void *)WSAGetLastError;
// ws2_32: int32_t WSAGetLastError(void)
static void *bun_check_WSASetLastError = (void *)WSASetLastError;
// ws2_32: void WSASetLastError(int32_t)
static void *bun_check_WSASocketW = (void *)WSASocketW;
// ws2_32: SOCKET WSASocketW(int32_t, int32_t, int32_t, WSAPROTOCOL_INFOW *, uint32_t, uint32_t)
static void *bun_check_WSADuplicateSocketW = (void *)WSADuplicateSocketW;
// ws2_32: int32_t WSADuplicateSocketW(SOCKET, uint32_t, WSAPROTOCOL_INFOW *)
static void *bun_check_WSAIoctl = (void *)WSAIoctl;
// ws2_32: int32_t WSAIoctl(SOCKET, uint32_t, void *, uint32_t, void *, uint32_t, uint32_t *, void *, void *)
static void *bun_check_socket = (void *)socket;
// ws2_32: SOCKET socket(int32_t, int32_t, int32_t)
static void *bun_check_closesocket = (void *)closesocket;
// ws2_32: int32_t closesocket(SOCKET)
static void *bun_check_ioctlsocket = (void *)ioctlsocket;
// ws2_32: int32_t ioctlsocket(SOCKET, int32_t, uint32_t *)
static void *bun_check_bind = (void *)bind;
// ws2_32: int32_t bind(SOCKET, const struct sockaddr *, int32_t)
static void *bun_check_listen = (void *)listen;
// ws2_32: int32_t listen(SOCKET, int32_t)
static void *bun_check_accept = (void *)accept;
// ws2_32: SOCKET accept(SOCKET, struct sockaddr *, int32_t *)
static void *bun_check_connect = (void *)connect;
// ws2_32: int32_t connect(SOCKET, const struct sockaddr *, int32_t)
static void *bun_check_shutdown = (void *)shutdown;
// ws2_32: int32_t shutdown(SOCKET, int32_t)
static void *bun_check_recv = (void *)recv;
// ws2_32: int32_t recv(SOCKET, char *, int32_t, int32_t)
static void *bun_check_send = (void *)send;
// ws2_32: int32_t send(SOCKET, const char *, int32_t, int32_t)
static void *bun_check_recvfrom = (void *)recvfrom;
// ws2_32: int32_t recvfrom(SOCKET, char *, int32_t, int32_t, struct sockaddr *, int32_t *)
static void *bun_check_sendto = (void *)sendto;
// ws2_32: int32_t sendto(SOCKET, const char *, int32_t, int32_t, const struct sockaddr *, int32_t)
static void *bun_check_setsockopt = (void *)setsockopt;
// ws2_32: int32_t setsockopt(SOCKET, int32_t, int32_t, const char *, int32_t)
static void *bun_check_getsockopt = (void *)getsockopt;
// ws2_32: int32_t getsockopt(SOCKET, int32_t, int32_t, char *, int32_t *)
static void *bun_check_getsockname = (void *)getsockname;
// ws2_32: int32_t getsockname(SOCKET, struct sockaddr *, int32_t *)
static void *bun_check_getpeername = (void *)getpeername;
// ws2_32: int32_t getpeername(SOCKET, struct sockaddr *, int32_t *)
static void *bun_check_getaddrinfo = (void *)getaddrinfo;
// ws2_32: int32_t getaddrinfo(const char *, const char *, const struct addrinfo *, struct addrinfo **)
static void *bun_check_freeaddrinfo = (void *)freeaddrinfo;
// ws2_32: void freeaddrinfo(struct addrinfo *)
static void *bun_check_SetHandleInformation = (void *)SetHandleInformation;
// kernel32: int32_t SetHandleInformation(HANDLE, uint32_t, uint32_t)
static void *bun_check_SetLastError = (void *)SetLastError;
// kernel32: void SetLastError(uint32_t)
static void *bun_check_InitOnceExecuteOnce = (void *)InitOnceExecuteOnce;
// kernel32: int32_t InitOnceExecuteOnce(INIT_ONCE *, PINIT_ONCE_FN, void *, void **)
static void *bun_check_GetLastError = (void *)GetLastError;
// kernel32: uint32_t GetLastError(void)
int main(void) { return 0; }
