// Lines for targeted/09-checker-grammar.txt: sources that tsc parses, whose checker reports a grammar error,
// and that the binary that runs this file rejects. Run it with the BASE binary.
//
//   <base bun> harvest.mjs > targeted/09-checker-grammar.txt
//
// Candidates: the rows of class A2 of probes/top-down/results/classes.tsv, and the list below.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expand } from "./harness.mjs";
import { check, parseAs } from "./oracle.mjs";
import { SOURCES } from "./targeted.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MORE = [
  "const a: typeof #a = 1;",
  "type X = typeof #a;",
  "let x: typeof #a.b;",
  "let x = y as typeof #a;",
  "function f(a: typeof #a) {}",
  "let x: A<typeof #a>;",
  "class C { #a = 1; m(): typeof #a { return 1 } }",
  "let x: keyof #a;",
  "let x: #a[];",
  "let x: #a | B;",
  "interface I { #a: A }",
  "interface I { #a(): void }",
];
// What the corpora have already, without the file that this run writes.
const have = new Set();
for (const input of expand(JSON.parse(readFileSync(join(HERE, "corpus.small.json"), "utf8")))) have.add(input.src);
for (const [name, list] of Object.entries(SOURCES)) if (name !== "09-checker-grammar") for (const src of list) have.add(src);
const candidates = [...MORE];
for (const line of readFileSync(join(HERE, "../probes/top-down/results/classes.tsv"), "utf8").split("\n").slice(1)) {
  const cells = line.split("\t");
  if (cells[3] !== "A2" || cells[2] !== "ts") continue;
  candidates.push(cells[7].startsWith('"') ? JSON.parse(cells[7]) : cells[7]);
}
const transpiler = new Bun.Transpiler({ loader: "ts" });
const rejects = src => {
  try {
    transpiler.transformSync(src);
    return false;
  } catch {
    return true;
  }
};
const lines = [];
const seen = new Set();
for (const src of candidates) {
  if (seen.has(src) || have.has(src) || src.startsWith("# ") || src.includes("\u23ce") || src.length === 0) continue;
  seen.add(src);
  if (parseAs(src, "ts").length !== 0) continue;
  if (check(src, "ts", false).grammar.length === 0 || !rejects(src)) continue;
  lines.push(src.replaceAll("\n", "\u23ce"));
}
console.log("# tsc parses, its checker reports a grammar error, the base rejects: a parse without lint keeps rejecting");
console.log(lines.join("\n"));
console.error(`${lines.length} lines, bun ${Bun.version} ${Bun.revision}`);
