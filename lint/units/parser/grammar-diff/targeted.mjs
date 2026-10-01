// Whole-program inputs of the targeted corpus: one file per group under targeted/, one source per line.
// A line that starts with "# " is a comment. The character U+23CE stands for a line break inside a source.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "targeted");
export const SOURCES = {};
for (const file of readdirSync(dir)
  .filter(f => f.endsWith(".txt"))
  .sort()) {
  SOURCES[file.replace(/\.txt$/, "")] = readFileSync(join(dir, file), "utf8")
    .split("\n")
    .filter(line => line.length > 0 && !line.startsWith("# "))
    .map(line => line.replaceAll("\u23ce", "\n"));
}
