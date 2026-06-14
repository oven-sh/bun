# Section A: runtime-webcore

## Purpose (1 paragraph)
`src/runtime/webcore/` is the Bun runtime's JS-visible Web-API surface — the
implementations of `Blob`/`File`/`Body`/`Request`/`Response`/`FormData`,
`ReadableStream` + its sources/sinks (`ArrayBufferSink`, `FileSink`,
`ByteBlobLoader`, `ByteStream`, `ResumableSink`), `fetch` and its tasklet,
`TextEncoder`/`TextDecoder` and the WHATWG-encoding decode pipeline, the S3
client family (`S3Client`, `S3File`, `s3/*`), Web Crypto, prompt, cookie map,
object-URL registry and WebAssembly streaming. Almost every file is a `.rs`
port of an adjacent `.zig` reference (still on disk, not compiled) and the
unsafe surface here is dominated by two patterns: (1) JSC class/finalizer
glue that hands `*mut Self` around through C-ABI callbacks and reaches back
through `bun_core::heap::{take, destroy, into_raw}` to balance refcounts, and
(2) byte-buffer reinterpretation at the boundary between Rust `Vec<u8>`,
JSC external strings, and C-allocated buffers (WebKit `WTFStringImpl`, the
encoding fast path, BoringSSL crypto, libuv pipes). The streaming code adds
real cross-thread state — `Bun.serve` workers, HTTP tasklets and FS readers
all touch `Cell`/`UnsafeCell`-backed parents from re-entrant FFI callbacks.

## Unsafe-surface tally
- unsafe blocks: 571 (prior-audit `kind == unsafe_block`)
- unsafe fns: 31 (prior-audit `kind == unsafe_fn`)
- unsafe impl Send/Sync: 0 (rg `unsafe\s+impl\s+(Send|Sync)` returns zero)
- extern "C" decls: 71 lines (callbacks for JSC/uv/uWS; primarily forward
  declarations of C++ shims defined in `src/jsc/bindings/`)
- transmute calls: 3 (`rg '\btransmute(?:_copy)?\b'`)
- from_raw / from_raw_parts calls: 26 (`Box::from_raw`, `Vec::from_raw_parts`,
  `slice::from_raw_parts*`, `bun_jsc::Strong::from_raw_unchecked`, etc.)
- set_len: 1
- assume_init: 4
- get_unchecked / get_unchecked_mut: 0 / 0
- UnsafeCell direct references: 18 (mostly comment references; 2 actual
  field declarations counted in prior audit as `unsafe_cell_decl`)
- Pin::new_unchecked: 0
- new_unchecked (mostly `NonNull::new_unchecked`): 2
- intrinsics / hint::*_unchecked: 0 / 0
- mem::forget / ManuallyDrop / mem::zeroed / mem::uninitialized: 10 / 7 / 2 / 0
- raw ptr::{read, write, copy, swap, drop_in_place}: 17
- atomic ops (load/store/RMW/swap/compare_exchange): 75 (mostly
  `Cell`/`AtomicU{32,64}` refcount + state flags on stream parents)
- static_assertions / const _ asserts: 3 (`offset_of!(NewSource<T>, context) == 0`
  in `ReadableStream.rs:792-794` — guarantees ptr-cast safety on three
  generic instantiations)
- TOTAL: 604 (exactly matches prior audit; delta = 0)

### SAFETY-comment quality (per Phase-1 inventory classifier)
- PRESENT_STRONG (>40 chars naming invariants): 464 / 604 = 76.8%
- PRESENT_WEAK: 84 / 604 = 13.9%
- MISSING (no `// SAFETY:` reachable from the unsafe site): 56 / 604 = 9.3%

### Macro vs source-direct
- SOURCE_DIRECT: 604 / 604. Every counted site lives in `.rs` source text;
  no unsafe operations are emitted *into* webcore by an in-file
  `macro_rules!` body. The one external macro that drives many files —
  `bun_io::impl_streaming_writer_parent!` (defined in
  `src/io/PipeWriter.rs:2623`, invoked by `FileSink.rs:254`,
  `ResumableSink.rs`, etc.) — expands inside `bun_io`, not into webcore;
  those expansion sites are Section P / I/O's responsibility.

### Bucket distribution (from inventory classifier, multi-tag allowed)
| Bucket | Hits | Description |
|--------|------|-------------|
| 1 — Aliasing | 266 | dominant: `*mut Self` callbacks, `(*this).field`, `&mut *raw` reborrows |
| 13 — Refcount lifecycle | 78 | `bun_core::heap::{take, destroy, into_raw}`, `Strong`/`Weak`, `Box::from_raw` |
| 10 — FFI contracts | 76 | `extern "C"`, libuv, libc, BoringSSL, JSC shims |
| 21 — FFI-callback aliasing | 63 | `on_write`/`on_error`/`on_ready`/`on_close` re-entrant callbacks |
| 2 — Provenance | 28 | `as_uintptr`, `cast::<u8>`, `from_field_ptr!`, raw-ptr offsets |
| 15 — Lifetimes / escape | 24 | `slice::from_raw_parts` over JSC-owned buffers |
| 20 — Dangling Box / allocator pairing | 15 | `Box::from_raw` + `bun_core::heap` allocator round-trips |
| 4 — Validity invariants | 13 | `assume_init`, `NonNull::new_unchecked`, transmutes |
| 5 — Uninit | 9 | `assume_init`, `Cell::get_mut` on freshly-allocated parents |
| 6 — Type punning | 5 | includes the anchored EXP-004 Vec layout reinterpret |
| 3 — Alignment | 2 | `read_unaligned`, the `Vec<u8>→Vec<u16>` cast at encoding.rs:303 |
| 9 — Pin invariants | 2 | (no `Pin::new_unchecked` — tagged via category heuristic only) |
| 11 — Panic safety / forget | 2 | `mem::forget` near JSC finalizers |
| 14, 23 — `*const`→`*mut` mutation | 2 / 2 | a handful of `as *const … as *mut` casts |
| 7 — Data races | 1 (under-counted) | actual atomic-RMW lines: ~75; this column counts only sites whose `unsafe` block itself names an atomic op |
| 0 — unclassified low-risk | 168 | helper unsafe blocks (`Self::destroy(this)`, `(*ptr).value()`, etc.) whose normalized text matches no bucket trigger; many ride on bucket-1 aliasing one layer up |

Buckets 8 (Send/Sync), 16 (volatile), 17 (async drop in unsafe), 18 (inline
asm), 19 (target_feature), 22 (repr(packed) field address), 24 (coherence)
register zero hits in Section A.

## Notable patterns
Cross-referenced against the prior-audit cluster catalog:

- **`*mut Self` callback pattern** — present and dominant. Hot files:
  `FileSink.rs` (52 sites; `pub unsafe fn on_write/on_error/on_ready/on_close`
  all take `this: *mut FileSink` and only reborrow `(*this).field` per
  statement), `ResumableSink.rs` (`pub unsafe fn deref_(this: *mut Self)` at
  line 573), `S3Client.rs`, `blob/{copy,read,write}_file.rs`. The header
  comment at `FileSink.rs:248-253` explicitly documents the `borrow = ptr`
  choice and the no-`&FileSink`-across-reentrant-call invariant. This is the
  Section-A instance of the project-wide ~1,610-site pattern.

- **`bun_core::heap::take`/`destroy`/`into_raw` helpers** — 164 callsites
  across webcore. `Blob.rs` alone has 31 `heap::*` calls. The MISSING-SAFETY
  cluster is densest here: many `unsafe { bun_core::heap::take(...) }`
  one-liners inside JSC finalizers have no SAFETY block at all, relying on
  the finalizer's prose (or the caller's `*mut` contract) instead.

- **`impl_streaming_writer_parent!` macro** — invoked at `FileSink.rs:254`
  and `ResumableSink.rs:609` (the latter via `impl_resumable_sink_js!`). The
  webcore-side invocation is one line; the unsafe code it emits compiles
  into `src/io/PipeWriter.rs` (Section P). The four `pub unsafe fn
  on_{write,error,ready,close}` bodies that the macro *calls* are direct
  source in webcore — those are the 16 `pub unsafe fn ... this: *mut` sites
  I found here.

- **`bun_jsc::Strong`/`Weak` handle discipline** — 72 hits including
  `JSPromiseStrong::init` and the `Strong::create`/`Strong::get` cycle in
  `fetch/FetchTasklet.rs`, `Body.rs`, `Response.rs`, `Request.rs`. The
  canonical cross-thread `String::clone_utf8` workaround documented in
  `src/CLAUDE.md` lives in `fetch/FetchTasklet.rs` near `Response::init`.

- **`Vec<u8>→Vec<u16>` reinterpret** — anchored EXP-004 at
  `encoding.rs:303-310` (see Anchor cross-refs below). Sole instance in
  Section A; the matching `Vec<u16>->Vec<u8>` direction in `streams.rs:2595`
  uses `Vec::from_raw_parts(slice_ptr, len, len)` on an allocator-owned
  slice and is tagged with the same buckets (2, 6, 13, 15).

- **Re-entrant FFI callback patterns** — 63 sites where an `extern "C" fn`
  or a `pub unsafe fn on_*` may free `*this` or run microtasks that reach
  back into the same parent. Header comments at `FileSink.rs:466`,
  `:541`, `:589` and the `// SAFETY(JsCell):` note at `:591` document the
  re-entrancy-safe ordering (`runPending()` → drop GC root → maybe-free).

- **`UnsafeCell`-as-`noalias`-suppressor** — `Body.rs:92`, `ByteStream.rs:339`,
  `FileSink.rs:1675`, `CookieMap.rs:15` and several Blob spots all justify
  manual `UnsafeCell`s by citing the LLVM `noalias` hazard on a `&Parent`
  that a re-entrant FFI callback re-borrows mutably.

- **Constant ABI offset asserts** — `ReadableStream.rs:792-794` uses
  `const _: () = assert!(core::mem::offset_of!(NewSource<T>, context) == 0)`
  for three generic instantiations. These are the only Section-A
  static-assertions; they justify a `*mut NewSource<T>` ↔ `*mut Context`
  ptr-cast inside the source-glue.

## Open questions
- 56 MISSING-SAFETY blocks — should Phase 2 treat all of these as automatic
  `SUSPICIOUS`, or only the ones in buckets 1/13/21? The cluster around
  `unsafe { (*handler).promise.value() }` and `unsafe { webcore::FileSink::deref(sink) }`
  is repetitive and probably *contractually defensible* once the SAFETY is
  hoisted to the surrounding function.
- The 168 bucket-0 ("unclassified-low-risk") rows are a mix of:
  one-line `Self::deref(this)` calls (legitimately low-risk), `(*ptr).value()`
  reads (bucket 1 candidates the heuristic missed), and `unsafe { … }`
  blocks whose inside is itself a safe expression with no UB-producing
  operator (cheap noise the inventory script can't easily disambiguate
  without parsing the macro/method body). A Phase-2 hand-pass over the
  bucket-0 set would either reclassify them or escalate any that turn out
  to involve aliasing.
- Data-races bucket count (1) is misleading — webcore has 75 atomic-RMW
  lines, but most fall *outside* the unsafe block (`Cell::set`, `AtomicU32::load`
  on a struct field). Phase 2's bucket-7 sweeper should sweep these
  separately rather than rely on the per-unsafe-site tagging.
- `streams.rs:2595` uses `Vec::from_raw_parts(slice_ptr, len, len)` on a
  slice whose origin is a JSC-allocated buffer; this is a near-duplicate of
  EXP-004's shape and warrants a Phase-2 confirmation that the allocator
  paired with the eventual `Vec::drop` is the same one that originated the
  pointer (per UB-TAXONOMY bucket 20).

## Anchor cross-refs
- **EXP-004** (miri-confirmed `Vec<u8>→Vec<u16>` allocator-layout
  mismatch): confirmed at `src/runtime/webcore/encoding.rs:303-310`. The
  anchor still matches the prior-audit description exactly. Code around the
  anchor:
  ```rust
  // line 302: SAFETY: input.as_ptr() is at least 1-aligned; Zig asserted u16 alignment via @alignCast.
  // line 303: let as_u16 = unsafe {
  // line 304:     let mut input = core::mem::ManuallyDrop::new(input);
  // line 305:     Vec::from_raw_parts(
  // line 306:         input.as_mut_ptr().cast::<u16>(),
  // line 307:         usable_len / 2,
  // line 308:         input.capacity() / 2,
  // line 309:     )
  // line 310: };
  ```
  The block carries an explicit `TODO(port)` (lines 298-301) that names
  the soundness gap and proposes routing through `bun_core::String`'s
  raw-(ptr,len,cap) accepter as "Phase B". The SAFETY comment is
  intentionally weak — the surrounding prose admits the cast is unsound in
  the general case and is held up only by the matching Zig `@alignCast`
  assertion on the producer side. Phase 5 should re-verify under Miri TB
  + symbolic-alignment-check.
