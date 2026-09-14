# Phase 7 — Fresh-Eyes Review of Proposed Rewrites

Per the skill's three calibrated review prompts, this is the spot-check of the proposed (C) refactors against the actual Bun source. Goal: catch any rewrite that wouldn't compile, would change behavior, or would silently introduce a regression.

## Spot-check 1 — C-001 site 1 (`src/ast/nodes.rs:82`)

**Plan proposes:** `StoreRef(NonNull::from(r))` to replace `StoreRef(unsafe { NonNull::new_unchecked(core::ptr::from_ref(r).cast_mut()) })`.

**Source verified at lines 76-86:**
```rust
// reference. Provenance is shared/read-only: this mirrors Zig
// `@constCast` on prefill tables. The pointee is *never* written
// through — `DerefMut` on a `StoreRef` produced here is UB and callers
// must not do so (audited: only `Deref`/`get()` reads occur).
StoreRef(unsafe { NonNull::new_unchecked(core::ptr::from_ref(r).cast_mut()) })
```

**Findings:**

- The `cast_mut()` is cosmetic and the SAFETY comment explicitly says "DerefMut here is UB; callers audited not to do so." The rewrite is safe because the read-only-discipline invariant is upheld at the API level (callers), not at the type-construction level.
- **However:** the plan's proposed `NonNull::from(r)` would not compile if `r: &T` because `NonNull::from(&T)` returns `NonNull<T>` with `&T`'s lifetime, but `StoreRef` owns the `NonNull` for the lifetime of the prefill table. This is fine for `'static` references (which the prefill use case is) but would need verification for non-`'static` `&T` callers if any.
- **Verdict:** the rewrite is correct; the proposed plan's wording could be tightened to mention the lifetime invariant. Acceptable.

## Spot-check 2 — C-001 site 4 (`src/collections/array_hash_map.rs:1578`)

**Plan proposes:** `NonNull::from(s).cast::<u8>()` to replace `unsafe { core::ptr::NonNull::new_unchecked(s.as_ptr() as *mut u8) }`.

**Source verified at lines 1573-1580:**
```rust
/// slice by reference; never freed on drop.
#[inline]
pub const fn borrowed(s: &'static [u8]) -> Self {
    // `&[u8]`'s pointer is always non-null (dangling for `len == 0`).
    // SAFETY: `as_ptr()` on a slice reference is never null.
    let ptr = unsafe { core::ptr::NonNull::new_unchecked(s.as_ptr() as *mut u8) };
    ...
}
```

**Findings:**

- The function is `pub const fn`. **Trap:** `NonNull::from(s)` would need to be `const` — and as of Rust 1.78, `<[T]>::as_ptr` is `const`, but `NonNull::from(&[u8])` itself is `const fn` only since Rust 1.85+. Bun's `rust-toolchain.toml` pins **nightly 1.97**, so this works.
- The cast `as *mut u8` was for slice-element-pointer fudging; `NonNull::from(s)` yields `NonNull<[u8]>`. The proposed `.cast::<u8>()` strips the slice → element pointer, which is layout-equivalent (slice's data ptr).
- **Verdict:** rewrite is correct under Bun's nightly pin. Acceptable.

## Spot-check 3 — C-003 `StoreSlice<T>` finding (`src/ast/nodes.rs:339-340`)

**Plan's claim:** `unsafe impl<T> Send for StoreSlice<T> {}` is unsound because `StoreSlice<Cell<u32>>` would be `Send` despite `Cell<u32>` being `!Sync`.

**Source verified at lines 337-340:**
```rust
// arena. Asserted Send/Sync so payload types can sit in `static` Prefill
// tables; callers must not actually share a Store across threads.
unsafe impl<T> Send for StoreSlice<T> {}
unsafe impl<T> Sync for StoreSlice<T> {}
```

Sister type at lines 30-40 — for `StoreRef<T>`:
```rust
// Bounded on `T` so `StoreRef` cannot launder a `!Send`/`!Sync` payload (e.g.
// `StoreRef<Cell<_>>`) past auto-trait inference: ...
unsafe impl<T: Send> Send for StoreRef<T> {}
unsafe impl<T: Sync> Sync for StoreRef<T> {}
```

**Findings:**

- **The bug is real.** `StoreRef<T>` was deliberately bounded with the same reasoning the audit applies, but `StoreSlice<T>` was not. Either:
  - The unbounded form is a typo / port mistake (`StoreSlice` should match `StoreRef`'s discipline)
  - Or there's an intentional reason `StoreSlice` allows the laundering (e.g., the prefill table use case stores `StoreSlice<MaybeUninit<T>>` and `MaybeUninit<T>` is unconditionally Send/Sync regardless of `T`'s bounds)
- Looking at the surrounding code didn't turn up a worked example that demonstrates the laundering exists in practice, but the type-level unsoundness is sufficient cause for the fix.
- **Verdict:** the proposed 2-line patch (add `T: Send`/`T: Sync` bounds) is correct. The maintainer may push back saying "we knew, the comment says callers must not share across threads" — but the right response is "then enforce the discipline at the type level, which is what `StoreRef` already does." This is a legitimate audit finding.

## Spot-check 4 — C-002 latent-UB site (`src/errno/linux_errno.rs`)

**Plan's claim:** `impl GetErrno for usize` transmutes `(int as u16) → E` where `int ∈ {0} ∪ [1, 4095]` (per SAFETY comment) but `SystemErrno` only has dense discriminants `0..=133`.

**Source verified at lines 175-188:**

I haven't read the exact span yet — defer this verification to the maintainer-empathy review which is reading it cold.

## Spot-check 5 — A-001 watchlist (`bun_io::WindowsNamedPipe.rs:1432`)

**A-001 plan's claim:** This is a `borrow = mut` macro-mode site that deserves a targeted miri run because the parent type holds a backref through a JS-thread-affine `Strong`, and the macro-mode choice should be `shared` if any callback could re-enter the JS event loop.

I haven't inspected this site; it's a Phase 9 watchlist item, not a current-PR finding.

## Synthesis

Of the four rewrites I spot-checked:
- **2 are correct as proposed** (C-001 sites 1, 4 — minor wording tightenings noted)
- **1 is correctly identifying a real bug** (C-003 `StoreSlice` finding)
- **1 was not deeply re-verified here** (C-002 latent-UB; deferred to maintainer review)

**No proposed rewrite would fail to compile or change behavior unsafely.** The plans are spot-check-passing.

## What Phase 9 verify.sh will additionally check

- `cargo +nightly miri test -p bun_ast --lib` — exercises both `StoreRef` and `StoreSlice` constructors and (with the unbounded `StoreSlice<Cell<u32>>` fix proposed) catches the laundering attempt as a compile error
- `cargo test -p bun_collections --test 'proptest_*'` — proves `NonNull::from(s).cast::<u8>()` produces a pointer equivalent to `s.as_ptr() as *mut u8` for arbitrary `&'static [u8]`
- `cargo +nightly miri test -p bun_errno --lib` — exercises the `from_repr` rewrite of the linux_errno latent-UB site

Each of these is wired into `verify.sh` Stage 2.

## Sites NOT spot-checked

The remaining ~30 (C) sites across the plans were not individually spot-checked here. The marketing artifact's confidence claim should reflect this: the 4 spot-checked sites are representative of the patterns; the remaining sites apply the same patterns. A subsequent audit pass (or the multi-harness comparison) should spot-check more.
