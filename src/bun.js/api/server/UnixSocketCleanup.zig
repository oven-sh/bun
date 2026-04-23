//! Tracks unix domain socket paths that `Bun.serve` / `Bun.listen` currently
//! own, so they can be unlinked from an `atexit()` hook or a signal handler
//! if the process terminates without a clean `server.stop()` / `listener.stop()`.
//!
//! Design constraints:
//! - Must be async-signal-safe when walked from a SIGINT/SIGTERM handler.
//!   `unlink(2)` is on the POSIX async-signal-safe list; anything else we do
//!   here must avoid malloc/free and lock acquisition.
//! - Register/unregister is called from the JS main thread, under normal
//!   circumstances infrequently (one or two unix listeners per process).
//!
//! Implementation: append-only singly linked list with CAS at the head.
//! `unregister` only flips an atomic tombstone flag (it does NOT touch the
//! filesystem — the caller is responsible for calling `bun.sys.unlink`
//! separately, and must do so AFTER `unregister` to close the
//! tombstone-vs-unlink race; see `unregister` docs). Nodes are never freed
//! (total leak is bounded by the number of unix listeners ever created in
//! the process lifetime) — this keeps the signal-handler walk wait-free.

const Node = struct {
    /// Null-terminated owned slice in `bun.default_allocator`. Never mutated
    /// or freed after publication so the signal handler can read it safely.
    path: [:0]const u8,
    tombstoned: std.atomic.Value(bool),
    next: std.atomic.Value(?*Node),
};

var head: std.atomic.Value(?*Node) = .init(null);

/// Opaque handle returned from `register`; pass to `unregister` on clean stop.
pub const Handle = *Node;

/// Register a unix socket path for cleanup on unexpected process termination.
///
/// - `path` is copied into a new null-terminated buffer owned by the registry
///   (the caller retains its own copy).
/// - Returns null for empty or abstract (`path[0] == 0`) sockets, since those
///   have no filesystem entry to remove.
/// - Safe to call on the main thread during `onListen`.
pub fn register(path: []const u8) ?Handle {
    if (path.len == 0 or path[0] == 0) return null;

    // Allocator failures here are OOM-only — crash via `handleOom` rather
    // than silently starting a listener that is missing from the cleanup
    // registry (which would be indistinguishable from the "abstract
    // socket" early return above).
    const node = bun.handleOom(bun.default_allocator.create(Node));
    const path_dup = bun.handleOom(bun.default_allocator.dupeZ(u8, path));

    node.* = .{
        .path = path_dup,
        .tombstoned = .init(false),
        .next = .init(null),
    };

    // CAS node into the head of the list.
    var current = head.load(.acquire);
    while (true) {
        node.next.store(current, .release);
        const res = head.cmpxchgWeak(current, node, .acq_rel, .acquire);
        if (res == null) break;
        current = res.?;
    }

    return node;
}

/// Mark a node tombstoned so the cleanup walk will skip it. Purely
/// bookkeeping — this does NOT touch the filesystem. The caller must
/// still `bun.sys.unlink` the path separately.
///
/// **Call order matters**: the clean `stopListening()` path MUST call
/// `unregister` BEFORE `unlink`, not after. If a signal arrives between
/// `unlink` and `unregister`, the cleanup walk would see the node as
/// live and re-unlink the path — which would be wrong if another
/// process has already bound a new socket at the same path in that
/// window. Tombstoning first closes that race.
///
/// Nodes are never actually removed from the list (see module docs) so
/// this is a plain atomic flag set.
pub fn unregister(handle: ?Handle) void {
    const node = handle orelse return;
    node.tombstoned.store(true, .release);
}

/// Walk the registered-but-not-tombstoned nodes and unlink each path.
///
/// Intended to be called from `atexit()` and, via an `extern "C"` shim,
/// from a SIGINT/SIGTERM handler. We call `unlink(2)` directly via
/// `std.posix.system.unlink` — `bun.sys.unlink` logs on debug builds
/// via a scoped logger that takes a mutex and writes to stdio, which is
/// NOT async-signal-safe and could deadlock/reenter if a signal arrives
/// while the main thread holds that lock. Raw `unlink(2)` is on the
/// POSIX async-signal-safe list.
///
/// Concurrency: `cleanupAll` can be re-entered — the signal handler may
/// preempt an in-progress `atexit` walk, since POSIX doesn't block
/// signals during atexit callbacks. We claim each node with an atomic
/// compare-and-swap so that only one caller issues `unlink(2)` for a
/// given path. This matters in the pathological case where another
/// process binds a new socket at the same path in the nanoseconds
/// between one caller's `unlink` and a second redundant `unlink` from
/// the re-entrant walk — the CAS prevents the second call entirely.
pub fn cleanupAll() void {
    var cur = head.load(.acquire);
    while (cur) |node| : (cur = node.next.load(.acquire)) {
        // Atomically claim the right to unlink this node. If another
        // `cleanupAll` caller (or the signal handler preempting us) has
        // already flipped the tombstone, this CAS returns the old `true`
        // and we skip. Otherwise we are the sole unlinker for this path.
        if (node.tombstoned.cmpxchgStrong(false, true, .acq_rel, .acquire) != null) continue;
        // Best-effort: errors here (ENOENT if already removed, EACCES if
        // chmod'd, etc.) are intentionally swallowed — we're on the
        // termination path and have no way to report them. We don't
        // retry on EINTR either: a second signal during exit is going
        // to be handled by the kernel's default disposition anyway.
        _ = std.posix.system.unlink(node.path.ptr);
    }
}

/// C entry point for the atexit hook and signal handler shim.
pub export fn Bun__cleanupUnixSocketPaths() void {
    cleanupAll();
}

const bun = @import("bun");
const std = @import("std");
