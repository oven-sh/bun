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

struct us_poll_t;

struct us_loop_t {
  alignas(LIBUS_EXT_ALIGNMENT) struct us_internal_loop_data_t data;

  uv_loop_t *uv_loop;
  int is_default;

  /* libuv is only the readiness source here, the way epoll/kqueue are on the
   * other backend: the callbacks it runs inside uv_run (poll_cb, timer_cb,
   * async_cb) do nothing but link the poll into this list. us_loop_run and
   * us_loop_pump dispatch it once uv_run has returned, so no libuv frame is
   * ever on the stack below a socket, timer or wakeup handler. That is what
   * makes it sound for a handler to drive the loop again (waitForPromise) or
   * to close any handle: uv_run is not re-entrant, and closing a handle whose
   * libuv dispatch frame is still live corrupts the loop once a nested run
   * completes the close. The list is intrusive (a poll is in it at most once,
   * later reports for the same poll merge into its entry) and loop-wide, so a
   * nested dispatch keeps draining what an outer uv_run collected. */
  struct us_poll_t *ready_head;
  struct us_poll_t *ready_tail;

  /* Unref'd timer that bounds how long uv_run may park, so a tick can take a
   * timeout the way epoll_wait/kevent do (us_loop_run_with_timeout). Its
   * callback does nothing; expiring is enough to end the poll phase. */
  uv_timer_t *deadline_timer;

  /* Non-zero while this loop's uv_run is on the stack, i.e. while whatever
   * runs is running inside a libuv callback. Ticking the loop from there is a
   * nested uv_run, which libuv does not support; libuv callbacks record and
   * defer (see the top of libuv.c) so that never happens. */
  int in_uv_run;

  /* For a uv loop this us_loop created itself: head and tail of what Bun's
   * own libuv callbacks (pipes, processes, files, dns, ...) deferred during
   * uv_run - the Rust-side counterpart of the ready list
   * (src/libuv_sys/deferred.rs), reached through uv_loop->data. */
  void *deferred[2];
};

/* Not castable to uv_poll_t: the libuv handle is a separate allocation so the
 * poll block can be resized (us_poll_resize) while the handle stays put. */
struct us_poll_t {
  /* NULL once the poll no longer owns a handle: us_poll_stop handed it to
   * uv_close (libuv frees it in the close callback), or us_poll_resize moved
   * it to the replacement block. */
  uv_poll_t *uv_p;
  struct us_loop_t *loop;
  LIBUS_SOCKET_DESCRIPTOR fd;
  unsigned char poll_type;
  /* Linked into loop->ready_head. ready_status/ready_events accumulate what
   * libuv reported since the poll was last dispatched: the first non-zero
   * status, and the union of the event bits. */
  unsigned char ready;
  int ready_status;
  int ready_events;
  struct us_poll_t *ready_prev, *ready_next;
};

/* One non-blocking tick regardless of whether libuv considers the loop alive,
 * and one tick parked for at most timeout_ms (< 0 unbounded, 0 = pump); see
 * libuv.c. us_loop_run (libusockets.h) is the unbounded form. */
void us_loop_pump(struct us_loop_t *loop);
void us_loop_run_with_timeout(struct us_loop_t *loop, long long timeout_ms);

#endif // LIBUV_H
