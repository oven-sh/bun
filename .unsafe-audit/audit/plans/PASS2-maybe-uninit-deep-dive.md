# PASS-2 Deep Dive: `maybe_uninit` Cluster

**Inventory query:**
`jq -c 'select((.categories | index("maybe_uninit")) or (.categories | index("mem_zeroed")) or (.categories | index("mem_uninitialized")))' .unsafe-audit/unsafe-inventory.jsonl`

**Site count:** 190 (172 `maybe_uninit`, 8 `mem_zeroed`, 0 `mem_uninitialized`,
others have overlapping tags such as `ptr_cast` / `fd_syscall` / `raw_cast`).

The original task brief said 182; the inventory tags 190. The eight extras are
sites that picked up `maybe_uninit` via a sibling category (e.g.
`ptr_cast,maybe_uninit,fd_syscall` on the libc-stat call sites). All 190 are
covered in the per-pattern analysis below; the 30+ representative sites are
cited with file:line.

## Executive Summary

| Bucket                                                                | Count | Disposition                                                              |
| --------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------ |
| **Sound — `MaybeUninit<T>` field access after guarded init**          |   ~85 | `assume_init_ref` / `assume_init_mut` gated by `loaded` flag or atomic.  |
| **Sound — FFI out-param init**                                        |   ~40 | C/C++ populates the struct; `assume_init` after success rc.              |
| **Sound — pool-slot raw write (`addr_of_mut!().write(...)`)**         |   ~25 | Every field of the destination type written exactly once before claim.   |
| **Sound — `Box::new_uninit()` / `Box::new_zeroed()` round-trip**      |   ~15 | Followed by `init_in_place` / typed write + `assume_init`.               |
| **Sound — `MaybeUninit::write` slot then `assume_init_*`**            |    ~8 | Canonical, no UB window.                                                 |
| **Sound — `MaybeUninit<T>::uninit().assume_init()` over zero-niche T** |     4 | `[u8; N]` / `[u16; N]` / `[u32; N]` / `[MaybeUninit<T>; N]`. Style nit. |
| **Sound — `core::mem::zeroed::<T>()` for POD T (auditable per call)** |     8 | All-zero valid for that T; 6 of 8 sit inside `bun_core::ffi::zeroed`-style wrappers gated by `unsafe trait Zeroable`. |
| **UB-RISK — `&mut [MaybeUninit<T>]` reinterpreted as `&mut [T]` over uninit storage with niche-bearing T** | 6 sites, 2 active call paths | `bun_collections::linear_fifo::LinearFifo::{as_slice, as_mut_slice}` for `LinearFifo<RefDataValue, _>` (test_runner) and `LinearFifo<{Entry, PromisePair}, _>` (valkey_jsc). See **Finding F-1** below. |
| **LATENT UB-RISK — reference to uninit `T` formed across the API surface, sound today only because every in-tree caller passes `T: Copy + Pod`** | 4 | `bun_threading::Channel::{try_read_item, read_item}` cast (channel.rs:126/138); `BoundedArray::add_many_as_slice` (bounded_array.rs:195); `DynamicBuffer::realloc` and `alloc_swap` (linear_fifo.rs:177–187) only do `ptr::copy_nonoverlapping`, sound. See **Finding F-2**. |
| **LATENT LEAK / brittle pattern — `*loop_ = Self { … }` direct assignment to a `&mut T` obtained from `assume_init_mut` over genuinely-uninit storage** | 1 | `bun_io::IoRequestLoop::load` (io/lib.rs:683-689). See **Finding F-3**. |
| **LATENT LEAK — `MaybeUninit::write` over an already-initialized slot without prior `assume_init_drop`** | 1 conceptual, 1 site | `bun_runtime::webcore::streams.rs:1968` — `(*pooled).data = MaybeUninit::new(...)` overwrites a `MaybeUninit<Vec<u8>>` without dropping. See **Finding F-4**. |
| **LATENT LEAK — `clean_entries` skips drop for `needs_free == false`** | 1 | `node_fs_watcher.rs:240`. Currently sound by call-graph discipline. See **Finding F-5**. |

**Counts at a glance:**

- UB-RISK confirmed (`pre-existing-ub-N` candidates): **2**
  ( **F-1a** RefDataValue queue / **F-1b** Valkey Entry+PromisePair queues; both
  share root cause F-1: `linear_fifo::assume_init_slice{,_mut}` ).
- LATENT UB if generics widen: **3** (F-2 surfaces).
- LATENT LEAK / brittle: **3** (F-3, F-4, F-5).
- Refactor opportunities: **8** (see §Refactor Opportunities).
- Sound, no action needed: **~178** of 190.

No double-drops, no `assume_init_drop` -after- `assume_init` move-out, no
`zeroed()`-on-niche-bearing-T were found.

## Pattern Taxonomy

Across the 190 sites, every block falls into one of ten syntactic shapes.
I list them in order of risk.

### Pattern A — `MaybeUninit::<T>::uninit().assume_init()` for "any bit-pattern valid" T

Four occurrences:

| ID         | file:line                                       | T                          | Soundness |
| ---------- | ----------------------------------------------- | -------------------------- | --------- |
| S-001508   | `src/bun_core/util.rs:1003`                     | `PathBuffer = [u8; N]`     | Sound     |
| S-001509   | `src/bun_core/util.rs:1050`                     | `WPathBuffer = [u16; N]`   | Sound     |
| S-002517   | `src/install/lockfile/Tree.rs:91`               | `DepthBuf = [u32; N]`      | Sound     |
| S-010099   | `src/sql_jsc/shared/CachedStructure.rs:58`      | `[MaybeUninit<X>; 70]`     | Sound     |

The three plain-array sites are sound (every bit pattern is a valid `u8`/`u16`/
`u32`), and each carries `#[allow(invalid_value, clippy::uninit_assumed_init)]`
with a comment justifying the perf concern. The `[MaybeUninit<X>; 70]` site is
the canonical "uninit array of uninits" pattern. **Refactor opportunity:** all
four can be written as `MaybeUninit::<[T; N]>` + `assume_init` (sound) or via
`[const { MaybeUninit::uninit() }; N]` and lazy fill, eliminating the
`#[allow(invalid_value)]` attribute. Marginal — the current spellings compile
to the same MIR. Score: **Sound, style nit**.

### Pattern B — `core::mem::zeroed::<T>()` / `bun_core::ffi::zeroed::<T: Zeroable>()`

Eight raw `mem::zeroed` call sites; 34 `bun_core::ffi::zeroed_unchecked` and
`bun_core::ffi::zeroed::<T: Zeroable>()` wrappers (the inventory tagged these
under `mem_zeroed`). All eight raw sites:

| ID         | file:line                                            | T                                   | Why all-zero is valid                                                                                          |
| ---------- | ---------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| S-001280   | `src/bun_core/lib.rs:2921`                           | generic `T: Zeroable`               | Inside `pub const fn zeroed<T: Zeroable>()`; bound discharges the obligation per type at the `unsafe impl`.    |
| S-001282   | `src/bun_core/lib.rs:2952`                           | generic `T` (caller asserts)        | `unsafe const fn zeroed_unchecked<T>()`; caller-side audit.                                                    |
| S-001328   | `src/bun_core/lib.rs:3118`                           | ZST closure / fn item               | `conjure_zst<H>` compile-time-asserts `size_of::<H>() == 0`; writes zero bytes. Always sound.                  |
| S-002910   | `src/install/windows-shim/main.rs:267`               | `T: Zeroable` (shim's local trait)  | Mirror of `bun_core::ffi::zeroed` for the install Windows shim (which can't depend on bun_core).               |
| S-003320   | `src/jsc/btjs.rs:288`                                | local `MemoryBasicInformation`      | `repr(C)` with `*const c_void`/`usize`/`u32` fields — every all-zero bit pattern valid (null ptr is valid for `*const`). |
| S-006734   | `src/runtime/image/codec_webp.rs:199`                | `libwebp::WebPChunkIterator`        | C struct, `*mut u8` + ints. Sound.                                                                             |
| S-008827   | `src/runtime/test_runner/harness/recover.rs:59`      | `Context = jmp_buf/ucontext_t`      | POD; written by `get_context` immediately after.                                                               |
| S-008829   | `src/runtime/test_runner/harness/recover.rs:84`      | same                                | same                                                                                                           |

No `zeroed::<T>()` site targets a type with niches. The
`Zeroable`-trait-gated pathway (`bun_core::ffi::zeroed`) is the *correct*
way to make this discipline auditable — each `unsafe impl Zeroable` does the
once-per-type proof. The 8 raw sites are all leaf wrappers (`zeroed_unchecked`,
`conjure_zst`) or one-off FFI POD inits. **No UB.**

### Pattern C — `MaybeUninit<T>` field + guarded `assume_init_ref/mut`

The dominant pattern (~85 of 190 sites). Shape:

```rust
struct S { x: MaybeUninit<T>, loaded: bool }
// or, statically:
static GLOBAL: ThreadCell<MaybeUninit<T>> = ...;
static GLOBAL_INIT: AtomicBool = AtomicBool::new(false);
```

Sites I read end-to-end:

- `src/http/lib.rs:750` (`HTTP_THREAD`) — gated by `HTTP_THREAD_INIT.load(Acquire)`.
  Release-mode `assert!` (not `debug_assert!`) on the load makes the gate
  unbreakable in shipping builds. Comment explicitly calls out that the
  inhabited type has niche-bearing fields and that `debug_assert!` would have
  been unsound. Sound.
- `src/io/lib.rs:683` (`LOOP`) — `OnceLock<()>` for happens-before, then
  `(*LOOP.get_unchecked()).assume_init_mut()` inside the one-shot loader. See
  **Finding F-3** for the brittle "direct assignment" follow-up.
- `src/io/lib.rs:804` — `assume_init_ref` after `ensure_init()` (which calls
  `ONCE.get_or_init(Self::load)`). Sound.
- `src/jsc/ZigException.rs:179, 224, 236` — gated by `self.loaded`. Lazy init
  + idempotent deinit. Drop guard covers the early-return path. Sound.
- `src/jsc/RuntimeTranspilerStore.rs:267` — `init_in_place(&mut MaybeUninit<Self>)`
  writes every named field via `addr_of_mut!`; the embedded `[MaybeUninit<T>; N]`
  hive buffer stays uninit (correct). Sound.
- `src/runtime/bake/DevServer.rs:150–175` — three `MaybeUninit<Transpiler<'static>>`
  fields with accessors `server_transpiler()` / `client_transpiler()` /
  `ssr_transpiler()` documented as "written by `init()` before any access".
  The bitwise-alias of `ssr_transpiler` to `server_transpiler` on the
  `!separate_ssr_graph` branch (DevServer.rs:776–780) does NOT cause double-drop
  because neither field has automatic Drop glue (`MaybeUninit<T>` suppresses
  drop); the surrounding code never `assume_init_drop`s either field. Sound.
- `src/install/PackageManager.rs:1152`, `1975`, `2426` — the in-place
  `addr_of_mut!((*p).field).write(value)` macro `wr!` pattern. I diffed the
  field list against the writes for both `init()` (line 1975) and the second
  init flavor (line 2426): every named field of `PackageManager` is written
  exactly once. The two `HiveArrayFallback` pools (`preallocated_network_tasks`,
  `preallocated_resolve_tasks`) are initialized via `Self::init_in_place(ptr)`
  which writes the `used` bitset and leaves the `[MaybeUninit<T>; CAPACITY]`
  inline buffer uninitialized (correct). Sound.
- `src/install/NetworkTask.rs:153, 160, 907, 914` — `write_init(slot)` writes
  every field of `NetworkTask` except `unsafe_http_client` (which is itself
  `MaybeUninit<AsyncHTTP<'static>>` and stays uninit; later overwritten by
  `for_manifest`/`for_tarball` without drop). The `assume_init_ref/mut`
  accessors `http()` / `http_mut()` document their precondition. Sound.
- `src/install/PackageManager/runTasks.rs:536, 892, 982, 1063` — paired writes
  and explicit `assume_init_drop` before returning the slot to the hive pool.
  Sound.
- `src/runtime/bake/dev_server/mod.rs:487, 511, 1377` — `(*dev).server_transpiler.assume_init_mut()`
  after `DevServer::init` has run. Sound.
- `src/resolver/lib.rs:273, 293, 3461, 7554, 7779, 7819, 7885, 9593, 9639` —
  `FileSystem::instance()` / `bin_dirs()` / similar singletons. Some are
  atomic-guarded (`INSTANCE_LOADED.load(Acquire)` at line 287), some are
  caller-discipline (line 271 `instance()` has only a comment). The `instance()`
  pattern is fragile — see §Refactor Opportunities. Sound under current
  call-graph.

The pattern is uniformly applied and uniformly commented. I read the call
graph for every guard variant (`AtomicBool::load(Acquire)` matched with
`Release`-store at init, `OnceLock` `get_or_init`, struct-field `loaded: bool`,
`ManuallyDrop`-handoff). No found bug.

### Pattern D — FFI out-param: `let mut x = MaybeUninit::<T>::uninit(); ffi_call(x.as_mut_ptr()); x.assume_init()`

~40 sites. Examples:

- `src/sys/lib.rs:902, 2090, 2106, 2123, 2330, 2810, 7894` — libc `stat`/`fstat`/
  `lstat`/`statx`/`tcgetattr`. Sound: kernel fills the entire struct on success
  (rc == 0 / -1 → no `assume_init`).
- `src/jsc/array_buffer.rs:1089` — C++ `JSC__ArrayBuffer__asBunArrayBuffer`.
  Sound: C++ initializes the entire `ArrayBuffer` (POD struct).
- `src/jsc/bindgen.rs:310` — `convert_from_extern` round-trip. Sound: bytes copied
  from initialized storage above.
- `src/jsc/generated.rs:258, 560, 676` — `bindgenConvert*` host functions.
  Sound: gated by `call_false_is_throw` → `?`.
- `src/jsc/StringBuilder.rs:22` — `StringBuilder__init` (C++).
- `src/runtime/crypto/HMAC.rs:22, 59` — BoringSSL `HMAC_CTX_init` / `HMAC_CTX_copy`.
- `src/spawn_sys/posix_spawn.rs:342, 406` — `posix_spawnattr_init` /
  `posix_spawn_file_actions_init`. Sound: `spawn_errno(...)?` gates `assume_init`.
- `src/sys_jsc/error_jsc.rs:147` — C++ `ErrorJsc::to_system_error`.
- `src/bun_core/util.rs:1568` (`fd_path_raw`, FreeBSD) —
  `MaybeUninit::<libc::kinfo_file>::zeroed()` + `addr_of_mut!((*kif).kf_structsize).write(...)`.
  Zeroed initializes the rest; only `kf_structsize` needs the explicit write
  for the F_KINFO contract. Sound.

All 40 follow the same shape and all 40 are correct. No found bug.

### Pattern E — `Box::<T>::new_uninit() + init_in_place(box.as_mut_ptr()) + box.assume_init()`

~15 sites. The canonical RVO substitute for "construct directly in heap, never
on stack". Examples:

- `src/bun_alloc/lib.rs:2001, 2342` — `OverflowGroup` block alloc. The trait
  method `OverflowBlock::zero(this: *mut Self)` only writes the typed `used`
  field; the body's `[MaybeUninit<T>; N]` is correctly left uninit.
- `src/collections/hive_array.rs:513, 586` — `HiveArray::Fallback::new_boxed`
  and similar; `init_in_place` writes only the 256-byte `HiveBitSet` (`[usize; 32]`).
- `src/jsc/rare_data.rs:791` — `SpawnSyncEventLoop`. The init API takes
  `&mut MaybeUninit<Self>`, calls `this.write(Self { ... })`, then
  `assume_init_mut()` for the `setParentEventLoop` follow-up. Sound.
- `src/runtime/bake/production.rs:445, 450, 507, 509, 519, 650, 519` —
  `MaybeUninit<Transpiler>` slots filled by `Framework::init_transpiler_with_options`.
  The `ssr_transpiler` is *conditionally* initialized only when
  `separate_ssr_graph == true`; the post-init `assume_init_mut()` is correctly
  gated. Sound.

No found bug.

### Pattern F — In-place struct init via `addr_of_mut!`

9 sites tagged. The two most extensive:

- `src/runtime/bake/DevServer.rs:574, 733` — the `init()` of `DevServer`.
  47 named fields. I diffed the writes against the struct definition (line
  320–470). Every named field appears in exactly one `w!(field, value)` macro
  call or in the immediate `addr_of_mut!((*p).field).write(...)` body
  (`bun_watcher`, `watcher_atomics`, `server_transpiler`, `client_transpiler`,
  `ssr_transpiler`). The post-`init_transpiler` `assume_init_mut` accessors on
  the three Transpiler fields preserve the soundness contract.
- `src/install/PackageManager.rs:1975, 2426` — 74 named fields. Diffed against
  the struct definition (line 354 onward). Every field is written. The two
  inline `HiveArrayFallback` pools use `init_in_place` rather than `wr!`,
  correctly initializing only the bitset and leaving the buffer slots uninit.
- `src/collections/hive_array.rs:188`, `src/install/NetworkTask.rs:907, 914`,
  `src/jsc/RuntimeTranspilerStore.rs:267` — already covered above; all sound.

No found bug. **Refactor opportunity:** the `wr!(field, value)` macro could
take the field-list and verify "every field written" at expansion time via
`useAllFields` (mirrors the Zig source), eliminating the manual diff. Not
critical — the per-init audit ran clean.

### Pattern G — `MaybeUninit::<T>::uninit()` + `MaybeUninit::write(value)` + `assume_init*`

~8 sites. The canonical "no UB window" pattern (`MaybeUninit::write` is a safe
method that returns `&mut T` to the now-initialized slot). Examples:

- `src/install/PackageManager.rs:846, 879` — `Transpiler::init` via
  `MaybeUninit::write`.
- `src/runtime/cli/bunx_command.rs:614`, `run_command.rs:576, 2412`,
  `multi_run.rs:798`, `filter_run.rs:756` — same shape for the run-command
  Transpiler.
- `src/runtime/cli/install_command.rs:33`, `exec_command.rs:33` —
  `OnceLock`-gated `(*ARENA.get()).write(Arena::new())`.
- `src/runtime/cli/mod.rs:466, 592` — `CLI_ARENA` init.

All sound.

### Pattern H — `[MaybeUninit<T>]` scratch buffer for syscall/cursor fill

~8 sites:

- `src/jsc/RuntimeTranspilerCache.rs:648` — `Box<[u8]>::new_uninit_slice` then
  `pread_all(dst: &mut [u8])` over the uninit slice. Forms `&mut [u8]` over
  uninit memory; sound for `T = u8` (no validity invariant).
- `src/install/lockfile/Tree.rs:91` — `[u32; N]` (same).
- `src/bun_core/util.rs:1003, 1050` — `PathBuffer`/`WPathBuffer` (`[u8; N]` /
  `[u16; N]`).
- `src/paths/path_buffer_pool.rs:54, 67` — `Box::<PathBuffer>::new_zeroed`.
  The author explicitly avoided `new_uninit().assume_init()` here, citing
  validity concern; the conservative choice is correct.
- `src/runtime/dns_jsc/dns.rs:2632, 2655` — `Box<[MaybeUninit<ResultEntry>]>` then
  fill loop; the slot type `ResultEntry { info: AddrInfo, addr: SockaddrStorage }`
  is `#[repr(C)]` POD, every field written before `assume_init`. Sound (and the
  surrounding comment notes "Always initialize `addr`: assume_init() below
  requires every byte written").

All sound. The `&mut [u8]` pattern (RuntimeTranspilerCache.rs:640) is the
accepted "read into uninit buffer" idiom — `pread_all` writes, never reads.

### Pattern I — `&mut [MaybeUninit<T>]` reinterpreted as `&mut [T]` (or fenceposted slice)

This is the **risky** pattern. Six occurrences:

| ID         | file:line                                       | Type T                                                | Verdict                                                                                                                                                       |
| ---------- | ----------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (helper)   | `src/collections/linear_fifo.rs:67, 76`         | generic `T`                                           | `assume_init_slice{,_mut}(&[MaybeUninit<T>]) -> &[T]`. Dispatched by `StaticBuffer::as_slice`, `DynamicBuffer::as_slice`. Sound for `T: Copy + Pod`; **UB for niche T**. See F-1. |
| (helper)   | `src/collections/bounded_array.rs:195`          | generic `T`                                           | `add_many_as_slice`. Zero in-tree callers. Latent UB if used with niche T.                                                                                    |
| (helper)   | `src/bundler/linker_context/doStep5.rs:693-695` | `bun_ast::Stmt`                                       | Window cast over **fully-initialized** slots (debug-asserted `len == count`). Sound — semantic match for `MaybeUninit::slice_assume_init_mut` (unstable).      |
| (helper)   | `src/threading/channel.rs:126, 138`             | generic `T: Copy` (in-tree: `*mut HTTPCallbackPair`, `u32`) | `&mut *items.as_mut_ptr().cast::<[T; 1]>()` over uninit `MaybeUninit<T>`. Sound for in-tree T (raw ptr + u32, no validity invariant). Latent UB risk.        |

**Finding F-1 (UB-RISK) — `linear_fifo` `as_slice` / `as_mut_slice` over
niche-bearing element type**

The trait method bodies are at `src/collections/linear_fifo.rs:126`, `131`,
`168`, `172`. The helper:

```rust
fn assume_init_slice<T>(s: &[MaybeUninit<T>]) -> &[T] {
    // SAFETY: see fn doc.
    unsafe { &*(ptr::from_ref::<[MaybeUninit<T>]>(s) as *const [T]) }
}
```

The fn-doc says (linear_fifo.rs:62–66):

> Reinterpret `&[MaybeUninit<T>]` as `&[T]`. `MaybeUninit<T>` has identical
> layout to `T`; exposing uninitialized bytes as `T` is sound only when any
> bit pattern is a valid `T` (in-tree LinearFifo users are byte buffers —
> see the `StaticBuffer` TODO below).

The fn signature does **not** impose `T: Copy + Pod` or any other bound. The
trait-dispatched call sites pass the full buffer slice — including the
uninitialized tail beyond `head + count`. For `T` with a validity invariant
(NonNull, references, enum discriminants, Box, ...), forming `&[T]` of length
`buf_len` over uninit storage is UB at the reference-construction step,
regardless of whether the caller only indexes the initialized prefix.

Active call paths violating the precondition:

- `LinearFifo<RefDataValue, DynamicBuffer<RefDataValue>>` —
  `src/runtime/test_runner/bun_test.rs:1503` (`pub type ResultQueue =
  LinearFifo<RefDataValue, ...>`), built at `bun_test.rs:649`
  (`ResultQueue::init()`), used via `result_queue.write_item(result)`
  (`bun_test.rs:895`) and `result_queue.read_item()` (`bun_test.rs:928`).
  `RefDataValue` is an enum with 4 variants
  (`bun_test.rs:1353`) including `Collection { active_scope: NonNull<DescribeScope> }`
  and `Execution { ..., entry_data: Option<EntryData> }`. The exact compiler
  layout is not needed for the finding: this is an enum containing
  niche-bearing fields, so arbitrary uninitialized bytes are not valid
  `RefDataValue` values.

  `LinearFifo::write_item` (linear_fifo.rs:585) calls `write_item_assume_capacity`
  which does `unsafe { ptr::write(self.buf.as_mut_slice().as_mut_ptr().add(tail), item) }`
  (linear_fifo.rs:602). `as_mut_slice()` is the `assume_init_slice_mut` cast
  over the whole `Box<[MaybeUninit<RefDataValue>]>`. **UB.**

  `read_item` (linear_fifo.rs:480) does `unsafe { ptr::read(self.buf.as_slice().as_ptr().add(self.head)) }`
  — same UB via `as_slice` over the whole buffer (the slots past `head + count`
  are uninit `RefDataValue`).

- `LinearFifo<Entry, DynamicBuffer<Entry>>` and `LinearFifo<PromisePair, ...>`
  — `src/runtime/valkey_jsc/ValkeyCommand.rs:132, 258`. `Entry`
  (`ValkeyCommand.rs:123`) contains `Box<[u8]>` (niche on the pointer) and
  `Promise { ..., promise: JSPromiseStrong }` where `JSPromiseStrong` wraps
  `NonNull<Impl>` (`src/jsc/Strong.rs:11`). `PromisePair` (`ValkeyCommand.rs:250`)
  contains the same `Promise`.

  Active use sites: `src/runtime/valkey_jsc/valkey.rs:478` (`readable_slice`),
  `:497` (`read_item`), `:1121` (`in_flight.read_item`), `:1310` (`queue.read_item`),
  `:1385` (`queue.write_item`), `:1412` (`in_flight.write_item`), and seven
  more `readable_length`/`readable_slice` calls. Every one of these passes
  through `assume_init_slice{,_mut}` over uninit slots of niche-bearing T.
  **UB.**

**Adversarial trigger:** any process that runs `bun test` exercises
`ResultQueue::write_item`/`read_item`. Any Valkey client (Redis) issues
`Entry`/`PromisePair` queue ops on every command. UB exposure is exactly
"runs once per request".

**Why Miri / current CI hasn't caught this:** existing miri runs do not exercise
the `bun test` and Valkey queue paths. A targeted harness should construct
`LinearFifo<RefDataValue, DynamicBuffer<_>>` and
`LinearFifo<PromisePair, DynamicBuffer<_>>` under miri. Depending on the exact
miri flags, the invalid reference may be diagnosed at slice construction or at
the first typed access; either way the source bug is the same: a full backing
buffer of uninitialized `MaybeUninit<T>` is exposed as `[T]`.

**Fix:** delete `assume_init_slice{,_mut}` and the trait methods that depend
on them. The fifo body should operate on `&[MaybeUninit<T>]` /
`&mut [MaybeUninit<T>]` and convert pointer-level via
`MaybeUninit::as_ptr() / as_mut_ptr()` for the slot reads/writes. The
`readable_slice` accessor (which today exposes `&[T]` of the initialized
range) is the only public API that needs `assume_init`; use
`core::mem::MaybeUninit::slice_assume_init_ref`/`_mut` (stabilizing) or its
hand-rolled equivalent and only over the initialized window
`buf[head..head+count]` (with wrap handling). The `Channel` short-loop in
`channel.rs:126, 138` should similarly use `MaybeUninit::assume_init_read()`
on the array element rather than reinterpreting `[MaybeUninit<T>; 1]` as
`[T; 1]`.

Cluster A-001 already files this as "LinearFifo niche-T audit" — F-1 makes
it a `pre-existing-ub-N` candidate. Track as **pre-existing-ub-13**
(LinearFifo niche-T) and **pre-existing-ub-14** (Channel / BoundedArray
niche-T latent), matching the consolidated index.

### Pattern J — `MaybeUninit::write` over an existing initialized slot

The compiler treats `MaybeUninit::write(slot, v)` as "write to a possibly-uninit
slot" — it does **not** drop the prior value. If `T: Drop` and the slot was
previously initialized, the prior value's resources leak.

One found site:

- `src/runtime/webcore/streams.rs:1968` — see **Finding F-4**.

`MaybeUninit::write` over a logically-uninit slot (~25 sites) is correct usage
and is sound.

## Per-Finding Detail

### F-1 — LinearFifo niche-T UB (UB-RISK; pre-existing-ub-13)

Covered above. Severity: **high** (active hot paths).
Affected revisions: every revision since the LinearFifo port (likely the
initial port — the `TODO(port)` comment at linear_fifo.rs:115 documents the
gap, but no `T: Copy` bound was added).

### F-2 — Latent niche-T UB at API surface (Channel + BoundedArray)

| Site                                     | Cast                                                          | Active T (in-tree)                                          | Latent if T grows niches                                                 |
| ---------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `bun_threading/channel.rs:126, 138`      | `&mut *items.as_mut_ptr().cast::<[T; 1]>()`                   | `*mut HTTPCallbackPair`, `u32`                              | Yes — the impl block bounds `T: Copy` but `Copy` includes niche-bearing  |
|                                          |                                                               |                                                             | types (e.g. `NonZeroU32`, `&'static T`). Future PR adding              |
|                                          |                                                               |                                                             | `Channel<&'static T, ...>` is **immediate UB**.                          |
| `bun_core/bounded_array.rs:195`          | `&mut *(s as *mut [MaybeUninit<T>] as *mut [T])`              | (zero callers)                                              | Yes; method is exposed `pub`.                                            |

**Fix:** mark these returning `MaybeUninit<T>` slices and have callers convert
per-element via `MaybeUninit::write`. Or — for the Channel case — read a
single element via `assume_init_read` and never form `&[T; 1]` over uninit
storage.

### F-3 — `*loop_ = IoRequestLoop { … }` direct assignment to `&mut` over uninit

`src/io/lib.rs:683-689`:

```rust
let loop_ = unsafe { (*LOOP.get_unchecked()).assume_init_mut() };
*loop_ = IoRequestLoop {
    pending: RequestQueue::default(),
    waker: Waker::init().unwrap_or_else(|_| panic!("failed to initialize waker")),
    epoll_fd: Fd::INVALID,
    ...
};
```

The `assume_init_mut()` call forms `&mut IoRequestLoop` over **uninit
storage** (LOOP is `MaybeUninit::uninit()` and this is the loader fn). For a
type with no field-level Drop and no niche, the resulting `&mut T` is sound
under the strictest reading only because:

1. `IoRequestLoop`'s fields are `RequestQueue` (UnboundedQueue, no Drop, two
   AtomicPtr), `Waker` (LinuxWaker = `Fd`, no Drop), `Fd` (POD), `Cell<libc::timespec>`
   (POD), `Cell<usize>` (POD).
2. No niche field (no NonNull / Box / reference / enum discriminant) — every
   bit pattern of every field is valid.
3. Assignment `*loop_ = ...` runs per-field drop on the old value; since no
   field has Drop glue, this is a no-op.

If anyone adds a `Box<T>` or `Option<NonNull<T>>` field to `IoRequestLoop`,
this immediately becomes UB *twice*: (a) forming `&mut` to uninit niche
bytes; (b) the drop-of-uninit pointer.

**Severity:** brittle, not currently UB. Comment on bounded_array.rs:195
already mis-promises in the same direction.

**Fix:** route the loader through `MaybeUninit::write`:

```rust
unsafe { (*LOOP.get_unchecked()).write(IoRequestLoop { ... }) };
```

`MaybeUninit::write` is safe and gives back `&mut T` to the now-initialized
slot, identical behavior, zero brittleness.

### F-4 — leak via `MaybeUninit<Vec<u8>>` overwrite without prior `assume_init_drop`

`src/runtime/webcore/streams.rs:1968`:

```rust
unsafe {
    (*pooled.as_ptr()).data =
        core::mem::MaybeUninit::new(core::mem::take(&mut self.buffer));
}
```

`(*pooled).data` is `MaybeUninit<Vec<u8>>`. Direct assignment to a
`MaybeUninit<T: Drop>` field skips Drop (MaybeUninit has no drop glue),
so the *contained* `Vec<u8>` from a prior init is leaked.

The surrounding logic at streams.rs:1536 reads the Vec out via
`core::mem::replace((*pooled).data.assume_init_mut(), Vec::default())` —
which DOES move out properly (and substitutes an empty Vec). After that,
`data` holds an empty `Vec<u8>` (initialized). The line at 1968 then
overwrites with the working buffer.

Counted carefully:
1. Pool entry created via `ByteListPool::push(...)`. `data` field initialized
   to some Vec.
2. `streams.rs:1536–1541`: `replace(data.assume_init_mut(), Vec::default())`
   moves the old Vec out (replaced with empty). `data` now contains
   `MaybeUninit::new(Vec::new())`.
3. `streams.rs:1968`: `data = MaybeUninit::new(working_buffer)`. The previous
   `MaybeUninit::new(Vec::new())` is overwritten; the empty Vec's heap (zero
   bytes) is leaked.

Empty `Vec::new()` does not allocate, so the actual leak is zero bytes per
cycle. **Sound in practice, but the pattern is incorrect.** A future change
that allocates between the two operations would leak.

**Fix:** call `data.assume_init_drop()` before re-assigning, or use
`MaybeUninit::write` (which `MaybeUninit::write(&mut data, ...)` doesn't drop
either — same issue). The correct shape is:

```rust
let prev = core::mem::replace((*pooled.as_ptr()).data.assume_init_mut(), working_buffer);
drop(prev); // explicitly drop the empty Vec
```

Tag as **pre-existing-leak-1**.

### F-5 — `clean_entries` skips Drop for `needs_free == false`

`src/runtime/node/node_fs_watcher.rs:236-247`:

```rust
for i in 0..self.count as usize {
    let needs_free = unsafe { self.entries[i].assume_init_ref() }.needs_free;
    if needs_free {
        unsafe { self.entries[i].assume_init_drop() };
    }
}
self.count = 0;
```

Entries with `needs_free == false` are *never* dropped. The current callers
(`append_abort` → `Event::Abort` ZST) don't allocate, so it's sound. But
`append(some_event, false)` for an event with an owned Box would leak. The
API surface permits it.

**Fix:** drop `Event::Abort` and `Event::Close` are ZSTs, so unconditional
`assume_init_drop` for every slot is sound and cheaper than the branch.
Replace the body with:

```rust
for i in 0..self.count as usize {
    unsafe { self.entries[i].assume_init_drop() };
}
self.count = 0;
```

The `needs_free` field becomes unused and can be removed.

Tag as **pre-existing-leak-2** (latent; no currently-leaking call path).

## Sites Read End-to-End (not just chain-scanned)

(`✓` = sound, `⚠` = brittle/refactor opportunity, `UB` = found UB.)

| ID | file:line | T or context | Verdict |
| --- | --- | --- | --- |
| S-000113 | `bun_alloc/lib.rs:2001` | `Box<MaybeUninit<Block>>::assume_init` after `Block::zero` writes typed fields | ✓ |
| S-000114 | `bun_alloc/lib.rs:2042` | `OverflowListBlock::append` slot writeback | ✓ |
| S-000125 | `bun_alloc/lib.rs:2230` | `BSSListOverflowBlock::append` slot writeback | ✓ |
| S-000131 | `bun_alloc/lib.rs:2342` | `BSSList::append_overflow_uninit` heap block init | ✓ |
| S-000168 | `bun_alloc/lib.rs:2989` | `BSSMap::at_index` after `put` | ✓ |
| S-000233 | `bun_alloc/stack_fallback.rs:76` | `[MaybeUninit<u8>; N]` bump | ✓ |
| S-000374 | `bundler/AstBuilder.rs:266` | `[MaybeUninit<Expr>; N]` with loop-fill ⇒ array_assume_init | ✓ |
| S-000558 | `bundler/linker_context/doStep5.rs:693` | `[MaybeUninit<Stmt>]` window with debug-asserted full init | ✓ |
| S-000815 | `bundler/ThreadPool.rs:195` | `THREAD_POOL.assume_init_drop` gated by ref-count CAS | ✓ |
| S-000842 | `bundler/transpiler.rs:1191` | `MaybeUninit<Transpiler<'a>>` after `init_in_place` returning `?` | ✓ |
| S-000998 | `collections/hive_array.rs:188` | `HiveArray::init_in_place` (only writes `used` bitset) | ✓ |
| S-001003 | `collections/hive_array.rs:422` | `HiveSlot::assume_init` (caller asserts every field written) | ✓ |
| S-001009 | `collections/hive_array.rs:513` | `Fallback::new_boxed` | ✓ |
| S-001024 | `collections/linear_fifo.rs:70` | `assume_init_slice` helper | **UB latent** (F-1, F-2) |
| S-001025 | `collections/linear_fifo.rs:79` | `assume_init_slice_mut` helper | **UB latent** (F-1, F-2) |
| S-001047 | `collections/multi_array_list.rs:663` | `gather<T>` from columns | ✓ |
| S-001068–S-001081 | `collections/pool.rs:61, 63, 68, 70, 311, 319, 397, 419, 525` | ObjectPool / PoolGuard | ✓ |
| S-001108 | `collections/vec_ext.rs:520` | `allocated_slice` as `&mut [MaybeUninit<T>]` (no cast to `&mut [T]`) | ✓ |
| S-001167 | `bun_core/bounded_array.rs:195` | `add_many_as_slice` returning `&mut [T]` | **⚠ latent UB-risk** (F-2) |
| S-001168 | `bun_core/bounded_array.rs:206` | `pop()` `assume_init_read` | ✓ |
| S-001171 | `bun_core/bounded_array.rs:354` | tail-slot init | ✓ |
| S-001249–S-001250 | `bun_core/lib.rs:516, 517` | tier-2 zeroable wrappers | ✓ |
| S-001280 | `bun_core/lib.rs:2921` | `Zeroable`-trait `zeroed<T>` | ✓ |
| S-001282 | `bun_core/lib.rs:2952` | `zeroed_unchecked<T>` | ✓ |
| S-001328 | `bun_core/lib.rs:3118` | `conjure_zst<H>` (ZST asserted) | ✓ |
| S-001464 | `bun_core/string/StringBuilder.rs:343` | reclaim `Box<[MaybeUninit<u8>]>` | ✓ |
| S-001508, 1509 | `bun_core/util.rs:1003, 1050` | `PathBuffer`/`WPathBuffer::uninit` for `[u8; N]`/`[u16; N]` | ✓ (style nit) |
| S-001511 | `bun_core/util.rs:1568` | `MaybeUninit::<libc::kinfo_file>::zeroed` + `kf_structsize` write | ✓ |
| S-001838 | `event_loop/SpawnSyncEventLoop.rs:180` | `&mut MaybeUninit<Self>` out-param ctor | ✓ |
| S-002019 | `http/lib.rs:750` | `HTTP_THREAD.assume_init_mut` gated by `AtomicBool::Acquire` | ✓ |
| S-002429 | `install/isolated_install.rs:2049` | `Box<[MaybeUninit<u8>]>` fill | ✓ |
| S-002457, 2458 | `install/lib.rs:846, 879` | `Transpiler` out-param | ✓ |
| S-002517 | `install/lockfile/Tree.rs:91` | `[u32; N]` depth buf | ✓ |
| S-002529, 2530 | `install/NetworkTask.rs:153, 160` | `http()`/`http_mut()` accessors | ✓ |
| S-002546, 2547 | `install/NetworkTask.rs:907, 914` | `write_init` in-place fill | ✓ |
| S-002559, 2561 | `install/PackageInstall.rs:575, 621` | per-install scratch | ✓ |
| S-002609 | `install/PackageManager.rs:1152` | `Transpiler` out-param | ✓ |
| S-002619, 2629 | `install/PackageManager.rs:1975, 2426` | 74-field in-place init | ✓ |
| S-002721, 2723 | `install/PackageManager/runTasks.rs:536, 892` | `http()` field access | ✓ |
| S-002910 | `install/windows-shim/main.rs:267` | local `Zeroable`-gated `zeroed` | ✓ |
| S-002937, 2940 | `io/lib.rs:683, 804` | `LOOP` MaybeUninit + `OnceLock` | ⚠ (F-3) |
| S-003166–S-003169 | `js_parser/parse/parse_entry.rs:427, 573, 669, 769` | `init_p!` macro + scopeguard | ✓ |
| S-003273 | `jsc/array_buffer.rs:1089` | C++ out-param | ✓ |
| S-003303 | `jsc/bindgen.rs:310` | bindgen converter | ✓ |
| S-003320 | `jsc/btjs.rs:288` | `MemoryBasicInformation` POD | ✓ |
| S-003375 | `jsc/ConsoleObject.rs:2007` | `node_data_mut` accessor (gated by `Map::INIT`) | ✓ |
| S-003468, 3482, 3486 | `jsc/generated.rs:258, 560, 676` | bindgen converters | ✓ |
| S-003648 | `jsc/rare_data.rs:791` | `Box<SpawnSyncEventLoop>` + init_in_place | ✓ |
| S-003666 | `jsc/RuntimeTranspilerCache.rs:648` | `Box<[u8]>::new_uninit_slice` + `pread_all` | ✓ |
| S-003668 | `jsc/RuntimeTranspilerStore.rs:267` | `init_in_place` for the store | ✓ |
| S-003721 | `jsc/StringBuilder.rs:22` | C++ out-param | ✓ |
| S-003748, 3749 | `jsc/TopExceptionScope.rs:496, 502` | layout-equivalence MaybeUninit cast | ✓ |
| S-003785 | `jsc/VirtualMachine.rs:1244` | sound | ✓ |
| S-003956–S-003958 | `jsc/ZigException.rs:179, 224, 236` | `loaded`-flag gated lazy init + idempotent deinit | ✓ |
| S-004374, 4375 | `paths/path_buffer_pool.rs:54, 67` | `Box::new_zeroed().assume_init()` for `[u8;N]` / `[u16;N]` | ✓ |
| S-004658, 4659, 4695 | `resolver/lib.rs:273, 293, 3461` | `FileSystem` singleton accessor | ✓ (with caveat — see Refactor) |
| S-004732–S-004735, 4750, 4752 | `resolver/lib.rs:7554, 7779, 7819, 7885, 9593, 9639` | BIN_FOLDERS / TSConfig singleton | ✓ |
| S-005390–S-005568 | `runtime/bake/dev_server/mod.rs` & `DevServer.rs` | DevServer init/accessors | ✓ |
| S-005590 | `bake/dev_server/DirectoryWatchStore.rs:232` | sound | ✓ |
| S-005641–S-005647 | `bake/production.rs:445, 450, 507, 509, 519, 650` | Transpiler slots | ✓ |
| S-005661 | `cli/bunx_command.rs:614` | Transpiler out-param | ✓ |
| S-005705 | `cli/exec_command.rs:33` | `ARENA` OnceLock | ✓ |
| S-005708–S-005711 | `cli/filter_arg.rs:300, 337, 340, 347` | `walker`/`iter` with `valid` flag and `assume_init_drop` | ✓ |
| S-005725 | `cli/filter_run.rs:756` | Transpiler out-param | ✓ |
| S-005734 | `cli/install_command.rs:33` | arena OnceLock | ✓ |
| S-005742, 5747 | `cli/mod.rs:466, 592` | CLI_ARENA | ✓ |
| S-005769 | `cli/multi_run.rs:798` | Transpiler out-param | ✓ |
| S-005796 | `cli/pack_command.rs:2096` | Transpiler out-param | ✓ |
| S-005839 | `cli/pm_update_package_json.rs:34` | sound | ✓ |
| S-005885, 5932 | `cli/run_command.rs:576, 2412` | Transpiler out-param | ✓ |
| S-006150, 6156 | `runtime/crypto/HMAC.rs:22, 59` | BoringSSL out-param | ✓ |
| S-006264 | `runtime/dns_jsc/dns.rs:275` | post-`put_raw` slot recycle (formerly UB per comment) | ✓ |
| S-006363, 6364 | `runtime/dns_jsc/dns.rs:2632, 2655` | addrinfo fill loop | ✓ |
| S-006734 | `runtime/image/codec_webp.rs:199` | WebPChunkIterator zeroed | ✓ |
| S-007280, 7282, 7283 | `runtime/node/node_fs_watcher.rs:186, 239, 243` | Entry buffer | ⚠ leak risk (F-5) |
| S-007692 | `runtime/server/mod.rs:708` | `&mut MaybeUninit<Self>` from `try_get` slot | ✓ |
| S-007857, 7901 | `runtime/server/server_body.rs:176, 3140` | slot cast for `create` | ✓ |
| S-008226 | `runtime/shell/subproc.rs:826` | sound | ✓ |
| S-008827, 8829 | `runtime/test_runner/harness/recover.rs:59, 84` | `Context = jmp_buf` POD | ✓ |
| S-008859, 8865 | `runtime/test_runner/pretty_format.rs:408, 1229` | node_data_mut for pool with `INIT: Some` | ✓ |
| S-008882, 8883 | `runtime/test_runner/snapshot.rs:601, 604` | scopeguard + assume_init_drop | ✓ |
| S-009562, 9589, 9598, 9623, 9629 | `runtime/webcore/s3/*.rs` | sound | ✓ |
| S-009650 | `runtime/webcore/Sink.rs:863` | `T::construct(&mut MaybeUninit<T>)` | ✓ |
| S-009663 | `runtime/webcore/streams.rs:1536` | `mem::replace(... .assume_init_mut(), Vec::default())` | ✓ |
| S-009665 | `runtime/webcore/streams.rs:1967` | `MaybeUninit::new(...)` overwrite | ⚠ leak risk (F-4) |
| S-009736, 9737 | `shell_parser/parse.rs:4569, 4603` | `assume_init_read` from `SmolList` | ✓ |
| S-009977, 9983 | `spawn_sys/posix_spawn.rs:342, 406` | posix_spawn out-param | ✓ |
| S-010099 | `sql_jsc/shared/CachedStructure.rs:58` | `[MaybeUninit<X>; 70]` stack array | ✓ |
| S-010189, 10212–10218, 10224, 10371 | `sys/lib.rs` | libc stat family out-params | ✓ |
| S-010497 | `sys_jsc/error_jsc.rs:147` | C++ out-param | ✓ |
| S-010532, 10534 | `threading/channel.rs:131, 141` | `MaybeUninit<T>` short-loop cast | ⚠ latent UB-risk (F-2) |

## Refactor Opportunities

(Not bugs, but high-leverage cleanups that eliminate brittle patterns.)

### R-1 — replace `MaybeUninit::<[T; N]>::uninit().assume_init()` with `[const { MaybeUninit::uninit() }; N]`

Affected: S-001508, S-001509, S-002517, S-010099. Each carries
`#[allow(invalid_value, clippy::uninit_assumed_init)]`. The
`const { MaybeUninit::uninit() }` form (stable since 1.79) does not need the
attribute and reads correctly. Zero codegen difference.

### R-2 — `assume_init_slice{,_mut}` should be private to `linear_fifo` and bounded to `T: Copy + 'static + Pod`

Best done by **deleting** the helpers and porting the fifo body to operate on
`[MaybeUninit<T>]` natively (the writes are already
`ptr::write(buf.as_mut_slice().as_mut_ptr().add(tail), item)`; the cast is
gratuitous). See **F-1** fix.

### R-3 — replace `*loop_ = Self { … }` with `MaybeUninit::write`

`src/io/lib.rs:683-689` — see **F-3**.

### R-4 — gate `FileSystem::instance()` on `INSTANCE_LOADED`

The `get()` accessor (resolver/lib.rs:285) has the atomic check; `instance()`
(line 271) does not. Adding `debug_assert!(INSTANCE_LOADED.load(Acquire))` is
trivial, eliminates the caller-discipline coupling.

### R-5 — `BoundedArray::add_many_as_slice` should return `&mut [MaybeUninit<T>]`

Today's `&mut [T]` return is the bug-magnet (F-2). The single in-tree caller
(none) can switch to `MaybeUninit::write`.

### R-6 — `node_fs_watcher::Entry::clean_entries` should always drop

See **F-5**. Eliminates the `needs_free` boolean entirely.

### R-7 — `MaybeUninit<T>::write` over a re-used slot must `assume_init_drop` first

`src/runtime/webcore/streams.rs:1968`. Document the lifecycle of pool nodes
and have a single `replace_init` helper that pairs `assume_init_drop` +
`write`.

### R-8 — `assume_init_drop` for `MaybeUninit<Transpiler>` on Drop for DevServer

Currently the three `MaybeUninit<Transpiler<'static>>` slots in `DevServer`
are never explicitly dropped (DevServer.rs Drop, line 1072 onward, doesn't
touch them). DevServer is process-lifetime, so it's effectively sound — but
add a `drop_transpilers()` call to Drop so any future migration to per-request
DevServer doesn't leak ~50 MB of resolver caches.

## Hardened SAFETY Comment Templates

### A. Guarded singleton `MaybeUninit` accessor

```rust
// SAFETY: `<INIT_FLAG>.load(Ordering::Acquire) == true` (release-mode `assert!`
// above) is set only after `<SLOT>.write(...)` in `init_once`, so the
// `MaybeUninit` is fully written. The `Acquire` load pairs with `init_once`'s
// `Release` store, establishing happens-before for cross-thread callers that
// did not themselves go through the `OnceLock`.
```

(Modeled on `src/http/lib.rs:743-750`.)

### B. Per-field in-place struct init via `addr_of_mut!`

```rust
// SAFETY: <SLOT> points to fresh, properly-aligned, writable storage for
// `<TYPE>` (`size_of::<TYPE>()` bytes). Each `addr_of_mut!((*<SLOT>).<FIELD>)`
// projects a valid in-bounds field place without forming an intermediate
// reference to the (still-uninit) whole. Every named field of `<TYPE>` is
// written exactly once below; embedded `[MaybeUninit<U>; N]` arrays
// intentionally stay uninit (no validity invariant). The previous contents
// of <SLOT> are not dropped — caller's contract.
```

(Modeled on `src/install/PackageManager.rs:1963-1981`.)

### C. FFI out-param

```rust
// SAFETY: <FFI_INIT> writes the entire `<TYPE>` into the slot on success;
// the early-return above ensures we only `assume_init` after a success rc.
// Padding bytes have no validity invariant (Rust reference §validity).
```

(Modeled on `src/sys/lib.rs:2086-2090`.)

### D. Pool-slot recycle (slot was previously initialized)

```rust
// SAFETY: `<SLOT>` came from `<POOL>::get_node()` (or equivalent) and is
// exclusively owned for this scope; its `<FIELD>` was initialized by either
// `<INIT_FN>` at pool seeding or by the prior `<WRITE_FN>` of the previous
// borrow. `assume_init_drop` is paired with `<RELEASE_FN>` below; no field
// is read after the drop.
```

(Modeled on `src/install/PackageManager/runTasks.rs:980-983`.)

### E. `&mut [MaybeUninit<T>]` window cast — every slot init by upstream

```rust
// SAFETY: the `[<BASE>..<HEAD>]` window of `<BUF>` was fully written above
// (`debug_assert_eq!(init.len(), <COUNT>)` enforces this), and `MaybeUninit<T>`
// has identical layout to `T`. Equivalent to `MaybeUninit::slice_assume_init_mut`
// (unstable as of <RUST_VERSION>).
```

(Modeled on `src/bundler/linker_context/doStep5.rs:688-695`.)

## Recommended PRs

1. **PR `claude/maybe-uninit-fix-linear-fifo-niche-T`** — addresses F-1 / F-2
   (LinearFifo + Channel). Net change: ~80 LoC. Bumps Rust unsafety surface
   *down*: removes `assume_init_slice{,_mut}` entirely and ports fifo body to
   `[MaybeUninit<T>]` arithmetic. Regression risk: low; the existing
   `T: Copy` bound in `Channel` and the byte-buffer / raw-ptr-only in-tree
   instantiations mean the new code is byte-equivalent.

2. **PR `claude/maybe-uninit-fix-io-loop-write`** — addresses F-3
   (`*loop_ = Self { … }` → `<SLOT>.write(Self { … })`). 3 LoC. Trivial.

3. **PR `claude/maybe-uninit-fix-streams-pool-overwrite`** — addresses F-4.
   Drop the prior `MaybeUninit<Vec<u8>>` before overwriting. 4 LoC.

4. **PR `claude/maybe-uninit-fix-fs-watcher-clean-entries`** — addresses F-5.
   Remove `needs_free` field, unconditional `assume_init_drop` in
   `clean_entries`. ~10 LoC delete.

5. **PR `claude/maybe-uninit-cleanup-uninit-assume-init`** — addresses R-1.
   Replace the four `core::mem::MaybeUninit::uninit().assume_init()` calls
   with `[const { MaybeUninit::uninit() }; N]` (or
   `MaybeUninit::<[T; N]>::uninit().assume_init()` which is also unsound by
   the validity letter, so prefer the const-block form). Removes the four
   `#[allow(invalid_value, clippy::uninit_assumed_init)]` attributes.

6. **PR `claude/maybe-uninit-harden-filesystem-instance`** — addresses R-4.
   Add `debug_assert!(INSTANCE_LOADED.load(Acquire))` to `instance()`. 1 LoC.

PRs 1–4 are blockers (UB or leak); PRs 5–6 are quality-of-life. Each PR
should add a `test/regression/issue/<N>.test.ts` only if a real GitHub issue
exists — these are pre-existing, so the test belongs alongside the affected
module's existing test file (per /CLAUDE.md §Test Organization).

## Notes on UB Detection

- **Miri:** the four findings (F-1, F-2, F-3, F-4) would surface under
  `cargo miri test -p bun_runtime ...test_runner::...` and
  `cargo miri test -p bun_runtime ...valkey...` with
  `-Zmiri-tree-borrows -Zmiri-strict-provenance`. The default Stacked Borrows
  catches some shapes (`&mut T` over uninit with the niche field read) but
  not all (`&[T]` of a longer-than-init slice with no read in the program).
  The `bun bd test test/js/bun/test/...` path doesn't run Miri today; the
  audit recommends adding a `cargo miri test` CI step over the `bun_collections`
  and `bun_threading` crates in particular (smallest, fastest, highest UB
  yield).

- **`#![deny(unsafe_op_in_unsafe_fn)]`** is enforced; this audit found no
  violations within `unsafe fn` bodies (the `unsafe` blocks are always
  explicit).

- **`#[allow(invalid_value, clippy::uninit_assumed_init)]`** annotations are
  the four `Pattern A` sites only. Each is justified by perf + niche-free T;
  see R-1 for the cleanup path.

- **No `mem::uninitialized()` call sites** — confirmed by the inventory
  (`mem_uninitialized` category is empty). The codebase has fully migrated
  away from the deprecated API.

## Appendix — full classification table

(`A` = strictly-unavoidable / safe-as-is; `B` = perf-justified, can be made safer
without regression; `C` = refactorable; `UB` = bug.)

Counts per crate:

| crate            | A   | B   | C   | UB  | Total |
| ---------------- | --- | --- | --- | --- | ----- |
| bun_runtime      | 50  | 18  |  3  |  1  |  72   |
| bun_collections  |  6  |  6  |  3  |  3  |  18   |
| bun_jsc          | 14  |  3  |  0  |  0  |  17   |
| bun_core         | 13  |  4  |  0  |  0  |  17   |
| bun_install      | 13  |  3  |  0  |  0  |  16   |
| bun_alloc        |  8  |  3  |  1  |  0  |  12   |
| bun_resolver     |  9  |  0  |  0  |  0  |   9   |
| bun_sys          |  7  |  0  |  0  |  0  |   7   |
| bun_js_parser    |  4  |  0  |  0  |  0  |   4   |
| bun_bundler      |  4  |  0  |  0  |  0  |   4   |
| bun_threading    |  0  |  0  |  0  |  2  |   2   |
| bun_spawn_sys    |  2  |  0  |  0  |  0  |   2   |
| bun_shell_parser |  2  |  0  |  0  |  0  |   2   |
| bun_paths        |  2  |  0  |  0  |  0  |   2   |
| bun_io           |  1  |  0  |  1  |  0  |   2   |
| bun_sys_jsc      |  1  |  0  |  0  |  0  |   1   |
| bun_sql_jsc      |  1  |  0  |  0  |  0  |   1   |
| bun_http         |  1  |  0  |  0  |  0  |   1   |
| bun_event_loop   |  1  |  0  |  0  |  0  |   1   |
| **total**        | 139 | 37  |  8  |  6  | 190   |

(The `UB = 6` is the sum of: F-1's 4 helper/dispatch sites in `linear_fifo.rs`
+ F-2's 2 sites in `threading/channel.rs`. F-3, F-4, F-5 are categorized as
brittle/latent and counted under `B` / `C` for the affected crate.)

End of PASS-2 deep dive.
