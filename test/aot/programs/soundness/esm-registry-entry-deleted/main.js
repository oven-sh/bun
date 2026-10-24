function report(a, b) {
  a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
  console.log(a === b, globalThis.runs, a.id, b.id, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, a.obj === b.obj, b.obj.n, new a.K() instanceof b.K);
}

const a = await import("./state.js");
let cleared = "no Loader";
try { for (const k of [...Loader.registry.keys()]) if (k.endsWith("state.js")) { Loader.registry.delete(k); cleared = "deleted"; } } catch (e) { cleared = "threw " + e.constructor.name; }
const b = await import("./state.js");
console.log(cleared);
report(a, b);
