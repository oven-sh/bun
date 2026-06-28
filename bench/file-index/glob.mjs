// Glob over an already-built index (Bun.FileIndex.glob, pure in-memory) vs
// re-walking the filesystem for every query (Bun.Glob.scanSync, fast-glob).
// Same pattern set as ../glob/scan.mjs.
//
//   FILE_INDEX_BENCH_N=20000   synthetic tree size (files, excluding node_modules)
import fg from "fast-glob";
import { bench, group, run } from "../runner.mjs";
import { assertEqual, hasFileIndex, syntheticPaths, tempRoot, writeTree } from "./lib.mjs";

const fileCount = parseInt(process.env.FILE_INDEX_BENCH_N || "20000", 10);

const { root, cleanup } = tempRoot("file-index-glob");
{
  const paths = syntheticPaths(fileCount, 3);
  // Guarantee hits for every pattern: top-level .ts files and a node_modules tree.
  for (let i = 0; i < 50; i++) paths.push(`entry_${i}.ts`);
  for (let i = 0; i < 200; i++) {
    paths.push(
      `node_modules/pkg-${i}/lib/index.js`,
      `node_modules/pkg-${i}/lib/util.js`,
      `node_modules/pkg-${i}/package.json`,
    );
  }
  writeTree(root, paths, "// generated\n");
}

const normalPattern = "*.ts";
const recursivePattern = "**/*.ts";
const nodeModulesPattern = "**/node_modules/**/*.js";
const multiLevelPattern = "node_modules/*/lib/*.js";
const patterns = [normalPattern, recursivePattern, nodeModulesPattern, multiLevelPattern];

const Glob = typeof Bun !== "undefined" ? Bun.Glob : undefined;
const scanOpts = { cwd: root, followSymlinks: false, onlyFiles: false };
const fgOpts = { cwd: root, followSymbolicLinks: false, onlyFiles: false };

let index;
if (hasFileIndex) {
  index = new Bun.FileIndex(root);
  await index.ready;
}

for (const pattern of patterns) {
  // Correctness before timing: the in-memory index and the filesystem walk
  // must agree exactly (both sorted, both relative `/`-separated paths).
  if (index && Glob) {
    const fromIndex = index.glob(pattern).sort();
    const fromScan = [...new Glob(pattern).scanSync(scanOpts)].sort();
    assertEqual(fromIndex.length > 0, true, `index.glob("${pattern}") is non-empty`);
    assertEqual(JSON.stringify(fromIndex), JSON.stringify(fromScan), `index.glob vs Bun.Glob.scanSync "${pattern}"`);
  }

  group(`pattern="${pattern}"`, () => {
    if (index)
      bench("Bun.FileIndex.glob (in memory)", () => {
        index.glob(pattern);
      });
    if (Glob)
      bench("Bun.Glob.scanSync (filesystem)", () => {
        [...new Glob(pattern).scanSync(scanOpts)];
      });
    bench("fast-glob.globSync (filesystem)", () => {
      fg.globSync([pattern], fgOpts);
    });
  });
}

await run({ avg: true, min_max: true, percentiles: true });
index?.close();
cleanup();
