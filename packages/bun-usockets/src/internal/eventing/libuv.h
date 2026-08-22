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

#ifndef LIBUV_H
#define LIBUV_H

#include "internal/loop_data.h"

#include <uv.h>
#define LIBUS_SOCKET_READABLE UV_READABLE
#define LIBUS_SOCKET_WRITABLE UV_WRITABLE

/* Defined in eventing/libuv.c; used by the sweep escalation in loop.c. */
int us_internal_libuv_peer_reset_probe(LIBUS_SOCKET_DESCRIPTOR fd);

struct us_loop_t {
  alignas(LIBUS_EXT_ALIGNMENT) struct us_internal_loop_data_t data;

  uv_loop_t *uv_loop;
  int is_default;

  uv_prepare_t *uv_pre;
  uv_check_t *uv_check;
};

// it is no longer valid to cast a pointer to us_poll_t to a pointer of
// uv_poll_t
struct us_poll_t {
  /* We need to hold a pointer to this uv_poll_t since we need to be able to
   * resize our block */
  uv_poll_t *uv_p;
  LIBUS_SOCKET_DESCRIPTOR fd;
  unsigned char poll_type;
  /* us_poll_stop ran. uv_p is closing, or closes when poll_cb_depth drops to
   * 0 (see poll_cb). Nothing re-arms the poll after this. */
  unsigned char stopped : 1;
  /* us_internal_poll_close_fd ran while the close of uv_p was still deferred;
   * fd is closed right after that close is issued. The order matters: uv_close
   * cancels the in-flight request with an ioctl on the socket, and a process
   * with strict handle checks (every AppContainer) dies on a closed handle. */
  unsigned char close_fd : 1;
  /* Once us_poll_start_rc has registered uv_p, libuv keeps pointers into it
   * (the in-flight AFD requests live inside the handle, and it sits in the
   * loop's handle and endgame lists) until it runs the close callback. So the
   * two blocks are freed by whichever of us_poll_free and close_cb_free_poll
   * runs second; these record which one has already run. */
  unsigned char uv_closed : 1;
  unsigned char released : 1;
  /* Number of poll_cb frames for this poll on the stack. More than one means
   * a handler re-entered the event loop (it waited for a promise) and the
   * inner run dispatched this poll again. */
  unsigned int poll_cb_depth;
};

#endif // LIBUV_H