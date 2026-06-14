# Phase 2 Bucket 5 — Uninitialized Memory

**Bucket scope:** `MaybeUninit::<T>::uninit().assume_init()` for non-`()` `T`;
reading `Vec`'s `set_len`-extended region before write; reading padding bytes
via `*(ptr as *const u8)`; `Vec::with_capacity(n)` + index `[0..n]` before
write. Per UB-TAXONOMY §5.

**Run:** `2026-05-15-exhaustive` exhaustive sweep.
**Inputs:** all 21 phase1 inventories + 24 phase1 notes + current EXP registry.
**Method:** ripgrep + targeted file reads on every flagged callsite,
cross-referenced against bucket-5-relevant phase1 callouts (Sections E, J, L,
O, P primarily).

**Current-status overlay (Codex follow-up, 2026-05-16):** the draft `NEW-U-*`
items in this file are no longer merely recommended experiments. `NEW-U-1`
is **EXP-033 / CONFIRMED_UB**, `NEW-U-2` is **EXP-034 / CONFIRMED_UB**,
`NEW-U-3` is **EXP-078 / CONFIRMED_UB**, and the corrected primitive-scratch
array finding is **EXP-089 / CONFIRMED_UB**. The source-of-truth registry is
`UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`; this bucket file is the static
sweep narrative that led to those closures.

---

## 1. Cross-references to existing EXP entries

| EXP | Section | Status | Bucket-5 relevance |
| --- | --- | --- | --- |
| **EXP-001** | O | CONFIRMED | `assume_init_slice<T>(&[MaybeUninit<T>])` reinterprets entire `LinearFifo` backing buffer as `&[T]` including unused slots. Section O re-confirmed shape unchanged at `src/collections/linear_fifo.rs:62-80`; in-source `// TODO(port)` lines 115-118 explicitly flag the unlanded fix. Hot callers across J: `LinearFifo<{RefDataValue, Entry, PromisePair}>` — Section J subagent corrected the niche-bearing-T claim: ALL three carry validity / non-trivial Drop. |
| **EXP-005** | L | CONFIRMED | `&mut [Dependency]` over uninit `Vec` capacity at `src/install/yarn.rs:918-925`. Section L re-confirmed verbatim; SAFETY comment discharges capacity, not uninit; `DependencyVersionTag` (`#[repr(u8)]` 0..=9) supplies the validity-bearing field that turns this into observable UB. |

These two are the established Bucket-5 anchors and remain accurate.

## 2. Bucket-5 finds promoted to EXP entries

### NEW-U-1 (HIGH): `bun_threading::Channel::try_read_item` / `read_item` materialize `&mut [T]` over uninit storage before any slot is written

**Source:** `src/threading/channel.rs:121-142` (`try_read_item`, `read_item`),
flowing into `read_items` at `:208-242` line 232 (`items[popped] = item;`).

```rust
pub fn try_read_item(&self) -> Result<Option<T>, ChannelError> {
    let mut items: [MaybeUninit<T>; 1] = [MaybeUninit::uninit()];
    // SAFETY: `read` only writes initialized `T` into the first `n` slots
    // and returns `n`; we never read an uninitialized slot.
    let slice = unsafe { &mut *items.as_mut_ptr().cast::<[T; 1]>() };
    if self.read(slice)? != 1 { return Ok(None); }
    Ok(Some(unsafe { items[0].assume_init_read() }))
}
// inside read_items at line 232:
items[popped] = item;
```

The SAFETY comment at line 124 says "we never read an uninitialized slot" —
but the earlier cast has already materialized a `&mut [T; 1]` whose referent
is still `[MaybeUninit<T>; 1]`. Bun's current impl is `T: Copy`, and `Copy`
does not mean "all byte patterns, including uninitialized bytes, are valid
`T`." A validity-bearing `Copy` type such as `bool` is enough for Miri to
observe the bug.

**Current saving grace (in-tree):** every concrete `Channel<T>` instantiation
audited uses pointer/integer-like POD payloads — `Channel<*mut HTTPCallbackPair>`
(`src/http/AsyncHTTP.rs:953`), `Channel<u32, …>`
(`src/runtime/cli/run_command.rs:3100`), and `Channel<image-thumbhash-ZST>`.
Those payloads do not exercise the validity-bearing witness in today's call set.

**Why this still matters:** `Channel<T>` is **`pub`** in `bun_threading` and
generic over `T: Copy`. The next caller that picks `Channel<bool>`,
`Channel<NonZeroU32>`, `Channel<&U>`, or any other validity-bearing `Copy`
payload can hit immediate UB on the very first `try_read_item` / `read_item`.
The implementation should pass a `&mut [MaybeUninit<T>]` into a refactored
`read_items` and only form/read initialized `T` slots after the count proves
they were written.

**EXP closure:** promoted to **EXP-033 / CONFIRMED_UB**. A focused
`Channel<bool>`-shape Miri witness trips the validity-bearing uninitialized
slot path while respecting Bun's current `T: Copy` bound.

### NEW-U-2 (MEDIUM): `migration.rs:1492-1493` set_len + drop window — same shape as EXP-005 in npm migrate path

**Source:** `src/install/migration.rs:1490-1494`.

```rust
// SAFETY: res_cursor elements written above into reserved capacity
unsafe {
    this.buffers.resolutions.set_len(res_cursor);
    this.buffers.dependencies.set_len(res_cursor);
}
```

This is structurally identical to EXP-005 in `src/install/yarn.rs:1401-1402`:
both extend a `Vec<Dependency>` / `Vec<DependencyID>` backing buffer to a
cursor that the preceding loop has been bumping. The npm-migrate loop
contains multiple `continue 'dep_loop;` shortcuts; if any path bumps
`deps_cursor` without bumping `res_cursor` (or vice versa), the set_len
covers slots that were never written. The `#[cfg(debug_assertions)]` block
at `:1499-1518` *does* spot-check `Behavior::default()` and `UNSET_PACKAGE_ID`
sentinels in dependencies/resolutions before the panic at `:1517`, but only
in debug builds — release silently passes a Vec of partially-uninit
`Dependency` values.

Section L Phase-1 note explicitly flagged this: "Same shape may repeat at
`src/install/migration.rs:1492-1493`; that path needs its own experiment
instead of a dangling EXP reference."

**EXP closure:** promoted to **EXP-034 / CONFIRMED_UB**. The witness mirrors
the `DependencyVersionTag` validity-bearing shape and confirms the
set_len-over-cursor failure class.

### NEW-U-3 / EXP-078 (CONFIRMED): `bun_core::ArrayLike::set_len_and_slice<T>` is a *safe* trait method that returns `&mut [T]` over uninit storage

**Source:** `src/bun_core/util.rs:111-119` (trait), `:294-301` (impl for Vec),
`:166` (only in-tree caller).

```rust
pub trait ArrayLike {
    type Elem;
    /// Set `len` to `n` (caller has already reserved) and return the now-live
    /// slice for bulk memcpy. Mirrors the Zig `map.items.len = n; slice = map.items`.
    fn set_len_and_slice(&mut self, n: usize) -> &mut [Self::Elem];   // <-- SAFE
}
impl<T> ArrayLike for Vec<T> {
    fn set_len_and_slice(&mut self, n: usize) -> &mut [T] {
        debug_assert!(self.capacity() >= n);
        unsafe { self.set_len(n) };
        self.as_mut_slice()                                            // <-- &mut [T] over uninit
    }
}
```

The trait method is **safe** (no `unsafe fn`); the only reviewed in-tree caller
(`util.rs::from_slice`) immediately follows with `slice.copy_from_slice(default)`
which writes every element before any read. That intended caller is disciplined,
but the API surface itself is unsound: any safe caller can observe the slice
between `set_len_and_slice(n)` and the bulk initialization. EXP-078 models
`Vec<bool>`, forces an observable read via `std::hint::black_box(live[0])`, and
Miri reports `reading memory ... but memory is uninitialized`.

**Verdict:** EXP-078 / CONFIRMED_UB as a safe-API shape. The trait method should
be `unsafe fn` with a Safety contract documenting "every element must be written
before the slice is read or dropped", or be replaced with a closure/initializer
API that never exposes typed initialized storage before initialization is
complete. Lower priority than NEW-U-1/NEW-U-2 for production blast radius, but
no longer just a recommended experiment.

## 3. Best-in-section anti-patterns to land in the Phase-12 UB_RUNBOOK

### Anti-pattern A: `vec![…; len]` zero-init INSTEAD of `Vec::with_capacity(n) + set_len(n)`

**Exemplar:** `src/runtime/socket/udp_socket.rs:1207-1212` (Section E
`send_many_impl`).

```rust
let mut payloads:   Vec<*const u8>          = vec![core::ptr::null(); len];
let mut lens:       Vec<usize>              = vec![0; len];
let mut addr_ptrs:  Vec<*const c_void>      = vec![core::ptr::null(); len];
// `sockaddr_storage` is POD (`Zeroable + Copy`); zero-init so phase 1/2
// can index safely (no `set_len` over uninit memory).
let mut addrs:      Vec<sockaddr_storage>   = vec![bun_core::ffi::zeroed(); len];
```

The SAFETY comment **explicitly names** the EXP-005 hazard it is dodging.
This is the canonical "phase-1 collects user-JS-reachable values, phase-2
captures byte pointers" pattern; the zero-init eliminates the UB window
between allocation and the first slot write.

### Anti-pattern B: `MaybeUninit + ptr::addr_of_mut!().write(field)` per-field then a single `assume_init`

**Exemplars:** 
- `src/runtime/bake/DevServer.rs:559-787` — the `w!` macro.
- `src/runtime/socket/WindowsNamedPipeContext.rs:282-358` — `create()` with 9 field-writes through addr_of_mut.
- `src/runtime/socket/socket_body.rs:3830-3940` — `DuplexUpgradeContext`.
- `src/runtime/cli/run_command.rs:3263-3300` — `RemoteImageDownload`.

Pattern: allocate `Box<MaybeUninit<T>>`, derive a stable `*mut T`, write each
field via `addr_of_mut!((*p).field).write(...)`, then `assume_init` once
every field is written. Avoids `mem::zeroed::<T>()` for `T` containing `fn`
pointers / `NonNull` / niches (which would be Bucket-4 UB).

This is the canonical PORT pattern for self-referential / niche-bearing
`undefined`-style Zig storage. **Phase-2 should not flag occurrences** —
they are the safe spelling of the Zig `var x: T = undefined;` idiom.

### Anti-pattern C (corrected by EXP-089): `MaybeUninit::uninit().assume_init()` for `[u8; N]` / `[u16; N]` / `[u32; N]` is UB at construction

**Exemplars:**
- `src/bun_core/util.rs:996-1003` — `PathBuffer::uninit()` (`[u8; PATH_MAX_BYTES]`)
- `src/bun_core/util.rs:1043-1050` — `WPathBuffer::uninit()` (`[u16; PATH_MAX_WIDE]`)
- `src/install/lockfile/Tree.rs:85-92` — `depth_buf_uninit()` (`[u32; N]`)
- `src/sys/lib.rs:274-294` — `AlignedBuf` (`MaybeUninit<[u8; 8192]>` per phase1 P:114) is the **sound contrast**, not part of the defect.

Earlier wording here was wrong. "Every bit pattern is valid" does not mean
"uninitialized memory is an initialized integer value." Rust requires integer
elements to be initialized; `MaybeUninit::uninit().assume_init()` for
`[u8; N]`, `[u16; N]`, or `[u32; N]` constructs an invalid initialized value
immediately. Miri confirms this in **EXP-089** before any caller-visible
read. The sound spellings are either zero-initialization (if the memset is
acceptable) or keeping the scratch storage inside `MaybeUninit<[T; N]>` /
`[MaybeUninit<T>; N]` until an initialized prefix is exposed.

## 4. Enumeration of every `set_len` callsite in `src/` (79 sites, summarized by safety verdict)

| Verdict | Count | Notes |
| --- | --- | --- |
| SOUND — `set_len(prev + n)` after FFI/syscall returns `n` written bytes | 13 | `zlib/lib.rs:567/1043`, `libdeflate_sys/libdeflate.rs:208/422`, `bun_core/lib.rs:412/430/460/476/573`, `bun_core/string/immutable/unicode.rs:39`, `runtime/webcore/blob/copy_file.rs:1170`, `io/lib.rs:1089` (kqueue), `bun_core/lib.rs:1876` (memcpy-then-set_len for u16) |
| SOUND — `set_len(n)` after `copy_nonoverlapping(src, dst, n)` filled all bytes | 6 | `collections/vec_ext.rs:251/288`, `bundler/LinkerGraph.rs:694`, `install/lockfile.rs:2898` (trailing tail unread; PathToId is `Copy`), `bundler/linker_context/findImportedFilesInCSSOrder.rs:45` (set_len(0)), `js_parser/p.rs:8533` (set_len(parts_end), shrink) |
| SOUND — `set_len(n)` after preceding loop wrote every slot | 26 | `bun_core/string/SmolStr.rs:138/180/212/293`, `bun_core/string/MutableString.rs:308/318/418`, `collections/vec_ext.rs:425/431/439/447/463/642/751/753`, `collections/lib.rs:450`, `bundler/LinkerGraph.rs:507/526`, `exe_format/macho.rs:219/691/753`, `bundler/linker_context/{generateChunksInParallel.rs:198, generateCodeForFileInChunkJS.rs:413, findImportedFilesInCSSOrder.rs:487/527/631}`, `sql_jsc/shared/CachedStructure.rs:109` |
| SOUND — `set_len(n)` after FFI fills + n is the kernel-returned count or no-Drop prefix is filled before observation | 4 | `resolver/fs.rs:2689/2729` (file read), `http_jsc/headers_jsc.rs:61/64`, `http/h3_client/encode.rs:76` (reserves 4 pseudo-headers, fills before `send_headers`; Codex EXP-090 Miri probe clean for current no-Drop `quic::Header` shape) |
| SOUND — `set_len(0)` shrinking; tail leaked but elements have no Drop or are arena-backed | 5 | `css/selectors/builder.rs:213/214`, `css/selectors/parser.rs:68`, `bun_core/string/immutable.rs:3386`, `bundler/bundle_v2.rs:2336` (intentional leak; arena-lifetime) |
| EXP-005 RE-CONFIRMED | 2 | `install/yarn.rs:1401-1402` (the "final" set_len after the populate loop, distinct from but related to the EXP-005 line 918-925 slice-construct site) |
| **NEW-U-2 / EXP-034 (confirmed)** | 2 | `install/migration.rs:1492-1493` |
| SUSPICIOUS — `set_len(N)` then `load_fields` writes all 8 columns; Drop on Err leaves tail uninit | 2 | `install/lockfile/Package.rs:3370/3432` — Section L Phase-1 explicitly flagged. `Package: Copy`-component fields, but full struct contains validity-bearing `Meta`. Already covered by EXP-003/006 reachability — Bucket-5 layer is the "load_fields returns Err mid-column" contract |
| Other (non-bun_core; unsafe fn writers; etc.) | 19 | Each has explicit caller-discipline SAFETY; spot-checked, no new findings |

### Notable individual verdicts

- `install/lockfile.rs:2898` — `sort_buf.set_len(l_len + r_len)` then writes
  via two disjoint `&mut [PathToId]` views (l_buf / r_buf), each truncated to
  actual count `i` before any iteration. `PathToId: Copy` — no Drop runs over
  the unwritten tail. **SOUND** (the analysis was non-obvious — flagged by
  Section L and verified here).

- `bundler/bundle_v2.rs:2336` — `set_len((0) as usize)` on `items_parts_mut`
  shrinks length to 0; **leaks** the prior `Part` destructors (intentional —
  matches Zig's no-destructor semantics; arena-backed). Bucket 11
  (panic/leak), not Bucket 5.

## 5. Enumeration of every `MaybeUninit::*::assume_init()` site (~52 sites, summarized)

| Verdict | Count | Notes |
| --- | --- | --- |
| SOUND — Pin pattern: `MaybeUninit::uninit()` storage written by `Self::init(&mut storage)` then `assume_init_mut`/`assume_init_drop` for the duration | 14 | `jsc/host_fn.rs:640/654/681`, `jsc/JSValue.rs:2526`, `jsc/TopExceptionScope.rs:612/642/663/696/502`, `jsc/StringBuilder.rs:24`, `runtime/dns_jsc/dns.rs:2655`, `event_loop/SpawnSyncEventLoop.rs:179`, `jsc/rare_data.rs:791`, `bundler/transpiler.rs:1191` |
| SOUND — `Box<MaybeUninit<T>>` + per-field `addr_of_mut!().write()` then `assume_init` (Anti-pattern B) | 7 | `runtime/bake/DevServer.rs:787`, `runtime/cli/run_command.rs:3270`, `runtime/cli/pack_command.rs:2073`, `install/PackageManager.rs:1152` (cross-module write contract), `runtime/cli/filter_run.rs:756`, `bundler/AstBuilder.rs:209-266`, `runtime/webcore/Sink.rs:863` (`T::construct(&mut storage)` — see §6) |
| SOUND — `Box::<T>::new_zeroed().assume_init()` for `T: Zeroable` (or unchecked variant for caller-vetted T) | 6 | `bun_core/lib.rs:2777/2789` (`boxed_zeroed`/`boxed_zeroed_unchecked`), `paths/path_buffer_pool.rs:54/67`, `resolver/lib.rs:3461` (Bufs — primitives + `[MaybeUninit; 256]`) |
| SOUND — `[MaybeUninit<T>; N]::uninit().assume_init()` (element type itself MaybeUninit; no validity invariant) | 5 | `sql_jsc/shared/CachedStructure.rs:58`, `bundler/AstBuilder.rs:209`, `collections/{hive_array, linear_fifo, bounded_array}` const-init (multiple) |
| **EXP-089 CONFIRMED_UB** — `MaybeUninit::uninit().assume_init()` for primitive arrays constructs invalid initialized values | 3 | `bun_core/util.rs:1003` (PathBuffer), `:1050` (WPathBuffer), `install/lockfile/Tree.rs:91` (depth_buf). `sys/lib.rs:279` `AlignedBuf(MaybeUninit<[u8; N]>)` is the sound contrast because it does **not** call `assume_init()` at construction. |
| Per-element write loop then map(assume_init) | 3 | `bundler/AstBuilder.rs:266`, `runtime/dns_jsc/dns.rs:2655`, `install/isolated_install.rs:2049` |
| Linear FIFO assume_init_slice (EXP-001 anchor) | 4 (callers in linear_fifo.rs) | `collections/linear_fifo.rs:127/131/168/172` |
| Other / spot-checked | 9 | `bun_alloc/lib.rs:2042/2123/2140/2230/2342/2989/3027`, `runtime/webcore/Sink.rs:860`, `runtime/webcore/s3/{client,download_stream,simple_request}.rs` (wrapped in S3HttpSimpleTask `MaybeUninit<AsyncHTTP>` — see §6) |

## 6. `Vec::with_capacity(N) + slice::from_raw_parts_mut` and shape variants

| Site | Element type | Verdict |
| --- | --- | --- |
| `src/install/yarn.rs:918-925` (EXP-005 anchor) | `Dependency` (validity-bearing via `DependencyVersionTag`) | **CONFIRMED UB** — slice exposes uninit; subsequent reads through validity-bearing fields. |
| `src/install/migration.rs:1492-1493` (NEW-U-2) | same | **NEW** — same shape, distinct call path. |
| `src/bun_core/lib.rs:526` `spare_bytes_mut` | `u8` | SOUND — `unsafe fn` with caller contract; `u8` no validity. |
| `src/bun_core/lib.rs:560` `allocated_bytes_mut` | `u8` | SOUND — `unsafe fn` with caller contract. |
| `src/bun_core/string/StringBuilder.rs:288/308` | `u8` | SOUND — `unsafe fn` over `Box<[MaybeUninit<u8>]>` allocation. |
| `src/collections/vec_ext.rs:300-310` `from_borrowed_slice_dangerous` | T | `unsafe fn` returning `ManuallyDrop<Vec>` — caller contract enforced by ManuallyDrop wrapper. SOUND. |

## 7. `HiveArray` / `Fallback` deprecated uninit-slot APIs (EXP-072)

`src/collections/hive_array.rs` now documents the legacy bug class directly:
`HiveArray::get` claims a `[MaybeUninit<T>; CAPACITY]` slot, marks it used,
and returns `*mut T` before any `ptr::write`. `Fallback::{get, try_get,
get_and_see_if_new}` expose the same uninitialized pointer shape, with a heap
fallback path when the inline hive is full.

`experiments/EXP-072/src/main.rs` turns that exact contract into a Miri
witness: claim a slot, return before initialization, then later call `put()`.
The witness uses `NeedsDrop(NonZeroU32)` to force drop glue to read initialized
bytes. Miri reports:

```
Undefined Behavior: reading memory at alloc119[0x0..0x4], but memory is uninitialized
 --> src/main.rs:8:17
```

Verdict: **CONFIRMED_UB for the generic unsafe API contract**. The eight Bun
callers still need per-site control-flow review before claiming a live
production exploit path, but the migration obligation is no longer just a
deprecation-message inference. It is a runtime UB witness for the documented
early-return-before-write hazard.

## 8. Cross-section observations

### Section E proactive avoidance
`udp_socket.rs:894-897/1018-1026/1210-1211` (Section E note §3+§4) carry
SAFETY comments that **name the EXP-005 hazard explicitly** ("no `set_len`
over uninit memory", "producing a `sockaddr_storage` value via
`assume_init()` from a partially-init `MaybeUninit` is UB"). Section E is
the only major section in the codebase that calls out the bucket-5 hazard
**by name** in source. Worth lifting into the Phase-12 UB_RUNBOOK as the
canonical "how to write a SAFETY comment that demonstrates awareness of the
underlying UB rule" example.

### Section L cross-references confirmed
Phase-1 Section L flagged migration.rs:1492-1493 as "same shape as
yarn.rs:1401-1402, applied during npm `package-lock.json` migration"; Phase-2
verified verbatim and elevated to **EXP-034 / CONFIRMED_UB**.

### Section P WindowsNamedPipeContext::create (P note §3)
Per-field `addr_of_mut!().write()` over a `Box<MaybeUninit<T>>`; followed by
a single `ptr::write(this, T { ... })` rather than per-field writes. Sound by
construction — the `ptr::write` overwrites the entire allocation in one
`memcpy`. The earlier per-field handlers (handlers struct, named_pipe boxed
pipe) live in stack temporaries, not in the partially-init heap slot, so
no field is read between alloc and the final `ptr::write`. **Pattern P
verified sound.** No bucket-5 finding.

### Section J corrections (LinearFifo callers)
Phase-1 Section J corrected the prior-audit claim that "only niche-bearing T
matters": `DynamicBuffer<T>::as_slice` reinterprets the *whole* `Box<[MaybeUninit<T>]>` as `&[T]` regardless of T's validity. EXP-001 needs a
Miri instantiation per concrete T (`RefDataValue`, Valkey `Entry`,
`PromisePair`) — none are plain primitive arrays.

## 9. Out-of-scope (reported here for cross-bucket trace)

- **Bucket 11 (panic-safety / leak)** sightings during sweep:
  - `runtime/bake/DevServer.rs:559-787` — early `return Err(...)` paths at
    687/698/746/756/766 leak partially-written fields (Box, ManuallyDrop,
    JSC StrongOptional). Not Bucket 5 because `assume_init` never runs on
    those paths.
  - `runtime/cli/filter_arg.rs:313-341` — if `iter.init()??` at 340 fails
    after walker+iter were `.write()`n, `Drop` skips them (`self.valid`
    still false). Leak, not UB.
  - `runtime/webcore/s3/simple_request.rs:476-495` — `S3HttpSimpleTask::drop`
    unconditionally `assume_init_mut()`s `self.http`. Sound under the
    "task ptr never escapes before init" contract; mid-init panic leaks
    rather than UAFs.

## 9. Deliverable summary

**Total findings:**
- 2 cross-references to existing CONFIRMED EXP entries (EXP-001, EXP-005).
- **3 bucket-5 finds promoted by this sweep**: NEW-U-1 → EXP-033
  (`Channel::try_read_item` uninit `&mut [T]`), NEW-U-2 → EXP-034
  (`migration.rs` set_len), NEW-U-3 → EXP-078
  (`ArrayLike::set_len_and_slice` safe trait method).
- 79 `set_len` sites enumerated with verdicts.
- ~52 `MaybeUninit::*::assume_init()` sites enumerated with verdicts.
- 6 `from_raw_parts_mut` sites over uninit `Vec` capacity enumerated.
- 3 best-in-section anti-patterns documented for UB_RUNBOOK.

**Top 3 promoted uninit-bucket findings:**
1. **EXP-033** — `bun_threading::Channel::{try_read_item, read_item}` use
   a cast from `[MaybeUninit<T>; 1]` to `&mut [T; 1]` before any slot is
   written. Currently safe-by-luck for audited in-tree payloads, but the pub
   generic `Channel<T: Copy>` API is a Bucket-5 landmine for the next
   validity-bearing `Copy` payload. Confirmed by a `Channel<bool>`-shape Miri
   repro. **Highest priority** because the failure mode is invisible until a
   new instantiation.
2. **EXP-034** — `src/install/migration.rs:1492-1493` set_len-after-cursor
   shape. Same family as EXP-005 / yarn.rs:1401-1402; supply-chain reachable
   via npm `package-lock.json` migration. Production type contains
   `DependencyVersionTag` (validity-bearing); Miri reports immediately.
3. **EXP-078** — `bun_core::ArrayLike::set_len_and_slice<T>` is a *safe*
   trait method that returns `&mut [T]` over uninitialized backing. The single
   reviewed in-tree caller immediately `copy_from_slice`s, but the public API
   shape is Miri-confirmed unsound for safe callers; should be `unsafe fn` or
   an initializer closure.

**Best-in-section anti-patterns for Phase-12 UB_RUNBOOK:**
- Anti-pattern A — `vec![…; len]` zero-init at
  `src/runtime/socket/udp_socket.rs:1207-1212` with EXP-005-aware SAFETY
  comment.
- Anti-pattern B — `MaybeUninit + addr_of_mut!().write(field)` per-field
  init pattern (DevServer, WindowsNamedPipeContext, RemoteImageDownload).
- Anti-pattern C — `[u8;N]` / `[u16;N]` / `[u32;N]` `assume_init` is invalid
  at construction despite all bit patterns being valid (PathBuffer,
  WPathBuffer, depth_buf). `AlignedBuf(MaybeUninit<[u8; N]>)` is the sound
  contrast, not part of the defect.

**Time budget:** ~20 min as specified. No source edits performed.
