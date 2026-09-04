# Phase 3 — Evidence That Bun's Unsafe Is Deliberately Designed

A blanket criticism of "Bun has too much unsafe" doesn't survive contact with the actual code. This document collects the design evidence that the audit must engage with before classifying anything.

## Exhibit A — `impl_streaming_writer_parent!` macro (`src/io/PipeWriter.rs`)

This single macro stamps out the FFI-callback dispatch for every parent type (FileSink, Terminal, WindowsNamedPipe, ShellIOWriter, StaticPipeWriter) in three flavors corresponding to three real Stacked Borrows constraints:

```rust
(@call mut    $p:expr; $m:ident($($a:tt)*)) => { (&mut *$p).$m($($a)*) };
(@call shared $p:expr; $m:ident($($a:tt)*)) => { (&*$p).$m($($a)*) };
(@call ptr    $p:expr; $m:ident($($a:tt)*)) => { <Self>::$m($p, $($a)*) };
```

The doc comment names each mode's correctness condition:

> - `borrow = mut` → bodies form `&mut *this` (unique access for the callback's duration; the writer never holds `&mut Parent` itself).
> - `borrow = shared` → bodies form `&*this` (callback may re-enter JS or `enqueue(&self)` and observe a fresh `&Self`; aliased `&Self` is sound where `&mut Self` is not).
> - `borrow = ptr` → bodies call `Self::method(this, ..)` — no reference is materialized at the boundary; for parents that must keep full write/dealloc provenance through a re-entrant, freeing callback (the callback may run `Box::from_raw` on `this`, so a `&self`-derived ptr would carry only SharedReadOnly provenance and dealloc through it is UB).

**This is not Zig-style legacy code.** This is Rust-native engineering against Rust's actual aliasing model. The three modes correspond to:

- `mut` — Unique-aliased reborrow valid for the callback's duration
- `shared` — Shared-aliased reborrow valid because the callback may re-enter
- `ptr` — No reborrow at all, because any reborrow's tag would expire before the dealloc

A grep-based audit that flags every `unsafe { &mut *this }` as suspicious would call ~145 sites of this pattern "unsafe code smells." A real audit recognizes that ~all of them are **correctness-load-bearing**.

## Exhibit B — `bun_core::heap` lifecycle helpers

```rust
// src/bun_core/heap.rs:90
/// # Safety
/// `ptr` must be the unique live pointer to a `Box<T>` allocation that has
/// not yet been [`take`]n or [`destroy`]ed.
#[inline(always)]
pub unsafe fn take<T: ?Sized>(ptr: *mut T) -> Box<T> {
    // SAFETY: caller contract above.
    unsafe { Box::from_raw(ptr) }
}
```

The helper is a 1-line wrapper, but it centralizes the SAFETY contract: every FFI-handed pointer that crosses Box-ownership goes through `into_raw` / `take` / `destroy`. The repetition of `Box::from_raw` across 204 sites would have hidden the contract; the helper makes it greppable and reviewable.

This is what good unsafe-discipline looks like.

## Exhibit C — `MimallocArena` non-Drop semantics, explicitly documented

`src/CLAUDE.md § Memory & Allocators § Arena gotcha`:

> **Arena gotcha:** values allocated in `bun_alloc::MimallocArena` (the AST allocator and similar) do **not** run `Drop` when the arena resets — the backing pages are bulk-freed. If a type owns a heap allocation, refcount, or fd, free it explicitly before the arena resets. Don't rely on `Drop` for correctness in arena-backed code.

The project root `CLAUDE.md` reinforces this. Maintainers have built an entire convention around the arena's behavior. The audit can find specific sites where the convention is violated — but it can't claim "they didn't know about Drop in arenas."

## Exhibit D — Cross-thread string hazards, explicitly documented

`src/CLAUDE.md § Cross-thread string hazards`:

> AtomStrings live in a per-thread table. Never deref one from another thread — it trips `wasRemoved` in `AtomStringImpl::remove()`. If a `bun_core::String` may be dropped from a non-JS thread (HTTP worker, threadpool, dying VM), build it via `String::clone_utf8` (a plain `WTFStringImpl` with an atomic refcount), not from an interned/atomized JS string. See the comment in `src/runtime/webcore/fetch/FetchTasklet.rs` near `Response::init` for the canonical example of this bug class and its fix.

Again — this is a known hazard, documented, with a canonical mitigation site. The audit's task here is verification, not discovery.

## Exhibit E — `Mutex` lifetime-erasing transmute, hand-justified

`src/bun_alloc/lib.rs:555-565`:

```rust
pub fn lock(&self) -> MutexGuard {
    let g = self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    // SAFETY: lifetime extension only — `std::sync::MutexGuard<'a, ()>` and
    // `<'static, ()>` have identical layout. Every `bun_alloc::Mutex` lives
    // in a `'static` BSS singleton, so the inner `&Mutex` the guard holds
    // is in fact valid for `'static`.
    MutexGuard(unsafe {
        core::mem::transmute::<std::sync::MutexGuard<'_, ()>, std::sync::MutexGuard<'static, ()>>(g)
    })
}
```

The transmute is sound only if every `bun_alloc::Mutex` is `'static`. The SAFETY comment names the invariant explicitly. A custom `static_assertions::assert_impl_all!(Mutex: HasStaticLifetimeBSS)` won't quite express this (there's no Rust trait for "I'm in BSS"), but `linkme` or a phantom-data-tagged constructor could.

This is (A) STRICTLY_UNAVOIDABLE today; future Rust may add a way to express it (e.g., `&'static` constructors only).

## Exhibit F — `PropertyIdTag` transmute SAFETY comment names its own removal path

`src/bundler/linker_context/scanImportsAndExports.rs:1674-1685`:

```rust
let property_id_tag: PropertyIdTag =
    // SAFETY: `PropertyBitset` is only ever populated via
    // `bitset.set(tag as u16 as usize)` where `tag: PropertyIdTag`
    // (see `bun_css::fill_property_bit_set`), so every set index is a
    // valid `#[repr(u16)]` discriminant. `PropertyIdTag` lives in
    // `bun_css` (generated) and exposes no `from_repr`; once it does,
    // replace this transmute with that accessor.
    unsafe {
        core::mem::transmute::<u16, PropertyIdTag>(
            u16::try_from(property_tag).expect("int cast"),
        )
    };
```

The SAFETY comment says **"replace this transmute with `from_repr` once `bun_css` exposes it."** The maintainer has explicitly noted the migration path. The audit's contribution here is to actually do that migration — add `from_repr` to the `bun_css`-generated code and refactor this and similar sites.

This is a clear (C) REFACTORABLE site with maintainer pre-approval signal embedded in the SAFETY comment itself.

## Exhibit G — `windows_errno::*::from_raw` and `linux_errno::*::from_raw`

Both files have a function:

```rust
// Linux errno version (more permissive)
unsafe fn from_raw(int: u16) -> E {
    // SAFETY: int is in [0, 4096); E is #[repr] over the kernel errno range
    unsafe { core::mem::transmute::<u16, E>(int as u16) }
}

// Windows errno version (cautious)
unsafe fn from_raw_unchecked<E>(n: u16) -> E {
    // SAFETY: caller guarantees `n` is a declared `#[repr(u16)]` discriminant
    // of `E` (Zig `@enumFromInt` precondition). Debug-asserted above; for
    // untrusted input use `try_from_raw` instead.
    unsafe { core::mem::transmute::<u16, E>(n) }
}
```

The Windows version explicitly distinguishes "trusted caller" (`from_raw_unchecked`) vs "untrusted" (use `try_from_raw` instead). The Linux version assumes a contiguous discriminant range over `[0, 4096)`. If any specific platform's `Errno` enum doesn't cover every value in `[0, 4096)`, this is **latent UB** for that platform.

The audit's contribution: enumerate the `Errno` enums per platform, verify the discriminant ranges, and either land the `try_from_raw` rewrite or document the bound enforcement at the call sites.

## What this evidence means for the audit

These exhibits aren't outliers — they represent the modal quality of Bun's unsafe-discipline. Phase 4 classification will find:

- **Most (A) sites have a SAFETY comment** naming the invariant. Some are cursory; some are exhaustive. The audit's hardening pass adds the missing dimensions.
- **Most (C) candidates are sites where the SAFETY comment itself names the migration** ("once `from_repr` is exposed", "once `T: Send` propagation can be auto-derived after removing the raw ptr field"). The audit's value is **executing those migrations**, not discovering them.
- **The (B) sites are rare** and concentrated in specific perf hot spots (parser unreachables, base64 decode tables). The `safe-only` Cargo feature gives users a meaningful safety/perf knob.

## What this evidence means for marketing

The audit's strongest claim is **NOT** "Bun has X% removable unsafe." That framing concedes ground to the critics. The strongest claim is:

> Bun's port from Zig to Rust ships with structured unsafe-discipline. Of the 11,044 unsafe sites, the audit identifies:
>
> - **~1,610** Zig-port pattern sites that are LOAD-BEARING for Stacked Borrows correctness — exactly as Bun's `src/CLAUDE.md` documents
> - **~1,200+** FFI shim sites in `*_sys` crates that have no safe alternative — Bun is a JS runtime, and JS runtimes bridge to C
> - **~120-200** sites in clusters C-001, C-002, C-003 that are SAFELY REFACTORABLE — and the audit lands a demonstration PR for them
> - **~30** (B) perf-only sites that get a `safe-only` Cargo feature flag for measurement
> - **~5-15** latent-UB candidates (mostly in error-code paths where enum range isn't bounds-checked) — filed as `pre-existing-ub` beads
>
> The audit's value is not denouncing unsafe — it's **finding the specific refactors the maintainers already wanted to land** (often signposted in SAFETY comments) and lighting up the corners where the unsafe discipline could be hardened further.
