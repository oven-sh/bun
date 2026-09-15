/**
 * Ninja rules and edges for the Rust units (`units.ts`), plus the plan edge
 * (`plan.ts`) that feeds configure.
 *
 * Edges per unit kind — each edge is one rustc (or build script) process, start to exit:
 *   lib               rust_rustc → lib<name>-<hash>.rlib + lib<name>-<hash>.rmeta
 *   proc-macro        rust_rustc → lib<name>-<hash>.so
 *   build-script      rust_rustc → build_script_build-<hash>
 *   build-script-run  rust_build_script → output.json (restat)
 *   staticlib (root)  rust_rustc → libbun_runtime.a
 *
 * Every edge's command is `run.ts <mode> <unit.json>`; the unit manifest
 * (argv/env/cwd) is written at configure with writeIfChanged and is an input
 * of the edge, so a flag change rebuilds exactly the units it touches.
 */

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Config } from "../config.ts";
import { writeIfChanged } from "../fs.ts";
import type { Ninja } from "../ninja.ts";
import { quote } from "../shell.ts";
import { streamPath } from "../stream.ts";
import { type PlanInput, planInputPath, planPath } from "./plan.ts";
import { type ManifestContext, externDeps, externPath, transitiveLinkInputs, unitManifest } from "./units.ts";

const here = import.meta.dirname;
const runScript = resolve(here, "run.ts");
const planScript = resolve(here, "plan.ts");
/** What each build-time entry point loads: an edit to any of these reruns its edges (the convention for every build-time script in this system). */
const runScriptDeps = [runScript, resolve(here, "cargo-env.ts"), resolve(here, "..", "fs.ts")];
const planScriptDeps = [planScript, resolve(here, "toml.ts"), resolve(here, "..", "fs.ts")];

export function registerRustUnitRules(n: Ninja, cfg: Config): void {
  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);
  // run.ts runs under Bun whatever runs configure: it starts once per edge along a dependency chain ~30 crates
  // deep, so runtime startup is on the critical path (bun: ~20 ms, node: ~80 ms).
  const run = `${q(cfg.bun)} ${q(runScript)}`;

  // Depfiles: run.ts rewrites rustc's dep-info (all emitted artifacts as targets, `# env-dep` comments)
  // into `$depfile` with just this edge's outputs. deps=gcc moves it into .ninja_deps.
  n.rule("rust_rustc", {
    command: `${run} rustc $manifest`,
    description: "rustc $crate $what",
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
 * The edge producing `<buildDir>/rust/plan.json`. What to plan (cargo args/env, rustc, triple, rustflags) goes into
 * `rust/plan.input.json` at configure — writeIfChanged, an input of the edge, so a changed argument re-plans.
 * Returns the plan's path (an input of build.ninja's regen edge).
 */
export function emitRustPlan(n: Ninja, cfg: Config, p: RustPlanEdgeInputs): string {
  const hostWin = cfg.host.os === "windows";
  const out = planPath(cfg.buildDir);
  const input = planInputPath(cfg.buildDir);
  mkdirSync(join(cfg.buildDir, "rust"), { recursive: true });
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
   * What must exist before a workspace crate compiles: generated `.rs` files the crates `include!` and the codegen
   * phony. Order-only, through one `rust-codegen-ready` phony: rustc's dep-info names every `include!`d file, so from
   * the second build on exactly the crate that includes a changed file rebuilds.
   */
  codegenOrderOnly: string[];
  /**
   * Stamps of edges whose real product reaches a crate as an undeclared side effect, by the crate that reads it
   * (the Windows shim: bun_install `include_bytes!` the copied .exe, of which only the stamp is a declared
   * output). Implicit inputs of that crate: ninja stats the .exe before the edge producing it runs, so the
   * crate's dep-info entry alone would lag one build behind.
   */
  implicitInputs: Record<string, string[]>;
  /** Fetch stamps of vendored crates: order-only for everything (the plan already required them). */
  vendorStamps: string[];
}

/** Emit every unit's edges and write the unit manifests. Returns the root staticlib path. */
export function emitRustUnits(n: Ninja, ctx: ManifestContext, inputs: RustEdgeInputs): string {
  const { cfg, graph } = ctx;
  const hostWin = cfg.host.os === "windows";
  mkdirSync(join(graph.dir, "units"), { recursive: true });
  n.phony("rust-codegen-ready", inputs.codegenOrderOnly);

  for (const unit of graph.units) {
    const manifest = unitManifest(ctx, unit);
    writeIfChanged(unit.manifestPath, JSON.stringify(manifest, null, 1) + "\n");

    const vars = {
      manifest: quote(unit.manifestPath, hostWin),
      crate: unit.crateName,
      depfile: manifest.depfile, // a ninja `depfile =` binding, read as a path (never part of a command): no shell quoting
      what: "",
    };
    // What rebuilds this unit: the artifacts it names with --extern (metadata rlibs for a library, full rlibs and
    // dylibs for a link), the build-script outputs run.ts reads for it, its manifest, the driver scripts; sources and
    // `include!`d files come from the depfile.
    const externs = externDeps(unit).map(d => externPath(unit, d.unit));
    const scriptOutputs =
      manifest.kind === "build-script-run"
        ? []
        : [
            ...(manifest.buildScriptOutput !== undefined ? [manifest.buildScriptOutput] : []),
            ...manifest.depBuildScriptOutputs,
          ];
    const common = [...scriptOutputs, ...runScriptDeps, ...(inputs.implicitInputs[unit.crateName] ?? [])];
    const orderOnly = [...inputs.vendorStamps, ...(unit.isLocal ? ["rust-codegen-ready"] : [])];

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
          vars: { ...vars, early_output_prefix: "@ninja-early-output@" },
        });
        break;
      case "proc-macro":
      case "build-script":
      case "staticlib": {
        // These link, so beyond the direct `--extern`ed rlibs they read every transitive rlib through `-L`
        // (cargo: a linking unit gets Artifact::All edges to all of them). A direct dependency's rlib being done
        // says nothing about *its* dependencies' rlibs: it was compiled against their metadata rlibs.
        const all = transitiveLinkInputs(unit).map(u => u.output);
        const what = manifest.kind === "staticlib" ? `→ ${cfg.libPrefix}${unit.crateName}${cfg.libSuffix}` : "";
        n.build({
          outputs: [unit.output],
          rule: "rust_rustc",
          inputs: [],
          implicitInputs: [...new Set([...externs, ...all, unit.manifestPath, ...common])],
          orderOnlyInputs: orderOnly,
          vars: { ...vars, what },
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
            ...runScriptDeps,
          ],
          orderOnlyInputs: orderOnly,
          vars,
        });
        break;
    }
  }

  n.phony("bun-rust", [graph.root.output]);
  return graph.root.output;
}
