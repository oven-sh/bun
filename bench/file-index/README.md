# Bun.FileIndex benchmarks

Benchmarks for the in-memory codebase index, `Bun.FileIndex`. Each file builds
its own deterministic tree in a temp directory (seeded PRNG, cleaned up on
exit), **asserts correctness once before timing anything** (entry counts, glob
result sets, grep hit counts, git status entry counts), then runs
[mitata](https://github.com/evanwashere/mitata) groups. mitata's `min` / `p50`
/ `max` columns are the best / median / worst per-call latency.

Every file also runs under Node.js (or a Bun without `Bun.FileIndex`): the
Bun-specific benchmarks are skipped and only the competitors run.

```bash
cd bench
bun install

bun file-index/index-build.mjs
bun file-index/complete.mjs
bun file-index/glob.mjs
bun file-index/grep.mjs
bun file-index/git-status.mjs
```

## What each file measures

- **`index-build.mjs`** — construct `new Bun.FileIndex(root)` + `await ready`
  (a full crawl + lstat of every entry), vs walking the same tree with
  [`fdir`](https://github.com/thecodrr/fdir) and `fast-glob` (walk only, no
  `lstat`) and vs `spawnSync("git ls-files --cached --others")`. Also prints a
  one-shot `entries/sec` and `bytes/entry` (`index.memoryUsage / index.size`).
  - `FILE_INDEX_BENCH_N=20000` — synthetic tree size (files).
  - `FILE_INDEX_BENCH_ROOT=/path/to/checkout` — index a real tree instead
    (the `git ls-files` competitor and the entry-count assertion only run
    against the synthetic tree).
- **`complete.mjs`** — per-keystroke fuzzy autocomplete latency of
  `index.complete(needle, { limit: 32 })` at several index sizes, for short /
  medium / long / path-like needles, vs two pure-JS baselines over the same
  path array: a naive `path.includes(needle)` filter (first 32, no ranking)
  and a subsequence scorer + top-K (what you would write in userland).
  `complete()` keeps a per-index survivor cache that is reused when a query
  equals or extends the previous one, so each needle is reported as two
  benches:
  - **`cold`** — the cache is busted before every timed call by first issuing
    a decoy query the needle does not extend. This is the cost of the first
    keystroke of a new query (and is the row to watch for regressions in the
    scan + score + rank path). The decoy matches nothing and costs ~1 µs
    (printed per size), which is noise next to the cold call it precedes.
  - **`warm (cache)`** — the identical query repeated back to back, i.e. the
    cache-hit path. Timing only this (what a naive repeat-the-call bench
    does) badly understates real per-keystroke latency and would hide a
    regression in the cold path.
  - `FILE_INDEX_BENCH_SIZES=10000,100000,250000` — comma-separated path counts.
- **`glob.mjs`** — `index.glob(pattern)` (pure in-memory, the index is built
  once) vs re-walking the filesystem per query with `Bun.Glob().scanSync` and
  `fast-glob.globSync`, over the same pattern set as `../glob/scan.mjs`.
  Asserts `index.glob` and `Bun.Glob.scanSync` return the exact same path set.
  - `FILE_INDEX_BENCH_N=20000` — synthetic tree size (files).
- **`grep.mjs`** — `index.grep(literal)` (parallel reads on Bun's thread pool)
  over a corpus with a known hit count, vs spawning `rg -n --fixed-strings`
  and `grep -rnF` (each skipped cleanly if not on `PATH`) and vs a sequential
  pure-JS `readFileSync` + `indexOf` loop.
  - `FILE_INDEX_BENCH_FILES=2000`, `FILE_INDEX_BENCH_KB=30` — corpus shape.
- **`git-status.mjs`** — `index.gitStatus()` (in-process: `.git/index`, refs
  and objects are parsed directly, git is never spawned) vs
  `spawnSync("git status --porcelain=v1 -z")` over the same dirty repository.
  If the running build does not implement `gitStatus()` yet, only the spawned
  `git` is benchmarked so the suite always runs.
  - `FILE_INDEX_BENCH_N=5000` — number of tracked files.

## Caveats

- The fdir / fast-glob / pure-JS numbers depend on the JavaScript engine they
  run in as much as on the algorithm; run the suite under `node` too before
  quoting them.
- Never quote numbers from a debug or ASAN build of Bun.
