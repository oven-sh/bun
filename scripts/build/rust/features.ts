/**
 * Features that `bun build --compile --compile-exclude-features` can leave out (src/bun_core/feature.rs).
 *
 * Which crates are a feature's is read off the crate graph. Bun is `bun_runtime` and what it depends on. A crate with
 * `[package.metadata.bun] feature = "lint"` is where a feature starts, and what it depends on and Bun does not is the
 * feature's too. The C and C++ in the directory of such a crate is the crate's.
 *
 * What the same features need is an island, and has a number. All of it is compiled with feature-pass.cpp, which is given
 * the number.
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

/**
 * The pass, or undefined where it cannot be made or loaded. That Bun has no islands, and says that nothing can be excluded from
 * what it compiles. What CI builds is what ships.
 */
export function featurePass(cfg: Config): string | undefined {
  const canBeMade = cfg.host.os === "linux" && existsSync(join(llvmHeaders(cfg), "llvm", "Plugins", "PassPlugin.h"));
  if (cfg.ci && !canBeMade) {
    throw new BuildError(`feature-pass.cpp cannot be compiled: LLVM's headers are not in ${llvmHeaders(cfg)}`, {
      hint: "The llvm tool of scripts/build/ci-images/spec.ts puts them on the image that builds.",
    });
  }
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
    command: `${cfg.jsRuntime} ${q(resolve(cfg.cwd, "scripts", "build", "check-features.ts"))} $nm $readobj $manifest $exe $out`,
    description: "check that the islands are islands",
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
function numbersOf(root: string, crate: string, features: string[]): string {
  const ids = readFileSync(resolve(root, "src", "bun_core", "feature", "ids.rs"), "utf8");
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

export interface Islands {
  /** The features that need each island, from number 1: `"1;1,2,3;2,3"`. `bun_core::feature` puts it in the executable. */
  table: string;
  of: Map<RustUnit, number>;
}

export function islandsOf(root: string, neededBy: Map<RustUnit, string[]>): Islands {
  const features = new Map([...neededBy].map(([unit, names]) => [unit, numbersOf(root, unit.crateName, names)]));
  const table = [...new Set(features.values())].sort();
  return { table: table.join(";"), of: new Map([...features].map(([unit, it]) => [unit, table.indexOf(it) + 1])) };
}

/** What rustc is given for `unit`: arguments, after everything else, and environment. */
export function featureFlags(
  cfg: Config,
  unit: RustUnit,
  neededBy: Map<RustUnit, string[]>,
  islands: Islands,
): { args: string[]; env: Record<string, string> } {
  const pass = featurePass(cfg);
  if (unit.crateName === "bun_core" && unit.platform !== "host" && pass !== undefined) {
    return { args: [], env: { BUN_FEATURE_ISLANDS: islands.table } };
  }
  const features = neededBy.get(unit);
  if (features === undefined) return { args: [], env: {} };
  return {
    // `#[feature::behind]` asks.
    args: [
      "--cfg",
      "bun_needed_by",
      ...features.flatMap(feature => ["--cfg", `bun_needed_by="${feature}"`]),
      ...(pass !== undefined ? [`-Zllvm-plugins=${pass}`] : []),
    ],
    env: pass !== undefined ? { BUN_ISLAND: String(islands.of.get(unit)) } : {},
  };
}

/** A crate that is a feature's: where it is, what the link takes of it, and its island. */
export interface FeatureCrate {
  directory: string;
  rlib: string;
  island: number;
}

export function featureCrates(islands: Islands): FeatureCrate[] {
  return [...islands.of].map(([unit, island]) => ({
    directory: dirname(unit.pkg.manifest_path),
    rlib: unit.output,
    island,
  }));
}

/** The crate that `source`, a C or C++ file, is of: the one whose directory it is in. */
export function crateOfSource(crates: FeatureCrate[], source: string): FeatureCrate | undefined {
  return crates.find(crate => source.startsWith(crate.directory + sep));
}

/** What clang is given for a file of `crate`, and what it then reads beside the file. */
export function clangFeatureFlags(cfg: Config, crate: FeatureCrate | undefined): { flags: string[]; inputs: string[] } {
  const pass = featurePass(cfg);
  if (crate === undefined || pass === undefined) return { flags: [], inputs: [] };
  const plugin = cfg.windows ? ["-Xclang", `-fpass-plugin=${pass}`] : [`-fpass-plugin=${pass}`];
  return {
    flags: [
      ...["-Xclang", "-load", "-Xclang", pass, ...plugin, "-mllvm", `-bun-island=${crate.island}`],
      ...["-mllvm", `-bun-island-directory=${crate.directory}`],
    ],
    inputs: [pass],
  };
}

/**
 * Returns the stamp of check-features.ts over `exe`, which was linked, and `inputs`, what the link took, each with its island.
 */
export function emitFeatureCheck(
  n: Ninja,
  cfg: Config,
  table: string,
  inputs: Map<string, number | undefined>,
  exe: string,
): string[] {
  if (featurePass(cfg) === undefined || cfg.nm === undefined || cfg.readobj === undefined) return [];
  const manifest = join(cfg.buildDir, "features-checked.manifest");
  writeIfChanged(manifest, `${table}\n` + [...inputs].map(([path, island]) => `${island ?? 0} ${path}\n`).join(""));
  const stamp = join(cfg.buildDir, "features-checked");
  n.build({
    outputs: [stamp],
    rule: "check_features",
    inputs: [...inputs.keys(), exe],
    implicitInputs: [manifest, resolve(cfg.cwd, "scripts", "build", "check-features.ts")],
    vars: {
      nm: quote(cfg.nm, false),
      readobj: quote(cfg.readobj, false),
      manifest: quote(manifest, false),
      exe: quote(exe, false),
    },
  });
  return [stamp];
}
