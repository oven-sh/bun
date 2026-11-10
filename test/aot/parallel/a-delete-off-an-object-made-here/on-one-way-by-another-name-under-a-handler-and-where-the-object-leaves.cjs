// STATISTIC: DeletesFollowedIntoFreshObjects >= 1
'use strict';
const said = [];
const show = (k, v) => v === undefined ? "<undefined>" : v;
{ // on one way only
  function f(i) { const o = { id: i, name: "x", n: i + 1 }; if (i & 1) delete o.name; return [o.name, Object.keys(o).join(), o.n]; }
  for (let i = 0; i < 6; i++) said.push("d08 " + JSON.stringify(f(i), show));
}
{ // by another name of the object
  function f(i) { const o = { id: i, name: "x", n: i + 1 }; const p = o; delete p.name; return [o.name, p === o, Object.keys(o).join()]; }
  for (let i = 0; i < 6; i++) said.push("d09 " + JSON.stringify(f(i), show));
}
{ // the object leaves behind the delete
  const kept = []; function f(i) { const o = { id: i, name: "x", n: i + 1 }; delete o.name; kept.push(o); if (kept.length > 3) kept.shift(); return [kept.map(k => Object.keys(k).join("+") + ":" + k.name).join("|")]; }
  for (let i = 0; i < 6; i++) said.push("d10 " + JSON.stringify(f(i), show));
}
{ // an object from in front of the loop
  function f(i) { const o = { id: i, name: "x", n: i + 1 }; let s = 0; for (let k = 0; k < 3; k++) { if (k === 1) delete o.name; s += o.name === undefined ? 1 : 10; } return [s, Object.keys(o).join()]; }
  for (let i = 0; i < 6; i++) said.push("d15 " + JSON.stringify(f(i), show));
}
{ // under a handler
  function boom(i) { if (i & 1) throw new Error("b"); } function f(i) { const o = { id: i, name: "x", n: i + 1 }; try { boom(i); delete o.name; boom(i + 1); } catch (e) { return ["caught", o.name, Object.keys(o).join()]; } return ["none", o.name]; }
  for (let i = 0; i < 6; i++) said.push("d17 " + JSON.stringify(f(i), show));
}
{ // held by another object made here
  function f(i) { const o = { id: i, name: "x", n: i + 1 }; const box = { held: o, k: i }; delete o.name; return [box.held.name, Object.keys(box.held).join(), box.k]; }
  for (let i = 0; i < 6; i++) said.push("d20 " + JSON.stringify(f(i), show));
}
{ // in a callee that is copied
  function strip(r) { delete r.name; return r; } function f(i) { const o = strip({ id: i, name: "x", n: i + 1 }); return [o.name, o.n, Object.keys(o).join()]; }
  for (let i = 0; i < 6; i++) said.push("d27 " + JSON.stringify(f(i), show));
}
console.log(said.join("\n"));
