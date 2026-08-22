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
#include <stdio.h>
#include <stdlib.h>

#if __has_include("wtf/Platform.h")
#include "wtf/Platform.h"
#elif !defined(ASSERT_ENABLED)
#if defined(BUN_DEBUG) || defined(__SANITIZE_ADDRESS__)
#define ASSERT_ENABLED 1
#elif defined(__has_feature)
#if __has_feature(address_sanitizer)
#define ASSERT_ENABLED 1
#endif
#endif
#ifndef ASSERT_ENABLED
#define ASSERT_ENABLED 0
#endif
#endif

#ifdef LIBUS_USE_LIBUV

/* Drains what Bun-side libuv callbacks (pipes, processes, files, dns, ...)
 * deferred during uv_run; src/libuv_sys/deferred.rs. */
extern void Bun__uv_dispatch_deferred(uv_loop_t *loop);

/* How this backend uses libuv (see also us_loop_t in eventing/libuv.h).
 *
 * uv_run is not re-entrant, and libuv keeps using a handle after the
 * handle's callback returns (uv__fast_poll_process_poll_req re-arms or
 * endgames the poll, uv__process_reqs walks a list it detached before
 * dispatching). Bun's handlers, on the other hand, routinely drive the event
 * loop again before returning (anything that waits for a promise
 * synchronously) and close sockets from inside their own events. So nothing of
 * ours runs inside uv_run: the libuv callbacks below only record which poll,
 * timer or async became ready, and us_loop_run / us_loop_pump dispatch that
 * list after uv_run has returned - the same shape as us_loop_run_bun_tick on
 * epoll/kqueue, with uv_run in the place of epoll_wait. From there a nested
 * us_loop_run is just another sequential uv_run as far as libuv is concerned,
 * a uv_close never races a live libuv frame for the same handle, and events an
 * outer uv_run collected but did not get to yet are dispatched by the nested
 * run instead of being invisible to it.
 *
 * The same rule holds for every other libuv handle and request Bun owns on
 * this loop (pipes, ttys, processes, fs requests, c-ares polls, ...): their
 * callbacks record into loop->deferred (src/libuv_sys/deferred.rs) and
 * Bun__uv_dispatch_deferred runs them right after the ready list, still inside
 * the same tick. in_uv_run guards the invariant: ticking the loop while it is
 * set is a nested uv_run and aborts in assertion-enabled builds. */

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
 * pointing at the live one) and skips closed sockets. The probes in
 * us_internal_dispatch_poll must honor the same contract - dereferencing the raw poll cast crashed the
 * CONNECT-tunnel tests on the aarch64 agent. */
static struct us_socket_t *us_internal_poll_cb_adopted_socket(struct us_poll_t *wp) {
  return us_internal_socket_follow_adopted((struct us_socket_t *)wp);
}

/* ── Ready list ─────────────────────────────────────────────────────────── */

static void us_internal_ready_push(struct us_poll_t *p, int status, int events) {
  if (p->ready) {
    if (!p->ready_status) {
      p->ready_status = status;
    }
    p->ready_events |= events;
    return;
  }
  struct us_loop_t *loop = p->loop;
  p->ready = 1;
  p->ready_status = status;
  p->ready_events = events;
  p->ready_next = NULL;
  p->ready_prev = loop->ready_tail;
  if (loop->ready_tail) {
    loop->ready_tail->ready_next = p;
  } else {
    loop->ready_head = p;
  }
  loop->ready_tail = p;
}

/* Every path that stops, closes, frees or relocates a poll goes through here
 * first, so the dispatch loop never sees a poll that is gone. */
static void us_internal_ready_unlink(struct us_poll_t *p) {
  if (!p->ready) {
    return;
  }
  struct us_loop_t *loop = p->loop;
  if (p->ready_prev) {
    p->ready_prev->ready_next = p->ready_next;
  } else {
    loop->ready_head = p->ready_next;
  }
  if (p->ready_next) {
    p->ready_next->ready_prev = p->ready_prev;
  } else {
    loop->ready_tail = p->ready_prev;
  }
  p->ready = 0;
  p->ready_prev = p->ready_next = NULL;
}

/* us_poll_resize copied *from into *to (including the list links); make the
 * neighbours point at the new block. */
static void us_internal_ready_relocate(struct us_poll_t *from, struct us_poll_t *to) {
  if (!from->ready) {
    return;
  }
  struct us_loop_t *loop = from->loop;
  if (to->ready_prev) {
    to->ready_prev->ready_next = to;
  } else {
    loop->ready_head = to;
  }
  if (to->ready_next) {
    to->ready_next->ready_prev = to;
  } else {
    loop->ready_tail = to;
  }
  from->ready = 0;
  from->ready_prev = from->ready_next = NULL;
}

/* ── libuv callbacks: record only ─────────────────────────────────────────── */

/* uv_poll_t->data always points to the us_poll_t (us_poll_resize moves it to
 * the replacement block); us_poll_stop disarms the handle before letting go of
 * it, and libuv delivers no poll_cb for a disarmed handle. */
static void poll_cb(uv_poll_t *p, int status, int events) {
  us_internal_ready_push((struct us_poll_t *)p->data, status, events);
}

static void timer_cb(uv_timer_t *t) {
  struct us_internal_callback_t *cb = t->data;
  us_internal_ready_push(&cb->p, 0, LIBUS_SOCKET_READABLE);
}

static void async_cb(uv_async_t *a) {
  struct us_internal_callback_t *cb = a->data;
  us_internal_ready_push(&cb->p, 0, LIBUS_SOCKET_READABLE);
}

/* Timers and asyncs: frees the us_internal_callback_t the handle is embedded
 * in (h->data points back at it). */
static void close_cb_free(uv_handle_t *h) { us_free(h->data); }

/* Polls: the uv_poll_t is its own allocation, handed to libuv by us_poll_stop
 * and freed here; the us_poll_t is freed by us_poll_free, in either order. */
static void close_cb_free_handle(uv_handle_t *h) { us_free(h); }

/* ── Dispatch ───────────────────────────────────────────────────────────── */

/* Translate what libuv reported for one poll into the shared dispatcher's
 * (error, eof, events) and run it. Called from us_internal_dispatch_ready_polls
 * only, i.e. never inside uv_run. */
static void us_internal_dispatch_poll(struct us_poll_t *wp, int status, int events) {
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
  /* libuv masked the readable/writable bits against the handle's interest when
   * it collected them; the interest may have changed since (a handler paused
   * the socket before this entry was reached), so mask again the way the
   * epoll dispatcher does against us_poll_events. */
  events &= us_poll_events(wp) | UV_DISCONNECT | UV_PRIORITIZED;
  if (events & (UV_DISCONNECT | UV_PRIORITIZED)) {
    uv_poll_start(wp->uv_p, us_poll_events(wp), poll_cb);
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
        uv_poll_start(wp->uv_p, us_poll_events(wp) | UV_PRIORITIZED, poll_cb);
      }
    } else {
      events |= UV_READABLE;
    }
  }
  if (!error && !eof && !(events & (UV_READABLE | UV_WRITABLE))) {
    return;
  }
  us_internal_dispatch_ready_poll(wp, error, eof, events);
}

/* Counterpart of us_internal_dispatch_ready_polls on epoll/kqueue. Each poll
 * is unlinked before it is dispatched, so a handler may stop, free or re-ready
 * it (or any other poll) and may run this loop again through a nested
 * us_loop_run; when that returns the list is simply re-read from its head. */
static void us_internal_dispatch_ready_polls(struct us_loop_t *loop) {
  struct us_poll_t *p;
  while ((p = loop->ready_head)) {
    int status = p->ready_status;
    int events = p->ready_events;
    us_internal_ready_unlink(p);
    us_internal_dispatch_poll(p, status, events);
  }
}

/* ── Poll ─────────────────────────────────────────────────────────────────── */

void us_poll_init(struct us_poll_t *p, LIBUS_SOCKET_DESCRIPTOR fd,
                  int poll_type) {
  p->poll_type = poll_type;
  p->fd = fd;
}

struct us_poll_t *us_create_poll(struct us_loop_t *loop, int fallthrough,
                                 unsigned int ext_size) {
  struct us_poll_t *p =
      (struct us_poll_t *)us_malloc(sizeof(struct us_poll_t) + ext_size);
  p->uv_p = us_malloc(sizeof(uv_poll_t));
  /* Not a libuv handle until us_poll_start_rc initialises it; us_poll_free
   * tells the two states apart by this. */
  p->uv_p->type = UV_UNKNOWN_HANDLE;
  p->uv_p->data = p;
  p->loop = loop;
  p->ready = 0;
  return p;
}

/* Called from the closed lists in us_internal_loop_post (outermost tick), or
 * straight after a failed us_poll_start_rc. */
void us_poll_free(struct us_poll_t *p, struct us_loop_t *loop) {
  us_internal_ready_unlink(p);
  if (p->uv_p) {
    if (p->uv_p->type == UV_POLL) {
      /* Initialised and still registered (the caller skipped us_poll_stop):
       * only libuv can unlink it from the loop. */
      uv_close((uv_handle_t *)p->uv_p, close_cb_free_handle);
    } else {
      us_free(p->uv_p);
    }
  }
  us_free(p);
}

int us_poll_start_rc(struct us_poll_t *p, struct us_loop_t *loop, int events) {
  if (!p->uv_p) return 0;
  p->poll_type = us_internal_poll_type(p) |
                 ((events & LIBUS_SOCKET_READABLE) ? POLL_TYPE_POLLING_IN : 0) |
                 ((events & LIBUS_SOCKET_WRITABLE) ? POLL_TYPE_POLLING_OUT : 0);

  /* uv_poll_init_socket (win/poll.c) can fail either before uv__handle_init
   * (ioctlsocket FIONBIO) or after it (getsockopt SO_PROTOCOL_INFOW). The
   * latter leaves the handle linked into loop->handle_queue with
   * submitted_events_* still unset. Zero first so, on failure, ->type
   * distinguishes the two states and the fields uv__poll_close reads are 0
   * rather than garbage. */
  memset(p->uv_p, 0, sizeof(uv_poll_t));
  p->uv_p->data = p;

  int rc;
#if defined(LIBUS_SOCKET_FAULT_INJECTION) && LIBUS_SOCKET_FAULT_INJECTION
  ssize_t injected = 0;
  int unused = 0;
  if (US_FAULT_CHECK(US_FAULT_POLL_START, p->fd, injected, unused)) {
    rc = (int) injected;
  } else
#endif
  rc = uv_poll_init_socket(loop->uv_loop, p->uv_p, p->fd);
  if (rc < 0) {
    int saved = LIBUS_ERR;
    if (p->uv_p->type == UV_POLL) {
      /* uv__handle_init ran: the handle is in loop->handle_queue. Close it
       * through libuv so it is unlinked and freed by the close callback. */
      uv_close((uv_handle_t *)p->uv_p, close_cb_free_handle);
    } else {
      /* Never reached uv__handle_init: uv_p is still our raw block. */
      us_free(p->uv_p);
    }
    p->uv_p = NULL;
    errno = saved ? saved : -rc;
    return rc;
  }
  // This unref is okay in the context of Bun's event loop, because sockets have
  // a `Async.KeepAlive` associated with them, which is used instead of the
  // usockets internals. usockets doesnt have a notion of ref-counted handles.
  uv_unref((uv_handle_t *)p->uv_p);
  /* Always ask for UV_DISCONNECT: a peer FIN must fire even when the poll is
   * writable-only at that moment (a half-closed connection whose reads are
   * paused is exactly the state that otherwise hangs; see
   * us_internal_dispatch_poll). */
  uv_poll_start(p->uv_p, events | UV_DISCONNECT, poll_cb);
  return 0;
}

void us_poll_start(struct us_poll_t *p, struct us_loop_t *loop, int events) {
  us_poll_start_rc(p, loop, events);
}

int us_poll_change(struct us_poll_t *p, struct us_loop_t *loop, int events) {
  if (!p->uv_p) return 0;
  if (us_poll_events(p) != events) {
    p->poll_type =
        us_internal_poll_type(p) |
        ((events & LIBUS_SOCKET_READABLE) ? POLL_TYPE_POLLING_IN : 0) |
        ((events & LIBUS_SOCKET_WRITABLE) ? POLL_TYPE_POLLING_OUT : 0);
    /* The poll stays initialized across changes here (the dispatcher never
     * parks a libuv poll), so this cannot hit the registration failure the
     * epoll re-add can; uv_poll_start on a live poll only rejects bad args. */
    uv_poll_start(p->uv_p, events | UV_DISCONNECT, poll_cb);
    /* Events collected but not yet dispatched are filtered against the new
     * mask at dispatch time (us_internal_dispatch_poll), as on epoll. */
  }
  return 0;
}

/* One-way: the handle is disarmed and handed to uv_close, and the poll drops
 * out of the ready list. Callers close the socket right after this returns,
 * which is the order uv__poll_close needs: it cancels the in-flight AFD
 * request with an ioctl on the (still open) socket. Issuing the uv_close here
 * is sound because nothing of ours runs inside uv_run - see the top of this
 * file. */
void us_poll_stop(struct us_poll_t *p, struct us_loop_t *loop) {
  us_internal_ready_unlink(p);
  if (!p->uv_p) return;
  if (p->uv_p->type == UV_POLL) {
    uv_poll_stop(p->uv_p);
    uv_close((uv_handle_t *)p->uv_p, close_cb_free_handle);
  } else {
    /* Never started: libuv has not seen this block. */
    us_free(p->uv_p);
  }
  p->uv_p = NULL;
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
  us_internal_ready_relocate(p, new_p);

  return new_p;
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

/* No pending-events array to patch on this backend: the ready list is
 * intrusive and us_poll_stop / us_poll_resize maintain it directly. */
void us_internal_loop_update_pending_ready_polls(struct us_loop_t *loop,
    struct us_poll_t *old_poll, struct us_poll_t *new_poll, int old_events, int new_events) {}

/* ── Loop ─────────────────────────────────────────────────────────────────── */

struct us_loop_t *us_create_loop(void *hint,
                                 void (*wakeup_cb)(struct us_loop_t *loop),
                                 void (*pre_cb)(struct us_loop_t *loop),
                                 void (*post_cb)(struct us_loop_t *loop),
                                 unsigned int ext_size) {
  struct us_loop_t *loop =
      (struct us_loop_t *)us_calloc(1, sizeof(struct us_loop_t) + ext_size);

  loop->uv_loop = hint ? hint : uv_loop_new();
  loop->is_default = hint != 0;
  if (!hint) {
    /* A thread's own loop comes with its queue (uv::Loop::get); one made here
     * keeps it in us_loop_t. See src/libuv_sys/deferred.rs. */
    loop->deferred[0] = loop->deferred[1] = 0;
    loop->uv_loop->data = loop->deferred;
  }

  loop->deadline_timer = us_malloc(sizeof(uv_timer_t));
  uv_timer_init(loop->uv_loop, loop->deadline_timer);
  uv_unref((uv_handle_t *)loop->deadline_timer);
  loop->deadline_timer->data = loop->deadline_timer;

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
  uv_close((uv_handle_t *)loop->deadline_timer, close_cb_free);

  us_internal_loop_data_free(loop);

  // we need to run the loop one last round to call all close callbacks
  // we cannot do this if we do not own the loop, default
  if (!loop->is_default) {
    uv_run(loop->uv_loop, UV_RUN_NOWAIT);
    Bun__uv_dispatch_deferred(loop->uv_loop);
    uv_loop_delete(loop->uv_loop);
  }

  // now we can free our part
  us_free(loop);
}

extern void Bun__JSC_onBeforeWait(void *jsc_vm, uint64_t now_ns);

static void deadline_timer_cb(uv_timer_t *t) {}

/* One tick: the libuv equivalent of us_loop_run_bun_tick. uv_run only
 * collects (see poll_cb); everything the tick collected is dispatched here,
 * between loop_pre and loop_post, from our own frame. tick_depth tells
 * us_internal_loop_post whether this is the outermost tick, which is the only
 * one that may free the sockets closed during it (a nested tick runs inside a
 * handler whose dispatch still holds its socket).
 *
 * timeout_ms bounds how long a UV_RUN_ONCE tick may park (< 0: no bound); it
 * is what the timespec argument to us_loop_run_bun_tick is on epoll/kqueue.
 * libuv takes its poll timeout from its own timer heap, so the bound is an
 * unref'd timer whose expiry merely ends the poll phase. */
static void us_internal_loop_tick(struct us_loop_t *loop, uv_run_mode mode, long long timeout_ms) {
#if ASSERT_ENABLED
  if (loop->in_uv_run) {
    /* Someone is ticking the loop from inside a libuv callback. That callback
     * has to record and defer instead (ready list / Bun__uv_dispatch_deferred);
     * see the top of this file. */
    fprintf(stderr, "us_loop_run: nested uv_run - a libuv callback is driving the event loop\n");
    fflush(stderr);
    abort();
  }
#endif
  loop->data.tick_depth++;
  us_internal_loop_pre(loop);

  if (mode == UV_RUN_ONCE) {
    uv_update_time(loop->uv_loop);
    /* UV_RUN_ONCE may block in the poll phase, making this the JS thread's
     * park hook, the counterpart of us_loop_run_bun_tick's. jsc_vm is only set
     * on the JS thread's loop. uv_update_time() above just refreshed libuv's
     * cached monotonic clock, so uv_now() reads that cache rather than taking
     * the clock again. */
    if (loop->data.jsc_vm) {
      Bun__JSC_onBeforeWait(loop->data.jsc_vm, (uint64_t) uv_now(loop->uv_loop) * 1000000ULL);
    }
    /* Armed here rather than by the caller: loop_pre above may already have
     * run handlers, and a nested tick from one of them uses this same timer. */
    if (timeout_ms > 0) {
      uv_timer_start(loop->deadline_timer, deadline_timer_cb, (uint64_t) timeout_ms, 0);
    }
  }

  loop->in_uv_run++;
  uv_run(loop->uv_loop, mode);
  loop->in_uv_run--;

  if (mode == UV_RUN_ONCE && timeout_ms > 0) {
    uv_timer_stop(loop->deadline_timer);
  }

  us_internal_dispatch_ready_polls(loop);
  Bun__uv_dispatch_deferred(loop->uv_loop);
  us_internal_loop_post(loop);
  loop->data.tick_depth--;
}

int us_loop_in_uv_run(struct us_loop_t *loop) {
  return loop->in_uv_run;
}

void us_loop_run(struct us_loop_t *loop) {
  us_internal_loop_tick(loop, UV_RUN_ONCE, -1);
}

void us_loop_run_with_timeout(struct us_loop_t *loop, long long timeout_ms) {
  if (timeout_ms == 0) {
    us_loop_pump(loop);
    return;
  }
  us_internal_loop_tick(loop, UV_RUN_ONCE, timeout_ms);
}

void us_loop_pump(struct us_loop_t *loop) {
  /* POSIX parity: us_loop_run_bun_tick polls epoll/kqueue and dispatches
   * regardless of ref state (it only early-outs on num_polls == 0). libuv's
   * uv_run() skips its body when uv__loop_alive() is 0, so IOCP completions
   * for unref'd handles (subprocess exit packets, socket events) and due
   * timers are never processed. Bun's outer drive loops (wait_for_promise,
   * bun:test) supply their own keep-going predicate, so force exactly one
   * non-blocking iteration; UV_RUN_NOWAIT keeps the poll timeout at 0. */
  loop->uv_loop->active_handles++;
  us_internal_loop_tick(loop, UV_RUN_NOWAIT, 0);
  loop->uv_loop->active_handles--;
}

/* ── Timer ────────────────────────────────────────────────────────────────── */

/* Timers and asyncs are us_internal_callback_t blocks with the libuv handle
 * placed after them. Their embedded us_poll_t is what goes on the ready list
 * (as a readable event on a POLL_TYPE_CALLBACK poll, like the eventfd/timerfd
 * polls on epoll), which routes it to cb->cb in the shared dispatcher. */
struct us_timer_t *us_create_timer(struct us_loop_t *loop, int fallthrough,
                                   unsigned int ext_size) {
  struct us_internal_callback_t *cb = us_calloc(
      1, sizeof(struct us_internal_callback_t) + sizeof(uv_timer_t) + ext_size);

  cb->loop = loop;
  cb->cb_expects_the_loop = 0;
  cb->leave_poll_ready = 0;
  us_poll_init(&cb->p, LIBUS_SOCKET_ERROR, POLL_TYPE_CALLBACK | POLL_TYPE_POLLING_IN);
  cb->p.loop = loop;

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

  us_internal_ready_unlink(&cb->p);

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
    /* A stopped timer must not fire a callback that is already collected. */
    us_internal_ready_unlink(&internal_cb->p);
  } else {
    uv_timer_start(uv_timer, timer_cb, ms, repeat_ms);
  }
}

struct us_loop_t *us_timer_loop(struct us_timer_t *t) {
  struct us_internal_callback_t *internal_cb =
      (struct us_internal_callback_t *)t;

  return internal_cb->loop;
}

/* ── Async (internal only: the loop's wakeup) ─────────────────────────────── */

struct us_internal_async *us_internal_create_async(struct us_loop_t *loop,
                                                   int fallthrough,
                                                   unsigned int ext_size) {
  struct us_internal_callback_t *cb = us_calloc(
      1, sizeof(struct us_internal_callback_t) + sizeof(uv_async_t) + ext_size);

  cb->loop = loop;
  /* The wakeup callback takes the loop, not the async (see loop.c). */
  cb->cb_expects_the_loop = 1;
  cb->leave_poll_ready = 0;
  us_poll_init(&cb->p, LIBUS_SOCKET_ERROR, POLL_TYPE_CALLBACK | POLL_TYPE_POLLING_IN);
  cb->p.loop = loop;
  return (struct us_internal_async *)cb;
}

void us_internal_async_close(struct us_internal_async *a) {
  struct us_internal_callback_t *cb = (struct us_internal_callback_t *)a;

  uv_async_t *uv_async = (uv_async_t *)(cb + 1);

  us_internal_ready_unlink(&cb->p);

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
