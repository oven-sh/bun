/**
 * Shared setup for the scripts that run cargo on individual crates
 * (`rust-miri.ts`, `rust-test.ts`).
 *
 * `bun_core/build.rs` needs `build_options.rs`, and cargo can't resolve the
 * workspace at all until `vendor/lolhtml/` (a path dep) exists. Both come from
 * the configure step, which is a no-op when already done.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const repo = resolve(import.meta.dirname, "..");

const buildOptionsRs = resolve(repo, "build/debug/codegen/build_options.rs");
const lolhtmlCargo = resolve(repo, "vendor/lolhtml/Cargo.toml");

export function cargoWorkspaceConfigured(): boolean {
  return existsSync(buildOptionsRs) && existsSync(lolhtmlCargo);
}

export function run(cmd: string, args: string[], opts: Parameters<typeof spawnSync>[2] = {}) {
  return spawnSync(cmd, args, { stdio: "inherit", cwd: repo, ...opts });
}

/** Configures the tree if needed; exits the process when that does not produce what cargo needs. */
export function ensureCargoWorkspace(): void {
  if (cargoWorkspaceConfigured()) return;

  console.log("\x1b[36m[setup]\x1b[0m bun run build --configure-only");
  if (run("bun", ["run", "build", "--configure-only"]).status !== 0) process.exit(1);
  if (!existsSync(lolhtmlCargo) && run("ninja", ["-C", "build/debug", "clone-lolhtml"]).status !== 0) {
    process.exit(1);
  }
  // Re-check: configure can succeed without producing these (e.g. partial
  // checkout, ninja target rename). Fail fast instead of letting cargo
  // produce a confusing workspace-resolution error.
  for (const [path, hint] of [
    [buildOptionsRs, "bun run build --configure-only"],
    [lolhtmlCargo, "ninja -C build/debug clone-lolhtml"],
  ] as const) {
    if (!existsSync(path)) {
      console.error(`\x1b[31m[error]\x1b[0m ${path} still missing after setup; try: ${hint}`);
      process.exit(1);
    }
  }
}
