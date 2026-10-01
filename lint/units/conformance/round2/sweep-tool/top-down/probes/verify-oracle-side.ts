// usage: bun verify-oracle-side.ts <tree> <lines of --each>
// Holds the oracle's side of every line "fail <name> line N: - <json>..." against line N of the oracle file of the instance, read here from the corpus.
import { readFileSync } from "node:fs";
const [tree, linesPath] = process.argv.slice(2);
const home = `${tree}/test/cli/lint/conformance`;
const { loadOracleTable, oracleOf, readOracle } = await import(`${home}/runner/oracle`);
const { corpusPaths } = await import(`${home}/runner/paths`);
const { enumerateInstances } = await import(`${home}/runner/compiler_runner`);
const paths = corpusPaths(`${home}/corpus`);
const table = loadOracleTable(paths);
const suiteOf = new Map<string, string>();
for (const i of enumerateInstances(paths.cases)) suiteOf.set(i.name, i.suite);
const display = (line: string) => {
  const text = line.replaceAll("\x1b", "\\x1b").replaceAll("\r", "\\r").replaceAll("\n", "\\n");
  return text.length > 500 ? text.slice(0, 500) + "..." : text;
};
const side = /^(\.\.\.)?("(?:[^"\\]|\\.)*")(\.\.\.)?/;
const counts = { lines: 0, withOracleSide: 0, same: 0, cut: 0, bad: 0, bothSides: 0, sidesEqual: 0, plusOnly: 0 };
for (const line of readFileSync(linesPath, "utf8").split("\n")) {
  if (line === "") continue;
  counts.lines++;
  const m = /^fail (\S+) line (\d+):(.*)$/s.exec(line);
  if (m === null) continue;
  const [, name, n, rest] = m;
  let text = rest;
  let minus: string | undefined;
  let plus: string | undefined;
  let cut = false;
  if (text.startsWith(" - ")) {
    const s = side.exec(text.slice(3))!;
    minus = JSON.parse(s[2]);
    cut = s[3] !== undefined;
    text = text.slice(3 + s[0].length);
  }
  if (text.startsWith(" + ")) {
    const s = side.exec(text.slice(3))!;
    plus = JSON.parse(s[2]);
    text = text.slice(3 + s[0].length);
  }
  if (text !== "") { counts.bad++; console.log("BAD rest", line.slice(0, 200)); continue; }
  if (minus !== undefined && plus !== undefined) { counts.bothSides++; if (minus === plus) counts.sidesEqual++; }
  if (minus === undefined) { counts.plusOnly++; continue; }
  counts.withOracleSide++;
  const oracle = new TextDecoder().decode(readOracle(oracleOf(table, suiteOf.get(name), name)));
  const want = display(oracle.split("\r\n")[Number(n) - 1] ?? "<no such line>");
  const shown = cut ? minus + "..." : minus;
  if (cut) counts.cut++;
  if (want === shown) counts.same++;
  else { counts.bad++; if (counts.bad <= 5) console.log("BAD", name, n, JSON.stringify(want).slice(0, 150), JSON.stringify(shown).slice(0, 150)); }
}
console.log(JSON.stringify(counts));
