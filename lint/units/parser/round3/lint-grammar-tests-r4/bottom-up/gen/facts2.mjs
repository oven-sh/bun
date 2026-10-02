// rows.facts.json of tests-known-differences/bottom-up with four more facts of tsc for the whole-source test, in ../rows.facts2.json.
// (The same script as gen/facts2.mjs of the top-down pass of this unit, with the paths of this directory.)
// usage: node facts2.mjs
//   types             the outline of the type of each variable, class property and parameter outside a type, by its start;
//                     not the parameters of an index signature or of a signature that is a member of an interface
//   returnTypes       the outline of each return type outside a type
//   typeParameters    "<lt,end>{pos,end} name[start,end) ..." of each function, arrow function and class
//   heritage          "extends|implements: outline" of each clause of a class
import { readFileSync, writeFileSync } from "node:fs";
import { ts, parse } from "/workspace/notes/lint/units/parser/round3/tests-known-differences/bottom-up/gen/roots.mjs";
const here = new URL("..", import.meta.url).pathname;
const rows = JSON.parse(readFileSync("/workspace/notes/lint/units/parser/round3/tests-known-differences/bottom-up/rows.facts.json", "utf8"));
const shift = (text, by) => text.replace(/\d+/g, n => String(Number(n) + by));
const ANNOTATED = new Set(["VariableDeclaration", "PropertyDeclaration", "Parameter"]);
const OWNERS = new Set(["ArrowFunction", "FunctionDeclaration", "FunctionExpression", "MethodDeclaration", "ClassDeclaration", "ClassExpression", "Constructor"]);
// The parameters whose signature is a member of a type or an index signature: no binding of theirs stays, so no annotation is kept for them.
const K = ts.SyntaxKind;
const MEMBER = new Set([K.IndexSignature, K.CallSignature, K.ConstructSignature, K.MethodSignature]);
function memberParameterTypes(src, loader) {
  const sf = parse(src, loader === "deco" ? "ts" : loader);
  const starts = new Set();
  const visit = n => {
    if (n.kind === K.Parameter && n.type && MEMBER.has(n.parent.kind)) starts.add(n.type.getStart(sf));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return starts;
}
for (const r of rows) {
  if (!r.facts) continue;
  const f = r.facts;
  const at = list => list.sort((a, b) => a.start - b.start);
  const ofMembers = memberParameterTypes(r.src, r.loader);
  f.types = at(r.roots.filter(x => x.entry === "type" && ANNOTATED.has(x.site) && !(x.site === "Parameter" && ofMembers.has(x.start)))).map(x => shift(x.outline, x.start));
  f.returnTypes = at(r.roots.filter(x => x.entry === "return")).map(x => shift(x.outline, x.start));
  f.typeParameters = at(r.roots.filter(x => x.entry === "type-parameters" && OWNERS.has(x.site))).map(x => `<${x.start},${x.end}>` + shift(x.outline, x.start));
  f.heritage = at(r.roots.filter(x => x.entry === "heritage" && x.site.startsWith("Class"))).map(x => `${x.site.split(".")[1]}: ${shift(x.outline, x.start)}`);
}
writeFileSync(here + "rows.facts2.json", JSON.stringify(rows));
console.log("rows.facts2.json");
