# TypeScript Build System

This directory generates `build.ninja`. The scripts **describe** the build; ninja **performs** it.

## Goals

**Idempotent.** Run `bun run build` over and over — that's it. Same inputs produce the same `build.ninja`, ninja sees nothing changed, exits immediately. No state drift between runs, no "did I clean first?", no sticky flags from last time. The mechanisms:

- **Configure always runs.** Every `bun run build` reconfigures before spawning ninja — no separate first-time configure step, no cached options that persist across runs. Config is `profile + overrides` evaluated fresh each time. Fast enough to not matter (~200ms — we haven't tried to make it faster yet).
- `writeIfChanged()` — preserves mtimes on unchanged content, so the always-configure cost is near-zero for ninja: if `build.ninja` didn't change, ninja doesn't restat the graph
- `restat = 1` on fetch/codegen/dep rules — prunes downstream rebuilds when outputs don't actually change
- Self-rebuilding `build.ninja` — the `regen` generator rule re-runs configure when running ninja directly and a build script changed

**Explicit over implicit.** Every decision traceable to a line of code you can grep for. No hidden defaults, no order-dependent global state, no "it works because something else happened to set this."

- **One flat `Config` struct.** All derived booleans computed once in `resolveConfig()`. No `if(ENABLE_X)` depending on `if(CI)` depending on `if(RELEASE)` — the chain resolves here, the result is a plain value.
- **One flat table per flag category.** Each flag has a `when` predicate and a `desc`. To find why `-fno-unwind-tables` is set, grep for it in `flags.ts`. Related flags live adjacent so coupling is visible.
- **Explicit rule registration** — see "registerXxxRules vs emitXxx" below.
- **One concern per file** — see Module inventory.

**Minimal cross-platform diffs.** Platform-specific logic is abstracted once, consumed everywhere. `Config` derives `cfg.exeSuffix`/`cfg.objSuffix`/`cfg.libPrefix`/`cfg.libSuffix` so callers write `lib${name}${cfg.libSuffix}` not `if windows ".lib" else ".a"`. Flag tables use `when: c => c.darwin` predicates — one table entry, not a new branch in N files. `shell.ts`/`stream.ts`/`tools.ts`/`compile.ts` absorb the remaining cmd.exe-vs-sh, `.exe` suffix, and clang-vs-clang-cl differences. Where a branch is unavoidable (Windows resources, Darwin dsymutil, Linux setarch), it lives in one function and returns empty on other platforms.

**First-class support for deps with their own build systems.** Vendored deps keep their native cmake/cargo — we don't rewrite their build into our graph. `BuildSpec` variants:

- `nested-cmake` — invoke the dep's own cmake configure + build as ninja edges. Flags forwarded via `-DCMAKE_C_FLAGS`; cmake's own dependency tracking handles incrementality inside.
- `cargo` — invoke cargo build. Cargo's incremental build is reliable; `restat = 1` keeps our downstream no-ops fast.
- `direct` — for deps simple enough that an overlay CMakeLists.txt is more work than listing files (tinycc, picohttpparser). Sources become first-class `cc` edges in our graph.
- `prebuilt` — skip build entirely, download compiled `.a`/`.lib` (WebKit, nodejs-headers).

The `dep` pool (depth 4) throttles concurrent sub-builds so 15 nested `cmake --build -j` don't oversubscribe cores.

**Self-obsoleting workarounds** — see "Adding a workaround" below.

## Configure time vs build time

Configure time is Phase 1 below — resolve tools, compute flags, glob sources, write `build.ninja` and constant manifests, validate, pre-create output dirs. Build time is everything ninja does: turning source files into outputs.

**The smell:** if configure code calls `spawnSync` to compile something, or compares mtimes with `statSync`, it's doing ninja's job. Make it a build edge — `n.rule()` + `n.build()`. Size doesn't matter; a 1-file compile is still a build edge.

**Legitimate `spawnSync` at configure time:** tool detection (`clang --version`), git revision, `xcrun --show-sdk-path`. These probe the environment; they don't produce build artifacts.

## Ninja primer

A **rule** is a command template. A **build edge** instantiates a rule with specific files. The graph is just edges; rules are deduplication. Two real examples from our generated `build/<profile>/build.ninja`:

```ninja
rule cc
  command = clang $cflags -MMD -MT $out -MF $out.d -c $in -o $out
  depfile = $out.d
  deps = gcc

build obj/src/foo.c.o: cc ../../src/foo.c | deps/zstd/libzstd.a || codegen/generated.h
  cflags = -O2 -I...
```

`cc` is defined via `n.rule("cc", {...})` in `compile.ts`; the edge is emitted by `cc(n, cfg, src, opts)` per source. The `|` starts implicit inputs, `||` starts order-only.

```ninja
rule dep_fetch
  command = bun fetch-cli.ts dep $name $repo $commit $dest ...
  restat = 1
  pool = dep

build ../../vendor/zstd/.ref: dep_fetch | ../../scripts/build/fetch-cli.ts
  name = zstd
  repo = facebook/zstd
  commit = abc123...
```

`restat = 1`: if fetch was a no-op (`.ref` unchanged), prune everything downstream. `pool = dep` throttles to 4 concurrent fetches.

All rules and edges are written to `build/<profile>/build.ninja` by `n.write()` at the end of configure. `compile_commands.json` (for clangd/LSP) is written alongside it.

Edge dependency types:

- **explicit inputs** (`$in`) — listed on the build line, passed to the command
- **implicit inputs** (`| foo`) — tracked for rebuild but not in `$in`. Use for the PCH, dep lib outputs (invalidation signal for their headers), or a per-file generated header this source is known to read
- **order-only inputs** (`|| stamp`) — must exist before this edge runs, but mtime doesn't trigger rebuild. Use for bulk codegen headers: "must be generated first, but the compiler's `.d` depfile will track which ones I actually read"

**`restat = 1`** — after the command runs, re-stat outputs; if mtime didn't change, prune downstream. Critical for idempotent steps (fetch no-op, codegen unchanged).

**`depfile`** — compiler writes `foo.o.d` listing every `#include`d header. Ninja reads it on the next build to know which headers this `.o` depends on. Codegen headers are order-only for this reason: they're declared outputs with restat, the depfile gives exact per-file header deps on build 2+, and order-only just ensures they exist for build 1. Dep outputs (`lib*.a`) are a different story — PCH, cc, and no-PCH cxx use them as _implicit_ deps, because local sub-builds (e.g. WebKit) rewrite forwarding headers as undeclared side effects and order-only would lag one build behind (see Gotchas).

## Iterating on the build system

```sh
bun scripts/build.ts --configure-only       # regenerate build.ninja, don't run ninja
bunx tsc --noEmit -p scripts/build/tsconfig.json   # typecheck
grep "yourtarget\|yourrule" build/debug/build.ninja  # inspect generated output
ninja -C build/debug -t query <target>      # why does <target> rebuild?
ninja -C build/debug -t deps <target>       # what headers does foo.o depend on?
ninja -C build/debug <target>               # build a specific target (e.g. tinycc, bun-zig.o)
```

The generated `build.ninja` is the ground truth. If an edge isn't doing what you expect, read it there first.

## CLI arg parsing

`bun scripts/build.ts [build-flags] [exec-args...]`. The cutoff: first arg that isn't a recognized build/ninja flag ends build-flag parsing — it and everything after go to the built binary.

| Arg shape                                          | Goes to                                        |
| -------------------------------------------------- | ---------------------------------------------- |
| `-j<N>`, `-k<N>`, `-l<N>`, `-v`                    | ninja                                          |
| `--configure-only`, `--help`                       | build.ts                                       |
| `--<known-field>=<val>` or `--<known-field> <val>` | build.ts (profile/target/config overrides)     |
| `--`                                               | ends parsing — rest to runtime unconditionally |
| `--<unknown-field>=<val>`                          | **errors** (typo detection)                    |
| Anything else                                      | runtime, and everything after too              |

Build flags must come before exec args. `bun bd --asan=off test foo.ts` works; `bun bd test --asan=off foo.ts` sends `--asan=off` to bun-debug. Use `--` when a runtime flag collides with a build flag: `bun bd -- --target=browser script.ts`.

**`--target=<name>`** builds a specific ninja target instead of the full binary. Every dep gets phonies: `<name>` (full build), `clone-<name>` (fetch only), `configure-<name>` (cmake deps). Also `bun`, `check`, `bun-zig.o`. List all: `ninja -C build/debug -t targets`.

## Common tasks

**Add a compiler flag** — one entry in the right table in `flags.ts`:

```ts
{ flag: "-fno-foo", when: c => c.linux && c.release, desc: "why this flag" },
```

Tables: `cpuTargetFlags` (`-march`/`-mcpu`/`-mtune` — also forwarded to local WebKit via `computeCpuTargetFlags()`), `globalFlags` (bun + all deps), `bunOnlyFlags` (just bun), `linkFlags`, `stripFlags`. Use `lang: "cxx"` to restrict to C++.

**Bump a dependency** — edit the `commit` in `scripts/build/deps/<name>.ts`. See `deps/README.md` for adding/removing deps.

**Add a codegen step** — add a function in `codegen.ts` following the shape of `emitErrorCode` (simple) or `emitCppBind` (needs file-list input). Call it from `emitCodegen()` and add outputs to the right `CodegenOutputs` group (`zigInputs` if zig reads it, `cppSources` if it's a `.cpp` to compile, `cppAll` if it's a header).

**Add a Config field** — add to `Config` interface and `PartialConfig` in `config.ts`, resolve in `resolveConfig()`. If it needs a CLI flag, `build.ts`'s arg parser already handles `--anyfield=value` generically.

**Add a profile** — one entry in `profiles.ts`. Copy `debug` or `release-asan`.

## Build flow: `bun run build` → binary

### Phase 0 — Entry (`scripts/build.ts`)

1. Windows: re-exec inside VS dev shell if `VSINSTALLDIR` unset (provides PATH/INCLUDE/LIB for nested cmake).
2. Parse CLI: `--profile=<name>`, `--<field>=<value>` overrides, `--target=<ninja-target>`, `-j`/`-v`/`-k` passthrough, bare positionals = exec args for built binary.
3. Resolve `PartialConfig` from profile + overrides (or `--config-file` for ninja's self-reconfigure).

### Phase 1 — Configure (`configure.ts::configure`)

1. `resolveToolchain()` — find clang/ar/lld/strip/cmake/cargo/bun/zig/esbuild. Version-checked where it matters; paths stored on `Toolchain`.
2. `resolveConfig(partial, toolchain)` — produce the flat `Config`. Detect host, derive all target booleans, compute paths, read package.json version + git sha.
3. `validateBunConfig(cfg)` + `checkWorkarounds(cfg)` — fail early with clear errors.
4. `globAllSources()` — one filesystem snapshot of all `.cpp`/`.c`/`.zig`/codegen-input globs.
5. `new Ninja({buildDir})` + `registerAllRules(n, cfg)` — register every rule template.
6. `emitGeneratorRule(n, cfg, partial)` — persist `configure.json`, emit `regen` rule so editing any build script triggers reconfigure.
7. `emitBun(n, cfg, sources)` — assemble the build graph (see Phase 2).
8. `n.default([...])` + `n.write()` — set default targets, write `build.ninja` + `compile_commands.json`.
9. `mkdirAll(...)` — pre-create all object output dirs.

### Phase 2 — emitBun (`bun.ts::emitBun`)

For `mode: "full"` (the normal case):

1. **Deps** — loop `allDeps`, call `resolveDep(n, cfg, dep)`. Each emits fetch → configure → build (nested-cmake), or fetch → cargo, or fetch → direct cc+ar, or prebuilt download. Collects lib paths, include dirs, outputs.
2. **Codegen** — `emitCodegen(n, cfg, sources)` emits ~20 generation steps (bindgen, `.classes.ts` → C++, bundled modules, LUTs). Returns grouped outputs.
3. **Zig** — `emitZig(n, cfg, {...})` emits zig download + `zig build obj` → `bun-zig.o`.
4. **Flags** — `computeFlags(cfg)` evaluates flag tables → cflags/cxxflags/defines/ldflags/stripflags.
5. **PCH** — compile `root.h` → PCH (skipped on Windows, skipped in CI full mode).
6. **Compile** — loop sources, `cxx()`/`cc()` per file.
7. **Link** — `emitShims(n, cfg)` for platform workaround dylibs, then `link(n, cfg, exeName, objects, {libs, flags})`.
8. **Post-link** — strip (release only), dsymutil (darwin release only).
9. **Smoke test** — `<exe> --revision` catches load-time failures.

Split CI modes: `zig-only` (zstd+codegen+zig), `cpp-only` (deps+codegen+compile → archive), `link-only` (download artifacts → link).

### Phase 3 — Execute

- **CI:** collapsible log groups, spawn ninja with `spawnWithAnnotations` (parses compiler errors into Buildkite annotations), upload/download artifacts.
- **Local:** spawn ninja with FD 3 dup'd to stderr — `stream.ts`-wrapped commands write to FD 3, bypassing ninja's per-job output buffering so dep/zig progress streams live. If positionals given, exec the built binary with them.

## Module inventory

| File                           | Owns                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `build.ts` (parent dir)        | CLI entry — parse args, call configure, spawn ninja, optionally exec               |
| `configure.ts`                 | `configure()` — toolchain → config → `build.ninja`                                 |
| `config.ts`                    | `Config`/`PartialConfig`/`Toolchain`/`Host` types, `resolveConfig()`               |
| `profiles.ts`                  | Named `PartialConfig` presets + `getProfile()`                                     |
| `tools.ts`                     | Tool discovery: `findTool()`, `resolveLlvmToolchain()`, version parsing            |
| `flags.ts`                     | Flat flag tables, `computeFlags()`, `computeDepFlags()`, `computeCpuTargetFlags()` |
| `ninja.ts`                     | `Ninja` class — the build-file writer                                              |
| `rules.ts`                     | `registerAllRules()` — calls each module's `registerXxxRules()`                    |
| `compile.ts`                   | `cc`/`cxx`/`pch`/`link`/`ar` + `registerCompileRules()`                            |
| `unified.ts`                   | WebKit-style unified-source bundling, `generateUnifiedSources()`                   |
| `source.ts`                    | `Dependency` types, `resolveDep()`, fetch/configure/build emission                 |
| `codegen.ts`                   | Code generation steps, `emitCodegen()`, `CodegenOutputs`                           |
| `zig.ts`                       | Zig download + `zig build`, `emitZig()`                                            |
| `bun.ts`                       | `emitBun()` — assembles deps+codegen+zig+compile+link                              |
| `shims.ts`                     | Platform/toolchain workaround dylibs, `emitShims()`                                |
| `workarounds.ts`               | Self-obsoleting workaround registry, `checkWorkarounds()`                          |
| `depVersionsHeader.ts`         | Generates `bun_dependency_versions.h` for `process.versions`                       |
| `stream.ts`                    | Subprocess output wrapper — FD-3 sideband, zig progress decoding                   |
| `shell.ts`                     | `quote()`/`slash()` — shell escaping for ninja commands                            |
| `fs.ts`                        | `writeIfChanged()`, `mkdirAll()`                                                   |
| `error.ts`                     | `BuildError` with hint/file/cause, `assert()`                                      |
| `download.ts`                  | `downloadWithRetry()`, archive extraction                                          |
| `fetch-cli.ts`                 | Build-time CLI ninja invokes for downloads                                         |
| `ci.ts`                        | CI integration — annotations, artifacts, log groups                                |
| `clean.ts`                     | `bun run clean` preset-based cleanup                                               |
| `glob-sources.ts` (parent dir) | Source glob patterns + CLI to print them                                           |
| `deps/*.ts`                    | One `Dependency` object per vendored dep                                           |
| `deps/index.ts`                | `allDeps` array — fetch order + link order                                         |
| `shims/*.c`                    | Platform workaround sources                                                        |

## Key types

**`Dependency`** (`source.ts`) — `{name, source, patches?, fetchDeps?, build, provides, enabled?, versionMacro?}`. The `source`/`build`/`provides` fields are functions of `Config` so they vary per-target. `Source` variants: `github-archive`, `local`, `in-tree`, `prebuilt`. `BuildSpec` variants covered in Goals above.

**`Ninja`** — Accumulates rules/builds/pools/defaults, emits `build.ninja`. All paths given absolute; converted to buildDir-relative at write time.

## registerXxxRules vs emitXxx

**Rules** are ninja `rule` blocks — reusable command templates. **Build edges** are `build` statements — input→output instances.

Ninja requires all rules defined before any build references them. Hence:

1. `registerXxxRules(n, cfg)` — each module registers its rules. Called once via `registerAllRules()`.
2. `emitXxx(n, cfg, ...)` — each module emits build edges.

Why not auto-register in emit functions? Some rules are shared (`dep_configure` used by both `source.ts` and `webkit.ts` local mode). Explicit registration keeps "which rule lives where" clear.

## Gotchas

**Dep order in `allDeps` matters.** `fetchDeps: ["X"]` means X must come first (its `.ref` stamp node must exist). Link order matters too: static linking resolves left→right, providers after users.

**PCH, cc, and no-PCH cxx need implicit dep on `depHeaderSignal`**, not order-only. Local WebKit's sub-build rewrites forwarding headers as an undeclared side effect (only `lib*.a` are declared outputs). Depfiles record those headers, but ninja stats them before the sub-build runs — order-only lags one build. The lib itself is the invalidation signal. Codegen headers stay order-only: they're declared outputs with restat, so depfile tracking is exact.

**Windows `ReleaseFast` → `ReleaseSafe`** in `zig.ts`. Load-bearing since Bun 1.1; caught more crashes. Don't "fix" it.

**`isExecutable` must check `isFile()`.** `X_OK` on a directory means traversable — a `cmake/` dir in PATH would shadow the real cmake binary.

**cmd.exe quoting is partial.** `shell.ts` quote() handles spaces/special chars but NOT `%VAR%` expansion, `^` escape, `&|>` redirection. If an arg contains those, switch to powershell.

**`rm -rf build/` doesn't clear the cache locally.** `cfg.cacheDir` is machine-shared at `$BUN_INSTALL/build-cache` for non-CI builds (ccache, zig, tarballs, prebuilt WebKit). Everything there is content-addressed or version-stamped, so a stale entry can't be hit — don't reach for `bun run clean cache` as a debugging step. If a build misbehaves, the bug is in the inputs or the graph, not the cache; nuking it just costs you a cold rebuild. CI keeps `<buildDir>/cache` so `rm -rf build/` is still a full reset there.

## Node compatibility

The build system runs under Node 24+ with `--experimental-strip-types` (or Node 25+ without the flag). CI invokes it this way via `process.execPath` in `.buildkite/ci.mjs`.

`cfg.jsRuntime` holds the shell-ready command prefix for running `.ts` subprocesses (stream.ts, fetch-cli.ts, the regen rule) — it's `process.execPath` when bun runs configure, or `node --experimental-strip-types` when node does. The subprocesses inherit whichever runtime started the build.

**TODO — remaining `cfg.bun` usage (codegen only):** For a fully bun-optional build:

- `cfg.packageManager` — `bun install` or `npm install` for the one codegen install step.
- Codegen `.ts` scripts (~20 ninja rules) — either verify they're node-compatible and switch to `cfg.jsRuntime`, or bundle them via esbuild first and run the output with plain node.
- `cfg.esbuild` — already separate.

With those done, `cfg.bun` disappears.

## Adding a workaround

Every temporary fix for a toolchain/OS bug registers a self-obsoleting check so it can't rot silently:

1. Put the artifact under `scripts/build/shims/` (or `patches/` for source patches).
2. Emit it as a ninja build edge from `shims.ts` (or the appropriate module).
3. Register an entry in `workarounds.ts` with an `expectedToBeFixed` predicate — configure fails with cleanup instructions once the upstream fix ships.

`expectedToBeFixed` typically checks a tool version against a threshold (e.g. `cfg.clangVersion >= "23.0.0"`). When you know exactly which release has the fix, use that. When you don't — fix merged upstream but not released yet — pick your best guess for the likely release. The check might trip on a version that turns out not to have the fix; that's okay. The error message tells the dev to bump the threshold, which takes 30 seconds. That's cheaper than leaving the check blank and the workaround living forever because nobody remembered to come back.
