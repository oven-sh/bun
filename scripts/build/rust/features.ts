/**
 * Features that `bun build --compile --compile-exclude-features` can leave out (src/bun_core/feature.rs).
 *
 * Which crates are a feature's is read off the crate graph. Bun is `bun_runtime` and what it depends on. A crate with
 * `[package.metadata.bun] feature = "lint"` is where a feature starts, and what it depends on and Bun does not is the
 * feature's too. Those crates are compiled with feature-pass.cpp.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Config } from "../config.ts";
import { BuildError } from "../error.ts";
import type { Ninja } from "../ninja.ts";
import { quote } from "../shell.ts";
import type { RustUnit } from "./units.ts";

const source = (cfg: Config) => resolve(cfg.cwd, "scripts", "build", "feature-pass.cpp");
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
}

export function emitFeaturePass(n: Ninja, cfg: Config): void {
  const pass = featurePass(cfg);
  if (pass !== undefined) n.build({ outputs: [pass], rule: "feature_pass", inputs: [source(cfg)] });
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
