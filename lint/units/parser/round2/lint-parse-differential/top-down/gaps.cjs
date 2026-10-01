// usage: node gaps.cjs <join.jsonl>... [--examples=N] [--list=<family id>]
// Class "LT" (the lint parse parses, the reference rejects) of the join files, by production. A record belongs to the first family whose test holds.
// Prints one table over all the files: family, count for each file, the first codes of typescript-go, examples.
const fs = require("node:fs");
const args = process.argv.slice(2);
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const joins = args.filter(a => !a.startsWith("--"));
const nExamples = Number(flag("examples") ?? 2);
const has = (s, re) => re.test(s);
const RESERVED = "break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|function|if|import|in|instanceof|new|null|return|super|switch|this|throw|true|try|typeof|var|void|while|with";
const FAMILIES = [
  ["TS1477", "instantiation expression before a property access: `a<b>.c`", r => r.go[0] === 1477 || (r.t !== null && has(r.t, /<[^<>]*>\.\w/) && has(r.t, /^(A|typeof a| a)</))],
  ["TS2880", "`assert` where import attributes take `with`", r => r.go[0] === 2880],
  ["TS1034", "`super` without `.`, `[` or `(`", r => r.go[0] === 1034],
  ["INTERFACE-EXTENDS", "entry of an interface `extends` list that is no expression with type arguments (read as a type by the Discard sink)", r => r.ctx === "iextends"],
  ["CLASS-IMPLEMENTS", "entry of a class `implements` list that is no expression with type arguments (read as a type)", r => r.ctx === "heritage"],
  ["ALIAS-DISCARD", "type of a type alias, read by the Discard sink", r => r.ctx === "alias"],
  ["IS-PREDICATE", "`x is T` outside a return type", r => r.t !== null && has(r.t, /(^|[\s\[(])(\w+) is\b/) && !has(r.t, /^asserts is\s*$/)],
  ["TUPLE-RESERVED-WORD", "tuple element that starts with a reserved word that starts no type", r => r.t !== null && has(r.t, new RegExp(`^\\[(\\.\\.\\.)?(${RESERVED})\\b`)) && !has(r.t, /^\[(\.\.\.)?(new|typeof|import|void|null|true|false|this)\b/)],
  ["INFER-POSTFIX", "`infer U[]`: a postfix after the type parameter of `infer`", r => r.t !== null && has(r.t, /infer \w+\[\]/)],
  ["OPERATOR-FN", "function or constructor type as the operand of `keyof` or `readonly`", r => r.t !== null && has(r.t, /^(keyof|readonly)\s+(new\s*)?\(/)],
  ["OPERATOR-NAME", "`unique`, `keyof`, `readonly` or `infer` read as a name", r => r.t !== null && has(r.t, /\b(unique|keyof|readonly|infer)\b/)],
  ["TARGS-AFTER-TYPE", "type arguments after a cast whose type takes none, or on the next line", r => r.t !== null && (r.ctx === "as" || r.ctx === "satisfies") && has(r.t, /<[^<>]*>?$/)],
  ["IMPORT-ATTRIBUTES", "import type: what follows the `,`", r => r.t !== null && has(r.t, /^import\('x',/)],
  ["TUPLE-EMPTY-ELEMENT", "tuple with an empty element in an attempt at type arguments", r => r.t !== null && has(r.t, /^\[,|,,/)],
  ["ATTEMPT-OTHER", "an attempt at type arguments or at an arrow return type that the reference refuses", r => r.ctx === "targ" || r.ctx === "ternary" || r.ctx === "arrowret" || r.ctx === "angle"],
];
const files = [];
const table = new Map();
for (const path of joins) {
  const name = path.replace(/^.*\//, "").replace(".join.jsonl", "");
  files.push(name);
  for (const line of fs.readFileSync(path, "utf8").split("\n")) {
    if (!line.includes('"cls":"LT"')) continue;
    const r = JSON.parse(line);
    if (r.cls !== "LT") continue;
    let id = "UNCLASSIFIED";
    for (const [fid, , test] of FAMILIES) {
      if (test(r)) { id = fid; break; }
    }
    if (!table.has(id)) table.set(id, { counts: {}, rows: [], codes: {}, ctx: {} });
    const e = table.get(id);
    e.counts[name] = (e.counts[name] ?? 0) + 1;
    e.rows.push([name, r]);
    const key = `TS${r.go[0]} ${r.go[3]}`;
    e.codes[key] = (e.codes[key] ?? 0) + 1;
    e.ctx[r.ctx ?? r.prod] = (e.ctx[r.ctx ?? r.prod] ?? 0) + 1;
  }
}
const title = id => FAMILIES.find(f => f[0] === id)?.[1] ?? "";
const list = flag("list");
console.log(["family", ...files].join("\t"));
const order = [...FAMILIES.map(f => f[0]), "UNCLASSIFIED"].filter(id => table.has(id));
for (const id of order) console.log([id, ...files.map(f => table.get(id).counts[f] ?? 0)].join("\t"));
console.log(["TOTAL", ...files.map(f => order.reduce((n, id) => n + (table.get(id).counts[f] ?? 0), 0))].join("\t"));
console.log("");
for (const id of order) {
  const e = table.get(id);
  if (list && list !== id) continue;
  console.log(`== ${id}: ${title(id)}`);
  console.log(`   first diagnostic of typescript-go: ${Object.entries(e.codes).sort((a, b) => b[1] - a[1]).slice(0, list ? 100 : 8).map(([k, n]) => `${k} x${n}`).join("; ")}`);
  console.log(`   contexts: ${Object.entries(e.ctx).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} x${n}`).join(", ")}`);
  const seen = new Set();
  const seenCode = new Set();
  let shown = 0;
  for (const [name, r] of e.rows) {
    if (seen.has(r.src)) continue;
    seen.add(r.src);
    if (!list && seenCode.has(r.go[0]) && shown >= nExamples) continue;
    if (!list && shown >= nExamples * 3) continue;
    seenCode.add(r.go[0]);
    shown++;
    console.log(`     ${JSON.stringify(r.src)}  [${name}] go: TS${r.go[0]} at ${r.go[1]}..${r.go[2]} ${JSON.stringify(r.go[3])}${r.tsc === null ? " (tsc parses)" : r.tsc[0] !== r.go[0] ? ` (tsc TS${r.tsc[0]})` : ""}`);
  }
  console.log(`   distinct sources: ${seen.size}`);
}
