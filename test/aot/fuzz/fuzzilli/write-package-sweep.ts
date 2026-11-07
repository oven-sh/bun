// Code that people publish is written by tools as often as by hand: calls joined by commas, `!0`, `void 0`, a dead `if (0)`, one line of 100,000 characters. No scene of ours is written like that.
// For each file of a folder of installed packages that matches, this writes a program of a few lines that loads the file and says what it exports: the names, and the kind of each.
//
//   bun write-package-sweep.ts <folder to write to> <node_modules> [minified|entries] [most bytes, 600000]
//   bun run-alone.ts --bun <the Bun that builds> --work <folder> --finds <folder> --programs <folder to write to>
//
// minified   every *.min.js, *.min.cjs and *.min.mjs below the folder
// entries    every package of the folder, loaded by its name as a program would
//
// A file that `bun <file>` cannot load says so in both ways of running it, and that is the same answer. A build that stops, dies or does not end is what this looks for first.

import { existsSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [out, packages, kind = "minified", most = "600000"] = process.argv.slice(2);
if (!out || !packages || !existsSync(packages)) {
  console.error(
    "usage: bun write-package-sweep.ts <folder to write to> <node_modules> [minified|entries] [most bytes]",
  );
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const says = `const say = value =>
  typeof value === "function"
    ? "function " + value.length
    : typeof value === "object" && value !== null
      ? "object " + Object.keys(value).sort().slice(0, 40).join()
      : typeof value + " " + String(value).slice(0, 40);
console.log(Object.keys(held).sort().map(key => key + ": " + say(held[key])).join("\\n"));`;

let count = 0;
function write(name: string, from: string) {
  const file = `${String(++count).padStart(5, "0")}-${name.replace(/[^\w$]+/g, "-").slice(-100)}.mjs`;
  writeFileSync(join(out, file), `import * as held from ${JSON.stringify(from)};\n${says}\n`);
}

if (kind === "entries") {
  for (const name of readdirSync(packages).sort()) {
    if (name.startsWith(".")) continue;
    const inside = name.startsWith("@") ? readdirSync(join(packages, name)).map(each => `${name}/${each}`) : [name];
    for (const each of inside) if (existsSync(join(packages, each, "package.json"))) write(each, join(packages, each));
  }
} else {
  const seen = new Set<string>();
  const walk = (folder: string) => {
    const real = realpathSync(folder);
    if (seen.has(real)) return;
    seen.add(real);
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      const found = statSync(path, { throwIfNoEntry: false });
      if (!found) continue;
      if (found.isDirectory()) walk(path);
      else if (/\.min\.[cm]?js$/.test(name) && found.size <= Number(most)) write(relative(packages, path), path);
    }
  };
  walk(packages);
}
console.log(`${count} programs`);
