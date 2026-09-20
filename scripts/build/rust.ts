/**
 * Rust build step — every crate a ninja edge.
 *
 * The Rust port lives in the workspace rooted at the repo's `Cargo.toml`; the leaf crate is
 * `src/runtime` (`bun_runtime`, `crate-type = ["staticlib"]`), whose `libbun_runtime.a` carries the
 * entire crate graph plus libstd with `main` exported `#[no_mangle] extern "C"`.
 *
 * cargo plans, ninja executes: `rust/plan.ts` asks cargo for the unit graph it would build for
 * exactly the arguments computed here (`cargoBuildInvocation`: profile, target, `-Zbuild-std`, the
 * profile overrides) and `rust/emit.ts` turns each unit into one rustc edge, `rust/units.ts` holding
 * cargo's rules for the command line. ninja then schedules the rustc invocations together with the
 * C++ ones instead of handing all of Rust to one opaque `cargo build` job, and what every crate is
 * compiled with is in `build.ninja` and `rust/units/*.json` to read. Dependents start on a crate's
 * `.rmeta`, as under cargo, when the build runs under oven-sh/ninja (`ninja-release.ts`), which
 * releases an output its running command announces; under a stock ninja they wait for rustc to exit.
 *
 * The plan is itself a build edge (`rust/plan.json`, rerun when `Cargo.lock`, a manifest or the
 * toolchain changes) and `build.ninja` depends on it: the first configure of a fresh tree emits only
 * that edge, ninja runs it and reconfigures, and from then on the graph is per crate.
 *
 * A Windows target has a second graph of the same kind, `rust/shim/`: the `.bin/` launcher
 * (`src/install/windows-shim`), planned with its own profile, flags and `-Zbuild-std`, whose root is a
 * `bin`. Its executable lands in the codegen directory, where `bun_install` embeds it from.
 *
 * ## Why an `.a` and not a single `.o`
 *
 * A single `.o` would need either full LTO (`-C lto=fat --emit=obj`, which
 * recompiles the whole crate graph from bitcode every build — minutes in
 * debug) or an `ld -r --whole-archive` post-merge (extra platform-specific
 * step). The staticlib goes into the link's `$in` list between the C++
 * objects and the dependency archives;
 * crt1.o's undefined `main` plus the C++ side's hundreds of `extern "C"`
 * `Bun__*`/`Zig*` references pull every reachable member, and the release
 * link's `--gc-sections` still DCEs per-function. `rustLinkFlags()` wraps
 * the archive in `--whole-archive` so members that are *only* referenced via
 * the dynamic-list / NAPI surface (no inbound static ref) are retained too.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Abi, Arch, Config, OS } from "./config.ts";
import { assert } from "./error.ts";
import { computeCpuTargetFlags } from "./flags.ts";
import type { Ninja } from "./ninja.ts";
import { emitRustPlan, emitRustUnits, registerRustUnitRules } from "./rust/emit.ts";
import { type PlanInput, planEnv, planPath, readPlan } from "./rust/plan.ts";
import { buildRustGraph } from "./rust/units.ts";

// ───────────────────────────────────────────────────────────────────────────
// Target / profile mapping
// ───────────────────────────────────────────────────────────────────────────

/**
 * Rust target triple. Arch is `x86_64`/`aarch64`, not `x64`/`arm64`.
 *
 * Passed explicitly via `--target` for two reasons:
 *   - `-Z sanitizer=address` requires it (rustc refuses on the implicit
 *     host triple)
 *   - Cross-compiles (Android/FreeBSD) need it anyway
 */
export function rustTarget(cfg: Config): string {
  return rustTriple(cfg.os, cfg.arch, cfg.abi);
}

/** `rustTarget()` on the bare target platform; `abi` is linux-only. */
export function rustTriple(os: OS, arch: Arch, abi: Abi | undefined): string {
  const rustArch = arch === "x64" ? "x86_64" : "aarch64";
  if (os === "darwin") return `${rustArch}-apple-darwin`;
  if (os === "windows") return `${rustArch}-pc-windows-msvc`;
  if (os === "freebsd") return `${rustArch}-unknown-freebsd`;
  // linux
  assert(abi !== undefined, "linux build missing abi");
  if (abi === "android") return `${rustArch}-linux-android`;
  if (abi === "musl") return `${rustArch}-unknown-linux-musl`;
  return `${rustArch}-unknown-linux-gnu`;
}

/**
 * Cargo profile name. `cfg.asan` does NOT change the profile (it changes rustflags); a debug-asan build still
 * uses `dev`. RelWithDebInfo / MinSizeRel collapse to `release` — cargo's stock release already keeps debuginfo
 * (`debug = 1` is the workspace default), and we don't ship a `MinSizeRel` Rust path yet.
 */
export function cargoProfile(cfg: Config): string {
  return cfg.buildType === "Debug" ? "dev" : "release";
}

/**
 * All target triples CI builds (`buildPlatforms` in .buildkite/ci.ts, one
 * triple per os/arch/abi; test/internal/source-lints/build-rust.test.ts keeps
 * the two in sync). Drives `rust:check-all` and the generated
 * `.cargo/config.toml` (cargo-config.ts). `rust-toolchain.toml`'s `targets`
 * is this list minus the Tier 3 triples.
 */
export const allRustTargets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-unknown-linux-musl",
  "aarch64-unknown-linux-musl",
  "x86_64-linux-android",
  "aarch64-linux-android",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "aarch64-pc-windows-msvc",
  "x86_64-unknown-freebsd",
  "aarch64-unknown-freebsd",
] as const;

/**
 * Tier 3 targets — rustup ships no prebuilt `rust-std` for these, so
 * `rustup target add` would fail and cargo needs `-Zbuild-std` (which in turn
 * needs the `rust-src` component). As of nightly-2026-05, the only Tier 3
 * triple in CI's matrix is aarch64-freebsd.
 */
export function rustTargetIsTier3(triple: string): boolean {
  return triple === "aarch64-unknown-freebsd";
}

/**
 * Build std/core/alloc from source instead of linking the rustup prebuilt.
 * The workspace is `panic = "abort"` (see Cargo.toml). `proc_macro` is
 * needed because `cargo build --target` still resolves proc-macro crates for
 * the host through the same `-Zbuild-std` flag set. Requires the `rust-src`
 * component, which `rust-toolchain.toml` requests and CI images preinstall
 * (the `rust` tool of ci-images/spec.ts). Shared with
 * `rust:check-all`, which needs it for the Tier 3 triples.
 */
export const cargoBuildStdArg = "-Zbuild-std=core,alloc,std,proc_macro,panic_abort";

/**
 * The C++ side's `cpuTargetFlags` (flags.ts) spelled as rustflags, derived
 * from that table so the two halves of the binary can't drift apart. They
 * have to agree: the Rust half runs on whatever CPU the C++ baseline admits,
 * and under cross-language LTO (`cfg.crossLangLto`) LLVM only inlines a call
 * when the callee's CPU feature set is a subset of the caller's (a CPU's own
 * tuning features and the tune CPU count too), so a mismatch turns off
 * inlining across the Rust/C++ boundary in both directions.
 *
 *   -mcpu=X   → -Ctarget-cpu=X   (both take LLVM CPU names)
 *   -mtune=X  → -Ztune-cpu=X     (nightly-only, like the other -Z flags here)
 *   -march=X  → x64:   -Ctarget-cpu=X, since x86 -march values are CPU names
 *               arm64: -Ctarget-cpu=generic -Ctarget-feature=+ext,...
 *
 * The arm64 `-march` value is an architecture level plus extensions
 * (`armv8-a+crc`), which clang itself lowers to LLVM's `generic` aarch64 CPU
 * plus the extensions as features (`clang -### ...` shows `-target-cpu
 * generic`); rustc's target features use the same names. This used to name a
 * real CPU instead (cortex-a72), which also assumed aes, sha2 and pmuv3
 * (`rustc --print cfg`), none of which the C++ side does.
 *
 * clang-cl (windows) spells the same flags `/clang:-march=...`.
 */
function rustCpuTargetFlags(cfg: Config): string[] {
  const rustflags: string[] = [];
  for (const clangFlag of computeCpuTargetFlags(cfg)) {
    const parsed = /^(?:\/clang:)?-m(cpu|tune|arch)=(.+)$/.exec(clangFlag);
    assert(parsed !== null, `rustCpuTargetFlags() can't translate cpuTargetFlags entry '${clangFlag}'`);
    const kind = parsed[1]!;
    const value = parsed[2]!;
    if (kind === "tune") {
      rustflags.push(`-Ztune-cpu=${value}`);
    } else if (kind === "cpu" || cfg.x64) {
      rustflags.push(`-Ctarget-cpu=${value}`);
    } else {
      const [level, ...extensions] = value.split("+");
      assert(level === "armv8-a", `rustCpuTargetFlags() only knows how to spell -march=armv8-a, not -march=${value}`);
      rustflags.push("-Ctarget-cpu=generic");
      if (extensions.length > 0) rustflags.push(`-Ctarget-feature=${extensions.map(ext => `+${ext}`).join(",")}`);
    }
  }
  return rustflags;
}

/**
 * The Windows .bin/ shim PE as `bun_install` embeds it:
 * `include_bytes!(concat!(env!("BUN_CODEGEN_DIR"), "/bun-shim-impl.exe"))`, beside the other generated files the
 * crates include. It is the shim graph's `bin` under its target's name (run.ts copies it there, as cargo would).
 */
function windowsShimPath(cfg: Config): string {
  return resolve(cfg.codegenDir, "bun-shim-impl.exe");
}

// ───────────────────────────────────────────────────────────────────────────
// Paths
// ───────────────────────────────────────────────────────────────────────────

/** cargo's `--target-dir`, `<buildDir>/rust-target`: only planning still runs cargo, and `rust:timings`. */
function rustTargetDir(cfg: Config): string {
  return resolve(cfg.buildDir, "rust-target");
}

/**
 * Each planned graph has a directory of its own under `<buildDir>/rust`: its plan, unit manifests and artifacts.
 * bun_runtime's is that directory itself; the Windows shim's is `rust/shim`.
 */
function rustGraphDir(cfg: Config): string {
  return resolve(cfg.buildDir, "rust");
}

function shimGraphDir(cfg: Config): string {
  return resolve(cfg.buildDir, "rust", "shim");
}

/** The plans build.ninja is generated from: inputs of the regen edge (configure.ts). */
export function rustPlanFiles(cfg: Config): string[] {
  return [planPath(rustGraphDir(cfg)), ...(cfg.windows ? [planPath(shimGraphDir(cfg))] : [])];
}

/** Absolute path to `libbun_runtime.a` (or `bun_runtime.lib` on Windows): the staticlib root's output, `<buildDir>/rust/<triple>/` (rust/units.ts). */
export function rustLibPath(cfg: Config): string {
  return resolve(cfg.buildDir, "rust", rustTarget(cfg), `${cfg.libPrefix}bun_runtime${cfg.libSuffix}`);
}

// ───────────────────────────────────────────────────────────────────────────
// Ninja rules
// ───────────────────────────────────────────────────────────────────────────

export function registerRustRules(n: Ninja, cfg: Config): void {
  if (cfg.cargo === undefined) return; // emitRust() asserts with a hint
  registerRustUnitRules(n, cfg);
}

// ───────────────────────────────────────────────────────────────────────────
// Rust build emission
// ───────────────────────────────────────────────────────────────────────────

/**
 * Inputs to the Rust step. Assembled by the caller from emitted codegen
 * outputs + globbed sources.
 */
export interface RustBuildInputs {
  /**
   * Generated files the workspace crates `include!` / `include_bytes!` or need to exist (`generated_classes.rs`
   * and friends are undeclared side effects of the scripts producing these). Order-only for the crate edges:
   * they must exist before a workspace crate compiles, and from then on rustc's dep-info names exactly the
   * files each crate read, so a changed one rebuilds just its includers.
   */
  codegenOrderOnly: string[];
  /**
   * All `*.rs` source files + workspace `Cargo.toml`/`Cargo.lock` (globbed at configure time). The manifests
   * and lockfile are inputs of the plan edges (they are what changes the crate graph); the `.rs` files are
   * not inputs of anything here: per-crate rustc edges track their sources through dep-info.
   */
  rustSources: string[];
  /**
   * Fetch stamps for vendored Rust crates the workspace consumes as path dependencies (lol-html, rust-argon2).
   * Inputs of the plan edge — cargo cannot load the workspace before their manifests exist, and a commit bump
   * re-plans — and order-only for every crate edge.
   */
  vendorStamps: string[];
}

/**
 * The exact `cargo build` invocation the Rust step uses.
 *
 * Extracted so tooling (`scripts/rust-timings.ts`) can run cargo with the same
 * args/rustflags/env that `emitRust()` puts into the ninja edge, without
 * re-deriving any of it. `emitRust()` is the only build-graph caller.
 */
export interface CargoInvocation {
  /** `cargo build <args>` — everything after `build`. */
  args: string[];
  /** The environment `cargo build` runs under (planning, `rust:timings`): `unitEnv` plus what configures cargo itself — profile overrides, `CARGO_ENCODED_RUSTFLAGS`, the target linker, terminal colour. */
  env: Record<string, string>;
  /** The environment every rustc and build script runs under — what cargo's children inherited from it: toolchain forwarding (CARGO_HOME, RUSTUP_*), CC/CXX/AR for cc-rs, BUN_CODEGEN_DIR, cross-compile SDK variables. */
  unitEnv: Record<string, string>;
  /** The target rustflags (what `CARGO_ENCODED_RUSTFLAGS` joins): appended to every target unit's rustc command. */
  rustflags: string[];
  /** `-C linker=` for target units (cargo: `CARGO_TARGET_<TRIPLE>_LINKER`). */
  linker: string;
  /** `--target-dir` absolute path (also present in `args`). */
  targetDir: string;
  /** `--target` triple (also present in `args`). */
  triple: string;
}

/**
 * Compute the cargo command line + environment for `cargo build -p bun_runtime`.
 * Pure function of `cfg`; does no I/O.
 */
export function cargoBuildInvocation(cfg: Config): CargoInvocation {
  const targetDir = rustTargetDir(cfg);
  const triple = rustTarget(cfg);
  const tier3 = rustTargetIsTier3(triple);
  const profile = cargoProfile(cfg);

  // ─── Build args ───
  const args: string[] = [
    "-p",
    "bun_runtime",
    "--lib",
    "--target-dir",
    targetDir,
    "--target",
    triple,
    "--profile",
    profile,
    "--locked",
  ];
  if (tier3 || cfg.release || cfg.asan) {
    // Rebuild std from source (cargoBuildStdArg) because:
    // tier3:   no prebuilt `rust-std` exists.
    // release: prebuilt std is native code built for generic x86-64 with no
    //          `.llvm_addrsig`. Rebuilding with our RUSTFLAGS gets it
    //          `-Ctarget-cpu=` (AVX2/BMI in core::str / hashbrown), and under
    //          `cfg.lto` it becomes bitcode that joins the cross-language LTO
    //          unit + safe ICF instead of being an opaque blob in the link.
    // asan:    prebuilt std is uninstrumented; rebuilding applies
    //          `-Zsanitizer=address` so OOB/UAF inside Vec/String/HashMap are
    //          visible instead of stopping at the std boundary.
    args.push(cargoBuildStdArg);
    if (cfg.release && !cfg.asan) {
      // Cargo's default build-std feature set is `panic-unwind,backtrace,default`.
      // `backtrace` links std's symbolizer (gimli, addr2line, miniz_oxide,
      // rustc-demangle, ~200 KB on linux-x64) for `std::backtrace` and the
      // default panic hook; bun installs its own panic hook and symbolizes
      // crash traces out of process, so nothing reads it.
      args.push("-Zbuild-std-features=panic-unwind,default");
    }
  }

  // ─── rustflags ───
  // CARGO_ENCODED_RUSTFLAGS: U+001F-separated so multi-arg flags survive.
  const rustflags: string[] = [];
  // Match the C/C++ side's `-fno-pic` / `-Wl,-no-pie` (flags.ts:929,1001) on
  // the targets where bun links as a position-dependent ET_EXEC. With the
  // default `pic`, every Rust `&'static [T]` / `&'static str` / vtable is a
  // GOT-relative reference and the constant ends up in `.data.rel.ro` (RW
  // segment, eagerly faulted) instead of `.rodata`; libbun_runtime.a alone
  // contributes ~561 KiB of `.data.rel.ro` that the Zig binary placed in
  // shareable read-only pages. `static` lets rustc emit absolute references
  // and the constants land in `.rodata`. This is a *target* RUSTFLAG: with
  // `--target` set, cargo does NOT apply it to host artifacts (proc-macro
  // dylibs / build scripts), so those still build PIC. Darwin (Mach-O is
  // always PIC), Android (bionic loader requires PIE — flags.ts:934), and
  // Windows (COFF has its own model) are excluded.
  if ((cfg.linux && cfg.abi !== "android") || cfg.freebsd) {
    rustflags.push("-Crelocation-model=static");
  }
  // Keep frame pointers — matches the C++ side's `-fno-omit-frame-pointer`
  // (flags.ts:293-301). Needed so profilers and crash backtraces can walk Rust frames.
  rustflags.push("-Cforce-frame-pointers=yes");
  // Parallel frontend: rustc's default is single-threaded for parse / macro
  // expansion / typeck / borrowck, so the critical-path crate (`bun_runtime`)
  // sits on one core while the rest idle. With this, independent compiler
  // queries run on a rayon pool and the long pole roughly halves. These are
  // threads inside one rustc process; ninja counts the process as one job,
  // as it does a multi-threaded link.
  //
  // Why 8, not nproc: returns flatten past ~8 (the query DAG has its own
  // serial spine — macro expansion in particular), and `-Zthreads=0` (= nproc)
  // measured marginally *worse* on a 32-core box from sharded-lock contention.
  // 8 is also the upstream proposal for the eventual default
  // (rust-lang/compiler-team#681).
  //
  // Local-only: CI/release builds want byte-identical output across runs, and
  // the parallel frontend can reorder diagnostics (and is still nightly
  // `-Z`-gated). The shipped binaries stay on the serial path.
  if (!cfg.ci) {
    rustflags.push("-Zthreads=8");
  }
  // rustc does not emit `.llvm_addrsig` by default on *any* target (verified
  // empirically — Linux-gnu, musl, darwin, msvc all missing it). lld's
  // `--icf=safe` (flags.ts:960) and lld-link's `/OPT:SAFEICF` (flags.ts:778)
  // need the table to know which functions are safe to fold; without it every
  // Rust monomorphization is treated as address-taken and *none* fold
  // (#53159: 33,162 extra `.pdata` entries vs Zig main on Windows, all from
  // Rust functions). C++ already emits it via `-faddrsig` (flags.ts:350).
  // `-Cllvm-args=-addrsig` sets the same LLVM module flag clang's `-faddrsig`
  // does. Harmless on Apple ld64 (ignores the section).
  rustflags.push("-Cllvm-args=-addrsig");
  // Reuse an upstream crate's monomorphization instead of re-instantiating
  // it locally. rustc defaults this on only at opt-level 0/1/s/z: at O2/O3 a
  // shared generic is an out-of-line upstream symbol the caller can't
  // inline. Cross-language ThinLTO re-imports and inlines any callee under
  // the import threshold at link time, so here it only dedups the large
  // bodies nobody inlines. Nightly-only; the pinned toolchain is nightly.
  // Not under ASAN: routing Box/Vec allocs through the shared alloc-crate
  // instantiation moves their frames and LSAN's conservative reachability
  // loses some at-exit allocations it previously found (bun-info, bun-audit,
  // issue 30205), turning benign at-exit state into reported leaks.
  if (!cfg.asan) rustflags.push("-Zshare-generics=y");
  rustflags.push(...rustCpuTargetFlags(cfg));
  // `bun_core::build_options::ENABLE_ASAN = cfg!(bun_asan)` — must agree with
  // the C++ `ASAN_ENABLED` macro so Global::exit() picks the same libc exit
  // path (`exit` vs `quick_exit`) that c-bindings.cpp registered Bun__onExit on.
  rustflags.push("--check-cfg=cfg(bun_asan)");
  if (cfg.asan) {
    // Match the C/C++ side's instrumentation so cross-language stack traces
    // and shadow-memory bookkeeping agree. Nightly-only flag; the pinned
    // toolchain in `rust-toolchain.toml` is nightly.
    rustflags.push("-Zsanitizer=address");
    // The C/C++ side's `-fsanitize-address-use-after-return=never` (flags.ts).
    // rustc builds the ASAN pass in `runtime` mode and has no flag to change
    // that; the pass's own LLVM option overrides the mode.
    rustflags.push("-Cllvm-args=-asan-use-after-return=never");
    rustflags.push("--cfg=bun_asan");
  }
  // `bun_debug`: the cargo profile is `dev` (a Debug-buildtype build).
  // `bun_core::env::IS_DEBUG` and `build_options::ENABLE_LOGS` key on this
  // instead of `cfg!(debug_assertions)` so that release-asan /
  // release-assertions (which enable `debug-assertions` below for
  // `debug_assert!()` coverage) don't also flip on Debug-only conveniences:
  // `DUMP_SOURCE` (per-module writes to /tmp/bun-debug-src/), `debug_warn!`
  // stderr noise, the `bun-debug` self-name for `npm run` rewrites,
  // experimental feature-flag defaults. Mirrors Zig's
  // `builtin.mode == .Debug`, which the Rust port had proxied via
  // `debug_assertions` only because the two were coextensive until now.
  rustflags.push("--check-cfg=cfg(bun_debug)");
  if (cfg.debug) {
    rustflags.push("--cfg=bun_debug");
  }
  // `bun_codegen_embed`: embed codegen-output `.js` (`include_bytes!`) instead
  // of reading them from `BUN_CODEGEN_DIR` at runtime. Mirrors Zig
  // `BunBuildOptions.shouldEmbedCode() = optimize != .Debug or codegen_embed`.
  // Debug builds skip it for faster iteration (and the dir always exists
  // locally); anything else needs it for the binary to be portable across
  // machines — without it `bun_runtime::bake`/`bun_resolver::node_fallbacks`
  // panic with `Failed to load '<build-machine-path>/codegen/...'` when a CI
  // test runner runs an artifact built on a different agent.
  rustflags.push("--check-cfg=cfg(bun_codegen_embed)");
  if (!cfg.debug) {
    rustflags.push("--cfg=bun_codegen_embed");
  }
  // `socket_fault_injection`: usockets bsd_* fault-injection hooks compiled
  // in (LIBUS_SOCKET_FAULT_INJECTION=1 on the C side). The Rust FFI for
  // us_fault_set/us_fault_clear_all and the JS control surface gate on this
  // so the C symbol and the Rust extern are either both present or both
  // absent regardless of profile.
  rustflags.push("--check-cfg=cfg(socket_fault_injection)");
  if (cfg.socketFaultInjection) {
    rustflags.push("--cfg=socket_fault_injection");
  }
  // Drop `#[track_caller]` source-location capture in release. Every
  // `Option::unwrap`/`slice[i]`/`RefCell::borrow` etc. otherwise emits a
  // `&'static core::panic::Location` (file/line/col) plus the file-path string
  // and a per-call-site `lea` to load it — ~320 KB across the crate graph
  // (measured macOS arm64). Release ships `panic = "abort"` and the crash
  // handler captures a frame-pointer backtrace that bun.report symbolizes to
  // file:line server-side, so the panic call site is recoverable from the trace
  // without embedding the location in the binary — same as the Zig build, which
  // had ~0 embedded source paths. Kept off for debug and `release-assertions`
  // where panic messages are read locally. Nightly-only; the pinned toolchain
  // is nightly.
  if (cfg.release && !cfg.assertions) {
    rustflags.push("-Zlocation-detail=none");
  }
  // Path remapping (CI reproducibility) — rustc equivalent of the C/C++
  // `-ffile-prefix-map` entries in flags.ts. Without this, `file!()` /
  // panic locations and the DWARF compilation-dir from every workspace
  // crate and vendored Rust dep (lol-html) embed the absolute checkout
  // path into the release binary (`strings bun | grep $PWD` shows them).
  // Gated on `cfg.ci` to match the flags.ts entry.
  if (cfg.ci) {
    rustflags.push(`--remap-path-prefix=${cfg.cwd}=.`);
    rustflags.push(`--remap-path-prefix=${cfg.vendorDir}=vendor`);
  }
  // IR PGO, Rust half — mirrors the C++ `-fprofile-generate`/`-fprofile-use`
  // (flags.ts) so the Rust ~half of bun's `.text` participates too (a port-era
  // `bun` is mostly Rust now; instrumenting only C++ would leave most of the
  // cold-start working set un-ordered). One merged `.profdata` covers both:
  // clang and rustc share LLVM's IR-PGO format, and scripts/build-pgo.ts
  // resolves `llvm-profdata` from the build's own toolchain so the versions
  // line up. Stale/partial coverage is expected (codegen drifts; prebuilt
  // WebKit isn't instrumented) — `-fprofile-use`'s C++ warnings are already
  // silenced in flags.ts; rustc just emits "no profile data" notes and skips
  // those functions, it does not fail. Driven end-to-end by
  // scripts/build-pgo.ts. RUSTFLAGS only reach target crates (with `--target`), so
  // host build scripts / proc-macros stay un-instrumented, which is what we
  // want. Not on Windows (the C++ PGO flags are `c.unix`-gated; keep parity).
  if (!cfg.windows && cfg.pgoGenerate) {
    rustflags.push(`-Cprofile-generate=${cfg.pgoGenerate}`);
  }
  if (!cfg.windows && cfg.pgoUse) {
    // Functions absent from the profile (or whose CFG hash drifted) just don't
    // get PGO applied — rustc emits a stderr warning, not an error, so a
    // stale/partial profile degrades gracefully rather than failing the build.
    rustflags.push(`-Cprofile-use=${cfg.pgoUse}`);
  }
  // Force lld for any target link rustc itself performs. None exists today
  // (`bun_runtime` is a staticlib with no link step; `lol_html` is a plain rlib
  // path dep), so this is defensive — see the Windows note below. The
  // default `cc` driver picks BFD `/usr/bin/ld`, which doesn't match the
  // semantics the C/C++ object set assumes (and, under `-Clinker-plugin-lto`,
  // doesn't understand `-plugin-opt`). This used to live only behind
  // `cfg.lto`, with the non-LTO build relying on `.cargo/config.toml`'s
  // `rustflags`; but `CARGO_ENCODED_RUSTFLAGS` (always set below) *replaces*
  // the config-file `rustflags` rather than merging, so the config entry was
  // dead for any ninja build. Push it unconditionally so the ninja build's
  // behavior doesn't depend on the generated `.cargo/config.toml` at all.
  //
  // Not on Windows: the per-target linker there is `link.exe` / `lld-link.exe`
  // (see `CARGO_TARGET_*_LINKER` below), which take `/X` args, not the GCC/clang
  // `-fuse-ld=`. RUSTFLAGS only reach *target* crates when `--target` is given,
  // and the `bun_runtime` staticlib has no link step, so it's normally dead — but
  // if a target cdylib ever appears it'd fail with "could not open '-fuse-ld=lld'".
  if (!cfg.windows) rustflags.push(`-Clink-arg=-fuse-ld=lld`);
  // Keep the clang driver quiet about link args that don't apply to a given
  // artifact kind: rustc adds `-no-pie` under `-Crelocation-model=static`,
  // which is meaningless when it links a target cdylib, and rustc's
  // `linker_messages` lint then re-surfaces clang's
  // "argument unused during compilation: '-no-pie'" as a warning on every
  // build-rust job. No target cdylib exists today (same story as
  // `-fuse-ld=lld` above), so this too is defensive. Same approach as the
  // WebKit configure (`-Qunused-arguments`); real linker errors still fail
  // the link.
  if (!cfg.windows) rustflags.push(`-Clink-arg=-Qunused-arguments`);
  // And allow the lint itself: CI treats new warnings as failures, and the
  // lint forwards anything any platform's linker prints to stderr - the
  // -Qunused-arguments above only covers the clang-driver case. Real linker
  // errors are unaffected (they fail the link, not the lint).
  rustflags.push(`-Alinker_messages`);
  if (cfg.crossLangLto) {
    // Cross-language LTO: emit LLVM bitcode (not machine code) into the .a
    // so the final lld LTO link sees through Rust↔C++ call edges. The shape
    // of that bitcode must match the platform's C++ LTO mode — thin
    // (per-CGU, ThinLTO-summaried) on darwin, fat (pre-merged by rustc,
    // summary-less) on ELF — selected via the CARGO_PROFILE_RELEASE_LTO
    // override in the env block below.
    //
    // Bitcode-format compatibility: lld must be able to read rustc's bitcode.
    // LLVM bitcode is forward-compatible (newer reads older), so this works
    // when the linker's LLVM ≥ rustc's bundled LLVM. resolveConfig() swaps
    // `cfg.ld` to rustc's bundled rust-lld when rustc's LLVM major is ahead
    // of clang's (the wantRustLld block in config.ts).
    rustflags.push("-Clinker-plugin-lto");
    rustflags.push("-Cembed-bitcode=yes");
    // EnableSplitLTOUnit consistency: lld errors with "inconsistent LTO Unit
    // splitting" if any bitcode module in the link disagrees with the others.
    // Every LTO platform now links ThinLTO with the C/C++ side passing
    // -fno-split-lto-unit (index-based WPD, no hybrid split), so every C/C++
    // module (ours and the WebKit -lto prebuilts) says 0. rustc's default is
    // also 0, so pass nothing. (`-Clink-arg=-fuse-ld=lld` is pushed
    // unconditionally above — under LTO it doubles as making rustc's bitcode
    // link go through the LTO-aware linker our final link uses, not BFD
    // `/usr/bin/ld`.)
    if (!cfg.darwin && !cfg.windows) {
      // Rust functions default to carrying the `uwtable(async)` attribute.
      // When the LTO inliner inlines such a callee into one of our C++
      // callers (compiled without unwind tables), the caller inherits the
      // attribute — so cross-language inlining sprays full .eh_frame FDEs
      // across thousands of C++ functions (~+1.8 MB on the linux links;
      // the musl release binary keeps .eh_frame so it pays it in full).
      // We build with panic=abort and always keep frame pointers, and the
      // glibc release binary already ships without .eh_frame entirely, so
      // the tables are pure dead weight here — turn them off for the Rust
      // side of the merged module. (The prebuilt std bitcode keeps its own
      // uwtable attrs; this only stops our crates from spreading them.)
      rustflags.push("-Cforce-unwind-tables=no");
    }
  }

  // ─── Environment ───
  // What every rustc and build script sees (cargo's children inherited cargo's environment).
  const unitEnv: Record<string, string> = {
    // `include!(concat!(env!("BUN_CODEGEN_DIR"), "/generated_*.rs"))` and `include_bytes!` in
    // `bun_js_parser`/`bun_runtime` resolve against this. `bun_core::build_options` is also `include!()`'d from
    // here — its values come from `buildOptionsRs.ts` (written at configure time), not env vars.
    BUN_CODEGEN_DIR: cfg.codegenDir,
    // Toolchain forwarding: build.rs of crates in the dep graph (anything using `cc`) must use the SAME clang/ar
    // `tools.ts` resolved — not whatever is first in PATH. On CI the LLVM toolchain lives at a versioned path
    // (`/opt/llvm-N/`) and the system `cc` may be absent or mismatched. cc-rs honours `CC`/`CXX`/`AR`.
    CC: cfg.cc,
    CXX: cfg.cxx,
    AR: cfg.ar,
  };
  if (cfg.cargoHome !== undefined) unitEnv.CARGO_HOME = cfg.cargoHome;
  if (cfg.rustupHome !== undefined) unitEnv.RUSTUP_HOME = cfg.rustupHome;
  // Pin the toolchain explicitly. `vendor/` is commonly a symlink shared across worktrees; rustup's directory walk
  // could otherwise resolve a different worktree's `rust-toolchain.toml`.
  if (cfg.rustToolchain !== undefined) unitEnv.RUSTUP_TOOLCHAIN = cfg.rustToolchain;
  if (cfg.rustc !== undefined) unitEnv.RUSTC = cfg.rustc;
  // Darwin cross-compile from a non-darwin host: point anything in the dep graph that cares about the Apple SDK at
  // the extracted sysroot. rustc itself doesn't need it for a staticlib, but cc-rs (build scripts compiling target C)
  // honours CFLAGS_<triple>/SDKROOT, and MACOSX_DEPLOYMENT_TARGET keeps the LC_BUILD_VERSION minos rustc stamps into
  // its objects consistent with the C++ side's -mmacosx-version-min.
  if (cfg.darwin && cfg.host.os !== "darwin") {
    if (cfg.osxDeploymentTarget !== undefined) unitEnv.MACOSX_DEPLOYMENT_TARGET = cfg.osxDeploymentTarget;
    if (cfg.osxSysroot !== undefined && cfg.crossTarget !== undefined && cfg.osxDeploymentTarget !== undefined) {
      unitEnv.SDKROOT = cfg.osxSysroot;
      const sdkFlags = `--target=${cfg.crossTarget} -isysroot ${cfg.osxSysroot} -mmacosx-version-min=${cfg.osxDeploymentTarget}`;
      const tripleEnv = triple.replace(/-/g, "_");
      unitEnv[`CFLAGS_${tripleEnv}`] = sdkFlags;
      unitEnv[`CXXFLAGS_${tripleEnv}`] = sdkFlags;
    }
  }

  // The linker for target units (cargo: `CARGO_TARGET_<TRIPLE>_LINKER`). The `bun_runtime` artifact is a staticlib
  // (no link step); what actually gets linked are host executables/dylibs in the dep graph (build scripts,
  // proc-macros) — and on a native build the target *is* the host triple, so this sets their linker too.
  //
  // Non-Windows: `cfg.cxx` (clang++) drives lld with the same flag dialect the C++ side uses;
  // `-Clink-arg=-fuse-ld=lld` (in rustflags) selects lld for any rustc-driven link.
  //
  // Windows: rustc's `*-msvc` linker flavor passes `link.exe`-style args directly (`/NOLOGO`, `/OUT:`, …).
  // `clang-cl` is a *compiler driver*, not a linker — it reads `/N…` args as input filenames — so use the
  // discovered MSVC `link.exe` (matches what `dep_cargo` sets for vendored crates, source.ts), falling back to
  // `lld-link.exe` (`cfg.ld`); both speak the `/X` dialect rustc emits.
  const linker = cfg.windows ? (cfg.msvcLinker ?? cfg.ld) : cfg.cxx;

  // What configures cargo itself, on top of the children's environment.
  const env: Record<string, string> = {
    ...unitEnv,
    CARGO_TERM_COLOR: "always",
    [`CARGO_TARGET_${triple.toUpperCase().replace(/-/g, "_")}_LINKER`]: linker,
  };
  if (cfg.crossLangLto) {
    // Every crossLangLto platform links ThinLTO, so leave each crate's per-CGU
    // bitcode with its ThinLTO summary intact: the whole link is one uniform
    // ThinLTO graph and cross-module importing works across Rust↔C++/JSC.
    // `fat` would pre-merge the crates into one summary-less blob the thin
    // link can't import from. (The workspace `[profile.release] lto = "fat"`
    // exists for non-LTO release builds, where the rust .a is linked as
    // already-codegen'd machine code and still wants intra-Rust inlining.)
    env.CARGO_PROFILE_RELEASE_LTO = "off";
  } else if (cfg.asan) {
    // release-asan has `cfg.lto` forced off (config.ts), but without this
    // override Cargo.toml's `[profile.release] lto = "fat"` still applies —
    // rustc merges every crate into one module and codegens it serially, on
    // IR that ASAN instrumentation has already ~doubled. That's the 15-min
    // cargo step vs 4m36s for the linker-plugin-lto build (which defers
    // codegen to lld). ASAN builds don't need intra-Rust LTO; turn it off.
    env.CARGO_PROFILE_RELEASE_LTO = "off";
    // With LTO off, `codegen-units = 1` only serializes each crate's LLVM pass over the doubled IR; nothing built with ASAN ships, so take cargo's release default instead.
    env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS = "16";
  }
  if (cfg.assertions) {
    // Turn `debug_assert!()` / `#[cfg(debug_assertions)]` on in the release
    // cargo profile. `cfg.assertions` defaults to `debug || asan`
    // (config.ts), so release-asan and release-assertions both get Rust
    // invariant checks to match the C++ side's `-DASSERT_ENABLED=1` (keyed
    // on the same `cfg.assertions` in flags.ts). Without this override the
    // workspace `[profile.release]` leaves debug-assertions off and ~3k
    // `debug_assert!` sites compile to nothing under ASAN. The `dev` profile
    // (debug builds) already defaults it on, so this is a no-op there.
    env.CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS = "true";
  }
  if (rustflags.length > 0) env.CARGO_ENCODED_RUSTFLAGS = rustflags.join("\x1f");

  return { args, env, unitEnv, rustflags, linker, targetDir, triple };
}

/**
 * What cargo is asked to plan for the Windows .bin/ shim: `src/install/windows-shim` as a freestanding release PE,
 * which `bun_install` embeds. Without it `bun install` would write empty `.exe`s into `node_modules/.bin/`.
 *
 * Always `--profile shim` (workspace `[profile.shim]`: panic=abort, opt-level=z, lto, codegen-units=1, strip)
 * regardless of bun's own profile — a debug bun should still write release shims (matches Zig's unconditional
 * `.ReleaseFast`).
 *
 * `-Zbuild-std=core,compiler_builtins` rebuilds the sysroot for the freestanding `#![no_std]` crate so LTO can
 * inline across `core`. Nightly + `rust-src` are guaranteed by `rust-toolchain.toml`.
 *
 * None of the main build's rustflags: the shim has its own panic strategy (abort) so `-Zsanitizer=address` (which
 * assumes unwind) and `-Clinker-plugin-lto` (the PE is final-linked by rustc, not deferred to bun's lld link) don't
 * apply, and `-Cforce-frame-pointers` / `-Ctarget-cpu` cost size we don't want. A freestanding flag set instead:
 *   - `-Cpanic=immediate-abort` — every panic call (incl. the core::fmt-carrying assert/unreachable/unwrap, slice
 *                                 indexing) compiles to a bare trap with no `Arguments` payload; that machinery
 *                                 is otherwise the bulk of `.text`.
 *   - `/ENTRY:shim_main`        — bypass the CRT (`mainCRTStartup`) entirely; the launcher reads argv from
 *                                 TEB→PEB itself.
 *   - `/SUBSYSTEM:CONSOLE`      — link.exe can't infer subsystem without a recognised entry symbol.
 *   - `/NODEFAULTLIB`           — don't pull msvcrt/vcruntime/ucrt; the only imports are kernel32 + ntdll (named
 *                                 via `#[link]` on the externs).
 *   - `/Brepro`                 — the link time and the PDB signature in the PE headers come from the contents
 *                                 instead of the clock, so the same inputs give the same bytes: bun_install
 *                                 embeds this file, and a relink must not look like a change.
 *
 * (`-Cforce-unwind-tables=no` would drop `.pdata`, but the `*-windows-msvc` target spec sets
 * `requires_uwtable: true` so rustc rejects it. The section is ~3 KiB; not worth a custom target JSON.)
 */
function shimCargoInvocation(
  cfg: Config,
  main: { env: Record<string, string>; targetDir: string; triple: string },
): { args: string[]; env: Record<string, string>; rustflags: string[] } {
  const args = [
    "-p",
    "bun_shim_impl",
    "--bin",
    "bun-shim-impl",
    "--features",
    "shim_standalone",
    "--target-dir",
    main.targetDir,
    "--target",
    main.triple,
    "--profile",
    "shim",
    "--locked",
    "-Zbuild-std=core,compiler_builtins",
    "-Zbuild-std-features=compiler-builtins-mem",
  ];
  const rustflags = [
    "-Zunstable-options",
    "-Cpanic=immediate-abort",
    "-Clink-arg=/ENTRY:shim_main",
    "-Clink-arg=/SUBSYSTEM:CONSOLE",
    "-Clink-arg=/NODEFAULTLIB",
    "-Clink-arg=/Brepro",
    "-Clink-arg=kernel32.lib",
    "-Clink-arg=ntdll.lib",
    // Cross-compiling from a unix host: this is the only rustc-driven link of a *target* artifact, and the linker
    // is lld-link (no MSVC install), so point it at the xwin splat for the kernel32/ntdll import libs.
    ...(cfg.winsysroot !== undefined ? [`-Clink-arg=/winsysroot:${cfg.winsysroot}`] : []),
  ];
  return { args, env: { ...main.env, CARGO_ENCODED_RUSTFLAGS: rustflags.join("\x1f") }, rustflags };
}

/**
 * Emit the Rust step: for bun_runtime — and on Windows targets the .bin/ shim — a plan edge and, once the plans
 * exist, one edge per unit. Returns the output staticlib path as a one-element array so the link step can spread it
 * alongside the C++ object list.
 */
export function emitRust(n: Ninja, cfg: Config, inputs: RustBuildInputs): string[] {
  assert(cfg.cargo !== undefined, "building bun's Rust crates requires cargo but no rust toolchain was found", {
    hint: "Install rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
  });
  assert(
    cfg.rustc !== undefined && cfg.rustSysroot !== undefined && cfg.rustHostTriple !== undefined,
    "no rustc found for the pinned toolchain",
  );
  const { cargo, rustc } = cfg;

  n.comment("─── Rust ───");
  n.blank();

  const lib = rustLibPath(cfg);
  const { args, env, unitEnv, rustflags, linker, targetDir, triple } = cargoBuildInvocation(cfg);

  // ─── Plans ───
  // cargo resolves a unit graph for exactly the arguments and environment it is given; rerun when the lockfile, any
  // workspace manifest (from the source glob), the toolchain pin, or a vendored path dependency's pinned commit (its
  // fetch stamp — those manifests live under vendor/, outside the glob) changes, or when what is asked for does
  // (plan.input.json). The vendored crates also have to be on disk: cargo refuses to load the workspace manifest if
  // any path dependency's `Cargo.toml` is missing.
  const manifests = inputs.rustSources.filter(p => p.endsWith("Cargo.toml") || p.endsWith("Cargo.lock"));
  const planEdgeInputs = [cargo, rustc, ...manifests, resolve(cfg.cwd, "rust-toolchain.toml"), ...inputs.vendorStamps];
  const planned = (dir: string, what: { args: string[]; env: Record<string, string>; rustflags: string[] }) => {
    const input: PlanInput = {
      cwd: cfg.cwd,
      cargo,
      rustc,
      triple,
      rustflags: what.rustflags,
      args: what.args,
      env: planEnv(what.env),
    };
    return {
      dir,
      rustflags: what.rustflags,
      file: emitRustPlan(n, cfg, dir, { input, inputs: planEdgeInputs }),
      plan: readPlan(dir, input),
    };
  };
  const runtime = planned(rustGraphDir(cfg), { args, env, rustflags });
  const shim = cfg.windows
    ? planned(shimGraphDir(cfg), shimCargoInvocation(cfg, { env, targetDir, triple }))
    : undefined;
  const planFiles = [runtime.file, ...(shim !== undefined ? [shim.file] : [])];
  n.phony("rust-plan", planFiles);

  // ─── Units ───
  // On a fresh tree there is no plan yet: build.ninja depends on the plans (configure.ts), so ninja produces them,
  // reconfigures, and restarts with the per-crate graph. Until then `bun-rust` builds just the plans.
  if (runtime.plan === undefined || (shim !== undefined && shim.plan === undefined)) {
    n.phony("bun-rust", planFiles);
    n.blank();
    return [lib];
  }
  const toolchainBin = (tool: string) => join(cfg.rustSysroot!, "bin", `${tool}${cfg.host.exeSuffix}`);
  const context = {
    cfg,
    baseEnv: unitEnv,
    linker: { host: hostLinker(cfg, triple, linker), target: linker },
    // cargo exports CARGO as the toolchain's own binary, not the rustup proxy that found it.
    cargo: existsSync(toolchainBin("cargo")) ? toolchainBin("cargo") : cargo,
    rustdoc: toolchainBin("rustdoc"),
  };
  n.phony("rust-codegen-ready", inputs.codegenOrderOnly);

  // The shim first: bun_install embeds its executable, so every edge of that package waits for it. Its crates
  // (bun_windows_sys, bun_opaque and the shim itself) include nothing generated, so they wait for no codegen.
  const packageInputs: Record<string, string[]> = {};
  if (shim?.plan !== undefined) {
    const graph = buildRustGraph(shim.plan, shim.rustflags, shim.dir);
    assert(
      graph.root.kind === "bin",
      `shim plan root ${graph.root.crateName} is a ${graph.root.kind}, expected the bin`,
    );
    const exe = windowsShimPath(cfg);
    emitRustUnits(
      n,
      { ...context, graph, targetRustflags: shim.rustflags, binDestination: exe },
      { localOrderOnly: [], implicitInputs: {}, vendorStamps: inputs.vendorStamps },
    );
    n.phony("bun-shim", [exe]);
    packageInputs.bun_install = [exe];
  }

  const graph = buildRustGraph(runtime.plan, runtime.rustflags, runtime.dir);
  assert(graph.root.output === lib, `rust plan root writes ${graph.root.output}, expected ${lib}`);
  emitRustUnits(
    n,
    { ...context, graph, targetRustflags: runtime.rustflags },
    { localOrderOnly: ["rust-codegen-ready"], implicitInputs: packageInputs, vendorStamps: inputs.vendorStamps },
  );
  n.phony("bun-rust", [lib]);
  n.blank();
  return [lib];
}

/**
 * `-C linker` for host units (build scripts, proc-macros). Under cargo the `[target.<triple>]` linker setting
 * applies to host units too whenever the host *is* the target triple (the common, non-cross case), so those
 * builds keep one linker for everything; when cross-compiling, host units get what the generated
 * `.cargo/config.toml` (cargo-config.ts) names for the host: the discovered host C++ driver, or on a Windows
 * host the MSVC-style linker.
 */
function hostLinker(cfg: Config, targetTriple: string, targetLinker: string): string | undefined {
  if (cfg.rustHostTriple === targetTriple) return targetLinker;
  if (cfg.host.os === "windows") return cfg.msvcLinker ?? cfg.ld;
  return cfg.hostCxx;
}

/**
 * Linker flags to wrap the Rust staticlib so every `#[no_mangle]` member
 * reaches the final image (the dynamic-list / NAPI surface has no inbound
 * static ref, so plain archive extraction would drop those `.o` members).
 * Functionally equivalent to feeding a single merged `.o`.
 *
 * Returned flags reference `libs` by absolute path; the caller must also
 * list them in the link's `implicitInputs` so ninja relinks on change.
 */
export function rustLinkFlags(cfg: Config, libs: string[]): string[] {
  if (libs.length === 0) return [];
  if (cfg.windows) {
    return libs.map(l => `/WHOLEARCHIVE:${l}`);
  }
  if (cfg.darwin) {
    return libs.flatMap(l => ["-Wl,-force_load", l]);
  }
  // ELF (Linux/FreeBSD/Android)
  return ["-Wl,--whole-archive", ...libs, "-Wl,--no-whole-archive"];
}
