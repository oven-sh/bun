function report(a, b) {
  a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
  console.log(a === b, globalThis.runs, a.id, b.id, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, a.obj === b.obj, b.obj.n, new a.K() instanceof b.K);
}

const a = await import("./state.js");
const b = await import("./sub/../state.js");
const c = await import(import.meta.dir + "/state.js");
const d = await import(new URL("./state.js", import.meta.url).href);
console.log(a === c, a === d);
report(a, b);
