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
- Layer 7 brought `LiveList`, `Map` and `Memo` into `core/golang.rs` (`0d31a6eb0f`; their tests `ec92cd8fca`): lines
  152 to 220, 222 to 270 and 345 to 350 of the contract's file. A caller writes them as the contract has them:
  `Map::make()` is `make(map[K]V)` and `Map::default()` the nil map; `get(&k)` answers the zero value for a key that is
  not there, `get_ok(&k)` an `Option`, `set(k, v)` answers `false` on the nil map where Go panics (`#[must_use]`),
  `delete(&k)`, `clear()`, `len()` as an `isize`, `is_nil()`; `LiveList::NIL`, `from_cells`, `is_nil`, `len`, `at`,
  `set` with its `bool`, `iter` (each value is read at its step), `same`, `sub`, `to_vec`; `Memo { value, done }`.
  Three differences: `Map` names `bun_collections::HashMap` itself, because the tree has no `deps` module; a key of
  `Map` needs `Hash + Eq` and not `Copy` as well, because the key of `bigint_literal_types` is `jsnum::PseudoBigInt`,
  which owns its digits; `LiveList::sub` keeps a part of the nil list nil, as `List::sub` of the tree does. A value of
  `Map` is `Copy + Default`. `Map` has no `Clone` and no `Debug` (`bun_collections::HashMap` has neither), `LiveList`
  no `Debug`. No compiler has seen the three and the two tests (`live_list_shares_its_cells`, `map_is_a_go_map`) were
  not run: they were read against `src/collections/zig_hash_map.rs` and against the calls of `checker/`, and
  `rustfmt --check --edition 2024` passes. `SliceBuf`, `compare_strings` and `compare_f64` are still not in the tree,
  and no file names them.

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
  `DiagnosticStore`; the others wait ("Binder: the wiring of `binder`" below). Layer 6 brought `deep_clone_node`
  ("Emit printer: the wiring of `printer`" at the end of this file). Layer 7 brought `Map`, `LiveList` and `Memo`
  (`0d31a6eb0f`, the last point of "Differences from the contract" above), and `Diagnostics`, `DiagnosticsCollection`,
  `RepopulateDiagnosticInfo` and `RepopulateDiagnosticKind` (`644e7f1b94`, "Node table: the collection of a checker and
  the comparison of diagnostics" below).
- `lowering::ParseDiagnostic` and `importer::javascript::ParseDiagnostic` stay two types until `ast/diagnostic.rs` has
  the diagnostic itself. It has since `d0230a94c6`; the two types are still there.

## Binder: the wiring of `binder`

Commits `a9b14ab2d6` (`core/golang.rs`, `ast/ids.rs`) and `d0230a94c6` (`ast/diagnostic.rs`, `ast/file.rs`,
`ast/open.rs`, `ast/publish.rs`, and `pub mod binder;` in `lib.rs`), both written by the job that commits the worktree;
`6f844a8b93` after them changes one comment of `ast/file.rs`.
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
  RepopulateDiagnosticKind, deep_clone_node}`: files of later layers name them and no file defines them
  (`deep_clone_node` is in `ast/deepclone.rs` since layer 6; the four others of `crate::ast` are in `ast/diagnostic.rs`
  since `644e7f1b94`, the next heading).
- No test reads what was added. The tests of the contract's diagnostics block (`diagnostics_tests.rs`) need the
  comparisons and the writer, which are not in the tree. The comparisons are since `644e7f1b94`; the writer is not.

## Node table: the collection of a checker and the comparison of diagnostics (`ast/diagnostic.rs`)

Commit `644e7f1b94`, written by the job that commits the worktree. `ast/diagnostic.rs` (1,311 lines, 361 before) now
also holds `internal/ast/diagnostic.go` 15-30, 55, 74 and 80 (the repopulate info), 234-364 (`DiagnosticsCollection`)
and 366-503 (the comparisons), and Go's `slices` sorting that they call. The four files of `checker/` that import the
names (`c02_program_checker.rs`, `c21_resolved_symbols_diagnostics.rs`, `c22_symbols_merge.rs`,
`c24_external_modules.rs`) are unchanged.

### How a caller writes the calls

- `SourceFiles` is what the comparison and a writer read of a file: `file_name(file)`, `path(file)`, `text(file)` and
  `ecma_line_map(file) -> &[i32]`, each for the root of a source file. `ProgramFiles` of `c21` implements it.
- `Diagnostics { store: &DiagnosticStore, files: &F }` is a `Copy` view over the diagnostics of one store:
  `compare_diagnostics(d1, d2) -> isize` (`ast.CompareDiagnostics`), `equal_diagnostics(d1, d2)` and
  `equal_diagnostics_no_related_info(d1, d2)`.
- `DiagnosticsCollection` (`Default`): `add(view, d) -> DiagnosticId` (the id that the collection keeps: `d`, or an
  equal one that it had), `lookup(view, d)` (nil when none), `get_global_diagnostics(view)`,
  `get_diagnostics_for_file(view, file)` and `get_diagnostics(view)`. Each takes the view first, the three getters
  return `Vec<DiagnosticId>`, and all but `get_diagnostics` take `&mut self` (the lists are sorted at the first read).
- `store[d].set_repopulate_info(RepopulateDiagnosticInfo { kind, module_reference, mode, package_name })` and
  `store[d].repopulate_info() -> Option<&RepopulateDiagnosticInfo>`. `RepopulateDiagnosticKind::{MODE_MISMATCH,
  MODULE_NOT_FOUND}` are 1 and 2; the `Default` of the info has kind 0, which upstream has no name for.

### Differences from the contract and from upstream

- The text is lines 10 to 16 and 337 to 739 of `checker-data-model-contract/bottom-up/crate/src/ast_diagnostic.rs` with
  four differences: the paths of the tree (`crate::ast::ids`, `crate::core`); `strings::compare` of `stringutil/util.rs`
  in place of the contract's private `compare_strings` (the same body); the sorting functions are called as
  `slices::...` of a private `mod slices` at the end of the file, which is the contract's `tscore/slices.rs` with
  `pub(super)` on its three entries; and `get_diagnostic_message_identity` has upstream's second branch
  (diagnostic.go 399: a message of code -1 is compared by its text), so an ad hoc diagnostic with an empty text has the
  empty identity, where the contract's text answered its key `-1`. Seven one-line comments are new.
  `round2-layer7-checker/diagnostic-assemble.py` makes the file from the one of `d0230a94c6` and the contract's texts.
- As in the contract: the key of the index and of the lists is the root of the file, where upstream's is its path; a
  nil diagnostic is not added, where upstream dereferences nil; there is no mutex (a collection belongs to one checker);
  `get_diagnostics` walks the files in the order of their first diagnostic, where upstream ranges over a map; the
  recursion over chains and related information stops past depth 200 (there `equal` answers false and a comparison
  descends no further), where upstream has no bound; `slices.Compare` of two argument lists answers the difference of
  the lengths, where upstream answers -1 or +1 (every caller reads the sign).
- The repopulate info is not in the contract. It is `Option<Box<RepopulateDiagnosticInfo>>` in the diagnostic (upstream's
  pointer); `clone_diagnostic` copies it, where upstream's `Clone` shares the pointer; `set_repopulate_info` takes the
  info by value, so it cannot set nil again (no caller does).
- Not in the tree, as before: `SetExternalData` (82), `String` (125), `displayMessageArgs` (134),
  `NewDiagnosticFromSerialized` (166), `NewExternalDiagnostic` (223).

### Verified

Cargo compiled nothing with this commit: the survey after it is the first compile of these lines in the real crate.
What was checked instead is `sh round2-layer7-checker/diagnostic-probe.sh` (single processes, no cargo), which reads
the file of the tree beside the real `ast/ids.rs`, `core/text.rs`, `diagnostics/` and `stringutil/` (stand-in:
`core::ResolutionMode` with the derive list of `core/compileroptions.rs` 364):

- `rustc --edition 2024 --crate-type lib --emit=metadata` with the rust lints of the workspace denied, and
  `clippy-driver` with the clippy table of the workspace and the repository's `clippy.toml`: exit 0, no warning. The
  root also holds the calls of `c02`, `c21`, `c22` and `c24` as those files write them.
- Five tests over the file in that root (they are not in the tree): one of two equal diagnostics is kept and both of
  a collision; the getters sort by path, position, end, code and arguments, and `lookup` finds an equal diagnostic; the
  longer chain and the more related information come first; an ad hoc message is compared by its text, the empty one
  first; the repopulate info is kept, copied by `clone_diagnostic`, and a write through nil is dropped.
- `mod slices` as a crate of its own (`diagnostic-slices-test.py`), with overflow checks on: `sort_func` leaves the
  order of Go on the 210 vectors of `importer/javascript/testdata/go_sort_func.txt`; `sort_stable_func` gives the order
  of the standard library's stable sort and `binary_search_func` the first position that is not less, for 0 to 299
  elements over six key counts; with a comparer that answers at random (4,000 rounds) the two sorts end, keep every
  element and do not panic.
- `rustfmt --check --edition 2024` on the file: exit 0. No `unsafe`, `unwrap`, `expect`, `panic!`, `allow(`, and no run
  of two comment lines.
- Once, not in the script: `round2-layer7-checker/c21-sink-probe.rs` without its stand-ins for `SourceFiles`,
  `Diagnostics` and `DiagnosticsCollection`, with this file in their place and with `core/golang.rs` of `a9b14ab2d6`
  (the one of the tree names `bun_collections`): the real `c21_resolved_symbols_diagnostics.rs` compiles with `rustc`, as
  a library and with `--test`. Its test was not run: it asserts what the stand-in collection did.
- Not done: `cargo check`, `cargo clippy`, `cargo test`; the contract's `diagnostics_tests.rs` over this file; a read of
  `c02`, `c22` and `c24` by a compiler (their calls were read and copied into the probe).

### What waits

- Go's `slices` sorting is in the tree four times, each private to its file or its package: here (`binary_search_func`,
  `sort_stable_func` and `sort_func`, with a comparer that answers an `isize`), `checker/c43_unions_intersections.rs`
  (the first two, the same text), `checker/utilities.rs` and `importer/javascript/tree.rs` (`slices::sort_func`, with a
  comparer that answers a `bool`). `core/golang.rs` is where one copy belongs ("What callers in the tree expect and
  these packages do not have" under "Leaf packages"); `sort_and_deduplicate_diagnostics` of the contract's
  `compiler_program.rs` will need `sort_func` from a module that is not `ast`.
- No test of the tree reads the collection or the comparisons. The contract's `diagnostics_tests.rs` also needs its
  writer (`diagnosticwriter.rs`) and `compiler_program.rs`, which are not in the tree.

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
`src/js_parser`, `src/ast` or `src/runtime` changed. `lib.rs` declares the module since `5d5a6e614a`
(`pub mod lowering;`, with `bun_ast` in `Cargo.toml`). No file of the tree calls `lower_source_file` but
`lowering/tests.rs`.

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

Not built by cargo at that commit: its `lib.rs` had no `pub mod lowering;`, and `crate::diagnostics`,
`crate::internal`, `crate::ast::Arg` were not in the tree. `5d5a6e614a` declares the module: PORT_STATUS.md, "Lowering
of Bun's parse", says what was checked with that commit and what was not, and that the tests have not run in the real
crate. Compiled with `rustc` alone from a scratch root outside the repository: `ast`, `collections`, `core`,
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
  The crate has the line of `lib.rs` and `bun_ast` since `5d5a6e614a`, and `bun_core` since `a8b48548a6`. It has
  neither dev-dependency and no stand-in: `cargo test -p bun_typecheck` cannot compile `lowering/tests.rs`, which
  names the two crates, and with it no test of the crate, until they are there.
- `crate::diagnostics`: `MessageId` and the constants `KEYWORDS_CANNOT_CONTAIN_ESCAPE_CHARACTERS`,
  `IDENTIFIER_EXPECTED`, `AN_OPTIONAL_CHAIN_CANNOT_CONTAIN_PRIVATE_IDENTIFIERS`,
  `IMPORT_ASSERTIONS_HAVE_BEEN_REPLACED_BY_IMPORT_ATTRIBUTES_USE_WITH_INSTEAD_OF_ASSERT`; the tests also name
  `OCTAL_LITERALS_ARE_NOT_ALLOWED_USE_THE_SYNTAX_0` and `DECIMALS_WITH_LEADING_ZEROS_ARE_NOT_ALLOWED`.
  `crate::ast::Arg` with `Str`, `Int`, `Bool`, as the scanner uses it. The tree has all of them since layers 2 and 3
  of round 2 (`diagnostics/mod.rs`, `diagnostics/diagnostics_generated.rs`, `ast/diagnostic.rs`).
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

Nothing was built with cargo or `bun bd` at that commit: its `lib.rs` did not declare the modules (`ebb836b39f`
declares `importer`; PORT_STATUS.md, "Parser pieces for JavaScript trees", has the state of the files in the real
crate since that line, and says that their tests have not run there). The files were compiled in place
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

### What these files expect

The tree did not have the first four when the files came in. It has them now (layers 1 to 5 of round 2):

- `lib.rs`: `pub mod importer;` (`ebb836b39f`) and `ast`, `core`, `diagnostics`, `internal`, `scanner`, `stringutil`.
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

The tree does not have:

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
- The sink of the checker (`checker.go` 14052-14168, in `c21_resolved_symbols_diagnostics.rs` since `f49ea57437`):
  `error(location, message, args) -> DiagnosticId`, `error_skipped_on_no_emit` with the same parameters,
  `error_and_maybe_suggest_await(location, maybe_missing_await, message, args) -> DiagnosticId`,
  `error_or_suggestion(is_error, location, message, args)`, `add_error_or_suggestion(is_error, diagnostic)`,
  `add_diagnostic(diagnostic)` and `add_suggestion_diagnostic(diagnostic)`, whose result is the id that the collection
  keeps (the one given, or an equal one that it had). `args` is `&[Arg<'_>]`, `&[]` for none. A diagnostic is an id of
  `c.diagnostic_store`: `c.diagnostic_store[d]` reads it, `c.diagnostic_store.add_related_info(d, related)` is
  `d.AddRelatedInfo(related)`.
- `GetDiagnostics` is `get_diagnostics_exported(source_file) -> Vec<DiagnosticId>` (`getDiagnostics` has the same
  snake case name), `GetSuggestionDiagnostics` is `get_suggestion_diagnostics(source_file)` and `GetGlobalDiagnostics`
  is `get_global_diagnostics()`: ids of `c.diagnostic_store`, and no context parameter.
  `get_diagnostics(source_file, collection)` takes `DiagnosticsCollectionKind::{Diagnostics, SuggestionDiagnostics}`
  where upstream takes a pointer to one of the two collections of the checker.
- `add_deferred_diagnostic(Box::new(move |c: &mut Checker<'a>| { .. }))`: the callback
  (`DeferredDiagnosticCallback<'a>`) gets the checker that upstream's closure captures.
- `add_deprecated_suggestion(location, declarations, deprecated_entity)` and
  `add_deprecated_suggestion_worker(declarations, diagnostic)` only read the list (`List<'_, NodeId>`, so
  `List::from_slice(&[declaration])` fits) and the name (`&[u8]`). `IsDeprecatedDeclaration` is the method
  `is_deprecated_declaration(declaration)` with `&mut self` (it goes through the cache of the combined node flags);
  `ast::is_deprecated_declaration(a, declaration)` is the free function of `ast/utilities.go`.
  `has_parse_diagnostics(source_file)` takes `&self`.
- `ProgramFiles { ast }` implements `ast::SourceFiles`: the file names, paths and texts behind
  `Diagnostics { store: &c.diagnostic_store, files: &files }`, the view that the two collections of the checker and
  `compare_diagnostics` of `c22_symbols_merge.rs` compare through.

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
- The sink (14052-14168). No function takes a `ctx`: a check is not canceled, and `check_source_file` gets none.
  `get_diagnostics` after a canceled check returns the empty list where upstream returns nil. `addErrorOrSuggestion`
  copies the struct of the diagnostic: here the store makes the copy (`clone_diagnostic`), as `report_unused` of `c13`
  does. `produce_deferred_diagnostics` takes the list out of the checker before it runs it: a callback that a
  callback adds is not run and is dropped, as upstream's `range` and its assignment of nil do; a call from inside a
  callback, which upstream does not make, would run nothing twice. A read through the nil symbol in
  `is_deprecated_symbol` gives false where upstream dereferences nil.
- `ProgramFiles`: the file of a root is found by the page of its id (`Ast::file_of`), and only for the root itself.
  `path` is the path that the file keeps (`SourceFileData.path`), where the scratch of the contract, whose table had
  no path, answered the file name. `ecma_line_map` is empty: `SourceFiles` of the contract answers `&[i32]`, and a
  file keeps its line map as `TextPos` (`File::ecma_line_map`), which a writer of diagnostics reads there.

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
  behind the diagnostics view, which `add_duplicate_declaration_error` compares through; these six are in
  `c21_resolved_symbols_diagnostics.rs` since `f49ea57437`); `resolve_name(location,
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

## Emit printer: the wiring of `printer`

Commits `a518aba15d` (`ast/deepclone.rs`), `a8df180054` (`printer/factory.rs`, `printer/printer.rs`,
`printer/utilities.rs`) and `c73680fe1d` (`ast/mod.rs`, and `pub mod printer;` with `#![allow(dead_code)]` in
`lib.rs`), all three written by the job that commits the worktree. The other ten files of `printer/` are those of
round 1, unchanged. This section says what a caller of the printer and of a deep clone writes; the rows and what was
checked are in PORT_STATUS.md, "Emit printer".

### How a caller writes the calls

- `crate::printer::NodeFactory<'a, 'c>` has two lifetimes: `'a` is the tree and `'c` the borrow of the emit context.
  `new_node_factory(a: Ast<'a>, context: &'c mut EmitContext) -> NodeFactory<'a, 'c>`. A factory is made where it is
  used and dropped with the statement, so the context is free again after it:
  `new_node_factory(a, self.emit_context).new_token(Kind::DotToken)`.
- The factory implements `NodeSink`, `NodeUpdate` and `NodeClone` of `crate::ast`. The constructors (`new_token`,
  `new_identifier`, ...) are methods of the trait `crate::ast::NodeFactory` and the update functions of
  `crate::ast::NodeUpdater`: a file that calls them imports the trait. `clone_node(node)` (`Node.Clone(f)`: the clone
  is marked as synthesized and linked to its original) and `deep_clone_node(node)` (`f.DeepCloneNode(node)`) are
  methods of the factory itself and need no import.
- `crate::ast::deep_clone_node(f: &mut F, a: Ast<'_>, node: NodeId) -> NodeId` for `F: NodeClone` is
  `NodeFactory.DeepCloneNode`: a copy of the node and of everything that `VisitEachChild` visits below it, made with
  `f`. Every node and every list of the copy is of the open store and has the range (-1, -1); the last node of a list
  that had a trailing comma has (-2, -2). The nil node gives the nil node.
- `crate::ast::NodeClone: NodeUpdate` is the factory that upstream's three `Clone` methods take:
  `clone_node(node)`, `clone_node_list(list)`, `clone_modifier_list(list)`. `ast::Factory` and `printer::NodeFactory`
  implement it. Both also have `clone_node` as a method of their own, which the trait method calls: a call on the
  type itself needs no import.
- `Printer.Write` is `Printer::write_exported(node, source_file, writer)`: `write(text)` of printer.go 304 has the
  same snake case name and stays `write`, private to `printer/printer.rs`.
- `lib.rs` carries `#![allow(dead_code)]`: the rust lint `dead_code` is off for the whole crate from `c73680fe1d` on,
  every other lint of the workspace stays denied.

### Differences from upstream

- `get_deep_clone_visitor(a, synthetic_location, run)` calls `run` with the visitor where upstream returns it: a
  `NodeVisitor` borrows its callbacks, which live in that call. The factory is the state `C` of the visitor, so it is
  the argument of the visitor's methods (`visitor.visit_node_exported(f, node)`) and not a capture of the callbacks.
- The visit callback of the deep clone checks the stack before it visits the children of a node; without stack left
  it records `FaultKind::StackLimit` and clones the node as a leaf.
- A place of `printer/` that upstream's code has and the port has not records a fault with the name of the upstream
  function (`a.unhandled("Printer.emitFunctionBody", node)`), 22 places, and is not an entry of the stand-in log.
  Layer 6 did not change that.

### What waits

- `checker/printer.rs` 162, 265, 333 and 373 call `p.write(node, source_file, writer)`: the name is `write_exported`.
- `checker/nodebuilderimpl.rs` 214 names `NodeFactory<'c>`: with the checker's `Checker<'a>` the type is
  `NodeFactory<'a, 'c>`.
- `Printer<'p>` still has one lifetime for the tree (`a: Ast<'p>`), for the emit context (`&'p mut EmitContext`) and
  for the writer (`&'p mut (dyn EmitTextWriter + 'p)` of `write_exported`), and `Ast` is invariant. So a caller lends
  its emit context and its writer for as long as the tree is used. No file of layers 1 to 6 makes a printer, so
  nothing fails there. The four `create_printer_*` of `checker/printer.rs` take the context out of the checker for
  one block: by the reasoning that explains the 18 borrow errors of `emit_property_access_expression`, such a printer
  does not accept that. This was not compiled against the checker; the comment at the end of
  `round2-layer6-printer/probe.rs` has a caller of a stand-in printer that rustc rejects for this reason. The answer
  would be the one `NodeFactory` got, a second lifetime for the borrows: a change of `printer/printer.rs`, not of its
  callers.

## Checker: grammar checks (`checker/grammarchecks.rs`)

Commit `6349fc8157` (written by the job that commits the worktree). The 76 functions of `grammarchecks.go` (layer
G-GRAMMAR), in upstream order. PORT_STATUS.md has the row.

NOT compiled by cargo: `checker/mod.rs` still names modules without a file, and rustc stops at the first of them.
"Verified" below says what was checked instead.

### How a caller writes the calls

- The four helpers: `grammar_error_on_first_token(node, message, args)`, `grammar_error_at_pos(node_for_source_file,
  start: i32, length: i32, message, args)`, `grammar_error_on_node(node, message, args)` and
  `grammar_error_on_node_skipped_on_no_emit(node, message, args)`. `args` is `&[Arg<'_>]`, and each answers `bool`:
  true when it reported.
- A check takes the `NodeId` of the node that upstream takes as a cast (`check_grammar_decorator(decorator)`,
  `check_grammar_heritage_clause(heritage_clause)`, `check_grammar_variable_declaration_list(list)`). A
  `*ast.NodeList` is a `NodeListId` (`check_grammar_type_arguments(node, type_arguments)`,
  `check_grammar_for_disallowed_trailing_comma(list, message)`, `check_grammar_parameter_list(parameters)`,
  `check_grammar_type_parameter_list(type_parameters, file)`), and a `*ast.SourceFile` is the id of the SourceFile
  node (`check_grammar_source_file(file)`, `check_grammar_arrow_function(node, file)`).
- Every check answers `bool` but `check_grammar_numeric_literal(node)`, which answers nothing, as upstream.
- These only read and take `&self`: `find_first_modifier_except`, `find_first_illegal_modifier`,
  `find_first_illegal_decorator`, `does_accessor_have_correct_parameter_count`,
  `container_allows_block_scoped_variable`. Every other method takes `&mut self`.
- Free functions: `get_identifier_from_entity_name_expression(a, node)`,
  `is_initializer_string_or_number_literal_expression(a, expr)`, `is_initializer_big_int_literal_expression(a, expr)`.

### Differences from upstream

- `checkGrammarRegularExpressionLiteral`. The scanner is made for the one check (the Checker has no `regExpScanner`
  field), so `SetText("")` and `SetOnError(nil)` after the scan have no counterpart. The error callback borrows the
  checker and `lastError` while the scanner lives. `re_scan_slash_token` has no pattern parser, so the function
  records `regExpParser.run` in the stand-in log at each call: only `Unterminated regular expression literal` can
  come out of it. The panic of `ResetTokenState` for a negative position is a fault, no scan, and the answer false.
- The two switches on the module kind with `fallthrough` (1196-1214, 1691-1726) are a labeled block that holds the
  three case bodies once each, in upstream's order: the node module kinds (the CommonJS test), then those and ES2022,
  ESNext, Preserve and System (the target test), then the default.
- Stack tests (`StackLimit`, false) are the first statement of the three recursive functions:
  `check_grammar_for_es_module_marker_in_binding_name`, `check_grammar_name_in_let_or_const_declarations`,
  `container_allows_block_scoped_variable`.
- Panics and asserts are faults with a fallback: 263 (false), 637 (the nil node), 918 and 950 (the token as detail,
  false), 977, 1105, 1885, 1896 and 1942 (the kind as detail, false), 1324 (false), 1787 (false, and TS1156 is not
  reported). The asserts of 94 and 1222 record and go on. Two indexings that upstream does not guard are faults too:
  `typeParameters.Nodes[0]` of 785 for an empty list (an arrow function `<>() => x` in a `.mts` or `.cts` file that
  has parse diagnostics; false, and the line terminator test is not made) and `node.Parent.Members()[0]` of 1867
  (false).
- A nil `FunctionLikeData()` or `ClassLikeData()` (762, 896), which upstream dereferences, reads as the zero record:
  nil lists, and the checks go on.
- `checkGrammarClassDeclarationHeritageClauses` keeps the parameter `file` that upstream does not read (`_file`).
- `checkGrammarObjectLiteralExpression`: the call `prop.ClassLikeData()` of 1079, whose result upstream drops, is not
  carried over; `commonProp.PostfixToken` is `a.postfix_token(prop)`; `seen` is a `BTreeMap` by the effective name
  (the function never ranges over it).
- Values that upstream reads again and again are read once: `modifier.Flags&NodeFlagsReparsed` per modifier and the
  kind and the parent of the node in `check_grammar_modifiers`, `NodeFlagsAwaitContext` in
  `check_grammar_for_in_or_for_of_statement`.
- `strings.ContainsRune(nodeText, '.')` is `bun_core::strings::contains_char`, and
  `strings.ContainsFunc(text, stringutil.IsLineBreak)` walks the runes of the text with `utf8::range`. `len(",")`,
  `len("<")`, `len(">")` and `len(";")` are the private `text_len`.
- The three comments of upstream that ask a question or name work to do (784, 873, 2006) are not carried over.

### Verified

No compiler has seen the file, and nothing ran a function of it. What was checked, by scripts that read the file
beside `grammarchecks.go` and beside the tree:

- `rustfmt --check --edition 2024`: exit 0.
- The 76 functions have upstream's names, in upstream's order.
- The 273 places that name a diagnostic message name the same messages as upstream, in the same order, with the same
  string arguments; the 187 constants are in the generated table. Two calls give one argument to a message without
  a placeholder, as upstream does (1121, 1384).
- The `ast.Kind*` names (232 upstream) and the names of `ModifierFlags`, `NodeFlags`, `TokenFlags` and
  `FunctionFlags` (126) come in upstream's order, one fewer each where a value is read once
  (`KindShorthandPropertyAssignment` of 1078, `NodeFlagsAwaitContext` of 1233), `NodeFlagsReparsed` aside.
- Every imported name is defined by the module it is imported from and is used. No two comment lines are adjacent.
  No `unwrap`, `expect`, `panic`, `unsafe` or index into a slice.
- The signatures of the callees were read where the tree has them: `error`, `add_diagnostic`,
  `add_error_or_suggestion`, `has_parse_diagnostics` (`c21`), `create_diagnostic_for_node`,
  `get_symbol_of_declaration` (`c22`), `check_expression_cached`, `get_symbol_for_private_identifier_expression`
  (`c14`), `new_diagnostic_for_node` and seven free functions of `utilities.rs`, `get_combined_node_flags_cached`,
  `is_var_const_like`, `get_effective_property_name_for_property_name_node` (`c31`), `is_valid_index_key_type`,
  `get_accessor_this_parameter`, `is_late_bindable_name` (`c33`), `get_type_from_type_node` (`c38`),
  `is_generic_type` (`c40`), `some_type`, `every_type` (`c43`), `is_rest_parameter` (`c45`),
  `get_verbatim_module_syntax_error_message` (`c10`), `visibility_to_string` (`relater.rs`), and the calls that
  `c05` to `c11`, `c13`, `c14`, `c17` and `jsx.rs` make into the file.

### What this file expects and the tree does not have

- `is_in_parameter_initializer_before_containing_function(node) -> bool` (checker.go 12326, the range of `c18`),
  called as a method at 1750 and 1765.

## Checker: expressions (`checker/c14_expressions.rs`)

Commits `29243aaf5a`, `639fb21984` and `f65d481d68` (written by the job that commits the worktree). The 45 functions
of `checker.go` 7419-8405 (layers E-CORE, E-ACCESS and E-LITERAL, and `checkImportCallExpression` of E-CALL), in
upstream order. PORT_STATUS.md has the row.

NOT compiled by cargo: `checker/mod.rs` still names modules without a file. "Verified" below says what was checked
instead.

### How a caller writes the calls

- `check_expression(node)`, `check_expression_ex(node, check_mode)`, `check_expression_cached(node)`,
  `check_expression_cached_ex(node, check_mode)`, `get_type_of_expression(node)`,
  `get_context_free_type_of_expression(node)` and `check_expression_worker(node, check_mode)` answer a `TypeId`.
  `get_quick_type_of_expression(node)`, `get_return_type_of_single_non_generic_signature(func_type, kind)` and
  `get_return_type_of_single_non_generic_signature_of_call_chain(expr)` answer `TypeId::NIL` for upstream's nil.
- `check_expression_with_contextual_type(node, contextual_type, inference_context: InferenceContextId, check_mode)`:
  `InferenceContextId::NIL` is upstream's nil context.
- `check_non_null_type_with_reporter(t, node, report_error)`: the reporter is
  `impl FnOnce(&mut Checker<'a>, NodeId, TypeFacts)`. A method is passed where upstream passes a method expression:
  `Self::report_object_possibly_null_or_undefined_error` here, and checker.go 8601 (the range of `c15`) passes
  `(*Checker).reportCannotInvokePossiblyNullOrUndefinedError`.
- `get_unique_type_parameters(context: InferenceContextId, type_parameters: List<'_, TypeId>) -> List<'a, TypeId>`
  (never nil) and `get_outer_inference_type_parameters() -> List<'a, TypeId>` (nil when nothing was appended).
- Free functions, `pub` at column 0 (`mod.rs` has the glob): `has_type_parameter_by_name(c, &[TypeId], name: &[u8])`,
  `get_unique_type_parameter_name(c, &[TypeId], base_name: &[u8]) -> Vec<u8>`, `is_spread_into_call_or_new(a, node)`.
- These only read and take `&self`: `get_context_node`, `get_outer_inference_type_parameters`,
  `is_in_constructor_argument_initializer`, `is_template_literal_context`. Every other method takes `&mut self`.
- `get_constituent_property(object_type, property_name: &[u8])`, `get_symbol_for_private_identifier_expression(node)`
  and `get_for_in_variable_symbol(node)` answer a `SymbolId`, nil for none.

### Differences from upstream

- Stack tests, each the first statement of its function, at the five entries of
  `checker-expressions-calls-flow/top-down/data/tested_entries.tsv` that are in this range: `get_type_of_expression`
  (the error type, `flow_type_cache` is not written), `check_expression_cached_ex` (the error type, the link is not
  written), `check_expression_ex` (the error type, `current_node` is not touched), `get_quick_type_of_expression` (the
  error type) and `is_template_literal_context` (false).
- The tracer call of `checkExpressionEx` (7648-7650) is not ported.
- Panics, asserts and nil dereferences are faults with a fallback: 7922 (`JsxOpeningElement`: the error type); the
  assert of 7680 records and goes on; a const enum symbol without a value declaration (7681-7683, where upstream reads
  the file and the flags of nil) is a fault and the function returns, as `c13` does for the same read; a project
  reference without `Resolved` (7683) is a fault and counts as not preserving const enums, so TS2748 is reported as
  for no redirect; `evaluated.(string)` of 8085 for another kind of value is a bad cast and the empty text; the panic
  of `jsnum.ParsePseudoBigInt` (7843) is a fault and the error type. A nil inference context (`context.signature`
  of 7719) reads the zero record through the store, which counts the nil read.
- `checkExpressionCachedEx` saves `flowLoopStack` and `flowTypeCache` with `std::mem::take`, which leaves the nil
  value in the field, and puts both back in upstream's order.
- `intraExpressionInferenceSites` is a `Vec`: nil and empty are one value, and `= nil` is a new empty `Vec`.
- `checkArrayLiteral`: `elementTypes` and `elementInfos` are filled by `push` in the arms where upstream writes
  `[i]`; each arm writes both exactly once. The closure of `someType` for the tuple context is written with early
  returns in the order of upstream's `||` and `&&`.
- `checkSuperExpression`: `isLegalUsageOfSuperExpression` is a closure over `a`, the flag and the container, as
  upstream. The local `is_call_expression` hides the function of `ast` of the same name after its own line, as
  upstream's local does.
- `instantiateTypeWithSingleGenericCallSignature`: `core.Map(context.inferences, ...)` is the nil list for nil, else
  a live list of new inference infos; `core.Every` and `core.Some` over a live list are `iter().all` and
  `iter().any`.
- `hasTypeParameterByName` and `getUniqueTypeParameterName` take the checker, since a type is an id. The loop of
  `getUniqueTypeParameterName` has no budget: it ends after at most one more step than there are type parameters.
- `getOuterInferenceTypeParameters` has no caller upstream either. It is `pub`.
- The comment of 7754 is carried over without its first word.

### Verified

No compiler has seen the file, and nothing ran a function of it. What was checked:

- `rustfmt --check --edition 2024`: exit 0 (the file parses and is formatted).
- Scripts over the file: the 45 functions have upstream's names in upstream's order; each of the 120 imported names
  is used and no free name is used without an import; no two comment lines are adjacent; no `unwrap`, `expect`,
  `panic`, `unsafe` or index into a slice; the 25 diagnostic messages exist by name in
  `diagnostics/diagnostics_generated.rs`.
- Read against the definitions of the tree at `f1f0123b19`, name, parameter order and result: the callees that the
  tree defines (`c12`, `c21`, `c22`, `c24`, `c28`, `c31`, `c33`, `c34`, `c38`, `c40`, `c41`, `c42`, `c43`, `c44`,
  `c45`, `c47`, `c51`, `jsx.rs`, `mapper.rs`, `printer.rs`, `relater.rs`, `utilities.rs`, `grammarchecks.rs`, the
  accessors of `ast/`, `core/core.rs`, `jsnum/`), and the fields, records, casts, flags and helpers of the data model
  (`c01_data.rs`, `c02_program_checker.rs`, `types.rs`, `links.rs`, `core/linkstore.rs`). `Map`, `LiveList` and
  `Text` are used as the contract has them (`checker-data-model-contract/bottom-up/crate/src/tscore/golang.rs`).
- The calls that other files of the tree make into these functions (88 sites of 21 files by the look-ahead, and
  `grammarchecks.rs` 218, 3091 and 3103) match the signatures by name and number of arguments.
- Not checked: types and borrows (no compiler), clippy, and any result against upstream's baselines.

### What this file expects and the tree does not have

At `f1f0123b19`, 61 callees, called by their upstream names with upstream's parameter order:

- `c03`: `resolve_name(location, name, meaning, message, is_use, exclude_globals)`, `evaluate(expr, location)` with
  `.value` a `LiteralValue`, `get_global_import_call_options_type_checked()`.
- `c15`: `check_call_expression(node, check_mode)`, `check_tagged_template_expression(node)`,
  `is_symbol_or_symbol_for_call(node)`, `skipped_generic_function(node, check_mode)`.
- `c16`: `check_parenthesized_expression(node, check_mode)`, `check_class_expression(node)`,
  `check_function_expression_or_object_literal_method(node, check_mode)`.
- `c17`: `check_type_of_expression`, `check_non_null_assertion`, `check_expression_with_type_arguments`,
  `check_satisfies_expression`, `check_meta_property`, `check_delete_expression`, `check_void_expression`,
  `check_prefix_unary_expression`, `check_postfix_unary_expression`, `check_yield_expression` and
  `check_synthetic_expression`, each `(node)`; `check_conditional_expression(node, check_mode)`,
  `check_spread_expression(node, check_mode)`.
- `c18`: `check_identifier(node, check_mode)`, `check_this_expression(node)`,
  `check_property_access_expression(node, check_mode, write_only)`,
  `check_property_access_expression_or_qualified_name(node, left, left_type, right, check_mode, write_only)`,
  `get_flow_type_of_access_expression(node, prop, prop_type, error_node, check_mode)`,
  `is_method_access_for_call(node)`, `lookup_symbol_for_private_identifier_declaration(name, location)`,
  `check_this_before_super(node, container, message)`, `class_declaration_extends_null(class_decl)`.
- `c19`: `check_assertion(node, check_mode)`, `check_binary_expression(node, check_mode)`.
- `c20`: `check_object_literal(node, check_mode)`, `is_const_context(node)`,
  `check_expression_for_mutable_location(node, check_mode)`.
- `c34`: `create_promise_return_type(node, promised_type)`. `c45`: `mark_property_as_referenced(prop, node, false)`.
- `c47`: `get_mapped_type_modifiers(c, t)` (a free function), `get_optional_expression_type(expr_type, expression)`.
- `c48`: `get_contextual_type(node, context_flags)`.
- `c50`: `get_apparent_type_of_contextual_type(node, context_flags)`,
  `instantiate_contextual_type(contextual_type, node, context_flags)`, `push_contextual_type(node, t, is_cache)`,
  `pop_contextual_type()`, `push_cached_contextual_type(node)`, `push_inference_context(node, context)`,
  `pop_inference_context()`, `get_inference_context(node) -> InferenceContextId`, `is_context_sensitive(node)`.
- `c51`: `get_type_facts(t, mask) -> TypeFacts`.
- `inference.rs`, as the contract has them: `infer_types(inferences: LiveList, source, target, priority,
  contravariant)`, `apply_to_parameter_types(source, target, &mut dyn FnMut(&mut Checker, TypeId, TypeId))`,
  `apply_to_return_types` (the same shape), `merge_inferences(target, source)`,
  `add_intra_expression_inference_site(context, node, t)`, `is_skip_direct_inference_node(node)`, and the free
  functions `new_inference_info(c, type_parameter)`, `has_inference_candidates(c, info)`,
  `has_overlapping_inferences(c, a, b)`.

## Checker: utilities (`checker/utilities.rs`)

Commit `6349fc8157` (written by the job that commits the worktree). `checker/utilities.go` whole (layer UTIL): its
150 functions in upstream order, the types it declares (`AssignmentKind`, `AssignmentTarget`, `orderedSet`,
`FeatureMapEntry`, `DiagnosticDetails`) and the feature map. PORT_STATUS.md has the row.

NOT compiled by cargo: `checker/mod.rs` still names modules without a file. "Verified" below says what was checked
instead.

### How a caller writes the calls

- A function that reads the tree takes the tree context first and then upstream's parameters in upstream's order:
  `has_dot_dot_dot_token(a, node)`, `get_assignment_target_kind(a, node) -> AssignmentKind`,
  `get_super_container(a, node, stop_on_functions)`, `get_selected_modifier_flags(a, node, flags)`,
  `range_of_type_parameters(a, source_file, type_parameters: NodeListId) -> TextRange`. A symbol is read through the
  same context: `is_known_symbol(a, symbol)`, `is_private_identifier_symbol(a, symbol)`,
  `get_declaration_modifier_flags_from_symbol(a, s)` and `get_declaration_modifier_flags_from_symbol_ex(a, s,
  is_write)`, `has_export_assignment_symbol(a, module_symbol)`, `all_declarations_in_same_source_file(a, symbol)`,
  `is_external_module_symbol(a, module_symbol)`.
- A function that reads a type takes the checker as `&Checker<'_>`, so the `self` of a `&mut self` method fits:
  `is_type_any(c, t)`, `is_object_literal_type(c, t)`, `is_object_or_array_literal_type(c, t)`,
  `is_this_type_parameter(c, t)`, `is_type_usable_as_property_name(c, t)`, `get_property_name_from_type(c, t)`,
  `contains_non_missing_undefined_type(c, t)`, `get_non_rest_parameter_count(c, sig)`. The order of types is
  `compare_types(c, t1, t2) -> isize`, with `compare_type_lists(c, &[TypeId], &[TypeId])`,
  `compare_type_mappers(c, m1, m2)`, `compare_type_names(c, t1, t2)`, `get_sort_order_flags(c, t)`,
  `get_type_name_symbol(c, t)`, `get_object_type_name(c, t)` and `compare_tuple_types(c, t1, t2)`, whose two types
  are the tuple targets that hold the `TupleType` data; `compare_element_labels(a, n1, n2)` reads two nodes.
- A function of a name or of a token takes it alone: `is_late_bound_name(name)`, `is_reserved_member_name(name)`,
  `is_numeric_literal_name(name)`, `is_infinity_or_nan_string(name)`, `is_valid_number_string(s, round_trip_only)`,
  `is_valid_big_int_string(s, round_trip_only)`, the 16 operator classes (`is_binary_operator(kind)`),
  `token_is_identifier_or_keyword(token)`.
- Methods of the checker, as upstream has them. `&mut self`: `is_optional_parameter(node)`,
  `is_constant_variable(symbol)`, `get_packages_map()`, `types_package_exists(name)`, `package_bundles_types(name)`,
  `is_js_literal_type(t)`. `&self`: `sort_symbols(&mut [SymbolId])`, `compare_symbols_worker(s1, s2) -> isize`,
  `compare_nodes(n1, n2) -> isize`, `is_parameter_or_mutable_local_variable(symbol)`,
  `is_mutable_local_variable_declaration(declaration)`, `call_like_expression_may_have_type_arguments(node)`,
  `is_canceled()`, `check_not_canceled()`, `is_unchecked_js_suggestion(node, suggestion, exclude_classes)`.
- `NewDiagnosticForNode` and `NewDiagnosticChainForNode` are methods too, because a diagnostic is made in the store of
  the checker: `new_diagnostic_for_node(node, message, args: &[Arg<'_>]) -> DiagnosticId` and
  `new_diagnostic_chain_for_node(chain: DiagnosticId, node, message, args)`.
- A text result is a new text, `Vec<u8>`: `entity_name_to_string(a, name)`, `get_property_name_from_type(c, t)`,
  `try_get_property_access_or_identifier_to_string(a, expr)` (empty for upstream's `""`),
  `value_to_string(&LiteralValue)`, `pseudo_big_int_to_string(value)`. The last takes the value or a reference to it.
- Lists: `get_members_of_declaration(a, node) -> List<'a, NodeId>` (the list of the node, nil for another kind),
  `get_declarations_of_kind(a, symbol, kind) -> Vec<NodeId>`, `symbols_to_array(a, table) -> Vec<SymbolId>`,
  `create_symbol_table(a, &[SymbolId]) -> SymbolTableId` (nil for no symbol),
  `get_index_symbol_from_symbol_table(a, table) -> SymbolId`.
- A callback is `impl FnMut`, so a closure and a `&mut` closure both fit: `find_in_map(a, table, |symbol| ..)` (the
  one map that upstream searches this way is a symbol table), `for_each_yield_expression(a, body, |expr| ..) -> bool`,
  `min_and_max(slice: &[T], |value| ..) -> (isize, isize)`.
- `AssignmentKind::{NONE, DEFINITE, COMPOUND}`, and `AssignmentTarget` is `NodeId`.
- `get_feature_map().get(name) -> Option<&'static [FeatureMapEntry]>` is `getFeatureMap()[name]` with its ok. An
  entry has `lib: &'static [u8]` and `props: &'static [&'static [u8]]`.
- `create_module_not_found_chain(program, file, module_reference, mode, package_name)` and
  `create_mode_mismatch_details(a, program, file)` answer `DiagnosticDetails { message, args: Vec<Vec<u8>> }`.
- `OrderedSet<T>` is upstream's `orderedSet`: the fields `values` and `values_by_key`, the methods `contains(value)`
  and `add(value)`, and `OrderedSet::default()` for the zero value. It is `crate::checker::OrderedSet`;
  `crate::collections::OrderedSet` is the type of `internal/collections`, and a file names the one it imports.
- `skip_alias(symbol, checker)` keeps upstream's parameter order.

### Differences from upstream

- `sort_symbols` runs Go's `slices.SortFunc`: the pattern-defeating quicksort of `slices/zsortanyfunc.go`, statement
  for statement, in the private module `slices` at the end of the file. A symbol gets its id at the first call of
  `ast.GetSymbolId`, and the last resort of `compare_symbols_worker` asks for the id of its first argument first, so
  the sequence of the comparisons decides the order of two symbols without declaration that have one name. The
  module is the text of `importer/javascript/tree.rs` 537-873 (`mod tree` is private to the importer), with
  `pub(super)` on `sort_func`.
- `compare_types`: the test of 425-427 for types of two checkers has no counterpart, because a type id belongs to
  one checker.
- Stack tests. `compare_types`, as its first statement: the fault is recorded and the answer is the order of the type
  ids, which is upstream's last resort. `compare_type_mappers` (0) and `is_js_literal_type` (false). Three walks of
  the tree test through the context, as `ast/utilities.rs` does: `get_alias_declaration_from_name` (the nil node),
  `for_each_yield_expression` (false for the subtree), `try_get_property_access_or_identifier_to_string` (the empty
  text).
- Panics are faults with a fallback where the function has a sink: 107 (`a.unhandled` with the kind, `NONE`), 895
  (`c.fail`, the empty text), 1665 (`c.fail`). The type assertions of 516, 521, 525 and 889-891 are the three value
  functions of `c42_literal_types.rs` (`get_string_literal_value` and its two neighbours), which record a value of
  another kind. Two places have no sink, because the function gets neither the tree context nor the checker: 1707
  (`value_to_string` of the nil value answers the empty text) and the panic of `jsnum.ParsePseudoBigInt` inside 958
  (`is_valid_big_int_string` then answers false for the round trip). `debug.Assert` of 314 is `assert`.
- `is_canceled` answers false: the checker has no `ctx` (`c02_program_checker.rs`: "a check is not canceled").
- `cmp.Compare` of two numbers and `slices.Compare` of two lists of strings are the private `compare_numbers` and
  `compare_texts`. The targets of an array mapper are read into a vector for `compare_type_lists`: a mapper can hold
  a list that is still written (`Targets::Live`).
- `findInMap` and `symbolsToArray` visit a symbol table in insertion order, where the order of a Go map is random.
- `getPackagesMap` fills the map through `Program::for_each_resolved_module`, and `CreateModuleNotFoundChain` asks
  `Program::get_packages_map_entry` twice where upstream reads the map of the program once.
- `is_jsdoc_optional_parameter(_node)` answers false, which is upstream's whole body (292).
- The feature map is a constant table in upstream's order of writing, and `FeatureMap::get` walks it; upstream builds
  a Go map once.
- `is_optional_parameter` reads `get_effective_call_arguments(iife).as_slice().len()`, which fits a `Vec` and a
  `List`.
- The two comments of upstream that name work to do (292, 304) are not carried over.

### Verified

No compiler has seen the file, and nothing ran a function of it. What was checked:

- `rustfmt --check --edition 2024`: exit 0 (the file parses and is formatted; the table of the feature map is under
  `#[rustfmt::skip]`, one entry a line as upstream writes it).
- `python3 round2-layer7-checker/utilities-check.py`, which reads the file beside `utilities.go` and beside the tree
  (exit 0 on the tree of `bb8a0745fd`, where the file is the one of `6349fc8157`): the 150 functions have
  upstream's names in upstream's order; each of the 166 imported names is used and no free function is called
  without an import; no two comment lines are adjacent; no `unwrap`, `expect`, `panic`, `todo`, `unimplemented`,
  `unreachable` or `unsafe`; the 423 strings of the feature map are those of `utilities.go` 1294-1552 in order (the
  table was written by a script from that text); the 359 calls that `checker/`, `evaluator/` and `modulespecifiers/`
  make into the `pub` functions of the file have their number of arguments; 711 calls that the file makes have the
  number of arguments of a definition of the tree.
- The 63 names that the look-ahead of round 8 lists as imported from `crate::checker` are `pub` items at column 0,
  and the 6 methods it lists as called are methods of the checker. `round2-layer7-checker/globs.py --names` prints
  none of them under G, and no name of the file under C (a `pub` name of two globbed modules).
- Read at their definitions, name, parameter order and result: the accessors and predicates of `ast/` that the file
  calls (`reader.rs`, `node_methods.rs`, `symbol.rs`, `utilities.rs`, the generated casts), `DiagnosticStore`,
  `get_error_range_for_node`, `get_text_of_node`, `skip_trivia`, `is_intrinsic_jsx_name` and the `Scanner`,
  `get_container_flags`, `escape_string`, the functions of `jsnum/`, `module/util.rs`, `tspath/`, `core/core.rs` and
  `stringutil`, and of `checker/`: the fields of `Checker`, `Records`, the casts and the type records (`types.rs`),
  `TypeMapper` and `Targets` (`mapper.rs`), `Program` (`c02`), `get_signature_from_declaration` (`c33`),
  `get_min_argument_count_ex` (`relater.rs`), `get_declaration_node_flags_from_symbol` (`c31`),
  `get_resolved_base_constraint` (`c45`), `signature_has_rest_parameter` (`c28`), the value functions of `c42`.
- The places where the consumers use a result were read for its type: the nine of `get_property_name_from_type`,
  `get_declarations_of_kind` (`.is_empty()` and `.as_slice()`), `get_members_of_declaration` (`.as_slice()`),
  `compare_types` as the comparer of `binary_search_func`, `sort_stable_func` and the spelling suggestion (`isize`),
  `details.message` and `details.args.iter()` of `c24`.
- Not checked: types and borrows (no compiler), clippy, and any result against upstream's code. The module `slices`
  has no test here; its text is tested in the importer (`sort_func_leaves_the_order_of_go`).

### What this file expects and the tree does not have

At `bb8a0745fd`:

- Two methods of the checker, called by their upstream names: `get_aliased_symbol(symbol) -> SymbolId` (32294, the
  range of `c52`, which has no file) and `get_effective_call_arguments(node)` (30165, the range of `c49`, whose file
  does not have it). The third that the file of `6349fc8157` waited for is there: `compare_symbols(s1, s2) -> isize`
  on `&self` (the closure field of checker.go 918) is `c03_init.rs` 372 and calls `compare_symbols_worker`.
- `crate::core::Map` as the contract has it (`make`, `is_nil`, `get`, `get_ok`, `set` with its `bool`), and
  covariant in its key: `types_package_exists` looks a local text up in the `Map<Text<'a>, bool>` of the checker, as
  `c33` 282 does in `string_literal_types`.

What waits in other files: `c43_unions_intersections.rs` keeps the type set of an intersection in a `Vec<TypeId>`
where checker.go 26180 has an `orderedSet`.

## Checker: keyof, indexed access and substitution types (`checker/c44_index_indexed_access.rs`)

Commits `6fdbea41c8`, `29243aaf5a`, `51919074d5`, `badc91ca23` and `f1f0123b19`, all written by the job that commits
the worktree. The file holds checker.go 26803-27549 whole and in upstream order: the 38 functions of the layers K-KEYOF
(`getIndexType` to `checkComputedPropertyName`, `shouldDeferIndexType` to `getIndexTypeForMappedType`), K-INDEXED
(`getIndexedAccessType` to `indexTypeLessThan`) and K-SUBST (`isNoInferType`, `getSubstitutionIntersection`,
`getNoInferType` to `getOrCreateSubstitutionType`). No function is a stand-in. PORT_STATUS.md has the row.

NOT compiled by cargo: it does not reach the file while a module of `checker/mod.rs` has no file. "Verified" below says
what was checked instead.

### How a caller writes the calls

- Methods of `Checker<'a>` with `&mut self` and upstream's parameter order. A nil type, node, symbol or alias is
  `TypeId::NIL`, `NodeId::NIL`, `SymbolId::NIL`, `TypeAliasId::NIL`.
  - keyof: `get_index_type(t)`, `get_index_type_ex(t, IndexFlags)`, `get_index_type_for_generic_type(t, IndexFlags)`,
    `get_index_type_for_mapped_type(t, IndexFlags)`, `should_defer_index_type(t, IndexFlags) -> bool`,
    `get_mapped_type_name_type_kind(t) -> MappedTypeNameTypeKind` (`NONE`, `FILTERING`, `REMAPPING`),
    `get_extract_string_type(t)`.
  - Names as types: `get_literal_type_from_properties(t, include: TypeFlags, include_origin: bool)`,
    `get_literal_type_from_property(prop, include, include_non_public)`,
    `get_literal_type_from_property_name(name: NodeId)`, `check_computed_property_name(node)`.
  - Indexed access: `get_indexed_access_type(object_type, index_type)`,
    `get_indexed_access_type_ex(object_type, index_type, AccessFlags, access_node, alias)`,
    `get_indexed_access_type_or_undefined(...)` with the same five parameters and the nil type for upstream's nil,
    `get_property_type_for_index_type(original_object_type, object_type, index_type, full_index_type, access_node,
    access_flags)`, `should_defer_indexed_access_type(object_type, index_type, access_node)`,
    `error_if_writing_to_readonly_index(index_info: IndexInfoId, object_type, access_expression)`.
  - Access checks: `is_self_type_access(name, parent: SymbolId)`,
    `is_assignment_to_readonly_entity(expr, symbol, assignment_kind: AssignmentKind)`,
    `is_this_property_access_in_constructor(node, prop)`, `type_has_static_property(prop_name: &[u8], containing_type)`.
  - Substitution: `get_substitution_type(base_type, constraint)`, `get_or_create_substitution_type(base_type,
    constraint)`, `get_substitution_intersection(t)`, `get_no_infer_type(t)`, `is_no_infer_target_type(t)`.
- These only read and take `&self`: `is_no_infer_type(t)`, `is_key_type_included(key_type, include)`,
  `is_auto_typed_property(symbol)`, `get_declaring_constructor(symbol) -> NodeId`,
  `get_property_name_from_index(index_type, access_node)`,
  `get_suggested_type_for_nonexistent_string_literal_type(source, target) -> TypeId` (nil for no suggestion).
- A `string` result is a new `Vec<u8>`: `get_property_name_from_index` (`ast::INTERNAL_SYMBOL_NAME_MISSING` for no
  name: `name != INTERNAL_SYMBOL_NAME_MISSING` and `&name` both work on the result),
  `get_suggestion_for_nonexistent_property(name: &[u8], containing_type)` and
  `get_suggestion_for_nonexistent_index_signature(object_type, expr, keyed_type)` (empty for no suggestion).
- Free functions, re-exported as `crate::checker`: `is_invalid_computed_property_name(a, node)`,
  `get_index_node_for_access_expression(a, access_node) -> NodeId`, `index_type_less_than(c, index_type, limit: isize)`.
- The field `isStringIndexSignatureOnlyType` (the method value of checker.go:1260) is the method
  `is_string_index_signature_only_type`, which calls `is_string_index_signature_only_type_worker`. Both are in this
  file, as `could_contain_type_variables` is in `c37` and `mark_node_assignments` in `flow.rs`; `c03_init.rs` does not
  define it.

### Differences from upstream

- Stack tests at the entries of `checker-type-layers-topdown/data/recursion.txt` that are in this range. The entry
  records `StackLimit` and returns the error type (`get_index_type_ex`, `get_indexed_access_type_or_undefined`) or
  false (`is_string_index_signature_only_type_worker`, `is_no_infer_target_type`, and `is_key_type_included` before
  it descends into an intersection).
- Closures take the checker: `addMemberForKeyType` of `getIndexTypeForMappedType` is one local closure
  `|c: &mut Checker<'a>, key_type|` that owns the borrow of the key list and is handed on as `&mut dyn FnMut` three
  times; `hasProp` of `getSuggestionForNonexistentIndexSignature` is a local closure `|c, name| -> bool`.
- `core.Map` over constituents or properties is a loop into a local vector that is passed as `List::from_slice`
  (26815, 26817, 27262): the callee copies what it keeps.
- `get_property_type_for_index_type`: the cases of 27295 and 27297 (string literal, number literal) have one body
  and are one branch. `!(accessNode != nil && IsPrivateIdentifier(accessNode))` of 27131 is written
  `access_node.is_nil() || !is_private_identifier(a, access_node)`, and the enum test of 27240-27245 is a named
  boolean that is computed only when `IncludeUndefined` is set. Both keep upstream's order of evaluation.
- A literal value as a message argument (`indexType.AsLiteralType().value`, which `StringifyArgs` prints with `%v`)
  is `evaluator::any_to_string` of the value: the text of a string, `Number.String()` of a number.
- `index < 0` and `index >= 0` of a `jsnum.Number` compare its `f64`; `jsnum.Number(limit)` is `limit as f64`.
- `should_defer_indexed_access_type` reads `getTotalFixedElementCount(objectType.TargetTupleType())` inside a block
  of the `&&` chain: only for a tuple, as upstream's short circuit does, and before `index_type_less_than` borrows
  the checker.
- `get_suggested_type_for_nonexistent_string_literal_type`: `core.FilterSeq` is a lazy iterator, so the limit of
  1000 counts the string literal constituents as upstream counts them.
- `symbol.Parent.ValueDeclaration` of 27429-27430 reads the zero symbol through a nil parent, where upstream
  dereferences nil. The range has no panic and no assert.

### Verified

No compiler has seen the file, and nothing ran a function of it. What was checked:

- `rustfmt --check --edition 2024`: exit 0 (the file parses and is formatted).
- `python3 round2-layer7-checker/ranges.py c44_index_indexed_access`: 38 of 38 functions of the range have a `fn` of
  their name in the file. `round2-layer7-checker/globs.py`: the module exports `pub` names (its glob in `mod.rs` is
  not empty) and none of them is a name of another globbed module. No other file of `src/typecheck/` defines a `fn`
  with one of the 39 names.
- A script over the tree of `a2dd5ba96a` (argument counts and receiver kind only, not types): 359 calls that the
  file makes match a definition of the tree, and the 87 calls that other files make into the 39 functions match
  their parameter counts (`relater.rs`, `jsx.rs`, `c14`, `c31`, `c33`, `c37`, `c38`, `c40`, `c45` and the others
  of the look-ahead).
- Read at their definitions, name, parameter order, receiver and result: the accessors and predicates of `ast/`
  (`reader.rs`, `node_methods.rs`, `symbol.rs`, `utilities.rs`, the generated casts), `get_text_of_node`,
  `jsnum::from_string`, `core::get_spelling_suggestion_with_max_candidate_count`, `core::or_else`,
  `evaluator::any_to_string`, the fields of `Checker`, `Records`, `LinkStore`, the casts and records of `types.rs`,
  the keys of `c01_data.rs`, and the callees in `c03`, `c14`, `c20` to `c22`, `c25`, `c27`, `c28`, `c31`, `c33`,
  `c36` to `c38`, `c40` to `c43`, `c45`, `flow.rs`, `mapper.rs`, `printer.rs`, `relater.rs` and `utilities.rs`.
  The modules that came in during the step were read again when they landed: `c41` (the three constructors), `c21`
  (`add_deprecated_suggestion` takes `&[u8]`), `c14`, `utilities.rs` (`compare_types` takes `&Checker`, so the
  spelling suggestion needs no copy of the candidates; `get_property_name_from_type` returns `Vec<u8>`), `c37` (the
  mapped type accessors and the callback of `for_each_mapped_type_property_key_type_and_index_signature_key_type`)
  and `c03` (`get_global_extract_symbol`, `contains_missing_type`).
- The 16 diagnostic messages exist by name in `diagnostics_generated.rs`, and each call gives as many arguments as
  the message has placeholders. No two comment lines are adjacent; no `unwrap`, `expect`, `panic`, `todo`,
  `unimplemented`, `unreachable`, `unsafe` or slice index.
- Not checked: types and borrows (no compiler), clippy, and any result against upstream's code.

### What this file expects and the tree does not have

At `a2dd5ba96a`, each called by its upstream name:

- `c30_type_keys.rs` (no file): `get_type_list_key(types: List<'_, TypeId>) -> CacheHashKey` and
  `get_indexed_access_key(c, object_type, index_type, access_flags, alias) -> CacheHashKey` (17690), the checker
  first as the callers of `get_alias_key` and `get_union_key` pass it.
- `c50` (no file): `get_type_of_property_of_contextual_type(t, name: &[u8]) -> TypeId`. The file passes the local
  `Vec<u8>` of the property name: a parameter of type `Text<'a>` does not accept it.
- `c18` (no file): `get_control_flow_container(node) -> NodeId` (11528) and
  `is_uncalled_function_reference(node, symbol) -> bool` (11784).
- `c45`: `mark_property_as_referenced(prop, node_for_check_write_only, is_self_type_access)` (27829) and
  `get_modifiers_type_from_mapped_type(t) -> TypeId` (28250). `c35`: `get_lower_bound_of_key_type(t) -> TypeId`
  (21135). `c04`: `get_spelling_suggestion_for_name(name: &[u8], symbols: &[SymbolId], meaning) -> SymbolId` (1806).
- `crate::core::Map` as the contract has it (`get`, `get_ok`, `set` with its `bool`).

## Checker: initialisation and globals (`checker/c03_init.rs`)

Commits `aae9f74be7`, `bb8a0745fd` and `0f2dab7801` (written by the job that commits the worktree). The functions of
`checker.go` 908-1503 (layer C-INIT), in upstream order, and the closure fields of upstream's Checker that `NewChecker`
and `initializeClosures` assign, as the methods that the other files call. PORT_STATUS.md has the row.

NOT compiled by cargo: at `0f2dab7801` the crate does not compile (see "What this file expects" below). "Verified"
says what was compiled instead.

### How a caller writes the calls

- `new_checker(ast: Ast<'a>, lists: &'a CheckerArena<'a>, program: &'a dyn Program<'a>) -> Checker<'a>` is
  `NewChecker`. The caller makes the tree context and the arena of the lists, as for `Checker::zero`; the options are
  `program.options()`. The files are bound BEFORE the context is made: a `Frozen` holds the bind results that exist
  when it is made, so the `program.bind_source_files()` of the first line binds nothing new.
- `resolve_name(location, name: &[u8], meaning, name_not_found_message: MessageId, is_use, exclude_globals) ->
  SymbolId`, and `resolve_name_for_symbol_suggestion` with the same parameters. The nil message is `MessageId::NIL`.
- `get_global_symbol(name: &[u8], meaning, diagnostic: MessageId) -> SymbolId`,
  `get_global_type(name: &[u8], arity: isize, report_errors) -> TypeId`,
  `get_global_type_alias_symbol(name, arity, report_errors) -> SymbolId`, and
  `get_type_alias_type_parameters(symbol) -> List<'a, TypeId>` (`GetTypeAliasTypeParameters` has no lower case twin).
- The 50 memoized getters of checker.go 1068-1117 are methods without a parameter, on `&mut self`, with the names of
  their fields of the Checker (`get_global_es_symbol_type()`, `get_global_awaited_symbol_or_nil()`, ...).
  `getGlobalNaNSymbolOrNil` is `get_global_nan_symbol_or_nil`, as the field of `c02_program_checker.rs` is.
- `evaluate(expr, location) -> evaluator::Result<'a>`.
- `compare_symbols(s1, s2) -> isize` and `compare_symbol_chains(&[SymbolId], &[SymbolId]) -> isize` take `&self`: sort
  callbacks and `compare_types` call them through `&Checker`. `contains_missing_type(t)` takes `&self` too.
  `is_primitive_or_object_or_empty_type(t)` takes `&mut self` (`is_empty_anonymous_object_type` does).
- `report_unreliable_worker(t)`, `report_unmeasurable_worker(t)`, `initialize_checker()`, `merge_global_symbol(symbol)`,
  `merge_module_augmentation(module_name)`, `add_undefined_to_globals_or_error_on_redeclaration()`: `&mut self`.
- `create_name_resolver()` and `create_name_resolver_for_suggestion()` take `&self` and give a
  `NameResolver<'a, Checker<'a>>` whose hooks are the methods of the checker as function pointers.
- The five resolvers take the place of the memoized answer first: `get_global_type_resolver(memo, name, arity,
  report_errors) -> TypeId`, `get_global_type_alias_resolver(memo, name, arity, report_errors) -> SymbolId`,
  `get_global_value_symbol_resolver(memo, name, report_errors)` and `get_global_type_symbol_resolver(memo, name,
  report_errors) -> SymbolId`, `get_global_types_resolver(memo, names: &[&[u8]], arity, report_errors) ->
  List<'a, TypeId>`. `memo` is a `MemoField<'a, T>`, which is `for<'r> fn(&'r mut Checker<'a>) -> &'r mut Memo<T>`: a
  getter passes `|c| &mut c.<the field of its name>`.
- Free functions, `pub` at column 0 (`mod.rs` has the glob): `create_file_index_map(files: List<'_, NodeId>) ->
  Map<NodeId, isize>`, `count_global_symbols(a, files) -> isize`, `get_global_type_declaration(a, symbol) -> NodeId`.

### Differences from upstream

- Two of the 23 functions have no function of their name, because what they assign is no field here.
  `initializeClosures`: its two closures are the methods `is_primitive_or_object_or_empty_type` and
  `contains_missing_type`, at the place of the function; `couldContainTypeVariables`, `isStringIndexSignatureOnlyType`
  and `markNodeAssignments` are the methods beside their workers (`c37`, `c44`, `flow.rs`), and
  `compareTypesAssignable` is `TypeComparer::Assignable`. `initializeIterationResolvers`: the two resolvers are the
  two values of `IterationTypesResolverKind`, whose methods are in `c12_iteration_types.rs` since round 1.
  `new_checker` says so where upstream calls the two.
- The closure fields that `NewChecker` assigns are methods, placed after `new_checker` in the order of the
  assignments: `compare_symbols` (918) and `compare_symbol_chains` (919) call their workers; `evaluate` (937) makes
  the evaluator at each call and passes `evaluate_entity` of the checker; `resolve_name` (971) and
  `resolve_name_for_symbol_suggestion` (972) make the resolver at each call (it holds ids and function pointers, and
  the globals, `arguments` and `require` that it copies never change after 970) and pass the checker as its host; the
  50 getters (1068-1117) each call the resolver that upstream makes them with.
- `core.Memoize` is in the four resolvers: the lookup runs while `done` of the field is false, and `done` is set
  after the lookup has returned, so a lookup that comes back into its own getter runs again, as upstream's does.
- `getGlobalTypesResolver` is translated, and nothing calls it: the Checker has no field for such a list, and
  `IterationTypesResolverKind::get_global_builtin_iterator_types` (`c12`) makes its list at each call ("Checker:
  iteration and await" above). With two `Memo<List<'a, TypeId>>` fields, `c12` would call it.
- `countGlobalSymbols` is translated and not called: `Ast::new_table()` takes no size hint. The size hint of
  `createFileIndexMap` has no counterpart either (`Map::make()`).
- `nextCheckerID` (checker.go 583, the range of `c02`) is the private static `NEXT_CHECKER_ID` of this file. The id
  wraps as Go's `atomic.Uint32` does.
- A range over a Go map runs in the order of the table: `file.Locals` and `file.GlobalExports` in
  `initialize_checker`, the exports of the augmentation in `merge_module_augmentation`.
- `_, ok := c.globals[name]` is `table_get(globals, name).is_nil()`: a table has no entry with a nil symbol.
- `c.patternAmbientModules = append(..., file.PatternAmbientModules...)`: the list of the checker owns its elements,
  so each pattern is cloned (`PatternAmbientModule` has no `Clone`: the record is made field by field).
- Go evaluates the place of `c.valueSymbolLinks.Get(s).resolvedType = f()` before `f()`: the links are asked for
  first (which gives the symbol its id), then the type is made, then it is stored. The same for `globalThis`.
- `&Relation{}` is `Relation::default()` (the five relations are values). `&TypePredicate{...}` and the two
  `&IndexInfo{...}` are records of `type_predicates` and `index_infos`, where upstream allocates outside its arenas.
- Panics: 1210 is a fault and the nil list. `moduleAugmentation.Symbol.Declarations[0]` (1406) of a symbol without
  a declaration reads the nil node, which is not the module node: the augmentation is not merged.
- Not ported: the tracer and the mutex (`new_checker` returns the checker alone), and the two comments `Closure
  optimization` of 918-919.

### Verified

Cargo has not compiled the file, and nothing ran a function of it. What was compiled and checked:

- `sh round2-layer7-checker/c03-probe.sh` (rustc and clippy-driver alone, a few seconds; last run on the tree of
  `0f2dab7801`): a small crate that mounts the real `c03_init.rs` beside the real `core/{arena,golang,linkstore,
  tristate}.rs`, `ast/{flags,ids,symbolflags,checkflags,nodeflags}.rs` and `diagnostics/`. Everything else is a
  stand-in: the tree context, `NameResolver`, the evaluator, the data model and 51 methods of the checker, and the
  Checker itself with the 212 fields that the file names, each with its type of `c02_program_checker.rs` (a script
  reads them). `#![deny(warnings)]` with `dead_code` allowed: no error, no warning. clippy-driver with the table of
  the workspace and the repository's `clippy.toml`: no finding. So types, borrows, lifetimes, imports and lints of
  the file are checked against those signatures, not against the bodies of the tree.
- The stand-in signatures were compared with the tree by a script (name, receiver, parameter types, result): the 38
  methods that the tree defines in plain text and `new_function_type_mapper` are equal. Read by hand instead: `fail`
  and `list_of` (generic in the tree), the four casts (made by the macros of `types.rs`), `Checker::zero`, and the
  stand-ins of `ast/`, `binder/nameresolver.rs` and `evaluator/evaluator.rs`. The seven functions of `c04` that the
  tree does not have are assumptions.
- The probe found one error that reading had not: `fn(&mut Checker<'a>) -> &mut Memo<T>` does not elide (one
  parameter, two lifetimes). `MemoField` names the lifetime.
- A script over upstream 1068-1117 and the 50 getters: same name, resolver, global name, arity, `reportErrors` and
  result type for all 50, in upstream's order, and each field of `c02` has the type that its getter answers.
- `rustfmt --check --edition 2024`: exit 0. No two comment lines are adjacent. No `unwrap`, `expect`, `panic`,
  `unsafe`, `todo!` or index into a slice.
- The calls that other files make into this file (the 76 sites of the look-ahead, and the later `c14` 984 and 1503,
  `c44` 93 and 656, `utilities.rs` 504, 610, 706 and 738) were read against the signatures: all fit but three of
  `nodebuilderimpl.rs` (below).
- Upstream's own numbers for a later test (`oracle-toolchain-and-goldens/bottom-up/state/golden/init.nolib.state.txt`,
  strict, one empty file): 62 types, 6 symbols, 4 signatures and 1 global after line 1117; 64 types, 2 globals and 10
  diagnostics at the end of `initializeChecker`. Counted by hand over `new_checker` and `initialize_checker`: the same
  62 and 64 types, 6 symbols, 4 signatures, and the ten `Cannot find global type` errors.

### What this file expects and the tree does not have

At `0f2dab7801`:

- `crate::core::{Map, Memo}` as the contract has them: `Map::make()`, `set` with its `bool`; `Memo { value, done }`
  with public fields. `bigint_literal_types` needs a `Map` whose key is not `Copy` (`PseudoBigInt`), as `c42` does.
- `crate::evaluator` as a module: `evaluator/` has `evaluator.rs` and no `mod.rs`.
- Seven functions of `c04` (checker.go 1505-1806), passed to the name resolver as function pointers, so receiver,
  parameters and result must be those of `binder/nameresolver.rs` 14-27, all on `&mut self`:
  `symbol_referenced(symbol, meaning: SymbolFlags)`, `get_requires_scope_change_cache(node) -> Tristate`,
  `set_requires_scope_change_cache(node, value: Tristate)`,
  `check_and_report_error_for_invalid_initializer(error_location, name: &[u8], property_with_invalid_initializer:
  NodeId, result: SymbolId) -> bool`, `on_failed_to_resolve_symbol(error_location, name: &[u8], meaning,
  name_not_found_message: MessageId)`, `on_successfully_resolved_symbol(error_location, result: SymbolId, meaning,
  last_location: NodeId, associated_declaration_for_containing_initializer_or_binding_name: NodeId,
  within_deferred_context: bool)`, `get_suggestion_for_symbol_name_lookup(symbols: SymbolTableId, name: &[u8],
  meaning) -> SymbolId`. A name that is `Text<'a>` or a receiver that is `&self` does not coerce.
- A consumer that does not fit: `nodebuilderimpl.rs` 2059, 3601 and 3613 pass `None` as the message of
  `resolve_name`; it is `MessageId::NIL`.

## Checker: object literals and spread (`checker/c20_object_literals_spread.rs`)

Commits `88e8c64306` and `51528b0cf0` (written by the job that commits the worktree). The 25 functions of
`checker.go` 13235-13989 in upstream order: the 23 of layers E-LITERAL, E-ACCESS and E-CORE that the file did not
have, around `getUnionIndexInfos` and `isReadonlySymbol` (T-UIMEMBERS), which it had and which are unchanged.
PORT_STATUS.md has the row.

NOT compiled by cargo: `checker/mod.rs` still names modules without a file. "Verified" below says what was checked
instead.

### How a caller writes the calls

- `check_object_literal(node, check_mode)`, `check_property_assignment(node, check_mode)`,
  `check_shorthand_property_assignment(node, in_destructuring_pattern, check_mode)`,
  `check_object_literal_method(node, check_mode)` and `check_expression_for_mutable_location(node, check_mode)`
  answer a `TypeId`.
- `get_spread_type(left, right, symbol: SymbolId, object_flags, readonly) -> TypeId`,
  `try_merge_union_of_object_type_and_empty_object(t, readonly) -> TypeId`,
  `get_spread_symbol(prop, readonly) -> SymbolId`,
  `get_index_info_with_readonly(info: IndexInfoId, readonly) -> IndexInfoId` and
  `check_spread_prop_overrides(t, props: SymbolTableId, spread: NodeId)`: the table is the id of upstream's map.
- `get_narrowed_type_of_symbol(symbol, location) -> TypeId`. `is_const_type_variable(t, depth: isize)`: the nil type
  answers false, as upstream's nil.
- `check_contextual_deprecations(node)` takes an object literal or a JSX attributes node,
  `check_deprecated_property(name: NodeId, contextual_type)` the name node of a property.
- These only read and take `&self`: `is_spreadable_property`, `has_default_value` and
  `is_in_property_initializer_or_class_static_block(node, ignore_arrow_functions)`. Every other method takes
  `&mut self`.

### Differences from upstream

- `checkObjectLiteral`: the closure `createObjectLiteralType` (13284-13308) is a local function, and the locals that
  it reads are the fields of the private record `ObjectLiteralState`: the node, the contextual type,
  `inDestructuringPattern`, `propertiesTable`, `propertiesArray`, `offset`, `objectFlags`,
  `patternWithComputedProperties` and the three `hasComputed...Property`. The function writes them between the calls
  of the closure, which a closure of Rust that borrows them does not allow. The callback of `mapType` (13437) calls
  the local function with the state as the resets of 13431-13434 left it: `hasComputedSymbolProperty` keeps its
  value there, as upstream (hazard 16 of `checker-expressions-calls-flow/top-down/data/hazards.txt`).
  `propertiesArray[offset:]` is `get(offset..)`, the empty slice for an offset beyond the length.
  `allPropertiesTable` is the nil table without `strictNullChecks`. `propertiesArray = nil` is a new empty `Vec`.
- Stack tests, each the first statement of its function, at the six entries of
  `checker-expressions-calls-flow/top-down/data/tested_entries.tsv` that are in this range: `get_spread_type` (the
  error type), `is_valid_spread_type` (true), `has_default_value` (false), `is_const_context` (false),
  `is_valid_const_assertion_argument` (true) and `is_const_type_variable` (false, before the test of the depth).
- Asserts and indexings: the assert of 13403 records and goes on. `types[len(types)-1]` (13531),
  `elementInfos[i]` (13766), `contextualSignature.parameters[0]` (13917) and `node.Arguments()[2]` (13934) are
  `List::at`, the zero value outside the list. The write `newTypes[len(newTypes)-1]` (13534) into an empty copy is a
  fault.
- `tryMergeUnionOfObjectTypeAndEmptyObject`: the empty branch for private and protected properties (13657-13658) is
  the negated test in front of `isSpreadableProperty`, which is still not asked for them. `t.Types()` is read once.
- `getSpreadType`: `collections.Set[string]` is `collections::Set<Text>`, and the two `spreadLinks.Get(result)` are
  one link.
- `getNarrowedTypeOfSymbol`: the `switch` (13828-13925) is an `if` with an `else if`, and the body of its first arm
  is a labeled block that upstream's `break` leaves. `slices.Index` is `core::find_index`. Each of the two comments
  with a code example is one line.
- `isConstTypeVariable` and `checkExpressionForMutableLocation`: the `switch` over conditions is a sequence of `if`
  with returns, in upstream's order.
- `isConstContext`: the second operand of `&&` at 13719 is a block, so that the contextual type is asked only after
  `isValidConstAssertionArgument` answered true, as upstream's evaluation order has it.

### Verified

No cargo build has seen the file, and nothing ran a function of it. What was checked:

- `rustfmt --check --edition 2024`: exit 0. rustfmt leaves a statement alone when a token of it is longer than the
  line (the two `error` calls with the long message names, the assert with the long text): a copy of the file with
  short names in their place is formatted without a difference.
- A probe of the file with `rustc` alone and with `clippy-driver` alone: exit 0 each.
  `round2-layer7-checker/c20-probe-gen.py` writes `c20-probe.rs`, and `c20-probe-clippy.sh` has the clippy table of
  the workspace and its `clippy.toml`. The probe denies warnings, unused imports, variables, `mut` and assignments and
  `unreachable_pub`. It holds this file and `checker/types.rs` by `#[path]`, the leaf files they stand on by `#[path]`
  (`diagnostics/`, `core/{arena,golang,linkstore,text,tristate}.rs`, `collections/{set,ordered_map,ordered_set}.rs`,
  `jsnum/jsnum.rs`, `ast/{flags,ids,checkflags,symbolflags,modifierflags,nodeflags,kind_generated,diagnostic}.rs`),
  and stand-ins for every other name. The script reads the signature of a stand-in from the file of the tree that
  defines the function, and the body of a stand-in never returns: 140 functions (21 methods of `Ast` and 30 free
  functions of `ast/`, 5 of `core/core.rs`, 73 methods of the checker from 26 files and 11 free functions of
  `checker/`), with the `Symbol` record, three node records, `FindAncestorResult`, `CheckMode`, `UnionReduction` and
  `IntersectionState` copied from their files. Written by hand in the probe: the 13 callees of the last section,
  `core::Map` with the signatures of the contract, `StackCheck`, `CacheHashKey`, `ScriptTarget`, `PseudoBigInt`,
  `evaluator::Result`, `Fallback`, `ListItem`, and a `Checker` of the 27 fields that the two files read, with the
  types of `c02_program_checker.rs`. `Ast` and `Checker` are invariant in their lifetime there, as in the tree.
  A copy of the file with an unused variable, two swapped arguments and a nested `&mut self` call gave the four
  errors (two of unused variables, E0308, E0499).
- Scripts over the file: the 25 functions have upstream's names in upstream's order
  (`round2-layer7-checker/ranges.py`: 25 in the file, 0 nowhere); no two comment lines are adjacent; no `unwrap`,
  `expect`, `panic`, `todo`, `unimplemented`, `unreachable` or `unsafe`; every `[...]` indexes a store of records or a
  link store of the checker.
- Read against the tree at `0f2dab7801`: the calls that other files make into these functions match by name, number
  and order of arguments (`c05` 338, `c14` 711, 998, 1053 and 1122, `c24` 1047-1048, `c28` 307-313, 651 and 659,
  `c31` 126, 137, 301, 332, 525 and 722, `jsx.rs` 1394-1587, `relater.rs` 1329 and 5646).
- Not checked: the 13 callees that have no definition, the `core::Map` of the tree (no file defines it), clippy and
  rustc on the real crate, and any result against upstream's baselines.

### What this file expects and the tree does not have

At `51528b0cf0`, 13 callees, each called by its upstream name with upstream's parameter order, as the other callers
of the tree write them:

- `c50` (no file): `get_apparent_type_of_contextual_type(node, context_flags) -> TypeId` (30809),
  `instantiate_contextual_type(contextual_type, node, context_flags) -> TypeId` (30940),
  `push_cached_contextual_type(node)` (30995), `pop_contextual_type()` (31003), `is_context_sensitive(node) -> bool`
  (31020), `get_inference_context(node) -> InferenceContextId` (31088).
- `c48`: `get_contextual_type(node, context_flags) -> TypeId` (29466),
  `is_context_sensitive_function_or_object_literal_method(func) -> bool` (29619).
- `c47`: `remove_definitely_falsy_types(t) -> TypeId` (29229).
- `c18` (no file): `get_control_flow_container(node) -> NodeId` (11528).
- `c16` (no file): `check_function_expression_or_object_literal_method(node, check_mode) -> TypeId` (10204),
  `get_contextual_signature(node) -> SignatureId` (10354), nil for none.
- `inference.rs` (no file): `add_intra_expression_inference_site(context: InferenceContextId, node, t)`
  (`inference.go` 1285).
- `crate::core::Map` as the contract has it (`get` and `set` with its `bool`), for `pattern_for_type`.

## Checker: calls and overload resolution (`checker/c15_calls.rs`)

Commit `609c902233` (written by the job that commits the worktree). The 52 functions of `checker.go` 8407-10131 that
the file did not have (layer E-CALL), each at its upstream place among the seven that it had (E-DECOR, T-SIGSHAPE),
and `CallState` of 8920: the 59 functions of the range are in the file, in upstream order. PORT_STATUS.md has the row.

NOT compiled by cargo when it was written: the checker did not compile yet. "Verified" below says what was checked
instead.

### How a caller writes the calls

- `check_call_expression(node, check_mode)` and `check_tagged_template_expression(node)` answer a `TypeId`.
- `*[]*Signature` is `Option<&mut Vec<SignatureId>>`: `get_resolved_signature(node, candidates_out_array, check_mode)`,
  `resolve_signature`, `resolve_call_expression`, `resolve_new_expression`, `resolve_tagged_template_expression` and
  `resolve_instanceof_expression` (the same three parameters), and
  `resolve_call(node, signatures, candidates_out_array, check_mode, call_chain_flags, head_message)`. A nil message is
  `MessageId::NIL`.
- A `[]*ast.Node`, `[]*Signature`, `[]*ast.Symbol` or `[]*Type` that a function only reads is `List<'_, T>`, so
  `List::from_slice(&local)` fits: the `signatures` of `resolve_call` and `reorder_candidates`,
  `has_correct_arity(node, args, signature, signature_help_trailing_comma)`,
  `has_correct_type_argument_arity(signature, type_arguments)`,
  `is_signature_applicable(node, args, signature, relation: RelationKind, check_mode, report_errors, diagnostic_output: Option<&mut Vec<DiagnosticId>>)`,
  `infer_type_arguments(node, signature, args, check_mode, context: InferenceContextId) -> List<'a, TypeId>`,
  `check_type_arguments(signature, type_argument_nodes, report_errors, head_message) -> List<'a, TypeId>` (the nil
  list when a constraint fails), `get_longest_candidate_index(candidates, args_count) -> isize`,
  `get_type_arguments_from_nodes(type_argument_nodes, type_parameters) -> List<'a, TypeId>`,
  `create_union_of_signatures_for_overload_failure(candidates)`, `create_combined_symbol_from_types(sources, types)`,
  `create_combined_symbol_for_overload_failure(sources, t)`,
  `get_argument_arity_error(node, signatures, args, head_message) -> DiagnosticId` and
  `get_type_argument_arity_error(node, signatures, type_arguments, head_message) -> DiagnosticId`.
  `infer_signature_instantiation_for_overload_failure(node, type_parameters: List<'a, TypeId>, candidate, args, check_mode)`
  keeps its type parameters in the inference context.
- The list that `pickLongestCandidateSignature` writes is `&mut [SignatureId]`:
  `get_candidate_for_overload_failure(node, candidates, args, has_candidates_out_array, check_mode)` and
  `pick_longest_candidate_signature(node, candidates, args, check_mode)`. `reorder_candidates` answers a
  `Vec<SignatureId>`.
- `CallState<'a>` has upstream's ten fields: `type_arguments` is the `List<'a, NodeId>` of the node, `args` a
  `Vec<NodeId>`, `candidates` and `candidates_for_argument_error` a `Vec<SignatureId>`, and the two single candidates
  for an error are ids (nil for none). `choose_overload(&mut CallState, relation) -> SignatureId` answers nil for no
  candidate; `report_call_resolution_errors(node, &CallState, signatures, head_message)` and
  `add_implementation_success_elaboration(&CallState, failed, diagnostic)` only read the state.
- `invocation_error(error_target, apparent_type, kind, related_information: DiagnosticId)`: nil for none.
  `invocation_error_details(error_target, apparent_type, kind) -> DiagnosticId` and
  `invocation_error_recovery(apparent_type, kind, diagnostic)` as the callers of the tree had them.
- `is_untyped_function_call(func_type, apparent_func_type, num_call_signatures: isize, num_construct_signatures: isize)`.
- `add_deprecated_suggestion_with_signature(location, declaration, deprecated_entity: &[u8], signature_string: &[u8])`.
- `report_cannot_invoke_possibly_null_or_undefined_error(node, facts)` is what `resolve_call_expression` passes to
  `check_non_null_type_with_reporter`, as `Self::report_cannot_invoke_possibly_null_or_undefined_error`.
- Free functions, `pub` at column 0: `some_signature(c, signatures, &mut dyn FnMut(&mut Checker, SignatureId) -> bool)`,
  `signature_has_literal_types(c, s)`, `accepts_void(c, t)` and `get_error_node_for_call_node(a, node)`. Only this
  file names them and `CallState`, and `checker/mod.rs` has no glob for the file.
- These only read and take `&self`: `get_this_argument_of_call`, `get_effective_check_node`,
  `get_diagnostic_head_message_for_decorator_resolution`, `get_legacy_decorator_argument_count`. Every other method
  takes `&mut self`.

### Differences from upstream

- `*candidatesOutArray = s.candidates` (8950) shares the list with the caller, and `chooseOverload` (9191) and
  `pickLongestCandidateSignature` (9627) write into it afterwards. `resolve_call` keeps the candidates in its
  `CallState` and moves them into the caller's vector at its one exit: the statements after 8950 are a labeled block,
  and each `return` of upstream is a `break` out of it. Nothing reads the vector of the caller before that exit
  (`reportErrors` is false when there is one).
- The stack test of `checker-expressions-calls-flow/top-down/data/tested_entries.tsv` for this range is the first
  statement of `type_has_protected_accessible_base`: `StackLimit`, and true (false would report TS2674).
- Panics, asserts and indexes are faults with a fallback, as `fallbacks.tsv` and `fallbacks_additions.tsv` of that
  research have them: 8558 (`Panic` with the kind as detail, the unknown signature, which `get_resolved_signature`
  stores as any other result); 9318 (assert for a type argument past the type parameters, the loop stops and the
  type argument types are returned); 9612 and 9627 (`candidates[-1]`: `Panic`, the unknown signature); 8638
  (`text[...]`: a checked read, no line break outside the text); 9092 (`slices.Insert` outside the list: `Panic`, the
  signature is appended); 9896 (`args[maxCount]` outside the arguments: `Panic`, the diagnostic is the one of the
  guard of 9888, at the error node); 10120 with a nil context: the write of the flag lands in the scratch record of
  the store, which counts it. `mixinFlags[i]` reads false outside the list. `constructSignatures[0]`,
  `s.candidates[0]`, `candidates[0]`, `node.Arguments()[0]` and `args[i]` are guarded reads (`at`, `first_or_nil`)
  that give the nil id without a fault.
- `localState := *s` (9784) is a new `CallState` written field by field with the candidate and the flag of the
  implementation; its `candidates_for_argument_error` starts empty, because `chooseOverload` resets the three
  candidates for an error before it reads them. The arguments are copied.
- `someSignature`, `signatureHasLiteralTypes` and `acceptsVoid` take the checker, since a signature and a type are
  ids; the callback of `some_signature` gets the checker, as the callback of `some_type` does.
- `core.Some`, `core.Every` and `core.Find` with a method of the checker are `iter().any`, `iter().all` and
  `iter().find` over the list; `core.MapNonNil` and `core.Map` over the candidates are `core::map_non_nil` and
  `core::map` into a vector; `core.Filter` of 9764 is `core::filter` over the slice, so nothing is allocated in the
  arena of the checker for a list that is only counted and passed on.
- `getTypeArgumentsFromNodes`: the result is the nil list only for nil nodes when nothing is appended (`core.Map`
  gives nil for nil).
- `s.argCheckMode != 0` (9170) is `!= CheckMode::NONE`. `math.MaxInt` and `math.MinInt` (9800-9803, 9961-9962) are
  `isize::MAX` and `isize::MIN`; `strconv.Itoa` is the private `itoa`.
- `s.args` is copied out of what `get_effective_call_arguments` answers (`as_slice().to_vec()`), which fits a `Vec`
  and a `List`.
- The switch of `hasCorrectArity` and the switches over `true` of 8589, 9206, 9440, 9462, 9740, 9824, 9838, 9852 and
  9872 are `if` chains in upstream's order of cases.
- Comments: the examples that upstream writes on lines of their own are folded into the sentence before them, and
  the three references to an issue number (8955, 9078, 9384) are not carried over.

### Verified

No compiler has seen the file, and nothing ran a function of it. What was checked:

- `rustfmt --check --edition 2024`: exit 0 (the file parses and is formatted).
- Scripts over the file: the 59 functions have upstream's names in upstream's order; each of the 106 imported names
  is used and no free function is called without an import; no two comment lines are adjacent; no `unwrap`,
  `expect`, `panic`, `unsafe`, and no index into a slice (every `[...]` is the index of a store of the checker); the
  57 diagnostic messages of the range exist by name in `diagnostics/diagnostics_generated.rs`.
- The 279 shapes of calls that the file makes were compared by name and number of arguments with the definitions
  of the tree of `609c902233`: every callee that the tree defines matches. Read at their definitions for the types
  of parameters and results: the callees in `c03`, `c05`, `c06`, `c14`, `c21`, `c22`, `c23`, `c24`, `c28`, `c29`, `c31`,
  `c33`, `c34`, `c35`, `c36`, `c37`, `c38`, `c40`, `c41`, `c43`, `c45`, `c47`, `c49`, `c51`, `flow.rs`, `grammarchecks.rs`,
  `jsx.rs`, `mapper.rs`, `printer.rs`, `relater.rs`, `utilities.rs`, the accessors and predicates of `ast/`,
  `DiagnosticStore`, `core/core.rs`, `core/text.rs`, `scanner` (`skip_trivia`, `skip_trivia_ex`, `SkipTriviaOptions`,
  `get_text_of_node`), `stringutil::is_line_break`, and the fields, records, flags, link stores and helpers of the
  data model (`c01_data.rs`, `c02_program_checker.rs`, `types.rs`, `core/linkstore.rs`). `Map` and `LiveList` are used as
  the contract has them.
- The calls that other files of the tree make into these functions (`c05`, `c08`, `c11`, `c14`, `jsx.rs`,
  `relater.rs`, `flow.rs`, 24 sites by the look-ahead) match the signatures by name and number of arguments, and
  `jsx.rs` 1071 and 1093 by the types of what they pass.
- Not checked: types and borrows (no compiler), clippy, and any result against upstream's baselines.

### What this file expects and the tree does not have

At `609c902233`, 18 callees, each called by its upstream name with upstream's parameter order:

- `inference.rs` (no file), as the contract has them: `new_inference_context(type_parameters: List<'a, TypeId>,
  signature, flags, TypeComparer) -> InferenceContextId` (1251, `TypeComparer::Nil` for nil),
  `clone_inference_context(n, extra_flags) -> InferenceContextId` (1258),
  `clone_inferred_part_of_context(n) -> InferenceContextId` (1265), `get_inferred_types(n) -> List<'a, TypeId>` (1406),
  `get_mapper_from_context(n) -> TypeMapperId` (1414), `create_outer_return_mapper(context) -> TypeMapperId` (1423),
  `infer_types(inferences: LiveList, source, target, priority, contravariant)` (53) and the free function
  `has_inference_candidates(c, info)` (1650).
- `c50` (no file): `is_context_sensitive(node) -> bool` (31020), `get_inference_context(node) -> InferenceContextId`
  (31088).
- `c49`: `get_effective_call_arguments(node)` (30165; a `Vec<NodeId>` and a `List<'a, NodeId>` both fit),
  `get_spread_argument_index(args: List<'_, NodeId>) -> isize` (30231), the free function
  `is_spread_argument(a, arg) -> bool` (30235) and
  `create_synthetic_expression(parent, t, is_spread, tuple_name_source) -> NodeId` (30239), a node of the open store,
  whose range `is_signature_applicable` writes with `Ast::set_loc`.
- `c48`: `get_contextual_type(node, context_flags) -> TypeId` (29466) and
  `get_spread_argument_type(args: List<'_, NodeId>, index: isize, arg_count: isize, rest_type, context: InferenceContextId, check_mode) -> TypeId`
  (29623).
- `c47`: `get_optional_expression_type(expr_type, expression) -> TypeId` (29187).
- `c18` (no file): `is_node_within_class(node, class_declaration) -> bool` (12051).
- `crate::core::Map` as the contract has it (`get` and `set` with its `bool`), for `cached_signatures`.

## Checker: type keys (`checker/c30_type_keys.rs`)

Commit `1c1db7d342`, written by the job that commits the worktree. The file holds checker.go 17471-17775 whole and in
upstream order (layer T-KEYS): `CacheHashKey` with `IsZero`, `keyBuilder` with its 14 methods, the 12 key functions and
the three tests that close the range, 30 functions. No function is a stand-in. PORT_STATUS.md has the row.

NOT compiled by cargo when this was written: it does not reach the file while a module of `checker/mod.rs` has no file.
"Verified" below says what was checked instead.

### How a caller writes the calls

- `CacheHashKey { hi, lo }` is `Copy`, `Eq`, `Ord`, `Hash`, `Debug` and `Default` (the zero key).
  `CacheHashKey::of(bytes)` is `CacheHashKey(xxh3.Hash128(bytes))` and `CacheHashKey(xxh3.HashString128(s))`, and
  `key.is_zero()` is `IsZero`.
- `KeyBuilder::default()` is `var b keyBuilder`. `write_byte(u8)`, `write_string(&[u8])`, `write_uint32(u32)`,
  `write_uint64(u64)`, `write_int(isize)`, `write_type(TypeId)`, `write_types(List<'_, TypeId>)`,
  `write_node_id(NodeId)`, `write_node(NodeId)` (nothing for the nil node) and `hash()` need no checker.
  `write_symbol(c, symbol)` and `write_alias(c, alias)` take `&Checker` (a `&mut Checker` is accepted), and
  `write_generic_type_references(c, source, target, ignore_constraints) -> bool` takes `&mut Checker`.
- Free functions, re-exported as `crate::checker`, with upstream's parameter order after the checker:
  - no checker: `get_type_list_key(types)`, `get_tuple_key(element_infos: List<'_, TupleElementInfo>, readonly)`,
    `get_template_type_key(texts: List<'_, Text<'_>>, types)`, `get_node_list_key(nodes: List<'_, NodeId>)`;
  - `&Checker`: `get_alias_key(c, alias)`, `get_union_key(c, types, origin, alias)`,
    `get_intersection_key(c, types, flags, alias)`, `get_type_alias_instantiation_key(c, type_arguments, alias)`,
    `get_type_instantiation_key(c, type_arguments, alias, single_signature)`,
    `get_indexed_access_key(c, object_type, index_type, access_flags, alias)`,
    `get_conditional_type_key(c, type_arguments, alias, for_constraint)`, `is_non_deferred_type_reference(c, t)`,
    `is_unconstrained_type_parameter(c, tp)`;
  - `&mut Checker`, because `get_type_arguments` and `get_constraint_of_type_parameter` resolve:
    `get_relation_key(c, source, target, intersection_state, is_identity, ignore_constraints) -> (CacheHashKey, bool)`
    and `is_type_reference_with_generic_arguments(c, t)`.

### Differences from upstream and from the contract

- The digest. Upstream keeps `xxh3.Hash128` of the byte stream. The contract
  (`checker-data-model-contract/top-down/data/decisions.tsv`, row "cache keys") keeps `Wyhash11` and `Wyhash` of
  `bun_wyhash`. The file keeps two XXH64 digests of the byte stream, `bun_core::hash::xxhash64` under the seeds 0 (`lo`)
  and 0x9E3779B97F4A7C15 (`hi`): `src/typecheck/Cargo.toml` has no `bun_wyhash` dependency, and the manifest was not a
  file of the step that wrote this one. The names, the fields and the derives are the contract's. A key is only
  compared, as a map key or a set member, and no key reaches output, so the digest changes no answer. With
  `bun_wyhash.workspace = true` in the manifest (and the line in `Cargo.lock`) the contract's digest is the two lines of
  `CacheHashKey::of`: `hi: bun_wyhash::Wyhash11::hash(0, bytes)` and `lo: bun_wyhash::hash(bytes)`. `xxhash64` is a C++
  function of `bun_highway`: a test binary of the crate that makes a key needs the symbol `highway_xxhash64`, beside
  the native functions of `bun_core` that the crate already calls (`StackCheck`, `strings`). The test
  `the_five_signature_keys_differ` of `c01_data.rs` makes five keys.
- The bytes of a key are upstream's. `t.id` is the `TypeId`, `ast.GetNodeId` is `ast::get_node_id` (the id of the node
  table), and `ast.GetSymbolId` is `Ast::get_symbol_id`, which gives a symbol its id at the first request, as upstream
  does: a key that names a symbol is such a request.
- `overflowBuffer == nil` is `overflow_buffer.is_empty()`: a spill of no byte leaves the slice nil. A write into the
  inline buffer goes through `get_mut`; the spill before it makes the room, so no byte is dropped.
- The closure `writeTypeReference` is the private method `write_type_reference`, with `depth`, `ignore_constraints`,
  the list of type parameters and `constrained` as parameters. `slices.Index` with the append is a `match` on
  `position`.
- `getUnionKey` panics for an origin that is no union, intersection or index type: `c.fail` and the zero key, as the
  contract's test `cache_keys_hash_upstream_bytes` expects.
- A stack test is the first statement of `is_type_reference_with_generic_arguments`: it records `StackLimit` and
  answers false, and `get_relation_key` then makes the plain key (`s` and the two type ids).
- `is_unconstrained_type_parameter` reads `Type.Target` through `type_target`: for a type without a target that is a
  fault and the error type, whose nil symbol gives false. Upstream has no caller of this function and none of
  `getNodeListKey`.

### Verified

- `sh round2-layer7-checker/c30-probe.sh` on the trees of `fdf519158d` and `205dd25e8a`: exit 0, "probe ok". It runs `rustc` and
  `clippy-driver` alone, no cargo. (1) One crate holds the real `c30_type_keys.rs` and `checker/types.rs`, the real
  `core/golang.rs`, the flag and id files of `ast/` and the collections that `types.rs` names, and a stand-in for every
  other name whose signature the generator reads from the file of the tree that defines it (`Ast::sym`, `parent`,
  `get_symbol_id`, `as_type_parameter_declaration`, the three node tests, `fail`, `bad_cast`, `stack_limit`, `list_of`,
  `get_type_arguments`, `get_constraint_of_type_parameter`, `IntersectionFlags`, `IntersectionState`); `bun_core` is a
  stand-in crate with `hash::xxhash64`, after the generator found that signature in `src/bun_core/util.rs` and the
  dependency in the manifest. It compiles under `#![deny(warnings)]` with `unused_imports`, `unused_variables`,
  `unused_mut`, `unused_assignments` and `unreachable_pub` denied. (2) `clippy-driver` with the clippy table of the
  workspace, `clippy::all` and the repository's `clippy.toml` prints nothing. (3) A program drives the functions that
  need no checker and compares each key with the digest of a plain byte stream: 399,549 random writes in 2,000
  builders with a digest after each write, the exact fill of the inline buffer by each kind of write (184 to 192
  bytes before an 8-byte write, 192 and 193 bytes of one string), the key of the contract's test that spills twice,
  and the keys of type lists, tuples, template literal types and node lists. (4) `rustfmt --check --edition 2024`.
- `python3 round2-layer7-checker/ranges.py c30_type_keys`: 30 of 30 functions of the range have a `fn` of their name
  in the file. `python3 round2-layer7-checker/globs.py --names`: no `pub` name of the module is a name of another
  globbed module, and no name of this range is left among the names that files import and no module exports.
- `python3 round2-layer7-checker/c30-callsites.py`: 45 calls in 12 files (`c29`, `c33`, `c37` to `c41`, `c43`, `c44`,
  `c47`, `flow.rs`, `relater.rs`) give as many arguments as the definitions take, and 13 names are imported at 26
  sites. Each call was also read against the signature.
- Read against upstream statement by statement. No two comment lines are adjacent; no `unwrap`, `expect`, `panic`,
  `todo`, `unimplemented`, `unreachable`, `unsafe` or slice index.
- Not checked: the real crate through cargo. The functions that read the checker (`write_symbol`, `write_alias`,
  `write_generic_type_references`, the keys and tests that take the checker) were compiled and not run. The stand-in
  signatures are those of the tree at the time of the run.

### What this file expects and the tree does not have

- Nothing of its own: every name that the file uses has a definition in the tree of `fdf519158d`.
- The maps that its callers key with a `CacheHashKey` are `crate::core::Map` (section C of the look-ahead).
- For the contract's digest: `bun_wyhash.workspace = true` in `src/typecheck/Cargo.toml`, as above.

## Checker: the symbol and the type at a location (`checker/c52_symbol_at_location.rs`)

Commits `2de76025ed` and `ed705371ac`, written by the job that commits the worktree. The file holds checker.go
31704-32296 whole and in upstream order (layer Z-SERVICES), 16 functions, and after them `is_arguments_symbol` of
`services.go` 229, which `containsArgumentsReference` calls and which no module holds (`services.go` has none). No
function is a stand-in. PORT_STATUS.md has the row.

NOT compiled by cargo when this was written: it does not reach the file while a module of `checker/mod.rs` has no file
(`c16`, `c18`, `c19` and `emitresolver` at `a582ea9efb`). "Verified" below says what was checked instead.

### How a caller writes the calls

- Every function is a method of `Checker<'a>`. `get_emit_resolver` and `is_arguments_symbol` take `&self`, the others
  `&mut self`. The module exports no name, so `checker/mod.rs` has no glob for it.
- `GetSymbolAtLocation` is `get_symbol_at_location_exported(node)` (the contract,
  `node-table-id-contract/bottom-up/data/snake-collisions.txt` 71), and `getSymbolAtLocation` is
  `get_symbol_at_location(node, ignore_errors)`. Both answer a `SymbolId`, nil for none, as
  `get_symbol_of_name_or_property_access_expression(name)` and `get_applicable_index_symbol(t, key_type)` do.
- `get_type_of_node(node)`, `get_type_at_location(node)` and `get_regular_type_of_expression(expr)` answer a `TypeId`
  that is never nil. `get_this_type_of_object_literal_from_contextual_type(containing_literal, contextual_type)`,
  `get_this_type_from_contextual_type(t)` and `get_this_type_argument(t)` answer `TypeId::NIL` for upstream's nil.
- `get_applicable_index_infos(t, key_type) -> List<'a, IndexInfoId>`: `core.Filter` of the index infos of the type,
  so the list of the type itself when every info applies. `get_index_signatures_at_location(node) -> Vec<NodeId>`.
- `contains_arguments_reference(node) -> bool`, `is_this_property_and_this_typed(node) -> bool`,
  `get_aliased_symbol(symbol) -> SymbolId`, `is_arguments_symbol(symbol) -> bool`.
- `get_emit_resolver() -> EmitResolver`: the unit value that `symbolaccessibility.rs` 89 and `nodebuilderimpl.rs` 3151
  and 3361 name where upstream writes `c.GetEmitResolver()`.

### Differences from upstream

- `GetEmitResolver`: the `Checker` record has no `emitResolver` and no `emitResolverOnce` (the comment of
  `c02_program_checker.rs` 715), and the two files that use a resolver name `EmitResolver` as a value and give the
  checker to its methods. So the function answers that value and does not call `newEmitResolver`. If
  `emitresolver.rs` gives the resolver fields of its own, this function and those two files change together.
  `emitresolver.rs` of `48da5c6a89` keeps the value without fields: since `04848b7d4f` the record has the field
  `emit_resolver`, the link stores of the resolver ("Checker: the emit resolver").
- The switch of `getSymbolAtLocation` has four `fallthrough`. The cases that fall into each other are one arm each,
  and a test of the kind says where a kind enters: `Identifier`, `PrivateIdentifier`, `PropertyAccessExpression` and
  `QualifiedName` with `ThisKeyword` and `ThisType`; the two string literal kinds with `NumericLiteral`;
  `ImportKeyword` with `NewKeyword`. A `JsxNamespacedName` that is no intrinsic tag name answers nil, as the default.
- Panics are faults with the nil symbol: 31846 (`Symbol should be defined`) and 31921 (`ImportEqualsDeclaration should
  be defined`). `c.getTypeArguments(t)[0]` of 32200 and `parent.Arguments()[1]` of 31817 are guarded reads (`at`) that
  give nil without a fault: the first is safe while the global `ThisType` has its arity, the second follows the test
  for three arguments. A read through a nil parent (31725, where upstream dereferences `parent`) reads the nil node.
- The closure `visit` of `containsArgumentsReference` is a nested function with a stack test as its first statement:
  it records `StackLimit` and answers false, and the result is cached as upstream caches it. No other function of the
  file has a stack test: each cycle through `get_symbol_at_location` and `get_type_of_node` passes an entry that has
  one (`check_expression_ex`, `get_type_from_type_node`, `get_type_for_variable_like_declaration`,
  `resolve_entity_name`), and the two loops of the file climb the syntax tree.
- `getApplicableIndexSymbol`: `declarations` is a `Vec` that becomes the list of the symbol (`list_of`), and the four
  writes to the new symbol are one `update_symbol`. The inner loop variable hides `info`, as upstream's does.
- `getIndexSignaturesAtLocation`: `objectType.Distributed()` is `type_distributed`.
- `core.IfElse` is an `if` expression (five places), and the arguments of a call are computed in upstream's order
  before the call where they take the checker.
- The comment of 31757-31760 is carried over without its last sentence, which names two pull requests.

### Verified

- `sh round2-layer7-checker/c52-probe.sh` on the trees of `a582ea9efb` and `f5d129e53c`: exit 0, "probe ok". It runs
  `rustc` and `clippy-driver` alone, no cargo. (1) One crate holds the real `c52_symbol_at_location.rs`,
  `checker/types.rs` and `checker/c01_data.rs`, the leaf files they stand on, and a stand-in for every other name.
  `c52-probe-gen.py` reads
  the signature of a stand-in from the file of the tree that defines it: 23 methods of `Ast`, 54 free functions of
  `ast/`, 50 methods of the checker, the 8 free functions of `utilities.rs`, `append_if_unique` and `first_or_nil` of
  `core/core.rs`, and the types of the 10 fields of the checker that the file names beside `ast`, `types` and
  `stack_check`. It compiles under `#![deny(warnings)]` with `unused_imports`, `unused_variables`, `unused_mut`,
  `unused_assignments` and `unreachable_pub` denied. (2) `clippy-driver` with the clippy table of the workspace,
  `clippy::all` and the repository's `clippy.toml` prints nothing. (3) `rustfmt --check --edition 2024`. A type error
  and an `assign_op_pattern` put into a copy of the file were both reported, so the probe sees the file.
- Assumptions of the probe, written by hand because the tree did not have them: `pub struct EmitResolver;`, `Map` of
  `crate::core` as the contract has it, and the four callees of the last section.
- `python3 round2-layer7-checker/c52-callseq.py`: per function, the calls of methods of the checker are upstream's,
  by name and number (28 in `get_symbol_at_location`, 24 in `get_symbol_of_name_or_property_access_expression`, 23 in
  `get_type_of_node`), and so are the calls of free functions of `ast`, `core` and the package, but for `core.IfElse`
  (five `if` expressions), `core.Filter` (the method `filter`) and `newEmitResolver`. The script compares names and
  counts, not arguments and not order: each function was also read against upstream statement by statement.
- `python3 round2-layer7-checker/ranges.py c52_symbol_at_location`: 16 of 16 functions of the range have a `fn` of
  their name in the file. `python3 round2-layer7-checker/globs.py`: the module is under E (a file, no `pub` name, no
  glob).
- The 17 calls that 6 files of the tree make into the file (`c08` 7, `c49` 4, `c09` 2, `jsx.rs` 2, `jsdoc.rs` 1,
  `utilities.rs` 1) were read against the signatures: arguments, and what they do with the result (`c09` reads
  `len()` and `as_slice()` of the list of index infos).
- No two comment lines are adjacent; no `unwrap`, `expect`, `panic`, `todo`, `unimplemented`, `unreachable`, `unsafe`
  or slice index.
- Not checked: the real crate through cargo, and any result against upstream's baselines. Nothing ran a function of
  the file.

### What this file expects and the tree does not have

At `a582ea9efb`:

- `c18`: `get_this_container(node, include_arrow_functions, include_class_computed_property_name) -> NodeId` (12279;
  the method of the checker, not `ast::get_this_container`) and
  `check_property_access_expression(node, check_mode, write_only) -> TypeId` (11334).
- `c17`: `check_new_target_meta_property(node) -> TypeId` (10858) and `check_meta_property_keyword(node) -> TypeId`
  (10889).
- `emitresolver.rs`: `EmitResolver`, a value without fields.
- `crate::core::Map` with `get_ok(&key) -> Option<V>` and `set(key, value) -> bool` (section C of the look-ahead).

## Checker: inference (`checker/inference.rs`)

Commit `e9755c9f92` (written by the job that commits the worktree). `checker/inference.go` whole (layers I-INFER and
I-REVMAP): its 77 functions in upstream order, 2,807 lines. `InferenceKey` and `InferenceState` of 11-30 are the
records of `c01_data.rs`. PORT_STATUS.md has the row.

NOT compiled by cargo: at that commit modules of `checker/mod.rs` still have no file and `crate::core` has no `Map`
and no `LiveList`. "Verified" below says what was checked instead.

### How a caller writes the calls

- An `*InferenceState`, `*InferenceContext` or `*InferenceInfo` is the id of its record: `n: InferenceStateId`,
  `n: InferenceContextId`, `inference: InferenceInfoId`. `[]*InferenceInfo` is `LiveList<'a, InferenceInfoId>`.
- `infer_types(inferences, original_source, original_target, priority, contravariant)`,
  `new_inference_context(type_parameters: List<'a, TypeId>, signature, flags, compare_types) -> InferenceContextId`
  (`TypeComparer::Nil` is upstream's nil comparer and becomes `Assignable`), `clone_inference_context(n, extra_flags)`
  and `clone_inferred_part_of_context(n)` (nil for a nil context or for no inferred part),
  `get_inferred_type(n, index: isize) -> TypeId`, `get_inferred_types(n) -> List<'a, TypeId>` (never nil),
  `get_mapper_from_context(n) -> TypeMapperId` (nil for nil, `&self`), `create_outer_return_mapper(context)`,
  `add_intra_expression_inference_site(n, node, t)`, `infer_from_intra_expression_sites(n)`,
  `merge_inferences(target, source)`.
- `apply_to_parameter_types(source, target, callback)` and `apply_to_return_types` take
  `&mut dyn FnMut(&mut Checker<'a>, TypeId, TypeId)`.
- `invoke_once(n, source, target, action)`: the action is `fn(&mut Checker<'a>, InferenceStateId, TypeId, TypeId)`, a
  method is passed where upstream passes a method expression (`Self::infer_from_object_types`).
  `infer_from_matching_types(n, sources: &[TypeId], targets: &[TypeId], matches, sort)` takes
  `fn(&mut Checker<'a>, TypeId, TypeId) -> bool` and answers `(Cow<[TypeId]>, Cow<[TypeId]>)`: a list comes back
  borrowed when nothing was removed, as `core.Filter` answers its argument. `find_leftmost_type(types, f)` takes the
  same kind of function.
- `infer_to_template_literal_type(n, source, target)`: `target` is the `TypeId` of the template literal type.
- `get_common_supertype`, `get_single_common_supertype`, `get_common_subtype`, `literal_types_with_same_base_type`,
  `get_combined_type_flags` (`&self`) and `infer_to_multiple_types` take `List<'_, TypeId>`, so
  `List::from_slice(&local)` fits. `union_object_and_array_literal_candidates(&[TypeId]) -> Cow<[TypeId]>`.
- `infer_type_for_homomorphic_mapped_type`, `create_reverse_mapped_type` and `infer_reverse_mapped_type` answer
  `TypeId::NIL` for upstream's nil. `get_limited_constraint(t)` too.
- Free functions, `pub` at column 0 (`mod.rs` has the glob), the checker first because a type is an id:
  `compare_types_and_depth(c, t1, t2) -> isize`, `get_type_depth(c, t, max_depth)`, `get_type_list_depth(c, types,
  max_depth)` (these three take `&mut Checker`: `getTypeArguments` resolves), `get_inference_info_for_type(c, n, t)
  -> InferenceInfoId`, `get_single_type_variable_from_intersection_types(c, n, types)`,
  `tuple_types_definitely_unrelated(c, source, target)`, `new_inference_info(c, type_parameter)`,
  `clone_inference_info(c, info)`, `clear_cached_inferences(c, inferences)`, `has_inference_candidates(c, info)`,
  `has_inference_candidates_or_default(c, info)`, `has_type_parameter_default(c, tp)`,
  `has_overlapping_inferences(c, a, b)`. `new_inference_info`, `clone_inference_info` and `clear_cached_inferences`
  take `&mut Checker`; the four `has_*`, `get_inference_info_for_type`,
  `get_single_type_variable_from_intersection_types` and `tuple_types_definitely_unrelated` take `&Checker`.
- These only read and take `&self`: `is_tuple_type_structure_matching`, `is_type_closely_matched_by`,
  `get_combined_type_flags`, `is_from_inference_blocked_source`, `is_skip_direct_inference_node`,
  `get_mapper_from_context`. Every other method takes `&mut self`.

### Differences from upstream

- Stack tests, each the first statement of its function: `infer_from_types`, `infer_to_mapped_type` (false),
  `is_partially_inferable_type` (false), `get_combined_type_flags` (no flag), which
  `checker-relations-and-inference/data/recursion.txt` names, and two more whose recursion follows the structure of
  a type: `is_type_parameter_at_top_level` (false) and `get_type_depth` (0).
- `get_inferred_type`: an index outside `n.inferences`, where Go panics, is a fault and the error type.
- `put_inference_state` sets `inferences` to the nil list where upstream keeps `n.inferences[:0]`: nothing reads the
  list of a pooled state. The map and the two stacks keep their storage, as upstream's do.
- `invoke_once` and `infer_reverse_mapped_type` take the stack out of its record with `std::mem::take` for the call of
  `is_deeply_nested_type` and put it back, as `relater.rs` does.
- `infer_from_intra_expression_sites` ranges over a copy of the sites: upstream's `range` keeps the slice that the
  context had when the loop started, also when a nested call (the fixing mapper) sets the field to nil.
- `get_inferred_type`: `core.Some` and `core.Every` over candidate lists run over a copy of the list, and
  `core.Every(n.inferences, ...)` over the live list, which shows a write of `merge_inferences` as Go's `range` does.
  `n.compareTypes` is read once.
- `slices.SortFunc` of 391 is `sort_func` of `checker/utilities.rs` (Go's pattern-defeating quicksort, so the
  sequence of comparisons is upstream's): `mod slices` and `sort_func` are `pub(crate)` there since `657189599b`.
- The `choose` closure of `inferToTemplateLiteralType` takes the checker as its first parameter. Its `switch` is a
  run of `if` statements that return, in upstream's order. `constraint.Distributed()` is called once for both loops.
- `inferFromTypes`: `!(source.node != nil && target.node != nil)` of 232 is written `source.node == nil ||
  target.node == nil`. `n.priority` is read once in the block of 183-211, where nothing writes it.
- `isPartiallyInferableType` and `isTypeParameterAtTopLevel` are written with early returns in the order of
  upstream's `||` and `&&`.
- `hasTypeParameterDefault` of 1658 is the free function `has_type_parameter_default(c, tp)`; the method of the same
  name in `c36_properties_apparent_types.rs` is checker.go 22062. Both exist upstream.
- `inference.candidates = nil` is a new empty `Vec` (nil and empty are one value).

### Verified

No compiler has seen the file, and nothing ran a function of it. What was checked:

- `rustfmt --check --edition 2024 --config skip_children=true` on `inference.rs` and `utilities.rs`: exit 0.
- Scripts over the file: the 77 functions have upstream's names in upstream's order; each of the 75 imported names is
  used and no free name is used without an import; no two comment lines are adjacent; no `unwrap`, `expect`, `panic`,
  `unsafe` or index into a slice (the indexed stores are `Records` and `LinkStore`).
- Read against the definitions of the tree at `657189599b`, name, parameter order, receiver and result: every callee
  that the tree defines (`c20`, `c22`, `c28`, `c29`, `c31`, `c33`, `c34`, `c36`, `c37`, `c38`, `c40`, `c41`, `c42`,
  `c43`, `c44`, `c45`, `c47`, `c51`, `links.rs`, `mapper.rs`, `relater.rs`, `utilities.rs`, `types.rs`, the accessors
  of `ast/`, `core/core.rs`, `core/linkstore.rs`, `jsnum/`), and the fields and records of `c01_data.rs` and
  `c02_program_checker.rs`. `Map` and `LiveList` are used as the contract has them
  (`checker-data-model-contract/bottom-up/crate/src/tscore/golang.rs`).
- The calls that other files make into these functions (`c14`, `c20`, `c28`, `c33`, `c37`, `c50`, `jsx.rs`,
  `mapper.rs`, `relater.rs`) match the signatures by name, number and kind of arguments.
- Not checked: types and borrows (no compiler), clippy, and any result against upstream's baselines.

### What this file expects and the tree does not have

At `e9755c9f92`, called by their upstream names with upstream's parameter order:

- `c40`: `get_true_type_from_conditional_type(t)`, `get_false_type_from_conditional_type(t)`.
- `c45`: `distribute_index_over_object_type(object_type, index_type, writing) -> TypeId` (nil for upstream's nil).
- `c47`: the free functions `get_mapped_type_modifiers(c, t) -> MappedTypeModifiers` and
  `apply_string_mapping(a: Ast, symbol: SymbolId, str: &[u8])`, whose result is compared as `*str == *result`, so a
  `Vec<u8>`, a `Cow<[u8]>` or a `Text` fits.
- `c48`: `get_contextual_type(node, context_flags)`, `get_contextual_type_for_object_literal_method(node,
  context_flags)`.
- `crate::core::Map` (`make`, `is_nil`, `get`, `get_ok`, `set -> bool`, `clear`) and `crate::core::LiveList` (`NIL`,
  `is_nil`, `len`, `at`, `set -> bool`, `iter`), section C of the look-ahead.

## Checker: conditional types and import types (`checker/c40_type_nodes_conditional_tuples.rs`)

Commits `6469fdd56c`, `cad7795f23` and `a582ea9efb` (written by the job that commits the worktree). The 57 functions
of `checker.go` 24225-25124 in upstream order: the 12 that the file did not have (`getTypeFromConditionalTypeNode`,
`getConditionalType`, `getTailRecursionRoot`, `isSimpleTupleType`, `isDeferredType`, the true, false and inferred true
type of a conditional type, `getTypeFromImportTypeNode`, `getIdentifierChain`, `resolveImportSymbolType`,
`getGlobalImportMetaExpressionType`) at their upstream places among the 45 that it had, which are unchanged.
PORT_STATUS.md has the row.

NOT compiled by cargo: `checker/mod.rs` still names modules without a file. "Verified" below says what was checked
instead.

### How a caller writes the calls

- `get_type_from_conditional_type_node(node)` and `get_type_from_import_type_node(node)` answer a `TypeId` and keep it
  in the type node links, as the other `get_type_from_*_node`.
- `get_conditional_type(root: ConditionalRootId, mapper, for_constraint, alias: TypeAliasId) -> TypeId`: the root is
  the id of its record in `conditional_roots`, nil ids for upstream's nil mapper and alias.
- `get_tail_recursion_root(new_type, new_mapper) -> (ConditionalRootId, TypeMapperId)`: two nil ids for `nil, nil`.
- `get_true_type_from_conditional_type(t)`, `get_false_type_from_conditional_type(t)` and
  `get_inferred_true_type_from_conditional_type(t)` take the conditional type and keep their answer in its data.
- `is_deferred_type(t, check_tuples) -> bool`, `resolve_import_symbol_type(node, symbol, meaning) -> TypeId`,
  `get_global_import_meta_expression_type() -> TypeId`.
- These only read and take `&self`: `is_simple_tuple_type(node)` and `get_identifier_chain(node) -> Vec<NodeId>`.
  Every other method takes `&mut self`.

### Differences from upstream

- `getTypeFromConditionalTypeNode`: the root is a record of `conditional_roots` and `root.node` is the id of the
  conditional type node. `core.Filter` is `Checker::filter`: the list itself when nothing is removed (nil stays nil),
  else a new list that is not nil, so `outerTypeParameters != nil` asks the same.
- `getConditionalType`: `result` is the value of the loop, each `break` of upstream with its value. The conditions
  of 24500, 24506 and 24538 are the locals `definitely_false`, `include_true_type` and `definitely_true`, filled in
  upstream's order of evaluation with its short circuits (the permissive and restrictive instantiations are made only
  where upstream makes them). The fields of the root (`node`, `checkType`, `extendsType`, `inferTypeParameters`) are
  read once for an iteration, and the flags of the check type and of the inferred extends type once: nothing writes
  them after the record is made. `extraTypes != nil` is "not empty". The comment of 24454-24467 is one line, and the
  issue reference of 24480 is not kept.
- No budget was added to the loop of `getConditionalType`. Upstream counts to 1000 only the tail roots that have an
  alias. A root without one can be its own tail root (`interface I<T> { p: T extends object ? I<T>["p"] : never }`
  with `I<{}>["p"]`): every such iteration instantiates the check type with a mapper that is not nil, so the loop
  ends where `instantiate_type` reaches 5,000,000 instantiations and answers the error type, as upstream's does.
  `tsc` 6.0.2 reports TS2589 for those two declarations, about two seconds later than it answers for a file
  without them.
- `isDeferredType`: two `if` with a return for `a || b && c && core.Some(...)`.
- The three types of a conditional type: read with `as_conditional_type`, written with `as_conditional_type_mut`;
  `d.combinedMapper` is read once.
- `getTypeFromImportTypeNode`: `n.Argument.AsLiteralTypeNode().Literal` is read once. `i == len(nameChain)-1` is
  `i + 1 == len`. The `TODO` comment of 24709 and the `!!!` of 24737 are not kept.
- `getIdentifierChain`: a stack test is the first statement (the empty chain at the limit; the recursion is as deep
  as the qualified name is long). A node that is neither an identifier nor a qualified name ends the chain with the
  empty chain, after the cast has recorded its fault: upstream's type assertion panics there, and the left side of a
  failed cast is the nil node, on which the recursion would not end before the stack limit.
- `getGlobalImportMetaExpressionType`: `Parent` and `Members` of the two transient symbols are written with
  `update_symbol`.

### Verified

No cargo build has seen the file, and nothing ran a function of it. What was checked:

- `rustfmt --check --edition 2024`: exit 0, and the same for a copy of the file with short names in place of the two
  long message names of `get_type_from_import_type_node`.
- `sh round2-layer7-checker/c40-probe.sh`: `rustc` alone and `clippy-driver` alone (the clippy table of the workspace
  from `conventions-scratch/data/clippy_flags.txt`, the `clippy.toml` of the repository), exit 0 each, no output. The
  probe denies warnings, unused imports, variables, `mut` and assignments and `unreachable_pub`. It holds this file
  and `checker/types.rs` by `#[path]`, the leaf files they stand on by `#[path]` (as the probe of `c20` above), and a
  stand-in for every other name. `c40-probe-gen.py` reads from this file what it names (the methods of the checker
  and of `Ast` that it calls, the fields of the checker that it reads, the names it imports) and reads each signature
  from the file of the tree that defines the function, and each field type from `checker_fields!`: 76 methods of the
  checker from 27 files, 11 free functions of `checker/`, 26 methods of `Ast`, 15 free functions of `ast/`, `or_else`
  of `core/core.rs`, `declaration_name_to_string` of `scanner/utilities.rs`, 32 fields, 13 node records, `Symbol`,
  `JSDeclarationKind`, `CacheHashKey`, `Targets`, and of `c01_data.rs` `InferenceContext`,
  `IntraExpressionInferenceSite`, `CachedTypeKey` and six flag sets. Written by hand there: the two callees of the
  last section, `core::Map` and `core::LiveList` after the contract, `StackCheck`, `ScriptTarget`, `PseudoBigInt`,
  `evaluator::Result`, `Fallback`, `ListItem`. A copy of the file with an unused import and an unused variable gave
  the two errors.
- Scripts over the file: the 57 functions have upstream's names in upstream's order
  (`round2-layer7-checker/ranges.py`: 57 in the file, 0 nowhere); no two comment lines are adjacent; no `unwrap`,
  `expect`, `panic`, `todo`, `unimplemented`, `unreachable` or `unsafe`; every `[...]` indexes a store of records or
  a link store of the checker.
- Read against the tree at `a582ea9efb`: the calls that other files make into the 12 match by name, number and order
  of arguments (`c29` 328-329, `c37` 725 and 730, `c38` 106 and 108, `c50` 147 and 155, `c52` 89, `inference.rs`
  804-812, 2557 and 2561, `nodebuilderimpl.rs` 4713 and 4715, `relater.rs` 5837-5850, 6255, 6270 and 6582-6594).
- Not checked: the two callees that have no definition, the `core::Map` of the tree (no file defines it), clippy and
  rustc on the real crate, and any result against upstream's baselines.

### What this file expects and the tree does not have

At `a582ea9efb`, called by their upstream names with upstream's parameter order:

- `c17`: `get_instantiation_expression_type(expr_type, node) -> TypeId` (10750), from `resolve_import_symbol_type`,
  and `check_expression_with_type_arguments(node) -> TypeId` (10727), from `get_type_from_type_query_node`, which
  the file had.
- `crate::core::Map` as the contract has it (`make`, `get`, `set` with its `bool`, and `Default` for the nil map),
  for `cached_types`, `tuple_types` and the instantiations of a conditional root and of a tuple target.

## Checker: name resolution hooks (`checker/c04_name_resolution_hooks.rs`)

Commits `cad7795f23` and `f5d129e53c` (written by the job that commits the worktree). The file holds checker.go
1505-2200 whole and in upstream order: the 30 functions of the layer N-DIAG (`symbolReferenced` 1505 to `addTypeOnlyDeclarationRelatedInfo`
2174) before `get_symbol` (2182, layer N-RESOLVE), which was there and did not change. PORT_STATUS.md has the rows.

NOT compiled by cargo: `checker/mod.rs` still names modules without a file (`c16`, `c18`, `c19`, `emitresolver` at
`f5d129e53c`). "Verified" below says what was checked instead.

### How a caller writes the calls

- The eight functions that `createNameResolver` and `createNameResolverForSuggestion` hand to the name resolver are
  methods on `&mut self` with the parameters of the fields of `binder/nameresolver.rs` 14-27, so `Checker::name`
  coerces to the function pointer: `get_symbol` and `get_suggestion_for_symbol_name_lookup(symbols: SymbolTableId,
  name: &[u8], meaning) -> SymbolId`, `symbol_referenced(symbol, meaning)`, `get_requires_scope_change_cache(node) ->
  Tristate`, `set_requires_scope_change_cache(node, value)`,
  `check_and_report_error_for_invalid_initializer(error_location, name: &[u8], property_with_invalid_initializer,
  result: SymbolId) -> bool`, `on_failed_to_resolve_symbol(error_location, name: &[u8], meaning,
  name_not_found_message: MessageId)` and `on_successfully_resolved_symbol(error_location, result, meaning,
  last_location, associated_declaration_for_containing_initializer_or_binding_name, within_deferred_context)`.
- `get_spelling_suggestion_for_name(name: &[u8], symbols: &[SymbolId], meaning) -> SymbolId`: the candidates are a
  slice where upstream takes a sequence, so `properties.as_slice()` and `&symbols` of a `Vec` fit. The nil symbol is
  "no suggestion".
- `get_type_only_alias_declaration(symbol) -> NodeId` and `get_type_only_alias_declaration_ex(symbol, meaning) ->
  NodeId` (nil for none); the second has the shape of the hook `get_type_only_alias_declaration` of
  `binder/referenceresolver.rs` 24. `get_immediate_aliased_symbol(symbol) -> SymbolId`.
- `add_type_only_declaration_related_info(diagnostic: DiagnosticId, type_only_declaration: NodeId, name: &[u8]) ->
  DiagnosticId`: the diagnostic it was given, with the related information when the declaration is not nil.
- `is_block_scoped_name_declared_before_use(declaration, usage) -> bool`,
  `is_used_in_function_or_instance_property(usage, declaration, decl_container) -> bool`,
  `check_resolved_block_scoped_variable(result, error_location)`, `maybe_mapped_type(node, symbol) -> bool`,
  `get_suggested_symbol_for_nonexistent_symbol(location, outer_name: &[u8], meaning) -> SymbolId` and the six other
  `check_and_report_error_for_*` with upstream's parameters and a name as `&[u8]`: all on `&mut self`.
- `get_suggested_lib_for_non_existent_name(name) -> &'static [u8]` on `&self`: the empty text for no lib.
- Free functions, `pub fn` at column 0: `is_primitive_type_name(s)`, `is_es2015_or_later_constructor_name(s)`,
  `get_primitive_type_alias_suggestions(a, symbols) -> Vec<SymbolId>`,
  `is_immediately_used_in_initializer_of_block_scoped_variable(a, declaration, usage, decl_container)`,
  `is_same_scope_descendent_of(a, initial, parent, stop_at)` and
  `is_property_immediately_referenced_within_declaration(a, declaration, usage, stop_at_any_property_declaration)`.
  `checker/mod.rs` has no glob for the file, so the six are `crate::checker::c04_name_resolution_hooks::name`:
  upstream names them in this range only, and this file is their one caller.

### Differences from upstream

- `primitiveTypeAliasSuggestions` (1751) is a map of the process that holds six symbols. A symbol lives in the store
  of one checker here, and the checker has no field for them: `PRIMITIVE_TYPE_ALIAS_SUGGESTIONS` is the table of the
  six pairs of names, and `get_primitive_type_alias_suggestions` makes a transient symbol (`TypeAlias | Transient`,
  by `Ast::new_symbol`, which `symbolCount` does not count, as upstream's `&ast.Symbol{}`) for each global type that
  the table of the request has. So two requests answer two symbols of one name where upstream answers one symbol
  twice. A suggestion is read for its name, its flags and its declarations (it has none) by
  `onFailedToResolveSymbol`, the one caller of `getSuggestedSymbolForNonexistentSymbol`, and nothing keeps it.
- `getSpellingSuggestionForName` (1806): upstream's two callbacks close over the checker, one to resolve an alias
  and one to compare two symbols. Here both borrow it from one `RefCell` for the time of their call
  (`try_borrow_mut`, `try_borrow`), so `core::get_spelling_suggestion_exported` runs them in upstream's order: the
  name of a candidate is asked before the candidate is compared, and `ast.GetSymbolId` gives its ids in that order.
  A callback that finds the checker taken, which the order of the calls rules out, records `StoreBusy` and answers
  the nil symbol or 0.
- `getSuggestionForSymbolNameLookup` (1781): `maps.Values(symbols)` is the table in its own order, and the
  suggestions of the primitive types follow in the order of the table of names, where the order of both Go maps is
  random. The candidates are collected before the first is looked at, where upstream's sequences are lazy.
- `getTypeOnlyAliasDeclarationEx` (2149): the loop has a budget (`LoopGuard`, `loop_limit`), as the alias loop of
  `resolve_entity_name` has. Its end depends on checker state: two aliases that each have another meaning and
  resolve to each other would never get the meaning that is asked for (read in the code, not seen in a run).
- `isUsedInFunctionOrInstanceProperty` (2017) calls itself for the decorator of a method or of a parameter: the
  entry tests the stack, records `StackLimit` and answers false. `isBlockScopedNameDeclaredBeforeUse` calls itself
  once at most (a binding element, then its variable declaration) and has no test.
- Panics and asserts are faults with a fallback: 1905 (`checkResolvedBlockScopedVariable` without a block-scoped
  declaration) reports nothing; 2167 (`getImmediateAliasedSymbol` without a declaration) answers the nil symbol and
  leaves the links; the asserts of 1620, 1895, 1917 and 2162 record and go on. `typeFeatures[0]` of 1742 answers
  the empty text for an empty list, which no entry of the feature map is.
- A node or a symbol that is nil reads as the zero value where upstream dereferences nil: `errorLocation.Flags` of
  1847, `errorLocation.Parent` of 1576, 1636 and 1671, and the declaration that 1950 passes on when a binding
  element has no variable declaration above it (the two files then differ and the answer is true).
  `suggestion.ValueDeclaration` of 1598 is read before the test for nil, through the nil symbol.
- The comment of upstream that names work to do (1559) is not carried over.

### Verified

Cargo built nothing and no test ran a function of the file. What was checked:

- `sh round2-layer7-checker/c04-probe.sh`, with `rustc` and `clippy-driver` alone (no cargo), on the working tree
  when its last commit was `f5d129e53c`: no error, no warning, no finding. One crate of 1,070 lines compiles the
  real file by `#[path]` beside the real `diagnostics/`, `internal.rs`,
  `core/{arena,golang,linkstore,text,tristate}.rs`, `collections/{set,ordered_map,ordered_set}.rs`,
  `ast/{flags,ids,checkflags,symbolflags,nodeflags,kind_generated,diagnostic}.rs` and
  `checker/{types,c01_data}.rs`, with `#![deny(warnings)]` and the deny set of the workspace, then the clippy table
  of the workspace with `clippy.toml`. Every other name is a stand-in whose signature `c04-probe-gen.py` reads from
  the file of the tree that defines it, and whose body never returns: the 29 methods of the checker that the file
  calls, 45 free functions of `ast/`, 7 of `checker/utilities.rs`, 24 methods of `Ast`,
  `get_spelling_suggestion_exported` and `declaration_name_to_string`. `every`, `filter`, `find`, `if_else` and
  `concatenate_seq` are the text of `core/core.rs`. Written by hand: `Map` and `LiveList` (as the contract has
  them), the view of a source file with its one field `global_exports`, and the three methods of `c18` below.
- The same crate holds the consumers: `create_name_resolver` and `create_name_resolver_for_suggestion` as
  `c03_init.rs` has them, against the struct `NameResolver` as `binder/nameresolver.rs` has it (the eight
  functions coerce to its fields), the hook of `binder/referenceresolver.rs` 24, and the calls of `c44` 1056, `c09`
  1082, `jsx.rs` 946, `c25` 352, `c46` 495-503 and 978, `c27` 121 and 164, `c23` 177, `c52` 61, `c10` 927 and 987,
  `c13` 161-221, `flow.rs` 2826 and `c39` 512 and 584, written in their shape.
- A type error and a `clone` of an id, each put into a copy of the file, are reported by the two steps of the probe.
- `python3 round2-layer7-checker/c04-callseq.py`: the 31 functions have upstream's names in upstream's order, and
  each calls the same methods of the checker as upstream's body, the same number of times; the one difference is
  `compare_symbols`, which upstream passes as a value.
- `rustfmt --check --edition 2024`; no two comment lines are adjacent; no `unwrap`, `expect`, `panic`, `todo`,
  `unimplemented`, `unreachable`, `unsafe` or `allow(`; the 31 messages are constants of
  `diagnostics/diagnostics_generated.rs`.
- Read against upstream statement by statement, and each callee at its definition in the tree.
- Not checked: any result against upstream's baselines or a run of tsgo; the bodies of the stand-ins; what cargo
  and clippy say of the file in the real crate.

### What this file expects and the tree does not have

At `f5d129e53c`: three methods of the checker of the range of `c18` (no file), called by their upstream names with
upstream's parameter order: `get_this_container(node, include_arrow_functions: bool,
include_class_computed_property_name: bool) -> NodeId` (12279; `c52_symbol_at_location.rs` calls it the same way),
`check_and_report_error_for_extending_interface(error_location) -> bool` (11756) and
`is_in_ambient_or_type_node(node) -> bool` (11328, the method that 1937 calls: `utilities.rs` has the free function
of `utilities.go` 1058, which 5947 calls). The receiver can be `&self` or `&mut self`.

## Checker: contextual properties, the two context stacks and context sensitivity (`checker/c50_contextual_properties_inference_context.rs`)

Commit `e9755c9f92` (written by the job that commits the worktree). The file holds `checker.go` 30674-31095 whole and
in upstream order (layer E-CTX): the 25 methods of the checker from `getTypeOfPropertyOfContextualType` to
`getInferenceContext`, and `ObjectLiteralDiscriminator` of 30836 with its three methods. No function is a stand-in.
PORT_STATUS.md has the row.

NOT compiled by cargo when this was written: it does not reach the file while a module of `checker/mod.rs` has no
file. "Verified" below says what was checked instead.

### How a caller writes the calls

- `get_type_of_property_of_contextual_type(t, name: &[u8]) -> TypeId` and
  `get_type_of_property_of_contextual_type_ex(t, name, name_type)`: the nil type for no type, and `TypeId::NIL` for
  upstream's nil `nameType`. The name need not live as long as the checker.
- `get_apparent_type_of_contextual_type(node, context_flags)`,
  `instantiate_contextual_type(contextual_type, node, context_flags)` (the nil type for a nil contextual type) and
  `instantiate_instantiable_types(t, mapper: TypeMapperId)` answer a `TypeId`.
- The stack of contextual types: `push_contextual_type(node, t, is_cache)`, `push_cached_contextual_type(node)`,
  `pop_contextual_type()`, and `find_contextual_node(node, include_caches) -> isize`, -1 for no entry: the entry is
  `contextual_infos.get(index)`, as `jsx.rs` 357 reads it.
- The stack of inference contexts: `push_inference_context(node, context: InferenceContextId)` (the nil id is
  upstream's nil context), `pop_inference_context()`, `get_inference_context(node) -> InferenceContextId`, nil for
  none and for an entry that was pushed with the nil context.
- `ObjectLiteralDiscriminator { props: List<'a, NodeId>, members: List<'a, SymbolId> }` is a `Discriminator<'a>` of
  `relater.rs`: `discriminate_type_by_discriminable_items(t, &mut discriminator)` takes it. `checker/mod.rs` has the
  glob of the module, and the record is its one `pub` name.
- `append_contextual_property_type_constituent(types: Vec<TypeId>, t) -> Vec<TypeId>` takes the list and gives it
  back, as `append_signatures` of `c35` does.
- These only read and take `&self`: `is_context_sensitive`, `is_context_sensitive_function_like_declaration`,
  `has_context_sensitive_return_expression`, `has_context_sensitive_yield_expression`,
  `is_possibly_discriminant_value`, `find_contextual_node`, `get_inference_context` and
  `append_contextual_property_type_constituent`. Every other method takes `&mut self`.

### Differences from upstream

- `ObjectLiteralDiscriminator` has no field `c`: the checker is a parameter of `name` and `matches`, as the trait of
  `relater.rs` has them and as `TypeDiscriminator` does.
- `c.getStringLiteralType(name)` (30733, 30777) needs a text of the checker. The name is looked up in
  `string_literal_types` first and copied into the arena only when it has no literal type yet, as
  `get_applicable_index_info_for_name` of `c33` does. The type is the same one either way.
- Stack tests, each the first statement of its function, at the four entries of
  `checker-expressions-calls-flow/top-down/data/tested_entries.tsv` that are in this range:
  `is_excluded_mapped_property_name`, `is_possibly_discriminant_value` and `is_context_sensitive` (false), and
  `instantiate_instantiable_types` (the error type).
- `popContextualType` and `popInferenceContext` index `len-1` of an empty stack (`fallbacks.tsv` of that research):
  a fault and a return. The write of the zero entry before the re-slice (31005, 31084) has no counterpart, because
  `Vec::pop` removes the entry.
- Reads that upstream dies of and that read as zero here: `node.Symbol().Members` of an object literal without a
  symbol (30899) is the nil table, so every optional member counts as absent; a nil result of `mapTypeEx` at 30825
  reads the zero record of the store, which counts the read.
- `isExcludedMappedPropertyName`: the three operands of `&&` (30749-30751) are three tests with early returns, in
  upstream's order of evaluation, because each needs the checker mutably.
- `getApparentTypeOfContextualType`: the `switch` of 30824 is two `if` after one read of the union flag.
- `core.Some`, `core.Find` and `core.Map` are `core::some`, `core::find` (the nil node for none) and `core::map` into a
  vector; `core.Some` over the live list of inferences is `iter().any`; `core.Filter` is `Checker::filter`, whose
  callback gets the checker. `indexInfoCandidates = nil` is `clear()`. The test of the length at 30708-30714 is a
  `match` on the slice.
- `prop.Initializer()` of 30858-30860 and `statement.Expression()` are read as often as upstream reads them, but for
  the initializer of 30860, which is the local of 30858.
- Comments: a comment of several lines is one line, and the reference to an issue number (30959) is not carried over.

### Verified

No cargo build has seen the file, and nothing ran a function of it. What was checked, last on the tree of
`f5d129e53c`:

- `rustfmt --check --edition 2024`: exit 0.
- A probe of the file with `rustc` alone and with `clippy-driver` alone: exit 0 each, no warning and no finding.
  `round2-layer7-checker/c50-probe-gen.py` writes `c50-probe.rs`, and `c50-probe-clippy.sh` has the clippy table of
  the workspace and its `clippy.toml`. The probe denies warnings, unused imports, variables, `mut` and assignments and
  `unreachable_pub`. It holds this file, `checker/types.rs` and `checker/c01_data.rs` by `#[path]`, the leaf files
  they stand on by `#[path]` (`diagnostics/`, `core/{arena,golang,linkstore,text,tristate}.rs`,
  `collections/{set,ordered_map,ordered_set}.rs`, `jsnum/jsnum.rs`,
  `ast/{flags,ids,checkflags,symbolflags,modifierflags,nodeflags,kind_generated,diagnostic}.rs`), and stand-ins for
  every other name. The script reads the signature of a stand-in from the file of the tree that defines the function,
  and the body of a stand-in never returns: 81 functions (17 methods of `Ast` and 13 free functions of `ast/`, 3 of
  `core/core.rs`, `jsnum::from_string`, 40 methods of the checker from 17 files and 7 free functions of `checker/`),
  with the `Symbol` record, two node records, `FunctionFlags` and the `Discriminator` trait copied from their files.
  Written by hand in the probe: the two callees of the last section, `core::Map` and `core::LiveList` with the
  signatures of the contract, `StackCheck`, `CacheHashKey`, `ScriptTarget`, `PseudoBigInt`, `evaluator::Result`,
  `Fallback`, `ListItem`, and a `Checker` of the 22 fields that the three files read, with the types of
  `c02_program_checker.rs`. `Ast` and `Checker` are invariant in their lifetime there, as in the tree. So the types,
  the borrows and the lints of every statement of the file are checked against the data model and the signatures of
  the tree as they were at the run.
- The probe finds what it should: a copy of the file with two swapped arguments, an unused variable and a nested
  `&mut self` call gave E0308, the unused variable and E0499, and a copy that returns a `let` binding gave clippy's
  `let_and_return`.
- Three callees had no definition when the file was written and got one since (`substitute_indexed_mapped_type` in
  `c47`, `get_true_type_from_conditional_type` and `get_false_type_from_conditional_type` in `c40`): their signatures
  are what the file expected, and the probe now reads them from the tree.
- `python3 round2-layer7-checker/ranges.py c50_contextual_properties_inference_context`: 28 of 28 functions of the
  range have a `fn` of their name in the file. `python3 round2-layer7-checker/globs.py --names`: the module is no
  longer a glob without a `pub` name, no `pub` name of it is a name of another globbed module, and
  `ObjectLiteralDiscriminator` is no longer among the names that files import and no module exports. No other file
  of the crate defines a function of one of the 25 names.
- `python3 round2-layer7-checker/c50-callsites.py`: 90 calls of the 25 methods in 9 files, 44 of them outside the
  file (`c14` 14, `jsx.rs` 10, `c20` 8, `relater.rs` 5, `c15` 3, `c52` 2, `c39` 1, `c44` 1), give as many arguments as
  the definitions take, and the one literal of `ObjectLiteralDiscriminator` (`jsx.rs` 457) names its two fields. Each
  call outside the file was also read against the signature, with the type of what it passes.
- Read against upstream statement by statement. No two comment lines are adjacent; no `unwrap`, `expect`, `panic`,
  `todo`, `unimplemented`, `unreachable`, `unsafe` or slice index: every `[...]` indexes a store of records or a link
  store of the checker.
- Not checked: the real crate through cargo; the two callees that have no definition; the `Map` and the `LiveList`
  of the tree (no file defines them: the probe has the contract's, and the lookup of a name that does not live as
  long as the checker needs a `Map` that is covariant in its key, which a map over `bun_collections::HashMap` is);
  any result against upstream's baselines.

### What this file expects and the tree does not have

At `f5d129e53c`, two callees, each called by its upstream name with upstream's parameter order, as the other callers
of the tree write them:

- `c48`: `get_contextual_type(node, context_flags) -> TypeId` (29466) and
  `get_contextual_type_for_object_literal_method(node, context_flags) -> TypeId` (30087), the nil type for none.
- `crate::core::Map` as the contract has it (`get` and `set` with its `bool`), for `string_literal_types` and
  `discriminated_contextual_types`, and `crate::core::LiveList` (`iter`), for the inferences of a context.

## Checker: function expressions, contextual signatures and name collisions (`checker/c16_function_expressions_collisions.rs`)

Commit `f0097bcc09` (written by the job that commits the worktree). The file holds `checker.go` 10133-10705 in upstream
order (layers E-CORE, E-FUNC and E-COLLIDE): 28 of the 29 methods of the range, from `checkParenthesizedExpression` to
`checkClassNameCollisionWithObject`. The 29th, `checkClassExpressionExternalHelpers` (10171), is in
`c46_mark_references.rs` since round 1: `check_class_expression` calls it there, and a second definition would not
compile. No function is a stand-in. PORT_STATUS.md has the row.

NOT compiled: cargo does not reach the checker while a module of `checker/mod.rs` has no file, and no other compiler
has seen the file. "Verified" below says what was checked instead.

### How a caller writes the calls

- `check_parenthesized_expression(node, check_mode)`, `check_class_expression(node)` and
  `check_function_expression_or_object_literal_method(node, check_mode)` answer a `TypeId`.
  `check_function_expression_or_object_literal_method_deferred(node)` and `check_class_expression_deferred(node)` are
  what `check_deferred_node` calls.
- `get_contextual_signature(node) -> SignatureId` and `get_contextual_call_signature(t, node) -> SignatureId`: nil for
  none. `create_union_signature(sig, union_signatures: List<'a, SignatureId>) -> SignatureId`: the list becomes the
  composite of the new signature. `get_intersected_signatures(signatures: &[SignatureId]) -> SignatureId`.
- `get_first_transformable_static_class_element(node) -> NodeId`, nil for none.
- `check_collisions_for_declaration_name(node, name: NodeId)`: a nil name returns at once.
  `need_collision_check_for_identifier(node, identifier: NodeId, name: &[u8]) -> bool`.
  `set_node_links_for_private_identifier_scope(node)`.
- `infer_from_annotated_parameters_and_return(sig, context, inference_context: InferenceContextId)`,
  `assign_contextual_parameter_types(sig, context)`, `assign_non_contextual_parameter_types(signature)`,
  `assign_parameter_type(parameter: SymbolId, contextual_type)` (`TypeId::NIL` is upstream's nil type) and
  `assign_binding_element_types(pattern, parent_type)`.
- These only read and take `&self`: `get_first_transformable_static_class_element` and
  `need_collision_check_for_identifier`. Every other method takes `&mut self`.

### Differences from upstream

- Stack test, the first statement of `assign_binding_element_types` (the one entry of the range in
  `checker-expressions-calls-flow/top-down/data/tested_entries.tsv`): `StackLimit` and a return.
- `getFirstTransformableStaticClassElement`: the `else if` of 10160 is a second `if` after the return of 10159. Both
  arms return the member, and clippy's `if_same_then_else` (denied in the workspace) rejects two arms with one body.
- `getContextualCallSignature`: `core.Filter` is `core::filter` over the slice with a closure that borrows the checker,
  so nothing is allocated in the arena for a list that is counted and passed on, as `c15` 2214 does.
- `getContextualSignature`: `signatureList` is a `Vec` that is copied into the arena once, when the union signature is
  made. `c.compareTypesIdentical` is `&mut Checker::compare_types_identical`, as `c35` 984 passes it. The `switch` over
  the length (10375) is a `match`, and the `switch` of `getIntersectedSignatures` (10410) an `if` chain in upstream's
  order.
- `createUnionSignature`: `&CompositeSignature{...}` is a record of `composite_signatures`.
- `c.contextFreeTypes[node]` with its ok (10215) is `get_ok`, and the write of 10222 is `set` with `map_set`.
- The operands of `&&` that need the checker mutably are blocks (10214, 10689), in upstream's order of evaluation.
- The two deferred diagnostics (10632, 10666) are boxed closures that get the checker, as `add_deferred_diagnostic`
  takes them.
- `sig.typeParameters` and `sig.thisParameter` are written into the signature of the function expression (10445,
  10451), and `context.thisParameter` is read again at each place where upstream reads it.
- Reads that upstream dies of and that read as zero here: the inferences and the non-fixing mapper of a nil inference
  context (10261, 10264, 10282) are those of the zero record of the store, which counts the read; a parameter symbol
  without a value declaration (10332, 10459) reads the nil node, which has no type node (where 10462 then asks for its
  initializer, `Ast::initializer` records the fault); `node.FunctionLikeData()` of a node without it (10233) is no
  full signature, as `c07` 56 reads it; the last parameter of a signature that is flagged as having a rest parameter
  and has no parameter (10476) is the nil symbol.
- Comments: a comment of several lines is one line.

### Verified

No compiler has seen the file, and nothing ran a function of it. What was checked, on the tree of `f0097bcc09`:

- `rustfmt --check --edition 2024`: exit 0 (the file parses and is formatted; rustfmt leaves the statements alone
  whose message name is longer than the line).
- `python3 round2-layer7-checker/ranges.py c16_function_expressions_collisions`: 28 of the 29 functions of the range
  have a `fn` of their name in the file, one only elsewhere (`c46`), none nowhere.
- Scripts over the file: the 28 functions are in upstream's order; each of the 66 imported names is used and no free
  function is called without an import; no two comment lines are adjacent; no `unwrap`, `expect`, `panic`, `todo`,
  `unimplemented`, `unreachable`, `unsafe` or `allow(`, and every `[...]` indexes a store of records or a link store of
  the checker; the 8 messages are constants of `diagnostics/diagnostics_generated.rs`.
- `python3 round2-layer7-checker/c16-callseq.py`: each of the 28 functions calls the same methods of the checker as
  upstream's body, the same number of times (`list_of`, `map_set`, `type_types` and `value_symbol_links_get` stand for
  a slice that is kept, a map write, `t.Types()` and `valueSymbolLinks.Get`, and are not counted).
- Read at their definitions in the tree, name, receiver, parameter order and types, and result: the 55 methods of
  the checker that the file calls and the tree defines (`c05`, `c06`, `c07`, `c08`, `c09`, `c13`, `c14`, `c21`, `c22`,
  `c28`, `c31`, `c33`, `c34`, `c35`, `c36`, `c37`, `c38`, `c41`, `c46`, `c50`, `grammarchecks.rs`, `inference.rs`,
  `links.rs`, `relater.rs`, `types.rs`, `c02_program_checker.rs`), the 37 free functions of `ast/`, `checker/`,
  `core/core.rs` and `scanner/utilities.rs`, the 18 accessors of `Ast`, `Program::get_emit_module_format_of_file`,
  `CompilerOptions::get_use_define_for_class_fields`, `ModuleKind::string`, and the fields, records, flags and stores
  of the data model (`c01_data.rs`, `c02_program_checker.rs`, `types.rs`, `core/linkstore.rs`, and `List`, `LiveList`
  and `Map` with `get_ok` and `set` of `core/golang.rs`).
- The 20 calls that 10 other files make into these functions (`c05` 309 and 315, `c06` 135, 303 and 541, `c07` 23 and
  62, `c09` 69, `c10` 36, 139 and 469, `c11` 318 and 470, `c14` 725-728, `c20` 1099 and 1198, `c35` 642, `c46` 60) match
  the signatures by name, number and kind of arguments, and by what they do with the result.
- Not checked: types, borrows and lints by a compiler (no rustc, no clippy), and any result against upstream's
  baselines.

### What this file expects and the tree does not have

At `f0097bcc09`, two callees, each called by its upstream name with upstream's parameter order, as `c07`, `c31` and
`c34` call them:

- `c34` (its range holds them, its file does not): `get_return_type_from_body(node, check_mode) -> TypeId` (20240) and
  `unwrap_return_type(return_type, function_flags: FunctionFlags) -> TypeId` (20502), the nil type for upstream's nil.

What waits in another file: `c46_mark_references.rs` 31 says that `check_class_expression_external_helpers` is kept
there until the file of its upstream range exists. That file exists now, and the function is still in `c46`.

## Checker: assertions and binary operators (`checker/c19_assertions_binary_operators.rs`)

Commit `48da5c6a89` (written by the job that commits the worktree). 32 of the 34 functions of `checker.go`
12378-13233 (layers E-CORE for the two assertion functions, E-OPER for the rest), in upstream order, and
`PredicateSemantics` of 12968. `getExactOptionalUnassignableProperties` and `isExactOptionalPropertyMismatch`
(13208-13219) are in `relater.rs`, as before. PORT_STATUS.md has the row.

NOT compiled by cargo when it was written: the crate did not compile (modules of `checker/mod.rs` without a file).
"Verified" below says what was checked instead.

### How a caller writes the calls

- `check_assertion(node, check_mode)`, `check_binary_expression(node, check_mode)` and
  `check_binary_like_expression(left, operator_token, right, check_mode, error_node)` answer a `TypeId`; a nil error
  node is `NodeId::NIL`. `check_assertion_deferred(node)` answers nothing.
- `check_destructuring_assignment(node, source_type, check_mode, right_is_this) -> TypeId`,
  `check_object_literal_assignment(node, source_type, right_is_this)`,
  `check_object_literal_destructuring_property_assignment(node, object_literal_type, property_index: isize, all_properties: NodeListId, right_is_this)`,
  `check_array_literal_assignment(node, source_type, check_mode)`,
  `check_array_literal_destructuring_element_assignment(node, source_type, element_index: isize, element_type, check_mode)`
  and `check_reference_assignment(target, source_type, check_mode)`: `TypeId::NIL` is upstream's nil result, and the
  nil list is `NodeListId::NIL`.
- `report_operator_error(left_type, operator: Kind, right_type, error_node, is_related)`: the callback is
  `Option<&mut dyn FnMut(&mut Checker<'a>, TypeId, TypeId) -> bool>`, `None` for upstream's nil. A caller writes
  `Some(&mut |c: &mut Checker<'a>, left: TypeId, right: TypeId| ..)`. `report_operator_error_unless(.., types_are_compatible)`
  and `get_base_types_if_unrelated(left_type, right_type, is_related) -> (TypeId, TypeId)` take the callback as
  `&mut dyn FnMut(&mut Checker<'a>, TypeId, TypeId) -> bool`. The callback gets the checker, as the one of `some_type`.
- `check_assignment_operator(left, operator: Kind, right, left_type, right_type)`,
  `check_arithmetic_operand_type(operand, t, diagnostic: MessageId, is_await_valid) -> bool`,
  `check_for_disallowed_es_symbol_operand(left, right, left_type, right_type, operator: Kind) -> bool`,
  `check_nan_equality(error_node, operator: Kind, left, right)`, `check_truthiness_of_type(t, node) -> TypeId`,
  `check_instance_of_expression(left, right, left_type, right_type, check_mode) -> TypeId`,
  `check_in_expression(left, right, left_type, right_type) -> TypeId`,
  `check_reference_expression(expr, invalid_reference_message, invalid_optional_chain_message) -> bool`.
- `PredicateSemantics` is a flag set of `checker_flags!`: `NONE`, `ALWAYS`, `NEVER`, `SOMETIMES`.
  `get_syntactic_truthy_semantics(node)` and `get_syntactic_nullishness_semantics(node)` answer it. `checker/mod.rs`
  has no glob for the file, so the name is `checker::c19_assertions_binary_operators::PredicateSemantics`; only this
  file names it, as upstream.
- These only read and take `&self`: `get_suggested_boolean_operator`, `is_side_effect_free`, `is_indirect_call`. Every
  other method takes `&mut self`.

### Differences from upstream

- Stack tests, each the first statement of its function, at the four entries of
  `checker-expressions-calls-flow/top-down/data/tested_entries.tsv` that are in this range:
  `check_destructuring_assignment` (the error type), `get_syntactic_truthy_semantics` and
  `get_syntactic_nullishness_semantics` (`SOMETIMES`: the zero value would report TS2872, TS2873, TS2869 or TS2871)
  and `is_side_effect_free` (false, no TS2695).
- The panic that closes the switch of `checkBinaryLikeExpression` (12640) is `fail_detail` with the operator kind, and
  the error type, as `fallbacks.tsv` has it.
- `rhsEval.Value.(jsnum.Number)` (12498) is a match on `LiteralValue::Number`, and the number that the message of
  TS6807 prints is `Number::string`, which is what `%v` prints of a `jsnum.Number`.
- The comma operator (12625-12637): the parse diagnostics of the file are ids of the store of its parser
  (`SourceFile::diagnostics` and `SourceFile::diagnostic_store`); a file without a store has no diagnostic.
- `ast.NewDiagnostic` of 12385 is `diagnostic_store.new_diagnostic`, as `grammarchecks.rs` writes it.
- `checkDestructuringAssignment`: `target` is the value of the `if`, where upstream assigns it in both branches, and
  `c.strictNullChecks && !c.hasTypeFacts(c.checkExpression(initializer), ..)` is two nested tests, so that the
  initializer is checked only under `strictNullChecks`, as upstream's `&&` has it.
- `properties[propertyIndex]` (12690) and `elements.Nodes[elementIndex]` (12756) are `List::at`: the nil node outside
  the list, where upstream panics. The callers pass an index of the list.
- `checkArithmeticOperandType`, `checkForDisallowedESSymbolOperand` and the result type of the arithmetic operators:
  a nested call of the checker in an argument is a `let` before the call, in upstream's order of evaluation. The
  `switch` over conditions of 12905 is an `if` with an `else if`.
- `reportOperatorError`: the two tests of `isRelated != nil` are `as_deref_mut` and a move of the option.
- `checkNaNEquality`: the suggestion is built with `concat`, and `err.AddRelatedInfo` is
  `diagnostic_store.add_related_info`.
- `hasEmptyObjectIntersection`: the second operand of `&&` is a block, so that `getBaseConstraintOrType` is asked only
  for an intersection.
- The reference to an issue number in the comment of 12567-12569 is not carried over.

### Verified

Cargo has not compiled the file, and nothing ran a function of it. What was checked:

- `rustfmt --check --edition 2024`: exit 0. rustfmt leaves a statement alone when a token of it is longer than the
  line (the calls with the long message names).
- `sh round2-layer7-checker/c19-probe.sh` (rustc alone) and `sh round2-layer7-checker/c19-probe-clippy.sh`
  (clippy-driver with the clippy table of the workspace and its `clippy.toml`): exit 0 each, no warning and no finding.
  `c19-probe-gen.py` writes the probe: this file, `checker/types.rs` and `checker/c01_data.rs` by `#[path]`, the real
  packages `diagnostics`, `core`, `collections`, `jsnum`, `stringutil` and `tspath` by `#[path]`,
  `ast/{flags,ids,checkflags,symbolflags,modifierflags,nodeflags,kind_generated,diagnostic}.rs` by `#[path]`, and
  stand-ins for every other name. The probe denies warnings, unused imports, variables, `mut` and assignments and
  `unreachable_pub`. The script reads the signature of a stand-in from the file of the tree that defines the function
  at the time of the run, and the body of a stand-in never returns: 21 methods of `Ast` and 31 free functions of
  `ast/`, 3 of `scanner/`, 78 methods of the checker from 27 files and 10 free functions of `checker/`, with the
  `Symbol` record, five node records and `evaluator::Result` copied from their files. Written by hand in the probe:
  the four callees of the last section, `StackCheck`, `CacheHashKey`, `OuterExpressionKinds` and `JSDeclarationKind`
  with the three and one constants that the file names, the view `SourceFile` with its four readers,
  `Ast::as_source_file`, `ListItem`, `Fallback`, a `Checker` of the fields that the three files read, and a crate
  `bun_collections` that names the map of std. `Ast` and `Checker` are invariant in their lifetime there, as in the
  tree. A copy of the file with two swapped arguments, an unused variable and a nested `&mut self` call gave the three
  errors (E0308, unused variable, E0499), and a copy with `clone` of a `Copy` value gave the clippy finding.
- Scripts over the file: the 32 functions have upstream's names in upstream's order; each of the 77 imported names is
  used and no free function is called without an import; no two comment lines are adjacent; no `unwrap`, `expect`,
  `panic`, `todo`, `unimplemented`, `unreachable` or `unsafe`; every `[...]` indexes a store of records, a link store
  of the checker or the diagnostic store of a parser; the 35 diagnostic messages of the range exist by name in
  `diagnostics/diagnostics_generated.rs`.
- The calls that the file makes were compared by name and number of arguments with the definitions of the tree, and
  the seven calls that other files make into it (`c05` 327, `c08` 381, 456, 464 and 680, `c14` 731 and 743) fit the
  signatures by name, number and order of arguments.
- Not checked: the four callees that have no definition, the real `Ast`, `SourceFile` and `Checker` (the probe has
  stand-ins for them), rustc and clippy on the real crate, and any result against upstream's baselines.

### What this file expects and the tree does not have

At `48da5c6a89`, four callees, each called by its upstream name with upstream's parameter order, as the other
callers of the tree write them:

- `c18` (no file): `check_property_access_expression(node, check_mode, write_only) -> TypeId` (11334),
  `report_nonexistent_property(prop_node, containing_type, is_unchecked_js)` (11620),
  `check_property_accessibility(node, is_super, writing, t, prop) -> bool` (11844).
- `c45`: `mark_property_as_referenced(prop, node_for_check_write_only, is_self_type_access)` (27829).

## Checker: the emit resolver (`checker/emitresolver.rs`)

Commits `48da5c6a89`, `e0fe9fcd4a` and `cff856f6be` (the file) and `04848b7d4f` (`c02_program_checker.rs`), written
by the job that commits the worktree. The file holds `checker/emitresolver.go` whole and in upstream order, 65
functions, 2,009 lines. After them come the hook `try_get_element_access_expression_name` of the reference resolver
and `Checker::get_constant_value` of `services.go` 859, which `GetConstantValue` calls and which no module holds
(`services.go` has none). Eight callees are stand-ins: the entries of the node builder of a request (below).
PORT_STATUS.md has the row.

NOT compiled by cargo when this was written: the fixer of a file does not build in this step, and `checker/mod.rs`
named `c18` without a file until `1c525192d2`. "Verified" below says what was checked instead.

### How a caller writes the calls

- `EmitResolver` is a value without fields (`#[derive(Clone, Copy, Default)] pub struct EmitResolver;`), as
  `c52_symbol_at_location.rs` 792, `symbolaccessibility.rs` 89 and `nodebuilderimpl.rs` 3151 and 3361 name it. A
  method takes `self` by value and the checker as its first argument:
  `EmitResolver.is_entity_name_visible(c, entity_name, enclosing_declaration, false)`.
- What the resolver keeps is the field `emit_resolver: EmitResolverState` of the checker: `jsx_links`,
  `declaration_links` and `declaration_file_links`, each a `LinkStore<NodeId, _>` of `JSXLinks { import_ref }`,
  `DeclarationLinks { is_visible: Tristate }` and `DeclarationFileLinks { aliases_marked }`.
- The five pairs of an exported and an unexported function with one name in snake_case are named by the contract
  (`node-table-id-contract/bottom-up/data/snake-collisions.txt` 90-94): `is_optional_parameter_exported(c, node)` and
  `is_optional_parameter(c, node)`, `is_declaration_visible_exported` and `is_declaration_visible`,
  `is_entity_name_visible_exported(c, entity_name, enclosing_declaration)` and
  `is_entity_name_visible(c, entity_name, enclosing_declaration, should_compute_alias_to_make_visible)`,
  `requires_adding_implicit_undefined_exported` and `requires_adding_implicit_undefined(c, declaration, symbol,
  enclosing_declaration)`, `is_symbol_accessible_exported` and `is_symbol_accessible`.
- A node, a symbol and a type are ids, nil for upstream's nil. A file is the id of its SourceFile node
  (`precalculate_declaration_emit_visibility(c, file)`, `mark_linked_references_recursively(c, file)`, and the result
  of `get_external_module_file_from_declaration(c, declaration)`).
- `has_visible_declarations(c, symbol, should_compute_alias_to_make_visible) -> Option<SymbolAccessibilityResult>`:
  `None` is upstream's nil.
- `get_enum_member_value(c, node) -> evaluator::Result<'a>`, `get_constant_value(c, node) -> LiteralValue<'a>`
  (upstream's `any`: `Nil`, a string or a number), `get_properties_of_container_function(c, node) ->
  List<'a, SymbolId>` (never nil), `get_referenced_value_declarations(c, node) -> Vec<NodeId>`,
  `get_element_access_expression_name(c, expression) -> Text<'a>`, `get_resolution_mode_override(c, node) ->
  ResolutionMode`, `get_effective_declaration_flags(c, node, flags) -> ModifierFlags`.
- The seven functions that make nodes take the emit context and the tracker of the caller by reference:
  `create_type_of_declaration(c, emit_context: &mut EmitContext, declaration, enclosing_declaration, flags: Flags,
  internal_flags: InternalFlags, tracker: &mut dyn SymbolTracker) -> NodeId`, and the same for
  `create_return_type_of_signature_declaration`, `create_type_of_expression`, `try_js_type_node_to_type_node`,
  `create_type_parameters_of_signature_declaration` and `create_late_bound_index_signatures` (both `-> Vec<NodeId>`),
  and `create_literal_const_value(c, emit_context, node, tracker) -> NodeId`.
- `get_type_reference_serialization_kind(c, type_name, location) -> TypeReferenceSerializationKind`: the enum of
  `printer/emitresolver.go` 33-75 is declared in this file (`Unknown` is its default) and is `crate::checker::
  TypeReferenceSerializationKind`.
- `get_reference_resolver(compiler_options) -> impl ReferenceResolver<'a, Checker<'a>>`: the caller gives
  `c.compiler_options`, and the checker is the host of each call of the resolver.
- Free functions, exported through `crate::checker`: `is_common_js_module_exports(a, node)`,
  `get_meaning_of_entity_name_reference(a, entity_name) -> SymbolFlags`, `noop_add_visible_alias(declaration,
  aliasing_statement)`, `is_const_enum_or_const_enum_only_module(a, s)` (what `c46_mark_references.rs` imports) and
  `new_emit_resolver(checker)`.
- `Checker::get_constant_value(node) -> LiteralValue<'a>` is a method of the checker.

### Differences from upstream

- No lock: `checkerMu` has no field (`c02_program_checker.rs` 731). The exported function of a pair calls the other,
  and `RequiresAddingImplicitUndefinedUnsafe`, `IsExpandoFunctionDeclarationUnsafe` and
  `GetReferencedValueDeclarationUnsafe` keep their names and do what the locking ones do.
- `newEmitResolver` answers the value and nothing calls it: `Checker::get_emit_resolver` of `c52` answers the value
  itself. The two function values that it binds (`isValueAliasDeclaration`, `aliasMarkingVisitor`) are the methods
  `is_value_alias_declaration_worker` and `alias_marking_visitor_worker`, called in a closure where upstream passes
  the value.
- The link stores are in the checker, where upstream has them in the resolver that the checker holds. The record of
  the checker got the field `emit_resolver` at the place of upstream's `emitResolver`; `emitResolverOnce` has no field.
  This changes the contract of the record (`checker-data-model-contract/bottom-up/data/checker-fields.tsv` 303:
  `emitResolver` without a field, "declaration emit is out of scope"): `hasVisibleDeclarations`, which the symbol
  accessibility of the checker calls for the names of a diagnostic, reads and writes `declarationLinks`, and the three
  files that use the resolver name it as a value without fields, so the checker is the one place for what it keeps.
- `getReferenceResolver`: the resolver holds the options and function pointers only, so it is made at each call, as
  `c03_init.rs` makes the name resolver. Six hooks are methods of the checker. `get_merged_symbol` and
  `get_export_symbol_of_value_symbol_if_exported` take `&self`, so their hooks are closures, and
  `tryGetElementAccessExpressionName` answers a `Cow`, so its hook (the private function at the end of the file)
  copies a name that the checker built into the texts of the checker.
- The node builder of a request, `NewNodeBuilder(r.checker, emitContext)`: the node builder of the tree is the one
  state `node_builder` of the checker over its own emit context (`nodebuilder.rs` 1), and `nodebuilder.rs` has five of
  upstream's entries. So `RequestNodeBuilder` (private to the file) has the eight entries that the resolver calls as
  stand-ins with upstream's parameters: each records `NodeBuilder.<Entry>` and answers nil (an empty list for
  `SerializeTypeParametersForSignature`). What the callers make themselves is ported: the `any` keyword for a node
  that is not of the parse tree, the `true` and `false` keywords and the literal of `CreateLiteralConstValue`, the
  modifiers and the property declarations of `CreateLateBoundIndexSignatures`. After the stand-in, an enum literal
  type gives its literal in `CreateLiteralConstValue` where upstream gives the expression of the enum member, and
  `CreateLateBoundIndexSignatures` gives property declarations without a type node and no index signature.
- The tracker is `&mut dyn SymbolTracker`: the caller keeps it, and `CreateLateBoundIndexSignatures` uses it for
  every component. The entries of `nodebuilder.rs` take `Option<Box<dyn SymbolTracker>>`.
- `core.IfElse` is an `if` (two places in `CreateLateBoundIndexSignatures`): the node of the `static` modifier is
  made for the static list only, and no modifier list is made for no modifier.
- `hasVisibleDeclarations`: `aliasesToMakeVisibleSet` is a list of pairs in the order of the first entry of a
  declaration, where upstream collects the values of a map, in no order. The closure `addVisibleAlias` is a nested
  function that takes the checker, the flag and the list, and calls `noop_add_visible_alias` when no alias is computed.
- `markLinkedAliases`: `visited` is a `Set<u64>` of the ids that `get_symbol_id` gives.
- Panics are faults: 601 (`Node cannot possibly require adding undefined`) answers false, 1046 (`unhandled literal
  const value kind`) answers nil. A read through a nil node reads the nil node (`isDeclarationVisible` tests the flags
  before nil upstream).
- Stack tests, where Go's stack grows: `is_declaration_visible` (it climbs the parents with
  `determine_if_declaration_is_visible`), `alias_marking_visitor_worker` and the nested `visit` of
  `MarkLinkedReferencesRecursively` (both walk a whole file). Each records `StackLimit` and answers false.
- `r.checker.GetEffectiveDeclarationFlags` and `r.checker.GetResolutionModeOverride` are wrappers of `exports.go`,
  which has no module: the calls go to the methods that they wrap. `r.checker.IsSymbolAccessible` is
  `is_symbol_accessible` of `symbolaccessibility.rs`.
- `var _ printer.EmitResolver = (*EmitResolver)(nil)`: the printer has no such trait (`printer/emitresolver.rs` 1).
- The statement `r.checker.mappedSymbolLinks.Has(symbol)` of 596, whose result upstream drops, is kept.
- `CreateLiteralConstValue`: the identifier `Infinity` is made before the test of the sign, and the text of a number
  is made once.
- A comment of upstream that asks a question of the future is dropped or says what upstream asks.

### Verified

Cargo has not compiled the file, and nothing ran a function of it. What was checked:

- `sh round2-layer7-checker/emitresolver-probe.sh`: exit 0, "probe ok". It runs `rustc` and `clippy-driver` alone, no
  cargo, and `rustfmt --check --edition 2024`. `emitresolver-probe-gen.py` writes the probe: this file by `#[path]`,
  `ast/{flags,ids,checkflags,symbolflags,modifierflags,nodeflags,tokenflags,kind_generated}.rs`,
  `core/{arena,linkstore,tristate,tristate_stringer_generated}.rs`, `collections/set.rs`, `jsnum/jsnum.rs`,
  `nodebuilder/types.rs` and `printer/emitresolver.rs` by `#[path]`, and stand-ins for every other name. The probe
  denies warnings, unused imports, variables, `mut` and assignments and `unreachable_pub`; clippy runs with the clippy
  table of the workspace, `clippy::all` and the repository's `clippy.toml`. The script reads the signature of a
  stand-in from the file of the tree that defines the function at the time of the run, and the body of a stand-in
  never returns: 25 methods of `Ast` and 46 free functions of `ast/`, 10 default methods of the two factory traits, 59
  methods of the checker from 28 files and 8 free functions of `checker/`, `parse_node`, `new_node_factory`,
  `new_reference_resolver`, `should_preserve_const_enums` and `Number::string`. Copied from their files as text: `Text`,
  `GoIndex` and `List`, `some` and `every`, the `Symbol` record and five node records, `JSDeclarationKind`, the trait
  `ReferenceResolver` and its hooks, `evaluator::Result` and `new_result`, and from `checker/types.rs` the flag and id
  macros, `Records`, seven records, `LiteralValue`, `TypeFlags`, `ObjectFlags`, and `ReferenceHint` of `c01_data.rs`.
  The types of the 16 fields of the checker that the file names are read from `c02_program_checker.rs`. Written by
  hand, and checked against the text of the tree at each run (`need` in the script): `MessageId`, `ModuleKind`,
  `CompilerOptions`, `PseudoBigInt`, the view `SourceFile` with its one member, `NodeSink`, `NodeUpdate` and the two
  blanket impls, `EmitContext`, the factory of the printer, `Type` and `Signature` with the members that the file
  reads, `as_literal_type`, `StackCheck`, `ListItem`, `Fallback`. `Ast` and `Checker` are invariant in their lifetime
  there, as in the tree. A copy of the file with a `bool` bound to a `u32` gave E0308, and a copy with a `Vec` passed
  by value and `n = n + 1` gave the two clippy findings, so the probe sees the file.
- `python3 round2-layer7-checker/emitresolver-callseq.py`: per function, the calls of methods of the checker, of
  methods of the resolver and of free functions are upstream's by name and number in 58 of the 65 functions. The
  seven others differ where a function value of upstream is a call in a closure here (`alias_marking_visitor_worker`
  twice, `is_value_alias_declaration_worker`, `visit`, `add_visible_alias`, the two `&self` hooks) and in
  `create_late_bound_index_signatures`, where upstream's loop variable `c` is a node and `core.IfElse` is an `if`. The
  script compares names and counts, not arguments and not order: each function was also read against upstream
  statement by statement.
- `python3 round2-layer7-checker/ranges.py emitresolver`: 65 of 65 functions have a `fn` of their name in the file.
  `python3 round2-layer7-checker/globs.py --names`: nothing under A, C and F, and no name of the 351 that files import
  through `crate::checker` is without a globbed module.
- The four places where other files use the resolver (`symbolaccessibility.rs` 89, `nodebuilderimpl.rs` 3151 and 3361,
  `c52_symbol_at_location.rs` 791) and the import of `c46_mark_references.rs` 24 with its four calls were read
  against the signatures.
- No two comment lines are adjacent; no `unwrap`, `expect`, `panic`, `todo`, `unimplemented`, `unreachable` or
  `unsafe`; every `[...]` indexes a link store or a store of records of the checker.
- Not checked: the real crate through cargo, the real `Ast`, `SourceFile`, `EmitContext`, factory and `Checker` (the
  probe has stand-ins for them), and any result against upstream's baselines.

### What this file expects and the tree does not have

At `cff856f6be` the one callee without a definition was `get_this_container(node, include_arrow_functions,
include_class_computed_property_name) -> NodeId` of `c18` (12279). `1c525192d2` has it, with `&self`: the probe reads
its signature from `c18_identifiers_property_access_this.rs` since then ("0 callees written by hand"). What is left:

- `nodebuilder.rs`: a node builder over the emit context of a caller (`NewNodeBuilder`, 279) and seven entries of
  `nodebuilder.go` that it does not have (`IndexInfoToIndexSignatureDeclaration` 111,
  `SerializeReturnTypeForSignature` 117, `SerializeTypeParametersForSignature` 126, `SerializeTypeForDeclaration` 134,
  `SerializeTypeForExpression` 140, `SymbolToExpression` 231, `TryJSTypeNodeToTypeNode` 272). The functions of
  `NodeBuilderImpl` that those entries call are in the tree but for `serializeTypeForExpression`,
  `symbolToTypeParameterDeclarations` and `tryJSTypeNodeToTypeNode`. Until then the eight entries of
  `RequestNodeBuilder` are stand-ins.
