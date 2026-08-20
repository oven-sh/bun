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

## `environment/`: jsdom + React Testing Library

This benchmark compares the existing per-file preload model with a persistent
environment. Both variants create a fresh jsdom document for every file and run
the same React Testing Library assertion.

```sh
cd bench/test
bun install
bun environment/setup.ts 100
cd environment/suite
hyperfine --warmup 1 --runs 5 -N \
  -n 'preload per file' 'bun test --isolate --config bunfig-preload.toml .' \
  -n 'persistent environment' 'bun test --config bunfig-environment.toml .' \
  -n 'persistent environment parallel=1' 'bun test --parallel=1 --config bunfig-environment.toml .' \
  -n 'persistent environment parallel=3' 'bun test --parallel=3 --config bunfig-environment.toml .'
```

Run the generator with 25, 100, and 400 files to compare startup cost,
steady-state throughput, and RSS growth.
