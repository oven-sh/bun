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

#include "internal/internal.h"
#include "libusockets.h"
#include <stdlib.h>
/* struct timespec for us_loop_run_bun_tick (UCRT defines it in time.h) */
#include <time.h>

#ifdef LIBUS_USE_LIBUV

/* uv_poll_t->data always (except for most times after calling us_poll_stop)
 * points to the us_poll_t */
static void poll_cb(uv_poll_t *p, int status, int events) {
  /* UV_DISCONNECT (Windows AFD): the peer closed its write side. A FIN
   * arriving after this side already half-closed and stopped reading never
   * fires another readable poll, and the socket (and server.close()) waits
   * forever - so DISCONNECT is armed unconditionally in us_poll_start/change
   * and surfaced as a readable dispatch: the read loop's recv() discovers
   * the true end of stream (0) after consuming whatever is still queued.
   * It is mapped to the eof hint ONLY for sockets whose write side we
   * already shut down (see below): unlike kqueue's EV_EOF, which the kernel
   * sets only alongside the final data, AFD can signal DISCONNECT while data
   * is still in flight, and an unconditional eof mapping closed connections
   * at a mid-stream EAGAIN (truncated bodies across the fetch/backpressure
   * suites). One-shot: AFD keeps reporting DISCONNECT once signaled, so
   * re-arm without it - us_poll_start/us_poll_change add it back on the next
   * poll change.
   * https://github.com/libuv/libuv/blob/v1.x/docs/src/poll.rst (UV_DISCONNECT
   * is Windows-only and best-effort; readable polling stays the primary
   * signal). */
  int eof = status == UV_EOF;
  if (events & UV_DISCONNECT) {
    struct us_poll_t *wp = (struct us_poll_t *)p->data;
    uv_poll_start(p, us_poll_events(wp), poll_cb);
    events |= UV_READABLE;
    /* For a socket whose write side we already shut down, AFD delivers no
     * readable event for the peer's FIN at all - the exact half-closed state
     * that hung server.close() - and with our writes closed there is no
     * data-bearing flow left that an early EOF could truncate. Only there is
     * DISCONNECT mapped to the eof hint (like kqueue's EV_EOF); every other
     * socket keeps recv()-owned EOF discovery so mid-stream transfers are
     * never cut at an EAGAIN. */
    if ((us_internal_poll_type(wp) & POLL_TYPE_KIND_MASK) == POLL_TYPE_SOCKET_SHUT_DOWN) {
      eof = 1;
    }
  }
  us_internal_dispatch_ready_poll((struct us_poll_t *)p->data, status < 0 && status != UV_EOF, eof,
                                  events);
}

static void prepare_cb(uv_prepare_t *p) {
  struct us_loop_t *loop = p->data;
  us_internal_loop_pre(loop);
}

/* Note: libuv timers execute AFTER the post callback */
static void check_cb(uv_check_t *p) {
  struct us_loop_t *loop = p->data;
  us_internal_loop_post(loop);
}

/* Not used for polls, since polls need two frees */
static void close_cb_free(uv_handle_t *h) { free(h->data); }

/* This one is different for polls, since we need two frees here */
static void close_cb_free_poll(uv_handle_t *h) {
  /* It is only in case we called us_poll_stop then quickly us_poll_free that we
   * enter this. Most of the time, actual freeing is done by us_poll_free. */
  if (h->data) {
    free(h->data);
    free(h);
  }
}

static void timer_cb(uv_timer_t *t) {
  struct us_internal_callback_t *cb = t->data;
  cb->cb(cb);
}

static void async_cb(uv_async_t *a) {
  struct us_internal_callback_t *cb = a->data;
  // internal asyncs give their loop, not themselves
  cb->cb((struct us_internal_callback_t *)cb->loop);
}

// poll
void us_poll_init(struct us_poll_t *p, LIBUS_SOCKET_DESCRIPTOR fd,
                  int poll_type) {
  p->poll_type = poll_type;
  p->fd = fd;
}

void us_poll_free(struct us_poll_t *p, struct us_loop_t *loop) {
  // poll was resized and dont own uv_poll_t anymore
  if(!p->uv_p) {
    free(p);
    return;
  }
  /* The idea here is like so; in us_poll_stop we call uv_close after setting
   * data of uv-poll to 0. This means that in close_cb_free we call free on 0
   * with does nothing, since us_poll_stop should not really free the poll.
   * HOWEVER, if we then call us_poll_free while still closing the uv-poll, we
   * simply change back the data to point to our structure so that we actually
   * do free it like we should. */
  if (uv_is_closing((uv_handle_t *)p->uv_p)) {
    p->uv_p->data = p;
  } else {
    free(p->uv_p);
    free(p);
  }
}

void us_poll_start(struct us_poll_t *p, struct us_loop_t *loop, int events) {
  if(!p->uv_p) return;
  p->poll_type = us_internal_poll_type(p) |
                 ((events & LIBUS_SOCKET_READABLE) ? POLL_TYPE_POLLING_IN : 0) |
                 ((events & LIBUS_SOCKET_WRITABLE) ? POLL_TYPE_POLLING_OUT : 0);

  uv_poll_init_socket(loop->uv_loop, p->uv_p, p->fd);
  // This unref is okay in the context of Bun's event loop, because sockets have
  // a `Async.KeepAlive` associated with them, which is used instead of the
  // usockets internals. usockets doesnt have a notion of ref-counted handles.
  uv_unref((uv_handle_t *)p->uv_p);
  /* Always ask for UV_DISCONNECT: a peer FIN must fire even when the poll is
   * writable-only at that moment (a half-closed connection whose reads are
   * paused is exactly the state that otherwise hangs; see poll_cb). */
  uv_poll_start(p->uv_p, events | UV_DISCONNECT, poll_cb);
}

int us_poll_start_rc(struct us_poll_t *p, struct us_loop_t *loop, int events) {
  us_poll_start(p, loop, events);
  return 0;
}

void us_poll_change(struct us_poll_t *p, struct us_loop_t *loop, int events) {
  if(!p->uv_p) return;
  if (us_poll_events(p) != events) {
    p->poll_type =
        us_internal_poll_type(p) |
        ((events & LIBUS_SOCKET_READABLE) ? POLL_TYPE_POLLING_IN : 0) |
        ((events & LIBUS_SOCKET_WRITABLE) ? POLL_TYPE_POLLING_OUT : 0);
    uv_poll_start(p->uv_p, events | UV_DISCONNECT, poll_cb);
  }
}

void us_poll_stop(struct us_poll_t *p, struct us_loop_t *loop) {
  if(!p->uv_p) return;
  uv_poll_stop(p->uv_p);

  /* We normally only want to close the poll here, not free it. But if we stop
   * it, then quickly "free" it with us_poll_free, we postpone the actual
   * freeing to close_cb_free_poll whenever it triggers. That's why we set data
   * to null here, so that us_poll_free can reset it if needed */
  p->uv_p->data = 0;
  uv_close((uv_handle_t *)p->uv_p, close_cb_free_poll);
}

int us_poll_events(struct us_poll_t *p) {
  return ((p->poll_type & POLL_TYPE_POLLING_IN) ? LIBUS_SOCKET_READABLE : 0) |
         ((p->poll_type & POLL_TYPE_POLLING_OUT) ? LIBUS_SOCKET_WRITABLE : 0);
}

size_t us_internal_accept_poll_event(struct us_poll_t *p) { return 0; }

int us_internal_poll_type(struct us_poll_t *p) { return p->poll_type & POLL_TYPE_KIND_MASK; }

void us_internal_poll_set_type(struct us_poll_t *p, int poll_type) {
  p->poll_type = poll_type | (p->poll_type & POLL_TYPE_POLLING_MASK);
}

LIBUS_SOCKET_DESCRIPTOR us_poll_fd(struct us_poll_t *p) { return p->fd; }

void us_loop_pump(struct us_loop_t *loop) {
  /* Same alive-guard gap as us_loop_run_bun_tick: with zero ref'd handles
   * uv_run skips the loop body entirely - including the zero-timeout IOCP
   * poll - so pending completions (a socket's close event) sit undelivered
   * while the caller spins. This is the tick auto_tick takes when Bun's
   * KeepAlive accounting says nothing is active, which is exactly the
   * teardown state that wedged. Ref the loop-lifetime wakeup async around
   * the iteration so the body always runs; NOWAIT keeps it non-blocking. */
  uv_async_t *wakeup_uv_async =
      (uv_async_t *)((struct us_internal_callback_t *)loop->data.wakeup_async + 1);
  uv_ref((uv_handle_t *)wakeup_uv_async);
  uv_run(loop->uv_loop, UV_RUN_NOWAIT);
  uv_unref((uv_handle_t *)wakeup_uv_async);
}

struct us_loop_t *us_create_loop(void *hint,
                                 void (*wakeup_cb)(struct us_loop_t *loop),
                                 void (*pre_cb)(struct us_loop_t *loop),
                                 void (*post_cb)(struct us_loop_t *loop),
                                 unsigned int ext_size) {
  struct us_loop_t *loop =
      (struct us_loop_t *)calloc(1, sizeof(struct us_loop_t) + ext_size);

  loop->uv_loop = hint ? hint : uv_loop_new();
  loop->is_default = hint != 0;

  loop->uv_pre = malloc(sizeof(uv_prepare_t));
  uv_prepare_init(loop->uv_loop, loop->uv_pre);
  uv_prepare_start(loop->uv_pre, prepare_cb);
  uv_unref((uv_handle_t *)loop->uv_pre);
  loop->uv_pre->data = loop;

  loop->uv_check = malloc(sizeof(uv_check_t));
  uv_check_init(loop->uv_loop, loop->uv_check);
  uv_unref((uv_handle_t *)loop->uv_check);
  uv_check_start(loop->uv_check, check_cb);
  loop->uv_check->data = loop;

  // here we create two unreffed handles - timer and async
  us_internal_loop_data_init(loop, wakeup_cb, pre_cb, post_cb);

  // if we do not own this loop, we need to integrate and set up timer
  if (hint) {
    us_loop_integrate(loop);
  }

  return loop;
}

// based on if this was default loop or not
void us_loop_free(struct us_loop_t *loop) {
  // ref and close down prepare and check
  uv_ref((uv_handle_t *)loop->uv_pre);
  uv_prepare_stop(loop->uv_pre);
  loop->uv_pre->data = loop->uv_pre;
  uv_close((uv_handle_t *)loop->uv_pre, close_cb_free);

  uv_ref((uv_handle_t *)loop->uv_check);
  uv_check_stop(loop->uv_check);
  loop->uv_check->data = loop->uv_check;
  uv_close((uv_handle_t *)loop->uv_check, close_cb_free);

  us_internal_loop_data_free(loop);

  if (loop->uv_tick_timer) {
    uv_ref((uv_handle_t *)loop->uv_tick_timer);
    uv_timer_stop(loop->uv_tick_timer);
    loop->uv_tick_timer->data = loop->uv_tick_timer;
    uv_close((uv_handle_t *)loop->uv_tick_timer, close_cb_free);
    loop->uv_tick_timer = 0;
  }

  // we need to run the loop one last round to call all close callbacks
  // we cannot do this if we do not own the loop, default
  if (!loop->is_default) {
    uv_run(loop->uv_loop, UV_RUN_NOWAIT);
    uv_loop_delete(loop->uv_loop);
  }

  // now we can free our part
  free(loop);
}

void us_loop_run(struct us_loop_t *loop) {
  us_loop_integrate(loop);
  uv_update_time(loop->uv_loop);

  uv_run(loop->uv_loop, UV_RUN_ONCE);
}

static void bun_tick_timer_cb(uv_timer_t *t) {
  /* Wakeup only: the deadline's work (Bun's JS timer heap) is drained by the
   * caller after uv_run returns. */
  (void)t;
}

/* The libuv counterpart of epoll_kqueue.c's us_loop_run_bun_tick: run one
 * loop iteration that ALWAYS polls I/O and runs timers, bounded by the
 * caller's deadline. Two gaps in plain uv_run(UV_RUN_ONCE) that this exists
 * to close:
 * - uv_run's alive-guard skips timers and I/O entirely when the loop has no
 *   ref'd handles. Bun refs nothing here by design (socket liveness is
 *   tracked by Bun-side KeepAlives, and every uSockets poll/async is
 *   uv_unref'd), so a teardown state - an armed unref'd socket poll whose
 *   JS owner awaits its close event - wedged forever: no I/O delivery, no
 *   timer processing, until an unrelated ref'd handle appeared.
 * - the caller's timespec (Bun's next JS-timer deadline) was discarded, so
 *   JS timers only fired when something else woke the loop.
 * Ref the loop-lifetime wakeup async around the iteration so the run body
 * always executes, and arm a scratch timer with the deadline so the wait is
 * bounded. The async's ref is restored before returning, so process-exit
 * semantics (driven by Bun's own accounting, not uv's) are unchanged. */
void us_loop_run_bun_tick(struct us_loop_t *loop, const struct timespec *timeout) {
  us_loop_integrate(loop);
  uv_update_time(loop->uv_loop);

  uv_async_t *wakeup_uv_async =
      (uv_async_t *)((struct us_internal_callback_t *)loop->data.wakeup_async + 1);
  uv_ref((uv_handle_t *)wakeup_uv_async);

  if (timeout) {
    if (!loop->uv_tick_timer) {
      loop->uv_tick_timer = malloc(sizeof(uv_timer_t));
      uv_timer_init(loop->uv_loop, loop->uv_tick_timer);
      uv_unref((uv_handle_t *)loop->uv_tick_timer);
    }
    uint64_t ms = (uint64_t)timeout->tv_sec * 1000 + (uint64_t)timeout->tv_nsec / 1000000;
    uv_timer_start(loop->uv_tick_timer, bun_tick_timer_cb, ms, 0);
  } else if (loop->uv_tick_timer) {
    uv_timer_stop(loop->uv_tick_timer);
  }

  uv_run(loop->uv_loop, UV_RUN_ONCE);

  if (loop->uv_tick_timer) {
    uv_timer_stop(loop->uv_tick_timer);
  }
  uv_unref((uv_handle_t *)wakeup_uv_async);
}

struct us_poll_t *us_create_poll(struct us_loop_t *loop, int fallthrough,
                                 unsigned int ext_size) {
  struct us_poll_t *p =
      (struct us_poll_t *)malloc(sizeof(struct us_poll_t) + ext_size);
  p->uv_p = malloc(sizeof(uv_poll_t));
  p->uv_p->data = p;
  return p;
}

/* If we update our block position we have to update the uv_poll data to point
 * to us */
struct us_poll_t *us_poll_resize(struct us_poll_t *p, struct us_loop_t *loop,
                                 unsigned int old_ext_size, unsigned int ext_size) {

  // cannot resize if we dont own uv_poll_t
  if(!p->uv_p) return p;

  unsigned int old_size = sizeof(struct us_poll_t) + old_ext_size;
  unsigned int new_size = sizeof(struct us_poll_t) + ext_size;
  if(new_size <= old_size) return p;

  struct us_poll_t *new_p = calloc(1, new_size);
  memcpy(new_p, p, old_size);

  new_p->uv_p->data = new_p;
  p->uv_p = NULL;

  return new_p;
}

// timer
struct us_timer_t *us_create_timer(struct us_loop_t *loop, int fallthrough,
                                   unsigned int ext_size) {
  struct us_internal_callback_t *cb = us_calloc(
      1, sizeof(struct us_internal_callback_t) + sizeof(uv_timer_t) + ext_size);

  cb->loop = loop;
  cb->cb_expects_the_loop = 0; // never read?
  cb->leave_poll_ready = 0;    // never read?

  uv_timer_t *uv_timer = (uv_timer_t *)(cb + 1);
  uv_timer_init(loop->uv_loop, uv_timer);
  uv_timer->data = cb;

  if (fallthrough) {
    uv_unref((uv_handle_t *)uv_timer);
  }

  return (struct us_timer_t *)cb;
}

void *us_timer_ext(struct us_timer_t *timer) {
  return ((char *)timer) + sizeof(struct us_internal_callback_t) +
         sizeof(uv_timer_t);
}

void us_timer_close(struct us_timer_t *t, int fallthrough) {
  struct us_internal_callback_t *cb = (struct us_internal_callback_t *)t;

  uv_timer_t *uv_timer = (uv_timer_t *)(cb + 1);

  // always ref the timer before closing it
  uv_ref((uv_handle_t *)uv_timer);

  uv_timer_stop(uv_timer);

  uv_timer->data = cb;
  uv_close((uv_handle_t *)uv_timer, close_cb_free);
}

void us_timer_set(struct us_timer_t *t, void (*cb)(struct us_timer_t *t),
                  int ms, int repeat_ms) {
  struct us_internal_callback_t *internal_cb =
      (struct us_internal_callback_t *)t;

  // Match the epoll_kqueue backend: re-arming is allowed (uv_timer_start
  // restarts an already-running timer). The one-shot guard only applies to
  // the sweep timer, which is set with the same args from every new socket
  // context — restarting it would skew the 4s tick.
  if (internal_cb->loop->data.sweep_timer == t) {
    if (internal_cb->has_added_timer_to_event_loop) {
      return;
    }
    internal_cb->has_added_timer_to_event_loop = 1;
  }

  internal_cb->cb = (void (*)(struct us_internal_callback_t *))cb;

  uv_timer_t *uv_timer = (uv_timer_t *)(internal_cb + 1);
  if (!ms) {
    uv_timer_stop(uv_timer);
  } else {
    uv_timer_start(uv_timer, timer_cb, ms, repeat_ms);
  }
}

struct us_loop_t *us_timer_loop(struct us_timer_t *t) {
  struct us_internal_callback_t *internal_cb =
      (struct us_internal_callback_t *)t;

  return internal_cb->loop;
}

// async (internal only)
struct us_internal_async *us_internal_create_async(struct us_loop_t *loop,
                                                   int fallthrough,
                                                   unsigned int ext_size) {
  struct us_internal_callback_t *cb = us_calloc(
      1, sizeof(struct us_internal_callback_t) + sizeof(uv_async_t) + ext_size);

  cb->loop = loop;
  return (struct us_internal_async *)cb;
}

void us_internal_async_close(struct us_internal_async *a) {
  struct us_internal_callback_t *cb = (struct us_internal_callback_t *)a;

  uv_async_t *uv_async = (uv_async_t *)(cb + 1);

  // always ref the async before closing it
  uv_ref((uv_handle_t *)uv_async);

  uv_async->data = cb;
  uv_close((uv_handle_t *)uv_async, close_cb_free);
}

void us_internal_async_set(struct us_internal_async *a,
                           void (*cb)(struct us_internal_async *)) {
  struct us_internal_callback_t *internal_cb =
      (struct us_internal_callback_t *)a;

  internal_cb->cb = (void (*)(struct us_internal_callback_t *))cb;

  uv_async_t *uv_async = (uv_async_t *)(internal_cb + 1);
  uv_async_init(internal_cb->loop->uv_loop, uv_async, async_cb);
  uv_unref((uv_handle_t *)uv_async);
  uv_async->data = internal_cb;
}

void us_internal_async_wakeup(struct us_internal_async *a) {
  struct us_internal_callback_t *internal_cb =
      (struct us_internal_callback_t *)a;

  uv_async_t *uv_async = (uv_async_t *)(internal_cb + 1);
  uv_async_send(uv_async);
}

int us_socket_get_error(struct us_socket_t *s) {
  int error = 0;
  socklen_t len = sizeof(error);
  if (getsockopt(us_poll_fd((struct us_poll_t *)s), SOL_SOCKET, SO_ERROR,
                 (char *)&error, &len) == -1) {
    return errno;
  }
  return error;
}

#endif