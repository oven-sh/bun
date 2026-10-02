// Scratch of the top-down pass: rows.facts.json with four more facts of tsc for the whole-source test, in rows.facts2.json.
//   types             the outline of the type of each variable, class property and parameter outside a type, by its start
//   returnTypes       the outline of each return type outside a type
//   typeParameters    "<lt,end>{pos,end} name[start,end) ..." of each function, arrow function and class
//   heritage          "extends|implements: outline" of each clause of a class
import { readFileSync, writeFileSync } from "node:fs";
const here = new URL("..", import.meta.url).pathname;
const rows = JSON.parse(readFileSync(here + "rows.facts.json", "utf8"));
const shift = (text, by) => text.replace(/\d+/g, n => String(Number(n) + by));
const ANNOTATED = new Set(["VariableDeclaration", "PropertyDeclaration", "Parameter"]);
const OWNERS = new Set(["ArrowFunction", "FunctionDeclaration", "FunctionExpression", "MethodDeclaration", "ClassDeclaration", "ClassExpression", "Constructor"]);
for (const r of rows) {
  if (!r.facts) continue;
  const f = r.facts;
  const at = list => list.sort((a, b) => a.start - b.start);
  f.types = at(r.roots.filter(x => x.entry === "type" && ANNOTATED.has(x.site))).map(x => shift(x.outline, x.start));
  f.returnTypes = at(r.roots.filter(x => x.entry === "return")).map(x => shift(x.outline, x.start));
  f.typeParameters = at(r.roots.filter(x => x.entry === "type-parameters" && OWNERS.has(x.site))).map(x => `<${x.start},${x.end}>` + shift(x.outline, x.start));
  f.heritage = at(r.roots.filter(x => x.entry === "heritage" && x.site.startsWith("Class"))).map(x => `${x.site.split(".")[1]}: ${shift(x.outline, x.start)}`);
}
writeFileSync(here + "rows.facts2.json", JSON.stringify(rows));
console.log("rows.facts2.json");
