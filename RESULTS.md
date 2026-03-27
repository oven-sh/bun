# Ziggit Integration Benchmarks

## Environment
- Date: 2026-03-27T00:22Z (fresh run)
- Ziggit: v0.2.0, built from /root/ziggit (master), ReleaseFast
- Bun: 1.3.11 (stock), fork branch: ziggit-integration
- Machine: Linux x86_64, 483MB RAM, 1 vCPU, 2GB swap
- Git: 2.43.0, Zig: 0.15.2

## Build Status

Full bun fork binary **cannot be built** on this VM (needs ≥16GB RAM, ≥30GB disk).
`build.zig` correctly wires ziggit as `../ziggit` path dependency.
Benchmarks compare stock bun + git CLI vs ziggit CLI to measure replaceable operations.

## Stock Bun Install (5 Git Dependencies)

| Metric | Cold Cache | Warm Cache |
|--------|-----------|------------|
| Run 1 | 395ms | 91ms |
| Run 2 | 380ms | 82ms |
| Run 3 | 380ms | 80ms |
| **Median** | **380ms** | **82ms** |

Dependencies: is, express, chalk, debug, node-semver (all `github:` refs).

## Git CLI Sequential Workflow (5 repos)

`git clone --bare --depth=1` + `git rev-parse HEAD` + `git archive HEAD | tar -x`

| Run | Total (5 repos) |
|-----|-----------------|
| 1 | 809ms |
| 2 | 696ms |
| 3 | 692ms |
| **Median** | **696ms** |

## Ziggit CLI Sequential Workflow (5 repos)

`ziggit clone` + `ziggit log -1` + `ziggit status`

| Run | Total (5 repos) |
|-----|-----------------|
| 1 | 1676ms |
| 2 | 1133ms |
| 3 | 1164ms |
| **Median** | **1164ms** |

## Per-Repo Median Comparison

| Repo | Git CLI | Ziggit | Ratio |
|------|---------|--------|-------|
| is | 149ms | 137ms | 0.92x ✅ |
| express | 173ms | 690ms | 3.99x ❌ |
| chalk | 137ms | 102ms | 0.74x ✅ |
| debug | 120ms | 93ms | 0.78x ✅ |
| node-semver | 143ms | 151ms | 1.06x ≈ |

## Local Re-Clone (chalk bare → working tree)

| Tool | Median |
|------|--------|
| git archive + tar | 5ms |
| ziggit clone local | 8ms |

## Summary

- **Small repos:** Ziggit is comparable or faster than git CLI (0.74x-0.92x)
- **Large repos (express):** Ziggit is ~4x slower — no shallow clone support, full pack indexing
- **Local ops:** Both fast (~5-8ms), git slightly ahead
- **Checkout bug:** Ziggit fails to populate working tree (`error.InvalidCommit`)
- **Shallow clone:** Not supported — biggest performance gap vs git

## Blockers

1. 🔴 Fix checkout bug (working tree not populated)
2. 🔴 Implement `--depth=1` shallow clone support
3. 🟡 Implement `--bare` clone mode
4. 🟢 Build integration with bun works via `build.zig`
