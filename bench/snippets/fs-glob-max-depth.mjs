// fs.globSync and fs.promises.glob with `maxDepth`, for each spelling of a pattern: below cwd, absolute, and through
// "..". Each spelling has a walk with no limit, a walk with `maxDepth: 100`, which cuts nothing, and such a walk with no
// match. The last walk of a group is one that the limit cuts.
//
//   bun bench/snippets/fs-glob-max-depth.mjs
//   node bench/snippets/fs-glob-max-depth.mjs    (Node.js v26.9.0 or later has `maxDepth`)
import { globSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { bench, group, run } from "../runner.mjs";

const long = "-with-a-long-name-for-the-benchmark";
// Names of 2, 11 and 37 characters, and names that need a 16-bit string.
const trees = {
  short: { dir: i => `d${i}`, file: i => `f${i}.txt` },
  medium: { dir: i => `directory-${i}`, file: i => `file-${i}.txt` },
  long: { dir: i => `d${i}${long}`, file: i => `f${i}${long}.txt` },
  "16-bit": { dir: i => `目录${i}`, file: i => `文件${i}.txt` },
};

// 121 directories and 484 files: 3 directories and 4 files in each directory, 4 levels below the root.
function makeTree(root, names, level = 0) {
  mkdirSync(root, { recursive: true });
  for (let i = 0; i < 4; i++) writeFileSync(join(root, names.file(i)), "");
  if (level < 4) {
    for (let i = 0; i < 3; i++) makeTree(join(root, names.dir(i)), names, level + 1);
  }
}

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "fs-glob-max-depth-")));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

async function count(iterator) {
  let matches = 0;
  for await (const _ of iterator) matches++;
  return matches;
}

const tooDeep = path => path.split(sep).length > 100;

const walks = {
  globSync: (pattern, options) => globSync(pattern, options),
  "fs.promises.glob": (pattern, options) => count(glob(pattern, options)),
};

for (const [name, names] of Object.entries(trees)) {
  const cwd = join(tmp, name, "root");
  makeTree(cwd, names);
  const spellings = {
    "below cwd": "**/",
    "absolute": `${cwd.replaceAll(sep, "/")}/**/`,
    "through ..": `../${basename(cwd)}/**/`,
  };

  for (const [api, walk] of Object.entries(walks)) {
    group(`${api}, ${name} names`, () => {
      for (const [spelling, prefix] of Object.entries(spellings)) {
        bench(`${spelling}, no maxDepth`, () => walk(`${prefix}*.txt`, { cwd }));
        bench(`${spelling}, maxDepth: 100`, () => walk(`${prefix}*.txt`, { cwd, maxDepth: 100 }));
        bench(`${spelling}, no match`, () => walk(`${prefix}*.none`, { cwd, maxDepth: 100 }));
      }
      // The matches of `maxDepth: 100` from a function for `exclude`, with no `maxDepth`.
      bench("below cwd, exclude function", () => walk("**/*.txt", { cwd, exclude: tooDeep }));
      // 4 of the 121 directories are read.
      bench("below cwd, maxDepth: 2", () => walk("**/*.txt", { cwd, maxDepth: 2 }));
    });
  }
}

await run();
