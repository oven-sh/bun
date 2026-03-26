# ziggit vs git CLI — Benchmark Results

## Test Environment

- **OS:** Linux hdr 6.1.141 #1 SMP PREEMPT_DYNAMIC x86_64
- **Zig:** 0.13.0
- **Git:** 2.43.0
- **Test repo:** https://github.com/octocat/Hello-World.git (small repo, ~13 objects)
- **Network:** Cloud VM (low-latency to GitHub)

## Results (ReleaseFast build)

| Operation | ziggit (ms) | git CLI (ms) | Speedup | Notes |
|-----------|-------------|--------------|---------|-------|
| **clone (bare)** | 1366.733 | 113.406 | **0.08x (git wins)** | Network + HTTP implementation overhead |
| **revParseHead** | 0.033 | 1.781 | **53.80x** | Pure file read vs process spawn |
| **findCommit** | 0.047 | 2.202 | **46.83x** | Direct object lookup vs spawn `git log` |
| **describeTags** | 0.041 | 2.010 | **48.87x** | Directory scan vs spawn `git describe` |
| **fetch** | — | — | SKIPPED | Known segfault in ziggit smart_http (use-after-free in local ref map) |

### Debug build comparison

| Operation | ziggit (ms) | git CLI (ms) | Speedup |
|-----------|-------------|--------------|---------|
| clone (bare) | 4648.880 | 1495.974 | 0.32x |
| revParseHead | 0.343 | 2.171 | 6.34x |
| findCommit | 0.333 | 2.969 | 8.91x |
| describeTags | 0.338 | 2.171 | 6.41x |

## Detailed Statistics (ReleaseFast)

### revParseHead (100 iterations)
```
ziggit: mean=0.033ms min=0.027ms max=0.272ms p50=0.028ms p95=0.037ms
git:    mean=1.781ms min=0.896ms max=5.242ms p50=1.876ms p95=2.273ms
```

### findCommit (100 iterations)
```
ziggit: mean=0.047ms min=0.022ms max=1.969ms p50=0.024ms p95=0.082ms
git:    mean=2.202ms min=1.145ms max=3.155ms p50=2.191ms p95=2.952ms
```

### describeTags (100 iterations)
```
ziggit: mean=0.041ms min=0.027ms max=1.108ms p50=0.029ms p95=0.033ms
git:    mean=2.010ms min=0.968ms max=4.316ms p50=1.987ms p95=2.290ms
```

## Analysis

### Where ziggit wins decisively: Local operations (47-54x faster)

All local git operations — `revParseHead`, `findCommit`, `describeTags` — are **~50x faster** with ziggit in release mode. The speedup comes from two sources:

1. **No process spawn overhead.** Spawning `git` as a child process costs ~1-2ms per invocation (fork + exec + dynamic linker + git's own startup). Ziggit is a direct function call: ~0.03ms.

2. **No pipe/parsing overhead.** Git CLI writes output to stdout, bun reads it from a pipe, trims whitespace, etc. Ziggit returns a `[40]u8` hash directly — zero-copy, no allocation.

For bun's package manager, these operations happen **per git dependency** during resolution. A project with 10 git dependencies would save ~20ms on each `bun install` just from `findCommit` calls. With lock-file checking, `revParseHead` is called even more frequently.

### Where git CLI wins: Network operations (clone is 12x faster)

Git CLI's `clone --bare` is dramatically faster. This is expected:

- **libcurl vs Zig's std.http:** Git uses libcurl with connection pooling, HTTP/2, and years of optimization. Ziggit uses Zig's standard library HTTP client which is simpler.
- **Pack negotiation:** Git has sophisticated pack negotiation (multi_ack_detailed, thin packs). Ziggit's smart HTTP is newer and less optimized.
- **TLS:** Git uses the system's OpenSSL/GnuTLS. Zig's TLS is pure Zig — correct but not as fast.

However, in bun's actual usage pattern, clones are **cached** — they happen once per dependency and are stored in `~/.bun/install/cache/`. Subsequent installs only need `fetch` (when the dep changes) or local operations (always). So the clone speed matters less in practice.

### Fetch: known bug

Ziggit's `fetch()` segfaults due to a use-after-free in `smart_http.zig:fetchNewPack()` when building the local refs map. This is a ziggit bug (not a bun integration issue) and should be fixed before production use.

## Conclusion

**Is this a legitimate improvement for bun?**

**Yes, for local operations.** The 47-54x speedup on `findCommit`, `revParseHead`, and `describeTags` is significant and real. These are the operations that happen on every `bun install` after the initial clone. The improvement comes from eliminating process spawn overhead, which is a fundamental advantage of in-process calls over CLI invocation.

**Not yet for network operations.** Clone and fetch need more work in ziggit's HTTP layer. The recommendation is:

1. **Phase 1 (now):** Replace local git operations (`findCommit`, `revParseHead`, `describeTags`) with ziggit — immediate 50x speedup per call.
2. **Phase 2 (after ziggit HTTP optimization):** Replace `clone` and `fetch` — only after ziggit's HTTP performance matches git CLI.
3. **Fallback:** Keep `exec()` as a fallback for SSH URLs and edge cases ziggit doesn't handle yet.

### Impact estimate

For a typical project with N git dependencies:
- **Current (git CLI):** ~2ms × 3 operations × N = ~6ms × N overhead
- **With ziggit (local ops):** ~0.04ms × 3 operations × N = ~0.12ms × N overhead
- **Savings:** ~5.88ms per git dependency, or **~59ms for 10 git deps**

The savings are modest in absolute terms but meaningful for bun's goal of being the fastest JavaScript runtime. Every millisecond counts in `bun install`.
