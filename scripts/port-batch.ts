#!/usr/bin/env bun
// Emit args JSON for the phase-a-port workflow.
// Usage: bun scripts/port-batch.ts <head|tail|status|N> [batchSize=100]
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const REPO = process.cwd();
const manifest = readFileSync("/tmp/port-manifest-filtered.tsv", "utf8")
  .trim()
  .split("\n")
  .map(l => {
    const [zig, loc] = l.split("\t");
    return { zig, loc: Number(loc) };
  });

function rsPathFor(zig: string): string {
  const dir = dirname(zig);
  const base = basename(zig, ".zig");
  const parts = dir.split("/");
  const area = parts[1];
  const parent = parts[parts.length - 1];
  if (parts.length === 2 && base === area) return join(dir, "lib.rs");
  if (base === parent) return join(dir, "mod.rs");
  return join(dir, base + ".rs");
}

const mode = process.argv[2] ?? "head";
const batchSize = Number(process.argv[3] ?? "100");
const pending = manifest.filter(f => !existsSync(join(REPO, rsPathFor(f.zig))));

if (mode === "status") {
  console.error(`total ${manifest.length}  done ${manifest.length - pending.length}  pending ${pending.length}`);
  process.exit(0);
}

let slice: typeof pending;
if (mode === "tail") slice = pending.slice(-batchSize);
else if (mode === "head") slice = pending.slice(0, batchSize);
else {
  const i = Number(mode);
  slice = pending.slice(i * batchSize, (i + 1) * batchSize);
}
process.stderr.write(
  `manifest ${manifest.length}  pending ${pending.length}  batch[${mode}] ${slice.length} files  loc ${slice.reduce((a, f) => a + f.loc, 0)}\n`,
);
console.log(JSON.stringify({ files: slice, repo: REPO }));
