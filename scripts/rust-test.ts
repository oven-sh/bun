#!/usr/bin/env bun
/**
 * Native `cargo test` for the crates whose unit tests are meant to run on
 * their own, outside the bun build.
 *
 * A crate's test binary links its Rust dependencies and nothing else; the C/C++
 * behind the workspace's externs (highway kernels, simdutf, mimalloc, the
 * OutputSink interface implemented in bun_sys, ...) exists only in the full bun
 * link. A test that reaches one of them fails to link with an `undefined
 * symbol`, and nothing else notices: the Miri lane (`rust-miri.ts`) never links
 * and runs bun_highway's scalar paths, and `cargo check --tests` stops before
 * the linker. A crate whose tests need the byte-search kernels enables
 * bun_highway's `scalar` feature from its `[dev-dependencies]` (see
 * src/clap/Cargo.toml); anything else has to be stubbed in the crate, or stays
 * a link error naming the symbol.
 *
 * One cargo invocation per crate on purpose: cargo unifies features within an
 * invocation, so `cargo test -p a -p b` would build bun_highway with `scalar`
 * for both as soon as either asks for it, and a crate missing its own
 * `[dev-dependencies]` entry would pass here yet fail for whoever runs
 * `cargo test -p <crate>` alone. Shared dependencies are still built once per
 * feature set, not once per crate.
 *
 * Usage:
 *   bun run rust:test                 # every crate below
 *   bun run rust:test -p bun_foo      # extra args go straight to cargo test
 */

import { ensureCargoWorkspace, run } from "./rust-workspace.ts";

// Crates whose `cargo test --locked -p <crate>` links and passes on a
// configured checkout. Of the Miri set, bun_ast (its tests reach mimalloc) and
// bun_ptr (highway kernels and the OutputSink interface) do not link yet, and
// bun_collections' pool tests count drops that its thread-local pools perform
// at thread exit, so they race once libtest actually runs them in parallel.
const NATIVE_TEST_CRATES = [
  "bun_base64",
  "bun_clap",
  "bun_dispatch",
  "bun_errno",
  "bun_hash",
  "bun_http_types",
  "bun_md",
  "bun_paths",
  "bun_resolve_builtins",
  "bun_shell_parser",
  "bun_threading",
  "bun_wyhash",
];

ensureCargoWorkspace();

// `scalar` makes every byte search scalar, so it must only ever reach test
// binaries. Cargo does not activate [dev-dependencies] when building bun_bin;
// a `[dependencies]` entry asking for the feature would, silently.
const treeArgs = ["tree", "--locked", "-p", "bun_bin", "-i", "bun_highway", "-e", "features"];
console.log(`\x1b[36m[test]\x1b[0m cargo ${treeArgs.join(" ")}`);
const tree = run("cargo", treeArgs, { stdio: ["ignore", "pipe", "inherit"] });
if (tree.status !== 0) process.exit(tree.status ?? 1);
if (tree.stdout.toString().includes('feature "scalar"')) {
  console.error(tree.stdout.toString());
  console.error("\x1b[31m[error]\x1b[0m bun_highway's `scalar` feature is enabled in bun_bin's dependency graph");
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
const invocations = extraArgs.length > 0 ? [extraArgs] : NATIVE_TEST_CRATES.map(crate => ["-p", crate]);

const failed: string[] = [];
for (const args of invocations) {
  console.log(`\x1b[36m[test]\x1b[0m cargo test --locked ${args.join(" ")}`);
  if (run("cargo", ["test", "--locked", ...args]).status !== 0) failed.push(args.join(" "));
}

if (failed.length > 0) {
  console.error(`\x1b[31m[error]\x1b[0m cargo test failed for: ${failed.join(", ")}`);
  process.exit(1);
}
