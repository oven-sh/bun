#!/usr/bin/env bun
/**
 * Runs the mordant lint pack (pinned under `[workspace.metadata.dylint]` in
 * Cargo.toml) over the workspace. Findings are errors; the ones that predate
 * the job are accepted per (lint, file) by mordant-baseline.toml, so a run
 * fails only on findings a change adds. See dylint.toml.
 *
 *   bun run rust:mordant                            # what CI runs
 *   MORDANT_BASELINE_WRITE=1 bun run rust:mordant   # rewrite the baseline
 *
 * Needs `cargo install cargo-dylint dylint-link`. Mordant is built with, and
 * lints this workspace using, its own pinned nightly, so the first run also
 * installs that toolchain.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Lints this repo has decided not to act on. Everything else in the pack is
// on; add a lint here only with a reason.
const off = [
  // "list the variants instead of `_`": a per-site style call, ~500 today.
  "wildcard_local_enum",
  // Structs with several bools are nearly all option bags here; the state
  // machines among them were found by hand once and are not worth the volume.
  "flag_cluster",
  // Most names it flags are real, on the C++/JS side or in a sibling crate.
  "stale_safety_comment",
  // Variants only ever tested through `!=` / `_`; checked, none were bugs.
  "unread_error_variant",
  // "make the guard a type": style.
  "guard_flag",
];

const rustflags = [
  // Mordant's nightly is older than rust-toolchain.toml's, so `#[allow]`s of
  // lints added since then are unknown to it.
  "-A unknown_lints",
  ...off.map(lint => `-A ${lint}`),
  process.env.DYLINT_RUSTFLAGS ?? "",
].join(" ");

if (spawnSync("cargo", ["dylint", "--version"], { stdio: "ignore" }).status !== 0) {
  console.error("cargo-dylint is not installed; run: cargo install cargo-dylint dylint-link");
  process.exit(1);
}

// The crates' build.rs files include!() generated sources from
// build/debug/codegen and lol_html is a path dependency under vendor/; the
// build knows how to produce both, so ask it for just those targets.
const prep = spawnSync("bun", ["scripts/build.ts", "--quiet", "--target=codegen", "--target=clone-lolhtml"], {
  stdio: "inherit",
});
if (prep.status !== 0) process.exit(prep.status ?? 1);

// cargo-dylint builds each `[workspace.metadata.dylint]` entry out of cargo's
// checkout of its rev (~/.cargo/git/checkouts/...) into
// <target>/dylint/libraries/<toolchain>/, the same target dir whatever the rev.
// Cargo treats sources under $CARGO_HOME/git as immutable and the rev is not in
// the fingerprint, so after a bump the library built from the previous rev
// still counts as fresh. Remember what the directory was built from and start
// over when that changes. (The workspace itself does get re-linted: the driver
// feeds the metadata and the library bytes into rustc's dependency tracking.)
const metadata = spawnSync("cargo", ["metadata", "--no-deps", "--format-version", "1"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
  // ~400 KB for this workspace today, against spawnSync's default cap of 1 MB.
  maxBuffer: 1 << 26,
});
if (metadata.status !== 0) process.exit(metadata.status ?? 1);
const workspace = JSON.parse(metadata.stdout);
const libraries = join(workspace.target_directory, "dylint", "libraries");
const builtFrom = join(libraries, "built-from.json");
const pinned = JSON.stringify(workspace.metadata?.dylint ?? null);
if (!existsSync(builtFrom) || readFileSync(builtFrom, "utf8") !== pinned) {
  if (existsSync(libraries)) {
    console.error(`rebuilding ${libraries}: it was not built from the current [workspace.metadata.dylint]`);
  }
  rmSync(libraries, { recursive: true, force: true });
  mkdirSync(libraries, { recursive: true });
  // Written before the build on purpose: it says which entries the directory
  // is for; whether their builds finished is cargo's own bookkeeping.
  writeFileSync(builtFrom, pinned);
}

const r = spawnSync("cargo", ["dylint", "--all", "--workspace", "--keep-going", "--", "--keep-going"], {
  stdio: "inherit",
  env: { ...process.env, DYLINT_RUSTFLAGS: rustflags },
});
process.exit(r.status ?? 1);
