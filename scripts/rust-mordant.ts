#!/usr/bin/env bun
/**
 * `cargo mordant` over the workspace for every target the `mordant` job
 * checks. This file is the one place that names them: the job, `bun run
 * rust:mordant` and `bun run rust:mordant:baseline` all come through here.
 *
 * Several targets in one run, because `unused_pub` counts a use only from a
 * unit the run builds: a `pub fn` whose one caller is `#[cfg(windows)]` is
 * unused to a Linux-only run. It also puts the Windows- and macOS-only code
 * in front of the other lints. `cargo check` never links, so any host can
 * check every target once its std is installed.
 *
 * Usage:
 *   bun run rust:mordant               # lint; findings over the baseline are warnings
 *   bun run rust:mordant -p bun_paths  # extra args go to `cargo mordant`
 *   bun run rust:mordant:baseline      # regenerate mordant-baseline.toml
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");

// Once any `--target` is given, cargo checks only the targets listed, so the
// Linux one is named too. One target per OS: a second Windows or macOS
// target would lint the same `cfg(windows)` / `cfg(target_os = "macos")` code
// again for the few dozen arch gates.
const TARGETS = ["x86_64-unknown-linux-gnu", "x86_64-pc-windows-msvc", "aarch64-apple-darwin"];

// Mordant's nightly is older than rust-toolchain.toml's, so `#[allow]`s of
// lints added since then are unknown to it.
const RUSTFLAGS = "-A unknown_lints";

/** The nightly mordant is built with, which is the pin next to `MORDANT_REV` in the job. */
const toolchain =
  process.env.MORDANT_TOOLCHAIN ??
  /^\s*MORDANT_TOOLCHAIN: (\S+)/m.exec(readFileSync(join(repo, ".github/workflows/rust-lints.yml"), "utf8"))?.[1];
if (toolchain === undefined) {
  console.error("rust-mordant: no MORDANT_TOOLCHAIN in .github/workflows/rust-lints.yml");
  process.exit(1);
}

function run(cmd: string, args: string[], env: Record<string, string> = {}): number {
  console.log(`\x1b[36m[mordant]\x1b[0m ${cmd} ${args.join(" ")}`);
  return spawnSync(cmd, args, { stdio: "inherit", cwd: repo, env: { ...process.env, ...env } }).status ?? 1;
}

function mordant(targets: string[], extra: string[], env: Record<string, string> = {}): number {
  const args = [`+${toolchain}`, "mordant", "--workspace", ...targets.flatMap(t => ["--target", t]), ...extra];
  return run("cargo", args, { MORDANT_RUSTFLAGS: RUSTFLAGS, ...env });
}

// Idempotent, and a fraction of a second once they are there.
if (run("rustup", ["target", "add", "--toolchain", toolchain, ...TARGETS]) !== 0) process.exit(1);

const args = process.argv.slice(2);
if (!args.includes("--baseline")) {
  rmSync(join(repo, "target/mordant/over-baseline.txt"), { force: true });
  process.exit(mordant(TARGETS, ["--keep-going", ...args]));
}

// Write mode replaces a crate's section from every rustc process, and a run
// over several targets has one process per crate per target: the last one to
// finish wins, and an entry only another target has is lost. So each target
// writes a baseline of its own, and a count is the largest any target
// recorded, which is what every process of a later run is held to. `unused_pub`
// is the other way round: only a run over all the targets sees every use, and
// `cargo mordant` writes its entries itself, once, after the build.
type Doc = Record<string, Record<string, number>>;
const config = readFileSync(join(repo, "dylint.toml"), "utf8");
const scratch = "target/mordant/baseline";
rmSync(join(repo, scratch), { recursive: true, force: true });
mkdirSync(join(repo, scratch), { recursive: true });

function write(name: string, targets: string[]): Doc {
  const file = `${scratch}/${name}.toml`;
  const toml = config.replace(/^baseline = .*$/m, `baseline = ${JSON.stringify(file)}`);
  if (toml === config) {
    console.error("rust-mordant: dylint.toml names no baseline");
    process.exit(1);
  }
  if (mordant(targets, [], { MORDANT_TOML: toml, MORDANT_BASELINE_WRITE: "1" }) !== 0) process.exit(1);
  // No file: nothing to record for these targets.
  return existsSync(join(repo, file)) ? (Bun.TOML.parse(readFileSync(join(repo, file), "utf8")) as Doc) : {};
}

const merged: Doc = {};
const record = (section: string, key: string, count: number) => {
  (merged[section] ??= {})[key] = Math.max(merged[section][key] ?? 0, count);
};
for (const target of TARGETS) {
  for (const [section, entries] of Object.entries(write(target, [target]))) {
    for (const [key, count] of Object.entries(entries)) {
      if (!key.startsWith("unused_pub:")) record(section, key, count);
    }
  }
}
for (const [section, entries] of Object.entries(write("all", TARGETS))) {
  for (const [key, count] of Object.entries(entries)) {
    if (key.startsWith("unused_pub:")) record(section, key, count);
  }
}

// As mordant writes it: sections and keys in byte order, a blank line between sections.
const text = Object.keys(merged)
  .sort()
  .map(section => {
    const entries = merged[section];
    const lines = Object.keys(entries)
      .sort()
      .map(key => `${JSON.stringify(key)} = ${entries[key]}`);
    // A binary's section is `crate (bin name)`, which is not a bare key.
    const header = /^[A-Za-z0-9_-]+$/.test(section) ? section : JSON.stringify(section);
    return `[${header}]\n${lines.join("\n")}\n`;
  })
  .join("\n");
writeFileSync(join(repo, "mordant-baseline.toml"), text);
console.log(`\x1b[36m[mordant]\x1b[0m wrote mordant-baseline.toml (${Object.keys(merged).length} sections)`);
