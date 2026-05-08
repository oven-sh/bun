/**
 * Rust build step — cargo as a ninja edge, parallel to `emitZig`.
 *
 * The Rust port lives in the workspace rooted at the repo's `Cargo.toml`;
 * the leaf crate is `src/bun_bin` (`crate-type = ["staticlib"]`). One
 * `cargo build -p bun_bin` produces `libbun_rust.a` containing the entire
 * Rust crate graph plus libstd, with `main` exported `#[no_mangle] extern "C"`
 * — the same role `bun-zig.o` filled.
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
 * step). The staticlib goes into the link's `$in` list at the same position
 * `bun-zig.o` did, between the C++ objects and the dependency archives;
 * crt1.o's undefined `main` plus the C++ side's hundreds of `extern "C"`
 * `Bun__*`/`Zig*` references pull every reachable member, and the release
 * link's `--gc-sections` still DCEs per-function. `rustLinkFlags()` wraps
 * the archive in `--whole-archive` so members that are *only* referenced via
 * the dynamic-list / NAPI surface (no inbound static ref) are retained too.
 */

import { resolve } from "node:path";
import type { Config } from "./config.ts";
import { assert } from "./error.ts";
import type { Ninja } from "./ninja.ts";
import { quote, quoteArgs } from "./shell.ts";
import { streamPath } from "./stream.ts";

// ───────────────────────────────────────────────────────────────────────────
// Target / profile mapping
// ───────────────────────────────────────────────────────────────────────────

/**
 * Rust target triple. Mirrors `zigTarget()` — arch is `x86_64`/`aarch64`,
 * not `x64`/`arm64`.
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

// ───────────────────────────────────────────────────────────────────────────
// Paths
// ───────────────────────────────────────────────────────────────────────────

/** `<buildDir>/rust-target` — sibling of `obj/`, `pch/`, `bun-zig.o`. */
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

// ───────────────────────────────────────────────────────────────────────────
// Ninja rules
// ───────────────────────────────────────────────────────────────────────────

export function registerRustRules(n: Ninja, cfg: Config): void {
  if (cfg.cargo === undefined) return; // emitRust() asserts with a hint
  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);
  const stream = `${cfg.jsRuntime} ${q(streamPath)} rust`;

  // Cargo build for `bun_bin`. Runs from repo root (workspace `Cargo.toml`
  // lives there). Env passed via stream.ts `--env=K=V`.
  //
  // `--console`: cargo has its own progress bar / colour; pool=console gives
  // it the TTY directly (same as `zig_build`). restat: cargo's incremental
  // build doesn't touch the staticlib when nothing changed.
  n.rule("rust_build", {
    command: `${stream} --console --cwd=$cwd $env ${q(cfg.cargo)} build $args`,
    description: "cargo bun_bin → $label",
    pool: "console",
    restat: true,
  });
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
   * effects of the same scripts that produce `CodegenOutputs.zigInputs`, so
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
 * one-element array (same shape as `emitZig`'s return) so the link step
 * can spread it where `zigObjects` went.
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
  const profile = cargoProfile(cfg);
  const lib = rustLibPath(cfg);

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

  // ─── rustflags ───
  // CARGO_ENCODED_RUSTFLAGS: U+001F-separated so multi-arg flags survive.
  // `-C relocation-model` is left at the default (pic) — the Rust objects
  // are PIC-compatible with the no-PIE link, and forcing `static`
  // workspace-wide would break proc-macro dylibs.
  const rustflags: string[] = [];
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
  if (cfg.lto) {
    // Cross-language LTO: emit LLVM bitcode (not machine code) into the .a
    // so the final lld `-flto=full` link sees through Rust↔C++ call edges.
    // `linker-plugin-lto` supersedes Cargo's `[profile.release] lto="fat"`
    // (cargo skips its own LTO pass and defers to the linker), so there's no
    // double-LTO cost.
    //
    // Bitcode-format compatibility: lld must be able to read rustc's bitcode.
    // LLVM bitcode is forward-compatible (newer reads older), so this works
    // when the linker's LLVM ≥ rustc's bundled LLVM. If clang's lld is older
    // than rustc's LLVM and the link fails with "Invalid bitcode version",
    // either bump clang or point `cfg.lld` at rustc's bundled `rust-lld`
    // (`$(rustc --print sysroot)/lib/rustlib/<host>/bin/rust-lld`) — see
    // workarounds.ts for the auto-fallback.
    rustflags.push("-Clinker-plugin-lto");
    rustflags.push("-Cembed-bitcode=yes");
    // Any cdylib/staticlib in the dep graph (lol_html_c_api) gets linked by
    // rustc itself; default `cc` driver picks BFD `/usr/bin/ld` which doesn't
    // understand `-plugin-opt`. Force lld so the bitcode link goes through
    // the same LTO-aware linker our final link uses.
    rustflags.push(`-Clink-arg=-fuse-ld=lld`);
  }

  // ─── Environment ───
  const env: Record<string, string> = {
    CARGO_TERM_COLOR: "always",
    // `include!(concat!(env!("BUN_CODEGEN_DIR"), "/generated_*.rs"))` and
    // `include_bytes!` in `bun_js_parser`/`bun_runtime` resolve against this.
    // Set in cargo's env so it reaches every crate's `rustc` invocation
    // (not just those with a `build.rs` re-export).
    BUN_CODEGEN_DIR: cfg.codegenDir,
  };
  if (cfg.cargoHome !== undefined) env.CARGO_HOME = cfg.cargoHome;
  if (cfg.rustupHome !== undefined) env.RUSTUP_HOME = cfg.rustupHome;
  // Pin the toolchain explicitly. `vendor/` is commonly a symlink shared
  // across worktrees; rustup's directory walk could otherwise resolve a
  // different worktree's `rust-toolchain.toml`.
  if (cfg.rustToolchain !== undefined) env.RUSTUP_TOOLCHAIN = cfg.rustToolchain;
  if (rustflags.length > 0) env.CARGO_ENCODED_RUSTFLAGS = rustflags.join("\x1f");

  // ─── Emit build node ───
  n.build({
    outputs: [lib],
    rule: "rust_build",
    inputs: [],
    // Cargo binary itself + every .rs/Cargo.toml so editing one re-invokes
    // (cargo's own fingerprinting then decides what to actually recompile).
    // Codegen `.rs` outputs are side effects of edges in `codegenInputs`,
    // so depending on those orders the codegen step before cargo without
    // ninja needing to know the `.rs` paths. vendorStamps orders the
    // lol-html source fetch before cargo resolves the path dep.
    implicitInputs: [cfg.cargo, ...inputs.rustSources, ...inputs.codegenInputs, ...inputs.vendorStamps],
    orderOnlyInputs: inputs.codegenOrderOnly,
    vars: {
      cwd: cfg.cwd,
      args: quoteArgs(args, hostWin),
      label: `${cfg.libPrefix}bun_rust${cfg.libSuffix}`,
      env: Object.entries(env)
        .map(([k, v]) => `--env=${k}=${quote(v, hostWin)}`)
        .join(" "),
    },
  });
  n.phony("bun-rust", [lib]);
  n.blank();

  return [lib];
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
