/**
 * Configure-time model of the Rust build: every compilation unit from the plan
 * (`plan.ts`) with its rustc argv, environment, outputs and edges resolved —
 * the data `emit.ts` turns into ninja edges and `run.ts` executes.
 *
 * The rules for turning a cargo unit into a rustc command line are cargo's
 * (`cargo::core::compiler::{build_base_args, build_deps_args, lto,
 * custom_build}`), transcribed; comments name the cargo function where the
 * choice is not obvious. What is deliberately different from cargo:
 *
 * - Layout: `<buildDir>/rust/{host,<triple>}/{deps,build,incremental}` instead
 *   of cargo's `target/` tree; the two per-unit hashes (symbols, file names)
 *   follow cargo's split but are computed here rather than being cargo's values.
 * - Diagnostics: human-readable straight from rustc for units that are not
 *   pipelined; JSON (rendered by `run.ts`) only where the metadata artifact
 *   notification is needed.
 * - No `--cap-lints warn` + `--verbose` (that is cargo `-vv`); dependencies get
 *   `--cap-lints allow` as in a normal cargo build.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { Config } from "../config.ts";
import { assert } from "../error.ts";
import { type BuildScriptOutput, dylibPathVar, envify } from "./cargo-env.ts";
import type { ManifestLints, MetadataPackage, RustPlan, RustcTargetInfo, UnitGraphUnit } from "./plan.ts";

export { envify };
export type { BuildScriptOutput };

export type UnitKind = "lib" | "proc-macro" | "staticlib" | "build-script" | "build-script-run";

/** A dependency edge as rustc sees it. */
export interface UnitDep {
  unit: RustUnit;
  /** `--extern <name>=…`; `-` already mapped to `_` by cargo. */
  externName: string;
  noprelude: boolean;
  nounused: boolean;
  /** cargo `public` dependency (RFC 1977); only meaningful for packages with the public-dependency feature. */
  public: boolean;
}

export interface RustUnit {
  index: number;
  kind: UnitKind;
  pkg: MetadataPackage;
  /** rustc crate name (`-` → `_`). */
  crateName: string;
  /** "host" for build scripts, proc-macros and everything they depend on; the target triple otherwise. */
  platform: "host" | string;
  isStd: boolean;
  /** Workspace member or other path package (vendored crates): gets `[lints]`, incremental, no `--cap-lints`. */
  isLocal: boolean;
  features: string[];
  profile: UnitGraphUnit["profile"];
  edition: string;
  /** cargo `Target::rustc_crate_types`: `lib`, `rlib`, `proc-macro`, `staticlib`, `bin` — passed verbatim. */
  crateTypes: string[];
  srcPath: string;
  deps: UnitDep[];
  /** For lib/staticlib/proc-macro units of a package with a build script: that script's run unit (its `--cfg`s, env and OUT_DIR apply here). */
  buildScript: RustUnit | undefined;
  /**
   * 16 hex digits: `-C extra-filename`, directory and manifest names. Covers everything that changes the output,
   * target rustflags included, so an artifact built with other flags is never picked up under the same name.
   */
  hash: string;
  /**
   * 16 hex digits: `-C metadata` (rustc mixes it into every symbol). Like cargo's `c_metadata` it leaves the
   * rustflags out, so an instrumented and an optimized PGO build — or any two builds differing only in flags — mangle
   * identically; and std crates hash by their path inside the sysroot, not relative to the checkout.
   */
  symbolHash: string;

  // ─── derived paths (absolute) ───
  /** `--out-dir` */
  outDir: string;
  /** The rlib (lib), dylib (proc-macro), archive (staticlib) or executable (build-script); the `output` file for a build-script run. */
  output: string;
  /** lib units only: the `.rmeta`, produced ahead of `output` by the same rustc process. */
  rmeta: string | undefined;
  /** rustc's dep-info, rewritten by run.ts into a depfile for the edge. */
  depInfo: string | undefined;
  /** build-script-run units: `OUT_DIR`. */
  scriptOutDir: string | undefined;
  /** Path of the per-unit manifest `run.ts` reads (argv/env/cwd/…), written at configure. */
  manifestPath: string;
}

export interface RustGraph {
  units: RustUnit[];
  /** The `bun_runtime` staticlib. */
  root: RustUnit;
  /** `<buildDir>/rust` */
  dir: string;
  hostDeps: string;
  targetDeps: string;
  plan: RustPlan;
}

// ───────────────────────────────────────────────────────────────────────────
// Graph construction
// ───────────────────────────────────────────────────────────────────────────

export function buildRustGraph(cfg: Config, plan: RustPlan, targetRustflags: string[]): RustGraph {
  const dir = join(cfg.buildDir, "rust");
  const triple = plan.target.triple;
  const platDir = (platform: string) => join(dir, platform);
  const g = plan.unitGraph;
  assert(g.roots.length === 1, `rust plan: expected one root unit, got ${g.roots.length}`);

  const units: RustUnit[] = g.units.map((u, index): RustUnit => {
    const pkg = plan.packages[u.pkg_id];
    assert(pkg !== undefined, `rust plan: no package for ${u.pkg_id}`);
    assert(
      u.mode === "build" || u.mode === "run-custom-build",
      `rust plan: unit ${index} (${u.target.name}) has mode ${u.mode}; only build graphs are supported`,
    );
    const tkind = u.target.kind[0];
    const kind: UnitKind =
      u.mode === "run-custom-build"
        ? "build-script-run"
        : tkind === "custom-build"
          ? "build-script"
          : tkind === "proc-macro"
            ? "proc-macro"
            : u.target.crate_types.includes("staticlib")
              ? "staticlib"
              : "lib";
    if (kind === "lib") {
      assert(
        u.target.crate_types.every(t => t === "lib" || t === "rlib"),
        `rust plan: unit ${u.target.name} has crate types ${u.target.crate_types}; only rlib libraries, proc-macros and the staticlib root are supported`,
      );
    }
    return {
      index,
      kind,
      pkg,
      crateName: u.target.name.replace(/-/g, "_"),
      platform: u.platform ?? "host",
      isStd: u.is_std === true,
      isLocal: pkg.source === null && u.is_std !== true,
      features: u.features,
      profile: u.profile,
      edition: u.target.edition,
      crateTypes: kind === "build-script" ? ["bin"] : u.target.crate_types,
      srcPath: u.target.src_path,
      deps: [],
      buildScript: undefined,
      hash: "",
      symbolHash: "",
      outDir: "",
      output: "",
      rmeta: undefined,
      depInfo: undefined,
      scriptOutDir: undefined,
      manifestPath: "",
    };
  });

  // Edges. cargo lists the run-custom-build unit among a lib's dependencies (that is how OUT_DIR and the
  // script's cfgs reach it); it is not an `--extern`, so it is split out here.
  g.units.forEach((u, i) => {
    const unit = units[i]!;
    for (const d of u.dependencies) {
      const dep = units[d.index]!;
      if (dep.kind === "build-script-run" && unit.kind !== "build-script-run") {
        assert(unit.buildScript === undefined, `rust plan: ${unit.crateName} has two build scripts`);
        unit.buildScript = dep;
      } else {
        unit.deps.push({
          unit: dep,
          externName: d.extern_crate_name,
          noprelude: d.noprelude,
          nounused: d.nounused === true,
          public: d.public,
        });
      }
    }
  });

  // Hashes, computed topologically over the DAG. `symbolHash` (→ `-C metadata`) must differ wherever two builds
  // of one crate name can meet in a link — host vs target, sysroot std vs build-std std, feature sets — and must
  // *not* differ between builds meant to have identical symbols (PGO generate/use), so it excludes the rustflags.
  // `hash` (→ file names) additionally covers the rustflags. cargo: compute_metadata's c_metadata vs unit_id.
  const packageKey = (unit: RustUnit): string =>
    unit.isStd
      ? relative(plan.rustc.sysroot, unit.pkg.manifest_path)
      : unit.pkg.source === null
        ? relative(plan.workspaceRoot, unit.pkg.manifest_path)
        : unit.pkg.id;
  const digest = (parts: unknown[]): string =>
    createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
  const identity = (unit: RustUnit): unknown[] => {
    const u = g.units[unit.index]!;
    return [
      3, // bump to invalidate every artifact
      packageKey(unit),
      u.target.name,
      u.target.kind,
      u.target.crate_types,
      unit.platform,
      u.mode,
      [...unit.features].sort(),
      u.profile,
      unit.isStd,
      plan.rustc.version,
      plan.rustc.commitHash,
      plan.rustc.host,
    ];
  };
  const hashesOf = (unit: RustUnit): void => {
    if (unit.hash !== "") return;
    for (const d of unit.deps) hashesOf(d.unit);
    if (unit.buildScript !== undefined) hashesOf(unit.buildScript);
    unit.symbolHash = digest([
      ...identity(unit),
      unit.deps.map(d => [d.externName, d.unit.symbolHash]),
      unit.buildScript?.symbolHash ?? null,
    ]);
    unit.hash = digest([
      ...identity(unit),
      unit.platform === "host" ? [] : targetRustflags.filter(f => !f.startsWith("--remap-path-prefix")),
      unit.deps.map(d => [d.externName, d.unit.hash]),
      unit.buildScript?.hash ?? null,
    ]);
  };
  for (const unit of units) hashesOf(unit);

  // Paths. File names come from `rustc --print file-names` for the unit's platform (cargo: TargetInfo::rustc_outputs).
  for (const unit of units) {
    const info: RustcTargetInfo = unit.platform === "host" ? plan.host : plan.target;
    const pdir = platDir(unit.platform);
    const pkgDir = `${unit.pkg.name}-${unit.hash}`;
    unit.manifestPath = join(dir, "units", `${unit.crateName}-${unit.hash}.json`);
    switch (unit.kind) {
      case "lib": {
        const [pre, suf] = info.fileNames.rlib;
        unit.outDir = join(pdir, "deps");
        unit.output = join(unit.outDir, `${pre}${unit.crateName}-${unit.hash}${suf}`);
        unit.rmeta = join(unit.outDir, `lib${unit.crateName}-${unit.hash}.rmeta`);
        unit.depInfo = join(unit.outDir, `${unit.crateName}-${unit.hash}.d`);
        break;
      }
      case "proc-macro": {
        const [pre, suf] = info.fileNames["proc-macro"];
        unit.outDir = join(pdir, "deps");
        unit.output = join(unit.outDir, `${pre}${unit.crateName}-${unit.hash}${suf}`);
        unit.depInfo = join(unit.outDir, `${unit.crateName}-${unit.hash}.d`);
        break;
      }
      case "staticlib": {
        // No extra-filename: the link step and `rustLibPath()` want a fixed name.
        const [pre, suf] = info.fileNames.staticlib;
        unit.outDir = pdir;
        unit.output = join(unit.outDir, `${pre}${unit.crateName}${suf}`);
        unit.depInfo = join(unit.outDir, `${unit.crateName}.d`);
        break;
      }
      case "build-script": {
        const [pre, suf] = info.fileNames.bin;
        unit.outDir = join(pdir, "build", pkgDir);
        unit.output = join(unit.outDir, `${pre}${unit.crateName}-${unit.hash}${suf}`);
        unit.depInfo = join(unit.outDir, `${unit.crateName}-${unit.hash}.d`);
        break;
      }
      case "build-script-run": {
        unit.outDir = join(pdir, "build", pkgDir);
        unit.scriptOutDir = join(unit.outDir, "out");
        // What run.ts writes after parsing the script's stdout: the directives, as JSON. restat'd, so
        // dependents only rebuild when the directives (not merely the run) changed.
        unit.output = join(unit.outDir, "output.json");
        break;
      }
    }
  }

  const root = units[g.roots[0]!]!;
  assert(root.kind === "staticlib", `rust plan: root unit ${root.crateName} is ${root.kind}, expected the staticlib`);
  return { units, root, dir, hostDeps: join(dir, "host", "deps"), targetDeps: join(dir, triple, "deps"), plan };
}

// ───────────────────────────────────────────────────────────────────────────
// Per-unit manifest: what run.ts needs to execute the unit
// ───────────────────────────────────────────────────────────────────────────

/** Written to `unit.manifestPath` at configure; the edge depends on it, so any change here rebuilds the unit. */
export type UnitManifest = RustcUnitManifest | BuildScriptRunManifest;

interface ManifestCommon {
  crateName: string;
  /** The unit's file-name hash; also how run.ts recognizes a process working on this unit. */
  hash: string;
  cwd: string;
  env: Record<string, string>;
  /** The file ninja knows this unit by: rlib (lib), dylib (proc-macro), archive (staticlib), executable (build-script), output.json (build-script-run). */
  output: string;
  /** The ninja depfile run.ts writes for the unit's (first) edge. */
  depfile: string;
  /**
   * The dynamic-library search path for the process (proc-macro dylibs, anything a build script loads): the variable
   * for this host and what to put in front of its inherited value — composed by run.ts at build time so that the
   * user's PATH/LD_LIBRARY_PATH is not frozen into every manifest.
   */
  libraryPath: { variable: string; prepend: string[] };
}

/** A rustc invocation: lib, proc-macro, staticlib or build-script compile. */
export interface RustcUnitManifest extends ManifestCommon {
  kind: "lib" | "proc-macro" | "staticlib" | "build-script";
  rustc: string;
  /** rustc argv without the program. Build-script-derived `-L`/`-l`/`-C link-arg`/`--cfg`/`--check-cfg` and `rustc-env` are added by run.ts. */
  args: string[];
  /** lib units: the `.rmeta` the same rustc produces ahead of `output`. */
  rmeta: string | undefined;
  /** rustc's dep-info output, which run.ts rewrites into `depfile`. */
  depInfo: string;
  /** The package's build-script `output.json`, when the package has one (its directives apply here). */
  buildScriptOutput: string | undefined;
  /** `output.json` of every transitive same-platform dependency with a build script: their `rustc-link-search` paths apply here too (cargo add_native_deps). */
  depBuildScriptOutputs: string[];
}

/** A build-script execution. */
export interface BuildScriptRunManifest extends ManifestCommon {
  kind: "build-script-run";
  script: {
    program: string;
    outDir: string;
    /** `output.json` of each direct dependency with a `links` key → `DEP_<LINKS>_<KEY>` env. */
    linksDeps: { links: string; output: string }[];
    manifestDir: string;
    /** Path package: warnings are shown, and without `rerun-if-*` directives the script reruns when any file of the package changes. */
    local: boolean;
    /**
     * `rerun-if-env-changed`: the variables the script named on its last run, with the values configure saw.
     * Configure runs before every build, so a changed value changes this manifest and reruns the script — cargo's
     * behaviour, minus builds that bypass configure and invoke ninja directly.
     */
    trackedEnv: Record<string, string>;
  };
}

/** `CARGO_PKG_*` / `CARGO_MANIFEST_*` (cargo: `Compilation::fill_env`) — set for rustc and for build scripts alike, empty string when the manifest lacks the field. */
function packageEnv(pkg: MetadataPackage, cargo: string): Record<string, string> {
  const [major = "0", minor = "0", patchPre = "0"] = pkg.version.split(".");
  const dash = pkg.version.indexOf("-");
  return {
    CARGO: cargo,
    CARGO_MANIFEST_DIR: dirname(pkg.manifest_path),
    CARGO_MANIFEST_PATH: pkg.manifest_path,
    CARGO_PKG_VERSION: pkg.version,
    CARGO_PKG_VERSION_MAJOR: major,
    CARGO_PKG_VERSION_MINOR: minor,
    CARGO_PKG_VERSION_PATCH: patchPre.replace(/[-+].*$/, ""),
    CARGO_PKG_VERSION_PRE: dash >= 0 ? pkg.version.slice(dash + 1).replace(/\+.*$/, "") : "",
    CARGO_PKG_NAME: pkg.name,
    CARGO_PKG_DESCRIPTION: pkg.description ?? "",
    CARGO_PKG_HOMEPAGE: pkg.homepage ?? "",
    CARGO_PKG_REPOSITORY: pkg.repository ?? "",
    CARGO_PKG_LICENSE: pkg.license ?? "",
    CARGO_PKG_LICENSE_FILE: pkg.license_file ?? "",
    CARGO_PKG_AUTHORS: pkg.authors.join(":"),
    CARGO_PKG_RUST_VERSION: pkg.rust_version ?? "",
    CARGO_PKG_README: pkg.readme ?? "",
  };
}

export interface ManifestContext {
  cfg: Config;
  graph: RustGraph;
  /** rust.ts's flag list (formerly CARGO_ENCODED_RUSTFLAGS): appended to every *target* unit, and handed to build scripts as CARGO_ENCODED_RUSTFLAGS. */
  targetRustflags: string[];
  /** Environment every rustc and build script runs under (CC/CXX/AR, BUN_CODEGEN_DIR, RUSTUP_*, …) — formerly the cargo process's env. */
  baseEnv: Record<string, string>;
  /** `-C linker=` per platform. */
  linker: { host: string | undefined; target: string };
  cargo: string;
  rustdoc: string;
}

export function unitManifest(ctx: ManifestContext, unit: RustUnit): UnitManifest {
  if (unit.kind === "build-script-run") return buildScriptRunManifest(ctx, unit);
  return rustcUnitManifest(ctx, unit);
}

/** cargo: the host deps dir (proc-macro dylibs a build script or rustc may load) goes in front of the inherited search path. */
function libraryPath(ctx: ManifestContext): ManifestCommon["libraryPath"] {
  return { variable: dylibPathVar(ctx.cfg.host.os), prepend: [ctx.graph.hostDeps] };
}

function rustcUnitManifest(ctx: ManifestContext, unit: RustUnit): RustcUnitManifest {
  const { cfg, graph } = ctx;
  const plan = graph.plan;
  const isHost = unit.platform === "host";
  assert(
    unit.kind !== "build-script-run" && unit.depInfo !== undefined,
    `rust plan: ${unit.crateName} is not a rustc unit`,
  );
  const args: string[] = [];
  const local = unit.isLocal;
  // cargo `add_path_args`: path packages compile with cwd = workspace root and a relative source path (this is what
  // makes `file!()`, diagnostics and debuginfo say `src/foo/bar.rs`); everything else gets an absolute path.
  const inWorkspace =
    !isAbsolute(relative(plan.workspaceRoot, unit.srcPath)) &&
    !relative(plan.workspaceRoot, unit.srcPath).startsWith("..");
  const cwd =
    unit.pkg.source === null && inWorkspace
      ? plan.workspaceRoot
      : unit.isStd
        ? plan.workspaceRoot
        : dirname(unit.pkg.manifest_path);
  const src = cwd === plan.workspaceRoot && inWorkspace ? relative(plan.workspaceRoot, unit.srcPath) : unit.srcPath;

  args.push("--crate-name", unit.crateName, `--edition=${unit.edition}`, src);
  // Pipelined units report the metadata artifact through rustc's JSON stream (run.ts renders the diagnostics);
  // the rest print human diagnostics themselves.
  if (unit.kind === "lib")
    args.push("--error-format=json", "--json=diagnostic-rendered-ansi,artifacts,future-incompat");
  else args.push("--error-format=human", "--color=always");
  for (const t of unit.crateTypes) args.push("--crate-type", t);
  // cargo: dep-info,metadata,link for rlib-only libs (pipelining), dep-info,link for everything that links.
  args.push(
    unit.kind === "lib" ? `--emit=dep-info=${unit.depInfo},metadata,link` : `--emit=dep-info=${unit.depInfo},link`,
  );
  if (unit.kind === "proc-macro") args.push("-C", "prefer-dynamic");

  // ─── profile (cargo build_base_args) ───
  const p = unit.profile;
  if (p.opt_level !== "0") args.push("-C", `opt-level=${p.opt_level}`);
  if (p.panic !== "unwind") args.push("-C", `panic=${p.panic}`);
  args.push(...ltoArgs(unit));
  if (p.codegen_backend) args.push("-Z", `codegen-backend=${p.codegen_backend}`);
  if (p.codegen_units !== null) args.push("-C", `codegen-units=${p.codegen_units}`);
  const debuginfo = debuginfoArg(p.debuginfo);
  if (debuginfo !== undefined) {
    args.push("-C", `debuginfo=${debuginfo}`);
    const info = isHost ? plan.host : plan.target;
    if (p.split_debuginfo !== null && info.splitDebuginfo.includes(p.split_debuginfo))
      args.push("-C", `split-debuginfo=${p.split_debuginfo}`);
  }
  // [lints] (local packages only), then `--check-cfg` from `unexpected_cfgs.check-cfg`.
  const lints: ManifestLints | undefined = plan.lints[unit.pkg.id];
  if (local && lints !== undefined) {
    args.push(...lints.flags);
    for (const c of lints.checkCfg) args.push("--check-cfg", c);
  }
  for (const f of p.rustflags ?? []) args.push(f);
  // debug-assertions / overflow-checks: cargo emits the minimal delta from what opt-level implies.
  if (p.opt_level !== "0") {
    if (p.debug_assertions) {
      args.push("-C", "debug-assertions=on");
      if (!p.overflow_checks) args.push("-C", "overflow-checks=off");
    } else if (p.overflow_checks) args.push("-C", "overflow-checks=on");
  } else {
    if (!p.debug_assertions) {
      args.push("-C", "debug-assertions=off");
      if (p.overflow_checks) args.push("-C", "overflow-checks=on");
    } else if (!p.overflow_checks) args.push("-C", "overflow-checks=off");
  }
  for (const f of [...unit.features].sort()) args.push("--cfg", `feature="${f}"`);
  args.push("--check-cfg", "cfg(docsrs,test)");
  const declared = Object.keys(unit.pkg.features).sort();
  args.push(
    "--check-cfg",
    declared.length > 0
      ? `cfg(feature, values(${declared.map(f => JSON.stringify(f)).join(", ")}))`
      : "cfg(feature, values())",
  );
  args.push("-C", `metadata=${unit.symbolHash}`);
  if (unit.kind !== "staticlib") args.push("-C", `extra-filename=-${unit.hash}`);
  if (p.rpath) args.push("-C", "rpath");
  args.push("--out-dir", unit.outDir);
  if (!isHost) args.push("--target", unit.platform);
  const linker = isHost ? ctx.linker.host : ctx.linker.target;
  if (linker !== undefined) args.push("-C", `linker=${linker}`);
  // cargo: incremental for path packages only, and never when CI is set.
  if (p.incremental && local && !cfg.ci)
    args.push("-C", `incremental=${join(graph.dir, unit.platform, "incremental")}`);
  const strip = stripArg(p.strip);
  if (strip !== undefined) args.push("-C", `strip=${strip}`);
  if (unit.isStd) args.push("-Z", "force-unstable-if-unmarked");
  args.push("-L", `dependency=${isHost ? graph.hostDeps : graph.targetDeps}`);
  if (!isHost) args.push("-L", `dependency=${graph.hostDeps}`);

  // ─── --extern (cargo build_deps_args / extern_args) ───
  let externOpts = false;
  for (const d of externDeps(unit)) {
    // `priv`: packages using cargo's `public-dependency` feature (the std crates) mark non-public deps so rustc's
    // exported_private_dependencies lint can see them.
    const priv = unit.kind === "lib" && !d.public && plan.publicDependency.includes(unit.pkg.id);
    const opts = [priv ? "priv" : "", d.noprelude ? "noprelude" : "", d.nounused ? "nounused" : ""].filter(
      o => o !== "",
    );
    if (opts.length > 0) externOpts = true;
    args.push("--extern", `${opts.length > 0 ? opts.join(",") + ":" : ""}${d.externName}=${externPath(unit, d.unit)}`);
  }
  if (unit.kind === "proc-macro") args.push("--extern", "proc_macro");
  if (externOpts) args.push("-Z", "unstable-options");
  if (!local) args.push("--cap-lints", "allow");
  // RUSTFLAGS position: after everything cargo generates, before build-script cfgs (run.ts appends those).
  if (!isHost) args.push(...ctx.targetRustflags);
  // The depfile must name what rustc read: `-Zbinary-dep-depinfo` adds every rlib/rmeta/dylib it loaded
  // (transitive crates found through -L, the sysroot std for host units, proc-macro dylibs).
  args.push("-Z", "binary-dep-depinfo");

  const env: Record<string, string> = {
    ...ctx.baseEnv,
    ...packageEnv(unit.pkg, ctx.cargo),
    CARGO_CRATE_NAME: unit.crateName,
  };
  // cargo: every unit of a package named on the command line (`-p bun_runtime`), its build script included.
  if (unit.pkg.id === graph.root.pkg.id) env.CARGO_PRIMARY_PACKAGE = "1";
  if (unit.buildScript !== undefined) env.OUT_DIR = unit.buildScript.scriptOutDir!;
  if (unit.isStd) env.RUSTC_BOOTSTRAP = "1";

  return {
    kind: unit.kind,
    crateName: unit.crateName,
    hash: unit.hash,
    rustc: plan.rustc.path,
    cwd,
    args,
    env,
    output: unit.output,
    rmeta: unit.rmeta,
    depInfo: unit.depInfo,
    depfile: `${unit.depInfo}.ninja`,
    buildScriptOutput: unit.buildScript?.output,
    // cargo build_scripts.to_link: the package's own script, then those of linkable dependencies on the *same*
    // platform — a proc-macro's (host) subgraph contributes its dylib, not its native search paths.
    depBuildScriptOutputs: transitiveLinkInputs(unit, "same-platform")
      .map(d => d.buildScript?.output)
      .filter((o): o is string => o !== undefined),
    libraryPath: libraryPath(ctx),
  };
}

function buildScriptRunManifest(ctx: ManifestContext, unit: RustUnit): BuildScriptRunManifest {
  const { cfg, graph } = ctx;
  const plan = graph.plan;
  const isHost = unit.platform === "host";
  const compiled = unit.deps.find(d => d.unit.kind === "build-script");
  assert(
    compiled !== undefined,
    `rust plan: build-script run for ${unit.pkg.name} has no compiled build script among its dependencies`,
  );
  // cargo custom_build::build_work. TARGET/CARGO_CFG_* describe the platform the *package* is built for; a host
  // package's script (proc-macro deps) sees the host.
  const info = isHost ? plan.host : plan.target;
  const p = unit.profile;
  const env: Record<string, string> = {
    ...ctx.baseEnv,
    ...packageEnv(unit.pkg, ctx.cargo),
    OUT_DIR: unit.scriptOutDir!,
    TARGET: info.triple,
    HOST: plan.rustc.host,
    OPT_LEVEL: p.opt_level,
    DEBUG: String(debuginfoArg(p.debuginfo) !== undefined),
    // cargo: the profile *root* — every custom profile inherits from dev or release.
    PROFILE: cfg.debug ? "debug" : "release",
    RUSTC: plan.rustc.path,
    RUSTDOC: ctx.rustdoc,
    // What the library will be compiled with (target units only get rustflags); RUSTFLAGS itself is removed by cargo.
    CARGO_ENCODED_RUSTFLAGS: isHost ? "" : ctx.targetRustflags.join("\x1f"),
  };
  const linker = isHost ? ctx.linker.host : ctx.linker.target;
  if (linker !== undefined) env.RUSTC_LINKER = linker;
  if (unit.pkg.links !== null) env.CARGO_MANIFEST_LINKS = unit.pkg.links;
  for (const f of unit.features) env[`CARGO_FEATURE_${envify(f)}`] = "1";
  // CARGO_CFG_*: every `--print cfg` value for the platform (rustflags applied), grouped by name, values comma-joined
  // in rustc's order; `debug_assertions` comes from the profile rather than rustc; `proc_macro` is never exported.
  const cfgs = new Map<string, string[]>();
  for (const line of info.cfg) {
    const m = /^([^=]+)(?:="(.*)")?$/.exec(line);
    if (!m) continue;
    const [, name, value] = m;
    if (name === "proc_macro" || name === "debug_assertions") continue;
    const list = cfgs.get(name!) ?? [];
    if (value !== undefined) list.push(value);
    cfgs.set(name!, list);
  }
  if (p.debug_assertions) cfgs.set("debug_assertions", []);
  for (const [name, values] of cfgs) env[`CARGO_CFG_${envify(name)}`] = values.join(",");
  env.CARGO_CFG_FEATURE = unit.features.join(",");

  const trackedEnv: Record<string, string> = {};
  if (existsSync(unit.output)) {
    try {
      const last = JSON.parse(readFileSync(unit.output, "utf8")) as { rerunIfEnvChanged?: string[] };
      // Variables the unit's own env sets are already part of this manifest; unset ones are recorded by their absence.
      for (const name of last.rerunIfEnvChanged ?? []) {
        const value = process.env[name];
        if (!(name in env) && value !== undefined) trackedEnv[name] = value;
      }
    } catch {
      // unreadable output.json: the script reruns anyway (its output is this edge's restat'd product)
    }
  }
  const linksDeps = unit.deps
    .filter(d => d.unit.kind === "build-script-run")
    .map(d => {
      assert(
        d.unit.pkg.links !== null,
        `rust plan: ${unit.pkg.name}'s build script depends on ${d.unit.pkg.name}'s, which has no links key`,
      );
      return { links: d.unit.pkg.links, output: d.unit.output };
    });
  return {
    kind: "build-script-run",
    crateName: unit.crateName,
    hash: unit.hash,
    cwd: dirname(unit.pkg.manifest_path),
    env,
    output: unit.output,
    depfile: join(unit.outDir, "output.d"),
    libraryPath: libraryPath(ctx),
    script: {
      program: compiled.unit.output,
      outDir: unit.scriptOutDir!,
      linksDeps,
      manifestDir: dirname(unit.pkg.manifest_path),
      local: unit.isLocal,
      trackedEnv,
    },
  };
}

/**
 * The dependencies a unit names with `--extern` (cargo `extern_args`: linkable targets only — not build scripts),
 * in a stable order (cargo sorts by crate name; rustc does not care, but stable manifests do).
 */
export function externDeps(unit: RustUnit): UnitDep[] {
  return unit.deps
    .filter(d => d.unit.kind === "lib" || d.unit.kind === "proc-macro")
    .sort((a, b) => (a.externName < b.externName ? -1 : a.externName > b.externName ? 1 : a.unit.index - b.unit.index));
}

/**
 * Which of a dependency's artifacts the `--extern` names (cargo `extern_args` + `only_requires_rmeta`):
 * a proc-macro's dylib; a lib's `.rmeta` when both sides are pipelined rlib builds (the dependent needs
 * type information only); its `.rlib` when the dependent links (staticlib, proc-macro, build script).
 */
export function externPath(unit: RustUnit, dep: RustUnit): string {
  if (dep.kind === "proc-macro") return dep.output;
  return requiresUpstreamObjects(unit) ? dep.output : dep.rmeta!;
}

/** cargo `Unit::requires_upstream_objects`: does compiling this unit link (so it needs deps' object code, not just metadata)? */
export function requiresUpstreamObjects(unit: RustUnit): boolean {
  return unit.kind !== "lib";
}

/**
 * cargo `core::compiler::lto::generate`: with the profile's `lto` unset (`false`) every unit gets
 * `-C embed-bitcode=no` (object code only, no wasted bitcode); `"off"` also says `-C lto=off`; with
 * `thin`/`fat`/`true` the target rlibs carry only bitcode for the linker plugin (`-C linker-plugin-lto`)
 * and the staticlib root runs the LTO (`-C lto[=…]`). Host units are object-only in every case.
 */
function ltoArgs(unit: RustUnit): string[] {
  // Host units (build scripts, proc-macros, their deps) are object-only whatever the profile says.
  if (unit.platform === "host") return ["-C", "embed-bitcode=no"];
  const lto = unit.profile.lto;
  if (lto === "false") return ["-C", "embed-bitcode=no"];
  if (lto === "off") return ["-C", "lto=off", "-C", "embed-bitcode=no"];
  // thin | fat | true
  if (unit.kind === "staticlib") return lto === "true" ? ["-C", "lto"] : ["-C", `lto=${lto}`];
  return ["-C", "linker-plugin-lto"];
}

/** cargo `TomlDebugInfo` → the `-C debuginfo=` value; undefined for none. */
function debuginfoArg(d: UnitGraphUnit["profile"]["debuginfo"]): string | undefined {
  if (d === null || d === 0 || d === "none" || d === "0") return undefined;
  if (d === (true as unknown) || d === "full") return "2";
  if (d === "limited") return "1";
  return String(d);
}

/** cargo `Strip` (deferred/resolved wrapper around none | debuginfo | symbols | a named option). */
function stripArg(s: UnitGraphUnit["profile"]["strip"]): string | undefined {
  const v = typeof s === "string" ? s : (s.resolved ?? s.deferred ?? "none");
  const inner = typeof v === "string" ? v : ((v as { Named?: string }).Named ?? "none");
  const lower = inner.toLowerCase();
  return lower === "none" || lower === "false" ? undefined : lower;
}

/**
 * Every lib/proc-macro unit reachable through `--extern` edges: what a linking unit reads (cargo gives it
 * `Artifact::All` edges to all of them). With `"same-platform"` the walk does not descend into dependencies built
 * for the other platform (a target unit's proc-macros and everything beneath them): that is cargo's
 * `build_scripts.to_link`, the set whose native search paths apply.
 */
export function transitiveLinkInputs(unit: RustUnit, scope: "all" | "same-platform" = "all"): RustUnit[] {
  const seen = new Set<RustUnit>();
  const walk = (u: RustUnit) => {
    for (const d of externDeps(u)) {
      if (seen.has(d.unit)) continue;
      if (scope === "same-platform" && d.unit.platform !== unit.platform) continue;
      seen.add(d.unit);
      walk(d.unit);
    }
  };
  walk(unit);
  return [...seen];
}
