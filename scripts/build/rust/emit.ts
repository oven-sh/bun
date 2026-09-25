/**
 * Ninja rules and edges for the Rust units (`units.ts`), plus the plan edge
 * (`plan.ts`) that feeds configure.
 *
 * Edges per unit kind — each edge is one rustc (or build script) process, start to exit:
 *   lib               rust_rustc → lib<name>-<hash>.rlib + lib<name>-<hash>.rmeta
 *   proc-macro        rust_rustc → lib<name>-<hash>.so
 *   build-script      rust_rustc → build_script_build-<hash>
 *   build-script-run  rust_build_script → output.json (restat)
 *   bin (root)        rust_rustc → <crate>.exe + its copy under the target's name (the Windows shim)
 *
 * Every edge's command is `run.ts <mode> <unit.json>`; the unit manifest
 * (argv/env/cwd) is written at configure with writeIfChanged and is an input
 * of the edge, so a flag change rebuilds exactly the units it touches.
 */

import { basename, resolve } from "node:path";
import type { Config } from "../config.ts";
import { assert } from "../error.ts";
import { writeIfChanged } from "../fs.ts";
import type { Ninja } from "../ninja.ts";
import { quote } from "../shell.ts";
import { streamPath } from "../stream.ts";
import { type PlanInput, planInputPath, planPath } from "./plan.ts";
import { type ManifestContext, externDeps, externPaths, transitiveLinkInputs, unitManifest } from "./units.ts";

const here = import.meta.dirname;
const runScript = resolve(here, "run.ts");
const planScript = resolve(here, "plan.ts");
/**
 * The scripts whose edit reruns an edge. A rustc edge names run.ts alone: what run.ts imports (fs.ts, cargo-env.ts,
 * error.ts) it uses for build scripts and for reporting, not for what rustc writes, and fs.ts is shared by the whole
 * build system — an edit to it must not recompile every crate (fetch edges name only fetch-cli.ts for the same
 * reason). Build-script runs and the planner rerun in moments, so they name everything they load.
 */
const rustcScriptDeps = [runScript];
const buildScriptRunDeps = [
  runScript,
  resolve(here, "cargo-env.ts"),
  resolve(here, "..", "fs.ts"),
  resolve(here, "..", "error.ts"),
];
const planScriptDeps = [
  planScript,
  resolve(here, "toml.ts"),
  resolve(here, "..", "fs.ts"),
  resolve(here, "..", "error.ts"),
];

export function registerRustUnitRules(n: Ninja, cfg: Config): void {
  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);
  // run.ts runs under Bun whatever runs configure: it starts once per edge along a dependency chain ~30 crates
  // deep, so runtime startup is on the critical path (bun: ~20 ms, node: ~80 ms).
  const run = `${q(cfg.bun)} ${q(runScript)}`;

  // Depfiles: run.ts rewrites rustc's dep-info (all emitted artifacts as targets, `# env-dep` comments) into the
  // edge's depfile with just this edge's outputs. deps=gcc moves it into .ninja_deps. The depfile is named per edge
  // (it is not derived from $out), so it is a binding of each build statement, not of the rule.
  n.rule("rust_rustc", {
    command: `${run} rustc $manifest`,
    description: "rustc $crate $what",
    deps: "gcc",
  });
  n.rule("rust_build_script", {
    command: `${run} build-script $manifest`,
    description: "build.rs $crate",
    deps: "gcc",
    // output.json is rewritten only when the directives change, so an unchanged rerun rebuilds nothing downstream.
    restat: true,
  });
  // Through stream.ts like the other cargo/dep edges: cargo's registry and crate-download progress streams to the
  // terminal (it has a TTY UI worth the console pool on a cold cache), and stream.ts points cargo at the system CA
  // bundle (CARGO_HTTP_CAINFO) the way the environment expects.
  n.rule("rust_plan", {
    command: `${cfg.jsRuntime} ${q(streamPath)} cargo --console ${cfg.jsRuntime} ${q(planScript)} $planinput $plan`,
    description: "cargo plan → $plan",
    // plan.json is written only if the graph changed; then build.ninja (which depends on it) is regenerated.
    restat: true,
    pool: "console",
  });
}

export interface RustPlanEdgeInputs {
  input: PlanInput;
  /** cargo and rustc binaries, Cargo.lock, workspace manifests, rust-toolchain.toml, vendored-crate fetch stamps */
  inputs: string[];
}

/**
 * The edge producing `<dir>/plan.json` for one graph (`dir`: its directory under the build directory). What to plan
 * (cargo args/env, rustc, triple, rustflags) goes into `<dir>/plan.input.json` at configure — writeIfChanged, an
 * input of the edge, so a changed argument re-plans. Returns the plan's path (an input of build.ninja's regen edge).
 */
export function emitRustPlan(n: Ninja, cfg: Config, dir: string, p: RustPlanEdgeInputs): string {
  const hostWin = cfg.host.os === "windows";
  const out = planPath(dir);
  const input = planInputPath(dir);
  writeIfChanged(input, JSON.stringify(p.input, null, 2) + "\n");
  n.build({
    outputs: [out],
    rule: "rust_plan",
    inputs: [input],
    implicitInputs: [...p.inputs, ...planScriptDeps],
    vars: { planinput: quote(input, hostWin), plan: quote(out, hostWin) },
  });
  return out;
}

export interface RustEdgeInputs {
  /**
   * What must exist before a workspace crate of this graph compiles (the `rust-codegen-ready` phony: generated
   * `.rs` files the crates `include!`). Order-only: rustc's dep-info names every `include!`d file, so from the
   * second build on exactly the crate that includes a changed file rebuilds.
   */
  localOrderOnly: string[];
  /**
   * Build products a package reads that another edge makes, by package name (the Windows shim's executable, which
   * bun_install `include_bytes!`). Implicit inputs of every edge of the package, its build script's run included:
   * the dep-info entry alone would let the first build compile the crate before the file exists.
   */
  implicitInputs: Record<string, string[]>;
  /** Fetch stamps of vendored crates: order-only for everything (the plan already required them). */
  vendorStamps: string[];
  /** Validations of the root's edge: built whenever the root is, without being an input of anything. */
  rootValidations: string[];
}

/** Emit every unit's edges of one graph and write the unit manifests. */
export function emitRustUnits(n: Ninja, ctx: ManifestContext, inputs: RustEdgeInputs): void {
  const { cfg, graph } = ctx;
  const hostWin = cfg.host.os === "windows";
  for (const name of Object.keys(inputs.implicitInputs)) {
    assert(
      graph.units.some(u => u.pkg.name === name),
      `rust edges: implicit inputs are given for package ${name}, which is not in the graph`,
      { hint: "The package that reads the file was renamed or no longer builds here; update the caller (rust.ts)." },
    );
  }

  for (const unit of graph.units) {
    const manifest = unitManifest(ctx, unit);
    writeIfChanged(unit.manifestPath, JSON.stringify(manifest, null, 1) + "\n");

    const vars = { manifest: quote(unit.manifestPath, hostWin), crate: unit.crateName };
    const depfile = manifest.depfile; // read by ninja as a path, never part of a command: no shell quoting
    // What rebuilds this unit: the artifacts it names with --extern (`.rmeta`s for a library, `.rlib`s and
    // dylibs for a link), the build-script outputs run.ts reads for it, its manifest, the driver scripts; sources and
    // `include!`d files come from the depfile.
    const externs = externDeps(unit).flatMap(d => externPaths(unit, d.unit));
    const scriptOutputs =
      manifest.kind === "build-script-run"
        ? []
        : [
            ...(manifest.buildScriptOutput !== undefined ? [manifest.buildScriptOutput] : []),
            ...manifest.depBuildScriptOutputs,
          ];
    const packageInputs = inputs.implicitInputs[unit.pkg.name] ?? [];
    const common = [...scriptOutputs, ...rustcScriptDeps, ...packageInputs];
    const orderOnly = [...inputs.vendorStamps, ...(unit.isLocal ? inputs.localOrderOnly : [])];

    switch (manifest.kind) {
      case "lib":
        // One rustc, two outputs. Dependent libraries read only the `.rmeta` (type information), which rustc writes
        // long before it has generated the `.rlib`'s code. `early_output_prefix` asks ninja to listen for the
        // command announcing an output early: oven-sh/ninja then exports the prefix to the command
        // (NINJA_EARLY_OUTPUT_PREFIX), run.ts announces the `.rmeta` when rustc reports it, and dependents start
        // while this command is still running — cargo's pipelining. A ninja without the feature ignores the
        // binding (it must sit on the build statement for that) and releases both outputs when rustc exits:
        // same graph, no pipelining.
        n.build({
          outputs: [unit.output, unit.rmeta!],
          rule: "rust_rustc",
          inputs: [],
          implicitInputs: [...externs, unit.manifestPath, ...common],
          orderOnlyInputs: orderOnly,
          vars: { ...vars, what: "" },
          depfile,
          earlyOutputPrefix: "@ninja-early-output@",
        });
        break;
      case "proc-macro":
      case "build-script":
      case "bin": {
        // These link, so beyond the direct `--extern`ed rlibs they read every transitive rlib (and its `.rmeta`,
        // where the metadata is) through `-L`
        // (cargo: a linking unit gets Artifact::All edges to all of them). A direct dependency's rlib being done
        // says nothing about *its* dependencies' rlibs: it was compiled against their `.rmeta`s.
        const all = transitiveLinkInputs(unit).flatMap(u => (u.rmeta !== undefined ? [u.output, u.rmeta] : [u.output]));
        const what = manifest.kind === "bin" ? `→ ${basename(unit.output)}` : "";
        n.build({
          outputs: [unit.output, ...(manifest.binDestination !== undefined ? [manifest.binDestination] : [])],
          rule: "rust_rustc",
          inputs: [],
          implicitInputs: [...new Set([...externs, ...all, unit.manifestPath, ...common])],
          orderOnlyInputs: orderOnly,
          ...(unit === graph.root && inputs.rootValidations.length > 0 ? { validations: inputs.rootValidations } : {}),
          vars: { ...vars, what },
          depfile,
        });
        break;
      }
      case "build-script-run":
        n.build({
          outputs: [unit.output],
          rule: "rust_build_script",
          inputs: [],
          implicitInputs: [
            manifest.script.program,
            ...manifest.script.linksDeps.map(d => d.output),
            unit.manifestPath,
            ...buildScriptRunDeps,
            ...packageInputs,
          ],
          orderOnlyInputs: orderOnly,
          vars,
          depfile,
        });
        break;
    }
  }
}
