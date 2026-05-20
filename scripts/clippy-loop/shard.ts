#!/usr/bin/env bun
// Splits a manifest [{file,count,diagPath}] into N interleaved shards so each
// shard gets a mix of high- and low-count files. Writes shard-<i>.json under
// argv[3] and prints the paths.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const manifest = JSON.parse(readFileSync(process.argv[2], "utf8")) as Array<{
  file: string;
  count: number;
  diagPath: string;
}>;
const n = Number(process.argv[3] || 4);
const outDir = process.argv[4] || "/tmp/clippy-loop/shards";
mkdirSync(outDir, { recursive: true });

const shards: (typeof manifest)[] = Array.from({ length: n }, () => []);
manifest.forEach((m, i) => shards[i % n].push(m));

for (let i = 0; i < n; i++) {
  const p = join(outDir, `shard-${i}.json`);
  writeFileSync(p, JSON.stringify(shards[i]));
  const diags = shards[i].reduce((s, x) => s + x.count, 0);
  console.error(`shard-${i}: ${shards[i].length} files, ${diags} diags`);
  console.log(p);
}
