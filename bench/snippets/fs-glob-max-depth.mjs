// fs.globSync and fs.promises.glob with `maxDepth`, for each way that a pattern names its paths: below cwd, by an
// absolute path, through "..", and in a directory beside cwd by an absolute path and through "..". Each way has a walk
// with no limit, a walk with `maxDepth: 100`, which cuts nothing, such a walk with no match, such a walk whose last part
// has no wildcard, and a walk that the limit cuts.
//
//   bun bench/snippets/fs-glob-max-depth.mjs [tree ...]     (the trees: short, long, longest, 16-bit)
//   node bench/snippets/fs-glob-max-depth.mjs               (Node.js v26.9.0 or later has `maxDepth`)
import { globSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { bench, group, run } from "../runner.mjs";

const pad = length => "-".padEnd(length, "a-long-name-");
// Names of 2, 49 and 200 characters, and names that need a 16-bit string. A path of the longest names is over 512 bytes.
const trees = {
  short: { dir: i => `d${i}`, file: i => `f${i}.txt` },
  long: { dir: i => `d${i}${pad(47)}`, file: i => `f${i}${pad(43)}.txt` },
  longest: { dir: i => `d${i}${pad(198)}`, file: i => `f${i}${pad(194)}.txt` },
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

const only = process.argv.slice(2);
for (const [name, names] of Object.entries(trees)) {
  if (only.length > 0 && !only.includes(name)) continue;
  const top = join(tmp, name);
  const cwd = join(top, "root");
  makeTree(cwd, names);
  makeTree(join(top, "other"), names);
  const slashes = top.replaceAll(sep, "/");
  // The start of the pattern, and the depth of the directory that it names.
  const ways = {
    "below cwd": ["", 0],
    "absolute": [`${slashes}/root/`, 0],
    "through ..": ["../root/", 0],
    "beside cwd, absolute": [`${slashes}/other/`, 2],
    "beside cwd, through ..": ["../other/", 2],
  };
  const lastFile = names.file(0);

  for (const [api, walk] of Object.entries(walks)) {
    for (const [way, [start, depth]] of Object.entries(ways)) {
      group(`${api}, ${name} names, ${way}`, () => {
        bench("no maxDepth", () => walk(`${start}**/*.txt`, { cwd }));
        bench("maxDepth: 100", () => walk(`${start}**/*.txt`, { cwd, maxDepth: 100 }));
        bench("no match", () => walk(`${start}**/*.none`, { cwd, maxDepth: 100 }));
        bench("no wildcard in the last part", () => walk(`${start}*/*/*/*/${lastFile}`, { cwd, maxDepth: 100 }));
        // 4 of the 121 directories are read.
        bench("a limit that cuts", () => walk(`${start}**/*.txt`, { cwd, maxDepth: depth + 2 }));
      });
    }
    group(`${api}, ${name} names`, () => {
      bench("two patterns", () => walk(["**/*.txt", "*/*/*"], { cwd, maxDepth: 100 }));
      // The matches of `maxDepth: 100` from a function for `exclude`, with no `maxDepth`.
      bench("exclude function", () => walk("**/*.txt", { cwd, exclude: tooDeep }));
      bench("the directory above cwd", () => walk("../*", { cwd, maxDepth: 100 }));
    });
  }
}

await run();
