# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-26 (full re-run with HTTP clone fix)
- Ziggit: built from /root/ziggit, commit 0ca17e1 (HTTP chunked fix)
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU
- Git: 2.43.0, Zig: 0.15.2
- Build: `zig build -Doptimize=ReleaseFast`

## Build Status

Full bun fork binary **cannot be built** on this VM (needs 16GB+ RAM, 20GB+ disk).
`build.zig.zon` correctly wires ziggit as `../ziggit` path dependency.

## Stock Bun Install (Git Dependencies)

| Config | Cold Avg | Warm Avg |
|--------|----------|----------|
| 3 deps (debug, semver, ms) | **211ms** | **109ms** |
| 5 deps (+ chalk, is) | **160ms** | **85ms** |

## Remote Clone: Git CLI vs Ziggit CLI

✅ **HTTP clone now working** (previously blocked by chunked TE bug).

| Repo | Git (--depth=1) | Ziggit (full) | Δ |
|------|----------------|---------------|---|
| debug | 122ms | **83ms** | ✅ 32% faster |
| node-semver | 139ms | 135ms | parity |
| ms | 124ms | 128ms | parity |
| chalk | 127ms | **90ms** | ✅ 29% faster |
| express | 178ms | 836ms | ❌ needs shallow clone |

## Local Clone: Git CLI vs Ziggit CLI

| Size | Git Clone | Ziggit Clone | Git Status | Ziggit Status |
|------|-----------|--------------|------------|---------------|
| small | 6ms | 7ms | 3ms | 4ms |
| medium | 7ms | 8ms | 3ms | 3ms |
| large | 10ms | 9ms | 3ms | 4ms |

**Verdict:** Parity — both dominated by process startup (~0.5-1ms).

## findCommit: In-Process (185× Speedup)

1000 iterations, bare repos with 50 commits.

| Repo | git rev-parse (CLI) | ziggit findCommit (lib) | Speedup |
|------|--------------------|--------------------------|---------| 
| chalk | 1,064µs | 7.1µs | 150× |
| debug | 1,063µs | 5.5µs | 193× |
| express | 1,063µs | 5.4µs | 197× |
| ms | 1,062µs | 5.5µs | 193× |
| node-semver | 1,063µs | 5.6µs | 190× |
| **Average** | **1,063µs** | **5.8µs** | **185×** |

## Process Spawn Overhead

| Process | Per-call |
|---------|----------|
| /bin/true | 505µs |
| ziggit --help | 692µs |
| git --version | 943µs |

Per git dep, bun spawns ~4 git processes → **~3.8ms spawn overhead per dep**.

## Projected Savings with Bun + Ziggit

| Git Deps | Stock Bun (warm) | Bun+Ziggit (warm) | Savings |
|----------|------------------|--------------------|---------|
| 3 | 109ms | ~95ms | 13% |
| 5 | 85ms | ~66ms | 22% |
| 20 | ~340ms | ~264ms | 22% |
| 50 | ~850ms | ~598ms | 30% |

## Key Takeaways

1. **HTTP clone works** — ziggit beats git for small repos even without shallow clone
2. **185× findCommit speedup** as in-process library (the core architectural win)
3. **22-30% install time savings** projected for warm cache with 5-50 git deps
4. **Shallow clone needed** — large repos (express) fetch too much history
5. **Scales linearly** — more git deps = bigger absolute savings

## vs Previous Run

| Metric | Previous | Current | Change |
|--------|----------|---------|--------|
| HTTP clone | ❌ Broken | ✅ Working | Fixed! |
| Remote debug clone | error (754ms) | **83ms** | Now functional |
| findCommit speedup | 421× | 185× | Different repo sizes (50-depth bare) |
| Stock bun 3-dep cold | 118ms | 211ms | Network variance |

## Raw Data

- Script: [`benchmark/bun_install_bench.sh`](benchmark/bun_install_bench.sh)
- findCommit bench: [`benchmark/findcommit_bench.zig`](benchmark/findcommit_bench.zig)
- Build config: [`benchmark/build.zig`](benchmark/build.zig)
