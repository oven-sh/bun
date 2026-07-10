/*
 * uSockets Windows eventing backend — C-side struct definitions for the Rust
 * implementation in src/iocp/usockets.rs (crate `bun_iocp`).
 *
 * Replaces internal/eventing/libuv.h at the rewire flip (internal.h gains a
 * branch including this header instead). The NORMATIVE contract is
 * USOCKETS_EVENTING_CONTRACT.md at the repo worktree root.
 *
 * Every static_assert below has a twin `const _` assert in usockets.rs using
 * the SAME literal — a layout change on either side fails both compiles.
 */

#ifndef BUN_IOCP_H
#define BUN_IOCP_H

#include "internal/loop_data.h"

/* Backend-chosen readiness bits (match kqueue's 1/2 and, bit-for-bit, the
 * bun_iocp AfdPoll POLL_READABLE/POLL_WRITABLE). */
#define LIBUS_SOCKET_READABLE 1
#define LIBUS_SOCKET_WRITABLE 2

#if defined(__cplusplus)
#define BUN_IOCP_STATIC_ASSERT(c, m) static_assert(c, m)
#else
#define BUN_IOCP_STATIC_ASSERT(c, m) _Static_assert(c, m)
#endif

struct us_loop_t {
  /* MUST stay first / offset 0: us_loop_ext() in shared loop.c computes
   * `loop + 1`, so both the offset and sizeof(struct us_loop_t) are ABI
   * (uWS LoopData placement-new sizes its allocation off them). */
  alignas(LIBUS_EXT_ALIGNMENT) struct us_internal_loop_data_t data;

  /* Incremented by us_wakeup_loop() (shared loop.c, by name, any thread);
   * atomically exchanged to 0 at the top of us_loop_run_bun_tick to decide
   * whether the tick may idle (GC-safepoint gate). Accessed only via
   * __atomic builtins on the C side / AtomicU32 on the Rust side. */
  unsigned int pending_wakeups;

  /* Opaque Rust backend state (bun_iocp usockets::Backend: native loop
   * pointer, async delivery list, before-wait slot, is_default flag).
   * Layout-asserted from Rust; C must never read or write it. */
  void *bun_backend[4];
};

struct us_poll_t {
  /* Heap-split native watcher (bun_iocp NativePoll), the uv_poll_t
   * analogue: separately allocated so us_poll_resize can move this block
   * while kernel I/O is in flight. NULL after a resize moved the poll to a
   * new block (this block then no longer owns the watcher). */
  void *backend_handle;
  LIBUS_SOCKET_DESCRIPTOR fd; /* SOCKET — 8 bytes; never the POSIX bitfield */
  unsigned char poll_type;
};

/* ── frozen layout (twin asserts in src/iocp/usockets.rs) ─────────────── */
BUN_IOCP_STATIC_ASSERT(sizeof(struct us_internal_loop_data_t) == 200,
                       "us_internal_loop_data_t layout drifted — update "
                       "src/iocp/usockets.rs::LoopData and "
                       "src/uws_sys/InternalLoopData.rs together");
BUN_IOCP_STATIC_ASSERT(offsetof(struct us_internal_loop_data_t, sweep_timer) == 0,
                       "sweep_timer offset");
BUN_IOCP_STATIC_ASSERT(offsetof(struct us_internal_loop_data_t, quic_head) == 32,
                       "quic_head offset");
BUN_IOCP_STATIC_ASSERT(offsetof(struct us_internal_loop_data_t, quic_next_tick_us) == 40,
                       "quic_next_tick_us offset");
BUN_IOCP_STATIC_ASSERT(offsetof(struct us_internal_loop_data_t, quic_timer) == 48,
                       "quic_timer offset");
BUN_IOCP_STATIC_ASSERT(offsetof(struct us_internal_loop_data_t, iteration_nr) == 176,
                       "iteration_nr offset");
BUN_IOCP_STATIC_ASSERT(offsetof(struct us_internal_loop_data_t, jsc_vm) == 184,
                       "jsc_vm offset");
BUN_IOCP_STATIC_ASSERT(offsetof(struct us_internal_loop_data_t, tick_depth) == 192,
                       "tick_depth offset");
BUN_IOCP_STATIC_ASSERT(offsetof(struct us_loop_t, data) == 0, "data must sit at offset 0");
BUN_IOCP_STATIC_ASSERT(offsetof(struct us_loop_t, pending_wakeups) == 200,
                       "pending_wakeups offset");
BUN_IOCP_STATIC_ASSERT(sizeof(struct us_loop_t) == 240,
                       "us_loop_t size is ABI (us_loop_ext = loop + 1)");
BUN_IOCP_STATIC_ASSERT(sizeof(struct us_poll_t) == 24, "us_poll_t size");
BUN_IOCP_STATIC_ASSERT(offsetof(struct us_poll_t, fd) == 8, "fd offset");
BUN_IOCP_STATIC_ASSERT(offsetof(struct us_poll_t, poll_type) == 16, "poll_type offset");

/* us_internal_callback_t is defined later, in internal/internal.h (it embeds
 * us_poll_t). Its first-two-fields prefix is hard ABI (loop.c:326 reads
 * cb->loop through a us_timer_t* cast); the Rust mirror asserts the same
 * numbers. At the rewire, add these to internal.h after the definition:
 *   _Static_assert(sizeof(struct us_internal_callback_t) == 64, "...");
 *   _Static_assert(offsetof(struct us_internal_callback_t, loop) == 24, "...");
 */

#if defined(__cplusplus)
extern "C" {
#endif

/* One loop iteration honoring `timeout` (NULL = block until work, {0,0} =
 * non-blocking). WINDOWS ABI NOTE: the Rust backend reads the timeout as
 * { int64_t sec; int64_t nsec; } (bun_core::util::Timespec). ucrt's
 * `struct timespec` has a 4-byte tv_nsec and is NOT layout-compatible — the
 * only callers on Windows are Rust (src/uws_sys/Loop.rs); do not call this
 * from C with a ucrt timespec. */
struct timespec;
void us_loop_run_bun_tick(struct us_loop_t *loop, const struct timespec *timeout);

/* One non-blocking turn (no other C declaration exists; the symbol name is
 * load-bearing for the Rust extern). */
void us_loop_pump(struct us_loop_t *loop);

/* The real keep-alive API replacing the libuv-era
 * `loop->uv_loop->active_handles` pokes. One coherent refcount: explicit
 * units here + non-fallthrough timers; polls and the wakeup async never
 * count. The loop's blocking entry points return immediately when the count
 * (plus in-flight/closing work) is zero. */
void us_loop_add_active(struct us_loop_t *loop, unsigned int count);
void us_loop_sub_active(struct us_loop_t *loop, unsigned int count);
unsigned int us_loop_active_count(struct us_loop_t *loop);

/* GC-safepoint slot: `cb` is invoked with loop->data.jsc_vm when a bun tick
 * is about to idle (no pending wakeups, nonzero timeout, about to block).
 * Wire Bun__JSC_onBeforeWait here once per VM loop, after setting jsc_vm. */
void us_loop_set_on_before_wait(struct us_loop_t *loop, void (*cb)(void *jsc_vm));

#if defined(__cplusplus)
}
#endif

#endif /* BUN_IOCP_H */
