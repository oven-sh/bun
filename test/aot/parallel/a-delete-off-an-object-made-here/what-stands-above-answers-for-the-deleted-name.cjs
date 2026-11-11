'use strict';
const said = [];
const show = (k, v) => v === undefined ? "<undefined>" : v;
{ // the prototype holds the name
  const above = { name: "above", zip: "z" }; function f(i) { const o = { __proto__: above, id: i, name: "x", n: i + 1 }; const before = o.name; const a = delete o.name; const b = delete o.zip; return [before, o.name, "name" in o, o.hasOwnProperty("name"), a, b, o.zip, Object.keys(o).join()]; }
  for (let i = 0; i < 6; i++) said.push("d04 " + JSON.stringify(f(i), show));
}
{ // an instance of a class
  class P { constructor(i) { this.id = i; this.name = "x"; this.n = i + 1; } get zip() { return "getter above"; } } function f(i) { const o = new P(i); const a = delete o.name; const b = delete o.zip; return [a, b, o.name, o.zip, Object.keys(o).join(), o.n]; }
  for (let i = 0; i < 6; i++) said.push("d23 " + JSON.stringify(f(i), show));
}
{ // the prototype is set behind the birth
  const above = { name: "above" }; function f(i) { const o = { id: i, name: "x", n: i + 1 }; Object.setPrototypeOf(o, above); delete o.name; return [o.name, Object.keys(o).join()]; }
  for (let i = 0; i < 6; i++) said.push("d24 " + JSON.stringify(f(i), show));
}
console.log(said.join("\n"));
