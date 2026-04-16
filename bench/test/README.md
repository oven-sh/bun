# `bun test --parallel` and `--isolate` benchmarks

Two synthetic suites that show where each flag pays off. The fixture files use
global `test`/`expect` (no `bun:test` import) so the same suite runs under
vitest for comparison.

```sh
cd bench/test
bun install                       # for vitest
bun parallel/setup.ts
bun isolate-cache/setup.ts
```

## `--parallel`: many independent files

```sh
hyperfine --warmup 1 \
  'bun test ./parallel/suite' \
  'bun test --parallel ./parallel/suite' \
  'npx vitest run parallel/suite'
```

32 files × 4 tests each, ~100ms per file. Serial walks them one at a time;
`--parallel` spreads them across CPU-count workers (lazily — the first slow
file triggers scale-up). Vitest runs files in worker threads by default.

## `--isolate`: parse-heavy shared dependency

```sh
hyperfine --warmup 1 \
  -n 'bun --isolate (cache off)' 'BUN_FEATURE_FLAG_DISABLE_ISOLATION_SOURCE_CACHE=1 bun test --isolate ./isolate-cache/suite' \
  -n 'bun --isolate (cache on)'  'bun test --isolate ./isolate-cache/suite' \
  -n 'vitest'                    'npx vitest run isolate-cache/suite'
```

30 test files all import a single ~2MB function. Under `--isolate` each file
gets a fresh global; the VM-level SourceProvider cache means the 2MB is
transpiled and parsed once, and every subsequent file rebuilds the module
record from cached `module_info` with zero re-parsing.
