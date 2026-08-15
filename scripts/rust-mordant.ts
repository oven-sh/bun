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
  // The workspace denies warnings; a finding over the baseline should be
  // reported (and fail the run below), not abort the crate and hide the rest.
  "--cap-lints warn",
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

const r = spawnSync("cargo", ["dylint", "--all", "--workspace", "--keep-going", "--", "--keep-going"], {
  stdio: ["inherit", "inherit", "pipe"],
  env: { ...process.env, DYLINT_RUSTFLAGS: rustflags },
  maxBuffer: 1 << 28,
});
const stderr = r.stderr?.toString() ?? "";
process.stderr.write(stderr);
if (r.status !== 0) process.exit(r.status ?? 1);
// Cargo's own summary lines ("warning: `crate` (lib) generated N warnings")
// are not findings; anything else at warning level came from a lint.
const findings = stderr
  .split("\n")
  .filter(l => /^warning: /.test(l) && !/generated \d+ warnings?/.test(l) && !/^warning: build failed/.test(l));
if (findings.length > 0 && !process.env.MORDANT_BASELINE_WRITE) {
  console.error(
    `\n${findings.length} finding(s) over mordant-baseline.toml; fix them or regenerate the baseline (MORDANT_BASELINE_WRITE=1 bun run rust:mordant).`,
  );
  process.exit(1);
}
