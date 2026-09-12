/**
 * Ninja rules and edges for the Rust units (`units.ts`), plus the plan edge
 * (`plan.ts`) that feeds configure.
 *
 * Edges per unit kind:
 *   lib               rust_meta  → <hash>.rmeta   (starts rustc; returns at metadata)
 *                     rust_codegen → <hash>.rlib  (same rustc; returns at exit)
 *   proc-macro        rust_rustc → lib<name>-<hash>.so
 *   build-script      rust_rustc → build_script_build-<hash>
 *   build-script-run  rust_build_script → output.json (restat)
 *   staticlib (root)  rust_rustc → libbun_runtime.a
 *
 * Every edge's command is `run.ts <mode> <unit.json>`; the unit manifest
 * (argv/env/cwd) is written at configure with writeIfChanged and is an input
 * of the edge, so a flag change rebuilds exactly the units it touches.
 */

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Config } from "../config.ts";
import { writeIfChanged } from "../fs.ts";
import type { Ninja } from "../ninja.ts";
import { quote, quoteArgs } from "../shell.ts";
import { planPath } from "./plan.ts";
import {
  type ManifestContext,
  type RustGraph,
  type RustUnit,
  depfilePath,
  externPath,
  transitiveLinkInputs,
  unitManifest,
} from "./units.ts";

const runScript = resolve(import.meta.dirname, "run.ts");
const planScript = resolve(import.meta.dirname, "plan.ts");
const planScriptDeps = [planScript, resolve(import.meta.dirname, "toml.ts")]; // what the planner runs

export function registerRustUnitRules(n: Ninja, cfg: Config): void {
  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);
  const run = `${cfg.jsRuntime} ${q(runScript)}`;

  // Depfiles: run.ts rewrites rustc's dep-info (all emitted artifacts as targets, `# env-dep` comments)
  // into `$depfile` with just this edge's outputs. deps=gcc moves it into .ninja_deps.
  n.rule("rust_meta", {
    command: `${run} meta $manifest`,
    description: "rustc $crate (metadata)",
    depfile: "$depfile",
    deps: "gcc",
  });
  n.rule("rust_codegen", {
    command: `${run} codegen $manifest`,
    description: "rustc $crate (codegen)",
  });
  n.rule("rust_rustc", {
    command: `${run} rustc $manifest`,
    description: "rustc $crate$what",
    depfile: "$depfile",
    deps: "gcc",
  });
  n.rule("rust_build_script", {
    command: `${run} build-script $manifest`,
    description: "build.rs $crate",
    depfile: "$depfile",
    deps: "gcc",
    // output.json is rewritten only when the directives change, so an unchanged rerun rebuilds nothing downstream.
    restat: true,
  });
  n.rule("rust_plan", {
    command: `${cfg.jsRuntime} ${q(planScript)} --cwd=$cwd $env $out $cargo $rustc $triple $rustflags -- $args`,
    description: "cargo plan → $out",
    // plan.json is written only if the graph changed; then build.ninja (which depends on it) is regenerated.
    restat: true,
    pool: "console",
  });
}

export interface RustPlanEdgeInputs {
  cargo: string;
  rustc: string;
  triple: string;
  rustflags: string[];
  /** `cargo build` args (after `build`) */
  args: string[];
  env: Record<string, string>;
  /** Cargo.lock, workspace manifests, rust-toolchain.toml, vendored-crate fetch stamps */
  inputs: string[];
  orderOnly: string[];
}

/** The edge producing `<buildDir>/rust/plan.json`. Returns its path (an input of build.ninja's regen edge). */
export function emitRustPlan(n: Ninja, cfg: Config, p: RustPlanEdgeInputs): string {
  const hostWin = cfg.host.os === "windows";
  const out = planPath(cfg.buildDir);
  n.build({
    outputs: [out],
    rule: "rust_plan",
    inputs: [],
    implicitInputs: [...p.inputs, ...planScriptDeps],
    orderOnlyInputs: p.orderOnly,
    vars: {
      cwd: quote(cfg.cwd, hostWin),
      env: Object.entries(p.env)
        .map(([k, v]) => `--env=${k}=${quote(v, hostWin)}`)
        .join(" "),
      cargo: quote(p.cargo, hostWin),
      rustc: quote(p.rustc, hostWin),
      triple: p.triple,
      rustflags: quote(p.rustflags.join("\x1f"), hostWin),
      args: quoteArgs(p.args, hostWin),
    },
  });
  return out;
}

export interface RustEdgeInputs {
  /**
   * Generated `.rs` files the workspace crates `include!`, and anything else that must exist before a workspace
   * crate compiles (the Windows shim). Order-only: rustc's dep-info names every `include!`d file, so from the
   * second build on exactly the crate that includes a changed file rebuilds.
   */
  codegenInputs: string[];
  codegenOrderOnly: string[];
  /** Fetch stamps of vendored crates: order-only for everything (the plan already required them). */
  vendorStamps: string[];
}

/**
 * Emit every unit's edges and write the unit manifests; sweep artifacts of units no longer in the graph.
 * Returns the root staticlib path.
 */
export function emitRustUnits(n: Ninja, cfg: Config, ctx: ManifestContext, inputs: RustEdgeInputs): string {
  const { graph } = ctx;
  const hostWin = cfg.host.os === "windows";
  mkdirSync(join(graph.dir, "units"), { recursive: true });

  for (const unit of graph.units) {
    const manifest = unitManifest(ctx, unit);
    writeIfChanged(unit.manifestPath, JSON.stringify(manifest, null, 1) + "\n");

    const vars = {
      manifest: quote(unit.manifestPath, hostWin),
      crate: unit.crateName,
      // a ninja `depfile =` binding, read as a path (never part of a command): no shell quoting
      depfile: manifest.depfile ?? "",
      what: "",
    };
    // What rebuilds this unit: the artifacts it names with --extern (rmeta for pipelined lib deps, rlib/dylib
    // otherwise), its build script's output.json, its manifest; sources and `include!`d files come from the depfile.
    const externs = unit.deps
      .filter(d => d.unit.kind !== "build-script" && d.unit.kind !== "build-script-run" && d.unit.kind !== "staticlib")
      .map(d => externPath(unit, d.unit));
    const scriptOut = unit.buildScript !== undefined ? [unit.buildScript.output] : [];
    const common = [unit.manifestPath, ...scriptOut];
    const orderOnly = [
      ...inputs.vendorStamps,
      ...(unit.isLocal ? [...inputs.codegenInputs, ...inputs.codegenOrderOnly] : []),
    ];

    switch (unit.kind) {
      case "lib":
        n.build({
          outputs: [unit.rmeta!],
          rule: "rust_meta",
          inputs: [],
          implicitInputs: [...externs, ...common],
          orderOnlyInputs: orderOnly,
          vars,
        });
        n.build({
          outputs: [unit.output],
          rule: "rust_codegen",
          inputs: [unit.rmeta!],
          vars: { manifest: vars.manifest, crate: vars.crate },
        });
        break;
      case "proc-macro":
      case "build-script":
      case "staticlib": {
        // These link, so beyond the direct `--extern`ed rlibs they read every transitive rlib through `-L`
        // (cargo: a linking unit gets Artifact::All edges to all of them). A direct dependency's rlib being done
        // says nothing about *its* dependencies' rlibs: those edges were released on `.rmeta`.
        const all = transitiveLinkInputs(unit).map(u => u.output);
        const what = unit.kind === "staticlib" ? ` → ${cfg.libPrefix}${unit.crateName}${cfg.libSuffix}` : "";
        n.build({
          outputs: [unit.output],
          rule: "rust_rustc",
          inputs: [],
          implicitInputs: [...new Set([...externs, ...all, ...common])],
          orderOnlyInputs: orderOnly,
          vars: { ...vars, what },
        });
        break;
      }
      case "build-script-run": {
        const compiled = unit.deps.find(d => d.unit.kind === "build-script")!.unit;
        const linksDeps = unit.deps.filter(d => d.unit.kind === "build-script-run").map(d => d.unit.output);
        n.build({
          outputs: [unit.output],
          rule: "rust_build_script",
          inputs: [],
          implicitInputs: [compiled.output, ...linksDeps, unit.manifestPath],
          orderOnlyInputs: orderOnly,
          vars,
        });
        break;
      }
    }
  }

  // Stale artifact removal. Everything a unit writes carries its hash in the name (`libfoo-<hash>.rlib`,
  // `foo-<hash>.d`, `build/foo-<hash>/`, `units/foo-<hash>.json`); a name with a hash no current unit has is a
  // leftover from an earlier plan or flag set. cargo lets these accumulate; here they would also be visible to
  // `-L dependency=` crate lookup, so they go.
  const live = new Set(graph.units.map(u => u.hash));
  const sweep = (dirPath: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dirPath);
    } catch {
      return;
    }
    for (const e of entries) {
      const m = /-([0-9a-f]{16})(?:[./]|$)/.exec(e);
      if (m !== null && !live.has(m[1]!)) rmSync(join(dirPath, e), { recursive: true, force: true });
    }
  };
  for (const platformDir of new Set(
    graph.units.map(u => (u.platform === "host" ? join(graph.dir, "host") : join(graph.dir, u.platform))),
  )) {
    sweep(join(platformDir, "deps"));
    sweep(join(platformDir, "build"));
  }
  sweep(join(graph.dir, "units"));

  n.phony("bun-rust", [graph.root.output]);
  return graph.root.output;
}

export { depfilePath };
export type { RustGraph, RustUnit };
