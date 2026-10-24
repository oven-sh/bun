#!/usr/bin/env bun
/**
 * `cargo clippy` over the workspace for every target in `rustLintTargets`: what
 * the `cargo clippy` job runs. Code under `cfg(windows)` or
 * `cfg(target_os = "macos")` is only linted when its target is. Clippy never
 * links, so any host can lint every target once its std is installed.
 *
 * Usage:
 *   bun run rust:clippy                                  # every target
 *   bun run rust:clippy --target x86_64-pc-windows-msvc  # only the ones named
 *   bun run rust:clippy --message-format=short           # other args go to `cargo clippy`
 *
 * Read what `--fix` did before keeping it. Clippy sees the code after `cfg`
 * stripping, so a fix for one target can delete what another target needs: an
 * arm that is `cfg!(unix)`, a `#[cfg(not(windows))]` block, a clamp that is a
 * no-op for this target's integer type.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { rustLintTargets } from "./build/rust.ts";

const repo = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const targets = args.some(arg => arg === "--target" || arg.startsWith("--target=")) ? [] : rustLintTargets;

function run(cmd: string, args: string[]) {
  console.log(`\x1b[36m[clippy]\x1b[0m ${cmd} ${args.join(" ")}`);
  return spawnSync(cmd, args, { stdio: "inherit", cwd: repo });
}

if (targets.length > 0) {
  // Idempotent, and a fraction of a second once they are there. No rustup
  // (a distro's cargo): the targets' std is the user's to provide.
  const added = run("rustup", ["target", "add", ...targets]);
  if (added.error === undefined && added.status !== 0) process.exit(added.status ?? 1);
}

const clippy = ["clippy", "--workspace", "--no-deps", "--keep-going"];
process.exit(run("cargo", [...clippy, ...targets.flatMap(target => ["--target", target]), ...args]).status ?? 1);
