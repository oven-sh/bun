#!/usr/bin/env bun
// Fix relative @import("...") paths in .zig files after a batch of git mv renames.
// Reads staged renames from `git diff --cached --name-status -M90%`, builds old→new map,
// then for EVERY .zig in src/: for each relative @import, resolve it against the file's
// OLD location, look up the target's NEW location, and re-relativize from the file's NEW
// location. Handles moved→unmoved, unmoved→moved, and moved→moved.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, normalize, relative, resolve } from "node:path";

const root = process.cwd();

// 1. Build rename map from staged diff (R<score>\told\tnew)
const diff = execSync("git diff --cached --name-status -M90% -- '*.zig'", { encoding: "utf8" });
const old2new = new Map<string, string>();
const new2old = new Map<string, string>();
for (const line of diff.split("\n")) {
  const m = line.match(/^R\d+\t(\S+)\t(\S+)$/);
  if (!m) continue;
  old2new.set(m[1], m[2]);
  new2old.set(m[2], m[1]);
}
console.error(`renames: ${old2new.size}`);

// 2. All .zig files currently on disk (post-mv)
const all = execSync("git ls-files -- 'src/**/*.zig' 'src/*.zig'", { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);

// Set of all valid current .zig paths (for existence check)
const exists = new Set(all);

let filesTouched = 0;
let importsFixed = 0;

for (const newPath of all) {
  const oldPath = new2old.get(newPath) ?? newPath; // where this file USED to be
  const text = readFileSync(newPath, "utf8");
  let changed = false;
  const out = text.replace(/@import\("(\.{1,2}\/[^"]+\.zig)"\)/g, (full, rel) => {
    // Resolve the import as written, against the file's OLD location
    const targetOld = normalize(relative(root, resolve(dirname(oldPath), rel)));
    // Where does that target live NOW?
    const targetNew = old2new.get(targetOld) ?? targetOld;
    // Re-relativize from this file's NEW location
    let fixed = relative(dirname(newPath), targetNew).replaceAll("\\", "/");
    if (!fixed.startsWith(".")) fixed = "./" + fixed;
    if (fixed === rel) return full;
    // Only rewrite if the new target actually exists; otherwise leave it (probably already correct
    // or a genuinely broken import we shouldn't paper over)
    if (!exists.has(targetNew)) return full;
    changed = true;
    importsFixed++;
    return `@import("${fixed}")`;
  });
  if (changed) {
    writeFileSync(newPath, out);
    filesTouched++;
  }
}

console.error(`files touched: ${filesTouched}, imports fixed: ${importsFixed}`);
console.log(JSON.stringify({ renames: old2new.size, filesTouched, importsFixed }));
