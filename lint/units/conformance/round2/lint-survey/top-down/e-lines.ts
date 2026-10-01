// usage: bun e-lines.ts <clone with the corpus> <raw.jsonl of bottom-up/raw.ts> <out.tsv>
// A heuristic for the parser unit, beyond class C: for every instance of class E where the command printed an error
// of Bun's parser, is each of Bun's lines on a line of a file where the oracle has an error too (any code)? A line of
// Bun without one is a place where Bun reports and typescript-go does not, or reports on another line.
// It starts no process.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [tree, rawPath, outPath] = process.argv.slice(2);
const home = resolve(tree, "test/cli/lint/conformance");
const { corpusPaths } = await import(join(home, "runner/paths.ts"));
const { enumerateCase } = await import(join(home, "runner/compiler_runner.ts"));
const { loadOracleTable, oracleOf, readOracle } = await import(join(home, "runner/oracle.ts"));
const paths = corpusPaths(join(home, "corpus"));
const table = loadOracleTable(paths);
const decoder = new TextDecoder();
const head = /^(?:(\S.*?)\((\d+),(\d+)\): )?(error|warning|suggestion|message) (?:TS(-?\d+)|([A-Za-z@][A-Za-z0-9@/_-]*)): (.*)$/;
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

let instances = 0;
let allCovered = 0;
let someCovered = 0;
let noneCovered = 0;
let linesTotal = 0;
let linesCovered = 0;
const uncoveredTexts = new Map<string, number>();
const coveredCodes = new Map<string, number>();
const out: string[] = ["# instance\tcase path\tBun error lines\tof them on a line where the oracle has an error\tfirst line of Bun without one"];
for (const text of readFileSync(rawPath, "utf8").split("\n")) {
  if (text === "") continue;
  const r = JSON.parse(text);
  if (r.kind !== "E" || r.died) continue;
  const bun: { file: string; line: number; text: string; whole: string }[] = [];
  for (const line of String(r.stderr ?? "").split("\n")) {
    const m = head.exec(line);
    if (m === null || m[4] !== "error" || m[6] !== "syntax" || m[1] === undefined) continue;
    bun.push({ file: base(m[1]), line: Number(m[2]), text: m[7], whole: line });
  }
  if (bun.length === 0) continue;
  const enumerated = enumerateCase(paths.cases, r.casePath).find((i: { name: string }) => i.name === r.name);
  if (enumerated === undefined) continue;
  const oracle = decoder.decode(readOracle(oracleOf(table, enumerated.suite, r.name)));
  // The first section of a baseline: the lines of the plain format, up to the first empty line.
  const oracleLines = new Map<string, string[]>();
  for (const line of oracle.split("\r\n")) {
    if (line === "") break;
    const m = head.exec(line);
    if (m === null || m[1] === undefined) continue;
    const key = `${base(m[1])}:${m[2]}`;
    oracleLines.set(key, [...(oracleLines.get(key) ?? []), `TS${m[5]}`]);
  }
  instances++;
  let covered = 0;
  let first = "";
  for (const b of bun) {
    linesTotal++;
    const codes = oracleLines.get(`${b.file}:${b.line}`);
    if (codes !== undefined) {
      covered++;
      linesCovered++;
      for (const code of new Set(codes)) coveredCodes.set(code, (coveredCodes.get(code) ?? 0) + 1);
    } else {
      if (first === "") first = b.whole;
      const shape = b.text.replace(/"[^"]*"/g, '"…"');
      uncoveredTexts.set(shape, (uncoveredTexts.get(shape) ?? 0) + 1);
    }
  }
  if (covered === bun.length) allCovered++;
  else if (covered === 0) noneCovered++;
  else someCovered++;
  out.push([r.name, r.casePath, bun.length, covered, first].join("\t"));
}
writeFileSync(resolve(outPath), out.join("\n") + "\n");
console.log(`class E instances where Bun's parser printed an error: ${instances}`);
console.log(`  every line of Bun is on a line where the oracle has an error: ${allCovered}`);
console.log(`  some lines: ${someCovered}; no line: ${noneCovered}`);
console.log(`error lines of Bun: ${linesTotal}; on a line where the oracle has an error: ${linesCovered}`);
console.log("codes of the oracle on the lines that Bun also reports (lines of Bun):");
for (const [code, n] of [...coveredCodes].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(5)}  ${code}`);
console.log("texts of Bun on lines where the oracle has nothing (lines):");
for (const [shape, n] of [...uncoveredTexts].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`  ${String(n).padStart(5)}  ${shape}`);
