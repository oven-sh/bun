# `bun_ast` unification refactor

Goal: one `Expr` type, clean crate graph, no shims.

## Final crate graph

```
bun_ast  (Loc/Log/Source + full Expr/Stmt/Binding/Symbol/Scope/Op + lexer_tables + Store)
  ◄─ bun_parsers      (json/json5/toml/yaml — was bun_interchange)
  ◄─ bun_css
  ◄─ bun_js_parser    (lexer + parser + visit/lower passes ONLY)
  ◄─ bun_js_printer
  ◄─ bun_install / bun_bunfig / bun_ini / bun_sourcemap / bun_resolver / bun_dotenv
  ◄─ bun_ast_jsc      (was bun_logger_jsc)

bun_bundler ─► {bun_js_parser, bun_js_printer, bun_css, bun_parsers, bun_resolver, bun_ast}
              owns BundledAst, DefineData JSON-parse, AllowUnresolved glob
```

`bun_js_parser`, `bun_js_printer`, `bun_css`, `bun_parsers` are **siblings** — zero edges between them.

## File → crate map

### → `src/ast/` (new crate `bun_ast`)

From `src/logger/`:
- `lib.rs` (Loc, Range, Log, Msg, MsgData, Source, fs::Path, Indentation) — **minus** `js_ast` mod + re-exports at L3360-3373
- everything else in `src/logger/*.rs`

From `src/js_parser/ast/`:
- `E.rs` `Expr.rs` `S.rs` `Stmt.rs` `B.rs` `Binding.rs` `G.rs` `Op.rs`
- `base.rs` `Scope.rs` `Symbol.rs` `CharFreq.rs` `Ref.rs` (if separate; else in base/mod)
- `NewStore.rs` `ASTMemoryAllocator.rs`
- `TS.rs` `UseDirective.rs` `ServerComponentBoundary.rs`
- `foldStringAddition.rs` `KnownGlobal.rs`
- `Ast.rs` (sever `crate::parser::Runtime` — Runtime moves too)
- `mod.rs` (split: data re-exports stay, parser-pass mod decls go back to js_parser)

From `src/js_parser/`:
- `lexer_tables.rs` (keyword/identifier tables — printer/renamer needs them)
- `runtime.rs` (Runtime feature enum — `Ast` field type)
- `flags` module (wherever it lives — `G.rs`/`B.rs` import `crate::flags`)

`bun_ast` Cargo deps: `bun_alloc bun_core bun_collections bun_paths bun_string bun_sys bun_wyhash` (= `bun_logger`'s deps today). **No** css/glob/http_types/options_types.

### → `src/bundler/`
- `src/js_parser/ast/BundledAst.rs` → `src/bundler/bundled_ast.rs` (brings `bun_css::BundlerStyleSheet` field + `MimeType::by_extension`)
- `DefineData::from_input` JSON body (from `js_parser/lib.rs:~2188`) merges into `src/bundler/defines.rs`
- `AllowUnresolved` glob matcher: `bun_js_parser` keeps the enum but `Patterns` arm stores `Box<dyn Fn(&[u8]) -> bool + Send + Sync>`; `bun_bundler` constructs it with `|s| bun_glob::r#match(p, s).matches()`

### → `src/js_parser_jsc/`
- macro blob→Expr helper (`parse_for_macro` caller in `Expr.rs:~155-180`)

### → `src/parsers/` (renamed from `src/interchange/`)
- `git mv src/interchange src/parsers`; crate name `bun_parsers`
- produces `bun_ast::Expr` directly (the one true enum)

### → `src/ast_jsc/` (renamed from `src/logger_jsc/`)
- `git mv src/logger_jsc src/ast_jsc`; crate name `bun_ast_jsc`

### Stays in `src/js_parser/` — and `ast/` subdir is **deleted**

After data types leave, nothing remaining is "AST"; it's the parser body.
Reorganize (git mv, snake_case):

```
src/js_parser/
  lib.rs  lexer.rs  defines.rs  defines_table*.rs
  p.rs                  # ast/P.rs — Parser state struct
  parse/
    mod.rs              # ast/parse.rs + ast/Parser.rs
    stmt.rs prefix.rs suffix.rs property.rs fn_.rs
    import_export.rs jsx.rs typescript.rs skip_typescript.rs
  visit/
    mod.rs expr.rs stmt.rs binary.rs
  lower/
    decorators.rs       # ast/lowerDecorators.rs
    esm_exports_hmr.rs  # ast/ConvertESMExportsForHmr.rs
  scan/
    imports.rs side_effects.rs symbols.rs
  fold.rs               # ast/maybe.rs
  typescript.rs         # ast/TypeScript.rs
  repl_transforms.rs
```

`src/js_parser/ast/` directory removed. `crate::ast::` paths inside these
files become `crate::` / `crate::parse::` / `bun_ast::` as appropriate.
Sibling `.zig` spec files move alongside their `.rs` (same basename, new dir).

`bun_js_parser` Cargo deps after: `bun_ast bun_alloc bun_core bun_collections bun_crash_handler bun_highway bun_io bun_options_types bun_paths bun_string bun_url bun_wyhash bun_dispatch bun_base64`. **Drops** `bun_css bun_glob bun_http_types bun_interchange bun_logger`.

`bun_js_printer` Cargo deps after: `bun_ast bun_alloc bun_core bun_collections bun_crash_handler bun_io bun_options_types bun_paths bun_sourcemap bun_string bun_sys`. **Drops** `bun_js_parser bun_logger`.

## `Indentation` (cycle-break cleanup)

`bun_logger::js_printer::options::Indentation` was a TYPE_ONLY MOVE_DOWN so the
JSON lexer could record tab-vs-space without depending on the printer. It's a
property of source text, not of printing. Canonical home:

- `bun_ast::{Indentation, IndentationCharacter}` — defined next to `Source`
- `bun_ast::js_printer` module → **deleted** (no `js_printer` namespace in `bun_ast`)
- `bun_js_printer::Options.indent: bun_ast::Indentation` — direct use, no re-export
- `runtime/cli/pm_pkg_command.rs` `convert_indentation()` → deleted (was identity)
- importers (`parsers/json_lexer.rs`, `parsers/json.rs`,
  `install/PackageManager/WorkspacePackageJSONCache.rs`,
  `runtime/cli/pm_version_command.rs`) → `use bun_ast::Indentation`

## Deletes

- `src/logger/js_ast.rs` (1323 lines — the T2 subset enum)
- `src/js_parser/ast/Expr.rs:~1156-1260` `impl From<logger::js_ast::expr::Data> for Data` + `impl From<logger::js_ast::Expr> for Expr`
- `src/bun_alloc/ast_alloc.rs` `GlobalHeapScope` (sole purpose was the T2→T4 lift)
- `src/install/lib.rs:~77-160` `trait JsonExprView` + both impls
- `src/js_parser/lib.rs` `json_data_to_expr_data` / `json_data_is_primitive_literal`
- `src/logger/lib.rs:3360-3373` js_ast mod decl + re-exports
- All `// MOVE_DOWN(b0)` / `// T2→T4` / `b2-ast-unify` comments referencing the split

## Import rewrite rules (tree-wide, ~300 files)

Order matters — most specific first:

```
bun_logger::js_ast::expr::Data       → bun_ast::ExprData
bun_logger::js_ast::expr::           → bun_ast::expr::
bun_logger::js_ast::                 → bun_ast::
bun_logger::ast::                    → bun_ast::
bun_logger::ExprNodeList             → bun_ast::ExprNodeList
bun_logger::                         → bun_ast::
bun_interchange::                    → bun_parsers::
bun_logger_jsc::                     → bun_ast_jsc::
use bun_logger as logger             → use bun_ast as logger        # keep `logger::` local alias for Loc/Log churn-min
use bun_interchange                  → use bun_parsers
bun_js_parser::ast::{E,Expr,ExprData,S,Stmt,StmtData,B,Binding,G,Op,Scope,Symbol,Ref,StoreRef,StoreSlice,StoreStr,CharFreq,ExprNodeList,StmtNodeList,LocRef,Ast} → bun_ast::{same}
bun_js_parser::{Expr,ExprData,Stmt,Ref,Symbol,E,S,G,B,Op,...}       → bun_ast::{same}
bun_js_parser::lexer_tables::        → bun_ast::lexer_tables::
bun_js_parser::lexer::is_identifier  → bun_ast::lexer_tables::is_identifier  # if renamer uses it
```

Inside moved files: `use crate::parser::` / `use crate::lexer` references that survived the split mean the file was misclassified — move it back to `js_parser`.

## Semantic fixes (hand-edit, ~15 sites)

- ~10× `.root.into()` → `.root` in `runtime/cli/{update_interactive,pm_version,pm_view,init,pack,publish,create,pm_trusted}_command.rs`, `install/pnpm.rs`, `install/PackageManager/updatePackageJSONAndInstall.rs`
- `js_printer/lib.rs:661` `RuntimeTranspilerCacheRef` → `NonNull<c_void>` (or move type to `bun_ast`)
- `js_printer/renamer.rs` `use bun_js_parser::lexer as js_lexer` → `use bun_ast::lexer_tables as js_lexer` (only `is_identifier`/reserved-word fns)
- `bun_install` / `bun_bunfig` / `bun_ini` matches on `ExprData`: add `_ => unreachable!("non-value Expr from JSON parser")` fallthrough where they were previously exhaustive over 8 variants
- `interchange/json.rs:1289` test `expect_printed_json` — `js_printer` is no longer reachable from `bun_parsers`; move test to `js_printer` or gate `#[cfg(test)]` dev-dep

## Verify

```sh
cargo check -p bun_ast
cargo check -p bun_parsers -p bun_css -p bun_js_parser -p bun_js_printer
cargo check --workspace
bun bd
bun bd test test/cli/install test/bundler/bundler_edgecase.test.ts test/js/bun/util/json5.test.ts
```
