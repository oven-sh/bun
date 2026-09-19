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
import { existsSync, readFileSync, rmSync } from "node:fs";
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
  fileNames: Record<"rlib" | "proc-macro" | "staticlib" | "bin", [string, string]>;
  /** `rustc --print split-debuginfo`: the `-C split-debuginfo` values this target accepts (cargo drops the profile's setting otherwise). */
  splitDebuginfo: string[];
}

export interface ManifestLints {
  /** `--deny=warnings`, `--allow=clippy::too_many_arguments`, … in cargo's order */
  flags: string[];
  /** `[lints.rust.unexpected_cfgs] check-cfg = [...]` */
  checkCfg: string[];
}

/** What configure asks the planner for: `rust/plan.input.json`, the plan edge's input (rust/emit.ts). */
export interface PlanInput {
  cwd: string;
  cargo: string;
  rustc: string;
  triple: string;
  /** rust.ts's target rustflags (the `rustc --print cfg` probe applies them, as cargo does) */
  rustflags: string[];
  /** `cargo build` argv after `build` */
  args: string[];
  /** the subset of the cargo environment that shapes the plan (`planEnv`) */
  env: Record<string, string>;
}

export interface RustPlan {
  version: typeof PLAN_VERSION;
  /** What the graph was planned for; a plan for anything else is not used (`readPlan`). */
  plannedWith: PlanInput;
  rustc: { path: string; version: string; commitHash: string | null; host: string; sysroot: string };
  unitGraph: UnitGraph;
  /** By package id: every package the unit graph mentions, workspace + registry + (with -Zbuild-std) the std workspace. */
  packages: Record<string, MetadataPackage>;
  /** By package id, for path packages that have a `[lints]` table (cargo passes lint flags only to local packages). */
  lints: Record<string, ManifestLints>;
  /** Package ids whose manifest enables `cargo-features = ["public-dependency"]` (the std crates): their non-public deps are passed as `--extern priv:…`. */
  publicDependency: string[];
  workspaceRoot: string;
  host: RustcTargetInfo;
  /** Absent when host == target and no `--target` was planned (never the case for bun today: rust.ts always passes --target). */
  target: RustcTargetInfo;
}

export const PLAN_VERSION = 2;

export function planPath(buildDir: string): string {
  return join(buildDir, "rust", "plan.json");
}

export function planInputPath(buildDir: string): string {
  return join(buildDir, "rust", "plan.input.json");
}

/**
 * The plan for this build directory, or undefined when there is none to build from: before the plan edge has run
 * (first configure of a fresh tree), or when the one on disk was made by an older generator or for different cargo
 * arguments (profile/ASAN/LTO toggles change the graph). In every such case configure emits just the plan edge,
 * ninja runs it, and the reconfigure it triggers picks the fresh plan up.
 */
export function readPlan(buildDir: string, input: PlanInput): RustPlan | undefined {
  const path = planPath(buildDir);
  if (!existsSync(path)) return undefined;
  let plan: RustPlan | undefined;
  try {
    plan = JSON.parse(readFileSync(path, "utf8")) as RustPlan;
  } catch {
    plan = undefined; // truncated or otherwise unreadable (disk full, …)
  }
  if (
    plan !== undefined &&
    plan.version === PLAN_VERSION &&
    JSON.stringify(plan.plannedWith) === JSON.stringify(input)
  ) {
    return plan;
  }
  // Not a plan for this configuration. The plan edge reruns because its input file changed; removing the stale
  // plan as well means nothing (a lost .ninja_log, a hand-run ninja) can mistake it for current.
  rmSync(path, { force: true });
  return undefined;
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
// Build-time CLI:  plan.ts <plan.input.json> <plan.json>
// ───────────────────────────────────────────────────────────────────────────

function run(
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string | undefined>; inheritStderr?: boolean } = {},
): string {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", opts.inheritStderr ? "inherit" : "pipe"],
    env: { ...process.env, ...opts.env },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    if (!opts.inheritStderr) process.stderr.write(r.stderr ?? "");
    throw new Error(`${cmd} ${args.slice(0, 4).join(" ")} … exited with ${r.status ?? r.signal}`);
  }
  return r.stdout;
}

/**
 * cargo `TargetInfo::new`: one rustc process compiling an empty probe crate from stdin that prints the file name
 * it would produce per crate type, then sysroot, the accepted split-debuginfo values and the cfg values — with the
 * *target* rustflags applied (host probes get none when --target is in play). Sections come back in argument
 * order; the sysroot line (known in advance) separates the file names from the rest.
 */
function targetInfo(rustc: string, triple: string, rustflags: string[], sysroot: string): RustcTargetInfo {
  const crateTypes = ["rlib", "proc-macro", "staticlib", "bin"] as const;
  const probe = (types: readonly string[], prints: string[]) =>
    run(rustc, [
      "-",
      "--crate-name",
      "___",
      "--print=file-names",
      ...types.map(t => `--crate-type=${t}`),
      ...prints,
      `--target=${triple}`,
      ...rustflags,
    ])
      .split("\n")
      .map(l => l.trim());
  const out = probe(crateTypes, ["--print=sysroot", "--print=split-debuginfo", "--print=cfg"]);
  const sysrootAt = out.indexOf(sysroot);
  if (sysrootAt < 0) throw new Error(`rustc --print probe for ${triple}: no sysroot line in\n${out.join("\n")}`);
  const split = (line: string): [string, string] => line.split("___") as [string, string];
  let names = out.slice(0, sysrootAt);
  // One artifact per crate type on every target bun builds for; where a type yields several (dylib + import
  // library), ask per type and take the first, as cargo does.
  if (names.length !== crateTypes.length) names = crateTypes.map(t => probe([t], [])[0]!);
  const fileNames = Object.fromEntries(crateTypes.map((t, i) => [t, split(names[i]!)])) as RustcTargetInfo["fileNames"];
  const rest = out.slice(sysrootAt + 1).filter(l => l.length > 0);
  const splitDebuginfo = rest.filter(l => l === "off" || l === "packed" || l === "unpacked");
  const cfg = rest.slice(splitDebuginfo.length);
  return { triple, cfg, fileNames, splitDebuginfo };
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
 * `--<level>=<name>` flags (`<tool>::<name>` for tool lints), `cargo` lints dropped, sorted by
 * (priority ascending, bare lint name descending, flag). The `unexpected_cfgs` lint's `check-cfg`
 * list becomes `--check-cfg` args after them.
 */
function manifestLints(manifest: TomlTable, manifestPath: string): ManifestLints | undefined {
  let table = manifest.lints as TomlTable | undefined;
  if (table === undefined) return undefined;
  if (table.workspace === true)
    table =
      ((workspaceManifestOf(manifest, manifestPath).workspace as TomlTable | undefined)?.lints as
        | TomlTable
        | undefined) ?? {};
  const lints: { priority: number; lint: string; flag: string }[] = [];
  const checkCfg: string[] = [];
  for (const [tool, entries] of Object.entries(table)) {
    if (tool === "workspace" || tool === "cargo") continue;
    for (const [lint, spec] of Object.entries(entries as TomlTable)) {
      const conf: { level?: TomlValue; priority?: TomlValue; "check-cfg"?: TomlValue } =
        typeof spec === "string" ? { level: spec } : (spec as TomlTable);
      if (typeof conf.level !== "string" || !["allow", "warn", "deny", "forbid"].includes(conf.level)) {
        throw new Error(`${manifestPath}: lint ${tool}.${lint} has no valid level`);
      }
      lints.push({
        priority: typeof conf.priority === "number" ? conf.priority : 0,
        lint,
        flag: `--${conf.level}=${tool === "rust" ? lint : `${tool}::${lint}`}`,
      });
      if (tool === "rust" && lint === "unexpected_cfgs" && Array.isArray(conf["check-cfg"]))
        checkCfg.push(...(conf["check-cfg"] as string[]));
    }
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  lints.sort((a, b) => a.priority - b.priority || cmp(b.lint, a.lint) || cmp(a.flag, b.flag));
  return { flags: lints.map(l => l.flag), checkCfg };
}

if (process.argv[1] === import.meta.filename) {
  const [inputArg, outArg] = process.argv.slice(2);
  if (!inputArg || !outArg) {
    process.stderr.write("usage: plan.ts <plan.input.json> <plan.json>\n");
    process.exit(2);
  }
  // ninja passes paths relative to the build directory it runs in; cargo runs from the workspace.
  const out = resolve(outArg);
  const input = JSON.parse(readFileSync(resolve(inputArg), "utf8")) as PlanInput;
  process.chdir(input.cwd);
  for (const [k, v] of Object.entries(input.env)) process.env[k] = v;
  const { cargo, rustc, triple, rustflags, args: cargoArgs } = input;

  const vV = run(rustc, ["-vV"]);
  const host = /^host:\s*(\S+)/m.exec(vV)?.[1];
  if (host === undefined) throw new Error(`rustc -vV did not report a host triple:\n${vV}`);
  const sysroot = run(rustc, ["--print=sysroot"]).trim();

  // 1. The unit graph, for exactly the build cargo would have run. Downloads any missing registry crates as a side
  //    effect, like the build would — stderr (cargo's progress) goes to the terminal.
  const unitGraph = JSON.parse(
    run(cargo, ["build", ...cargoArgs, "-Zunstable-options", "--unit-graph"], { inheritStderr: true }),
  ) as UnitGraph;
  if (unitGraph.version !== 1) throw new Error(`cargo --unit-graph version ${unitGraph.version}, expected 1`);

  // 2. Package facts: the workspace's metadata, plus the std workspace's when -Zbuild-std put std units in the graph.
  //    --filter-platform keeps cargo from resolving (and downloading) crates that only other targets use.
  const platforms = [...new Set([host, triple])].flatMap(t => ["--filter-platform", t]);
  const packages: Record<string, MetadataPackage> = {};
  const meta = JSON.parse(
    run(cargo, ["metadata", "--format-version=1", "--locked", ...platforms], { inheritStderr: true }),
  ) as {
    packages: MetadataPackage[];
    workspace_root: string;
  };
  for (const p of meta.packages) packages[p.id] = p;
  if (unitGraph.units.some(u => u.is_std)) {
    const stdManifest = join(sysroot, "lib", "rustlib", "src", "rust", "library", "Cargo.toml");
    // RUSTC_BOOTSTRAP: the std manifests use nightly cargo features; cargo's own build-std resolve sets the same.
    // --all-features: `packages` only lists what some feature set reaches, and -Zbuild-std-features decides which
    // optional std deps (backtrace: addr2line, miniz_oxide, …) are in the graph. The std workspace is vendored with
    // the rust-src component (its Cargo.lock is complete), so this resolves offline.
    const stdMeta = JSON.parse(
      run(
        cargo,
        ["metadata", "--format-version=1", "--locked", "--all-features", ...platforms, "--manifest-path", stdManifest],
        {
          env: { RUSTC_BOOTSTRAP: "1" },
          inheritStderr: true,
        },
      ),
    ) as { packages: MetadataPackage[] };
    for (const p of stdMeta.packages) packages[p.id] ??= p;
  }
  for (const u of unitGraph.units) {
    if (packages[u.pkg_id] === undefined)
      throw new Error(`unit graph references ${u.pkg_id}, which cargo metadata did not report`);
  }

  // 3. Manifest facts cargo's JSON does not export: [lints] (local packages only — cargo passes lint flags to
  //    path, non-std packages) and the public-dependency cargo feature (std crates).
  const lints: Record<string, ManifestLints> = {};
  const publicDependency: string[] = [];
  const seen = new Set<string>();
  for (const u of unitGraph.units) {
    if (seen.has(u.pkg_id)) continue;
    seen.add(u.pkg_id);
    const pkg = packages[u.pkg_id]!;
    if (pkg.source !== null && !u.is_std) continue;
    const manifest = parseToml(readFileSync(pkg.manifest_path, "utf8"), pkg.manifest_path);
    if (Array.isArray(manifest["cargo-features"]) && manifest["cargo-features"].includes("public-dependency"))
      publicDependency.push(u.pkg_id);
    if (u.is_std) continue;
    const l = manifestLints(manifest, pkg.manifest_path);
    if (l !== undefined) lints[u.pkg_id] = l;
  }

  const plan: RustPlan = {
    version: PLAN_VERSION,
    plannedWith: input,
    rustc: {
      path: rustc,
      version: /^release:\s*(\S+)/m.exec(vV)?.[1] ?? "?",
      commitHash: /^commit-hash:\s*(\S+)/m.exec(vV)?.[1] ?? null,
      host,
      sysroot,
    },
    unitGraph,
    packages: Object.fromEntries(Object.entries(packages).filter(([id]) => seen.has(id))),
    lints,
    publicDependency,
    workspaceRoot: meta.workspace_root,
    host: targetInfo(rustc, host, [], sysroot),
    target: targetInfo(rustc, triple, rustflags, sysroot),
  };
  // Only if changed: an identical re-plan (touched Cargo.toml, same graph) must not bump the mtime and reconfigure (restat).
  writeIfChanged(out, JSON.stringify(plan) + "\n");
  const by = new Map<string, number>();
  for (const u of unitGraph.units) {
    const kind = `${u.mode === "run-custom-build" ? "run " : ""}${u.target.kind[0]}${u.platform ? "" : " (host)"}`;
    by.set(kind, (by.get(kind) ?? 0) + 1);
  }
  console.log(`${unitGraph.units.length} units: ${[...by].map(([k, n]) => `${n} ${k}`).join(", ")}`);
}
