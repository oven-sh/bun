# Unit "conformance": TypeScript's own test cases as the yardstick

Read `/workspace/notes/lint/goals/COMMON.md` first. Its rules apply to everything below.

- Worktree: `/workspace/wt/conformance`. Branch: `robobun/abbc0c92/lint-conformance`.
- Notes directory (your log, `API.md`, `NEEDS.md`, final report): `/workspace/notes/lint/units/conformance/`.
- You OWN: everything under `test/cli/lint/conformance/` (new), the file `test/cli/lint/conformance.test.ts`
  (new), `LICENSE.md` and `docs/project/license.mdx` (attribution only).
- You do NOT own anything under `src/`, and nothing else under `test/`.
- This unit needs no debug build for most of its work: the runner is TypeScript that runs under the installed
  `bun`. Only the last milestone calls the build.

## Background you must read

- The reference harness: `/workspace/ref/typescript-go/internal/testrunner/` (`test_case_parser.go`,
  `compiler_runner.go`), `internal/testutil/{harnessutil,tsbaseline,baseline}`, and the lists
  `testdata/submoduleAccepted.txt` and `testdata/submoduleTriaged.txt`.
- Measured facts about the reference (from a source build that ran its suite): `TestSubmodule` has 14,915
  instances, 12,797 run, 2,118 skipped. 7,027 instances have an error baseline (conformance 3,840, compiler
  3,187), 5,770 have none. Skips: 45 by name (10 API tests, 35 removed-option tests), 8 emit-only, and
  unsupported options (module AMD, UMD or System; moduleResolution node10 or classic; esModuleInterop false;
  allowSyntheticDefaultImports false; baseUrl; outFile; target ES5; alwaysStrict false). 72 of 126 declared
  options vary. The error baseline is taken from the program AFTER emit. 7,013 of 7,027 baselines use the
  plain format and 14 the pretty one. typescript-go's error baselines differ from TypeScript's in 681 cases
  (442 accepted, 2 triaged, 237 not categorised).
- Rules for the yardstick: the oracle is byte-exact baselines. A committed list of passing names may grow and
  may not shrink. Instances with no expected error are a separate guard, so that an empty checker scores zero.
- How the repository vendors another project's tests: `test/bundler/transpiler/react-compiler-fixtures/` and
  `scripts/sync-react-compiler.sh` (a pinned commit, a sync script, fixtures committed to the repository).
- Repository rule: tests never use the network. Everything the runner reads is committed.

## Milestones, in this order. Commit and push after each step inside a milestone.

### T1. The corpus
1. Copy verbatim from `/workspace/ref/typescript-go/_submodules/TypeScript` (commit 5848bc5):
   `tests/cases/conformance/**` and `tests/cases/compiler/**` (the cases), and for each case its
   `tests/baselines/reference/<name>*.errors.txt` files (the error baselines, one per option variation).
   Do not copy `.types`, `.symbols`, `.js` or `.map` baselines in this milestone.
2. typescript-go accepts some differences from tsc on purpose. Its own baselines for the same cases are under
   `/workspace/ref/typescript-go/testdata/baselines/reference/submodule/` with `.diff` files. Copy its
   `.errors.txt` files where they differ, into a parallel directory, plus `submoduleAccepted.txt` and
   `submoduleTriaged.txt`. The runner's oracle is typescript-go's baseline where one exists, else TypeScript's.
3. A file `UPSTREAM` that names both repositories and commits, and a script `sync.sh` that rebuilds the
   directory from local clones at given commits (no network in the script itself) and prints what changed.
4. Measure and report BEFORE you commit the corpus: number of files and bytes per directory, and the size that
   the commit adds to the repository (pack the new objects: `git count-objects -vH` before and after in a
   scratch clone, or the size of a `git bundle` of the commit). If the packed size is above 40 MB, STOP: do
   not commit the corpus, write the numbers and two smaller alternatives (for example: the error baselines as
   one sorted text file per directory, or only the directories that the first milestones of the checker
   need) to `NEEDS.md`, save the notes, and go on with T2 against the reference directory on disk.
5. Attribution: TypeScript and typescript-go are Apache-2.0. Add them to `LICENSE.md` and
   `docs/project/license.mdx` in the style of the entries that exist, and keep upstream's license text beside
   the corpus.

### T2. The runner (TypeScript, under `test/cli/lint/conformance/runner/`)
1. A port of the directive grammar of `test_case_parser.go`: `// @option: value` at column 0, names
   lowercased, the last whole-file occurrence wins, `// @filename:` splits a case into units,
   `// @link: target -> path`, and the option variations (values split on commas and deduplicated, the cross
   product named with sorted `key=value` pairs, as `harnessutil` does).
2. The list of instances with their status, reproduced from the reference. Your enumerator must reproduce the
   numbers above for the pinned commits, or your report explains each difference.
3. The baseline reader and writer for `.errors.txt`, byte-exact (plain format and the pretty one). Round
   trip test: read every baseline, write it again from the parsed form, compare the bytes.
4. The runner: for an instance, materialise its units in a temporary directory, call a `check(instance)`
   function that returns diagnostics, format them as a baseline, compare with the oracle byte for byte.
   `check` is pluggable. The default implementation spawns `bunExe()` with `--lint`, the environment variable
   `BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1` and the unit files as operands, and parses the plain format
   `path(line,col): error TSnnnn: text` plus indented chain lines from stderr.
5. The expectations file `expectations.json`: the sorted list of instance names that pass, split in two
   lists: "E" (instances whose oracle has errors) and "C" (instances whose oracle has none). The runner
   fails when a listed instance does not pass, and prints the names of instances that pass and are not
   listed, with the one command that adds them. It never removes a name by itself.

### T3. The test file
`test/cli/lint/conformance.test.ts` runs in the normal test run of the repository, so it must be fast (budget:
10 seconds in a release build): it runs the unit tests of the runner (directive parser, variations,
enumerator counts, baseline round trip on a sample of 200 files chosen by a fixed rule such as every 40th
name) and every instance that is listed in `expectations.json`, in batches. The full sweep over all instances
is a script, `bun test/cli/lint/conformance/sweep.ts`, which prints the pass counts by directory and by
diagnostic code and writes a report file. Until the checker exists both lists are empty and the sweep reports
zero passes: that is the correct result, state it in your report.

### T4. `API.md`
Write `/workspace/notes/lint/units/conformance/API.md`: how another unit plugs its `check` function in, how to
run one instance, a directory, or the sweep, the meaning of each status, and how the expectations file is
updated. Save the notes.

## Out of scope for this unit

The checker, the parser, the CLI. `.types` and `.symbols` baselines.
