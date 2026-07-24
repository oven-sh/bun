# DFG/FTL compile-time memory measurement

Scripts for measuring JavaScriptCore optimizing-JIT working memory under
JetStream3. See `docs/contributing/jsc-jit-compile-memory.md` for the
methodology and findings.

Both scripts are Linux-only (they read `/proc/<pid>/statm`).

```sh
export JSC=/path/to/release/jsc
# Coarse per-tier peak RSS across the default test list:
bun measure-jit-mem.ts

# Per-phase RSS for the heaviest DFG compile in octane-zlib:
bun phase-mem.ts octane-zlib 3 dfg-only

# Per-phase RSS for the heaviest FTL compile in typescript:
bun phase-mem.ts typescript 20 ftl
```
