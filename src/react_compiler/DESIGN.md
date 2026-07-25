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

New symbols (`$`, `t0`, `c`, `_c`) are minted via the `SymbolHost` trait
implemented by the parser's `P`; the import of `react/compiler-runtime` is
registered via `SymbolHost::add_import_record`.

### Bail-out semantics

Any `bun_ast` node the port cannot lower (bundler-only synthetics: `ESpecial`,
`EInlinedEnum`, `ERequireMain`, …) returns a `CompilerError` from `lower()`
with category `Unsupported`. `program.rs` catches that per-function, leaves the
original `G::Fn` untouched, and logs a `CompileSkip` event — exactly what
upstream does for its own unsupported cases.

## Hook placement

The compiler runs **per-function, post-visit** at the `S::Function` /
`S::Local` / `S::ExportDefault` arms of `visit_stmt.rs` (the same hook sites
as React Fast Refresh). At that point the visit pass has already consumed all
`scopes_in_order` entries for the function's interior, every `Ref` is a
resolved `RefTag::Symbol`, and JSX has been lowered to
`E::Call { was_jsx_element: true }`. Lowering reads that call shape and
codegen emits it, so the compiled body needs no further visiting.
