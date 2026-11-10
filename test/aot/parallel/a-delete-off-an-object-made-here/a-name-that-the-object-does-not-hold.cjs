// STATISTIC: FreshObjectDeletesFolded >= 1
'use strict';
const said = [];
const show = (k, v) => v === undefined ? "<undefined>" : v;
{ // what is not there
  function f(i) { const o = { id: i, name: "x", n: i + 1 }; const said = delete o.zip; return [said, o.name, Object.keys(o).join(), o.zip]; }
  for (let i = 0; i < 6; i++) said.push("d11 " + JSON.stringify(f(i), show));
}
{ // the answer of the delete
  function f(i) { const o = { id: i, name: "x", n: i + 1 }; const first = delete o.name; const second = delete o.name; return [first, second, typeof first, o.n]; }
  for (let i = 0; i < 6; i++) said.push("d12 " + JSON.stringify(f(i), show));
}
{ // a store by a key in front
  const K = JSON.parse('["zip","name"]'); function f(i) { const o = { id: i, name: "x", n: i + 1 }; o[K[i & 1]] = i; const said = delete o.zip; return [said, o.zip, o.name, Object.keys(o).join()]; }
  for (let i = 0; i < 6; i++) said.push("d18 " + JSON.stringify(f(i), show));
}
console.log(said.join("\n"));
