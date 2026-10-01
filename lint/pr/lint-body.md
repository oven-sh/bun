Part of #2246

### Problem

- Bun has no type check and no lint. `bun --lint x.ts` drops the unknown flag and runs `x.ts` (`src/clap/streaming.rs:157-175`).
- The parser drops TypeScript type syntax token by token and builds no node for it (`src/js_parser/parse/parse_skip_typescript.rs`).

### Fix

- `bun --lint <files>` parses each file and never runs it. It prints syntax errors and the findings of 11 lint rules. It needs `BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1`.
- The type grammar reads what tsc reads. A lint parse keeps the type syntax in a side table beside the unchanged tree.
- The type checker (a port of typescript-go) is not in this branch yet. The notes list each step.
- Verified: `test/cli/lint/` (89 tests), `test/bundler/transpiler/typescript-grammar*.test.ts` (366 cases), 70 parser Rust tests.

### Background

- A sink receives what the type grammar reads. `Discard` keeps nothing, `Build` makes type nodes.
- A lint parse runs the parse pass without the visit pass. Other parses build the same tree as before.
- Considered a third const parameter on the parser: one more parser copy (475,827 B). Considered type syntax as AST nodes: `G::Decl` grows for each run.

### Downsides

- The transpiler now accepts TypeScript that it rejected, and some `emitDecoratorMetadata` values change to those of tsc. The transpiler cache version goes from 33 to 34.
- The parser stops at the first syntax error. tsc continues.
- Not measured yet for this state: binary size, and the instructions of a parse without `--lint`.

<details><summary>Notes</summary>

#2246 asks for a linter and a formatter. The maintainers set the scope of `bun --lint` to a type checker plus lint rules on Bun's own parser, in one PR. This PR does not address the formatter.

**Steps**

| Step | State |
|---|---|
| Benchmark for type-heavy TypeScript (`bench/snippets/transpiler-typescript.mjs`) | done |
| The type grammar is generic over a sink (`Discard`, `DecoratorMetadata`, `Build`) | done |
| One read-only walker over `Stmt`, `Expr` and `Binding` (`bun_ast::walk`), `bun pm diff` moved onto it | done |
| The tables that only `Parser::parse_only` fills go behind a `Box`, size assertions on `P` | done |
| The type grammar reads what tsc reads, with the tree shape of the reference | done, the comparison with the base build on a corpus is open |
| Type nodes with start and end (`bun_ast::ts`), built by the `Build` sink | done |
| `Parser::parse_for_lint` and the side table: annotations, type parameters and arguments, casts, non-null, parentheses, erased statements and class members, tsc codes of syntax errors | done |
| Comments, directive comments and triple-slash directives in the side table | open |
| `bun --lint <files>` parses its operands and never runs them (behind `BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1`), with the refusals of flags it cannot be combined with | done |
| Diagnostics with a code, sorted, in tsc's plain format and as code frames | done |
| 11 lint rules on JavaScript, with ESLint's names and cases: `no-compare-neg-zero`, `no-debugger`, `no-dupe-class-members`, `no-dupe-keys`, `no-duplicate-case`, `no-empty-pattern`, `no-self-assign`, `no-sparse-arrays`, `no-unsafe-negation`, `use-isnan`, `valid-typeof` | done |
| The lint rules on TypeScript files, and the rest of `eslint:recommended` | open |
| TypeScript conformance corpus, runner and expectations file | written on a branch, its test does not pass yet |
| Type checker: node table, binder, checker (typescript-go 89d5d5b) | translated on a branch: 121,196 lines in 172 files, not compiled yet |
| Program: compilerOptions, resolution of types, embedded lib files, `bun --lint` with no operand | open |
| Comment directives, JSDoc, checkJs | open |
| Type-aware lint rules, help text, completions, docs. The flag becomes public | open |

A defect that is older than this PR is fixed here, because the new tests show it: `Metadata::MDot` held a `Vec<Ref>` inside AST nodes that an arena holds, so a decorated member with a type such as `ns.A.B` leaked the buffer at each parse. It is an arena slice now.

**Measurements for the four groundwork steps**

linux-x64 release builds. Each step was measured alone against main at 36cd1514ec. Symbol sizes come from `llvm-nm -S`, and each address counts one time. Instruction counts come from valgrind 3.27.1 (`--tool=cachegrind --cache-sim=no --branch-sim=yes`) with `BUN_JSC_useJIT=0`, for the symbols whose name contains `bun_js_parser`. They repeat exactly between runs.

| Step | `bun` (stripped) | Parser text | Parse: instructions | Parse: branches |
|---|---:|---:|---:|---:|
| Base | 80,827,976 B | 1,400,807 B | | |
| Sink grammar | 80,827,976 B | 1,400,561 B | +0 in 5 of 5 groups | +0 |
| Walker | 80,827,976 B | 1,400,807 B | +0 in 5 of 5 groups | +0 |
| Boxed tables | 80,827,976 B | 1,400,824 B | -0.0016% to +0.0044% | +0 |

Baseline of the benchmark (`--iterations=20`, one process for each group):

| Group | Files | Input bytes | Passes | Ir | Bc |
|---|---:|---:|---:|---:|---:|
| bun-types | 29 | 1,076,221 | 20 | 314,398,437 | 44,553,098 |
| typescript-lib | 108 | 3,784,758 | 20 | 1,106,648,257 | 160,854,698 |
| src-js | 193 | 3,268,179 | 20 | 4,441,129,664 | 512,392,086 |
| tsx | 1 | 7,003 | 2,000 | 1,177,361,175 | 137,557,479 |
| js-control | 1 | 1,506,667 | 20 | 2,904,091,481 | 312,264,098 |

Sink grammar:

- The discard mode has the same 816 instructions in the two builds. The metadata mode goes from 7,045 to 7,017 bytes, and its stack frame from 152 to 136 bytes.
- Differential run: 24,000 generated snippets in 5 configurations (decorator metadata, the same with minified identifiers, the same with unused imports trimmed, decorators without metadata, `.tsx`). That is 120,000 records: 80,164 transforms and 39,836 error lists. The base and the branch give the same bytes. The corpus found each of 7 mistakes that were put into a build on purpose.
- The grammar keeps its differences from tsc in this step. Example: the type after `:` of a conditional type binds at `Level::BitwiseAnd` in metadata mode and at `Level::Lowest` in discard mode. `TypeSink::CONDITIONAL_FALSE_LEVEL` holds that difference until the next step removes it.

Walker:

- `function_identities.rs` keeps its own walk. It writes bytes that depend on its own child order (arguments of a call before the target), on a byte for each absent child, and on its depth rules.
- One `bun pm diff` run that computes profiles, counts for the profile pass and the walker: instructions 4,529,162 to 4,437,036, conditional branches 388,928 to 341,618, indirect branches 50,318 to 86,918. A first version with one `enter` hook had 5,541,226 instructions, because the consumer and the walker each matched the kind of the node.
- Differential run: 58 runs of `bun pm diff` over 14,153 files. The output (6,832,752 bytes), the exit codes and 38,460 profile hashes are identical.
- A right-nested chain (`a = b = c`) was on a heap work list in `pm_diff_profile.rs`. It is on the stack now.

Boxed tables:

- `size_of::<P<true, false>>()`: 3,968 to 3,808 bytes in a release build, 4,048 to 3,888 with debug assertions.
- The 3 sites that test the option have one more instruction: the boxed option is loaded, then tested (`mov`, `test`), where the inline option was compared in memory (`cmpq`).

**Older tests on the debug build of this branch (all pass, also with the leak check of CI)**

- `test/bundler/transpiler/decorator-metadata.test.ts`
- `test/bundler/bundler_decorator_metadata.test.ts`
- `test/bundler/transpiler/transpiler.test.js`
- `test/bundler/esbuild/ts.test.ts`
- `test/bundler/transpiler/decorators.test.ts`
- `test/js/bun/typescript/type-export.test.ts`
- `test/bundler/transpiler/transpiler-stack-overflow.test.ts`
- `test/cli/run/transpiler-cache.test.ts`
- `test/cli/install/bun-pm-diff.test.ts`

**Facts that shape the later steps**

- The reference is typescript-go at 89d5d5b (Apache-2.0): checker 60,301 lines, binder 3,544 lines. Its tests: 5,908 conformance cases and 6,537 compiler cases with error baselines.
- Bun's type grammar accepts input that tsc rejects (`let x: (a: ) => void`) and rejects input that tsc accepts (`type as = 1`). Of 625 probed type forms, 117 are in the first group and 68 in the second.
- The estimate for the complete checker is +2.1 to 2.7 MB of cold code. Each step adds its measured size to this description.

</details>

