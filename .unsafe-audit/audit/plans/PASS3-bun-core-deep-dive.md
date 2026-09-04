# PASS 3 — `bun_core` deep-dive

**Scope:** `src/bun_core/` (461 unsafe sites across 36 .rs files) plus the
`bun_paths::path_buffer_pool` helper (tightly coupled to `bun_core::String`
allocators).

**Method:** Re-walked the densest 12 files (≥10 unsafe sites each), sampled
~120 sites stratified across `string/`, `lib.rs`, `util.rs`, `output.rs`,
`atomic_cell.rs`, `external_shared.rs`, `bounded_array.rs`, `result.rs`,
`MutableString.rs`, `SmolStr.rs`, `PathString.rs`, `StringBuilder.rs`,
`StringJoiner.rs`, `Progress.rs`, `Global.rs`, `heap.rs`, `env_var.rs`,
`tty.rs`, `deprecated.rs`. Every site was read with ≥30 lines of
surrounding context; the public-API contracts were chased through their
callers when a `pub fn` body invoked `unsafe`.

**Discipline:** Tier 1 = a concrete unsound operation on the source OR a
safe-API contract that lets ordinary Rust callers trip UB without writing
`unsafe` themselves. Tier 2 = real safe-abstraction defect requiring a
larger remediation than a one-line patch. Tier 3 = latent / threat-model-
dependent watchlist. Counts are deliberately not padded with intentional
FFI hazards, duplicates of prior-pass findings, or perf-only refactor
opportunities.

---

## Executive summary

`bun_core` is the foundation crate — every other crate depends on it, so
unsafe bugs here cascade. The audit confirms the file is *less* leaky than
the surface-area suggests, but the gaps that remain are real and several
are previously-unreported safe-API UB primitives.

**Tier-1 (confirmed patchable):** 5

| # | ID | Location | Class |
|---|----|----------|-------|
| T1.1 | P3-BC-001 | `bun_core/fmt.rs:725-731` (`fmt::Raw` / `fmt::s` / `fmt::raw`) | Safe `Display` impl runs `core::str::from_utf8_unchecked` on caller-supplied `&[u8]`. Live call sites pass `argv[0]`, tarball paths, npm tmpnames — all of which can carry non-UTF-8 bytes. Creating an invalid `&str` is library UB on its own. |
| T1.2 | P3-BC-002 | `bun_core/string/StringBuilder.rs:315-332` (`move_to_slice`) | Safe `pub fn` returns `Box<[u8]>` whose length is the full `cap`, but only `len` bytes are initialised. Source TODO acknowledges this. Reading the tail as `u8` is deferred UB the safe API caller cannot avoid without an `unsafe { set_len(self.len) }` they aren't told to write. |
| T1.3 | P3-BC-003 | `bun_core/bounded_array.rs:108-114` (`resize`) + `bun_core/bounded_array.rs:93-104` (`slice`/`const_slice`) | Safe `resize(len)` grows the logical length over `[MaybeUninit<T>]` storage without initialising; subsequent safe `const_slice` / `get` / `pop` reads uninit `T`. For niche-bearing `T` (`NonNull`, `&_`, `bool`, `char`, niche enums) this is immediate reference UB. Same class as the prior `add_many_as_slice` finding (F-2) but reachable via a different safe entry. |
| T1.4 | P3-BC-004 | `bun_core/string/MutableString.rs:416-420` (`to_owned_slice_length`) | Safe `pub fn to_owned_slice_length(&mut self, length: usize) -> Box<[u8]>` calls `self.list.set_len(length)` unconditionally. Any caller value ≤ `capacity` works; any value `> len` exposes uninit `u8`, any value `> capacity` is OOB on the next read. The SAFETY comment names the obligation but it lives only in the comment. |
| T1.5 | P3-BC-005 | `bun_core/string/MutableString.rs:311-320` (`inflate`) | Safe `pub fn inflate(amount)` reserves and `set_len(amount)`, deliberately leaving the new tail uninit (matches Zig). The `pub fn slice(&mut self) -> &mut [u8]` at L403-405 then exposes those uninit bytes to any reader. Reachable from safe code without `unsafe`. |

**Tier-2 (architecture / public-contract defects):** 7

| # | ID | Location | Defect |
|---|----|----------|--------|
| T2.1 | P3-BC-101 | `bun_core/string/PathString.rs:111-119, 86-97` | `PathString` is `Copy + 'static`-shaped: `init(&[u8])` stores the slice's `(ptr, len)` packed into an integer with no phantom lifetime; `slice()` returns `&[u8]` derived from raw parts. A safe call sequence `let p = PathString::init(&local); drop(local); let s = p.slice();` produces a dangling `&[u8]` with no `unsafe`. Lifetime-laundering is the type's design, not a one-line fix. |
| T2.2 | P3-BC-102 | `bun_core/lib.rs:118-170` (`RawSlice<T>`) | Same shape as PathString but generic over `T`: `RawSlice::new(s: &[T])` is `safe const`, `slice(&self) -> &[T]` is safe, no lifetime parameter. The "backing storage outlives the holder" invariant is structural-contract-only. Used pervasively inside `StringJoiner::Node`, `bun_alloc::ZigString`, environment caches, etc. |
| T2.3 | P3-BC-103 | `bun_core/string/StringJoiner.rs:13-22, 41-53, 118-120` | `StringJoiner::push_static(&[u8])` and `push(&[u8])` store the slice as a `RawSlice<u8>` field (`owns_slice = false`). No lifetime ties the joiner to the slice. `done()` / `last_byte()` / `contains()` then return references derived from the dead storage. Same family as RawSlice but with an additional `Send + Sync` impl on the joiner that exfiltrates the borrow across threads. |
| T2.4 | P3-BC-104 | `bun_core/string/StringBuilder.rs:60-103` (`append16`) | `count16(slice)` reserves `simdutf::length::utf8::from::utf16::le(slice)` bytes; `count16_z(slice)` reserves that + 1 (for NUL). `append16` always writes the trailing `*buf_ptr.add(count) = 0` byte. A safe caller who used `count16` followed by `append16` (the natural pair when the NUL is not desired) reserves N bytes and `append16` writes N+1 — a 1-byte OOB write into the trailing allocation slot. The contract is `count16_z`-only; there is no debug assert distinguishing them. |
| T2.5 | P3-BC-105 | `bun_core/string/mod.rs:380-408` (`create_uninitialized_latin1` / `_utf16`) | `pub fn` returns `(Self, &'static mut [u8])` where the slice's true lifetime is "until `Self` is `deref`'d" (WTF refcount → 0). The `'static` is a fabricated annotation; the source comment admits "lifetime is actually tied to `s`". The signature lets a caller drop `s` while retaining `&'static mut [u8]` — and in Rust that is no longer a contract, it's a use-after-free reachable from safe code. |
| T2.6 | P3-BC-106 | `bun_core/string/mod.rs:539-557` (`String::deref` / `ref_` / `dupe_ref`) | `String: Copy` (FFI-shape requirement) plus `pub fn deref(&self)` that decrements the WTF refcount is a manual-refcount-on-Copy footgun: `let a = s; s.deref(); a.deref();` over-decrements without any `unsafe` and frees the impl twice. The `OwnedString` RAII wrapper is the documented safe surface, but the underlying `Copy + manual deref` is the source of truth shared with C++; nothing forces callers through the wrapper. |
| T2.7 | P3-BC-107 | `bun_core/output.rs:1074-1110` (`source_writer_escape`, `writer`, `error_writer`, `writer_buffered`, `error_writer_buffered`, `error_stream`) | Reaffirmation of `CODEX-P3-writer-static-mut` with no new bug, but the audit confirms five safe public accessors share the same `&'static mut io::Writer` escape — two concurrent calls on the same thread create overlapping `&mut` references. Source TODO at L1067-L1070 says "Returning `&'static mut` is *unsound* if two are alive at once". The single-`unsafe`-centralisation does not erase the underlying soundness gap. |

**Tier-3 (latent / threat-model watchlist):** 9

| # | ID | Location | Concern |
|---|----|----------|---------|
| T3.1 | P3-BC-201 | `bun_core/atomic_cell.rs:194-209, 237-283` | `unsafe trait Atom` plus `unsafe_impl_atom!` macro: the macro `const_assert`s size and alignment but the no-padding invariant ("reinterpreting as `uN` reads only initialized bits") is per-type discipline. Current built-in impls (`bool`, `char`, `u*`, `i*`, `f*`) all qualify; `Winsize` and `ast::Level` are size/repr-disciplined. The macro is sound today; the contract relies on every future caller reading the safety doc — name this Tier 3 because no in-tree caller violates it. |
| T3.2 | P3-BC-202 | `bun_core/atomic_cell.rs:373-470` (pointer specialisations) | `unsafe impl<U> Atom for *mut U / *const U / Option<NonNull<U>>` all cast `*mut Self` (where `Self = *mut U`) to `*const AtomicPtr<U>` and call `(*p).load(ord)` through it. The double-indirection is sound (the storage's true type is `*mut U` and `AtomicPtr<U>` has identical layout), but the cast pattern is fragile if `AtomicPtr<U>` ever grows `repr` packing. The comment cluster at L367-371 calls out the provenance-preservation rationale; no current breakage. |
| T3.3 | P3-BC-203 | `bun_core/string/SmolStr.rs:115-127` (`from_baby_list`), `bun_core/string/PathString.rs:116` (`init`) | Pointer-to-`usize` round-trip via `as usize` for packed-pointer storage. Fails `-Zmiri-strict-provenance` (already accounted for in the 11 strict-provenance findings in the prior index, but flagged again because these are the foundation types). On AArch64 with TBI enabled or future 5-level paged x86-64, the top-byte / top-11-bits truncation in PathString's small-mode (53-bit pointer) could lose meaningful address bits. |
| T3.4 | P3-BC-204 | `bun_core/string/wtf.rs:55-60, 105-109` (`ZigStringSlice::WTF` / `WtfBorrowed`) | The variants store a raw `*const WTFStringImplStruct` plus `(ptr, len)`. The struct-level safety contract is "the impl is kept alive by the +1 ref (`WTF` variant) or by the holding `SliceWithUnderlyingString::underlying` (`WtfBorrowed`)". A `WtfBorrowed` whose holder fails to keep `underlying` alive UAFs. Not currently reachable from safe code because `to_utf8_borrowed` is paired with `String::to_slice`, but a future borrow-only accessor would expose it. |
| T3.5 | P3-BC-205 | `bun_core/atomic_cell.rs:495-589` (`ThreadCell<T>`) | `claim()`/`assert_owner()` are debug-only; release builds compile the latch away. The Send/Sync impls are unconditional: `unsafe impl<T: ?Sized> Sync for ThreadCell<T> {}`. For non-`Sync` `T`, this is the same shape as `RacyCell` — discipline-only. Documented as such; flagged for parity with the existing PUB-N-B finding on `RacyCell`. |
| T3.6 | P3-BC-206 | `bun_core/string/mod.rs:1264-1265` (`unsafe impl Send/Sync for String`) | Reaffirmation of `pre-existing-ub-8`. The `String` is `Send + Sync` regardless of which tag is active, and the Atom-string variant uses a non-atomic refcount that races across threads. The documented contract is `to_thread_safe()` at the hand-off, which only the call site can guarantee. The audit found no new violation, but the entry remains the highest-risk static finding in the crate because the runtime sends `String`s across threads frequently (HTTP responses, worker payloads, log lines). |
| T3.7 | P3-BC-207 | `bun_core/util.rs:208-265` (`Unaligned<T>::slice_align_cast[_mut]`) | Reaffirmation of `pre-existing-ub-ptr-2`. Debug-only alignment check before forming a `&[T]` over potentially-unaligned bytes. Already in the prior index Tier 1; included here for completeness because the type is foundational. |
| T3.8 | P3-BC-208 | `bun_core/lib.rs:937-948` (`impl_field_parent! { … fn raw … }`) | The `(&self) -> *mut Parent` macro arm uses `from_ref(self).cast_mut()` — the same SB-UB shape as the prior U1 finding (`pack_command.rs:3009`). The macro itself only forms the pointer; the SAFETY comment says "the returned pointer is not dereferenced here". UB-on-dereference is on callers. No in-tree caller currently forms `&mut *p` from this arm, but the macro emits the SB-poisoned pointer at every expansion. |
| T3.9 | P3-BC-209 | `bun_core/env_var.rs:347-366` (`Cache::deser_and_invalidate`) | `ptr_value.store(.., Relaxed)` followed by `len_value.store(.., Release)` is a Release-on-len + happens-before-via-Acquire-on-len pattern. Algorithmically sound (the Release on len synchronises all prior writes by this thread, including the Relaxed ptr store). Flagged as Tier 3 because the asymmetry is unusual and a future refactor that flips the order or drops Release would re-introduce a race; the test suite cannot catch this because env-var caching is single-write-many-read in practice. |

**Summary counts**

- Tier 1 confirmed-patchable: **5**
- Tier 2 architecture / safe-API defects: **7**
- Tier 3 latent / watchlist: **9**

The Tier-1 numbers are deliberately small. The audit found *many* `pub fn`
bodies that contain `unsafe` blocks, but the great majority are sound by
local invariant (the `as_wtf` / `as_zig` union readers, the `*_assume_*`
unsafe-fn family, every `fmt::s` Display arm that's actually fed ASCII).
The five Tier-1s are the cases where a safe-API caller, holding no
`unsafe` block, can reach UB.

---

## Per-module unsafe-density map

| File | Lines | `unsafe` occurrences | Notes |
|------|------:|---:|-------|
| `bun_core/lib.rs` | 3,445 | 155 | Foundation utilities; most are in `ffi::*` (Zeroable impls + zeroed wrappers), `vec::*` (writable_slice family, `pub unsafe fn`), `RawSlice<T>` (Tier 2). |
| `bun_core/util.rs` | 5,777 | 128 | Mostly `RacyCell`, `Once`, `getenv_z`, `getcwd`, `which`, csprng, FFI environs. `bytes_as_slice_mut`, `Unaligned::*` (Tier 3). |
| `bun_core/atomic_cell.rs` | 639 | 79 | Atom trait, dispatch macros, ThreadCell (Tier 3). Most density per LOC in the crate. |
| `bun_core/string/mod.rs` | 2,781 | 34 | Union tag-readers (`as_wtf`/`as_zig`), refcount toggles, +1 dealloc-through-shared finding from prior pass, Tier 2 lifetime escapes. |
| `bun_core/output.rs` | 3,173 | 27 | `&'static mut io::Writer` cluster (Tier 2 = CODEX-P3 reaffirmation), `SCOPED_FILE_WRITER` `RacyCell`, `Source::ZEROED` `zeroed_unchecked`. |
| `bun_core/string/immutable.rs` | 3,465 | 24 | SIMD-validated `from_utf8_unchecked`, libc `memmem`/`memrchr` shims, code-point decoders. |
| `bun_core/external_shared.rs` | 213 | 21 | `ExternalShared<T>` ref/deref machinery — correctly modelled with `unsafe trait` and `pub unsafe fn`. Sound. |
| `bun_core/deprecated.rs` | 497 | 20 | `DoublyLinkedList` — correctly `pub unsafe fn` throughout. Sound. |
| `bun_core/Progress.rs` | 823 | 16 | Re-entrant raw-`*mut`-deref into `Source` context; same `*mut Self` shape as runtime, well-modelled here. |
| `bun_core/Global.rs` | 849 | 16 | `SyncCStr` (sound), `Bun__userAgent` extern, FFI symbol keep-alive macros. |
| `bun_core/fmt.rs` | 3,878 | 14 | `Raw`/`s`/`raw` Display impl (Tier 1), various `from_utf8_unchecked` after ASCII validation (sound), hex tables, JSON encoder dispatch. |
| `bun_core/string/StringBuilder.rs` | 352 | 13 | `move_to_slice` (Tier 1), `append16` count mismatch (Tier 2), `append_raw` (correctly `pub unsafe fn`). |
| `bun_core/string/StringJoiner.rs` | 290 | 12 | Lifetime-laundering `push_static`/`push` (Tier 2), node-chain `heap::take` drain (sound). |
| `bun_core/thread_id.rs` | 208 | 9 | Cross-platform OS-TID syscalls; correctly `unsafe { libc::* }` for fallible-args, `safe fn` for no-arg syscalls. |
| `bun_core/bounded_array.rs` | 489 | 9 | `MaybeUninit<T>` viewing (Tier 1), `add_one_assume_capacity` reaffirmation of F-2. |
| `bun_core/result.rs` | 679 | 8 | `Error::intern` `NonZeroU16::new_unchecked` calls — every numeric source provably ≥ 1. Sound. |
| `bun_core/heap.rs` | 121 | 7 | `into_raw`/`take`/`destroy`/`release` — correctly `pub unsafe fn` for the freeing half. Sound. |
| `bun_core/string/SmolStr.rs` | 407 | 5 | Heap/inline packed-u128 layout; `Vec::from_raw_parts` round-trip is correct. Pointer-as-usize is strict-provenance debt (Tier 3). |
| `bun_core/string/PathString.rs` | 200 | 5 | Lifetime-laundering safe API (Tier 2). |
| `bun_core/string/MutableString.rs` | 653 | 5 | `set_len`-based safe APIs exposing uninit (Tier 1×2). |
| `bun_core/tty.rs` | 58 | 3 | `Winsize` Atom impl (Tier 3 if padding ever creeps in), set-mode FFI. Sound today. |
| `bun_core/wtf.rs` | 69 | 2 | Tiny re-export shim. |
| `bun_core/windows_sys.rs` | 69 | 2 | Win32 type aliases. |
| `bun_core/env_var.rs` | 1,052 | 1 | The single `from_raw_parts` materialisation of cached env-var bytes (Tier 3 watchlist for ordering future-proofing). |
| `bun_core/string/HashedString.rs` | — | 1 | One-liner; sound. |
| `bun_core/string/identifier.rs` | 2,584 | 0 | All-safe (table-driven lookups). |

**Density observation:** `atomic_cell.rs` has the highest unsafe-per-LOC
ratio (≈12%) but every site is centralised under one of three primitives
(`Atom`, `_dispatch_*`, `ThreadCell::claim`). `string/identifier.rs` is
the largest non-zero-unsafe file in the crate (2,584 lines, 0 unsafe).

---

## Per-module analysis

### 1. `bun_core/heap.rs` — heap round-trip helpers

121 lines, 7 unsafe sites. Doc comment at L1-28 explicitly disclaims
"safety deliverable" status: the helpers are vocabulary, not protection.

Sites:
- `pub fn alloc(value: T) -> *mut T` — safe, `Box::into_raw(Box::new(..))`.
- `pub fn into_raw<T: ?Sized>(boxed: Box<T>) -> *mut T` — safe.
- `pub fn release<'a, T>(boxed: Box<T>) -> &'a mut T` — safe; intended as
  named `Box::leak` for ownership-handed-off-elsewhere cases.
- `pub unsafe fn take<T: ?Sized>(ptr: *mut T) -> Box<T>` — correctly unsafe.
- `pub unsafe fn destroy<T: ?Sized>(ptr: *mut T)` — correctly unsafe.
- `pub fn alloc_nn<T>(value: T) -> NonNull<T>` — safe (`Box::leak` →
  `NonNull::from`).
- `pub fn into_raw_nn<T: ?Sized>(boxed: Box<T>) -> NonNull<T>` — safe.

**Verdict:** Sound. The contract is "anything taking a raw pointer must
be paired with a `take`/`destroy` from the unique-owner thread"; this is
the standard `Box::into_raw` contract and not specific to this file.
The audit found no `heap::take` / `heap::destroy` site inside `bun_core`
that would over-free a pointer derived from shared provenance — the one
known sibling-class bug is `bun_core/string/mod.rs:1765` (already filed
as U2.5).

No new findings here.

### 2. `bun_core/atomic_cell.rs` — the audited primitive

639 lines. The audit's pass-2 atomic survey praised this type; pass 3
verified the implementation against its documented claims.

#### 2.1 `AtomicCell<T>` core

- L65-66: `unsafe impl<T: Copy> Sync/Send for AtomicCell<T>` — **no `T:
  Send` bound**. The SAFETY comment justifies this for raw pointer / NonNull
  payloads (matching `AtomicPtr<U>: Send + Sync` unconditionally). For
  non-pointer `Copy + !Send` types this would be wrong — but `Copy + !Send`
  is essentially "raw pointers, references, fn pointers, MaybeUninit",
  all of which are pointer-shaped. **Sound by structural argument**, but
  worth a debug-assert in tests that `T: Send` for non-pointer impls
  (Tier 3 watchlist; flagged but no bug).

- L72-76: `pub const fn new(value: T) -> Self` — sound; no unsafe.

- L89-99: `load` / `store` — `Ordering::Acquire` / `Ordering::Release`
  default. **Matches the documented AcqRel-by-default claim.**

- L104-122: `swap` / `compare_exchange` — `Ordering::AcqRel` success,
  `Ordering::Acquire` failure. **Standard.**

- L143-154: `load_relaxed` / `store_relaxed` — named for grep-discovery,
  documented as "telemetry / best-effort hints" only. The audit grepped
  for current call sites: every use is gated either to a memory-cost
  telemetry helper or to RUNNING_FLAGS where the load is racy-by-design.
  **No misuse found.**

#### 2.2 `unsafe trait Atom`

L194-209: documented `# Safety` contract — size ∈ {1,2,4,8}, no padding,
round-trip `Self → uN → Self` preserves value. The `unsafe_impl_atom!`
macro (L237-283) discharges size + alignment at compile time; padding
is per-caller responsibility.

**Audit of built-in impls (L363-365):**

| Type | Size | Padding | Round-trip valid? |
|------|------|---------|--------------------|
| `bool` | 1 | none | yes — `0`/`1` only stored |
| `char` | 4 | none | yes — only valid chars ever stored |
| `u8/u16/u32/u64/usize` | 1/2/4/8/8 | none | yes |
| `i8/i16/i32/i64/isize` | 1/2/4/8/8 | none | yes |
| `f32/f64` | 4/8 | none | yes (NaN bit-equality is acceptable) |

**Audit of external impls:**
- `Level` (`src/ast/lib.rs:1604`): `#[repr(i8)]`, 5 variants — size 1, no
  padding. **Sound.**
- `Winsize` (`bun_core/tty.rs:17`): `#[repr(C)] struct { row, col, xpixel,
  ypixel: u16 }` — exactly 8 bytes, no padding. **Sound.**

**Verdict:** The atomic primitive is correctly built. The only forward-
looking risk is a future `unsafe_impl_atom!(MyEnum)` where the enum has
implicit padding (e.g., a 3-variant `#[repr(C)]` enum that the compiler
lays out as 4 bytes with 3 valid + 1 padding); the macro does not catch
this. Tier-3 watchlist item P3-BC-201.

#### 2.3 Pointer specialisations (L372-470)

`unsafe impl<U> Atom for *mut U` / `*const U` / `Option<NonNull<U>>` —
each casts `*mut Self` to `*const AtomicPtr<U>` and dispatches.

The cast is sound *iff* `*mut U` and `AtomicPtr<U>` have identical
in-memory layout. `core::sync::atomic::AtomicPtr<T>` is documented as
`#[repr(transparent)]` over a pointer; this is part of its API contract.
**Sound today.** Tier 3 watchlist for future stdlib repr changes.

`Option<NonNull<U>>`: relies on the null-pointer niche. The Rust
reference documents this layout guarantee for `Option<NonNull<T>>`.
**Sound.**

#### 2.4 `ThreadCell<T>`

L495-589: `RacyCell<T>` + debug-only owner latch. Same Send/Sync issue
as `RacyCell` (Tier 3, parity with PUB-N-B). The `claim()` /
`assert_owner()` machinery is sound: `AtomicU64::compare_exchange` with
`Ordering::AcqRel`/`Acquire` establishes the right happens-before. The
race between two `claim()` calls is resolved by CAS.

No new findings beyond P3-BC-205.

### 3. `bun_core/string/mod.rs` — `bun_core::String` core

2,781 lines, 34 unsafe sites. The 5-variant tagged union (`Empty`, `Dead`,
`ZigString`, `StaticZigString`, `WTFStringImpl`) is the FFI-compatible
core. Audited every constructor, every variant-discriminating method,
every refcount toggle.

#### 3.1 Union readers (sound)

- L146-152 `fn as_zig(&self) -> &ZigString` — `debug_assert!(matches!(...))`,
  then `&*(addr_of!(self.0.value.zig_string) as *const ZigString)`. The
  union arm is the active one by tag, reading a `Copy + POD` value.
  Sound; debug-assert in debug, but in release a tag mismatch is also
  not UB because the union arms are layout-identical (`(*const u8,
  usize)` for both `ZigString` and `WtfBorrowed`). **Sound.**

- L158-164 `fn as_wtf(&self) -> &WTFStringImplStruct` — same pattern.
  Calling this with a non-WTF tag would dereference a `*const u8` as a
  WTF struct, which IS UB. The function is `fn` (not `pub`); every caller
  branches on `self.0.tag` first. **Sound by call-graph audit.**

- L170-176 `pub(crate) fn wtf_ptr(&self) -> WTFStringImpl` — returns the
  pointer without dereferencing. Even on a wrong tag, reading a `*mut`
  out of a union arm is a POD read. **Sound.**

#### 3.2 Constructors

Audited every `clone_utf8`, `borrow_utf8`, `clone_utf16`, `static_`,
`ascii`, `create_external_globally_allocated_*`, `create_uninitialized_*`.

The vast majority forward to FFI with `bytes.as_ptr()`/`bytes.len()` —
sound (the slice's validity is the FFI precondition).

**Tier-2 finding T2.5 (P3-BC-105)** at L380-408 (`create_uninitialized_latin1` /
`_utf16`):

```rust
pub fn create_uninitialized_latin1(len: usize) -> (Self, &'static mut [u8]) {
    let s = BunString__fromLatin1Unitialized(len);
    if s.0.tag != Tag::WTFStringImpl {
        return (s, &mut []);
    }
    debug_assert_eq!(s.as_wtf().ref_count(), 1);
    let buf = unsafe {
        let ptr = (*s.0.value.wtf_string_impl).m_ptr.latin1.cast_mut();
        core::slice::from_raw_parts_mut(ptr, len)
    };
    (s, buf)
}
```

The `&'static mut [u8]` is fabricated — its actual lifetime is "until
`s` is dropped or `.deref()`'d to refcount 0". A caller can:

```rust
let (s, buf) = String::create_uninitialized_latin1(64);
drop(s);                  // refcount → 0, WTF impl frees the buffer
buf[0] = 42;              // UAF, no `unsafe` in caller code
```

The SAFETY comment at L386-389 acknowledges this: "lifetime is actually
tied to `s` — caller must not outlive it." That's the architecture
defect; lifetime-tying is what Rust lifetimes are for. Fix: return
`(Self, &'a mut [u8])` parameterised by the lifetime of the returned
`Self`'s borrow — or take a closure `(builder: FnOnce(&mut [u8]) -> R)`
and bound the access inside.

#### 3.3 Refcount machinery (T2.6 = P3-BC-106)

L539-557:

```rust
pub fn ref_(&self) { if WTF { self.as_wtf().r#ref() } }
pub fn deref(&self) { if WTF { self.as_wtf().deref() } }
pub fn dupe_ref(&self) -> Self { self.ref_(); *self }
```

`String: Copy` (line 1264-1265 — required by the FFI by-value-pass
contract). Combined with `pub fn deref`, this is the canonical
manual-refcount-on-Copy footgun. The `OwnedString` wrapper at L1281 is
the documented Rust-side correct path, but `String::deref` is `pub` and
greppable.

The audit found no in-tree double-deref site, but the type system permits
it without `unsafe`. Tier-2 architecture defect; the only sound fix is
to remove `Copy` (and rebuild the FFI surface to pass-by-pointer).

#### 3.4 `Display for String` chain (sound)

L1364-1369:
```rust
impl Display for String {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let s = self.to_utf8_without_ref();
        f.write_str(unsafe { str::from_utf8_unchecked(s.slice()) })
    }
}
```

Audited every arm of `to_utf8_without_ref` (string/mod.rs:711, string/
wtf.rs:76, ZigString::to_slice at string/mod.rs:1928):
- `Tag::WTFStringImpl`, 8-bit: `to_utf8_from_latin1` returns `Some(utf8)`
  when input has high bytes — explicit transcoding. Returns `None` only
  when input is all-ASCII (lib.rs:1862), where `from_utf8_never_free`
  borrows the ASCII bytes as UTF-8. **Sound — ASCII ⊂ UTF-8.**
- `Tag::WTFStringImpl`, 16-bit: `to_utf8_alloc` produces UTF-8. **Sound.**
- `Tag::ZigString`: `to_slice` transcodes 16-bit / Latin-1, borrows
  ASCII-only 8-bit. **Sound.**
- `Tag::StaticZigString`: borrows as `from_utf8_never_free` — assumes the
  static string was ASCII. Static callers in the codebase pass ASCII-only
  literals (Bun keyword tables, npm package-name fragments). **Sound by
  call-graph audit.**

**No bug here**, despite the `from_utf8_unchecked`. Confirming.

#### 3.5 Send/Sync on `String` (T3.6 = P3-BC-206)

L1264-1265 reaffirmation of `pre-existing-ub-8`. The non-atomic atom-string
refcount race is real; the fix is a `ThreadSafeString` newtype, deferred
in the prior audit. No new evidence.

### 4. `bun_core/string/PathString.rs` — packed-pointer path string

200 lines, 5 unsafe sites.

**Tier-2 finding T2.1 (P3-BC-101)** — the type as a whole.

```rust
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Default)]
pub struct PathString(PathStringBackingInt);

impl PathString {
    pub fn init(str: &[u8]) -> Self {
        let ptr = (str.as_ptr() as usize as PathStringBackingInt) & Self::PTR_MASK;
        let len = (str.len() as PathStringBackingInt) << POINTER_BITS;
        Self(ptr | len)
    }
    pub fn slice(&self) -> &[u8] {
        let ptr = self.ptr();
        if ptr == 0 { return &[]; }
        unsafe { core::slice::from_raw_parts(ptr as *const u8, self.len()) }
    }
}
```

`init` is **safe**, takes `&[u8]`, stores ptr+len into a `Copy` integer
with no lifetime tie. `slice()` is **safe**, returns `&[u8]` tied to
`&self`. The borrow lifetime of the returned slice is `'_ self` — but
`self`'s storage no longer reflects the source slice's lifetime. UAF
follows from:

```rust
let p = {
    let local: Vec<u8> = b"hello".to_vec();
    PathString::init(&local)
};                          // local dropped here
let _ = p.slice();          // dangling
```

Plus pointer-as-usize round-trip (P3-BC-203 / strict-provenance debt).

`init_owned` (L130-143) at least is safe-but-leaky: it forgets a Box
which `deinit_owned` (L152-162, correctly `pub unsafe fn`) reclaims. The
`Copy` semantics still let a caller `let q = p; q.deinit_owned();
p.deinit_owned();` for a double-free — but `deinit_owned` is `unsafe`
so caller has to ack the contract.

**Fix path:** add a lifetime parameter (`PathString<'a>(...,
PhantomData<&'a [u8]>)`) for borrowed mode, splitting owned mode into a
`PathStringOwned` newtype.

### 5. `bun_core/string/StringBuilder.rs`

352 lines, 13 unsafe sites.

#### 5.1 Tier-1 P3-BC-002: `move_to_slice` returns uninit-tail Box

L315-332:
```rust
pub fn move_to_slice(&mut self) -> Box<[u8]> {
    let Some(ptr) = self.ptr.take() else { ... };
    let cap = self.cap;
    *self = Self::default();
    // TODO(port): if not fully written this reads uninit bytes — Zig didn't care.
    unsafe { crate::heap::take(slice::from_raw_parts_mut(ptr.as_ptr(), cap)) }
}
```

`heap::take` on a `[u8]` of length `cap` yields a `Box<[u8]>`. Bytes
`[len..cap]` are uninit. The function is `pub fn` (safe).

A caller does:
```rust
let mut b = StringBuilder::init_capacity(64);
b.append(b"hi");           // len = 2
let v = b.move_to_slice(); // Box<[u8]> of length 64; bytes [2..64] uninit
println!("{:?}", v);       // reads MaybeUninit<u8>
```

Reading uninit `u8` is rustc-current-day deferred UB; the *real* UB
materialises the moment the bytes feed into a function with a noundef
or freeze precondition, or get reinterpreted as `&str`. Either way:
safe-API UB.

**Fix:** Truncate to `self.len` before returning. Change the body to
`unsafe { Box::from_raw(slice::from_raw_parts_mut(ptr.as_ptr(), self.len)) }`
(after reallocating the spare capacity away with a `shrink_to_fit`-style
realloc, or accepting a one-time alloc for correctness).

#### 5.2 Tier-2 P3-BC-104: `append16` 1-byte OOB if paired with `count16`

L60-103 — `append16` writes `count + 1` bytes (the transcoded UTF-8 plus
a trailing NUL). The matching `count16_z` reserves `len + 1`; `count16`
reserves only `len`. The function offers no way to opt out of the NUL.

Trace:
```rust
let mut b = StringBuilder::default();
b.count16(&utf16_slice);         // reserves N
b.allocate().unwrap();
b.append16(&utf16_slice);        // writes N+1 → trailing byte is OOB
```

In practice every call site uses `count16_z` (the audit grepped all
~20 callers in `bun_install`, `bun_resolver`, `bundler`), but the
contract is unmarked.

**Fix:** Either rename `count16` → `count16_z` (collapse to one), or add
an `append16_no_nul` variant and `debug_assert!(remaining_cap >= count +
1)` in `append16`.

#### 5.3 Other unsafe (sound)

- L148-165 `pub unsafe fn append_raw<'a>` — correctly unsafe; doc
  spells out the unbounded-lifetime hazard.
- L284-309 `allocated_slice` / `writable` / `written_slice` — sound; len
  is upheld by every append.
- L335-349 `Drop` — reconstructs `Box<[MaybeUninit<u8>]>` to free. Sound.

### 6. `bun_core/string/MutableString.rs`

653 lines, 5 unsafe sites — but two are Tier-1.

#### 6.1 Tier-1 P3-BC-004: `to_owned_slice_length`

L416-420:
```rust
pub fn to_owned_slice_length(&mut self, length: usize) -> Box<[u8]> {
    // SAFETY: caller guarantees `length` bytes have been initialized.
    unsafe { self.list.set_len(length) };
    self.to_owned_slice()
}
```

`pub fn` (safe), `length: usize` is caller-supplied. Three failure modes:
1. `length > self.list.capacity()` — `set_len` requires `new_len <=
   capacity`. Calling with bigger is **immediate UB** (the Box returned
   has its `len` past the allocation).
2. `length > self.list.len()` and `length <= capacity` — exposes
   uninitialised tail to the returned `Box<[u8]>`.
3. `length < self.list.len()` — silently truncates without dropping (OK
   for `u8`, but the contract is unmarked).

**Fix:** make `pub unsafe fn`, or replace with a checked
`fn to_owned_slice_truncated(&mut self, length: usize) -> Option<Box<[u8]>>`
that asserts `length <= self.list.len()`.

#### 6.2 Tier-1 P3-BC-005: `inflate` + safe `slice`

L311-320:
```rust
pub fn inflate(&mut self, amount: usize) -> Result<(), AllocError> {
    self.list.reserve(amount.saturating_sub(self.list.len()));
    // SAFETY: `u8` has no drop and any bit pattern is valid; capacity ≥
    // `amount` after `reserve`. Callers MUST write before reading.
    unsafe { self.list.set_len(amount) };
    Ok(())
}
```

Combined with `pub fn slice(&mut self) -> &mut [u8] { &mut self.list }`
at L403-405, this is a safe code path to a `&mut [u8]` of length `amount`
where bytes `[old_len..amount]` are uninit.

The comment "any bit pattern is valid" for `u8` is *true* at the type
level — `u8` has no validity invariant. But:
- `MaybeUninit<u8>` reads as `u8` are deferred UB under current rustc;
  reading uninit through `&[u8]` IS UB per the official memory model
  (T-opsem position).
- A safe caller indexing `slice()[i]` for `i >= old_len` is reaching
  uninit through a `&[u8]`.

**Fix:** Either zero-fill the tail (matches `expand_to_capacity` at L75-84
which DOES zero-fill), or change `inflate` to return `&mut [MaybeUninit<u8>]`
for the freshly-exposed tail.

#### 6.3 Sound sites

- L101-104 `writable_n_bytes_assume_capacity` — `pub fn` calling
  `unsafe { vec::writable_slice_assume_capacity }`. The inner is
  correctly `pub unsafe fn`, but the outer wrapper drops the safety
  obligation. Same shape as P3-BC-004/005; **third Tier-1 candidate**,
  but the SAFETY comment is at the call site and current call sites
  fully write the buffer (audited the four in-tree callers). Documenting
  as Tier 2 boundary, not Tier 1, since misuse-via-current-callers
  doesn't exist — but the contract is asserted only in a comment.

- L298-309 `reset_to(index)` — `pub fn` with `debug_assert!(index <=
  capacity)`. Same shape: `set_len` in safe wrapper, but `reset_to` is
  always called to shrink, never grow, in current call graph. Tier 4.

### 7. `bun_core/string/SmolStr.rs`

407 lines, 5 unsafe sites.

#### 7.1 Sound

- L186-189, L218-221, L239-244: `Vec::from_raw_parts(ptr, len, cap)` —
  every call paired with a prior `from_baby_list` that captured the
  same triple via `ManuallyDrop<Vec<u8>>`. The Drop impl frees correctly.
- L326-333 `all_chars` — returns `&mut [u8; 15]` over the first 15 bytes
  of the backing `u128`. Sound by `repr(transparent)` and little-endian
  assert (L7).

#### 7.2 Tier-3 P3-BC-203: pointer-as-usize

L115-127 `from_baby_list`:
```rust
smol_str.set_raw_ptr_bits(p as usize);
```

Stores a pointer as `usize`. Recovered via:
```rust
pub fn ptr(&mut self) -> *mut u8 {
    (self.raw_ptr_bits() & NEGATED_TAG) as *mut u8
}
```

Pointer-to-integer-to-pointer round-trip fails `-Zmiri-strict-provenance`.
The integer also drops provenance under Stacked Borrows. Fix is the
standard `expose_provenance` / `with_exposed_provenance` migration once
strict provenance lands. **Tier 3 watchlist.**

The `TAG` bit (0x8000_0000_0000_0000) is the high bit of the pointer
word. On AArch64 with TBI, the top byte of a userspace pointer can be
non-zero (used as type tags by GC / Pointer Authentication Code). On
x86-64 with 5-level paging, bits 48-56 may be non-zero. Combining bit-57
into the tag word means **the type may misread its own tag bit on these
configurations**. Bun is not currently configured for either AArch64
TBI or LA57 (the `const _` assert at L9 forces 64-bit pointers but does
not forbid TBI), so this is Tier 3.

### 8. `bun_core/string/StringJoiner.rs`

290 lines, 12 unsafe sites.

#### 8.1 Tier-2 P3-BC-103: borrowed-slice lifetime laundering

L118-120 `push_static(&[u8])` / L146-151 `push(&[u8])` store a
`RawSlice<u8>` field with `owns_slice = false`. No lifetime tie. The
doc says "data is expected to live until `.done` is called" — once again
this is contract-by-comment.

Same shape as PathString (T2.1) and RawSlice (T2.2), with the additional
hazard that:

```rust
unsafe impl Send for StringJoiner {}
unsafe impl Sync for StringJoiner {}
```

at L27-28 makes the borrow-laundered slice cross thread boundaries. A
worker thread can `.done()` a `StringJoiner` whose `&[u8]` source went
out of scope on the spawning thread.

The Send/Sync rationale at L24-26 says "raw pointers in tail/Node are
interior to the singly-linked chain uniquely owned by this struct; no
aliasing escapes." That's true for the `Node::next` pointers (which are
internal). It is *not* true for the `Node.slice: RawSlice<u8>` of
borrowed slices, whose backing memory lives on the spawning thread.

**Fix:** Either restrict `push_static` to `&'static [u8]` (matching the
name — but the type signature accepts any `&[u8]`), or remove
`push_static` and force callers through `push_cloned`.

#### 8.2 Sound

- L84-95 `drain_chain` — owns the chain head, walks via `heap::take`.
  Sound.
- L99-105 `Drop` for `Node` — reconstructs `Box<[u8]>` for owned slices.
  Sound.

### 9. `bun_core/bounded_array.rs`

489 lines, 9 unsafe sites.

#### 9.1 Tier-1 P3-BC-003: `resize` + safe `slice` over `MaybeUninit<T>`

L108-114 `resize` is `pub fn` (safe). L93-104 `slice` / `const_slice` are
safe and read `[0..len]` as `[T]`.

For niche-bearing `T` (`NonNull<U>`, `&U`, `bool`, `char`, niche enums):
```rust
let mut b: BoundedArray<NonNull<u8>, 10> = Default::default();
b.resize(10).unwrap();           // safe — sets len=10 without init
let s = b.const_slice();         // safe — &[NonNull<u8>] of len 10
let _ = s[0];                    // reads uninit MaybeUninit<NonNull<u8>>
                                 // as NonNull<u8>; reference UB on the
                                 // slice formation itself.
```

The previous pass found a sibling at `add_many_as_slice` (Tier-2 F-2 in
the prior index). This extra entry point widens the family: the
`resize`-then-`slice` path is reachable without ever touching
`add_many_as_slice`.

**Fix:** Either (a) bound `T: bytemuck::AnyBitPattern` on the inherent
impl, (b) make `resize` `pub unsafe fn` (contract: "caller has
initialised the new tail"), or (c) split the API into `resize_init(len,
default: T)` requiring `T: Copy + Default` for the safe path.

#### 9.2 Reaffirmation of F-2

L160-174 `add_one_assume_capacity` returns `&mut T` from `MaybeUninit<T>`;
L189-196 `add_many_as_slice` returns `&mut [T]` from `&mut
[MaybeUninit<T>]`. Same family; one prior finding.

### 10. `bun_core/output.rs` — scoped logging, colored output

3,173 lines, 27 unsafe sites.

#### 10.1 Reaffirmation T2.7 = P3-BC-107 (CODEX-P3-writer-static-mut)

L1074-1110: five safe accessors that all funnel through `source_writer_escape`,
which forms `&'static mut io::Writer` from a thread-local. Two concurrent
calls on the same thread return aliasing `&mut`. Source TODO acknowledges:
"Returning `&'static mut` is *unsound* if two are alive at once."

Already in the index; reconfirming here because the audit re-verified
the surface area:
- `error_writer()`
- `error_writer_buffered()`
- `error_stream()`
- `writer()`
- `writer_buffered()`

All five are `pub fn` returning `&'static mut io::Writer`. The fix
proposed in the prior plan (closure-scoped writer access) requires
migrating every caller; the audit did not find a smaller fix.

#### 10.2 Sound

- `TERMINAL_SIZE: AtomicCell<Winsize>` at L306-312 — uses the verified
  Atom primitive for an 8-byte `repr(C)` struct. Sound.
- `STDOUT_STREAM` / `STDERR_STREAM` `RacyCell<StreamType>` (L283-284) +
  `SOURCE` `thread_local!` `RefCell<Source>` — the migration target for
  the writer escape. Sound today: write-once at startup, read on
  every thread via the cell.
- `SCOPED_FILE_WRITER` `RacyCell<QuietWriter>` (L2660) — write-once at
  startup, read on every debug log site. Sound.

### 11. `bun_core/external_shared.rs` — `WTF::RefPtr<T>` shape

213 lines, 21 unsafe sites — **all correctly modelled**:

- `unsafe trait ExternalSharedDescriptor` (L13) — contract on
  `ext_ref`/`ext_deref`.
- `pub unsafe fn adopt` / `pub unsafe fn clone_from_raw` (L34, L55, L130,
  L148) — correctly unsafe for the caller's responsibility to provide a
  valid pointer with the right refcount.
- `Clone` and `Drop` impls (L98-112, L172-189) — internal `unsafe` calls
  to `T::ext_ref`/`ext_deref` from already-validated `self.ptr`.
- The `WTFStringImpl` descriptor impl (L199-208) delegates to the
  FFI-backed `r#ref`/`deref`.

The Send/Sync auto-traits resolve correctly: `ExternalShared<T>` contains
`NonNull<T>` which is `!Send + !Sync`, so callers must explicitly opt in
(no `unsafe impl` here).

**No new findings.** The file is a model for how the rest of the crate
should look.

### 12. `bun_core/env_var.rs`

1,052 lines, 1 unsafe site (L343).

Cached env-var accessors with `AtomicPtr<u8>` + `AtomicUsize` pairs. The
publish protocol (L347-366):
```rust
self.ptr_value.store(ev.as_ptr().cast_mut(), Ordering::Relaxed);
self.len_value.store(ev.len(), Ordering::Release);
```

And read (L328-344):
```rust
let len = self.len_value.load(Ordering::Acquire);
if len == NOT_LOADED_LEN { return Unknown; }
if len == NOT_SET_LEN    { return NotSet; }
let ptr = self.ptr_value.load(Ordering::Relaxed);
CacheOutput::Value(unsafe { slice::from_raw_parts(ptr, len) })
```

Sound by Release-on-len + Acquire-on-len: after the Acquire load observes
the new len, the Relaxed ptr load is guaranteed to observe the matching
ptr (because the publisher wrote ptr-Relaxed before len-Release, and the
Release synchronises-with the Acquire).

The doc-comment at L351-354 notes "racy" two-writer behaviour is OK
because all writers compute the same `getenv` result (idempotent).

**Tier 3 (P3-BC-209):** the ordering asymmetry is correct but unusual.
A future refactor that flipped the order or dropped Release re-introduces
a race. Worth a regression test that verifies the orderings.

### 13. `bun_core/fmt.rs` — Latin-1 / UTF-8 / hex formatting

3,878 lines, 14 unsafe sites.

#### 13.1 Tier-1 P3-BC-001: `fmt::Raw` / `fmt::s` / `fmt::raw`

L722-731:
```rust
#[derive(Copy, Clone)]
#[repr(transparent)]
pub struct Raw<'a>(pub &'a [u8]);
impl fmt::Display for Raw<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        // SAFETY: caller contract — `self.0` is valid UTF-8 (in practice ASCII:
        // npm package names, registry URLs, semver tags). Matches Zig `{s}`.
        f.write_str(unsafe { core::str::from_utf8_unchecked(self.0) })
    }
}

pub const fn raw(bytes: &[u8]) -> Raw<'_> { Raw(bytes) }

#[inline(always)]
pub const fn s(bytes: &[u8]) -> Raw<'_> { Raw(bytes) }
```

Plus L3755-3759 (private helper):
```rust
fn write_bytes(w: &mut impl fmt::Write, bytes: &[u8]) -> fmt::Result {
    // SAFETY: see `s()` above — Zig's `{s}` path, callers feed ASCII/utf8.
    w.write_str(unsafe { core::str::from_utf8_unchecked(bytes) })
}
```

The "caller contract" is comment-only. The constructors `raw`/`s` are
safe `const fn`s.

**Why this is Tier 1, not Tier 3:** Live call sites pass:
- `output.rs:2422` — `argv[0]` — POSIX argv may contain non-UTF-8 bytes
  (filenames are arbitrary byte sequences).
- `output.rs:2425` — `arg` from argv — same.
- `Progress.rs:637` — `name` from progress task — typically ASCII but
  doesn't have to be.
- `install/extract_tarball.rs:48, 258, 259, 351, 364, 365, 456, 457, 551,
  553, 554` — `name`, `tmpname.as_bytes()`, `folder_name` — tarball
  archive entries can contain any byte sequence (CVE territory if
  trusted).
- `string/mod.rs:1401, 2216` — `self.slice()` on a `ZigString` — already
  transcoded to UTF-8 elsewhere, so these are safe in practice.

The argv and tarball-entry paths are reachable from untrusted input.
Even ignoring the security angle, creating an invalid `&str` via
`from_utf8_unchecked` is **immediate library UB** (the value carries a
validity invariant) before any read or write occurs.

**Fix:** Either (a) replace `Display` impl with `bstr::BStr::new(self.0).fmt(f)`
(BStr handles invalid UTF-8 by lossy display), or (b) rename to `unsafe
fn raw_unchecked` so callers acknowledge the contract.

#### 13.2 Sound `from_utf8_unchecked` sites

- L1082-1090 `parse_ascii` — early-returns on non-ASCII. Sound.
- L2732-2737 `bytes_to_hex_lower_string` — output is hex chars (ASCII).
- L2762-2780 `HexBytes` Display — same.
- L1102-1117 `format_latin1` — manually transcodes Latin-1 → UTF-8 in
  chunks; only `from_utf8_unchecked`s the chunk after `copy_latin1_into_utf8`
  writes guaranteed-valid UTF-8 bytes.

### 14. `bun_core/lib.rs` — foundation

3,445 lines, 155 unsafe sites. Audited the high-traffic sections:

#### 14.1 Tier-2 P3-BC-102: `RawSlice<T>`

L110-212. Same shape as PathString (T2.1) but generic, and the type is
used pervasively (every `BORROW_FIELD` raw fat-pointer port site). The
`unsafe impl<T: Sync> Send/Sync for RawSlice<T>` at L211-212 is correct
for the autotrait shape, but doesn't fix the lifetime gap.

**Fix:** Add a phantom lifetime: `RawSlice<'a, T>(*const [T], PhantomData<&'a [T]>)`.
The repr-transparent stays. Migrating every call site is mechanical but
broad-touch.

#### 14.2 Tier-3 P3-BC-208: `impl_field_parent! fn raw`

L937-948 macro arm:
```rust
($Child:ty => $Parent:ident . $field:ident ; $v:vis fn raw $name:ident ;) => {
    impl $Child {
        $v fn $name(&self) -> *mut $Parent {
            unsafe {
                $crate::from_field_ptr!($Parent, $field, ::core::ptr::from_ref(self).cast_mut())
            }
        }
    }
};
```

`from_ref(self).cast_mut()` is the same Stacked-Borrows / Tree-Borrows
poisoned-pointer pattern as Tier-1 U1 (`pack_command.rs:3009`). The
macro itself doesn't dereference the result — the SAFETY note at L941-942
says "pointer arithmetic only; the returned pointer is not dereferenced
here." That makes the *expansion* sound, but every caller materialising
`&mut *p` from this arm trips the UB U1 documents.

The audit did not find an in-tree caller that does the `&mut *p`
materialisation against a shared-provenance pointer derived from this
macro, but the macro fires the poisoned pointer at every site. Tier 3.

#### 14.3 Sound (sampled)

- L120-170 `RawSlice::EMPTY`/`new`/`as_ptr`/`len`/`is_empty`/`slice` —
  the slice formation in `slice()` is sound for a valid `*const [T]`;
  the type-level lifetime gap is T2.2.
- L444-457 `vec::writable_slice` — correctly `pub unsafe fn`.
- L460-474 `vec::writable_slice_assume_capacity` — correctly unsafe.
- L516-540 `vec::spare_bytes_mut` / `reserve_spare_bytes` — correctly
  unsafe; SAFETY comments describe the write-only-tail contract.
- L587-600 `vec::fill_spare` — correctly unsafe; ergonomic combinator
  for the producer-into-spare-capacity pattern.
- L789-832 `container_of` / `callback_ctx` — correctly unsafe; both
  document the C-trampoline / `@fieldParentPtr` contract.
- L2950-2953 `zeroed_unchecked` — correctly unsafe; escape hatch for
  the `Zeroable`-bound `zeroed` API.

#### 14.4 `Zeroable` trait (L2924-2950)

Local re-spelling of `bytemuck::Zeroable` to allow blanket impls on
foreign `libc::*` POD. `unsafe trait`, correctly documented contract
("no non-nullable pointers, no `bool`/`char` outside their valid range,
no niche-optimised enums").

The blanket impls at L2960-3050 — audited every `libc::*` impl against
the libc crate's struct definitions:
- `sigaction`, `sigset_t`, `utsname`, `winsize`, `rlimit`, `passwd`,
  `stat`, `rusage`, `timespec`, `timeval`, `pollfd`, `Dl_info`,
  `sockaddr*`, `addrinfo`, `sysinfo`, `epoll_event`, `signalfd_siginfo`,
  `statfs`, `kevent`, `kevent64_s` — all `#[repr(C)]` over integers and
  function pointers; zero is a valid value for each field. **Sound.**

`passwd`/`addrinfo` contain `*mut c_char` / `*mut addrinfo` fields —
null is a valid pointer value for those (and the docs explicitly say
"raw pointers" are Zeroable). **Sound.**

### 15. `bun_core/util.rs` — global utilities

5,777 lines, 128 unsafe sites. Audited the high-traffic primitives:

#### 15.1 Reaffirmation: `Unaligned<T>::slice_align_cast` (T3.7)

L208-265. `pre-existing-ub-ptr-2` in the prior index. Debug-only alignment
check before forming `&[T]` over potentially-unaligned bytes. Already
filed.

#### 15.2 `bytes_as_slice_mut` (L196-206)

`pub unsafe fn bytes_as_slice_mut<T>(bytes: &mut [u8]) -> &mut [T]`:
**release-asserted** alignment via `assert!` (not `debug_assert!`). The
doc says "release. The check is a single AND+CMP and every current call
site is immediately followed by a syscall, so the cost is negligible."
This is the *right* shape compared to `Unaligned::slice_align_cast`'s
debug-only assert. Sound.

#### 15.3 `RacyCell<T>` (L2270-2316)

Reaffirmation of PUB-N-B from the prior index. `unsafe impl<T: ?Sized>
Sync for RacyCell<T>` is discipline-only.

#### 15.4 `Once<T, F>` (L2691-2692)

```rust
unsafe impl<T: Send + Sync, F: Sync> Sync for Once<T, F> {}
unsafe impl<T: Send, F: Send> Send for Once<T, F> {}
```

Audited the bounds: `Once` runs `F: FnOnce() -> T` once and stores `T`.
For Sync, both `T` and `F` (the closure that may run on any thread that
wins the race) need cross-thread sharing. The `F: Sync` bound is
conservative — `FnOnce` closures don't need to be `Sync` to be called
once, but they need to be `Send` to ship to the winning thread. **The
bounds are slightly stricter than strictly necessary** but not unsound.
No bug.

#### 15.5 Sound (sampled)

- L1568-1648 `fd_path_raw` / `fd_path_raw_w` — correctly `pub unsafe fn`;
  buffer + capacity contract.
- L3011-3060 `csprng` — calls `getrandom` / `BCryptGenRandom`; sound.
- L3478-3532 `bytes_of` / `bytes_of_mut` / `cast_slice` / `cast_slice_mut`
  / `slice_as_bytes` — bytemuck wrappers; safe-by-trait-bound. Sound.
- L4124-4136 `dupe_z` — heap-allocates a NUL-terminated copy; sound.
- L4184-4194 `init_argv` — correctly `pub unsafe fn`.
- L4544-4555 `set_argv` — correctly `pub unsafe fn`.

#### 15.6 Other notable

- L2340 `unsafe impl Sync for ThreadLock` — manual; ThreadLock is the
  Rust-side rendering of Zig's cross-thread mutex over an atomic owner
  id, sound on its API.

### 16. `bun_core/string/immutable.rs` — SIMD-backed `&[u8]` toolkit

3,465 lines, 24 unsafe sites.

Audited highlights:

- L496-545 `next_code_point` — `copy_nonoverlapping(contents.add(cur), quad, cp_len)`
  with `cp_len ∈ 2..=4` and `avail >= cp_len` checks above. Sound.
- L573-592 `memmem` POSIX path — libc `memmem` shim; pointer-as-usize
  return arithmetic at L590 is a strict-provenance debt (already counted).
- L893-905 `last_index_of_char` POSIX — libc `memrchr` shim, sound.
- L1487-1500 `eql_comptime_check_len_u8_impl` — `get_unchecked(..b.len())`
  after a `debug_assert!(a.len() >= b.len())`. **Reaffirmation of B-002**
  (perf-only); the function is private, all callers pass a slice already
  bounds-checked. No bug.
- L1910-1917 `str_utf8` — simdutf-validated; sound `from_utf8_unchecked`.
- L1922-1944 `format_latin1` — chunked transcode; sound.
- L2664-2710 `ares_inet_pton` shim — sound.

No new findings beyond the strict-provenance debt.

### 17. `bun_paths/path_buffer_pool.rs` — per-thread 4-slot pool

164 lines (lives in `bun_paths`, not `bun_core`, but heavily used by
`bun_core` allocators).

Audited every unsafe site:

- L46-55, L62-68 `PoolStorage::new_boxed` (both impls): `Box::<Self>::new_zeroed().assume_init()`
  on `#[repr(transparent)]` `[u8; N]` / `[u16; N]`. SAFETY comment is
  correct — all-zero is a valid `u8`/`u16`. Sound.

Per-thread state via `thread_local!` `RefCell<Vec<Box<...>>>`. The
`PoolGuard<T>` RAII drops the buffer back into the pool. **Send/Sync**:
the guard is `!Send + !Sync` by default because `RefCell` is `!Sync` —
no explicit unsafe impls. **Sound.**

`delete_all()` at L94-96 is a `pub fn` that clears the pool — callable
from any thread but operates only on the current thread's pool (via
`with_pool`). Sound.

`PathBufferPoolT::put(buf)` at L84-92 — `pub fn`, drops the buffer if
the pool is full. Sound.

**No findings. The pool is a model implementation.**

The audit did NOT find cross-thread sharing of `PoolGuard<PathBuffer>` —
the type's `!Send + !Sync` auto-trait derivation correctly forbids it.

---

## Bug findings — detailed

### Tier 1 — confirmed patchable

#### T1.1 P3-BC-001 — `fmt::Raw` / `fmt::s` / `fmt::raw` UTF-8 contract

**File:** `src/bun_core/fmt.rs:722-737, 3744-3749, 3755-3759`

**Class:** safe-API `from_utf8_unchecked` on untrusted bytes.

**Patch sketch:**
```rust
impl fmt::Display for Raw<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        // Lossy display: replaces invalid sequences with U+FFFD.
        write!(f, "{}", bstr::BStr::new(self.0))
    }
}
```

Or, if zero-overhead is required for the ASCII fast path:
```rust
impl fmt::Display for Raw<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        if simdutf::validate::utf8(self.0) {
            // SAFETY: validated above.
            f.write_str(unsafe { core::str::from_utf8_unchecked(self.0) })
        } else {
            write!(f, "{}", bstr::BStr::new(self.0))
        }
    }
}
```

#### T1.2 P3-BC-002 — `StringBuilder::move_to_slice` uninit tail

**File:** `src/bun_core/string/StringBuilder.rs:315-332`

**Class:** safe `pub fn` returns a `Box<[u8]>` whose tail is uninit.

**Patch sketch:**
```rust
pub fn move_to_slice(&mut self) -> Box<[u8]> {
    let Some(ptr) = self.ptr.take() else {
        *self = Self::default();
        return Box::default();
    };
    let len = self.len;
    let _cap = self.cap;
    *self = Self::default();
    // Truncate to the initialised prefix. The trailing uninit capacity
    // leaks back to the allocator on the realloc-down inside `into_iter
    // ::collect::<Vec<_>>` shrink; for u8 we can avoid the realloc by
    // reading-then-truncating a Vec instead of a Box.
    let mut v = unsafe {
        Vec::from_raw_parts(ptr.as_ptr(), len, _cap)
    };
    v.shrink_to_fit();
    v.into_boxed_slice()
}
```

If callers genuinely depend on the cap-sized return (audit grepped — only
ten callers, all use the result as `.iter()` / `&[u8]` truncated to known
length), the simpler fix is:
```rust
let v = unsafe { Vec::from_raw_parts(ptr.as_ptr(), len, _cap) };
v.into_boxed_slice()  // copies tail away via shrink-to-fit when len < cap
```

#### T1.3 P3-BC-003 — `BoundedArray::resize` + safe `slice`

**File:** `src/bun_core/bounded_array.rs:108-114, 93-104`

**Class:** same uninit-as-`T` family as F-2, additional safe entry.

**Patch sketch (recommended — bound on Pod):**
```rust
impl<T: bytemuck::AnyBitPattern, ..., const BUFFER_CAPACITY: usize, ...>
    BoundedArray<T, ...>
{
    pub fn resize(&mut self, len: usize) -> Result<(), OverflowError> { ... }
    pub fn slice(&mut self) -> &mut [T] { ... }
    pub fn const_slice(&self) -> &[T] { ... }
}
```

If the bound is too aggressive, split:
```rust
impl<T, ...> BoundedArray<T, ...> {
    pub unsafe fn resize_uninit(&mut self, len: usize) -> Result<(), OverflowError> { ... }
}
impl<T: Copy + Default, ...> BoundedArray<T, ...> {
    pub fn resize_init(&mut self, len: usize, default: T) -> Result<(), OverflowError> { ... }
}
```

#### T1.4 P3-BC-004 — `MutableString::to_owned_slice_length` checked

**File:** `src/bun_core/string/MutableString.rs:416-420`

**Class:** safe `pub fn` calls `set_len` with caller-supplied length.

**Patch sketch:**
```rust
pub fn to_owned_slice_length(&mut self, length: usize) -> Box<[u8]> {
    assert!(length <= self.list.len(),
        "to_owned_slice_length: length {length} > initialised len {}",
        self.list.len());
    self.list.truncate(length);
    self.to_owned_slice()
}
```

Or mark `pub unsafe fn` if the perf cost of the assert is unacceptable.

#### T1.5 P3-BC-005 — `MutableString::inflate` zero-fill or MaybeUninit

**File:** `src/bun_core/string/MutableString.rs:311-320`

**Class:** safe `pub fn` exposes uninit through `pub fn slice`.

**Patch sketch (option A — zero-fill):**
```rust
pub fn inflate(&mut self, amount: usize) -> Result<(), AllocError> {
    let old = self.list.len();
    self.list.resize(amount.max(old), 0u8);
    Ok(())
}
```

This loses the "Zig undefined" semantic but `expand_to_capacity` at L75-84
already zero-fills, so the in-tree semantic is already shifted. The
perf cost is one extra memset on a printer pre-size path.

**Patch sketch (option B — typed MaybeUninit tail):**
```rust
pub fn inflate_uninit(&mut self, amount: usize) -> Result<&mut [MaybeUninit<u8>], AllocError> {
    self.list.reserve(amount.saturating_sub(self.list.len()));
    Ok(&mut self.list.spare_capacity_mut()[..amount.saturating_sub(self.list.len())])
}
```

Keep the existing `inflate` but make it `pub unsafe fn`.

### Tier 2 — public-contract / architecture defects

See per-finding sections 4 (PathString), 14.1 (RawSlice), 8.1
(StringJoiner), 5.2 (StringBuilder::append16), 3.2
(create_uninitialized_*), 3.3 (String::deref Copy footgun), 10.1
(output writer escape).

Remediation for these is larger than a one-line patch — each requires
either (a) adding a phantom lifetime parameter, (b) splitting a Copy
type into owned + borrowed forms, or (c) migrating every caller to a
closure-scoped API.

Recommended landing order (smallest first):

1. **`StringBuilder::append16` debug-assert** — single-file fix, no
   caller migration. Add `debug_assert!(self.cap - self.len >= count + 1)`
   inside `append16`.

2. **`create_uninitialized_latin1` / `_utf16` closure form** — replace
   `(Self, &'static mut [u8])` return with `with_uninitialized_latin1<R>(len,
   f: impl FnOnce(&mut [u8]) -> R) -> (Self, R)`. Migrate ~10 in-tree
   callers.

3. **`RawSlice<T>` phantom lifetime** — `RawSlice<'a, T>`. Migrate every
   site that uses the type (StringJoiner, bun_alloc, ~5 places). The
   `Send`/`Sync` impls stay; the lifetime makes the borrow contract
   checkable.

4. **`PathString` lifetime + owned-split** — `PathString<'a>` for
   borrowed, `PathStringOwned` for the heap-adopting form. The packed-
   pointer layout is preserved; the `Copy` impl stays for the borrowed
   form. Heaviest migration.

5. **Output writer closure-scoped** — `Output::with_writer(|w| ...)` and
   `Output::with_error_writer(|w| ...)`. Migrate every caller that
   currently spells `Output::writer().write_all(b"...")`. Largest scope.

6. **`String::deref` removal in favour of `OwnedString`-only** — requires
   reshaping the FFI surface to pass-by-pointer for refcount-managed
   strings. Largest blast radius; defer until the FFI surface
   refactoring is otherwise planned.

### Tier 3 — latent / watchlist

See per-finding sections 2.2 (Atom no-padding), 2.3 (Atom pointer reprs),
7.2 (SmolStr pointer-as-usize), 3.5 (ZigStringSlice borrow validity),
2.4 (ThreadCell Sync), 3.5 (String Send/Sync), 15.1 (Unaligned), 14.2
(impl_field_parent fn raw arm), 12 (env_var ordering future-proof).

These should not be patched without a triggering reason — each is sound
today and the fix would touch code that currently works.

---

## Hardened SAFETY-comment templates per primitive

Below: the SAFETY comment shape every site of each primitive should
share, so a future audit can grep for divergence.

### `heap::take(ptr)` / `heap::destroy(ptr)`

```rust
// SAFETY: `ptr` was produced by `heap::alloc` / `heap::into_raw` /
// `heap::alloc_nn` / `heap::into_raw_nn` at <SITE>, has not been freed
// by another `heap::take` / `heap::destroy`, and no other live pointer
// or reference aliases the same allocation. Ownership of the heap block
// transfers to the returned `Box<T>` (`take`) or is dropped here
// (`destroy`).
```

### `Box::leak` / `heap::release`

```rust
// SAFETY: ownership of the allocation is handed off to <OWNER>
// (intrusive refcount on T / JSC ExternalStringImpl / WeakPtr table /
// enqueued work-pool task), which will reclaim it via `heap::take`. The
// returned `&'static mut T` is documented to actually live until <OWNER>
// reclaims; no caller may outlive that.
```

### `AtomicCell<T>::load` / `store`

```rust
// SAFETY: `T: Atom` guarantees size 1/2/4/8 with no padding, and `T`
// is the same type the cell was stored as. The default ordering is
// Acquire/Release — see the AtomicCell doc for when to opt into
// load_relaxed/store_relaxed.
```

### `unsafe_impl_atom!(T)`

```rust
// SAFETY: caller of `unsafe_impl_atom!` upholds:
//   * size_of::<T>() ∈ {1,2,4,8} — checked at compile time
//   * align_of::<T>() ≤ align_of::<u64>() — checked at compile time
//   * `T` has no padding bytes (no `#[repr(C)] enum E { A, B, C }`-style
//     implicit padding; prefer explicit `#[repr(uN)]` enums)
//   * round-trip `T → uN → T` (where every uN observed was produced from
//     a valid T) yields the original T (this is weaker than
//     `bytemuck::AnyBitPattern`).
```

### `ExternalShared<T>::adopt(raw)` / `clone_from_raw(raw)`

```rust
// SAFETY: `raw` is a valid pointer to a live T managed by the external
// refcount, AND the caller is transferring exactly one outstanding ref
// to the returned `ExternalShared`. The matching deref happens in
// `ExternalShared::Drop` (`adopt`) or after this site bumped the
// refcount via `T::ext_ref` (`clone_from_raw`).
```

### `String::as_wtf()` / `as_zig()` (internal `fn`)

```rust
// SAFETY: the caller branched on `self.0.tag` (debug_asserted in the
// body) so the active union arm is the one accessed. `WTFStringImplStruct`
// pointers are non-null, refcount ≥ 1 (constructor invariant).
```

### `slice::from_raw_parts(ptr, len)` over `Vec`/`Box` storage

```rust
// SAFETY: `ptr` was produced by <SOURCE> and points to `len` initialised
// `T` for the duration of <LIFETIME-OWNER>. Per the Vec/Box invariant,
// the pointer is non-null and aligned for T. No other `&mut` reference
// to the same backing allocation is live for the returned borrow's
// lifetime.
```

### `Box::<T>::new_uninit_slice(cap)` + later `from_raw_parts`

```rust
// SAFETY: every byte in `[0, len)` was written by <CALLER-PROTOCOL>;
// bytes in `[len, cap)` are uninit. The returned `Box<[u8]>` is
// truncated to `len` before any read (or treated as write-only until
// truncation).
```

### Pointer-as-usize (strict-provenance)

```rust
// SAFETY: pointer round-tripped through `usize` for packed-pointer
// storage. Strict provenance currently lost; <FUTURE-FIX>: migrate to
// `core::ptr::expose_provenance` / `with_exposed_provenance` once
// stable. On AArch64 with TBI, the top byte must be zero (current
// build does not enable TBI). On x86_64 with 5-level paging (LA57),
// the top 11 bits must be zero (current build asserts 4-level paging).
```

---

## Recommended PRs (landing order)

The Tier-1 fixes are five small patches that can each ship independently.
None of them touch the FFI surface or the WTF allocator hand-off.

### PR 1 — `fmt::Raw` BStr or simdutf-validated

- Patch `bun_core/fmt.rs:725-731` per T1.1.
- Audit-grep `fmt::s` / `fmt::raw` call sites; flag any that pass
  user-supplied bytes (argv, tarball entries) and accept the lossy-display
  semantic.
- No test exists for non-UTF-8 argv display; add a regression in
  `test/cli/run/cli.test.ts` that spawns Bun with a non-UTF-8 arg and
  asserts the printed output is well-formed UTF-8.

### PR 2 — `StringBuilder::move_to_slice` truncate-to-len

- Patch `bun_core/string/StringBuilder.rs:315-332` per T1.2.
- Add a debug test that fills 32 bytes of a 64-byte builder and asserts
  `move_to_slice().len() == 32` (currently 64).

### PR 3 — `BoundedArray::resize` AnyBitPattern bound

- Patch `bun_core/bounded_array.rs:108-114` per T1.3.
- Split `resize_init` / `resize_uninit` if the bound is too restrictive.
- Add a compile-fail test that `BoundedArray<NonNull<u8>, 10>::resize`
  is rejected.

### PR 4 — `MutableString::to_owned_slice_length` assert

- Patch `bun_core/string/MutableString.rs:416-420` per T1.4.
- Single-file fix; no caller migration needed (the assert holds for
  every current caller).

### PR 5 — `MutableString::inflate` zero-fill

- Patch `bun_core/string/MutableString.rs:311-320` per T1.5.
- Single-file fix; the perf cost is one memset on a cold path.
- Add a regression test that reads `slice()[i]` for `i > old_len` after
  `inflate` and asserts it's zero.

### PR 6 — `StringBuilder::append16` count-mismatch debug assert (Tier 2)

- Patch `bun_core/string/StringBuilder.rs:60-103` to add
  `debug_assert!(self.cap - self.len >= count + 1)` and a doc note that
  `append16` requires `count16_z`, not `count16`.

### PR 7+ — Tier 2 architectural fixes

Defer per the order in §"Tier 2 — public-contract / architecture defects"
above. None of these are required to ship; they are insurance against
future call-site UB.

---

## Negative findings (rule-outs)

The audit value also lives in classes ruled out:

| Class | Result |
|-------|--------|
| `heap.rs` round-trip helpers (4 entry points × ~1.8k call sites in tree) | No new mismatched-allocator or double-free found. The U2.x family from the prior pass is exhaustive. |
| `atomic_cell.rs` `Atom` trait + macros (8 built-in + 2 external impls) | All sound. No `enum E { A, B }` with implicit padding currently fed to `unsafe_impl_atom!`. |
| `external_shared.rs` ExternalShared / Optional / WTFString | All sound; the file is a model for `unsafe trait` + `pub unsafe fn` discipline. |
| `path_buffer_pool.rs` 4-slot thread-local pool | All sound; `PoolGuard` correctly `!Send + !Sync`. |
| `env_var.rs` cached env-var accessors | Release/Acquire publish protocol is correct (P3-BC-209 is a future-proofing flag, not a current bug). |
| `result.rs` Error interning (Vec + RwLock + Relaxed cache) | Atomic ordering is sound; the RwLock provides happens-before for `EXTRA` reads. |
| `String::Display` chain (via `to_utf8_without_ref` + `from_utf8_unchecked`) | All paths yield validated UTF-8; the `from_utf8_unchecked` is sound by call-graph audit. |
| `Zeroable` libc blanket impls (~25 types) | All checked against libc crate field definitions; zero is valid for every field. |
| `next_code_point` UTF-8 decoder fast/slow path | Bounds + cp_len checks are correct; `copy_nonoverlapping` is fed a verified slice. |
| `eql_comptime_check_len_u8_impl` `get_unchecked` | Caller-bounded; private function, all callers pre-check length. |
| `unsafe impl Send/Sync for StringJoiner / Node` | Correct for the owned-payload variant; unsound only via the `RawSlice` lifetime gap (T2.2 / T2.3). |

The `bun_core` crate is **not riddled with UB**. The five Tier-1
findings are real and patchable; the seven Tier-2 findings are real and
require architecture work; everything else is either sound or already
in the prior index. The crate's foundation is more solid than the
unsafe-density would suggest — most of the `unsafe` blocks are
correctly contained, correctly documented, and correctly bounded by
their callers. The cases above are the exceptions.
