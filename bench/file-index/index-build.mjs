// Time to build a Bun.FileIndex (construct + await `ready`) over a tree, vs
// walking the same tree with fdir, fast-glob, and `git ls-files`.
//
//   FILE_INDEX_BENCH_ROOT=/path/to/checkout   bench an existing tree instead
//   FILE_INDEX_BENCH_N=20000                  synthetic tree size (files)
import fg from "fast-glob";
import { fdir } from "fdir";
import { spawnSync } from "node:child_process";
import { bench, group, run } from "../runner.mjs";
import { assertEqual, hasBinary, hasFileIndex, impliedDirs, syntheticPaths, tempRoot, writeTree } from "./lib.mjs";

const externalRoot = process.env.FILE_INDEX_BENCH_ROOT;
const fileCount = parseInt(process.env.FILE_INDEX_BENCH_N || "20000", 10);

let root, cleanup, expectedEntries;
if (externalRoot) {
  root = externalRoot;
} else {
  ({ root, cleanup } = tempRoot("file-index-build"));
  const paths = syntheticPaths(fileCount, 1);
  writeTree(root, paths, "// generated\n");
  expectedEntries = paths.length + impliedDirs(paths).length;
}

const haveGit = hasBinary("git");
if (haveGit) {
  // `git ls-files` needs a repository. `git init` in an external root would be
  // destructive, so the git competitor only runs against the synthetic tree.
  if (!externalRoot) {
    for (const args of [
      ["init", "-q"],
      ["add", "-A"],
    ]) {
      const r = spawnSync("git", args, { cwd: root, stdio: "ignore" });
      if (r.status !== 0) throw new Error(`git ${args[0]} failed in ${root}`);
    }
  }
}
const benchGit = haveGit && !externalRoot;

function gitLsFiles() {
  const r = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root });
  if (r.status !== 0) throw new Error("git ls-files failed");
  return r.stdout.toString("latin1").split("\0").filter(Boolean);
}

// Like Bun.FileIndex, neither competitor descends into `.git`. The synthetic
// tree has no other dotfiles, so fast-glob's default `dot: false` is enough.
const fdirCrawl = () =>
  new fdir()
    .withRelativePaths()
    .withDirs()
    .exclude(name => name === ".git")
    .crawl(root)
    .sync();
const fgCrawl = () => fg.globSync("**/*", { cwd: root, onlyFiles: false, followSymbolicLinks: false });

// ---- correctness + one-shot stats (not a benchmark) ------------------------
if (hasFileIndex) {
  const t0 = performance.now();
  const index = new Bun.FileIndex(root);
  await index.ready;
  const elapsedMs = performance.now() - t0;
  if (expectedEntries !== undefined) {
    // index.size counts files + directories; the synthetic tree has no
    // ignore rules and (post `git init`) the `.git` directory is always skipped.
    assertEqual(index.size, expectedEntries, "index.size over the synthetic tree");
    // fdir's withDirs() also yields the crawl root itself; FileIndex does not.
    assertEqual(fdirCrawl().length - 1, expectedEntries, "fdir entry count");
    if (benchGit) assertEqual(gitLsFiles().length, fileCount, "git ls-files file count");
  }
  console.log(
    `Bun.FileIndex: ${index.size} entries in ${elapsedMs.toFixed(1)}ms (one shot)` +
      ` => ${Math.round(index.size / (elapsedMs / 1000))} entries/sec,` +
      ` ${index.memoryUsage} bytes retained (${(index.memoryUsage / index.size).toFixed(1)} bytes/entry)`,
  );
  index.close();
} else if (!externalRoot) {
  assertEqual(fdirCrawl().length - 1, expectedEntries, "fdir entry count");
}

group(`index a tree of ${expectedEntries ?? "?"} entries (${externalRoot ?? "synthetic"})`, () => {
  if (hasFileIndex)
    bench("Bun.FileIndex ready", async () => {
      const index = new Bun.FileIndex(root);
      await index.ready;
      index.close();
    });

  bench("fdir (walk only, no lstat)", () => {
    fdirCrawl();
  });

  bench("fast-glob **/* (walk only)", () => {
    fgCrawl();
  });

  if (benchGit)
    bench("spawnSync git ls-files", () => {
      gitLsFiles();
    });
});

await run({ avg: true, min_max: true, percentiles: true });
cleanup?.();
