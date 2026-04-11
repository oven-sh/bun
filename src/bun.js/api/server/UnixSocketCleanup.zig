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
//! Unregister just flips an atomic tombstone flag and eagerly calls
//! `unlink` so the cleanup walk can skip the node. Nodes are never freed
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

    const node = bun.default_allocator.create(Node) catch return null;
    const path_dup = bun.default_allocator.dupeZ(u8, path) catch {
        bun.default_allocator.destroy(node);
        return null;
    };

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

/// Mark a node tombstoned so the cleanup walk will skip it. Called from a
/// clean `stopListening()` path after the path has already been unlinked —
/// this is purely bookkeeping, it does NOT touch the filesystem.
///
/// Nodes are never actually removed from the list (see module docs) so this
/// is a plain atomic flag set.
pub fn unregister(handle: ?Handle) void {
    const node = handle orelse return;
    node.tombstoned.store(true, .release);
}

/// Walk the registered-but-not-tombstoned nodes and unlink each path.
///
/// Intended to be called from `atexit()` and, via an `extern "C"` shim,
/// from a SIGINT/SIGTERM handler. Uses only `unlink(2)` on the syscall
/// path, which is async-signal-safe.
pub fn cleanupAll() void {
    var cur = head.load(.acquire);
    while (cur) |node| : (cur = node.next.load(.acquire)) {
        if (node.tombstoned.load(.acquire)) continue;
        // Best-effort: errors here (ENOENT if already removed, EACCES if
        // chmod'd, etc.) are intentionally swallowed — we're on the
        // termination path and have no way to report them.
        _ = bun.sys.unlink(node.path);
        // Flip the tombstone so a second invocation (e.g. atexit firing
        // after the signal handler already ran) is a no-op.
        node.tombstoned.store(true, .release);
    }
}

/// C entry point for the atexit hook and signal handler shim.
pub export fn Bun__cleanupUnixSocketPaths() void {
    cleanupAll();
}

const bun = @import("bun");
const std = @import("std");
