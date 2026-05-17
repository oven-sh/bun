# Codex Review — Phase-5 Registry Tightening

Run: `2026-05-15-exhaustive`

Scope: adversarial review of the remaining `OPEN` / `NEEDS_REFINEMENT`
entries in `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`, with a bias toward
either executable witnesses or demotion.

## Promotions

### EXP-011 — picohttp NUL-write through shared provenance

Added `experiments/EXP-011`, a Tree-Borrows mirror of the current
`Request::parse(buf: &[u8], ...)` wrapper shape:

```rust
let path_ptr = buf.as_ptr().add(4);
path_ptr.cast_mut().add(path_len).write(0);
```

Miri rejects the write: `write access ... is forbidden`; the tag created by
`buf.as_ptr()` is `Frozen`. This promotes EXP-011 from prose-only `OPEN` to
`CONFIRMED_UB` **as a model witness**. The artifact now explicitly says this is
not a full integrated picohttpparser trace.

### EXP-014 — `multi_array_list::Slice<T>: Copy`

Added `experiments/EXP-014`, modeling the documented source gap:
copy a `Slice`, call `items_mut` on both copies, write through both mutable
views. Miri Tree Borrows rejects the second write after the first view disables
the second tag. This confirms the local API shape; real bundler callsite
mapping remains separate.

### EXP-017 — volatile callback publication primitive

Added `experiments/EXP-017`, a cross-thread Miri model showing that
`write_volatile` + `fence(SeqCst)` still races with a plain read of the function
pointer. The registry now says the primitive race is confirmed, but the
production claim remains `OPEN` until the already-scheduled `io_request` path
is proven to overlap with the I/O-thread read.

### EXP-026 — timer `&mut self` receiver re-entry

Added `experiments/EXP-026`, modeling the current timer pattern:
`fn drain_timers_like(&mut self)`, immediate raw-pointer conversion, local
short-lived `&mut`, then callback re-entry through a raw/global owner. Miri Tree
Borrows rejects the reborrow through the raw owner while the receiver's
protected tag is live. This validates the existing `TODO(b2)` signature flip
as a real Tree-Borrows issue, still described as a model witness rather than an
integrated JSC timer trace.

## Demotions / Narrowing

### EXP-015 — `StringHashMap::put_borrowed` / `get_or_put_borrowed`

The earlier wording overreached. Both functions are `unsafe fn` and document
the lifetime contract. A workspace callsite audit found exactly three real
callers:

- `src/ast/scope.rs:124`
- `src/js_parser/p.rs:3697`
- `src/js_parser/p.rs:4921`

All three pass source-text / lexer-string-table / already-stored map keys that
outlive the arena-backed `Scope`. EXP-015 is now `NO_EVIDENCE` for current
source and should not be counted as a confirmed UB finding.

### EXP-016 — `AstAlloc + T: Drop`

The arena invariant is real, but no concrete destructor-bearing payload was
identified. Direct enumeration of `AstVec` / `Vec<_, AstAlloc>` sites and
explicit Drop impls under `src/ast` / `src/js_parser` found the expected AST
value/reference vectors, not a lock/refcount/FFI-handle payload. EXP-016 is now
`NEEDS_REFINEMENT`, not a counted bug.

### EXP-028 — `DirectoryWatchStore::owner`

The source TODO is real, but a source-shaped Tree-Borrows model of
`&mut field -> &mut parent`, parent-field use, then child-field use ran clean.
A stronger model with a live parent-borrowing guard does not match current
`ThreadLock::lock()`, which returns `()`. EXP-028 remains a hardening target /
`NEEDS_REFINEMENT` item until an integrated caller witness proves live overlap.

### EXP-020 / EXP-029 — strict-provenance integer-to-pointer rebuilds

Both mirrors fail under `MIRIFLAGS="-Zmiri-strict-provenance"`:

- EXP-020: `bun_url::URL::host_with_path`
- EXP-029: `shell::EnvStr::cast_slice`

These are confirmed strict-provenance failures, but they should be counted
separately from default-Miri/runtime UB traces. Later Phase-5 tightening moved
the strict-provenance policy entries to `DEFERRED`: the witnesses are complete,
but remediation is a release-gate / representation-migration decision rather
than missing production-UB evidence.

## Current unresolved registry entries

- EXP-013: crash-handler async-signal-safety — **superseded by later Phase-5
  closure.** A narrowed POSIX signal call graph now exists at
  `phase5_experiment_results/EXP-013-signal-safety-source-audit.log`; the
  registry verdict is `CONFIRMED_UB` in the POSIX/libc contract sense, not a
  Miri Rust abstract-machine trace.
- EXP-016: AstAlloc destructor-elision payload audit — no concrete payload yet.
- EXP-017: volatile callback publication — primitive confirmed; source-overlap
  proof still open.
- EXP-018: GuardedLock auto-trait defect — compile witness confirms `Send`;
  runtime UB remains backend-specific.
- EXP-020: `URL::host_with_path` strict-provenance failure — confirmed under the
  strict-provenance gate, not counted as default-Miri UB.
- EXP-028: DirectoryWatchStore parent projection — source TODO real, but current
  Miri model did not fail.
- EXP-029: `EnvStr` strict-provenance failure — confirmed under the
  strict-provenance gate, not counted as default-Miri UB.

Registry lint after this pass: `OK`.
