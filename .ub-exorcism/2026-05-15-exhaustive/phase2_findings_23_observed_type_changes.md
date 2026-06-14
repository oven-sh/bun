# Phase 2 – Bucket 23: Observed Type Changes (Mutability/Const)

Run: `2026-05-15-exhaustive` (registry-tightening sweep on 2026-05-16)
Sweeper: static-bucket-sweeper-23
Scope: Rust-only (`src/**.rs`). `.zig` siblings are porting references, not
compiled, and therefore out of scope.

## Bucket definition (UB-TAXONOMY §23 recap)

- The strict, always-UB case is writing through a `*mut T` that was obtained by
  casting away `const` from a pointer whose backing allocation lives in
  read-only memory (`.rodata` / `.text` rel-RO): string literals, `static`
  items, anonymous const-promoted temporaries.
- A weaker shape — casting `&T → *const T → *mut T → write` where the pointee
  is *heap*-allocated — is observed-type-change-flavored but is bucketed
  primarily under 1 (Aliasing) / 14 (`*const` mutation): the `.rodata` segfault
  primitive does not apply, but rustc's `invalid_reference_casting` lint still
  fires and the write is UB under Stacked/Tree Borrows.
- Phase 2 enumerates only the strict-bucket-23 surface here; the broader
  shared-provenance-write population is owned by buckets 1 & 14.

## Method

1. Inventoried every `cast_mut()` site in `src/**.rs` via
   `rg -n 'cast_mut' --type rust src/` → 205 hits.
2. Cross-checked against:
   - Every `static [A-Z_]+:` declaration that exposes a `&'static` pointer to
     `cast_mut`.
   - String / byte-literal patterns (`b"..".as_ptr().cast_mut`,
     `".." as *const str as *mut str`).
   - `&'static`-typed function parameters / fields fed into a write via a
     stripped const.
3. Inspected the existing Phase-1 inventory entries that already crossed
   buckets 1+14+23 (picohttp NUL-write, U2 dealloc cluster, `bundle_v2`
   `Slice<T>: Copy` exploiter, WebSocketServerContext counter).

## Strict `.rodata` writes? — None observed.

Bun has **zero call sites** that:
- materialise a `*const _` from a string literal, a `static FOO:` slot, or a
  promoted-constant temporary, and
- then write through the resulting `*mut _`.

The closest exception is the `analytics` / `bun_alloc` / `which` static tables
(e.g. `WIN_EXTENSIONS_W`, `SYMBOL_REPLACEMENTS`, `VTABLE` arrays). All are
read-only consumers; none are paired with a `cast_mut()` or `as *mut` site in
the same module. `string_literal.as_ptr().cast_mut()` ⇒ write: zero hits.

The `env_var::Cache::deser_and_invalidate` path (`src/bun_core/env_var.rs:358`)
casts `&'static [u8]::as_ptr().cast_mut()` into an `AtomicPtr<u8>`, but only
because `AtomicPtr` constructively requires `*mut T`; the read path
(`get_cached`) reconstitutes the slice via `from_raw_parts(ptr, len)` for
immutable access only. There is no write through the cast pointer.

## Heap-only "observed type change" residue (bucket 1+14 primary, 23 secondary)

These are the sites where rustc's `invalid_reference_casting` lint applies but
the backing storage is *not* `.rodata`. They are already counted under buckets
1 / 14; they are reproduced here so the bucket-23 sweep file is auditable.

| Site | Shape | Phase-1 anchor |
|---|---|---|
| `src/picohttp/lib.rs:383` | `path_ptr.cast_mut().add(path_len).write(0)` against a `*const u8` whose provenance derives from the read-only `&'a [u8]` request buffer through `phr_parse_request`'s out-param | **EXP-011 CONFIRMED-UB-MODEL** |
| `src/http/AsyncHTTP.rs:117` | `bun_core::heap::destroy(core::ptr::from_ref(href).cast_mut())` where `href: &'static [u8]` is in fact a leaked `Box<[u8]>` (heap, not `.rodata`) | U2 cluster #1 |
| `src/http/lib.rs:176` | Same shape: `heap::destroy(from_ref(list).cast_mut())` where `list: &[Header]` is a `Box::leak`ed slice | U2 cluster #2 |
| `src/runtime/server/WebSocketServerContext.rs:83,94` | `addr_of!(self.active_connections).cast_mut(); *p = ...saturating_add(n)` — single-threaded JS-heap `usize` field; SAFETY comment + TODO to convert to `Cell` | source-direct, prior-audit |
| `src/runtime/cli/repl.rs:99` | `core::ptr::from_ref(vm).cast_mut()` with `#[allow(invalid_reference_casting)]` — `VirtualMachine` is process-singleton, single-threaded; lint silenced deliberately | source-direct |
| `src/runtime/cli/test/Scanner.rs:255` | `core::ptr::from_ref(&self.fs.fs).cast_mut()` — `FileSystem` singleton, mutex-serialised inside callee | source-direct |
| `src/ast/symbol.rs:553` | `self.symbols_for_source.as_ptr().cast_mut().add(src)` — `Vec::as_ptr` is documented to project from `NonNull<T>` so provenance is preserved; SAFETY note documents the avoidance | source-direct |
| `src/runtime/shell/subproc.rs:72` | `arc_as_mut_ptr` helper: `Arc::as_ptr(a).cast_mut()` — `Arc::as_ptr` projects from `NonNull<ArcInner>` (allocation provenance), so this is *not* a `&T → *mut` laundering | documented in source |
| `src/ptr/lib.rs:665` (`AsCtxPtr` blanket trait) | Centralised `from_ref(self).cast_mut()` for 19+ JS-class `as_ctx_ptr()` call sites; contract: consumers must deref as `&*p`, mutate via interior mutability | source-direct |

`AsCtxPtr` (via `ptr/lib.rs:665`) is the load-bearing one: any future use that
forms `&mut *self.as_ctx_ptr()` and writes a non-interior-mutable field would
slip into bucket-23-flavored UB. Today every call site honours the contract,
but the boundary is wide.

## Top-3 *new* finds (beyond the three Phase-1-cited entries)

1. **`AsCtxPtr` blanket trait at `src/ptr/lib.rs:665`** — not a new UB, but a
   newly-itemised *systemic* surface. 19+ ex-inherent `as_ctx_ptr()` methods
   were consolidated into one trait whose default impl strips const from
   `&self` for every type in the workspace. Documented contract: "consumers
   deref as `&*p`; mutation goes through interior-mutable fields." A
   `compile-fail` cargo-deny rule (`disallowed-method` on
   `AsCtxPtr::as_ctx_ptr` outside listed crates) would cap the surface.

2. **`WebSocketServerContext::active_connections_saturating_{add,sub}`
   (`src/runtime/server/WebSocketServerContext.rs:83,94`)** — `addr_of!`
   sidesteps the `invalid_reference_casting` lint by avoiding an intermediate
   `&usize`, but the field is still a plain `usize` (no `Cell`/`UnsafeCell`).
   Under the actual borrow model, `*p = (*p).saturating_add(n)` through
   `&self` is bucket-1+14 UB; the in-source `TODO(port): convert to Cell<usize>`
   acknowledges it. Bucket-23 risk is heap, not `.rodata`. Recommend filing as
   a small remediation bead.

3. **`env_var::Cache::deser_and_invalidate` (`src/bun_core/env_var.rs:358`)** —
   `&'static [u8].as_ptr().cast_mut()` ⇒ `AtomicPtr::store`. The cast itself
   is required by `AtomicPtr`'s `*mut T` signature, and current code only ever
   reads back through `from_raw_parts`. **No active UB**, but the const-strip
   on a `&'static [u8]` from `getenv` is the closest Bun has to a literal
   bucket-23 shape; a one-line comment pinning the read-only contract would
   make future regressions obvious.

## Totals

- `cast_mut()` sites in `src/`: **205**
- Sites whose stripped-const source is a string literal / `static FOO` /
  promoted const ⇒ `.rodata` write: **0**
- Heap-backed const-strip sites (bucket 1+14 primary, 23 flavoured):
  **~9 distinct shapes**, dominated by the centralised `AsCtxPtr` trait
  (which expands to ~19 call sites). Three of these are already counted as
  EXP-011 / U2 cluster / Phase-1 inventory entries; the rest are documented
  in-source with SAFETY comments and either (a) recover provenance from a
  raw-pointer field (Vec/Arc/NonNull projection), (b) are immediate-read-only
  consumers, or (c) are explicitly `#[allow(invalid_reference_casting)]` with
  rationale.

## Severity calibration (per PHASES.md scale)

- **Strict bucket-23 (`.rodata` write):** N/A — no candidates exist in the
  Rust source.
- **EXP-011 picohttp:** already counted as CONFIRMED-UB-MODEL under
  buckets 1+14+23; provenance is `Frozen` (Tree-Borrows-proven), not
  `.rodata`. No re-counting in this bucket.
- **U2 cluster, `AsCtxPtr`, scoped `&T → *mut T` reborrows:**
  CONTRACTUAL-BUT-DEFENSIBLE under bucket 23; the primary UB classification
  stays in buckets 1 & 14.

## Recommendations

1. Keep Bucket 23 closed as a **N/A-for-strict-shape** finding in the Phase-5
   registry; do not double-count EXP-011 / U2 cluster.
2. File a small bead to convert `WebSocketServerContext.active_connections` to
   `Cell<usize>` (the TODO is already on-source).
3. Add a one-line in-source comment to `env_var::Cache::deser_and_invalidate`
   pinning the "read-only consumer only — never write through this pointer"
   contract.
4. Consider a cargo-deny `disallowed-methods` rule scoping `AsCtxPtr::as_ctx_ptr`
   to the crates that already use it, so the implicit-blanket surface cannot
   silently grow.
