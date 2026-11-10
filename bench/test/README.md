# `bun test --parallel` and `--isolate` benchmarks

## `app/`: bun vs jest vs vitest on an ordinary suite

`app/setup.ts` generates a small app — `src/` modules built on `zod`,
`date-fns` and `lodash` — and N TypeScript test files that import it and run
8 tests each, plus a `preload.ts` setup file (custom matcher + hooks) wired
into each runner (`bunfig.toml`, `setupFilesAfterEnv`, `setupFiles`). The test
files use global `describe`/`test`/`expect`, so the identical suite runs under
all three runners with their stock configs (`jest.config.cjs` uses `@swc/jest`;
`vitest.config.ts` sets `globals: true`).

```sh
cd bench/test
bun install
bun app/setup.ts 2000 20         # files, items-per-test
cd app                           # bunfig.toml / jest.config.cjs / vitest.config.ts here wire in preload.ts
hyperfine --warmup 1 --runs 3 -N \
  -n 'bun test'                         'bun test tests' \
  -n 'bun test --parallel'              'bun test --parallel tests' \
  -n 'bun test --parallel --no-isolate' 'bun test --parallel --no-isolate tests' \
  -n 'jest'                             '../node_modules/.bin/jest' \
  -n 'vitest run'                       '../node_modules/.bin/vitest run' \
  -n 'vitest run --no-isolate'          '../node_modules/.bin/vitest run --no-isolate'
```

## `parallel/`: many independent slow files

```sh
bun parallel/setup.ts
hyperfine --warmup 1 'bun test ./parallel/suite' 'bun test --parallel ./parallel/suite' 'npx vitest run parallel/suite'
```

32 files × 4 tests each, ~100ms per file. Serial walks them one at a time;
`--parallel` spreads them across CPU-count workers.

## `isolate/`: parse-heavy shared dependency

```sh
bun isolate/setup.ts
hyperfine --warmup 1 \
  -n 'bun --isolate (cache off)' 'BUN_FEATURE_FLAG_DISABLE_ISOLATION_SOURCE_CACHE=1 bun test --isolate ./isolate/suite' \
  -n 'bun --isolate (cache on)'  'bun test --isolate ./isolate/suite' \
  -n 'vitest'                    'npx vitest run isolate/suite'
```

30 test files all import a single ~2MB function. Under `--isolate` each file
gets a fresh global; the VM-level SourceProvider cache means the 2MB is
transpiled and parsed once, and every subsequent file rebuilds the module
record from cached `module_info` with zero re-parsing.

## `isolate/reset/`: `jest.resetModules()` under `--isolate`

`isolate/setup.ts` also writes `isolate/reset/suite/`:

- `src/`: 300 small TypeScript modules and an `index.ts` that imports them all.
- `tests/`: 100 test files × 3 tests. A `beforeEach` hook calls
  `jest.resetModules()`, and each test runs `await import("../src/index.ts")`,
  so every test evaluates the 301 modules again.
- `tests-noreset/`: the same test files without the hook.
- `preload-reset.ts`: a preload with a `beforeAll` hook that calls
  `jest.resetModules()`.

The test files and the preload import `bun:test`, so only Bun runs them.

```sh
bun isolate/setup.ts
sleep 3
cd isolate/reset/suite
BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 hyperfine --warmup 1 -N \
  -n 'no reset'       'bun test --isolate ./tests-noreset/' \
  -n 'reset per test' 'bun test --isolate ./tests/'
```

Pass the suite as `./tests/` and check that the summary says
`Ran 300 tests across 100 files.` The bare filter `tests` also matches
`tests-noreset` and runs 200 files.

The preload case runs the parse-heavy suite above (`../../suite`) from the same
directory:

```sh
BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 hyperfine --warmup 1 -N \
  -n 'no reset'      'bun test --isolate ../../suite' \
  -n 'preload reset' 'bun test --isolate --preload ./preload-reset.ts ../../suite'
```

Both commands print `Ran 30 tests across 30 files.` Under `--isolate` the
preload's `beforeAll` hook runs in every test file.

`BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` turns off the on-disk transpiler cache.
With it on, Bun reads the transpiled `big.ts` and `src/index.ts` from disk
instead of transpiling them.

`jest.resetModules()` keeps the SourceProvider cache. After a reset, the next
load of a module checks its cached source against the file, and Bun transpiles
the file again only if that check fails. `reset per test` makes one check per
module in every test. `preload reset` makes one check of `big.ts` per test
file, because each file resets after it has imported `big.ts`.

- The check is one `stat` if the file last changed more than two seconds before
  `bun test` started. Otherwise Bun reads the file and compares a hash of its
  contents. The `sleep` keeps every run on the `stat` check. To time the other
  check, pass `--prepare 'bun ../../setup.ts'` to `hyperfine`, which writes the
  files again before every run.
- A source that was cached before the first reset of the process has nothing to
  be checked against. Bun transpiles it again the first time it loads after
  that reset. In `preload reset` that includes `big.ts`, so the run transpiles
  it twice.
