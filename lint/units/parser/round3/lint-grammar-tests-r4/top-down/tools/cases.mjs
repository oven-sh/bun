// The parity audit: one line for each of the 366 cases with the place that holds it after R4.
//   rust: the index of its source in ROWS, and the entries of TYPES, RETURN_TYPES and TYPE_PARAMETERS that hold its type roots
//   api:  the list of "Known differences of a parse without lint" that names it (rejected, metadata, other-program, no-defect)
//   needs: the routes of ../../tests-known-differences/top-down/data/routes.txt
// usage: node cases.mjs <rows.facts2.json> <rows.table.tsv> > cases.tsv
import { readFileSync } from "node:fs";
import { familyOf } from "/tmp/r4td/bu/gen/families.mjs";
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const table = readFileSync(process.argv[3], "utf8").split("\n").filter(Boolean).map(l => l.split("\t"));
const needAt = table[0].indexOf("needs in a lint parse");
const needs = new Map(table.slice(1).map(l => [Number(l[0]), l[needAt]]));
const rowIndex = new Map();
const tables = { type: new Map(), return: new Map(), "type-parameters": new Map() };
const out = [["case", "file", "group", "loader", "class", "family", "want", "ROWS", "type tables", "api list", "needs", "source"].join("\t")];
const SHORT = { "typescript-grammar.test.ts": "tg", "typescript-grammar-expressions.test.ts": "tg-expr", "typescript-grammar-statements.test.ts": "tg-stmt", "typescript-grammar-decorator-metadata.test.ts": "tg-meta" };
const count = { rust: 0, typed: 0, untyped: [], api: {} };
for (const r of rows) {
  const key = r.loader + "\0" + r.src;
  if (!rowIndex.has(key)) rowIndex.set(key, rowIndex.size);
  const held = [];
  if (!r.reject && (r.class === "T" || r.class === "M")) {
    for (const root of r.roots) {
      if (root.entry === "type" || root.entry === "return") {
        const t = tables[root.entry];
        const text = r.src.slice(root.start);
        if (!t.has(text)) t.set(text, t.size);
        held.push(`${root.entry === "type" ? "TYPES" : "RETURN_TYPES"}[${t.get(text)}]`);
      } else if (root.entry === "type-parameters") {
        const t = tables["type-parameters"];
        if (!t.has(root.text)) t.set(root.text, t.size);
        held.push(`TYPE_PARAMETERS[${t.get(root.text)}]`);
      }
    }
    if (held.length) count.typed++; else count.untyped.push(r.i);
  }
  const api = r.key ? "metadata" : r.main[0] === "e" && r.valid ? "rejected" : r.class === "X" && r.valid ? "other-program" : "no-defect";
  count.api[api] = (count.api[api] ?? 0) + 1;
  count.rust++;
  out.push([r.i, SHORT[r.file], r.group, r.loader, r.class, familyOf(r), r.reject ? `Fails(${r.reject.code},${r.reject.start},${r.reject.end})` : "Reads", `ROWS[${rowIndex.get(key)}]`, held.join(" "), api, needs.get(r.i) ?? "?", JSON.stringify(r.src)].join("\t"));
}
console.log(out.join("\n"));
console.error(`${rows.length} cases: ${rowIndex.size} ROWS, ${tables.type.size} TYPES, ${tables.return.size} RETURN_TYPES, ${tables["type-parameters"].size} TYPE_PARAMETERS; T and M cases with a type table entry ${count.typed}, without ${JSON.stringify(count.untyped)}; api lists ${JSON.stringify(count.api)}`);
