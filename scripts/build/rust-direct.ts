/**
 * Direct rustc — the Rust crate graph as first-class ninja edges.
 *
 * Instead of one opaque `cargo build` edge, this reads cargo's
 * `--unit-graph` at configure time and emits one ninja edge per
 * compilation unit (lib / proc-macro / build-script-compile /
 * build-script-run / staticlib). Ninja then schedules rustc invocations
 * in the same `-j` pool as C++ compiles, logs each in `.ninja_log`, and
 * `ninja -t query` works per crate.
 *
 * It is to cargo what `BuildSpec: "direct"` is to nested-cmake.
 *
 * ## Unit kinds and their ninja shapes
 *
 *   lib / rlib  →  rustc … --crate-type lib --emit=dep-info,metadata,link
 *                  output: `<depsDir>/lib<crate>-<meta>.rlib`
 *                  depfile: rustc's own `--emit=dep-info` (.d)
 *   proc-macro  →  rustc … --crate-type proc-macro  (HOST compile)
 *                  output: `<hostDir>/lib<crate>-<meta>.{so,dylib,dll}`
 *   custom-build (mode=build)
 *               →  rustc … --crate-type bin  (HOST compile)
 *                  output: `<hostDir>/build-script-<crate>-<meta>`
 *   custom-build (mode=run-custom-build)
 *               →  buildscript-runner.ts <spec> <exe>
 *                  output: `<bsDir>/<crate>-<meta>.out` (captured stdout)
 *                  depfile: synthesised from `cargo:rerun-if-changed`
 *   staticlib   →  rustc … --crate-type staticlib  (the root: bun_bin)
 *                  output: `libbun_rust.a` — same path the cargo edge wrote.
 *
 * ## What cargo did that we now do
 *
 *   - `-C metadata=` / `-C extra-filename=`: cargo SipHashes
 *     (pkgid, profile, features, deps' metadata, rustc -vV). We don't need
 *     to *match* cargo's hash — only to be unique per unit and stable
 *     across reconfigures. `unitMetadata()` hashes the same input set.
 *   - `--extern name=path`: derived from unit-graph `dependencies[]`
 *     (it gives `extern_crate_name` and the dep unit index).
 *   - Host/target split: unit-graph `platform` is `null` for host units
 *     (proc-macros, build-script compiles, and their transitive deps).
 *     Host units get no `--target`, no target rustflags, `panic=unwind`.
 *   - Build-script env + directive parsing: delegated to the two runner
 *     scripts (`buildscript-runner.ts`, `rustc-runner.ts`) since the
 *     directive values aren't known until build time.
 *   - Source fetch: `--unit-graph` resolves crates.io packages to
 *     `$CARGO_HOME/registry/src/...` paths and downloads them as a side
 *     effect, so by the time configure returns the sources exist. A
 *     `cargo_fetch` edge re-runs on `Cargo.lock` change for the same
 *     reason `dep_fetch` re-runs on a commit bump.
 *
 * ## What this does NOT do (cargo behaviours intentionally dropped)
 *
 *   - **Pipelining.** cargo signals `.rmeta`-ready mid-process so
 *     dependents start typeck while the producer is still in LLVM.
 *     Ninja can't observe a mid-process output; each edge produces both
 *     `.rmeta` and `.rlib`, dependents wait on the `.rlib`. This is the
 *     biggest known fresh-build wall-clock cost vs cargo and the first
 *     thing to revisit (split into `rustc_meta` + `rustc_codegen` edges).
 *   - **`links` metadata propagation** (`DEP_<links>_<key>` env on
 *     downstream build scripts). The only `links` crate in the bun_bin
 *     graph is `lol_html_c_api`, whose build.rs is `fn main() {}`.
 *     `rustc-runner.ts` warns loudly on any unhandled directive so a
 *     new dep that needs this surfaces.
 *   - **The Windows .bin/ shim PE** (a freestanding `#![no_std]` build
 *     with its own profile/rustflags) is still built via the cargo
 *     `rust_shim` rule.
 *
 * Gated behind `cfg.rustDirect`; the cargo edge in `rust.ts` is the
 * default and the fallback.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Config } from "./config.ts";
import { BuildError, assert } from "./error.ts";
import type { Ninja } from "./ninja.ts";
import { type RustBuildInputs, rustLibPath, rustTarget } from "./rust.ts";
import { quote } from "./shell.ts";

// ───────────────────────────────────────────────────────────────────────────
// unit-graph types (the subset we read)
// ───────────────────────────────────────────────────────────────────────────

interface UnitGraph {
  version: number;
  units: Unit[];
  roots: number[];
}

interface Unit {
  pkg_id: string;
  target: {
    kind: string[];
    crate_types: string[];
    name: string;
    src_path: string;
    edition: string;
  };
  profile: {
    name: string;
    opt_level: string;
    lto: string;
    codegen_units: number | null;
    debuginfo: number | null;
    debug_assertions: boolean;
    overflow_checks: boolean;
    panic: "unwind" | "abort";
    /** cargo enables incremental for workspace crates only — externals/std are `false`. */
    incremental: boolean;
  };
  /** Target triple, or null for host (proc-macro / build-script compile). */
  platform: string | null;
  mode: "build" | "run-custom-build";
  features: string[];
  /** True for the `-Zbuild-std` sysroot crates (core/alloc/std/…). */
  is_std: boolean;
  dependencies: {
    index: number;
    extern_crate_name: string;
    /** `--extern noprelude:` — set on the implicit std/core/alloc deps. */
    noprelude: boolean;
    /** `--extern nounused:` — suppress unused-crate-dependency lint. */
    nounused: boolean;
  }[];
}

/** `cargo metadata` package — for `links`, manifest path, version. */
interface MetaPkg {
  id: string;
  name: string;
  version: string;
  links: string | null;
  manifest_path: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Paths
// ───────────────────────────────────────────────────────────────────────────

const runnerPath = resolve(import.meta.dirname, "rustc-runner.ts");
const bsRunnerPath = resolve(import.meta.dirname, "buildscript-runner.ts");

interface Layout {
  /** `<buildDir>/rust` — root of all direct-rustc outputs. */
  root: string;
  /** Target `.rlib`s go here; also the `-L dependency=` dir. */
  deps: string;
  /** Host `.rlib`/proc-macro `.so`/build-script exes. */
  host: string;
  /** `<root>/bs/<name>-<meta>/` — per-buildscript OUT_DIR + captured stdout. */
  bs: string;
  /** Stamp file the `cargo_fetch` edge writes. */
  fetchStamp: string;
}

function layout(cfg: Config): Layout {
  const root = resolve(cfg.buildDir, "rust");
  return {
    root,
    deps: resolve(root, "deps"),
    host: resolve(root, "host"),
    bs: resolve(root, "bs"),
    fetchStamp: resolve(root, ".fetch-stamp"),
  };
}

/** Host proc-macro dynamic-library suffix. */
function hostDylibSuffix(cfg: Config): string {
  switch (cfg.host.os) {
    case "darwin":
      return ".dylib";
    case "windows":
      return ".dll";
    default:
      return ".so";
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Resolution — one Resolved per unit
// ───────────────────────────────────────────────────────────────────────────

interface Resolved {
  unit: Unit;
  pkg: MetaPkg;
  /** `target.name` with `-` → `_` (rustc's crate-name convention). */
  crateName: string;
  /** 16-hex-char metadata, also the `-C extra-filename=` suffix. */
  meta: string;
  /** True for proc-macros, build-script compiles, and their dep closure. */
  isHost: boolean;
  /** True for the `-Zbuild-std` sysroot crates (core/alloc/std/…). */
  isStd: boolean;
  /** True when `manifest_path` is under `cfg.cwd` (workspace + lol-html). */
  isLocal: boolean;
  /** Primary ninja output (the `.rlib`/`.so`/exe/stdout-capture). */
  output: string;
  /** Secondary outputs (`.rmeta`, depfile). */
  implicitOutputs: string[];
  /** `.d` depfile path (rustc's, or synthesised for build-script-run). */
  depfile: string;
  /** Per-buildscript OUT_DIR + captured-stdout, when this unit is `run-custom-build`. */
  bsOutDir: string | undefined;
}

/**
 * Stable per-unit metadata hash. Inputs mirror cargo's `compute_metadata`:
 * the symbol-mangling hash must differ whenever ABI could differ, so
 * (pkg, features, profile, host/target, target-triple, rustc identity) all
 * go in. Dep metadata is folded in so a feature change on a dep changes
 * every downstream symbol — same closure property cargo has.
 */
function unitMetadata(u: Unit, depMetas: string[], rustcFingerprint: string): string {
  const h = createHash("sha256");
  h.update(u.pkg_id);
  h.update("\0");
  h.update(u.target.kind.join(","));
  h.update("\0");
  h.update(u.mode);
  h.update("\0");
  h.update(u.platform ?? "host");
  h.update("\0");
  h.update(u.features.join(","));
  h.update("\0");
  h.update(u.profile.name);
  h.update(u.profile.opt_level);
  h.update(u.profile.panic);
  h.update(String(u.profile.debug_assertions));
  h.update("\0");
  for (const m of [...depMetas].sort()) h.update(m);
  h.update("\0");
  h.update(rustcFingerprint);
  return h.digest("hex").slice(0, 16);
}

/**
 * Run `cargo build --unit-graph` + `cargo metadata` and resolve every unit
 * to a `Resolved`. Topologically processes (dep metas feed into unit meta).
 *
 * The unit-graph query also fetches crates.io sources into
 * `$CARGO_HOME/registry/src/` as a side effect, so `target.src_path` is
 * valid by the time we return.
 */
function resolveUnits(cfg: Config, vendorStamps: string[]): { resolved: Resolved[]; roots: number[] } {
  assert(cfg.cargo !== undefined && cfg.rustc !== undefined, "rustDirect requires cargo + rustc", {
    hint: "Install rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
  });
  // unit-graph requires every path-dep manifest to exist; lol-html lives in
  // vendor/ and is fetched by a ninja edge in the normal flow. Configure is
  // the wrong place for a network fetch, so refuse with the fix.
  assert(
    vendorStamps.length === 0 || vendorStamps.every(s => existsSync(s)),
    "rustDirect: vendored Rust path-dep not fetched yet",
    { hint: "ninja -C build/<profile> clone-lolhtml  (or run once without --rust-direct)" },
  );

  const triple = rustTarget(cfg);
  const env = {
    ...process.env,
    ...(cfg.cargoHome ? { CARGO_HOME: cfg.cargoHome } : {}),
    ...(cfg.rustupHome ? { RUSTUP_HOME: cfg.rustupHome } : {}),
    ...(cfg.rustToolchain ? { RUSTUP_TOOLCHAIN: cfg.rustToolchain } : {}),
  };
  const profile = cfg.buildType === "Debug" ? "dev" : "release";
  const tier3 = triple === "aarch64-unknown-freebsd";
  // Same predicate as the cargo edge (rust.ts): rebuild std from source so it
  // sees the same `-Ctarget-cpu` / `-Zsanitizer` / cross-lang LTO bitcode
  // shape as the workspace crates. With this, the std/core/alloc/… units
  // appear in the unit-graph and every dependent gets explicit
  // `--extern noprelude:core=…` instead of the sysroot prebuilt.
  const buildStd = tier3 || cfg.release || cfg.asan;

  const ugArgs = [
    "build",
    "-p",
    "bun_bin",
    "--lib",
    "--target",
    triple,
    "--profile",
    profile,
    "-Zunstable-options",
    "--unit-graph",
  ];
  if (buildStd) ugArgs.push("-Zbuild-std=core,alloc,std,proc_macro,panic_abort");
  const ug = spawnSync(cfg.cargo, ugArgs, { cwd: cfg.cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (ug.status !== 0) {
    throw new BuildError("cargo --unit-graph failed", { cause: ug.stderr });
  }
  const graph: UnitGraph = JSON.parse(ug.stdout);
  assert(graph.version === 1, `unsupported unit-graph version ${graph.version}`);

  const md = spawnSync(cfg.cargo, ["metadata", "--format-version", "1", "--filter-platform", triple], {
    cwd: cfg.cwd,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (md.status !== 0) throw new BuildError("cargo metadata failed", { cause: md.stderr });
  const pkgs = new Map<string, MetaPkg>();
  for (const p of JSON.parse(md.stdout).packages as MetaPkg[]) pkgs.set(p.id, p);

  // `-Zbuild-std` units aren't in `cargo metadata` — std is its own workspace
  // under `lib/rustlib/src/rust/`. Synthesise their MetaPkg from pkg_id +
  // src_path. pkg_id is one of
  //   path+file:///…/library/core#0.0.0
  //   registry+https://…/crates.io-index#addr2line@0.25.1
  // and src_path is `<pkgdir>/src/lib.rs` (or `build.rs` for custom-build),
  // so the manifest is one or two dirs up.
  if (buildStd) {
    for (const u of graph.units) {
      if (!u.is_std || pkgs.has(u.pkg_id)) continue;
      const m = u.pkg_id.match(/#(?:([^@]+)@)?([\d][^#]*)$/);
      assert(m, `unparseable std pkg_id: ${u.pkg_id}`);
      const pathName = u.pkg_id
        .match(/^path\+file:\/\/(.+?)#/)?.[1]
        ?.split("/")
        .pop();
      const srcDir = dirname(u.target.src_path);
      const manifest =
        u.target.kind[0] === "custom-build"
          ? resolve(srcDir, "Cargo.toml") // build.rs is at <pkgdir>/build.rs
          : resolve(srcDir, "..", "Cargo.toml"); // lib.rs is at <pkgdir>/src/lib.rs
      pkgs.set(u.pkg_id, {
        id: u.pkg_id,
        name: m[1] ?? pathName ?? u.target.name,
        version: m[2]!,
        links: null,
        manifest_path: manifest,
      });
    }
  }

  // rustc identity — folded into every metadata hash so a toolchain bump
  // changes every symbol (matches cargo).
  const vv = spawnSync(cfg.rustc, ["-vV"], { env, encoding: "utf8" }).stdout ?? "";
  const rustcFingerprint = createHash("sha256").update(vv).digest("hex").slice(0, 16);

  const lay = layout(cfg);
  const dylib = hostDylibSuffix(cfg);
  const resolved: (Resolved | undefined)[] = new Array(graph.units.length);

  // Topo-resolve: each unit's meta depends on its deps' metas.
  function res(i: number): Resolved {
    const cached = resolved[i];
    if (cached) return cached;
    const u = graph.units[i]!;
    const pkg = pkgs.get(u.pkg_id);
    assert(pkg !== undefined, `unit ${u.pkg_id} not in cargo metadata`);
    const depMetas = u.dependencies.map(d => res(d.index).meta);
    const meta = unitMetadata(u, depMetas, rustcFingerprint);
    const isHost = u.platform === null;
    const dir = isHost ? lay.host : lay.deps;
    const crateName = u.target.name.replace(/-/g, "_");
    const kind = u.target.kind[0]!;

    let output: string;
    let implicitOutputs: string[] = [];
    let depfile: string;
    let bsOutDir: string | undefined;

    if (u.mode === "run-custom-build") {
      const base = resolve(lay.bs, `${pkg.name}-${meta}`);
      output = `${base}.out`;
      depfile = `${base}.d`;
      bsOutDir = `${base}.outdir`;
    } else if (kind === "custom-build") {
      // rustc names a bin `<crate_name><extra_filename>`; crate_name is fixed
      // at `build_script_build`, the per-unit meta keeps them apart.
      output = resolve(lay.host, `build_script_build-${meta}${cfg.host.exeSuffix}`);
      depfile = `${output}.d`;
    } else if (kind === "proc-macro") {
      // Windows proc-macro dylibs have no `lib` prefix; unix do.
      const stem = cfg.host.os === "windows" ? `${crateName}-${meta}` : `lib${crateName}-${meta}`;
      output = resolve(lay.host, `${stem}${dylib}`);
      depfile = `${output}.d`;
    } else if (kind === "staticlib") {
      // Same path the cargo edge wrote so the link step / link-only CI mode
      // see no difference. rustc with `-o <path>` writes the `.d` alongside.
      output = rustLibPath(cfg);
      depfile = `${output}.d`;
    } else {
      // lib / rlib
      output = resolve(dir, `lib${crateName}-${meta}.rlib`);
      implicitOutputs = [resolve(dir, `lib${crateName}-${meta}.rmeta`)];
      depfile = `${output}.d`;
    }

    const isLocal = pkg.manifest_path.startsWith(cfg.cwd + "/") || pkg.manifest_path.startsWith(cfg.cwd + "\\");
    const r: Resolved = {
      unit: u,
      pkg,
      crateName,
      meta,
      isHost,
      isStd: u.is_std,
      isLocal,
      output,
      implicitOutputs,
      depfile,
      bsOutDir,
    };
    resolved[i] = r;
    return r;
  }
  for (let i = 0; i < graph.units.length; i++) res(i);

  return { resolved: resolved as Resolved[], roots: graph.roots };
}

// ───────────────────────────────────────────────────────────────────────────
// rustc argv assembly
// ───────────────────────────────────────────────────────────────────────────

/**
 * Target rustflags — the same set the cargo edge passes via
 * `CARGO_ENCODED_RUSTFLAGS`. Computed here (not shared with rust.ts) because
 * the cargo path encodes them as one env string while we splice them into
 * each unit's argv. Kept in lockstep with rust.ts; see #8 in
 * docs/project/rust-build-integrations.md for the eventual single-table fix.
 */
function targetRustflags(cfg: Config): string[] {
  const f: string[] = [];
  if ((cfg.linux && cfg.abi !== "android") || cfg.freebsd) f.push("-Crelocation-model=static");
  f.push("-Cforce-frame-pointers=yes");
  f.push("-Cllvm-args=-addrsig");
  const cpu = cfg.x64 ? (cfg.baseline ? "nehalem" : "haswell") : cfg.darwin ? "apple-m1" : "cortex-a72";
  f.push(`-Ctarget-cpu=${cpu}`);
  f.push("--check-cfg=cfg(bun_asan)");
  if (cfg.asan) f.push("-Zsanitizer=address", "--cfg=bun_asan");
  f.push("--check-cfg=cfg(bun_codegen_embed)");
  if (!cfg.debug) f.push("--cfg=bun_codegen_embed");
  if (cfg.release && !cfg.assertions) f.push("-Zlocation-detail=none");
  if (!cfg.windows && cfg.pgoGenerate) f.push(`-Cprofile-generate=${cfg.pgoGenerate}`);
  if (!cfg.windows && cfg.pgoUse) f.push(`-Cprofile-use=${cfg.pgoUse}`);
  if (cfg.crossLangLto) f.push("-Clinker-plugin-lto", "-Cembed-bitcode=yes", "-Zsplit-lto-unit");
  return f;
}

/** `[workspace.lints]` → rustc flags. Read from the root manifest at configure time. */
function workspaceLintFlags(cfg: Config): string[] {
  // The lint table is small and stable; parse it out of the manifest rather
  // than re-spawning `cargo metadata` (which doesn't expose lints anyway).
  const toml = readFileSync(resolve(cfg.cwd, "Cargo.toml"), "utf8");
  const flags: string[] = [];
  // [workspace.lints.rust] / [workspace.lints.clippy] entries are
  // `name = "level"` or `name = { level = "...", check-cfg = [...] }`.
  for (const grp of ["rust", "clippy"]) {
    const sect = toml.match(new RegExp(`\\[workspace\\.lints\\.${grp}\\]([^\\[]*)`));
    if (!sect) continue;
    for (const line of sect[1]!.split("\n")) {
      const kv = line.match(/^\s*([A-Za-z_][\w-]*)\s*=\s*"(allow|warn|deny|forbid)"/);
      if (kv) flags.push(`--${kv[2]}=${grp === "clippy" ? "clippy::" : ""}${kv[1]}`);
      const cc = line.match(/check-cfg\s*=\s*\[([^\]]*)\]/);
      if (cc) for (const m of cc[1]!.matchAll(/'([^']+)'|"([^"]+)"/g)) flags.push("--check-cfg", m[1] ?? m[2]!);
    }
  }
  return flags;
}

/**
 * Per-crate `-Zthreads` from the previous build's `.ninja_log`. The
 * critical-path crates run alone at the tail with idle cores around them, so
 * giving them a frontend thread pool shortens the path; small crates stay at
 * 1 so N concurrent compiles don't oversubscribe. First build (no log)
 * returns 1 for everything.
 *
 * The cutoffs and thread counts are heuristic — tuned against the timings in
 * the file header on a 32-core box. Revisit if the crate-size distribution
 * shifts.
 */
function frontendThreads(cfg: Config, lay: Layout): Map<string, number> {
  const m = new Map<string, number>();
  let log: string;
  try {
    log = readFileSync(resolve(cfg.buildDir, ".ninja_log"), "utf8");
  } catch {
    return m;
  }
  // .ninja_log: start<tab>end<tab>mtime<tab>output<tab>hash. Last entry wins.
  const prefix = relative(cfg.buildDir, lay.deps) + "/";
  const ms = new Map<string, number>();
  for (const line of log.split("\n")) {
    const f = line.split("\t");
    const out = f[3];
    if (out === undefined || !out.startsWith(prefix) || !out.endsWith(".rlib")) continue;
    const name = out.slice(prefix.length + 3 /* lib */).split("-")[0]!;
    ms.set(name, Number(f[1]) - Number(f[0]));
  }
  // Only the single longest crate gets a thread pool — it runs alone at the
  // tail with idle cores. Giving the next-tier crates threads too made them
  // contend with each other mid-build (4 crates × 4–8 threads + ~28
  // singletons on 32 cores) and netted zero.
  let longest: [string, number] = ["", 0];
  for (const [name, t] of ms) if (t > longest[1]) longest = [name, t];
  if (longest[1] > 5_000) m.set(longest[0], 8);
  return m;
}

/** Full rustc argv for a `mode == "build"` unit (everything except the runner spec). */
function rustcArgv(
  cfg: Config,
  r: Resolved,
  all: Resolved[],
  lay: Layout,
  lintFlags: string[],
  threads: number,
): string[] {
  const u = r.unit;
  const kind = u.target.kind[0]!;
  // unit-graph gives the resolved crate_types (e.g. std is `rlib`, not `lib`);
  // build.rs compiles as `bin` regardless of its kind label.
  const crateType = kind === "custom-build" ? "bin" : u.target.crate_types[0]!;
  const isBin = crateType === "bin";

  const argv: string[] = [
    "--crate-name",
    isBin ? "build_script_build" : r.crateName,
    `--edition=${u.target.edition}`,
    u.target.src_path,
    "--crate-type",
    crateType,
    // cargo runs rustc with `cwd = workspace_root` and passes `src/…` relative
    // paths, so `file!()` / `core::panic::Location` / DWARF strings read
    // `src/jsc/JSValue.rs`, not the build machine's absolute path. We can't do
    // the same — the `.d` depfile would then hold cwd-relative paths and
    // ninja resolves those buildDir-relative — so remap instead. rustc
    // explicitly excludes `--emit=dep-info` from remapping (the depfile keeps
    // real paths) while `file!()`/debuginfo get the prefix stripped.
    `--remap-path-prefix=${cfg.cwd}/=`,
    "--emit=dep-info,link" + (crateType === "lib" || crateType === "rlib" ? ",metadata" : ""),
    "-C",
    `metadata=${r.meta}`,
    "-C",
    `extra-filename=-${r.meta}`,
    "-L",
    `dependency=${r.isHost ? lay.host : lay.deps}`,
    "--check-cfg=cfg(docsrs,test)",
    `--check-cfg=cfg(feature, values(${u.features.map(f => JSON.stringify(f)).join(", ")}))`,
    "--cap-lints",
    r.isLocal ? "warn" : "allow",
  ];

  // staticlib gets `-o` (exact path = rustLibPath, no extra-filename suffix);
  // everything else gets `--out-dir` and rustc derives the filename from
  // crate-name + extra-filename. `-o` with multiple `--emit`s warns.
  if (crateType === "staticlib") {
    argv.splice(argv.indexOf("--emit=dep-info,link"), 1, "--emit=link");
    argv.push("-o", r.output, "--emit=dep-info=" + r.depfile);
  } else {
    argv.push("--out-dir", dirname(r.output));
  }

  // Profile → codegen flags. Read from the unit (cargo already resolved
  // `[profile.*]` inheritance and host/target overrides into here).
  // Profile → codegen flags. Match cargo: only pass when the value differs
  // from rustc's default, so the argv (and thus ninja's command-hash) is the
  // same shape cargo produces. rustc defaults: opt-level=0; debug-assertions
  // and overflow-checks track opt-level (on at 0, off otherwise).
  const optDefault = u.profile.opt_level === "0";
  if (!optDefault) argv.push("-C", `opt-level=${u.profile.opt_level}`);
  if (u.profile.panic !== "unwind") argv.push("-C", `panic=${u.profile.panic}`);
  if (u.profile.debuginfo !== null) argv.push("-C", `debuginfo=${u.profile.debuginfo}`);
  if (u.profile.codegen_units !== null) argv.push("-C", `codegen-units=${u.profile.codegen_units}`);
  if (u.profile.debug_assertions !== optDefault) {
    argv.push("-C", `debug-assertions=${u.profile.debug_assertions ? "on" : "off"}`);
  }
  if (u.profile.overflow_checks !== u.profile.debug_assertions) {
    argv.push("-C", `overflow-checks=${u.profile.overflow_checks ? "on" : "off"}`);
  }
  if (u.profile.lto !== "false" && !r.isHost) argv.push("-C", `lto=${u.profile.lto}`);
  argv.push("-C", "embed-bitcode=no");
  // rustc's own intra-crate incremental cache. cargo enables it for workspace
  // crates only (`u.profile.incremental`); externals/std don't get it. With
  // `-C incremental`, codegen-units defaults to 256 (vs 16 without) — under
  // ASAN that's ~16× more per-CGU global-registration overhead, which is why
  // applying it to externals diverges from cargo's `.text` size.
  if (u.profile.incremental && crateType !== "staticlib") {
    argv.push("-C", `incremental=${resolve(lay.root, "incremental", `${r.crateName}-${r.meta}`)}`);
  }

  for (const f of u.features) argv.push("--cfg", `feature="${f}"`);

  // Parallel frontend. The bottleneck crates run alone at the tail of the
  // critical path with idle cores around them; let those rustcs use a thread
  // pool. Threshold-driven from `.ninja_log` so the first build (no log)
  // and small crates stay at 1 — N concurrent crates × T threads each
  // oversubscribing 32 cores is exactly the two-scheduler problem direct
  // mode exists to avoid.
  argv.push(`-Zthreads=${threads}`);

  // Target units get `--target` + the rustflags set; host units (proc-macros,
  // build-script bins, and their dep closure) compile native.
  if (!r.isHost) {
    argv.push("--target", rustTarget(cfg));
    // Host deps dir on the search path too: a target lib can depend on a
    // proc-macro `.so` (which is host) — `--extern` names it, `-L` finds it.
    argv.push("-L", `dependency=${lay.host}`);
    argv.push(...targetRustflags(cfg));
  }
  // Linker for any unit rustc actually links (proc-macro dylibs, build-script
  // bins). lib/rlib have no link step. The staticlib has no link either —
  // rustc archives upstream rlibs into it.
  if (crateType === "proc-macro" || crateType === "bin") {
    argv.push("-C", `linker=${cfg.host.os === "windows" ? (cfg.msvcLinker ?? cfg.ld) : cfg.cxx}`);
    if (cfg.host.os !== "windows") argv.push("-C", "link-arg=-fuse-ld=lld");
  }
  // proc-macros (and host libs that re-export from it, e.g. proc-macro2 with
  // the `proc-macro` feature) need the compiler-provided sysroot crate.
  if (crateType === "proc-macro" || (r.isHost && u.features.includes("proc-macro"))) {
    argv.push("--extern", "proc_macro");
  }

  // Workspace lints apply to workspace members only (cargo's behaviour).
  if (r.isLocal && !r.pkg.manifest_path.includes("/vendor/")) {
    argv.push(...lintFlags);
  }
  // `-Zbuild-std` sysroot crates: `#[unstable]` items are pervasive and
  // gated; this is what lets them compile outside the rustc bootstrap.
  if (r.isStd) {
    argv.push("-Z", "force-unstable-if-unmarked");
  }

  // --extern per dependency. Build-script-run deps are not externs (they're
  // ordering edges that surface as the runner's `buildScriptOutput`). The
  // `noprelude,nounused:` prefix is how rustc knows to use the locally-built
  // std rlib instead of the sysroot's, without auto-importing its prelude.
  let needsUnstable = false;
  for (const d of u.dependencies) {
    const dep = all[d.index]!;
    if (dep.unit.mode === "run-custom-build") continue;
    const opts = [d.noprelude && "noprelude", d.nounused && "nounused"].filter(Boolean).join(",");
    if (opts) needsUnstable = true;
    argv.push("--extern", `${opts ? `${opts}:` : ""}${d.extern_crate_name}=${dep.output}`);
  }
  // `--extern <opts>:` is unstable; `force-unstable-if-unmarked` already
  // covers the std crates, but the *dependents* (every target crate under
  // `-Zbuild-std`) also need the gate.
  if (needsUnstable && !r.isStd) argv.push("-Z", "unstable-options");

  return argv;
}

// ───────────────────────────────────────────────────────────────────────────
// Ninja emission
// ───────────────────────────────────────────────────────────────────────────

export function registerRustDirectRules(n: Ninja, cfg: Config): void {
  if (!cfg.rustDirect) return;
  assert(cfg.rustc !== undefined && cfg.cargo !== undefined, "rustDirect requires rustc + cargo");
  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);
  const js = cfg.jsRuntime;

  // One rustc invocation. The runner injects build-script directives + CARGO_*
  // env, then execs rustc. `$spec` is a JSON literal; `$args` is the rustc
  // argv. depfile is rustc's own `--emit=dep-info` output (gcc-format with
  // `# env-dep:` lines, which ninja's parser ignores — env tracking is
  // covered by the configure-time hash instead).
  n.rule("rustc", {
    command: `${js} ${q(runnerPath)} $spec -- ${q(cfg.rustc)} $args`,
    description: "rustc $crate",
    depfile: "$depfile",
    deps: "gcc",
  });

  // Compile + run a build script. Two edges: `rustc` compiles it (host bin),
  // this rule runs it via the runner. Restat: most scripts are deterministic
  // and the captured `.out` is content-stable, so downstream rustc edges
  // prune when the directives didn't change.
  n.rule("rustc_buildscript", {
    command: `${js} ${q(bsRunnerPath)} $spec $in`,
    description: "build.rs $crate",
    depfile: "$depfile",
    deps: "gcc",
    restat: true,
  });

  // crates.io fetch. `cargo --unit-graph` at configure time already
  // downloaded everything; this edge re-runs on Cargo.lock change so a
  // dep bump pulls the new tarball before any rustc edge fires.
  const touch = hostWin ? "type nul >" : "touch";
  const fetch = `${q(cfg.cargo)} fetch --locked --manifest-path ${q(resolve(cfg.cwd, "Cargo.toml"))}`;
  n.rule("cargo_fetch", {
    command: hostWin ? `cmd /c "${fetch} && ${touch} $out"` : `${fetch} && ${touch} $out`,
    description: "cargo fetch",
    restat: true,
    pool: "dep",
  });
}

/**
 * `CARGO_CFG_*` map for `target` — what cargo derives from
 * `rustc --print cfg`. Multi-valued keys (target_feature, target_family,
 * target_has_atomic) join with `,` per cargo's convention.
 */
function targetCfgEnv(cfg: Config, target: string): Record<string, string> {
  assert(cfg.rustc !== undefined, "rustDirect requires rustc");
  const out = spawnSync(cfg.rustc, ["--print", "cfg", "--target", target], {
    encoding: "utf8",
    env: cfg.rustToolchain ? { ...process.env, RUSTUP_TOOLCHAIN: cfg.rustToolchain } : process.env,
  });
  assert(out.status === 0, `rustc --print cfg failed for ${target}`, { hint: out.stderr });
  const map: Record<string, string[]> = {};
  for (const line of out.stdout.split("\n")) {
    const kv = line.match(/^(\w+)(?:="(.*)")?$/);
    if (!kv) continue;
    (map[kv[1]!] ??= []).push(kv[2] ?? "");
  }
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) r[k] = v.filter(Boolean).join(",");
  return r;
}

export function emitRustDirect(n: Ninja, cfg: Config, inputs: RustBuildInputs): string[] {
  const lay = layout(cfg);
  const triple = rustTarget(cfg);
  const hostWin = cfg.host.os === "windows";
  const hostTriple = cfg.host.rustTriple;
  assert(hostTriple !== undefined, "rustDirect: host.rustTriple unresolved (rustc -vV failed?)");

  const { resolved, roots } = resolveUnits(cfg, inputs.vendorStamps);
  const lintFlags = workspaceLintFlags(cfg);
  const tCfg = targetCfgEnv(cfg, triple);
  const threads = frontendThreads(cfg, lay);

  n.comment("─── Rust (direct) ───");
  n.blank();

  // Env shared by every runner invocation. Kept minimal — per-unit env
  // (CARGO_PKG_*, OUT_DIR) is in the JSON spec.
  const sharedEnv: Record<string, string> = {
    BUN_CODEGEN_DIR: cfg.codegenDir,
    CC: cfg.cc,
    CXX: cfg.cxx,
    AR: cfg.ar,
  };
  if (cfg.cargoHome) sharedEnv.CARGO_HOME = cfg.cargoHome;
  if (cfg.rustupHome) sharedEnv.RUSTUP_HOME = cfg.rustupHome;
  if (cfg.rustToolchain) sharedEnv.RUSTUP_TOOLCHAIN = cfg.rustToolchain;

  // crates.io fetch — order-only dep of every external-crate edge.
  n.build({
    outputs: [lay.fetchStamp],
    rule: "cargo_fetch",
    inputs: [resolve(cfg.cwd, "Cargo.lock")],
    implicitInputs: [resolve(cfg.cwd, "Cargo.toml"), ...inputs.vendorStamps],
  });

  const rootOutputs: string[] = [];

  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i]!;
    const u = r.unit;
    const isExternal = !r.pkg.manifest_path.startsWith(cfg.cwd);
    // Ordering: external crates wait on fetch; workspace crates wait on
    // codegen (the `include!()`'d generated .rs files) and lol-html fetch.
    const orderOnly = isExternal
      ? [lay.fetchStamp]
      : [...inputs.codegenInputs, ...inputs.codegenOrderOnly, ...inputs.vendorStamps];

    if (u.mode === "run-custom-build") {
      // The dep with `mode == "build"` is the compiled bin to run. With
      // `-Zbuild-std` there may also be `run-custom-build` deps (e.g.
      // compiler_builtins' — `links` metadata propagation); they're ordering
      // edges, not the exe.
      const deps = u.dependencies.map(d => resolved[d.index]!);
      const exeDep = deps.find(d => d.unit.mode === "build");
      assert(exeDep, `run-custom-build ${r.pkg.name} has no compiled-bin dep`);
      const exe = exeDep.output;
      const linksDeps = deps.filter(d => d.unit.mode === "run-custom-build").map(d => d.output);
      const spec = {
        output: r.output,
        depfile: r.depfile,
        outDir: r.bsOutDir!,
        target: triple,
        host: hostTriple,
        manifestDir: dirname(r.pkg.manifest_path),
        links: r.pkg.links ?? undefined,
        pkgName: r.pkg.name,
        pkgVersion: r.pkg.version,
        features: u.features,
        optLevel: u.profile.opt_level,
        debug: u.profile.debug_assertions,
        rustc: cfg.rustc!,
        targetCfg: tCfg,
        extraEnv: sharedEnv,
      };
      n.build({
        outputs: [r.output],
        rule: "rustc_buildscript",
        inputs: [exe],
        implicitInputs: linksDeps,
        orderOnlyInputs: orderOnly,
        vars: {
          crate: r.pkg.name,
          depfile: r.depfile,
          spec: quote(JSON.stringify(spec), hostWin),
        },
      });
      continue;
    }

    // mode == "build": rustc invocation.
    const argv = rustcArgv(cfg, r, resolved, lay, lintFlags, threads.get(r.crateName) ?? 1);
    // Find this unit's run-custom-build dep (if any) — its captured stdout
    // is what rustc-runner reads to inject --cfg/--env.
    const bsDep = u.dependencies.map(d => resolved[d.index]!).find(d => d.unit.mode === "run-custom-build");
    const spec = {
      pkgName: r.pkg.name,
      pkgVersion: r.pkg.version,
      manifestDir: dirname(r.pkg.manifest_path),
      buildScriptOutput: bsDep?.output,
      outDir: bsDep?.bsOutDir,
      extraEnv: sharedEnv,
    };
    const depOutputs = u.dependencies.map(d => resolved[d.index]!.output);
    n.build({
      outputs: [r.output],
      implicitOutputs: r.implicitOutputs,
      rule: "rustc",
      inputs: [u.target.src_path],
      // Dep .rlib/.so/.out files: implicit so a rebuilt dep re-triggers, but
      // not in `$in` (rustc finds them via `--extern`/`-L`).
      implicitInputs: depOutputs,
      orderOnlyInputs: orderOnly,
      vars: {
        crate: r.crateName,
        depfile: r.depfile,
        spec: quote(JSON.stringify(spec), hostWin),
        args: argv.map(a => quote(a, hostWin)).join(" "),
      },
    });

    if (roots.includes(i)) rootOutputs.push(r.output);
  }

  n.phony("bun-rust", rootOutputs);
  n.blank();
  return rootOutputs;
}

export function rustDirectOutputDirs(cfg: Config): string[] {
  const lay = layout(cfg);
  return [lay.deps, lay.host, lay.bs, dirname(rustLibPath(cfg))];
}
