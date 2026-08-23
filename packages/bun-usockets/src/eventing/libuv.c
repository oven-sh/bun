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
#include "internal/fault_inject.h"
#include "libusockets.h"
#include <stdlib.h>

#ifdef LIBUS_USE_LIBUV

/* Windows does not reliably latch a received RST in SO_ERROR (POSIX does);
 * the reset surfaces on the next I/O. A zero-byte send observes it without
 * touching the stream: 0 on a healthy socket, SOCKET_ERROR with a fatal
 * code once the connection died hard. */
int us_internal_libuv_peer_reset_probe(LIBUS_SOCKET_DESCRIPTOR fd) {
  /* Raw winsock send: this file only builds on the libuv (Windows) path and
   * bsd_send's Windows signature has no flags parameter. */
  if (send(fd, "", 0, 0) != SOCKET_ERROR) {
    return 0;
  }
  int err = WSAGetLastError();
  /* WSAESHUTDOWN means our own shutdown(SD_SEND) ran; that is not a peer
   * reset (us_socket_stalled_write_means_peer_gone can ask after one). */
  return err != WSAEWOULDBLOCK && err != WSAESHUTDOWN;
}

/* The shared dispatch follows socket adoption (a tunneled/upgraded socket
 * moves; the old allocation stays readable with flags.adopted set and prev
 * pointing at the live one) and skips closed sockets. poll_cb's probes must
 * honor the same contract - dereferencing the raw poll cast crashed the
 * CONNECT-tunnel tests on the aarch64 agent. */
static struct us_socket_t *us_internal_poll_cb_adopted_socket(struct us_poll_t *wp) {
  return us_internal_socket_follow_adopted((struct us_socket_t *)wp);
}

static void close_cb_free_poll(uv_handle_t *h);

/* uv_poll_t->data always points to the us_poll_t (us_poll_resize moves it to
 * the replacement block). libuv delivers no poll_cb once us_poll_stop has
 * disarmed the handle, and nothing re-arms a stopped poll. */
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
  int error = status < 0 && status != UV_EOF;
  if (events & (UV_DISCONNECT | UV_PRIORITIZED)) {
    struct us_poll_t *wp = (struct us_poll_t *)p->data;
    uv_poll_start(p, us_poll_events(wp), poll_cb);
    int kind = us_internal_poll_type(wp) & POLL_TYPE_KIND_MASK;
    /* For a socket whose write side we already shut down, AFD delivers no
     * readable event for the peer's FIN at all - the exact half-closed state
     * that hung server.close() - and with our writes closed there is no
     * data-bearing flow left that an early EOF could truncate. Only there is
     * DISCONNECT mapped to the eof hint (like kqueue's EV_EOF); every other
     * socket keeps recv()-owned EOF discovery so mid-stream transfers are
     * never cut at an EAGAIN. */
    if (kind == POLL_TYPE_SOCKET_SHUT_DOWN) {
      eof = 1;
      /* A paused socket keeps the hint only; the dispatcher leaves it for
       * resume(), whose poll change re-arms DISCONNECT and lands here again. */
      events |= us_poll_events(wp) & LIBUS_SOCKET_READABLE;
    } else if (kind == POLL_TYPE_SOCKET &&
               !(us_poll_events(wp) & LIBUS_SOCKET_READABLE)) {
      /* A data socket that is not reading: paused, or half-open with its end
       * already delivered (the EOF path moved its poll to WRITABLE-only, and
       * us_poll_change re-adds UV_DISCONNECT unconditionally, so AFD keeps
       * reporting the FIN's level-triggered DISCONNECT). Re-adding READABLE
       * here would pull bytes a paused caller asked to defer, or rediscover
       * the same EOF and busy-loop on_end; keeping DISCONNECT armed would
       * complete instantly forever. A dead peer surfaces via SO_ERROR or the
       * zero-byte send probe and goes through the shared error path (which
       * reads off whatever is still queued and closes); a FIN, fresh on a
       * paused socket or re-reported on a half-open one, quiesces with only
       * the ABORT-only subscription (UV_PRIORITIZED) kept armed so a later
       * RST still has an event to ride, and a paused socket meets the FIN
       * again through recv() once resume() re-arms READABLE. Non-SOCKET kinds
       * keep the unconditional READABLE below: SEMI_SOCKET checks error/eof
       * (set from status) and listen polls READABLE only. */
      struct us_socket_t *sock = us_internal_poll_cb_adopted_socket(wp);
      /* A reported UV_PRIORITIZED is AFD's own ABORT signal and needs no
       * probe; the probe covers a reset that arrives while PRIORITIZED was
       * not yet subscribed (reported as plain DISCONNECT, same as the FIN
       * re-report) and a reset AFD has latched but only SO_ERROR shows. */
      if (!sock->flags.is_closed &&
          ((events & UV_PRIORITIZED) ||
           us_socket_get_error(sock) != 0 ||
           us_internal_libuv_peer_reset_probe(us_poll_fd(wp)))) {
        error = 1;
      } else {
        uv_poll_start(p, us_poll_events(wp) | UV_PRIORITIZED, poll_cb);
      }
    } else {
      events |= UV_READABLE;
    }
  }
  if (!error && !eof && !(events & (UV_READABLE | UV_WRITABLE))) {
    return;
  }
  struct us_poll_t *wp = (struct us_poll_t *)p->data;
  wp->poll_cb_depth++;
  us_internal_dispatch_ready_poll(wp, error, eof, events);
  /* The dispatch may have relocated the poll (us_poll_resize); the counter
   * was copied along, so finish on the block the handle points to now. */
  wp = (struct us_poll_t *)p->data;
  /* uv_run is not reentrant, and a handler that waits for a promise runs it
   * anyway. If such an inner run had closed this handle, it would also have
   * run the handle's endgame while libuv's outer uv__fast_poll_process_poll_req
   * frame (the caller of this function) was still using the handle; that
   * frame then queues the endgame a second time. So us_poll_stop only disarms
   * the handle while a poll_cb frame is on the stack, and the outermost frame
   * closes it here, on its way back into libuv: a close from inside the
   * callback is what libuv supports, and the endgame runs in the outer run.
   * The socket itself is closed after the handle, as on the direct path in
   * us_poll_stop (see close_fd). */
  if (--wp->poll_cb_depth == 0 && wp->stopped) {
    uv_close((uv_handle_t *)p, close_cb_free_poll);
    if (wp->close_fd) {
      bsd_close_socket(wp->fd);
    }
  }
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
static void close_cb_free(uv_handle_t *h) { us_free(h->data); }

/* Polls have two blocks; whichever of us_poll_free and this callback runs
 * second frees both (see us_poll_t). This one usually runs second: uv_close
 * cancels the in-flight AFD request, us_poll_free runs from loop_post in the
 * same iteration, and the cancellation is processed on a later one. It runs
 * first for a socket closed during a nested tick (a handler that waits for a
 * promise): the inner run completes the close, but loop_post leaves the closed
 * list alone until the outermost tick (tick_depth), since the outer dispatch
 * may still hold sockets on it. */
static void close_cb_free_poll(uv_handle_t *h) {
  struct us_poll_t *p = h->data;
  if (p->released) {
    us_free(h);
    us_free(p);
  } else {
    p->uv_closed = 1;
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
  uv_poll_t *h = p->uv_p;
  /* us_poll_resize moved the handle to the replacement block, or
   * us_poll_start_rc already freed it. */
  if (!h) {
    us_free(p);
    return;
  }
  /* Never started (us_create_poll zeroes the handle): libuv has not seen it.
   * Closed: libuv is done with it and close_cb_free_poll left it to us. */
  if (h->type != UV_POLL || p->uv_closed) {
    us_free(h);
    us_free(p);
    return;
  }
  /* Stopped, or still polling if the caller skipped us_poll_stop: an AFD
   * request that completes into h may still be in flight, so h has to live
   * until close_cb_free_poll, which now frees both blocks. */
  us_poll_stop(p, loop);
  p->released = 1;
}

/* One-way: on this backend a stopped poll is a closed (or closing) handle and
 * cannot be started again. The blocks are freed later, see close_cb_free_poll.
 * Callers close the socket afterwards through us_internal_poll_close_fd, which
 * keeps it open for as long as the uv_close below is deferred. */
void us_poll_stop(struct us_poll_t *p, struct us_loop_t *loop) {
  uv_poll_t *h = p->uv_p;
  if (!h || p->stopped) return;
  p->stopped = 1;
  /* Never registered: libuv has not seen the handle, so there is nothing to
   * close. The flag still keeps the poll from being started later. */
  if (h->type != UV_POLL) return;
  /* Disarm first: a completion this or an inner run has already dequeued must
   * not reach poll_cb for a socket that is now on the closed list. */
  uv_poll_stop(h);
  /* Inside this poll's own callback the outermost poll_cb frame closes the
   * handle instead (see poll_cb). */
  if (p->poll_cb_depth == 0) {
    uv_close((uv_handle_t *)h, close_cb_free_poll);
  }
}

void us_internal_poll_close_fd(struct us_poll_t *p) {
  /* The uv_close is still pending on the outermost poll_cb frame; it has to
   * see the socket open (see close_fd in us_poll_t), so the frame closes both. */
  if (p->stopped && p->poll_cb_depth > 0) {
    p->close_fd = 1;
    return;
  }
  bsd_close_socket(p->fd);
}

int us_poll_start_rc(struct us_poll_t *p, struct us_loop_t *loop, int events) {
  uv_poll_t *h = p->uv_p;
  if (!h) return 0;
  p->poll_type = us_internal_poll_type(p) |
                 ((events & LIBUS_SOCKET_READABLE) ? POLL_TYPE_POLLING_IN : 0) |
                 ((events & LIBUS_SOCKET_WRITABLE) ? POLL_TYPE_POLLING_OUT : 0);

  /* A stopped poll cannot be started again (see us_poll_stop). */
  if (p->stopped) {
    errno = -UV_EBADF;
    return UV_EBADF;
  }
  if (h->type == UV_POLL) {
    /* Already registered. Initializing it again would wipe the in-flight AFD
     * requests and the loop's list links out from under libuv, and the next
     * completion would land in a handle libuv no longer tracks. A live poll
     * only changes its mask. */
    uv_poll_start(h, events | UV_DISCONNECT, poll_cb);
    return 0;
  }

  int rc;
#if defined(LIBUS_SOCKET_FAULT_INJECTION) && LIBUS_SOCKET_FAULT_INJECTION
  ssize_t injected = 0;
  int unused = 0;
  if (US_FAULT_CHECK(US_FAULT_POLL_START, p->fd, injected, unused)) {
    rc = (int) injected;
  } else
#endif
  rc = uv_poll_init_socket(loop->uv_loop, h, p->fd);
  if (rc < 0) {
    int saved = LIBUS_ERR;
    /* uv_poll_init_socket (win/poll.c) fails either before uv__handle_init
     * (ioctlsocket FIONBIO) or after it (getsockopt SO_PROTOCOL_INFOW). After
     * it, the handle is in loop->handle_queue: close it through libuv so it is
     * unlinked, and the caller's us_poll_free hands it to close_cb_free_poll.
     * (uv__poll_close reads submitted_events_*, which init did not reach; they
     * are 0 from us_create_poll.) Before it, the block is still only ours. */
    if (h->type == UV_POLL) {
      us_poll_stop(p, loop);
    } else {
      us_free(h);
      p->uv_p = NULL;
    }
    errno = saved ? saved : -rc;
    return rc;
  }
  // This unref is okay in the context of Bun's event loop, because sockets have
  // a `Async.KeepAlive` associated with them, which is used instead of the
  // usockets internals. usockets doesnt have a notion of ref-counted handles.
  uv_unref((uv_handle_t *)h);
  /* Always ask for UV_DISCONNECT: a peer FIN must fire even when the poll is
   * writable-only at that moment (a half-closed connection whose reads are
   * paused is exactly the state that otherwise hangs; see poll_cb). */
  uv_poll_start(h, events | UV_DISCONNECT, poll_cb);
  return 0;
}

void us_poll_start(struct us_poll_t *p, struct us_loop_t *loop, int events) {
  us_poll_start_rc(p, loop, events);
}

int us_poll_change(struct us_poll_t *p, struct us_loop_t *loop, int events) {
  uv_poll_t *h = p->uv_p;
  /* A stopped poll belongs to a socket on the closed list; re-arming it would
   * deliver a poll_cb for that socket. */
  if (!h || p->stopped) return 0;
  if (us_poll_events(p) != events) {
    p->poll_type =
        us_internal_poll_type(p) |
        ((events & LIBUS_SOCKET_READABLE) ? POLL_TYPE_POLLING_IN : 0) |
        ((events & LIBUS_SOCKET_WRITABLE) ? POLL_TYPE_POLLING_OUT : 0);
    /* The poll stays initialized across changes here (the dispatcher never
     * parks a libuv poll), so this cannot hit the registration failure the
     * epoll re-add can; uv_poll_start on a live poll only rejects bad args. */
    uv_poll_start(h, events | UV_DISCONNECT, poll_cb);
  }
  return 0;
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
  /* POSIX parity: us_loop_run_bun_tick polls epoll/kqueue and dispatches
   * regardless of ref state (it only early-outs on num_polls == 0). libuv's
   * uv_run() skips its body when uv__loop_alive() is 0, so IOCP completions
   * for unref'd handles (subprocess exit packets, socket events) and due
   * timers are never processed. Bun's outer drive loops (wait_for_promise,
   * bun:test) supply their own keep-going predicate, so force exactly one
   * non-blocking iteration; UV_RUN_NOWAIT keeps the poll timeout at 0. */
  loop->data.tick_depth++;
  loop->uv_loop->active_handles++;
  uv_run(loop->uv_loop, UV_RUN_NOWAIT);
  loop->uv_loop->active_handles--;
  loop->data.tick_depth--;
}

struct us_loop_t *us_create_loop(void *hint,
                                 void (*wakeup_cb)(struct us_loop_t *loop),
                                 void (*pre_cb)(struct us_loop_t *loop),
                                 void (*post_cb)(struct us_loop_t *loop),
                                 unsigned int ext_size) {
  struct us_loop_t *loop =
      (struct us_loop_t *)us_calloc(1, sizeof(struct us_loop_t) + ext_size);

  loop->uv_loop = hint ? hint : uv_loop_new();
  loop->is_default = hint != 0;

  loop->uv_pre = us_malloc(sizeof(uv_prepare_t));
  uv_prepare_init(loop->uv_loop, loop->uv_pre);
  uv_prepare_start(loop->uv_pre, prepare_cb);
  uv_unref((uv_handle_t *)loop->uv_pre);
  loop->uv_pre->data = loop;

  loop->uv_check = us_malloc(sizeof(uv_check_t));
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
  us_free(loop);
}

extern void Bun__JSC_onBeforeWait(void *jsc_vm, uint64_t now_ns);

void us_loop_run(struct us_loop_t *loop) {
  us_loop_integrate(loop);
  uv_update_time(loop->uv_loop);

  /* UV_RUN_ONCE may block in the poll phase (pending callbacks dispatch
   * first), making this the JS thread's park hook, the counterpart of
   * us_loop_run_bun_tick's. jsc_vm is only set on the JS thread's loop. */
  if (loop->data.jsc_vm) {
    /* uv_update_time() above just refreshed libuv's cached monotonic clock, so
     * uv_now() reads that cache rather than taking the clock again. */
    Bun__JSC_onBeforeWait(loop->data.jsc_vm, (uint64_t) uv_now(loop->uv_loop) * 1000000ULL);
  }

  /* check_cb -> us_internal_loop_post frees the closed sockets only at depth
   * 1: a poll callback that waits for a promise re-enters here, and the outer
   * dispatch still holds the socket it is dispatching (same as the POSIX
   * backend's us_loop_run_bun_tick). */
  loop->data.tick_depth++;
  uv_run(loop->uv_loop, UV_RUN_ONCE);
  loop->data.tick_depth--;
}

struct us_poll_t *us_create_poll(struct us_loop_t *loop, int fallthrough,
                                 unsigned int ext_size) {
  struct us_poll_t *p =
      (struct us_poll_t *)us_malloc(sizeof(struct us_poll_t) + ext_size);
  /* Zeroed so that ->type tells us_poll_free and us_poll_stop whether
   * us_poll_start_rc ever registered the handle (uv__handle_init sets it). */
  p->uv_p = us_calloc(1, sizeof(uv_poll_t));
  p->uv_p->data = p;
  p->stopped = 0;
  p->close_fd = 0;
  p->uv_closed = 0;
  p->released = 0;
  p->poll_cb_depth = 0;
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

  struct us_poll_t *new_p = us_calloc(1, new_size);
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
    return LIBUS_ERR;
  }
  return error;
}

#endif
