---
description: Re-sync src/react_compiler/ against upstream facebook/react. Use when bumping the React Compiler, when upstream lands a fix we need, or when src/react_compiler/UPSTREAM_PORTED is stale.
---

# Re-syncing the React Compiler

Bun integrates the React Compiler by **directly lowering Bun's AST into the
compiler's HIR** and **directly emitting Bun's AST from codegen**, skipping
upstream's Babel-shaped `react_compiler_ast` intermediate entirely. Nothing is
vendored — every upstream crate Bun uses has been ported into
`src/react_compiler/` and is built as part of the `bun_react_compiler` crate.

There are two kinds of port:

- **Whole-crate ports** (`hir/`, `diagnostics/`, `ssa/`, `inference/`,
  `typeinference/`, `optimization/`, `validation/`, `reactive_scopes/`,
  `utils/`) — byte-for-byte copies of the upstream crate's `src/`, modulo
  crate-name/import rewrites. Upstream diffs apply mechanically.
- **AST-boundary ports** (`lowering/build_hir/`, `lowering/*.rs`, `codegen.rs`,
  `pipeline.rs`, `program.rs`, `imports.rs`, `compile_result.rs`) — re-typed
  onto `bun_ast` using the mapping in `src/react_compiler/DESIGN.md`. Upstream
  diffs are re-ported by hand. Upstream's `gating.rs` is folded into
  `program.rs`; `suppression.rs` is handled by the lexer
  (`js_parser/lexer.rs`) and consumed in `program.rs`;
  `identifier_loc_index.rs` is not needed because Bun's `Ref` already
  provides binding identity.

`react_compiler_ast`, `react_compiler_lowering`, and the `react_compiler`
umbrella crate are **not** in Bun's tree at all — they exist upstream only as
the porting reference for the AST-boundary files.

## Sync procedure

1. **Produce the upstream diff.** The script sparse-fetches facebook/react into
   a temp dir (nothing is written to the repo) and prints, per ported file, the
   diff between `src/react_compiler/UPSTREAM_PORTED` and upstream's tip:
   ```sh
   scripts/sync-react-compiler.sh            # or pass an explicit <sha>
   ```
   Output is grouped into three sections: whole-crate ports, AST-boundary
   ports, and any new upstream file that newly references `react_compiler_ast`
   (i.e. a new boundary file that needs a fresh Bun port).

2. **Apply whole-crate diffs mechanically.** For each hunk under the
   whole-crate section, apply it to the corresponding `src/react_compiler/<dir>/`
   file. The only systematic edit is import paths (`react_compiler_hir::` →
   `crate::hir::`, etc.); everything else lands verbatim.

3. **Re-port AST-boundary diffs by hand.** For each hunk under the
   AST-boundary section, re-port it into the named Bun file using the
   type-mapping table in `src/react_compiler/DESIGN.md`: where upstream reads
   `react_compiler_ast::expressions::Expression::Foo`, the Bun port reads
   `bun_ast::expr::Data::EFoo`; where upstream constructs
   `react_compiler_ast::statements::Statement::Foo { … }`, the Bun port calls
   `Stmt::alloc(S::Foo { … }, loc)`. Keep control flow, pass ordering,
   variable names, and comments 1:1 with upstream — only the AST reads/writes
   change.

   For large diffs, fan out one agent per file with the upstream diff + the Bun
   port + DESIGN.md as context, then adversarially review each port.

4. **Handle new boundary files.** If the third section lists any file, write a
   fresh Bun port of it under `src/react_compiler/`, add it to both arrays in
   `scripts/sync-react-compiler.sh`, and add a row to the layout table in
   `DESIGN.md`.

5. **Verify.**
   ```sh
   cargo check -p bun_react_compiler
   bun bd test test/bundler/transpiler/react-compiler.test.ts
   ```
   Snapshots will change if codegen changed upstream — review the diff against
   upstream's new fixture output and update with `bun bd test -u` if it
   matches.

6. **Update the port marker** to the `UPSTREAM_HEAD` the script printed:
   ```sh
   echo <new-sha> > src/react_compiler/UPSTREAM_PORTED
   ```
