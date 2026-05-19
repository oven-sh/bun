// ──────────────────────────────────────────────────────────────────────────
// BufferedReader
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): Zig's `ReaderType` only needs `.read(&mut [u8]) -> Result<usize, Self::Error>`
// and an associated `Error` type. There is no `bun_io::Read` trait yet; introduce one
// (or reuse whatever the `std.Io.GenericReader` port lands as) and bound `R` on it.
pub struct BufferedReader<const BUFFER_SIZE: usize, R> {
    pub unbuffered_reader: R,
    pub buf: [u8; BUFFER_SIZE],
    pub start: usize,
    pub end: usize,
}

impl<const BUFFER_SIZE: usize, R> BufferedReader<BUFFER_SIZE, R>
where
    // TODO(port): replace with the real reader trait once it exists.
    R: DeprecatedRead,
{
    // Zig: `pub const Error = R.Error;` — inherent assoc types are nightly-only
    // (E0658). Callers name `R::Error` directly; this alias was sugar.
    // TODO(port): `pub const Reader = std.Io.GenericReader(*Self, Error, read);` —
    // depends on the Rust port of `std.Io.GenericReader`. Left unported; `reader()`
    // below is stubbed accordingly.

    pub fn read(&mut self, dest: &mut [u8]) -> Result<usize, R::Error> {
        // First try reading from the already buffered data onto the destination.
        let current = &self.buf[self.start..self.end];
        if !current.is_empty() {
            let to_transfer = current.len().min(dest.len());
            dest[0..to_transfer].copy_from_slice(&current[0..to_transfer]);
            self.start += to_transfer;
            return Ok(to_transfer);
        }

        // If dest is large, read from the unbuffered reader directly into the destination.
        if dest.len() >= BUFFER_SIZE {
            return self.unbuffered_reader.read(dest);
        }

        // If dest is small, read from the unbuffered reader into our own internal buffer,
        // and then transfer to destination.
        self.end = self.unbuffered_reader.read(&mut self.buf)?;
        let to_transfer = self.end.min(dest.len());
        dest[0..to_transfer].copy_from_slice(&self.buf[0..to_transfer]);
        self.start = to_transfer;
        Ok(to_transfer)
    }

    pub fn reader(&mut self) -> &mut Self {
        // TODO(port): Zig returned a `std.Io.GenericReader` adapter wrapping `self`.
        // Until the generic-reader port exists, hand back `&mut Self` (which already
        // exposes `read`). Wire to the real adapter type once it exists.
        self
    }
}

// TODO(port): placeholder trait standing in for `ReaderType` duck-typing. Remove once
// the shared reader trait exists and bound `R` on that instead.
pub trait DeprecatedRead {
    type Error;
    fn read(&mut self, dest: &mut [u8]) -> Result<usize, Self::Error>;
}

pub fn buffered_reader<R: DeprecatedRead>(reader: R) -> BufferedReader<4096, R> {
    BufferedReader {
        unbuffered_reader: reader,
        // PERF(port): Zig left `buf` undefined; zero-init here is an extra 4 KiB memset.
        buf: [0u8; 4096],
        start: 0,
        end: 0,
    }
}

pub fn buffered_reader_size<const SIZE: usize, R: DeprecatedRead>(
    reader: R,
) -> BufferedReader<SIZE, R> {
    BufferedReader {
        unbuffered_reader: reader,
        // PERF(port): Zig left `buf` undefined; zero-init here is an extra memset.
        buf: [0u8; SIZE],
        start: 0,
        end: 0,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SinglyLinkedList
// ──────────────────────────────────────────────────────────────────────────
//
// DEDUP(D050): the Rust port of `SinglyLinkedList` / `SinglyLinkedNode` was
// removed — the canonical implementation lives at
// `bun_collections::pool::{SinglyLinkedList, Node}`. The two had diverged
// (`data: T` vs `data: MaybeUninit<T>`, `*mut`-null vs `Option<*mut>` returns)
// and this copy had zero callers outside its own unit test. New consumers
// should depend on `bun_collections::pool` directly.

// ──────────────────────────────────────────────────────────────────────────
// DoublyLinkedList
// ──────────────────────────────────────────────────────────────────────────
//
// The Rust port of `std.DoublyLinkedList` / `DoublyLinkedNode` was removed
// after its in-tree unit test failed under Miri (Stacked Borrows): callers
// hand the list `&mut node` references whose tags are then invalidated by
// later `&mut node` re-borrows on the same stack-local, while the list
// still traverses the stale raw `*mut node` links. The struct had no
// callers outside its own unit test, so deletion is the safe fix. The one
// in-tree comment that referenced the type (`src/jsc/web_worker.rs`'s
// `TODO(port): std.DoublyLinkedList` for `WebWorker.live_{next,prev}`)
// remains a TODO. Future intrusive-list needs should pick a design that
// does not interleave `*mut node` and `&mut node` on the same allocation
// (for example pinned/list-owned nodes, an `intrusive-collections` adapter,
// or a `Box`-owning list).

// ──────────────────────────────────────────────────────────────────────────
// RapidHash
// ──────────────────────────────────────────────────────────────────────────

// Canonical impl lives in the leaf `bun_hash` crate; re-export so the
// historical `crate::deprecated::RapidHash` path keeps resolving. Test
// vectors live alongside the canonical impl in `bun_hash::rapidhash`.
pub use bun_hash::RapidHash;

// ──────────────────────────────────────────────────────────────────────────
// misc
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): comptime reflection — Zig picks "{f}" if `ty` has a `format` method,
// otherwise `fallback`. Rust has no `@hasDecl`; the equivalent is "does `T: Display`?".
// Format specifiers also differ (Rust uses "{}" for both). Callers should be migrated
// to use `Display` directly; until then this returns the fallback unconditionally.
pub const fn auto_format_label_fallback<T>(fallback: &'static str) -> &'static str {
    // TODO(port): `std.meta.hasFn(ty, "format")` reflection — see note above.
    let _ = core::marker::PhantomData::<T>;
    fallback
}

pub const fn auto_format_label<T>() -> &'static str {
    auto_format_label_fallback::<T>("{s}")
}

// ported from: src/bun_core/deprecated.zig
