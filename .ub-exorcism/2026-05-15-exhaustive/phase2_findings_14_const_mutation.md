# Phase 2 Findings — Bucket 14: Mutation Through `*const T`

**Run:** 2026-05-15-exhaustive
**Sweeper:** static-bucket-sweeper Bucket 14
**Date:** 2026-05-16
**Scope:** Every site where `*const T` (or `&T`-derived raw pointer) is cast to `*mut T` and used as a write pointer. Includes manual `Cell`-without-`UnsafeCell` reimplementations.

---

## Method

- `rg -n 'as \*const .* as \*mut'` — explicit double-cast strip-const
- `rg -n '\.cast_mut\(\)'` — modern provenance-aware strip-const (195 occurrences)
- `rg -n 'from_ref\(.*\)\.cast_mut\(\)'` — `&T` → `*mut T` direct chain (23 occurrences)
- `rg -n 'addr_of!.*\.cast_mut\(\)'` — `addr_of!`-via-`&self` strip-const (2 occurrences)
- `rg -n '#\[allow\(invalid_reference_casting\)\]'` — actively-suppressed rustc lint (2 sites)
- `rg -nB1 'cast_mut\(\).*\.write'` — cast+write in one expression (2 sites)

Each hit was triaged for whether the **source pointer** carries write provenance:
1. **CONTRACTUAL** when the `*const T` is a *raw field* whose construction used `&raw mut`/`&raw const` of a `let mut` binding, or when the cast is purely an ABI/signature shape with no actual write through the laundered pointer reaching memory borrowed as `&T`.
2. **SUSPICIOUS / LIKELY-UB** when the cast launders SharedReadOnly provenance (`&self` → `*mut`) and the body writes through it, but a runtime defense exists.
3. **MUST-BE-UB** when there is no runtime defense and Miri Tree Borrows (the strictest production aliasing model) will reject.

---

## Aggregate counts

| Pattern                                          | Hits |
| ------------------------------------------------ | ----:|
| `cast_mut()` total                               |  195 |
| `as *const ... as *mut ...`                      |   23 |
| `from_ref(...).cast_mut()`                       |   23 |
| `addr_of!(...).cast_mut()`                       |    2 |
| `#[allow(invalid_reference_casting)]` sites      |    2 |
| Cast-then-write-in-one-expression                |    2 |

**True `*const T → *mut T → write` UB sites after triage: 6** (excluding EXP-011 / pack_command.rs:3009 / AsyncHTTP.rs:117+http/lib.rs:176 already registered). Later Phase-5/11 work registered and resolved the Bucket-14 top set:

| Phase-2 row | Registry entry | Final verdict |
|---|---|---|
| F14-A / F-A14-A | EXP-041 | CONFIRMED_UB (Tree-Borrows) |
| F14-B / F-A14-B | EXP-042 | CONFIRMED_UB (Tree-Borrows) |
| F14-C / F-A14-C | EXP-043 | CONFIRMED_UB (Tree-Borrows) |
| F14-D / F-A14-D | EXP-075 | CONFIRMED_UB |
| F14-E / F-A14-E | EXP-076 | CONFIRMED_UB |
| F14-F / F-A14-F | EXP-074 | CONFIRMED_UB |

---

## Top 3 confirmed finds (highest severity)

### F14-A — `WebSocketServerContext::active_connections_saturating_{add,sub}` ⇒ **MUST-BE-UB**

**File:** `src/runtime/server/WebSocketServerContext.rs:79-96`

```rust
pub fn active_connections_saturating_add(&self, n: usize) {
    unsafe {
        let p = core::ptr::addr_of!(self.active_connections).cast_mut();
        *p = (*p).saturating_add(n);
    }
}
```

**Why UB:** Classic Bucket-14 textbook violation — `&self` projects into `self.active_connections`, the resulting raw pointer inherits `SharedReadOnly`/frozen-mut-disallowed provenance, and the body writes through it. The TODO comment already names the fix (`Cell<usize>`).

The SAFETY argument ("single-threaded JS heap; addr_of! avoids materializing `&usize`") confuses **bucket 7** (data races) with **bucket 14** (mutation through `*const`). `addr_of!` only avoids the *intermediate* `&usize` reborrow; the parent `&self → &self.active_connections` projection still installs read-only tag along the path. Miri TB rejects regardless of thread count.

**Sibling site:** `subprocess.rs:265`, `Terminal.rs:373`, `cron.rs:1401`, `node_fs_watcher.rs:107`, `node_fs_stat_watcher.rs:550`, `interpreter.rs:894`, `JSTranspiler.rs:1192`, `dns.rs:4017`, `socket_body.rs:347`, `h2_frame_parser.rs:1340` — all `fn as_mut_ptr(&self) -> *mut Self { (self as *const Self).cast_mut() }`. These are dormant landmines: the cast itself does not write, but every caller writing through the returned ptr inherits the SharedReadOnly tag. Lint reachable via Miri once a caller writes.

---

### F14-B — `runtime::cli::repl::vm_mut` ⇒ **MUST-BE-UB** (the canonical anti-pattern)

**File:** `src/runtime/cli/repl.rs:94-101`

```rust
#[allow(invalid_reference_casting)]
fn vm_mut<'a>(vm: &'a VirtualMachine) -> &'a mut VirtualMachine {
    let ptr: *mut VirtualMachine = core::ptr::from_ref(vm).cast_mut();
    unsafe { &mut *ptr }
}
```

**Why UB:** This is exactly the example rustc's `invalid_reference_casting` lint exists to catch. Even with `!Sync`/single-threaded execution, the function hands safe callers a mutable-reference capability derived from a shared reference; Miri Tree Borrows confirms UB when that capability is used for mutation. The single-thread-only argument addresses **bucket 7** (races) but is silent on **bucket 1** (aliasing) and **bucket 14** (const-mut).

Severity higher than F14-A because the cast immediately yields a `&mut T` API surface rather than only a raw pointer; the recorded Miri witness rejects the first write through that forged mutable reference.

---

### F14-C — `runtime::cli::test::Scanner::resolve_dir_for_test` ⇒ **MUST-BE-UB**

**File:** `src/runtime/cli/test/Scanner.rs:255-265`

```rust
let real_fs = core::ptr::from_ref(&self.fs.fs).cast_mut();
#[allow(invalid_reference_casting)]
unsafe { &mut *real_fs }.read_directory_with_iterator(...)
```

**Why UB:** Same as F14-B; the borrow chain is `&mut self → &self.fs (shared reborrow over `&'a FileSystem`) → &self.fs.fs (shared reborrow over `&RealFS`) → from_ref → cast_mut → &mut RealFS`. The `entries_mutex` defense only synchronizes data races, not aliasing tags. Companion site at `Scanner.rs:365` for `Scanner::next(&mut self, ...)` has the same shape (`(&raw const self.fs.fs).cast_mut()`).

---

## Additional new finds (lower severity but worth filing)

| # | File:line | Pattern | Severity |
|---|-----------|---------|----------|
| F14-D | `src/runtime/bake/DevServer.rs:2115 → 3021` | `dev: std::ptr::from_ref(self)` taken from `&mut self`, later written through via `(*self.dev.cast_mut()).deferred_request_pool.put(...)` | **CONFIRMED_UB** — EXP-075 faithful model fires under default Miri and Tree Borrows; fix is `std::ptr::from_mut(self)` / `NonNull::from(self)` to preserve mutable provenance |
| F14-E | `src/runtime/socket/WindowsNamedPipeContext.rs:269-272` | `ptr::from_ref(vm: &'static VM).cast_mut(); (*vm).enqueue_task(...)` | **CONFIRMED_UB** — EXP-076 faithful model fires under default Miri and Tree Borrows; the fix is to stop deriving a mutable VM receiver from a shared `&'static VirtualMachine` backref |
| F14-F | `src/runtime/timer/timer_object_internals.rs:107, 856-869, 970-1021` | `parent_ptr(&self) → from_ref(self).cast_mut()` feeds `event_loop_timer(&self)`, and `set_event_loop_timer_state(&self)` writes plain `EventLoopTimer.state` through the recovered parent pointer | **CONFIRMED_UB** — EXP-074 faithful model fires under default Miri and Tree Borrows; source comment says writes must go through `Cell`/`UnsafeCell`, but `state` is plain |

## Triaged-as-CONTRACTUAL (already defended)

- **`from_ref(self).cast_mut()` used only for refcount FFI** (`bun_ptr::ThreadSafeRefCount::ref_`/`deref`): FetchTasklet.rs:366, webcore_types.rs:997, valkey.rs:1516, BlockList.rs:85, js_valkey.rs:1139, dns.rs:3920. These pass the laundered ptr to a function that only touches an `AtomicUsize` — no real write through the const-derived ptr.
- **MimallocArena.rs:548** — `from_ref(self).cast_mut()` for ABI shape (`StdAllocator.ptr: *mut c_void`); the vtable thunks form `&MimallocArena` and never write through it.
- **Worker.rs cluster** (`Worker.rs:308, 327, 341, 364, 376, 387, 403, 418, 431`) — uses `self.coord.cast_mut()` where `self.coord: *const Coordinator` is a raw field constructed at `runner.rs:255-257` via `&raw const coord` of a `let mut coord` binding. Raw-to-raw cast preserves write provenance.
- **multi_run.rs cluster** (lines 78, 121, 267, 1197) — same shape as Worker.rs (raw field `state: *const State` constructed via `&raw const state` of `let mut state`).
- **ast/symbol.rs:553** — `Map::get(&self) → Vec::as_ptr().cast_mut()`. Documented SAFETY claims Vec's data-ptr field projection preserves write provenance; this is the standard SB/TB-permitted Vec idiom.
- **picohttp/lib.rs:383** — Already EXP-011 (path_ptr cast_mut + NUL write).
- **runtime/cli/pack_command.rs:3009** — Already Section C / PASS5 U1.
- **JSC FFI surface** (`VirtualMachine.rs:3814, 3848, 3914`, `ffi/FFIObject.rs:150, 267`, `valkey_jsc/js_valkey.rs:1118, 1130, 1574`, etc.) — `&JSGlobalObject` cast to `*mut JSGlobalObject` for C++ ABI; the C++ side treats it as interior-mutable. Standard JSC contract; out of scope for Miri (opaque FFI).

## Registry mapping and remediation seeds

1. **EXP-041** — Miri Tree-Borrows witness for `WebSocketServerContext::active_connections_saturating_add` on a non-zero connection count. Fix path: convert the counter field and the 10 sibling `as_mut_ptr(&self)` counter patterns to explicit interior mutability (`AtomicUsize` / `Cell` as appropriate).
2. **EXP-042** — Miri Tree-Borrows / `invalid_reference_casting` witness for `repl::vm_mut`. The lint is currently `#[allow]`'d. Fix path: restore the lint and stop manufacturing `&mut VirtualMachine` from `&VirtualMachine`.
3. **EXP-043** — Miri Tree-Borrows witness for `Scanner::resolve_dir_for_test` / `Scanner::next`. Fix path: route mutation through a real mutable owner or mutex-guarded `RealFS`, not cast-laundering.
4. **EXP-075** — Miri default + Tree-Borrows witness for DevServer's `dev` backref. Fix path is intentionally small: store `std::ptr::from_mut(self)` / `NonNull::from(self)` at construction instead of `std::ptr::from_ref(self)`.

## Cross-bucket links

- **Bucket 1 (Aliasing)** — Every F14-A through F14-F is *also* an aliasing violation; the const-mut framing is the more direct lint.
- **Bucket 23 (Observed type changes)** — None of these write to a `.rodata`/`static` allocation; all targets are heap- or stack-resident `let mut`. Bucket 23 not implicated.
- **Bucket 7 (Data races)** — Several SAFETY comments cite "single-threaded JS heap" as if it discharges Bucket 14. It does not.

---

**EXP-011 status:** CONFIRMED_UB. Picohttp NUL-write demonstrates the kernel; the WebSocketServerContext sites generalise it to interior-mutation counter sites and prove the pattern is not isolated.
