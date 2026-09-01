# A/B benchmark for two bun binaries

Built to measure `-enable-machine-outliner`. Works for any pair of binaries.

```sh
bun bench/outliner/setup.ts                 # writes bench/outliner/fixtures
bun install --cwd bench                     # only for the babel+fastify bundling workload

export BENCH_ROOT=$PWD/bench/outliner
export BENCH_BINS='{"base":"/path/to/bun","outl":"/path/to/bun-outliner"}'
export BENCH_PAIRS='[["outl","base"]]'

bun bench/outliner/procs.ts 20              # spawn workloads: startup, bun build, bun test, require
bun bench/outliner/drive.ts 5               # in-process micro benchmarks (suite.mjs)
```

Run the drivers with the system bun. They spawn the binaries named in `BENCH_BINS`
in rotating order, so both binaries see the same machine noise. Each cell is a
median. A negative delta means the variant is faster.

Optional environment:

- `BENCH_TS`: path to a large JS file for the `bun build` workload (default
  `node_modules/typescript/lib/typescript.js` in the repo).
- `BENCH_NO_DEPS_BUILD=1`: skip the workload that bundles `bench/node_modules`.
- `BENCH_INSTALL_DIR`: a project with a lockfile and a warm cache, adds a
  `bun install --frozen-lockfile` workload.
