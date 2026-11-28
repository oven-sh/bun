// clang-format off
#include "_libusockets.h"
#include "libusockets.h"
#include <bun-usockets/src/internal/internal.h>
#include <cerrno>

extern "C" size_t Bun__formatIpAddress(char (&buffer)[64], bool is_ipv6);
extern "C" int bun_is_exiting();
extern "C" void __attribute__((__noreturn__)) Bun__panic(const char *message, size_t length);
#ifndef _WIN32
extern "C" void __attribute__((__noreturn__)) Bun__loopInitFailed(int err);
#endif
extern "C" us_loop_t *Bun__ThreadLoop__create(void *nativeLoop);
extern "C" void Bun__ThreadLoop__free(us_loop_t *);

struct ThreadLoop {
  ~ThreadLoop() {
    // At exit it is wasted work, and it would free what must stay, such as uv_tty_t.
    if (loop && ownsNativeLoop && !bun_is_exiting()) {
      free();
    }
  }
  void free() {
    Bun__ThreadLoop__free(loop);
    loop = nullptr;
  }
  us_loop_t *loop = nullptr;
  bool ownsNativeLoop = false;
};
static thread_local ThreadLoop threadLoop;

extern "C"
{

// Force ThinLTO to import + inline these into their Rust callers. The
// out-of-line definitions are still emitted for non-LTO builds.
#pragma clang attribute push(__attribute__((always_inline)), apply_to = function)

  struct us_loop_t *uws_get_loop_with_native(void *existing_native_loop)
  {
    if (!threadLoop.loop) {
      threadLoop.loop = Bun__ThreadLoop__create(existing_native_loop);
      if (!threadLoop.loop) {
#ifndef _WIN32
        Bun__loopInitFailed(errno);
#else
        static const char msg[] = "failed to create the event loop";
        Bun__panic(msg, sizeof(msg) - 1);
#endif
      }
      threadLoop.ownsNativeLoop |= !existing_native_loop;
    }
    return threadLoop.loop;
  }

  struct us_loop_t *uws_get_loop()
  {
    return uws_get_loop_with_native(nullptr);
  }

  us_socket_t *uws_socket_next(us_socket_r s) { return s->next; }
  bool uws_socket_is_paused(us_socket_r s) { return s->flags.is_paused; }
  void uws_socket_set_allow_half_open(us_socket_r s, bool allow) { s->flags.allow_half_open = allow; }
  void uws_socket_set_hangup_closes_unsent(us_socket_r s) { s->hangup_closes_unsent = 1; }

  void us_socket_sendfile_needs_more(us_socket_r s) {
    if(us_socket_is_closed(s)) return;
    s->flags.last_write_failed = 1;
    /* Same gate as us_internal_rearm_writable (socket.c): re-adding READABLE
     * would undo a pause mid-backpressure and re-surface a consumed EOF on a
     * half-open socket. */
    us_poll_change(&s->p, s->group->loop,
                   LIBUS_SOCKET_WRITABLE | ((s->flags.is_paused || s->read_eof) ? 0 : LIBUS_SOCKET_READABLE));
  }

  LIBUS_SOCKET_DESCRIPTOR us_socket_get_fd(us_socket_r s) {
    return us_poll_fd(&s->p);
  }

  // Gets the remote address and port
  // Returns 0 if failure / unix socket
  uint64_t uws_res_get_remote_address_info(us_socket_r res, const char **dest, int *port, bool *is_ipv6)
  {
    // This function is manual inlining + modification of
    //      us_socket_remote_address
    // To get { ip, port, is_ipv6 } for Bun.serve().requestIP()
    static thread_local char b[64];
    auto length = us_get_remote_address_info(b, res, dest, port, (int*)is_ipv6);

    if (length == 0) return 0;
    *dest = b;
    *is_ipv6 = length != 4;
    return Bun__formatIpAddress(b, *is_ipv6);
  }

  uint64_t uws_res_get_local_address_info(us_socket_r res, const char **dest, int *port, bool *is_ipv6)
  {
    static thread_local char b[64];
    auto length = us_get_local_address_info(b, res, dest, port, (int*)is_ipv6);

    if (length == 0) return 0;
    *dest = b;
    *is_ipv6 = length != 4;
    return Bun__formatIpAddress(b, *is_ipv6);
  }

  // A thread that ran a uws loop (a Worker) is exiting; free its loop. On Windows the loop sits on
  // the thread's libuv loop, which the caller closes after this returns.
  extern "C" void bun_free_loop_at_thread_exit() {
      if (threadLoop.loop) {
          threadLoop.free();
      }
  }

#pragma clang attribute pop
}
