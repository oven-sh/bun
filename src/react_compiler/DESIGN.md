# bun_react_compiler — direct-lowering design

Bun runs the upstream React Compiler **without** the Babel-shaped
`react_compiler_ast` intermediate. Bun's parser already produces a fully
resolved AST (every identifier is a `Ref` into a symbol table, every scope is
linked); we lower that AST straight into the compiler's HIR, run the upstream
HIR passes unmodified, and emit Bun AST nodes straight from the
`ReactiveFunction` codegen.

```text
bun_ast::Stmt[]  ──►  lowering/ (this crate)  ──►  HirFunction
                                                     │
                          ┌──────────────────────────┘
                          ▼
                 ssa/
                 typeinference/                   (whole-crate ports,
                 inference/                        byte-for-byte upstream)
                 validation/
                 optimization/
                 reactive_scopes/ (all passes)
                          │
                          ▼
                 ReactiveFunction
                          │
codegen.rs (this crate)   ▼
                 bun_ast::G::Fn { args, body }
```

## Layout

Everything lives in this crate; nothing is vendored. Each file is either a
**whole-crate port** (upstream `src/` copied byte-for-byte, only import paths
rewritten) or an **AST-boundary port** (re-typed onto `bun_ast`).

| Upstream                                                                        | Bun port (`src/react_compiler/`)       | Kind                                                                                   |
| ------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| `react_compiler_hir/src/`                                                       | `hir/`                                 | whole-crate                                                                            |
| `react_compiler_diagnostics/src/`                                               | `diagnostics/`                         | whole-crate                                                                            |
| `react_compiler_ssa/src/`                                                       | `ssa/`                                 | whole-crate                                                                            |
| `react_compiler_inference/src/`                                                 | `inference/`                           | whole-crate                                                                            |
| `react_compiler_typeinference/src/`                                             | `typeinference/`                       | whole-crate                                                                            |
| `react_compiler_optimization/src/`                                              | `optimization/`                        | whole-crate                                                                            |
| `react_compiler_validation/src/`                                                | `validation/`                          | whole-crate                                                                            |
| `react_compiler_reactive_scopes/src/`                                           | `reactive_scopes/`                     | whole-crate (all passes EXCEPT `codegen_reactive_function.rs`)                         |
| `react_compiler_utils/src/`                                                     | `utils/`                               | whole-crate                                                                            |
| `react_compiler_lowering/build_hir.rs`                                          | `lowering/build_hir/`                  | AST-boundary — reads `bun_ast::{Expr,Stmt,Binding}` instead of `react_compiler_ast::*` |
| `react_compiler_lowering/hir_builder.rs`                                        | `lowering/hir_builder.rs`              | AST-boundary — `Builder` holds `&[Symbol]`/`&Scope` instead of `&ScopeInfo`            |
| `react_compiler_lowering/find_context_identifiers.rs`                           | `lowering/find_context_identifiers.rs` | AST-boundary — walks `bun_ast`                                                         |
| `react_compiler_lowering/identifier_loc_index.rs`                               | — (not ported)                         | Ref already provides binding identity; lookup is by `Ref`, not `(u32, String)`         |
| `react_compiler_reactive_scopes/codegen_reactive_function.rs`                   | `codegen.rs`                           | AST-boundary — emits `bun_ast::{Expr,Stmt,Binding}`                                    |
| `react_compiler/entrypoint/pipeline.rs`                                         | `pipeline.rs`                          | AST-boundary — calls our `lower` + HIR passes + our `codegen`                          |
| `react_compiler/entrypoint/program.rs`                                          | `program.rs`                           | AST-boundary — walks `&[Stmt]`, finds candidate components/hooks                       |
| `react_compiler/entrypoint/{imports,compile_result}.rs`                         | same names                             | AST-boundary — small; emit/read `bun_ast`                                              |
| `react_compiler/entrypoint/gating.rs`                                           | — (folded into `program.rs`)           | dynamic-gating directive parsing lives alongside candidate selection                   |
| `react_compiler/entrypoint/suppression.rs`                                      | — (not ported)                         | eslint-disable detected in `js_parser/lexer.rs`, consumed in `program.rs`              |
| `react_compiler_ast`, `react_compiler_lowering` (rest), `react_compiler` (rest) | —                                      | **not in tree** — upstream-only porting reference                                      |

`validate_source_locations.rs` and `fixture_utils.rs` are upstream test/debug
helpers — **not ported**.

## Porting rules

The port is mechanical: the upstream file's control flow, pass ordering,
variable names, and comments stay 1:1. **Only** the AST reads/writes change.
Keep the diff between upstream and the port as small as the type substitution
allows — the `/sync-react-compiler` skill re-ports upstream changes hunk by
hunk, so gratuitous restructuring makes that harder.

### Type mapping (input: lowering)

| upstream `react_compiler_ast`                                            | `bun_ast`                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `Expression`                                                             | `Expr` (`expr::Data`)                                                          |
| `Statement`                                                              | `Stmt` (`stmt::Data`)                                                          |
| `PatternLike`                                                            | `Binding` (`b::B`)                                                             |
| `Identifier { name, .. }`                                                | `Ref` → `symbols[ref.inner_index()].original_name`                             |
| `BaseNode { start, node_id, .. }`                                        | `Loc { start: i32 }` (no node_id — use `Ref` for identity)                     |
| `ScopeInfo` / `BindingId`                                                | `&[Symbol]` + `&Scope` tree; binding identity is `Ref`                         |
| `FunctionDeclaration` / `FunctionExpression` / `ArrowFunctionExpression` | `G::Fn` / `E::Arrow` (`FunctionNode<'a>` enum wraps a `&G::Fn` or `&E::Arrow`) |
| `BlockStatement.body: Vec<Statement>`                                    | `G::FnBody.stmts: StoreSlice<Stmt>`                                            |
| `BinaryExpression`/`LogicalExpression`/`AssignmentExpression`            | one `EBinary` with `OpCode` discriminant                                       |
| `MemberExpression { computed }`                                          | `EDot` (computed=false) / `EIndex` (computed=true)                             |
| `OptionalMemberExpression`/`OptionalCallExpression`                      | `optional_chain: Option<OptionalChain>` on `EDot`/`EIndex`/`ECall`             |
| `JSXElement` / `JSXFragment`                                             | one `EJsxElement` (`tag: None` = fragment)                                     |
| `VariableDeclaration`                                                    | `S::Local`                                                                     |
| `StringLiteral.value: JsString`                                          | `E::EString` (`data: StoreStr` UTF-8, or `data16` for UTF-16)                  |

**Scope/binding resolution.** Upstream's `ScopeInfo` is a flat table the
Babel/OXC frontends build separately. Bun's parser already resolved every
reference: an `EIdentifier`/`EImportIdentifier` carries a `Ref`, and
`symbols[ref.inner_index()]` gives the `Symbol { original_name, kind, .. }`.
So where upstream does `scope_info.get_binding(scope, name)`, the port does a
direct `Ref` comparison or `symbols[ref]` lookup. The `Builder` carries
`symbols: &[Symbol]`, `module_scope: &Scope`, and `import_records:
&[ImportRecord]` instead of `scope_info: &ScopeInfo`.

**SourceLocation.** Upstream's HIR `SourceLocation` is `{ start: Position,
end: Position }`. Bun's `Loc` is start-only. The port constructs
`SourceLocation { start: loc.start, end: loc.start }` (the compiler uses end
only for diagnostic span width).

### Type mapping (output: codegen)

| upstream emits                             | Bun port emits                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `Expression::Identifier(Identifier{name})` | `Expr::init_identifier(ref_, loc)` — `ref_` from `Builder.declare_temporary(name)` |
| `Statement::VariableDeclaration`           | `Stmt::alloc(S::Local { kind, decls, .. }, loc)`                                   |
| `Statement::ExpressionStatement`           | `Stmt::alloc(S::SExpr { value, .. }, loc)`                                         |
| `BlockStatement { body }`                  | `G::FnBody { stmts: StoreSlice<Stmt>, loc }`                                       |
| `Expression::CallExpression`               | `Expr::init(E::Call { target, args, .. }, loc)`                                    |
| `Expression::ArrayExpression`              | `Expr::init(E::Array { items, .. }, loc)`                                          |
| `Expression::JSXElement`                   | `Expr::init(E::JSXElement { tag, properties, children, .. }, loc)`                 |
| `PatternLike::ArrayPattern`                | `Binding::alloc(arena, b::Array { items, .. }, loc)`                               |

Node allocation uses the thread-local store (`Expr::init`, `Stmt::alloc`) so
nodes land in the parser's arena. `Binding` and slice/string copies need an
explicit `&Arena` (the `Codegen` context carries one).

New symbols (`$`, `t0`, `c`, `_c`) are minted via the `Host` trait
implemented by the parser's `P`; the import of `react/compiler-runtime` is
registered via `Host::add_import_record`.

Every local of a compiled function is a new symbol, also one the source
declared. `Host::new_local` registers it in the body scope of that function
(`Scope::generated`), and once the body is replaced the parser drops the
symbols it declared for the old one (all but `arguments` and the own name of a
function expression). The bundler's renamer then numbers the new symbols like
the locals of any other function. `Host::new_generated` is for a name declared
at module level, such as an outlined `_temp`.

### The compiler as a linter

`bun lint` has the validations as rules (`react/refs`, `react-hooks/refs`, ...). `lint.rs` is upstream's
`outputMode: 'lint'` for one function: lowering, the passes, all validations, no codegen, and every
error that upstream would log. The function comes from `src/lint/react_compiler/convert.rs`, which
makes a `bun_ast` tree of the linter's own syntax tree, without a visit pass. In that tree a `Loc` is
an index into a table of ranges, so that what is reported has an end, and
`Host::is_module_level` says what is bound outside of the function.

### Bail-out semantics

Any `bun_ast` node the port cannot lower (bundler-only synthetics: `ESpecial`,
`EInlinedEnum`, `ERequireMain`, …) returns a `CompilerError` from `lower()`
with category `Unsupported`. `program.rs` catches that per-function, leaves the
original `G::Fn` untouched, and logs a `CompileSkip` event — exactly what
upstream does for its own unsupported cases.

A function that is nested more deeply than the thread has the stack for bails out the same way, with the
Todo "Support functions of this size". Every function of the compiler that calls itself along the nesting
of the source asks `Environment::has_stack()`, and the pipeline asks after each pass whether one has said no.

### A store through a join

InferMutationAliasingRanges walks from each store, and from each call that may store, to every value that it can
change. Those values get one memo block with it. Upstream's walk passes over an entry for a node that it has come to
before with the same kind. But an entry does not do the same at a node as every other: only a transitive one goes on
to what a container holds, and one that came along an edge into a join does not go on to the other values of the join.
So the walk can pass over the one entry that would have gone on:

- `const first = w[0]; const y = c ? first : w; y.n = 1;` The walk comes to `w` as a value of `y`. It then passes over
  `w` as what `first` was read from, and does not come to what `w` holds.
- `const p = c ? a : b; const z = d ? p : a; z.n = 1;` The walk comes to `p` along the edge from `a`. It then passes
  over `p` as a value of `z`, and does not come to `b`.

Such a value keeps a memo block of its own, and each render runs the store again on the value of the first render.
Which operand the walk comes to first decides it: upstream is right with the operands the other way round.

With `EnvironmentConfig::missed_values_are_refused` such a function is not compiled: it gets the Todo "Support a
store through a local that is one of several values" and is left as written. The switch is on, but for `bun lint`,
which reports what the tools report. Every function that is compiled is compiled as without the switch: upstream's
walk is as it was, and no mark and no range changes.

- After the walk of a store, `AliasingState::note_missed_values` walks from the same place once more, against the
  edges alone: to what the place can be, to what that was read from, and for a transitive arrival to what it holds.
  It passes over a node only where it has come to it the same way before, as local or as transitive. It notes each
  value that the walk of the store did not come to (`Environment::missed_values`).
- It does not go along an edge as upstream's walk does. Along an edge a walk can come back to where it was:
  `w.push(k)` reads `push` out of `w`, and the walk of the store into `w` comes from that read back to `w` as a
  transitive arrival. Upstream passes that over in every order, and so a `push` changes the array alone.
- When the scopes are known, `refuse_a_store_after_the_scope_of_a_missed_value` refuses the function if such a value
  has a scope that ends before the store. A value with no scope is not cached, and a value in the scope of the store
  is made again whenever the store runs. The first of the gaps below is where that is not enough.
- Only a store is judged, and only in the outermost function. The callback of `useMemo` and a function that is
  called where it stands are a part of that function by then. A call that may store and a store in another function
  expression miss values the same way, and stay as in upstream (`react-compiler/CallThatMayStoreThroughAJoin`,
  `react-compiler/StoreThroughAJoinInAFunction`).

The second walk could mark what it comes to, so that the store and the value share a memo block. An earlier form of
the rule did. The block of the store is then longer, and a component that is right today turns wrong where it has
another store that the walk misses too: the values that the longer block makes are cached with it, and that store
runs again on them. A function that is left as written cannot turn wrong.

`react-compiler/StoreReachesEachValueOfAJoin` in `test/bundler/transpiler/react-compiler.test.ts` has a component for
each of these. `a function with a store through a join is compiled as before or not at all`, in that file, builds a
product of such components with and without the switch. The rule can go when upstream's walk comes to these values.

The rule does not see a value that the container got in a statement of its own (`w.push(x)`, `tree.child = leaf`).
The statement gave the value to a read of the container, and the second walk comes to that read only along an edge
(`react-compiler/StoreReachesWhatAValueOfAJoinWasGiven`).

A review found these gaps, and they are open:

- A value in the scope of the store can be stale all the same. An inner memo block of that scope can lose its
  dependency on the value: PruneNonReactiveDependencies visits the inner block before it marks what the outer block
  declares. The component below is compiled, and its store goes to the `totals` of an earlier render. A check of the
  range of the value in place of its scope refuses that function. It also leaves more functions as written that are
  right.

  ```js
  function Totals({ items, pick, extra }) {
    const totals = { count: 0 };
    const seen = [];
    totals.label = "all";
    const holder = { totals };
    const target = pick ? holder.totals : holder;
    target.count += items.length;
    seen.push(extra);
    return <b data-holder={holder}>{totals.count + "/" + seen.length}</b>;
  }
  ```

- `Environment::missed_values` has a record for each store and each value that its walk misses. One record for a
  value is enough, with the last such store.
- A function that is left as written takes its outlined functions with it, so the outlined functions of a later
  function of the file get other numbers.

## Hook placement

The compiler runs **per-function, post-visit** at the `S::Function` /
`S::Local` / `S::ExportDefault` arms of `visit_stmt.rs` (the same hook sites
as React Fast Refresh). At that point the visit pass has already consumed all
`scopes_in_order` entries for the function's interior, every `Ref` is a
resolved `RefTag::Symbol`, and JSX has been lowered to
`E::Call { was_jsx_element: true }`. Lowering reads that call shape and
codegen emits it, so the compiled body needs no further visiting.

The visit pass emits two call shapes. The automatic runtime calls
`jsx(type, {...props, children}, key)` (or `jsxs` / `jsxDEV`). The classic
runtime, and the automatic runtime when `key` follows a spread, calls
`factory(type, props | null, ...children)` with `key` left in `props`. The two
overlap in arity, so lowering tells them apart by the callee
(`Host::jsx_import_kind`), and codegen picks the shape the visit pass would
(`Host::is_jsx_classic`, and whether the HIR `key` attribute follows a spread).
The callee is not an operand of the HIR `JsxExpression`: codegen resolves the
classic factory again (`Host::jsx_classic_factory`). Lowering rejects a factory
that is a local of the function, because the compiler would drop it as unused.
