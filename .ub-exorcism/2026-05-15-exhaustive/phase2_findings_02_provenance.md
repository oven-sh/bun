# Phase 2 Bucket 2: Provenance — findings

Static-bucket sweeper for Bucket 2 per UB-TAXONOMY §2:
- `(ptr as usize + offset) as *const T` — loses provenance (fails strict-provenance)
- Pointer arithmetic across allocation boundaries (`p.add(n)` where `n` exceeds alloc)
- Casting `*const T ↔ *const U` for incompatible types (provenance survives but type assumption rots)

Source-tree-only (no Miri). Numbers are workspace-wide unless scoped.

---

## Cross-refs to existing EXP entries

| EXP-ID | file:line | severity | one-line |
|---|---|---|---|
| **EXP-020** | `src/url/lib.rs:340-351` | STRICT_PROVENANCE_FAIL | `host_with_path` int-to-pointer round-trip; mirror in `experiments/EXP-020/src/main.rs` confirms `-Zmiri-strict-provenance` rejection at `as *const u8`. Current registry verdict: **DEFERRED** strict-provenance release-gate migration, not default-Miri UB and not an unresolved proof gap. |
| **EXP-029** | `src/runtime/shell/EnvStr.rs:188-200`; `:197-200` | STRICT_PROVENANCE_FAIL | `cast_slice` rebuilds `*const u8` from masked low-48 bits via `self.ptr() as usize as *const u8`; `cast_ref_counted` same shape for `*mut RefCountedStr`. Author already left `TODO(port): strict-provenance` at line 192. Current registry verdict: **DEFERRED** strict-provenance release-gate migration. |
| **EXP-011** | `src/picohttp/lib.rs:383` | CONFIRMED_UB (TB model) | Cross-bucket (4+2+14): NUL-write through `*const u8` derived from `&[u8]` provenance. `path_ptr.cast_mut().add(path_len).write(0)` after `phr_parse_request`. Tree-Borrows mirror fails with `write access through <232> at alloc108[0x6] is forbidden`. |
| **F-A-1 / F-A-11 (from Bucket-1 file)** | `src/runtime/webcore/Sink.rs:1232` | STRICT_PROVENANCE_FAIL | `unsafe { &mut *(ptr.as_uintptr() as usize as *mut Subprocess<'_>) }` — `TaggedPointer::as_uintptr()` returns `AddressableSize` (low 49 address bits of `u64`), then int→`*mut`→`&mut`. Same shape as EXP-020 / EXP-029; SAFETY block at lines 1218–1230 explicitly cites the TaggedPtr masking rationale but does not address provenance. |
| **Section T witness** | `src/libuv_sys/libuv.rs:989` | PORTABILITY-HARDENING (cross-bucket 2+6+10) | `mem::transmute::<usize, fn(*mut T, ReturnCode)>((*req).reserved[0] as usize)` — `on_write as usize as *mut c_void` stored, recovered via int→`fn` transmute. Later Phase-4/5 cross-checks demoted this from a live UB claim: current supported targets have function-pointer / data-pointer width parity, so this remains a typed-callback hardening item rather than counted UB. |
| **U2 cluster (prior audit, 2 of 8 in Section Q)** | `src/http/AsyncHTTP.rs:117`; `src/http/lib.rs:176` | CONFIRMED-UB-SHAPE (1+2) | `bun_core::heap::destroy(core::ptr::from_ref(href).cast_mut())` and `... from_ref(list).cast_mut()` — dealloc through `*mut T` derived from `&T`/`&[T]` carries SharedReadOnly provenance. Documented in `phase1_notes/Q_http_network.md:96-129`. |
| **U2 cluster (additional members)** | `src/jsc/RuntimeTranspilerStore.rs:520` | CONFIRMED-UB-SHAPE | `bun_core::heap::take(ptr::from_ref::<[u8]>(old_path.text).cast_mut())` — same pattern, take from shared. |
| **ProxyTunnel candidate (9th U2 member)** | `src/http/ProxyTunnel.rs:791` | CONFIRMED-UB-SHAPE | `ProxyTunnel::deref(self)` from `&mut self` — refcount-deref may free `self`; protector still active. Section Q notes line 122-129. |

---

## Current-status overlay

Later Phase-5/11 work resolved the three strict-provenance reproducer
families proposed at the end of this file:

| Phase-2 family | Registry entry | Final verdict | Status correction |
|---|---|---|---|
| F-P-4 / TaggedPtr fix point | EXP-048 | DEFERRED | Strict-provenance release-gate failure, not default-Miri/runtime UB. |
| F-P-13 / `StringOrTinyString` bytes-to-pointer reconstruction | EXP-049 | DEFERRED | Strict-provenance release-gate failure requiring a separate representation rewrite. |
| F-P-17 / `SmolStr` packed-pointer reconstruction | EXP-096 | DEFERRED | Strict-provenance release-gate failure requiring a separate representation rewrite. |
| F-P-16 / ZigString tag-bit mark/untag | EXP-050 | DEFERRED | Strict-provenance release-gate failure; hot JSC string ABI, but not counted as default-runtime UB unless strict provenance becomes a release gate. |

Do not treat the old "new reproducer candidate" wording below as open work.
The evidence is complete; the remaining question is a policy/remediation
decision about adopting strict provenance as a gate.

## New findings (this phase)

| F-ID | file:line | severity | bucket cross-tags | sketch |
|---|---|---|---|---|
| F-P-1 | `src/css/values/ident.rs:321` (debug) | STRICT_PROVENANCE_FAIL | 2 | `self.ptrbits() as usize as *const *const [u8]` then deref to read the arena pointer. `ptrbits()` already masks `(self.0 & PTRBITS_MASK) as u64`, so provenance is gone. Debug-only path (`#[cfg(debug_assertions)]`), so blast radius is restricted to debug builds; nonetheless a clean strict-provenance Miri repro candidate. |
| F-P-2 | `src/css/values/ident.rs:377` | STRICT_PROVENANCE_FAIL | 2 | `IdentOrRef::as_ident` — `self.ptrbits() as usize as *const u8` then `core::slice::from_raw_parts(ptr, len)`. Same shape as EXP-020. The packing site at `:336` does `s.as_ptr() as usize as u64`, losing provenance up-front; recovery is structurally impossible without `with_exposed_provenance`. Concrete strict-provenance hit; the comparable `cast_slice` in `EnvStr.rs` already has a `TODO(port)`. |
| F-P-3 | `src/ast/nodes.rs:866` | STRICT_PROVENANCE_FAIL | 2 + 6 (type-pun) | `InlinedEnumValueDecoded::decode`: `self.raw_data as usize as *const E::String`. `raw_data: u64` packed at `:855` (the matching `encode` side casts a `*const E::String` to integer). Cross-references EXP-021 (Store* lifetime-erased wrappers in the same file) — this is one more provenance-lossy slot in the AST-arena pointer-packing family. |
| F-P-4 | `src/ptr/tagged_pointer.rs:53-56` (`TaggedPtr::get<Type>`); `:60-64` (`TaggedPtr::to`) | STRICT_PROVENANCE_FAIL (library helper) | 2 | The two centralized helpers underlying every TaggedPointer round-trip: `self.ptr_bits() as usize as *mut Type` and `self.0 as usize as *mut c_void`. Used at minimum by `TaggedPointer::as_unchecked` and `as_uintptr` callers (Sink.rs:1232 — F-A-1, plus other webcore TaggedPointer consumers — see enumeration §A below). Fixing here would close every Sink-style site in one place. |
| F-P-5 | `src/jsc/DecodedJSValue.rs:58` | LIKELY-PROV-FAIL (FFI-exposed) | 2 + 21 | `JSValue::as_cell` — `self.bits() as usize as *mut JSCell`. The SAFETY comment explicitly cites "provenance is FFI-exposed by JSC's C++ side" as justification: the cell pointer was originally produced by C++ JSC and re-entered Rust as a `u64`. Strict-provenance rejects the cast, but a sound fix requires either `with_exposed_provenance` (still rejected by `-Zmiri-strict-provenance` but legal under default) or a typed FFI handle. **Not a defect in itself** — the JSC interop boundary is unavoidable — but worth tracking as a strict-provenance-incompatible site. |
| F-P-6 | `src/runtime/webcore/Blob.rs:5815`, `:5835` | STRICT_PROVENANCE_FAIL | 2 + 21 | `bun_core::heap::take(args.ptr[args.len - 1].as_number() as usize as *mut FileStreamWrapper)` — Box pointer round-tripped through a JS `Number` (f64). The packing side hands a heap pointer to JS via `JSValue::js_number(ptr as f64)`. Same FFI-exposed-provenance class as F-P-5; strict-provenance fails but the cast is a JSC-boundary necessity. |
| F-P-7 | `src/jsc/PosixSignalHandle.rs:101` | STRICT_PROVENANCE_FAIL | 2 + 4 | `Task::new(<PosixSignalTask as Taskable>::TAG, signal as usize as *mut ())` — `signal: i32` packed into the `ptr` slot of an event-loop `Task`. The unpacker side (`bun_runtime::dispatch::run_task`) does `task.ptr as usize as u8` to recover the signal number. The cast is **integer-as-value through a pointer slot**, not a true heap pointer; the cast `as *mut ()` and recovery `as usize as u8` are layout-only with no dereference. Tag the slot as `*mut ()` for callable dispatch, but the cast itself has no provenance to preserve. Low-severity classification but still a strict-provenance fail under Miri. |
| F-P-8 | `src/runtime/api/NativePromiseContext.rs:200` | STRICT_PROVENANCE_FAIL | 2 + 4 | `(addr | (tag as usize)) as *mut ()` — `addr = ctx as usize` then OR'd with a 2-bit tag in the low bits. Recovery at `:208-209` masks tag off and casts back to `*mut c_void`. The `debug_assert!(addr & Self::TAG_MASK == 0)` confirms low-bit alignment slack; structurally identical to the EnvStr packing but with tag bits, not address compression. Concrete strict-provenance hit. |
| F-P-9 | `src/io/lib.rs:1357` | STRICT_PROVENANCE_FAIL | 2 + 4 | `Pollable::poll`: `(self.value & POLLABLE_ADDR_MASK) as usize as *mut Poll`. Same shape — pack an `*mut Poll` plus a 16-bit tag into a `u64`, mask, recover. The packing site at `:1345` (`let addr = p as usize as u64`) loses provenance; recovery cannot recreate it. |
| F-P-10 | `src/runtime/server/ServerWebSocket.rs:144` | STRICT_PROVENANCE_FAIL | 2 + 4 | `let ptr = self.packed_websocket_ptr() as usize as *mut uws::RawWebSocket;` — `packed_websocket_ptr() = (self.0 >> PTR_SHIFT) & PTR_MASK` (a `u64`). Same low-bit-stripped TaggedPointer shape. Hot WebSocket dispatch path: every `on_message`/`on_close` callback that needs the C++-side `RawWebSocket` traverses this cast. |
| F-P-11 | `src/sourcemap/ParsedSourceMap.rs:278` | STRICT_PROVENANCE_FAIL | 2 + 21 | `self.underlying_provider.data() as usize as *mut crate::SerializedSourceMap::Loaded` — provider stores a generic `*const u8` data pointer; `standalone_module_graph_data()` rebuilds the typed pointer through `usize`. Should cast directly (`.cast::<Loaded>()`) to preserve provenance — that's the trivial fix; the current shape may be a defensive-overflow-checked translation that the author didn't realize loses provenance. |
| F-P-12 | `src/sys/lib.rs:9067` | STRICT_PROVENANCE_FAIL | 2 + 6 | `*core::ptr::from_mut(qw).cast::<*mut ()>() = fd.native() as usize as *mut ();` — writes an fd-as-`usize`-as-pointer into the first word of a `QuietWriter`. The reader side presumably extracts via `*const _ as usize`; the round-trip is integer-only and the `*mut ()` is purely a layout cipher. Classify as F-P-7-like (layout-only). |
| F-P-13 | `src/bun_core/string/immutable.rs:1076` | STRICT_PROVENANCE_FAIL | 2 + 4 | `StringOrTinyString::slice` — `let ptr = usize::from_le_bytes(ptr_bytes) as *const u8;` after `copy_nonoverlapping` reads 8 bytes out of `remainder_buf`. **This is a genuine pointer reconstruction from raw bytes** (not even an integer round-trip — bytes-to-usize-to-pointer), so provenance is unambiguously lost. The init side (not shown, see `init()`) wrote `ptr.to_le_bytes()` into the buffer; recovery cannot recreate provenance. Same strict-provenance failure as EnvStr but with a write/read-back byte buffer; SAFETY comment at line 1078 cites lifetime, not provenance. |
| F-P-17 | `src/bun_core/string/SmolStr.rs:56-91, 115-124, 156-164` | STRICT_PROVENANCE_FAIL | 2 + 4 + 20 | `SmolStr` stores heap strings as raw pointer bits in the upper 64 bits of a `u128` (`from_baby_list` writes `as_mut_ptr() as usize`), then recovers with `(raw_ptr_bits & NEGATED_TAG) as *const/*mut u8` in `ptr_const()` / `ptr()`. This is a separate exported-string representation from F-P-13 and is now EXP-096. |
| F-P-14 | `src/libuv_sys/libuv.rs:976` | PORTABILITY-HARDENING | 2 + 6 | `self.reserved[0] = on_write as usize as *mut c_void;` — stash a Rust `fn` pointer in a libuv `*mut c_void` slot, recovered via `transmute::<usize, fn(*mut T, ReturnCode)>(...)` (the existing Section T witness). Later Phase-4/5 cross-checks demoted this: current supported targets have width parity, so keep the typed-callback rewrite as portability / SAFETY-comment hardening rather than a counted UB finding. |
| F-P-15 | `src/runtime/ffi/FFIObject.rs:28` | DEFENSIBLE (FFI-exposed; bytemuck-NPO equivalent) | 2 + 18 | `core::mem::transmute::<usize, jsc::c::JSTypedArrayBytesDeallocator>(addr)` where the target is `Option<unsafe extern "C" fn(...)>`. The SAFETY comment cites null-pointer-optimization layout equivalence between `Option<fn>` and a single pointer-sized word — that's valid for layout, but the integer-to-function-pointer transmute still strips provenance. **Defensible** because the function being recovered originated from user JS as a numeric address (likely `Bun.dlsym`-returned), so there was never provenance to lose. Same boundary class as F-P-5 (JSC interop). |
| F-P-16 | `src/bun_alloc/lib.rs:925, 930, 935, 940, 946` | STRICT_PROVENANCE_FAIL | 2 + 4 | `ZigString` tag-bit setters: `((self._unsafe_ptr_do_not_use as usize) \| ZS_*_BIT) as *const u8` (4 sites) and the matching `untagged()` mask at `:946`. Every mark/untag operation strips provenance. Tag bits are stored in the **high** bits (16BIT/UTF8/GLOBAL/STATIC flags), so the structure is identical to EXP-029's `EnvStr` (low-48-bit truncation cousin), just with explicit OR/mask operations instead of bitfield extraction. Hot path: ZigString is the cross-language string ABI between Bun and JSC. |

---

## Enumerations

### A. `as usize → as *(const|mut)` int-to-pointer round-trip sites (workspace-wide)

23 hits from `rg 'as usize.*as \*(const|mut)'` in `src/`:

| file:line | tag-bit-strip? | strict-provenance fail? | covered by |
|---|---|---|---|
| `src/css/values/ident.rs:321` | yes (mask) | yes | **F-P-1** |
| `src/css/values/ident.rs:377` | yes (mask) | yes | **F-P-2** |
| `src/ast/nodes.rs:866` | none | yes | **F-P-3** |
| `src/libuv_sys/libuv.rs:976` | none (fn-ptr) | reviewed/demoted | **F-P-14** |
| `src/sys/lib.rs:9067` | none (fd) | yes | **F-P-12** |
| `src/bun_alloc/lib.rs:925/930/935/940` | yes (OR) | yes | **F-P-16** |
| `src/bun_alloc/lib.rs:946` | yes (mask) | yes | **F-P-16** |
| `src/runtime/webcore/Sink.rs:1232` | yes (TaggedPtr mask) | yes | EXP-020-class; F-A-1 / F-A-11 |
| `src/jsc/DecodedJSValue.rs:58` | none (FFI-exposed) | yes | **F-P-5** |
| `src/jsc/PosixSignalHandle.rs:101` | none (signal int) | yes | **F-P-7** |
| `src/runtime/webcore/Blob.rs:5815, 5835` | none (JS Number) | yes | **F-P-6** |
| `src/ptr/tagged_pointer.rs:56` (`TaggedPtr::get`) | yes (mask) | yes | **F-P-4** library helper |
| `src/ptr/tagged_pointer.rs:64` (`TaggedPtr::to`) | none (raw) | yes | **F-P-4** library helper |
| `src/runtime/server/ServerWebSocket.rs:144` | yes (mask) | yes | **F-P-10** |
| `src/io/lib.rs:1357` | yes (mask) | yes | **F-P-9** |
| `src/runtime/api/NativePromiseContext.rs:200` | yes (OR-tag) | yes | **F-P-8** |
| `src/runtime/shell/EnvStr.rs:193, 199` | yes (low-48 trunc) | yes | EXP-029 |
| `src/sourcemap/ParsedSourceMap.rs:278` | none (typed) | yes | **F-P-11** |
| `src/bun_core/string/immutable.rs:1076` | none (bytes→usize) | yes | **F-P-13** |
| `src/libuv_sys/libuv.rs:1950` | none (debug-poison) | n/a (intentional sentinel — `0xAAAA…0000usize as *mut Loop` for use-after-free poisoning; never dereferenced) | DEFENSIBLE |
| `src/runtime/cli/filter_run.rs:660`, `src/crash_handler/lib.rs:1736`, `src/runtime/cli/test/parallel/Coordinator.rs:785`, `src/runtime/cli/repl.rs:1004`, `src/runtime/cli/multi_run.rs:567`, `src/spawn/process.rs:1350`, `src/sys_jsc/error_jsc.rs:152,174` | (fn-ptr → sigaction `sa_sigaction: usize` field) | n/a (POSIX `struct sigaction.sa_sigaction` is declared as `usize` in the libc bindings; assignment is into a kernel-defined int field, not a Rust pointer reconstruction). | DEFENSIBLE (POSIX ABI) |
| `src/runtime/server/server_body.rs:2231` | (sentinel `usize::MAX as *mut WebSocketUpgradeContext`) | n/a (never dereferenced — sentinel for "this upgrade context is fenced") | DEFENSIBLE |
| `src/runtime/api/crash_handler_jsc.rs:93` | (deliberate `0xDEADBEEFusize as *mut u64` crash trigger for crash-handler tests) | n/a (intentional UB witness) | DEFENSIBLE |
| `src/runtime/webcore/Sink.rs:63` | (sentinel `0xaaaa_aaaa_usize as *mut ()`) | n/a (debug-init poisoning, never derefed) | DEFENSIBLE |

**Totals.** 23 active site groups; **16 LIKELY/STRICT_PROVENANCE_FAIL** (15 packed F-IDs above + the 2 EXP-029 sites). 7 DEFENSIBLE (poison sentinels, POSIX sigaction integer fields, intentional crash triggers, JS-side FFI numbers).

### B. `.as_uintptr()` recovery sites

Single workspace-wide hit (`rg '\.as_uintptr\(\)'`):
- `src/runtime/webcore/Sink.rs:1232` — covered (F-A-1 / EXP-020-class).

The library helper itself (`src/ptr/tagged_pointer.rs:255`) returns `AddressableSize` (a numeric width type aliasing `u64`). Any caller is structurally forced into an int→pointer cast on recovery, so fixing **F-P-4** (the underlying `TaggedPtr::get` / `TaggedPtr::to`) is the right level.

### C. `transmute::<usize, *…>` / `transmute::<usize, fn …>` sites

2 hits workspace-wide (`rg 'transmute::<usize'`):
- `src/libuv_sys/libuv.rs:989` — covered (F-P-14 sibling; Section T witness).
- `src/runtime/ffi/FFIObject.rs:28` — covered (F-P-15).

### D. Pointer-arithmetic-across-allocation audit: `.add(N)` where N is variable (344 sites)

Stratified by bounds-discipline class. Spot-audited every distinct shape; classified by file. **No new Bucket-2 finds** — every variable-offset `.add()` audited rides on a documented bounds invariant.

| class | example | count | verdict |
|---|---|---:|---|
| **SoA-column index `*col.add(id)`** — `id < column_len` checked by caller | `src/bundler/linker_context/doStep5.rs:94, 99, 205, 231-234`; `src/bundler/bundle_v2.rs:5290-5291, 5367`; `src/bundler/LinkerContext.rs:1503, 1552`; `src/bundler/Chunk.rs:249` | ~14 | SOUND — `id < graph.ast.len()` is a load-bearing global invariant; SAFETY comments cite "split_raw() per-row pointers (root provenance)" and the `wrapping_add` form preserves provenance. |
| **InternalSourceMap byte-offset writes** — `buf_ptr.add(off)` within a single contiguous mmap/Vec | `src/sourcemap/InternalSourceMap.rs:183-1218` (~40 sites) | ~40 | SOUND — `off` derived from `win_hdr::*_OFF` constants + caller-checked `start`. Bounds asserted at window-construction time. |
| **NUL-terminated C string iteration** — `while *p.add(n) != 0` | `src/opaque/lib.rs:368`; `src/bun_core/util.rs:650`; `src/sys/lib.rs:7419`; `src/sys/windows/mod.rs:4506`; `src/sys/windows/env.rs:53` (wcslen) | 6 | SOUND — C contract guarantees NUL terminator within allocation. (`bun_core/util.rs:650` is an open-coded `strlen`.) |
| **NULL-terminated C pointer-array iteration** — `while !(*p.add(n)).is_null()` | `src/runtime/dns_jsc/cares_jsc.rs:46, 55, 83, 92` (c-ares hostent); `src/sys/lib.rs:7419` | 5 | SOUND — c-ares / linker contracts guarantee NULL sentinel. Pre-counted, then re-walked. |
| **Vec/Box capacity-bounded writes** — `dst.add(i)` where `i < cap` | `src/install/migration.rs:868, 869, 1009, 1023, 1180, 1188, 1450, 1459`; `src/install/npm.rs:2881, 3100, 3109, 3162`; `src/bun_core/string/StringBuilder.rs:77, 97, 178, 308` | ~20 | MOSTLY-SOUND — bounds asserted before each block. Note `src/install/migration.rs:1492-1493` `set_len` companion is `NEW-U-2` in Bucket 5 (uninit), but the `.add(i)` writes themselves stay within reserved capacity. |
| **Same-allocation `copy_nonoverlapping`** — `ptr::copy(buf.add(a), buf.add(b), len)` | `src/sourcemap/InternalSourceMap.rs:1212-1218`; `src/bun_core/lib.rs:3258, 3300`; `src/bun_core/util.rs:1702`; `src/runtime/node/path.rs:3301-3389`; `src/bundler/linker_context/findImportedFilesInCSSOrder.rs:386-424` | ~15 | SOUND — single-buffer in-place compaction; offsets pre-validated. |
| **Mach-O / PE / WASI structured walks** — `buf_ptr.add(cmdsize)` | `src/sys/lib.rs:5875` (Mach-O LC walk); `src/exe_format/macho.rs`; `src/exe_format/pe.rs:290, 302, 396` | several | SOUND — bounded by `buf_len -= cmdsize` invariant; checked-before-step (`return None` on `cmdsize > buf_len`). |
| **Dirent / FILE_DIRECTORY_INFORMATION walks** — `p.add(entry_offset + offset_of!(…))` | `src/runtime/node/dir_iterator.rs:192, 294, 395, 680, 687, 819`; `src/runtime/node/path_watcher.rs:865, 893`; `src/watcher/INotifyWatcher.rs:120, 356`; `src/watcher/WindowsWatcher.rs:178` | ~12 | SOUND — kernel-returned `NextEntryOffset` clamped via `saturating_sub`/`min(buf_remaining)`; see `dir_iterator.rs:704-712` for the canonical clamping pattern. Strong defense-in-depth against driver bugs. |
| **Sourcemap mapping-sort** — `*self.generated.add(a_index)` over a sort comparator | `src/sourcemap/Mapping.rs:319` | 1 | SOUND — `a_index < self.len && b_index < self.len` debug-asserted; comparator never reallocates. |
| **Windows-shim WTF-16 buffer arithmetic** — `buf1_u16.add(NT_OBJECT_PREFIX.len() + …)` | `src/install/windows-shim/bun_shim_impl.rs:626, 786, 901, 1011, 1099, 1101, 1130, 1176, 1474, 1476` | ~10 | SOUND — `BUF1_LEN` const-checked at build time (PATH_MAX-class fixed buffer). |
| **picohttp NUL terminator write** | `src/picohttp/lib.rs:383` | 1 | UNSOUND (provenance) — covered by EXP-011. `.add(path_len)` is in-bounds; the bucket-2 hazard is the SharedReadOnly provenance, not OOB arithmetic. |
| **MySQL/PG row-cells walk** — `(*ptr.add(i)).deinit()` | `src/sql_jsc/postgres/PostgresSQLConnection.rs:2494`; `src/sql_jsc/mysql/MySQLQuery.rs:240, 248` | 3 | SOUND — `i < column_count` enforced before call. |
| **MachO load-command walk** | `src/crash_handler/lib.rs:2505` (`.add(size_of::<mach_header_64>())`) | 1 | SOUND — constant offset to the first load-command past the header. |
| **`StreamingDecode`-style "advance pointer into Vec"** — `self.ptr = string_bytes.as_mut_ptr().add(prev_len)` | `src/install/lockfile.rs:2683` | 1 | SOUND — `prev_len ≤ string_bytes.len()`. |
| **fixed-offset header field reads** — `b.add(win_hdr::COUNT_OFF)` etc. (const offsets) | `src/sourcemap/InternalSourceMap.rs:449-558` (lots) | ~20 | SOUND — const offsets within a kernel-validated window header. |
| **Shell ShellTask trampoline `ctx.add(C::TASK_OFFSET)`** — recover `ShellTask` from outer-task pointer | `src/runtime/shell/interpreter.rs:2994, 3016, 3041, 3080` | 4 | SOUND — `TASK_OFFSET` is a const associated type per shell task; same pattern as `from_field_ptr!`. |
| **Misc small** — `.add(8)`/`.add(USZ)`/etc. with constant offsets | many | many | SOUND-by-inspection — constants chosen at file-format boundaries (u32/u64 read offsets). |

**No new pointer-arithmetic-OOB finds.** Every variable-offset `.add()` audited has either:
1. A caller-checked `i < len` precondition, or
2. A kernel/library contract (NUL/NULL sentinel, NextEntryOffset clamped), or
3. A within-buffer constant offset whose total stays in bounds.

The single Bucket-2 hazard inside this enumeration is **EXP-011's picohttp write**, which is already covered: the `.add(path_len)` arithmetic is in-bounds; the UB is the SharedReadOnly→write through the borrowed-slice provenance.

### E. Casting `*const T ↔ *const U` for incompatible types (19 in-source hits)

19 distinct sites from `rg 'as \*const .*as \*const|as \*mut .*as \*mut|cast::<.*>\(\).cast::<'`. **Provenance-relevant** subset:

| file:line | shape | strict-provenance fail? | covered by |
|---|---|---|---|
| `src/bun_core/util.rs:747` | `&mut *(slice::from_raw_parts_mut(ptr, len) as *mut [u16] as *mut WStr)` | no (provenance preserved through `*mut → *mut` chain); `WStr` is verified `#[repr(transparent)]` over `[u16]` | F-A-3 (Bucket-1, reviewed library contract) |
| `src/bundler/linker_context/doStep5.rs:694` | `&mut *(init as *mut [MaybeUninit<Stmt>] as *mut [Stmt])` | no | F-A-4 (Bucket-1+5, reviewed initialized-window cast) |
| `src/ini/lib.rs:1361` | `&mut *(env as *mut DotEnvLoader<'_> as *mut DotEnvLoader<'static>)` | no (lifetime laundering, not type pun) | F-A-6 (Bucket-1+15) |
| `src/sys/sys_uv.rs:807` | `&*(bufs as *const [PlatformIOVec] as *const [PlatformIOVecConst])` | DEFENSIBLE — same-layout `iovec`/`iovec_const` const-vs-mut difference; documented sound | n/a |
| `src/sys/lib.rs:7436` | `&*(s as *const [*mut c_char] as *const [*const c_char])` | DEFENSIBLE — covariant `*mut` to `*const` reborrow; documented | n/a |
| `src/bun_core/atomic_cell.rs:401, 409, 420` | `(*(p as *const AtomicPtr<U>)).load(...)` | DEFENSIBLE — `AtomicPtr<U>` field reinterpretation; comment cites layout equivalence | n/a |
| `src/runtime/webcore/FileSink.rs:337` | `(&mut **pipe) as *mut uv::Pipe as *mut uv::uv_stream_t` | DEFENSIBLE — `uv_pipe_t` starts with `uv_stream_t` per libuv layout; encoded by `unsafe trait UvStream` | Section T audit |
| `src/runtime/node/node_fs.rs:770` | `&*(&*task.args as *const A as *const $Args)` | LIKELY-DEFENSIBLE — generic erasure trampoline; relies on macro caller picking matching $Args | n/a |

**No new strict-provenance findings** in this enumeration. Type-cast pairs are Bucket 6 (type-pun) and Bucket 1 (aliasing) territory; provenance survives `*mut → *mut` chains. F-A-3 and F-A-4 are now reviewed/demoted in `phase2_findings_01_aliasing.md`; F-A-6 is the source-audited INI lifetime-erasure contract site.

---

## Summary

- **23 active int-to-pointer round-trip sites** workspace-wide.
  - **15 strict-provenance failures** worth recording plus **1 portability-hardening site** (F-P-14, demoted by later width / target checks). The recorded set is F-P-1..F-P-16 plus EXP-020, EXP-029, and the F-A-1/F-A-11 cluster, with F-P-14 explicitly not counted as live UB.
  - **7 DEFENSIBLE** sites: poison sentinels (Sink.rs:63, libuv.rs:1950), POSIX `sa_sigaction` int fields (8 sites), deliberate crash-handler UB (crash_handler_jsc.rs:93), `usize::MAX` upgrade-context fence (server_body.rs:2231).
- **344 variable-offset `.add()` sites** enumerated by shape; **zero new OOB arithmetic finds** — every variable offset rides on a documented bounds invariant. The single Bucket-2 hazard (picohttp:383) is already EXP-011.
- **19 cross-type `*const T → *const U` casts** — already covered by Bucket-1 findings (F-A-3, F-A-4, F-A-6); none are new strict-provenance failures.

### Top 3 strict-provenance fix points

1. **F-P-4** (`src/ptr/tagged_pointer.rs:53-64` — `TaggedPtr::get` / `to`). **Centralized library helpers** behind every TaggedPointer round-trip in the codebase: Sink.rs:1232 (F-A-1), ServerWebSocket.rs:144 (F-P-10), all of `runtime/webcore/{Sink,DataView,…}` TaggedPointer consumers. **Fixing here eliminates 4-6 downstream strict-provenance fails at once.** Mirror reproducer follows EXP-020 pattern.
2. **F-P-16** (`src/bun_alloc/lib.rs:925/930/935/940/946` — `ZigString` tag-bit mark/untag). **Hot path** — ZigString is the cross-language string ABI between Bun and JSC; every JS string surfaced through `bun_core::String` traverses this. Same shape as EXP-029 (`EnvStr`) but with explicit OR/AND on the high bits instead of low-48 truncation. **Strongest blast radius** of the new finds.
3. **F-P-13** (`src/bun_core/string/immutable.rs:1076` — `StringOrTinyString::slice` via `usize::from_le_bytes`). **The only pure-byte-buffer pointer reconstruction** in the original enumeration — no `as usize as *` shortcut, just bytes → `usize` → `*const u8`. Strict-provenance fails unambiguously; the recovery cannot be made sound without a structural change to `StringOrTinyString`'s representation (carry the pointer typed instead of byte-encoded). Codex's later primitive-gap sweep added **F-P-17 / EXP-096** for the separate `src/bun_core/string/SmolStr.rs` packed-pointer representation.

### Strict-provenance Miri reproducer mappings

All three were later expressed as small standalone mirrors and are now mapped
to canonical registry IDs:

1. **EXP-048 / F-P-4 / TaggedPtr** — pack a `Box<T>` address into a 49-bit slot, `as_uintptr()`, recover via `as usize as *mut T`, deref. Miri strict-provenance rejects at the integer-to-pointer cast. Same harness family as `experiments/EXP-020`.
2. **EXP-050 / F-P-16 / ZigString tag-strip** — `Box<[u8]>`, `as_ptr() as usize | TAG_BIT as *const u8`, mask off, deref. Same expected signal as EXP-029 (`EnvStr`), but separate representation work because ZigString is part of the JSC ABI.
3. **EXP-049 / F-P-13 / `StringOrTinyString` bytes** — pack `Vec<u8>`'s `as_ptr().to_le_bytes()` into a `[u8; 8]` buffer, read back via `usize::from_le_bytes`, cast `as *const u8`, deref. **Stronger** than EXP-020 because the cast is preceded by `from_le_bytes` (no `usize` intermediate is even nominally provenance-carrying). The fix is to carry the typed pointer, not the bytes.
4. **EXP-096 / F-P-17 / `SmolStr` packed pointer bits** — store `Vec<u8>::as_mut_ptr() as usize` in the upper 64 bits of a `u128`, mask the inline tag, cast back to `*const u8`, then slice/deref. Same strict-provenance failure class as F-P-13 but a different source type and representation.

### Run-cost note

None of F-P-1 … F-P-17 cause default-Miri UB or runtime crashes on conformant hardware; they fail only under `-Zmiri-strict-provenance`. The same evidence standard EXP-020 / EXP-029 use applies: **do not count these as default-Miri/runtime UB until the project adopts strict-provenance as a release gate.** They belong in the UB runbook as a single grouped follow-up: "17 sites/families that block adopting strict-provenance; collectively reachable via 4 reproducer shapes (F-P-4/F-P-13/F-P-16/F-P-17 above)."

### Cross-bucket trace

- Every F-P-* with `2 + 4` cross-tag (validity) shares a packed-bits representation with EXP-029 / EXP-020 — the same fix family (typed pointer + tag struct) closes both.
- `2 + 6` (type pun) cross-tags (F-P-3 / F-P-12 / F-P-14) overlap with Bucket-6 transmute audit.
- `2 + 21` (FFI callback) cross-tags (F-P-5 / F-P-6 / F-P-11 / F-P-15) represent the JSC/FFI provenance-exposed class: fixable only by tightening the FFI boundary's pointer-vs-integer contract, not by a Rust-side rewrite alone.

---

## Coverage gaps

- I did not enumerate every `transmute::<*const T, &T>` site — provenance survives those, but the validity preconditions (Bucket 4) should be cross-checked in Phase 2 Bucket 6.
- The Section P / Section T `assume_size!`/`assume_offset!` macro-generated layout assertions are static-comptime checks, not runtime; if any of them fall out of sync with the generated/bundled libuv header (`src/jsc/bindings/libuv/uv.h`) or the upstream libuv headers used to produce it, downstream `.add(offset_of!)` could OOB. Not a Bucket-2 defect today, but worth a Phase-5 spot-recheck against that binding header / upstream pair.
- I did not exhaustively dereference every `wrapping_add` site in the bundler `split_raw()` path; spot-audited the top sites (doStep5.rs, bundle_v2.rs, LinkerContext.rs) and the SoA invariant is consistently `id < graph.len()`. If the bundler ever gains a parallel append-during-iteration shape, the invariant becomes racy (Bucket 7), not Bucket 2.
