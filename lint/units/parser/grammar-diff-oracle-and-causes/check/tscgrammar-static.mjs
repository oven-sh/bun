// Scratch: the codes that typescript.js 6.0.2 names in calls of its checker's grammarError* functions (static scan).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const TS = "/workspace/bun/node_modules/typescript/lib/typescript.js";
const ts = createRequire(import.meta.url)(TS);
const text = readFileSync(TS, "utf8");
const D1 = new Set(JSON.parse(readFileSync("grammar-codes.json", "utf8")).codes);
const E1 = new Set(JSON.parse(readFileSync("checker-grammar-codes.json", "utf8")).new.concat([17019, 17020]));
const direct = new Map();
const indirect = [];
const re = /\bgrammarError(?:OnNode|OnFirstToken|AtPos|AfterFirstToken|OnNodeSkippedOn)\(/g;
for (let m; (m = re.exec(text)); ) {
  if (text.slice(m.index - 9, m.index) === "function ") continue;
  let end = text.indexOf(";\n", m.index);
  if (end < 0 || end - m.index > 1500) end = m.index + 1500;
  const call = text.slice(m.index, end);
  const names = [...call.matchAll(/Diagnostics\.(\w+)/g)].map(x => x[1]);
  const line = text.slice(0, m.index).split("\n").length;
  if (names.length === 0) indirect.push([line, call.replace(/\s+/g, " ").slice(0, 140)]);
  for (const n of names) {
    if (!direct.has(n)) direct.set(n, []);
    direct.get(n).push(line);
  }
}
const codes = new Map();
for (const [n, lines] of direct) {
  const d = ts.Diagnostics[n];
  if (!d) { console.log("no Diagnostics." + n); continue; }
  codes.set(d.code, { name: n, lines, cat: d.category });
}
const all = [...codes.keys()].sort((a, b) => a - b);
console.log("direct call sites name", direct.size, "diagnostics,", all.length, "codes");
const onlyHere = all.filter(c => !D1.has(c) && !E1.has(c));
console.log("named in tsc 6.0.2 grammarError* calls, in neither D1 nor E1:\n   " + onlyHere.map(c => `${c} ${codes.get(c).name.slice(0, 90)} @${codes.get(c).lines.slice(0, 3)}`).join("\n   "));
console.log("D1 codes never named in a tsc grammarError* call:", [...D1].filter(c => !codes.has(c)).sort((a, b) => a - b).join(" "));
console.log("E1 codes never named in a tsc grammarError* call:", [...E1].filter(c => !codes.has(c)).sort((a, b) => a - b).join(" "));
console.log("calls whose message is a variable:");
for (const [line, call] of indirect) console.log("  ", line, call);
writeFileSync("tsc-grammar-direct.json", JSON.stringify({ codes: all }));
