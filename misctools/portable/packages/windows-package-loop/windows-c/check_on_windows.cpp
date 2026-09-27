// Written by misctools/portable/loop/uv_header.ts. Do not edit.
//
// Compiled against the headers of the Windows SDK and of libuv:
//   clang++ -fsyntax-only -std=c++17 -I<libuv>\include check_on_windows.cpp
// Every line that fails names a function that bun_windows_c.h calls with other arguments than the
// headers declare, or a callback that it declares with others.
#include <winsock2.h>
#include <ws2tcpip.h>
#include <mstcpip.h>
#include <afunix.h>
#include <windows.h>
#include <stdint.h>
#include <uv.h>

// What the calling convention sees of a type: its width, whether it is a pointer, and for a pointer
// what it points at. Two integers of one width are the same (a long of Windows and an int32_t), and
// so are an enumeration and the integer of its width. A pointer to void is the same as every pointer
// to data.
template <class T> struct Shape {
  static constexpr bool pointer = false, function = false, nothing = __is_void(T), floating = __is_floating_point(T);
  static constexpr unsigned long long size = sizeof(T);
};
template <> struct Shape<void> {
  static constexpr bool pointer = false, function = false, nothing = true, floating = false;
  static constexpr unsigned long long size = 0;
};
template <class R, class... A> struct Shape<R(A...)> {
  static constexpr bool pointer = false, function = true, nothing = false, floating = false;
  static constexpr unsigned long long size = 0;
};
template <class T> struct Shape<T *> {
  static constexpr bool pointer = true, function = false, nothing = false, floating = false;
  static constexpr unsigned long long size = sizeof(T *);
};
template <class T> struct Shape<const T> : Shape<T> {};
template <class T> struct Shape<volatile T> : Shape<T> {};
template <class T> struct Shape<const volatile T> : Shape<T> {};

template <class A, class B> struct Same;
template <class A, class B> struct SamePointee {
  static constexpr bool value = Shape<A>::nothing || Shape<B>::nothing || (!Shape<A>::function && !Shape<B>::function && Same<A, B>::value);
};
template <class R, class... A, class S, class... B> struct SamePointee<R(A...), S(B...)> {
  static constexpr bool value = Same<R(A...), S(B...)>::value;
};
template <class A, class B> struct SamePointee<const A, B> : SamePointee<A, B> {};
template <class A, class B> struct SamePointee<A, const B> : SamePointee<A, B> {};
template <class A, class B> struct SamePointee<const A, const B> : SamePointee<A, B> {};
template <class A, class B> struct Same {
  static constexpr bool value = !Shape<A>::pointer && !Shape<B>::pointer && Shape<A>::nothing == Shape<B>::nothing &&
                                Shape<A>::floating == Shape<B>::floating && Shape<A>::size == Shape<B>::size;
};
template <class A, class B> struct Same<A *, B *> {
  static constexpr bool value = SamePointee<A, B>::value;
};
template <class A, class B> struct Same<const A, B> : Same<A, B> {};
template <class A, class B> struct Same<A, const B> : Same<A, B> {};
template <class A, class B> struct Same<const A, const B> : Same<A, B> {};
template <class... A> struct List {};
template <class A, class B> struct SameList {
  static constexpr bool value = false;
};
template <> struct SameList<List<>, List<>> {
  static constexpr bool value = true;
};
template <class A, class... As, class B, class... Bs> struct SameList<List<A, As...>, List<B, Bs...>> {
  static constexpr bool value = Same<A, B>::value && SameList<List<As...>, List<Bs...>>::value;
};
template <class R, class... A, class S, class... B> struct Same<R(A...), S(B...)> {
  static constexpr bool value = Same<R, S>::value && SameList<List<A...>, List<B...>>::value;
};

// The machinery tells a difference.
static_assert(Same<int(long, void *), int32_t(int32_t, char *)>::value, "a long of Windows is an int32_t");
static_assert(!Same<int(long), int(long long)>::value, "the width of an argument");
static_assert(!Same<int(long), int(long, long)>::value, "the number of the arguments");
static_assert(!Same<int(unsigned long *), int(unsigned long long *)>::value, "the width of what a pointer points at");
static_assert(!Same<int(void *), int(uintptr_t)>::value, "a pointer and an integer");
static_assert(!Same<void(void (*)(int)), void(void (*)(int, int))>::value, "the arguments of a callback");
static_assert(!Same<void(int), int(int)>::value, "the result");

static_assert(Same<decltype(uv_loop_new), uv_loop_t *()>::value, "libuv: uv_loop_new");
static_assert(Same<decltype(uv_loop_delete), void(uv_loop_t *)>::value, "libuv: uv_loop_delete");
static_assert(Same<decltype(uv_run), int32_t(uv_loop_t *, int32_t)>::value, "libuv: uv_run");
static_assert(Same<decltype(uv_now), uint64_t(const uv_loop_t *)>::value, "libuv: uv_now");
static_assert(Same<decltype(uv_update_time), void(uv_loop_t *)>::value, "libuv: uv_update_time");
static_assert(Same<decltype(uv_ref), void(uv_handle_t *)>::value, "libuv: uv_ref");
static_assert(Same<decltype(uv_unref), void(uv_handle_t *)>::value, "libuv: uv_unref");
static_assert(Same<decltype(uv_close), void(uv_handle_t *, uv_close_cb)>::value, "libuv: uv_close");
static_assert(Same<decltype(uv_is_closing), int32_t(const uv_handle_t *)>::value, "libuv: uv_is_closing");
static_assert(Same<decltype(uv_poll_init_socket), int32_t(uv_loop_t *, uv_poll_t *, SOCKET)>::value, "libuv: uv_poll_init_socket");
static_assert(Same<decltype(uv_poll_start), int32_t(uv_poll_t *, int32_t, uv_poll_cb)>::value, "libuv: uv_poll_start");
static_assert(Same<decltype(uv_poll_stop), int32_t(uv_poll_t *)>::value, "libuv: uv_poll_stop");
static_assert(Same<decltype(uv_timer_init), int32_t(uv_loop_t *, uv_timer_t *)>::value, "libuv: uv_timer_init");
static_assert(Same<decltype(uv_timer_start), int32_t(uv_timer_t *, uv_timer_cb, uint64_t, uint64_t)>::value, "libuv: uv_timer_start");
static_assert(Same<decltype(uv_timer_stop), int32_t(uv_timer_t *)>::value, "libuv: uv_timer_stop");
static_assert(Same<decltype(uv_prepare_init), int32_t(uv_loop_t *, uv_prepare_t *)>::value, "libuv: uv_prepare_init");
static_assert(Same<decltype(uv_prepare_start), int32_t(uv_prepare_t *, uv_prepare_cb)>::value, "libuv: uv_prepare_start");
static_assert(Same<decltype(uv_prepare_stop), int32_t(uv_prepare_t *)>::value, "libuv: uv_prepare_stop");
static_assert(Same<decltype(uv_check_init), int32_t(uv_loop_t *, uv_check_t *)>::value, "libuv: uv_check_init");
static_assert(Same<decltype(uv_check_start), int32_t(uv_check_t *, uv_check_cb)>::value, "libuv: uv_check_start");
static_assert(Same<decltype(uv_check_stop), int32_t(uv_check_t *)>::value, "libuv: uv_check_stop");
static_assert(Same<decltype(uv_async_init), int32_t(uv_loop_t *, uv_async_t *, uv_async_cb)>::value, "libuv: uv_async_init");
static_assert(Same<decltype(uv_async_send), int32_t(uv_async_t *)>::value, "libuv: uv_async_send");
static_assert(Same<decltype(WSAGetLastError), int32_t()>::value, "ws2_32: WSAGetLastError");
static_assert(Same<decltype(WSASetLastError), void(int32_t)>::value, "ws2_32: WSASetLastError");
static_assert(Same<decltype(WSASocketW), SOCKET(int32_t, int32_t, int32_t, WSAPROTOCOL_INFOW *, uint32_t, uint32_t)>::value, "ws2_32: WSASocketW");
static_assert(Same<decltype(WSADuplicateSocketW), int32_t(SOCKET, uint32_t, WSAPROTOCOL_INFOW *)>::value, "ws2_32: WSADuplicateSocketW");
static_assert(Same<decltype(WSAIoctl), int32_t(SOCKET, uint32_t, void *, uint32_t, void *, uint32_t, uint32_t *, void *, void *)>::value, "ws2_32: WSAIoctl");
static_assert(Same<decltype(socket), SOCKET(int32_t, int32_t, int32_t)>::value, "ws2_32: socket");
static_assert(Same<decltype(closesocket), int32_t(SOCKET)>::value, "ws2_32: closesocket");
static_assert(Same<decltype(ioctlsocket), int32_t(SOCKET, int32_t, uint32_t *)>::value, "ws2_32: ioctlsocket");
static_assert(Same<decltype(bind), int32_t(SOCKET, const struct sockaddr *, int32_t)>::value, "ws2_32: bind");
static_assert(Same<decltype(listen), int32_t(SOCKET, int32_t)>::value, "ws2_32: listen");
static_assert(Same<decltype(accept), SOCKET(SOCKET, struct sockaddr *, int32_t *)>::value, "ws2_32: accept");
static_assert(Same<decltype(connect), int32_t(SOCKET, const struct sockaddr *, int32_t)>::value, "ws2_32: connect");
static_assert(Same<decltype(shutdown), int32_t(SOCKET, int32_t)>::value, "ws2_32: shutdown");
static_assert(Same<decltype(recv), int32_t(SOCKET, char *, int32_t, int32_t)>::value, "ws2_32: recv");
static_assert(Same<decltype(send), int32_t(SOCKET, const char *, int32_t, int32_t)>::value, "ws2_32: send");
static_assert(Same<decltype(recvfrom), int32_t(SOCKET, char *, int32_t, int32_t, struct sockaddr *, int32_t *)>::value, "ws2_32: recvfrom");
static_assert(Same<decltype(sendto), int32_t(SOCKET, const char *, int32_t, int32_t, const struct sockaddr *, int32_t)>::value, "ws2_32: sendto");
static_assert(Same<decltype(setsockopt), int32_t(SOCKET, int32_t, int32_t, const char *, int32_t)>::value, "ws2_32: setsockopt");
static_assert(Same<decltype(getsockopt), int32_t(SOCKET, int32_t, int32_t, char *, int32_t *)>::value, "ws2_32: getsockopt");
static_assert(Same<decltype(getsockname), int32_t(SOCKET, struct sockaddr *, int32_t *)>::value, "ws2_32: getsockname");
static_assert(Same<decltype(getpeername), int32_t(SOCKET, struct sockaddr *, int32_t *)>::value, "ws2_32: getpeername");
static_assert(Same<decltype(getaddrinfo), int32_t(const char *, const char *, const struct addrinfo *, struct addrinfo **)>::value, "ws2_32: getaddrinfo");
static_assert(Same<decltype(freeaddrinfo), void(struct addrinfo *)>::value, "ws2_32: freeaddrinfo");
static_assert(Same<decltype(SetHandleInformation), int32_t(HANDLE, uint32_t, uint32_t)>::value, "kernel32: SetHandleInformation");
static_assert(Same<decltype(SetLastError), void(uint32_t)>::value, "kernel32: SetLastError");
static_assert(Same<decltype(InitOnceExecuteOnce), int32_t(INIT_ONCE *, PINIT_ONCE_FN, void *, void **)>::value, "kernel32: InitOnceExecuteOnce");
static_assert(Same<decltype(GetLastError), uint32_t()>::value, "kernel32: GetLastError");
static_assert(Same<uv_close_cb, void(*)(uv_handle_t *)>::value, "uv_close_cb");
static_assert(Same<uv_poll_cb, void(*)(uv_poll_t *, int32_t, int32_t)>::value, "uv_poll_cb");
static_assert(Same<uv_timer_cb, void(*)(uv_timer_t *)>::value, "uv_timer_cb");
static_assert(Same<uv_async_cb, void(*)(uv_async_t *)>::value, "uv_async_cb");
static_assert(Same<uv_prepare_cb, void(*)(uv_prepare_t *)>::value, "uv_prepare_cb");
static_assert(Same<uv_check_cb, void(*)(uv_check_t *)>::value, "uv_check_cb");
int main() { return 0; }
