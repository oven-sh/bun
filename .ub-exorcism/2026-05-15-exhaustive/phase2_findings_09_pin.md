# Phase 2 Findings — Bucket 9: Pin Invariants

**Run:** 2026-05-15-exhaustive
**Sweeper:** static-bucket-sweeper Bucket 9
**Date:** 2026-05-16
**Scope:** Every site that constructs a `Pin<T>` (especially `Pin::new_unchecked`), declares `!Unpin` via `PhantomPinned`, or projects through a `Pin<&mut T>`. Verifies the "move-after-pin" invariant is structurally honored.

---

## Method

```
rg -n 'Pin::new_unchecked'              --type rust src/   # 0 hits
rg -n 'Pin::into_inner_unchecked'       --type rust src/   # 1 hit (in a comment)
rg -n 'Pin::as_mut|Pin::get_unchecked_mut|map_unchecked_mut' --type rust src/   # 0 hits
rg -n 'Box::into_pin|Box::pin\('        --type rust src/   # 1 hit (ConsoleObject::init)
rg -n 'core::pin::Pin|std::pin::Pin'    --type rust src/   # 1 hit (ConsoleObject::init signature)
rg -n 'Pin<'                            --type rust src/   # 7 hits (5 comments + 1 sig + 1 doc)
rg -n 'PhantomPinned'                   --type rust src/   # 63 hits (all marker uses)
rg -n '!Unpin|impl !Unpin'              --type rust src/   # 0 active impls
```

Then every non-comment "Pin" occurrence was opened and the surrounding control
flow inspected: was the pinned value ever moved? Was `Pin::into_inner_unchecked`
ever actually called? Did any callback re-enter and mutate through a stale
projection?

---

## Aggregate counts

| Construct                                      | Hits |
| ---------------------------------------------- | ----:|
| `Pin::new_unchecked` calls                     |    0 |
| `Pin::into_inner_unchecked` calls              |    0 |
| `Pin::as_mut` / `get_unchecked_mut` / `map_unchecked_mut` |    0 |
| `Box::into_pin` calls                          |    1 |
| `Pin<Box<T>>` return types                     |    1 |
| `Pin<&mut T>` parameters                       |    0 |
| `impl !Unpin` blocks                           |    0 |
| `PhantomPinned` as a `!Unpin` marker (field)   |   ~60 |

**True Pin-invariant UB candidates: 0.** All comments, marker-only `PhantomPinned` fields, and the lone `Pin<Box<ConsoleObject>>` API are sound by inspection.

---

## Cross-reference to Phase 1 inventories

Confirms Phase 1's per-section claims:

| Section | Phase 1 claim | Phase 2 verdict |
| ------- | ------------- | --------------- |
| A (webcore) | zero Pin (regex false-positive vs `NonNull::new_unchecked`) | Confirmed — no `Pin` token in `src/runtime/webcore/`. |
| D (node) | zero `Pin::new_unchecked`, zero `Pin<T>` | Confirmed. |
| G (bake) | zero Pin sites | Confirmed. |
| B (api) | `filesystem_router` uses `UnsafeCell` + `Vec::from_raw_parts` *instead of* Pin | Confirmed. The only "Pin" string in that file is a comment at `:780` explicitly saying it does NOT use `Pin`/ouroboros. (Phase 2 Bucket 1/2 own that finding — out of scope here.) |
| J (napi/ffi) | no `Pin` in FFI surface | Confirmed. |

---

## The one real Pin site

### F09-A — `ConsoleObject::init` returns `Pin<Box<Self>>` ⇒ **SOUND (dead API)**

**File:** `src/jsc/ConsoleObject.rs:146-174`

```rust
pub fn init(
    error_writer: Output::StreamType,
    writer: Output::StreamType,
) -> core::pin::Pin<Box<ConsoleObject>> {
    let mut out = Box::new(ConsoleObject {
        stderr_buffer: [0; 4096],
        stdout_buffer: [0; 4096],
        error_writer_backing: Output::QuietWriterAdapter::uninit(),
        writer_backing: Output::QuietWriterAdapter::uninit(),
        default_indent: 0,
        counts: Counter::default(),
        _pin: core::marker::PhantomPinned,
    });
    // SAFETY: `out` is heap-allocated at its final address; the adapters
    // store raw pointers into `out.{stderr,stdout}_buffer`, which remain
    // valid for the box's lifetime ...
    let p: *mut ConsoleObject = &raw mut *out;
    unsafe {
        (*p).error_writer_backing = error_writer.quiet_writer()
            .adapt_to_new_api(&mut (*p).stderr_buffer);
        (*p).writer_backing       = writer.quiet_writer()
            .adapt_to_new_api(&mut (*p).stdout_buffer);
    }
    Box::into_pin(out)
}
```

**Why sound:**
1. `Box::new(...)` allocates at a stable heap address before the
   self-referential adapters are wired up. The writes through `p` happen on the
   already-heap-allocated box, so the adapter pointers reference the final
   address, not a stack temporary.
2. `Box::into_pin(out)` for a `!Unpin` payload is the canonical safe
   constructor — no `Pin::new_unchecked` is needed.
3. `ConsoleObject` carries `_pin: PhantomPinned`, so `Unpin` is not auto-derived.
   `Pin<Box<ConsoleObject>>` therefore exposes no safe API that would let the
   caller move the value (no `get_mut`, no `into_inner`).
4. The function comment at `:141` mentions
   `heap::alloc(Pin::into_inner_unchecked(..))`, but **this call site does not
   exist in the tree** (`rg -n 'Pin::into_inner_unchecked'` returns only the
   comment). It is an aspirational/historical note — the *actual* VM caller
   uses `init_in_place`, not `init`.

**Caller reality (`VirtualMachine.rs:2011-2019`):**

```rust
let mut console_box: Box<MaybeUninit<ConsoleObject>> =
    Box::new(MaybeUninit::uninit());
ConsoleObject::init_in_place(&mut console_box, ...);
let console = bun_core::heap::into_raw(console_box).cast::<ConsoleObject>();
```

The `Pin<Box<...>>` API is **unreferenced** — only `init_in_place` (returns
`&mut ConsoleObject`) is wired up. `init` exists as a defensive parallel API.

**Verdict:** Not UB, not even reachable. The Pin invariant is structurally
satisfied (heap allocation + `!Unpin` payload + no safe-move API exposed +
zero callers). Worth a tiny doc fix: either delete the `init` variant or
delete the stale `Pin::into_inner_unchecked` comment that refers to a leak
pattern that does not exist.

---

## `PhantomPinned` ≠ Pin pattern

~60 files use `PhantomPinned` solely as a `!Unpin` marker on **opaque FFI
handles** (Rustonomicon idiom for `extern type` substitutes):

```rust
// e.g. src/uws_sys/WebSocket.rs:14-19
pub struct WebSocket {
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}
```

These types are **never** held by value in Rust — only behind `*mut T` or
`NonNull<T>` from a foreign allocator (uWS/lol-html/BoringSSL/etc.). The
`PhantomPinned` here makes the handle `!Send + !Sync + !Unpin` so that:

- consumers cannot accidentally `mem::swap` two FFI handles by value,
- but no `Pin<...>` wrapper exists in the API surface.

Pin invariants do not apply because the handles never live in Rust storage;
the foreign side owns the address. The opaque-FFI doc-comment at
`src/opaque/lib.rs:27` confirms: *"`PhantomPinned` → `!Unpin`: the foreign
object's address is its identity."*

These 60 sites belong to Bucket 21 (FFI callback aliasing) and Bucket 7
(`Send`/`Sync` markers) for any auditing concerns — they are out of scope for
Bucket 9.

---

## TODO/Phase-B "future Pin" comments

Found exclusively in doc-comments / TODO markers — **no current Pin usage**:

| File | Line | Note |
| ---- | ----:| ---- |
| `src/bundler/bundled_ast.rs` | 19 | Planning note: future `Pin<Box<Bump>>`. |
| `src/event_loop/SpawnSyncEventLoop.rs` | 152 | "Phase B: consider `Pin<&mut Self>`". |
| `src/runtime/cli/filter_arg.rs` | 42, 333 | "Phase B: Pin<Box<Self>> or fold ...". |
| `src/glob/GlobWalker.rs` | 427 | "Phase B may need Pin or raw-ptr slice." |

Each describes a *future* refactor away from `UnsafeCell` + raw-pointer
self-references toward Pin-based safety. The current code does not use Pin
and therefore cannot violate Pin invariants — any soundness concerns belong
to Bucket 1 (aliasing) / Bucket 2 (provenance) for the existing raw-pointer
designs. Phase 1 already flagged `filesystem_router::MatchedRoute` in Section
B as the representative self-referential cluster.

---

## Why Bun structurally avoids Pin

Bun's runtime has **no Rust async** — there are no `Future`s, no `async fn`s
generating self-referential state machines, no `tokio::select!`. The event
loop is libuv-driven; in-flight state crosses C/C++/Rust boundaries as raw
pointers + RAII guards on heap-allocated boxes, with lifecycle managed by
explicit callbacks (close, finalize, GC). The library never has to surface
self-referential generator state to a poll API, which is the canonical place
`Pin::new_unchecked` shows up in idiomatic Rust async code.

The closest analogues are:
- **uWebSockets / lol-html / BoringSSL handles** — opaque FFI structs with
  `PhantomPinned` markers but no `Pin<...>` wrappers (above).
- **`ConsoleObject` buffer-and-writer self-reference** — solved with
  `Box::into_pin` + `init_in_place` (above).
- **filesystem_router self-ref** — solved with `UnsafeCell` + lifetime
  erasure via `Vec::from_raw_parts` (Bucket 1/2; Phase 1 §B).

Verdict: **Bucket 9 is N/A across the workspace.** The single `Pin<Box<T>>`
API surface is sound by construction (`Box::into_pin` + `PhantomPinned`), has
no callers, and exposes no unsafe escape hatch. There are zero
`Pin::new_unchecked` calls anywhere in `src/`. No follow-up beads are warranted.

---

## Recommended (cosmetic) follow-up

Not UB; just hygiene:

1. `src/jsc/ConsoleObject.rs:141` — the `Pin::into_inner_unchecked` comment
   refers to a leak idiom no caller uses. Either delete the `init`
   constructor (preferred — `init_in_place` is the only live path), or
   update the comment to match the actual VM lifecycle (caller leaks via
   `heap::into_raw` of the `Box<MaybeUninit<...>>`, not via
   `Pin::into_inner_unchecked`).
2. The Phase-B TODOs in `filter_arg.rs` / `SpawnSyncEventLoop.rs` /
   `bundled_ast.rs` / `GlobWalker.rs` are best filed as beads against the
   matching Bucket 1/2 findings rather than tracked under Bucket 9, since
   their current implementations use raw pointers (not Pin) and any current
   soundness issues are aliasing/provenance bugs.
