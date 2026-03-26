# ziggit vs git CLI — Benchmark Results

## Test Environment

- **OS:** Linux hdr 6.1.141 #1 SMP PREEMPT_DYNAMIC x86_64
- **Zig:** 0.13.0 (ReleaseFast build)
- **Git:** 2.43.0
- **Test repo:** https://github.com/octocat/Hello-World.git (small repo, ~13 objects)
- **Network:** Cloud VM (low-latency to GitHub)
- **Date:** 2026-03-26

## Results (ReleaseFast build)

| Operation | ziggit (ms) | git CLI (ms) | Speedup | Notes |
|-----------|-------------|--------------|---------|-------|
| **clone (bare)** | 782.450 | 132.701 | **0.17x (git wins)** | Network + HTTP implementation overhead |
| **revParseHead** | 0.028 | 0.917 | **33.08x** | Pure file read vs process spawn |
| **findCommit** | 0.027 | 1.087 | **40.21x** | Direct object lookup vs spawn `git log` |
| **describeTags** | 0.027 | 0.968 | **35.71x** | Directory scan vs spawn `git describe` |
| **fetch** | — | — | SKIPPED | Known segfault in ziggit smart_http (use-after-free in local ref map) |

## Detailed Statistics (ReleaseFast, 100 iterations for local ops, 5 for network)

### clone (bare) — 5 iterations
```
ziggit: mean=782.450ms min=735.886ms max=850.345ms p50=774.121ms p95=850.345ms
git:    mean=132.701ms min=120.876ms max=159.412ms p50=127.050ms p95=159.412ms
```

### revParseHead — 100 iterations
```
ziggit: mean=0.028ms min=0.021ms max=0.364ms p50=0.023ms p95=0.028ms
git:    mean=0.917ms min=0.889ms max=1.005ms p50=0.905ms p95=0.973ms
```

### findCommit — 100 iterations
```
ziggit: mean=0.027ms min=0.022ms max=0.307ms p50=0.023ms p95=0.030ms
git:    mean=1.087ms min=1.051ms max=1.483ms p50=1.066ms p95=1.136ms
```

### describeTags — 100 iterations
```
ziggit: mean=0.027ms min=0.022ms max=0.322ms p50=0.023ms p95=0.029ms
git:    mean=0.968ms min=0.938ms max=1.031ms p50=0.955ms p95=1.025ms
```

## Analysis

### Where ziggit wins decisively: Local operations (33-40x faster)

All local git operations — `revParseHead`, `findCommit`, `describeTags` — are **33-40x faster** with ziggit in release mode. The speedup comes from two sources:

1. **No process spawn overhead.** Spawning `git` as a child process costs ~0.9-1.1ms per invocation (fork + exec + dynamic linker + git's own startup). Ziggit is a direct function call: ~0.025ms.

2. **No pipe/parsing overhead.** Git CLI writes output to stdout, bun reads it from a pipe, trims whitespace, etc. Ziggit returns a `[40]u8` hash directly — zero-copy, no allocation.

For bun's package manager, these operations happen **per git dependency** during resolution. A project with 10 git dependencies would save ~10ms on each `bun install` just from `findCommit` calls. With lock-file checking, `revParseHead` is called even more frequently.

### Where git CLI wins: Network operations (clone is ~6x faster)

Git CLI's `clone --bare` is dramatically faster. This is expected:

- **libcurl vs Zig's std.http:** Git uses libcurl with connection pooling, HTTP/2, and years of optimization. Ziggit uses Zig's standard library HTTP client which is simpler.
- **Pack negotiation:** Git has sophisticated pack negotiation (multi_ack_detailed, thin packs). Ziggit's smart HTTP is newer and less optimized.
- **TLS:** Git uses the system's OpenSSL/GnuTLS. Zig's TLS is pure Zig — correct but not as fast.

However, in bun's actual usage pattern, clones are **cached** — they happen once per dependency and are stored in `~/.bun/install/cache/`. Subsequent installs only need `fetch` (when the dep changes) or local operations (always). So the clone speed matters less in practice.

### Fetch: known bug

Ziggit's `fetch()` segfaults due to a use-after-free in `smart_http.zig:fetchNewPack()` when building the local refs map. This is a ziggit bug (not a bun integration issue) and should be fixed before production use.

## Conclusion

**Is this a legitimate improvement for bun?**

**Yes, for local operations.** The 33-40x speedup on `findCommit`, `revParseHead`, and `describeTags` is significant and real. These are the operations that happen on every `bun install` after the initial clone. The improvement comes from eliminating process spawn overhead, which is a fundamental advantage of in-process calls over CLI invocation.

**Not yet for network operations.** Clone and fetch need more work in ziggit's HTTP layer. The recommendation is:

1. **Phase 1 (now):** Replace local git operations (`findCommit`, `revParseHead`, `describeTags`) with ziggit — immediate 33-40x speedup per call, with git CLI fallback.
2. **Phase 2 (after ziggit HTTP optimization):** Replace `clone` and `fetch` — only after ziggit's HTTP performance matches git CLI.
3. **Fallback:** Keep `exec()` as a fallback for SSH URLs and edge cases ziggit doesn't handle yet.

### Impact estimate

For a typical project with N git dependencies:
- **Current (git CLI):** ~1.0ms × 3 operations × N = ~3ms × N overhead
- **With ziggit (local ops):** ~0.027ms × 3 operations × N = ~0.08ms × N overhead
- **Savings:** ~2.9ms per git dependency, or **~29ms for 10 git deps**

The savings are modest in absolute terms but meaningful for bun's goal of being the fastest JavaScript runtime. Every millisecond counts in `bun install`. The bun integration uses ziggit for local operations with automatic fallback to git CLI, so there is zero risk of regression.
