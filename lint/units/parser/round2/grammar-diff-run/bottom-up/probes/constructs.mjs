// bun constructs.mjs <diff.jsonl>...: the records with the mark !! by construct (the fix that owns them).
import { readFileSync } from "node:fs";
const code = d => (/TS(\d+)$/.exec(d.cause) ?? [])[1];
const t = d => d.t ?? d.src;
const inHer = d => d.ctx === "heritage" || d.ctx === "iextends";
const entry = d => (inHer(d) ? d.t : (/^(?:class \w+ implements|interface \w+ (?:extends|implements)) ([^]*)$/.exec(d.src) ?? [])[1]);
const RULES = [
  ["M1 metadata: a class of the file in a branch of a conditional type", d => d.cause.startsWith("FORBIDDEN metadata")],
  ["C2 accessor without standard decorators after readonly/declare, or optional", d => ["1243", "1276"].includes(code(d))],
  ["C1 class index signature without a type or not one plain parameter", d => /^class \w+ \{/.test(d.src) && (code(d) === "1021" || (code(d) === "1096" && (/^class \w+ \{ \[/.test(d.src) || /\n\[\]; \}$/.test(d.src))))],
  ["H1 interface: second extends/implements list, empty list, comma before {", d => /^interface /.test(d.src) && (["1172", "1176", "1097", "1009"].includes(code(d)) || (d.ctx === "iextends" && /\bextends\b/.test(d.t) && !/^[\s]*[(\[{<]|^new\b|^\s*\(|import\(/.test(d.t)))],
  ["H2 extends/implements entry read as an expression that no left-hand-side expression starts", d => entry(d) !== undefined && /^\s*(typeof\b|[-+!~]|delete\b|void\b|await\b|<|@|\+\+|--)/.test(entry(d)) && !/^\s*<out/.test(entry(d))],
  ["P1 signature of a type: initializer after ?, after a rest parameter or after a rest element", d => ["1015", "1048", "1186"].includes(code(d)) || /\(a\?: A = 1\) =>/.test(t(d))],
  ["P2 modifiers of a parameter repeated or in another order", d => ["1028", "1029", "1030"].includes(code(d))],
  ["T1 named tuple element with ? after its type", d => code(d) === "5086" || /\[a\??: A?\?\]/.test(t(d))],
  ["N1 type reference A.<B>", d => code(d) === "8020" || (/[\w\]]\.<\w/.test(t(d)) && !/import\(/.test(t(d)))],
  ["N3 constraint of a type parameter that starts an expression (super, class, delete, in)", d => /<U extends\s+(super|class|delete|in)\b/.test(d.src)],
  ["N2 private name as a type name", d => code(d) === "2304" || (code(d) === "1110" && /<U extends #a/.test(d.src))],
  ["N4 extends where a type argument starts", d => /^f<\s*extends>/.test(d.src)],
  ["O1 member of a type named by a private name or a bigint", d => ["18016", "1539"].includes(code(d)) || /\{ #a:\s+\}/.test(t(d))],
  ["O2 property signature with an initializer", d => ["1247", "1246"].includes(code(d))],
  ["O3 accessor of a type with a body", d => code(d) === "1183"],
  ["O5 computed name of a property or method of a type that is an expression", d => ["1170", "1169"].includes(code(d))],
  ["O4 index signature of a type: rest, ?, comma, not one parameter", d => ["1017", "1019", "1025", "1096", "1020"].includes(code(d)) || /\{ (readonly )?\[(\.\.\.k|k\?|k: string,|)[^\]]*\]: A \}/.test(t(d))],
];
const table = new Map();
const unowned = new Map();
for (const path of process.argv.slice(2)) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    const d = JSON.parse(line);
    if (!/^(RESTORE|FORBIDDEN|NO ORACLE|unexplained)/.test(d.cause) && /^(R>A|A>A|R>R)$/.test(d.cls)) continue;
    const rule = RULES.find(r => r[1](d));
    const key = rule ? rule[0] : "?? " + d.cause;
    if (!table.has(key)) table.set(key, { records: 0, sources: new Set(), codes: new Set(), ex: d.src });
    const row = table.get(key);
    row.records++; row.sources.add(d.src); if (code(d)) row.codes.add("TS" + code(d));
    if (d.src.length < row.ex.length) row.ex = d.src;
    if (!rule) unowned.set(d.src, d.cause);
  }
}
let records = 0, sources = 0;
for (const [key, row] of [...table].sort()) { records += row.records; sources += row.sources.size; console.log(`${String(row.records).padStart(6)} records ${String(row.sources.size).padStart(4)} sources  ${key}  [${[...row.codes].sort((a, b) => a.slice(2) - b.slice(2)).join(" ")}]  e.g. ${JSON.stringify(row.ex)}`); }
console.log(`${records} records, ${sources} sources`);
for (const [src, cause] of [...unowned].slice(0, 40)) console.log("   unowned:", cause, JSON.stringify(src));
