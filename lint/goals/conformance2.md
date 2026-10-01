# Unit "conformance", round 2: finish the corpus, make the test pass, take the first numbers

Read `/workspace/notes/lint/goals/COMMON.md` first, then `/workspace/notes/lint/goals/conformance.md` (round 1:
what you own, the milestones T1 to T4). This file says where the work stands and what is left.

- Worktree: `/workspace/wt/conformance`. Branch: `robobun/abbc0c92/lint-conformance`. Push it after every commit:
  `git push origin HEAD:robobun/abbc0c92/lint-conformance`.
- Notes: `/workspace/notes/lint/units/conformance/`. Save them with
  `/workspace/tools/save-notes "conformance: <what>"`.

## Where the work stands (verified by the integrator on 2026-09-30)

Round 1 made 44 commits: the runner (28 files under `test/cli/lint/conformance/runner/`), `sweep.ts`, `sync.sh`,
`update-reference.ts`, `conformance.test.ts`, the fixtures, and 9,056 error baselines of TypeScript. The packed
size of all of it is 3.9 MB. The branch is NOT merged into the pull request branch, because its test fails:
`bun bd test test/cli/lint/conformance.test.ts` gave 45 pass and 22 fail on the branch as it is. What is missing:
- `test/cli/lint/conformance/UPSTREAM` is not committed. A prototype is in your notes:
  `/workspace/notes/lint/units/conformance/corpus-layout-and-sync/top-down/prototype/UPSTREAM`. With that file in
  place, `bash sync.sh /workspace/ref/typescript-go /workspace/ref/typescript-go/_submodules/TypeScript` runs to
  the end and writes 13,130 files: `corpus/cases/compiler` (6,537 files, 4.6 MB), `corpus/cases/conformance`
  (5,908 files, 3.8 MB), `corpus/lib` (4 files), `corpus/baselines/typescript-go` (675 files, 3.1 MB), the two
  lists and the four licence files. It reports one file that an ignore rule of the repository matches
  (`corpus/cases/conformance/parser/ecmascript5/parserSyntaxWalker.generated.ts`) and two files that are
  executable upstream.
- With the corpus in place the test gives 66 pass, 37 fail: `expectations.json` does not exist, and the tests of
  `describe("variations")` fail (18 of them), with others. Nobody has looked at why.
- `bun --lint` exists now on the pull request branch, and your branch has it after the merge: the flag, the
  plain format, eleven lint rules, syntax errors of Bun's parser. There is no type checker behind it yet.

## What is left, in this order

E1. Commit the corpus: `UPSTREAM`, the cases, `corpus/lib`, the typescript-go baselines, the lists, the licence
    files. Decide what happens with the file that an ignore rule matches (an exception in a `.gitignore` beside
    the corpus, or `git add --force`, and `sync.sh --verify` must agree with the choice). Measure the packed
    size of the branch against `e3566be889` before and after
    (`git rev-list --objects <base>..HEAD | git pack-objects --stdout -q | wc -c`) and write both numbers into
    your report. The limit is 40 MB packed.
E2. Make `test/cli/lint/conformance.test.ts` pass: with `bun bd test` (debug build with ASAN, also with the leak
    check of CI: `BUN_DESTRUCT_VM_ON_EXIT=1
    ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1
    LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$PWD/test/leaksan.supp`), and within
    10 seconds under a release build (`USE_SYSTEM_BUN=1 bun test` is close enough for the parts that do not call
    `--lint`). Find the cause of each failing test and fix the cause. Create `expectations.json`.
    The repository's test runner must not take a file of the corpus for a test: check how CI finds test files
    (`scripts/runner.node.ts`) and prove that no file below `corpus/` is run.
E3. T4 of round 1: `/workspace/notes/lint/units/conformance/API.md`.
E4. The first numbers. Run the full sweep (`sweep.ts`) with the default check against the debug build of your
    worktree (or a release build, if you make one: `/workspace/tools/lk bun run build:release`). There is no type
    checker yet, so the expected result is: no instance of list E passes unless its oracle holds only syntax
    errors that Bun's parser reports with the same code, position and text. Report, by directory and by code:
    how many instances run, how many reach a result, how many crash or time out, how many of class C print
    nothing (the guard), how many of class E pass. Every crash and every hang of `bun --lint` on a corpus file is
    a bug of the parser or of the command: write each one, with the file, into
    `/workspace/notes/lint/units/conformance/CRASHES.md`, and save the notes. Do not fix code outside your files.
    Put into `expectations.json` what passes.
E5. The sweep as a tool for the other units: one command that takes a list of instance names or a directory and
    prints, per instance, pass or the first differing line of the baseline. Document it in `API.md`.

## Always

- Tests never use the network, and everything the runner reads is committed.
- Nothing below `src/` is yours.
