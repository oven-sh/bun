/**
 * The Rust build plan: cargo's own answer to "which rustc invocations, with
 * which features/profile/dependencies, make up `bun_runtime`" — captured as
 * data so configure can emit one ninja edge per compilation unit.
 *
 * Cargo stays the planner (feature resolution, profile inheritance and
 * overrides, `-Zbuild-std` unit injection, host/target split, build-script
 * ordering); ninja becomes the executor. Nothing here re-implements cargo's
 * resolver: `cargo build … -Zunstable-options --unit-graph` prints the final
 * unit DAG cargo would execute for exactly the arguments `rust.ts` would have
 * run `cargo build` with, and `cargo metadata` supplies the per-package facts
 * (`CARGO_PKG_*`, `links`, declared features, manifest paths) the unit graph
 * refers to by package id. `rustc --print` supplies the target facts cargo
 * would probe (cfg values as seen by build scripts, artifact file naming).
 *
 * This file is both the type definitions configure reads (`readPlan`) and the
 * build-time CLI ninja runs to (re)generate `<buildDir>/rust/plan.json`
 * whenever `Cargo.lock`, a manifest, the toolchain or the planning arguments
 * change. `build.ninja` itself depends on `plan.json`, so a changed plan
 * reconfigures and ninja restarts with the new unit edges (the same manifest
 * self-rebuild the `regen` rule uses for build-script edits).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { writeIfChanged } from "../fs.ts";
import { parseToml, type TomlTable, type TomlValue } from "./toml.ts";

// ───────────────────────────────────────────────────────────────────────────
// cargo --unit-graph (src/cargo/core/compiler/unit_graph.rs, version 1)
// ───────────────────────────────────────────────────────────────────────────

export interface UnitGraph {
  version: number;
  units: UnitGraphUnit[];
  /** Indices of the requested units (here: the one `bun_runtime` staticlib). */
  roots: number[];
}

export interface UnitGraphUnit {
  /** PackageIdSpec, same spelling as `cargo metadata`'s `packages[].id`. */
  pkg_id: string;
  target: {
    kind: ("lib" | "rlib" | "dylib" | "cdylib" | "staticlib" | "proc-macro" | "bin" | "custom-build")[];
    crate_types: string[];
    /** Cargo target name; the crate name is this with `-` → `_`. */
    name: string;
    src_path: string;
    edition: string;
    doc?: boolean;
    doctest?: boolean;
    test?: boolean;
  };
  profile: {
    name: string;
    opt_level: string;
    /** The profile's `lto` *setting* ("false" | "true" | "fat" | "thin" | "off"); the per-unit LTO mode is derived (units.ts). */
    lto: string;
    codegen_backend: string | null;
    codegen_units: number | null;
    /** 0 | 1 | 2 | "line-tables-only" | "line-directives-only" | "limited" | "full" | "none" */
    debuginfo: number | string | null;
    split_debuginfo: string | null;
    debug_assertions: boolean;
    overflow_checks: boolean;
    rpath: boolean;
    incremental: boolean;
    panic: "unwind" | "abort";
    strip: { deferred?: string; resolved?: string } | string;
    rustflags?: string[];
    trim_paths?: unknown;
  };
  /** Target triple for target units; null for host units (build scripts, proc-macros and their dependencies). */
  platform: string | null;
  mode: "build" | "run-custom-build" | "check" | "test" | "doc" | "doctest" | "docscrape";
  features: string[];
  is_std?: boolean;
  dependencies: { index: number; extern_crate_name: string; public: boolean; noprelude: boolean; nounused?: boolean }[];
}

// ───────────────────────────────────────────────────────────────────────────
// cargo metadata (the subset we read)
// ───────────────────────────────────────────────────────────────────────────

export interface MetadataPackage {
  id: string;
  name: string;
  version: string;
  manifest_path: string;
  links: string | null;
  authors: string[];
  description: string | null;
  homepage: string | null;
  repository: string | null;
  license: string | null;
  license_file: string | null;
  readme: string | null;
  rust_version: string | null;
  edition: string;
  /** Declared features (keys) — what `--check-cfg cfg(feature, values(...))` lists. */
  features: Record<string, string[]>;
  source: string | null;
}

// ───────────────────────────────────────────────────────────────────────────
// plan.json
// ───────────────────────────────────────────────────────────────────────────

/** What `rustc --print` reports for one platform. */
export interface RustcTargetInfo {
  triple: string;
  /** `rustc --print cfg` lines, with the target rustflags applied (what cargo hands build scripts as `CARGO_CFG_*`). */
  cfg: string[];
  /** `[prefix, suffix]` per crate type from `rustc --print file-names`, e.g. rlib → ["lib", ".rlib"], bin → ["", ".exe"]. */
  fileNames: Record<"rlib" | "dylib" | "proc-macro" | "staticlib" | "bin", [string, string]>;
  /** `rustc --print split-debuginfo`: the `-C split-debuginfo` values this target accepts (cargo drops the profile's setting otherwise). */
  splitDebuginfo: string[];
  /** `rustc --print sysroot` + `/lib/rustlib/<triple>/lib`. */
  targetLibdir: string;
}

/** One `[lints]` entry as cargo turns it into a rustc flag (`lints_to_rustflags`). */
export interface ManifestLint {
  /** `warnings`, `clippy::too_many_arguments`, … */
  name: string;
  level: "allow" | "warn" | "deny" | "forbid";
  priority: number;
}

export interface ManifestLints {
  lints: ManifestLint[];
  /** `[lints.rust.unexpected_cfgs] check-cfg = [...]` */
  checkCfg: string[];
}

export interface RustPlan {
  version: 1;
  /** The `cargo build` argv (after `build`) and env the graph was planned with — informational, and part of what invalidates the plan. */
  plannedWith: { args: string[]; env: Record<string, string> };
  rustc: { path: string; version: string; commitHash: string | null; host: string; sysroot: string };
  unitGraph: UnitGraph;
  /** By package id: every package the unit graph mentions, workspace + registry + (with -Zbuild-std) the std workspace. */
  packages: Record<string, MetadataPackage>;
  /** By package id, for path packages that have a `[lints]` table (cargo passes lint flags only to local packages). */
  lints: Record<string, ManifestLints>;
  /** Package ids whose manifest enables `cargo-features = ["public-dependency"]` (the std crates): their non-public deps are passed as `--extern priv:…`. */
  publicDependency: string[];
  workspaceRoot: string;
  workspaceMembers: string[];
  host: RustcTargetInfo;
  /** Absent when host == target and no `--target` was planned (never the case for bun today: rust.ts always passes --target). */
  target: RustcTargetInfo;
}

export const PLAN_VERSION = 1;

export function planPath(buildDir: string): string {
  return join(buildDir, "rust", "plan.json");
}

/**
 * The plan for this build directory, or undefined when there is none to build from: before the plan edge has run
 * (first configure of a fresh tree), or when the one on disk was made by an older generator or for different cargo
 * arguments (profile/ASAN/LTO toggles change the graph). In every such case configure emits just the plan edge,
 * ninja runs it, and the reconfigure it triggers picks the fresh plan up.
 */
export function readPlan(buildDir: string, plannedWith: RustPlan["plannedWith"]): RustPlan | undefined {
  const path = planPath(buildDir);
  if (!existsSync(path)) return undefined;
  const plan = JSON.parse(readFileSync(path, "utf8")) as RustPlan;
  if (plan.version !== PLAN_VERSION) return undefined;
  if (JSON.stringify(plan.plannedWith) !== JSON.stringify(plannedWith)) return undefined;
  return plan;
}

/** The subset of the cargo environment that shapes the plan (recorded in it, compared by `readPlan`). */
export function planEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([k]) => /^(CARGO_|RUSTUP_|RUSTC$|BUN_CODEGEN_DIR$)/.test(k))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Build-time CLI:  plan.ts [--cwd=DIR] [--env=K=V]... <plan.json> <cargo> <rustc> <target-triple> <rustflags \x1f-joined> -- <cargo build args...>
// ───────────────────────────────────────────────────────────────────────────

function run(
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string | undefined>; cwd?: string } = {},
): string {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...opts.env },
    cwd: opts.cwd,
  });
  if (r.status !== 0) {
    process.stderr.write(r.stderr ?? "");
    throw new Error(`${cmd} ${args.slice(0, 4).join(" ")} … exited with ${r.status ?? r.signal}`);
  }
  return r.stdout;
}

function targetInfo(
  rustc: string,
  triple: string,
  rustflags: string[],
  env: Record<string, string | undefined>,
): RustcTargetInfo {
  // cargo: TargetInfo::new — one rustc process printing sysroot, cfg and the file names of a probe crate per crate type,
  // with the *target* rustflags applied (host probes get none when --target is in play).
  const probe = (crateType: string): [string, string] => {
    const out = run(
      rustc,
      [
        "-",
        "--crate-name",
        "___",
        "--print=file-names",
        `--crate-type=${crateType}`,
        `--target=${triple}`,
        ...rustflags,
      ],
      { env },
    )
      .trim()
      .split("\n");
    // dylib-ish types print the library first; bin prints one name. `___` splits prefix from suffix.
    const first = out.find(l => l.includes("___")) ?? out[0]!;
    const [prefix, suffix] = first.split("___") as [string, string];
    return [prefix, suffix];
  };
  const sysroot = run(rustc, ["--print=sysroot", `--target=${triple}`, ...rustflags], { env }).trim();
  return {
    triple,
    cfg: run(rustc, ["--print=cfg", `--target=${triple}`, ...rustflags], { env })
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0),
    fileNames: {
      rlib: probe("rlib"),
      dylib: probe("dylib"),
      "proc-macro": probe("proc-macro"),
      staticlib: probe("staticlib"),
      bin: probe("bin"),
    },
    splitDebuginfo: run(rustc, ["--print=split-debuginfo", `--target=${triple}`, ...rustflags], { env })
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0),
    targetLibdir: join(sysroot, "lib", "rustlib", triple, "lib"),
  };
}

/**
 * The `[workspace]` manifest a package inherits from (cargo `find_workspace_root`): `package.workspace` if given,
 * else the package's own manifest if it has `[workspace]`, else the nearest ancestor directory's `Cargo.toml` that does.
 * A vendored crate with its own workspace table (lol-html) inherits from that, not from bun's root.
 */
function workspaceManifestOf(manifest: TomlTable, manifestPath: string): TomlTable {
  const explicit = (manifest.package as TomlTable | undefined)?.workspace;
  if (typeof explicit === "string") {
    const p = join(resolve(dirname(manifestPath), explicit), "Cargo.toml");
    return parseToml(readFileSync(p, "utf8"), p);
  }
  if (manifest.workspace !== undefined) return manifest;
  for (let dir = dirname(dirname(manifestPath)); ; dir = dirname(dir)) {
    const p = join(dir, "Cargo.toml");
    if (existsSync(p)) {
      const m = parseToml(readFileSync(p, "utf8"), p);
      if (m.workspace !== undefined) return m;
    }
    if (dirname(dir) === dir)
      throw new Error(`${manifestPath}: lints.workspace = true but no workspace manifest found above it`);
  }
}

/**
 * cargo `lints_to_rustflags` (src/cargo/util/toml/mod.rs): the package's `[lints]` table — or the
 * workspace's `[workspace.lints]` when the package says `lints.workspace = true` — flattened to
 * (tool, name, level, priority), `cargo::` lints dropped, sorted by priority ascending then name
 * descending; each becomes `--<level>=<name>` (`<tool>::<name>` for tool lints). The
 * `unexpected_cfgs` lint's `check-cfg` list becomes `--check-cfg` args after them.
 */
function manifestLints(manifest: TomlTable, manifestPath: string): ManifestLints | undefined {
  let table = manifest.lints as TomlTable | undefined;
  if (table === undefined) return undefined;
  if (table.workspace === true)
    table =
      ((workspaceManifestOf(manifest, manifestPath).workspace as TomlTable | undefined)?.lints as
        | TomlTable
        | undefined) ?? {};
  const lints: ManifestLint[] = [];
  const checkCfg: string[] = [];
  for (const [tool, entries] of Object.entries(table)) {
    if (tool === "workspace" || tool === "cargo") continue;
    for (const [lint, spec] of Object.entries(entries as TomlTable)) {
      const conf: { level?: TomlValue; priority?: TomlValue; "check-cfg"?: TomlValue } =
        typeof spec === "string" ? { level: spec } : (spec as TomlTable);
      const name = tool === "rust" ? lint : `${tool}::${lint}`;
      lints.push({
        name,
        level: conf.level as ManifestLint["level"],
        priority: typeof conf.priority === "number" ? conf.priority : 0,
      });
      if (tool === "rust" && lint === "unexpected_cfgs" && Array.isArray(conf["check-cfg"]))
        checkCfg.push(...(conf["check-cfg"] as string[]));
    }
  }
  lints.sort((a, b) => a.priority - b.priority || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return { lints, checkCfg };
}

if (process.argv[1] === import.meta.filename) {
  const argv = process.argv.slice(2);
  const invokedFrom = process.cwd();
  const passedEnv: Record<string, string> = {};
  // `--cwd=DIR` / `--env=K=V` first (ninja has no per-edge environment; same convention as stream.ts).
  while (argv[0]?.startsWith("--cwd=") || argv[0]?.startsWith("--env=")) {
    const opt = argv.shift()!;
    if (opt.startsWith("--cwd=")) process.chdir(opt.slice("--cwd=".length));
    else {
      const kv = opt.slice("--env=".length);
      const eq = kv.indexOf("=");
      process.env[kv.slice(0, eq)] = kv.slice(eq + 1);
      passedEnv[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }
  const dashdash = argv.indexOf("--");
  const [outArg, cargo, rustc, triple, rustflagsJoined] = argv.slice(0, dashdash);
  // ninja passes $out relative to the build directory it ran us from.
  const out = outArg === undefined ? undefined : resolve(invokedFrom, outArg);
  const cargoArgs = argv.slice(dashdash + 1);
  if (!out || !cargo || !rustc || !triple || rustflagsJoined === undefined || dashdash < 0) {
    process.stderr.write("usage: plan.ts <plan.json> <cargo> <rustc> <triple> <rustflags> -- <cargo build args>\n");
    process.exit(2);
  }
  const rustflags = rustflagsJoined.length > 0 ? rustflagsJoined.split("\x1f") : [];
  const env = process.env as Record<string, string>;

  // 1. The unit graph, for exactly the build cargo would have run. (Downloads any missing registry crates as a side effect, like the build would.)
  const unitGraph = JSON.parse(run(cargo, ["build", ...cargoArgs, "-Zunstable-options", "--unit-graph"])) as UnitGraph;
  if (unitGraph.version !== 1) throw new Error(`cargo --unit-graph version ${unitGraph.version}, expected 1`);

  // 2. Package facts. The workspace's own metadata, plus the std workspace's when -Zbuild-std put std units in the graph.
  const vV = run(rustc, ["-vV"]);
  const host = /^host:\s*(\S+)/m.exec(vV)?.[1]!;
  const sysroot = run(rustc, ["--print=sysroot"]).trim();
  const packages: Record<string, MetadataPackage> = {};
  const meta = JSON.parse(run(cargo, ["metadata", "--format-version=1", "--locked"])) as {
    packages: MetadataPackage[];
    workspace_root: string;
    workspace_members: string[];
  };
  for (const p of meta.packages) packages[p.id] = p;
  if (unitGraph.units.some(u => u.is_std)) {
    const stdManifest = join(sysroot, "lib", "rustlib", "src", "rust", "library", "Cargo.toml");
    // RUSTC_BOOTSTRAP: the std manifests use nightly cargo features; cargo's own build-std resolve sets the same.
    // --all-features: `packages` only lists what some feature set reaches, and -Zbuild-std-features decides which optional std deps (backtrace: addr2line, miniz_oxide, …) are in the graph.
    const stdMeta = JSON.parse(
      run(cargo, ["metadata", "--format-version=1", "--locked", "--all-features", "--manifest-path", stdManifest], {
        env: { RUSTC_BOOTSTRAP: "1" },
      }),
    ) as { packages: MetadataPackage[] };
    for (const p of stdMeta.packages) packages[p.id] ??= p;
  }
  for (const u of unitGraph.units) {
    if (packages[u.pkg_id] === undefined)
      throw new Error(`unit graph references ${u.pkg_id}, which cargo metadata did not report`);
  }

  const lints: Record<string, ManifestLints> = {};
  const publicDependency: string[] = [];
  const seen = new Set<string>();
  for (const u of unitGraph.units) {
    if (seen.has(u.pkg_id)) continue;
    seen.add(u.pkg_id);
    const pkg = packages[u.pkg_id]!;
    const manifest = parseToml(readFileSync(pkg.manifest_path, "utf8"), pkg.manifest_path);
    if (Array.isArray(manifest["cargo-features"]) && manifest["cargo-features"].includes("public-dependency"))
      publicDependency.push(u.pkg_id);
    // cargo passes lint flags to local (path, non-std) packages only.
    if (pkg.source !== null || u.is_std) continue;
    const l = manifestLints(manifest, pkg.manifest_path);
    if (l !== undefined) lints[u.pkg_id] = l;
  }

  const plan: RustPlan = {
    version: PLAN_VERSION,
    plannedWith: { args: cargoArgs, env: planEnv(passedEnv) },
    rustc: {
      path: rustc,
      version: /^release:\s*(\S+)/m.exec(vV)?.[1] ?? "?",
      commitHash: /^commit-hash:\s*(\S+)/m.exec(vV)?.[1] ?? null,
      host,
      sysroot,
    },
    unitGraph,
    packages: Object.fromEntries(Object.entries(packages).filter(([id]) => unitGraph.units.some(u => u.pkg_id === id))),
    lints,
    publicDependency,
    workspaceRoot: meta.workspace_root,
    workspaceMembers: meta.workspace_members,
    host: targetInfo(rustc, host, [], env),
    target: targetInfo(rustc, triple, rustflags, env),
  };
  // writeIfChanged: an identical re-plan (touched Cargo.toml, same graph) leaves plan.json's mtime alone, so restat prunes the reconfigure.
  writeIfChanged(out, JSON.stringify(plan, null, 1) + "\n");
  const by: Record<string, number> = {};
  for (const u of unitGraph.units)
    by[`${u.mode === "run-custom-build" ? "run " : ""}${u.target.kind[0]}${u.platform ? "" : " (host)"}`] =
      (by[`${u.mode === "run-custom-build" ? "run " : ""}${u.target.kind[0]}${u.platform ? "" : " (host)"}`] ?? 0) + 1;
  console.log(
    `${unitGraph.units.length} units: ${Object.entries(by)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ")}`,
  );
}
