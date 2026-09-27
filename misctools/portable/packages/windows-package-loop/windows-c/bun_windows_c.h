// Written by misctools/portable/loop/uv_header.ts. Do not edit.
//
// The declarations of Windows and of libuv for the C of the portable image. See uv_header.ts for
// where each of them comes from and for what checks them.
#ifndef BUN_WINDOWS_C_H
#define BUN_WINDOWS_C_H
#include <stddef.h>
#include <stdint.h>
// The headers of Windows bring the string functions of the C runtime along. Here they are the ones of
// the C library of the image.
#include <string.h>

#define BUN_WINDOWS_ABI __attribute__((ms_abi))

typedef uint64_t SOCKET;
typedef void *HANDLE;
typedef uint8_t BYTE, UCHAR;
typedef uint16_t WORD, USHORT, ADDRESS_FAMILY, WCHAR;
typedef int32_t BOOL, INT, LONG;
typedef uint32_t DWORD, UINT, ULONG;
typedef uint64_t UINT_PTR, ULONG_PTR, DWORD_PTR, SIZE_T;
typedef int64_t INT_PTR, LONG_PTR, SSIZE_T;
typedef int32_t socklen_t;
#ifndef BUN_WINDOWS_C_SSIZE_T
#define BUN_WINDOWS_C_SSIZE_T
typedef int64_t ssize_t;
#endif
#define INVALID_SOCKET ((SOCKET)(~(SOCKET)0))
#define INVALID_HANDLE_VALUE ((HANDLE)(int64_t)-1)

#define AF_UNSPEC 0
#define AF_UNIX 1
#define AF_INET 2
#define AF_INET6 23
#define SOCK_STREAM 1
#define SOCK_DGRAM 2
#define IPPROTO_IP 0
#define IPPROTO_TCP 6
#define IPPROTO_UDP 17
#define IPPROTO_IPV6 41
#define INADDR_ANY 0x00000000u
#define INADDR_LOOPBACK 0x7f000001u
#define SOL_SOCKET 0xffff
#define SO_ACCEPTCONN 0x0002
#define SO_REUSEADDR 0x0004
#define SO_KEEPALIVE 0x0008
#define SO_BROADCAST 0x0020
#define SO_LINGER 0x0080
#define SO_SNDBUF 0x1001
#define SO_RCVBUF 0x1002
#define SO_ERROR 0x1007
#define SO_TYPE 0x1008
#define SO_EXCLUSIVEADDRUSE (~0x0004)
#define TCP_NODELAY 0x0001
#define TCP_KEEPALIVE 3
#define IP_TOS 3
#define IP_TTL 4
#define IP_MULTICAST_IF 9
#define IP_MULTICAST_TTL 10
#define IP_MULTICAST_LOOP 11
#define IP_ADD_MEMBERSHIP 12
#define IP_DROP_MEMBERSHIP 13
#define IP_ADD_SOURCE_MEMBERSHIP 15
#define IP_DROP_SOURCE_MEMBERSHIP 16
#define IP_PKTINFO 19
#define IP_RECVTOS 40
#define IPV6_UNICAST_HOPS 4
#define IPV6_MULTICAST_IF 9
#define IPV6_MULTICAST_HOPS 10
#define IPV6_MULTICAST_LOOP 11
#define IPV6_ADD_MEMBERSHIP 12
#define IPV6_JOIN_GROUP 12
#define IPV6_DROP_MEMBERSHIP 13
#define IPV6_LEAVE_GROUP 13
#define IPV6_PKTINFO 19
#define IPV6_V6ONLY 27
#define IPV6_TCLASS 39
#define IPV6_RECVTCLASS 40
#define MCAST_JOIN_SOURCE_GROUP 45
#define MCAST_LEAVE_SOURCE_GROUP 46
#define MSG_OOB 0x1
#define MSG_PEEK 0x2
#define MSG_DONTROUTE 0x4
#define MSG_PUSH_IMMEDIATE 0x20
#define SD_RECEIVE 0
#define SD_SEND 1
#define SD_BOTH 2
#define FIONBIO 0x8004667e
#define SOCKET_ERROR (-1)
#define SIO_UDP_CONNRESET 0x9800000cu
#define SIO_UDP_NETRESET 0x9800000fu
#define SIO_TCP_INITIAL_RTO 0x98000011u
#define WSA_FLAG_OVERLAPPED 0x01
#define WSA_FLAG_NO_HANDLE_INHERIT 0x80
#define FROM_PROTOCOL_INFO (-1)
#define AI_PASSIVE 0x00000001
#define AI_CANONNAME 0x00000002
#define AI_NUMERICHOST 0x00000004
#define TRUE 1
#define FALSE 0
#define HANDLE_FLAG_INHERIT 0x00000001
#define ERROR_PATH_NOT_FOUND 3
#define ERROR_FILENAME_EXCED_RANGE 206
#define UNIX_PATH_MAX 108
#define WSAEINTR 10004
#define WSAEBADF 10009
#define WSAEACCES 10013
#define WSAEFAULT 10014
#define WSAEINVAL 10022
#define WSAEMFILE 10024
#define WSAEWOULDBLOCK 10035
#define WSAEINPROGRESS 10036
#define WSAEALREADY 10037
#define WSAENOTSOCK 10038
#define WSAEDESTADDRREQ 10039
#define WSAEMSGSIZE 10040
#define WSAEPROTOTYPE 10041
#define WSAENOPROTOOPT 10042
#define WSAEPROTONOSUPPORT 10043
#define WSAESOCKTNOSUPPORT 10044
#define WSAEOPNOTSUPP 10045
#define WSAEPFNOSUPPORT 10046
#define WSAEAFNOSUPPORT 10047
#define WSAEADDRINUSE 10048
#define WSAEADDRNOTAVAIL 10049
#define WSAENETDOWN 10050
#define WSAENETUNREACH 10051
#define WSAENETRESET 10052
#define WSAECONNABORTED 10053
#define WSAECONNRESET 10054
#define WSAENOBUFS 10055
#define WSAEISCONN 10056
#define WSAENOTCONN 10057
#define WSAESHUTDOWN 10058
#define WSAETIMEDOUT 10060
#define WSAECONNREFUSED 10061
#define WSAEHOSTDOWN 10064
#define WSAEHOSTUNREACH 10065
#define TCP_INITIAL_RTO_UNSPECIFIED_RTT ((uint16_t)-1)
#define TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS ((uint8_t)-2)

struct in_addr { union { struct { uint8_t s_b1, s_b2, s_b3, s_b4; } S_un_b; struct { uint16_t s_w1, s_w2; } S_un_w; uint32_t S_addr; } S_un; };
struct in6_addr { union { uint8_t Byte[16]; uint16_t Word[8]; } u; };
struct sockaddr { uint16_t sa_family; char sa_data[14]; };
struct sockaddr_in { uint16_t sin_family; uint16_t sin_port; struct in_addr sin_addr; char sin_zero[8]; };
struct sockaddr_in6 { uint16_t sin6_family; uint16_t sin6_port; uint32_t sin6_flowinfo; struct in6_addr sin6_addr; uint32_t sin6_scope_id; };
struct sockaddr_storage { uint16_t ss_family; char __ss_pad1[6]; int64_t __ss_align; char __ss_pad2[112]; };
struct sockaddr_un { uint16_t sun_family; char sun_path[108]; };
struct addrinfo { int32_t ai_flags; int32_t ai_family; int32_t ai_socktype; int32_t ai_protocol; uint64_t ai_addrlen; char *ai_canonname; struct sockaddr *ai_addr; struct addrinfo *ai_next; };
struct linger { uint16_t l_onoff; uint16_t l_linger; };
struct ip_mreq { struct in_addr imr_multiaddr; struct in_addr imr_interface; };
struct ip_mreq_source { struct in_addr imr_multiaddr; struct in_addr imr_sourceaddr; struct in_addr imr_interface; };
struct ipv6_mreq { struct in6_addr ipv6mr_multiaddr; uint32_t ipv6mr_interface; };
struct group_source_req { uint32_t gsr_interface; struct sockaddr_storage gsr_group; struct sockaddr_storage gsr_source; };
typedef struct _WSABUF { uint32_t len; char *buf; } WSABUF;
typedef struct _TCP_INITIAL_RTO_PARAMETERS { uint16_t Rtt; uint8_t MaxSynRetransmissions; } TCP_INITIAL_RTO_PARAMETERS;
typedef struct _WSAPROTOCOL_INFOW { uint8_t bun_bytes[628]; } WSAPROTOCOL_INFOW;
typedef struct _INIT_ONCE { void *Ptr; } INIT_ONCE;
typedef INIT_ONCE *PINIT_ONCE;
typedef void *PVOID, *LPVOID;
#define INIT_ONCE_STATIC_INIT {0}
// The calling convention that the sources name: on x64 Windows has one.
#define CALLBACK BUN_WINDOWS_ABI
#define WINAPI BUN_WINDOWS_ABI
typedef BOOL (CALLBACK *PINIT_ONCE_FN)(PINIT_ONCE once, PVOID parameter, PVOID *context);
#define s_addr S_un.S_addr
#define s6_addr u.Byte
typedef struct sockaddr SOCKADDR;
typedef struct sockaddr_in SOCKADDR_IN;
typedef struct sockaddr_in6 SOCKADDR_IN6;
typedef struct sockaddr_storage SOCKADDR_STORAGE;
typedef struct addrinfo ADDRINFOA;
static const struct in6_addr in6addr_any = {{{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}}};
static const struct in6_addr in6addr_loopback = {{{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}}};
static inline uint16_t htons(uint16_t value) { return __builtin_bswap16(value); }
static inline uint16_t ntohs(uint16_t value) { return __builtin_bswap16(value); }
static inline uint32_t htonl(uint32_t value) { return __builtin_bswap32(value); }
static inline uint32_t ntohl(uint32_t value) { return __builtin_bswap32(value); }

_Static_assert(sizeof(struct sockaddr) == 16 && _Alignof(struct sockaddr) == 2, "struct sockaddr: the bindings of bun have another size or alignment");
_Static_assert(offsetof(struct sockaddr, sa_family) == 0, "struct sockaddr.sa_family: the bindings of bun have it at another offset");
_Static_assert(offsetof(struct sockaddr, sa_data) == 2, "struct sockaddr.sa_data: the bindings of bun have it at another offset");
_Static_assert(sizeof(struct sockaddr_in) == 16 && _Alignof(struct sockaddr_in) == 4, "struct sockaddr_in: the bindings of bun have another size or alignment");
_Static_assert(offsetof(struct sockaddr_in, sin_family) == 0, "struct sockaddr_in.sin_family: the bindings of bun have it at another offset");
_Static_assert(offsetof(struct sockaddr_in, sin_port) == 2, "struct sockaddr_in.sin_port: the bindings of bun have it at another offset");
_Static_assert(offsetof(struct sockaddr_in, sin_addr) == 4, "struct sockaddr_in.sin_addr: the bindings of bun have it at another offset");
_Static_assert(offsetof(struct sockaddr_in, sin_zero) == 8, "struct sockaddr_in.sin_zero: the bindings of bun have it at another offset");
_Static_assert(sizeof(struct sockaddr_in6) == 28 && _Alignof(struct sockaddr_in6) == 4, "struct sockaddr_in6: the bindings of bun have another size or alignment");
_Static_assert(offsetof(struct sockaddr_in6, sin6_family) == 0, "struct sockaddr_in6.sin6_family: the bindings of bun have it at another offset");
_Static_assert(offsetof(struct sockaddr_in6, sin6_port) == 2, "struct sockaddr_in6.sin6_port: the bindings of bun have it at another offset");
_Static_assert(offsetof(struct sockaddr_in6, sin6_flowinfo) == 4, "struct sockaddr_in6.sin6_flowinfo: the bindings of bun have it at another offset");
_Static_assert(offsetof(struct sockaddr_in6, sin6_addr) == 8, "struct sockaddr_in6.sin6_addr: the bindings of bun have it at another offset");
_Static_assert(offsetof(struct sockaddr_in6, sin6_scope_id) == 24, "struct sockaddr_in6.sin6_scope_id: the bindings of bun have it at another offset");
_Static_assert(sizeof(struct sockaddr_storage) == 128 && _Alignof(struct sockaddr_storage) == 8, "struct sockaddr_storage: the bindings of bun have another size or alignment");
_Static_assert(offsetof(struct sockaddr_storage, ss_family) == 0, "struct sockaddr_storage.ss_family: the bindings of bun have it at another offset");
_Static_assert(sizeof(struct addrinfo) == 48 && _Alignof(struct addrinfo) == 8, "struct addrinfo: the bindings of bun have another size or alignment");
_Static_assert(offsetof(struct addrinfo, ai_flags) == 0, "struct addrinfo.ai_flags: the bindings of bun have it at another offset");
_Static_assert(offsetof(struct addrinfo, ai_family) == 4, "struct addrinfo.ai_family: the bindings of bun have it at another offset");
_Static_assert(offsetof(struct addrinfo, ai_socktype) == 8, "struct addrinfo.ai_socktype: the bindings of bun have it at another offset");
_Static_assert(offsetof(struct addrinfo, ai_protocol) == 12, "struct addrinfo.ai_protocol: the bindings of bun have it at another offset");
_Static_assert(offsetof(struct addrinfo, ai_addrlen) == 16, "struct addrinfo.ai_addrlen: the bindings of bun have it at another offset");
_Static_assert(offsetof(struct addrinfo, ai_canonname) == 24, "struct addrinfo.ai_canonname: the bindings of bun have it at another offset");
_Static_assert(offsetof(struct addrinfo, ai_addr) == 32, "struct addrinfo.ai_addr: the bindings of bun have it at another offset");
_Static_assert(offsetof(struct addrinfo, ai_next) == 40, "struct addrinfo.ai_next: the bindings of bun have it at another offset");

// libuv
#define UV_READABLE (1)
#define UV_WRITABLE (2)
#define UV_DISCONNECT (4)
#define UV_PRIORITIZED (8)
#define UV_RUN_DEFAULT (0)
#define UV_RUN_ONCE (1)
#define UV_RUN_NOWAIT (2)
#define UV_POLL (8)
#define UV_EOF (-4095)
typedef struct uv_loop_s uv_loop_t;
typedef struct uv_handle_s uv_handle_t;
typedef struct uv_poll_s uv_poll_t;
typedef struct uv_timer_s uv_timer_t;
typedef struct uv_async_s uv_async_t;
typedef struct uv_prepare_s uv_prepare_t;
typedef struct uv_check_s uv_check_t;
struct uv_loop_s {
  void *data;
  uint32_t active_handles;
  uint8_t bun_bytes_at_12[460];
} __attribute__((packed, aligned(8)));
_Static_assert(sizeof(uv_loop_t) == 472 && _Alignof(uv_loop_t) == 8, "uv_loop_t: not the size and the alignment of the bindings of bun");
_Static_assert(offsetof(uv_loop_t, data) == 0 && sizeof(((uv_loop_t *)0)->data) == 8, "uv_loop_t.data: not where the bindings of bun have it");
_Static_assert(offsetof(uv_loop_t, active_handles) == 8 && sizeof(((uv_loop_t *)0)->active_handles) == 4, "uv_loop_t.active_handles: not where the bindings of bun have it");
struct uv_handle_s {
  void *data;
  struct uv_loop_s *loop;
  int32_t type;
  uint8_t bun_bytes_at_20[76];
} __attribute__((packed, aligned(8)));
_Static_assert(sizeof(uv_handle_t) == 96 && _Alignof(uv_handle_t) == 8, "uv_handle_t: not the size and the alignment of the bindings of bun");
_Static_assert(offsetof(uv_handle_t, data) == 0 && sizeof(((uv_handle_t *)0)->data) == 8, "uv_handle_t.data: not where the bindings of bun have it");
_Static_assert(offsetof(uv_handle_t, loop) == 8 && sizeof(((uv_handle_t *)0)->loop) == 8, "uv_handle_t.loop: not where the bindings of bun have it");
_Static_assert(offsetof(uv_handle_t, type) == 16 && sizeof(((uv_handle_t *)0)->type) == 4, "uv_handle_t.type: not where the bindings of bun have it");
struct uv_poll_s {
  void *data;
  struct uv_loop_s *loop;
  int32_t type;
  uint8_t bun_bytes_at_20[396];
} __attribute__((packed, aligned(8)));
_Static_assert(sizeof(uv_poll_t) == 416 && _Alignof(uv_poll_t) == 8, "uv_poll_t: not the size and the alignment of the bindings of bun");
_Static_assert(offsetof(uv_poll_t, data) == 0 && sizeof(((uv_poll_t *)0)->data) == 8, "uv_poll_t.data: not where the bindings of bun have it");
_Static_assert(offsetof(uv_poll_t, loop) == 8 && sizeof(((uv_poll_t *)0)->loop) == 8, "uv_poll_t.loop: not where the bindings of bun have it");
_Static_assert(offsetof(uv_poll_t, type) == 16 && sizeof(((uv_poll_t *)0)->type) == 4, "uv_poll_t.type: not where the bindings of bun have it");
struct uv_timer_s {
  void *data;
  struct uv_loop_s *loop;
  int32_t type;
  uint8_t bun_bytes_at_20[140];
} __attribute__((packed, aligned(8)));
_Static_assert(sizeof(uv_timer_t) == 160 && _Alignof(uv_timer_t) == 8, "uv_timer_t: not the size and the alignment of the bindings of bun");
_Static_assert(offsetof(uv_timer_t, data) == 0 && sizeof(((uv_timer_t *)0)->data) == 8, "uv_timer_t.data: not where the bindings of bun have it");
_Static_assert(offsetof(uv_timer_t, loop) == 8 && sizeof(((uv_timer_t *)0)->loop) == 8, "uv_timer_t.loop: not where the bindings of bun have it");
_Static_assert(offsetof(uv_timer_t, type) == 16 && sizeof(((uv_timer_t *)0)->type) == 4, "uv_timer_t.type: not where the bindings of bun have it");
struct uv_async_s {
  void *data;
  struct uv_loop_s *loop;
  int32_t type;
  uint8_t bun_bytes_at_20[204];
} __attribute__((packed, aligned(8)));
_Static_assert(sizeof(uv_async_t) == 224 && _Alignof(uv_async_t) == 8, "uv_async_t: not the size and the alignment of the bindings of bun");
_Static_assert(offsetof(uv_async_t, data) == 0 && sizeof(((uv_async_t *)0)->data) == 8, "uv_async_t.data: not where the bindings of bun have it");
_Static_assert(offsetof(uv_async_t, loop) == 8 && sizeof(((uv_async_t *)0)->loop) == 8, "uv_async_t.loop: not where the bindings of bun have it");
_Static_assert(offsetof(uv_async_t, type) == 16 && sizeof(((uv_async_t *)0)->type) == 4, "uv_async_t.type: not where the bindings of bun have it");
struct uv_prepare_s {
  void *data;
  struct uv_loop_s *loop;
  int32_t type;
  uint8_t bun_bytes_at_20[100];
} __attribute__((packed, aligned(8)));
_Static_assert(sizeof(uv_prepare_t) == 120 && _Alignof(uv_prepare_t) == 8, "uv_prepare_t: not the size and the alignment of the bindings of bun");
_Static_assert(offsetof(uv_prepare_t, data) == 0 && sizeof(((uv_prepare_t *)0)->data) == 8, "uv_prepare_t.data: not where the bindings of bun have it");
_Static_assert(offsetof(uv_prepare_t, loop) == 8 && sizeof(((uv_prepare_t *)0)->loop) == 8, "uv_prepare_t.loop: not where the bindings of bun have it");
_Static_assert(offsetof(uv_prepare_t, type) == 16 && sizeof(((uv_prepare_t *)0)->type) == 4, "uv_prepare_t.type: not where the bindings of bun have it");
struct uv_check_s {
  void *data;
  struct uv_loop_s *loop;
  int32_t type;
  uint8_t bun_bytes_at_20[100];
} __attribute__((packed, aligned(8)));
_Static_assert(sizeof(uv_check_t) == 120 && _Alignof(uv_check_t) == 8, "uv_check_t: not the size and the alignment of the bindings of bun");
_Static_assert(offsetof(uv_check_t, data) == 0 && sizeof(((uv_check_t *)0)->data) == 8, "uv_check_t.data: not where the bindings of bun have it");
_Static_assert(offsetof(uv_check_t, loop) == 8 && sizeof(((uv_check_t *)0)->loop) == 8, "uv_check_t.loop: not where the bindings of bun have it");
_Static_assert(offsetof(uv_check_t, type) == 16 && sizeof(((uv_check_t *)0)->type) == 4, "uv_check_t.type: not where the bindings of bun have it");
typedef void (BUN_WINDOWS_ABI *uv_close_cb)(uv_handle_t *);
typedef void (BUN_WINDOWS_ABI *uv_poll_cb)(uv_poll_t *, int32_t, int32_t);
typedef void (BUN_WINDOWS_ABI *uv_timer_cb)(uv_timer_t *);
typedef void (BUN_WINDOWS_ABI *uv_async_cb)(uv_async_t *);
typedef void (BUN_WINDOWS_ABI *uv_prepare_cb)(uv_prepare_t *);
typedef void (BUN_WINDOWS_ABI *uv_check_cb)(uv_check_t *);

// An entry of the import table of the image (bun_windows_sys::host_imports::Import), and the
// address it holds once the host has resolved it.
struct bun_import { void *address; const char *library; const char *symbol; };
void *__bun_import_address(struct bun_import *import);
static inline void *bun_import_address(struct bun_import *import) {
  void *address = __atomic_load_n(&import->address, __ATOMIC_RELAXED);
  return address ? address : __bun_import_address(import);
}

extern struct bun_import bun_import__libuv__uv_loop_new;
static inline uv_loop_t *uv_loop_new(void) {
  return ((uv_loop_t * (BUN_WINDOWS_ABI *)(void))bun_import_address(&bun_import__libuv__uv_loop_new))();
}
extern struct bun_import bun_import__libuv__uv_loop_delete;
static inline void uv_loop_delete(uv_loop_t *loop) {
  ((void (BUN_WINDOWS_ABI *)(uv_loop_t *))bun_import_address(&bun_import__libuv__uv_loop_delete))(loop);
}
extern struct bun_import bun_import__libuv__uv_run;
static inline int32_t uv_run(uv_loop_t *loop, int32_t mode) {
  return ((int32_t (BUN_WINDOWS_ABI *)(uv_loop_t *, int32_t))bun_import_address(&bun_import__libuv__uv_run))(loop, mode);
}
extern struct bun_import bun_import__libuv__uv_now;
static inline uint64_t uv_now(const uv_loop_t *loop) {
  return ((uint64_t (BUN_WINDOWS_ABI *)(const uv_loop_t *))bun_import_address(&bun_import__libuv__uv_now))(loop);
}
extern struct bun_import bun_import__libuv__uv_update_time;
static inline void uv_update_time(uv_loop_t *loop) {
  ((void (BUN_WINDOWS_ABI *)(uv_loop_t *))bun_import_address(&bun_import__libuv__uv_update_time))(loop);
}
extern struct bun_import bun_import__libuv__uv_ref;
static inline void uv_ref(uv_handle_t *handle) {
  ((void (BUN_WINDOWS_ABI *)(uv_handle_t *))bun_import_address(&bun_import__libuv__uv_ref))(handle);
}
extern struct bun_import bun_import__libuv__uv_unref;
static inline void uv_unref(uv_handle_t *handle) {
  ((void (BUN_WINDOWS_ABI *)(uv_handle_t *))bun_import_address(&bun_import__libuv__uv_unref))(handle);
}
extern struct bun_import bun_import__libuv__uv_close;
static inline void uv_close(uv_handle_t *handle, uv_close_cb close_cb) {
  ((void (BUN_WINDOWS_ABI *)(uv_handle_t *, uv_close_cb))bun_import_address(&bun_import__libuv__uv_close))(handle, close_cb);
}
extern struct bun_import bun_import__libuv__uv_is_closing;
static inline int32_t uv_is_closing(const uv_handle_t *handle) {
  return ((int32_t (BUN_WINDOWS_ABI *)(const uv_handle_t *))bun_import_address(&bun_import__libuv__uv_is_closing))(handle);
}
extern struct bun_import bun_import__libuv__uv_poll_init_socket;
static inline int32_t uv_poll_init_socket(uv_loop_t *loop, uv_poll_t *handle, SOCKET socket) {
  return ((int32_t (BUN_WINDOWS_ABI *)(uv_loop_t *, uv_poll_t *, SOCKET))bun_import_address(&bun_import__libuv__uv_poll_init_socket))(loop, handle, socket);
}
extern struct bun_import bun_import__libuv__uv_poll_start;
static inline int32_t uv_poll_start(uv_poll_t *handle, int32_t events, uv_poll_cb cb) {
  return ((int32_t (BUN_WINDOWS_ABI *)(uv_poll_t *, int32_t, uv_poll_cb))bun_import_address(&bun_import__libuv__uv_poll_start))(handle, events, cb);
}
extern struct bun_import bun_import__libuv__uv_poll_stop;
static inline int32_t uv_poll_stop(uv_poll_t *handle) {
  return ((int32_t (BUN_WINDOWS_ABI *)(uv_poll_t *))bun_import_address(&bun_import__libuv__uv_poll_stop))(handle);
}
extern struct bun_import bun_import__libuv__uv_timer_init;
static inline int32_t uv_timer_init(uv_loop_t *loop, uv_timer_t *handle) {
  return ((int32_t (BUN_WINDOWS_ABI *)(uv_loop_t *, uv_timer_t *))bun_import_address(&bun_import__libuv__uv_timer_init))(loop, handle);
}
extern struct bun_import bun_import__libuv__uv_timer_start;
static inline int32_t uv_timer_start(uv_timer_t *handle, uv_timer_cb cb, uint64_t timeout, uint64_t repeat) {
  return ((int32_t (BUN_WINDOWS_ABI *)(uv_timer_t *, uv_timer_cb, uint64_t, uint64_t))bun_import_address(&bun_import__libuv__uv_timer_start))(handle, cb, timeout, repeat);
}
extern struct bun_import bun_import__libuv__uv_timer_stop;
static inline int32_t uv_timer_stop(uv_timer_t *handle) {
  return ((int32_t (BUN_WINDOWS_ABI *)(uv_timer_t *))bun_import_address(&bun_import__libuv__uv_timer_stop))(handle);
}
extern struct bun_import bun_import__libuv__uv_prepare_init;
static inline int32_t uv_prepare_init(uv_loop_t *loop, uv_prepare_t *prepare) {
  return ((int32_t (BUN_WINDOWS_ABI *)(uv_loop_t *, uv_prepare_t *))bun_import_address(&bun_import__libuv__uv_prepare_init))(loop, prepare);
}
extern struct bun_import bun_import__libuv__uv_prepare_start;
static inline int32_t uv_prepare_start(uv_prepare_t *prepare, uv_prepare_cb cb) {
  return ((int32_t (BUN_WINDOWS_ABI *)(uv_prepare_t *, uv_prepare_cb))bun_import_address(&bun_import__libuv__uv_prepare_start))(prepare, cb);
}
extern struct bun_import bun_import__libuv__uv_prepare_stop;
static inline int32_t uv_prepare_stop(uv_prepare_t *prepare) {
  return ((int32_t (BUN_WINDOWS_ABI *)(uv_prepare_t *))bun_import_address(&bun_import__libuv__uv_prepare_stop))(prepare);
}
extern struct bun_import bun_import__libuv__uv_check_init;
static inline int32_t uv_check_init(uv_loop_t *loop, uv_check_t *check) {
  return ((int32_t (BUN_WINDOWS_ABI *)(uv_loop_t *, uv_check_t *))bun_import_address(&bun_import__libuv__uv_check_init))(loop, check);
}
extern struct bun_import bun_import__libuv__uv_check_start;
static inline int32_t uv_check_start(uv_check_t *check, uv_check_cb cb) {
  return ((int32_t (BUN_WINDOWS_ABI *)(uv_check_t *, uv_check_cb))bun_import_address(&bun_import__libuv__uv_check_start))(check, cb);
}
extern struct bun_import bun_import__libuv__uv_check_stop;
static inline int32_t uv_check_stop(uv_check_t *check) {
  return ((int32_t (BUN_WINDOWS_ABI *)(uv_check_t *))bun_import_address(&bun_import__libuv__uv_check_stop))(check);
}
extern struct bun_import bun_import__libuv__uv_async_init;
static inline int32_t uv_async_init(uv_loop_t *loop, uv_async_t *async, uv_async_cb cb) {
  return ((int32_t (BUN_WINDOWS_ABI *)(uv_loop_t *, uv_async_t *, uv_async_cb))bun_import_address(&bun_import__libuv__uv_async_init))(loop, async, cb);
}
extern struct bun_import bun_import__libuv__uv_async_send;
static inline int32_t uv_async_send(uv_async_t *async) {
  return ((int32_t (BUN_WINDOWS_ABI *)(uv_async_t *))bun_import_address(&bun_import__libuv__uv_async_send))(async);
}
extern struct bun_import bun_import__libuv__uv__winsock_ensure;
static inline void uv__winsock_ensure(void) {
  ((void (BUN_WINDOWS_ABI *)(void))bun_import_address(&bun_import__libuv__uv__winsock_ensure))();
}
extern struct bun_import bun_import__ws2_32__WSAGetLastError;
static inline int32_t WSAGetLastError(void) {
  return ((int32_t (BUN_WINDOWS_ABI *)(void))bun_import_address(&bun_import__ws2_32__WSAGetLastError))();
}
extern struct bun_import bun_import__ws2_32__WSASetLastError;
static inline void WSASetLastError(int32_t error) {
  ((void (BUN_WINDOWS_ABI *)(int32_t))bun_import_address(&bun_import__ws2_32__WSASetLastError))(error);
}
extern struct bun_import bun_import__ws2_32__WSASocketW;
static inline SOCKET WSASocketW(int32_t af, int32_t type, int32_t protocol, WSAPROTOCOL_INFOW *info, uint32_t group, uint32_t flags) {
  return ((SOCKET (BUN_WINDOWS_ABI *)(int32_t, int32_t, int32_t, WSAPROTOCOL_INFOW *, uint32_t, uint32_t))bun_import_address(&bun_import__ws2_32__WSASocketW))(af, type, protocol, info, group, flags);
}
extern struct bun_import bun_import__ws2_32__WSADuplicateSocketW;
static inline int32_t WSADuplicateSocketW(SOCKET s, uint32_t process, WSAPROTOCOL_INFOW *info) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET, uint32_t, WSAPROTOCOL_INFOW *))bun_import_address(&bun_import__ws2_32__WSADuplicateSocketW))(s, process, info);
}
extern struct bun_import bun_import__ws2_32__WSAIoctl;
static inline int32_t WSAIoctl(SOCKET s, uint32_t code, void *in, uint32_t in_size, void *out, uint32_t out_size, uint32_t *returned, void *overlapped, void *completion) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET, uint32_t, void *, uint32_t, void *, uint32_t, uint32_t *, void *, void *))bun_import_address(&bun_import__ws2_32__WSAIoctl))(s, code, in, in_size, out, out_size, returned, overlapped, completion);
}
extern struct bun_import bun_import__ws2_32__socket;
static inline SOCKET socket(int32_t af, int32_t type, int32_t protocol) {
  return ((SOCKET (BUN_WINDOWS_ABI *)(int32_t, int32_t, int32_t))bun_import_address(&bun_import__ws2_32__socket))(af, type, protocol);
}
extern struct bun_import bun_import__ws2_32__closesocket;
static inline int32_t closesocket(SOCKET s) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET))bun_import_address(&bun_import__ws2_32__closesocket))(s);
}
extern struct bun_import bun_import__ws2_32__ioctlsocket;
static inline int32_t ioctlsocket(SOCKET s, int32_t command, uint32_t *argument) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET, int32_t, uint32_t *))bun_import_address(&bun_import__ws2_32__ioctlsocket))(s, command, argument);
}
extern struct bun_import bun_import__ws2_32__bind;
static inline int32_t bind(SOCKET s, const struct sockaddr *name, int32_t length) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET, const struct sockaddr *, int32_t))bun_import_address(&bun_import__ws2_32__bind))(s, name, length);
}
extern struct bun_import bun_import__ws2_32__listen;
static inline int32_t listen(SOCKET s, int32_t backlog) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET, int32_t))bun_import_address(&bun_import__ws2_32__listen))(s, backlog);
}
extern struct bun_import bun_import__ws2_32__accept;
static inline SOCKET accept(SOCKET s, struct sockaddr *address, int32_t *length) {
  return ((SOCKET (BUN_WINDOWS_ABI *)(SOCKET, struct sockaddr *, int32_t *))bun_import_address(&bun_import__ws2_32__accept))(s, address, length);
}
extern struct bun_import bun_import__ws2_32__connect;
static inline int32_t connect(SOCKET s, const struct sockaddr *name, int32_t length) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET, const struct sockaddr *, int32_t))bun_import_address(&bun_import__ws2_32__connect))(s, name, length);
}
extern struct bun_import bun_import__ws2_32__shutdown;
static inline int32_t shutdown(SOCKET s, int32_t how) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET, int32_t))bun_import_address(&bun_import__ws2_32__shutdown))(s, how);
}
extern struct bun_import bun_import__ws2_32__recv;
static inline int32_t recv(SOCKET s, char *buffer, int32_t length, int32_t flags) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET, char *, int32_t, int32_t))bun_import_address(&bun_import__ws2_32__recv))(s, buffer, length, flags);
}
extern struct bun_import bun_import__ws2_32__send;
static inline int32_t send(SOCKET s, const char *buffer, int32_t length, int32_t flags) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET, const char *, int32_t, int32_t))bun_import_address(&bun_import__ws2_32__send))(s, buffer, length, flags);
}
extern struct bun_import bun_import__ws2_32__recvfrom;
static inline int32_t recvfrom(SOCKET s, char *buffer, int32_t length, int32_t flags, struct sockaddr *from, int32_t *from_length) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET, char *, int32_t, int32_t, struct sockaddr *, int32_t *))bun_import_address(&bun_import__ws2_32__recvfrom))(s, buffer, length, flags, from, from_length);
}
extern struct bun_import bun_import__ws2_32__sendto;
static inline int32_t sendto(SOCKET s, const char *buffer, int32_t length, int32_t flags, const struct sockaddr *to, int32_t to_length) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET, const char *, int32_t, int32_t, const struct sockaddr *, int32_t))bun_import_address(&bun_import__ws2_32__sendto))(s, buffer, length, flags, to, to_length);
}
extern struct bun_import bun_import__ws2_32__setsockopt;
static inline int32_t setsockopt(SOCKET s, int32_t level, int32_t name, const char *value, int32_t length) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET, int32_t, int32_t, const char *, int32_t))bun_import_address(&bun_import__ws2_32__setsockopt))(s, level, name, value, length);
}
extern struct bun_import bun_import__ws2_32__getsockopt;
static inline int32_t getsockopt(SOCKET s, int32_t level, int32_t name, char *value, int32_t *length) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET, int32_t, int32_t, char *, int32_t *))bun_import_address(&bun_import__ws2_32__getsockopt))(s, level, name, value, length);
}
extern struct bun_import bun_import__ws2_32__getsockname;
static inline int32_t getsockname(SOCKET s, struct sockaddr *name, int32_t *length) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET, struct sockaddr *, int32_t *))bun_import_address(&bun_import__ws2_32__getsockname))(s, name, length);
}
extern struct bun_import bun_import__ws2_32__getpeername;
static inline int32_t getpeername(SOCKET s, struct sockaddr *name, int32_t *length) {
  return ((int32_t (BUN_WINDOWS_ABI *)(SOCKET, struct sockaddr *, int32_t *))bun_import_address(&bun_import__ws2_32__getpeername))(s, name, length);
}
extern struct bun_import bun_import__ws2_32__getaddrinfo;
static inline int32_t getaddrinfo(const char *node, const char *service, const struct addrinfo *hints, struct addrinfo **result) {
  return ((int32_t (BUN_WINDOWS_ABI *)(const char *, const char *, const struct addrinfo *, struct addrinfo **))bun_import_address(&bun_import__ws2_32__getaddrinfo))(node, service, hints, result);
}
extern struct bun_import bun_import__ws2_32__freeaddrinfo;
static inline void freeaddrinfo(struct addrinfo *info) {
  ((void (BUN_WINDOWS_ABI *)(struct addrinfo *))bun_import_address(&bun_import__ws2_32__freeaddrinfo))(info);
}
extern struct bun_import bun_import__kernel32__SetHandleInformation;
static inline int32_t SetHandleInformation(HANDLE object, uint32_t mask, uint32_t flags) {
  return ((int32_t (BUN_WINDOWS_ABI *)(HANDLE, uint32_t, uint32_t))bun_import_address(&bun_import__kernel32__SetHandleInformation))(object, mask, flags);
}
extern struct bun_import bun_import__kernel32__SetLastError;
static inline void SetLastError(uint32_t error) {
  ((void (BUN_WINDOWS_ABI *)(uint32_t))bun_import_address(&bun_import__kernel32__SetLastError))(error);
}
extern struct bun_import bun_import__kernel32__InitOnceExecuteOnce;
static inline int32_t InitOnceExecuteOnce(INIT_ONCE *once, PINIT_ONCE_FN function, void *parameter, void **context) {
  return ((int32_t (BUN_WINDOWS_ABI *)(INIT_ONCE *, PINIT_ONCE_FN, void *, void **))bun_import_address(&bun_import__kernel32__InitOnceExecuteOnce))(once, function, parameter, context);
}
extern struct bun_import bun_import__kernel32__GetLastError;
static inline uint32_t GetLastError(void) {
  return ((uint32_t (BUN_WINDOWS_ABI *)(void))bun_import_address(&bun_import__kernel32__GetLastError))();
}
extern struct bun_import bun_import__ucrtbase___errno;
static inline int32_t *_errno(void) {
  return ((int32_t * (BUN_WINDOWS_ABI *)(void))bun_import_address(&bun_import__ucrtbase___errno))();
}

// errno of the C runtime of Windows, and its numbers
#define errno (*_errno())
#define EPERM 1
#define ENOENT 2
#define ESRCH 3
#define EINTR 4
#define EIO 5
#define ENXIO 6
#define E2BIG 7
#define ENOEXEC 8
#define EBADF 9
#define ECHILD 10
#define EAGAIN 11
#define ENOMEM 12
#define EACCES 13
#define EFAULT 14
#define EBUSY 16
#define EEXIST 17
#define EXDEV 18
#define ENODEV 19
#define ENOTDIR 20
#define EISDIR 21
#define EINVAL 22
#define ENFILE 23
#define EMFILE 24
#define ENOTTY 25
#define EFBIG 27
#define ENOSPC 28
#define ESPIPE 29
#define EROFS 30
#define EMLINK 31
#define EPIPE 32
#define EDOM 33
#define ERANGE 34
#define EDEADLK 36
#define ENAMETOOLONG 38
#define ENOLCK 39
#define ENOSYS 40
#define ENOTEMPTY 41
#define EILSEQ 42
#define EADDRINUSE 100
#define EADDRNOTAVAIL 101
#define EAFNOSUPPORT 102
#define EALREADY 103
#define EBADMSG 104
#define ECANCELED 105
#define ECONNABORTED 106
#define ECONNREFUSED 107
#define ECONNRESET 108
#define EDESTADDRREQ 109
#define EHOSTUNREACH 110
#define EIDRM 111
#define EINPROGRESS 112
#define EISCONN 113
#define ELOOP 114
#define EMSGSIZE 115
#define ENETDOWN 116
#define ENETRESET 117
#define ENETUNREACH 118
#define ENOBUFS 119
#define ENODATA 120
#define ENOLINK 121
#define ENOMSG 122
#define ENOPROTOOPT 123
#define ENOSR 124
#define ENOSTR 125
#define ENOTCONN 126
#define ENOTRECOVERABLE 127
#define ENOTSOCK 128
#define ENOTSUP 129
#define EOPNOTSUPP 130
#define EOVERFLOW 132
#define EOWNERDEAD 133
#define EPROTO 134
#define EPROTONOSUPPORT 135
#define EPROTOTYPE 136
#define ETIME 137
#define ETIMEDOUT 138
#define ETXTBSY 139
#define EWOULDBLOCK 140

#endif
