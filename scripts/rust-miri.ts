#!/usr/bin/env bun
/**
 * `cargo miri test` for the crates Miri can interpret end to end.
 *
 * Miri interprets MIR and catches UB (use-after-free, out-of-bounds,
 * uninit reads, data races, aliasing violations) at runtime. It cannot call
 * foreign functions beyond the libc subset it ships shims for, so this only
 * covers the (nearly) pure-Rust corner of the workspace — which is also where
 * `unsafe` density is highest.
 *
 * Aliasing model: `-Zmiri-tree-borrows`, not the default Stacked Borrows.
 * Stacked Borrows invalidates every raw pointer derived from `&mut self` the
 * moment a later `&mut self` is formed — which is the entire premise of
 * `HiveArray`, `MultiArrayList`, the slot pools, etc. (claim a stable
 * `*mut T`, mutate the container, deref the pointer afterward). Tree Borrows
 * is the candidate replacement spec, allows that pattern, and still catches
 * the bugs we care about.
 *
 * Miri never links, so it cannot tell when a crate's tests start reaching a
 * symbol only the full bun binary defines; rust-test.ts (`bun run rust:test`)
 * runs the same crate set (MIRI_CRATES in rust-workspace.ts) natively for that.
 *
 * Usage:
 *   bun run rust:miri              # default crate set, crates run concurrently
 *   bun run rust:miri -p bun_foo   # extra args go straight to one `cargo miri test`
 */

import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { MIRI_CRATES, ensureConfigured, repo, run } from "./rust-workspace.ts";

ensureConfigured();

const env = {
  ...process.env,
  MIRIFLAGS: ["-Zmiri-tree-borrows", process.env.MIRIFLAGS ?? ""].join(" ").trim(),
};

// Explicit args: one plain `cargo miri test`, output straight through.
const extraArgs = process.argv.slice(2);
if (extraArgs.length > 0) {
  console.log(`\x1b[36m[miri]\x1b[0m cargo miri test ${extraArgs.join(" ")}`);
  process.exit(run("cargo", ["miri", "test", ...extraArgs], { env }).status ?? 1);
}

// Default set: Miri interprets one test at a time per process, so a single
// `cargo miri test -p a -p b ...` is serial end to end. Build everything once,
// then run one `cargo miri test -p <crate>` per crate concurrently.
const allCrates = MIRI_CRATES.flatMap(c => ["-p", c]);
console.log(`\x1b[36m[miri]\x1b[0m cargo miri test --no-run ${allCrates.join(" ")}`);
if (run("cargo", ["miri", "test", "--no-run", ...allCrates], { env }).status !== 0) process.exit(1);

type Result = { crate: string; ok: boolean; seconds: number; output: string };

function testCrate(crate: string): Promise<Result> {
  return new Promise(done => {
    const started = Date.now();
    const chunks: Buffer[] = [];
    const child = spawn("cargo", ["miri", "test", "-p", crate, "--color", "always"], { cwd: repo, env });
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.stderr.on("data", chunk => chunks.push(chunk));
    child.on("close", code =>
      done({ crate, ok: code === 0, seconds: (Date.now() - started) / 1000, output: Buffer.concat(chunks).toString() }),
    );
  });
}

const width = Math.max(1, Math.min(availableParallelism(), MIRI_CRATES.length));
console.log(`\x1b[36m[miri]\x1b[0m ${MIRI_CRATES.length} crates, ${width} at a time`);
const queue = [...MIRI_CRATES];
const results: Result[] = [];
const inActions = !!process.env.GITHUB_ACTIONS;

async function worker() {
  for (let crate = queue.shift(); crate; crate = queue.shift()) {
    const result = await testCrate(crate);
    results.push(result);
    const status = result.ok ? "\x1b[32mok\x1b[0m" : "\x1b[31mFAILED\x1b[0m";
    console.log(`\x1b[36m[miri]\x1b[0m ${result.crate} ${status} ${result.seconds.toFixed(0)}s`);
    if (!result.ok || !inActions) {
      console.log(result.output);
    } else {
      console.log(`::group::${result.crate} output\n${result.output}\n::endgroup::`);
    }
  }
}

await Promise.all(Array.from({ length: width }, worker));

const failed = results.filter(r => !r.ok).map(r => r.crate);
if (failed.length) {
  console.error(`\x1b[31m[miri]\x1b[0m failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\x1b[36m[miri]\x1b[0m all ${results.length} crates passed`);
