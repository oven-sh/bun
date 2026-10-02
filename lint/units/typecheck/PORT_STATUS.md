# Port status of the typecheck unit

One row per upstream file or function group of microsoft/typescript-go 89d5d5b (`/workspace/ref/typescript-go/internal`).
States: `not started`, `ported` (translated, compiles), `tested` (a test compares it with what upstream's code answers,
or is upstream's own test). "Not ported" in the last column names what the row leaves out, with the reason in API.md.

## Leaf packages

Commit `1e45ca9abb`. `ported` and `tested` below mean compiled and run with `rustc` alone from the scratch root of
`leaf-packages-scratch/port/` (API.md, "Verified"). Cargo compiles a package in the real crate from the commit that
declares it in `lib.rs`:

- `collections`: declared by `65ab2f65bc` (`pub mod collections;`, its six files are unchanged since `1e45ca9abb`).
  No `cargo check` and no `cargo test` was run with that commit: the survey of round 2
  (`/workspace/notes/lint/tools/typecheck-survey.sh`) is the first cargo compile of the six files, and their tests
  have run from the scratch root only.
- `core`: declared by `80dcacd6db` (`pub mod core;`; its 18 files are unchanged since `404d95dbe9`, which added
  `nodemodules.rs` and its two lines of `mod.rs` to the 17 files of `1e45ca9abb`). It names `crate::stringutil`,
  `crate::tspath` and `crate::collections`, so it compiles only in a tree whose `lib.rs` declares those three as
  well: `80dcacd6db` is the first commit whose `lib.rs` declares all five leaf packages, as the scratch root does.
  No `cargo check` and no `cargo test` was run with that commit: the survey of round 2 is the first cargo compile of
  the 18 files, and their tests have run from the scratch root only. `0aa0a67449` adds a 19th file, `golang.rs`
  (`GoIndex` and `List`: no upstream file, `std` only), and its two lines of `mod.rs`: the last `core` row of the
  table, with its state under "Node table" below. `a9b14ab2d6` adds `Text` to that file ("Binder" below).
- `jsnum`: declared by `80dcacd6db` (`pub mod jsnum;`, its four files are unchanged since `1e45ca9abb`). It names
  `crate::stringutil`, which the same commit declares. The line was written without a cargo run: the survey of
  round 2 is the first cargo compile of the four files, and the seven tests of `jsnum` have run from the scratch
  root only.
- `stringutil`: declared by `80dcacd6db` (`pub mod stringutil;`, its seven files are unchanged since `1e45ca9abb`).
  It names no other package. No `cargo check` and no `cargo test` was run with that commit: the survey of round 2 is
  the first cargo compile of the seven files, and the seven tests of `stringutil` have run from the scratch root
  only. Compared with upstream at that commit, entry for entry and equal: the four range tables and the 2,927 rows
  of the casing table against `identifier_parts_generated.go` and `js_case_generated.go`.
- `tspath`: declared by `c1d548ae4e` (`pub mod tspath;`, its three files are unchanged since `1e45ca9abb`). It names
  `crate::stringutil`, so it compiles only in a tree whose `lib.rs` declares `stringutil` as well. No `cargo check`
  and no `cargo test` was run with that commit: the survey of round 2 is the first cargo compile of the three files,
  and the three tests of `tspath/path.rs` have run from the scratch root only.

| upstream file, lines | Rust module under `src/typecheck/` | state | not ported |
| --- | --- | --- | --- |
| `core/core.go` 36-388 (slice helpers `Filter` to `AppendIfUnique`) | `core/core.rs` | tested (own tests: Go's answers written by hand) | |
| `core/core.go` 389-426 (`Memoize`, `IfElse`, `OrElse`, `Coalesce`) | `core/core.rs` | tested (own tests) | |
| `core/core.go` 428-508 (`ComputeECMALineStarts`, `PositionToLineAndByteOffset`, `UTF16Len`, `Flatten`) | `core/core.rs` | tested | |
| `core/core.go` 527-569 (script kind of a file name) | `core/core.rs` | tested | |
| `core/core.go` 571-706 (spelling suggestion, `levenshteinWithMax`, `Identity`) | `core/core.rs` | tested | the `sync.Pool` |
| `core/core.go` 708-763 (`CheckEachDefined`, `IndexAfter`, `ShouldRewriteModuleSpecifier`, `SingleElementSlice`, `ConcatenateSeq`, `Enumerate`) | `core/core.rs` | tested | |
| `core/core.go` 813-876 (`UnorderedEqual`, `Deduplicate`, `DeduplicateSorted`, `CompareBooleans`) | `core/core.rs` | tested (own tests) | |
| `core/core.go` 24-34, 510-525, 765-811 | | not ported | `ApplyDebugStackLimit`, `Must`, `FirstResult`, `StringifyJson`, `comparableValuesEqual`, `DiffMaps`, `DiffMapsFunc`, `CopyMapInto` |
| `core/compileroptions.go` 16-161 (`CompilerOptions`, 131 fields) | `core/compileroptions.rs` | ported | `noCopy` |
| `core/compileroptions.go` 174-373 (`EmptyCompilerOptions`, the 23 methods of `CompilerOptions`) | `core/compileroptions.rs` | tested | `Clone` by reflection is `derive(Clone)` |
| `core/compileroptions.go` 375-557 (`ModuleDetectionKind`, `ModuleKind`, `ResolutionMode`, `ModuleResolutionKind`, `NewLineKind`, `ScriptTarget`, `JsxEmit` and their methods) | `core/compileroptions.rs` | tested | |
| `core/text.go` | `core/text.rs` | tested (own tests) | |
| `core/tristate.go`, `tristate_stringer_generated.go` | `core/tristate.rs`, `core/tristate_stringer_generated.rs` | tested | |
| `core/arena.go` | `core/arena.rs` | tested (own tests) | pages: one buffer, indexes |
| `core/linkstore.go` | `core/linkstore.rs` | tested (own tests) | |
| `core/stack.go` | `core/stack.rs` | tested (own tests) | |
| `core/pattern.go` | `core/pattern.rs` | tested | |
| `core/binarysearch.go` | `core/binarysearch.rs` | tested (own tests) | |
| `core/scriptkind.go`, `scriptkind_stringer_generated.go` | `core/scriptkind.rs`, `core/scriptkind_stringer_generated.rs` | tested | |
| `core/languagevariant.go`, `languagevariant_stringer_generated.go` | `core/languagevariant.rs`, `core/languagevariant_stringer_generated.rs` | tested | |
| `core/modulekind_stringer_generated.go`, `scripttarget_stringer_generated.go` | `core/modulekind_stringer_generated.rs`, `core/scripttarget_stringer_generated.rs` | tested | |
| `core/semaphore.go`, `core/workgroup.go` | | not ported | one checker, one thread |
| `core/bfs.go`, `buildoptions.go`, `context.go`, `projectreference.go`, `textchange.go`, `typeacquisition.go`, `version.go`, `watchoptions.go` | | not started | binder and checker do not call them |
| `core/nodemodules.go` | `core/nodemodules.rs` | tested (own test) | came in with `404d95dbe9`: `checker.go` 15206 calls `core.NodeCoreModules()` (see "K3 steps 6 to 8" below) |
| no upstream file: a Go slice as a value (`[]T` with the nil slice, a `Copy` header, `len` as Go's `int`, the zero value for an index out of range, `core.Same` as `List::same`, `s[lo:hi]` as `List::sub` with the bounds clamped), and a Go `string` that a record keeps or a function hands on (`Text<'a> = &'a [u8]`) | `core/golang.rs` (`Text`: line 5 of `checker-data-model-contract/bottom-up/crate/src/tscore/golang.rs`; `GoIndex`, `List`: lines 7 to 81 of that file, byte for byte but for the body of `List::sub`: a part of the nil list is the nil list, as Go's slice expression and as `sub_list` of `checker/types.rs` have it, where the contract's answers an empty list that is not nil; own test `list_is_a_go_slice`) | translated (`GoIndex` and `List`: commits `0aa0a67449` and `2caaa157eb`, what was checked is under "Node table" below, and the survey of round 5 compiled them with cargo; `Text`: commit `a9b14ab2d6`, which no compiler has seen, see "Binder" below) | the other values of the contract's file: `SliceBuf`, `LiveList`, `Map`, `Memo`, `compare_strings`, `compare_f64`. No file that cargo compiles names them; `checker` imports `Map`, `LiveList` and `Memo` from `crate::core`. Its `OrderedMap`, `Set`, `OrderedSet` and `Tristate` are names that `collections/` and `core/tristate.rs` have in another form |
| `collections/ordered_map.go` 15-213, 295-316 | `collections/ordered_map.rs` | tested (upstream's `TestOrderedMap`) | `noCopy` |
| `collections/ordered_map.go` 215-293 (JSON) | | not ported | `internal/json` |
| `collections/ordered_set.go` | `collections/ordered_set.rs` | tested (upstream's `TestOrderedSet`) | |
| `collections/set.go` | `collections/set.rs` | tested (own tests) | |
| `collections/multimap.go` | `collections/multimap.rs` | tested (own tests) | |
| `collections/cow.go` | `collections/cow.rs` | tested (own tests) | |
| `collections/syncmap.go`, `collections/syncset.go` | | not ported | one checker, one thread |
| `jsnum/jsnum.go` | `jsnum/jsnum.rs` (with Go's `math` and `math/big`) | tested | `trunc`, `negativeZero` (unused upstream) |
| `jsnum/string.go` | `jsnum/string.rs` (with Go's `strconv`) | tested | `errUnknownPrefix` (unused upstream) |
| `jsnum/pseudobigint.go` | `jsnum/pseudobigint.rs` | tested | |
| `stringutil/util.go` | `stringutil/util.rs` (with Go's `unicode/utf8`, `unicode/utf16`, `unicode`, `strings`) | tested | |
| `stringutil/compare.go` | `stringutil/compare.rs` | tested | |
| `stringutil/js_case.go` | `stringutil/js_case.rs` | tested | |
| `stringutil/js_case_generated.go` | `stringutil/js_case_generated.rs` (generated: `leaf-packages-scratch/port/gen_tables.py`) | tested | |
| `stringutil/identifier.go` | `stringutil/identifier.rs` | tested | |
| `stringutil/identifier_parts_generated.go` | `stringutil/identifier_parts_generated.rs` (generated, same script) | tested | |
| `stringutil/generate.go` | | not ported | `go:generate` lines only |
| `tspath/path.go` | `tspath/path.rs` | tested | |
| `tspath/extension.go` | `tspath/extension.rs` | tested | |
| `tspath/ignoredpaths.go` | | not started | binder and checker do not call it |

## Diagnostics (`diagnostics`)

`diagnostics/mod.rs`, `diagnostics/diagnostics_generated.rs` and `diagnostics/tests.rs` are the files of the contract
byte for byte (`checker-data-model-contract/bottom-up/crate/src/diagnostics/`): the constants are UPPER_SNAKE, as the 49
files of the tree that import `crate::diagnostics` spell them (589 names, all in the table). The three files and
`scripts/` came in with `2d9e7ee843`, the line `pub mod diagnostics;` of `lib.rs` with `a53def3305`. No `cargo check` and
no `cargo test` was run with those commits: the survey that follows them is the first cargo compile of the module in
the real crate, so the state below is `translated` until that run passes. What was checked before: `rustc` alone beside
the five leaf packages with the rust lints of the workspace denied (the look-ahead of the round-3 survey, a scratch
root in `/tmp`, on the same bytes); `cargo check`, `cargo clippy --all-targets`, `cargo fmt --check` and `cargo test`
(the five tests of `diagnostics/tests.rs`) of the contract crate, which holds the same bytes
(`checker-data-model-contract/bottom-up/data/run.log`); `rustfmt --check --edition 2024` on the three files in the tree.

The table is generated. `bun src/typecheck/scripts/generate-diagnostics.ts` writes it from the two files beside the
script: `scripts/diagnosticMessages.json` (TypeScript 5848bc5, `src/compiler/`) and
`scripts/extraDiagnosticMessages.json` (typescript-go 89d5d5b, `internal/diagnostics/`), copies formatted by prettier,
which the script pins by the sha256 of their parsed content. The extras win by code: 2,130 + 86 - 10 = 2,206 messages.
The script is the one of `diagnostics-scratch/crate/scripts/` with one change: a constant is upstream's variable name
in upper case (the 2,206 names stay distinct; the script fails when two collide). Run in the tree, it writes the table
of the contract byte for byte. Compared with `diagnostics_generated.go` by
`bun diagnostics-scratch/data/table-against-upstream-go.mjs`: 2,206 of 2,206 equal in name (upper case), code,
category, the three flags and text, in upstream's order; the numbers that `tests.rs` asserts (the bytes of the keys and
their hash, the bytes of the texts, the counts by category, flag and argument count) are the ones that the script
recomputes from that file. No test of the tree compares the table with what the generator writes, as
`test/internal/typecheck-ast-generated.test.ts` does for the node definitions: that test is written for the tree's
layout in `diagnostics-scratch/test/typecheck-diagnostics-generated.test.ts` (not run as a test; a script that makes its
comparison says equal). Until it is in the tree the check is the generator followed by
`git diff --exit-code src/typecheck/diagnostics`.

| upstream file, lines | Rust module under `src/typecheck/` | state | not ported |
| --- | --- | --- | --- |
| `diagnostics/diagnostics.go` 20-41 (`Category`, `Name`) | `diagnostics/mod.rs` | translated | |
| `diagnostics/diagnostics.go` 43-65 (`Key`, `Message` and its six accessors) | `diagnostics/mod.rs` (`MessageId`: the code is the id and `NIL` the nil message; category, flags and the number of arguments are one byte of `INFO`; `key()` is computed from the text) | translated | `String` |
| `diagnostics/diagnostics.go` 67-85 (`Message.Localize`, `Localize`) | `diagnostics/mod.rs` (`localize`) | translated | the lookup by key, the localized texts: `Locale` is a unit |
| `diagnostics/diagnostics.go` 87-113 (`getLocalizedMessages`) | | not ported | English only |
| `diagnostics/diagnostics.go` 115-134 (`Format`) | `diagnostics/mod.rs` (`format`, `to_valid_utf8`) | translated | the panic is `Err(InvalidPlaceholder)` and the placeholder stays in the text |
| `diagnostics/diagnostics.go` 136-150 (`StringifyArgs`) | | not ported | an argument is a byte string; `write_decimal` prints an integer for the caller that has one |
| `diagnostics/diagnostics.go` 152-159 (`NewAdHocMessage`) | `diagnostics/mod.rs` (`MessageId::AD_HOC`, code -1; the text is an argument of `localize`) | translated | |
| `diagnostics/diagnostics_generated.go` 5-4415 (the 2,206 messages) | `diagnostics/diagnostics_generated.rs` (generated) | translated | |
| `diagnostics/diagnostics_generated.go` 4417-8834 (`keyToMessage`) | | not ported | only a diagnostic read back from build info has a key and no message (`execute/incremental`) |
| `diagnostics/generate.go` 71-174, 340-361, 402-460 (`main`, `generateDiagnostics`, `readRawMessages`, `convertPropertyName`) | `scripts/generate-diagnostics.ts`; the key half of `convertPropertyName` is also `convert_property_name` of `diagnostics/mod.rs` | run (it writes the table that is in the tree) | |
| `diagnostics/generate.go` 176-338, 363-400 (`generateLocalizations`, `readLocalizedMessages`), `loc_generated.go`, `loc/` | | not ported | English only |
| `diagnostics/stringer_generated.go` | | not ported | `Category.String`, for debugging |
| `diagnostics/diagnostics_test.go` | `diagnostics/tests.rs` (`format_is_one_pass` has the three English cases of `TestLocalize`) | translated | the other locales, `TestLocalize_ByKey` |

## Faults, the stand-in log and the loop budget (`internal`, no upstream file of its own)

`internal.rs` is the file of the contract byte for byte (`checker-data-model-contract/bottom-up/crate/src/tscore/internal.rs`,
133 lines, `std::cell` only), at the path that 22 files of the tree import it from: `crate::internal` (`ast` 12,
`checker` 6, `binder` 2, `evaluator` 1, `importer` 1). Declared by `bc27b2c968` (the file, and `pub mod internal;` in
`lib.rs`). No `cargo check` was run with that commit: the survey that follows it is the first cargo compile of the file
in the real crate, so the state below is `translated` until that run passes. What was checked before: `rustc` alone
beside the five leaf packages with the rust lints of the workspace denied (the look-ahead of the round-3 survey, a
scratch root in `/tmp`); `cargo check`, `cargo clippy --all-targets` and `cargo fmt --check` of the contract crate, which
holds the same bytes (`checker-data-model-contract/bottom-up/data/run.log`); `rustfmt --check --edition 2024` on the file
in the tree. It has no test of its own: the tests that read it are in `ast/tests.rs` and `checker/c02_program_checker.rs`,
which cargo does not compile yet.

| what of upstream it stands for | items of `internal.rs` | state | not named by the tree yet |
| --- | --- | --- | --- |
| `panic`, `debug.Assert`, a failed type assertion, a read or a write through nil, a write to a nil map or to a frozen file, an id space that is used up, a second parent, a stack that Go would grow, a loop that does not end | `FaultKind` (12 kinds), `Fault { kind, message, detail, id }`, `Faults` (`record`, `count`, `first`, `snapshot`: the first 64 faults) | translated | `FaultKind::StoreBusy` |
| the stand-in log of typecheck.md K3: a callee that is not ported records its name | `StandIns` (`record`, `is_empty`, `count_of`, `snapshot`) | translated | `is_empty`, `count_of`, `snapshot` |
| the loops whose end depends on checker state (`checker-data-model-contract/bottom-up/data/loops-with-budget.tsv`; four of them are in the tree) | `LOOP_LIMIT` (1 << 20 turns), `LoopGuard` (`new`, `with_limit`, `turn`) | translated | `with_limit` |

## Node table and `internal/ast` (`ast`)

The 28 files of round 1 came in with `4d40783efe` (`ast.rs`, `functionflags.rs`, `precedence.rs`, `utilities.rs`),
`2e8dd33ffd` (the node table and the other ports; its `mod.rs` declares all 27 others), `f4787aa475` (`publish.rs`,
`tests.rs`) and `3febf04ee5` (three readers of `builder.rs`). Layer 3 of round 2 declares the directory: the line
`pub mod ast;` of `lib.rs` is `887629cf2c`. What the 28 files name and the crate did not have came in before it:

- `0aa0a67449`: `core/golang.rs` with `crate::core::List` (and `GoIndex`), which `ast/ast.rs`, `ast/node_methods.rs`,
  `ast/reader.rs`, `ast/symbol.rs` and `ast/tests.rs` import (the last `core` row under "Leaf packages"). `2caaa157eb`
  changes `List::sub`, which no file of the tree calls, and adds the test of the file.
- `a8b48548a6`: `bun_collections.workspace = true` and `bun_core.workspace = true` in `src/typecheck/Cargo.toml`
  (`ast/utilities.rs` names `bun_collections::HashMap` and `bun_core::strings`; `ast/ast.rs` and `ast/utilities.rs` name
  `bun_core::StackCheck`), with the `dependencies` list of `bun_typecheck` in `Cargo.lock`, written by hand in the form
  that cargo writes; and `ast/diagnostic.rs` with `crate::ast::Arg`, which `scanner/scanner.rs` imports, with its two
  lines of `ast/mod.rs`.

No `cargo check`, `cargo clippy` or `cargo test` was run with these commits: the survey that follows them is the first
cargo compile of the 29 files of `ast/` and of `core/golang.rs` in the real crate, so the state below is `translated`
until that run passes. `translated` says less here than under the checker headings: the file is written, a `mod` line
reaches it, and the checks of this paragraph were made; no body was compared with upstream when the directory was
declared. What was checked before: the look-ahead of the round-4 survey (`rustc` alone from a scratch root in `/tmp`:
the 28 files and the two of `scanner/` read in place beside layers 1 and 2, against the real `bun_core` and
`bun_collections`, the rust lints of the workspace denied, with a `List` that is the one of `core/golang.rs` but for
the body of `sub`, and with the bare enum `Arg`: exit 0, no warning); `cargo check`, `cargo clippy --all-targets`,
`cargo fmt --check` and the tests of the contract crate on the same bytes of `GoIndex`, `List` (but for `sub`) and `Arg`
(`checker-data-model-contract/bottom-up/data/run.log`); `core/golang.rs` and `ast/diagnostic.rs` as they are in the
tree, alone (both name `std` only), by `rustc` and by `clippy-driver` (the clippy table of the workspace and the
repository's `clippy.toml`) from a scratch root in `/tmp` with the rust lints of the workspace denied, as a library and
with `--test`: exit 0, no warning, and the test of `golang.rs` passes there (with the contract's `sub` it fails at the
nil list); `rustfmt --check --edition 2024 src/typecheck/lib.rs`, which follows every `mod` line: exit 0;
`undeclared.py`: 76 of 179 files are reached, and no file of `ast/` or `scanner/` is outside. No compiler has seen
`ast/tests.rs` (728 lines, `#[cfg(test)]`) in the real crate, and clippy has not seen the 28 files of round 1 with
these commits. Those 28 files have, outside the tests, no `unsafe`, `unwrap()`, `expect(`, `panic!`, `todo!`,
`unimplemented!`, `unreachable!` and no `allow(`.

The counts of the last column are by name only: a Go function counts as present when some file of `ast/` has a function
of its name, underscores and case aside (`python3 round2-layer3-ast/names.py <file.go>` of the notes). They say nothing
about a body.

| upstream file, lines | Rust module under `src/typecheck/` | state | not ported |
| --- | --- | --- | --- |
| `ast/kind_generated.go`, `ast/ast_generated.go` (the kinds, the node records, their constructors, the `Is` and `As` functions, the children of a node) | `ast/kind_generated.rs`, `ast/ast_generated.rs` (written by `ast/generate.ts` from `ast/ast.json`), `ast/layout.rs` | translated | by name, 1,348 of the 1,386 functions of `ast_generated.go`; the other 38 are `computeSubtreeFacts` of a node |
| no upstream file: the ids, the table of a file, the tree context and the open store that stand for upstream's pointers | `ast/ids.rs`, `ast/file.rs`, `ast/reader.rs` (`Ast`), `ast/open.rs`, `ast/stable.rs`, `ast/builder.rs`, `ast/factory.rs`, `ast/publish.rs`, `ast/flags.rs` | translated; the survey of round 5 compiled the nine files with cargo as they were at `2caaa157eb`. Layer 4 added to four of them what no compiler has seen ("Binder" below): `DiagnosticId` in `ids.rs` (`a9b14ab2d6`); the diagnostics that a file keeps in `file.rs`, `open.rs` and `publish.rs` (`d0230a94c6`) | `ast/ids.go` (`NodeId`, `SymbolId` as `uint64`): an id of the table is a `u32` and is the identity of its object |
| `ast/ast.go` (the hand-written part, 307 functions) | `ast/node_methods.rs` (the methods of `Node`), `ast/ast.rs` (write access, the records beside a source file, pragmas) | translated | by name, 140 are in `ast/`, 4 only in other directories (`visit`, `NewNodeFactory`, `Node.Type`, `SourceFile.copyFrom`) and 163 nowhere in the tree: 102 that compute or propagate subtree facts (1210-2355, 2834), and 61 others that the script lists, among them the accessors of Go's node representation (`AsNode`, `DeclarationData`, `FlowNodeData`, ...), the data that a program, a content mapper or the language service keeps at a source file (2413-2990: `SourceFile.SetDiagnostics`, `JSDiagnostics`, `JSDocDiagnostics`, `GetNameTable`, `GetPositionMap`, `GetOrCreateToken`, `GetDeclarationMap`, ...), `newNode`, `UpdateSourceFile`, `ReleaseArenas`. Which of the 61 the binder or the checker calls was not looked at. Three came in with layer 4 (`d0230a94c6`, "Binder" below): `SourceFile.Diagnostics` (2726) is `SourceFile::diagnostics` of `ast/file.rs` and `SetBindDiagnostics` (2789) is `Ast::set_bind_diagnostics` of `ast/publish.rs`, the two that `binder/binder.rs` calls; `BindDiagnostics` (2785) is `SourceFile::bind_diagnostics` of `ast/file.rs`, which reads what the setter stored |
| `ast/utilities.go` (416 functions) | `ast/utilities.rs` | translated | by name, 414; `SetImportsOfSourceFile` (906) and `ContainsObjectRestOrSpread` (3987) are nowhere in the tree |
| `ast/symbol.go`, `ast/symbolflags.go`, `ast/checkflags.go` | `ast/symbol.rs`, `ast/symbolflags.rs`, `ast/checkflags.rs` | translated | by name, the 7 functions of `symbol.go` |
| `ast/flow.go` | `ast/flow.rs` | translated | by name, its 3 functions |
| `ast/nodeflags.go`, `ast/modifierflags.go`, `ast/tokenflags.go`, `ast/functionflags.go` | the files of the same names | translated | |
| `ast/subtreefacts.go` 1-87 (the flags) | `ast/subtreefacts.rs` | translated | 89-133, the seven `propagate...SubtreeFacts` functions: the binder and the checker do not read subtree facts |
| `ast/precedence.go` | `ast/precedence.rs` | translated | by name, its 6 functions |
| `ast/visitor.go` | `ast/visitor.rs` | translated | by name, its 18 functions |
| `ast/diagnostic.go`: the `any` of `args ...any` (194, 208, 215) | `ast/diagnostic.rs` (`Arg::{Str, Int, Bool}` with `Default` and seven `From` impls: lines 18 to 66 of `checker-data-model-contract/bottom-up/crate/src/ast_diagnostic.rs`, byte for byte) | translated; the survey of round 5 compiled it with cargo | |
| `ast/diagnostic.go` 34-73, 76-79, 88-122, 194-217 (`Diagnostic`, its accessors and setters, `SetMessageChain`, `AddMessageChain`, `SetRelatedInfo`, `AddRelatedInfo`, `Clone`, `Localize`, `NewDiagnostic`, `NewDiagnosticChain`, `NewCompilerDiagnostic`), and `diagnostics.StringifyArgs` (`diagnostics/diagnostics.go` 136-150) | `ast/diagnostic.rs` since `d0230a94c6` (`Diagnostic`, `DiagnosticStore`, `InvalidPlaceholderFault`, `stringify_args`: lines 68 to 335 of the contract's `ast_diagnostic.rs`, with three differences that API.md lists under "Binder: the wiring of `binder`"), and `DiagnosticId` in `ast/ids.rs` since `a9b14ab2d6` | translated: no compiler has seen the two commits ("Binder" below) | `RepopulateDiagnosticKind`, `RepopulateDiagnosticInfo`, `RepopulateInfo`, `SetRepopulateInfo` (15-30, 74, 80), `SetExternalData` (82), `String` (125), `displayMessageArgs` (134: `Localize` prints the stored arguments), `NewDiagnosticFromSerialized` (166), `NewExternalDiagnostic` (223), `DiagnosticsCollection` (234-364), `EqualDiagnostics` to `CompareDiagnostics` (366-503). The contract's file has a port of the collection and of the comparisons (its lines 10-16 and 337-739: `SourceFiles`, `Diagnostics { store, files }`, `DiagnosticsCollection`) that needs Go's `slices` sorting (`tscore/slices.rs`), which the tree does not have. No file that cargo compiles names them; `checker` names `Diagnostics`, `DiagnosticsCollection`, `RepopulateDiagnosticInfo` and `RepopulateDiagnosticKind` of `crate::ast` |
| `ast/deepclone.go`, `ast/parseoptions.go`, `ast/positionmap.go` | | not started in `ast/` | `DeepCloneReparse`, `DeepCloneReparseModifiers` and the statement loop of `isFileProbablyExternalModule` are in `importer/javascript/tree.rs` (rows under "Parser pieces"); one file of `printer/` names `crate::ast::deep_clone_node`, which no file defines |
| `ast/kind_stringer_generated.go`, `ast/*_test.go` | | not started | `ast/tests.rs` holds tests of the node table, not upstream's |

## Scanner (`scanner`)

`scanner/scanner.rs` (3,722 lines) and `scanner/utilities.rs` (232) came in with `4d40783efe`; `941cbf415f` took the
stand-in call out of `re_scan_slash_token`. `scanner/mod.rs` and the line `pub mod scanner;` of `lib.rs` came in with
`0aa0a67449`. `mod.rs` declares the two files and re-exports both (`pub use scanner::*;`, `pub use utilities::*;`), as
the `mod.rs` of every other package does: 25 files of the later layers reach the package as `crate::scanner` (`checker`
19, `importer` 2, `printer` 2, `binder` 1, `lowering` 1), none as `crate::scanner::scanner`. The two files name
`crate::ast` (with `crate::ast::Arg`, one argument of a message) and `bun_core::strings`, so they compile only in a
tree whose `lib.rs` declares `ast`, whose `ast` has `Arg` and whose `Cargo.toml` has `bun_core`: `887629cf2c` is the
first commit with the three (`Arg` and the dependency are of `a8b48548a6`). No `cargo check` was run with these
commits: the survey that follows them is the first cargo compile of the three files in the real crate, so the state
below is `translated` until that run passes. What was checked before: `rustc` alone beside `ast` and the seven modules
of layers 1 and 2 with the rust lints of the workspace denied, against the real `bun_core` and `bun_collections`, with
the module written inline as `mod.rs` is now and with stand-ins for `crate::core::List` and for `crate::ast::Arg` (the
enum that `ast/diagnostic.rs` now has) (the look-ahead of the round-4 survey, a scratch root in `/tmp`);
`rustfmt --check --edition 2024` on the three files in the tree. Not run on these bytes: clippy. The package has no
test of its own: `lowering/tests.rs` reads the scanner, and cargo does not compile it yet.

Compared with upstream: each of the 111 functions of `scanner.go` but `cleared`, and each of the 12 of `utilities.go`,
has a function of its name in snake_case, in upstream's order; each of the 33 messages that `scanner.go` reports is
reported at as many places, but the three about the flags of a regular expression (row of `ReScanSlashToken`). Read
side by side with upstream when the module was declared: `utilities.go`, and of `scanner.go` 192-245, 469-700, 972-1525,
2102-2212 and 2285-2504: no difference was found there besides the ones of the last column. The other lines were
compared by the names only. A text is a byte string, a position an `i32`, a rune an `i32` inside `scanner.rs` (-1 at
the end of the text) and a `u32` in `is_identifier_start`, `is_identifier_part` and `is_identifier_part_ex`; a read
outside the text answers -1 or an empty text where Go panics.

| upstream file, lines | Rust module under `src/typecheck/` | state | not ported |
| --- | --- | --- | --- |
| `scanner/scanner.go` 21-34 (`EscapeSequenceScanningFlags`, `ErrorCallback`) | `scanner/scanner.rs` | translated | `args ...any` of the callback is `&[crate::ast::Arg]` |
| `scanner/scanner.go` 36-190, 2255-2283 (`textToKeyword`, `textToToken`, `tokenToText`, `TokenToString`, `StringToToken`, `GetViableKeywordSuggestions`) | `scanner/scanner.rs` (`text_to_keyword`, `text_to_token`, `token_to_text`: a `match` for each map; `KEYWORD_TEXTS`) | translated | the suggestions come in the order of the source of `textToKeyword`: upstream ranges over a map |
| `scanner/scanner.go` 192-467 (`ScannerState`, `Scanner`, `NewScanner`, `Reset`, the accessors, `Mark`, `Rewind`, `ResetPos`, `ResetTokenState`, the setters, `scanJSDocCommentForTags`, `hasJSDocTag`, `error`, `errorAt`, `char`, `charAt`, `charAndSize`, `scanASCIIWhile`) | `scanner/scanner.rs` | translated | `numberCache`, `hexNumberCache`, `hexDigitCache` and `cleared`: a cached text is the text that the scan computes; the panic of `ResetPos` is `Err` with its message |
| `scanner/scanner.go` 469-1011 (`Scan`, `processCommentDirective`) | `scanner/scanner.rs` | translated | |
| `scanner/scanner.go` 1013-1065, 1225-1247 (`ReScanLessThanToken`, `ReScanGreaterThanToken`, `ReScanTemplateToken`, `ReScanAsteriskEqualsToken`, `ReScanJsxToken`, `ReScanHashToken`, `ReScanQuestionToken`) | `scanner/scanner.rs` | translated | the panics of `ReScanAsteriskEqualsToken` and `ReScanQuestionToken` are `Err` with their messages |
| `scanner/scanner.go` 1067-1223 (`ReScanSlashToken`) | `scanner/scanner.rs` (`re_scan_slash_token`) | translated without the lines of the last column | 1068, 1074 and 1112-1116 (`namedCaptureGroups`), 1171 and 1177-1189 (the check of the flags), 1192-1213 (`regExpParser.run`): `report_errors` is not read and no message about a flag or a pattern is reported. The scanner has no stand-in log, so nothing records it: the caller that passes `true` (`checker/grammarchecks.go` 91, not in the tree) has to record `regExpParser.run` |
| `scanner/scanner.go` 1249-1525 (`ScanJsxToken` to `ScanJSDocToken`) | `scanner/scanner.rs` | translated | |
| `scanner/scanner.go` 1527-2212 (`scanIdentifier` to `scanInvalidCharacter`: identifiers, strings, templates, escapes, numbers) | `scanner/scanner.rs` | translated | the three caches (row of `Scanner`); a binary or octal bigint that `jsnum::parse_pseudo_big_int` refuses keeps the text as scanned, where upstream panics |
| `scanner/scanner.go` 2214-2253 (`GetIdentifierToken`, `IsValidIdentifier`, `isWordCharacter`, `IsIdentifierStart`, `IsIdentifierPart`, `IsIdentifierPartEx`) | `scanner/scanner.rs` | translated | |
| `scanner/scanner.go` 2285-2504 (`couldStartTrivia`, `SkipTriviaOptions`, `SkipTrivia`, `SkipTriviaEx`, conflict markers, shebang, `GetShebang`) | `scanner/scanner.rs` | translated | where upstream panics, `isConflictMarkerTrivia` (a negative position) and `isShebangTrivia` (a position other than 0) answer `false`, and `scanConflictMarkerTrivia` (another character than the four) returns the position |
| `scanner/scanner.go` 2506-2654 (`GetScannerForSourceFile`, `ScanTokenAtPosition`, `GetRangeOfTokenAtPosition`, `GetTokenPosOfNode`, `getErrorRangeForArrowFunction`, `findOriginatingJSDocSatisfiesTag`, `GetErrorRangeForNode`) | `scanner/scanner.rs` (`a: Ast` first, then upstream's parameters, a node as its id) | translated | |
| `scanner/scanner.go` 2656-2798 (`ComputeLineOfPosition` to `ComputePositionOfLineAndUTF16Character`) | `scanner/scanner.rs` (a line is an `isize`; `line_start_at` answers 0 for a line outside the map) | translated | the panics and asserts of 2733, 2752, 2776, 2778 and 2796 are `Err` with the message without its numbers |
| `scanner/scanner.go` 2800-2918 (`GetLeadingCommentRanges`, `GetTrailingCommentRanges`, `iterateCommentRanges`) | `scanner/scanner.rs` | translated | the ranges are a `Vec`, not a lazy sequence; no factory parameter (`ast::new_comment_range` makes a range) |
| `scanner/utilities.go` | `scanner/utilities.rs` (with Go's `strings.TrimLeftFunc`, `strings.TrimRightFunc` and `unicode.IsSpace`) | translated | `debug.FailBadSyntaxKind` is `Ast::unhandled`, and the text as read is the answer |
| `scanner/regexp.go`, `scanner/unicodeproperties.go` | | not started | the flags and the pattern of a regular expression literal |
| `scanner/scanner_test.go` | | not started | |

## Binder (`binder`)

`binder/binder.rs` (3,947 lines), `binder/nameresolver.rs` (771), `binder/referenceresolver.rs` (423) and
`binder/mod.rs` (8) came in with `b52442e510`; `2c971fdc00` wrote the calls of `core` and `scanner` helpers by their
signatures. `mod.rs` declares the three files and re-exports them. Layer 4 of round 2 declares the directory: the line
`pub mod binder;` of `lib.rs` is `d0230a94c6`. The four files are as they were before that line. They name
`crate::{ast, collections, core, diagnostics, internal, scanner, tspath}` and `bun_core::StackCheck`, so
`src/typecheck/Cargo.toml` is unchanged. Five things that they name were in no file of the tree, all of them in
`core/` and `ast/`. They came in with `a9b14ab2d6` and `d0230a94c6` (both written by the job that commits the
worktree, under its message "typecheck: compile the port, work in progress"; `6f844a8b93` after them changes one
comment of `ast/file.rs`):

- `crate::core::Text` (`core/golang.rs`, `a9b14ab2d6`): the last `core` row under "Leaf packages".
- `crate::ast::DiagnosticId` (`ast/ids.rs`, `a9b14ab2d6`): one more id of `define_id!`, as the contract's
  `tscore/ids.rs` has it.
- `crate::ast::DiagnosticStore`, with `Diagnostic`, `InvalidPlaceholderFault` and `stringify_args`
  (`ast/diagnostic.rs`, `d0230a94c6`): the second row of `ast/diagnostic.go` under "Node table".
- `Ast::set_bind_diagnostics(file, store, diagnostics)` (`ast/publish.rs`, `d0230a94c6`): the store of the binder and
  the ids of its diagnostics go into `BindOverlay` (`ast/open.rs`) and from there, when the binding ends, into `Bound`
  (`ast/file.rs`: `bind_diagnostics`, `bind_diagnostic_store`). `SourceFile::bind_diagnostics()` and
  `SourceFile::bind_diagnostic_store()` read them.
- `SourceFile::diagnostics()` (`ast/file.rs`, `d0230a94c6`): the parse diagnostics of the file, which are two new
  fields of `SourceFileData` (`diagnostics`, `diagnostic_store`), with `SourceFile::diagnostic_store()`. No file of the
  tree sets the two fields: the producers are of layer 5 and keep their parse diagnostics beside the file (API.md,
  "Binder: the wiring of `binder`", "What waits").

No compiler has seen `a9b14ab2d6` and `d0230a94c6`: no `cargo check`, no `cargo clippy`, no `cargo test`, and no
`rustc` alone. The survey that follows them is the first compile of the four files of `binder/` in the real crate and
the first compile of what the two commits add to `core/` and `ast/`, so the state below is `translated` until that run
passes. What was checked before:

- The look-ahead of the round-5 survey (`rustc` alone from a scratch root in `/tmp`: the four files read in place
  beside layers 1 to 3 at `2caaa157eb`, against the real `bun_core` and `bun_collections`, the rust lints of the
  workspace denied). With stand-ins of the five names that have the signatures the tree has now (empty bodies for the
  two methods): exit 0, no warning. With the contract's `ast_diagnostic.rs` but for its lines 18 to 66 (`Arg`) and
  with its `records.rs` and `slices.rs`, on the tree's paths and with `undefined_text_range()`: exit 0, no warning.
  Neither run is the tree of `d0230a94c6`: there the store keeps its diagnostics in a `Vec` and not in the contract's
  `Records`, and the bodies of `set_bind_diagnostics` and `diagnostics`, the fields behind them and the three other
  readers are new.
- `diff` of lines 56 to 361 of `ast/diagnostic.rs` against lines 68 to 335 of the contract's file: the differences are
  five comment lines, `derive(Debug)` and a written `Default` for the derived one, the store's `Vec` and its sink in
  place of `Records`, the bodies of `Index` and `IndexMut`, `alloc`, `std::` for `core::`, and
  `undefined_text_range()`.
- `rustfmt --check --edition 2024 src/typecheck/lib.rs`, which follows every `mod` line: exit 0.
  `python3 /workspace/notes/lint/tools/undeclared.py src/typecheck`: 80 of 179 files are reached, and no file of
  `binder/` is outside.
- The four files and what the two commits add have no `unsafe`, `unwrap()`, `expect(`, `panic!`, `todo!`,
  `unimplemented!`, `unreachable!` and no `allow(`, and no run of two comment lines.
- Not run on these bytes: clippy. No test was added, and none was run: the package has no test of its own.

Compared with upstream when the directory was declared, by name: each of the 167 functions of `binder.go`, the 13 of
`nameresolver.go` and the 15 of `referenceresolver.go` has a function of its name in `binder/`
(`python3 round2-layer4-binder/names.py <file.go>` of the notes). Read side by side, because they are the places that
call what layer 4 added: `binder.go` 95-130 (`BindSourceFile` to `bindSourceFile`), 215-290 (the diagnostics of a
declaration that conflicts, in `declareSymbolEx`), 1299-1330 (`checkContextualIdentifier`, `checkPrivateIdentifier`)
and 2710-2728 (`errorOnNode` to `addDiagnostic`): no difference was found there besides the ones of the last column.
No other body was compared when the directory was declared.

| upstream file, lines | Rust module under `src/typecheck/` | state | not ported |
| --- | --- | --- | --- |
| `binder/binder.go` (167 functions) | `binder/binder.rs` (`a: Ast` first where a function is no method of the binder; a node, a symbol, a table and a flow node are ids) | translated | `binderPool`: every file gets a new binder (`get_binder`, `put_binder`). The symbols, flow nodes and flow lists are objects of the open store of `Ast`, not arenas of the binder. `addDiagnostic` keeps the id in the binder, and `bind_source_file` hands the store and the ids to the file once (`Ast::set_bind_diagnostics`), as it does with the pattern ambient modules; upstream appends to the file at each one. The `debug.Assert` of 153 and the panics of 294, 336, 446, 1077 and 1133 are faults of the open store (`Ast::fault`, `Ast::unhandled`) and the function goes on. A recursion that follows the depth of the tree ends with the fault `StackLimit` when the thread has no stack left (four places) |
| `binder/nameresolver.go` | `binder/nameresolver.rs` | translated | the row of 25-498 under "Checker: symbol merging, name resolution, aliases and modules" |
| `binder/referenceresolver.go` (15 functions) | `binder/referenceresolver.rs` | translated | no body was compared when the directory was declared |
| `binder/binder_test.go` (`BenchmarkBind`) | | not started | |

## Checker: signatures, instantiation, types of symbols, widening (K3 steps 18 to 21)

Commits `1cb4b9c183` and `314fac8c09`. The rows of `c15_calls.rs` and `c47_promised_mapped_template.rs` came in with
`63545ccfb7`, the functions of `relater.rs` with `ce23cca6c5` (two stack tests added in `1cb4b9c183`). Layers T-SIGDECL,
T-SIGSHAPE, T-SIGINST, T-INSTANTIATE, T-SYMTYPE, T-JSDECL, T-WIDEN: 176 functions, none left as a stand-in.

State `translated` is less than `ported`: the body is written in full, was read against upstream statement by
statement, and `rustfmt --check` parses the file, but cargo compiles none of it. `lib.rs` declares no module and the
tree has no `checker/mod.rs` and no `Checker` record (API.md, same heading).

| upstream file, lines | layer | Rust module under `src/typecheck/` | state | not ported |
| --- | --- | --- | --- | --- |
| `checker/checker.go` 9721-9737 (`getRestTypeOfSignature`, `tryGetRestTypeOfSignature`) | T-SIGSHAPE | `checker/c15_calls.rs` | translated | |
| `checker/checker.go` 16495-16585 (`getTypeOfSymbolWithDeferredType` to `GetTypeOfSymbolAtLocation`) | T-SYMTYPE | `checker/c28_types_of_symbols.rs` | translated | |
| `checker/checker.go` 16658-17028 (`isParameterOfContextSensitiveSignature` to `getTypeOfFuncClassEnumModuleWorker`) | T-SYMTYPE | `checker/c28_types_of_symbols.rs` | translated | |
| `checker/checker.go` 17132-17139 (`signatureHasRestParameter`, `getTypeOfParameter`) | T-SIGSHAPE | `checker/c28_types_of_symbols.rs` | translated | |
| `checker/checker.go` 17777-18162 (`isNullOrUndefined` to `getTypeOfPrototypeProperty`) | T-SYMTYPE | `checker/c31_binding_patterns_widening.rs` | translated | |
| `checker/checker.go` 18173-18344 (`getWidenedTypeForAssignmentDeclaration` to `isConstructorDeclaredThisProperty`) | T-JSDECL | `checker/c31_binding_patterns_widening.rs` | translated | |
| `checker/checker.go` 18346-18467 (`isGlobalSymbolConstructor` to `reportImplicitAny`) | T-SYMTYPE | `checker/c31_binding_patterns_widening.rs` | translated | |
| `checker/checker.go` 18469-18615 (`getWidenedType` to `getUndefinedProperty`) | T-WIDEN | `checker/c31_binding_patterns_widening.rs` | translated | |
| `checker/checker.go` 18617-18859 (`getTypeOfEnumMember` to `getCombinedModifierFlagsCached`) | T-SYMTYPE | `checker/c31_binding_patterns_widening.rs` | translated | |
| `checker/checker.go` 19407-19610 (`getSignatureInstantiation` to `instantiateSignatureInContextOf`) | T-SIGINST | `checker/c33_members_base_types_signatures.rs` | translated | |
| `checker/checker.go` 19920-20113 (`getSignaturesOfSymbol` to `isLateBindableAST`) | T-SIGDECL | `checker/c33_members_base_types_signatures.rs` | translated | |
| `checker/checker.go` 20115-20238 (`getReturnTypeOfSignature` to `getEffectiveSetAccessorTypeAnnotationNode`) | T-SIGDECL | `checker/c34_return_types.rs` | translated | |
| `checker/checker.go` 20566-20647 (`reportErrorsFromWidening` to `reportWideningErrorsInType`) | T-WIDEN | `checker/c34_return_types.rs` | translated | |
| `checker/checker.go` 20722-20727 (`addOptionalTypeMarker`) | T-SIGINST | `checker/c34_return_types.rs` | translated | |
| `checker/checker.go` 20729-20762 (`instantiateSignature` to `instantiateIndexInfo`) | T-SIGINST | `checker/c35_resolve_members.rs` | translated | |
| `checker/checker.go` 22007-22045 (`getTypeArguments`) | T-INSTANTIATE | `checker/c36_properties_apparent_types.rs` | translated | |
| `checker/checker.go` 22214-22597 (`instantiateType` to `instantiateAnonymousType`) | T-INSTANTIATE | `checker/c37_instantiation.rs` | translated | the tracer block of 22229 |
| `checker/checker.go` 22632-22636 (`cloneTypeParameter`), 22856-22911 (`instantiateReverseMappedType` to `instantiateList`) | T-INSTANTIATE | `checker/c37_instantiation.rs` | translated | |
| `checker/checker.go` 24602-24660 (`getPermissiveInstantiation` to `permissiveMapperWorker`) | T-INSTANTIATE | `checker/c40_type_nodes_conditional_tuples.rs` | translated | |
| `checker/checker.go` 27855-27924 (`expandSignatureParametersWithTupleMembers` to `getNameFromIndexInfo`) | T-SIGSHAPE | `checker/c45_base_constraints_normalization.rs` | translated | |
| `checker/checker.go` 28282-28310 (`getRegularTypeOfObjectLiteral`, `transformTypeOfMembers`) | T-WIDEN | `checker/c45_base_constraints_normalization.rs` | translated | |
| `checker/checker.go` 29124-29133 (`getTypeOfFirstParameterOfSignature`, `getTypeOfFirstParameterOfSignatureWithFallback`) | T-SIGSHAPE | `checker/c47_promised_mapped_template.rs` | translated | |
| `checker/checker.go` 29198-29227 (`removeOptionalTypeMarker` to `removeMissingOrUndefinedType`) | T-SYMTYPE | `checker/c47_promised_mapped_template.rs` | translated | |
| `checker/relater.go` 1708-1913 (`isTopSignature` to `getEffectiveRestType`) | T-SIGSHAPE | `checker/relater.rs` | translated | |
| `checker/relater.go` 1947-2150 (`getThisTypeOfSignature` to `isResolvingReturnTypeOfSignature`) | T-SIGSHAPE | `checker/relater.rs` | translated | |

The same files are the place of rows of other landing steps, which these commits do not contain: `c28` 16587-16656
and 17030-17130, `c33` 18960-19405 and 19612-19918, `c34` 20240-20564 and 20649-20720, `c35` 20764-21511, `c36`
21513-22005 and 22047-22212, `c37` 22599-22630 and 22638-22854.

## Lowering of Bun's parse (`lowering`, no upstream file of its own)

Commit `9684ef6a7d`: the seven files of `lowering/` (`mod.rs`, `declarations.rs`, `expressions.rs`, `modules.rs`,
`statements.rs`, `type_arguments.rs`, `tests.rs`) and `testdata/`, unchanged since. `tested` in the rows below means:
compiled with `rustc` alone from a scratch root and compared there with trees of typescript-go (API.md, "Lowering",
"Verified"): no test of the directory has run through cargo. Each function reads the tokens of the function of
`internal/parser/parser.go` that its comment names; the grammar decisions are Bun's, so these rows are not a port of
the parser.

Layer 5 of round 2 declares the directory: the line `pub mod lowering;` of `lib.rs`, the line
`bun_ast.workspace = true` of `src/typecheck/Cargo.toml` and the line `"bun_ast",` of the entry of `bun_typecheck` in
`Cargo.lock` are `5d5a6e614a` (written by the job that commits the worktree, under its message "typecheck: compile the
port, work in progress"; the commit holds these three lines and nothing else). `lowering/mod.rs` declares the other six
files, `tests.rs` under `#[cfg(test)]`. The six files that `cargo check` compiles (4,006 lines) name
`crate::{ast, core, diagnostics, scanner}`, `bun_core::StackCheck`, `std` and `bun_ast`: five `use` lines (`mod.rs` 18,
`declarations.rs` 6, `expressions.rs` 9, `modules.rs` 5, `statements.rs` 6) and `bun_ast::flags::{Function, Property}`
by path at nine places. `bun_ast` was the one thing the crate did not have: no file of layers 1 to 4 changed for this
directory. The line of `Cargo.lock` was written by hand and not by cargo, at the place where cargo sorts it (before
`"bun_collections"`); the lock held `bun_ast` and every crate under it already, since it is a member of the workspace.
No cargo command was run on the lock when the line was written. No `cargo check`, no `cargo clippy` and no `cargo test`
was run with that commit: the survey that follows it is the first cargo compile of the six files in the real crate and
the first build of `bun_ast` in the target directory of this worktree (19 crates that it has not built: `bun_ast`,
`bun_sys`, `bun_paths`, `bun_perf`, `bun_errno`, `bun_libuv_sys`, `bun_windows_sys` and 12 of crates.io), and until
that run passes the real crate has the six files declared and not compiled. What was checked before:

- The look-ahead of the round-6 survey (`/tmp/rdr-sweep-r6.log`; `rustc` alone from a scratch root in `/tmp`: the ten
  `pub mod` lines of `lib.rs` at `6f844a8b93` and `pub mod lowering;`, every file read in place, `--extern` for
  `bun_core`, `bun_collections` and `bun_ast` and for no other crate, the rust lints of the workspace denied, against
  the `.rmeta` files that the worktree of the cli unit had built, since this worktree had no `bun_ast`): exit 0, no
  warning. The same with `pub mod importer;` as well, which is the set of modules that `lib.rs` has at `5d5a6e614a`:
  exit 0, no warning. The same without `bun_ast`: 14 errors, each of them the unresolved crate at one of the 14 places
  above. Compared again when the line was written: `src/ast` and nine directories of path crates under it (`bun_core`,
  `collections`, `bun_alloc`, `sys`, `paths`, `perf`, `ptr`, `dispatch`, `wyhash`) have the same git tree in both
  worktrees. The survey's log says so for all 20 path crates of the closure.
- `rustfmt --check --edition 2024 src/typecheck/lowering/mod.rs`, which follows every `mod` line of the directory, the
  `#[cfg(test)]` one too: exit 0. The same on `lib.rs` with the new line, which follows every `mod` line of the crate:
  exit 0.
- `python3 /workspace/notes/lint/tools/undeclared.py src/typecheck` on the tree of `5d5a6e614a`: 94 of 179 files are
  reached, and no file of `lowering/` is outside (the 85 files of the seven directories of layers 6 and 7 are).
- The six files have no `unsafe`, `unwrap()`, `panic!`, `todo!`, `unimplemented!`, `unreachable!` and no `allow(`.
  Every `expect(` in them is `Lowerer::expect(kind)`, a function of `lowering/mod.rs` that answers `Err` with
  `OutOfStep` where the token is another one. None of the seven files has a run of two comment lines.
- Not run on these bytes in the real crate: clippy (the scratch root had it clean at `9684ef6a7d`, API.md).
  `cargo check` does not compile `lowering/tests.rs` (567 lines, `#[cfg(test)]`). That file names `bun_js_parser` and
  `bun_alloc` (lines 49 to 59), which `src/typecheck/Cargo.toml` does not have: since the line of `lib.rs`,
  `cargo test -p bun_typecheck` cannot compile the tests of the crate until the two are dev-dependencies, and a test
  binary needs the native stand-ins that API.md names ("Lowering", "What the crate needs for this module"). No
  compiler has seen `tests.rs` beside the `ast` and the `scanner` of today, so whether it still compiles is not known.

| upstream functions of `parser/parser.go` that the module follows | Rust module under `src/typecheck/` | state | not done |
| --- | --- | --- | --- |
| `parseSourceFileWorker`, `finishNode`, `parseTokenNode`, `createIdentifier`, `parseLiteralExpression`, `parseSemicolon`, `mark`/`rewind`/`lookAhead`, `reparseTopLevelAwait`, `isFileProbablyExternalModule` | `lowering/mod.rs` | tested | `finishSourceFile` apart from flags, identifier count, comment directives and the module indicator; `collectExternalModuleReferences`; pragmas |
| `parseStatement` and the statement functions (`parseBlock` to `parseDebuggerStatement`), `parseVariableStatement`, `parseVariableDeclarationList`, `parseFunctionDeclaration`, `parseClassDeclaration`, the modifiers of `parseDeclaration` | `lowering/statements.rs` | tested | `enum`, `namespace`, `module`, `interface`, `type`, `declare`, `import =`, `export =` |
| `parseExpression`, `parseAssignmentExpressionOrHigher`, binary, conditional, unary, update, member, call, `new`, template, array and object literals, arrow functions, `yield`, `await`, `import()`, `import.meta`, `new.target` | `lowering/expressions.rs` | tested | JSX, `as`, `satisfies`, `!`, type assertions, type arguments, type parameters |
| `parseDecorator`, `parseFunctionExpression`, `parseParameters`, `parseParameterEx`, `parseInitializer`, `parseIdentifierOrPattern`, binding elements, `parsePropertyName`, methods, accessors, `parseFunctionBlock`, `parseClassDeclarationOrExpression`, `parseHeritageClauses`, `parseClassElement` | `lowering/declarations.rs` | tested | type annotations, `implements`, index signatures, accessibility modifiers, parameter properties, overloads |
| `parseExportAssignment`, `parseModuleSpecifier`, `parseImportOrExportSpecifier`, `parseImportAttributes`, `parseImportDeclarationOrImportEqualsDeclaration`, `parseImportClause`, `parseExportDeclaration` | `lowering/modules.rs` | tested | `import x = require()`, `export =`, `export as namespace` |
| `tryParseTypeArgumentsInExpression`, `canFollowTypeArgumentsInExpression`, `isStartOfType`, `isStartOfExpression`, `isStartOfLeftHandSideExpression`, `isBinaryOperator`, and `parseType` for names, literals, `typeof`, `this`, indexes, `|`, `&` (as a recognizer: no node is made) | `lowering/type_arguments.rs` | tested | every other type: the answer is then "cannot tell" and the file has no table |
| `parser/jsdoc.go`, `parser/reparser.go`, `parser/references.go`, `parser/utilities.go` (pragmas) | | not started (`reparser.go`: see `importer/javascript`) | |

## Parser pieces for JavaScript trees (importer)

Commit `3febf04ee5`: the seven files of `importer/` (`mod.rs`, and `mod.rs`, `jsdoc.rs`, `jssyntax.rs`, `reparser.rs`,
`tree.rs` and `tests.rs` of `javascript/`), unchanged since. `ported` and `tested` in the rows below mean compiled and
run with `rustc` alone from the scratch root of `jsdoc-reparser-js-trees/port/` (API.md, "Importer: the JavaScript
step"): no test of the directory has run through cargo.

Layer 5 of round 2 declares the directory: the line `pub mod importer;` of `lib.rs` is `ebb836b39f` (written by the job
that commits the worktree, under its message "typecheck: compile the port, work in progress"; the commit holds that
line and nothing else). `importer/mod.rs` reaches `javascript/mod.rs`, which reaches the other five files. The six
files that `cargo check` compiles (3,193 lines) name `crate::{ast, core, diagnostics, internal, scanner, stringutil}`,
`bun_core::StackCheck` (as `binder/binder.rs` does) and `std::mem`: `lib.rs` and `src/typecheck/Cargo.toml` had all of
them before the line, so no file of layers 1 to 4 and no line of `Cargo.toml` changed for this directory. No
`cargo check`, no `cargo clippy` and no `cargo test` was run with that commit: the survey that follows it is the first
cargo compile of the six files in the real crate, and until that run passes the real crate has them declared and not
compiled. What was checked before:

- The look-ahead of the round-6 survey (`rustc` alone from a scratch root in `/tmp`: the ten `pub mod` lines of
  `lib.rs` at `6f844a8b93` and `pub mod importer;`, every file read in place, against the real `bun_core` and
  `bun_collections`, the rust lints of the workspace denied): exit 0, no warning. The same with `pub mod lowering;`
  as well, which is the set of modules that `lib.rs` has at `5d5a6e614a`, against the `bun_ast` that the worktree of
  the cli unit had built (this worktree had none; `/tmp/rdr-sweep-r6.log` says why it stands for the one that cargo
  builds here): exit 0, no warning.
- `rustfmt --check --edition 2024 src/typecheck/importer/mod.rs`, which follows every `mod` line of the directory, the
  `#[cfg(test)]` one too: exit 0. The same on `lib.rs` alone (`--config skip_children=true`): exit 0.
- `python3 /workspace/notes/lint/tools/undeclared.py src/typecheck` on the tree of `ebb836b39f`: 87 of 179 files are
  reached, and no file of `importer/` is outside.
- The six files have no `unsafe`, `unwrap()`, `expect(`, `panic!`, `todo!`, `unimplemented!`, `unreachable!` and no
  `allow(`, and none of the seven has a run of two comment lines.
- Not run on these bytes in the real crate: clippy. `clippy-driver` was clean at `3febf04ee5` from the scratch root of
  `jsdoc-reparser-js-trees/port/`, which has stand-ins for `core`, `internal`, `tspath`, `diagnostics`, five scanner
  functions, `ast/ast.rs` and `ast/utilities.rs` (API.md, "Importer: the JavaScript step", "Verified"): that is not the
  crate of today.
- `cargo check` does not compile `javascript/tests.rs` (805 lines) and `mod tests` of `javascript/tree.rs` (lines 875
  to 922), which are `#[cfg(test)]`, and the look-ahead did not either. They were compiled and run from that scratch
  root only: no compiler has seen the two beside the modules of today, so whether they compile in the real crate is
  not known.

| upstream file, lines | Rust module under `src/typecheck/` | state | not ported |
| --- | --- | --- | --- |
| `parser/reparser.go` 13-748 (21 functions, `finishReparsedNode` to `wrapInJSDocNamespace`) | `importer/javascript/reparser.rs` | tested (7 inputs byte for byte against upstream's trees; 1,146 of 1,276 corpus units from the scratch root) | runs after the parse, not during it |
| `parser/jsdoc.go` 56-110 (`withJSDoc`, JavaScript part), `parser/parser.go` 330-338 (`parseErrorAtRange`), 436-447 and 613-643 (the reparse list), 5941-5966 (`newNodeList`, `newModifierList`, `finishNodeWithEnd`, `overrideParentInImmediateChildren`), 484-485 (sort of the reparsed clones) | `importer/javascript/reparser.rs` | tested | the rest of the parser |
| `parser/parser.go` 6707-6850 (`jsErrorAtRange`, `checkJSDecoratorSyntax`, `checkJSSyntax`) | `importer/javascript/jssyntax.rs` | tested (30 diagnostics of 17 codes against upstream's; the 1,251 corpus units that load, from the scratch root) | |
| `ast/deepclone.go` 75-86 (`DeepCloneReparse`, `DeepCloneReparseModifiers`) on a builder | `importer/javascript/tree.rs` | tested | `DeepCloneNode` with synthetic locations is the visitor's |
| `ast/utilities.go` on a builder: `GetAssignmentDeclarationKind` (binary expressions), `GetRightMostAssignedExpression`, `GetElementOrPropertyAccessName`, `IsModuleExportsAccessExpression`, `IsEntityNameExpressionEx`, `HasSamePropertyAccessName`, `SkipParentheses`; `ast/parseoptions.go` 86-99 (statement loop of `isFileProbablyExternalModule`) | `importer/javascript/tree.rs` | tested | the `Ast` forms are `ast/utilities.rs` |
| Go `slices.SortFunc` (`slices/zsortanyfunc.go` 10-327) | `importer/javascript/tree.rs` (`slices::sort_func`) | tested (210 vectors of Go 1.26) | |
| `parser/jsdoc.go` 112-1354 (the JSDoc parser) | `importer/javascript/jsdoc.rs` holds the conversion of TypeScript's JSDoc nodes instead | not ported | needs the type grammar of `parser.go`; API.md lists the gaps |
| `parser/references.go` (`collectExternalModuleReferences`) | | not started | the reader of the dump runs it after the JavaScript step |

## Checker: control flow narrowing and reachability (K3 step 26)

Commit `c6d6d99ac0`. Layers F-NARROW and F-REACH, the 139 functions of landing step 26: `checker/flow.go` whole (130)
and the nine narrowing helpers of `checker/checker.go` 31594-31692. All are in `checker/flow.rs`, `flow.go` first in
upstream order, then the helpers in upstream order; none is left as a stand-in. State `translated` as defined under
the checker heading above: cargo compiles none of it. API.md, same heading, says what was compiled and run instead (a
scratch crate with the `ast`, `core`, `collections`, `stringutil` and `tspath` modules of the tree, clippy, six tests).

| upstream file, lines | layer | Rust module under `src/typecheck/` | state | not ported |
| --- | --- | --- | --- | --- |
| `checker/flow.go` 24-2511 (`FlowType.isNil` to `getFlowTypeInStaticBlocks`) | F-NARROW | `checker/flow.rs` | translated | the tracer call of 121-123 |
| `checker/flow.go` 2513-2652 (`isReachableFlowNode` to `isPostSuperFlowNodeWorker`) | F-REACH | `checker/flow.rs` | translated | |
| `checker/flow.go` 2655-2764 (`isSymbolAssignedDefinitely` to `extendAssignmentPosition`) | F-NARROW | `checker/flow.rs` | translated | |
| `checker/checker.go` 31594-31605 (`isSomeSymbolAssigned`, `isSomeSymbolAssignedWorker`) | F-NARROW | `checker/flow.rs`, after the functions of `flow.go` | translated | |
| `checker/checker.go` 31614-31692 (`getNarrowableTypeForReference` to `isGenericTypeWithUndefinedConstraint`) | F-NARROW | `checker/flow.rs`, after the functions of `flow.go` | translated | |

The layer table places the two `checker.go` rows in `checker/c51_type_facts_awaited.rs`. That file belonged to another
step while this one landed, so the nine functions stand at the end of `flow.rs`, as `relater.rs` holds the functions of
its layer that upstream keeps in `checker.go`; moving them is a cut and paste, and `c51` must not get a second copy.
The records of `flow.go` 19-50 (`FlowType`, `SharedFlow`, `FlowState`) are in `checker/c01_data.rs`. F-UNREACH
(`checker.go` 2398-2477) is in `checker/c05_check_source_file.rs`.

## Checker: iteration and await, JSX, decorators (K3 steps 28 to 30)

Commits `63545ccfb7`, `4d4ebd3d98` and `ad038d4de2`. Layers D-ITER, E-AWAIT, X-JSX, E-DECOR and D-DECOR: 136 functions,
each at its upstream place among the functions of its file, none left as a stand-in. State `translated` as defined
under the checker heading above: cargo compiles none of it (`lib.rs` declares no module, and `checker/mod.rs` names
modules that the tree does not have yet). API.md, same heading, says what was compiled and run instead: rustc and
clippy-driver alone from a scratch root that mounts these files beside the `ast`, `core`, `scanner` and data model
files of the tree, and a run of the entity name parser against upstream's.

| upstream file, lines | layer | Rust module under `src/typecheck/` | state | not ported |
| --- | --- | --- | --- | --- |
| `checker/checker.go` 6112-6183 (`checkDecorators`, `checkDecorator`) | D-DECOR | `checker/c11_check_variables_decorators.rs` | translated | |
| `checker/checker.go` 6185-6824 (`checkIteratedTypeOrElementType` to `isES2015OrLaterIterable`, 30 functions), with the fields of the two resolvers of 521-535 and 1265-1300 as methods of `IterationTypesResolverKind` | D-ITER | `checker/c12_iteration_types.rs` | translated | the memo of `getGlobalBuiltinIteratorTypes` (API.md) |
| `checker/checker.go` 8833-8888 (`resolveDecorator` to `getDiagnosticHeadMessageForDecoratorResolution`) | E-DECOR | `checker/c15_calls.rs` | translated | |
| `checker/checker.go` 9273-9302 (`getDecoratorArgumentCount`, `getLegacyDecoratorArgumentCount`) | E-DECOR | `checker/c15_calls.rs` | translated | |
| `checker/checker.go` 10935-10943 (`checkAwaitExpression`) | E-AWAIT | `checker/c17_unary_meta_yield.rs` | translated | |
| `checker/checker.go` 29042-29122 (`GetPromisedTypeOfPromise`, `getPromisedTypeOfPromiseEx`) | E-AWAIT | `checker/c47_promised_mapped_template.rs` | translated | |
| `checker/checker.go` 29924-29930 (`getContextualTypeForDecorator`) | E-DECOR | `checker/c48_contextual_types.rs` | translated | |
| `checker/checker.go` 30264-30672 (`getEffectiveDecoratorArguments` to `getClassElementPropertyKeyType`, 23 functions) | E-DECOR | `checker/c49_call_arguments_decorator_signatures.rs` | translated | |
| `checker/checker.go` 31349-31591 (`checkAwaitedType` to `getAwaitedTypeOfPromiseEx`, 13 functions) | E-AWAIT | `checker/c51_type_facts_awaited.rs` | translated | |
| `checker/jsx.go` 26-32 and 42-70 (`JsxReferenceKind`, `JsxNames`, `ReactNames`), 72-1488 (`checkJsxElement` to `getJSXRuntimeImportSpecifier`, 59 functions) | X-JSX | `checker/jsx.rs` | translated | the commented-out lines 1178-1179 |
| `parser/parser.go` 282-289 (`ParseIsolatedEntityName`) with what it runs of 2950-3010 (`parseEntityName`, `parseRightSideOfDot`), 5874-5939 (`parseIdentifierName`, `createIdentifierWithDiagnostic`) and 5953-5972 (`finishNode`, `overrideParentInImmediateChildren`) | X-JSX | `checker/jsx.rs` (`parse_isolated_entity_name`) | tested (6,146 texts, each result equal to upstream's) | the rest of the parser |

`JsxFlags` and `JsxElementLinks` (`jsx.go` 17-24 and 34-40) are in `checker/c01_data.rs`. The rows of the same files
that belong to other steps are under their own headings: `c15` 9721-9737, `c47` 29124-29133 and 29198-29227 (steps 18
to 21, which came in with `63545ccfb7`), `c51` 31607-31612 and 31694-31702, `c11` 5854-6110.

## Checker: symbol merging, name resolution, aliases and modules (K3 steps 6 to 8)

Commits `404d95dbe9` and `db733c7c30`. Layers S-MERGE, N-RESOLVE, A-ALIAS, M-MODULE and Q-ENTITY: 121 functions, none
left as a stand-in. 108 are functions of `checker.go`; the 13 of `binder/nameresolver.go` came in with `b52442e510`. The
first commit also has the three leaf files that these functions call and the tree did not have (`module/types.rs`,
`module/util.rs`, `core/nodemodules.rs`).

States of this section. Cargo compiles none of the files of `checker/`: `lib.rs` does not declare `checker`, and
`checker/mod.rs` names modules that the tree does not have yet. `lib.rs` declares `core`, `binder` and `module`: the
rows of `core/nodemodules.rs` and `binder/nameresolver.rs` are under "Leaf packages" and "Binder" as well, and
`module/` is in the paragraph "Layer 6 of round 2" under the table. `checked` is more than `translated`: `rustc` and
`clippy-driver` accept the file, with the deny set and the clippy table of the workspace, in the scratch of
`k3-symbols-names-aliases-modules-scratch/run.sh`.
That scratch compiles it in place in one crate with the real `core`, `collections`, `stringutil`, `tspath`, `jsnum`,
`ast`, `evaluator`, `binder/nameresolver.rs` and the data model of the checker (`c01_data.rs`,
`c02_program_checker.rs`, `types.rs`, `mapper.rs`, `links.rs` of `761df39dfb`), and with stand-ins for what the tree
does not have yet. `run` is `checked`, and tests of that scratch enter the functions (how many is in the row): on
symbols of an open store and on files that are built and bound by hand. Neither state says anything about the code of
other steps that the stand-ins replace (API.md, same heading).

| upstream file, lines | layer | Rust module under `src/typecheck/` | state | not ported |
| --- | --- | --- | --- | --- |
| `checker/checker.go` 2182-2200 (`getSymbol`) | N-RESOLVE | `checker/c04_name_resolution_hooks.rs` | run (1 of 1) | |
| `checker/checker.go` 13991-14050 (`getResolvedSymbol` to `getCannotFindNameDiagnosticForName`) | N-RESOLVE | `checker/c21_resolved_symbols_diagnostics.rs` | run (4 of 4) | |
| `checker/checker.go` 14170-14531 (`newSymbol` to `resolveSymbolEx`) | S-MERGE | `checker/c22_symbols_merge.rs` | run (26 of 26) | |
| `checker/checker.go` 14533-15193 (`getTargetOfImportEqualsDeclaration` to `markSymbolOfAliasDeclarationIfTypeOnly`) | A-ALIAS | `checker/c23_alias_targets.rs` | run (29 of 31: not `getTargetOfBinaryExpression`, `getTargetOfAccessExpression`) | |
| `checker/checker.go` 15195-15828 (`resolveExternalModuleName` to `cloneTypeAsModuleType`) | M-MODULE | `checker/c24_external_modules.rs` | run (20 of 22: not `createModeMismatchDetails`, `isCommonJSRequire`) | |
| `checker/checker.go` 15830-15861 (`getTargetOfAliasDeclaration`) | A-ALIAS | `checker/c25_entity_names.rs` | run (1 of 1) | |
| `checker/checker.go` 15866-16012 (`resolveEntityName` to `getFullyQualifiedName`) | Q-ENTITY | `checker/c25_entity_names.rs` | run (5 of 5) | |
| `checker/checker.go` 16014-16347 (`getExportsOfSymbol` to `extendExportSymbols`) | M-MODULE | `checker/c26_exports_late_binding.rs` | run (8 of 10: not `lateBindIndexSignature`, `isNotReplacableByMethod`) | |
| `checker/checker.go` 16349-16493 (`ResolveAlias` to `getDeclarationOfAliasSymbol`) | A-ALIAS | `checker/c27_resolve_alias.rs` | run (8 of 8) | |
| `binder/nameresolver.go` 25-498 (`NameResolver.Resolve` to `isSelfReferenceLocation`) | N-RESOLVE | `binder/nameresolver.rs` (commit `b52442e510`) | checked; `resolve` is run with `get_symbol`, `get_symbol_of_declaration` and `error` as its hooks (131 of its 596 lines) | |
| `module/types.go` 47-79 (`PackageId`, `ResolvedModule`) | | `module/types.rs` | run (own tests) | the field `ResolutionDiagnostics` |
| `module/util.go` 58-79, 122-178 (`MangleScopedPackageName`, `UnmangleScopedPackageName`, `GetTypesPackageName`, `GetResolutionDiagnostic`) | | `module/util.rs` | run (own test for the names; `get_resolution_diagnostic` by the tests of the scratch) | |
| `module/types.go` 14-45 and 81-137, `module/util.go` 17-56, 81-120 and 180-201, `module/cache.go`, `module/resolver.go` | | | not started | the resolver: a resolved module is an input of the program |
| `core/nodemodules.go` | | `core/nodemodules.rs` | tested (own test; compiled with the other leaf packages by `rustc` alone, clippy clean) | |

Layer 6 of round 2 declares `module`: the line `pub mod module;` of `lib.rs` is `01d46502e3` (written by the job that
commits the worktree, under its message "typecheck: compile the port, work in progress"; the commit holds that line and
nothing else). `module/mod.rs` declares `types.rs` and `util.rs` and re-exports both; the three files (219 lines) are
unchanged since `404d95dbe9`. `types.rs` names nothing outside itself. `util.rs` names `crate::ast::{Ast, NodeId}`,
`crate::core::{CompilerOptions, JsxEmit}`, `crate::diagnostics::{self, MessageId}` with four messages,
`crate::stringutil::strings` and twelve extension constants of `crate::tspath`: `lib.rs` had the five packages before
the line, so no other file and no line of `src/typecheck/Cargo.toml` changed for this directory. No `cargo check`, no
`cargo clippy` and no `cargo test` was run with that commit: the survey that follows it is the first cargo compile of
the three files in the real crate, so the two rows of `module/` keep the state `run` of the scratch until that run
passes. What was checked when the line was written:

- By reading the tree of `2b4094382b`, each name of `util.rs` against its definition: `Ast` and `as_source_file`
  (`ast/reader.rs` 164, 526) with `SourceFile.is_declaration_file` (`ast/file.rs` 570), `NodeId` (`ast/ids.rs` 61),
  `CompilerOptions` with `allow_arbitrary_extensions`, `jsx`, `no_implicit_any`, `strict`, `get_resolve_json_module`
  and `get_allow_js`, and `JsxEmit::NONE` (`core/compileroptions.rs` 11, 13, 47, 64, 92, 234, 251, 507),
  `Tristate::is_true` and `default_if_unknown` (`core/tristate.rs` 13, 33), `MessageId::NIL` and `is_nil`
  (`diagnostics/mod.rs` 132, 135), the four messages (`diagnostics/diagnostics_generated.rs` 1314, 1422, 1695, 1720),
  `strings::{slice, slice_from, index, cut}` (`stringutil/util.rs` 730, 737, 777, 841) and the twelve constants
  (`tspath/extension.rs` 5-17): each is there, `pub`, with the types of the call.
- The look-ahead of the round-7 survey is reported as: `rustc` alone from a scratch root with the modules of layers 1
  to 5 and `pub mod module;`, the rust lints of the workspace denied: exit 0, no warning. Its log
  (`/tmp/rdr-sweep-r7.log`) was not on the machine when the line was written, so it was not read again.
- `rustfmt --check --edition 2024 src/typecheck/module/mod.rs`, which follows both `mod` lines and the two
  `#[cfg(test)]` ones: exit 0. The same on `lib.rs` alone with the new line (`--config skip_children=true`): exit 0.
- `python3 /workspace/notes/lint/tools/undeclared.py src/typecheck` on the tree of `01d46502e3`: 97 of 179 files are
  reached, and no file of `module/` is outside (the 82 files of `nodebuilder`, `pseudochecker`, `printer` and of the
  three directories of layer 7 are).
- The three files have no `unsafe`, `unwrap()`, `expect(`, `panic!`, `todo!`, `unimplemented!`, `unreachable!` and no
  `allow(`, and no run of two comment lines.
- Read side by side with upstream: `types.go` 47-79 and `util.go` 58-79 and 122-178. No difference was found besides
  the one of the last column and these: `get_resolution_diagnostic` takes `a: Ast` first and the file as a `NodeId`,
  a nil message is `MessageId::NIL`, and the nil receiver of `IsResolved` is the `None` of a program's answer.
- Not run on these bytes in the real crate: clippy (`clippy-driver` was clean in the scratch of
  `k3-symbols-names-aliases-modules-scratch/run.sh`, which is not the crate of today). `cargo check` does not compile
  `mod tests` of `types.rs` (lines 49 to 77) and of `util.rs` (lines 120 to 136): they ran from that scratch only.

The lines that the tests of the scratch run: `c04` 23 of 23, `c21` 36 of 72, `c22` 401 of 461, `c23` 562 of 889, `c24`
556 of 998, `c25` 212 of 317, `c26` 337 of 442, `c27` 122 of 160 (`K3SYM_COVERAGE=1 run.sh`).

`c04` and `c21` are also the place of rows of step 5, which this commit does not contain: `c04` 1505-2180 (N-DIAG),
`c21` 14052-14168 (D-SINK).
