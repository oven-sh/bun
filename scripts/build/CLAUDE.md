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

**Deps in our graph by default; native build systems when needed.** `BuildSpec` variants:

- `direct` — list the dep's sources explicitly; each becomes a first-class `cc`/`cxx` edge in our graph and the `.o`s go straight into bun's link. The default for the C/C++ deps (zlib, zstd, boringssl, libarchive, mimalloc, …). Skips a sub-process configure entirely and lets LTO see across the dep boundary.
- `nested-cmake` — invoke the dep's own cmake configure + build as ninja edges. For deps whose build is too entangled to list by hand. Flags forwarded via `-DCMAKE_C_FLAGS`; cmake's own dependency tracking handles incrementality inside.
- `cargo` — (rule kept for out-of-workspace cargo deps; none today — lolhtml and rust-argon2 are path dependencies compiled as units of bun's own Rust graph).
- `prebuilt` — skip build entirely, download compiled `.a`/`.lib` (WebKit, nodejs-headers).

The `dep` pool (depth 4) throttles concurrent nested cmake/cargo sub-builds so they don't oversubscribe cores.

**Self-obsoleting workarounds** — see "Adding a workaround" below.

## Configure time vs build time

Configure time is Phase 1 below — resolve tools, compute flags, glob sources, write `build.ninja` and constant manifests, validate, pre-create output dirs. Build time is everything ninja does: turning source files into outputs.

**The smell:** if configure code calls `spawnSync` to compile something, or compares mtimes with `statSync`, it's doing ninja's job. Make it a build edge — `n.rule()` + `n.build()`. Size doesn't matter; a 1-file compile is still a build edge.

**Legitimate `spawnSync` at configure time:** tool detection (`clang --version`), git revision, `xcrun --show-sdk-path` — these probe the environment. None of these compile or fetch anything.

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
- **order-only inputs** (`|| stamp`) — must exist before this edge runs, but mtime doesn't trigger rebuild. Use for bulk codegen headers: "must be generated first, but the compiler's `.d` depfile will track which ones I actually read". A group of them goes behind one phony (`obj/.codegen-ready`) so each compile edge names one input, not the list
- **validations** (`|@ check`) — built whenever this edge is, but not an input of it or of anything downstream. The smoke test is a validation of bun's link: relinking runs it, nothing waits on it

**`restat = 1`** — after the command runs, re-stat outputs; if mtime didn't change, prune downstream. Critical for idempotent steps (fetch no-op, codegen unchanged).

**`console` pool** — depth 1 and owns the terminal. Only for jobs with a TTY UI worth watching (cargo, dsymutil); never for links, checks, or anything else the graph has several of, since it serializes them.

**`depfile`** — compiler writes `foo.o.d` listing every `#include`d header. Ninja reads it on the next build to know which headers this `.o` depends on. Codegen headers are order-only for this reason: they're declared outputs with restat, the depfile gives exact per-file header deps on build 2+, and order-only just ensures they exist for build 1. Dep outputs (`lib*.a`) are a different story — PCH, cc, and no-PCH cxx use them as _implicit_ deps, because local sub-builds (e.g. WebKit) rewrite forwarding headers as undeclared side effects and order-only would lag one build behind (see Gotchas).

## Iterating on the build system

```sh
bun scripts/build.ts --configure-only       # regenerate build.ninja, don't run ninja
bunx tsc --noEmit -p scripts/build/tsconfig.json   # typecheck
grep "yourtarget\|yourrule" build/debug/build.ninja  # inspect generated output
bun run build --target=<target>             # build a specific target (e.g. tinycc, bun-rust)
bun run build -n -d explain                 # what would rebuild, and why (dry run)
bun run build -t query <target>             # <target>'s inputs and outputs
bun run build -t deps <target>              # what headers does foo.o depend on?
bun run build --timings                     # where the build's time went (see "Timings")
bun run build --configure-only --timings    # the same report for the directory as it is, without building
```

The generated `build.ninja` is the ground truth. If an edge isn't doing what you expect, read it there first.

## CLI arg parsing

`bun scripts/build.ts [build-flags] [exec-args...]`. The cutoff: first arg that isn't a recognized build/ninja flag ends build-flag parsing — it and everything after go to the built binary.

| Arg shape                                          | Goes to                                        |
| -------------------------------------------------- | ---------------------------------------------- |
| `-j<N>`, `-k<N>`, `-l<N>`, `-v`, `-n`, `-d <mode>` | ninja                                          |
| `-t <tool> [args…]`                                | the ninja tool, and nothing else (see below)   |
| `--configure-only`, `--timings`, `--help`          | build.ts                                       |
| `--<known-field>=<val>` or `--<known-field> <val>` | build.ts (profile/target/config overrides)     |
| `--`                                               | ends parsing — rest to runtime unconditionally |
| `--<unknown-field>=<val>`                          | **errors** (typo detection)                    |
| Anything else                                      | runtime, and everything after too              |

Everything ninja does goes through build.ts, never a bare `ninja`: the build runs a pinned ninja (`ninja-release.ts`), and a different version in the same directory can start the build log over. `-t <tool>` (`query`, `deps`, `commands`, `targets`, …) runs that ninja's tool on the build directory as it is, without configuring or building, and everything after `-t` is the tool's.

Build flags must come before exec args. `bun bd --asan=off test foo.ts` works; `bun bd test --asan=off foo.ts` sends `--asan=off` to bun-debug. Use `--` when a runtime flag collides with a build flag: `bun bd -- --target=browser script.ts`.

**`--target=<name>`** builds a specific ninja target instead of the full binary. Every dep gets phonies: `<name>` (full build), `clone-<name>` (fetch only), `configure-<name>` (cmake deps). Also `bun`, `check`, `bun-rust`. List all: `$NINJA -C build/debug -t targets`.

## Common tasks

**Add a compiler flag** — one entry in the right table in `flags.ts`:

```ts
{ flag: "-fno-foo", when: c => c.linux && c.release, desc: "why this flag" },
```

Tables: `cpuTargetFlags` (`-march`/`-mcpu`/`-mtune` — also forwarded to local WebKit via `computeCpuTargetFlags()`), `globalFlags` (bun + all deps), `bunOnlyFlags` (just bun), `linkFlags`, `stripFlags`. Use `lang: "cxx"` to restrict to C++.

**Bump a dependency** — edit the `commit` in `scripts/build/deps/<name>.ts`. See `deps/README.md` for adding/removing deps.

**Iterate on a dependency from a local checkout** — `bun bd --local-deps=mimalloc=~/code/mimalloc …` builds that dep from the clone instead of the pinned tarball (no fetch, no patches; edits rebuild incrementally). Any `github-archive` dep the graph compiles (not lolhtml or rust-argon2 — cargo reads those via `Cargo.toml`); details in `deps/README.md`.

**Add a codegen step** — add a function in `codegen.ts` following the shape of `emitErrorCode` (simple) or `emitCppBind` (needs file-list input). Use the `codegen` rule: it runs the script with `cfg.jsRuntime`, so the script must run under node and bun. Call it from `emitCodegen()` and add outputs to the right `CodegenOutputs` group (`rustInputs` if the Rust build reads it (the `include!`d generated `.rs` files) — `cppSources` if it's a `.cpp` to compile, `cppHeaders` if it's a header. `emitCodegen()` builds `cppAll` from those groups at the end, so do not push to it). A type declaration `src/js/builtins.d.ts` references goes in `cfg.typesDir` and the `generatedTypes` group. The functions take `CodegenFields`: a config field a generator newly reads is added to that `Pick` and must be one `resolveBase()` can decide without a native tool.

**Add a ninja rule** — add its name to `ruleVars` in `ninja.ts` with the `$variables` its text reads, and `n.rule()` it in the module's `registerXxxRules()`. `n.build({ rule, vars })` is typed by the table, and configure fails if the table and the rule's text disagree. Text that needs other variables on some platform is another rule (`pch` / `pch_msvc`). ninja's own bindings (`pool`, `depfile`, `early_output_prefix`) are fields of the build statement, not `vars`.

**Add a Config field** — add to `Config` interface and `PartialConfig` in `config.ts`, resolve in `resolveConfig()`. Add its entry to `configFlags` in `build.ts`: every `PartialConfig` field is a `--<field>` flag, and tsc fails without one.

**Add a profile** — one entry in `profiles.ts`. Copy `debug` or `release-asan`.

## Build flow: `bun run build` → binary

### Phase 0 — Entry (`scripts/build.ts`)

1. Windows: re-exec inside VS dev shell if `VSINSTALLDIR` unset (provides PATH/INCLUDE/LIB for nested cmake).
2. Parse CLI: `--profile=<name>`, `--<field>=<value>` overrides, `--target=<ninja-target>`, `-j`/`-v`/`-k` passthrough, bare positionals = exec args for built binary.
3. Resolve `PartialConfig` from profile + overrides (or `--config-file` for ninja's self-reconfigure).

### Phase 1 — Configure (`configure.ts::configure`)

1. `resolveToolchain()` — find clang/ar/lld/strip/cmake/cargo/bun/esbuild. Version-checked where it matters; paths stored on `Toolchain`.
2. `resolveConfig(partial, toolchain)` — produce the flat `Config`. Detect host, derive all target booleans, compute paths, read package.json version + git sha.
3. `validateBunConfig(cfg)` + `checkWorkarounds(cfg)` — fail early with clear errors.
   - `generateCargoConfig(cfg)` — write the repo-root `.cargo/config.toml` (git-ignored) with the per-target `linker = ` from the discovered `cfg.hostCxx`. Advisory only for `bun bd` (the rustc edges pass `-C linker` themselves); it's there for `cargo build`/`cargo check`/rust-analyzer run directly.
4. `globAllSources()` — one filesystem snapshot of all `.cpp`/`.c`/`.rs`/codegen-input globs.
5. `new Ninja({buildDir})` + `registerAllRules(n, cfg)` — register every rule template.
6. `emitBun(n, cfg, sources)` — assemble the build graph (see Phase 2).
7. `emitGeneratorRule(n, cfg, partial)` — persist `configure.json`, emit `regen` rule so editing any build script triggers reconfigure.
8. `n.default([...])` + `n.write()` — set default targets, write `build.ninja` + `compile_commands.json`; then stamp `build.ninja` and `ninja -t restat` it so ninja's log agrees the manifest is current (otherwise its own `regen` edge would rerun configure once more after any script edit).
9. `mkdirAll(...)` — pre-create all object output dirs.

### Phase 2 — emitBun (`bun.ts::emitBun`)

For `mode: "full"` (the normal case):

1. **Codegen** — `emitCodegen(n, cfg, sources)` emits ~20 generation steps (bindgen, `.classes.ts` → C++, bundled modules, LUTs). Returns grouped outputs.
2. **Rust** — `emitRust(n, cfg, {...})` emits one rustc edge per crate and returns the crates' rlibs, `bun_runtime`'s and std's included, which the link takes beside the C/C++ objects (after resolving the vendored path deps, lolhtml and rust-argon2). cargo plans, ninja executes: the `rust_plan` edge runs `cargo build … --unit-graph` + `cargo metadata` for exactly the arguments `cargoBuildInvocation()` computes and writes `rust/plan.json`; `build.ninja` depends on that file, so a new plan (lockfile/manifest/toolchain change) reconfigures and ninja restarts. `rust/units.ts` turns each unit into a rustc argv/env (cargo's rules, transcribed and diffed against `cargo -vv`), written to `rust/units/<crate>-<hash>.json`; `rust/emit.ts` emits the edges; `rust/run.ts` executes them. Every edge is one process from start to exit, and a crate is one edge: one rustc with the `.rlib` and the `.rmeta` as outputs. Dependent libraries name only the `.rmeta`, which rustc writes long before it has generated code; the edge carries `early_output_prefix`, which asks ninja to release an output when the running command announces it. oven-sh/ninja (what the driver runs, see `ninja-release.ts`) exports the prefix to the command as `NINJA_EARLY_OUTPUT_PREFIX`, `rust/run.ts` prints it with the `.rmeta`'s path when rustc reports the file written, and dependents start while rustc goes on — cargo's pipelining. A stock ninja ignores the binding and releases both outputs at exit: the same graph, built correctly, without the overlap. Build scripts are a compile edge plus a `rust_build_script` run edge whose parsed directives (`output.json`, restat) feed the package's rustc edges. A Windows target has a second graph built the same way, under `rust/shim/`: the `.bin/` launcher (`src/install/windows-shim`), planned with `--profile shim` and `-Zbuild-std`, with a `bin` root that `run.ts` also writes to `<codegenDir>/bun-shim-impl.exe`, where `bun_install` embeds it from (every edge of that package waits for it). Codegen and Rust are emitted before the deps on purpose: with no `.ninja_log` (every CI build) ninja weighs each edge as 1 and runs the longest remaining chain first, ties in emission order.
3. **Deps** — loop `allDeps`, call `resolveDep(n, cfg, dep)`. Each emits fetch → configure → build (nested-cmake), or fetch → cargo, or fetch → direct cc+ar, or prebuilt download. Collects objects, lib paths, include dirs, outputs.
4. **Flags** — `computeFlags(cfg)` evaluates flag tables → cflags/cxxflags/defines/ldflags/stripflags.
5. **PCH** — compile `root-pch.h` → PCH.
6. **Compile** — loop sources, `cxx()`/`cc()` per file.
7. **Link** — `emitShims(n, cfg)` for platform workaround dylibs, then `link(n, cfg, exeName, objects, {libs, flags})`.
8. **Post-link** — strip (release only), dsymutil (darwin release only).
9. **Checks** — validations of the link edge (`ninja check` names them too), all static except the first: `<exe> --revision` (load-time failures; only when the host can run the target), `verify-binary.ts binary` (exported symbols vs the lists in src/, exact NEEDED/dylib/DLL set and glibc/FBSD symbol-version ceilings, forbidden imports, static-initializer allowlist, W^X / nx-stack / PIE / DllCharacteristics, debug-info shape — expectations in `binary-expectations.ts`), and `verify-binary.ts duplicates` (no symbol strongly defined by two link inputs). Only CI fails on a finding: local builds (`cfg.ci` unset), and ASan and debug builds in CI, run the two scans with `--warn-only` (`binaryChecksWarnOnly` in `bun.ts`) — same report, the step passes.

CI's `build-bun` step uses `archive-link` (`ci-build` profile): the same graph, with the C/C++ objects archived into `libbun-<exe>.a` and linked from that archive; the archive and the dep libs are uploaded from ninja edges as soon as each exists.

**No crate is a final Rust artifact.** `bun_runtime` is a library like the rest and bun's link takes the rlibs, so what rustc decides only when _it_ links is decided here: the allocator marker `__rust_no_alloc_shim_is_unstable_v2` is defined in `src/runtime/bin_entry/mod.rs` (the allocator itself comes from `#[global_allocator]` there, the error handler from std), and `rust.ts` leaves the panic runtime the profile does not use (`panic_unwind` under `panic = "abort"`) out of the link. Release Rust is bitcode in the rlibs (`-C linker-plugin-lto`) and lld optimises it, together with the C++ where cross-language LTO is on.

### `mode: "codegen"` — the code generators alone

`--mode=codegen` configures a graph of the codegen steps only, default target `codegen`, for what needs their outputs and no binary. It has a build directory of its own (`build/debug-codegen`): its manifest and `compile_commands.json` have no native edges in them, and `build/debug` is where clangd reads `compile_commands.json`. `bun run build:types` (`--mode=codegen --target=generated-types`) is what `lint.yml` runs before typechecking `src/js`.

**`build/types/` (`cfg.typesDir`)** holds the type declarations `src/js/builtins.d.ts` references: `generated.d.ts`, `ErrorCode.d.ts`, `ZigGeneratedClasses.d.ts`, `WebCoreJSBuiltins.d.ts`. They are made from source alone (byte-identical between debug and release), so they do not live under a profile's build directory: every profile's graph declares the same files there, the way a dep's `vendor/<name>/.ref` is, and any build keeps them current for the editor. They are declared outputs of the edges that write them (`CodegenOutputs.generatedTypes`, target `generated-types`), so ninja regenerates one that is deleted or whose edge inputs changed. `src/runtime/bake/generated.ts` (the dev server's message enums, which the bake project imports) is in the same target, declared by the bake codegen edge that writes it.

It is configured by `configureCodegen()`, not `configure()`, and resolves a `CodegenConfig`, not a `Config`:

- `resolveJsToolchain()` looks for bun and the root install's esbuild. No compiler, linker, cmake or cargo is looked for, no SDK or sysroot is fetched, and `.cargo/config.toml` is not written. perl is required (the LUT steps).
- `CodegenFields` (`config.ts`) is the `Pick` of `Config` the generators read, and `codegen.ts` takes that type, so a generator that starts reading a native tool does not compile.
- `resolveBase()` decides the build type, the paths, the JavaScript tools and what `build_options.rs` is generated from, for both `resolveConfig()` and `resolveCodegenConfig()`.

### Phase 3 — Execute

- **CI:** collapsible log groups, spawn ninja with `spawnWithAnnotations` (parses compiler errors into Buildkite annotations), upload/download artifacts.
- **Which ninja:** `ensureNinja()` (`ninja-release.ts`), called by configure and returned as `ConfigureResult.ninja` — the oven-sh/ninja release pinned in `ci-images/spec.ts` (`pins.bunNinja`): the one a CI image has at `locations.bunNinja`, else fetched once into `cfg.cacheDir` (reported as `[ninja] fetching …` / `[ninja] extracted to …`) and checked against the pinned sha256; `ninja` from PATH if there is no release for the host, it can't be fetched, or the machine won't run it (`ninja --version` is tried on every configure: a machine can refuse programs it does not know). Configure fetches it, beside the macOS SDK and the Windows sysroot, because an edge can't: it is what runs the edges. A regen replay and the helper scripts use `ninjaIfPresent()` — the same binary, never a fetch: ninja versions disagree on the `.ninja_log` format and rewrite or delete a log they don't recognise, so everything that touches a build directory must be one ninja.
- **One build per build directory at a time.** Nothing enforces it (ninja has no lock either). Two builds of the same directory at once can fail: a rustc edge deletes its crate's old `.rlib` before compiling, while the other build may be reading it.
- **Local:** spawn ninja with FD 3 dup'd to stderr — `stream.ts`-wrapped commands (dep builds, the cargo plan edge) write to FD 3, bypassing ninja's per-job output buffering so their progress streams live; rustc edges are plain ninja commands. If positionals given, exec the built binary with them.

## Module inventory

| File                           | Owns                                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build.ts` (parent dir)        | CLI entry — parse args, call configure, spawn ninja, optionally exec                                                                                                    |
| `configure.ts`                 | `configure()` — toolchain → config → `build.ninja`; `configureCodegen()` for `mode: "codegen"`                                                                          |
| `config.ts`                    | `Config`/`PartialConfig`/`Toolchain`/`Host` types, `resolveConfig()`; `CodegenFields`/`CodegenConfig`, `resolveCodegenConfig()`                                         |
| `profiles.ts`                  | Named `PartialConfig` presets + `getProfile()`                                                                                                                          |
| `tools.ts`                     | Tool discovery: `findTool()`, `resolveLlvmToolchain()`, version parsing, `checkImageTools()`                                                                            |
| `flags.ts`                     | Flat flag tables, `computeFlags()`, `computeDepFlags()`, `computeCpuTargetFlags()`                                                                                      |
| `ninja.ts`                     | `Ninja` class — the build-file writer; `readManifest()`, which reads what it wrote back                                                                                 |
| `timings.ts`                   | `--timings`: where a build directory's time went, from `.ninja_log`, `build.ninja` and output mtimes: the report, and `timings.html`, the same as a chart               |
| `ninja-release.ts`             | `ensureNinja()`/`ninjaIfPresent()`: the oven-sh/ninja release pinned in `ci-images/spec.ts` — the CI image's copy, else fetched into the build cache, else PATH         |
| `rules.ts`                     | `registerAllRules()` — calls each module's `registerXxxRules()`                                                                                                         |
| `compile.ts`                   | `cc`/`cxx`/`pch`/`link`/`ar` + `registerCompileRules()`                                                                                                                 |
| `unified.ts`                   | WebKit-style unified-source bundling, `generateUnifiedSources()`                                                                                                        |
| `source.ts`                    | `Dependency` types, `resolveDep()`, fetch/configure/build emission                                                                                                      |
| `codegen.ts`                   | Code generation steps, `emitCodegen()`, `CodegenOutputs`                                                                                                                |
| `rust.ts`                      | Rust step entry: target/rustflags/env (`cargoBuildInvocation()`), `emitRust()`, `rustLibPath()`, the Windows shim's plan, cross-compile matrix                          |
| `rust/plan.ts`                 | `cargo --unit-graph` + `cargo metadata` + `rustc --print` → `rust-target/plan.json` (build-time CLI and the types configure reads)                                      |
| `rust/units.ts`                | Plan → per-unit rustc argv/env/outputs (cargo's command-line rules), unit manifests                                                                                     |
| `rust/emit.ts`                 | `rust_plan`/`rust_rustc`/`rust_build_script` rules and edges                                                                                                            |
| `rust/run.ts`                  | Build-time driver for one unit: rustc with build-script-derived flags and a depfile, or the build-script protocol                                                       |
| `rust/toml.ts`                 | TOML reader for the `[lints]` tables cargo's JSON doesn't export                                                                                                        |
| `rust/cargo-env.ts`            | cargo conventions shared by configure and the build-time driver: build-script `output.json` shape, `envify`, dylib path variable                                        |
| `cargo-config.ts`              | Generates the git-ignored `.cargo/config.toml` (per-target `linker` from `cfg.hostCxx`)                                                                                 |
| `bun.ts`                       | `emitBun()` — assembles deps+codegen+rust+compile+link                                                                                                                  |
| `shims.ts`                     | Platform/toolchain workaround dylibs, `emitShims()`                                                                                                                     |
| `workarounds.ts`               | Self-obsoleting workaround registry, `checkWorkarounds()`                                                                                                               |
| `macos-sdk.ts`                 | macOS SDK resolution/download for darwin cross-compiles — `resolveMacosSdkPath()`, `ensureMacosSdk()`                                                                   |
| `features-json.ts`             | Host-side `features.json` for cross lanes — `parsePackedFeaturesList()`, `crossFeaturesJson()`                                                                          |
| `depVersionsHeader.ts`         | Generates `bun_dependency_versions.h` for `process.versions`                                                                                                            |
| `buildOptionsRs.ts`            | Generates `build_options.rs` (`bun_core::build_options`) from `Config`                                                                                                  |
| `jsonByteClass.ts`             | Generates `json_byte_class.{h,rs}` — the JSON byte classification shared by the SIMD kernel and the Rust scalar indexer                                                 |
| `xmlByteClass.ts`              | Generates `xml_byte_class.{h,rs}` — the XML byte classification shared by the SIMD kernels and the Rust scalar indexer                                                  |
| `stream.ts`                    | Subprocess output wrapper — FD-3 sideband, prefixed line streaming                                                                                                      |
| `shell.ts`                     | `quote()`/`slash()` — shell escaping for ninja commands                                                                                                                 |
| `fs.ts`                        | `writeIfChanged()`, `mkdirAll()`                                                                                                                                        |
| `error.ts`                     | `BuildError` with hint/file/cause, `assert()`                                                                                                                           |
| `download.ts`                  | `downloadWithRetry()`, archive extraction                                                                                                                               |
| `winsysroot.ts`                | Windows MSVC CRT + SDK sysroot (xwin): validates, adds case aliases, CI fetch                                                                                           |
| `fetch-cli.ts`                 | Build-time CLI ninja invokes for downloads, `.h.in` substitution and the `forbidUndefined` symbol check                                                                 |
| `verify-binary.ts`             | Build-time CLI: static scans of the linked executable (exports, dynamic deps, initializers, hardening, debug info) and the duplicate-definition scan of the link inputs |
| `binary-expectations.ts`       | What each target's executable must look like for `verify-binary.ts`; serialized to `<exe>.verify.json` at configure                                                     |
| `annotations.ts`               | Compiler output from a failed step, parsed into Buildkite annotations                                                                                                   |
| `ci.ts`                        | CI integration — annotations, artifacts, log groups                                                                                                                     |
| `clean.ts`                     | `bun run clean` preset-based cleanup                                                                                                                                    |
| `glob-sources.ts` (parent dir) | Source glob patterns + CLI to print them                                                                                                                                |
| `ci-images/spec.ts`            | CI's machines in one file: images, version pins, locations, every tool, and the generator of the bake scripts; `bun run ci:images`                                      |
| `deps/*.ts`                    | One `Dependency` object per vendored dep                                                                                                                                |
| `deps/index.ts`                | `allDeps` array — fetch order + link order                                                                                                                              |
| `shims/*.c`                    | Platform workaround sources                                                                                                                                             |

## Timings

`bun run build --timings` builds as usual, then reports where the time went (`timings.ts`) and writes `<buildDir>/timings.html`: each of the most recent builds as a Gantt chart with a lane per sort of command, the critical path outlined, and a strip of how many commands were running. Hovering a bar draws the chain of commands it waited on; clicking pins that and joins everything it held up. `--configure-only --timings` reports on the directory as it is, without building. Every CI build does the same: the report is the "Build timings" group of the step's log, and the chart is uploaded as `timings-<step key>.html`, which Buildkite serves as a page, linked from one folded "Build timings" annotation on the build page that lists every step's chart (`ci.ts` `publishTimings`). There an error in the report is printed and the build goes on; locally it fails the command. Nothing is measured for it and no second build runs: it reads what every build leaves behind.

- `.ninja_log` — each command's start and end on its ninja's clock, and a file timestamp: the command's start on the wall clock, or, for a `restat`/`generator` rule that changed its output, that output's mtime (ninja `Builder::FinishCommand`). The log holds every ninja process that has built in the directory and ninja compacts it in no particular order, so processes are told apart by that timestamp, not by line order (`groupRuns`, which also says what cannot be told apart).
- `build.ninja` — read back by `readManifest()` for each edge's rule, pool, inputs and outputs. An edge is named the way ninja prints it (the rule's `description`). No build statement names `build.ninja` as an input, but ninja brings it up to date before anything else, so the timings treat the edge that writes it as an input of every edge that is not upstream of it.
- Output mtimes — a library crate's dependents start at its `.rmeta`, long before the edge ends. `rust/run.ts` stamps the `.rmeta` when rustc reports it (only for a ninja that releases outputs early), so `mtime − the log's start stamp` is how far into the command that was. Any edge with `early_output_prefix` is read this way.

**ninja starts over by itself**, counting from zero again, when bringing `build.ninja` up to date rewrote it (every CI build: the Rust plan is new). A process that ended by writing `build.ninja` and the one that began where it ended are one run, on one clock. The `build.ninja` entry is the one whose timestamp is not its own: every configure stamps the file and has ninja record it (`-t restat`), so that command is placed by its start and end instead.

**The report describes the build directory, not one invocation**: for every edge, the last time it ran. It reads the same after a build that had nothing to do, and it is all ninja keeps once it compacts the log. Totals per rule, the slowest edges and the critical path come from that. The critical path is computed (longest chain through the graph, each edge taking what it last took and starting when its inputs exist), so it does not depend on which run built what; it is what a build of everything takes with every core free. What exists only within one build — stretches with few commands running, how long commands were queued after their inputs existed (per pool) — is reported for the last build, the one build nothing can have overwritten part of. The page and the report use the same words for the same things: `total` is the last build's time, `queued` is how long a command sat ready before it started.

**Why an edge is slow** is the compilers' to say, and costs a rebuild: `--time-trace=on` adds `-ftime-trace` to bun's C++ (a `.json` beside each `.o`) and `-Z time-passes` to every rustc (`run.ts` records the passes in `<output>.phases.json`; the flag is not a rustflag, so crates keep their hashes). The report shows the largest phases under each slow edge, and the chart shows them on hover.

## CI machine images (`ci-images/`)

What is on CI's build and test machines, and the generator of what bakes them. `ci-images/spec.ts` is also where the versions this build system uses are written (LLVM, Node.js, xwin and the Windows SDK, the macOS SDK, the Android API level, FreeBSD): `tools.ts`, `deps/nodejs-headers.ts`, `winsysroot.ts`, `macos-sdk.ts` and `config.ts` import them from `pins`, the sysroot and download-cache lookups import where things are from `locations`, and `spec.ts` is one of `build.ninja`'s inputs. `findLlvmTool()` accepts only the pinned LLVM release series on every machine, and on a Buildkite agent `checkImageTools()` compares `bun`, `cmake` and `node` with their pins exactly. How the images work and how to change them: `ci-images/CLAUDE.md`.

## Key types

**`Dependency`** (`source.ts`) — `{name, source, patches?, fetchDeps?, build, provides, enabled?, versionMacro?}`. The `source`/`build`/`provides` fields are functions of `Config` so they vary per-target. `Source` variants: `github-archive`, `local`, `in-tree`, `prebuilt`. `BuildSpec` variants covered in Goals above.

**`Ninja`** — Accumulates rules/builds/pools/defaults, emits `build.ninja`. All paths given absolute; converted to buildDir-relative at write time, and every output whose relative and absolute spellings differ is also declared under the absolute one (implicit output) so compiler depfiles, which name headers by absolute path, resolve to the producing edge.

## registerXxxRules vs emitXxx

**Rules** are ninja `rule` blocks — reusable command templates. **Build edges** are `build` statements — input→output instances.

Ninja requires all rules defined before any build references them. Hence:

1. `registerXxxRules(n, cfg)` — each module registers its rules. Called once via `registerAllRules()`.
2. `emitXxx(n, cfg, ...)` — each module emits build edges.

Why not auto-register in emit functions? Some rules are shared (`dep_configure` used by both `source.ts` and `webkit.ts` local mode). Explicit registration keeps "which rule lives where" clear.

## Gotchas

**Dep order in `allDeps` matters.** `fetchDeps: ["X"]` means X must come first (its `.ref` stamp node must exist). Link order matters too: static linking resolves left→right, providers after users.

**PCH, cc, and no-PCH cxx need implicit dep on `depHeaderSignal`**, not order-only. Local WebKit's sub-build rewrites forwarding headers as an undeclared side effect (only `lib*.a` are declared outputs). Depfiles record those headers, but ninja stats them before the sub-build runs — order-only lags one build. The lib itself is the invalidation signal. Codegen headers stay order-only: they're declared outputs with restat, so depfile tracking is exact.

**`isExecutable` must check `isFile()`.** `X_OK` on a directory means traversable — a `cmake/` dir in PATH would shadow the real cmake binary.

**cmd.exe quoting is partial.** `shell.ts` quote() handles spaces/special chars but NOT `%VAR%` expansion, `^` escape, `&|>` redirection. If an arg contains those, switch to powershell.

**A tool is named by path, so ninja cannot see it replaced.** An LLVM upgrade behind a stable path (scoop's `current`, a Homebrew `opt/` symlink) leaves every command line unchanged, and the new binary's packaged mtime is usually older than the objects, so naming the binary as an input does not help. Configure writes `<buildDir>/toolchain-identity/<tool>.txt` (`tools.ts` `writeToolIdentities`) with what `cc`, `cxx`, `hostCc`, `nasm` and `ld` report for `--version` (for an llvm.org build: the release and the exact commit, the same on every machine), and an edge takes the file of each tool it runs as an implicit input (`toolIdentityFile(cfg, tool)`): a replaced compiler recompiles, a replaced linker only relinks. The Rust units get the same from the rustc version and commit in their hash. A new edge that runs one of those tools should name its file too. Not covered: a toolchain rebuilt in place at the same version and commit (`bun run clean`), and nested cmake builds, whose own build directory keeps the old compiler's objects.

**`rm -rf build/` doesn't clear the cache locally.** `cfg.cacheDir` is machine-shared at `$BUN_INSTALL/build-cache` for non-CI builds (ccache, tarballs, prebuilt WebKit); `$BUN_BUILD_CACHE_DIR` puts it somewhere else, in CI too (`--cacheDir` still wins for one build). Everything there is content-addressed or version-stamped, so a stale entry can't be hit — don't reach for `bun run clean cache` as a debugging step. If a build misbehaves, the bug is in the inputs or the graph, not the cache; nuking it just costs you a cold rebuild. CI keeps `<buildDir>/cache` so `rm -rf build/` is still a full reset there.

## Node compatibility

The build system runs under Node 25+ (configure checks the version). CI images have Node 26, and the build steps `.buildkite/ci.ts` generates run `node scripts/build.ts` (literal `node`: the steps run on a different machine from the generator).

`cfg.jsRuntime` holds the shell-ready command prefix for running `.ts` subprocesses (stream.ts, fetch-cli.ts, `rust/plan.ts`, the regen rule, the `codegen` rule) — it's `process.execPath` when bun runs configure, or `node --experimental-strip-types` when node does. The subprocesses inherit whichever runtime started the build.

**Remaining `cfg.bun` usage:** For a fully bun-optional build:

- `cfg.packageManager` — `--package-manager=npm` runs the codegen installs with npm (`npm-ci.ts`). The default is bun.
- Codegen scripts on the `codegen_bun` rule still need bun. Move a script to the `codegen` rule once it runs under node, and check that both runtimes write the same output.
- `rust/run.ts` (every rustc and build-script edge) is launched with `cfg.bun` for its startup time: it starts once per edge along a crate chain ~30 deep (bun ~20 ms, node ~80 ms). Its code uses only `node:` modules, so launching it with `cfg.jsRuntime` is a one-line change in `rust/emit.ts`.
- `cfg.esbuild` — already separate.

With those done, `cfg.bun` disappears.

## Adding a workaround

Every temporary fix for a toolchain/OS bug registers a self-obsoleting check so it can't rot silently:

1. Put the artifact under `scripts/build/shims/` (or `patches/` for source patches).
2. Emit it as a ninja build edge from `shims.ts` (or the appropriate module).
3. Register an entry in `workarounds.ts` with an `expectedToBeFixed` predicate — configure fails with cleanup instructions once the upstream fix ships.

`expectedToBeFixed` typically checks a tool version against a threshold (e.g. `cfg.clangVersion >= "23.0.0"`). When you know exactly which release has the fix, use that. When you don't — fix merged upstream but not released yet — pick your best guess for the likely release. The check might trip on a version that turns out not to have the fix; that's okay. The error message tells the dev to bump the threshold, which takes 30 seconds. That's cheaper than leaving the check blank and the workaround living forever because nobody remembered to come back.
