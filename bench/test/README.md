# `bun test --parallel` and `--isolate` benchmarks

Two synthetic suites that show where each flag pays off.

## `--parallel`: many independent files

```sh
cd bench/test/parallel
bun setup.ts
hyperfine --warmup 1 \
  'bun test ./suite' \
  'bun test --parallel ./suite'
```

32 files × 4 tests each, ~100ms per file. Serial walks them one at a time;
`--parallel` spreads them across CPU-count workers (lazily — the first slow
file triggers scale-up).

## `--isolate`: heavy shared dependency tree

```sh
cd bench/test/isolate-cache
bun setup.ts
hyperfine --warmup 1 \
  --command-name 'isolate (cache off)' 'BUN_FEATURE_FLAG_DISABLE_ISOLATION_SOURCE_CACHE=1 bun test --isolate ./suite' \
  --command-name 'isolate (cache on)'  'bun test --isolate ./suite'
```

30 test files all import the same 60-module TypeScript chain. Under `--isolate`
each file gets a fresh global, so without the VM-level SourceProvider cache the
chain is re-transpiled 30×. With the cache it's transpiled once and every
subsequent file's `fetch` returns the cached provider.

Both together:

```sh
hyperfine --warmup 1 \
  'bun test ./suite' \
  'bun test --isolate ./suite' \
  'bun test --parallel --isolate ./suite'
```
