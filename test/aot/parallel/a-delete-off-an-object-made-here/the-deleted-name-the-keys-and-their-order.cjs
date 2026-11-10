// STATISTIC: FreshObjectDeletesTracked >= 1
'use strict';
const said = [];
const show = (k, v) => v === undefined ? "<undefined>" : v;
{ // the deleted name is read
  function f(i) { const o = { id: i, name: "x", n: i + 1 }; delete o.name; return [o.name, "name" in o, o.hasOwnProperty("name"), o.n, o.id]; }
  for (let i = 0; i < 6; i++) said.push("d01 " + JSON.stringify(f(i), show));
}
{ // the keys behind the delete
  function f(i) { const o = { id: i, name: "x", n: i + 1 }; delete o.name; return [Object.keys(o).join(), JSON.stringify(o), Object.entries(o).length]; }
  for (let i = 0; i < 6; i++) said.push("d02 " + JSON.stringify(f(i), show));
}
{ // the name comes back last
  function f(i) { const o = { id: i, name: "x", n: i + 1 }; delete o.name; o.name = "y" + i; return [Object.keys(o).join(), o.name, JSON.stringify(o)]; }
  for (let i = 0; i < 6; i++) said.push("d03 " + JSON.stringify(f(i), show));
}
{ // every name goes
  function f(i) { const o = { id: i, name: "x", n: i + 1 }; delete o.n; delete o.id; delete o.name; return [Object.keys(o).length, JSON.stringify(o), o.id, o.n]; }
  for (let i = 0; i < 6; i++) said.push("d13 " + JSON.stringify(f(i), show));
}
{ // the first and the last
  function f(i) { const a = { id: i, name: "x", n: i + 1 }; const b = { id: i, name: "x", n: i + 1 }; delete a.id; delete b.n; return [Object.keys(a).join(), Object.keys(b).join(), a.n, b.id, a.id, b.n]; }
  for (let i = 0; i < 6; i++) said.push("d14 " + JSON.stringify(f(i), show));
}
{ // a number a boolean a text an object
  function f(i) { const o = { a: i * 0.5, b: i > 2, c: "t" + i, d: { x: i }, e: i }; delete o.a; delete o.b; delete o.d; return [o.a, o.b, o.c, o.d, o.e, Object.keys(o).join()]; }
  for (let i = 0; i < 6; i++) said.push("d16 " + JSON.stringify(f(i), show));
}
{ // spread behind the delete
  function f(i) { const o = { id: i, name: "x", n: i + 1 }; delete o.name; const c = { ...o, z: 1 }; return [Object.keys(c).join(), c.name, c.n]; }
  for (let i = 0; i < 6; i++) said.push("d21 " + JSON.stringify(f(i), show));
}
{ // for in behind the delete
  function f(i) { const o = { id: i, name: "x", n: i + 1 }; delete o.id; let said = ""; for (const k in o) said += k + "=" + o[k] + ";"; return [said]; }
  for (let i = 0; i < 6; i++) said.push("d22 " + JSON.stringify(f(i), show));
}
{ // the value was read in front
  function f(i) { const o = { id: i, name: "x" + i, n: i + 1 }; const held = o.name; delete o.name; o.n = held.length; return [held, o.name, o.n, Object.keys(o).join()]; }
  for (let i = 0; i < 6; i++) said.push("d26 " + JSON.stringify(f(i), show));
}
console.log(said.join("\n"));
