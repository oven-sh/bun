# Phase 2 — Bucket 3 (Alignment) Findings

Run: `2026-05-15-exhaustive`
Sweeper: Bucket-3 static-bucket-sweeper
Scope (UB-TAXONOMY §3):
- `*const T` cast from `*const u8` then dereferenced without alignment proof
- `&packed_struct.field` for `#[repr(packed)]` (rustc E0793 hard error)
- mmap-backed atomics without verifying mmap base alignment
- `ptr::read_unaligned` / `ptr::write_unaligned` correctness

Audit conducted against audited base `origin/main@4d443e5402` (`Cargo.lock`
clean at run time). Bucket-3 audit
intentionally focuses on **reference materialization** (`&T`, `&[T]`) over
unaligned bytes — that is the immediate-UB shape Miri's
`-Zmiri-symbolic-alignment-check` flags. Plain `read_unaligned` /
`write_unaligned` are sound by definition; what we audit there is whether the
caller's claim "the bytes that follow are a valid `T`" holds (cross-cuts with
Buckets 4/5).

---

## A. Quantitative Roll-Up

| Cohort | Sites | Sound | Hazard | Notes |
|---|---|---|---|---|
| `ptr::read_unaligned` callsites | **~115** (113 grep hits − comment lines) | ~113 | 0 wrong (1 caveat) | `FFIObject.rs` (33 sites) and `wyhash/lib.rs` (8 sites) dominate by count; all delegate the alignment claim to either JS-supplied `addr` (FFI contract) or `data.len() >= BYTES` (POD bytes) |
| `ptr::write_unaligned` callsites | **~12** | ~12 | 0 | symmetric to reads; `bun_shim_impl.rs`, `BinLinkingShim.rs`, `InternalSourceMap.rs`, `crash_handler_jsc.rs` (intentional crash) |
| `#[repr(packed)]` types | **8** | 8 | 0 | `bun_core::util::Unaligned<T>`, `bundler::ungate_support::StableRef`, `bun_shim_impl::ShebangMetadataPacked`, `jsc::ipc::VersionPacket`, `http_types::h2::{StreamPriority, SettingsPayloadUnit, FullSettingsPayload}`, `runtime::api::bun::h2_frame_parser::{StreamPriority, SettingsPayloadUnit, FullSettingsPayload, ...}` (duplicated wire types), `runtime::webcore::Blob::Inline`. None form `&packed.field`; all use `{packed.field}` brace-copy or `bytemuck::Pod` round-trips. **`cargo check` produces no E0793.** |
| `*const u8 → *const T` cast then `&*ptr` / `&[T]` over typed slice | **9 in pe.rs + 5 in macho.rs + 3 UTF-16 + 2 hardening clusters** | 0 sound for confirmed clusters | 9 (pe.rs cluster) + 5 (macho.rs load-command/section mutation) + 3 (json_lexer/yaml/ast::E::String UTF-16 reinterp); md/containers and INotifyWatcher are hardening-only under current source invariants | The PE cluster carries explicit TODOs and is now EXP-093 CONFIRMED_UB; the Mach-O cluster's own module docs say to use unaligned reads/writes and is now EXP-095 CONFIRMED_UB; the UTF-16 reinterp trio is EXP-088 CONFIRMED_UB because `init_utf16` narrows byte-slice provenance before `slice16` expands it; md/containers only needs a future-proof alignment assert and INotifyWatcher is aligned by its `EventListBytes` wrapper plus kernel record padding |
| mmap-backed reads requiring alignment | **6** | 6 | 0 | `StandaloneModuleGraph::get_data` (macho/pe/elf), `sourcemap::lib::SerializedSourceMap`, all properly use `read_unaligned`. **No atomic operations are performed over mmap-backed bytes — searched (`AtomicU32`/`AtomicU64`/`compare_exchange` × mmap), zero hits.** |
| Compile-time-asserted aligned (no audit needed) | **20+** | n/a | 0 | INotifyWatcher `EventListBytes` is `#[repr(C, align(4))]` with `const _: () = assert!(align_of::<Event>() == 4)`; WindowsWatcher `DirWatcher` carries `assert_ffi_layout!` + offset_of check; `bun_alloc/stack_fallback.rs` builds `align_of::<Self>() == align_of::<A>().max(word)` |

---

## B. Site-by-Site Enumeration

### B.1 — Sound: helper-funnelled `read_unaligned`/`write_unaligned`

These centralise alignment-tolerant access through one audited primitive.
Mass-counted; no per-site audit required.

| Path | Kind | Notes |
|---|---|---|
| `src/exe_format/lib.rs:30-46` | `read_struct<T: Copy>` / `write_struct<T: Copy>` | Shared by elf.rs, macho.rs, macho writer |
| `src/sys/lib.rs:5815, 5860` | `LoadCommand::cast<T>`, `LoadCommandIterator::next` | mach-o load-command iterator; cmdsize validated against `buf_len` |
| `src/runtime/ffi/FFIObject.rs:298-582` | `read_unaligned_at<T>` + 33 typed wrappers | JS-supplied `addr` is `unsafe fn` contract — documented hazard, not a bucket-3 site |
| `src/sourcemap/InternalSourceMap.rs:183, 1193, 1197, 1201` | window-header sync entries + Cap field writes | header layout owned by Builder; reader uses `read_unaligned` |
| `src/sourcemap/lib.rs:859, 926` | `SerializedSourceMap::header`, `Loaded::source_file_contents` | mmap blob inside standalone-graph; comments cite Zig `*align(1)` |
| `src/standalone_graph/StandaloneModuleGraph.rs:292, 345, 357, 580, 2153, 2183, 2213, 2334, 2369, 2376` | macho/pe/elf get_data, Offsets, modules-list iter, source-map header, StringPointer index | All read via `read_unaligned` from raw `*const u8` mmap-backed pointer; no `&T` materialised |
| `src/sys/sys_uv.rs:242` | uv_fs_statfs result | `StatFS` copied out of req.ptr before `uv_fs_req_cleanup` |
| `src/runtime/node/node_fs.rs:6196` | uv statfs sync | Same shape as sys_uv |
| `src/runtime/node/dir_iterator.rs:195-198, 296-299, 673-689, 818-820` | dirent header field reads (macOS/FreeBSD/Linux/Windows/WASI) | All use `addr_of!((*entry).field).read_unaligned()` to avoid materialising `&libc::dirent`. Cited by Section P as needing kernel-ABI hand-verify — the *Rust* side is sound; what needs hand-verify is the assumption that `d_namlen`/`d_reclen` field offsets match libc's `offset_of!(libc::dirent, d_name)`. **Cross-ref: Section P/U interactions.** |
| `src/runtime/webcore/FileSink.rs:174` | windows magic-mismatch probe — `[u8; 64]` byte read | Intentional UB-as-diagnostic site (probe before panic). Not a bug; documented |
| `src/runtime/webcore/encoding.rs:533` | `copy_latin1_into_utf16` misaligned-dest fallback | Branched on `align_of::<u16>()` check at :520 |
| `src/wyhash/lib.rs:46, 50, 571, 580, 682` | wyhash inner loop u32/u64 reads | `read_unaligned` on `data.as_ptr()` with `data.len() >= BYTES` debug-asserted |
| `src/bun_core/string/immutable.rs:1640, 1654, 1666` | `eql_long` word-chunked compare | Mirrors Zig's word-chunked memcmp; raw-pointer walk, all unaligned |
| `src/exe_format/macho.rs:167` | section table in-place rewrite | Writes `segment_command_64` into load-command region via `write_unaligned` |
| `src/sql_jsc/postgres/DataCell.rs:835` | typed-array element write | Delegates to `WireByteSwap::write_unaligned_ne_bytes` (safe `to_ne_bytes` round-trip) |
| `src/io/write.rs:194` | `FixedBufferStream::read_struct` | bounds-checked + `read_unaligned` |
| `src/collections/vec_ext.rs:641` | `write_type_as_bytes_assume_capacity` | capacity debug-asserted; `write_unaligned` into uninit tail |
| `src/install/windows-shim/{bun_shim_impl.rs:591, 628, 943, 1013, 1041, 1132, BinLinkingShim.rs:428, 429, 436, 463, 475}` | shebang/BinLinkingShim packed header read/writes | Shim pre-allocates aligned buffers and uses `read_unaligned`/`write_unaligned`/`bytemuck::pod_read_unaligned` for header field reads. Wire format owned by same crate |
| `src/runtime/api/crash_handler_jsc.rs:94` | intentional crash via `write_unaligned(ptr, 0xDEADBEEF)` | Crash-handler self-test; not a Bucket-3 site |

### B.2 — Hazard: `*const T` cast then dereferenced (no `read_unaligned`)

**These are the real Bucket-3 sites.** Each forms either `&T` or `&[T]` over
bytes whose alignment depends on either compile-time guarantees that aren't
asserted, source-data alignment that flows from elsewhere, or
kernel-padding assumptions that aren't audited.

#### B.2.1 — `src/exe_format/pe.rs` cluster (9 sites) — **EXP-093 CONFIRMED**

Severity: **CONFIRMED hazard; reachability low** (the PE file is the executable
or a Bun-built standalone binary, not attacker-controlled at runtime in
typical flows; but `is_pe()` is used as a content-sniff over arbitrary input)

| Line | Site | Form | TODO present? |
|---|---|---|---|
| `:212` | `view_at_const` / `view_at_mut` | returns raw `*const/*mut T` from `buf.as_ptr().add(off).cast::<T>()` | yes (lines 204-206) |
| `:289-290, 301-303` | `get_section_headers` / `_mut` | constructs `&[SectionHeader]` / `&mut [SectionHeader]` via `slice::from_raw_parts(ptr, num_sections)` | yes |
| `:396` | `init` first-pass section-iter | `data.as_ptr().add(section_headers_offset).cast::<SectionHeader>()` then `&[SectionHeader]` | no — same hazard, mirror of `:289` |
| `:676` | `add_data_section` writes a new header at `new_sh_off` via copy_from_slice from `(&raw const sh).cast::<u8>()` | sound (copy_from_slice, not pointer cast back) | n/a |
| `:907` | `utils::is_pe` — `&*data.as_ptr().cast::<DOSHeader>()` | direct `&T` materialisation | yes (line 906) |
| `:919` | `utils::is_pe` — `&*data.as_ptr().add(off).cast::<PEHeader>()` | direct `&T` materialisation | yes (line 918) |
| `:317` | `init` — `&*dos_header` derived from `view_at_const::<DOSHeader>(&data, 0)` | direct `&T` materialisation; offset is 0 so alignment depends on `Vec<u8>::as_ptr()` alignment (Rust `Vec<u8>` is byte-aligned; DOSHeader has `align_of::<u16>() == 2`) | inherits TODO from view_at_const |

**Verdict update (Codex 2026-05-16): CONFIRMED_UB via EXP-093.** The previous
PRESENT_WEAK framing understated the problem. The code already carries explicit
author TODOs (lines 204-206, 288, 300, 906, 918), and the minimal Miri witness
in `experiments/EXP-093` mirrors the source shape: `Vec<u8>` storage, an odd
section-header offset, `cast::<SectionHeader>()`, then
`slice::from_raw_parts`. Miri rejects the slice construction before the first
field read: `constructing invalid value of type &[SectionHeader]: encountered
an unaligned reference (required 4 byte alignment but found 1)`. Normal
toolchain-produced PE files are conventionally aligned, so production
exploitability is input-dependent; the Rust API shape over hostile/tampered PE
bytes is still unsound unless the alignment invariant is checked or the parser
uses unaligned reads / byte-copy parsing.

**Fix-point:** route everything through `view_at_const` returning `*const T`
and use either (a) `read_unaligned` to copy headers by value, or (b) the
`Unaligned<T>` wrapper from `bun_core::util` to keep typed slices over packed
storage.

#### B.2.2 — `src/exe_format/macho.rs` load-command mutation cluster (5 sites) — **EXP-095 CONFIRMED**

Severity: **CONFIRMED hazard; reachability low-to-medium** (normal Mach-O load
commands are conventionally aligned and ordinary allocators usually over-align
`Vec<u8>` storage, but neither fact is a Rust alignment proof for a safe API
over byte-backed object files).

| Line | Site | Form | Why it is not covered by the good helper |
|---|---|---|---|
| `:121-130` | `write_section` section table mutation | constructs `&mut [macho::section_64]` via `slice::from_raw_parts_mut(self.data.as_mut_ptr().add(...).cast::<section_64>(), nsects)` | bypasses `LoadCommand::cast<T>()`; creates a typed mutable slice over `Vec<u8>` storage |
| `:366` | `update_load_command_offsets` / `LC_SYMTAB` | `&mut *cmd_ptr.cast::<macho::symtab_command>()` | same byte region the iterator reads with `read_unaligned`, but this path materialises `&mut T` |
| `:371` | `LC_DYSYMTAB` | `&mut *cmd_ptr.cast::<macho::dysymtab_command>()` | same |
| `:392` | linkedit-data command family | `&mut *cmd_ptr.cast::<macho::linkedit_data_command>()` | same |
| `:403` | dyld-info command family | `&mut *cmd_ptr.cast::<macho::dyld_info_command>()` | same |

**Verdict update (Codex 2026-05-16): CONFIRMED_UB via EXP-095.** This is not
a false positive on `LoadCommand::cast<T>()`; that helper is correctly
implemented with `read_unaligned` and returns an owned value. The bug is the
later mutation path. `macho_types.rs:1-12` explicitly says these on-disk POD
structs should be read/written through unaligned `ptr::{read,write}_unaligned`,
and `macho.rs:163-170` follows that rule for the adjacent segment-command
write. The `&mut T` / `&mut [T]` sites above are the inconsistent tail.

The witness in `experiments/EXP-095` uses the same safe/unsafe split:
`read_unaligned` of the command header succeeds, then the production
`&mut *cmd_ptr.cast::<SymtabCommand>()` operation fails under Miri symbolic
alignment with: `constructing invalid value of type &mut SymtabCommand:
encountered an unaligned reference (required 4 byte alignment but found 1)`.

**Fix-point:** mutate Mach-O load commands by value. Read each command with
`ptr::read_unaligned`, update the owned local, then write it back with
`ptr::write_unaligned`. For `section_64` arrays, either iterate element-by-
element with unaligned reads/writes or copy into an aligned temporary
`Vec<section_64>` before mutation.

#### B.2.3 — UTF-16 reinterpret cluster (`json_lexer.rs:575`, `yaml.rs:1783`, `ast/e.rs:1424`)

| Site | Form |
|---|---|
| `src/parsers/json_lexer.rs:575-580` | `slice::from_raw_parts(self.string_literal_raw_content.as_ptr().cast::<u16>(), self.string_literal_raw_content.len())` |
| `src/parsers/yaml.rs:1783` | `slice::from_raw_parts(s.as_ptr().cast::<u16>(), s.len())` over bump-allocated bytes |
| `src/ast/e.rs:1424` | `slice::from_raw_parts(self.data.as_ptr().cast::<u16>(), self.data.len())` — `slice16()` of `E::String` |

**Verdict update (Codex 2026-05-16): CONFIRMED_UB via EXP-088.** The original
PRESENT_STRONG-conditional framing was too weak. `E::String::init_utf16` itself
narrows a `2 * len_u16` byte backing slice to only `len_u16` bytes:

```rust
let bytes = &bytemuck::cast_slice::<u16, u8>(data)[..data.len()];
```

Then `slice16()` treats that same stored length as a u16 element count:

```rust
slice::from_raw_parts(self.data.as_ptr().cast::<u16>(), self.data.len())
```

Miri rejects the re-expanded retag even for source-shaped aligned input:
the pointer tag was created for `[0x0..0x2]`, while `slice16()` requested
`[0x0..0x4]` for a two-code-unit input. This is stronger than the earlier
"misuse of internal API" concern: current `init_utf16(&[u16])` followed by
`slice16()` is enough. The JSON/YAML sites inherit the same representation
problem through `E::String::init_utf16`.

**Fix-point candidate:** introduce a `Utf16Bytes` newtype that *holds* the
original `&[u16]` provenance, replacing the raw `&[u8]` + cast-back-to-u16
pattern.

#### B.2.4 — `src/md/containers.rs:206, 222` — `BlockHeader` / `VerbatimLine` slices

| Line | Site |
|---|---|
| `:206` | `let hdr: &BlockHeader = unsafe { &*bytes_ptr.add(off).cast::<BlockHeader>() };` |
| `:222-226` | `&[VerbatimLine]` slice over `bytes_ptr.add(off).cast::<VerbatimLine>()` after `off += size_of::<BlockHeader>()` |

**Verdict:** PRESENT_STRONG-conditional. The SAFETY at :198-199 manually
realigns `off` via `(off + align_mask) & !align_mask` where
`align_mask = align_of::<BlockHeader>() - 1`, then asserts the writer maintained
this. The `VerbatimLine` slice at :221-226 assumes `align_of::<VerbatimLine>()
<= align_of::<BlockHeader>()` *implicitly* — there is no `const _: ()` check.
**Sharp-edge: if anyone bumps `VerbatimLine`'s alignment past `BlockHeader`'s,
the post-header offset becomes under-aligned for `VerbatimLine` and the
`&[VerbatimLine]` is UB.** Worth adding the assertion.

#### B.2.5 — `src/watcher/INotifyWatcher.rs:353-358, 443` — Linux inotify Event header

| Line | Site |
|---|---|
| `:353-358` | `let event: *const Event = … buf.as_ptr().add(i).cast::<Event>();` — stored as raw pointer (sound) |
| `:361` | `i += unsafe { (*event).size() };` — `(*event).name_len` field read via raw pointer (sound — direct field access, no reference) |
| `:443` | **`let event = unsafe { &*events[events_processed] };`** — **materialises `&Event`** for the entire batch loop |

**Verdict:** HARDENING-ONLY under current source invariants, not a confirmed
UB finding. The earlier "align 1" wording was too strong. The backing buffer is
`Box<EventListBytes>` where `EventListBytes` is `#[repr(C, align(4))]`, and the
file has `const _: () = assert!(align_of::<Event>() == 4)`. The Linux
`inotify(7)` example likewise says the read buffer should be aligned to
`struct inotify_event`, and `len` includes padding null bytes so subsequent
records land on the suitable boundary. The residual risk is kernel/ABI or
future-refactor drift, not a current in-tree symbolic-alignment witness.

**Fix-point:** the existing TODO is correct. Convert the read-path on :443 to
either `let event_copy: Event = ptr::read_unaligned(events[i]); let event =
&event_copy;` or to direct field reads via `addr_of!`. The latter is
zero-cost because `Event` is 16 bytes.

---

## C. Cross-Cutting Observations

### C.1 — `bun_core::util::Unaligned<T>` is the correct fix-point primitive

`#[repr(C, packed)] struct Unaligned<T>(T)` with `Unaligned::get()` / `set()`
funnels reads through `read_unaligned`/`write_unaligned`. `slice_align_cast`
debug-asserts alignment when reinterpreting back. **This primitive is
under-used:** the `pe.rs` `SectionHeader` cluster and the UTF-16 reinterp
trio could both adopt `&[Unaligned<T>]` to make alignment-tolerance type-level.

### C.2 — Compile-time alignment assertions

The codebase already has good patterns for compile-time alignment proof
(`WindowsWatcher::DirWatcher` `assert_ffi_layout!` + `offset_of!` check at
`src/watcher/WindowsWatcher.rs:92-103`, `INotifyWatcher` `EventListBytes`
`const _: () = assert!(align_of::<Event>() == 4)`,
`analyze_transpiled_module.rs:370-374` `MODULE_INFO_ALIGN` assertion cluster).
The PE cluster and md/containers.rs cluster are missing equivalent
guards.

### C.3 — `repr(packed)` is well-disciplined

Eight `#[repr(C, packed)]` types in tree, none form `&packed.field`
references. `cargo check` reports zero E0793 errors. Access patterns use:
- brace-copy: `{ self.field }` (creates aligned local)
- destructuring let: `let (a, b) = (self.x, self.y);` (copies)
- `bytemuck::bytes_of_mut(&mut packed).copy_from_slice(src)` (whole-struct memcpy)
- `addr_of!((*ptr).field).read_unaligned()` (raw-pointer field read)

The `bun_core_macros/lib.rs:322` macro template produces
`&*addr_of!((*this).field)` — that **is** a reference materialisation. Used
for refcount fields. Verify the parent struct is not `#[repr(packed)]` — if
it's `#[repr(C)]` with the refcount as a natural-aligned `AtomicU32`, fine.
Spot-check confirms this — refcounts live in `#[repr(C)]` (not packed) types.

### C.4 — mmap-backed atomics

**Searched, no hits.** No `AtomicU32`/`AtomicU64`/`compare_exchange` over
StandaloneModuleGraph bytes, FFI buffers, or mmap regions. The bytecode
in-place mutation path in standalone_graph mutates plain `*mut u8` regions,
not atomics. Bucket-3 sub-category "mmap-backed atomics without verifying
base address alignment" is therefore **empty in Bun**.

---

## D. Remaining Hardening Items (Not New Confirmed Findings)

1. **`src/watcher/INotifyWatcher.rs:443` `&Event` materialisation over kernel
   records** — current source aligns the backing buffer with
   `EventListBytes` and relies on inotify's padded `len` field for subsequent
   records. This is defensible, but the TODO at :104-106 is still the right
   hardening direction if maintainers want to eliminate kernel-padding trust:
   replace the `&Event` materialisation with `ptr::read_unaligned` into a
   local value and process that local.

2. **`src/md/containers.rs:222` missing `align_of::<VerbatimLine>() <=
   align_of::<BlockHeader>()` compile-time guard** — the existing manual
   realignment at :198 only covers `BlockHeader`. If a future change bumps
   `VerbatimLine` past `BlockHeader`'s alignment, the typed slice becomes
   misaligned silently. **Single-line `const _: () = assert!(...)`.**

3. **`src/exe_format/pe.rs:907/919` `is_pe()` content-sniff** — no longer a
   separate "new find"; it is part of EXP-093. Keep it called out inside the
   PE remediation because it is the public-content-sniffing edge of the same
   alignment bug class.

---

## E. Phase 3 / Phase 5 — Symbolic-Alignment-Check Candidates

These are the candidates for `MIRIFLAGS="-Zmiri-symbolic-alignment-check"`
experiments. Each would be an **EXP-NNN entry** if a witness can be produced.

| ID | Site | Hypothesis | Reachability |
|---|---|---|---|
| **EXP-093 (PE cluster)** | `pe.rs:289/301/396/907/919` | A handcrafted PE with an odd `e_lfanew` or odd section-headers offset forms a misaligned `&[SectionHeader]` | CONFIRMED_UB by Miri (`phase5_experiment_results/EXP-093.log`); reachable through PE reader/content-sniff paths when hostile/tampered bytes are accepted |
| **EXP-095 (Mach-O load-command mutation)** | `macho.rs:121/366/371/392/403` | Byte-backed Mach-O load-command storage is read safely with `read_unaligned`, then later mutated through `&mut T` / `&mut [T]` typed references | CONFIRMED_UB by Miri (`phase5_experiment_results/EXP-095.log`); production reachability depends on input/allocation alignment, but current Rust API has no alignment contract |
| **EXP-030 (StandaloneModuleGraph aliasing)** | already filed by Bucket-4 sweeper | n/a here (no Bucket-3 hazard, all reads are `read_unaligned`) | n/a |
| **No EXP recommended (INotifyWatcher Event)** | `INotifyWatcher.rs:443` | A synthetic 1-byte-aligned buffer would prove only the generic Rust rule, not the current Bun source path. Current source uses `EventListBytes` with 4-byte alignment plus inotify record padding. | Hardening-only unless a source-faithful path can produce an unaligned event pointer |
| **EXP-N2 (md/containers VerbatimLine)** | `containers.rs:222` | Bump `VerbatimLine`'s alignment in a fork to force `> align_of::<BlockHeader>()`, run md parser fuzz harness | Hypothetical (would require source change); recommend `const _` assert instead of EXP |
| **EXP-088 (UTF-16 reinterp)** | `ast/e.rs:1449-1459` + `ast/e.rs:1424`, propagated through `parsers/json_lexer.rs:575` and `parsers/yaml.rs:1783` | Source-shaped `init_utf16(&[u16; 2])` stores only `len_u16` bytes, then `slice16()` retags `2 * len_u16` bytes | CONFIRMED_UB by Miri (`phase5_experiment_results/EXP-088.log`); fix is the `Utf16Bytes` / typed-pointer representation |

**Recommendation update:** EXP-093 and EXP-095 are now the object-file
Bucket-3 witnesses: PE and Mach-O both had byte-backed wire-struct code that
materialised typed references. EXP-088 proves the UTF-16 representation is
also no longer merely a source-level cleanup. The remaining lower-confidence
items are better closed by source-level hardening (`const` alignment assert in
md/containers; optional `read_unaligned` swap in INotifyWatcher) than by new
experimental witnesses.

---

## F. Cross-References

- **Section R inventory** (`phase1_inventory_R.md`) line 225 — anchors this
  bucket's PE/UTF-16/md cluster. R's Q2 (Phase 3, alignment) explicitly
  identifies `pe.rs:289/301` as the canonical PE-alignment target; it is now
  tracked as EXP-093 because EXP-022..025 were intentionally left unused after
  registry renumbering.
- **Section P notes** (`phase1_notes/P_sys_io_event_loop.md`) — the 4-platform
  dirent `read_unaligned` cluster (`dir_iterator.rs:195-198, 296-299,
  673-689, 818-820`) is **sound on the Rust side**; what needs hand-verify
  is the per-platform `offset_of!(libc::dirent, d_name)` versus the kernel's
  actual record layout. That's a kernel-ABI Bucket-21 concern, not Bucket-3.
- **Section M / NF-3** — `StandaloneModuleGraph` on tampered binary: the
  `read_unaligned` reads at `:292/345/357/580/2153/2183/2213/2334/2369/2376`
  are alignment-sound; the *validity* concerns (Tampered Offsets, length
  fields, enum tags) belong to Bucket 4 (`phase2_findings_04_validity.md`).
- **Section U** (`phase1_inventory_U.md`) — the 3 inline-asm sites in
  `src/perf/hw_timer.rs` are alignment-clean (no memory operands).
- **EXP-093 (confirmed)** — mirrors `pe.rs:289`'s `&[SectionHeader]`
  construction with deliberately misaligned byte storage; Miri symbolic
  alignment checking fires at `slice::from_raw_parts`.
- **EXP-095 (confirmed)** — mirrors `macho.rs:366`'s `&mut
  symtab_command` construction with deliberately misaligned byte storage;
  Miri symbolic alignment checking fires at `&mut *cmd_ptr.cast::<T>()`.
- **Historical EXP-30/31 allocator-sweeper notes** — do not use those old IDs
  for this bucket. `StandaloneModuleGraph` remains a Bucket-4 validity concern;
  `jsc/bindgen` is now EXP-091 under Bucket 20/6 allocator-layout pairing, not
  the PE alignment witness.

---

## G. Bottom Line

- **Total alignment-sensitive sites:** ~138 (115 `read_unaligned` + 12
  `write_unaligned` + 8 `repr(packed)` definitions + 17 confirmed raw-byte-
  to-typed-reference sites across PE/Mach-O/UTF-16 + 2 hardening-only
  clusters in md/containers and INotifyWatcher)
- **Confirmed Bucket-3 hazards:** EXP-093 (PE, 9 sites) + EXP-095
  (Mach-O, 5 sites) + EXP-088
  (UTF-16 `E::String` narrowed-provenance representation). Hardening-only:
  INotifyWatcher `Event` optional unaligned-read rewrite + md/containers
  `VerbatimLine` alignment assertion. 0 remaining type-system-only UTF-16
  gaps.
- **mmap-backed atomics:** zero — Bucket-3's mmap-atomic sub-category is
  empty for Bun
- **`repr(packed)` field-reference hazards:** zero (rustc E0793 enforces; all
  packed types use brace-copy / bytemuck / addr_of! discipline)
- **`read_unaligned`/`write_unaligned` correctness:** all sound; what needs
  audit is Bucket 4 validity of the bytes claimed to be `T` (handled in
  `phase2_findings_04_validity.md`)
- **Phase 3/5 EXP witnesses:** EXP-093 (PE alignment witness), EXP-095
  (Mach-O load-command mutation alignment witness)
- **Skill-anchored fix-points:** compile-time `align_of` asserts (already
  used in 20+ sites in tree), `bun_core::util::Unaligned<T>` adoption,
  conversion of `&T`/`&[T]` materialisation to `read_unaligned` +
  by-value-local
