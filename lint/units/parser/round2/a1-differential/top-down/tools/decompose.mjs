// usage: node decompose.mjs <diff.jsonl>   every record with the mark !! or ??, by the site that takes it back or the witness that explains it
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
const path = process.argv[2];
const aliasCause = new Map();
const rows = [];
const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const head = line.slice(0, 120);
  const isMarked = /^\{"cause":"(RESTORE|ruling|FORBIDDEN|unexplained|NO ORACLE)/.test(head);
  const isAlias = line.includes('"ctx":"alias"') && line.includes('"api":"t.ts.plain"');
  if (!isMarked && !isAlias) continue;
  const d = JSON.parse(line);
  if (d.ctx === "alias" && d.api === "t.ts.plain" && d.t != null) aliasCause.set(d.t, `${d.cls} ${d.cause}`);
  if (isMarked) rows.push({ cause: d.cause, cls: d.cls, src: d.src, t: d.t, ctx: d.ctx, api: d.api, parse: d.tsc?.ts?.map(x => x[0]) ?? [], chk: (d.tsc?.chk?.ts ?? d.tsc?.chk?.tsx ?? []).map(x => x[0]) });
}
const heritage = r => r.ctx === "heritage" || r.ctx === "iextends" || (r.ctx == null && /\b(implements|interface\s+\w+\s+extends)\b/.test(r.src));
function site(r) {
  const s = r.t ?? r.src;
  const a = r.t != null ? aliasCause.get(r.t) : undefined;
  if (/^ruling: metadata/.test(r.cause)) return /\bis\b/.test(s) && !/extends/.test(s.split(/\bis\b/)[0]) && r.ctx !== "ret" ? "P  metadata: a predicate outside a return type keeps the tag of its name (fix)" : "D2 metadata of a source that tsc does not parse, conditional type or assertion (ruling)";
  if (/^FORBIDDEN metadata/.test(r.cause)) return "F1 metadata: a class of the file in a branch of a conditional type (fix)";
  if (/^ruling: A>A a declaration|^ruling: cast after/.test(r.cause)) return r.cls === "A>A" ? "D3 A>A that is no metadata: a declaration named as (output equals the emit of tsc) (ruling)" : "W3 witness: type as any after type as = 1";
  if (/^ruling: attributes of an export/.test(r.cause)) return "D1 a line break before with of an export: ECMAScript allows, tsc rejects (ruling)";
  if (/^ruling: attributes of a type-only import/.test(r.cause)) return "W4 witness: import type with attributes on one line (TS2857)";
  if (/TS1102/.test(r.cause)) return "W6 witness: delete of a name in a heritage expression (TS1102)";
  if (/with \(A\) \{\}/.test(r.src)) return "W2 witness: with statement after an import on the next line";
  if (r.chk.includes(1108)) return "W1 witness: a block with return after the function (TS1108)";
  if (heritage(r) && a && /^R>A (?!RESTORE)/.test(a)) return "WH witness: a type in a heritage clause, where tsc reads an expression (H8)";
  if (/=>\s*$/.test(s) && (r.ctx === "ret" || r.ctx === "fnret")) return "WB witness: a function type without a return type before a body, which is read as an object type";
  if (/^<out\s*>\(\) =>\s*$/.test(s)) return "WA witness: a missing type inside an attempt is not reported (H3)";
  if (/A<>\.C/.test(s)) return "W5 witness: an instantiation expression before a property access (TS1477)";
  if (/\.\s*</.test(s) && !/import/.test(s)) return "R1 .< after a dot of a type reference";
  if (/#\w/.test(s) && /\{[^}]*#\w+\s*(\?|:|\(|\})/.test(s)) return "R9 private name or bigint names a type member";
  if (/\b1n\s*:/.test(s)) return "R9 private name or bigint names a type member";
  if (/#\w/.test(s)) return r.ctx === "tparam" || /<\w+ extends #/.test(s) ? "R3 constraint of a type parameter: a word that starts an expression, a private name" : "R2 private name as the name of a type";
  if (r.ctx === "tparam" || /<\w+ extends (class|delete|super|in|instanceof)\b/.test(s)) return "R3 constraint of a type parameter: a word that starts an expression, a private name";
  if (/^\s*extends\s*$/.test(s) || /<extends>|\[extends\]/.test(s)) return "R3b extends as an element of a list of types";
  if (/\baccessor\b/.test(s)) return "W7 witness: accessor with a modifier or ?, which the base reads with the default options";
  if (/^class \w+ \{ \[|class \{ \[|A\n\[\]|\(A\)\n\[\]/.test(s) || (r.ctx === "field" && /\n\[\]$/.test(s))) return "R12 index signature of a class";
  if (/\b(public|private|protected|readonly|override)\s+(public|private|protected|readonly|override)\b/.test(s)) return /^function|^class \w+ \{ \w+\(/.test(s) ? "R13 order of parameter modifiers (parse_fn.rs)" : "R7 parameters of a signature: modifiers, ? or ... with an initializer";
  if (/\?\s*(:\s*[^=,)]+)?=|\.\.\.[^,)]*=/.test(s) && /=>|\)\s*:/.test(s)) return "R7 parameters of a signature: modifiers, ? or ... with an initializer";
  if (/\[\s*\w+\??:\s*[^\],]*\?\s*[\],]|\[\s*\w+\??:\s*\?\s*\]/.test(s)) return "R8 labeled element of a tuple with ? or ... at its type";
  if (/\{[^}]*\bget\b[^}]*\)\s*(:\s*\w+\s*)?\{/.test(s) || /\bset\b[^}]*\)\s*\{/.test(s)) return "R10 body of an accessor of a type";
  if (/\{[^{}]*:[^{}=]*=[^>]/.test(s) && !/=>/.test(s)) return "R6 initializer of a property of a type";
  if (/\{\s*(readonly\s+)?\[/.test(s)) return /\[\s*(\.\.\.|\]|\w+\s*[?,]|\w+\s*:[^\]]*,)/.test(s) ? "R4 index signature of a type with what the checker reports" : "R5 computed name of a type member that is an expression";
  if (heritage(r)) return /extends\s+[^{]*\bextends\b|implements[^{]*\b(extends|implements)\b|extends\s*(\w+\s*,\s*)*\{\}\s*$|extends\s*\{\}$|^\s*$|^A extends|extends A$|extends\s*$|infer\s+extends/.test(r.ctx ? `interface I extends ${s} {}` : s) && !/^[-+!~]|^(typeof|void|delete|await)\b|^</.test(s) ? "R11c clauses of an interface: a second extends, implements before extends, an empty list" : "R11a heritage entry read as an expression: a unary operator or a type assertion";
  return "?? " + r.cause;
}
const table = new Map();
for (const r of rows) {
  const k = site(r);
  if (!table.has(k)) table.set(k, { records: 0, sources: new Set(), ex: r.src });
  const t = table.get(k);
  t.records++;
  t.sources.add(r.src);
}
let total = 0;
for (const [k, t] of [...table].sort()) {
  total += t.records;
  console.log(`${String(t.records).padStart(6)} records ${String(t.sources.size).padStart(4)} sources  ${k}\n          e.g. ${JSON.stringify(t.ex).slice(0, 110)}`);
}
console.log(`${total} records`);
