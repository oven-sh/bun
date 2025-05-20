import { Glob, file, write } from "bun";
import { join, relative, resolve } from "path";
import { normalize } from "path/posix";

const root = resolve(import.meta.dirname, "..");
let total = 0;

async function globSources(output, patterns, excludes = []) {
  const paths = [];
  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for await (const path of glob.scan()) {
      if (excludes?.some(exclude => normalize(path) === normalize(exclude))) {
        continue;
      }
      paths.push(path);
    }
  }
  total += paths.length;

  const sources = paths
    .map(path => normalize(relative(root, path)))
    .sort((a, b) => a.localeCompare(b))
    .join("\n");

  await write(join(root, "cmake", "sources", output), sources);
}

const input = await file(join(root, "cmake", "Sources.json")).json();

const start = performance.now();
for (const item of input) {
  await globSources(item.output, item.paths, item.exclude);
}
const end = performance.now();

const green = "\x1b[32m";
const reset = "\x1b[0m";
const bold = "\x1b[1m";
console.log(`\nGlobbed ${bold}${green}${total}${reset} sources [${(end - start).toFixed(2)}ms]`);
