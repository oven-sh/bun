#!/usr/bin/env bun
/**
 * `bun run rust:check-gates`: does anything that stays name something that goes? (src/bun_core/feature.rs)
 *
 * `bun build --compile --compile-exclude-features` takes gated code out of a bun that was compiled with all of it, so no
 * compiler sees the result. This has one see it: Bun is type-checked with features compiled out for real, which is what
 * `#[feature::gate]`, `feature::enter!` and `feature::present!` do under `--cfg bun_without="<name>"`, and a crate with a
 * gate is emptied once all of its features are out.
 *
 * Once for each gate in use, with just its features out. That is enough: if code can outlive gated code that it names, it
 * does so when exactly that gate's features are excluded.
 *
 * Run as rustc's wrapper (cargo's RUSTC_WORKSPACE_WRAPPER) it is what empties the crates.
 */

import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

if (process.env.BUN_CHECK_GATES_WITHOUT !== undefined) {
  const [rustc, ...args] = process.argv.slice(2);
  const without: string[] = JSON.parse(process.env.BUN_CHECK_GATES_WITHOUT);
  const gates: Record<string, string[]> = JSON.parse(process.env.BUN_CHECK_GATES_CRATES!);
  const gate = gates[process.env.CARGO_PKG_NAME ?? ""];
  for (const name of without) args.push("--cfg", `bun_without="${name}"`);
  if (gate?.every(name => without.includes(name))) args.push("-Zcrate-attr=cfg(any())");
  // What only gated code used is unused now. That costs bytes, not correctness.
  args.push("--cap-lints", "warn");
  process.exit(spawnSync(rustc!, args, { stdio: "inherit" }).status ?? 1);
}

const metadata = JSON.parse(
  spawnSync("cargo", ["metadata", "--format-version=1", "--no-deps", "--locked"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  }).stdout,
) as { packages: { name: string; metadata?: { bun?: { gate?: string[] } } | null }[] };
const crates = Object.fromEntries(
  metadata.packages.flatMap(p => (p.metadata?.bun?.gate ? [[p.name, p.metadata.bun.gate]] : [])),
);

// The gates on functions are in the source.
const inSource = spawnSync("git", ["grep", "-h", "-o", "-E", "feature::gate\\([a-z_, ]+\\)", "--", "src/**/*.rs"], {
  cwd: root,
  encoding: "utf8",
}).stdout;
const onFunctions = [...inSource.matchAll(/gate\(([^)]*)\)/g)].map(m => m[1]!.split(",").map(name => name.trim()));
const gates = new Map([...Object.values(crates), ...onFunctions].map(gate => [[...gate].sort().join(","), gate]));

let failed = false;
for (const [name, without] of [...gates].sort()) {
  console.log(`\n── without ${name}`);
  const { status } = spawnSync("cargo", ["check", "-p", "bun_runtime", "--keep-going", ...process.argv.slice(2)], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      RUSTC_WORKSPACE_WRAPPER: join(root, "scripts", "rust-check-gates.ts"),
      BUN_CHECK_GATES_WITHOUT: JSON.stringify(without),
      BUN_CHECK_GATES_CRATES: JSON.stringify(crates),
      CARGO_TARGET_DIR: join(root, "target", "check-gates", name),
    },
  });
  failed ||= status !== 0;
}
process.exit(failed ? 1 : 0);
