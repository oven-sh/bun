function report(a, b) {
  a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
  console.log(a === b, globalThis.runs, a.id, b.id, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, a.obj === b.obj, b.obj.n, new a.K() instanceof b.K);
}
const Module = require("node:module");
const a = require("./state.cjs");
let b;
try { const m = new Module(require.resolve("./state.cjs"), module); m.filename = m.id; m.paths = []; m.load(m.id); b = m.exports; } catch (e) { console.log("threw", e.constructor.name); b = a; }
report(a, b);
