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
  the 18 files, and their tests have run from the scratch root only.
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

Commit `9684ef6a7d`. Not compiled by cargo (`lib.rs` does not declare `lowering`). `tested` means: compiled with
`rustc` alone from a scratch root and compared with trees of typescript-go (API.md, "Lowering", "Verified"). Each
function reads the tokens of the function of `internal/parser/parser.go` that its comment names; the grammar
decisions are Bun's, so these rows are not a port of the parser.

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

Commit `3febf04ee5`. Not compiled by cargo yet (`lib.rs` does not declare `importer`); `ported` and `tested` mean
compiled and run with `rustc` alone from the scratch root of `jsdoc-reparser-js-trees/port/` (API.md, "Importer: the
JavaScript step").

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

States of this section. Cargo compiles none of it: `lib.rs` declares no module, and `checker/mod.rs` names modules that
the tree does not have yet. `checked` is more than `translated`: `rustc` and `clippy-driver` accept the file, with the
deny set and the clippy table of the workspace, in the scratch of `k3-symbols-names-aliases-modules-scratch/run.sh`.
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

The lines that the tests of the scratch run: `c04` 23 of 23, `c21` 36 of 72, `c22` 401 of 461, `c23` 562 of 889, `c24`
556 of 998, `c25` 212 of 317, `c26` 337 of 442, `c27` 122 of 160 (`K3SYM_COVERAGE=1 run.sh`).

`c04` and `c21` are also the place of rows of step 5, which this commit does not contain: `c04` 1505-2180 (N-DIAG),
`c21` 14052-14168 (D-SINK).
