# Phase 2 — Bucket 22 (repr(packed) Field Address) Findings

Run: `2026-05-15-exhaustive`
Sweeper: Bucket-22 static-bucket-sweeper
Scope (UB-TAXONOMY §22):

- For every `#[repr(packed)]` (or `#[repr(C, packed)]`) struct, verify no
  `&packed.field` references exist — these are rustc **E0793** hard errors
  ("reference to packed field is undefined behavior"), so any surviving site
  would fail to compile under modern stable rustc.
- Audit `addr_of!` / `addr_of_mut!` (and the newer `&raw const` / `&raw mut`)
  discipline at packed-field touchpoints: stores must go through a raw
  primitive followed by `write_unaligned`, or via `bytemuck::bytes_of_mut` +
  `copy_from_slice` on a `Pod` type.

**Verdict: N/A — no new findings.** Bucket-22 is a strict sub-cohort of
Bucket-3 (Alignment §B.1 final row: "**`cargo check` produces no E0793.**"),
which Bucket-3's static-bucket-sweeper already exhausted. This file
re-verifies that result independently from a packed-first vantage, enumerates
every packed type by name, and confirms the discipline used at each access
site.

---

## A. Inventory of `#[repr(packed)]` types (8 nominal, 9 definitions)

Grep:

```
rg -n 'repr\(.*packed' --type rust -g '!vendor/*' -g '!target/*' -g '!build/*'
```

| # | Path | Type | Field shape | Access discipline |
|---|---|---|---|---|
| 1 | `src/bun_core/util.rs:216` | `Unaligned<T: Copy>` | `(T,)` | `get(self)` is by-value (self already moved into aligned local); `set(&mut)` goes via `core::ptr::addr_of_mut!(self.0).write_unaligned(value)`; slice round-trips use `from_raw_parts(slice.as_ptr().cast::<T>(), …)` gated on debug-asserted alignment of the slice's outer pointer. |
| 2 | `src/bundler/ungate_support.rs:87` | `StableRef` | `IndexInt + Ref` | All field touches use the brace-copy idiom `{ stable_ref.r#ref }` (renameSymbolsInChunk.rs:258, 279) or destructure into locals before comparing (`PartialEq`/`Ord` impls at :108-122). Derived `PartialEq`/`Ord` are intentionally hand-written for exactly this reason — the `// PORT NOTE` at :101 documents it. |
| 3 | `src/install/windows-shim/bun_shim_impl.rs:1027` | `ShebangMetadataPacked` (block-local) | `u32 + u32` | Constructed via `read_ptr.cast::<ShebangMetadataPacked>().read_unaligned()` then accessed by-value as a stack copy (`shebang_metadata.args_len_bytes` at :1043, :1044, :1047, :1048 — all are by-value field reads on an aligned local, never `&`). |
| 4 | `src/jsc/ipc.rs:320` | `VersionPacket` (mod-local) | `IPCMessageType + u32` | Only ever consumed via a comptime byte literal — `static VERSION_PACKET_BYTES: [u8; HEADER_LENGTH]` is hand-encoded (:327), no `VersionPacket` instance is ever materialised at runtime. Zero field accesses at all. |
| 5 | `src/http_types/h2.rs:185` | `StreamPriority` | `u32 + u8` | `unsafe impl bytemuck::Pod`; writes go through `bytemuck::bytes_of_mut(dst).copy_from_slice(src)` (:203). Byte-swap reads use brace-copy `{ dst.stream_identifier }` (:207, :213). |
| 6 | `src/http_types/h2.rs:269` | `SettingsPayloadUnit` | `u16 + u32` | Same shape: `Pod` + `bytes_of_mut` + brace-copy byte-swap (:292-293). |
| 7 | `src/http_types/h2.rs:305` | `FullSettingsPayload` | 7 × (`u16 + u32`) = 42 B | Same shape: `Pod` + `bytes_of` round-trip; per-field byte-swap goes through brace-copy on a stack `swap` copy (:375-387). |
| 8 | `src/runtime/webcore/Blob.rs:6708` | `Inline` (Blob inline payload) | `[u8; AVAILABLE_BYTES] + u8 + bool` | The first field is a `[u8; N]` array which has alignment 1 natively — slicing `&mut inline_blob.bytes[..total]` (:6728, :6750) is **not** an E0793 site because the field's native alignment already matches the packed layout. Empirically reproduced (see Appendix). `len` and `was_string` writes are scalar `inline_blob.len = …` / `inline_blob.was_string = …` stores, which lower to unaligned writes via the packed-write path the compiler emits automatically — no `&` taken. |
| 9 | `src/runtime/api/bun/h2_frame_parser.rs:355, 441, 468` | `StreamPriority`, `SettingsPayloadUnit`, `FullSettingsPayload` | duplicate wire types | Same discipline as `http_types/h2.rs`, with a minor variation: `StreamPriority::from` and `SettingsPayloadUnit::from` use `core::ptr::copy_nonoverlapping(src.as_ptr(), std::ptr::from_mut(dst).cast::<u8>(), …)` (:378-384, :452-458) which materialises an `*mut u8` from `&mut dst` — sound (no field-of-packed `&` taken; only the outer struct). Byte-swap reads use plain assignment to packed fields (e.g. `dst.stream_identifier = dst.stream_identifier.swap_bytes()` :385) — this is a read-and-write of a packed field where the *read* side is the load-bearing operation. Rustc accepts this as a field-rvalue copy. **Phase-1 Section B noted these are duplicates of the h2 wire types — Bucket 23 (duplicate wire types) tracks the de-dup risk; Bucket 22 status is clean.** |

Counts:
- **9 type definitions** across **8 nominal types** (the h2 wire trio is
  duplicated between `http_types/h2.rs` and `runtime/api/bun/h2_frame_parser.rs`).
- **0 sites** that form `&packed.field` or `&mut packed.field` over a field
  whose native alignment exceeds 1.

---

## B. E0793 verification

Direct `cargo check` is gated on the codegen step (`build_options.rs not
found at /data/projects/bun/build/debug/codegen/build_options.rs — run
`bun bd --configure-only` first`), so a fresh check would also force a
full `bun bd` to populate codegen. The Bucket-3 sweeper already ran the
full toolchain build to ground and reported **zero E0793 diagnostics**;
that result is reproducible by running `bun bd` and matches the negative
result of `grep -F 'reference to packed field is unaligned'` across
build logs (also empty in the Bucket-3 artifact set).

Per-site static re-verification done here (against current `main`):

```
$ rg -n 'repr\(.*packed' --type rust -g '!vendor/*' -g '!target/*' -g '!build/*'
```

returns the 9 definitions above; following each `pub struct` / `struct`
definition to every field-touch site (grep on field name within the
defining module + cross-crate users) found:

- 0 `&self.<packed_field>` or `&mut self.<packed_field>` borrows
- 0 `let r = &x.<packed_field>;` borrows
- 0 derived `Eq`/`Ord`/`Hash`/`Debug` (which would silently auto-emit
  `&self.field` and trigger E0793) — every packed type either omits
  these derives or supplies a hand-written impl that copies fields into
  locals first (StableRef :107-129 is the canonical example).

---

## C. `addr_of!` / `addr_of_mut!` / `&raw const|mut` discipline (cross-bucket spot-check)

Grep:

```
rg -n 'addr_of!|addr_of_mut!|core::ptr::addr_of|std::ptr::addr_of|&raw const|&raw mut' --type rust
```

returns ~150 hits. **None** are over packed-struct fields specifically —
the predominant uses are:

- C-FFI struct in-place init (`zlib/lib.rs` ~10 sites, `brotli_sys/brotli_c.rs`
  ~5 sites, `bun_alloc/MimallocArena.rs`) — outer struct is `#[repr(C)]`,
  not packed; the raw-pointer machinery is for placement-new / FFI handle
  threading, not unaligned access.
- `MaybeUninit` piecewise init (`collections/hive_array.rs:200, 492`,
  `ast/new_store.rs:112-113`) — addr-of-mut on an uninit field before any
  reference exists; orthogonal to packed.
- PE header rewrite (`exe_format/pe.rs:440, 489, 711`) — `addr_of_mut!` is
  used to project into the `data_directories` array without forming a `&mut`
  through the parent OptionalHeader; the PE structs themselves are
  `#[repr(C)]` (not packed) but unaligned because they sit at arbitrary mmap
  offsets. This is a Bucket-3 alignment site (already covered there at
  §B.2.1), not a Bucket-22 site.
- `Unaligned<T>::set` (`bun_core/util.rs:237`) — **this is the one
  Bucket-22-direct `addr_of_mut!` site.** It's idiomatic: `addr_of_mut!(self.0)`
  yields a raw pointer with the packed alignment-1 metadata, then
  `.write_unaligned(value)` performs the store. Sound by construction.

The `addr_of_mut!((*owner).tcp).write(sock)` cluster in
`http_jsc/websocket_client.rs:1770` and the `WebSocketProxyTunnel.rs`
chain (`addr_of_mut!((*this).wrapper)` × 6 sites) operate on
`#[repr(C)]` (non-packed) handle structs and are owned by Bucket-1
(Aliasing / `&self` materialisation across FFI) and Bucket-5 (Uninit),
both of which have explicit entries for these paths.

---

## D. Cross-references

- **Bucket 3 (Alignment)**: `phase2_findings_03_alignment.md` §A row 3 —
  authoritative `#[repr(packed)]` enumeration; this file is a
  cross-validation, not a delta.
- **Phase-1 Section B (h2 wire parser)**: `phase1_inventory_B.md` —
  documents the `bytemuck::Pod` + brace-copy idiom for the h2 wire trio.
- **Bucket 23 (Observed Type Changes)**: the h2-vs-h2_frame_parser
  duplication is a Bucket-23 de-dup hazard (`phase2_findings_23_observed_type_changes.md`),
  not a Bucket-22 hazard — both copies are independently sound under §22.
- **Bucket 5 (Uninit) and Bucket 1 (Aliasing)**: own the non-packed
  `addr_of_mut!` usage clusters surveyed in §C above.

---

## E. Verdict

- **Total packed types**: 8 nominal (9 definitions, one trio duplicated).
- **E0793 status**: clean. Codebase relies on rustc's compile-time
  rejection as a backstop; current sources never tempt it.
- **`addr_of!` discipline**: single Bucket-22-direct site
  (`Unaligned::set` at `bun_core/util.rs:237`) is textbook
  `addr_of_mut!(field).write_unaligned(value)`.
- **Finding count**: **0**. Bucket 22 carries no Phase-11 remediation
  candidates and contributes no new beads.

---

## Appendix — empirical E0793 baseline for `[u8; N]` field in packed struct

To verify the `Inline.bytes[..]` slice expression does not trigger E0793,
the following minimum-repro compiled and ran cleanly under stable rustc:

```rust
#[repr(C, packed)]
pub struct Inline {
    pub bytes: [u8; 8],
    pub len: u8,
    pub was_string: bool,
}

fn main() {
    let mut b = Inline { bytes: [0; 8], len: 0, was_string: false };
    let s = &mut b.bytes[..3]; // accepted: [u8; N] has native alignment 1
    s[0] = 1;
    println!("OK");
}
```

E0793 fires only when the field's *native* alignment exceeds the packed
alignment of 1; arrays of `u8` and other byte-aligned scalars are exempt.
This matches the rustc reference (E0793 long-form) and our `Inline`
usage.
