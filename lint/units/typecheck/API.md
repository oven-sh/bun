# API of the typecheck unit

What another part of the port reads to call the crate `bun_typecheck` (`/workspace/wt/typecheck/src/typecheck`,
branch `robobun/abbc0c92/lint-typecheck`). The reference is microsoft/typescript-go 89d5d5b
(`/workspace/ref/typescript-go`). Each section names the commit that it describes and says what was verified.

## Leaf packages: `core`, `collections`, `jsnum`, `stringutil`, `tspath`

Commit `1e45ca9abb`. 32 Rust modules, one per upstream file with upstream's name, and one `mod.rs` per package that
declares them and re-exports their public names, so `core.Filter` of upstream is `crate::core::filter`.

Wired since `80dcacd6db`: `lib.rs` declares the five packages
(`pub mod collections; pub mod core; pub mod jsnum; pub mod stringutil; pub mod tspath;`), and they need nothing
else: they use `std` only and each other (`core` uses `collections`, `stringutil`, `tspath`; `jsnum` and `tspath`
use `stringutil`). At `1e45ca9abb` `lib.rs` had no `pub mod` line and cargo did not compile these files: what was
verified then is in "Verified" below, and PORT_STATUS.md names the commit that declares each package.

`src/typecheck/.gitignore` holds `!/core/`: line 203 of the root `.gitignore` is `core` (core dumps), which ignores
the directory `src/typecheck/core/` too. Without that file `git status` shows nothing under `core/` and `git add`
refuses a new file there.

### Types of Go in these packages

| Go | Rust |
| --- | --- |
| `string` | `&[u8]` in, `Vec<u8>` out; `&'a [u8]` out when the result is always a part of one argument or a constant; `Cow<'a, [u8]>` when upstream returns the argument itself on its fast path (`normalize_slashes`, `to_file_name_lower_case`, `get_canonical_file_name`, `to_lower_js`, `to_upper_js`, `combine_surrogate_pairs`, `add_utf8_byte_order_mark`) |
| `rune` | `u32`. A size in bytes that a decode function returns is `usize` |
| `int` | `isize` (`-1` stays the "not found" answer of `find_index`, `strings::index`, `get_encoded_root_length` and the like) |
| a text position | `i32`: `TextPos(pub i32)`, `new_text_range(pos: i32, end: i32)`, `TextRange::pos()`, `end()`, `len()`, `contains(pos)` |
| a named numeric type | a tuple struct with its constants in upper snake case and without the prefix of the type: `Tristate::TRUE`, `ScriptKind::TSX`, `ScriptTarget::ES2015`, `ScriptTarget::ES_NEXT`, `ScriptTarget::LATEST_STANDARD`, `ModuleKind::COMMON_JS`, `ModuleKind::NODE_NEXT`, `ModuleResolutionKind::BUNDLER`, `JsxEmit::REACT_JSX_DEV`, `LanguageVariant::STANDARD`, `NewLineKind::CRLF`, `ModuleDetectionKind::FORCE`, `RESOLUTION_MODE_ESM`. Also `UTF16Offset(pub isize)`, `Number(pub f64)`, `Path(pub Vec<u8>)`. Every value of the Go type is a value: `ScriptKind(5).string()` is `ScriptKind(5)` |
| the zero value of `T` | `T::default()`: `find`, `find_last`, `first_or_nil`, `last_or_nil`, `element_or_nil`, `first_non_nil`, `first_non_zero`, `or_else`, `coalesce`, `map_non_nil`, `single_element_slice`, `get_spelling_suggestion_*` need `T: Default` (and `PartialEq` where upstream compares with it) |
| `[]T` | `&[T]` in. The callback of a slice helper gets each element by value (`T: Copy`), as upstream's does. A fresh slice out is `Vec<T>`. A nil slice and an empty slice are the same |
| a result that can be the argument | `Cow<'a, [T]>`: `filter`, `filter_index`, `same_map`, `same_map_index`, `concatenate`, `splice`, `deduplicate` borrow the argument when upstream returns it, so `core::same(&result, argument)` answers what it answers upstream. `append_if_unique`, `insert_sorted`, `deduplicate_sorted` take the `Vec` and return it |
| `(T, bool)` | `Option<T>`: `OrderedMap::get`, `entry_at`, `delete`, `CopyOnWriteMap::get`, `PagedLinkStore::try_get`, `simple_normalize_path`, the callback of `map_filtered`. `trim_file_path_prefix` and `split_volume_path` keep the tuple: their string has a meaning when the flag is false |
| `iter.Seq[T]` | `impl Iterator` out, `impl IntoIterator` in |
| a callback `(result T, stop bool)` | `Option<T>`: `Some` stops with the result (`for_each_ancestor_directory*`) |
| `map[K]V`, `map[K]struct{}` | `BTreeMap`, `BTreeSet` of `std`. Keys need `Ord`, and a loop over `Set::keys()`, `MultiMap::keys()` or `values()` runs in ascending order of the keys where Go's order is random. The crate has no dependency yet; with `bun_collections` the map is one field per file to change |
| a nil receiver | the empty value: `Set::default()`, `OrderedMap::default()`; `CompilerOptions::paths` and every `[]string` option are `Option` because upstream tests them against nil |
| `panic(message)` | `Result<T, &'static str>` with upstream's message: the caller records the internal diagnostic. `Stack::pop`, `Stack::peek`, `Pattern::matched_text`, `ModuleResolutionKind::string`, `JsxEmit::string`, `CompilerOptions::get_effective_type_roots`, `check_each_defined`, `parse_pseudo_big_int`, `parse_valid_big_int`, `get_relative_path_from_directory`, `get_relative_path_from_file`, `get_common_parents` |
| a panic of Go's runtime (index out of range) | no panic: an index outside a string or slice is clamped or gives the zero value. `strings::slice`, `slice_from`, `slice_to`, `byte_at`, `element_or_nil`, `replace_element`, `index_after`, `remove_extension`, `Pattern::matches` of a pattern that is not valid (false), `position_to_line_and_byte_offset` without line starts |

No function of these packages can panic on its input: no `unwrap`, no `expect`, no index that is not a constant into
a fixed array, no arithmetic that can overflow, no recursion that the input can make deep (the test modules aside).

### Go's library, where the ported code calls it

These are modules inside the file that needs them most, so that no module exists without an upstream file:

- `stringutil::util::utf8`: `decode_rune_in_string`, `decode_last_rune_in_string`, `rune_count_in_string`,
  `append_rune`, `range` (`for i, r := range s`), `runes` (`[]rune(s)`), `RUNE_ERROR`, `RUNE_SELF`, `MAX_RUNE`,
  `UTF_MAX`. A byte that is not part of valid UTF-8 is U+FFFD with size 1, as in Go. A lone surrogate is three such
  bytes for these functions; `decode_js_string_rune` is upstream's function that reads it as one rune.
- `stringutil::util::utf16`: `is_surrogate`, `decode_rune`, `encode_rune`, `rune_len`.
- `stringutil::util::unicode`: `Range16`, `Range32`, `RangeTable`, `is`, `ZS`, `to_lower`, `to_upper`, `simple_fold`.
  The three case functions answer what Go 1.24 and 1.26 answer (Unicode 15.0.0) for every rune: they read upstream's
  casing table (Unicode 15.1.0) and three lists of the runes where Go differs from it (1, 27 and 36 entries).
- `stringutil::util::strings`: `index`, `index_byte`, `last_index`, `last_index_byte`, `index_any` (ASCII set),
  `contains`, `count`, `cut`, `cut_prefix`, `trim_prefix`, `trim_suffix`, `trim_left`, `trim_right` (ASCII set),
  `trim_func`, `replace_all`, `split`, `join`, `compare`, `map`, `to_lower`, `equal_fold`, and Go's slice expressions
  `slice`, `slice_from`, `slice_to`, `byte_at`. They are plain loops: with `bun_core` as a dependency the searches
  are the place to call `bun_core::strings`.
- `jsnum::string::strconv`: `format_int`, `parse_int`, `parse_float` (decimal text), `append_float` (formats `e` and
  `f`, shortest digits).
- `jsnum::jsnum::math`: `frexp`, `ldexp`, `modf`, `log`, `exp`, `log2`, `pow`. `jsnum::jsnum::big::Int`: `new`, `exp`,
  `set_string` (base 0), `float64`, `float64_with_prec`, `string`.

### Differences from upstream

Files that are not ported: `collections/syncmap.go`, `collections/syncset.go`, `core/semaphore.go`,
`core/workgroup.go` (one checker, one thread). Not started, because binder and checker do not call them:
`core/bfs.go`, `buildoptions.go`, `context.go`, `projectreference.go`, `textchange.go`,
`typeacquisition.go`, `version.go`, `watchoptions.go`, `tspath/ignoredpaths.go`. `stringutil/generate.go` holds
`go:generate` lines only.

`core/core.go`
- Not ported: `ApplyDebugStackLimit` (an environment variable and Go's stack limit), `Must` and `FirstResult` (Go's
  multiple results), `StringifyJson` (`internal/json`), `comparableValuesEqual`, `DiffMaps`, `DiffMapsFunc`,
  `CopyMapInto` (helpers of Go's `map`).
- `GetSpellingSuggestion` is `get_spelling_suggestion_exported`: `getSpellingSuggestion` has the same snake case
  name. The `sync.Pool` of the two buffers is two local buffers. `debug.Assert(distance <= bestDistance)`: the
  candidate is skipped (it cannot happen: `levenshtein_with_max` answers -1 above the maximum).
- `ECMALineStarts` is `Vec<TextPos>`. `compute_ecma_line_starts_seq` yields `TextPos`.
- `or` takes `&[&dyn Fn(T) -> bool]`. `memoize` takes `FnOnce` and needs `T: Clone + Default`.
- `find_best_pattern_match(values: &[T], get_pattern: impl Fn(&T) -> &Pattern, candidate) -> Option<&T>`: by
  reference, because its elements are records and not ids.

`core/compileroptions.go`
- `noCopy`, `optionsType` and `Clone` by reflection: `#[derive(Clone)]`. `EmptyCompilerOptions` is
  `empty_compiler_options()`. `ModuleKindToModuleResolutionKind` is `module_kind_to_module_resolution_kind(kind)`.
- A `string` option is `Vec<u8>` (empty when not set), a `[]string` option `Option<Vec<Vec<u8>>>`, `Paths`
  `Option<OrderedMap<Vec<u8>, Vec<Vec<u8>>>>`, `MaxNodeModuleJsDepth` and `Checkers` `Option<isize>`.
- The field names are upstream's in snake case: `es_module_interop`, `emit_bom`, `ts_build_info_file`.

`core/arena.go`, `core/linkstore.go`, `core/stack.go`, `core/pattern.go`, `core/tristate.go`, the stringers
- `Arena<T>`: `new()` returns the index of the element (`u32`), `new_slice(size)`, `new_slice1(t)`, `clone(&[T])`
  return the range of indexes. One `Vec` that grows holds the elements, so an index stays valid; upstream's pages
  exist to keep pointers valid. Added to read through an index: `get`, `get_mut`, `slice`, `slice_mut`, `len`.
- `LinkStore<K, V>`: `get(key)` returns a `Link<V>` (`Copy`, `is_nil()`), `try_get(key)` the nil link for a key
  without links, and the store is indexed by a link: `store[link].field`. A read through the nil link gives the
  zero value and a write lands in a scratch value, where upstream panics.
- `PagedLinkStore<V>`: `get(key) -> &mut V`, `try_get(key) -> Option<&V>`, `has(key)`.
- `Tristate::unmarshal_json` and `marshal_json` return no error (upstream's is always nil).
- `string()` of `Tristate`, `ScriptKind`, `LanguageVariant`, `ModuleKind`, `ScriptTarget` returns `Vec<u8>`.

`collections`
- `OrderedMap`: `MarshalJSONTo`, `UnmarshalJSONFrom`, `resolveKeyName` are not ported (`internal/json`), nor is
  `noCopy`. `keys()`, `values()` and `entries()` borrow the map, so a loop cannot add to it. A loop that must see
  what its body adds goes by position: `OrderedMap::entry_at(index)`, and `OrderedSet::value_at(position)`, which
  upstream does not have.
- `Set::union` has no nil receiver and so no panic. `Set::keys()` returns the `BTreeSet`.
- `CopyOnWriteMap::enter_scope()` and `CopyOnWriteSet::enter_scope()` return the saved state. Upstream returns a
  function that restores it: assign the value back instead (`names = saved;`). The backing map is in an `Arc`.

`jsnum`
- `Number` has `+`, `-`, `*`, `/` and unary `-`. `NaN()`, `IsNaN`, `Inf(sign)`, `IsInf` are `nan()`, `is_nan()`,
  `inf(sign)`, `is_inf()`. `trunc`, `negativeZero` and `errUnknownPrefix` are not ported: nothing uses them upstream.
- `Number::string()`: the shortest digits come from exact integer arithmetic (the closest shortest digits, an even
  last digit on a tie), which is what Go's `strconv` gives. Rust's own formatting rounds such a tie up.
- `exponentiate`: `math::pow`, `log` and `exp` are Go's on amd64 with FMA, bit for bit (`f64::mul_add` is the fused
  operation on every target). Go's result differs between amd64 with FMA, amd64 without and arm64; the goldens are
  from amd64 with FMA. `int64(b)` of a base of 2^63 is `i64::MAX` here (Go leaves it to the platform: arm64 gives
  that, amd64 gives `i64::MIN`, which makes `2**63 ** 1` negative there).

`stringutil`
- `specialCasingMappings` is a sorted table of code points (rune, lower, upper; a mapping of two or three runes is
  an index into a second table) with `special_casing_mappings(r) -> Option<SpecialCasingMapping>` in place of the
  map. 12 bytes a row and no pointer, where three strings a row are 56 bytes and three relocations.
- The regular expression `\\.` of `UnquoteString` is a loop with the same matches.

`tspath`
- `ComparePathsOptions<'a>` is `Copy` and borrows `current_directory`; pass it by value.
- `get_common_parents` returns `(parents, ignored)` with `ignored` a `BTreeSet`. A parent never shares storage with
  the components of a path. Upstream appends each sub-result to a head that does (`append(group.head, sr...)`), so
  with two levels of fan-out it answers one parent twice: `/a/b/c, /a/d/e, /f/g/h, /f/i/j` with 3 components gives
  `/a/b/c, /a/b/c, /f/g/h, /f/g/h` upstream and the four paths here.
- `TryGetExtensionFromPath` of extension.go and `tryGetExtensionFromPath` of path.go are both
  `try_get_extension_from_path`, one public in `extension`, one private in `path`.
- `normalizedUpTo-1 >= 0` is written `normalized_up_to > 0` (clippy `int_plus_one`).

### Verified

At `1e45ca9abb` nothing was built with cargo or `bun bd`: `lib.rs` did not declare the modules. The five packages
were compiled in place with `rustc` alone from a scratch root (`#[path]` to the five `mod.rs`), with the `deny` set
of the workspace (`warnings`, `dead_code`, `unreachable_pub`, `unused_*`), then with `clippy-driver` and the
repository's `clippy.toml` and lint table (library and tests), and `rustfmt --check`. All clean.

The 38 `#[test]`s of the packages ran from that scratch root and pass, also with overflow checks and debug
assertions on. They replay what upstream's Go code answers (`testdata/*.tsv` beside the modules):

| package | vectors |
| --- | --- |
| `stringutil` | 1,796 lines of `util.go` functions, 1,936 pairs through the 11 functions of `compare.go`, 133 strings through `ToLowerJS` and `ToUpperJS`; a digest over all 1,112,064 code points of `ToLowerJS`, `ToUpperJS`, `IsUnicodeIdentifierStart`, `IsUnicodeIdentifierPart` (the 140,160 `C` lines of the golden `leafdump`); a digest over all code points of the rune predicates and of Go's `unicode.ToLower`, `ToUpper`, `SimpleFold`, `Is(Zs)` |
| `jsnum` | 381 `FromString`, 4,310 `String`, 400 lines of the seven binary operations, 400 `BitwiseNOT`, 1,242 `Exponentiate` (600 with a fractional exponent), 96 lines of `ParsePseudoBigInt` and `ParseValidBigInt` |
| `tspath` | 418 paths (the string literals of upstream's three test files up to 64 bytes, and about 100 more) with 58 answers each, 1,849 ordered pairs of 43 paths with 34 answers each (both as digests), 15 triples, 30 `GetCommonParents` cases |
| `core` | 304 pattern cases, 151 lines: script kinds, stringers, `Tristate`, module kinds, line starts, `UTF16Len`, spelling suggestions, `IndexAfter`, the option getters, and a digest over 5,040 combinations of target, module, module resolution and module detection |
| `collections` | upstream's `TestOrderedMap` and `TestOrderedSet`, and tests of `Set`, `MultiMap`, the copy-on-write map and set |

Run once from the scratch root and not part of the tree: every line of the three golden files of
`leaf-packages-scratch/golden/run.sh` (`vectors_126.tsv`, `vectors2.tsv`, `vectors4.tsv`, with the sha256 of
`oracle-toolchain-and-goldens/bottom-up/replay-inputs/leaf/sha256.txt`): `F` 381, `S` 300,273 + 2,999,771, `B` 20,000,
`N` 20,000, `P` 20,042 + 20,000, `G` 25, no mismatch. The research prototype had 2,504 mismatches on the 20,000
fractional powers; Go's `exp` and `log` of amd64 removed them. And 60,000 random byte strings through every
function that takes text, and 400,000 random doubles through `string`, `from_string` (which gives the double
back) and the operators: no panic.

To make the vectors and the two generated tables again, and to run the checks:
`sh /workspace/notes/lint/units/typecheck/leaf-packages-scratch/port/regen.sh [vectors|tables|check|all]`. It needs
Go 1.24, `rustc`, `clippy-driver`, `rustfmt`, and `/tmp/golden` from `leaf-packages-scratch/golden/run.sh` for the
`jsnum` samples. `cargo test -p bun_typecheck` runs the same tests once `lib.rs` declares the modules; five of them
are `#[cfg_attr(miri, ignore)]` (two loops over all code points, three long replays).

### What callers in the tree expect and these packages do not have

Seen in files of other packages on 2026-09-30, for whoever owns them:
- `crate::core::{List, Map, Text, binary_search_func, sort_stable_func}`: Go's slice and map values and Go's
  `slices` sorting are not upstream's `internal/core` and are not in this commit. `core/mod.rs` is where a module
  that holds them is declared and re-exported. Since `0aa0a67449` that module is `core/golang.rs`, with `List` and
  `GoIndex` ("Node table: the wiring of `ast`" below), and since `a9b14ab2d6` with `Text` ("Binder: the wiring of
  `binder`" below); `Map` and the two sorting functions are not in it yet.
- `checker/nodebuilderimpl.rs` writes `ModuleKind::ESNext`, `ModuleKind::None`, `ModuleKind::CommonJS`,
  `LanguageVariant::Standard`, `ModuleResolutionKind::NodeNext`, `ModuleResolutionKind::Node16`: the constants are
  `ES_NEXT`, `NONE`, `COMMON_JS`, `STANDARD`, `NODE_NEXT`, `NODE16`, as the other files write them.

## Diagnostics: `diagnostics`

Commits `2d9e7ee843` (the files) and `a53def3305` (`pub mod diagnostics;`). The port of `internal/diagnostics`: the
message table and what formats a message. The three Rust files are those of
`checker-data-model-contract/bottom-up/crate/src/diagnostics/`, byte for byte. The diagnostic itself (`ast.Diagnostic`,
its arguments, its chain and related information) is `internal/ast/diagnostic.go` and was not in the tree at these
commits; since `a8b48548a6` the type of one argument, `ast::Arg`, is (`ast/diagnostic.rs`), and since `d0230a94c6` the
diagnostic and its store ("Binder: the wiring of `binder`" below).

### How a caller writes the calls

- A message is `diagnostics::MessageId`, a `Copy` id whose number is the code of the message.
  `diagnostics.Type_0_is_not_assignable_to_type_1` is `diagnostics::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1`: upstream's
  variable name in upper case, 2,206 constants. `MessageId::NIL` is the nil `*Message`, `is_nil()` the test for it, and
  `==` the pointer comparison of upstream.
- `code() -> i32`, `category() -> Category`, `key() -> Vec<u8>`, `reports_unnecessary()`,
  `elided_in_compatibility_pyramid()`, `reports_deprecated()`; and, not upstream's, `text() -> &'static [u8]` (the
  English text), `argument_count()` (the highest placeholder plus one), `is_valid()` (the id is a code of the table).
- `Category::{Warning, Error, Suggestion, Message}` with Go's values 0 to 3, and `name()`.
- `localize(Locale, message, ad_hoc_text, args: &[&[u8]]) -> (Vec<u8>, Result<(), InvalidPlaceholder>)`, and
  `format(text, args)` with the same result. An argument is a byte string that the caller has printed;
  `write_decimal(&mut out, i64)` prints an integer.
- `NewAdHocMessage(text)` is `MessageId::AD_HOC` (code -1, category error, key `-1`): the holder keeps the text and
  hands it to `localize` as `ad_hoc_text`.

### Differences from upstream

- English only. `Locale` is a unit (`Locale::DEFAULT`); the localized texts (`loc_generated.go`, `loc/`) and the lookup
  of a message by its key (`keyToMessage`, for a diagnostic read back from build info) are not ported.
- `Format` panics on a placeholder that has no argument. `format` returns `Err(InvalidPlaceholder)` beside the text, in
  which that placeholder stays as written: the caller records the internal diagnostic.
- An id that is not a code of the table, `NIL` too, has the category `Error`, no flag and an empty text, where upstream
  dereferences nil.
- `StringifyArgs` and `Message.String` are not ported.

### The table, its generator and the two copied files

`diagnostics/diagnostics_generated.rs` is written by `bun src/typecheck/scripts/generate-diagnostics.ts` from the two
files beside the script. Both are copies of upstream files (Apache-2.0), formatted by prettier as the repository formats
every JSON file under `src/`: `scripts/diagnosticMessages.json` is `src/compiler/diagnosticMessages.json` of
microsoft/TypeScript 5848bc5 (2,130 messages), `scripts/extraDiagnosticMessages.json` is
`internal/diagnostics/extraDiagnosticMessages.json` of microsoft/typescript-go 89d5d5b (86 messages). The script pins
each by the sha256 of its parsed content, so a copy with other messages does not generate. The extras win by code (10
codes are in both files): 2,206 messages, in the order of their codes. `generate(messagesJson, extraJson)`, `merge` and
`convertPropertyName` are exported for a test.

### Verified

- The generator, run in the tree, writes the table that is checked in, and that table is the contract's byte for byte.
- `bun diagnostics-scratch/data/table-against-upstream-go.mjs` (notes): the 2,206 rows equal the 2,206 variables of
  upstream's `diagnostics_generated.go` in name (upper case), code, category, flags and text, in the same order, and the
  numbers that `diagnostics/tests.rs` asserts are the ones that the script recomputes from that file.
- `rustfmt --check` on the three Rust files, prettier `--check` with the repository's configuration on the script and
  the two JSON files, and the comment check of the repository (no run of two comment lines) on the commit.
- Not run with these commits: `cargo check`, `cargo clippy`, `cargo test`. The same bytes were compiled by `rustc` alone
  beside the five leaf packages (the look-ahead of the round-3 survey) and checked, linted and tested by cargo in the
  contract crate (`checker-data-model-contract/bottom-up/data/run.log`, five tests).

### What waits

- A test that fails when the table and the generator disagree, as `test/internal/typecheck-ast-generated.test.ts` is
  for the node definitions. It is written for the tree's layout in
  `diagnostics-scratch/test/typecheck-diagnostics-generated.test.ts` of the notes and was not run as a test (a script
  that makes its comparison says equal, and unequal after one row is changed). Until it is in the tree: run the
  generator, then `git diff --exit-code src/typecheck/diagnostics`.
- The constants are `pub`, as the contract has them, and 589 of the 2,206 are named by the tree: what the `unused_pub`
  count of `cargo mordant` makes of the others was not looked at.
- `src/typecheck/UPSTREAM_PORTED` does not exist. The table names both upstream commits in its first line and the
  generator in `pinned`.

## Node table: the wiring of `ast`

Commits `0aa0a67449` and `2caaa157eb` (`core/golang.rs`), `a8b48548a6` (the two dependencies, `ast/diagnostic.rs`) and
`887629cf2c` (`pub mod ast;`). The 28 files of `ast/` are those of round 1, unchanged but for two lines of `ast/mod.rs`.
This section says what the crate got so that cargo compiles them; the rows are in PORT_STATUS.md, "Node table".

### How a caller writes the calls

- `crate::core::List<'a, T>` is a Go `[]T` that is stored or passed: `Copy`, 16 bytes, nil-able. `List::NIL` and
  `List::default()` are the nil slice; `List::from_slice(&[T])` is a slice that is not nil, also when it is empty;
  `is_nil()` tells them apart. The methods need `T: Copy + Default`: `as_slice() -> &'a [T]`, `len() -> isize` (Go's
  `int`), `at(index) -> T` (the zero value of `T` where Go panics: an index below 0 or not below `len`), `iter()` (the
  elements by value), `same(other)` (`core.Same`: the same backing array and the same length; two empty lists are the
  same, nil or not), `sub(lo, hi)` (`s[lo:hi]`: both bounds are clamped to the list and `lo` to `hi` where Go panics;
  a part of the nil list is the nil list, and a part of another list is never nil).
- An index is `impl GoIndex`: `usize`, `isize` or `i32`. An integer literal is an `i32`.
- `crate::ast::Arg<'a>` is one `any` of upstream's `args ...any`: `Arg::Str(&'a [u8])`, `Arg::Int(i64)`,
  `Arg::Bool(bool)`; a callee takes `&[Arg<'_>]`. `Arg::default()` is `Arg::Str(b"")`, so a `List<'a, Arg<'a>>` has its
  methods. `From` is implemented for `&[u8]`, `&[u8; N]`, `&str`, `i32`, `isize`, `usize` (a value above `i64::MAX` is
  `i64::MAX`) and `bool`. The other files of the tree write the variants (`Arg::Str` 416 times, `Arg::Int` 34,
  `Arg::Bool` 3) and `Arg::from` nowhere.
- `src/typecheck/Cargo.toml` has `bun_collections` and `bun_core`, both as `workspace = true`. The first module of a
  later layer that names another crate adds its line when it is declared (the lowering: `bun_ast`, and
  `bun_js_parser` and `bun_alloc` for its tests).

### Differences from the contract

- `core/golang.rs` is lines 7 to 81 of the contract's `tscore/golang.rs` with another body of `List::sub`: the
  contract's gives an empty list that is not nil for a part of the nil list, Go gives nil ("If the sliced operand of a
  valid slice expression is a nil slice, the result is a nil slice"), and `sub_list` of `checker/types.rs` keeps the nil
  list nil as well. No file of the tree calls `List::sub`; `LiveList::sub` of the contract has the same body as the
  contract's `List::sub`.
- The rest of that file is not in the tree: `Text`, `SliceBuf`, `LiveList`, `Map`, `Memo`, `compare_strings`,
  `compare_f64`. The files that name them are of later layers (`binder`: `Text`; `checker`: `Text`, `Map`, `LiveList`,
  `Memo`). `Map` is written on `bun_collections::HashMap`, which is a dependency now. Its `OrderedMap`, `Set`,
  `OrderedSet` and `Tristate` have the names of types that `collections/` and `core/tristate.rs` hold in another form:
  which form the files of the checker expect was not looked at.
- `ast/diagnostic.rs` is lines 18 to 66 of the contract's `ast_diagnostic.rs` and not the rest (the diagnostic, its
  store, the collection, the comparison): that port names `crate::tscore::{ids, records, slices, text}`, and the tree
  has no module of those paths.
- Layer 4 changed two of these three points: `Text`, the diagnostic and its store are in the tree since `a9b14ab2d6`
  and `d0230a94c6` ("Binder: the wiring of `binder`" below).

### Verified

- Not run with these commits: `cargo check`, `cargo clippy`, `cargo test`. The survey that follows them is the first
  cargo compile of `ast/` and of `core/golang.rs` in the real crate.
- The look-ahead of the round-4 survey, before the commits: `rustc` alone from a scratch root in `/tmp`, the 28 files
  of `ast/` and the two of `scanner/` read in place beside layers 1 and 2, against the real `bun_core` and
  `bun_collections`, the rust lints of the workspace denied, with the contract's `List` and the bare enum `Arg`: exit
  0, no warning.
- `core/golang.rs` and `ast/diagnostic.rs` as committed, alone (both name `std` only): `rustc` and `clippy-driver`
  (the clippy table of the workspace, the repository's `clippy.toml`) with the rust lints of the workspace denied, as
  a library and with `--test`: exit 0, no warning; the test `list_is_a_go_slice` passes, and fails at the nil list
  when the body of `sub` is the contract's.
- `rustfmt --check --edition 2024 src/typecheck/lib.rs` (it follows every `mod` line): exit 0.
  `python3 /workspace/notes/lint/tools/undeclared.py src/typecheck`: 76 of 179 files are reached, none of `ast/` or
  `scanner/` is outside.
- Not looked at: clippy on the 28 files of round 1; `ast/tests.rs` (`#[cfg(test)]`, which `cargo check` does not
  compile: it imports `crate::core::{List, new_text_range}`); any body of `ast/` against upstream.

### What waits

- `crate::core::{Text, Map, LiveList, Memo}` and `crate::ast::{DiagnosticId, DiagnosticStore, Diagnostics,
  DiagnosticsCollection, RepopulateDiagnosticInfo, RepopulateDiagnosticKind, deep_clone_node}`: files of the layers
  after this one name them and no file defines them (the probe of the round-4 survey). The contract's
  `tscore/golang.rs` and `ast_diagnostic.rs` hold all but `deep_clone_node`. Layer 4 brought `Text`, `DiagnosticId` and
  `DiagnosticStore`; the others wait ("Binder: the wiring of `binder`" below).
- `lowering::ParseDiagnostic` and `importer::javascript::ParseDiagnostic` stay two types until `ast/diagnostic.rs` has
  the diagnostic itself. It has since `d0230a94c6`; the two types are still there.

## Binder: the wiring of `binder`

Commits `a9b14ab2d6` (`core/golang.rs`, `ast/ids.rs`) and `d0230a94c6` (`ast/diagnostic.rs`, `ast/file.rs`,
`ast/open.rs`, `ast/publish.rs`, and `pub mod binder;` in `lib.rs`), both written by the job that commits the worktree.
The four files of `binder/` are those of round 1, unchanged. This section says what the crate got so that cargo
compiles them; the rows are in PORT_STATUS.md, "Binder" and "Node table".

### How a caller writes the calls

- `crate::core::Text<'a>` is `&'a [u8]`: a Go `string` that a record keeps or a function hands on. The bytes are in
  the text of a file, in an arena (`Open::arena` for a name that the binder builds) or in a constant.
- `crate::ast::DiagnosticId` is a diagnostic: its index in the `DiagnosticStore` that made it. It has what every id of
  `ast/ids.rs` has (`NIL`, `is_nil()`, `Default`, `Ord`, `Hash`), and bit 31 is never set. An id says nothing without
  its store: two stores give out the same ids.
- `crate::ast::DiagnosticStore` holds the diagnostics of one parser, one binder or one checker.
  `DiagnosticStore::default()` is the empty store.
  - `new_diagnostic(file: NodeId, loc: TextRange, message: MessageId, args: &[Arg<'_>]) -> DiagnosticId` is
    `ast.NewDiagnostic`: `file` is the root of a source file, or `NodeId::NIL`. Beside it
    `new_diagnostic_chain(chain, message, args)`, `new_compiler_diagnostic(message, args)`, and
    `new_ad_hoc_diagnostic(file, loc, text)` for a diagnostic of `diagnostics.NewAdHocMessage(text)`.
  - A method of upstream's `*Diagnostic` that stores a pointer is a method of the store: `add_message_chain(d, chain)`,
    `set_message_chain(d, Vec<DiagnosticId>)`, `add_related_info(d, related)`, `set_related_info(d, Vec<DiagnosticId>)`
    (each returns `d`; a nil `chain` or `related` adds nothing), and `clone_diagnostic(d)` for `Clone`.
  - `store[id]` is the `Diagnostic`: `file()`, `pos()`, `end()`, `len()`, `loc()`, `code()`, `category()`, `source()`,
    `message()` (the `MessageId`), `message_text()`, `message_key()`, `message_args()`, `message_chain()`,
    `related_information()`, `reports_unnecessary()`, `reports_deprecated()`, `skipped_on_no_emit()`,
    `localize(Locale)`; and through `store[id]` as a place that is written: `set_file`, `set_location`, `set_category`,
    `set_skipped_on_no_emit`.
  - A read through `DiagnosticId::NIL`, or through an id that the store did not give, is the zero `Diagnostic`; a write
    through one lands in a scratch value. Upstream dereferences nil there.
  - `fault_count()` and `take_faults() -> Vec<InvalidPlaceholderFault>`: a message that got arguments, but fewer than
    its highest placeholder needs, is a panic of upstream's `Format`. `new_diagnostic` makes the diagnostic as written,
    counts the fault and keeps the first 64.
- The diagnostics of a file, through the view `a.as_source_file(root)`:
  - `diagnostics() -> &[DiagnosticId]` is `SourceFile.Diagnostics()`, the parse diagnostics, and
    `diagnostic_store() -> Option<&DiagnosticStore>` is the store that they are ids of. The producer of the file sets
    both, as the fields `diagnostics` and `diagnostic_store` of `SourceFileData`: in the value that it hands to
    `FileBuilder::finish`, or in `File::source_file` afterwards.
  - `bind_diagnostics() -> &[DiagnosticId]` is `SourceFile.BindDiagnostics()`, and
    `bind_diagnostic_store() -> Option<&DiagnosticStore>` is the store of the binder of the file. Until the binding of
    the file has ended the first is empty and the second is `None`.
  - `Ast::set_bind_diagnostics(root, store, diagnostics)` is `SourceFile.SetBindDiagnostics`: the binder calls it once,
    at the end, with its whole store. As every write of a binder about its file, it records a fault when `root` is not
    the root of the file that the context binds.
- `binder::bind_source_file_exported(file: &File, ids: &IdAllocator)` is `BindSourceFile` (`bindSourceFile` has the
  same snake case name). After it `file.bound()` is `Some`.

### Differences from the contract

- `DiagnosticStore` keeps its diagnostics in a `Vec` of its own and not in `Records<DiagnosticId, Diagnostic>` of the
  contract's `tscore/records.rs`. `Records` counts the reads through nil in a `Cell`, so a store with it is not `Sync`;
  and a store is now a part of a file (`SourceFileData`) and of what its binder left (`Bound`), which the programs and
  the checkers of a process share (`ast/file.rs` asserts that `File` is `Sync`). What a caller sees is the same: index
  0 is the nil diagnostic, a write through nil lands in a scratch value, and the id space ends at the open bit. The
  two counters of `Records` are gone: no method of the contract's store showed them.
- `DiagnosticStore` derives `Debug`, because `SourceFileData` does.
- `new_compiler_diagnostic` calls `core::undefined_text_range()`: the `TextRange` of the tree has no `undefined()`.
- Lines 10 to 16 and 337 to 739 of the contract's `ast_diagnostic.rs` are not in the tree: the trait `SourceFiles`,
  `Diagnostics { store, files }` with the comparisons, and `DiagnosticsCollection`. They need Go's `slices` sorting
  (the contract's `tscore/slices.rs`), and no file of layers 1 to 4 names them.
- The contract does not say where the diagnostics of a file are. `set_bind_diagnostics` and `SourceFile::diagnostics`
  are the two names that `binder/binder.rs` calls; the fields behind them and the three other readers are new.

### Verified

No compiler has seen the two commits: no `cargo check`, no `cargo clippy`, no `cargo test`, no `rustc` alone. The survey
that follows them is the first compile of `binder/` in the real crate and of what the commits add. PORT_STATUS.md,
"Binder", lists what was checked instead: the look-ahead of the round-5 survey with stand-ins of the same signatures
and with the contract's store, a `diff` against the contract's text, `rustfmt --check`, `undeclared.py`, the names of
the functions, and the four places of `binder.go` that call what was added, read beside the Rust.

### What waits

- No producer sets `SourceFileData::diagnostics`. `lowering` and `importer::javascript` (layer 5) return their parse
  diagnostics beside the file, as their two `ParseDiagnostic` types. Until they put them into the store of the file,
  `SourceFile::diagnostics()` is empty for every file: the binder then reports its strict mode errors and the one of
  `#constructor` also in a file with parse errors (binder.go 1303 and 1326 ask for none), and a
  `has_parse_diagnostics` of the checker that reads it answers false.
- `FileBuilder::finish` does not do `attachFileToDiagnostics` (parser.go 6445). A producer that makes its diagnostics
  before `finish` sets their file when it has the `File`: `store[d].set_file(root)`, and the same for each related one.
- `SourceFile.JSDiagnostics` and `JSDocDiagnostics` (ast.go 2734, 2742) have no field yet.
- A diagnostic of a file and a diagnostic of a checker are ids of two stores. Upstream puts the bind diagnostics of a
  file in front of the checker's (`compiler/program.go` 1465) and sorts all of them together later; the contract's
  `sort_and_deduplicate_diagnostics` works on one store. Nothing copies a diagnostic, with its chain and its related
  information, from one store into another yet.
- The faults of the store of a binder stay in that store, where `fault_count()` reads their number. They are not among
  `Bound::faults()`.
- When the ids of a binding cannot be given (`File::bind_once` with the id space used up), the bind diagnostics are
  dropped with everything else of the binding.
- `Bound::heap_bytes` does not count the diagnostics.
- `crate::core::{Map, LiveList, Memo}` and `crate::ast::{Diagnostics, DiagnosticsCollection, RepopulateDiagnosticInfo,
  RepopulateDiagnosticKind, deep_clone_node}`: files of later layers name them and no file defines them.
- No test reads what was added. The tests of the contract's diagnostics block (`diagnostics_tests.rs`) need the
  comparisons and the writer, which are not in the tree.

## Checker: signatures, instantiation, types of symbols, widening (K3 steps 18 to 21)

Commits `1cb4b9c183` and `314fac8c09`. The 176 functions of the layers T-SIGDECL, T-SIGSHAPE, T-SIGINST, T-INSTANTIATE,
T-SYMTYPE, T-JSDECL and T-WIDEN, each at its upstream place among the functions of its file: `checker/c15_calls.rs`,
`c28_types_of_symbols.rs`, `c31_binding_patterns_widening.rs`, `c33_members_base_types_signatures.rs`,
`c34_return_types.rs`, `c35_resolve_members.rs`, `c36_properties_apparent_types.rs`, `c37_instantiation.rs`,
`c40_type_nodes_conditional_tuples.rs`, `c45_base_constraints_normalization.rs`, `c47_promised_mapped_template.rs`,
`relater.rs`. PORT_STATUS.md has the rows.

NOT compiled: `lib.rs` declares no module, and the tree has no `checker/mod.rs` and no `Checker` record. The files are
written against the scratch crates of `checker-data-model-contract/` and the `ast` module of the tree. What was
checked instead is in "Verified" below.

### How a caller writes the calls

- A method of upstream's `Checker` is a method of `Checker<'a>` with `&mut self` and the name in snake case.
  `GetTypeOfSymbolAtLocation`, `GetNonNullableType` and `IsNullableType` have no lower case twin, so they carry no
  `_exported` suffix.
- A free function of upstream is a free function that takes the tree context or the checker first:
  `signature_has_rest_parameter(c, sig)`, `has_rest_parameter(a, node)`, `is_rest_parameter(a, param)`,
  `get_name_from_index_info(c, info) -> Vec<u8>`, `is_late_bindable_ast(a, node)`,
  `get_effective_set_accessor_type_annotation_node(a, node)`, `instantiate_list(c, values, m, instantiator)`.
- `(string, bool)` is `(Text<'a>, bool)`: `get_effective_property_name_for_property_name_node`,
  `try_get_name_from_type`. `is_constructor_declared_this_property` returns `(ThisAssignmentDeclarationKind, NodeId)`.
- A `string` result that is a new text is `Vec<u8>` (`get_parameter_name_at_position`, `get_tuple_element_label`,
  `get_tuple_element_label_from_binding_element`; `get_uniq_associated_names_from_tuple_type` gives `Vec<Vec<u8>>`);
  `get_property_name_from_binding_element` gives `Text<'a>`, because the name goes into a symbol.
- A `*TypeReference` parameter is the `TypeId` of the type (`expand_signature_parameters_with_tuple_members`,
  `get_uniq_associated_names_from_tuple_type`).
- `WideningContext.getChildContext` is `WideningContextId::get_child_context(self, c, property_name)`.
- The field `couldContainTypeVariables` (the method value of checker.go:1259) is the method
  `could_contain_type_variables`, which calls `could_contain_type_variables_worker`.
- The callback of `transform_type_of_members` is `&mut dyn FnMut(&mut Checker<'a>, TypeId) -> TypeId`. The
  instantiator of `instantiate_list` is `impl FnMut(&mut Checker<'a>, T, TypeMapperId) -> T`: `Checker::instantiate_type`
  is passed where upstream passes `(*Checker).instantiateType`.
- A list that the callee keeps is `List<'a, T>` (the type arguments of `get_signature_instantiation`, the argument of
  `instantiate_types`). A list that it only reads is `List<'_, T>` (`get_rest_type`), so `List::from_slice(&local)` fits.

### Differences from upstream

- Stack tests at the entries of `checker-type-layers-topdown/data/recursion.txt`. The entry records `StackLimit` and
  returns: the error type (`get_write_type_of_symbol`, `get_type_for_variable_like_declaration`, `get_rest_type`,
  `get_type_from_binding_pattern`, `get_type_from_binding_element`, `get_return_type_of_signature`,
  `instantiate_type_with_alias`), its argument (`get_widened_type_with_context`, `get_regular_type_of_object_literal`),
  the nil node (`get_synthetic_element_access`), the nil list (`get_siblings_of_context`, `get_type_arguments`), the
  nil predicate (`get_type_predicate_of_signature`), false (`could_contain_type_variables_worker`, which then stores no
  flag; `report_widening_errors_in_type`; `is_resolving_return_type_of_signature`), `arg_<index>`
  (`get_tuple_element_label_from_binding_element`).
- The two closures that walk the syntax tree are nested functions with the same test: `visit` of
  `contains_same_named_this_property` answers false, `contains_reference` of `is_type_parameter_possibly_referenced`
  answers true (a walk that is cut proves nothing, so the type parameter counts as possibly referenced).
- Panics and asserts are faults with a fallback: 16681 and 16820 and 18755 (assert, go on); 16724 (the kind as detail,
  the error type, and the pop of 16726 still runs); 17886 (the kind as detail, the error type); 18179 and 18184 (`t`
  stays nil and the loop over the declarations computes the type); 18308 (returns the kind and the nil node); 22025
  (the kind as detail, no type arguments, the pop still runs); 22428, `Declarations[0]` of a type without declaration
  (returns `t`); an empty stack in `pop_active_mapper` and in the pop of `contextual_binding_patterns`; a nil context
  in `get_siblings_of_context` (the nil list). `signature.parameters[len-1]` and `node.Arguments()[2]` (18247) are
  guarded reads that give the nil id without a fault.
- Kept as upstream has them: the two returns of 16694-16699 leave without `popTypeResolution`; 18667 reports at
  `setter`, which can be nil (the diagnostic then has no file); `getTypeOfFuncClassEnumModule`,
  `getSignatureFromDeclaration` and `getObjectTypeInstantiation` store without a second nil test.
- The tracer block of 22229 is not ported.
- `activeTypeMappersCaches` re-slices within its capacity to reuse emptied maps. Here it is a `Vec` with the length
  in `active_type_mappers_caches_len`; `active_mapper_cache` and `active_mapper_cache_mut` read a slot, and a slot
  outside the length is `nil_cache`.
- `SignatureKeyErased`, `SignatureKeyCanonical` and `SignatureKeyBase` are read as functions `signature_key_erased()`,
  `signature_key_canonical()`, `signature_key_base()` of `crate::checker` (they are in the top-down scratch crate, not
  in the tree).
- `get_properties_of_context`: `slices.Collect` gives nil for no value, so an empty result stays the nil list and is
  computed again by the next call; `siblings` is never nil once computed. The local map is `collections::OrderedMap`.
- `counters` of `get_uniq_associated_names_from_tuple_type` is a `BTreeMap`: nothing iterates it.
- `expand_signature_parameters_with_tuple_members` and `get_uniq_associated_names_from_tuple_type` (checker.go:27855,
  27881) have no caller upstream. They are `pub`, so `dead_code` does not fire.
- `checker/nodebuilderimpl.rs`: the closures `getUniqAssociatedNamesFromTupleType` and
  `expandSignatureParametersWithTupleMembers` of `getExpandedParameters` (nodebuilderimpl.go:1917, 1956) were private
  methods of `Checker` with the names of the two methods above and another body (two inherent methods of one name do
  not compile). They are now functions local to `get_expanded_parameters`, bodies unchanged.

### Verified

Nothing was built and no test ran. `rustfmt --check --edition 2024` accepts each of the files above and
`nodebuilderimpl.rs` (they parse and are formatted). Each function was read against upstream for statement order,
conditions, the second nil tests (ordering.tsv O38), the limit of 22225 (`== 100`, `>= 5_000_000`) and the fallbacks of
fallbacks.tsv. The 37 diagnostic messages exist by name in `diagnostics_generated.go`. A script over the `use` lines
found no unused import and no name used without an import. The calls that other files of the tree already make into
these functions (`c05`, `c09`, `c10`, `c11`, `jsx.rs`, `nodebuilderimpl.rs`, `relater.rs`) match the signatures.

### What these files expect and the tree does not have

- The data model: `checker/mod.rs`, the `Checker` record, `types` (the casts `as_*`, `type_types`, `type_target`,
  `type_mapper`, `type_target_tuple_type`, `type_distributed`, `alias_symbol`, `alias_type_arguments`), `mapper`, the
  records and keys of checker.go 36-552, the type keys (`KeyBuilder`, `get_type_list_key`,
  `get_type_instantiation_key`), the resolution stack, `new_object_type` to `new_index_info`, and the helpers `list_of`,
  `text`, `map_list`, `same_map`, `filter`, `fail`, `fail_detail`, `assert`, `map_set`, `stack_limit`.
- Of utilities.go: `is_type_any`, `is_optional_declaration`, `has_dot_dot_dot_token`, `is_type_usable_as_property_name`,
  `get_property_name_from_type`, `is_object_literal_type`, `is_empty_array_literal`, `is_private_within_ambient`,
  `declaration_belongs_to_private_ambient_member` (the free function), `get_declaration_modifier_flags_from_symbol`,
  `is_declaration_readonly`, `is_right_side_of_access_expression`, `is_shorthand_ambient_module_symbol`,
  `get_set_accessor_value_parameter`, `is_node_descendant_of`.
- Callees of other landing steps, called by their upstream names: base types, members, lookup and apparent types
  (14 to 17: `resolve_structured_type_members`, `get_properties_of_object_type`, `get_property_of_type`,
  `get_index_infos_of_type`, `get_reduced_type`, `instantiate_symbol`, `get_base_type_variable_of_class`,
  `get_type_of_symbol` and its four neighbours of 16587-16656); expressions and contextual types (25: `check_expression`
  and its variants, `get_type_of_expression`, `get_contextual_type`, `get_return_type_from_body`, `has_type_facts`,
  `get_type_with_facts`); flow (26: `get_flow_type_in_constructor`, `get_flow_type_in_static_blocks`,
  `get_type_of_initializer`, `is_matching_reference`, `get_destructuring_property_name`); keyof to template (27:
  `get_index_type`, `get_indexed_access_type_ex`, `get_literal_type_from_property_name`,
  `get_conditional_type_instantiation`, `instantiate_mapped_type`, `get_substitution_type`, `get_string_mapping_type`);
  inference (`apply_to_parameter_types`, `apply_to_return_types`, `get_inferred_types`,
  `infer_type_for_homomorphic_mapped_type`); `resolve_name`, `error_or_suggestion`, `report_circularity_error`.

## Lowering: Bun's parse into the node table (`lowering`)

Commit `9684ef6a7d`. `src/typecheck/lowering/`: `mod.rs` (entry, tokens, source file, top-level await),
`statements.rs`, `expressions.rs`, `declarations.rs` (functions, classes, parameters, binding patterns), `modules.rs`
(imports, exports), `type_arguments.rs`, `tests.rs`, `testdata/` (25 inputs, each with the tree of typescript-go).
It reads `bun_ast` and writes nothing to it: no `Ref`, `Symbol` or `Scope` is touched, and nothing in
`src/js_parser`, `src/ast` or `src/runtime` changed. NOT wired: `lib.rs` has no `pub mod lowering;`.

### Entry

```rust
pub fn lower_source_file(
    builder: &mut FileBuilder,      // made with FileBuilder::new(text), the same slice
    text: &[u8],                    // the source, without a byte order mark
    statements: &[bun_ast::Stmt],   // ParsedOnly::stmts of bun_js_parser::Parser::parse_only
    options: LowerOptions,          // script_kind, is_declaration_file, force_module
) -> Result<Lowered, LowerError>;

pub struct Lowered {
    pub root: NodeId,                       // the SourceFile node, for FileBuilder::finish
    pub external_module_indicator: NodeId,  // SetExternalModuleIndicator; the root when the module is forced
    pub identifier_count: u32,
    pub diagnostics: Vec<ParseDiagnostic>,  // message, loc, args: what upstream's parser reports
    pub comment_directives: Vec<CommentDirective>,
}
pub struct LowerError { pub kind: LowerErrorKind, pub pos: i32, pub what: &'static str }
pub enum LowerErrorKind { OutOfStep, Unsupported, StackLimit }
```

The caller parses with `Parser::parse_only`, lowers inside its closure (the statements live in the arena of the
parse), copies `identifier_count`, `external_module_indicator` and `comment_directives` into `SourceFileData` and
calls `FileBuilder::finish(lowered.root, data, ids)`. `lowering/tests.rs` (`lower`) is that sequence. An error
means no table: the caller reports an internal diagnostic and drops the builder.

### How it works

The lowering walks Bun's statements and, in step with them, the source text with the ported scanner
(`crate::scanner`). Each function reads the tokens that the parse function of the same name in
`internal/parser/parser.go` reads, and asks Bun's tree where upstream decides by lookahead. So:
- `pos` is the full start and `end` the end as upstream has them (the scanner gives both), in UTF-8 bytes. Bun's
  `loc` is only read to tell which statement or arrow function starts at a token.
- What Bun's tree does not keep comes from the tokens: parentheses, empty statements, `"use strict"` directives,
  `;` class elements, token nodes (`=>`, `?`, `:`, `*`, `...`, `?.`, operators), modifiers, `MultiLine`, token flags,
  template raw texts, import and export clauses (read from the tokens alone).
- Flags are upstream's: the context flags at `finishNode`, `OptionalChain`, `HasJSDoc` and
  `PossiblyContainsDeprecatedTag` from the scanner, `PossiblyContainsDynamicImport` and `PossiblyContainsImportMeta`
  on the source file, `ThisNodeHasError` after a diagnostic.
- Parse diagnostics: every diagnostic of the scanner, and the four that upstream's parser reports for input that
  Bun accepts (`Keywords cannot contain escape characters`, `Identifier expected` after `name.` before a line of two
  names, `An optional chain cannot contain private identifiers`, the `assert` of import attributes).
- `reparseTopLevelAwait` is ported: a statement of a module that reads `await` outside an await context is made
  again in one.

### Either upstream's tree or no table

`Unsupported`: Bun's tree holds what has no node yet. `OutOfStep`: a token is not where the tree says, or
typescript-go reads the tokens another way than Bun. `StackLimit`: `bun_core::StackCheck`. Refused today:
- JSX (`EJsxElement`), TypeScript declarations that a JavaScript parse can still hold (`SEnum`, `SNamespace`,
  `STypeScript`, `SExportEquals`), `import x = require()`.
- In a TypeScript script kind, a `<` or `<<` operator where upstream's `tryParseTypeArgumentsInExpression` reads
  type arguments (`a < b > (c)`), or where only its type grammar can tell. `type_arguments.rs` ports that function
  for type arguments made of names, literals, `typeof`, `this`, indexes, `|` and `&`, and answers exactly for them.
  Otherwise it refuses when a `>` follows before a `;` outside brackets, an unbalanced closing bracket or the end of
  the file. That refuses some files that upstream reads as operators (`1 << g, g > e`).
- What `parse_only` accepts and typescript-go reports as a parse error with another tree: an assignment, a member
  access, a call or a postfix operator after an expression that is no left-hand side expression (`a + b = c`,
  `a++ ++`, `a--.b`), a prefix `++` before a unary expression, an optional chain in the callee of `new`, `yield*`
  without an operand.

### Gaps (the tree or the file data is not upstream's, and nothing is refused)

- Type syntax waits for the lint parse: `Parser::parse_only` is `P<'a, false, false>`, a JavaScript parse, so a
  file with a type annotation does not parse at all. The type nodes are `bun_ast::ts` on the parser's branch.
- JSDoc: the flags are set, no JSDoc node is made (no port of `parser/jsdoc.go`). In a JavaScript file upstream
  reparses JSDoc tags into the tree; `importer::javascript` does that for a builder whose nodes have their JSDoc
  attached, which the lowering does not do. JS-only diagnostics (`checkJSSyntax`) are in that step as well.
- File data that `Lowered` does not hold: `imports`, `module_augmentations`, `ambient_module_names`,
  `uses_uri_style_node_core_modules` (parser/references.go), pragmas, reference directives and their diagnostics,
  `check_js_directive`, `common_js_module_indicator`. `identifier_count` is the number of identifiers of the tree:
  upstream also counts the ones of its rewound lookaheads (a capacity hint and a statistic).
- In a TypeScript script kind, `a ? b ? (c) : d => e : f`: upstream reads `(c): d => e` as an arrow function with a
  return type. The lowering has Bun's tree.
- `a.` before a line `b in c`: upstream reads a missing name and a second statement. The lowering keeps Bun's
  property access and reports upstream's `Identifier expected`.
- `for (using of of [])`: upstream reads `of[]` with an error.
- A byte order mark: upstream's file reader removes it before the parse. Give the text without it.

### Verified

Not built by cargo (no `pub mod lowering;`, and `crate::diagnostics`, `crate::internal`, `crate::ast::Arg` are not
in the tree). Compiled with `rustc` alone from a scratch root outside the repository: `ast`, `collections`, `core`,
`jsnum`, `scanner`, `stringutil`, `tspath`, `lowering` with stand-ins for the three missing names, against the
`bun_ast`, `bun_core`, `bun_alloc`, `bun_js_parser` of this worktree (the rlibs of the parse-only probe,
`oracle-toolchain-and-goldens/bottom-up/bunprobe.sh`). Clean with `-D warnings -D dead_code -D unreachable_pub`,
with `clippy-driver` and the lint table of the workspace (library and tests), and `rustfmt --check`.

The five tests of `lowering/tests.rs` ran from that scratch root and pass:
- 25 inputs: the lowered table, printed like `tsgoprobe tree -nojsdoc`, and its external module indicator equal the
  golden of typescript-go byte for byte, with no fault of the builder and no parse diagnostic.
- 14 statements with type arguments are refused in a TypeScript file and lowered in a JavaScript file.
- 9 inputs that typescript-go reads another way are refused, 2 that it reads the same way are not.
- 5 inputs: the parse diagnostics (message, range, first argument) are the ones `/tmp/rr/parsediag` prints.
- JSX is refused and no id is taken.

Run once and not part of the tree: 25,954 files (`.js`, `.mjs`, `.cjs`, `.ts` of the repository's `node_modules`,
`test/`, `src/js`, `bench` and of TypeScript's `tests/cases`, without the ones that start with a byte order mark)
through the lowering and through `/tmp/rr/dumpast -nojsdoc`. Bun's JavaScript parse accepts 14,945.
As TypeScript files: 14,902 equal, 41 refused (32 for type arguments, 9 that typescript-go reports), 2 different
(`for (using of of [])`, and a reference directive diagnostic). As JavaScript files: 14,475 equal, 9 refused, 461
different: JSDoc in 459 of them, and the same 2. No panic, and the deepest inputs
(`binderBinaryExpressionStress.ts`) lower without deep recursion: a chain of left operands is a loop.

### What the crate needs for this module

- `lib.rs`: `pub mod lowering;`. `Cargo.toml`: `bun_ast` and `bun_core` (`StackCheck`) as dependencies;
  `bun_js_parser` and `bun_alloc` as dev-dependencies for `lowering/tests.rs`, and the native stand-ins of
  `src/parsers/native_test_shims.rs` plus the mimalloc ones of `bunprobe/src/shims.rs` to link a test binary.
- `crate::diagnostics`: `MessageId` and the constants `KEYWORDS_CANNOT_CONTAIN_ESCAPE_CHARACTERS`,
  `IDENTIFIER_EXPECTED`, `AN_OPTIONAL_CHAIN_CANNOT_CONTAIN_PRIVATE_IDENTIFIERS`,
  `IMPORT_ASSERTIONS_HAVE_BEEN_REPLACED_BY_IMPORT_ATTRIBUTES_USE_WITH_INSTEAD_OF_ASSERT`; the tests also name
  `OCTAL_LITERALS_ARE_NOT_ALLOWED_USE_THE_SYNTAX_0` and `DECIMALS_WITH_LEADING_ZEROS_ARE_NOT_ALLOWED`.
  `crate::ast::Arg` with `Str`, `Int`, `Bool`, as the scanner uses it.
- `lowering::ParseDiagnostic` and `importer::javascript::ParseDiagnostic` are two types with the same first three
  fields: one of them can go when a diagnostic type of `ast` exists.
- A golden is made with `/tmp/rr/dumpast -nojsdoc <out dir> <name>=<path>` (or `tsgoprobe tree -nojsdoc`), the
  input is stored as `testdata/<name>.txt` and the tree as `testdata/<name>.tsgo.txt`.

## Importer: the JavaScript step (JSDoc shapes, reparser, JS-only diagnostics)

Commit `3febf04ee5`. `src/typecheck/importer/javascript/` (`mod.rs`, `tree.rs`, `reparser.rs`, `jsdoc.rs`,
`jssyntax.rs`, `tests.rs`, `testdata/`), `src/typecheck/importer/mod.rs` (one line: `pub mod javascript;`), and three
readers in `src/typecheck/ast/builder.rs`.

Upstream's parser rewrites the JSDoc of a `.js` or `.jsx` file into real nodes while it parses (`reparser.go`). A
producer that builds its tree of another parse gets the same nodes with one call, after the tree of the file is in
the builder with its JSDoc comments attached, and before it collects the imports of the file and calls `finish`:

```rust
let js = crate::importer::javascript::convert_javascript_file(&mut builder, source_file);
data.reparsed_clones = js.reparsed_clones;                       // SourceFile.ReparsedClones
merge_reparse_diagnostics(&mut parse_diagnostics, js.reparse_diagnostics); // TS1003 of checkNonIdentifierName
// js.js_diagnostics: SourceFile.JSDiagnostics, in upstream's order, related information included
if !js.external_module_indicator_statement.is_nil() {
    data.external_module_indicator = js.external_module_indicator_statement;
}
```

The step is three passes over the builder, each callable alone:
- `jsdoc::convert_jsdoc_shapes(b, root)`: the shapes of the JSDoc nodes, below. It changes nothing the second time.
- `reparser::reparse_source_file(b, root) -> Reparsed`: the 21 functions of `reparser.go` in upstream's order and
  with upstream's names, as methods of `Reparser` over the builder, and the parts of `parser.go` and `jsdoc.go` that
  call them: the end of `withJSDoc`, the reparse list of `parseListIndex` and `parseSourceFileWorker`, the error
  flag of `finishNodeWithEnd`, `parseErrorAtRange`, the sort of `finishSourceFile`.
- `jssyntax::check_js_syntax_of_source_file(b, root) -> Vec<ParseDiagnostic>`: `jsErrorAtRange`,
  `checkJSDecoratorSyntax`, `checkJSSyntax` (parser.go 6707-6850).

`ParseDiagnostic { message: MessageId, loc, args: Vec<Vec<u8>>, related_information }` is what `ast.NewDiagnostic`
gets before a file is attached. The node ids in the results are ids of the builder: `finish` maps `reparsed_clones`.

### What the tree must be before the step

- Every JSDoc comment is a `JSDoc` node with its tags, attached with `FileBuilder::attach_jsdoc` to the host that
  upstream's `withJSDoc` gives it, with the kinds, members, comment lists and ranges of typescript-go except for
  what `convert_jsdoc_shapes` does. `jsdoc::kind_of_typescript_kind` and `jsdoc::member_of_typescript_property`
  are the names that differ.
- Every node has the flags of the parse (`JavaScriptFile`, `JSDoc` inside comments, the context flags). `HasJSDoc`
  and `PossiblyContainsDeprecatedTag` are set by the step.
- The parameters of a JSDoc signature are a list also when they are empty. TypeScript's `forEachChild` does not
  report an empty `NodeArray`: the dump script has to write that list (probe `dump-ast.ts` of this unit does).

### Where the tree of TypeScript 6.0.2 differs from typescript-go's in a JavaScript file

Names, for the producer (`jsdoc.rs`):
- Kinds: `JSDocTag`, `JSDocAuthorTag`, `JSDocClassTag`, `JSDocEnumTag` are `JSDocUnknownTag`; `JSDocMemberName` is
  `QualifiedName`; `JSDocUnknownType` is `JSDocNullableType`.
- Members: `class` of an augments or implements tag is `ClassName`; `fullName` of a typedef or callback tag is
  `name` and its `name` is dropped; `name` of a see tag is `NameExpression`; `jsDocPropertyTags` is
  `JSDocPropertyTags`; `default` of a type parameter is `DefaultType`; the type expression of an enum tag is dropped.

Shapes, by `convert_jsdoc_shapes`:
- The dotted name of a typedef or callback tag is a chain of `ModuleDeclaration` nodes with the keyword
  `namespace`, without modifiers, the inner ones with `NestedNamespace`.
- A typedef or callback tag without a name has an empty identifier with `ThisNodeHasError` where upstream's parser
  stands: at the first parameter or property tag when one follows, else at the end of the type expression, else at
  the end of the tag name. (The research rule put it at the end of the tag; five inputs of `testdata/shapes.js.txt`
  gave the positions.)
- The signature of a callback tag starts where its parameter list starts; the type literal of a typedef tag starts
  at its first property tag; the list of the type parameters of a template tag has the range `[0,0)`.
- `?` alone (TypeScript: `JSDocUnknownType`) is a `JSDocNullableType` of a `TypeReference` of an empty identifier
  with `ThisNodeHasError`, both at the end of the node.
- A host has `HasJSDoc` exactly when a comment is attached to it and `PossiblyContainsDeprecatedTag` exactly when
  one of its comments holds a deprecated tag (in a TypeScript file upstream sets both from the text of the comment).

Nodes that upstream's parser adds and TypeScript does not have, by `reparse_source_file`: `JSTypeAliasDeclaration`
(typedef and callback tags, wrapped in namespace declarations for a dotted name), `JSImportDeclaration` (import
tags), overload signatures (`FunctionDeclaration`, `MethodDeclaration`, `Constructor` without body), all put into
the statement or member list in front of the element whose comment made them, type aliases and imports moved out
to the next list of statements; the `Type` of declarations, parameters, properties, accessors, export assignments
and assignment declarations (`BinaryExpression.Type`); `FullSignature`; type parameters; a `this` parameter;
question tokens; `as` and `satisfies` expressions around initializers, returned and parenthesized expressions;
modifiers of the five modifier tags; heritage clauses and type arguments of implements and augments tags; JSDoc
comments of the properties and parameters that a tag with a comment made. Every such node has `Reparsed`, the
context flags of its host and the range that upstream gives it. The comment of a typedef or callback tag is
attached to its host and to the declaration made of the tag: `finish` gives a node that two hosts hold one id, and
for a `JSDoc` node that is no `TwoParents` fault.

### Changes in `ast/builder.rs`

`FileBuilder::list_loc(list)` (NodeList.Loc), `FileBuilder::member(node, name) -> Option<MemberValue>` (the read
beside `set_member`), `FileBuilder::jsdoc_attachments()` (the hosts with their JSDoc lists), and in `finish` no
`TwoParents` fault for a `JSDoc` node that a second host holds. The step reads the builder only through these and
the readers that were there.

### Differences from upstream

- The reparser runs after the parse, not during it. Its order of hosts is the order in which the parser finishes
  nodes: the members of a node by position, members at one position in the order of the struct, a node after its
  members. `contextFlags` is the context part of the flags of the host.
- An error of `checkNonIdentifierName` sets `ThisNodeHasError` on the next node of that order (or on the cast that
  `makeNewCast` finishes first). Upstream sets it on the next node that the parser finishes; no unit of the corpus
  tells the two apart.
- `gatherTypeParameters` returns nil when a comment has a typedef or callback tag and the type parameters are
  asked for another declaration. Upstream leaves the copies that it made until then in `ReparsedClones`, held by
  nothing. A node that the tree does not hold has no id in a file, so they are taken out of the list again (the
  corpus has one such unit, `c03060u0_cb.js`: 23 clones for upstream's 24).
- The copies of the modifiers of an overloaded declaration get the signature as parent down to the last node.
  Upstream sets the parent of the modifier nodes only, so the nodes under a copied decorator have a nil parent there.
- Upstream's panics: a typedef tag whose type expression is neither a type expression nor a type literal, and a
  signature of another kind than the four, are an internal diagnostic (`FaultKind::Panic` with the kind) and no
  node. A nil parameter, a nil class name of an implements tag, a cast of an augments class that is no
  `ExpressionWithTypeArguments` (nil dereference or failed assertion upstream) leave the host as it is.
  `reparseJSDocTypeLiteral` and `wrapInJSDocNamespace` call themselves as deep as the comment nests: they stop
  with `FaultKind::StackLimit` when `bun_core::StackCheck` says so.
- `ReparsedClones` is sorted with a port of Go 1.26's `slices.SortFunc` (`tree::slices::sort_func`, pattern-defeating
  quicksort), because the order that it leaves clones of one range in is what `GetReparsedNodeForNode` finds first.
- `IsEntityNameExpressionEx` and `HasSamePropertyAccessName` on the builder are loops, not recursions.

### Gaps: what a tree made of TypeScript's parse cannot have

Measured on the 1,276 JavaScript units of the conformance corpus (goldens: upstream's parser through the Go probe):
- 25 units have a kind without a counterpart in typescript-go: `JSDocFunctionType` (`function(string): number`,
  23 units) and `JSDocNamepathType` (2). Upstream parses these as type references or reports them; converting them
  needs the JSDoc type grammar of upstream.
- The text and the range of a `JSDocText` and the range of a comment list are what TypeScript has, which differs in
  87 units (upstream trims and splits differently). This is the producer's part.
- A statement that upstream parses twice for top-level `await` loses its JSDoc there: the second parse keeps the
  flag `HasJSDoc` and the reparsed nodes, and drops the comments from the cache and the clones from
  `ReparsedClones`. Here the comments stay attached (synthetic `await2.js`; no unit of the corpus).
- Nodes that upstream's parser makes in a speculative parse that it then abandons stay in its reparse list
  (`var a = (/** @typedef {number} T */ x);` gives the alias twice upstream). Here each comment is reparsed once.
- 14 more units differ beyond comment texts because TypeScript 6.0.2 parses the comment itself differently (the
  shape of an enum tag, a template tag inside a callback, prefix and postfix JSDoc types, a duplicate typedef, a
  flag on a comma token in two JSX files, ...). `jsdoc-reparser-js-trees/data/route-a.js-divergent-L2.txt` has
  each unit with its first difference.
- `SourceFile.JSDocDiagnostics` are TypeScript's `jsDocDiagnostics` of the dump, identical in 1,239 of 1,276 units
  (research measurement); the step does not make them.
- The lowering of Bun's parse has no JSDoc nodes at all. It needs a port of `jsdoc.go` and of the type grammar
  that it calls (402 functions, 5,693 lines by the research closure) before this step has anything to do there.

### Verified

Nothing was built with cargo or `bun bd`: `lib.rs` does not declare the modules. The files were compiled in place
with `rustc` alone from a scratch root (`jsdoc-reparser-js-trees/port/scratch`: the node table files of the
worktree by path, stand-ins for `core`, `internal`, `tspath`, `diagnostics`, five scanner functions, `ast.rs` and
`utilities.rs`; `stringutil` of the worktree), with the `deny` set of the workspace, then with `clippy-driver`, the
workspace lint flags and `clippy.toml` (library and tests), and `rustfmt --check`. All clean. To run it again:
`sh /workspace/notes/lint/units/typecheck/jsdoc-reparser-js-trees/port/regen.sh [check|fixtures|corpus|sort|all]`.

- The 6 `#[test]`s pass from the scratch root. Seven inputs (`testdata/*.js.txt`, written for the branches of the
  reparser, every JS-only diagnostic code and the shapes) give the tree that upstream's parser prints byte for
  byte, with the JS diagnostics, the merged parse diagnostics, the number of reparsed clones and the external
  module indicator. Their input trees (`testdata/*.tree`) are TypeScript 6.0.2's parse through the base rules of
  the importer research (`ts-dump-and-test-importer/top-down/probe/convert.mjs`), printed like the goldens.
  `tree::slices::sort_func` gives the order of Go's `slices.SortFunc` on 210 inputs.
- Run from the scratch root and not part of the tree: all 1,276 JavaScript units of the corpus. 1,251 load (25 have
  a kind of the first gap). Trees identical to upstream's byte for byte: 1,146, the number of the research
  prototype; all 1,251 trees are byte for byte the trees of that prototype (`probe/convert.mjs` with
  `probe/reparse.mjs`) except one unit that the position of a missing name improves, so the prototype's masks
  hold: 1,233 identical with comment ranges masked, 1,237 with comment texts left out. JS diagnostics identical:
  1,251 of 1,251. Parse diagnostics after the merge: 1,251 of 1,251. Number of
  reparsed clones: 1,249 of 1,251. External module indicator: 1,251 of 1,251 (one unit has a reparsed overload
  signature as indicator). No internal diagnostic of the builder in any unit.

### What these files expect and the tree does not have

- `lib.rs`: `pub mod importer;` (and `ast`, `core`, `diagnostics`, `internal`, `scanner`, `stringutil`).
- `crate::diagnostics`: `MessageId` (with `Clone`, `Debug`, `PartialEq`, `Eq`) and the 18 constants `IDENTIFIER_EXPECTED`,
  `DECORATORS_ARE_NOT_VALID_HERE`, `DECORATOR_USED_BEFORE_EXPORT_HERE`,
  `DECORATORS_MAY_NOT_APPEAR_AFTER_EXPORT_OR_EXPORT_DEFAULT_IF_THEY_ALSO_APPEAR_BEFORE_EXPORT`,
  `X_IMPORT_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES`, `X_EXPORT_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES`,
  `X_IMPLEMENTS_CLAUSES_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES`, `X_0_DECLARATIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES`,
  `THE_0_MODIFIER_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES`, and `TYPE_PARAMETER_DECLARATIONS_`, `TYPE_ALIASES_`,
  `TYPE_ANNOTATIONS_`, `TYPE_ARGUMENTS_`, `PARAMETER_MODIFIERS_`, `NON_NULL_ASSERTIONS_`,
  `TYPE_ASSERTION_EXPRESSIONS_`, `SIGNATURE_DECLARATIONS_`, `TYPE_SATISFACTION_EXPRESSIONS_` each followed by
  `CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES` (upstream's names in upper case, as the scanner and the binder write them).
- `crate::internal::{Fault, FaultKind}` with `FaultKind::Panic` and `FaultKind::StackLimit`, as `ast/` uses them.
- `crate::scanner::{is_valid_identifier, is_identifier_start, is_identifier_part, skip_trivia, token_to_string}`
  from a `scanner/mod.rs` that re-exports `scanner.rs`.
- The reader of the dump (the rest of `importer/`) and the dump script in `test/cli/lint/typecheck/`: nothing calls
  `convert_javascript_file` yet. The reader also has to run `collectExternalModuleReferences` after the step: the
  module specifiers of `JSImportDeclaration` nodes are imports of the file (24 units).

## Checker: control flow narrowing and reachability (K3 step 26)

Commit `c6d6d99ac0`: `checker/flow.rs`. It holds `checker/flow.go` whole in upstream order (layers F-NARROW and F-REACH,
130 functions) and after it the nine narrowing helpers that upstream keeps in `checker/checker.go` 31594-31692
(`is_some_symbol_assigned` to `is_generic_type_with_undefined_constraint`; `get_target_type` of 31607 is in
`c51_type_facts_awaited.rs`). No function is a stand-in. PORT_STATUS.md has the rows.

NOT compiled by cargo, as under the checker heading above. "Verified" below says what was compiled and run instead.

### How a caller writes the calls

- A flow state is a record of the checker named by `FlowStateId`: `get_flow_state()`, `put_flow_state(f)`, and a
  function that takes `f *FlowState` upstream takes the id as its first argument (`get_type_at_flow_node(f, flow)`,
  `narrow_type(f, t, expr, assume_true)`). A flow node is a `FlowNodeId`, a flow list a `FlowListId`.
- `get_flow_type_of_reference(reference, declared_type)` and
  `get_flow_type_of_reference_ex(reference, declared_type, initial_type, flow_container, flow_node)`: a nil argument is
  `TypeId::NIL`, `NodeId::NIL`, `FlowNodeId::NIL`.
- `FlowType::is_nil`, `get_flow_state` and `put_flow_state` are defined here; the records are in `c01_data.rs`.
- A parameter that is a pointer to node data upstream is the node: the binary expression of
  `narrow_type_by_binary_expression`, `narrow_type_by_instanceof` and
  `narrow_type_by_private_identifier_in_in_expression`, the typeof expression of `narrow_type_by_typeof`, the element
  access of `try_get_element_access_expression_name`. `get_final_array_type(t)` takes the evolving array type.
  `*ast.FlowSwitchClauseData` is the record by value. A `*TypePredicate` is a `TypePredicateId`, a `*ast.Diagnostic` a
  `DiagnosticId` (`get_type_of_dotted_name(node, DiagnosticId::NIL)`).
- `(string, bool)` is `(Cow<'a, [u8]>, bool)`: `get_accessed_property_name`, `try_get_element_access_expression_name`,
  `try_get_name_from_entity_name_expression`, `get_destructuring_property_name`, `get_literal_property_name_text`, and
  the free function `try_get_name_from_type(c, t)` of flow.go:1782 (the method of checker.go:18836 is the one in `c31`,
  with `(Text<'a>, bool)`). A name of the tree or of a type is borrowed; an index or a number is owned. Narrowing calls
  these functions for every access that it compares, and this way they add nothing to the arena. `&name` is the `&[u8]`.
- `get_property_name_for_known_symbol_name(symbol_name: &[u8]) -> Vec<u8>`.
- A callback gets the checker first: `narrow_type_by_discriminant(t, access, &mut dyn FnMut(&mut Checker<'a>, TypeId) -> TypeId)`,
  `narrow_type_by_switch_optional_chain_containment(t, data, &mut dyn FnMut(&mut Checker<'a>, TypeId) -> bool)`.
- Lists: `get_switch_clause_types(node) -> List<'a, TypeId>`; `get_switch_clause_type_of_witnesses(node) -> List<'a, Text<'a>>`,
  the nil list when a case is not a string literal and an empty list that is not nil for a switch without clauses;
  `get_flow_type_in_static_blocks(symbol, List<'_, NodeId>)`. `get_union_or_evolving_array_type(f, &[TypeId], reduction)`,
  `each_type_contained_in(source, &[TypeId])` and `get_not_equal_facts_from_typeof_switch(start, end, &[Text])` take a
  slice that they only read.
- Free functions: `get_flow_node_of_node(a, node)`, `get_branch_label_antecedents(a, flow, reduce_labels)` (the reduce
  labels are the `FlowReduceLabelData` nodes, the innermost last), `get_candidate_variable_declaration_initializer(a, node)`,
  `is_evolving_array_type_list(c, types)`, `is_coercible_under_double_equals(c, source, target)`.
- The map `typeofNEFacts` is `TYPEOF_NE_FACTS`: eight `(name, TypeFacts)` pairs in ascending order of the names, the
  order that checker.go:1058 needs for `typeofType` (`slices.Sorted(maps.Keys(typeofNEFacts))`).
  `typeof_ne_facts(text) -> Option<TypeFacts>` is the lookup. `nonDottedNameCacheKey` is `non_dotted_name_cache_key()`:
  the hash of a `KeyBuilder` that holds the one byte `?`.
- The field `markNodeAssignments` (the method value of checker.go:1261) is the method `mark_node_assignments`, which
  calls `mark_node_assignments_worker`. `extend_assignment_position` returns a text position (`i32`).

### Differences from upstream

- Stack tests, each the first statement of its function, at the 21 entries of
  `checker-expressions-calls-flow/bottom-up/data/recursion.txt` that are in this step, with the results of
  `top-down/data/tested_entries.tsv`. The entry records `StackLimit` and returns the error type
  (`get_flow_type_of_reference_ex`, before it takes a flow state; `get_type_at_flow_node`, before the test of the
  depth, so no TS2563 is reported; `narrow_type`, `narrow_type_by_assertion`, `get_narrowed_type_worker`,
  `get_type_of_dotted_name`, `get_explicit_type_of_symbol`, `get_initial_type_of_binding_element`,
  `get_assigned_type`), false (`is_matching_reference`, `write_flow_cache_key`, `is_constant_reference`,
  `is_false_expression`, `mark_node_assignments_worker`, `is_some_symbol_assigned_worker`,
  `is_generic_type_with_union_constraint`, `is_generic_type_without_nullable_constraint`), the nil node
  (`get_reference_candidate`, `get_reference_root`), and true in the two walks where false would become a diagnostic
  for the user (`is_reachable_flow_node_worker`: TS7027 and the unreachable never type;
  `is_post_super_flow_node_worker`: TS17009 or TS17011).
- The limits are upstream's: 2000 levels of `get_type_at_flow_node` per flow state (`depth == 2000`), five inlined
  aliases (`inline_level < 5`), `pos == 0 || pos != i32::MAX` in `mark_node_assignments_worker`.
- Panics and nil dereferences are faults with a fallback (`bottom-up/data/fallbacks.tsv` of the same unit): 2241 (the
  kind as detail, the error type); 189, a start node whose container has no flow node (the initial type, as at the top
  of the flow); 2641, a loop label without antecedents (true, the answer for unreachable nodes); 1593, no function or
  module block above the reference (the error is reported at the reference node); 2228, a declared type that is no
  interface type (the failed cast is recorded and the result is the nil type).
- `is_post_super_flow_node_worker` stores the answer for a shared node and goes on, so the arms below compute it a
  second time: upstream's code at 2619-2620, kept.
- `defer` of 2160 is a labeled block: every `return` after it is a `break` out of the block, and the delete follows.
- `FlowLoopInfo.types` is the slice as it was at the push. Here the entry takes the vector of the types seen so far for
  the time of the recursive call and hands it back at the pop; the walk below it only reads the entry.
- `c.antecedentTypes[antecedentStart:]` is copied before `get_union_or_evolving_array_type` gets it (the callee borrows
  the checker), and the types of an in-process loop entry are cloned for the same call. The lists that upstream builds
  with `core.Map` only to make a union of them are local vectors passed as `List::from_slice`.
- `get_type_at_flow_branch_label` keeps the parameter `flow`, and `narrow_type_by_in_keyword` and
  `narrow_type_by_optional_chain_containment` keep `f`: upstream does not read them either.
- The tracer call of 121-123 is not ported.
- The nine helpers of `checker.go` stand in `flow.rs` and not in `c51_type_facts_awaited.rs`, where the layer table has
  them: that file belonged to another step while this one landed.

### Verified

No cargo build and no `bun bd` ran. What ran is the scratch crate `checker-flow-scratch/` beside this file
(`sh run.sh`: rustc and clippy-driver alone, output in `/tmp/checker-flow-scratch`, about one minute):

- `rustfmt --check --edition 2024` accepts `flow.rs`.
- The crate mounts by `#[path]` `flow.rs` and the `ast`, `core`, `collections`, `stringutil` and `tspath` modules of
  the tree as they are, so every node accessor, flow node, factory call and core helper in `flow.rs` is type-checked
  against the real one. The data model is a copy of the fields and records of `checker-data-model-contract` that
  `flow.rs` names. `c01_data.rs`, `c02_program_checker.rs` and `types.rs` came into the tree after the commit: the 55
  fields of the checker, the records, the casts and 77 of the 80 flag constants that `flow.rs` uses were compared with
  them by name and type and are the same (the other three are `AssignmentKind` of utilities.go, not in the tree). The
  callees are signatures with empty bodies: 74 are taken by a script from the files of the tree that define them, 46
  are written by hand for callees that no file defines yet (`run.sh` prints the list), each with `&mut self`, the worst
  case for the borrows of the caller.
- rustc with the deny set of the workspace on `flow.rs` (`warnings`, `dead_code`, `unreachable_pub`, `unused_*`,
  `unreachable_*`): clean for each of three possible result types of `get_property_name_from_type` (`Vec<u8>`,
  `Cow<'a, [u8]>`, `Text<'a>`). clippy-driver with the lint table of the workspace and `clippy.toml`: clean for the
  first two; with `Text<'a>` it reports `needless_borrow` at four `&name`.
- Six tests over flow graphs made in the open store of the real `ast` module, with a small model of unions and type
  facts in place of the empty bodies: both reachability walks (branch labels, loop labels, shared nodes and their
  caches, reduce labels, the one-entry cache, the loop label without antecedents); flow types at conditions, at branch
  labels (union with subtype reduction, the exit on the declared type, one antecedent), at unreachable nodes and under
  reduce labels; a loop label (the in-process entry, the incomplete type, the cache, one key per pair of declared and
  initial type, no key for a reference that is not a dotted name); the depth limit (1999 levels give the type, 2000
  give the error type, TS2563 and `flow_analysis_disabled`, which is what upstream does for `edge1999.ts` and
  `edge2000.ts` of `checker-expressions-calls-flow/bottom-up/groundtruth`). No test ran narrowing by typeof, equality,
  instanceof, `in`, discriminants, type predicates or switch clauses, and nothing compared a result with upstream's.
- Scripts: the 139 upstream functions are present in upstream order; every upstream comment is present, folded to one
  line; no two comment lines are adjacent; no `unwrap`, `expect`, `panic`, index into a slice or search pattern of
  `byte-search.test.ts`; the calls that other files of the tree make into these functions (`c05`, `c08`, `c09`, `c12`,
  `c28`, `c31`) match the signatures.

### What this file expects and the tree does not have

- Of the data model: the type keys (`CacheHashKey` with `is_zero`, `KeyBuilder` with `write_byte`, `write_string`,
  `write_symbol(c, s)`, `write_type`, `write_node`, `hash`) and `new_object_type`.
- Of utilities.go: `AssignmentKind` (`NONE`, `DEFINITE`, `COMPOUND`), `get_assignment_target_kind(a, node)`,
  `is_in_compound_like_assignment`, `is_empty_array_literal` (the one of package checker), `is_call_chain`,
  `is_non_null_access`, `get_binding_element_property_name(a, node) -> NodeId`, `has_only_expression_initializer`,
  `has_dot_dot_dot_token`, `is_type_any(c, t)`, `is_type_usable_as_property_name(c, t)`,
  `get_property_name_from_type(c, t)`, and the methods `is_constant_variable` and
  `is_parameter_or_mutable_local_variable`.
- Callees of other landing steps, called by their upstream names: the diagnostics sink and globals (5: `error`,
  `add_diagnostic`, `is_block_scoped_name_declared_before_use`, `get_global_record_symbol()`,
  `get_global_es_symbol_constructor_symbol_or_nil()`, the closure field `contains_missing_type` as a method, and
  `diagnostic_store.new_diagnostic` with `add_related_info`);
  expressions, type facts and contextual types (25: `check_expression`, `check_expression_cached`,
  `check_non_null_expression`, `check_non_null_type`, `check_super_expression`, `get_type_of_expression`,
  `get_context_free_type_of_expression`, `get_optional_expression_type`,
  `get_resolved_signature(node, None, CheckMode::NORMAL)`, `get_symbol_for_private_identifier_expression`,
  `get_flow_type_of_property`, `get_contextual_type`, `get_type_facts`, `has_type_facts`, `get_type_with_facts`,
  `get_adjusted_type_with_facts`, `recombine_unknown_type`, `convert_auto_to_any`); keyof to
  template (27: `get_literal_type_from_property_name`, `get_type_of_property_or_index_signature_of_type`,
  `is_no_infer_type`).

## Checker: symbol merging, name resolution, aliases and modules (K3 steps 6 to 8)

Commits `404d95dbe9` and `db733c7c30`. The 108 functions of `checker.go` in the layers S-MERGE, N-RESOLVE, A-ALIAS,
M-MODULE and Q-ENTITY, each at its upstream place: `checker/c04_name_resolution_hooks.rs` (`getSymbol`),
`c21_resolved_symbols_diagnostics.rs` (the four of 13991-14050), `c22_symbols_merge.rs`, `c23_alias_targets.rs`,
`c24_external_modules.rs`, `c25_entity_names.rs`, `c26_exports_late_binding.rs`, `c27_resolve_alias.rs`. The 13
functions of `binder/nameresolver.go` are in `binder/nameresolver.rs` since `b52442e510`. New beside them: the package
`module` (`module/mod.rs`, `types.rs`, `util.rs`) and `core/nodemodules.rs` (declared in `core/mod.rs`). PORT_STATUS.md
has the rows.

NOT compiled by cargo: `lib.rs` declares no module, and `checker/mod.rs` names modules that the tree does not have
yet. What was checked instead is in "Verified" below.

### How a caller writes the calls

- A method of upstream's `Checker` is a method of `Checker<'a>` with the name in snake case and `&mut self`. These
  only read and take `&self`: `get_merged_symbol`, `get_export_symbol_of_value_symbol_if_exported`,
  `get_declaration_of_alias_symbol`, `get_cannot_find_name_diagnostic_for_name`,
  `get_cannot_resolve_module_name_error_for_specific_module`, `get_emit_syntax_for_module_specifier_expression`,
  `get_module_specifier_for_import_or_export`, `get_suggested_import_source`, `get_suggested_import_extension`.
- `ResolveAlias` is `resolve_alias_exported(symbol) -> (SymbolId, bool)`: `resolveAlias` has the same snake case name.
  `GetAmbientModules` is `get_ambient_modules() -> List<'a, SymbolId>`.
- Free functions: `get_adjusted_node_for_error(a, node)`, `get_first_declaration(a, symbol)`,
  `get_excluded_symbol_flags(flags)`, `get_module_specifier_from_node(a, node)`,
  `resolution_extension_is_ts_or_json(ext)`, `is_esm_format_import_importing_commonjs_format_file(usage, target)`,
  `is_not_replacable_by_method(a, decl)`.
- `createDiagnosticForNode` is the method `create_diagnostic_for_node(node, message, args) -> DiagnosticId`: a
  diagnostic lives in the store of the checker. `lookup_or_issue_error` has the same parameters.
- A symbol table is a `SymbolTableId` and the nil table is the nil map. `get_exports_of_module_worker` returns
  `(SymbolTableId, Map<Text<'a>, NodeId>)`; `extend_export_symbols(target, source, lookup_table, export_node)` takes
  `Option<&mut ExportCollisionTable<'a>>`, `None` for upstream's nil table.
- A name is `&[u8]` where it is looked up (`get_symbol(symbols, name, meaning)`, `get_export_of_module`,
  `resolve_export_by_name`, `try_find_ambient_module`, `resolve_external_module`) and `Text<'a>` where a symbol keeps
  it (`new_symbol`, `new_symbol_ex`, `new_parameter`, `new_property`): a node text, a constant, or `self.text(bytes)`.
  A new string is `Vec<u8>` (`get_fully_qualified_name`, `get_suggested_import_source`);
  `get_suggested_import_extension` returns `&'static [u8]`, empty for none.
- The nil message is `MessageId::NIL` (`resolve_external_module`, `resolve_external_module_name_worker`).
- `get_external_module_file_from_declaration` returns the `NodeId` of the SourceFile node.
- The hooks of the name resolver are these methods as function pointers: `lookup: Some(Checker::get_symbol)`,
  `get_symbol_of_declaration: Some(Checker::get_symbol_of_declaration)`, `error: Some(Checker::error)`.
- `module`: `ResolvedModule<'p>` and `PackageId<'p>` are `Copy` records of borrowed texts. A program answers
  `Option<ResolvedModule>`: `None` is upstream's nil module, `is_resolved()` tests the file name.
  `get_resolution_diagnostic(a, options, &module, file) -> MessageId`; `mangle_scoped_package_name`,
  `unmangle_scoped_package_name` and `get_types_package_name` return `Vec<u8>`.
- `core`: `node_core_modules() -> &'static BTreeSet<Vec<u8>>` (`.contains(name)`), the two lists
  `UNPREFIXED_NODE_CORE_MODULES` and `EXCLUSIVELY_PREFIXED_NODE_CORE_MODULES` (`&[&[u8]]`, in upstream's order), and
  `non_relative_module_name_for_typing_cache(name) -> &[u8]`.

### Differences from upstream

- Stack tests (`bun_core::StackCheck`) at the recursion hubs. The entry records `StackLimit` and returns: its target
  (`merge_symbol`), the nil symbol (`resolve_entity_name`), the empty name (`get_fully_qualified_name`), the unknown
  symbol (`resolve_alias`), the nil table (`visit` of `get_exports_of_module_worker`).
- Two loops over checker state have a budget (`LoopGuard`, `loop_limit`): the alias loop at the end of
  `resolve_entity_name` (15915: an alias that resolves to an alias without the meaning, for ever) and the loop of
  `resolve_alias_with_deprecation_check` (16413: a target without declarations that is not the resolved target).
- Panics and asserts are faults with a fallback. `resolve_alias` of a symbol that is no alias: the unknown symbol. Its
  nil declaration (16371): the alias resolves to the unknown symbol and the resolution stack stays balanced; the text
  of the symbol is not part of the fault. `get_target_of_alias_declaration` (15860): the kind as detail, the nil
  symbol. `resolve_entity_name` (15907), `get_module_specifier_for_import_or_export` (15143),
  `get_module_specifier_from_node` (15153): nil. `is_common_js_require` (15773): false. The two panics about the TS
  extension in `resolve_external_module` (15324, 15347): the error that needs the extension is not reported and the
  function goes on. `tspath`'s panic for a relative path between an absolute and a relative path (15362, 15391,
  15402): the empty path. `s.exportsWithDuplicate` through a nil entry (16343): a fault. The asserts of 14584, 14871,
  16100 and 16191 record and go on.
- `check_and_report_error_for_resolving_import_alias_to_type_only_symbol` (14591): the walk to the left of the
  qualified name ends at a nil name. Upstream's cast panics on a module reference that is no entity name; here the
  accessor records the bad cast and reads nil, and the loop would not end.
- A range over a Go map runs in the order of the table here: `merge_symbol_table`, `get_ambient_modules` (the order
  of the result), the three loops of `get_exports_of_module_worker`, `extend_export_symbols`,
  `get_suggested_symbol_for_nonexistent_module`, and `findInMap` in `report_non_exported_member` (upstream names a
  random one of several exports of one local). `ExportCollisionTable` is a `BTreeMap`: its loop runs by name.
- `nil` and empty are kept apart for `Symbol.Declarations`, which upstream tests against nil (checker.go 22308 and
  others): `merge_symbol` leaves the list of the target when the source has none, `clone_symbol`,
  `clone_type_as_module_type` and the synthetic default share the list, `combine_value_and_type_symbols` gives the nil
  list for `slices.Compact(slices.Concat())` of two empty lists, `get_ambient_modules` stays nil without a module.
- The closure `visit` of `getExportsOfModuleWorker` is a nested function over a record of what it captures. The
  `sync.Once` of `GetAmbientModules` is a `Memo`. `core.NodeCoreModules` (`sync.OnceValue`) is a `OnceLock`.
- `createModuleNotFoundChain` and `createModeMismatchDetails` read `DiagnosticDetails { message, args }` of
  utilities.go with `args` as byte strings: every argument upstream puts there is a string.
- `ResolvedModule` has no `ResolutionDiagnostics`: the resolver is not ported and nothing in binder or checker reads
  the field. The nil module is `None`; `resolve_external_module` reads the fields of the zero module where upstream
  reads them only after `IsResolved()`.
- `get_exports_of_module_worker` reads `moduleSymbol.Exports` for the size hint before upstream's own nil test of
  `moduleSymbol`: the nil symbol reads as no exports.
- `core/nodemodules.go`: the two maps, whose values are all true, are lists of their keys. PORT_STATUS.md had the file
  as "binder and checker do not call it": `checker.go` 15206 calls `core.NodeCoreModules()`, a variable of function
  type, which the call graph of the planning did not see.
- `binder/nameresolver.rs` is unchanged.

### Verified

Cargo built nothing and no test of the repository ran. `k3-symbols-names-aliases-modules-scratch/run.sh` does the
following with `rustc`, `clippy-driver` and `rustfmt` alone; its last run was on the tree at `db733c7c30`.

- It compiles, in place and in one crate: the real `core`, `collections`, `stringutil`, `tspath`, `jsnum`, `ast`,
  `evaluator` and `binder/nameresolver.rs`; the data model of the checker as it is in the tree since `761df39dfb`
  (`c01_data.rs`, `c02_program_checker.rs` with `Checker`, `Program`, `Fallback` and the helpers, `types.rs`,
  `mapper.rs`, `links.rs`); the eight checker files and `module/`. Stand-ins (`scratch/stubs/`) are what the tree does
  not have: `List`, `Map` and the other Go values of `crate::core`, `crate::internal`, `crate::diagnostics` (ids
  without texts), `ast/diagnostic.rs`, and the functions of other steps (`other_steps.rs`). Types and borrows are
  checked with the deny set of the workspace (`warnings`, `unused_*`, `unreachable_*`), then the clippy table of the
  workspace: no finding in these files (`db733c7c30` removed the one that the data model brought, a borrow of
  `output_dts`). The stand-ins are the assumptions about the missing parts.
- 31 tests run the ported functions on the `Checker` record of the tree: 16 on symbols and tables of an open store,
  11 on files that are built with `FileBuilder` and bound by hand (what upstream's binder leaves for them) and read
  through a frozen context, 3 of `module/`, 1 of `core/nodemodules.rs`. They cover: merging into a transient and into
  a bound target, the unidirectional merge, the const enum module flag, two interfaces and two `let` of two files in
  the globals (the clone, `getSymbolOfDeclaration`, the two errors with their related information); `getSymbol` and
  the name resolver with its hooks; an import specifier, a default import (both messages), a namespace import,
  `export { x as z } from`, `export { loc as renamed }`, `export * as`, `export as namespace`, `export =` and a named
  import of it, `import type` and an import alias of it, `import w = N.v`, two circular import aliases (both errors,
  in upstream's order); `export *` with a collision, `export type *` and its map, a module that exports itself; a
  module that resolves to an untyped file (suggestion, error, and the chain with its repopulate info), `@types/` in a
  specifier, a JSON module, a name of node, a module that is not there; computed members bound late (two properties,
  and a method against a property); the module type with a synthetic default. The expected values were derived from
  upstream's code by hand, not from a run of tsgo (`/tmp/rr` is gone).
- 102 of the 108 functions are entered; not entered: `getTargetOfBinaryExpression`, `getTargetOfAccessExpression`,
  `isCommonJSRequire` (JavaScript files), `createModeMismatchDetails` (node16 and node18), `lateBindIndexSignature`,
  `isNotReplacableByMethod`. `K3SYM_COVERAGE=1 run.sh` prints the lines.
- `rustfmt --check`, the comment rule of comment-cop.yml (no two comment lines in a row), and `py/callseq.py`: each
  of the 108 functions calls the same methods of the checker as upstream's body, the same number of times.
- `core/nodemodules.rs` was also compiled with the other leaf packages by `rustc` alone and `clippy-driver` (the
  scratch root of "Leaf packages" above), and its test ran there.
- Read against the tree, not compiled together: the callees of later steps that the tree has by now take what these
  files pass (`get_property_of_type`, `get_property_of_type_ex`, `get_signatures_of_structured_type`,
  `resolve_structured_type_members`, `has_late_bindable_name`, `has_late_bindable_index_signature` of `c33`;
  `get_string_literal_type` of `c42`; `get_type_from_type_node` of `c38`; `get_type_of_symbol` of `c28`;
  `is_error_type` of `c43`; `symbol_to_string`, `symbol_to_string_ex` of `printer.rs`; `is_contained_by_namespace` of
  `c10`), and no other file of `checker/` defines one of the 108 names.

Not verified: anything against upstream's baselines or a run of tsgo; the six functions above; the paths that need
types (`export =` of a value with properties, `getPropertyOfVariable`, spread of the synthetic default), project
references, and the node16 to nodenext branches.

### What these files expect and the tree does not have

The shapes that the scratch assumes are in `scratch/stubs/other_steps.rs`, `ast_diag.rs` and `golang.rs`.

- `crate::core::{List, Text, Map}` (and `Memo`, `LiveList` for the data model), `crate::internal::LoopGuard` (and
  `FaultKind`, `StandIns`), `crate::diagnostics` (`MessageId` and the 63 messages these files name; all exist in the
  generated table of the contract).
- `ast/diagnostic.rs`: `Arg`, `DiagnosticId`, `Diagnostics { store, files }` with `compare_diagnostics`, the store
  with `add_related_info` and `Index`, `Diagnostic::related_information` and `set_repopulate_info`,
  `RepopulateDiagnosticInfo { kind, module_reference: Vec<u8>, mode, package_name: Vec<u8> }`,
  `RepopulateDiagnosticKind::{MODE_MISMATCH, MODULE_NOT_FOUND}`.
- Of utilities.go (step 2): `find_in_map(a, table, predicate)`, `get_external_module_require_argument(a, node)`,
  `is_shorthand_ambient_module_symbol(a, symbol)`, `is_syntactic_default(a, node)`,
  `has_export_assignment_symbol(a, symbol)`, `is_side_effect_import(a, node)`, `entity_name_to_string(a, name)`,
  `get_alias_declaration_from_name(a, name)`, `get_containing_qualified_name_node(a, node)`,
  `get_members_of_declaration(a, node)` (a list), `is_type_usable_as_property_name(c, t)`,
  `get_property_name_from_type(c, t) -> Vec<u8>`, `create_module_not_found_chain(program, file, reference, mode,
  package_name)` and `create_mode_mismatch_details(a, program, file)` (both `DiagnosticDetails { message, args }`
  with `args` a list of byte strings), and the methods `new_diagnostic_for_node` and
  `new_diagnostic_chain_for_node(chain, node, message, args)`.
- Of steps 4 and 5: `push_type_resolution(TypeSystemEntity::Symbol(s), TypeSystemPropertyName::AliasTarget)`,
  `pop_type_resolution`, `find_resolution_cycle_start_index`; `error`, `add_diagnostic`, `add_error_or_suggestion`,
  `is_deprecated_symbol`, `add_deprecated_suggestion(node, declarations, name)`, `ProgramFiles { ast }` (the files
  behind the diagnostics view, which `add_duplicate_declaration_error` compares through); `resolve_name(location,
  name, meaning, message, is_use, exclude_globals)`, `get_immediate_aliased_symbol`,
  `get_type_only_alias_declaration`, `get_spelling_suggestion_for_name(name, &[SymbolId], meaning)`.
- Callees of later steps that the tree does not have yet: `check_expression_cached`, `check_computed_property_name`,
  `new_anonymous_type(symbol, members, call_signatures, construct_signatures, index_infos)`, `is_valid_spread_type`,
  `get_spread_type(left, right, symbol, object_flags, readonly)`.

## Checker: iteration and await, JSX, decorators (K3 steps 28 to 30)

Commits `63545ccfb7`, `4d4ebd3d98`, `ad038d4de2`. The 136 functions of the layers D-ITER, E-AWAIT, X-JSX, E-DECOR and
D-DECOR, each at its upstream place among the functions of its file: `checker/c11_check_variables_decorators.rs`
(`check_decorators`, `check_decorator`), `c12_iteration_types.rs`, `c15_calls.rs` (`resolve_decorator` to
`get_legacy_decorator_argument_count`), `c17_unary_meta_yield.rs` (`check_await_expression`),
`c47_promised_mapped_template.rs` (`get_promised_type_of_promise`, `get_promised_type_of_promise_ex`),
`c48_contextual_types.rs` (`get_contextual_type_for_decorator`), `c49_call_arguments_decorator_signatures.rs`,
`c51_type_facts_awaited.rs` (`check_awaited_type` to `get_awaited_type_of_promise_ex`), `jsx.rs`. No function is a
stand-in. PORT_STATUS.md has the rows.

NOT compiled by cargo, as under the checker headings above. "Verified" below says what was compiled and run instead.

### How a caller writes the calls

- `IterationTypesResolver` is `IterationTypesResolverKind::{Sync, Async}` (`c01_data.rs`), and each field of upstream's
  struct is a method of the kind in `c12_iteration_types.rs` that takes the checker: `r.get_global_iterator_type(c)`,
  `r.get_global_iterable_type(c)`, `r.get_global_iterable_type_checked(c)`, `r.get_global_iterable_iterator_type(c)`,
  `r.get_global_iterable_iterator_type_checked(c)`, `r.get_global_iterator_object_type(c)`,
  `r.get_global_generator_type(c)`, `r.get_global_builtin_iterator_types(c) -> Vec<TypeId>`,
  `r.resolve_iteration_type(c, t, error_node)`, and without the checker `r.iterator_symbol_name()`,
  `r.must_have_a_next_method_diagnostic()`, `r.must_be_a_method_diagnostic()`, `r.must_have_a_value_diagnostic()`.
  `r.get_resolved_iteration_types(c, yield_type, return_type, next_type)` is the method of 6474.
  `c.syncIterationTypesResolver` is `IterationTypesResolverKind::Sync`.
- `IterationTypes::has_types(self)` and `IterationTypes::get_type(self, c, kind)`. A record without types is
  `IterationTypes::default()`.
- `*[]*ast.Diagnostic` is `Option<&mut Vec<DiagnosticId>>` and `*[]*Signature` is `Option<&mut Vec<SignatureId>>`:
  `get_iteration_types_of_iterable_slow`, `get_iteration_types_of_iterator`, `_worker`, `_slow`,
  `get_iteration_types_of_method(t, r, method_name: &[u8], error_node, out)`, `elaborate_jsx_components`,
  `elaborate_iterable_or_array_like_target_elementwise`, `check_applicable_signature_for_jsx_call_like_element`;
  `resolve_decorator(node, candidates, check_mode)`, `resolve_jsx_opening_like_element(node, candidates, check_mode)`.
- Variadic message arguments are `&[Arg<'_>]`: `get_awaited_type_ex(t, error_node, message, args)`,
  `get_awaited_type_no_alias_ex`, `get_awaited_type_of_promise_ex`. `check_awaited_type(t, with_alias, error_node, message)`.
  A nil node, message or type is `NodeId::NIL`, `MessageId::NIL`, `TypeId::NIL`.
- `get_promised_type_of_promise_ex(t, error_node, this_type_for_error_out: Option<&mut TypeId>)`;
  `GetPromisedTypeOfPromise` is `get_promised_type_of_promise`.
- `get_iteration_diagnostic_details(use_, input_type, allows_strings) -> (MessageId, bool)`.
  `is_es2015_or_later_iterable(name)` is a free function.
- Results that are new slices: `get_effective_decorator_arguments(node) -> Vec<NodeId>`,
  `check_jsx_children(node, check_mode) -> Vec<TypeId>`. `get_uninstantiated_jsx_signatures_of_type` and
  `infer_jsx_type_arguments(node, signature, check_mode, context: InferenceContextId)` give lists of the checker.
- `get_decorator_argument_count` and `get_legacy_decorator_argument_count` return `isize`.
- `new_call_signature(type_parameters, this_parameter, parameters, return_type)` and `new_function_type` take
  `List<'a, _>` and `SymbolId::NIL` for no `this`; `new_es_decorator_call_signature(target, context, non_optional_return)`.
- `JsxReferenceKind::{COMPONENT, FUNCTION, MIXED}`; `JsxNames::JSX`, `JsxNames::INTRINSIC_ELEMENTS`,
  `JsxNames::ELEMENT_CLASS`, `JsxNames::ELEMENT_ATTRIBUTES_PROPERTY_NAME_CONTAINER`,
  `JsxNames::ELEMENT_CHILDREN_ATTRIBUTE_NAME_CONTAINER`, `JsxNames::ELEMENT`, `JsxNames::ELEMENT_TYPE`,
  `JsxNames::INTRINSIC_ATTRIBUTES`, `JsxNames::INTRINSIC_CLASS_ATTRIBUTES`, `JsxNames::LIBRARY_MANAGED_ATTRIBUTES` and
  `ReactNames::FRAGMENT` are `&'static [u8]`.
- Names are `Text<'a>`: `get_jsx_namespace(location)`, `get_local_jsx_namespace(file)`,
  `get_jsx_element_properties_name(ns)`, `get_jsx_element_children_property_name(ns)`,
  `get_name_from_jsx_element_attributes_container(name, ns)` (`ast::INTERNAL_SYMBOL_NAME_MISSING` and the empty text
  as upstream). `get_jsx_type(name: &[u8], location)`, `get_suggested_symbol_for_nonexistent_jsx_attribute(name: &[u8], t)`.
- A source file is its node: `get_local_jsx_namespace(file)`, `get_jsx_runtime_import_specifier(file) -> (Text<'a>, NodeId)`
  (it asks `Program::get_jsx_runtime_import_specifier(file)`, where upstream passes `file.Path()`).
- `parse_isolated_entity_name(a, text) -> NodeId` is the free function for `parser.ParseIsolatedEntityName` (nodes of
  the open store, the nil node for a text that is no entity name); `Checker::parse_isolated_entity_name(name)` is
  jsx.go:1435 and marks the result as synthetic with the free function `mark_as_synthetic(a, node)`.
- JSX elaboration: `JsxElaborationElement { error_node, inner_expression, name_type, create_diagnostic: bool }`;
  `get_elaboration_element_for_jsx_child(child, name_type)`;
  `generate_jsx_children(node, &mut JsxInvalidTextDiagnostic) -> JsxChildrenIterator`, whose `next(c)` gives the next
  element; `elaborate_iterable_or_array_like_target_elementwise(&mut iterator, source, target, relation, out)`.

### Differences from upstream

- D-ITER. `getGlobalBuiltinIteratorTypes` is `c.getGlobalTypesResolver(names, 1, false)` upstream, a list made once.
  The Checker has no field for the two lists (a resolver is its kind), so `get_global_builtin_iterator_types` makes
  the list at each call: four lookups for the sync kind, one for the async kind. `getGlobalType` without error
  reporting reports nothing and answers the same type at every call (the declared type of the global symbol is stored
  at the first), so only the work differs. Two `Memo<List<'a, TypeId>>` fields of the Checker would give upstream's
  shape back.
- D-ITER. `IterationTypes.getType` takes the checker: its panic for a kind outside the three (6507) is a fault and the
  error type. A stack test is the first statement of `get_iteration_types_of_iterable_worker` (`StackLimit`, no types).
  The two deferred diagnostics (6384, 6437) are `DeferredDiagnosticCallback`s; the second owns the vector of the
  diagnostics that it adds as related information.
- E-AWAIT. A stack test is the first statement of `get_awaited_type_no_alias_ex` (`StackLimit`, the error type).
  31499 with a nil message: `getAsyncFromSyncIterationTypes` passes none, and with an error node and a thenable
  upstream dereferences nil in `ast.NewDiagnostic`. Here that is a fault, no diagnostic is added, and the result is
  nil. `debug.Assert(thisTypeForError != nil)` of 29099 is an assert fault and the function goes on.
- X-JSX. `createDiagnostic` of `JsxElaborationElement` holds one closure upstream, the one that
  `getElaborationElementForJsxChild` makes for a text child. The field is a `bool`, the body of the closure is
  `JsxInvalidTextDiagnostic::create_diagnostic(c, prop)`, and the two variables that `getInvalidTextualChildDiagnostic`
  captures are fields of that record: the message and the three texts are made for the first text child that reports.
  `get_elaboration_element_for_jsx_child` has no third parameter.
- X-JSX. `generateJsxChildren` is a Go iterator. `JsxChildrenIterator::next` runs the loop up to the next `yield`, so
  the number literal type of a child is made when the consumer asks for its element, and the children after the last
  element are visited by the call that returns `None`, as upstream visits them when the `for range` ends.
- X-JSX. Closures are nested functions: `checkTagNameDoesNotExpectTooManyArguments` (node, `reportErrors` and the
  output are parameters), `createJsxAttributesType` (the symbol and the table are parameters, the object flags a
  `&mut`: the call comes before the read of the flags in each `getSpreadType` call, as Go evaluates it),
  `parentHasSemanticJsxChildren`, and `visit` of `getJsxNamespaceContainerForImplicitImport` (the first tag is stored
  in the links after the walk).
- X-JSX. `parse_isolated_entity_name` is written with the scanner of the tree, package parser being out of scope:
  the JSX language variant, `parseEntityName(true, false, nil)`, and the nil node unless the text ends after the
  name and the scanner reported nothing. A token from `Identifier` on is a name, so `#a` alone is an identifier with
  that text and `a.#b` is nil, as upstream. The rule of `parseRightSideOfDot` for a name after a line break that
  another name follows on its line needs no code: another token follows, which is already no result. `finishNode`
  sets the range, `NodeFlags::JAVA_SCRIPT_FILE` and the parent of the children.
- X-JSX. Stack tests: `get_uninstantiated_jsx_signatures_of_type` (the nil list), and the two tree walks
  `mark_as_synthetic` and `visit`, which are free functions and test `bun_core::StackCheck::init()` as `ast/ast.rs` does.
- X-JSX. Panics and asserts are faults with a fallback: `diags[0]` of 152 when the failed check left no diagnostic
  (no diagnostic is added); 417 (the zero element); 762, 768 and 1189 (assert, go on); 1224 `Invalid tag name`
  (`unknownSymbol`, nothing stored in the links). 193 tests the length upstream.
- X-JSX. `pragma.Args["factory"].Value` is `Pragma::arg(b"factory")`, the empty text for a pragma without the argument.
  The fake property signature of the children is a node of the open store made with `Factory::new(a)`; its parent and
  symbol are set with `a.set_parent` and `a.set_symbol`. The two commented-out lines 1178-1179 are not carried over.
- E-DECOR. `c.factory` is `Factory::new(self.ast)`: `new_call_signature` makes the `any` keyword node, then the function
  type node. The `break`s of the switch cases are labeled blocks. `min(max(n, 1), 2)` is `n.clamp(1, 2)`. Panics are
  faults with a fallback: 8887 (the nil message), 9301 (0), 30275 (no arguments), 30305 (assert, go on), 30597 (the
  error type).
- D-DECOR. 6180 is a fault, and the decorator is not checked for assignability.

### Verified

No cargo build and no `bun bd` ran. What ran is the scratch root `checker-declarations-grammar-jsx/k3-steps-28-30/`
beside this file (`sh run.sh [work dir] [pien]`: rustfmt, rustc and clippy-driver alone, output in `/tmp/k3-28-30`,
under a minute without `pien`):

- `rustfmt --check --edition 2024` accepts the nine files.
- The root mounts by `#[path]` the seven files that hold only these layers, a scratch copy of the functions of these
  layers in `c11` and `c47`, and the `core`, `collections`, `stringutil`, `tspath`, `jsnum`, `ast`, `scanner`,
  `module` and `evaluator` modules and the data model of the tree as they are (`checker/c01_data.rs`,
  `c02_program_checker.rs`, `types.rs`, `mapper.rs`, `links.rs` of `761df39dfb`). So every field of the Checker, record,
  cast, flag, link store, list helper, fault sink, node accessor, factory call and scanner call in these files is
  type-checked and borrow-checked against the real one. `crate::internal`, `crate::diagnostics`, the diagnostic store
  and `List`, `Map`, `Text` are stand-ins with the shapes of `checker-data-model-contract`, until the tree has them.
  A callee of another step is a signature with an empty body: a script copies it from the file of the tree that
  defines it (94 callees when this was written) and takes the rest from `stubs/checker_stub_template.rs`, one line a
  callee, dropped by the script when the tree defines the callee. `run.sh` prints both counts.
- rustc with the deny set of the workspace (`warnings`, `unused_*`, `unreachable_*`): clean. clippy-driver with the
  lint table of the workspace `Cargo.toml` and the `clippy.toml` of the repository: no finding in a file of the
  repository. `4d4ebd3d98` is what the first clippy run asked for (four `needless_late_init`, two
  `needless_option_as_deref`).
- `parse_isolated_entity_name` against `parser.ParseIsolatedEntityName` of typescript-go 89d5d5b (a Go program
  built from the module copy `/tmp/rr/parsediag-mod`, `pien/main.go`): 146 hand-picked texts and 6,000 seeded random
  token strings, 937 of them with a result. Kind, text, range, the JavaScript flag of every node and the parent of the
  children are the same for all 6,146, and so is the nil result.
- Scripts: the 136 upstream functions are present in upstream order; every upstream comment of the ranges is present,
  folded to one line (jsx.go 1178-1179 aside); no two comment lines are adjacent; no `unwrap`, `expect`, `panic`,
  `unsafe` or index into a slice; the 63 diagnostic messages exist by name in the contract's table and every call that
  names its message gives as many arguments as the message has placeholders; the calls that other files of the tree make into
  these functions (`c05`, `c06`, `c07`, `c08`, `c09`, `c10`, `c28`, `c31`, `c34`, `c39`, `c46`, `relater.rs`,
  `nodebuilderimpl.rs`) match the signatures.
- Nothing ran a function of these layers other than `parse_isolated_entity_name`, and nothing compared a diagnostic
  with upstream's.

### What these files expect and the tree does not have

`k3-steps-28-30/stubs/checker_stub_template.rs` has the expected signature of each callee below, one line each.

- `ObjectLiteralDiscriminator { props: List<'a, NodeId>, members: List<'a, SymbolId> }` with the `Discriminator<'a>` of
  `relater.rs` (checker.go, the contextual type functions of `c48`): `discriminate_contextual_type_by_jsx_attributes`
  makes one.
- Of utilities.go: `is_type_any(c, t)`, `is_jsx_intrinsic_tag_name(a, tag_name)`, `entity_name_to_string(a, name) -> Vec<u8>`.
- The diagnostics sink and globals: `error`, `add_diagnostic`, `add_error_or_suggestion`, `add_deferred_diagnostic`,
  `error_and_maybe_suggest_await(node, suggest, message, args) -> DiagnosticId`, `new_diagnostic_for_node`,
  `new_diagnostic_chain_for_node`, `DiagnosticStore::{new_diagnostic, new_diagnostic_chain, add_related_info}`,
  `resolve_name`, `get_global_symbol(name, meaning, message)`, `get_global_type(name, arity, report_errors)`,
  `get_spelling_suggestion_for_name(name, &[SymbolId], meaning)`, and the memoized getters as methods with `&mut self`:
  `get_global_awaited_symbol`, `get_global_awaited_symbol_or_nil`, `get_global_promise_type`, the fourteen
  `get_global_*iterator*`, `*iterable*` and `*generator*` types, `get_global_iterator_yield_result_type`,
  `get_global_iterator_return_result_type`, `get_global_typed_property_descriptor_type`, the eight
  `get_global_class_*decorator*` types.
- Expressions, calls and contextual types: `check_expression`, `check_expression_cached`,
  `check_expression_ex(node, check_mode)`, `check_expression_for_mutable_location(node, check_mode)`,
  `check_expression_with_contextual_type(node, t, InferenceContextId, check_mode)`, `check_computed_property_name`,
  `check_deprecated_signature`, `check_spread_prop_overrides(t, SymbolTableId, node)`,
  `create_synthetic_expression(parent, t, is_spread, tuple_name_source)`, `get_resolved_signature(node, candidates, check_mode)`,
  `resolve_call(node, signatures, candidates, check_mode, SignatureFlags, head_message)`, `resolve_error_call`,
  `resolve_untyped_call`, `is_untyped_function_call(func_type, apparent, call_count: isize, construct_count: isize)`,
  `invocation_error_details(node, t, kind) -> DiagnosticId`, `invocation_error_recovery(t, kind, diagnostic)`,
  `find_contextual_node(node, include_caches) -> isize`, `get_contextual_type`, `get_apparent_type_of_contextual_type`,
  `get_contextual_type_for_argument_at_index(node, 0)`, `get_type_of_property_of_contextual_type(t, name)`,
  `get_inference_context(node) -> InferenceContextId`, `add_intra_expression_inference_site(context, node, t)`,
  `infer_types(inferences, source, target, priority, contravariant)`, `get_inferred_types(context)`,
  `is_context_sensitive`, `is_possibly_discriminant_value`, `get_symbol_at_location(node, ignore_errors)`,
  `get_type_of_node`, `get_first_transformable_static_class_element`.
- Types: `new_anonymous_type`, `new_signature`, `create_type_reference`, `try_create_type_reference`,
  `get_applicable_index_symbol(t, key_type)`, `get_indexed_access_type(object, index)`,
  `get_indexed_access_type_or_undefined(object, index, AccessFlags, node, alias)`,
  `get_literal_type_from_property_name(name)`, `get_propagating_flags_of_types(List<'_, TypeId>, TypeFlags) -> ObjectFlags`,
  `get_property_name_from_index(t, node)` (a `Vec<u8>` or a `Text` both fit), `get_spread_type(left, right, symbol, ObjectFlags, readonly)`,
  `is_valid_spread_type`, `get_type_of_property_or_index_signature_of_type(t, name)`, `get_type_with_facts(t, TypeFacts)`.
- Grammar checks, each called as a statement: `check_grammar_await_or_await_using`, `check_grammar_decorator`,
  `check_grammar_jsx_element`, `check_grammar_jsx_expression`.
