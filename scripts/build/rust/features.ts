/**
 * Features that `bun build --compile --compile-exclude-features` can leave out (src/bun_core/feature.rs).
 *
 * Which crates are a feature's is read off the crate graph. Bun is `bun_runtime` and what it depends on. A crate with
 * `[package.metadata.bun] feature = "lint"` is where a feature starts, and what it depends on and Bun does not is the
 * feature's too. The C and C++ in the directory of such a crate is the crate's. All of it is compiled with
 * feature-pass.cpp.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { Config } from "../config.ts";
import { BuildError } from "../error.ts";
import { writeIfChanged } from "../fs.ts";
import type { Ninja } from "../ninja.ts";
import { quote } from "../shell.ts";
import type { RustUnit } from "./units.ts";

export const featurePassSource = (root: string) => resolve(root, "scripts", "build", "feature-pass.cpp");
/** rustc and clang are the same LLVM, which cross-language LTO takes anyway. */
const llvmHeaders = (cfg: Config) => join(dirname(dirname(cfg.hostCxx)), "include");

/** The pass, or undefined where it cannot be made or loaded. A feature then stays where everything else is, and only its doors are shut. */
export function featurePass(cfg: Config): string | undefined {
  const canBeMade = cfg.host.os === "linux" && existsSync(join(llvmHeaders(cfg), "llvm", "Plugins", "PassPlugin.h"));
  return canBeMade ? join(cfg.buildDir, "feature-pass.so") : undefined;
}

export function registerFeaturePassRule(n: Ninja, cfg: Config): void {
  if (featurePass(cfg) === undefined) return;
  const q = (p: string) => quote(p, false);
  n.rule("feature_pass", {
    command: `${q(cfg.hostCxx)} -std=c++17 -O2 -fPIC -shared -fno-rtti -fno-exceptions -I${q(llvmHeaders(cfg))} $in -o $out`,
    description: "host-plugin $out",
  });
  n.rule("check_features", {
    command: `${cfg.jsRuntime} ${q(resolve(cfg.cwd, "scripts", "build", "check-features.ts"))} $nm $manifest $out`,
    description: "check that nothing names what a feature can take with it",
  });
}

export function emitFeaturePass(n: Ninja, cfg: Config): void {
  const pass = featurePass(cfg);
  if (pass !== undefined) n.build({ outputs: [pass], rule: "feature_pass", inputs: [featurePassSource(cfg.cwd)] });
}

function closure(from: RustUnit): Set<RustUnit> {
  const seen = new Set<RustUnit>();
  const visit = (unit: RustUnit): void => {
    if (seen.has(unit)) return;
    seen.add(unit);
    for (const dep of unit.deps) visit(dep.unit);
  };
  visit(from);
  return seen;
}

/** For each unit that is a feature's: the features that need it. `root` depends on Bun and on where each feature starts. */
export function featuresThatNeed(units: RustUnit[], root: RustUnit): Map<RustUnit, string[]> {
  const needs = new Map<RustUnit, string[]>();
  const bun = units.find(u => u.crateName === "bun_runtime" && u.platform !== "host");
  if (bun === undefined || bun === root) return needs;
  const isBun = closure(bun);
  for (const start of units.filter(u => u.pkg.feature !== null && u.kind === "lib" && u.platform !== "host")) {
    if (isBun.has(start)) throw new BuildError(`bun_runtime depends on ${start.crateName}, where a feature starts`);
    for (const unit of closure(start)) {
      if (!isBun.has(unit) && unit.platform !== "host" && unit.kind === "lib") {
        needs.set(unit, [...(needs.get(unit) ?? []), start.pkg.feature!]);
      }
    }
  }
  for (const unit of closure(root)) {
    if (unit !== root && !isBun.has(unit) && !needs.has(unit) && unit.platform !== "host" && unit.kind === "lib") {
      throw new BuildError(`${unit.crateName} is neither something bun_runtime depends on nor part of a feature`);
    }
  }
  return needs;
}

/** `["lint", "fmt"]` → `"2,3"` */
function numbersOf(cfg: Config, crate: string, features: string[]): string {
  const ids = readFileSync(resolve(cfg.cwd, "src", "bun_core", "feature", "ids.rs"), "utf8");
  const names = [...(/NAMES: \[&str; \d+\] = \[([^\]]*)\]/.exec(ids)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
    m => m[1]!,
  );
  const numbers = features.map(feature => {
    const index = names.indexOf(feature);
    if (index < 0) throw new BuildError(`${crate}: there is no feature "${feature}". There are: ${names.join(", ")}`);
    return index + 1;
  });
  return numbers.sort((a, b) => a - b).join(",");
}

/** What rustc is given for a crate that `features` need: arguments, after everything else, and environment. */
export function featureFlags(
  cfg: Config,
  crate: string,
  features: string[] | undefined,
): { args: string[]; env: Record<string, string> } {
  if (features === undefined) return { args: [], env: {} };
  const pass = featurePass(cfg);
  return {
    // `#[feature::behind]` asks.
    args: [
      "--cfg",
      "bun_needed_by",
      ...features.flatMap(feature => ["--cfg", `bun_needed_by="${feature}"`]),
      ...(pass !== undefined ? [`-Zllvm-plugins=${pass}`] : []),
    ],
    env: pass !== undefined ? { BUN_FEATURES: numbersOf(cfg, crate, features) } : {},
  };
}

/** A crate that is a feature's: where it is, what the link takes of it, and the features that need it, "2,3". */
export interface FeatureCrate {
  directory: string;
  rlib: string;
  features: string;
}

export function featureCrates(cfg: Config, neededBy: Map<RustUnit, string[]>): FeatureCrate[] {
  return [...neededBy].map(([unit, features]) => ({
    directory: dirname(unit.pkg.manifest_path),
    rlib: unit.output,
    features: numbersOf(cfg, unit.crateName, features),
  }));
}

/** The features that need `source`, a C or C++ file: those of the crate whose directory it is in. */
export function featuresOfSource(crates: FeatureCrate[], source: string): string | undefined {
  return crates.find(crate => source.startsWith(crate.directory + sep))?.features;
}

/** What clang is given for a file that `features` need, and what it then reads beside the file. */
export function clangFeatureFlags(cfg: Config, features: string | undefined): { flags: string[]; inputs: string[] } {
  const pass = featurePass(cfg);
  if (features === undefined || pass === undefined) return { flags: [], inputs: [] };
  const plugin = cfg.windows ? ["-Xclang", `-fpass-plugin=${pass}`] : [`-fpass-plugin=${pass}`];
  return {
    flags: ["-Xclang", "-load", "-Xclang", pass, ...plugin, "-mllvm", `-bun-features=${features}`],
    inputs: [pass],
  };
}

/** Returns the stamp of check-features.ts over `inputs`, what the link takes, each with the features that need it. */
export function emitFeatureCheck(n: Ninja, cfg: Config, inputs: Map<string, string | undefined>): string[] {
  if (featurePass(cfg) === undefined || cfg.nm === undefined) return [];
  const manifest = join(cfg.buildDir, "features-checked.manifest");
  writeIfChanged(manifest, [...inputs].map(([path, features]) => `${features ?? "-"} ${path}\n`).join(""));
  const stamp = join(cfg.buildDir, "features-checked");
  n.build({
    outputs: [stamp],
    rule: "check_features",
    inputs: [...inputs.keys()],
    implicitInputs: [manifest, resolve(cfg.cwd, "scripts", "build", "check-features.ts")],
    vars: { nm: quote(cfg.nm, false), manifest: quote(manifest, false) },
  });
  return [stamp];
}
