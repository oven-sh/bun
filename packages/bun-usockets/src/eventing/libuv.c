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

#ifdef LIBUS_USE_LIBUV

/* uv_poll_t->data always (except for most times after calling us_poll_stop)
 * points to the us_poll_t */
static void poll_cb(uv_poll_t *p, int status, int events) {
  us_internal_dispatch_ready_poll((struct us_poll_t *)p->data, status < 0 && status != UV_EOF, status == UV_EOF,
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
  /* h->data is the owning us_poll_t (the embedding us_socket_t allocation).
   * us_poll_free arms this; freeing here (after uv_close completes) is the
   * only path — the synchronous-free branch was removed when uv_close moved
   * out of us_poll_stop. */
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
  /* uv_close lives here (not in us_poll_stop) so it runs from check_cb via
   * us_internal_free_closed_sockets — i.e. *outside* poll_cb. us_poll_stop is
   * reachable re-entrantly inside the handle's own poll_cb (connect-WRITABLE →
   * us_internal_socket_after_open → us_poll_change/uv_poll_start(READABLE) →
   * on_open → JS end() → us_internal_socket_close_raw → us_poll_stop), and
   * uv_close-ing a uv_poll_t whose AFD poll request was submitted in the same
   * frame leaves the handle wedged (close_cb never fires; observed as a
   * full-process hang on Windows for `Bun.connect` TLS sockets ended from
   * `open`). Deferring to here keeps every us_poll_stop caller's semantics
   * (they all park on closed_head/closed_udp_head and reach this), just one
   * loop tick later. */
  p->uv_p->data = p;
  if (uv_is_closing((uv_handle_t *)p->uv_p)) {
    /* Shouldn't happen anymore, but tolerate a caller that already closed. */
    return;
  }
  uv_close((uv_handle_t *)p->uv_p, close_cb_free_poll);
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
  uv_poll_start(p->uv_p, events, poll_cb);
}

void us_poll_change(struct us_poll_t *p, struct us_loop_t *loop, int events) {
  if(!p->uv_p) return;
  if (us_poll_events(p) != events) {
    p->poll_type =
        us_internal_poll_type(p) |
        ((events & LIBUS_SOCKET_READABLE) ? POLL_TYPE_POLLING_IN : 0) |
        ((events & LIBUS_SOCKET_WRITABLE) ? POLL_TYPE_POLLING_OUT : 0);
    uv_poll_start(p->uv_p, events, poll_cb);
  }
}

void us_poll_stop(struct us_poll_t *p, struct us_loop_t *loop) {
  if(!p->uv_p) return;
  uv_poll_stop(p->uv_p);
  /* uv_close deferred to us_poll_free — see comment there for why closing
   * here (inside poll_cb) wedged the handle on Windows. */
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
  uv_run(loop->uv_loop, UV_RUN_NOWAIT);
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