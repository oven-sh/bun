// Checks gen/roots.mjs against the expectations that src/js_parser/type_sink_tests.rs holds and that pass in the crate today:
// the outline of every text of TYPES and RETURN_TYPES must be the string of the test.
// usage: node check-outline.mjs
import { readFileSync } from "node:fs";
import { roots } from "./roots.mjs";
const text = readFileSync("/workspace/wt/parser/src/js_parser/type_sink_tests.rs", "utf8");
const unescape = s => s.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c));
function table(name) {
  const at = text.indexOf(`const ${name}:`);
  const body = text.slice(at, text.indexOf("];", at));
  const out = [];
  const re = /b"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"/g;
  for (let m; (m = re.exec(body)); ) out.push([unescape(m[1]), unescape(m[2])]);
  return out;
}
let bad = 0, n = 0;
for (const [source, expected] of table("TYPES")) {
  n++;
  const r = roots(`type T = ${source};`, "ts").roots.find(r => r.entry === "type");
  if (!r || r.outline !== expected) { bad++; console.log("TYPES", JSON.stringify(source), "\n  test:", expected, "\n  gen: ", r?.outline); }
}
for (const [source, expected] of table("RETURN_TYPES")) {
  n++;
  const r = roots(`function f(x: any): ${source} {}`, "ts").roots.find(r => r.entry === "return");
  if (!r || r.outline !== expected) { bad++; console.log("RETURN_TYPES", JSON.stringify(source), "\n  test:", expected, "\n  gen: ", r?.outline); }
}
for (const [source, expected] of [["<T>", "{1,2} T[1,2)"], ["<T, U>", "{1,5} T[1,2) U[4,5)"], ["<T extends A<B>>", "{1,15} T[1,15)"], ["<T = A<B<C>>>", "{1,12} T[1,12)"], ["<in out T, const U extends V = W,>", "{1,33} T[1,9) U[11,32)"]]) {
  n++;
  const r = roots(`class C${source} {}`, "ts").roots.find(r => r.entry === "type-parameters");
  if (!r || r.outline !== expected || r.closeEnd !== source.length) { bad++; console.log("type parameters", source, "\n  test:", expected, "\n  gen: ", r?.outline, r?.closeEnd); }
}
console.log(`${n} expectations of type_sink_tests.rs, ${bad} that gen/roots.mjs does not reproduce`);
