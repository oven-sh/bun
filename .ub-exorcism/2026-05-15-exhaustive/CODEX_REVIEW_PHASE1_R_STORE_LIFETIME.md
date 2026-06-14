# Codex Review — Phase 1 Section R Store Lifetime Escape

While reviewing Section R against current `origin/main`, I found a broader
issue than the already-counted `StoreSlice<T>` Send/Sync laundering.

## Finding

`src/ast/nodes.rs` defines lifetime-erased AST store wrappers with safe
constructors and safe reborrows:

- `StoreRef<T>` stores `NonNull<T>` and exposes safe `from_bump(&mut T)`,
  safe `Deref`, and safe `DerefMut`.
- `StoreStr` stores `(NonNull<u8>, len)` and exposes safe `new(&[u8])` plus
  `slice<'a>(self) -> &'a [u8]`.
- `StoreSlice<T>` stores `(NonNull<T>, len)` and exposes safe `new(&[T])`,
  `new_mut(&mut [T])`, `From<&[T]>`, `From<&mut [T]>`, `Deref`, and
  `slice<'a>(self) -> &'a [T]` / `slice_mut<'a>(self) -> &'a mut [T]`.

The comments correctly describe the intended arena discipline, but safe Rust
cannot require callers to uphold "do not outlive the arena" unless that lifetime
is encoded in the type or the operation is `unsafe`.

## Reproducer

I added `experiments/EXP-021`, a minimal mirror of the current `StoreSlice<T>`
shape. Miri reports:

```text
error: Undefined Behavior: pointer not dereferenceable: alloc194 has been freed, so this pointer is dangling
  --> src/main.rs:22:18
```

The mirror is intentionally tiny, but the source shape is the same as
`src/ast/nodes.rs:322-397`: safe constructor from `&[T]`, raw pointer storage,
safe caller-chosen-lifetime reborrow.

## Artifact Changes

- Added `EXP-021` to `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`.
- Updated `phase1_inventory_R.md` to split EXP-019 (Send/Sync laundering) from
  EXP-021 (lifetime escape).
- Updated `phase1_notes/R_parsers_lang.md` with the new high-priority open
  remediation question.

## Remediation Direction

The principled fix is to carry the arena lifetime:

```rust
pub struct StoreSlice<'arena, T> {
    ptr: NonNull<T>,
    len: u32,
    _arena: PhantomData<&'arena [T]>,
}
```

That may be invasive across AST types. The minimal soundness boundary fix is to
make lifetime-erasing constructors and arbitrary-lifetime reborrow methods
`unsafe`, forcing every caller to name the arena lifetime invariant explicitly.

