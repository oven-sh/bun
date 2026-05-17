# Differential Rust-vs-Zig Audit — 2026-05-16

Bun keeps every Zig source file as a sibling next to its Rust port (`fetch.zig`
next to `fetch.rs`, etc.) because the Rust code is a recent port and the Zig
file remains the source-of-truth for *intended semantics* even though only the
Rust code ships (per `CLAUDE.md` §"Language Structure"). This audit lane reads
both files for two candidate findings (EXP-109, EXP-111) and asks:

> Did the bug exist in the Zig original, or did the Rust port introduce it?

This is a *uniquely high-leverage* audit angle: most third-party security
reviewers don't have both implementations available, but Bun does because the
port is recent and complete.

---

## EXP-109 — `Compiled.js_function: JSValue` bare-handle candidate

### Zig original
`src/runtime/ffi/ffi.zig:1496-1508`:

```zig
pub const Step = union(enum) {
    pending: void,
    compiled: struct {
        ptr: *anyopaque,
        js_function: JSValue = JSValue.zero,         // <-- bare JSValue
        js_context: ?*anyopaque = null,              // <-- raw JSGlobalObject
        ffi_callback_function_wrapper: ?*anyopaque = null,
    },
    failed: struct { msg: []const u8, allocated: bool = false },
};
```

### Rust port
`src/runtime/ffi/mod.rs:432-445`:

```rust
pub enum Step {
    Pending,
    Compiled(Compiled),
    Failed { msg: Box<[u8]>, allocated: bool },
}

pub struct Compiled {
    pub ptr: *mut c_void,
    // TODO(port): bare JSValue on heap — rooted via JSFFI.symbolsValue own:
    // property; revisit Strong/JsRef once bun_jsc lands
    pub js_function: JSValue,                          // <-- IDENTICAL to Zig
    pub js_context: Option<*mut JSGlobalObject>,       // <-- IDENTICAL
    pub ffi_callback_function_wrapper: Option<NonNull<c_void>>,
}
```

### Corrected verdict: **NO_EVIDENCE for current production `JSCallback` UB**

The duplicate Zig/Rust `Compiled.js_function` fields really are similar, and
the Rust comment is still a cleanup smell. But that is not sufficient to prove
production UB. Later source-root-graph review traced the live `JSCallback`
path through:

- `src/js/bun/ffi.ts`: the `JSCallback` instance stores callback state in
  private `#ctx`.
- `src/runtime/ffi/ffi_body.rs`: `FFI::callback` creates the native callback
  wrapper for the live path.
- `src/jsc/bindings/JSFFIFunction.cpp`: `FFICallbackFunctionWrapper` owns
  `JSC::Strong<JSC::JSFunction>` and `JSC::Strong<Zig::GlobalObject>`.

That wrapper gives JSC visibility into the callback/global object. Therefore
the original EXP-109 claim ("production `JSCallback` stores a bare unrooted
JSValue") is not defensible.

**Implication for the audit:** keep this as negative evidence and cleanup
context, not as a counted bug. Do not claim a faithfully preserved Zig-era
rooting bug, do not cite the quarantined `ffi-bare-jsvalue-regression.test.ts`
as a valid regression test, and do not require `R-EXP-109` as a remediation.

**Strength of finding:** DEMOTED. The abstract Miri/Kani stale-handle models
remain useful education for future unrooted JSC-handle designs, but they do
not prove the current Bun production path is unsound.

---

## EXP-111 — bundler part-range workers create overlapping `&mut` owners

### Zig original
`src/bundler/Chunk.zig:35`:

```zig
renamer: renamer.Renamer = undefined,
```

And `src/js_printer/renamer.zig:32-62`:

```zig
pub const Renamer = union(enum) {
    NumberRenamer: *NumberRenamer,        // <-- RAW POINTER, not borrow
    NoOpRenamer:   *NoOpRenamer,          // <-- RAW POINTER
    MinifyRenamer: *MinifyRenamer,        // <-- RAW POINTER

    pub fn nameForSymbol(renamer: Renamer, ref: Ref) string {
        return switch (renamer) {
            inline else => |r| r.nameForSymbol(ref),
        };
    }
    // ... other methods take `renamer: Renamer` by value (copy of the union)
};
```

Zig's `Renamer` is a **tagged union of raw pointers**. The union itself is
~16 bytes (tag + pointer). It is **passed by value** to its methods, which
copy the pointer and dereference it for the actual work. Multiple worker
threads can hold the same `Renamer` value (copy) and dereference the inner
pointer in parallel. **Zig has no borrow stack**, so this is just a normal
unsynchronized C-style read pattern.

### Rust port
`src/bundler/Chunk.rs:80-84, 130-134`:

```rust
pub renamer: bun_renamer::ChunkRenamer,  // owned-erased placeholder
// ...
// TODO(ub-audit): `Renamer<'r>` still borrows `&'r mut {Number,Minify}Renamer`,
// so the per-chunk renamer is reborrowed mutably from each part-range task;
// the printer never writes through it, but the borrow should become `&'r`.
unsafe impl Send for Chunk {}
unsafe impl Sync for Chunk {}
```

And the `bun_renamer::Renamer<'r>` (per the author's TODO) is shaped:

```rust
pub enum Renamer<'r> {
    NumberRenamer(&'r mut NumberRenamer),       // <-- &'r mut (NOT &'r)
    NoOpRenamer  (&'r mut NoOpRenamer),
    MinifyRenamer(&'r mut MinifyRenamer),
}
```

### Corrected verdict: **PORT-SPECIFIC RUST UB; renamer-only framing was too narrow**

The Zig original uses raw pointers (`*NumberRenamer`). Raw pointers in Zig
have no borrow-stack semantics, no retag implications, and no soundness
constraints on multi-thread reads. The pattern of "fan out one Renamer to N
workers; each worker reads via the pointer" is legitimate in Zig and was the
intended design.

The Rust port translated a raw/shared style into APIs that repeatedly create
exclusive Rust references in parallel workers. The most important source facts
are:

- `generateCompileResultForJSChunk.rs` and
  `generateCompileResultForCssChunk.rs` both comment that they avoid
  `&mut LinkerContext`, but the bodies still do
  `let c_mut: &mut LinkerContext = unsafe { &mut *c_ptr };` and
  `let chunk_mut: &mut Chunk = unsafe { &mut *chunk_ptr };`.
- `generateCodeForFileInChunkJS.rs` then takes `&mut LinkerContext` and
  `&mut Chunk` for each part-range task.
- `ChunkRenamer::as_renamer(&mut self)` creates a mutable renamer view.
- `Renamer::name_for_symbol` calls `SymbolMap::follow()`, and
  `SymbolMap::follow()` mutates path-compression links through `Cell`
  unless a prior `follow_all()` proof makes the parallel path store-free.

So the Miri issue is not just "the renamer field is `&mut`." The default
Miri witness in `phase5_experiment_results/EXP-111-sb.log` fails at the
parallel construction of `&mut Chunk` itself. The mutable renamer view is a
second-order defect that prevents a trivial read-only conversion from being
obviously complete.

The Miri data-race report at `phase5_experiment_results/EXP-111-sb.log`:

> error: Undefined Behavior: Data race detected between (1) retag write on
> thread `unnamed-1` and (2) retag write of type `Chunk<'_>` on thread
> `unnamed-2` at alloc515

confirms this is a **Rust-borrow-system phenomenon, not a memory-safety
phenomenon**. Zig's `*NumberRenamer` doesn't have "retag writes."

**Implication for the audit:** EXP-111 remains materially strong because the
bug is tied to Rust exclusivity/retag semantics that Zig raw pointers do not
have. But the remediation must be stated correctly:

1. Stop fan-out workers from creating concurrent whole-owner
   `&mut LinkerContext` / `&mut Chunk`.
2. Pass only narrow mutable slots/atomics for actual per-part writes.
3. Convert the renamer path to a shared/read-only view, and either prove
   `follow_all()` makes `SymbolMap::follow()` store-free before parallel
   codegen or introduce a no-compress `follow_readonly()` for that path.

A renamer-only patch (`&mut` -> `&`) does **not** close EXP-111 while
parallel workers still materialize `&mut Chunk` / `&mut LinkerContext`.

**Strength of finding:** UPGRADED, with corrected scope. This is a documented
port-specific Rust UB shape with a Miri witness, author comments pointing at
the renamer subproblem, and source code showing the broader whole-owner
exclusive-reference fan-out.

---

## Why this matters for the audit's credibility

The differential-audit angle defends against two common objections:

1. **"This bug is hypothetical / not really exploitable."**
   EXP-109 is no longer used for this argument; the source-root graph demoted
   it. EXP-111 is countered by showing Miri found a real retag/data-race
   signal even on a read-only model, and by showing the Zig original avoided
   Rust exclusivity by using raw pointers.

2. **"Your audit is biased toward the Rust port; the Zig original was
   probably equally buggy."**
   Demonstrably false for EXP-111 (port-specific Rust UB). EXP-109 is the
   opposite lesson: superficially similar Zig/Rust fields were not enough to
   prove a live bug once the callback wrapper root graph was traced. The audit
   should say both things honestly.

The Bun codebase's policy of keeping the Zig sibling files in-tree as
intent-references (per `CLAUDE.md` §"Language Structure") is the enabler
for this audit angle. No other audit of Bun (or of any port) gets to make
these distinctions.

---

## Recommended audit-report wording

For EXP-109: the report should **not** claim this is a Rust port regression or
a preserved Zig bug. The correct wording is: "duplicate Zig/Rust bare-handle
scaffolding exists, but the live `JSCallback` path roots through
`FFICallbackFunctionWrapper`; no production UB evidence."

For EXP-111: the report SHOULD claim this is port-specific Rust UB. The
finding is "parallel codegen workers create overlapping whole-owner
`&mut LinkerContext` / `&mut Chunk`, and then expose a mutable renamer view
whose `follow()` path may still write through `Cell`; the appropriate Rust
translation of Zig's raw/shared intent is a narrow worker API plus shared
read-only renamer/symbol access."

For the Bun upstream audience: the EXP-111 framing is materially stronger
defensibility because Zig is the source-of-truth for intended semantics, and
Bun's own coding rule in `CLAUDE.md` says "When fixing a bug or porting a
behavior, the `.zig` sibling is the source of truth for *intended semantics*:
read it, then make the `.rs` match." The fix for EXP-111 is *literally
applying Bun's own coding rule to a site where the port deviated*.
