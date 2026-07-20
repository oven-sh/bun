/**
 * Rust build step — cargo as a ninja edge.
 *
 * The Rust port lives in the workspace rooted at the repo's `Cargo.toml`;
 * the leaf crate is `src/bun_bin` (`crate-type = ["staticlib"]`). One
 * `cargo build -p bun_bin` produces `libbun_rust.a` containing the entire
 * Rust crate graph plus libstd, with `main` exported `#[no_mangle] extern "C"`.
 *
 * Cargo's own incremental compilation handles per-file tracking; our ninja
 * rule just invokes it and declares the output. `restat` lets cargo's no-op
 * prune the downstream link when nothing changed.
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

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { bunExeName, type Config } from "./config.ts";
import { assert } from "./error.ts";
import type { Ninja } from "./ninja.ts";
import { rustLtoFixCliPath } from "./rust-lto-fix-cli.ts";
import { quote, quoteArgs } from "./shell.ts";
import { streamPath } from "./stream.ts";

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
  const arch = cfg.x64 ? "x86_64" : "aarch64";
  if (cfg.darwin) return `${arch}-apple-darwin`;
  if (cfg.windows) return `${arch}-pc-windows-msvc`;
  if (cfg.freebsd) return `${arch}-unknown-freebsd`;
  // linux
  assert(cfg.abi !== undefined, "linux build missing abi");
  if (cfg.abi === "android") return `${arch}-linux-android`;
  if (cfg.abi === "musl") return `${arch}-unknown-linux-musl`;
  return `${arch}-unknown-linux-gnu`;
}

/**
 * Cargo profile + the subdirectory it writes into under `--target-dir`.
 * `dev` writes to `debug/`, every other profile name writes to `<name>/`.
 *
 * `cfg.asan` does NOT change the profile (it changes rustflags); a debug-asan
 * build still uses `dev`. RelWithDebInfo / MinSizeRel collapse to `release` —
 * cargo's stock release already keeps debuginfo (`debug = 1` is the workspace
 * default), and we don't ship a `MinSizeRel` Rust path yet.
 */
function cargoProfile(cfg: Config): { name: string; subdir: string } {
  return cfg.buildType === "Debug" ? { name: "dev", subdir: "debug" } : { name: "release", subdir: "release" };
}

/**
 * Can a linux host cross-compile the Rust staticlib for `cfg`'s target
 * without a native runner?
 *
 * Used by CI's `build-rust` step to decide fan-out: targets that return
 * `true` here share one fast linux box (one `cargo build --target <triple>`
 * each); targets that return `false` get a native agent.
 *
 *   linux-{gnu,musl,android} × {x64,aarch64}: yes — `rustup target add`
 *     installs prebuilt std, no foreign linker needed for a staticlib.
 *   freebsd × {x64,aarch64}: yes — Tier 2/3 (`-Zbuild-std` for aarch64),
 *     staticlib needs no FreeBSD libc to produce.
 *   darwin × {x64,aarch64}: yes — Tier 2 prebuilt std, and a staticlib
 *     needs no Mach-O link. No build script in the current dep graph
 *     compiles C for the target; if one ever does, emitRust's
 *     CFLAGS_<triple>/SDKROOT forwarding (set when the SDK is resolved)
 *     points cc-rs at the macOS SDK.
 *   windows-msvc × {x64,aarch64}: yes *when a Windows sysroot (xwin splat)
 *     is present* — the staticlib itself needs no SDK, but the bun_shim_impl
 *     PE that emitRust() also builds links against kernel32/ntdll import
 *     libs via lld-link + /winsysroot (see config.ts `winsysroot`). The
 *     shared CI rust box doesn't carry a splat, so CI runs these on the
 *     amazonlinux fleet instead, where configure fetches one per build.
 *
 * Unlike zig (which bundled its own libc/SDK for every target), cargo
 * delegates to a system C toolchain for any `cc`/`bindgen`/link step, so
 * the cross-compile boundary is "does the host have a C cross-toolchain
 * for the target", not "does rustc support the triple".
 */
export function rustCanCrossFromLinux(cfg: Config): boolean {
  if (cfg.linux) return true; // gnu, musl, android — all archs
  if (cfg.freebsd) return true;
  if (cfg.darwin) return true;
  // windows: possible with a winsysroot (see above), but the shared rust
  // box isn't provisioned with one — CI routes windows rust-only to the
  // amazonlinux fleet (which fetches a splat at configure time) instead.
  return false;
}

/**
 * All target triples CI builds. Exposed so `rust:check-all` can iterate
 * `cargo check --target <t>` without re-deriving the list.
 */
export const allRustTargets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-unknown-linux-musl",
  "aarch64-unknown-linux-musl",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "aarch64-pc-windows-msvc",
  "x86_64-unknown-freebsd",
  "aarch64-linux-android",
] as const;

/**
 * Tier 3 targets — rustup ships no prebuilt `rust-std` for these, so
 * `rustup target add` would fail and cargo needs `-Zbuild-std` (which in turn
 * needs the `rust-src` component). As of nightly-2026-05, the only Tier 3
 * triple in CI's matrix is aarch64-freebsd.
 */
function rustTargetIsTier3(triple: string): boolean {
  return triple === "aarch64-unknown-freebsd";
}

/**
 * Absolute source-tree path the Windows .bin/ shim PE is copied to, where
 * `bun_install`'s `include_bytes!("bun_shim_impl.exe")` reads it from. The
 * build product lands in `rust-target/<triple>/shim/`; it's copied here so
 * the embed path is a fixed relative-to-source string (no env-var plumbing).
 * Git-ignored; `src/install/build.rs` creates a 0-byte placeholder for bare
 * `cargo check` so the embed never sees ENOENT.
 */
function windowsShimDestPath(cfg: Config): string {
  return resolve(cfg.cwd, "src", "install", "windows-shim", "bun_shim_impl.exe");
}

/**
 * Path to the `rustup` binary that owns `cfg.cargo`, or `undefined` if
 * `cfg.cargo` isn't a rustup proxy (a distro/Homebrew cargo, say).
 * `rustup target add` is only meaningful when rustup is the toolchain
 * manager — `rust_build_cross` requires it; everyone else gets `rust_build`.
 */
function findRustup(cfg: Config): string | undefined {
  if (cfg.cargo === undefined) return undefined;
  const rustup = join(dirname(cfg.cargo), `rustup${cfg.host.exeSuffix}`);
  return existsSync(rustup) ? rustup : undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// Paths
// ───────────────────────────────────────────────────────────────────────────

/** `<buildDir>/rust-target` — sibling of `obj/`, `pch/`. */
function rustTargetDir(cfg: Config): string {
  return resolve(cfg.buildDir, "rust-target");
}

/**
 * Absolute path to `libbun_rust.a` (or `bun_rust.lib` on Windows).
 *
 * `--target` is always passed, so cargo's output layout is
 * `<target-dir>/<triple>/<profile>/<libPrefix>bun_rust<libSuffix>`.
 */
export function rustLibPath(cfg: Config): string {
  const { subdir } = cargoProfile(cfg);
  return resolve(rustTargetDir(cfg), rustTarget(cfg), subdir, `${cfg.libPrefix}bun_rust${cfg.libSuffix}`);
}

/** The `RUSTC_WORKSPACE_WRAPPER` source — see its module doc for why it exists. */
const metadataShimSource = resolve(import.meta.dirname, "rustc-metadata-shim.rs");

/** Where the compiled wrapper lands. A HOST executable — cargo spawns it. */
function metadataShimPath(cfg: Config): string {
  return resolve(cfg.buildDir, `rustc-metadata-shim${cfg.host.exeSuffix}`);
}

// ───────────────────────────────────────────────────────────────────────────
// Ninja rules
// ───────────────────────────────────────────────────────────────────────────

export function registerRustRules(n: Ninja, cfg: Config): void {
  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);

  // Regular-LTO summary fix-up for the ELF cross-language LTO link (see
  // rustLtoLinkInputs() below). Registered before the cargo gate: the
  // link-only CI agents emit this edge too, and it needs rustc's
  // llvm-tools, not cargo. Not darwin/windows: their ThinLTO links keep the
  // per-CGU summaries (CARGO_PROFILE_RELEASE_LTO=off) and need no fix-up.
  if (cfg.crossLangLto && !cfg.darwin && !cfg.windows) {
    n.rule("rust_lto_fix", {
      command: `${cfg.jsRuntime} ${q(rustLtoFixCliPath)} $in $out $llvm_bin $ar`,
      description: "regular-LTO summary → $out",
    });
  }

  if (cfg.cargo === undefined) return; // emitRust() asserts with a hint
  const stream = `${cfg.jsRuntime} ${q(streamPath)} rust`;

  const rustup = findRustup(cfg);
  // Toolchain self-heal, prepended to anything that invokes a rustup proxy —
  // see the rust_build_cross comment below for what it repairs and why it's a
  // ~70ms no-op otherwise.
  const repair =
    rustup !== undefined && cfg.rustToolchain !== undefined
      ? `${stream} --console $env ${q(rustup)} toolchain install ${cfg.rustToolchain} --force --component rust-src $rust_target_arg && `
      : "";

  // `RUSTC_WORKSPACE_WRAPPER` — pins `-C metadata` so our crates keep the same
  // v0 symbol names across builds (rustc-metadata-shim.rs has the why). A bare
  // `rustc` builds it: it must exist before cargo runs, so it can't be a
  // workspace member. That makes it the build's first rustup-proxy call, hence
  // the repair above: a partially installed toolchain has no host `rust-std`
  // for it to link against. `-Clinker`: rustc's default `cc` isn't on every CI
  // image, so use the clang tools.ts resolved (MSVC's link.exe on a Windows
  // host), same as the cargo env picks for the dep graph's host artifacts.
  const rustc = join(dirname(cfg.cargo), `rustc${cfg.host.exeSuffix}`);
  const shimLink = hostWin
    ? [`-Clinker=${cfg.msvcLinker ?? cfg.ld}`]
    : [`-Clinker=${cfg.hostCc}`, "-Clink-arg=-fuse-ld=lld"];
  const shimCmd = `${repair}${q(rustc)} --edition 2024 -Copt-level=2 ${quoteArgs(shimLink, hostWin)} -o $out $in`;
  n.rule("rustc_metadata_shim", {
    // ninja spawns via CreateProcess, so `&&` needs a shell — same as rust_build_cross.
    command: hostWin && repair !== "" ? `cmd /c "${shimCmd}"` : shimCmd,
    description: "rustc → $out",
  });

  // Cargo build for `bun_bin`. Runs from repo root (workspace `Cargo.toml`
  // lives there). Env passed via stream.ts `--env=K=V`.
  //
  // `--console`: cargo has its own progress bar / colour; pool=console gives
  // it the TTY directly. restat: cargo's incremental build doesn't touch
  // the staticlib when nothing changed.
  n.rule("rust_build", {
    command: `${stream} --console --cwd=$cwd $env ${q(cfg.cargo)} build $args`,
    description: "cargo bun_bin → $label",
    pool: "console",
    restat: true,
  });

  // Variant that ensures the pinned toolchain (and `rust-std` for
  // `$rust_target` when it has a prebuilt one) is fully installed before
  // building. CI agents pin the toolchain via `RUSTUP_TOOLCHAIN`, which
  // bypasses `rust-toolchain.toml`'s `targets`/`components` install list, and
  // rustup-proxy auto-install can leave a *partial* toolchain dir (rustc/cargo
  // present, no `rust-std`, no `lib/rustlib/multirust-channel-manifest.toml`).
  // That surfaces as either `error[E0463]: can't find crate for core` (cargo
  // ran, no std) or `error: Missing manifest in toolchain '<channel>-<host>'`
  // (rustup-proxy refused to even resolve cargo). `rustup toolchain install
  // --force` repairs both — `--force` reinstalls missing components rather
  // than trusting "the dir exists, I'm done", and it's a ~70ms no-op when the
  // toolchain is already complete (verified locally), so it's cheap to run
  // unconditionally.
  //
  // `$rust_target_arg` is `--target <triple>` for Tier 1/2 (also installs the
  // prebuilt `rust-std-<triple>`), and empty for Tier 3 (no prebuilt; cargo
  // gets `-Zbuild-std` instead — see emitRust). Both still get `rust-src`
  // (needed for `-Zbuild-std`).
  //
  // Only registered when `cfg.rustToolchain` is pinned and `cfg.cargo` is a
  // rustup proxy — otherwise there's no channel to install / no `rustup` to
  // call, and toolchain management is the user's problem.
  // `--console` on the rustup step too: it's sequential with cargo (both
  // sides of `&&`) and the rule already takes the console pool, so there's
  // no interleaving risk — and `--console` inherits stdio directly, which
  // matters because stream.ts's pipe path can drop a fast-failing child's
  // output (it `process.exit()`s on `close` before the async stdout writes
  // drain). Without it, a failed `toolchain install` shows no error at all.
  //
  // No `--profile minimal`: the agent already has the default profile, and
  // rustup applies `--profile` to the install spec, not just first-install —
  // requesting a *narrower* profile on a `--force` reinstall is asking for
  // trouble. We only care that `rust-src` and `rust-std-<triple>` exist on
  // top of whatever profile is there.
  //
  // Windows: ninja spawns commands via CreateProcess directly (no shell), so
  // `&&` would be passed as a literal argument to the first node.exe — rustup
  // then sees the second half of the chain as extra argv and rejects
  // `--experimental-strip-types`. Wrap in `cmd /c "..."` so cmd.exe handles
  // the chain (cmd's quote-stripping rule removes only the outermost pair,
  // preserving the embedded `"..."` around paths/env values). Same pattern as
  // codegen.ts / bun.ts.
  // Windows .bin/ shim PE: cargo build → copy into the source tree for
  // `include_bytes!`. One rule does both; cargo's own output path and the
  // source-tree copy are undeclared side effects (see below for what $out is).
  //
  // Copy is *content-conditional* (`fc /b` / `cmp -s` returns 0 iff bytes
  // match): any `.rs` edit re-invokes this rule (it shares `rustSources`
  // with the main build), cargo no-ops, and a blind copy would still bump
  // the destination's mtime → `bun_install`'s `include_bytes!` dep-info sees
  // a change → spurious recompile of `bun_install` + downstream on every
  // build. Skipping the copy when bytes match keeps its mtime stable.
  //
  // The declared output ($out) is a per-build-dir stamp, NOT the source-tree
  // exe: the exe path is shared by every windows arch/profile (the
  // `include_bytes!` path is fixed), so if it were the output, building x64
  // then arm64 in sibling build dirs would leave the arm64 dir believing the
  // (x64) exe is up to date and embed the wrong-arch shim. With the stamp as
  // output and the shared exe as an implicit *input*, a sibling build dir
  // overwriting the exe makes this dir's stamp stale → the shim is rebuilt
  // for the right arch on the next build here.
  //
  // Registered for windows *targets* only; the shell dialect follows the
  // HOST (cmd.exe natively, sh when cross-compiling from linux/macOS).
  if (cfg.windows) {
    n.rule("rust_shim", {
      command: hostWin
        ? `cmd /c "${stream} --cwd=$cwd $env ${q(cfg.cargo)} build $args && ` +
          `( fc /b $shim_src $shim_dest >nul 2>&1 || copy /Y /B $shim_src $shim_dest >nul ) && type nul > $out"`
        : `${stream} --cwd=$cwd $env ${q(cfg.cargo)} build $args && ` +
          `( cmp -s $shim_src $shim_dest 2>/dev/null || cp $shim_src $shim_dest ) && touch $out`,
      description: "cargo bun_shim_impl → $shim_dest",
      pool: "console",
      // No restat: the stamp ($out) is touched unconditionally, so there's
      // nothing for ninja to prune on; the content-conditional copy above
      // exists for cargo's dep-info on $shim_dest, not for restat.
    });
  }

  if (repair !== "") {
    const chain = `${repair}${stream} --console --cwd=$cwd $env ${q(cfg.cargo)} build $args`;
    n.rule("rust_build_cross", {
      command: hostWin ? `cmd /c "${chain}"` : chain,
      description: "cargo bun_bin → $label ($rust_target_arg)",
      pool: "console",
      restat: true,
    });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Rust build emission
// ───────────────────────────────────────────────────────────────────────────

/**
 * Inputs to the cargo build step. Assembled by the caller from
 * emitted codegen outputs + globbed `*.rs` sources.
 */
export interface RustBuildInputs {
  /**
   * Generated files Rust `include!`s / `include_bytes!`s — content tracked.
   * The `.rs` files (`generated_classes.rs` etc.) are undeclared side
   * effects of the same scripts that produce `CodegenOutputs.rustInputs`, so
   * passing that set here is sufficient to order codegen before cargo.
   */
  codegenInputs: string[];
  /**
   * Generated files Rust needs to EXIST but doesn't embed (debug-mode bake
   * runtime, runtime-loaded modules). Order-only.
   */
  codegenOrderOnly: string[];
  /**
   * All `*.rs` source files + workspace `Cargo.toml`/`Cargo.lock` (globbed
   * at configure time). Implicit inputs for ninja's staleness check —
   * cargo discovers sources itself; this is just so ninja knows when to
   * re-invoke.
   */
  rustSources: string[];
  /**
   * Fetch stamps for vendored Rust crates the workspace consumes as path
   * dependencies (currently lol-html). Implicit inputs so cargo never runs
   * before the source tree exists, and so a commit bump re-invokes cargo.
   */
  vendorStamps: string[];
}

/**
 * Emit the cargo build step. Returns the output staticlib path as a
 * one-element array so the link step can spread it alongside the C++
 * object list.
 */
export function emitRust(n: Ninja, cfg: Config, inputs: RustBuildInputs): string[] {
  assert(cfg.cargo !== undefined, "building bun's Rust crates requires cargo but no rust toolchain was found", {
    hint: "Install rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
  });

  n.comment("─── Rust ───");
  n.blank();

  const hostWin = cfg.host.os === "windows";
  const targetDir = rustTargetDir(cfg);
  const triple = rustTarget(cfg);
  const tier3 = rustTargetIsTier3(triple);
  const profile = cargoProfile(cfg);
  const lib = rustLibPath(cfg);

  // Implicit input of every cargo edge below, so it's on disk before cargo
  // tries to spawn it. Emitted after `env` is built (the rule's toolchain
  // repair wants it).
  const metadataShim = metadataShimPath(cfg);

  // ─── Build args ───
  const args: string[] = [
    "-p",
    "bun_bin",
    "--lib",
    "--target-dir",
    targetDir,
    "--target",
    triple,
    "--profile",
    profile.name,
  ];
  if (tier3 || cfg.release || cfg.asan) {
    // Build std/core/alloc from source instead of linking the rustup prebuilt.
    //
    // tier3:   no prebuilt `rust-std` exists.
    // release: prebuilt std is native code built for generic x86-64 with no
    //          `.llvm_addrsig`. Rebuilding with our RUSTFLAGS gets it
    //          `-Ctarget-cpu=` (AVX2/BMI in core::str / hashbrown), and under
    //          `cfg.lto` it becomes bitcode that joins the cross-language LTO
    //          unit + safe ICF instead of being an opaque blob in the link.
    // asan:    prebuilt std is uninstrumented; rebuilding applies
    //          `-Zsanitizer=address` so OOB/UAF inside Vec/String/HashMap are
    //          visible instead of stopping at the std boundary.
    //
    // The workspace is `panic = "abort"` (see Cargo.toml). `proc_macro` is
    // needed because `cargo build --target` still resolves proc-macro crates
    // for the host through the same `-Zbuild-std` flag set. Requires the
    // `rust-src` component, which `rust-toolchain.toml` requests and CI
    // images preinstall (Dockerfile / bootstrap.sh `rustup component add
    // rust-src`).
    args.push("-Zbuild-std=core,alloc,std,proc_macro,panic_abort");
  }

  // ─── rustflags ───
  // CARGO_ENCODED_RUSTFLAGS: U+001F-separated so multi-arg flags survive.
  const rustflags: string[] = [];
  // Match the C/C++ side's `-fno-pic` / `-Wl,-no-pie` (flags.ts:929,1001) on
  // the targets where bun links as a position-dependent ET_EXEC. With the
  // default `pic`, every Rust `&'static [T]` / `&'static str` / vtable is a
  // GOT-relative reference and the constant ends up in `.data.rel.ro` (RW
  // segment, eagerly faulted) instead of `.rodata`; libbun_rust.a alone
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
  // Keep frame pointers — matches the C++ side's `-fno-omit-frame-pointer` / `/Oy-`
  // (flags.ts:293-301). Needed so profilers and crash backtraces can walk Rust frames.
  rustflags.push("-Cforce-frame-pointers=yes");
  // Parallel frontend: rustc's default is single-threaded for parse / macro
  // expansion / typeck / borrowck, so the critical-path crate (`bun_runtime`)
  // sits on one core while the rest idle. With this, independent compiler
  // queries run on a rayon pool and the long pole roughly halves. The pool
  // shares cargo's jobserver, so N rustcs × 8 doesn't oversubscribe — each
  // thread acquires a `-j` token before doing work.
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
  // Match the C++ side's CPU target (`cpuTargetFlags` in flags.ts) so Rust
  // codegen sees the same ISA. Without this, C++ is built with
  // `-march=haswell` while Rust defaults to generic x86-64 (SSE2 only),
  // leaving auto-vectorization and BMI/LZCNT/POPCNT on the table for the
  // entire Rust crate graph. rustc's `-C target-cpu=` takes LLVM CPU names
  // (same vocabulary as clang's `-march=`/`-mcpu=`), so the mapping is 1:1.
  const cpuTarget = cfg.x64
    ? cfg.baseline
      ? "nehalem"
      : "haswell"
    : cfg.darwin
      ? "apple-m1"
      : // armv8-a+crc isn't a CPU name — closest LLVM model with CRC baseline:
        "cortex-a72";
  rustflags.push(`-Ctarget-cpu=${cpuTarget}`);
  // `bun_core::build_options::ENABLE_ASAN = cfg!(bun_asan)` — must agree with
  // the C++ `ASAN_ENABLED` macro so Global::exit() picks the same libc exit
  // path (`exit` vs `quick_exit`) that c-bindings.cpp registered Bun__onExit on.
  rustflags.push("--check-cfg=cfg(bun_asan)");
  if (cfg.asan) {
    // Match the C/C++ side's instrumentation so cross-language stack traces
    // and shadow-memory bookkeeping agree. Nightly-only flag; the pinned
    // toolchain in `rust-toolchain.toml` is nightly.
    rustflags.push("-Zsanitizer=address");
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
  // those functions, it does not fail. Driven end-to-end by `bun run
  // build:btg:pgo`. RUSTFLAGS only reach target crates (with `--target`), so
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
  // (`bun_bin` is a staticlib with no link step; `lol_html` is a plain rlib
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
  // and the `bun_bin` staticlib has no link step, so it's normally dead — but
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
    // of clang's — see workarounds.ts "rust-lld-for-crosslang-lto".
    rustflags.push("-Clinker-plugin-lto");
    rustflags.push("-Cembed-bitcode=yes");
    // EnableSplitLTOUnit consistency: lld errors with "inconsistent LTO Unit
    // splitting" if any bitcode module in the link disagrees with the others.
    // The Rust value must match whatever the C++ side produces, and that
    // differs per platform:
    //
    //   - darwin (ThinLTO): the C/C++ side passes -fno-split-lto-unit
    //     everywhere (index-based WPD, no hybrid split mode) and Apple
    //     targets default to 0 anyway, so every C/C++ module is 0. rustc's
    //     default is also 0 — pass nothing. Adding -Zsplit-lto-unit here
    //     would make the Rust modules the inconsistent ones and abort the
    //     link.
    //   - windows cross (ThinLTO): same as darwin — clang-cl never gets
    //     -fwhole-program-vtables (COFF associative-COMDAT abort) and
    //     -fno-split-lto-unit is passed explicitly, so every C/C++ module is
    //     0 and rustc's default 0 matches — pass nothing.
    //   - linux (full LTO): the regular-LTO summary clang writes on ELF
    //     always says EnableSplitLTOUnit=1, so every C++ module (ours and
    //     the WebKit -lto prebuilts) carries 1. The Rust modules'
    //     EnableSplitLTOUnit module flag must say 1 to match →
    //     -Zsplit-lto-unit. (The flag is stamped per-CGU at module
    //     creation, survives rustc's fat-LTO pre-merge, and is what the
    //     rust_lto_fix step's `opt --module-summary` copies into the
    //     regular-LTO summary it bolts onto the merged module — see
    //     rust-lto-fix-cli.ts.)
    //
    // (`-Clink-arg=-fuse-ld=lld` is pushed unconditionally above — under LTO
    // it doubles as making rustc's bitcode link go through the LTO-aware
    // linker our final link uses, not BFD `/usr/bin/ld`.)
    if (!cfg.darwin && !cfg.windows) {
      rustflags.push("-Zsplit-lto-unit");

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
  const env: Record<string, string> = {
    CARGO_TERM_COLOR: "always",
    // Pins `-C metadata` for our own crates so their v0 symbol names survive a
    // dependency-graph edit — rustc-metadata-shim.rs has the why. `_WORKSPACE_`
    // rather than plain `RUSTC_WRAPPER`: cargo applies it to workspace members
    // only, leaving registry crates on its collision-proof hash. `cargo clippy`
    // sets this variable itself, so it keeps working.
    RUSTC_WORKSPACE_WRAPPER: metadataShim,
    // `include!(concat!(env!("BUN_CODEGEN_DIR"), "/generated_*.rs"))` and
    // `include_bytes!` in `bun_js_parser`/`bun_runtime` resolve against this.
    // Set in cargo's env so it reaches every crate's `rustc` invocation
    // (not just those with a `build.rs` re-export). `bun_core::build_options`
    // is also `include!()`'d from here — its values come from
    // `buildOptionsRs.ts` (written at configure time), not env vars.
    BUN_CODEGEN_DIR: cfg.codegenDir,

    // ── toolchain forwarding (cc-rs / build scripts) ──
    // build.rs of crates in the dep graph (anything using `cc`) and rustc's
    // own linker invocations must use the SAME clang/ar `tools.ts` resolved —
    // not whatever is first in PATH. On CI the LLVM toolchain lives at a
    // versioned path (`/opt/llvm-N/`) and the system `cc` may be absent or
    // mismatched. cc-rs honours `CC`/`CXX`/`AR`; cargo honours
    // `CARGO_TARGET_<TRIPLE>_LINKER` for the per-target linker.
    CC: cfg.cc,
    CXX: cfg.cxx,
    AR: cfg.ar,
    // Per-target linker. The `bun_bin` artifact is a staticlib (no link step);
    // what actually gets linked are HOST executables/dylibs in the dep graph
    // (build scripts, proc-macros) — and on a native build, `--target` is the
    // host triple, so this env var sets *their* linker too.
    //
    // Non-Windows: `cfg.cxx` (clang++) drives lld with the same flag dialect
    // the C++ side uses. `-Clink-arg=-fuse-ld=lld` (pushed into rustflags
    // below) selects lld for any rustc-driven cdylib link.
    //
    // Windows: rustc's `*-msvc` linker flavor passes `link.exe`-style args
    // directly (`/NOLOGO`, `/OUT:`, `/NATVIS:`, `/PDBALTPATH:`, …). `clang-cl`
    // is a *compiler driver*, not a linker — it reads `/N…` args as input
    // filenames ("no such file or directory: '/NOLOGO'") and never reaches the
    // underlying linker. Use the discovered MSVC `link.exe` (matches what
    // `dep_cargo` sets for vendored crates — see source.ts), falling back to
    // `lld-link.exe` (`cfg.ld`); both speak the `/X` dialect rustc emits.
    [`CARGO_TARGET_${triple.toUpperCase().replace(/-/g, "_")}_LINKER`]: cfg.windows
      ? (cfg.msvcLinker ?? cfg.ld)
      : cfg.cxx,
  };
  if (cfg.cargoHome !== undefined) env.CARGO_HOME = cfg.cargoHome;
  if (cfg.rustupHome !== undefined) env.RUSTUP_HOME = cfg.rustupHome;
  // Pin the toolchain explicitly. `vendor/` is commonly a symlink shared
  // across worktrees; rustup's directory walk could otherwise resolve a
  // different worktree's `rust-toolchain.toml`.
  if (cfg.rustToolchain !== undefined) env.RUSTUP_TOOLCHAIN = cfg.rustToolchain;
  // Darwin cross-compile from a non-darwin host: point anything in the dep
  // graph that cares about the Apple SDK at the extracted sysroot. rustc
  // itself doesn't need it for a staticlib, but cc-rs (build scripts
  // compiling target C) honours CFLAGS_<triple>/SDKROOT, and
  // MACOSX_DEPLOYMENT_TARGET keeps the LC_BUILD_VERSION minos rustc stamps
  // into its objects consistent with the C++ side's -mmacosx-version-min.
  if (cfg.darwin && cfg.host.os !== "darwin") {
    if (cfg.osxDeploymentTarget !== undefined) env.MACOSX_DEPLOYMENT_TARGET = cfg.osxDeploymentTarget;
    if (cfg.osxSysroot !== undefined && cfg.crossTarget !== undefined && cfg.osxDeploymentTarget !== undefined) {
      env.SDKROOT = cfg.osxSysroot;
      const sdkFlags = `--target=${cfg.crossTarget} -isysroot ${cfg.osxSysroot} -mmacosx-version-min=${cfg.osxDeploymentTarget}`;
      const tripleEnv = triple.replace(/-/g, "_");
      env[`CFLAGS_${tripleEnv}`] = sdkFlags;
      env[`CXXFLAGS_${tripleEnv}`] = sdkFlags;
    }
  }
  if (cfg.crossLangLto) {
    // The Rust bitcode's shape must match the platform's C++ LTO mode so both
    // sides land in the same LTO partition at link time and can exchange
    // function bodies. (The workspace `[profile.release] lto = "fat"` exists
    // for non-LTO release builds, where the rust .a is linked as
    // already-codegen'd machine code and still wants intra-Rust inlining.)
    //
    //   - darwin / windows cross (ThinLTO links): `off`. Each crate's
    //     per-CGU bitcode keeps its ThinLTO summary, so the whole link is
    //     one uniform ThinLTO graph and cross-module importing works across
    //     Rust↔C++/JSC. `fat` would pre-merge the crates into one
    //     summary-less blob the thin link can't import from (and rustc's
    //     serial pre-merge is wasted work — the linker schedules the
    //     backends itself).
    //   - ELF (full-LTO link — see the -flto=full entry in flags.ts): `fat`.
    //     rustc pre-merges every crate (including the prebuilt std's
    //     embedded bitcode) into ONE summary-less regular-LTO module, which
    //     lld then merges into the same regular-LTO partition as the C++
    //     `-flto=full` objects — that merge is what gives Rust↔C++
    //     cross-language inlining under full LTO. (The merged module first
    //     gets a regular-LTO summary bolted on by the rust_lto_fix edge —
    //     rustLtoLinkInputs() below — because lld's EnableSplitLTOUnit
    //     consistency check requires one.) With `off`, the per-CGU
    //     ThinLTO-summaried modules are processed as ThinLTO partitions
    //     instead, which (a) never exchange function bodies with the C++
    //     regular partition (no cross-language inlining at all), and
    //     (b) go through the LLVM 22 ThinLTO backend pipeline that
    //     miscompiles JSC on linux.
    env.CARGO_PROFILE_RELEASE_LTO = cfg.darwin || cfg.windows ? "off" : "fat";
  } else if (cfg.asan) {
    // release-asan has `cfg.lto` forced off (config.ts), but without this
    // override Cargo.toml's `[profile.release] lto = "fat"` still applies —
    // rustc merges every crate into one module and codegens it serially, on
    // IR that ASAN instrumentation has already ~doubled. That's the 15-min
    // cargo step vs 4m36s for the linker-plugin-lto build (which defers
    // codegen to lld). ASAN builds don't need intra-Rust LTO; turn it off.
    env.CARGO_PROFILE_RELEASE_LTO = "off";
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

  const envArgs = Object.entries(env)
    .map(([k, v]) => `--env=${k}=${quote(v, hostWin)}`)
    .join(" ");

  // ─── `-C metadata` pin ───
  n.build({
    outputs: [metadataShim],
    rule: "rustc_metadata_shim",
    inputs: [metadataShimSource],
    vars: { env: envArgs },
  });

  // ─── Windows .bin/ shim PE ───
  // Builds `src/install/windows-shim/bun_shim_impl.rs` as a freestanding release PE and wires the artifact into `include_bytes!`. Without this step `include_bytes!` embeds the
  // 0-byte placeholder and `bun install` writes empty `.exe`s into
  // `node_modules/.bin/`.
  //
  // Ordered before the main cargo build via `implicitInputs` below so the
  // real PE is on disk when `bun_install` compiles. Same env as the main
  // build (toolchain forwarding, CARGO_HOME) but no codegen dep — the shim
  // crate's graph is bun_core/bun_sys/bun_string only.
  const shimInputs: string[] = [];
  if (cfg.windows) {
    const shimDest = windowsShimDestPath(cfg);
    // Always `--profile shim` (workspace `[profile.shim]`: panic=abort,
    // opt-level=z, lto, codegen-units=1, strip) regardless of bun's own
    // profile — a debug bun should still write release shims (matches Zig's
    // unconditional `.ReleaseFast`).
    //
    // `-Zbuild-std=core,compiler_builtins` rebuilds the sysroot for the
    // freestanding `#![no_std]` crate so LTO can inline across `core`;
    // `panic_immediate_abort` makes every `panic!`/`unreachable!`/`assert!`
    // (incl. those buried in `core::fmt`, slice indexing, `Option::unwrap`)
    // compile to a bare `ud2`/`brk` with no `core::fmt::Arguments` payload —
    // that machinery is otherwise the bulk of `.text`. Nightly + `rust-src`
    // are guaranteed by `rust-toolchain.toml`.
    const shimArgs: string[] = [
      "-p",
      "bun_shim_impl",
      "--bin",
      "bun_shim_impl",
      "--features",
      "shim_standalone",
      "--target-dir",
      targetDir,
      "--target",
      triple,
      "--profile",
      "shim",
      "-Zbuild-std=core,compiler_builtins",
      "-Zbuild-std-features=compiler-builtins-mem",
    ];
    const shimSrc = resolve(targetDir, triple, "shim", "bun_shim_impl.exe");
    // Same env minus the main build's CARGO_ENCODED_RUSTFLAGS — the shim has
    // its own panic strategy (abort) so `-Zsanitizer=address` (which assumes
    // unwind) and `-Clinker-plugin-lto` (the PE is final-linked here, not
    // deferred to bun's lld link) don't apply, and `-Cforce-frame-pointers` /
    // `-Ctarget-cpu` cost size we don't want. Replace with a freestanding
    // flag set:
    //   - `/ENTRY:shim_main`      — bypass the CRT (`mainCRTStartup`) entirely;
    //                               the launcher reads argv from TEB→PEB itself.
    //   - `/SUBSYSTEM:CONSOLE`    — link.exe can't infer subsystem without a
    //                               recognised entry symbol.
    //   - `/NODEFAULTLIB`         — don't pull msvcrt/vcruntime/ucrt; the only
    //                               imports are kernel32 + ntdll (named via
    //                               `#[link]` on the externs).
    //
    // (`-Cforce-unwind-tables=no` would drop `.pdata`, but the
    // `*-windows-msvc` target spec sets `requires_uwtable: true` so rustc
    // rejects it. The section is ~3 KiB; not worth a custom target JSON.)
    const { CARGO_ENCODED_RUSTFLAGS: _, ...shimEnv } = env;
    shimEnv.CARGO_ENCODED_RUSTFLAGS = [
      // `panic = "immediate-abort"` is the new (nightly ≥ 2025-12) spelling of
      // the old `-Zbuild-std-features=panic_immediate_abort`: every panic call
      // (incl. core::fmt-carrying assert/unreachable/unwrap) compiles to a
      // bare trap with no `Arguments` payload.
      "-Zunstable-options",
      "-Cpanic=immediate-abort",
      "-Clink-arg=/ENTRY:shim_main",
      "-Clink-arg=/SUBSYSTEM:CONSOLE",
      "-Clink-arg=/NODEFAULTLIB",
      "-Clink-arg=kernel32.lib",
      "-Clink-arg=ntdll.lib",
      // Cross-compiling from a unix host: this is the only cargo-driven link
      // of a *target* artifact, and the linker is lld-link (no MSVC install),
      // so point it at the xwin splat for the kernel32/ntdll import libs.
      ...(cfg.winsysroot !== undefined ? [`-Clink-arg=/winsysroot:${cfg.winsysroot}`] : []),
    ].join("\x1f");
    // Declared output = per-build-dir stamp; the shared source-tree exe is an
    // implicit INPUT (see the rust_shim rule comment for why). The exe must
    // exist before ninja evaluates the graph — pre-create an empty
    // placeholder the same way `src/install/build.rs` does for bare
    // `cargo check`, so a fresh checkout doesn't error on a missing input.
    if (!existsSync(shimDest)) {
      mkdirSync(dirname(shimDest), { recursive: true });
      writeFileSync(shimDest, "");
    }
    const shimStamp = resolve(targetDir, triple, "shim", "bun_shim_impl.stamp");
    n.build({
      outputs: [shimStamp],
      rule: "rust_shim",
      inputs: [],
      // Same staleness signal as the main build (any .rs / Cargo.toml change
      // re-invokes; cargo's own fingerprinting decides what actually
      // recompiles). vendorStamps order the lol-html fetch first — the shim
      // crate doesn't depend on lol-html, but cargo refuses to load the
      // workspace manifest if any path-dep's `Cargo.toml` is missing.
      // shimDest: rebuilt when a sibling build dir (other arch/profile)
      // overwrote the shared exe.
      implicitInputs: [cfg.cargo, metadataShim, ...inputs.rustSources, ...inputs.vendorStamps, shimDest],
      vars: {
        cwd: cfg.cwd,
        args: quoteArgs(shimArgs, hostWin),
        shim_src: quote(shimSrc, hostWin),
        shim_dest: quote(shimDest, hostWin),
        env: Object.entries(shimEnv)
          .map(([k, v]) => `--env=${k}=${quote(v, hostWin)}`)
          .join(" "),
      },
    });
    n.phony("bun-shim", [shimStamp]);
    shimInputs.push(shimStamp);
  }

  // ─── Emit build node ───
  // When the toolchain is rustup-managed and pinned, route through
  // `rust_build_cross`, which does `rustup toolchain install --force ...`
  // before cargo. That makes the first build after a `rust-toolchain.toml`
  // channel bump (and a partially auto-installed toolchain) self-heal —
  // see the rule comment above. Tier 1/2 also pass `--target <triple>` so
  // the prebuilt `rust-std` for the cross triple is installed; Tier 3 omits
  // it (no prebuilt — cargo gets `-Zbuild-std` instead) and just gets
  // `rust-src`. Local builds without rustup, or without a pinned channel,
  // fall back to plain `rust_build` and trust whatever toolchain `cfg.cargo`
  // resolves to.
  const useCrossRule = findRustup(cfg) !== undefined && cfg.rustToolchain !== undefined;
  n.build({
    outputs: [lib],
    rule: useCrossRule ? "rust_build_cross" : "rust_build",
    inputs: [],
    // Cargo binary itself + every .rs/Cargo.toml so editing one re-invokes
    // (cargo's own fingerprinting then decides what to actually recompile).
    // Codegen `.rs` outputs are side effects of edges in `codegenInputs`,
    // so depending on those orders the codegen step before cargo without
    // ninja needing to know the `.rs` paths. vendorStamps orders the
    // lol-html source fetch before cargo resolves the path dep.
    implicitInputs: [
      cfg.cargo,
      metadataShim,
      ...inputs.rustSources,
      ...inputs.codegenInputs,
      ...inputs.vendorStamps,
      ...shimInputs,
    ],
    orderOnlyInputs: inputs.codegenOrderOnly,
    vars: {
      cwd: cfg.cwd,
      args: quoteArgs(args, hostWin),
      ...(useCrossRule ? { rust_target_arg: tier3 ? "" : `--target ${triple}` } : {}),
      label: `${cfg.libPrefix}bun_rust${cfg.libSuffix}`,
      env: envArgs,
    },
  });
  n.phony("bun-rust", [lib]);
  n.blank();

  return [lib];
}

/**
 * Link inputs for the Rust side of the binary.
 *
 * On ELF cross-language LTO targets the fat Rust bitcode member can't go
 * into the link as-is: it has no per-module summary, so lld reads it as
 * EnableSplitLTOUnit=0 while every clang-produced full-LTO object (ours,
 * the deps', the WebKit -lto prebuilts') says 1, and the link aborts with
 * "inconsistent LTO Unit splitting". rustc has no way to emit a regular-LTO
 * summary (clang hardcodes one in shouldEmitRegularLTOSummary()), so a
 * build step rewrites the bitcode with rustc's own LLVM tools — see
 * rust-lto-fix-cli.ts and the `rustc-no-regular-lto-summary` workaround
 * entry.
 *
 * Returns [fixed bitcode .o, original .a]: the .o defines every Rust symbol
 * (so the archive's bitcode member is never pulled), and the archive still
 * supplies its native members (compiler_builtins). On every other config
 * this is the identity function.
 */
export function rustLtoLinkInputs(n: Ninja, cfg: Config, rustObjects: string[]): string[] {
  const rustLib = rustObjects[0];
  if (!cfg.crossLangLto || cfg.darwin || cfg.windows || rustLib === undefined) return rustObjects;
  assert(
    cfg.rustSysroot !== undefined && cfg.host.rustTriple !== undefined,
    "ELF cross-language LTO needs rustc's sysroot to locate its LLVM tools (llvm-link/opt) for the regular-LTO summary fix-up, but rustc wasn't found",
    { hint: "Install the pinned rust toolchain (rustup show active-toolchain), or build with --lto=off" },
  );
  const llvmBin = join(cfg.rustSysroot, "lib", "rustlib", cfg.host.rustTriple, "bin");
  const out = resolve(cfg.buildDir, "bun_rust.lto.o");
  n.build({
    outputs: [out],
    rule: "rust_lto_fix",
    inputs: [rustLib],
    implicitInputs: [rustLtoFixCliPath],
    vars: { llvm_bin: llvmBin, ar: cfg.ar },
  });
  return [out, ...rustObjects];
}

/** `${buildDir}/${exe}.linker-map` — lld's `-Wl,-Map=` output (see flags.ts). */
export function linkerMapPath(cfg: Config): string {
  return join(cfg.buildDir, `${bunExeName(cfg)}.linker-map`);
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
