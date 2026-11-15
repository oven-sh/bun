// Loops of a context over built-ins, over names that its sandbox has and over its own variables, while collections run and the host changes the sandbox in between.
const vm = require("vm");
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
const lines = [];
class Box { constructor() { this.kept = { q: 1 }; this.sum = 0; } }
for (const make of [() => ({ kept: { q: 1 }, sum: 0 }), () => new Box(), () => Object.assign(Object.create(null), { kept: { q: 1 }, sum: 0 }), () => JSON.parse('{"kept":{"q":1},"sum":0}'), () => Object.create({ kept: { q: 1 }, sum: 0 })]) {
  const sandbox = make();
  sandbox.collect = () => void (typeof Bun === "undefined" || Bun.gc(true));
  const realm = vm.createContext(sandbox), run = t => vm.runInContext(hidden(t), realm);
  const attempt = f => { try { const v = f(); lines.push(v === sandbox ? "sandbox" : Object.is(v, -0) ? "-0" : v && typeof v === "object" ? JSON.stringify(v) : String(v)); } catch (e) { lines.push(e.name + ": " + e.message); } };
  const loops = run(`[
    () => { let s = 0; for (let i = 0; i < 50; i++) { s += Math.max(i, 5) + parseInt("7") + Number("2") + Array.isArray([]) + (Object === Object) + JSON.stringify([i]).length; } return s; },
    () => { for (let i = 0; i < 50; i++) sum += i; return sum; },
    () => { for (count = 0; count < 20; count++) { kept = { q: count }; if (count === 9) collect(); } return kept; },
    () => { for (text = ""; text.length < 30;) text += "ab"; return text; },
    () => { "use strict"; for (let i = 0; i < 9; i++) sum = i / 2; return sum; },
    () => { let s = ""; for (let i = 0; i < 3; i++) s += typeof Reflect + typeof missing + typeof Symbol + typeof kept; return s; },
    () => { self = globalThis; return self === globalThis; },
  ]`);
  for (let turn = 0; turn < 5; turn++) {
    for (const loop of loops) attempt(loop);
    for (const n of ["sum", "count", "kept", "text"]) attempt(() => sandbox[n]);
    if (turn === 0) { sandbox.sum = 100; sandbox.kept = null; }
    if (turn === 1) { sandbox.Math = { max: () => 1000 }; sandbox.parseInt = () => 3; }
    if (turn === 2) { delete sandbox.Math; delete sandbox.parseInt; delete sandbox.sum; attempt(() => run("sum")); sandbox.sum = -0; }
    if (turn === 3) { Object.defineProperty(sandbox, "sum", { get() { return 5; }, set(v) { lines.push("set " + v); }, configurable: true, enumerable: true }); Object.defineProperty(sandbox, "text", { value: "x".repeat(40), writable: false }); }
  }
  attempt(() => run("var total = 0; for (var i = 0; i < 100; i++) total += i % 7; total + i"));
  attempt(() => run("total + i"));
  attempt(() => run("let top = 0; for (var i = 0; i < 100; i++) { top += i; } top"));
}
console.log(lines.join("\n"));
