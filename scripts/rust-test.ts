#!/usr/bin/env bun
/**
 * Plain `cargo test` for the Miri crate set (MIRI_CRATES in rust-workspace.ts).
 *
 * A crate's test binary links the crate's Rust dependencies and nothing else.
 * Everything the full bun binary gets from C/C++ (the highway kernels behind
 * `bun_core::strings`, mimalloc, ...) or from a higher-tier crate (the
 * `bun_sys` arm of `bun_core`'s `OutputSink`) is missing, so a test that
 * reaches one either gets it from the crate's own `#[cfg(test)]` shim module
 * (src/ptr/native_test_shims.rs) or fails to link, naming the symbol. Miri
 * never links, and `bun_highway` takes scalar paths under `cfg(miri)`, so
 * `rust:miri` stays green either way; this is the lane that notices.
 *
 * Usage:
 *   bun run rust:test              # the crate set (per the lists below), then the pending check
 *   bun run rust:test -p bun_foo   # extra args go straight to one `cargo test`
 */

import { MIRI_CRATES, ensureConfigured, run } from "./rust-workspace.ts";

// Miri crates whose test binaries do not link natively yet, with the live
// reference that stops them. Each entry is re-linked below and fails this
// script once the crate links, so the list can only shrink.
const NATIVE_LINK_PENDING = [
  // `TapeAlloc::Arena` keeps `MimallocArena` live: mi_heap_malloc, mi_free_size, ...
  "bun_ast",
  // `StreamingClap::normal` reaches highway_index_of_char.
  "bun_clap",
];

// Crates whose test binary is built and linked here but not run: linking is
// what this lane checks, and running these is known to be unreliable natively.
const LINK_ONLY = [
  // pool.rs's tests race libtest's parallel threads against the thread-local
  // pool's teardown (3 of 40 runs fail on main); #37793 joins the thread.
  // Remove once it lands.
  "bun_collections",
];

for (const [list, name] of [
  [NATIVE_LINK_PENDING, "NATIVE_LINK_PENDING"],
  [LINK_ONLY, "LINK_ONLY"],
] as const) {
  for (const crate of list) {
    if (!MIRI_CRATES.includes(crate)) {
      console.error(`\x1b[31m[test]\x1b[0m ${crate} is in ${name} but not in MIRI_CRATES`);
      process.exit(1);
    }
  }
}

ensureConfigured();

const extraArgs = process.argv.slice(2);
if (extraArgs.length > 0) {
  console.log(`\x1b[36m[test]\x1b[0m cargo test --locked ${extraArgs.join(" ")}`);
  process.exit(run("cargo", ["test", "--locked", ...extraArgs]).status ?? 1);
}

// One `cargo test` per crate, so that every crate's own link result is
// reported rather than only the first failure's; the build artifacts are
// shared, so only the first invocation compiles anything substantial.
const failed: string[] = [];
const crates = MIRI_CRATES.filter(crate => !NATIVE_LINK_PENDING.includes(crate));
for (const crate of crates) {
  const args = LINK_ONLY.includes(crate) ? ["--no-run"] : [];
  console.log(`\x1b[36m[test]\x1b[0m cargo test --locked ${[...args, "-p", crate].join(" ")}`);
  if (run("cargo", ["test", "--locked", ...args, "-p", crate]).status !== 0) failed.push(crate);
}

// The only failure a pending crate is allowed is the linker's (lld, or
// link.exe's spelling); a compile error or a cargo failure stays loud.
const LINK_FAILURE = /undefined symbol|unresolved external|error: linking with/;
for (const crate of NATIVE_LINK_PENDING) {
  console.log(`\x1b[36m[test]\x1b[0m cargo test --locked --no-run -p ${crate} (pending: expected not to link)`);
  const result = run("cargo", ["test", "--locked", "--no-run", "-p", crate], { stdio: "pipe" });
  if (result.status === 0) {
    console.error(
      `\x1b[31m[test]\x1b[0m ${crate} links natively now; remove it from NATIVE_LINK_PENDING in scripts/rust-test.ts`,
    );
    failed.push(crate);
  } else if (!LINK_FAILURE.test(String(result.stderr ?? ""))) {
    console.error(`\x1b[31m[test]\x1b[0m ${crate} failed for a reason other than linking:\n${result.stderr}`);
    failed.push(crate);
  }
}

if (failed.length) {
  console.error(`\x1b[31m[test]\x1b[0m failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  `\x1b[36m[test]\x1b[0m ${crates.length} crates link, ${crates.length - LINK_ONLY.length} of them ran and passed, ` +
    `${NATIVE_LINK_PENDING.length} still pending`,
);
