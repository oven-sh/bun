#!/usr/bin/env bun
/**
 * Build + run the HPACK criterion bench (src/hpack/benches/hpack.rs): compiles
 * the Huffman kernel and the part of Highway it needs into one archive and
 * points RUSTFLAGS at it. Needs `bun bd` once.
 *
 *   bun scripts/bench-hpack-rust.ts                       # every row
 *   bun scripts/bench-hpack-rust.ts --scalar              # without the kernel, as on a CPU without AVX-512 VBMI
 *   bun scripts/bench-hpack-rust.ts encode/add/text       # other arguments go to criterion
 *   bun scripts/bench-hpack-rust.ts --save-baseline main
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");

if (!existsSync(resolve(repo, "vendor/highway"))) {
  console.error("error: vendor/ not populated — run `bun bd` (or `bun run build`) once first");
  process.exit(1);
}

const scalar = process.argv.includes("--scalar");
const criterionArgs = process.argv.slice(2).filter(arg => arg !== "--scalar");

const objects = resolve(repo, scalar ? "target/bench-hpack-cdeps-scalar" : "target/bench-hpack-cdeps");
mkdirSync(objects, { recursive: true });

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const { status, signal, error } = spawnSync(cmd, args, { stdio: "inherit", cwd: repo, env });
  if (status === null) console.error(`error: ${cmd}: ${error?.message ?? signal}`);
  if (status !== 0) process.exit(status ?? 1);
}

// May be more than one word, as in "ccache clang++".
const [cxx = "c++", ...cxxArgs] = (process.env.CXX ?? "").split(" ").filter(Boolean);

function compile(source: string, object: string, ...flags: string[]) {
  run(cxx, [...cxxArgs, "-O3", "-fPIC", ...flags, "-Ivendor/highway", "-c", source, "-o", `${objects}/${object}`]);
}

const rustflags = process.env.RUSTFLAGS ? [process.env.RUSTFLAGS] : [];
const kernelFlags = ["-Isrc/jsc/bindings"];
// What release builds of Bun are compiled for.
if (process.arch === "x64") {
  kernelFlags.push("-march=nehalem");
  rustflags.push("-Ctarget-cpu=nehalem");
}
if (scalar) kernelFlags.push("-DHWY_COMPILE_ONLY_STATIC");

for (const name of ["abort", "targets"]) compile(`vendor/highway/hwy/${name}.cc`, `hwy_${name}.o`, "-std=c++17");
compile("src/jsc/bindings/highway_hpack.cpp", "highway_hpack.o", "-std=c++20", ...kernelFlags);

// Cargo goes by the flags and not by the file, so a changed kernel needs another name to be linked.
const digest = createHash("sha256")
  .update(readFileSync(`${objects}/highway_hpack.o`))
  .digest("hex")
  .slice(0, 16);
const archive = `${objects}/libbun_bench_cdeps-${digest}.a`;
const files = readdirSync(objects)
  .sort()
  .map(file => `${objects}/${file}`);
for (const file of files) if (file.endsWith(".a")) rmSync(file);
run("ar", ["rcs", archive, ...files.filter(file => file.endsWith(".o"))]);

rustflags.push(`-Clink-arg=${archive}`, `-Clink-arg=-l${process.platform === "darwin" ? "c++" : "stdc++"}`);
run("cargo", ["bench", "-p", "bun_hpack", "--bench", "hpack", "--", ...criterionArgs], {
  ...process.env,
  BUN_CODEGEN_DIR: process.env.BUN_CODEGEN_DIR || resolve(repo, "build/debug/codegen"),
  CARGO_PROFILE_BENCH_LTO: process.env.CARGO_PROFILE_BENCH_LTO || "fat",
  RUSTFLAGS: rustflags.join(" "),
});
