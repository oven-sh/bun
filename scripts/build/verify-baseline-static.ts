/**
 * `verify-baseline-static` — the static ISA scanner in
 * `scripts/verify-baseline-static/` (its own cargo workspace), built as one
 * more edge of a CI build and uploaded next to the bun zips (ci.ts), so the
 * pipeline's `verify-baseline` step (.buildkite/ci.mjs) downloads it instead
 * of building it.
 *
 * That step runs on a test-fleet image (debian / alpine / win-2019), which
 * carries neither the nightly pinned in `rust-toolchain.toml` nor the
 * scanner's crates: building it there re-downloaded both on every job and
 * failed the step whenever static.rust-lang.org or crates.io did. The build
 * host has already installed the pinned toolchain and fetched bun's own
 * crate graph from crates.io by the time this edge runs, so building it here
 * adds no download source the build didn't already depend on.
 *
 * The scanner only *reads* the binary it checks, so it is built for the host
 * the verify step runs on (`getVerifyBaselineHost()` in ci.mjs), not for
 * bun's own target — see `verifyBaselineStaticTriple()`. Enabled by
 * `cfg.verifyBaselineStatic`; ci.mjs turns it on for exactly the targets it
 * emits a verify-baseline step for.
 */

import { resolve } from "node:path";
import type { Sources } from "../glob-sources.ts";
import type { Config } from "./config.ts";
import { assert } from "./error.ts";
import type { Ninja } from "./ninja.ts";
import { findRustup } from "./rust.ts";
import { quote, quoteArgs } from "./shell.ts";
import { depBuildDir } from "./source.ts";
import { ucrtServicingLibDir } from "./winsysroot.ts";

export const VERIFY_BASELINE_STATIC_NAME = "verify-baseline-static";

/** `scripts/verify-baseline-static/` — the directory holding the scanner's Cargo.toml. */
export function verifyBaselineStaticManifestDir(cfg: Config): string {
  return resolve(cfg.cwd, "scripts", VERIFY_BASELINE_STATIC_NAME);
}

/**
 * Rust triple the scanner is built for: the verify step's host, which
 * ci.mjs keeps on the target's os + arch (the emulated run needs that; the
 * scan itself would work from anywhere).
 *
 * Linux is always `*-unknown-linux-musl`, whatever libc bun itself targets:
 * with `+crt-static` that is one fully static executable that runs on the
 * glibc (debian) host, the alpine host, and the glibc host that scans the
 * android build, and rustc links it from the crt objects + libc.a bundled in
 * its own `rust-std`, so no sysroot is involved — only a linker. The price is
 * that the glibc and android lanes' build hosts install one more `rust-std`
 * (the musl one; the musl and windows lanes already have theirs, the triple
 * being bun's own). Using bun's triple instead would need the glibc sysroot
 * link set up for the gnu lanes and still an exception for android, whose
 * scanner has to run on a debian host.
 */
export function verifyBaselineStaticTriple(cfg: Config): string {
  assert(
    cfg.linux || cfg.windows,
    `--verify-baseline-static=on: the verify-baseline step only exists for linux and windows targets (got os=${cfg.os})`,
    { hint: "needsBaselineVerification() in .buildkite/ci.mjs decides which targets get one." },
  );
  const arch = cfg.x64 ? "x86_64" : "aarch64";
  return cfg.windows ? `${arch}-pc-windows-msvc` : `${arch}-unknown-linux-musl`;
}

/**
 * Where cargo leaves the executable: `<buildDir>/deps/verify-baseline-static/
 * <triple>/release/verify-baseline-static[.exe]`. The scanner runs on the
 * target's OS, so the target's exe suffix is the right one.
 */
export function verifyBaselineStaticExe(cfg: Config): string {
  return resolve(
    depBuildDir(cfg, VERIFY_BASELINE_STATIC_NAME),
    verifyBaselineStaticTriple(cfg),
    "release",
    `${VERIFY_BASELINE_STATIC_NAME}${cfg.exeSuffix}`,
  );
}

export interface VerifyBaselineStaticInvocation {
  /** `cargo build <args>`. */
  args: string[];
  /** Environment the cargo process runs under. */
  env: Record<string, string>;
  triple: string;
  exe: string;
}

/**
 * The cargo command line + environment for the scanner. Pure function of
 * `cfg` (no I/O) so it can be unit-tested; `emitVerifyBaselineStatic()` is
 * the only build-graph caller.
 */
export function verifyBaselineStaticInvocation(cfg: Config): VerifyBaselineStaticInvocation {
  const triple = verifyBaselineStaticTriple(cfg);
  const exe = verifyBaselineStaticExe(cfg);

  // Its own target dir, not bun's `rust-target/`: cargo holds a lock on the
  // target dir for the whole of a build, so sharing one would serialize this
  // behind the minutes-long bun_bin build for no reason.
  const args = [
    "--locked",
    "--release",
    "--target-dir",
    depBuildDir(cfg, VERIFY_BASELINE_STATIC_NAME),
    "--target",
    triple,
  ];

  const env: Record<string, string> = { CARGO_TERM_COLOR: "always" };
  if (cfg.cargoHome !== undefined) env.CARGO_HOME = cfg.cargoHome;
  if (cfg.rustupHome !== undefined) env.RUSTUP_HOME = cfg.rustupHome;
  // Same pin as every other cargo invocation in this build (see rust.ts);
  // this is also the toolchain `dep_cargo_cross` installs the triple's
  // rust-std into.
  if (cfg.rustToolchain !== undefined) env.RUSTUP_TOOLCHAIN = cfg.rustToolchain;

  // The linker is invoked by rustc directly, in the linker's own dialect, so
  // the host's C compiler driver (which the aarch64 build host only has for
  // aarch64) never enters into a foreign-arch link:
  //   - linux: lld in `ld.lld` guise — rustc infers the ld flavor from the
  //     name and hands it its self-contained musl crt objects. `cfg.ld` is
  //     whichever ld.lld the bun link itself uses (clang's, or rustc's
  //     gcc-ld/ wrapper under cross-language LTO); both take the same args.
  //   - windows: `msvcLinker ?? ld`, exactly as rust.ts does for
  //     bun_shim_impl.exe — the gcc-ld/lld-link wrapper `ld` may have been
  //     swapped to cannot be driven by rustc (see `msvcLinker` in config.ts).
  // The env var also overrides the `linker = "clang++"` that the generated
  // repo-root `.cargo/config.toml` (cargo-config.ts) declares for this
  // triple; cargo finds that file from the manifest dir.
  const linker = cfg.windows ? (cfg.msvcLinker ?? cfg.ld) : cfg.ld;
  assert(linker !== "", `--verify-baseline-static=on: no lld was resolved for a ${cfg.os} target on this host`);
  env[`CARGO_TARGET_${triple.toUpperCase().replace(/-/g, "_")}_LINKER`] = linker;

  const rustflags = [
    // Static CRT on both targets: musl's libc.a (its default, made explicit)
    // and libcmt/libucrt on windows (bun itself links /MT), so the artifact
    // runs on the verify host with no vcruntime redistributable or libc
    // version in the picture.
    "-Ctarget-feature=+crt-static",
  ];
  if (cfg.windows) {
    // Same library search setup as the bun.exe link (linkFlags in flags.ts):
    // the serviced UCRT overlay ahead of the xwin splat. Both are undefined
    // on a native windows host, where the VS dev shell's LIB env applies.
    const ucrt = ucrtServicingLibDir(cfg);
    if (ucrt !== undefined) rustflags.push(`-Clink-arg=/libpath:${ucrt}`);
    if (cfg.winsysroot !== undefined) rustflags.push(`-Clink-arg=/winsysroot:${cfg.winsysroot}`);
  }
  if (cfg.ci) rustflags.push(`--remap-path-prefix=${cfg.cwd}=.`);
  // Always set, even though the flags above would be enough reason: setting
  // CARGO_ENCODED_RUSTFLAGS is what stops cargo from applying the
  // `rustflags` of the generated `.cargo/config.toml` — those are
  // `-Clink-arg=-fuse-ld=lld`-style clang driver flags, which lld rejects
  // when it is invoked directly as it is here.
  env.CARGO_ENCODED_RUSTFLAGS = rustflags.join("\x1f");

  return { args, env, triple, exe };
}

/**
 * Emit the cargo edge. Returns the executable path; the caller adds it to the
 * default targets (configure.ts) and ci.ts uploads it after the build.
 *
 * `rustObjects` is bun's own cargo output (`emitRust()`), and this edge is
 * sequenced behind it: both edges begin with `rustup toolchain install` of
 * the same toolchain into the same RUSTUP_HOME, and by the time bun's has
 * finished, this one has at most a `rust-std` to add. It also puts the
 * scanner's ~20s of rustc into the link phase, where cores are idle, rather
 * than on top of the C++ compile. Order-only: the scanner does not depend on
 * bun's contents, so a bun rebuild must not rebuild it.
 */
export function emitVerifyBaselineStatic(n: Ninja, cfg: Config, sources: Sources, rustObjects: string[]): string {
  assert(cfg.cargo !== undefined, "--verify-baseline-static=on requires cargo but no rust toolchain was found", {
    hint: "Install rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
  });
  const { args, env, triple, exe } = verifyBaselineStaticInvocation(cfg);
  const hostWin = cfg.host.os === "windows";

  n.comment(`─── ${VERIFY_BASELINE_STATIC_NAME} (${triple}, for the verify-baseline CI step) ───`);
  n.blank();
  // `dep_cargo_cross` (source.ts) first runs `rustup toolchain install
  // --target <triple>`: the pinned toolchain on a CI build host only has the
  // rust-std of bun's own triple installed (rust.ts's rust_build_cross), and
  // this triple differs from it on the glibc and android lanes. Without
  // rustup there is nothing to install with; the plain rule then trusts the
  // toolchain to have the target already.
  n.build({
    outputs: [exe],
    rule: findRustup(cfg) !== undefined ? "dep_cargo_cross" : "dep_cargo",
    inputs: [],
    // Cargo fingerprints the sources itself; these only decide when ninja
    // re-invokes it. The toolchain pin is an input because a channel bump
    // changes the output without touching any scanner source.
    implicitInputs: [...sources.verifyBaselineStatic, cfg.cargo, resolve(cfg.cwd, "rust-toolchain.toml")],
    orderOnlyInputs: rustObjects,
    vars: {
      name: VERIFY_BASELINE_STATIC_NAME,
      manifestdir: verifyBaselineStaticManifestDir(cfg),
      args: quoteArgs(args, hostWin),
      rust_target: triple,
      env: Object.entries(env)
        .map(([k, v]) => `--env=${k}=${quote(v, hostWin)}`)
        .join(" "),
    },
  });
  n.phony(VERIFY_BASELINE_STATIC_NAME, [exe]);
  n.blank();

  return exe;
}
