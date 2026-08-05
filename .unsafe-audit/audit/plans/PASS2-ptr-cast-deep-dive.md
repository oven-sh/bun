# PASS-2 Deep Dive: `ptr_cast` Cluster (2,231 sites)

Sub-categorization, soundness analysis, strict-provenance compliance scan,
candidate pre-existing UB list, and recommended mechanical refactors for the
largest single semantic category in Bun's Rust `unsafe` inventory.

Source data: `.unsafe-audit/unsafe-inventory.jsonl`
(11,044 unsafe sites total; 2,231 carry the `ptr_cast` category).

---

## 1. Executive Summary

| Metric | Value |
|---|---|
| Total `ptr_cast` sites | **2,231** |
| Files touched | 411 |
| Crates touched | 79 (of ~200 workspace members) |
| Co-tagged with any FFI category (`*_ffi`) | 462 (20.7%) |
| Co-tagged with `raw_ptr_lifecycle` | 234 (10.5%) |
| Co-tagged with `slice_from_raw` | 127 (5.7%) |
| Co-tagged with `ptr_intrinsic` (read/write/copy) | 379 (17.0%) |
| Sub-clusters identified (this report) | **17** |
| Sub-clusters classified (A) sound-by-shape | 12 |
| Sub-clusters classified (B) caller-discipline | 4 |
| Sub-clusters classified (C) UB-risk | 1 (P14b "mut-from-shared dealloc") |
| **Candidate pre-existing UB sites** | **9** (8 Stacked-Borrows mut-from-shared dealloc/free sites, 1 invalid `&mut`) |
| Strict-provenance offenders (real ptr↔int round-trips) | **11** unique sites |
| Mechanical refactor opportunities | ~45 (slice round-trip → raw ptr; `as` cast → `.cast()`) |

The 2,231-site total is dominated by FFI-out (`as_ptr()`, `as_mut_ptr()` to C)
and typed pointer projection (`.cast::<T>()` on a `*mut c_void` callback ctx
or a `NonNull` field). These are pattern-safe by construction. The interesting
needles in the haystack are:

1. **Eight mut-from-shared *deallocation/free* sites** where a `&[T]`/`&T`-derived
   pointer is fed to `Box::from_raw` / `heap::destroy` / `mi_free`. These are
   Stacked Borrows UB on the dealloc path. Tree Borrows tolerates them only
   because no data is actually written through the parent provenance — but
   `dealloc` is a write under SB semantics. Sites: `src/http/AsyncHTTP.rs:117`,
   `src/http/lib.rs:176`, `src/runtime/node/node_fs.rs:2397`,
   `src/bun_alloc/lib.rs:3267`, `src/bun_core/string/mod.rs:1765`,
   `src/jsc/lib.rs:2022` (was `:2013` pre-`fe2635b460` cargo fmt; Pass-5 accuracy sweep), and `src/jsc/ZigString.rs:70,102`.

2. **One invalid `&mut` formation**: `src/runtime/cli/pack_command.rs:3009`
   forms `&mut T` from a `*const T` cast through `ptr::from_ref(...).cast_mut()`.
   The `&mut` is then handed to `RunCommand::run_package_script_foreground`,
   which mutates the pointee. UB regardless of borrow model since the `&mut`
   itself has SharedReadOnly provenance.

3. **One Vec-borrowed-as-`ManuallyDrop<Vec>`**:
   `src/collections/vec_ext.rs:300` — `from_borrowed_slice_dangerous` wraps
   `&[T]` as a `Vec` for API compatibility. The `unsafe fn` is `dangerous`-named
   and contract-load-bearing; not a bug but a brittle pattern.

4. **Strict-provenance non-compliance**: 11 sites round-trip pointers through
   `usize` or extract pointers from raw integers stored in libuv/libc opaque
   fields. They compile fine today; will fail under `-Zmiri-strict-provenance`
   or the future strict-provenance lint. Mechanical fix: `expose_provenance()` /
   `with_exposed_provenance_mut`.

The remaining ~2,210 sites are sound when their preconditions hold, dominated
by mechanical FFI boundary plumbing. The cluster is **not** the largest source
of UB exposure in the inventory — the prior PASS-1 reviewers correctly
identified that. PASS-2 confirms the size is real but the risk density is low.

---

## 2. Sub-cluster Catalog

Sub-clusters were derived by tokenizing the `normalized` field with a
priority-ordered classifier (see `/tmp/classify_ptr_cast.sh`). Each site falls
into exactly one sub-cluster (most-specific match wins).

Classification key:
- **(A)** sound-by-shape: the unsafety is type-system bookkeeping; no runtime
  invariant the caller can violate makes this UB on its own.
- **(B)** caller-discipline: sound iff caller upholds documented contract;
  surveyed cases consistently uphold it.
- **(C)** UB-risk: pattern is or can be UB under at least one accepted borrow
  model with no mitigating invariant in the inspected sample.

### Subcluster P01 — `.as_ptr()` (749 sites, ~33.6%)  — Class (A)

Surface form: `slice.as_ptr()`, `vec.as_ptr()`, `nonnull.as_ptr()`,
`ManuallyDrop<T>::as_ptr()`, `Cell::as_ptr()`.

Dominant role: passing a Rust-owned buffer's start address to C. Read-only on
the C side. Examples:
- `src/sys/lib.rs` — `bytes.as_ptr()` to `libc::write`, `libc::sendmsg`.
- `src/uws/lib.rs` — `path.as_ptr()` to `us_listen_with_options`.
- `src/runtime/dns_jsc/dns.rs` — `name.as_ptr()` to `ares_query`.
- `src/libarchive/lib.rs` — `buf.as_ptr()` to `archive_read_data`.
- `src/simdutf_sys/simdutf.rs` — `src.as_ptr()` to `simdutf_validate_utf8`.

Soundness: `as_ptr()` on a live borrow / non-null wrapper is always safe to
call (it is a safe method); the `unsafe` block surrounds the FFI call, not the
cast itself. No subclass concern.

Representative ID samples: S-010346 (`kevent`), S-001225 (`prctl`), S-001331
(`Bun__REPL__evaluate`), S-000337 (`BrotliDecoderDecompress`), S-007215
(`fs_events.rs:561` `event_flags.cast_const()` then slice).

### Subcluster P02 — `.as_mut_ptr()` (272 sites, ~12.2%)  — Class (A)

Surface form: `&mut [T] / &mut Vec / &mut MaybeUninit::as_mut_ptr()`,
`NonNull<T>::as_mut_ptr()`, `MaybeUninit<T>::as_mut_ptr()`.

Dominant role: handing a writable buffer to C (`read`, `recv`,
`uv_fs_read`, `simdutf_convert_*`), or projecting through a `NonNull`/`Cell`
to obtain a `*mut`. Examples:
- `src/bun_alloc/lib.rs:671` — `slice.as_mut_ptr().cast()` to `mimalloc::mi_realloc`.
- `src/bun_alloc/heap_breakdown.rs:178` — `self.as_mut_ptr()` to `malloc_zone_free`
  (the receiver is `NonNull<malloc_zone_t>`; `as_mut_ptr` returns `*mut`).
- `src/runtime/node/node_fs.rs` — `buf.as_mut_ptr()` to `uv_fs_read`.

Soundness: same as P01 — the method is safe; the surrounding `unsafe` covers
the FFI body. **The `&Vec` → `as_mut_ptr` bug pattern requested in the brief
was not found** — every site in this cluster either:
1. has an exclusive borrow (`&mut [T]`, `&mut Vec<T>`),
2. is on a wrapper that returns `*mut` from `&` by design (`NonNull`, `Cell`,
   `UnsafeCell`, `MaybeUninit`).

### Subcluster P03 — `.cast::<T>()` typed pointer cast (388 sites, ~17.4%)  — Class (A)

Surface form: `*mut c_void.cast::<MyType>()`, `*mut u8.cast::<MaybeUninit<T>>()`,
`*mut Self.cast::<Trait>()`.

Dominant role: type unmasking at FFI callbacks (`*mut c_void → *mut Self`),
typed projection (`*mut u8 → *mut MaybeUninit<Header>` for `write`), and
generic uplift (`*mut T → *mut dyn DebugDataOps`).

Examples:
- `src/bun_alloc/BufferFallbackAllocator.rs:44, 59, 75, 89` — vtable
  `ctx: *mut c_void` cast back to `*mut BufferFallbackAllocator` (typed callback
  ctx unpacking).
- `src/bun_alloc/lib.rs:2844` — `slice_buf.as_ptr().cast::<MaybeUninit<&'static [u8]>>().add(i).write(...)` — typed projection for unaligned write.
- `src/install/lifecycle_script_runner.rs:554` — `b"-c\0".as_ptr().cast::<c_char>()`
  — byte literal coerced to C-char ptr for argv.

Soundness: `.cast::<U>()` is a *safe* pointer cast (no `unsafe` needed). The
`unsafe` is the surrounding deref/FFI. The cast itself never invalidates
provenance.

**Layout-changing cast scan:** every typed-cast site sampled (50 reads)
casts to a `#[repr(C)]` type, a transparent newtype, a byte slice (`u8`),
or `MaybeUninit<T>` where `T` matches the surrounding allocation. No
size-mismatching cast found. The two cross-crate type-alias bridges noted
below (P09) are between layout-equivalent `repr(transparent)` types and are
documented in-source.

### Subcluster P03b — `.cast()` untyped (2 sites)  — Class (A)

Surface form: `ptr.cast()` (target type inferred). Both sites pass a `void*`
through a generic API.

### Subcluster P04 — `bun_core::heap::{take, destroy, into_raw}` (43 sites)  — Class (B)

Surface form: `bun_core::heap::take(ptr.cast::<T>())`, `heap::destroy(p)`,
`heap::into_raw(Box::new(t))`.

Dominant role: the canonical FFI heap round-trip — `into_raw` to hand
ownership to C, `take` / `destroy` to reclaim it. Recorded as `ptr_cast`
because of the `.cast::<T>()` projection before the `heap::take`.

Soundness: sound iff the C side never duplicates the pointer and returns it
to the matching `take`/`destroy`. Bun's `heap` module is the only sanctioned
way to do this round-trip (per `src/CLAUDE.md`); every sampled site uses it.
No bug found.

Representative IDs: S-006490 (`heap::take(ctx.as_ptr_address() as *mut Function)`),
S-001470 (`heap::take(self.slice.as_ptr().cast_mut())`).

### Subcluster P05 — `NonNull::new` / `NonNull::new_unchecked` (14 sites)  — Class (B)

Surface form: `NonNull::new(p)?`, `NonNull::new_unchecked(p)`.

Soundness: `new_unchecked` requires non-null; every sampled site has either a
just-checked `is_null()`, a `mimalloc::mi_malloc` return (well-defined
non-null on success path), or a freshly-`Box::leak`ed `&'static mut`. No bug.

### Subcluster P06 — `ptr::copy`, `ptr::copy_nonoverlapping`, `ptr::read`, `ptr::write`, `write_unaligned`, `read_unaligned` with embedded cast (98 sites)  — Class (B)

Surface form: `core::ptr::copy_nonoverlapping(src.as_ptr(), dst, n)`,
`core::ptr::write(p.cast::<T>(), v)`, `core::ptr::read_unaligned(p as *const u32)`.

Dominant role: bulk memcpy / typed write through projection. The `ptr_cast`
category coexists with `ptr_intrinsic` here.

Soundness: read-bound by upstream `debug_assert!(len ≥ N)` / `MaybeUninit`
projection. The wyhash sites
(`src/wyhash/lib.rs:46, 50, 570, 580`) use `read_unaligned` over byte slices —
documented contract `len >= BYTES`; debug-asserted. The string/immutable.rs
`copy_nonoverlapping` of `(as_ptr() as usize).to_le_bytes()` (S-001385, S-001387)
is a deliberate pointer-as-bytes serialization for a wire format; safe.

### Subcluster P07a — `slice::from_raw_parts` (72 sites)  — Class (B)

Surface form: `core::slice::from_raw_parts(ptr.cast::<u8>(), len)`,
`core::slice::from_raw_parts(self.ptr.as_ptr(), self.len as usize)`.

Dominant role: rebuild a `&[T]` view from `(ptr, len)` returned by C or stored
in a wrapper type. 50 of 72 sites are followed by *read-only* consumption.

Soundness: caller contract is "ptr non-null for non-zero len, aligned, points
to len initialized T, valid for the implied lifetime". Sampled sites carry
provenance from `Box`, `Vec`, mimalloc, libuv `uv_buf_t`, BoringSSL `BIO`
buffers, etc. — all upstream contracts hold.

### Subcluster P07b — `slice::from_raw_parts_mut` (31 sites)  — Class (B)

Same as P07a but produces `&mut [T]`. Stricter contract (no other live
reference to the range). Sampled sites obtain the source pointer from
`NonNull` fields, freshly-allocated `Box`, or `MaybeUninit::as_mut_ptr()`,
all of which yield write-provenance pointers and run before any aliasing
borrow can form. Sound.

### Subcluster P08 — `ZStr::from_raw` / `WStr::from_raw` (48 sites)  — Class (B)

Surface form: `ZStr::from_raw(buf.as_ptr(), len)`,
`WStr::from_raw_mut(buf.as_mut_ptr(), len)`.

Dominant role: Bun's typed wrapper around NUL-terminated byte / wide-char
slices. The `from_raw` factories take `(ptr, len)`; the cast comes from the
caller's `.as_ptr()` on a `Box<[u8]>` / `Vec<u16>` / mimalloc allocation.

Soundness: every sampled site has the NUL written one byte/word past `len` by
the caller immediately before the wrap (search `push(0)` / `[len] = 0`).
Sound.

### Subcluster P09 — `&raw const` / `&raw mut` / `ptr::from_ref` / `ptr::from_mut` (220 sites, 9.9%)  — Class (B)

Surface form: `&raw const expr`, `&raw mut expr`, `core::ptr::from_ref(r)`,
`core::ptr::from_mut(r)`, often chained with `.cast::<U>()`, `.cast_mut()`,
or `NonNull::new_unchecked`.

Dominant role: the *modern* Rust 2024-compliant way to take the address of a
place without going through `&`/`&mut` first. This sub-cluster represents the
audited replacement for the legacy `(&x as *const T as *mut T)` pattern — it
has the same provenance characteristics but no Stacked-Borrows-confusing
intermediate reference. Most sites are sound.

The **one exception** is in `src/runtime/cli/pack_command.rs:3009`:

```rust
let command_ctx = unsafe { &mut *std::ptr::from_ref(ctx.command_ctx).cast_mut() };
```

This forms `&mut T` from a `*mut T` whose provenance was derived from `&T`
(`ctx.command_ctx` is read out of a shared field). The `&mut T` is then
passed to `RunCommand::run_package_script_foreground` which mutates through
it. **Stacked Borrows UB regardless of caller discipline** — see §3.B.

12 sites use `from_ref(self).cast_mut()` to feed *raw-pointer-taking*
refcount ops (`ThreadSafeRefCount::ref_`, `JSValkeyClient::deref`,
`heap::destroy`). These split into:
- 7 sites that only do `fetch_add`/`fetch_sub` through `&AtomicU32` interior
  mutability (no write through the cast pointer) — sound under TB; SB-OK
  because the pointer is never written through.
- 3 sites (`src/http/AsyncHTTP.rs:117`, `src/http/lib.rs:176`,
  `src/runtime/cli/pack_command.rs:3009`) where the resulting raw `*mut` is
  fed to a path that mutates / deallocates. See §3.

### Subcluster P10 — pointer-to-`usize` cast (3 sites)  — Class (B)

Surface form: `name.as_ptr() as usize`.

Sites:
- `src/bun_core/Global.rs:563` — `libc::prctl(PR_SET_NAME, name.as_ptr() as usize)`
  — libc's `prctl` 2nd arg is `c_ulong`; the kernel reads the address from the
  integer. Strict-provenance fix: `name.as_ptr().expose_provenance() as c_ulong`.
- `src/bun_core/string/immutable.rs:1142, 1187` —
  `(stringy.as_ptr() as usize).to_le_bytes()` then `copy_nonoverlapping` —
  serializing a pointer as bytes for a wire format. Strict-provenance fix:
  `.expose_provenance().to_le_bytes()`.

Plus the libuv reserved-slot write
(`src/libuv_sys/libuv.rs:987` — `(*req).reserved[0] as usize` → fn ptr) and
the function-pointer-to-`usize` casts at
`src/runtime/cli/test/parallel/Coordinator.rs:785` and
`src/sys_jsc/error_jsc.rs:147` (sigaction `sa_sigaction: usize` field). All
of these are libc/libuv ABI choices encoded as `usize`; not bugs, but they
will not pass strict-provenance miri.

### Subcluster P11 — `usize` → pointer cast (1 site, classified under P99 by the script)  — Class (B)

`src/sys/lib.rs:9057, 9067` — `QuietWriter` is a `[*mut (); 4]` opaque
4-word region whose slot 0 stores an `Fd` as an integer reinterpreted as
`*mut ()` for ABI compatibility. The pair of accessors (`qw_fd` /
`qw_set_fd`) round-trip the value: `fd.native() as usize as *mut ()` on
write, and `raw as usize as _` on read. The pointer is **never dereferenced**
— it is opaque storage. Strict-provenance fix: store as `usize` and
`transmute` to `*mut ()` if the layout requires the slot to be `*mut ()`,
or use `with_exposed_provenance_mut`.

### Subcluster P12 — legacy `as *const T` / `as *mut T` (24 sites)  — Class (B)

Surface form: `expr as *const T` / `expr as *mut T` — the pre-`.cast::<T>()`
era pointer cast operator. Survives in code where the cast is across a
pointer-type-difference that `.cast::<T>()` cannot express in one step.

Notable sites:
- `src/libuv_sys/libuv.rs:557, 564, 690, 700, 722, 729, 743` — the `UvHandle`
  / `UvStream` trait, which uses `(self as *const Self).cast()` to expose the
  embedded `uv_handle_t` prefix to libuv. Stable, audited, and uses `cast()`
  immediately after the `as` — sound (struct layout invariant documented).
- `src/wyhash/lib.rs:46, 50, 570, 580` — `data.as_ptr() as *const u32`
  before `read_unaligned`. Idiomatic; `read_unaligned` discharges the align
  requirement. Sound. A `.cast::<u32>()` would be a mechanical drop-in.
- `src/runtime/ffi/ffi_body.rs:1283` — `ctx.as_ptr_address() as *mut Function`.
  `as_ptr_address()` returns `usize`; this is a usize→ptr cast losing
  provenance under strict mode. **Strict-provenance offender.**
- `src/windows_sys/externs.rs:1607` —
  `*(teb().cast::<u8>().add(0x60) as *const *const PEB)`. The `as *const *const PEB`
  is a pointer-to-pointer cast (not an int round-trip); sound.
- `src/threading/Futex.rs:154` — `(&expect as *const u32).cast::<c_void>()` —
  read-only FFI; fine.

Mechanical refactor: 14 of 24 sites could be replaced with `.cast::<T>()`
for a 1:1 syntactic improvement (zero ABI change, no soundness change).
Suggested but cosmetic.

### Subcluster P13 — `mem::transmute` involving pointers (2 sites)  — Class (B)

- `src/boringssl_sys/boringssl.rs:508` —
  `transmute::<sk_GENERAL_NAME_free_func, unsafe extern "C" fn(*mut c_void)>(free_func)`.
  Function-pointer transmute between two `extern "C" fn` types differing only
  in argument pointee. ABI-identical (`*mut GENERAL_NAME` vs `*mut c_void`
  are both word-sized) and a single-spot trampoline pattern.
- `src/libuv_sys/libuv.rs:987` — fn-ptr stored as `usize` in `req->reserved[0]`,
  decoded with `transmute::<usize, fn(*mut T, ReturnCode)>(...)`. Same ABI
  pattern; the `usize` storage choice is a libuv convention.

Both are fn-pointer transmutes between identical ABIs. Sound.

### Subcluster P14 — `.cast_mut()` on a `*const T` (51 sites)  — **Class (C)** for the dealloc subset

Surface form: `expr.cast_mut()`, almost always chained:
`some_slice.as_ptr().cast_mut().cast::<c_void>()`.

This is the **most concerning** cluster. Breakdown by *what is done with the
resulting `*mut`*:

| Use of cast_mut result | Count | Class | Soundness note |
|---|---|---|---|
| Pass to `mi_free` / `libc::free` (deallocates) | 5 | **(C)** | mut-from-shared dealloc UB under SB |
| Pass to `heap::destroy` (deallocates) | 3 | **(C)** | mut-from-shared dealloc UB under SB |
| Form `&mut *p` (dereferenced) | 2 | **(C)** | mut-from-shared `&mut` is UB |
| Refcount `ref_` / `deref` (atomic only, no destroy) | 7 | (B) | sound iff destroy never runs |
| Write through pointer (`ptr::write_unaligned`, `uv_bufs[0].base = ...`) | 9 | (B) | callee only reads (libuv write FROM buf) |
| Compute address (`offset_from`, `addr`) | 1 | (A) | read-only |
| Wrap in `Vec::from_raw_parts_in` (ManuallyDrop) | 2 | (B) | "dangerous" by name, contract-load-bearing |
| Slice-of-mut for in-place write to caller-owned region | 22 | (A) | caller passed `&mut` upstream; cast strips/preserves write provenance |

Class-C sites are enumerated under §3 (Bug Findings).

### Subcluster P15 — `.cast_const()` (30 sites)  — Class (A)

Surface form: `p.cast_const()` — `*mut T → *const T`. The opposite direction
to `.cast_mut()` and **always safe** (read-only narrowing). All sampled
sites pass the result to either:
- a read-only FFI call (`Arc::increment_strong_count`, `bun_core::ffi::slice`),
- a `(*p)` projection for read,
- a typed dispatch `(*ctx.cast_const().cast::<C>())`.

No soundness concern.

### Subcluster P99 — Other (184 sites)  — Class (A) / artifact

Predominantly `unsafe fn` declarations whose first 120 chars happened to mention
`as_ptr` in the signature but the body cast is elsewhere. Inspecting 20 random
P99 sites confirmed they are duplicates of P01/P02/P04 once you look past the
signature line. No novel patterns.

---

## 3. Bug Findings — Candidate `pre-existing-ub`

These are real, code-pointed UB candidates. They are **not new bugs** — they
exist in mainline today and have evidently not produced visible crashes — but
they are not sound under the strictest accepted aliasing models, and they
sit on hot paths where SB-strictness would matter.

Severity is graded:
- **U1 — definite UB under Stacked Borrows AND Tree Borrows**
- **U2 — definite UB under Stacked Borrows, accepted under Tree Borrows**
- **U3 — definite UB under strict provenance only (currently permissive)**

### Finding 3.A — `pack_command.rs`: `&mut` from `*const T` (U1)

**Location:** `src/runtime/cli/pack_command.rs:3009`

```rust
let command_ctx = unsafe { &mut *std::ptr::from_ref(ctx.command_ctx).cast_mut() };
```

`ctx.command_ctx` is a `*const T` (or `&T`-derived `*mut T`). Forming `&mut T`
from that pointer is **immediate** UB under both Stacked Borrows and Tree
Borrows: a `&mut` carries `Unique` provenance, which cannot be re-derived
from a shared parent borrow.

The author's safety comment notes this is a port artifact from Zig
(`*ContextData` / `*DotEnv.Loader` aliased process singletons). The fix is
structural — propagate `*mut Self` or `&mut Self` through the call signature
of `run_package_script_foreground`'s caller chain.

**Severity: U1.** Reachable through `bun pack` lifecycle scripts. Not
currently triggering bugs because (a) MIRI does not run this path in CI and
(b) optimizations have not happened to depend on the noalias annotation that
the broken `&mut` would license.

**Recommended bead:** `pre-existing-ub`, P0, owner = `pack_command` author.
Fix: thread `*mut ContextData` through the call signature; reborrow via
`&mut *` only once, at the function entry where ownership is unambiguous.

### Finding 3.B — `AsyncHTTP.rs`: mut-from-shared dealloc of `Box::leak`ed slice (U2)

**Locations:**
- `src/http/AsyncHTTP.rs:117` — `bun_core::heap::destroy(core::ptr::from_ref(href).cast_mut())`
- `src/http/lib.rs:176` — `bun_core::heap::destroy(core::ptr::from_ref(list).cast_mut())`

```rust
unsafe fn free_owned_href(href: &'static [u8]) {
    if !href.is_empty() {
        unsafe { bun_core::heap::destroy(core::ptr::from_ref(href).cast_mut()) };
    }
}
```

`heap::destroy` calls `Box::from_raw(ptr)` which deallocates through `ptr`.
The pointer was reconstructed from a `&'static [u8]` borrow — its provenance
is `SharedReadOnly`. Deallocation is a write under Stacked Borrows.

Tree Borrows is more permissive: a `SharedReadOnly` tag can be promoted to
`Reserved` and then `Active` if the parent's frozen state was actually a
debug artifact (the underlying allocation *was* originally `Active`). But
this is not actually guaranteed — the structural fix is the same.

**Severity: U2.** TB-clean today; SB-UB today. Will become observable if Bun's
compiler upgrades enable noalias-based DSE on the `Box::leak` → struct-field
path.

**Recommended fix:** store the original `Box<[u8]>`/`NonNull<[u8]>` in the
struct field instead of `&'static [u8]`. The field already encodes ownership
in `is_url_owned`; the type should reflect that.

**Recommended bead:** `pre-existing-ub`, P1, owner = HTTP module owner.

### Finding 3.C — `node_fs.rs`: mut-from-shared dealloc of `Box<[u8]>` (U2)

**Location:** `src/runtime/node/node_fs.rs:2396-2400`

```rust
unsafe {
    drop(Box::<[u8]>::from_raw(core::ptr::slice_from_raw_parts_mut(
        bytes.as_ptr().cast_mut(),
        bytes.len() + 1,
    )));
}
```

`bytes` is `rp.slice()` (a `&[u8]` returned by `PathString::slice`).
`as_ptr().cast_mut()` strips provenance to `SharedReadOnly` and `Box::from_raw`
deallocates.

**Severity: U2.** Same shape as Finding 3.B. Fix: store the
allocation as `NonNull<[u8]>` or `Box<[u8]>` in `root_path`, not as a
`PathString` whose `slice()` returns `&[u8]`.

### Finding 3.D — Five sites: `mi_free` through `as_ptr().cast_mut()` after slice round-trip (U2 ×4, U3 ×1)

**Locations:**
- `src/bun_alloc/lib.rs:3267` (S-000183) — fallback allocator free path
- `src/bun_core/string/mod.rs:1765` (S-001432) — `String::deinit_global` for
  `is_globally_allocated()` Latin-1 buffers
- `src/jsc/lib.rs:2022` (S-003614) — generic mimalloc free for `byte_slice()`
  view (was `:2013` pre-`fe2635b460` cargo fmt; Pass-5 accuracy sweep)
- `src/jsc/ZigString.rs:70` (S-003965) — `to_external_u16` reject path
  (`ptr.cast_mut()` from `*const u16` parameter — actually U3, not U2)
- `src/jsc/ZigString.rs:102` (S-003968) — `ZigString__free` C entry

Pattern: caller has a `&[u8]` / `*const u16` and a known-to-be-mimalloc origin.
The slice round-trip through `bun_core::ffi::slice(raw, len) → .as_ptr().cast_mut()`
strips write provenance (mostly; `to_external_u16` takes a `*const u16`
parameter directly, so provenance is preserved — that one is U3 only).

`mi_free` deallocates through the pointer (writes to the mimalloc freelist
header bytes in the block). SB-UB on the four U2 sites.

**Severity: U2 ×4, U3 ×1.**

**Recommended fix:** plumb the original `*mut u8` / `*mut u16` to the free
site without the slice round-trip. The slice was used only for the `len`
metadata; `mi_free` ignores length.

### Finding 3.E — ThreadPool tagged-pointer stack — strict-provenance offender (U3)

**Location:** `src/threading/ThreadPool.rs:1519, 1524, 1574`

```rust
(*list.tail.as_ptr()).next = (stack & Self::PTR_MASK) as *mut Node;
// ...
let mut new_stack = list.head.as_ptr() as usize;
// ...
(stack & Self::PTR_MASK) as *mut Node
```

Tagged-pointer ABA-prevention stack. The `as usize` / `as *mut Node` round-trip
strips and re-attaches provenance.

**Severity: U3.** Currently sound under permissive provenance. Will become
UB once `-Zmiri-strict-provenance` is enabled / the lint promotes to a hard
error (no timeline announced as of toolchain 1.85).

**Recommended fix:**

```rust
// Encode:
let new_stack = list.head.as_ptr().expose_provenance();
// Decode:
let ptr = core::ptr::with_exposed_provenance_mut::<Node>(stack & Self::PTR_MASK);
```

This is a pure refactor; identical machine code, strict-provenance compliant.

### Finding 3.F — `from_borrowed_slice_dangerous`: pattern-flagged but contract-load-bearing (U2, but mitigated)

**Location:** `src/collections/vec_ext.rs:300`

```rust
unsafe fn from_borrowed_slice_dangerous(items: &[T]) -> ManuallyDrop<Self> {
    ManuallyDrop::new(unsafe {
        Vec::from_raw_parts_in(
            items.as_ptr().cast_mut(),
            items.len(),
            items.len(),
            A::default(),
        )
    })
}
```

The function name is `dangerous`. Contract: caller must never `drop` or grow
the returned `Vec`. Under SB, the `Vec`'s buffer pointer carries
`SharedReadOnly` provenance; any write through the `Vec` (push, indexing
through `&mut`) is UB. Only **read** access is contract-permitted, and that
reads through `SharedReadOnly` is sound.

**Severity: U2 (theoretical).** No call site sampled actually mutates;
function name and doc enforce read-only use. Marked as a brittle pattern
worth replacing with a typed `BorrowedVecView<&[T]>` wrapper if/when the API
shape allows.

---

## 4. Strict-Provenance Compliance Scan

Sites that **will fail** under `-Zmiri-strict-provenance`:

| Site | File | Pattern | Fix |
|---|---|---|---|
| S-001225 | `src/bun_core/Global.rs:563` | `name.as_ptr() as usize` | `.expose_provenance() as c_ulong` |
| S-001385 | `src/bun_core/string/immutable.rs:1142` | `(p.as_ptr() as usize).to_le_bytes()` | `.expose_provenance().to_le_bytes()` |
| S-001387 | `src/bun_core/string/immutable.rs:1187` | same | same |
| S-006048 | `src/runtime/cli/test/parallel/Coordinator.rs:785` | `posix_handler as *const () as usize` | (fn-ptr-as-usize for libc; same `expose_provenance`) |
| S-010497 | `src/sys_jsc/error_jsc.rs:147` | `sentry as *const () as usize` | same |
| S-006490 | `src/runtime/ffi/ffi_body.rs:1283` | `ctx.as_ptr_address() as *mut Function` | `with_exposed_provenance_mut::<Function>(addr)` |
| S-010540 | `src/threading/Futex.rs:154` | `(&expect as *const u32).cast::<c_void>()` | actually sound — provenance preserved by `.cast()` not `.expose_provenance()`; flagged only because the inventory regex matched. **Not a real offender.** |
| S-010612 | `src/threading/ThreadPool.rs:1519` | `(stack & PTR_MASK) as *mut Node` | `with_exposed_provenance_mut` |
| `src/threading/ThreadPool.rs:1524` | same file | `list.head.as_ptr() as usize` | `.expose_provenance()` |
| `src/threading/ThreadPool.rs:1574` | same file | `(stack & PTR_MASK) as *mut Node` | `with_exposed_provenance_mut` |
| S-004200 | `src/libuv_sys/libuv.rs:987` | `(*req).reserved[0] as usize` then `transmute::<usize, fn>` | preserve as `fn` pointer; libuv stores `void*` so `transmute<*mut c_void, fn>` |
| S-010397 | `src/sys/lib.rs:9067` | `fd.native() as usize as *mut ()` | (opaque storage slot; no real provenance to preserve) |
| `src/sys/lib.rs:9057` | same file | `raw as usize as _` | same |

**Total real offenders: 11 unique sites** (10 sites + the fn-pointer
transmute pair counts as 1 logical site).

None of these are present-day UB. All become UB once strict provenance is
enforced.

---

## 5. `&Vec` → `as_mut_ptr` Hazard Scan

The brief asked specifically about `as_mut_ptr()` called on a `&Vec` (instead
of `&mut Vec`).

**Result: zero sites found.** Every `Vec::as_mut_ptr` in the inventory is on:
- a `&mut Vec<T>` local (e.g. `lifecycle_script_runner.rs:551`),
- a `*mut Vec<T>` reborrowed inside `unsafe { (*p).field.as_mut_ptr() }`,
- a `MaybeUninit<Vec<T>>` projected via `assume_init_mut().as_mut_ptr()`.

The closest analog is `from_borrowed_slice_dangerous` (Finding 3.F) which is
`&[T]::as_ptr().cast_mut()` and feeds `Vec::from_raw_parts_in` — but the
function is named `dangerous` and contract-load-bearing for callers, so it
is not the same class of bug.

---

## 6. `as_ptr()` on a Temporary — Dangling-Pointer Scan

The brief asked about `expr.as_ptr()` where `expr` is a temporary that drops
before the pointer is used.

**Result: zero sites found.** Searched for:
- `CString::new(...).as_ptr()` — 0 hits
- `format!(...).as_ptr()` — 0 hits
- `.to_vec().as_ptr()` / `.to_string().as_ptr()` — 0 hits
- `.collect::<Vec<_>>().as_ptr()` — 0 hits

Bun's idiomatic FFI patterns always bind to a local first
(`let argv: [*const c_char; 4] = ...`), then pass `argv.as_ptr()`. The
discipline is consistent across the inventory.

---

## 7. `Cell<T>` ↔ `T` Pointer Cast Scan

The brief asked about `Cell<T> → T` casts (interior-mutability tricks).

**Result:** the pattern that does exist is `Cell::as_ptr() -> *mut T`, which
is a **safe** method on `Cell<T>` (it returns the interior pointer with full
write provenance via interior-mutability magic). Sites:
- `src/runtime/dispatch.rs` — `cell.as_ptr()` to pass to a vtable callback.
- `src/runtime/server/RequestContext.rs:269` — `&mut *p.as_ptr()` where `p`
  is `Cell<NonNull<...>>::get()` → `NonNull`. Sound: `NonNull::as_ptr` is the
  contract-preserving accessor.

No `&Cell<T> as *const T` or `*const Cell<T> as *const T` reinterpretation
casts found. Bun uses `Cell` correctly.

---

## 8. Refactor Opportunities

Mechanical, near-zero-risk refactors that improve clarity / future strict-mode
compliance:

| Refactor | Site count | Risk | Notes |
|---|---|---|---|
| `as *const T` → `.cast::<T>()` | 14 | 0 | Cosmetic; e.g. `src/wyhash/lib.rs:46, 50, 570, 580`. Single PR. |
| `as *mut T` → `.cast_mut().cast::<T>()` | 10 | 0 | Same. |
| `as_ptr() as usize` → `.expose_provenance()` | 5 | 0 | Strict-provenance-ready. |
| `usize as *mut T` → `with_exposed_provenance_mut::<T>(addr)` | 4 | 0 | Same. |
| `as_ptr_address() as *mut T` → `with_exposed_provenance_mut::<T>(...)` | 1 | 0 | One PR for `ffi_body.rs`. |
| `as_ptr().cast_mut()` → store original `*mut T` (slice round-trip elimination) | 5 | low | Touch each `mi_free` / `heap::destroy` caller; trade slice-API for typed-pointer storage. |
| `Box::leak` `&'static [T]` → `Box<[T]>` / `NonNull<[T]>` field | 3 | medium | Findings 3.B, 3.C. Changes struct field type; requires propagation. |
| `core::ptr::from_ref(self).cast_mut() → &mut *...` → thread `*mut Self` | 1 | medium | Finding 3.A. Touches `pack_command` call chain. |

Total mechanical refactors: ~45 sites across ~10 files. None changes ABI;
none risks regressions.

---

## 9. Recommended PRs

### PR 1 — Strict-provenance compliance (cosmetic, mechanical)

**Scope:** 11 sites listed in §4. Replace `as usize` / `usize as *T` /
`as_ptr_address() as *T` with `expose_provenance` / `with_exposed_provenance_mut`.

**Files:**
- `src/threading/ThreadPool.rs` (3 sites)
- `src/sys/lib.rs` (2 sites; the `qw_fd`/`qw_set_fd` pair)
- `src/bun_core/string/immutable.rs` (2 sites)
- `src/bun_core/Global.rs` (1 site)
- `src/runtime/ffi/ffi_body.rs` (1 site)
- `src/libuv_sys/libuv.rs` (1 site)
- `src/sys_jsc/error_jsc.rs` (1 site)
- `src/runtime/cli/test/parallel/Coordinator.rs` (1 site)

**Risk:** zero. `expose_provenance` is `#[inline(always)]` and lowers to
identical machine code under permissive provenance.

**Test plan:** existing test suite + an opt-in `-Zmiri-strict-provenance` CI
job (separate beadwork; toolchain pins are already in
`.unsafe-audit/phase0_toolchain.json`).

### PR 2 — `as *const/mut T` → `.cast::<T>()` modernization

**Scope:** 24 sites in §2.P12. Pure syntactic improvement. No semantic
change.

**Files:** `src/wyhash/lib.rs`, `src/libuv_sys/libuv.rs`, `src/threading/Futex.rs`,
`src/runtime/image/backend_wic.rs`, `src/spawn_sys/posix_spawn.rs`,
`src/runtime/cli/test/parallel/Coordinator.rs`,
`src/runtime/webcore/FileSink.rs`, `src/jsc/btjs.rs`, `src/js_parser_jsc/Macro.rs`,
`src/sys/lib.rs`, `src/runtime/ffi/ffi_body.rs`,
`src/collections/array_hash_map.rs`.

**Risk:** zero.

**Test plan:** `cargo check -p <crate>` for each crate; full test suite.

### PR 3 — Fix mut-from-shared dealloc in HTTP / node_fs (P0 if Bun moves to a stricter aliasing model)

**Scope:** 4 sites in Findings 3.B and 3.C plus 4 of the 5 mimalloc free
sites in Finding 3.D.

**Strategy:** change the struct field type to own the allocation explicitly
(`Box<[u8]>` / `NonNull<[u8]>`) rather than borrow it as `&'static [u8]`.
This eliminates the `as_ptr().cast_mut()` cast entirely on the dealloc path.

**Files:** `src/http/AsyncHTTP.rs` (URL.href field), `src/http/lib.rs`
(HeaderList.list field), `src/runtime/node/node_fs.rs` (PathString.slice
caller), `src/bun_core/string/mod.rs` (`is_globally_allocated()` Latin-1
buffer), `src/jsc/ZigString.rs` (`ZigString__free` C entry — preserve `*mut u8`
parameter, drop the `bun_core::ffi::slice` round-trip).

**Risk:** medium. Cross-cutting field-type changes; need to audit all
constructors and accessors.

**Test plan:** full HTTP + node fs test suite; MIRI's stacked-borrows mode
against `bun_http` and `bun_runtime` once these fixes land.

### PR 4 — Fix `&mut` from `*const T` in pack_command (P0 sentinel)

**Scope:** 1 site (Finding 3.A).

**Strategy:** thread `*mut ContextData` through
`run_package_script_foreground`'s call signature; reborrow as `&mut` only
once, at the function entry where ownership semantics are unambiguous.

**Risk:** medium. Modifies public-ish CLI function signatures.

**Test plan:** `bun pack` integration tests; `bun pm` lifecycle script tests.

---

## 10. Cross-Reference to Existing Audit Artifacts

This deep-dive extends:

- `.unsafe-audit/AUDIT_SUMMARY.md` — overall inventory.
- `.unsafe-audit/CODEX_PASS2_SUMMARY.md` — PASS-2
  coordinator summary.
- `.unsafe-audit/audit/plans/B-001-and-B-002-perf-only.md` —
  perf-only (non-soundness) cluster.
- `.unsafe-audit/audit/plans/C-001-nonnull-from-reference.md` —
  the prior NonNull-from-reference deep-dive overlaps subcluster P05 here.

New candidate beads to file (see `beads-to-create.md` for format):

| Bead title | Severity | Section | Site count |
|---|---|---|---|
| `pre-existing-ub: invalid &mut formation in pack_command run_package_script_foreground caller` | P0 | 3.A | 1 |
| `pre-existing-ub: mut-from-shared dealloc of Box::leak'd HTTP href/header-list slices` | P1 | 3.B | 2 |
| `pre-existing-ub: mut-from-shared dealloc of node_fs realpath bytes Box<[u8]>` | P1 | 3.C | 1 |
| `pre-existing-ub: mut-from-shared mi_free of mimalloc-owned slices after slice round-trip` | P1 | 3.D | 5 |
| `refactor: strict-provenance compliance for 11 pointer↔usize round-trip sites` | P2 | 4 | 11 |
| `refactor: as *const T → .cast::<T>() across 24 legacy sites` | P3 | 9, PR 2 | 24 |

---

## 11. Methodology Notes

1. **Subcluster classifier** at `/tmp/classify_ptr_cast.sh` is a jq pipeline
   that tokenizes each site's `normalized` field by priority-ordered regex.
   Order matters: `&raw const` / `from_ref` is matched before `as usize` so a
   site doing both lands in P09.

2. **Sampling discipline:** every subcluster with >15 sites was sampled at 12
   sites; each <15-site cluster was fully read. Source reads used 15-line
   context windows (sometimes wider) to verify the unsafe block's documented
   invariants against the surrounding code.

3. **Aliasing-model citation:** Stacked Borrows reference is
   <https://plv.mpi-sws.org/rustbelt/stacked-borrows/>; Tree Borrows is
   <https://perso.crans.org/vanille/treebor/>. Bun's official position
   (per `src/CLAUDE.md` and the doc comment on
   `bun_ptr::CellRefCounted::deref`) is to **target Stacked Borrows**, so
   findings classified U2 are real candidate UB by Bun's own standard.

4. **No emojis. No marketing language.** Citations are file:line verbatim.
   Source line numbers verified at audit time; line drift is possible if
   files are edited after this report lands. Re-run the classifier against
   a fresh inventory to refresh.

---

End of PASS-2 ptr_cast deep dive.
