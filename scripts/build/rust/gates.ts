/**
 * The gate on a crate: `[package.metadata.bun] gate = ["lint", "fmt"]` in its Cargo.toml (src/bun_core/feature.rs says
 * what a gate is). Such a crate is compiled by crate-gate.rs in place of rustc, which is rustc with one answer changed.
 * That is made from the compiler's own crates, the `rustc-dev` component of the toolchain.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Config } from "../config.ts";
import { BuildError } from "../error.ts";
import type { Ninja } from "../ninja.ts";
import { quote } from "../shell.ts";

const source = (cfg: Config) => resolve(cfg.cwd, "scripts", "build", "rust", "crate-gate.rs");

/** Where `rustc-dev` puts the compiler's crates. */
function compilerCrates(cfg: Config): string | undefined {
  if (cfg.rustSysroot === undefined || cfg.rustHostTriple === undefined) return undefined;
  const dir = process.env.BUN_RUSTC_DEV ?? join(cfg.rustSysroot, "lib", "rustlib", cfg.rustHostTriple, "lib");
  return existsSync(dir) && readdirSync(dir).some(f => /^librustc_driver-.*\.rmeta$/.test(f)) ? dir : undefined;
}

/** The driver, or undefined where crates cannot be gated: they are compiled as if they had no gate. */
export function crateGateDriver(cfg: Config): string | undefined {
  const isGatedTarget = (cfg.linux && cfg.abi !== "android") || cfg.darwin || cfg.windows;
  return isGatedTarget && compilerCrates(cfg) !== undefined
    ? join(cfg.buildDir, `rust-crate-gate${cfg.host.exeSuffix}`)
    : undefined;
}

export function registerCrateGateRule(n: Ninja, cfg: Config): void {
  if (crateGateDriver(cfg) === undefined) return;
  const q = (p: string) => quote(p, cfg.host.os === "windows");
  const compiler = join(cfg.rustSysroot!, "lib");
  n.rule("rust_crate_gate", {
    command:
      `${q(cfg.rustc!)} --edition 2024 -O -L ${q(compilerCrates(cfg)!)} -C linker=${q(cfg.hostCc)} ` +
      `-C link-arg=-Wl,-rpath,${q(compiler)} $in -o $out`,
    description: "host-tool $out",
  });
}

export function emitCrateGateDriver(n: Ninja, cfg: Config): void {
  const driver = crateGateDriver(cfg);
  if (driver !== undefined) n.build({ outputs: [driver], rule: "rust_crate_gate", inputs: [source(cfg)] });
}

/** `["lint", "fmt"]` → `"6"`: a bit for each feature, in hex, as in the name of the gate's section. */
export function gateOf(cfg: Config, crate: string, features: string[]): string {
  const ids = readFileSync(resolve(cfg.cwd, "src", "bun_core", "feature", "ids.rs"), "utf8");
  const names = [...(/NAMES: \[&str; \d+\] = \[([^\]]*)\]/.exec(ids)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
    m => m[1]!,
  );
  let gate = 0n;
  for (const feature of features) {
    const index = names.indexOf(feature);
    if (index < 0) throw new BuildError(`${crate}: gate names "${feature}". The features are: ${names.join(", ")}`);
    gate |= 1n << BigInt(index);
  }
  if (gate === 0n) throw new BuildError(`${crate}: an empty gate`);
  return gate.toString(16);
}
