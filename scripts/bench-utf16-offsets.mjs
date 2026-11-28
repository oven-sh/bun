#!/usr/bin/env bun
// bun scripts/bench-utf16-offsets.mjs [--test] [case-filter]
// Compiles the real utf16_offsets.rs on its own (bun_core itself cannot link without JSC) and either runs
// its unit tests (--test) or the old-vs-new microbenchmark of src/bun_core/benches/utf16_offsets.rs.
// Needs the pinned nightly from rust-toolchain.toml.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repo = resolve(import.meta.dirname, "..");
const out = join(process.env.BENCH_OUT ?? tmpdir(), "utf16-offsets-micro");
mkdirSync(out, { recursive: true });

const source = readFileSync(join(repo, "src/bun_core/string/immutable/utf16_offsets.rs"), "utf8")
  .replace("    fn from_valid(", "    pub fn from_valid(")
  .replace("    fn from_lossy(", "    pub fn from_lossy(")
  .replace("    fn from(", "    pub fn from(")
  .replace("    shifts: Vec", "    pub shifts: Vec")
  .replace(
    "impl Utf16OffsetTable {",
    "impl Utf16OffsetTable {\n    pub fn len(&self) -> usize { self.shifts.len() }\n    pub fn from_lossy_for_bench(text: &[u8]) -> Utf16OffsetTable { Self::from_lossy(text, 0) }\n",
  );
if (!source.includes("from_lossy_for_bench")) throw new Error("utf16_offsets.rs changed shape; update run-micro.mjs");
writeFileSync(join(out, "utf16_offsets.rs"), source);
copyFileSync(join(repo, "src/bun_core/benches/utf16_offsets.rs"), join(out, "micro.rs"));

const args = process.argv.slice(2);
const test = args[0] === "--test";
const bin = join(out, test ? "micro-test" : "micro");
const build = spawnSync(
  "rustc",
  [
    "+nightly-2026-11-14",
    "--edition",
    "2024",
    "-C",
    "opt-level=3",
    "-C",
    "target-cpu=native",
    ...(test ? ["--test"] : []),
    "-o",
    bin,
    join(out, "micro.rs"),
  ],
  { stdio: "inherit", cwd: repo },
);
if (build.status !== 0) process.exit(build.status ?? 1);
const run = spawnSync(bin, test ? ["--nocapture"] : args, { stdio: "inherit" });
process.exit(run.status ?? 1);
