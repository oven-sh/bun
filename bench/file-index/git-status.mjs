// In-process git status (Bun.FileIndex.gitStatus) vs spawning
// `git status --porcelain=v1 -z` over the same repository.
//
// `gitStatus()` lands in a later wave: this file detects it at run time and
// benches only the `git` spawn when it is absent, so the suite always runs.
//
//   FILE_INDEX_BENCH_N=5000   number of tracked files in the repository
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bench, group, run } from "../runner.mjs";
import { assertEqual, hasBinary, hasFileIndex, syntheticPaths, tempRoot, writeTree } from "./lib.mjs";

if (!hasBinary("git")) {
  console.log("git is not on PATH; nothing to benchmark.");
  process.exit(0);
}

const fileCount = parseInt(process.env.FILE_INDEX_BENCH_N || "5000", 10);

const { root, cleanup } = tempRoot("file-index-git-status");
const paths = syntheticPaths(fileCount, 5);
writeTree(root, paths, "// committed\n");

function git(...args) {
  const r = spawnSync("git", args, { cwd: root });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
  return r.stdout;
}
git("init", "-q");
git("-c", "user.email=bench@example.com", "-c", "user.name=bench", "add", "-A");
git("-c", "user.email=bench@example.com", "-c", "user.name=bench", "commit", "-qm", "init", "--no-gpg-sign");

// A deterministic dirty state: some modified, some deleted, some untracked.
const modified = paths.filter((_, i) => i % 50 === 0);
const deleted = paths.filter((_, i) => i % 50 === 1);
const untracked = [];
for (let i = 0; i < Math.max(1, fileCount / 100); i++) untracked.push(`brand_new_${i}.txt`);
for (const rel of modified) writeFileSync(join(root, ...rel.split("/")), "// modified\n");
for (const rel of deleted) rmSync(join(root, ...rel.split("/")));
writeTree(root, untracked, "// untracked\n");

function gitStatusPorcelain() {
  // -z: NUL-separated, no quoting; --untracked-files=all matches the index view.
  const out = git("status", "--porcelain=v1", "-z", "--untracked-files=all").toString("latin1");
  const files = [];
  for (const rec of out.split("\0")) {
    if (rec.length > 3) files.push({ status: rec.slice(0, 2), path: rec.slice(3) });
  }
  return files;
}

const expected = modified.length + deleted.length + untracked.length;
assertEqual(gitStatusPorcelain().length, expected, "spawned `git status` entry count");

let index = null;
let nativeWorks = false;
if (hasFileIndex && typeof Bun.FileIndex.prototype.gitStatus === "function") {
  index = new Bun.FileIndex(root);
  await index.ready;
  try {
    const st = await index.gitStatus();
    assertEqual(st !== null, true, "gitStatus() resolves non-null inside a repository");
    assertEqual(st.files.length, expected, "Bun.FileIndex.gitStatus entry count");
    nativeWorks = true;
  } catch (err) {
    console.log(`Bun.FileIndex.gitStatus exists but is unusable (${err?.message}); benching git only.`);
  }
} else {
  console.log("Bun.FileIndex.gitStatus is not implemented in this build; benching git only.");
}

group(`git status over ${fileCount} tracked files (${expected} dirty)`, () => {
  if (nativeWorks)
    bench("Bun.FileIndex.gitStatus (in process)", async () => {
      await index.gitStatus();
    });
  bench("spawnSync git status --porcelain=v1 -z", () => {
    gitStatusPorcelain();
  });
});

await run({ avg: true, min_max: true, percentiles: true });
index?.close();
cleanup();
