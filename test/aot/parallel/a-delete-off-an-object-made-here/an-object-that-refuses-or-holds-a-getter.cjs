'use strict';
const said = [];
const show = (k, v) => v === undefined ? "<undefined>" : v;
{ // a frozen object refuses
  function f(i) { const o = { id: i, name: "x", n: i + 1 }; Object.freeze(o); let said = "no throw"; try { delete o.name; } catch (e) { said = e.constructor.name; } return [said, o.name, Object.keys(o).join()]; }
  for (let i = 0; i < 6; i++) said.push("d05 " + JSON.stringify(f(i), show));
}
{ // a name that may not be removed
  function f(i) { const o = { id: i, name: "x", n: i + 1 }; Object.defineProperty(o, "name", { configurable: false }); let said = "no throw"; try { delete o.name; } catch (e) { said = e.constructor.name; } return [said, o.name]; }
  for (let i = 0; i < 6; i++) said.push("d06 " + JSON.stringify(f(i), show));
}
{ // a getter is removed unrun
  let ran = 0; function f(i) { const o = { id: i, get name() { ran++; return "g"; }, n: i + 1 }; delete o.name; return [o.name, ran, Object.keys(o).join()]; }
  for (let i = 0; i < 6; i++) said.push("d07 " + JSON.stringify(f(i), show));
}
{ // sealed and not extensible
  function f(i) { const o = { id: i, name: "x", n: i + 1 }; const p = { id: i, name: "x" }; Object.seal(o); Object.preventExtensions(p); let said = "no throw"; try { delete o.name; } catch (e) { said = e.constructor.name; } const done = delete p.name; return [said, o.name, done, p.name, Object.keys(p).join()]; }
  for (let i = 0; i < 6; i++) said.push("d25 " + JSON.stringify(f(i), show));
}
console.log(said.join("\n"));
