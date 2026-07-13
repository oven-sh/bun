# bun_usockets core semantics (non-TLS)

This document specifies the behavioral contract of the non-TLS core of the
`bun_usockets` crate (`src/usockets`), which preserves the semantics of the C
implementation it replaced. Source of truth for the contract: the replaced C
sources `packages/bun-usockets/src/{loop.c, socket.c, context.c, bsd.c,
udp.c, fault_inject.c}`, `src/internal/{internal.h, loop_data.h,
eventing/epoll_kqueue.h, eventing/libuv.h, networking/bsd.h}`,
`src/eventing/{epoll_kqueue.c, libuv.c}`, `src/libusockets.h`.
All citations are `file:line` in `packages/bun-usockets/src/` unless prefixed.

This fork has diverged heavily from upstream uSockets. There is **no
`us_socket_context_t`**: its replacement is `us_socket_group_t` (embedded in the
owner, lazily linked to the loop) plus per-socket `kind` dispatch through the
`us_dispatch_*` dispatch tables (now `src/usockets/dispatch.rs`).
TLS is per-socket (`s->ssl != NULL`), not per-context. This document covers the
non-TLS core; every `us_internal_ssl_*` symbol is an extern boundary into
`crypto/openssl.c` and out of scope here, but the exact call sites and gating
conditions where the core routes into it ARE in scope and specified.

Terminology: R = `LIBUS_SOCKET_READABLE`, W = `LIBUS_SOCKET_WRITABLE`. On epoll
these are literally `EPOLLIN`/`EPOLLOUT` (epoll_kqueue.h:26-27); on kqueue they
are a private bitfield 1/2 translated per call (epoll_kqueue.h:32-33); on libuv
they are `UV_READABLE`/`UV_WRITABLE` (libuv.h:24-25).

Constants (libusockets.h:58-82):

- `LIBUS_RECV_BUFFER_LENGTH` = 524288 (512 KiB)
- `LIBUS_RECV_BUFFER_PADDING` = 32 (both ends of recv_buf)
- `LIBUS_SEND_BUFFER_LENGTH` = 16384 (UDP send metadata only)
- `LIBUS_TIMEOUT_GRANULARITY` = 4 (seconds)
- `LIBUS_EXT_ALIGNMENT` = 16
- Close codes: 0 = CLEAN_SHUTDOWN, 1 = CONNECTION_RESET, 2 = FAST_SHUTDOWN
- `LIBUS_MAX_READY_POLLS` = 1024 (internal.h:45)
- `LIBUS_UDP_MAX_SIZE` = 65536; `LIBUS_UDP_RECV_COUNT` = 8 POSIX / 1 Windows
  (networking/bsd.h:49,59-65)

---

## 1. LOOP TICK

### 1.1 Data structures

- **R1.1** `us_loop_t` (epoll/kqueue, epoll_kqueue.h:79-107) MUST have, in
  order: `data` (us_internal_loop_data_t, 16-aligned), `num_polls` (int),
  `num_ready_polls` (int), `current_ready_poll` (int), `fd` (int), `bun_polls`
  (unsigned int), `pending_wakeups` (unsigned int), then a 16-aligned
  `ready_polls[1024]` array of `epoll_event` (epoll) or `kevent64_s` (kqueue).
  Rust code (`src/uws_sys/Loop.rs:42,73-76`) statically asserts
  `pending_wakeups` is at `offset_of(num_polls)+20` and `ready_polls` at
  `(offset_of(pending_wakeups)+4).next_multiple_of(16)`. Layout is ABI.
- **R1.2** `us_internal_loop_data_t` (loop_data.h:38-90) layout is mirrored in
  `src/uws_sys/InternalLoopData.rs` — any change MUST update both. Fields of
  behavioral relevance: `sweep_next_tick_ns` (POSIX; absolute CLOCK_MONOTONIC ns
  of next sweep, or −1 = disarmed) / `sweep_timer` (libuv), `sweep_timer_count`
  (refcount), `wakeup_async`, `head` (group list), `quic_head`,
  `quic_next_tick_us`, `iterator` (group sweep cursor), `recv_buf`, `send_buf`,
  `ssl_data`, `pre_cb`, `post_cb`, `closed_udp_head`, `closed_head`,
  `low_prio_head`, `low_prio_budget`, `dns_ready_head`,
  `closed_connecting_head`, `mutex` (zig_mutex_t), `parent_ptr`, `parent_tag`,
  `iteration_nr`, `jsc_vm`, `tick_depth`.
- **R1.3** `us_create_loop` (epoll_kqueue.c:157-181) MUST `us_calloc` the loop
  (+ext_size), zero `num_polls`/`num_ready_polls`/`current_ready_poll`/
  `bun_polls`, create the backend fd (`epoll_create1(EPOLL_CLOEXEC)` /
  `kqueue()`), probe epoll_pwait2 support once via
  `Bun__isEpollPwait2SupportedOnLinuxKernel()` (epoll_kqueue.c:169-173), then
  `us_internal_loop_data_init`.
- **R1.4** `us_internal_loop_data_init` (loop.c:120-143) MUST: set
  `sweep_next_tick_ns = -1` (POSIX) or create the sweep `us_timer_t` (libuv);
  zero `sweep_timer_count`; malloc `recv_buf` of `LIBUS_RECV_BUFFER_LENGTH + 2*
LIBUS_RECV_BUFFER_PADDING` and `send_buf` of `LIBUS_SEND_BUFFER_LENGTH`,
  calling `Bun__outOfMemory()` if either is NULL (loop.c:133); store
  pre/post callbacks; create the wakeup async with `fallthrough=1, ext=0` and
  set its callback to `wakeup_cb` (loop.c:136-137). Under ASSERT_ENABLED it
  MUST panic if `Bun__lock__size != sizeof(loop->data.mutex)` (loop.c:138-142).
- **R1.5** `us_loop_free` (epoll_kqueue.c:56-60) = `us_internal_loop_data_free`
  then `close(loop->fd)` then `us_free(loop)`. `us_internal_loop_data_free`
  (loop.c:145-158) frees SSL loop data, `recv_buf`, `send_buf`, closes the
  sweep/quic timers (libuv only), closes the wakeup async.
- **R1.6** `us_loop_integrate` is a no-op (loop.c:920-922). The sweep is
  enabled dynamically by socket count (see §5).
- **R1.7** `us_loop_ext(loop)` = `loop + 1` (loop.c:924-926).
  `us_loop_iteration_number(loop)` = `loop->data.iteration_nr` (loop.c:391-393).

### 1.2 Plain run path — `us_loop_run` (epoll_kqueue.c:328-355)

- **R1.8** `us_loop_run` loops `while (loop->num_polls)`. Per iteration, in this
  exact order:
  1. `loop->data.tick_depth++`
  2. `us_internal_loop_pre(loop)` (see R1.13)
  3. compute timeout: start from NULL (block forever) and clamp to the sweep
     deadline via `us_internal_clamp_to_sweep` (R1.16)
  4. blocking poll: `bun_epoll_pwait2(fd, ready_polls, 1024, timeout)` on
     epoll; `kevent64(fd, NULL, 0, ready_polls, 1024, 0, timeout)` retried on
     EINTR on kqueue → `num_ready_polls`
  5. `us_internal_dispatch_ready_polls(loop)` (R1.18)
  6. `us_internal_drain_ready_polls(loop)` (R1.20)
  7. `us_internal_sweep_if_due(loop)` (R5.8)
  8. `us_internal_loop_post(loop)` (R1.14)
  9. `loop->data.tick_depth--`
- **R1.9** `bun_epoll_pwait2` (epoll_kqueue.c:123-150): if `has_epoll_pwait2 !=
0`, call raw syscall `sys_epoll_pwait2` (SYS 441; supplied by Bun's Rust
  platform layer) with an empty sigmask, retrying while return == `-EINTR`. If
  it returns any of `-ENOSYS/-EPERM/-EOPNOTSUPP/-EACCES/-EFAULT`, latch
  `has_epoll_pwait2 = 0` and fall back forever to `epoll_pwait` with a
  millisecond timeout computed as `tv_sec*1000 + tv_nsec/1e6` (NULL → −1),
  retrying on EINTR. Note: fallback ms conversion truncates (a 999999 ns
  timeout becomes 0 ms).

### 1.3 Bun tick — `us_loop_run_bun_tick(loop, timeout)` (epoll_kqueue.c:359-418)

- **R1.10** Exists only on epoll/kqueue (Windows drives libuv's own loop via
  `us_loop_pump` = `uv_run(UV_RUN_NOWAIT)`, libuv.c:150-152). Exact order:
  1. If `loop->num_polls == 0`, return immediately (before tick_depth++).
  2. `tick_depth++`; `us_internal_loop_pre(loop)`.
  3. QUIC fold: if `quic_head && quic_next_tick_us >= 0`, and (`timeout` is
     NULL or larger than `quic_next_tick_us` µs), replace `timeout` with the
     quic deadline (epoll_kqueue.c:372-381).
  4. Sweep fold: `timeout = us_internal_clamp_to_sweep(loop, timeout, &storage)`
     (epoll_kqueue.c:384).
  5. Wakeup swap: `had_wakeups = atomic_exchange(&loop->pending_wakeups, 0,
ACQUIRE)` (epoll_kqueue.c:386). This pairs with the RELEASE
     `fetch_add` in `us_wakeup_loop` (R10.1).
  6. `will_idle = had_wakeups == 0 && (timeout == NULL || timeout != {0,0})`
     (epoll_kqueue.c:387).
  7. If `will_idle && loop->data.jsc_vm`, call
     `Bun__JSC_onBeforeWait(jsc_vm)` — the GC safepoint. It MUST be skipped
     whenever a cross-thread wakeup is already pending or the poll will not
     block (epoll_kqueue.c:388-389).
  8. Poll: epoll uses `bun_epoll_pwait2` with the timeout as-is (a zero
     timespec is already a kernel fast path — comment epoll_kqueue.c:393-395).
     kqueue uses `kevent64(..., will_idle ? 0 : KEVENT_FLAG_IMMEDIATE,
timeout)` retried on EINTR — the IMMEDIATE flag avoids a ~14 µs XNU
     thread_block round-trip for an already-expired deadline
     (epoll_kqueue.c:398-408).
  9. `us_internal_dispatch_ready_polls`; `us_internal_drain_ready_polls`;
     `us_internal_sweep_if_due`; `us_internal_loop_post`; `tick_depth--`.
- **R1.11** The caller-provided `timeout` is a _relative_ timespec; NULL means
  block indefinitely. The effective timeout is
  `min(caller, quic_next_tick_us, sweep deadline)` in that folding order.
- **R1.12** Reentrancy: `tick_depth` counts nesting of run/tick bodies. A
  nested tick (JS callback re-entering the loop, e.g. `waitForPromise`) MUST
  NOT free closed sockets — see R1.15.

### 1.4 Pre / post

- **R1.13** `us_internal_loop_pre` (loop.c:396-407), exact order:
  1. `loop->data.iteration_nr++`
  2. `us_internal_handle_dns_results(loop)` (R6.10)
  3. `us_internal_handle_low_priority_sockets(loop)` (R1.22)
  4. `loop->data.pre_cb(loop)`
  5. if QUIC compiled and `quic_head`, `us_quic_loop_process(loop)`
- **R1.14** `us_internal_loop_post` (loop.c:409-423), exact order:
  1. `us_internal_handle_dns_results(loop)` (again — results that landed
     during dispatch)
  2. QUIC process (if any)
  3. **only if `tick_depth <= 1`**: `us_internal_free_closed_sockets(loop)`
  4. `loop->data.post_cb(loop)`
- **R1.15** `us_internal_free_closed_sockets` (loop.c:360-383) frees, in
  order: every socket on `closed_head` (zeroing prev/next, then
  `us_poll_free`), every UDP socket on `closed_udp_head` (`us_poll_free`),
  every `us_connecting_socket_t` on `closed_connecting_head` (`us_free`).
  All three heads are then NULL. This is the ONLY place closed
  socket/udp/connecting memory is released (drain point). A nested tick defers
  it to the outermost tick's loop_post (loop.c:414-421) because the outer
  dispatch may still hold a pointer to a just-closed socket.

### 1.5 Timeout clamping

- **R1.16** `us_internal_clamp_to_sweep(loop, timeout, storage)`
  (epoll_kqueue.c:312-326): let `ns = us_internal_sweep_timeout_ns(loop)`
  (−1 = no sweep armed → return `timeout` unchanged). If `timeout` is non-NULL
  and ≤ the sweep delta, return `timeout`. Otherwise return `storage` = the
  sweep delta split into sec/nsec. So the result is min(timeout, sweep delta),
  with ties going to `timeout`.
- **R1.17** `us_internal_sweep_timeout_ns` (loop.c:96-102): −1 if disarmed,
  else `max(0, sweep_next_tick_ns - monotonic_now_ns)`.

### 1.6 Ready-poll dispatch

- **R1.18** `us_internal_dispatch_ready_polls` (epoll*kqueue.c:184-285).
  **Epoll**: iterate `current_ready_poll` from 0 to `num_ready_polls-1`. For
  each entry read the poll pointer from `data.ptr`; skip NULL. If the pointer
  carries a tag in bits 48-63 (`CLEAR_POINTER_TAG(p) != p`,
  epoll_kqueue.c:38-39), it is a Bun FilePoll — call
  `Bun__internal_dispatch_ready_poll(loop, poll)` and continue. Otherwise:
  `error = !!(events & EPOLLERR)` (normalized to 0/1 — a raw EPOLLERR value 8
  would be misread as an errno downstream, comment epoll_kqueue.c:194-196),
  `eof = events & EPOLLHUP`, `events &= us_poll_events(poll)` (mask to what
  the poll is \_currently* registered for), then if `events || error || eof`
  call `us_internal_dispatch_ready_poll(poll, error, eof, events)`.
- **R1.19** **Kqueue** does a two-pass coalesce (epoll_kqueue.c:206-283)
  because each filter arrives as a separate kevent: pass 1 decodes each entry
  into 1-byte flags {readable (EVFILT_READ, plus EVFILT_MACHPORT on macOS /
  EVFILT_USER on FreeBSD), writable (EVFILT_WRITE), error (EV_ERROR), eof
  (EV_EOF)} and merges an entry into an earlier entry with the same poll
  pointer (backward scan; at most 2 kevents per fd), marking the later entry
  `skip`. Pass 2 iterates `current_ready_poll` in order: NULL → skip; tagged →
  `Bun__internal_dispatch_ready_poll`; skipped → skip; else build
  `events = readable*R | writable*W`, `events &= us_poll_events(poll)`,
  dispatch if `events || error || eof`. Dispatch order therefore matches
  kernel-delivered order of each poll's FIRST kevent.
- **R1.20** `us_internal_drain_ready_polls` (epoll_kqueue.c:292-309): while
  the previous poll returned exactly `LIBUS_MAX_READY_POLLS` events, and at
  most 48 times, and `num_polls > 0`, re-poll non-blocking (zero timespec /
  `KEVENT_FLAG_IMMEDIATE`) and dispatch again. ≤0 results reset
  `num_ready_polls = 0` and stop. (Mirrors libuv's saturation re-poll.)
- **R1.21** **Poll mutation during iteration**:
  `us_internal_loop_update_pending_ready_polls(loop, old, new, old_events,
new_events)` (epoll*kqueue.c:420-441) scans `ready_polls` from
  `current_ready_poll` (inclusive) forward, replacing up to N entries whose
  pointer equals `old` with `new` (N = 1 on epoll, 2 on kqueue). `new` may be
  NULL (removal — e.g. poll_stop/close). It is invoked by `us_poll_change`
  (with new==old, so it is effectively a no-op there but preserved for parity;
  stale event \_bits* are instead filtered by the `events &= us_poll_events()`
  mask at dispatch), by `us_poll_stop` (new = NULL), and by `us_poll_resize`
  (old → new). NOTE: entries at indexes < current_ready_poll are never
  rewritten — they were already dispatched.

### 1.7 Low-priority processing

- **R1.22** `us_internal_handle_low_priority_sockets` (loop.c:297-320), called
  from loop_pre: set `low_prio_budget = 5`
  (`MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION`, loop.c:295). Pop from
  `low_prio_head` (LIFO) while budget > 0: unlink from the low-prio queue
  (fixing prev of the new head), `s->next = 0`, decrement
  `s->group->low_prio_count`. If the socket is closed, just set
  `low_prio_state = 2` and continue. Otherwise relink into
  `group->head_sockets` (`us_internal_socket_group_link_socket`), re-enable
  readable (`us_poll_change(events | R)`), set `low_prio_state = 2`.
- **R1.23** low_prio_state values (internal.h:245): 0 = not queued, 1 = queued
  in `loop->data.low_prio_head`, 2 = was queued and got budget this iteration
  (processes one readable dispatch normally, then reset to 0 by the readable
  handler, loop.c:596-597).
- **R1.24** Parking (loop.c:595-633), inside the READABLE arm of the socket
  dispatch, only for TLS sockets where `us_internal_ssl_is_low_prio(s)` is
  true (mid-handshake). Priority order: state==2 → clear to 0 and process
  now; else if `low_prio_budget > 0` → decrement and process now; else park:
  disable readable (`us_poll_change(events & W)`), and if not already parked
  (state != 1): `group->low_prio_count++` **before**
  `us_internal_socket_group_unlink_socket(g, s)` (so the group's emptiness
  check can't unlink the group, loop.c:613-620), push LIFO onto
  `loop->data.low_prio_head` (prev/next reused), set state = 1. In both park
  cases `break` out of the socket case (skipping the eof/error tail for this
  event). Parked sockets are NOT in `group->head_sockets` and are NOT swept
  for timeouts.

---

## 2. POLL LAYER

- **R2.1** Poll kinds (internal.h:88-99): SOCKET=0, SOCKET_SHUT_DOWN=1,
  SEMI_SOCKET=2 (listen + in-flight connect), CALLBACK=3 (async/timer), UDP=4,
  stored in the low 3 bits; POLLING_OUT=8, POLLING_IN=16 in the top 2 bits of
  a 5-bit field. `POLL_TYPE_KIND_MASK=0b111`, `POLL_TYPE_POLLING_MASK=0b11000`.
- **R2.2** epoll/kqueue `us_poll_t` is 4 bytes: bitfield `{fd:27 signed,
poll_type:5}` (epoll_kqueue.h:109-114). fd is limited to 2^26-1. libuv
  `us_poll_t` is `{uv_poll_t *uv_p; fd; unsigned char poll_type}`
  (libuv.h:39-45).
- **R2.3** `us_create_poll(loop, fallthrough, ext_size)` (epoll_kqueue.c:63-68):
  `us_malloc(sizeof(us_poll_t)+ext_size)` with the returned pointer's bits
  48-63 cleared (`CLEAR_POINTER_TAG` — tagged pointers are reserved for Bun
  FilePolls). Increments `loop->num_polls` unless `fallthrough`. The ext
  region is NOT zeroed. On libuv (libuv.c:221-228) it also mallocs the
  `uv_poll_t` and points `uv_p->data` at the poll; num_polls is not tracked
  (libuv counts active handles itself).
- **R2.4** `us_poll_free` (epoll_kqueue.c:71-74): `loop->num_polls--` then
  `us_free(p)`. Note it decrements num_polls even for fallthrough-created
  polls — callers must keep create/free fallthrough-symmetric (the wakeup
  async is closed via `us_internal_async_close`, which does call
  `us_poll_free`; the balance works out because the async was fallthrough=1
  and its close also decrements — see quirk OQ-13). On libuv
  (libuv.c:73-91): if `p->uv_p == NULL` (poll lost ownership after resize)
  just free p; if the uv handle is mid-close, re-point `uv_p->data = p` so
  `close_cb_free_poll` frees both; else free both immediately.
- **R2.5** `us_poll_init(p, fd, poll_type)` sets `state.fd = fd`,
  `state.poll_type = poll_type` (clears polling bits) (epoll_kqueue.c:81-84).
  `us_internal_poll_set_type` only replaces the kind bits, preserving polling
  bits (epoll_kqueue.c:100-102) — it does not SET from scratch, so the poll
  must be inited first (comment epoll_kqueue.c:99).
- **R2.6** `us_poll_events(p)` derives R/W from the POLLING*IN/OUT bits
  (epoll_kqueue.c:86-88). This is the poll's \_believed* registration and is
  the source of truth for the dispatch-time event mask (R1.18).
- **R2.7** `us_poll_start_rc(p, loop, events)` (epoll_kqueue.c:513-539): store
  polling bits; **epoll**: build `epoll_event{events, data.ptr=p}`; if neither
  R nor W requested, add `EPOLLHUP|EPOLLERR` explicitly and NEVER `EPOLLRDHUP`
  (a level-triggered RDHUP for an already-received FIN would spin the loop —
  comment epoll_kqueue.c:518-527); `EPOLL_CTL_ADD` retried on EINTR; returns
  the epoll_ctl rc (0 success, −1 + errno). **kqueue**: `kqueue_change(kqfd,
fd, 0, events, p)` (R2.9). `us_poll_start` is the same ignoring the rc.
- **R2.8** `us_poll_change(p, loop, events)` (epoll_kqueue.c:545-570): no-op if
  events unchanged. Else update polling bits; epoll `EPOLL_CTL_MOD` with the
  same zero-events → `EPOLLHUP|EPOLLERR` rule; kqueue `kqueue_change(fd,
old_events, events, p)`; then
  `us_internal_loop_update_pending_ready_polls(loop, p, p, old, new)`.
- **R2.9** `kqueue_change` (epoll*kqueue.c:447-482): builds ≤2 kevent64
  changes: EVFILT_READ EV_ADD/EV_DELETE when the R bit differs. For W:
  \_special zero-events rule* — if the new events poll for NEITHER R nor W and
  the old events did not include W, ADD `EVFILT_WRITE EV_ADD|EV_ONESHOT` (a
  half-open socket needs some filter armed to learn about the FIN/EOF;
  epoll relies on implicit EPOLLHUP instead); otherwise if the W bit differs,
  `EVFILT_WRITE EV_ADD|EV_ONESHOT` or `EV_DELETE`. **EVFILT_WRITE is always
  one-shot on kqueue; EVFILT_READ is level-triggered (no EV_CLEAR, no
  ONESHOT).** Submitted with `KEVENT_FLAG_ERROR_EVENTS`; if the call returns
  > 0 error events, `errno` is set from `change_list[0].data` to mirror
  > epoll's error contract (epoll_kqueue.c:474-480).
- **R2.10** `us_poll_stop` (epoll_kqueue.c:572-589): epoll `EPOLL_CTL_DEL`
  (retried on EINTR; the `event` argument is uninitialized — legal since
  Linux 2.6.9); kqueue calls `kqueue_change(fd, old_events, 0, NULL)` only if
  `old_events != 0` — note this path passes new_events=0 through the R2.9
  zero-events rule, so if the poll had no W it ADDS a one-shot EVFILT_WRITE
  with `udata = NULL` (delivered later as a NULL ready poll and skipped).
  Then `us_internal_loop_update_pending_ready_polls(loop, p, NULL, old, 0)`.
  Poll bits in `p` are NOT cleared by stop.
- **R2.11** `us_poll_resize(p, loop, old_ext, new_ext)`
  (epoll_kqueue.c:485-511): if `new_size <= old_size` return `p` unchanged.
  Else `us_calloc` a new poll (zero-filled), memcpy the old bytes,
  `loop->num_polls++` (old poll's later free decrements). Re-register the fd
  with the new pointer as userdata: epoll strips the polling bits from
  `new_p` and calls `us_poll_change(new_p, loop, events)` (forcing a MOD);
  kqueue calls `kqueue_change(fd, 0, R|W, new_p)` (forcibly re-adds both
  filters). Then `us_internal_loop_update_pending_ready_polls(loop, p, new_p,
events, events)`. The OLD poll is NOT freed here. On libuv
  (libuv.c:232-249): keeps the same `uv_poll_t`, re-points `uv_p->data =
new_p`, sets `p->uv_p = NULL` (old poll no longer owns the uv handle).
- **R2.12** `us_internal_dispatch_ready_poll(p, error, eof, events)`
  (loop.c:431-917) switches on `us_internal_poll_type(p)`:
  - CALLBACK (loop.c:433-444): unless `cb->leave_poll_ready`, call
    `us_internal_accept_poll_event(p)` (epoll: read 8 bytes from the
    eventfd, retried on EINTR, epoll_kqueue.c:591-604; kqueue: no-op).
    Then invoke `cb->cb`, passing `cb->loop` if `cb_expects_the_loop` else
    the callback struct itself. Never reads `events`.
  - SEMI_SOCKET: connect-completion vs accept — §6/§7.
  - SOCKET / SOCKET_SHUT_DOWN: §3.6/§4.
  - UDP: §9.
- **R2.13** Epoll vs kqueue eventing summary (normative for the Rust implementation):
  - epoll: level-triggered for both R and W; EPOLLERR/EPOLLHUP always
    delivered regardless of interest set; error := EPOLLERR, eof := EPOLLHUP.
    EPOLLRDHUP is never requested.
  - kqueue: EVFILT_READ level-triggered; EVFILT_WRITE one-shot (EV_ONESHOT).
    After a writable event is delivered the kernel filter is gone; the
    dispatcher clears POLLING_OUT to reflect that (loop.c:556-563) while
    preserving POLLING_IN from the poll's own state (a pure write kevent has
    no R bit). error := EV_ERROR flag, eof := EV_EOF flag on either filter.
  - libuv: `uv_poll_start(events, poll_cb)`; poll_cb maps
    `status < 0 && status != UV_EOF` → error, `status == UV_EOF` → eof
    (libuv.c:26-29). uv_poll handles are created per poll; `us_poll_start`
    always `uv_unref`s the handle (keep-alive is Bun's `Async.KeepAlive`, not
    usockets — libuv.c:100-104). `us_poll_stop` uv_poll_stop + uv_close with
    deferred-free protocol (R2.4). `us_poll_start_rc` always returns 0 on
    libuv (libuv.c:107-110) — EPOLL_CTL_ADD-failure handling is
    epoll/kqueue-only.
  - libuv loop: `uv_prepare_t` → `us_internal_loop_pre`, `uv_check_t` →
    `us_internal_loop_post`, both unreffed (libuv.c:154-186). libuv timers
    fire AFTER the check (post) callback (comment libuv.c:36). `us_timer_t`
    exists only on this backend (libusockets.h:206-226): it is a
    `us_internal_callback_t` + embedded `uv_timer_t`; `us_timer_set` arms
    `uv_timer_start(ms, repeat_ms)` (0 → stop); the sweep timer specifically
    is one-shot-guarded (`has_added_timer_to_event_loop`) so repeated
    enable_sweep calls don't skew the 4 s cadence (libuv.c:296-305).
  - FreeBSD: kevent64 shimmed onto kevent (epoll_kqueue.h:44-75):
    `KEVENT_FLAG_ERROR_EVENTS` → suppress eventlist harvesting entirely;
    `KEVENT_FLAG_IMMEDIATE` + NULL timeout → zero timespec. Async wakeup uses
    EVFILT_USER with EV_CLEAR (R10.5).

---

## 3. SOCKET LIFECYCLE

### 3.1 Memory layout & creation

- **R3.1** `us_socket_t` (internal.h:258-304) layout: `us_poll_t p`
  (16-aligned), `timeout` (u8), `long_timeout` (u8), `flags` (packed 1-byte
  `us_socket_flags`: is_paused, allow_half_open, low_prio_state:2, is_ipc,
  is_closed, adopted, last_write_failed — internal.h:240-256, static-asserted
  size 1 on epoll/kqueue), `kind` (u8, dispatch discriminator), 12 bits of SSL
  state + `ssl_pending_close_code` (u8), `group*`, `ssl*`, `prev*`, `next*`,
  `connect_next*`, `connect_state*`. Ext memory is `s + 1` (socket.c:594-596),
  16-aligned by ALIGNMENT of the struct.
- **R3.2** A socket allocation is one poll allocation:
  `us_create_poll(loop, 0, sizeof(us_socket_t) - sizeof(us_poll_t) + ext_size
  - sizeof(us_poll_t))`— expressed variously as`sizeof(struct us_socket_t) + ext`(context.c:506,644,678; socket.c:416) or`sizeof(us_socket_t) - sizeof(us_poll_t) + listen->socket_ext_size` for
    accepts (loop.c:483). Poll header first, socket fields, then ext.
- **R3.3** Field init on every creation path MUST set: `group`, `kind`,
  `ssl = NULL`, `timeout = 255`, `long_timeout = 255`, all flags zero except
  `allow_half_open = (options & LIBUS_SOCKET_ALLOW_HALF_OPEN)` where an
  options word exists, `connect_state = NULL` (accept: loop.c:496-507;
  connect: context.c:477-494; from_fd: socket.c:424-436; listen:
  context.c:337-352). `connect_next` is initialized on connect paths and for
  listeners; the accept path does not touch it (dead for established
  server sockets).

### 3.2 Open

- **R3.4** `us_socket_open(s, is_client, ip, ip_length)` (socket.c:644-649):
  routes to `us_internal_ssl_on_open` iff `s->ssl`, else `us_dispatch_open`.
  The accept loop calls the same pair directly (loop.c:514-519) with
  `is_client=0` and the peer IP bytes from `bsd_accept_socket` (4 or 16 bytes,
  raw network order, NOT a string); the connect promotion calls it with
  `is_client=1, ip=NULL, ip_length=0` (context.c:812-816).

### 3.3 Adopt

- **R3.5** `us_socket_adopt(s, group, kind, old_ext_size, ext_size)`
  (context.c:265-329). Precondition: if `us_socket_is_closed(s) ||
us_socket_is_shut_down(s)`, return `s` unchanged (no adoption of closed or
  shut-down sockets). Steps:
  1. If `low_prio_state != 1`: `us_internal_socket_group_unlink_socket(
old_group, s)` (this also fixes `group->iterator` if we're inside
     on_timeout, R3.14). If parked (state==1) and the group actually changes:
     move the `low_prio_count` from old to new group, touch (link) the new
     group, maybe-unlink the old (context.c:276-283); the socket itself stays
     on the loop's low-prio queue.
  2. If `ext_size != -1`: `us_poll_resize` with sizes
     `sizeof(us_socket_t) - sizeof(us_poll_t) + {old_ext_size, ext_size}`.
     `us_poll_resize` only reallocates when growing (R2.11). If a new block
     was returned (`new_s != s`): mark OLD socket `is_closed = 1`, push OLD
     onto `loop->data.closed_head`, set OLD `flags.adopted = 1`, and set
     OLD `s->prev = new_s` — this is the forwarding pointer the dispatcher
     follows (R3.6). If the old socket had SSL, notify
     `us_internal_ssl_socket_relocated(loop, s, new_s)`.
     If `s->connect_state` exists (adopting an in-flight connect attempt),
     re-point `c->connecting_head = new_s`, `c->group = group`, `c->kind =
kind`, and move c between the groups' connecting lists
     (context.c:307-312). NOTE: this assumes the adopted socket is the list
     head — see OQ-7.
  3. Unconditionally stamp `new_s->group = group`, `new_s->kind = kind`,
     `timeout = 255`, `long_timeout = 255` (adoption clears timeouts).
  4. If `new_s->flags.low_prio_state == 1`: splice the new pointer into the
     loop low-prio queue in place of the old (fix neighbor/head pointers,
     context.c:319-324). Else `us_internal_socket_group_link_socket(group,
new_s)`.
  5. Return `new_s`.
     With `ext_size == -1` the socket is re-stamped (group/kind/timeouts) with
     no resize and no connect_state fixup.
- **R3.6** Adoption forwarding: everywhere the dispatcher regains control
  after calling out (accept-open loop.c:521-523, socket case entry
  loop.c:549-551, after writable loop.c:567-569, after on_data
  loop.c:687-689), it MUST apply: `if (s && s->flags.adopted && s->prev)
s = s->prev;`. I.e. a closed+adopted socket's `prev` field is repurposed as
  the forwarding pointer to the relocated socket. (`us_socket_adopt_tls` and
  `us_socket_tls_feed` live in crypto/openssl.c — TLS layer, out of scope —
  but they reuse `us_socket_adopt` and the same forwarding contract.)

### 3.4 Group linkage invariants

- **R3.7** `us_socket_group_t` (libusockets.h:270-287): `{loop, vtable, ext,
head_sockets, head_connecting_sockets, head_listen_sockets, iterator,
prev, next, global_tick (u32), low_prio_count (u16), timestamp (u8),
long_timestamp (u8), linked (u8)}`. `us_socket_group_init`
  (context.c:49-55) zeroes the struct and sets loop/vtable/ext; it does NOT
  link into the loop.
- **R3.8** Lazy linking: `us_internal_group_touched` links the group at the
  head of `loop->data.head` on first insertion of any socket / connecting
  socket / listener (context.c:178-183, called from link_socket,
  link_connecting_socket, init_listen_socket).
  `us_internal_group_maybe_unlink` (context.c:185-190) unlinks iff `linked`
  and the group is empty: `head_sockets == NULL && head_connecting_sockets ==
NULL && head_listen_sockets == NULL && low_prio_count == 0`
  (context.c:171-176).
- **R3.9** `us_internal_socket_group_link_socket` (context.c:192-204): no-op
  for closed sockets. Push at head of `head_sockets` (doubly linked via
  s->prev/s->next), set `s->group = group`, touch the group, and
  `us_internal_enable_sweep_timer(loop)` (§5).
- **R3.10** `us_internal_socket_group_unlink_socket` (context.c:206-228):
  if `s == group->iterator`, advance `group->iterator = s->next` (sweep
  safety). Unlink from the doubly-linked list — note the head-detection idiom
  `if (prev == next) head_sockets = 0` (both NULL ⟺ only element). Then
  `us_internal_disable_sweep_timer(loop)` and `maybe_unlink(group)`.
- **R3.11** Connecting-socket link/unlink are the same shape on
  `head_connecting_sockets` via `next_pending`/`prev_pending`
  (context.c:230-261), also enabling/disabling the sweep refcount.
- **R3.12** `us_internal_loop_unlink_group` (loop.c:178-196): if the group is
  the loop's sweep cursor (`loop->data.iterator`), advance the cursor to
  `group->next` BEFORE unlinking, so a timeout handler that deinits the
  current group doesn't strand the sweep in freed memory.
- **R3.13** `us_socket_group_deinit` (context.c:57-74): debug-asserts all
  heads NULL, `low_prio_count == 0`, `iterator == NULL`; unlinks from the
  loop if linked. The embedding owner frees the storage.
- **R3.14** Sweep-vs-mutation contract: during `us_internal_timer_sweep`,
  `group->iterator` is set to the socket being dispatched (loop.c:257). Any
  unlink of that socket (close, adopt) advances `group->iterator` (R3.10). If
  after dispatch `group->iterator == s` still, step `s = s->next`; else
  resume from `group->iterator` (loop.c:277-282). If dispatch caused the
  whole group to be deinit'd, `loop_data->iterator` no longer equals `group`
  and the sweep MUST NOT touch `group` again (loop.c:262-274; it jumps to the
  next group already installed in `loop_data->iterator` by R3.12).

### 3.5 Close paths

- **R3.15** Close-code trichotomy (libusockets.h:71-82):
  - `0` CLEAN_SHUTDOWN: TLS graceful (close_notify, deferred fd close); plain
    TCP just closes (FIN emitted by the kernel on close of an un-RST socket).
  - `1` CONNECTION_RESET: before closing the fd, set
    `SO_LINGER{l_onoff=1, l_linger=0}` so close() sends RST and skips
    TIME_WAIT (socket.c:304-308).
  - `2` FAST_SHUTDOWN: TLS fast shutdown, TCP normal FIN close. At the plain-
    TCP core level codes 0 and 2 behave identically; the distinction is
    consumed by the TLS layer and by JS (codes 0..2 are "self-initiated" and
    filtered; peer errors are errnos > 2, loop.c:793-796).
- **R3.16** `us_socket_close(s, code, reason)` (socket.c:339-344): if
  `s->ssl && !closed` route to `us_internal_ssl_close` (graceful TLS close,
  may defer); else `us_internal_socket_close_raw`.
- **R3.17** `us_internal_socket_close_raw(s, code, reason)` (socket.c:263-337)
  exact sequence: 0. If `s->ssl && s->ssl_in_use` (JS destroyed the socket from inside a
  BoringSSL callback): DO NOT close now; set `ssl_pending_detach = 1`,
  `ssl_pending_close_code = code`, return `s`. The SSL driver's epilogue
  re-runs the close (socket.c:264-273).
  1. If already closed, return `s` unchanged.
  2. Unlink: if `low_prio_state == 1`, splice out of the loop low-prio queue,
     zero prev/next/state, `group->low_prio_count--`, then
     `us_internal_group_maybe_unlink(group)` (socket.c:277-291). Else
     `us_internal_socket_group_unlink_socket(group, s)`.
  3. Deregister: kqueue skips the kevent syscall (fd close removes filters
     automatically) and only calls
     `us_internal_loop_update_pending_ready_polls(loop, s, 0, events, 0)`;
     epoll/libuv call `us_poll_stop` (socket.c:295-302).
  4. If `code == 1` (RESET), arm `SO_LINGER{1,0}` (socket.c:304-308).
  5. `bsd_close_socket(fd)`.
  6. `s->flags.is_closed = 1`.
  7. Dispatch on_close — but ONLY if the poll type is not SEMI_SOCKET
     (`!(poll_type & POLL_TYPE_SEMI_SOCKET)`; note this bit-test also skips
     UDP? No — close_raw is only called on TCP sockets; the mask test
     matches SEMI_SOCKET(2) and any type with bit 2 set, in practice only
     SEMI_SOCKET; SOCKET=0 and SOCKET_SHUT_DOWN=1 pass). Route
     `us_internal_ssl_on_close` if `s->ssl` else `us_dispatch_close(s, code,
reason)`. A never-opened connect (SEMI_SOCKET) MUST NOT get on_close —
     its owner is notified via on_connect_error instead (socket.c:316-325).
  8. `us_internal_ssl_detach(s)` (SSL_free + NULL; idempotent, no-op for
     plain TCP).
  9. Push `s` onto `loop->data.closed_head` via `s->next`. Memory is freed at
     the outermost tick's loop_post (R1.15).
  10. Return the on_close return value if it was dispatched, else `s`.
- **R3.18** `us_socket_detach(s)` (socket.c:349-385): identical unlink/stop/
  closed-list bookkeeping to close_raw but **never closes the fd**, never
  sets SO_LINGER, never dispatches on_close, and always
  `us_internal_ssl_detach`s. The fd's ownership passes to the caller. Sets
  `is_closed = 1` and pushes to closed_head.
- **R3.19** `us_socket_shutdown(s)` (socket.c:624-630): TLS routes to
  `us_internal_ssl_shutdown`; plain routes to
  `us_internal_socket_raw_shutdown` (socket.c:613-622): if not closed and not
  already SHUT_DOWN — set poll type to `POLL_TYPE_SOCKET_SHUT_DOWN`,
  `us_poll_change(events & R)` (stop polling writable), then
  `bsd_shutdown_socket(fd)` = `shutdown(fd, SHUT_WR/SD_SEND)`. Send-FIN,
  keep reading.
- **R3.20** `us_socket_shutdown_read(s)` = `shutdown(fd, SHUT_RD/SD_RECEIVE)`
  unconditionally (idempotent; no state change) (socket.c:47-50).
- **R3.21** `us_socket_is_shut_down(s)` (socket.c:602-607): TLS asks
  `us_internal_ssl_is_shut_down`; plain returns
  `poll_type == POLL_TYPE_SOCKET_SHUT_DOWN`. `us_socket_is_closed(s)` =
  `flags.is_closed` (socket.c:142-144). `us_socket_is_established(s)` =
  `poll_type != POLL_TYPE_SEMI_SOCKET` (socket.c:164-167).

### 3.6 Readable/eof/error dispatch on established sockets (loop.c:544-800)

- **R3.22** Case order for one event dispatch on SOCKET/SOCKET_SHUT_DOWN:
  (a) adoption-forward `s` (R3.6); cache `loop = s->group->loop` (the group
  may change during callbacks, the loop can't; loop.c:552-553);
  (b) WRITABLE handling (only when `events & W && !error`, loop.c:554-583):
  clear `last_write_failed`; on kqueue clear POLLING_OUT preserving
  POLLING_IN (R2.13); dispatch `ssl_on_writable`/`us_dispatch_writable`;
  re-forward for adoption; return if `!s || closed`. Then: if
  `!last_write_failed || shut_down` → `us_poll_change(events & R)` (stop
  polling writable); else on kqueue re-arm `us_poll_change(events | W)`
  (one-shot filter re-registration).
  (c) READABLE handling (loop.c:586-753): low-prio gate (R1.24), then a recv
  loop:
  - flags: `MSG_DONTWAIT` POSIX, `MSG_PUSH_IMMEDIATE` Windows (loop.c:638-643).
  - IPC sockets (`flags.is_ipc`, non-Windows) use `bsd_recvmsg` with a
    1-int SCM_RIGHTS control buffer; if a valid `SOL_SOCKET/SCM_RIGHTS` cmsg
    arrives with `length > 0`, dispatch `us_dispatch_fd(s, fd)` FIRST, then
    fall through to the normal data dispatch of the same bytes; abort the
    recv loop if on_fd closed the socket (loop.c:647-675). Only the first
    cmsg / one fd per recvmsg is extracted.
  - Non-IPC: `bsd_recv(fd, recv_buf + 32, LIBUS_RECV_BUFFER_LENGTH, flags)`
    (loop.c:678). All reads land in the loop-shared recv_buf at offset
    `LIBUS_RECV_BUFFER_PADDING`.
  - `length > 0`: dispatch `ssl_on_data`/`us_dispatch_data(s, buf, length)`;
    re-forward adoption. Repeat-read heuristic (POSIX, loop.c:691-713):
    continue the loop only if `s` alive, `length >= LIBUS_RECV_BUFFER_LENGTH
    - 24\*1024`, `length <= LIBUS_RECV_BUFFER_LENGTH`, and (`error`set (hung
up — macOS delivers EV_EOF with the same event) or`loop->num_ready_polls < 25`), and socket not closed and NOT paused
(`flags.is_paused`— a pause from inside on_data stops the loop).`repeat_recv_count`increments only when`error == 0`, and when
`repeat_recv_count > 10 && loop->num_ready_polls > 2` the loop stops
(starvation guard). Windows (loop.c:715-731): after a successful read,
probe recv exactly once more (`repeat_recv_count++ == 0`) unless
      closed/paused, to catch AFD_POLL_ABORT races.
  - `length == 0`: set `eof = 1`, break (handled below).
  - `length == -1 && !bsd_would_block()`: peer-initiated TCP error → bypass
    the SSL-graceful path and `us_internal_socket_close_raw(s, LIBUS_ERR,
NULL)`; **return** from dispatch (loop.c:736-748). The close code is the
    raw errno.
    (d) EOF handling (loop.c:755-784), only if `eof && s`: if socket already
    closed → return (no on_end after close). If `us_socket_is_shut_down(s)`
    (we sent FIN first, got FIN back) → `close_raw(s, 0 /*CLEAN*/, NULL)`,
    return. If `allow_half_open`: `us_poll_change(&s->p, loop, W)` — an
    ABSOLUTE event set: stop readable, force-keep writable even if it wasn't
    currently armed (a same-tick queued write must still flush; the writable
    dispatch disarms W again once drained — comment loop.c:765-775) — then
    dispatch `ssl_on_end`/`us_dispatch_end`. Else: dispatch on_end, then
    `close_raw(s, 0, NULL)`, return.
    (e) ERROR handling (loop.c:786-799), only if `error && s`: fetch real errno
    via `us_socket_get_error(s)` (SO_ERROR; epoll_kqueue.c:863-871 — falls back
    to `errno` if getsockopt itself fails) and
    `close_raw(s, so_error > 2 ? so_error : ECONNRESET, NULL)` — values 0..2
    are clamped to ECONNRESET because they'd collide with the CloseCode enum
    that JS filters as self-initiated; return.
- **R3.23** Pause/resume (socket.c:747-769): `us_socket_pause` — no-op if
  paused or closed; `us_poll_change(W)` (absolute: keep only writable),
  `is_paused = 1`. `us_socket_resume` — no-op unless paused; clear flag;
  no-op if closed; if shut down → `us_poll_change(R)` (read-only side);
  else `us_poll_change(R|W)`. NOTE resume unconditionally arms W even if no
  write is pending; the next writable dispatch will disarm it (R3.22b).

### 3.7 Misc accessors

- **R3.24** `us_socket_ext` = `s+1`; `us_connecting_socket_ext` = `c+1`
  (socket.c:594-600). `us_socket_kind`/`set_kind`, `us_socket_group`,
  `us_socket_is_tls` = `ssl != NULL` (socket.c:76-94).
  `us_socket_get_native_handle`: SSL* if TLS else `(void*)(uintptr_t)fd`(socket.c:456-461); for connecting sockets always`(void\*)-1`
  (socket.c:463-465).
- **R3.25** Address accessors (socket.c:29-74, 651-689) go through
  `bsd_local_addr`/`bsd_remote_addr` (getsockname/getpeername) each call —
  nothing is cached; failure or too-small caller buffer yields `*length = 0`
  / port −1. `us_get_remote_address_info`/`us_get_local_address_info` copy
  raw IP bytes into caller buf and return the byte length (0 on failure);
  `dest`/`is_ipv6` out-params are NOT written (callers infer family from
  length 4/16).
- **R3.26** `us_socket_ref`/`us_socket_unref` are uv_ref/uv_unref on libuv and
  no-ops elsewhere (socket.c:691-696, 736-741).
- **R3.27** `us_socket_from_fd(group, kind, ssl_ctx, ext, fd, ipc)`
  (socket.c:412-454), POSIX-only (returns 0 on Windows/libuv): create poll,
  init `POLL_TYPE_SOCKET`, `us_poll_start_rc(R|W)` — on failure free the poll
  and return 0 WITHOUT closing the caller's fd. Init fields (is_ipc = ipc),
  then `bsd_socket_nodelay(1)`, `apple_no_sigpipe`, `bsd_set_nonblocking`,
  link into group. If `ssl_ctx`, attach client TLS immediately. Caller
  invokes on_open itself (via `us_socket_open`) — from_fd does not dispatch.
- **R3.28** `us_socket_pair` (socket.c:387-397), POSIX-only:
  `socketpair(AF_UNIX, SOCK_STREAM)`, then `us_socket_from_fd(group, kind,
NULL, ext, fds[0], 0)`; fds[1] is left for the caller.
- **R3.29** Listen socket close (`us_listen_socket_close`, context.c:426-449):
  if not closed — `us_poll_stop`, `bsd_close_socket(fd)`,
  `us_internal_listen_socket_ssl_free(ls)` (frees SSL_CTX ref + SNI tree),
  unlink from `accept_group->head_listen_sockets` (singly-linked pointer
  scan), `maybe_unlink(group)`, push onto `closed_head`, `is_closed = 1`.
  Never dispatches on_close. Memory freed in loop_post (can be inside the
  accept loop — comment context.c:448).
- **R3.30** `us_loop_close_all_groups(loop)` (loop.c:204-224): walk
  `loop->data.head`; for each group with any of head_sockets /
  head_connecting_sockets / low_prio_count, call
  `us_socket_group_close_all_ex(g, /*also_listeners*/0)`; listen sockets are
  deliberately NOT closed (owner holds a raw pointer; closing here would
  UAF — comment loop.c:208-213). Returns 1 if anything was closed.
  Rust deviation: C cached `next` and probed `next->linked` after the call —
  but a close callback may free the cached group outright (owner deinit), so
  the probe is a UAF. The walk instead restarts from `loop->data.head` after
  every dispatch, skipping (by address, never deref'd) groups already
  dispatched this call so a repopulated or deferral-stuck group cannot spin
  it; the caller's retry rounds (C16) pick those up.
- **R3.31** `us_socket_group_close_all_ex(group, also_listeners)`
  (context.c:81-147), exact order:
  1. If also_listeners: close listeners first (`while (head_listen_sockets)
us_listen_socket_close(...)`) so nothing new is accepted.
  2. Close every connecting socket (walk with cached `next_pending`).
  3. Walk `head_sockets` (cached next): SEMI_SOCKET (in-flight connect
     attempt) → dispatch `us_dispatch_connect_error(s, ECONNABORTED)` first
     (so the owner wrapper detaches), then `close_raw(s, RESET, 0)` if the
     handler didn't close; established → `us_socket_close(s, CLEAN, 0)`.
  4. Force-drain survivors: `while (head_sockets)
close_raw(head_sockets, RESET, 0)` — TLS sockets whose graceful close
     deferred are forcibly closed so no socket outlives the owner's storage.
  5. If `low_prio_count`: walk `loop->data.low_prio_head`, and for each
     parked socket belonging to this group call `us_socket_close(q, CLEAN,
0)` (close_raw's low-prio branch unlinks + decrements the counter);
     assert count reaches 0.
  Rust deviation: steps 2-5 do not use C's cached-`next` walks. With
  in-place adoption there is no relocation tombstone, so a re-entrant
  adopt/close can relink a cached `next` into a foreign group or the closed
  chain. Step 2 restarts from `head_connecting_sockets` after every dispatch
  (close always detaches the node, so each pass shrinks the live prefix) and
  runs AGAIN after step 4 — a backstop for connecting sockets an on_close
  opened mid-walk. Step 3 snapshots `head_sockets` once (slot addresses are
  stable under the walk's tick-depth ref) and revalidates each entry
  (slot live ∧ not closed ∧ still this group) before closing — single-pass,
  so a §5.2-deferred close is attempted exactly once and left to step 4.
  Steps 4-5 keep restart-from-head walks, stepping past sockets a §1.4/§5.2
  deferral left linked (bounding the force-drain, which otherwise spins on
  an in-use head socket).

---

## 4. WRITE PATH

- **R4.1** `us_socket_write(s, data, length)` (socket.c:467-482): TLS →
  `us_internal_ssl_write`. Plain: return 0 if closed or shut down. Else
  `written = bsd_send(fd, data, length)`. If `written != length` (including
  −1): set `flags.last_write_failed = 1` and `us_poll_change(R|W)` (absolute
  set — this re-arms READABLE even on a paused socket, see OQ-2). Return
  `written < 0 ? 0 : written`. Fatal errors (EPIPE/ECONNRESET) are
  indistinguishable from would-block to the caller — the socket keeps polling
  writable; the error eventually surfaces as an error/HUP event.
- **R4.2** `us_socket_write_check_error(s, data, length, *fatal)`
  (socket.c:484-517): zero `*fatal` first. Closed/shut-down → 0. TLS → plain
  `us_socket_write` (TLS errors propagate through the SSL layer). Else send;
  on `written < 0`:
  - `bsd_would_block() || bsd_send_is_transient_error()` → treat as
    would-block: `last_write_failed = 1`, poll R|W, return 0. Transient =
    ENOBUFS/ENOMEM on POSIX, WSAENOBUFS on Windows (bsd.c:1017-1023). This is
    the commit-fc865b39 behavior: ENOBUFS/ENOMEM are transient kernel
    resource exhaustion on a healthy connection, NOT fatal (comment
    socket.c:496-501).
  - anything else → `*fatal = 1`, return 0, and DO NOT arm writable
    (retry can never succeed).
    On short write (`written != length`): `last_write_failed = 1`, poll R|W.
    Return `written` (≥0).
- **R4.3** `us_socket_write2(s, header, hlen, payload, plen)`
  (socket.c:399-410): closed/shut-down → 0. `bsd_write2` (single writev of
  the two chunks on POSIX; two sequential sends on Windows, where the payload
  send is only attempted if the header fully flushed — bsd.c:912-953). If
  `written != hlen + plen` → `us_poll_change(R|W)`. Returns
  `written < 0 ? 0 : written`. NOTE: write2 does NOT set `last_write_failed`
  (OQ-3). There is no TLS branch — write2 on a TLS socket writes ciphertext-
  layer bytes raw (callers only use it on plain sockets).
- **R4.4** `us_socket_raw_write(s, data, length)` (socket.c:537-554): gates
  ONLY on `is_closed` and raw poll type == SOCKET_SHUT_DOWN — deliberately
  NOT `us_socket_is_shut_down()`, because the TLS layer uses this to flush
  close_notify after SSL_shutdown marked the SSL shut down (comment
  socket.c:538-543). Otherwise identical to us_socket_write (sets
  last_write_failed + R|W on short).
- **R4.5** `us_socket_raw_writev(s, iov, count)` (socket.c:519-535): same
  gating as raw_write; computes `total = Σ iov_len`; `bsd_writev` caps count
  at 1024 (IOV_MAX; bsd.c:898-901 — partial-write handling carries the rest);
  short/failed → `last_write_failed = 1`, poll R|W; returns
  `written < 0 ? 0 : written`. Windows emulates writev with sequential
  bsd_send, stopping at the first short write, returning −1 if nothing was
  written (bsd.c:934-942).
- **R4.6** `bsd_send` (bsd.c:956-986) = `send(fd, buf, len,
MSG_NOSIGNAL | MSG_DONTWAIT)` retried on EINTR (MSG_NOSIGNAL defined to 0
  where missing; macOS relies on SO_NOSIGPIPE set at creation,
  bsd.c:332-340). There is NO MSG_MORE / TCP_CORK corking on the send path
  itself; `us_socket_flush` → `bsd_socket_flush` clears `TCP_CORK` on Linux
  (bsd.c:675-681) and is a no-op elsewhere — the "flush" only matters if
  some other layer corked. `us_socket_flush` is gated on
  `!us_socket_is_shut_down(s)` (socket.c:136-140).
- **R4.7** `bsd_would_block()` (bsd.c:1005-1011): POSIX checks
  `errno == EWOULDBLOCK` ONLY (the `|| EAGAIN` is commented out; equal on all
  currently-supported POSIX targets); Windows `WSAEWOULDBLOCK`.
- **R4.8** Sendfile: `us_socket_sendfile_needs_more(s)`
  (src/uws_sys/libuwsockets.cpp:1877-1881, declared libusockets.h:598): if
  not closed, set `last_write_failed = 1` and `us_poll_change(R|W)`. The
  actual sendfile syscall lives outside the core; this hook only re-arms
  writable + marks backpressure so the dispatcher keeps W polled (R3.22b).
- **R4.9** Writable-poll invariant: after any short/failed write the poll is
  R|W and `last_write_failed = 1`. The next writable event clears the flag
  BEFORE dispatching on_writable; if the handler doesn't write-and-fail
  again, W is disarmed (loop.c:554-577). This is the entire backpressure
  protocol — there is no userspace send buffer in the core
  (`us_socket_stream_buffer_t` does not exist in this tree; buffering lives
  in the Zig/Rust callers).
- **R4.10** IPC fd passing, send side: `us_socket_ipc_write_fd(s, data,
length, fd)` (socket.c:556-592, POSIX only): closed/shut-down → 0. Build a
  1-iovec msghdr with a single `SCM_RIGHTS` cmsg of one int
  (`CMSG_SPACE(sizeof(int))` control buffer), `bsd_sendmsg(fd, &msg, 0)`
  (EINTR-retried, bsd.c:989-1003 — note flags=0, no MSG_NOSIGNAL/DONTWAIT
  here; the fd is nonblocking anyway). If `sent != length`:
  `last_write_failed = 1`, poll R|W. Return `sent < 0 ? 0 : sent`. Contract:
  if the return value < length the fd was NOT transferred and the caller must
  retry the whole (data, fd) pair. Receive side is R3.22c (on_fd then
  on_data).

---

## 5. TIMEOUTS

- **R5.1** Encoding: `s->timeout` and `s->long_timeout` are u8; 255 =
  disarmed. Armed values are ticks-mod-240 on the group's clocks.
- **R5.2** `us_socket_timeout(s, seconds)` (socket.c:104-110): 0 → 255; else
  `s->timeout = (group->timestamp + ((seconds + 3) >> 2)) % 240` — i.e.
  ceil(seconds/4) ticks from the group's current short clock. Max meaningful
  timeout ≈ 239 ticks ≈ 956 s; longer values alias mod 240.
- **R5.3** `us_socket_long_timeout(s, minutes)` (socket.c:120-126): 0 → 255;
  else `(group->long_timestamp + minutes) % 240` (1-minute ticks, max 239
  min). Connecting-socket variants use `c->group->timestamp` identically
  (socket.c:112-134); those values are templates copied onto attempt sockets
  at `start_connections` (context.c:688-689) — the `us_connecting_socket_t`
  itself is NEVER swept (see OQ-5).
- **R5.4** Sweep clocks: per-group `global_tick` increments once per sweep;
  `timestamp = global_tick % 240`; `long_timestamp = (global_tick / 15) %
240` (loop.c:236-238). With one sweep per 4 s, one long tick = 15 sweeps =
  60 s.
- **R5.5** Sweep enable/disable refcount: EVERY link of a socket or
  connecting socket calls `us_internal_enable_sweep_timer(loop)`; every
  unlink calls `us_internal_disable_sweep_timer(loop)` (context.c:203,226,
  241,259). POSIX (loop.c:81-94): count 0→1 sets `sweep_next_tick_ns = now +
4e9` and calls `Bun__internal_ensureDateHeaderTimerIsEnabled(loop)`; count
  →0 sets `sweep_next_tick_ns = -1`. libuv (loop.c:56-69): 0→1 arms the
  repeating 4000 ms uv timer (+ same Bun call); →0 _intends_ to swap the
  callback to a no-op, but `us_timer_set` early-returns for the sweep timer
  once `has_added_timer_to_event_loop` is set (libuv.c:300-305), so in
  practice on libuv the sweep keeps firing `sweep_timer_cb` forever after
  the first enable; with all groups empty the sweep is a cheap no-op walk.
  The timer was created with fallthrough=1 → uv_unref'd (loop.c:124,
  libuv.c:265-267), so it does not keep the loop alive. Preserve this; do
  not "fix" by actually stopping it (see quirk OQ-16).
- **R5.6** Listen sockets do NOT participate in the sweep refcount
  (init_listen_socket links into head_listen_sockets without
  enable_sweep_timer, context.c:363-366) and are never swept (they live in
  head_listen_sockets, not head_sockets).
- **R5.7** Sweep deadline folds into the poll timeout via R1.16/R1.17;
  there is no timerfd / EVFILT_TIMER on POSIX.
- **R5.8** `us_internal_sweep_if_due(loop)` (loop.c:104-115), called after
  dispatch in both run paths: return if disarmed or `now <
sweep_next_tick_ns`. Re-arm FIRST (`sweep_next_tick_ns = now + 4e9`) —
  a timeout handler may unlink the last socket and disarm — then
  `us_internal_timer_sweep(loop)`. On libuv the sweep is driven by the uv
  timer callback instead (loop.c:386-389).
- **R5.9** `us_internal_timer_sweep(loop)` (loop.c:227-290) MUST NOT run
  recursively. For each group (cursor = `loop_data->iterator`, advanced as in
  R3.12/R3.14): bump the clocks (R5.4), then walk `head_sockets`. Inner fast
  loop scans until `short_ticks == s->timeout || long_ticks ==
s->long_timeout` or list end. On a hit: `group->iterator = s`. If short
  matches: `s->timeout = 255` (one-shot — the handler must re-arm) then
  `us_dispatch_timeout(s)`. Then, group-survival check (R3.14). If the
  socket survived as cursor (`group->iterator == s`) and long matches:
  `s->long_timeout = 255`, `us_dispatch_long_timeout(s)`, survival check
  again. Advance per R3.14. Both timeouts on the same tick fire short first,
  long second, on the same dispatch. After the group's walk: `group->iterator
= 0`, advance the loop cursor.
- **R5.10** Re-arm rules: dispatch does NOT re-arm anything. A handler that
  wants a recurring timeout MUST call `us_socket_timeout` again. A handler
  that closes the socket is safe (close unlinks and fixes both iterators).

---

## 6. CONNECT

- **R6.1** `us_connecting_socket_t` (internal.h:310-338): `{addrinfo_req,
group, loop (captured at create; survives group detach), ssl_ctx (up_ref'd
borrow), next (dns_ready / closed-list link), connecting_head (list of
in-flight attempt sockets via s->connect_next), options, socket_ext_size,
bitfields closed/shutdown/shutdown_read/pending_resolve_callback/
error_is_dns, timeout, long_timeout, kind, port, error, addrinfo_head
(cursor into the resolved list), next_pending/prev_pending (group list)}`.
  Allocated as `us_calloc(1, sizeof + socket_ext_size)` (context.c:611) —
  ext lives at `c+1` and is memcpy'd into every attempt socket
  (context.c:693).
- **R6.2** `us_socket_group_connect(group, kind, ssl_ctx, host, port,
local_host, local_port, options, ext_size, *has_dns_resolved)`
  (context.c:567-634), on the loop thread:
  1. Parse `local_host` as a literal IP (never resolved) into `local_addr`
     if given (context.c:574-578; `try_parse_ip` handles v4 then v6,
     context.c:542-565).
  2. If `host` parses as a literal IP: `*has_dns_resolved = 1`; return
     `us_socket_group_connect_resolved_dns(...)` (an `us_socket_t*`).
  3. Else `Bun__addrinfo_get(loop, host, port, &ai_req)`. Return 0 means the
     request already has a result (cache hit): if `result->error == 0` AND
     there is exactly one entry (`entries->info.ai_next == NULL`), do the
     fast path: build the sockaddr with the requested port
     (`init_addr_with_port`, context.c:530-540), `*has_dns_resolved = 1`,
     connect directly, `Bun__addrinfo_freeRequest(ai_req, s == NULL)`
     (invalidate the cache entry if the connect failed), return the socket
     (possibly NULL). A cached ERROR or multi-address result falls through
     to the connecting-socket path (comment context.c:589-593).
  4. Slow path: calloc the `us_connecting_socket_t`; fill options/kind/loop;
     up_ref ssl_ctx if given; `timeout = long_timeout = 255`;
     `pending_resolve_callback = 1`; store ai_req and port; link into the
     group's connecting list. Keep the loop alive:
     `loop->num_polls++` (POSIX) / `uv_loop->active_handles++` (Windows)
     (context.c:625-629). Then `Bun__addrinfo_set(ai_req, c)` — registers c
     for completion notification (may fire immediately via the dns_ready
     queue if the request already completed). Return `c` with
     `*has_dns_resolved = 0`.
     Return type is `void*`: `us_socket_t*` when `*has_dns_resolved == 1`,
     `us_connecting_socket_t*` otherwise.
- **R6.3** `us_socket_group_connect_resolved_dns` (context.c:496-528):
  `bsd_create_connect_socket(addr, local_addr, options)` (R8.9) → NULL on
  failure (errno preserved). `bsd_socket_nodelay(fd, 1)`. Create poll of
  `sizeof(us_socket_t) + ext`, init `POLL_TYPE_SEMI_SOCKET`,
  `us_poll_start_rc(W)`; on registration failure: close fd, free poll,
  restore errno, return NULL. Init fields (R3.3, `last_write_failed = 0`),
  attach client TLS now if ssl_ctx (fast path has no c to stash it on), link
  into group. The socket polls WRITABLE-only until the connect completes.
- **R6.4** Unix connect (`us_socket_group_connect_unix`, context.c:636-663):
  same shape via `bsd_create_connect_socket_unix` (macOS long-path
  `__pthread_fchdir` workaround, R8.13); no DNS, no connecting socket.
- **R6.5** DNS bridge threading contract (internal.h:140-144, loop.c:322-357):
  - `Bun__addrinfo_get(loop, host, port, &req)`: loop thread. Returns 0 if a
    result is already available (cache), nonzero if in flight.
  - `Bun__addrinfo_set(req, c)`: loop thread; registers c to be notified.
    On an already-resolved request it defers to the loop's dns_ready
    mechanism, never re-enters (comment context.c:592-593).
  - Completion: the resolver (any thread) calls
    `us_internal_dns_callback_threadsafe(c, req)` = `us_internal_dns_callback`
    (push c onto `loop->data.dns_ready_head` under `Bun__lock(&loop->data.
mutex)`) + `us_wakeup_loop(loop)`. The non-threadsafe variant
    (same-thread) skips the wakeup (loop.c:322-340).
  - Drain: `us_internal_handle_dns_results(loop)` (loop_pre AND loop_post)
    swaps `dns_ready_head` to a local list under the mutex, then calls
    `us_internal_socket_after_resolve(c)` for each (loop.c:342-357), on the
    loop thread.
  - `Bun__addrinfo_cancel(req, c)`: loop thread; returns nonzero if c was
    removed from the notify list before firing, 0 if the callback already
    fired/queued (socket.c:214-244).
  - `Bun__addrinfo_getRequestResult(req)` → `{entries, error}`;
    `Bun__addrinfo_freeRequest(req, invalidate_cache)` releases the request,
    dropping the DNS cache entry when `invalidate_cache != 0`.
- **R6.6** `us_internal_socket_after_resolve(c)` (context.c:702-745):
  clear `pending_resolve_callback`. If `c->closed` (close raced the
  callback): free the request (no invalidate) and `us_connecting_socket_free`
  — the keep-alive was already balanced by the cancel branch of close
  (comment context.c:703-707). Else: balance the keep-alive
  (`num_polls--` / `active_handles--`). If `result->error`: `c->error =
result->error`, `c->error_is_dns = 1` (the two error namespaces overlap
  numerically — consumers MUST check error_is_dns first, internal.h:324-328),
  `us_connecting_socket_close(c)`. Else set `c->addrinfo_head =
&result->entries->info` and `start_connections(c, 4)`; if zero attempts
  could be opened, `c->error = ECONNREFUSED` then close (a real connect
  failure must not read as caller abort, context.c:739-744).
- **R6.7** Happy-eyeballs (`CONCURRENT_CONNECTIONS = 4`, context.c:27):
  `start_connections(c, count)` (context.c:665-700) walks `c->addrinfo_head`
  (advancing the cursor), opening up to `count` attempt sockets: each is
  built exactly like R6.3 (SEMI_SOCKET, poll W, nodelay; syscall or
  registration failure → skip to next address; no local bind on this path —
  comment context.c:672), gets `s->timeout/long_timeout` copied from c, is
  linked into the group, gets c's ext memcpy'd, and is pushed onto
  `c->connecting_head` via `s->connect_next` with `s->connect_state = c`.
  Returns number opened. Ordering: address order is whatever the resolver
  returned; the first 4 race simultaneously; there is no per-attempt delay
  timer.
- **R6.8** Connect completion — the SEMI_SOCKET arm of dispatch
  (loop.c:445-467): if the poll's events include W it is a connecting socket
  (a listen socket only ever polls R; the bit-test rather than equality
  tolerates R|W after an early partial write — comment loop.c:446-452).
  If `error || eof` accompany the writable event, fetch `SO_ERROR`; if that
  reads 0, substitute ECONNRESET (handshake completed then reset race —
  matches libuv, loop.c:453-466). Call
  `us_internal_socket_after_open(s, connect_error)`.
- **R6.9** `us_internal_socket_after_open(s, error)` (context.c:747-818):
  - Windows-only pre-step: on error==0, probe `recv(fd, NULL, 0)` and map
    non-WSAEWOULDBLOCK/WSAEINTR failures to an error (context.c:749-765).
  - **Error path**: with `c = s->connect_state`:
    - c != NULL (happy-eyeballs attempt): remove s from `c->connecting_head`
      (pointer-scan), `us_socket_close(s, RESET, 0)` (SEMI_SOCKET → no
      on_close, R3.17.7). Then if ≤1 attempts remain
      (`connecting_head == NULL || connecting_head->connect_next == NULL`),
      `start_connections(c, head==NULL ? 4 : 1)`; if nothing opened and no
      attempts remain: `c->error = ECONNREFUSED`,
      `us_connecting_socket_close(c)`.
    - c == NULL (direct connect): `us_dispatch_connect_error(s, error)`;
      the handler is expected to close the socket itself (comment
      context.c:789).
  - **Success path**: `us_poll_change(R)` (absolute), nodelay(1) again,
    poll type → `POLL_TYPE_SOCKET`, `us_socket_timeout(s, 0)` (disarm). If
    c: close every OTHER attempt with RESET (loser legs), attach TLS from
    `c->ssl_ctx` if present, `Bun__addrinfo_freeRequest(req, 0)`,
    `us_connecting_socket_free(c)`, `s->connect_state = NULL`. Finally
    `ssl_on_open(s, 1, 0, 0)` or `us_dispatch_open(s, 1, 0, 0)`.
- **R6.10** `us_connecting_socket_close(c)` (socket.c:192-255): idempotent
  via `c->closed`. Steps:
  1. `c->closed = 1`.
  2. For every attempt socket on `connecting_head`: unlink from its group,
     `us_poll_stop`, `bsd_close_socket(fd)`, push to loop closed_head,
     `is_closed = 1`. (Direct fd teardown — deliberately NOT close_raw; no
     dispatch fires for attempts here.)
  3. If `c->error == 0`, set `c->error = ECONNABORTED` (caller abort).
  4. If `pending_resolve_callback`:
     - `Bun__addrinfo_cancel` succeeded → balance keep-alive
       (num_polls--/active_handles--), clear the flag, free the request (no
       invalidate), `us_dispatch_connecting_error(c, c->error)`,
       `us_connecting_socket_free(c)`.
     - cancel failed (callback in flight) → balance keep-alive, dispatch
       connecting_error, `us_internal_connecting_socket_detach(c, loop)`
       (unlink from group + drop ssl_ctx ref, group := NULL,
       socket.c:172-182) but DO NOT free — after_resolve will see
       `c->closed` and finish (R6.6). Return.
  5. Else (resolution already done): if `addrinfo_req` remains, free it with
     invalidate = `(c->error == ECONNREFUSED || c->error_is_dns)` (refused →
     stale addresses; DNS failure → never cache negatives; socket.c:247-252).
     `us_dispatch_connecting_error(c, c->error)`; `us_connecting_socket_free(c)`.
  Rust deviation (steps 4-5): for static-vtable (owner-carrying) kinds the
  detach runs BEFORE the connecting_error dispatch — the dispatch releases
  the core-held owner ref, whose Drop can free the owner storage embedding
  the group, so the group unlink must complete first. Group-vtable kinds
  keep the C order (their vtable is resolved through `c->group`).
- **R6.11** `us_connecting_socket_free(c)` (socket.c:184-190): detach
  (group unlink + ssl_ctx unref) then push onto
  `loop->data.closed_connecting_head` via `c->next`; actual `us_free` happens
  in `us_internal_free_closed_sockets` (R1.15). Never free immediately — c
  may still sit on the dns_ready list.
- **R6.12** on*connect_error vs on_connecting_error: `us_dispatch_connect*
  error(s, code)`fires on a real (attempt)`us_socket_t`— direct-connect
failure (R6.9) and group close_all of an in-flight attempt (R3.31.3).`us_dispatch_connecting_error(c, code)`fires on the`us_connecting_socket_t` — DNS failure, all-attempts-failed, or
  cancellation (R6.10). Exactly one of {on_open, on_connect_error(s),
  on_connecting_error(c)} terminates a connect.
- **R6.13** Connecting-socket accessor semantics: `get_error` = c->error;
  `get_dns_error` = error_is_dns ? error : 0 (socket.c:636-642);
  `shutdown`/`shutdown_read` just latch bits consumed after promotion by the
  Zig caller (socket.c:52-54, 632-634); `is_shut_down` = c->shutdown;
  `is_closed` = c->closed; `ext` = c+1; `get_native_handle` = (void\*)-1.

---

## 7. LISTEN / ACCEPT

- **R7.1** `us_listen_socket_t` (internal.h:401-424) embeds a full
  `us_socket_t s` (so a listener IS a socket for poll/close purposes), plus:
  `accept_group` (group accepted sockets join — usually == s.group), `next`
  (singly-linked into `accept_group->head_listen_sockets`), `ssl_ctx`
  (borrowed, up_ref'd on listen, freed on close; NULL = plain), `sni` tree,
  `on_server_name` callback, `socket_ext_size` (ext stamped onto every
  accepted socket), `accept_kind` (kind stamped onto accepted sockets),
  `deferred_accept` flag.
- **R7.2** `us_socket_group_listen(group, kind, ssl_ctx, host, port, options,
ext_size, *error)` (context.c:369-399): `bsd_create_listen_socket` (R8.6)
  → 0 on failure. Create poll of `sizeof(us_listen_socket_t)` (no ext on the
  listener poll itself), init `POLL_TYPE_SEMI_SOCKET`, `us_poll_start_rc(R)`;
  registration failure (e.g. epoll ENOSPC) → close fd, free poll, report via
  BOTH `*error` and thread-local errno (context.c:379-389). Init
  (context.c:333-367): listener socket fields per R3.3 with `kind = 0`
  ("listener itself never dispatches"), `allow_half_open` from options
  (inherited by accepted sockets), `timeout = long_timeout = 255`; listener
  struct fields per R7.1 (up_ref ssl_ctx, sni = NULL, on_server_name = NULL,
  deferred_accept = 0); link into `head_listen_sockets` + touch group. If
  `options & LIBUS_LISTEN_DEFER_ACCEPT`, `ls->deferred_accept =
bsd_set_defer_accept(fd)` (1 only if the setsockopt succeeded, R8.8).
  `us_socket_group_listen_unix` (context.c:401-424) is identical minus
  defer-accept.
- **R7.3** Accept loop — the SEMI_SOCKET/readable arm (loop.c:468-541):
  `bsd_accept_socket(listen_fd, &addr)`; on error do nothing (no timer yet —
  TODO in source; EMFILE/ENFILE are silently dropped until the next readable
  event). On success loop:
  1. `us_create_poll(loop, 0, sizeof(us_socket_t) - sizeof(us_poll_t) +
socket_ext_size)`; init `POLL_TYPE_SOCKET`; `us_poll_start_rc(R)`. If
     registration fails: `bsd_close_socket(client_fd)` (peer sees RST rather
     than a black hole) + `us_poll_free`, `continue` to the next accept
     (loop.c:485-492).
  2. Stamp fields: `group = accept_group`, `kind = accept_kind`, `ssl=NULL`,
     `connect_state=NULL`, timeouts 255, flags zeroed except
     `allow_half_open` copied from the listener (loop.c:496-507).
  3. `bsd_socket_nodelay(client_fd, 1)` — nodelay always on (loop.c:510).
  4. Link into accept_group.
  5. If `listen_socket->ssl_ctx`: `us_internal_ssl_attach(s, ssl_ctx, 0,
NULL, listen_socket)` then `us_internal_ssl_on_open(s, 0, ip, iplen)`;
     else `us_dispatch_open(s, 0, ip, iplen)` — ip is the raw 4/16-byte
     peer address from accept (loop.c:514-519).
  6. Adoption-forward `s` (R3.6).
  7. If `deferred_accept` and s alive: synchronously re-enter
     `us_internal_dispatch_ready_poll(s, 0, 0, R)` — the client's first
     bytes are already in the buffer; the recv loop tolerates EWOULDBLOCK
     (loop.c:525-532).
  8. If the LISTEN socket got closed by a callback, break out of the accept
     loop (loop.c:534-537).
  9. `bsd_accept_socket` again; loop until it returns error (EAGAIN drains
     the backlog).
     Accepted fds are CLOEXEC+NONBLOCK via accept4 where available; otherwise
     set by `bsd_set_nonblocking(apple_no_sigpipe(fd))` (bsd.c:800-846).
- **R7.4** macOS accept quirk (bsd.c:817-834): if accept returns a socket
  with `addr->len == 0` (XNU bug: dual-stack v4 connection immediately
  RST), probe `recv(MSG_PEEK|MSG_DONTWAIT)`; if no data, close the fd and
  retry accept; if buffered data exists, let the socket through.
- **R7.5** Listener accessors: `us_listen_socket_ext` = ls+1
  (context.c:451-453 — note the listener poll was created without ext, so
  this points one-past the struct into nothing usable unless a future ext is
  added; current callers don't use it), `head_listen_socket`/`next` walk
  (context.c:455-461), `get_fd`, `port` (getsockname), `group` =
  accept_group (context.c:463-473).

---

## 8. BSD LAYER (non-trivial pieces only)

- **R8.1** `bsd_create_socket(domain, type, protocol, *err)`
  (bsd.c:683-717): where SOCK_CLOEXEC|SOCK_NONBLOCK exist, pass them in the
  type (one syscall) and only add `apple_no_sigpipe`; otherwise (mac/Win)
  create then `bsd_set_nonblocking(apple_no_sigpipe(fd))`. EINTR-retried.
  On failure `*err = errno` (if err non-NULL) and returns
  LIBUS_SOCKET_ERROR. `bsd_set_nonblocking` (bsd.c:356-373) sets O_NONBLOCK
  AND FD_CLOEXEC via fcntl on POSIX; on Windows it is a no-op (libuv sets
  FIONBIO at poll init; connect paths use `win32_set_nonblocking`
  explicitly, bsd.c:342-354).
- **R8.2** Addr plumbing: `struct bsd_addr_t` = `{sockaddr_storage mem, len,
char *ip, ip_length, port}` (networking/bsd.h:51-57).
  `internal_finalize_bsd_addr` (bsd.c:743-757) points `ip` INTO `mem`
  (sin_addr / sin6_addr), sets ip_length 4/16, port via ntohs; unknown
  family → ip_length 0, port −1. No string formatting anywhere in the core —
  IPs cross the API as raw bytes.
- **R8.3** `bsd_local_addr`/`bsd_remote_addr` = getsockname/getpeername +
  finalize; −1 on failure (bsd.c:759-775).
- **R8.4** Reuse options (bsd.c:1044-1101): `bsd_set_reuse(fd, options)`
  applies, in order: `SO_EXCLUSIVEADDRUSE` (Windows only, if
  EXCLUSIVE_PORT); if REUSE_ADDR → `bsd_set_reuseaddr` = SO_REUSEPORT on
  non-Linux platforms that have it, else SO_REUSEADDR (bsd.c:1044-1051); if
  REUSE_PORT → SO_REUSEPORT, and if the platform lacks it (ENOTSUP) the
  failure is swallowed UNLESS `LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE`
  (bsd.c:1086-1098). Windows maps missing REUSE_PORT to
  WSAEOPNOTSUPP/ENOTSUP.
- **R8.5** `bsd_bind_listen_fd` (bsd.c:1103-1138): `bsd_set_reuse`; then on
  POSIX ALWAYS set plain SO_REUSEADDR (TIME_WAIT rebinding; never on
  Windows — port stealing, comment bsd.c:1115-1122); if AF_INET6 set
  IPV6_V6ONLY = (options & LIBUS_SOCKET_IPV6_ONLY) (failure is fatal);
  `bind` then `listen(fd, 512)` (both EINTR-retried,
  `us_internal_bind_and_listen` bsd.c:1025-1042; `*error` is set to LIBUS_ERR
  after bind failure AND unconditionally after listen — i.e. `*error` holds
  stale errno 0 on success).
- **R8.6** `bsd_create_listen_socket(host, port, options, *error)`
  (bsd.c:1160-1213): getaddrinfo(AI_PASSIVE, AF_UNSPEC, SOCK_STREAM) on the
  decimal port string; try every AF_INET6 result first, then every AF_INET;
  first successful bind+listen wins; failures close the candidate fd and
  continue. Returns LIBUS_SOCKET_ERROR if all fail. (host may be NULL →
  wildcard.)
- **R8.7** Unix listen/connect long-path handling
  (`bsd_create_unix_socket_address`, bsd.c:1230-1350): empty path → ENOENT.
  Linux: path ≥ sizeof(sun_path) (108) and not abstract → open the dirname
  `O_PATH|O_DIRECTORY` and rewrite the sun_path as
  `/proc/self/fd/<dirfd>/<basename>` (ENAMETOOLONG if even that overflows);
  abstract sockets (leading NUL) use `addrlen = offsetof(sun_path) +
path_len`. macOS: same trick but via `__pthread_fchdir(dirfd)` +relative
  basename around the bind/connect, restored with `__pthread_fchdir(-1)`
  (bsd.c:1389-1414, 1826-1849). Other/too-long → ENAMETOOLONG. Windows
  simulates ENOENT/ENAMETOOLONG via SetLastError. Note: no unlink() of a
  stale socket file — bind fails EADDRINUSE and the caller deals with it.
  Windows maps a bind/listen WSAENETDOWN to ERROR_PATH_NOT_FOUND
  (bsd.c:1362-1370).
- **R8.8** `bsd_set_defer_accept` (bsd.c:1140-1156): Linux
  `TCP_DEFER_ACCEPT = 1` second (nginx-style short timeout); FreeBSD
  `SO_ACCEPTFILTER "dataready"`; returns 1 on setsockopt success, 0 on
  failure or unsupported platform.
- **R8.9** `bsd_create_connect_socket(addr, local_addr, options)`
  (bsd.c:1727-1799): create socket for addr->ss_family. If `local_addr`:
  POSIX sets SO_REUSEADDR first (TIME_WAIT local-port reuse, matching
  libuv; NOT on Windows), bind, and a bind failure closes the fd and
  returns error with errno preserved. Windows: explicit nonblocking; the
  null address (0.0.0.0/::) is rewritten to loopback; loopback destinations
  get `SIO_TCP_INITIAL_RTO` with no SYN retransmissions (fail fast)
  (bsd.c:1760-1790). Then `bsd_do_connect_raw` (bsd.c:1643-1690):
  EINTR-retried connect where EINPROGRESS (POSIX) /
  WSAEINPROGRESS|WSAEWOULDBLOCK|WSAEALREADY (Windows) count as success (0);
  also treats `r == -1 && errno == 0` as success (comment bsd.c:1678-1680).
  Non-zero rc → close fd, return LIBUS_SOCKET_ERROR.
- **R8.10** `bsd_accept_socket` (bsd.c:790-847): accept4(SOCK_CLOEXEC|
  SOCK_NONBLOCK) where available else accept + fixups; EINTR-retried; macOS
  addrlen==0 quirk per R7.4; finalizes the addr.
- **R8.11** recv/send wrappers all EINTR-retry and carry fault-injection
  hooks (§11): `bsd_recv` (bsd.c:849-872; also BUN_DEBUG BUN_RECV/BUN_SEND
  file logging), `bsd_recvmsg`, `bsd_send` (MSG_NOSIGNAL|MSG_DONTWAIT),
  `bsd_sendmsg` (flags passed through), `bsd_writev` (IOV_MAX cap 1024),
  `bsd_write2`.
- **R8.12** Keepalive (`bsd_socket_keepalive`, bsd.c:547-613): SO_KEEPALIVE
  on/off; when on with delay: `delay == 0` → −1 (POSIX) / UV_EINVAL −4071
  (Windows+libuv); TCP_KEEPIDLE (or Darwin TCP_KEEPALIVE) = delay;
  TCP_KEEPINTVL = 1; TCP_KEEPCNT = 10. Returns 0 or the errno /
  WSAGetLastError value (positive).
- **R8.13** TOS (bsd.c:619-673): family detected via getsockname → IP_TOS or
  IPV6_TCLASS; setters return 0 / −errno, getter returns value / −errno.
- **R8.14** Misc option helpers, all thin but with the 6-then-4 fallback
  pattern (`setsockopt_6_or_4`, bsd.c:375-392: try IPPROTO_IPV6 option; on
  ENOPROTOOPT/EINVAL retry the IPv4 option): multicast loopback, TTL
  (validated 1..255 → EINVAL), broadcast, multicast interface (rejects
  multicast-range IPv4 addresses as interfaces, bsd.c:406-435), IGMP
  membership (v4 ip_mreq / v6 ipv6_mreq; iface family must match, else
  EINVAL) and source-specific membership (ip_mreq_source /
  group_source_req) (bsd.c:437-525).

---

## 9. UDP

- **R9.1** `us_udp_socket_t` (internal.h:340-358): poll header + callbacks
  `{on_data, on_drain, on_close, on_recv_error}`, `user`, `loop`, cached
  `port` (bound port, captured once at creation), bits `closed`/`connected`,
  `next` (closed-list link). No ext.
- **R9.2** `us_create_udp_socket(loop, data_cb, drain_cb, close_cb,
recv_error_cb, host, port, flags, *err, user)` (udp.c:149-202):
  `bsd_create_udp_socket` (R9.8) → 0 on failure. Poll of
  `sizeof(us_udp_socket_t)`, `POLL_TYPE_UDP`, `us_poll_start_rc(R|W)` —
  registration failure closes fd, frees poll, reports errno via \*err and
  errno. Cache the bound port via getsockname. Because the poll starts R|W,
  the first tick delivers one writable event → one initial `on_drain`
  (then W is cleared per R9.6).
- **R9.3** `us_udp_socket_close(s)` (udp.c:102-111): `us_poll_stop`, close
  fd, `closed = 1`, push onto `loop->data.closed_udp_head`, then call
  `s->on_close(s)` synchronously. Memory freed in loop_post (R1.15).
- **R9.4** Receive path (loop.c:802-914), the POLL_TYPE_UDP dispatch arm:
  1. If `u->closed`, ignore entirely.
  2. **Linux error-queue drain** (loop.c:808-843): if `error` (EPOLLERR),
     loop `recvmsg(fd, MSG_ERRQUEUE)` until it fails, extracting
     `sock_extended_err.ee_errno` from IP_RECVERR/IPV6_RECVERR cmsgs and
     calling `on_recv_error(u, ee ?: ECONNREFUSED)` per queued ICMP error.
     The socket stays open. Track `recv_error_surfaced`.
  3. If `events & R` and not closed: loop — `bsd_udp_setup_recvbuf` over the
     loop's shared recv_buf (LIBUS_RECV_BUFFER_LENGTH), `npackets =
bsd_recvmmsg(fd, &recvbuf, MSG_DONTWAIT)`: - `> 0` → `u->on_data(u, &recvbuf, npackets)`; repeat while not closed. - `== LIBUS_SOCKET_ERROR` and not would-block: Linux → surface errno
     via on_recv_error (socket stays open, `recv_error_surfaced = 1`);
     non-Linux → set `error = 1` (falls through to close). Would-block on
     Linux sets `recv_would_block_only`. - `== 0` → done.
  4. If `events & W` and not closed: `us_poll_change(events & R)` — clear W
     BEFORE `on_drain` so a callback that re-arms W keeps the re-arm; also
     ensures a level-triggered EPOLLOUT+EPOLLERR combo can't spin
     (loop.c:885-897). Then `u->on_drain(u)`.
  5. Close-on-error: Linux — only if `error && !recv_error_surfaced &&
!recv_would_block_only && !closed` (residual unexplained EPOLLERR);
     elsewhere — any `error` closes via `us_udp_socket_close`
     (loop.c:899-913).
- **R9.5** Packet buffer layout (`udp_recvbuf`, networking/bsd.h:140-152):
  POSIX — 8 mmsghdr + 8 iovec (each iov = 64 KiB slice of the shared
  recv_buf at `i * LIBUS_UDP_MAX_SIZE`) + 8 sockaddr_storage + 8×256-byte
  control buffers, wired by `bsd_udp_setup_recvbuf` (bsd.c:179-201). Windows
  — single buf/len/recvlen/addr (one packet per recv). Accessors
  (udp.c:27-45 → bsd.c:259-330): payload pointer/length (length clamped to
  LIBUS_UDP_MAX_SIZE), peer sockaddr pointer, truncated = MSG_TRUNC flag
  (always 0 on Windows), local (destination) IP from
  IP_PKTINFO/IP_RECVDSTADDR/IPV6_PKTINFO cmsg (4/16 bytes; unsupported on
  Windows/macOS → 0).
- **R9.6** `bsd_recvmmsg` (bsd.c:130-177): Linux/FreeBSD recvmmsg (EINTR
  retry); macOS `recvmsg_x` when supported (probed once via
  `Bun__doesMacOSVersionSupportSendRecvMsgX`) else a recvmsg loop that
  returns `i` on EAGAIN; Windows single recvfrom, swallowing
  WSAECONNRESET/WSAENETRESET (per-destination ICMP, retry — matches libuv,
  bsd.c:138-144). Returns packet count or −1.
- **R9.7** Send path: `us_udp_socket_send(s, payloads, lengths, addresses,
num)` (udp.c:47-72): batches through the loop's 16 KiB `send_buf` via
  `bsd_udp_setup_sendbuf` (bsd.c:203-254 — builds mmsghdr+iovec arrays in
  place, capacity `(16384 - hdr) / (sizeof(mmsghdr)+sizeof(iovec))`;
  computes per-address socklen; tracks has_empty/has_addresses for the macOS
  sendmsg_x eligibility), `bsd_sendmmsg(fd, buf, MSG_DONTWAIT)` (bsd.c:69-128:
  Linux sendmmsg | MSG_NOSIGNAL; macOS sendmsg_x when supported and no
  addresses/empties, else sendmsg loop returning i on EAGAIN; Windows
  send/sendto loop). Negative send → return it. Partial (`sent < num` after
  the bookkeeping — see OQ-1, the arithmetic is suspect) → re-arm W via
  `us_poll_change(R|W)` so on_drain fires later. Returns packets sent.
- **R9.8** `bsd_create_udp_socket(host, port, options, *err)`
  (bsd.c:1417-1556): getaddrinfo(AI_PASSIVE, SOCK_DGRAM); prefer AF_INET6
  result, else AF_INET; getaddrinfo failure reports `*err = -gai_code`.
  Then: `bsd_set_reuse(options)` (same bits as TCP);
  IPV6_V6ONLY per options for v6; enable destination-address reporting
  (IPV6_RECVPKTINFO, falling back to IP_PKTINFO / IP_RECVDSTADDR); enable
  ECN/TOS reporting (IPV6_RECVTCLASS → IP_RECVTOS fallback); Windows —
  disable SIO_UDP_CONNRESET and SIO_UDP_NETRESET at the source; Linux —
  IP_RECVERR always and IPV6_RECVERR for v6 (surface ICMP errors, matches
  libuv); finally bind. Any failure closes the fd and reports errno.
- **R9.9** Connect/disconnect (udp.c:125-131 → bsd.c:1558-1610):
  `bsd_connect_udp_socket` getaddrinfo's host:port (returning the gai error
  as-is if nonzero) and connect()s the first address that succeeds (−1 if
  none). `bsd_disconnect_udp_socket` connects to AF_UNSPEC, treating
  EAFNOSUPPORT/WSAEAFNOSUPPORT as success. NOTE: `u->connected` bit is
  declared but never written by the core. Option setters (broadcast, TTLs,
  multicast loopback/interface/membership/source-specific, udp.c:113-147)
  are direct pass-throughs to §R8.14 helpers.

---

## 10. WAKEUP / DEFER

- **R10.1** `us_wakeup_loop(loop)` (loop.c:160-165), callable from ANY
  thread: on epoll/kqueue, `atomic_fetch_add(&loop->pending_wakeups, 1,
RELEASE)` FIRST, then `us_internal_async_wakeup(loop->data.wakeup_async)`.
  On libuv, just uv_async_send (no pending_wakeups field is consumed there).
- **R10.2** Coalescing/GC-safepoint interplay: `pending_wakeups` is swapped
  to 0 with ACQUIRE at the top of every bun tick (R1.10.5). Any nonzero
  value (however many wakeups coalesced) makes `will_idle` false, which (a)
  skips `Bun__JSC_onBeforeWait` (the GC safepoint must not run when a
  cross-thread task is already waiting) and (b) on kqueue forces
  KEVENT_FLAG_IMMEDIATE. The wakeup async ALSO fires as a ready poll, whose
  CALLBACK dispatch invokes the loop's `wakeup_cb` (R1.4/R2.12) — the
  counter is an optimization layered on top, not a replacement for the
  async. Consumers: `src/jsc/event_loop.rs` `wakeup()` →
  `us_wakeup_loop` (src/uws_sys/Loop.rs:239,461).
- **R10.3** The wakeup async is created with `fallthrough = 1` (does not
  count toward num_polls → does not keep the loop alive; loop.c:136).
- **R10.4** Async backend implementations (all satisfy: N wakeup() calls
  from any threads → ≥1 callback invocation on the loop thread; callback
  receives the LOOP pointer since `cb_expects_the_loop = 1`):
  - **Linux** (epoll_kqueue.c:608-668): eventfd(EFD_NONBLOCK|EFD_CLOEXEC),
    PANIC (`BUN_PANIC`) if eventfd fails. Registered EPOLLIN, then upgraded
    to EPOLLIN|EPOLLET; `leave_poll_ready = 1` so dispatch never reads the
    eventfd (edge-triggered = self-clearing for our purposes). wakeup =
    write(8-byte 1), on EAGAIN (counter overflow) drain via read and retry.
  - **macOS** (epoll_kqueue.c:669-803): EVFILT_MACHPORT with
    MACH_RCV_MSG|MACH_RCV_OVERWRITE into a 1024-byte buffer; port queue
    limit 1 (qlimit 1) so sends coalesce; wakeup = non-blocking mach_msg
    send where TIMED_OUT/NO_BUFFER count as success (port full = already
    pending). `us_internal_async_set` aborts on registration failure.
    Close: EV_DELETE, deallocate port, free buffer, `us_poll_free`.
  - **FreeBSD** (epoll_kqueue.c:805-860): EVFILT_USER, EV_ADD|EV_ENABLE|
    EV_CLEAR; wakeup submits NOTE_TRIGGER with NO eventlist (an eventlist
    could consume the wakeup on the posting thread, comment
    epoll_kqueue.c:856-858).
  - **libuv** (libuv.c:325-366): uv_async, unreffed; async_cb passes
    `cb->loop`.
- **R10.5** There is NO `us_loop_defer`/`defer_callback` in this fork — the
  upstream deferring mechanism was removed. Cross-thread deferral is built
  in Bun on top of `us_wakeup_loop` + the wakeup_cb (which drains Bun's own
  concurrent task queue). The only C-side deferred queues are dns_ready
  (R6.5) and the three closed lists (R1.15). The implementation MUST NOT invent
  one.
- **R10.6** `us_internal_dns_callback[_threadsafe]` locking uses
  `Bun__lock/Bun__unlock` on `loop->data.mutex` (a Zig-implemented mutex
  whose size is ABI-checked at loop init, R1.4). All other loop state is
  loop-thread-only; `pending_wakeups` and the fault-inject `us_fault_armed`
  flag are the only atomics.

---

## 11. FAULT INJECTION (fault_inject.c, internal/fault_inject.h)

- **R11.1** Compiled only under `LIBUS_SOCKET_FAULT_INJECTION`; otherwise
  `US_FAULT_CHECK(...)` is the constant 0 (fault_inject.h:95-98). In Rust
  this becomes `#[cfg(feature = "fault-injection")]`.
- **R11.2** Hook points (all in bsd.c, before the real syscall):
  `US_FAULT_RECV` in bsd_recv (bsd.c:850-851), `US_FAULT_SEND` in bsd_send
  (bsd.c:957-958), `US_FAULT_WRITEV` in BOTH bsd_writev and bsd_write2
  (bsd.c:895-896, 913-914), `US_FAULT_SENDMSG` in bsd_sendmsg
  (bsd.c:990-991), `US_FAULT_RECVMSG` in bsd_recvmsg (bsd.c:876-877),
  `US_FAULT_CONNECT` in bsd_do_connect_raw (bsd.c:1645-1646 — on fire the
  function returns `errno` as the connect error), `US_FAULT_ACCEPT` in
  bsd_accept_socket (bsd.c:793-794 — fire → return LIBUS_SOCKET_ERROR).
  `US_FAULT_SOCKET/CLOSE/SHUTDOWN` are reserved (no hooks);
  `US_FAULT_SSL_LOOP_BUFFER` simulates the one-shot TLS loop-buffer
  allocation failure (hook lives in crypto/openssl.c, ERRNO action only).
- **R11.3** Rule = `{action, errno_value, clamp_bytes, after_n_calls,
repeat (−1 = forever), target_fd (−1 = any)}` (fault_inject.h:61-71).
  Actions: ERRNO → return −1 with errno (and WSASetLastError on Windows);
  ZERO → return 0 (recv: peer closed; send: backpressure); SHORT → clamp
  the length lvalue in place and let the real syscall run
  (fault_inject.c:94-112).
- **R11.4** State: one slot per syscall, process-global (rules armed on the
  JS thread must affect the HTTP/worker threads; per-socket isolation via
  target_fd — fault_inject.c:17-20). Guarded by `us_fault_lock`
  (zig_mutex_t); the hot path is a single acquire-load of `us_fault_armed`
  (recomputed with release-store whenever any rule is non-NONE)
  (fault_inject.c:26-40, macro fault_inject.h:91-93).
- **R11.5** Firing semantics (fault_inject.c:71-113): under the lock,
  snapshot the rule; if action != NONE and fd matches: `calls_seen++`; fire
  only once `calls_seen > after_n_calls` (i.e. skip the first N matching
  calls); `fired++`; when `repeat >= 0 && fired > repeat` the rule disarms
  itself instead of firing. The action switch runs OUTSIDE the lock on the
  snapshot. API: `us_fault_set(sc, rule)` (resets counters),
  `us_fault_clear(sc)`, `us_fault_clear_all()`.

---

## 12. EXTERN HOOKS INTO BUN (become direct Rust calls)

All are declared in internal.h / at use sites; the Rust implementation calls the
same symbols (or their Rust homes) directly:

- **R12.1** `Bun__panic(msg, len)` — noreturn; via `BUN_PANIC(lit)` macro
  (internal.h:71-72). Core call sites: mutex-size mismatch (loop.c:140,
  ASSERT_ENABLED only) and eventfd failure (epoll_kqueue.c:617).
- **R12.2** `Bun__outOfMemory()` — noreturn (internal.h:76). Call site:
  recv_buf/send_buf malloc failure (loop.c:133). Additionally
  `us_malloc/us_calloc` are plain malloc/calloc by default
  (libusockets.h:19-33) but in the Bun build map to mimalloc which aborts
  on OOM — allocations in this library are otherwise unchecked (comment
  context.c:607-610).
- **R12.3** `Bun__lock/Bun__unlock(zig_mutex_t*)` (internal.h:107-108) — used
  for `loop->data.mutex` (dns_ready list) and the fault-inject lock.
  `Bun__lock__size` ABI check (loop.c:44,138-142).
- **R12.4** DNS bridge: `Bun__addrinfo_get / _set / _cancel / _freeRequest /
_getRequestResult` (internal.h:140-144) — contract in R6.5. The result
  shape is `struct addrinfo_result { addrinfo_result_entry *entries; int
error }` where each entry embeds an `addrinfo` + `sockaddr_storage`
  (internal.h:110-118); entries are chained via `info.ai_next`.
- **R12.5** Dispatch layer: `us_dispatch_open/data/fd/writable/close/timeout/
long_timeout/end/connect_error/connecting_error/handshake/session/keylog/
ssl_raw_tap` (internal.h:120-138) — implemented in
  `src/runtime/socket/uws_dispatch.rs`; switches on `s->kind`, falling back
  to `s->group->vtable` for C++ (uWS) kinds. loop.c NEVER reads the vtable
  directly.
- **R12.6** `Bun__internal_dispatch_ready_poll(loop, tagged_poll)`
  (epoll_kqueue.c:24) — routes tagged (bits 48-63 set) ready-poll pointers
  to Bun's FilePoll machinery.
- **R12.7** `Bun__JSC_onBeforeWait(jsc_vm)` (epoll_kqueue.c:357) — GC
  safepoint before an idle-capable poll (R1.10.7).
- **R12.8** `Bun__isEpollPwait2SupportedOnLinuxKernel()` (epoll_kqueue.c:152)
  and `sys_epoll_pwait2` (raw syscall shim, epoll_kqueue.c:119-120, lives in
  src/platform).
- **R12.9** `Bun__internal_ensureDateHeaderTimerIsEnabled(loop)` (loop.c:47)
  — called when the sweep refcount goes 0→1 (R5.5).
- **R12.10** `Bun__doesMacOSVersionSupportSendRecvMsgX()` (bsd.c:64) — gates
  sendmsg_x/recvmsg_x.
- **R12.11** TLS boundary (crypto/openssl.c, out of scope but the symbols
  the core links against): `us_internal_ssl_{attach, detach, close, on_open,
on_data, on_writable, on_close, on_end, shutdown, write, is_low_prio,
is_shut_down, is_handshake_finished, handshake_callback_has_fired,
get_native_handle, verify_error, socket_relocated, ctx_up_ref, ctx_unref}`
  and `us_internal_listen_socket_ssl_free` (internal.h:162-234).
- **R12.12** QUIC boundary: `us_quic_loop_process(loop)` under
  LIBUS_USE_QUIC (loop.c:401-413) plus `quic_next_tick_us` folding
  (R1.10.3).

---

## Documented C-parity quirks (OQ-1 … OQ-16)

The replaced C implementation contained the following apparent bugs. Each is
preserved deliberately as a documented quirk (callers already compensate),
except where an entry states an explicit fix.

- **OQ-1: `us_udp_socket_send` batching arithmetic is broken**
  (udp.c:54-70). `num` is decremented by `count` per batch, yet both the
  loop condition (`total_sent < num`) and the partial-send re-arm test
  (`sent < num`) compare against the _post-decrement remaining_ count.
  Observable consequences: (a) a partial send within the FINAL batch never
  arms writable (`sent < 0` is false when num reached 0) — the drain
  callback for the common single-batch case is never scheduled by this
  function; (b) a fully-sent batch with more batches remaining SPURIOUSLY
  arms writable; (c) the loop exits once `total_sent >= remaining`, which
  can strand later batches unsent while still returning a short count.
  Callers see the short return and handle retry themselves, which is why
  this is latent. The arithmetic is preserved
  bit-for-bit: callers see the short return and retry.
- **OQ-2: `us_socket_write` / `raw_write*` / `write2` / `ipc_write_fd`
  re-arm READABLE on paused sockets.** They all issue `us_poll_change(R|W)`
  as an absolute set on short write (socket.c:406,478,503,514,531,550,587),
  which silently un-pauses the readable side of a socket paused via
  `us_socket_pause`. `is_paused` remains 1, so `us_socket_resume` becomes a
  no-op for the R bit it thinks it's restoring. Whether upper layers depend
  on this accidental resume is unknown.
- **OQ-3: `us_socket_write2` does not set `flags.last_write_failed`**
  (socket.c:399-410), unlike every other write. After a partial write2, the
  next writable dispatch sees `last_write_failed == 0` and immediately
  disarms W (loop.c:576-577) — the on_writable callback still fires once,
  so callers that retry from on_writable are fine, but the "keep W armed
  until drained" invariant differs from us_socket_write. Intentional or
  oversight?
- **OQ-4: `us_poll_resize` on epoll with zero events leaves a stale kernel
  data.ptr.** epoll_kqueue.c:499-502 strips polling bits then calls
  `us_poll_change(new_p, loop, events)`; if `events == 0`, poll_change
  no-ops (old==new==0) and no EPOLL_CTL_MOD updates `data.ptr` to `new_p`.
  A subsequent EPOLLHUP/EPOLLERR (always delivered) would surface the OLD
  (freed-after-adopt) pointer. Reachable only by adopting+resizing a socket
  that polls for nothing (fully paused half-open). kqueue re-registers both
  filters unconditionally and doesn't have this hole. Structurally fixed here:
  dispatch validates the slot generation, so a stale kernel pointer resolves
  to a dead slot and the event is dropped.
- **OQ-5: `us_connecting_socket_t` timeouts never fire during DNS
  resolution.** The sweep only walks `head_sockets`;
  `head_connecting_sockets` is never swept, so `c->timeout` is only a
  template copied onto attempt sockets (context.c:688). A hostname whose
  resolution hangs is bounded only by the resolver, not by
  `us_connecting_socket_timeout`. This is the intended contract: the resolver bounds the DNS phase.
- **OQ-6: low-prio parking `break`s out of the whole dispatch case**
  (loop.c:611,632), discarding a simultaneous eof/error flag for that
  event. The socket is re-dispatched later from the queue with fabricated
  `(0, 0, R)`-style events only via poll re-arm, so a coincident EOF is
  re-learned from recv() returning 0 — behavior is preserved end-to-end and
  the implementation must not "helpfully" handle eof before parking.
- **OQ-7: adopt of a happy-eyeballs attempt assumes it is
  `connecting_head`.** context.c:307 sets `c->connecting_head = new_s`
  unconditionally; if the adopted attempt were not the list head, the other
  attempts would be dropped from the list (and the old head leaked from
  c's perspective). Current Bun callers only adopt after promotion
  (connect_state == NULL), so the branch may be dead in practice.
- **OQ-8: `us_internal_bind_and_listen` writes `*error = LIBUS_ERR` even on
  success** (bsd.c:1039), i.e. `*error` may hold a stale errno from an
  unrelated earlier syscall when listen succeeds. Callers only read it on
  failure; the out-param is defined as failure-only.
- **OQ-9: `bsd_would_block` ignores EAGAIN** (bsd.c:1009 — `|| errno ==
EAGAIN` commented out). Identical to EWOULDBLOCK on Linux/macOS/FreeBSD/
  Windows targets Bun supports, so no observable difference today; the
  literal check is preserved.
- **OQ-10: SEMI_SOCKET skip test in close_raw uses a bitmask, not
  equality** (socket.c:317: `!(poll_type & POLL_TYPE_SEMI_SOCKET)`). Since
  SEMI_SOCKET == 2 and the other socket kinds are 0/1, this is equivalent
  today, but UDP (4) and CALLBACK (3=0b011!) would also test true for bit
  2... CALLBACK (3) has bit 1 set (0b11): `3 & 2 = 2` → a CALLBACK poll
  would be treated as SEMI_SOCKET here. close_raw is never called on
  CALLBACK polls, so latent-only. Implemented as `kind == SEMI_SOCKET` (equality).
- **OQ-11: `us_socket_write` on fatal errors polls writable forever.** By
  design (R4.1) fatal send errors look like would-block until the error
  event arrives; on kqueue the EVFILT_WRITE re-add generally reports
  EV_EOF/EV_ERROR promptly, on epoll EPOLLERR is level-triggered. This is
  the pre-fc865b39 behavior retained for plain `us_socket_write`; only
  `write_check_error` opts out. Preserve exactly.
- **OQ-12: `us_get_remote_address_info` / `us_get_local_address_info` never
  write `dest`/`is_ipv6`** (socket.c:651-689) despite the signature.
  Callers must already derive family from the returned length. Preserve
  (don't start writing the out-params — callers may pass garbage pointers).
- **OQ-13: num_polls accounting asymmetry.** `us_create_poll(fallthrough=1)`
  skips the increment but `us_poll_free` always decrements
  (epoll_kqueue.c:63-74). The wakeup async is created fallthrough and freed
  through `us_internal_async_close` → `us_poll_free`, so a loop's num_polls
  can go negative at teardown (harmless there, but the invariant
  "num_polls == live non-fallthrough polls" is not strictly maintained).
  On macOS/FreeBSD the async is `us_calloc`'d directly (not via
  us_create_poll) yet still honors `fallthrough` for the increment
  (epoll_kqueue.c:683-685, 815-817) and frees via us_poll_free — same
  asymmetry. The exact arithmetic is preserved, not the ideal.
- **OQ-14: DNS keep-alive uses `num_polls++` on POSIX**
  (context.c:625-629) — a pending resolution keeps `us_loop_run` alive by
  faking a poll. `us_loop_run_bun_tick`'s `num_polls == 0` early-return
  interacts with this too. The loop reproduces this counter
  semantics rather than a separate pending count.
- **OQ-15: `us_socket_group_connect`'s header comment names the out-param
  `is_connecting`** (libusockets.h:378-386) with the opposite polarity of
  the implementation's `has_dns_resolved` (context.c:570): the value is 1
  when a real `us_socket_t*` is returned. The implementation is the truth;
  fix the doc, not the behavior.
- **OQ-16: libuv sweep refcount never actually disables the sweep** — see
  R5.5: `us_internal_disable_sweep_timer`'s `us_timer_set(noop, 0, 0)` is
  swallowed by the sweep-timer one-shot guard in libuv.c:300-305, so
  `sweep_timer_count` reaching 0 has no effect on Windows. Harmless (empty
  sweep, unreffed timer) but the POSIX and libuv backends genuinely differ.
