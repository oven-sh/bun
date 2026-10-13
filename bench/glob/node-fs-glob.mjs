// node:fs glob, on bun and on node. A first call costs much more than a later one, so each
// sample is a fresh process:
//
//   bun bench/glob/node-fs-glob.mjs                              20 files, "*.txt"
//   bun bench/glob/node-fs-glob.mjs --pattern='**/*.rs' --cwd=src
//   node bench/glob/node-fs-glob.mjs --runs=31
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    pattern: { type: "string", default: "*.txt" },
    cwd: { type: "string" },
    runs: { type: "string", default: "15" },
    child: { type: "boolean", default: false },
  },
});
const median = samples => samples.sort((a, b) => a - b)[samples.length >> 1];

if (values.child) {
  let cwd = values.cwd;
  let created;
  if (!cwd) {
    cwd = created = fs.mkdtempSync(path.join(os.tmpdir(), "node-fs-glob-"));
    for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(cwd, `f${i}.txt`), "");
  }
  const sync = () => {
    const start = performance.now();
    fs.globSync(values.pattern, { cwd });
    return performance.now() - start;
  };
  const async = async () => {
    const start = performance.now();
    for await (const _ of fsp.glob(values.pattern, { cwd }));
    return performance.now() - start;
  };
  const times = async (once, later = []) => {
    const first = await once();
    const second = await once();
    for (let i = 0; i < 100; i++) later.push(await once());
    return { first, second, later: median(later) };
  };
  // The async API runs first in one half of the samples, the sync API in the other half.
  const asyncFirst = process.pid % 2 === 0;
  const a = asyncFirst ? await times(async) : undefined;
  const s = await times(sync);
  const result = { sync: s, async: a ?? (await times(async)), firstCallOf: asyncFirst ? "async" : "sync" };
  if (created) fs.rmSync(created, { recursive: true });
  console.log(JSON.stringify(result));
} else {
  const args = [import.meta.filename, "--child", `--pattern=${values.pattern}`];
  if (values.cwd) args.push(`--cwd=${path.resolve(values.cwd)}`);
  const samples = { sync: { first: [], second: [], later: [] }, async: { first: [], second: [], later: [] } };
  for (let i = 0; i < Number(values.runs); i++) {
    const { stdout, status, stderr } = spawnSync(process.execPath, args, { encoding: "utf8" });
    if (status !== 0) throw new Error(stderr);
    const result = JSON.parse(stdout);
    for (const api of ["sync", "async"]) {
      // A first call only counts for the API that ran first in that process.
      if (result.firstCallOf === api) samples[api].first.push(result[api].first);
      samples[api].second.push(result[api].second);
      samples[api].later.push(result[api].later);
    }
  }
  const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;
  console.log(`${runtime}, pattern ${JSON.stringify(values.pattern)}, median of ${values.runs} processes, ms`);
  for (const [api, name] of [
    ["sync", "fs.globSync"],
    ["async", "fs.promises.glob"],
  ]) {
    const { first, second, later } = samples[api];
    const fmt = list => (list.length ? median(list).toFixed(3) : "n/a");
    console.log(`${name.padEnd(17)} first ${fmt(first)} · second ${fmt(second)} · later ${fmt(later)}`);
  }
}
