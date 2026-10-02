// Every row with what main does, what tsc says, the cause of round 2 that owns it, and its class:
//   T        syntax that main's skipper (parse_skip_typescript.rs) rejects and tsc takes
//   O-stmt, O-member, O-param, O-class, O-expr    the same, decided outside the skipper
//   M        decorator metadata: main accepts and writes another value than tsc
//   X        other output: main accepts and reads another program
// usage: bun classify.mjs     (reads rows.json and runs/*.json, writes rows.classified.json)   GD as in tsc-rows.mjs
import { readFileSync, writeFileSync } from "node:fs";
const GD = process.env.GD ?? "/tmp/tkd/gd";
const causes = (await import(GD + "/causes.mjs")).default;
const { recordOf } = await import(GD + "/oracle.mjs");
const here = new URL(".", import.meta.url).pathname;
const read = name => JSON.parse(readFileSync(here + name, "utf8"));
const rows = read("rows.json");
const main = read("runs/main.f4d755a9c.json");
const head = read("runs/head.23a20afa7.json");
const tsc = read("runs/tsc.json").rows;
const API = { ts: "t.ts.plain", tsx: "t.tsx.plain", deco: "t.ts.deco" };
const kind = v => (v[0] === "e" ? "R" : "A");
const T_CAUSES = new Set([
  "a reserved word is the name of a type reference",
  "a reserved word is the label of a rest element of a tuple",
  "an import type takes type arguments and an expression in an attribute; .< stands before type arguments",
  "the type of an assertion predicate starts on the next line",
  "a parameter of a signature has an initializer",
  "a binding pattern of a signature is read as a binding pattern",
  "out or in names a type or a type parameter",
  "a comparison follows the type after as and satisfies",
]);
function classOf(r) {
  const c = r.cause;
  if (r.key) return "M";
  if (T_CAUSES.has(c)) return "T";
  if (c === "a modifier stands before a parameter that is no parameter property") return /^(function f\(|class C \{ m\()/.test(r.src) ? "O-param" : "T";
  if (c === "an interface extends, or a class implements, an expression") return r.src.startsWith("interface") ? "T" : "O-class";
  if (c === "a colon follows parentheses between ? and : of a conditional" || c === "a colon follows an operand that ends with a parenthesis") return "O-expr";
  if (c === "a comma ends an index signature of a class" || c === "accessor is a modifier without standard decorators") return "O-member";
  if (c === "a comma follows the rest parameter of a signature of a declared class") return "O-param";
  if (r.main[0] === "o") return "X";
  return "O-stmt";
}
const oracle = new Map();
const out = rows.map((r, i) => {
  const m = main.rows[i];
  const h = head.rows[i];
  let cause;
  if (r.loader === "js") cause = "js loader: the attributes of a module path start on the next line";
  else {
    if (!oracle.has(r.src)) oracle.set(r.src, recordOf(r.src));
    const d = { src: r.src, ctx: null, t: null, prod: r.group, mut: null, api: API[r.loader], cls: `${kind(m.got)}>${kind(h.got)}`, base: m.got, next: h.got, tsc: oracle.get(r.src) };
    cause = "unexplained";
    for (const candidate of causes) {
      const matched = candidate.match(d);
      if (matched) { cause = typeof matched === "string" ? `${candidate.id} ${matched}` : candidate.id; break; }
    }
  }
  const row = { i, ...r, main: m.got, mainDesign: m.design, cause, tsc: tsc[i] };
  row.class = classOf(row);
  // Valid for tsc as a whole: no parse diagnostic and no grammar error of the checker (the rule of round 2).
  row.valid = row.tsc.parse.length === 0 && row.tsc.chk.length === 0;
  return row;
});
writeFileSync(here + "rows.classified.json", JSON.stringify(out));
const table = new Map();
for (const r of out) {
  const key = `${r.class}\t${r.cause}`;
  if (!table.has(key)) table.set(key, { rows: 0, sources: new Set(), rejected: 0, invalid: 0 });
  const t = table.get(key);
  t.rows++;
  t.sources.add(r.loader + "\0" + r.src);
  if (r.main[0] === "e") t.rejected++;
  if (!r.valid) t.invalid++;
}
console.log("class\trows\tsources\tmain rejects\tnot valid for tsc\tcause");
for (const [key, t] of [...table].sort()) console.log(`${key.split("\t")[0]}\t${t.rows}\t${t.sources.size}\t${t.rejected}\t${t.invalid}\t${key.split("\t")[1]}`);
const by = {};
for (const r of out) by[r.class] = (by[r.class] ?? 0) + 1;
console.log(JSON.stringify(by), out.length);
