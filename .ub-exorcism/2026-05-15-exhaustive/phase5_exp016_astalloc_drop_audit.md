# EXP-016 AstAlloc Drop Audit

Run: `2026-05-15-exhaustive`
Date: `2026-05-16`

## Verdict

`EXP-016` should not be counted as a live UB finding on current `origin/main@4d443e5402`.

The current source does contain arena-backed containers with destructor-bearing
static types, most notably `G::Property`, but the destructor-bearing field is
`TypeScript::Metadata::MDot(Vec<Ref>)`. If arena reset skips that destructor,
the observable failure class is a heap leak, not Rust UB. No current
`Vec<T, AstAlloc>` payload was found whose destructor is required to preserve a
memory-safety invariant such as a lock release, aliasing guard, refcount whose
early/late destruction permits UAF, or FFI handle lifetime.

## Compiler Probe

The probe at `experiments/EXP-016` checks `core::mem::needs_drop::<T>()` for
the concrete AST payloads observed in direct `AstAlloc` vectors.

Raw output: `phase5_experiment_results/EXP-016-needs-drop.log`.

Key result:

```text
Expr                    false
Stmt                    false
G::Decl                 false
G::Property             true
B::Property             false
Ref                     false
StoreRef<Scope>         false
u8                      false
```

All `Vec<T, AstAlloc>` values report `needs_drop == true` because `Vec` has drop
glue regardless of whether `T` has element destructors. The UB-relevant question
is the element payload `T`, not the `Vec` header. `AstAlloc::deallocate` is a
documented no-op and the backing memory is intentionally bulk-freed by the AST
heap.

## Why `G::Property` Needs Drop

`src/ast/g.rs` defines:

- `G::Property { ts_decorators: ExprNodeList, ts_metadata: TypeScript::Metadata, ... }`
- `ExprNodeList = Vec<Expr, AstAlloc>`, where `Expr` is `Copy`.
- `TypeScript::Metadata::MDot(Vec<Ref>)`, where the inner `Vec<Ref>` is a
  normal global-heap vector.

That `MDot(Vec<Ref>)` variant is why `G::Property` is not trivially
non-dropping.

## Current Source Routing

The source already distinguishes the risky cases:

- Object literals use `E::Object { properties: G::PropertyList }`, where
  `PropertyList = Vec<G::Property, AstAlloc>`. The parser path
  `parse_prefix.rs` builds these with default `ts_metadata`, because
  decorator metadata is a class-property feature, not an object-literal
  feature.
- Class bodies use `G::Class { properties: StoreSlice<Property> }`, not
  `G::PropertyList`. Class properties are where `emitDecoratorMetadata` can
  produce `MDot(Vec<Ref>)`.
- The bundler has already annotated the distinction. For example,
  `transpiler.rs` warns that `--define` object-literal JSON is held across
  store resets, and `doStep5.rs` explicitly re-owns `G::Property` lists on the
  global heap because `G::Property` is not `Copy`.

## Residual Risk

The arena policy is still a sharp edge:

- A future `Vec<T, AstAlloc>` with a soundness-critical `Drop` payload would be
  a bug.
- A future object-literal `G::PropertyList` path that stores `MDot(Vec<Ref>)`
  and relies on destructor execution would leak the inner vector.
- Bitwise-copying `G::Property` remains dangerous unless the call site proves
  the copied value carries no owned heap state. Existing comments in
  `generateCodeForFileInChunkJS.rs` correctly name this invariant.

So `EXP-066` (`BumpDrop<T>` / a compile-time `AstAlloc` payload policy) remains
valuable as preventive hardening, but it should not be sold as closing a
currently proven UB bug.
