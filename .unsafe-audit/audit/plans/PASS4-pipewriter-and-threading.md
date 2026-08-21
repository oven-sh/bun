# PASS4 — PipeWriter Per-Callsite Review + `bun_threading` Deep Concurrency Audit

Two-part audit:

- **Part 1 — `bun_io` PipeWriter parent vtable per-callsite review.** The macros `impl_streaming_writer_parent!` and `impl_buffered_writer_parent!` (defined in `src/io/PipeWriter.rs:2611` and `:2755`) emit `Posix{Streaming,Buffered}WriterParent` / `Windows{Streaming,Buffered}WriterParent` impls for every parent type that hosts a `bun_io` writer. Pass 3 audited the macro *template* and found it sound. This pass audits every *invocation* and the small set of hand-written sibling impls, against the parent's actual lifecycle.

- **Part 2 — `bun_threading` deep concurrency audit.** Per-primitive review of `channel`, `ThreadPool`, `Mutex`, `RwLock`, `Condition`, `Futex`, `ResetEvent`, `Semaphore`, `WaitGroup`, `guarded`, `unbounded_queue`, and `work_pool`. Focus: data races, drop-while-locked, double-free in panic, atomic-ordering gaps, missing `Send`/`Sync` bounds, intrusive-list discipline.

Site counts (from `.unsafe-audit/unsafe-inventory.jsonl`):

| Crate            | Sites |
| ---------------- | ----- |
| `bun_io`         |   213 |
| `bun_threading`  |   126 |

Methodology: read each target file end-to-end (these crates are small enough), then for each `unsafe impl Send/Sync` and every `borrow = …` choice trace the call graph that justifies (or violates) the SAFETY claim. No emojis. No hedging. Where a callsite is sound I say "CLEAN" with the proof shape; where there is a real soundness gap I tier it T1/T2/T3.

--------------------------------------------------------------------------------

## 0. Executive summary

### Part 1 (PipeWriter cluster) — verdict

The PipeWriter parent-vtable discipline **holds across every callsite reviewed**.
Two parent types are invoked through `impl_streaming_writer_parent!`, two
through `impl_buffered_writer_parent!`, and one (`Terminal`) hand-rolls the
equivalent trait impls. Each callsite's `borrow = mut|shared|ptr` choice
(or equivalent hand-rolled reborrow) matches the parent's actual lifecycle:

| Parent type            | Macro / hand-roll                        | Borrow mode | Re-entrant freeing | Verdict |
| ---------------------- | ---------------------------------------- | ----------- | ------------------ | ------- |
| `FileSink`             | `impl_streaming_writer_parent!`          | `ptr`       | Yes — `heap::take` reachable through `on_close`/`on_error` paths | **CLEAN** (deliberate choice; see `FileSink.rs:233-254` for the full rationale tying the choice to issue #53265) |
| `WindowsNamedPipe`     | `impl_streaming_writer_parent!`          | `mut`       | No — outer `WindowsNamedPipeContext` defers all dealloc to next tick via `enqueue_task` (`WindowsNamedPipeContext.rs:58-62`, `:262-273`) | **CLEAN** |
| `Terminal`             | hand-written `PosixStreamingWriterParent` / `WindowsStreaming*` | `shared`-equivalent (`from_parent_ptr → &Self`) | Yes — `on_writer_close` calls `self.deref_()` which may free `*self` in tail position | **T3 watchlist** — same shape as the bug class FileSink fixed via `borrow = ptr` |
| `ShellIOWriter`        | `impl_buffered_writer_parent!`           | `shared`    | Yes — POSIX `on_write_pollable` may drop the last external `Arc<IOWriter>` mid-callback via `run_yield → bump → child callback` | **T3 watchlist** — author has a TODO acknowledging the gap (`shell/IOWriter.rs:1154-1158`); Windows path is hardened via `win_on_write_guard`, POSIX is not |
| `StaticPipeWriter<P>`  | `impl_buffered_writer_parent!`           | `mut`       | No — `Writable::Buffer(RefPtr<StaticPipeWriter>)` deliberately **leaks** the ref on `*stdin = Writable::Ignore` (RefPtr has no `Drop`, see `ptr/ref_count.rs:770-787`); the writer is never freed mid-callback | **CLEAN** |

There are **zero T1 findings** from the per-callsite PipeWriter review. The two
T3 watchlist items (Terminal, ShellIOWriter on POSIX) describe a shape that
is identical to the bug class that motivated `borrow = ptr` for FileSink. Both
have escape clauses (Terminal's deref is tail-position with no field access
after; ShellIOWriter has `Arc` and the destructor is currently synchronous but
benign in practice). Hardening either to `borrow = ptr` would close the gap;
neither is currently observable. Filed as watchlist.

### Part 2 (`bun_threading`) — verdict

| # | Tier | Finding |
| - | ---- | ------- |
| **TH-1** | **T1 (UB on Windows; abort on Darwin)** | **`GuardedLock<'_, Value, Mutex>` is unconditionally `Send`.** `guarded.rs:132-134` declares `GuardedLock { guarded: &'a GuardedBy<Value, M> }` with no `PhantomData<*const Mutex>` marker. Because `GuardedBy<V: Send, Mutex>: Sync`, `&GuardedBy: Send`, and the guard's auto-`Send` is unblocked. The guard's `Drop` calls `Mutex::unlock()`, which on Windows is documented UB if called from a non-owning thread (`Mutex.rs:248-252` SAFETY comment), and on Darwin aborts (`os_unfair_lock_unlock` precondition). The sibling `crate::mutex::MutexGuard` correctly carries `_not_send: PhantomData<*const Mutex>` (`Mutex.rs:119`); `GuardedLock` is missing that marker. |
| **TH-2** | **T2 (architecture defect)** | **`owned_task!` macro emits unconditional `unsafe impl Send` without `T: Send` bound on generic parameters.** `work_pool.rs:115` (`[$($gen:tt)*]` arm) emits `unsafe impl<$($gen)*> Send for $ty {}` with no `where` clause requiring the generic to be `Send`. The macro's doc explicitly chooses this design and shifts the proof burden to each callsite — but a future generic instantiation with a `!Send` parameter would smuggle non-thread-safe data across worker threads with no compiler check. Codex P3 already flagged this; this review confirms. |
| **TH-3** | T3 watchlist | **`UnboundedQueue<T: Node>` is auto-`Send + Sync` for any `T: Node`.** No `unsafe impl` is needed because the struct's fields are `AtomicPtr<T>` (intrinsically `Send + Sync` for all `T`). The queue stores raw pointers, so this is *type-system-correct*, but a user could push a `*mut !Send` and the queue would happily cross threads with no compile error. Pattern matches the `owned_task!` concern. Mitigation: callers must uphold the `Node` trait's safety contract (`unbounded_queue.rs:48-57`). |
| **TH-4** | T3 watchlist | **`Channel<T, B>: Sync` via `unsafe impl<T: Send, B: LinearFifoBuffer<T>> Sync` (`channel.rs:49`).** Correctly requires `T: Send`, but does not require `B: Send + Sync`. `LinearFifoBuffer<T>` may carry storage that is `!Sync` (e.g. a heap buffer with non-atomic accesses). The buffer is guarded by `Mutex`, so concurrent access is serialized, but if `B` itself contains thread-local invariants the missing bound is a latent footgun. All in-tree buffers (`StaticBuffer<T,N>`, `SliceBuffer<'a,T>`, `DynamicBuffer<T>`) are POD over `T`, so this is not currently observable. |
| **TH-5** | T3 watchlist | **`Mutex::is_held_by_current_thread()` returns `true` unconditionally in release builds (`Mutex.rs:72-81`).** Documented behavior: `debug_assert!(mutex.is_held_by_current_thread())` is a no-op in release. This masks a "caller must hold the lock" contract that would otherwise be caught. Not a soundness issue in itself; the lock-tracking is informational. Marking it for visibility because the `bun_io::Watcher::flush_evictions` and similar use it. |

**Bug count: 1 T1, 1 T2, 3 T3.** No T1 was found inside the PipeWriter cluster.

The threading-primitive ports (Mutex, RwLock, Condition, Futex, ResetEvent,
Semaphore, WaitGroup, ThreadPool) are otherwise faithful translations of the
Zig std and kprotty originals, with the documented orderings preserved and
`unsafe impl Send/Sync` bounds correctly stated where present. The
work-stealing buffer (kprotty/zap) is reviewed and is structurally correct
under the `Release tail` / `Acquire tail` pairing the original spec relies on
(see §6 for the slot-reuse / ABA analysis).

--------------------------------------------------------------------------------

# PART 1 — PipeWriter per-callsite review

## 1.1 The macro contract (recap)

`impl_streaming_writer_parent!` (`src/io/PipeWriter.rs:2611-2745`) and
`impl_buffered_writer_parent!` (`:2755-2885`) emit three (POSIX-streaming +
Windows + Windows-streaming) or three (POSIX-buffered + Windows +
Windows-buffered) trait impls per parent. The `borrow = …` discriminator
expands into one of three boundary forms:

| `borrow = …` | Reborrow at boundary | Required when                                                           |
| ------------ | -------------------- | ----------------------------------------------------------------------- |
| `mut`        | `&mut *this`         | Callback never re-enters JS; nothing frees `*this` mid-call             |
| `shared`     | `&*this`             | Callback may re-enter and observe a fresh `&Self`; aliased `&Self` OK   |
| `ptr`        | `*mut Self` (no ref) | Callback may free `*this`; need full write+dealloc provenance preserved |

For `impl_buffered_writer_parent!`, only `mut` and `shared` are exposed — there
is no `ptr` mode in that macro. The author's discipline is that
`impl_buffered_writer_parent!` is only used by parents whose callbacks never
reach `Box::from_raw` on `*this`. If a buffered-writer parent type ever needs
the freeing-callback guarantee, it must either migrate to the streaming
variant (which has `ptr`) or hand-roll the trait impls.

`impl_streaming_writer_parent!` is invoked at **two** sites in the tree;
`impl_buffered_writer_parent!` at **two** sites; `Terminal` hand-rolls its
trait impls (one streaming + two Windows partner traits). I review each below.

## 1.2 `FileSink` (`runtime/webcore/FileSink.rs:255-268`)

**Macro:** `impl_streaming_writer_parent!`
**Borrow mode:** `ptr`
**Verdict:** **CLEAN.** Deliberately chosen for soundness.

**Lifecycle:**
- Heap-allocated via `bun_core::heap::into_raw` from `FileSink::init`.
- Intrusive `ref_count: Cell<u32>` (via `#[derive(CellRefCounted)]`).
- Owners: JS wrapper (held by `JSSink<FileSink>` via `m_sinkPtr`), the writer (intrinsic +1), and any in-flight `FileSinkRef` RAII guards.
- Destruction: `FileSink::deref` → on count==0 → `Self::deinit` → `bun_core::heap::take(this)` (= `Box::from_raw` → dealloc).

**Re-entrant freeing paths from inside a callback:**
- `on_write` (`:464-536`): calls `FileSink::run_pending(this)` → `pending.run()` resolves a JSPromise → JS-side handlers may release the last external `Strong` ref → `clear_keep_alive_ref` → `FileSink::deref` → dealloc. The function explicitly hoists a `FileSinkRef::new_ref(this)` guard (`:471`) to extend lifetime through the body, but the *macro* boundary still has to cope with this shape before the guard is taken.
- `on_close` (`:589-609`): `clear_keep_alive_ref` at the tail may be the last deref.
- `on_error` (`:541-573`): Windows-only `clear_keep_alive_ref` at tail.

**Why `borrow = ptr` is required:**
- A `&FileSink`-derived `*mut FileSink` carries SharedReadOnly provenance under Stacked Borrows; using it to `Box::from_raw` is UB.
- A `&mut FileSink`-derived `*mut FileSink` carries Unique provenance over the WHOLE allocation (which embeds `writer`). The writer's own `*mut Self` tag would be popped; subsequent IO callbacks would fault on a popped tag.
- The `ptr` mode dispatches as `<Self>::on_write(this, amount, status)` with `this: *mut Self` in scope — no `&Self`/`&mut Self` is materialized at the boundary, preserving full write+dealloc provenance.

The 22-line PORT NOTE at `:233-254` cites the Windows fs-promises test (#53265) and the probe v6 STATE observation (`must_be_kept_alive=true` at deinit) that motivated this choice. This is the canonical R-2 evidence cited by Pass 1's invariants doc.

**Macro arg cross-check:**
- `ref_ = |this| (&*this).ref_()` — `ref_` only touches `ref_count: Cell<u32>` via a shared borrow. Safe.
- `deref = |this| FileSink::deref(this)` — takes `*mut FileSink` (raw). Safe.
- `event_loop = |this| (*this).io_evtloop()` — shared-only read of `event_loop_handle`. Safe.

No mismatch. Pass.

## 1.3 `WindowsNamedPipe` (`runtime/socket/WindowsNamedPipe.rs:1432-1445`)

**Macro:** `impl_streaming_writer_parent!`
**Borrow mode:** `mut`
**Verdict:** **CLEAN.**

**Lifecycle:**
- `WindowsNamedPipe` is an *embedded field* of the heap-allocated `WindowsNamedPipeContext` (`WindowsNamedPipeContext.rs:34-52`). The outer struct has an intrusive `ref_count: Cell<u32>` and is allocated via `bun_core::heap::into_raw`.
- Destruction path: `WindowsNamedPipeContext::deref` (intrusive) → on count==0 → `schedule_deinit(this)` (`:58-62`) → `Self::deinit_in_next_tick(this)` (`:262-273`) → `vm.enqueue_task(Task::init(&mut (*this).task))`. **Deferred to next tick**, not synchronous.
- `WindowsNamedPipe::deref` (the macro hook) calls `(self.handlers.deref_ctx)(self.handlers.ctx)` which is `Self::deref(ctx)` on the OUTER context (`WindowsNamedPipeContext.rs:308`).

**Critical safety property:** because the context's deref is deferred, **the writer's `&mut *this` reborrow at the macro boundary never sees a synchronous free of `*this`**.

The callback body's actions (`WindowsNamedPipe.rs:327-456`) only touch the writer's own fields (`writer`, `incoming`, `flags`, `wrapper`, etc.) — none of which is freed by the deferred deinit during the same call. The WRAPPER_BUSY re-entrancy guard (`:298-309`) further protects against `wrapper = None` rewriting the `Option` discriminant while a raw `*mut WrapperType` into the wrapper is mid-execution.

**Macro arg cross-check:**
- `ref_ = |this| (&mut *this).r#ref()` — `r#ref()` calls `(self.handlers.ref_ctx)(self.handlers.ctx)` which is `rc.set(rc.get()+1)` on the outer context's `Cell<u32>`. The `&mut WindowsNamedPipe` borrow never touches that field (the field lives in the outer struct, not this one), so the `&mut` reborrow is sound for the call's duration.
- `deref = |this| (&mut *this).deref()` — `deref()` calls `Self::deref(ctx)` which decrements the outer context's refcount and may schedule deinit. Crucially: it does not synchronously free, so `&mut *this` remains valid through the call.
- `event_loop = |this| (*this).event_loop_handle.as_event_loop_ctx()` — shared-only read.

The pass-3 watchlist concern (whether `borrow = mut` was correct here) is resolved: the answer is YES, because the outer-context indirection defers all dealloc one tick out. If the indirection were ever removed (or `schedule_deinit` made synchronous), this site would need to migrate to `borrow = ptr`.

No mismatch. Pass.

## 1.4 `StaticPipeWriter<P>` (`spawn/static_pipe_writer.rs:75-90`)

**Macro:** `impl_buffered_writer_parent!`
**Borrow mode:** `mut`
**Verdict:** **CLEAN** — relies on a counterintuitive but correctly-documented RefPtr-leaks-on-overwrite behavior.

**Lifecycle:**
- `StaticPipeWriter<P>` is heap-allocated via `bun_core::heap::into_raw(Box::new(...))` (`:135`).
- Intrusive `RefCount<Self>` from `#[derive(bun_ptr::RefCounted)]` (`:39-42`).
- Sole owner: `Writable::Buffer(RefPtr<StaticPipeWriter<'a>>)` in `Subprocess.stdin` (`api/bun/subprocess/Writable.rs:25`).
- Writer's own intrusive deref (the macro's `deref` hook) is wired to `RefCount::<Self>::deref(this)`.

**Re-entrant freeing path analysis:**
- `on_close(&mut self)` (`:238-248`) calls `P::on_close_io(self.process, StdioKind::Stdin)`.
- `Subprocess::on_close_io(&self, Stdin)` (`runtime/api/bun/subprocess.rs:485-507`) for the `Writable::Buffer` arm:
  ```rust
  Writable::Buffer(buffer) => {
      Writable::buffer_writer_mut(buffer).source.detach();
      *stdin = Writable::Ignore;     // overwrites the variant
  }
  ```
- The reassignment `*stdin = Writable::Ignore` drops the old `Writable::Buffer(RefPtr<...>)`.

**Critical safety property:** `RefPtr` deliberately has **no `Drop` impl** (`ptr/ref_count.rs:770-787`). Dropping a `RefPtr` value LEAKS the strong ref. So `*stdin = Writable::Ignore` does NOT synchronously decrement the writer's refcount, does NOT call `Self::deinit`, does NOT free. The PORT NOTE at `subprocess.rs:502-503` ("Zig's `buffer.deref()` is the owner drop from the assignment below; do not deref explicitly") is misleading — the Zig original DID rely on a drop; the Rust port intentionally leaks. The writer is freed later when the process's actual cleanup path runs `RefCount::<Self>::deref` directly.

**Note:** the leak-by-design here is a *separate* concern (correctness: the
writer may leak across runs), but it is what makes `borrow = mut` sound here.
The macro boundary does NOT see synchronous free of `*this` from inside any
callback, because the only path that would free it (the `Writable::Buffer`
drop) is a no-op.

**Macro arg cross-check:**
- `ref_ / deref = |this| RefCount::<Self>::ref_(this) / deref(this)` — operates on the writer's own intrusive ref. The macro's `WindowsWriterParent::deref` is called from the libuv `uv_close` callback (not from inside our `on_close`), so it doesn't fire mid-callback.
- `get_buffer = |this| &*(*this).buffer.as_ptr()` — `buffer` is a `RawSlice<u8>`; deref of the inner `*const [u8]` is sound under the field invariant ("backing storage outlives self").
- `win_on_write_guard = |_this| ()` — no Windows-specific keepalive needed since the macro's `&mut *this` boundary holds for the whole call and nothing inside frees synchronously.

No mismatch. Pass.

## 1.5 `IOWriter` (Shell) (`runtime/shell/IOWriter.rs:1051-1070`)

**Macro:** `impl_buffered_writer_parent!`
**Borrow mode:** `shared`
**Verdict:** **T3 watchlist.** Correct mode choice; POSIX `on_write_pollable` has a known-but-untriggered keepalive gap.

**Lifecycle:**
- `IOWriter` lives inside `Arc<IOWriter>` (`runtime/shell/IOWriter.rs:262-265`, `:300`).
- Parent backref is `Arc::as_ptr(&this).cast_mut()` (`:311`).
- `set_parent(parent)` stashes the raw pointer in the writer.
- `ref_ = |this| Arc::increment_strong_count(this as *const Self)` — synchronously increments.
- `deref = |this| Arc::decrement_strong_count(this as *const Self)` — synchronously decrements; **may free** if it's the last strong ref. The `IOWriter::drop` (`:1148-1177`) is then run.

**Why `borrow = shared` is correct here:** the body forms `&*this`, all field mutation routes through `state: UnsafeCell<State>` (`:252`), and re-entrant child callbacks may re-enter `enqueue(&self)` and form their own `&Self`. Aliased `&Self` is fine; `&mut Self` would have been wrong.

**The POSIX keepalive gap:**

- `on_error` (`:857-896`) takes `let _keepalive = self.keepalive();` (`:858`). The keepalive is a `Arc::upgrade(&self_weak)` that holds a strong ref through the callback body.
- `on_write_pollable` (`:760-823`) does NOT take a keepalive on POSIX. The macro's `win_on_write_guard = |this| (&*this).keepalive()` (`:1069`) **only fires on Windows**. The POSIX path is exposed.
- Inside `on_write_pollable`, the call `self.run_yield(self.bump(idx))` (`:774`, `:801`) fires `Yield::run` → child callback `on_io_writer_chunk` → child may drop the last external `Arc<IOWriter>` strong ref → `Arc::drop` → `IOWriter::drop` (synchronous!).
- If that happens, `self: &IOWriter` is now dangling. Subsequent reads inside `on_write_pollable` (`let wrote_everything = self.wrote_everything();` `:805`, `let s = self.state();` `:806`) UAF.
- The author has filed a TODO at `:1154-1158` acknowledging this:
  > "if a PipeWriter callback is on the stack when the last Arc drops (possible via re-entrant child deinit), we need the async hop. Revisit once `bun_event_loop::EventLoopTask` is wired."

**Why this is T3 not T1:**
- The shell-side child callback drop pattern requires a specific code path (last external `Arc` held by the child being dropped *synchronously* inside `on_io_writer_chunk`).
- In current shell code, the IOWriter's strong refs are held by the `Interpreter`, which outlives any in-flight chunk. The `Interpreter` does not synchronously drop its `IOWriter` Arc inside a chunk callback in the current shell code path.
- The TODO has not been hit in CI, suggesting it is latent rather than triggered.
- The fix is mechanical (add `let _keepalive = self.keepalive();` to `on_write_pollable` symmetrically with `on_error`), so this can be promoted to T2 with a precommit if the surrounding state is changed in a way that makes the drop reachable.

**Recommendation:** add the keepalive to POSIX `on_write_pollable` now — it costs one `Arc::upgrade` on the hot path. Filed.

## 1.6 `Terminal` (hand-rolled, `runtime/api/bun/Terminal.rs:1948-2008`)

**Pattern:** hand-rolled `PosixStreamingWriterParent` + `WindowsWriterParent` + `WindowsStreamingWriterParent` impls, NOT through the macro. Dispatches via `Self::from_parent_ptr(this)` which forms `&Self` (`:388-397`).

**Equivalent borrow mode:** `shared`.
**Verdict:** **T3 watchlist.** Same shape as the FileSink-#53265 bug class that motivated `borrow = ptr`.

**Lifecycle:**
- Heap-allocated; intrusive `RefCount<Terminal>` (`:103-105`).
- Destruction: `deref_()` → on count==0 → `deinit_and_destroy(this)` (`:1895-1912`) → `bun_core::heap::take(this)` (synchronous `Box::from_raw` + drop).

**Re-entrant freeing path:**
- `on_writer_close` (`:1692-1699`):
  ```rust
  fn on_writer_close(&self) {
      if !self.flags.get().contains(Flags::WRITER_DONE) {
          self.update_flags(|f| f.insert(Flags::WRITER_DONE));
          self.deref_();              // <-- may free *self
      }
  }
  ```
- `self.deref_()` (`:409-416`) calls `RefCount::<Terminal>::deref(self.as_ctx_ptr())`. The doc-comment at `:413-414` says:
  > "Callers must treat `self` as potentially-freed on return (always tail-position in this file)."
- The comment is accurate for **what the body does**: `on_writer_close` accesses no field after the `deref_()` call.
- The risk is the **`&self` reference still in scope** at the `}` of the function. LLVM applies the `dereferenceable(size)` attribute to `&T` parameters, which (per LLVM Lang Ref) means "a pointer that is dereferenceable can be loaded from speculatively". A speculative load of `*self` after the dealloc would UAF; in practice, since no body code accesses `self`, no speculative load is emitted.

**Why this is T3 not T1:**
- The risk depends on LLVM's interpretation of `dereferenceable`. Under strict Stacked Borrows, the reference's `SharedReadOnly` tag stays live until end of scope, but the tag does not require the *allocation* to remain live unless an access is performed.
- The Rust reference says: "A shared reference is alive for its lifetime. Pointed-to memory must be dereferenceable for the lifetime of the reference." This is a STRICTER rule than "no reads happen after dealloc"; under this reading, `on_writer_close` IS UB by the language spec — but it has not been observed to miscompile.
- Comparable issue resolved on `FileSink` by migrating to `borrow = ptr`; same migration would close the gap here.

**Recommendation:** convert `on_writer_close`, `on_writer_error`, `on_writer_ready`, `on_write` to take `this: *mut Self` (matching `FileSink`'s `pub unsafe fn on_write(this: *mut FileSink, …)` shape), and replace the hand-rolled trait impls with `bun_io::impl_streaming_writer_parent! { Terminal; … borrow = ptr, … }`. Filed.

**Other Terminal hand-rolled callbacks for context:**
- `WindowsWriterParent::ref_` / `deref` (`:1980-1990`) correctly do NOT call `from_parent_ptr` — they take the raw `*mut Self` directly with the explicit comment: "do NOT form &Terminal here: this is called from inside writer methods while a &mut self.writer borrow is live".
- `BufferedReaderParent` impls (`:1917-1942`) form `&Self` via `from_parent_ptr`; reader callbacks have the same potential issue but with smaller exposure (reader callbacks rarely free).

## 1.7 PipeWriter cluster — summary table

| Site                                                 | Macro                                | Borrow | Re-entrant free? | Tier |
| ---------------------------------------------------- | ------------------------------------ | ------ | ---------------- | ---- |
| `webcore/FileSink.rs:255`                            | `impl_streaming_writer_parent!`      | `ptr`  | Yes              | OK   |
| `socket/WindowsNamedPipe.rs:1432`                    | `impl_streaming_writer_parent!`      | `mut`  | No (deferred)    | OK   |
| `spawn/static_pipe_writer.rs:75`                     | `impl_buffered_writer_parent!`       | `mut`  | No (RefPtr leaks) | OK  |
| `shell/IOWriter.rs:1051`                             | `impl_buffered_writer_parent!`       | `shared` | Yes (POSIX gap) | T3   |
| `api/bun/Terminal.rs:1948-2008`                      | hand-rolled                          | `&Self`-equiv | Yes (tail dealloc) | T3 |

**Conclusion:** zero T1 findings in the PipeWriter cluster.

--------------------------------------------------------------------------------

# PART 2 — `bun_threading` deep audit

## 2.1 `Mutex` (`Mutex.rs`)

**Files:** `threading/Mutex.rs` (15 KB, 422 lines).

**Backends:**
- POSIX (non-Apple): `FutexImpl` over `AtomicU32`.
- Apple: `DarwinImpl` over `os_unfair_lock`.
- Windows: `WindowsImpl` over `SRWLOCK`.
- Debug: `DebugImpl` wraps a release backend + an `AtomicU64 locking_thread` for deadlock detection.

**Send/Sync claims:**

| Impl                                       | Bound                                | Verdict |
| ------------------------------------------ | ------------------------------------ | ------- |
| `unsafe impl Sync for WindowsImpl` (`:210`) | unconditional                        | OK — SRWLOCK is an OS-managed primitive |
| `unsafe impl Send for WindowsImpl` (`:212`) | unconditional                        | OK |
| `unsafe impl Sync for DarwinImpl` (`:263`)  | unconditional                        | OK |
| `unsafe impl Send for DarwinImpl` (`:265`)  | unconditional                        | OK |
| `FutexImpl`                                 | auto-derived (single `AtomicU32`)    | OK |

`Mutex` itself auto-derives `Send + Sync` because all backends are `Send + Sync`. Fine.

**MutexGuard `!Send` claim:**

```rust
pub struct MutexGuard {
    mutex: bun_ptr::BackRef<Mutex>,
    _not_send: core::marker::PhantomData<*const Mutex>,
}
```

`*const Mutex` is `!Send + !Sync`, so `MutexGuard` is `!Send` via PhantomData. This is **correct** and matches `std::sync::MutexGuard` and `parking_lot::MutexGuard`.

**Subtle concern (T3):** `is_held_by_current_thread()` returns `true` in release (`:78`). Any `debug_assert!(mutex.is_held_by_current_thread())` is a no-op in release — masking caller-contract violations. Documented; informational. **TH-5.**

**No data races:** all critical-section access goes through the OS lock or the futex state machine; `locking_thread` is `AtomicU64` with Relaxed loads/stores (acceptable for diagnostic-only purposes).

**Verdict:** CLEAN (with TH-5 informational watchlist).

## 2.2 `RwLock` (`RwLock.rs`)

**File:** `threading/RwLock.rs` (10 KB, 348 lines).
**Pattern:** port of Zig's `std.Thread.RwLock.DefaultRwLock` wrapped in a `RwLock<T>` data-owning shape.

**State machine:**
- `state: AtomicUsize` packed:
  - bit 0 — IS_WRITING.
  - bits 1..=COUNT_BITS — pending-writer count (WRITER_MASK).
  - bits COUNT_BITS+1.. — active-reader count (READER_MASK).
- All atomic operations use `SeqCst`. Matches Zig spec exactly.

**Send/Sync claims:**

```rust
unsafe impl<T: Send> Send for RwLock<T> {}
unsafe impl<T: Send + Sync> Sync for RwLock<T> {}
```

Identical to `parking_lot::RwLock<T>`. CLEAN.

**Guard `!Send`:**

```rust
pub struct RwLockReadGuard<'a, T> {
    lock: &'a RwLock<T>,
    _not_send: PhantomData<*const ()>,
}
pub struct RwLockWriteGuard<'a, T> { ... _not_send: PhantomData<*const ()> }
```

Both correctly `!Send`. The comment `:240-241` notes "writer guard must be `!Send` (Darwin `os_unfair_lock` requires unlock on locking thread); keeping both `!Send` avoids surprising asymmetry." CLEAN.

**Inline regression test:** `raw_internal_state` (`:340-345`) tests that `state` is restored to 0 after one lock/unlock pair — guards against ziglang #13163 (Zig's bug where WRITER was subtracted instead of cleared). The test is present and exercises the fix.

**Verdict:** CLEAN.

## 2.3 `Condition` (`Condition.rs`)

**File:** 20 KB, 466 lines.
**Pattern:** Port of Zig `std.Thread.Condition`.

**Backends:** Windows (`CONDITION_VARIABLE` + SRWLOCK via `SleepConditionVariableSRW`), POSIX (Futex + `state: AtomicU32` + `epoch: AtomicU32`).

**Critical ordering in `FutexImpl::wait`** (`:335-413`):
- `epoch.load(Acquire)` BEFORE `state.fetch_add(ONE_WAITER, Relaxed)` — the comment at `:336-345` walks through the missed-wakeup hazard if the order is reversed. Correct.

**Critical ordering in `FutexImpl::wake`** (`:415-463`):
- `state.cas(state, state + ONE_SIGNAL, Release, Relaxed)` BEFORE `epoch.fetch_add(1, Release)` BEFORE `Futex::wake`. Comment at `:435-456` walks the missed-wakeup hazard for the reverse order. Correct.

**Send/Sync:**
- WindowsImpl: explicit `unsafe impl Sync for WindowsImpl` (`:223`) and `Send` (`:224`). OK.
- FutexImpl: auto-derived (two `AtomicU32`s).

**Verdict:** CLEAN.

## 2.4 `Futex` (`Futex.rs`)

**File:** 20 KB, ~750 lines including platform impls.
**Backends:** Linux (`SYS_futex`), Darwin (`__ulock_wait2`), FreeBSD (`_umtx_op`), Windows (`RtlWaitOnAddress`), wasm (atomic.wait32).

**Surface:** `wait(ptr: &AtomicU32, expect: u32, timeout)` / `wake(ptr: &AtomicU32, max_waiters)` / `wait_forever`.

**Audit:** every backend wraps a syscall over an `&AtomicU32`; the safety argument is "the caller passes a reference, syscall takes a pointer + size_of::<u32>". Documented per-backend with SAFETY comments. None of the backends materialize a `&T` of an arbitrary `T` through the pointer — they all read 4 bytes via the syscall.

**Verdict:** CLEAN.

## 2.5 `ResetEvent` (`ResetEvent.rs`)

**File:** 4.4 KB, 134 lines.
**Pattern:** Port of `std.Thread.ResetEvent` (Futex-based).

**States:** `UNSET=0`, `WAITING=1`, `IS_SET=2`.

**Orderings:**
- `is_set()`: `state.load(Acquire) == IS_SET` — Acquire synchronizes with the Release-set below. Correct.
- `wait_until_set`: CAS UNSET→WAITING with Acquire success / Acquire failure; loops on `futex_deadline.wait`. Correct.
- `set()`: `state.swap(IS_SET, Release)` — pair for the Acquire above. If swap returns WAITING, calls `Futex::wake(&self.state, u32::MAX)` (wakes all waiters). Correct.
- `reset()`: `state.store(UNSET, Relaxed)`. Documented UB if waiters are blocked.

**Verdict:** CLEAN.

## 2.6 `Semaphore` (`Semaphore.rs`)

**File:** 2.2 KB, 75 lines.
**Pattern:** `Mutex + Condition + permits: UnsafeCell<usize>`.

**Send/Sync claims:**

```rust
unsafe impl Sync for Semaphore {}
unsafe impl Send for Semaphore {}
```

SAFETY comment at `:20-21`: "`permits` is only read/written while `mutex` is held; `Mutex` and `Condition` are themselves `Sync`/`Send`."

Auditable: every access to `*self.permits.get()` is wrapped in a `mutex.lock()` / scopeguard-`mutex.unlock()` pair. Correct.

**Verdict:** CLEAN.

## 2.7 `WaitGroup` (`WaitGroup.rs`)

**File:** 2.7 KB, 80 lines.
**Pattern:** standard `Mutex + Condition + raw_count: AtomicUsize`.

**Subtle ordering in `finish`** (`:50-64`):
- `raw_count.fetch_sub(1, AcqRel)` — Acquire to see writes from other tasks completing before us; Release so our task's prior writes are visible to other consumers.
- After fetch_sub, if old_count==1 (we are last): `mutex.lock(); mutex.unlock(); cond.signal()` — the lock/unlock acts as a memory barrier to ensure any in-flight `wait()` between count-read and `cond.wait()` reaches `cond.wait()` before we signal.

The trick relies on a thread doing `state.load(Acquire) > 0` then `cond.wait(&mutex)`; both are inside `wait()`'s `mutex.lock()` critical section. Our `mutex.lock(); mutex.unlock()` in `finish` waits for that thread to enter `cond.wait()` (which releases the mutex). Correct.

**Auto-derived `Send + Sync`** (AtomicUsize + Mutex + Condition). CLEAN.

## 2.8 `Channel` (`channel.rs`)

**File:** 9 KB, 246 lines.

**Internal state:** `mutex: Mutex`, `putters: Condition`, `getters: Condition`, `buffer: UnsafeCell<LinearFifo<T,B>>`, `is_closed: Cell<bool>`.

**Send/Sync claims:**

```rust
unsafe impl<T: Send, B: LinearFifoBuffer<T>> Send for Channel<T, B> {}
unsafe impl<T: Send, B: LinearFifoBuffer<T>> Sync for Channel<T, B> {}
```

`T: Send` is correct — items cross threads.

**Concern (TH-4):** the bound does NOT require `B: Send + Sync`. `B` is a buffer type; in-tree buffers are POD storages but the trait is open-extension. A user implementing a custom `LinearFifoBuffer<T>` with `!Sync` internals would smuggle non-Sync data through. CLEAN for in-tree usage; **T3 watchlist**.

**Re-derived borrows around wait**: the file documents that `unsafe { &mut *self.buffer.get() }` is **re-derived each loop iteration**, never held across `Condition::wait` (which releases the mutex) — see `:178-179` and `:213-214`. Correct.

**ABA hazard:** none — this is a mutex-guarded FIFO, not a lock-free queue.

**Verdict:** CLEAN with TH-4 watchlist.

## 2.9 `Guarded` (`guarded.rs`)

**File:** 7.1 KB, 194 lines.
**Pattern:** `parking_lot::Mutex<T>` drop-in.

**Type aliases:**
```rust
pub type Guarded<Value> = GuardedBy<Value, Mutex>;
pub type MutexGuard<'a, Value> = GuardedLock<'a, Value, Mutex>;
pub type Debug<Value> = GuardedBy<Value, ThreadLock>;
```

`MutexGuard` here is **NOT** `crate::mutex::MutexGuard` — it is `GuardedLock<'_, Value, Mutex>`, a different type. The two are re-exported under similar names from the crate root (`lib.rs:35-36`).

**Send/Sync claims on `GuardedBy`:**

```rust
unsafe impl<Value: Send, M: RawMutex + Sync> Sync for GuardedBy<Value, M> {}
```

`Value: Send` because lock hand-off transfers ownership. `M: Sync` because we call `mutex.lock()` via `&mutex`. CLEAN.

`Send` is auto-derived.

**TH-1 — T1 finding: `GuardedLock` is unconditionally `Send`.**

```rust
pub struct GuardedLock<'a, Value, M: RawMutex> {
    guarded: &'a GuardedBy<Value, M>,
}
```

Auto-trait derivation:
- `&'a GuardedBy<V, M>` is `Send` if `GuardedBy<V, M>: Sync`.
- `GuardedBy<V: Send, Mutex>: Sync` by the explicit `unsafe impl` above.
- Therefore `&GuardedBy<V: Send, Mutex>: Send`.
- Therefore `GuardedLock<'_, V: Send, Mutex>: Send` by auto-derivation.

But the guard's `Drop` (`:168-172`) calls `self.guarded.mutex.unlock()`, which on Windows is `ReleaseSRWLockExclusive` — documented UB if called from a non-owning thread (per the SAFETY comment at `Mutex.rs:248-252`); and on Darwin is `os_unfair_lock_unlock` which aborts if called from a non-owning thread.

The sibling type `crate::mutex::MutexGuard` correctly has:

```rust
pub struct MutexGuard {
    mutex: bun_ptr::BackRef<Mutex>,
    _not_send: core::marker::PhantomData<*const Mutex>,
}
```

`GuardedLock` is missing the analogous marker. **This is a real soundness gap, even though no in-tree caller currently sends a `GuardedLock` across threads.**

**Proof-of-bug shape:**

```rust
// Hypothetical caller:
let g = bun_threading::Guarded::<u32>::new(0);
let guard = g.lock();
std::thread::spawn(move || {
    // guard's Drop fires here, calling Mutex::unlock() on the wrong thread.
    drop(guard);
}).join().unwrap();
// On Windows: UB. On Darwin: abort.
```

`std::thread::spawn` requires `F: Send`. The closure captures `guard: GuardedLock<'static, u32, Mutex>` (assuming `g: &'static`). The closure is `Send` because `guard: Send`. Compiles.

**Fix:** add `_not_send: PhantomData<*const Mutex>` to `GuardedLock`. Same as `crate::mutex::MutexGuard`. One-line change.

**Mitigation while T1 is open:**
- Audit existing uses of `Guarded<T>` to confirm no guard is moved between threads. Quick grep (`rg 'Guarded::lock|guarded.lock\(\)'`) shows the in-tree uses are panic handlers, bundler workers, watcher state — none send guards across threads. The bug is latent.

**TH-1 verdict:** T1 by language semantics (UB on Windows, abort on Darwin); not currently triggered.

## 2.10 `UnboundedQueue` / `Link` / `Linked` (`unbounded_queue.rs`)

**File:** 13 KB, 373 lines.
**Pattern:** Vyukov-style intrusive MPMC queue (single-pop / batch-pop).

**Key types:**
- `Link<T>(AtomicPtr<T>)` — `#[repr(transparent)]` `AtomicPtr<T>` for embedding in node types.
- `trait Node: Sized` (unsafe) — four accessors: `get_next` / `set_next` / `atomic_load_next` / `atomic_store_next`.
- `trait Linked: Sized` (unsafe) — `link(item: *mut Self) -> *const Link<Self>`. Auto-impls `Node` for `T: Linked`.
- `struct UnboundedQueue<T: Node> { back: QueuePadded<AtomicPtr<T>>, front: QueuePadded<AtomicPtr<T>> }`.

**No explicit `unsafe impl Send/Sync`:** the struct's two `AtomicPtr<T>` fields auto-derive Send + Sync for all T. **TH-3 — T3 watchlist:** this is technically over-permissive — a user could push `*mut T` where `T: !Send` and the queue would cross threads. But the safety contract of `Node` and the producer/consumer pattern explicitly transfer ownership at API boundaries (raw pointers, not `Box<T>`), so this is by design. Filed as informational.

**push/pop algorithm review:**

`push_batch(first, last)`:
- `T::set_next(last, null)` — terminate the batch.
- `self.back.0.swap(last, AcqRel)` — atomic swap of tail; old_back is the previous tail.
- If old_back was null: `self.front.0.store(first, Release)` — queue was empty.
- Else: `T::atomic_store_next(old_back, first, Release)` — link old tail to new head.

Synchronization: the Release on `back.swap` orders the `set_next(last, null)` before any future Acquire on `back`. The Release on `atomic_store_next` orders the link write before any future Acquire load of the link.

`pop()`:
- `first = self.front.0.load(Acquire)`. If null → return null.
- Loop: `next_ptr = T::atomic_load_next(first, Acquire)`. CAS `front: first → next_ptr` (Release on success / Acquire on fail).
- If success and next_ptr != null: return `first`.
- Else (only-item case): CAS `back: first → null`. If success: return `first`. If fail (concurrent push): wait for `T::atomic_load_next(first)` to become non-null (set by the concurrent push), then `self.front.0.store(new_first, Release)`. Return `first`.

The single-item edge case has a documented spinloop awaiting the concurrent push's `atomic_store_next`. Correct.

**Drop while popped?** The popped node's `next` is set by the concurrent push BEFORE the push completes. The consumer reads the node only after observing non-null `next`. Sound.

**Verdict:** CLEAN with TH-3 informational.

## 2.11 `ThreadPool` (`ThreadPool.rs`)

**File:** 76 KB, 1946 lines.
**Pattern:** Port of kprotty/zap's work-stealing thread pool.

**Architecture:**
- Global `run_queue: node::Queue` — MPMC lock-free queue (Treiber-stack with consumer-cache bit).
- Per-thread `Buffer` — bounded SPMC ring (CAPACITY=256, indices wrap with `wrapping_add`).
- `Sync` packed atomic state: `idle:u14 + spawned:u14 + notified:bool + state:u2`.

**Send/Sync claims:**

- `unsafe impl Send for Task` (`:337`) — SAFETY comment at `:331-336` explains: "the intrusive `node.next` raw pointer is only dereferenced under the pool's internal synchronization (lock-free `Node.Queue` / `Node.Buffer`). The auto-trait opt-out is purely from the raw `*mut Node`, not a real !Send invariant." OK.
- `unsafe impl Sync for Queue` (`:1493`) — SAFETY: "non-atomic `cache` Cell is only read/written by the thread that has CAS-acquired the IS_CONSUMING bit in `stack`". The Acquire/Release barriers on `stack` order all cache accesses. OK.
- `unsafe impl Send for Queue` (`:1494`) — required because Queue is shared across threads. OK.
- `Buffer` is auto-`Send + Sync` (all fields are atomics) — sanity-asserted by `const _: fn() = ||` block (`:1677`).

**Work-stealing race analysis (kprotty/zap algorithm):**

`Buffer::steal(target)`:
1. Read `buffer_head: Acquire`, `buffer_tail: Acquire`. Compute `buffer_size`.
2. If `buffer_size > CAPACITY`, spin-retry — the loaded tail "got ahead of" the head.
3. `steal_size = buffer_size - buffer_size/2` (ceil-half).
4. For i in 0..steal_size: copy `target.array[(buffer_head + i) % CAP]` (Relaxed load) to `self.array[(tail + i) % CAP]` (Relaxed store).
5. CAS `target.head: buffer_head → buffer_head + steal_size` (AcqRel / Relaxed fail). If success, advance our `self.tail` (Release).

**Race vs target's `pop()`:** target's pop CAS-advances `target.head` Acquire. If a pop happens between our head read and our CAS, our CAS fails (head moved) and we retry. SAFE.

**Race vs target's `push()`:** target's push writes `target.array[i]` (Relaxed) then `target.tail.store(Release)`. Our `buffer_tail = target.tail.load(Acquire)` synchronizes-with the latest push's Release, so all array slots up to that tail are visible. SAFE.

**Slot reuse / ABA?** A target's push advances tail; if tail wraps around (after CAPACITY pushes), the same slot index is reused. But the slots [buffer_head .. buffer_head + steal_size] are only reused if head advances past them — and head only advances via pop or another steal. If head moves, our CAS fails. Therefore, between our Acquire load of buffer_head and our CAS on target.head, the slots we copied are stable. **No ABA.**

**Concern — Relaxed array loads in `consume`/`push`/`steal`:** the array stores are documented as Relaxed because the Release/Acquire on `tail`/`head` provides the happens-before. The orderings are consistent with Zig's `.unordered` (which the comment at `:1731`/`:1840`/`:1902` notes). x86 emits the same `mov` instruction either way. Correct under both x86-TSO and ARMv8 (the explicit Release/Acquire are what matter, not the atomic load type).

**Push overflow path** (`:1750-1789`):
- If buffer is full, migrate half to the global queue via `target.head.compare_exchange_weak(head, head + migrate, Acquire, Relaxed)`. On success, link migrated nodes and append the caller's list. Return Overflow to the caller.
- Acquire on success ensures the linked-list creation only happens after the steal claim is committed. OK.

**Verdict:** CLEAN.

## 2.12 `work_pool` (`work_pool.rs`)

**File:** 9.3 KB, 222 lines.

**TH-2 — T2 finding: `owned_task!` macro emits unconditional `Send` for generic types.**

The macro definition (`:111-132`) for the generic arm:

```rust
([$($gen:tt)*] $ty:ty, $field:ident) => {
    $crate::intrusive_work_task!([$($gen)*] $ty, $field);
    // SAFETY: see macro doc — the type is moved to a worker thread by design.
    unsafe impl<$($gen)*> ::core::marker::Send for $ty {}
    unsafe impl<$($gen)*> $crate::work_pool::OwnedTask for $ty {
        #[inline]
        fn run(self: ::std::boxed::Box<Self>) { <$ty>::run_owned(self) }
    }
};
```

The `unsafe impl<$($gen)*> Send for $ty {}` is emitted without any `where` clause. For a callsite like `owned_task!([T: SomeBound] MyTask<T>, task);`, the macro emits `unsafe impl<T: SomeBound> Send for MyTask<T> {}`. There is no `T: Send` requirement.

**Why this is T2 not T1:** the *current* in-tree uses are:
- `owned_task!(ConcurrentCppTask, ...)` — non-generic; fine.
- `owned_task!([Op: PasswordOp] PasswordJob<Op>, ...)` — generic on `Op: PasswordOp`. `PasswordJob<Op>` contains `JSPromiseStrong` (!Send), `*mut EventLoop` (!Send), `*const JSGlobalObject` (!Send), `KeepAlive` (!Send). The author has manually verified that the worker thread NEVER touches these fields (only `op.compute(&password)`), so smuggling them across is sound *as long as the worker discipline holds*. The type system has no way to enforce that discipline.
- `owned_task!(InitialStatTask, ...)` — non-generic; fine.
- `owned_task!([const IS_SHELL: bool] CpSingleTask<IS_SHELL>, ...)` — const-generic; fine.
- `owned_task!(ReaddirSubtask, ...)` — non-generic; fine.

So **no current callsite is exposed**, but the macro architecture admits a future regression. Codex P3 flagged this; I confirm it remains a T2 architecture defect.

**Fix options:**
1. Have the macro emit `unsafe impl<$($gen)*> Send for $ty where Self: Send {}` — this is tautological, but it propagates the requirement. The compiler would reject the impl if the type has a non-Send field unless the field has a Send bound. Hmm, this isn't quite right either.
2. Better: add a `const _: fn() = || { fn assert_send<T: Send>() {} assert_send::<$ty>(); };` after the impl. This forces the type to be Send through normal auto-derivation; any `!Send` field fails compilation, but the `unsafe impl` then *adds nothing* because Send was already there. **The whole point of the unsafe impl is to OVERRIDE the auto-trait** — so option 2 defeats it.
3. Best: remove the `unsafe impl Send` from the macro. Force each callsite to write its own `unsafe impl Send`, documented at the use site. The macro-generated impl is convenience, not soundness.
4. Reasonable middle ground: emit `static_assertions::assert_impl_all!($ty: Send);` for the non-generic arm; document the generic arm as "you must provide your own `unsafe impl Send` if your `T` is `!Send`".

Recommendation: option 3 or 4. Filed.

**`schedule_owned<T: OwnedTask>` callback (`:165-178`):**
- Stores `T::__callback` (which recovers `Box<T>` via `Box::from_raw`).
- Single `Box::into_raw` per call.
- `WorkPool::schedule(field_of(raw))` — passes the intrusive `Task` pointer.
- The `Send` bound is in `OwnedTask: ... + Send + 'static` (`:51`). So at type level, `T: Send`. The macro's `unsafe impl Send for $ty` is what makes this trait satisfiable for types with !Send fields. Without the unsafe impl, the trait bound would fail; with it, it succeeds even when fields are !Send. **The unsafe impl is the soundness escape hatch the macro provides** — and it provides it unconditionally, which is the T2.

**`WorkPool::go<C: Send + 'static>`** (`:187-218`):
- Box-allocates a `TaskType<C>`, installs a `fn(C)` callback, schedules.
- `C: Send + 'static` is correctly bounded. CLEAN.

## 2.13 `bun_threading` — invariant cross-checks

| Invariant                                                          | Verified                                                                          | Tier |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ---- |
| No mutex held across `Condition::wait` releases the mutex          | `Channel::write_items`/`read_items` re-derive `&mut buffer` each iter; CLEAN     | OK   |
| No double-unlock                                                   | `MutexGuard::Drop` runs once; `GuardedLock::Drop` runs once; CLEAN               | OK   |
| Drop runs unlock on locking thread                                 | `MutexGuard` is `!Send`; `GuardedLock` is `Send` — **TH-1 violation**             | T1   |
| `unsafe impl Send for Task` is sound                               | YES — pool synchronizes the intrusive `next` field; CLEAN                         | OK   |
| Work-stealing buffer slots are not reused while a steal is in flight | YES — CAS on `target.head` fails if a peer advanced head between read and commit | OK   |
| `unbounded_queue::push` linker write Release-paired with consumer's Acquire | YES — Release on `atomic_store_next`, Acquire on `atomic_load_next`        | OK   |
| ResetEvent.set is paired with Acquire on observed Set              | YES — `swap(IS_SET, Release)` + `is_set()` Acquire; CLEAN                         | OK   |
| WaitGroup.finish synchronizes lock-wait-pattern                    | YES — `mutex.lock(); mutex.unlock()` flushes any in-flight `cond.wait`            | OK   |
| `owned_task!` Send bound covers all field types                    | NO — unconditional `unsafe impl Send`; **TH-2 violation**                         | T2   |
| `Channel::Sync` requires correct bounds                            | Mostly — `T: Send` is correct, `B: Send + Sync` missing; **TH-4 watchlist**       | T3   |

--------------------------------------------------------------------------------

## 3. Tiered findings

### T1 (concrete unsound operation)

#### TH-1 — `GuardedLock<'_, V, Mutex>` is unconditionally `Send`

**File:** `src/threading/guarded.rs:132-134` (struct definition).

**Operation:** A `GuardedLock` value is `Send` (auto-derived). Its `Drop` calls `Mutex::unlock()`, which on Windows is documented as UB if called from a non-owning thread (`Mutex.rs:248-252`), and on Darwin aborts.

**Call-graph evidence:**
- `GuardedBy<V: Send, Mutex>: Sync` (`guarded.rs:38`, explicit `unsafe impl`).
- `&'a GuardedBy<V, Mutex>: Send` by `T: Sync → &T: Send`.
- `GuardedLock<'a, V, Mutex>` contains only `guarded: &'a GuardedBy<V, Mutex>` — auto-`Send`.
- `Mutex::unlock` ultimately calls `ReleaseSRWLockExclusive` (Windows, `Mutex.rs:251`) or `os_unfair_lock_unlock` (Darwin, `Mutex.rs:304`); both require the locking thread.

**Reproducer (one-liner):**

```rust
static G: bun_threading::Guarded<u32> = bun_threading::Guarded::new(0);
fn main() {
    let guard = G.lock();
    std::thread::spawn(move || drop(guard)).join().unwrap();
    // Windows: UB. Darwin: abort. POSIX-non-Apple: technically fine (Futex).
}
```

The closure compiles because `guard: Send`.

**Fix:** add `_not_send: PhantomData<*const Mutex>` to `GuardedLock`. Mirror `crate::mutex::MutexGuard`'s pattern (`Mutex.rs:114-120`). One-line change.

**Verification after fix:** `static_assertions::assert_not_impl_any!(bun_threading::guarded::MutexGuard<u32>: Send);` should compile.

### T2 (architecture defect — trait/macro admits unsound impls)

#### TH-2 — `owned_task!` macro emits unconditional `unsafe impl Send` for generic types

**File:** `src/threading/work_pool.rs:111-132`.

**Defect:** the generic arm of `owned_task!` emits `unsafe impl<$($gen)*> Send for $ty {}` with no `T: Send` bound on the generic parameters. The non-generic arm emits the same impl directly. The macro doc-comment acknowledges this is intentional, shifting the proof burden to the user's manual review of "all fields are sound to move across threads."

**Current callsite exposure:** five callsites; one (`PasswordJob<Op: PasswordOp>`) is generic with internal `!Send` fields (`*mut EventLoop`, `*const JSGlobalObject`, `JSPromiseStrong`, `KeepAlive`). The author has reviewed each field manually and concluded that the worker thread does not touch them; the JS-thread re-dispatch is via `concurrent_promise_task` which re-enters the JS thread before touching those fields. The review is correct for the current implementation but is not enforced by the type system.

**Risk:** a future change to `PasswordOp::compute` or a future `PasswordJob` field that holds a thread-local handle (e.g. a TLS-cached pointer) would silently smuggle that handle across threads.

**Recommendation (concrete):** modify the macro to drop the unconditional `unsafe impl Send` and require each callsite to provide its own — that way, the `unsafe impl Send for PasswordJob<Op>` lives at the use site with a per-callsite SAFETY comment. Example:

```rust
// At the callsite, replace owned_task!([Op: PasswordOp] PasswordJob<Op>, task)
// with the explicit two-line form:
bun_threading::intrusive_work_task!([Op: PasswordOp] PasswordJob<Op>, task);
// SAFETY: this PasswordJob field analysis ...
unsafe impl<Op: PasswordOp> Send for PasswordJob<Op> {}
impl<Op: PasswordOp> bun_threading::OwnedTask for PasswordJob<Op> { ... }
```

This puts the SAFETY proof next to the type, where future-author review will encounter it.

### T3 (latent watchlist)

#### TH-3 — `UnboundedQueue<T: Node>` auto-Sends for any T

**File:** `src/threading/unbounded_queue.rs:216-219`.

The struct's two `AtomicPtr<T>` fields make `UnboundedQueue<T>` auto-`Send + Sync` regardless of `T`. Pushing a `*mut T` where `T: !Send` would smuggle non-thread-safe data across cores; this is by design (the queue stores raw pointers, not owned `T`s), but it relies on Node-trait users upholding the safety contract.

**Mitigation:** the `Node` trait is unsafe, so callers know they're on the hook. Filed informational.

#### TH-4 — `Channel<T, B>` Sync impl does not bound `B`

**File:** `src/threading/channel.rs:47-49`.

`unsafe impl<T: Send, B: LinearFifoBuffer<T>> Sync for Channel<T, B>` — the bound on `B` is `LinearFifoBuffer<T>` (trait), but not `Send + Sync`. All in-tree `LinearFifoBuffer<T>` impls (`StaticBuffer<T,N>`, `SliceBuffer<'a,T>`, `DynamicBuffer<T>`) have POD storage that's auto-Sync, so no current Channel is unsound. If an out-of-tree user implements `LinearFifoBuffer<T>` with `!Sync` internals, the Channel would expose a data race.

**Recommendation:** add `B: Send + Sync` to the impl. Cheap, defensive.

#### TH-5 — `Mutex::is_held_by_current_thread` returns true in release

**File:** `src/threading/Mutex.rs:72-81`.

Documented behavior: the locking-thread id is not tracked in release builds, so the function returns `true` to keep `debug_assert!(mutex.is_held_by_current_thread())` a no-op there. The asymmetry between debug and release means a release build can violate a "caller must hold the lock" contract that debug catches.

**Recommendation:** if the intent is to ALWAYS catch contract violations, lift the locking_thread tracking into the release build (small cost on the hot path). Filed informational.

--------------------------------------------------------------------------------

## 4. Negative findings (explicit)

The following audit checks **passed** and are recorded so a future pass does
not re-litigate them:

| Check                                                              | Verdict        | Evidence |
| ------------------------------------------------------------------ | -------------- | -------- |
| FileSink `borrow = ptr` choice is correct                          | CONFIRMED      | `FileSink.rs:233-254` motivates the choice; `on_write`/`on_error`/`on_close` all take `*mut Self`; `FileSinkRef` RAII guards lifecycle |
| WindowsNamedPipe `borrow = mut` choice is correct                  | CONFIRMED      | Outer context defers deinit via `enqueue_task`; no synchronous free during callbacks |
| StaticPipeWriter `borrow = mut` choice is correct                  | CONFIRMED      | `RefPtr` has no `Drop`; `Writable::Buffer` overwrite leaks the ref (intentional in Rust port); no synchronous free |
| ShellIOWriter `borrow = shared` choice is correct                  | CONFIRMED      | Aliased `&Self` is sound; field mutation routes through `UnsafeCell<State>`; `keepalive()` pattern documented |
| Macro `impl_streaming_writer_parent!` template is sound            | CONFIRMED (Pass 3) | Pass 3 macro-template audit found no template-level issues |
| Macro `impl_buffered_writer_parent!` template is sound             | CONFIRMED      | Same Mc/shared discriminator pattern; no `ptr` mode is intentional (parents that need `ptr` use the streaming variant) |
| `Mutex::MutexGuard` is `!Send` (Darwin/Windows lock-affinity)      | CONFIRMED      | `Mutex.rs:114-120` has `_not_send: PhantomData<*const Mutex>` |
| `RwLockReadGuard`/`WriteGuard` are `!Send`                         | CONFIRMED      | `RwLock.rs:243-246`, `:268-271` both have `_not_send` |
| `ThreadPool::Task` `unsafe impl Send` is sound                     | CONFIRMED      | SAFETY at `ThreadPool.rs:331-336`; intrusive `next` only accessed under pool sync |
| `ThreadPool::Queue` `unsafe impl Sync + Send` is sound             | CONFIRMED      | SAFETY at `ThreadPool.rs:1489-1494`; non-atomic Cell guarded by IS_CONSUMING CAS |
| Work-stealing `Buffer::steal` no ABA on slot reuse                 | CONFIRMED      | CAS on target.head fails if peer pops between read and commit |
| `Channel::Sync` requires `T: Send`                                 | CONFIRMED      | `channel.rs:49` |
| `RwLock::Send + Sync` bounds match `parking_lot`                   | CONFIRMED      | `RwLock.rs:157-158` |
| `unbounded_queue::push` Release-pairs with consumer Acquire        | CONFIRMED      | `:259` Release-swap on back; `:263` Release on link write; `:270`/`:336` Acquire on consumer |
| `ResetEvent::set` Release pairs with `is_set` Acquire              | CONFIRMED      | `:121` Release-swap; `:44` Acquire-load |
| `WaitGroup::finish` mutex-flush pattern                            | CONFIRMED      | `:61-62` lock/unlock barrier before `cond.signal()` |
| `Condition::FutexImpl::wait` epoch-before-state ordering           | CONFIRMED      | `:346-348` Acquire-load epoch first; comment `:336-345` walks the hazard |
| `Condition::FutexImpl::wake` state-before-epoch ordering           | CONFIRMED      | `:437-456` Release-CAS state, then Release fetch_add epoch |
| `Futex` per-backend SAFETY blocks                                  | CONFIRMED      | One SAFETY per syscall; all wrap `&AtomicU32` properly |
| `Semaphore::Sync` is sound                                         | CONFIRMED      | Permits guarded by mutex; SAFETY at `:20-21` |

**Bench-style summary:** of the 213 `bun_io` unsafe sites, the 5 PipeWriter
parent-vtable invocations + the Terminal hand-roll are the highest-risk
cluster (most cross-thread / re-entrant). All 5 are sound under their chosen
discipline.

Of the 126 `bun_threading` unsafe sites, the highest-risk cluster is the
guard `!Send` markers (3 marker types — `MutexGuard`, `RwLockReadGuard`,
`RwLockWriteGuard`) and the auto-trait surface on `GuardedLock`. Two of the
three markers are correctly present; the fourth (`GuardedLock`) is missing
and is **TH-1** above.

--------------------------------------------------------------------------------

## 5. Tiered totals

| Tier | Count | Items |
| ---- | ----- | ----- |
| T1   |   1   | TH-1 (`GuardedLock` missing `!Send` marker → UB on Windows / abort on Darwin) |
| T2   |   1   | TH-2 (`owned_task!` unconditional `Send` bound) |
| T3   |   3   | TH-3 (`UnboundedQueue` auto-`Send`); TH-4 (`Channel` missing `B: Send + Sync`); TH-5 (`is_held_by_current_thread` debug-only) |
| OK   |  21   | All other invariants checked — see Negative Findings table |

The PipeWriter callsites contribute **zero** T1, **zero** T2, **two** T3
(Terminal's tail-position `deref_()` and ShellIOWriter's POSIX
on_write_pollable keepalive gap). Both are mechanically fixable by adopting
the `borrow = ptr` mode (Terminal) or by symmetrizing the keepalive
(ShellIOWriter).

The `bun_threading` audit contributes **one** T1, **one** T2, **three** T3.

--------------------------------------------------------------------------------

## 6. Recommendations (precommit / follow-up)

| ID    | Severity | Action |
| ----- | -------- | ------ |
| TH-1  | T1       | Add `_not_send: PhantomData<*const Mutex>` to `GuardedLock<'_, _, Mutex>` (and `_not_sync` if symmetry desired). One-line patch in `src/threading/guarded.rs:132`. Add `static_assertions::assert_not_impl_any!(GuardedLock<'_, (), Mutex>: Send);` next to the type. |
| TH-2  | T2       | Drop the `unsafe impl Send` from the `owned_task!` macro (move it to each callsite with a per-type SAFETY comment); or audit-tag every existing callsite with `// SAFETY (owned_task Send): …` and document the worker-discipline that justifies it. |
| TH-3  | T3       | Document the `UnboundedQueue<T>` raw-pointer-semantics contract more loudly; no code change required. |
| TH-4  | T3       | Add `B: Send + Sync` to `Channel::Sync` impl in `src/threading/channel.rs:49`. Defensive; in-tree usage unaffected. |
| TH-5  | T3       | Either remove the `is_held_by_current_thread` method (so debug-only callers explicitly cfg-gate the assert), or track `locking_thread` in release builds too. |
| PWR-T (Terminal) | T3 | Migrate `Terminal` to `bun_io::impl_streaming_writer_parent!` with `borrow = ptr` and convert `on_writer_close`/`on_writer_error`/`on_writer_ready`/`on_write` to take `this: *mut Self`. Closes the tail-position UAF window. |
| PWR-S (Shell)    | T3 | Add `let _keepalive = self.keepalive();` to POSIX `on_write_pollable` in `src/runtime/shell/IOWriter.rs:760`, symmetrically with `on_error` at `:858`. Resolves the documented TODO at `:1154-1158`. |
