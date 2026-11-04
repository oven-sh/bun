import * as a from "./state.js";
function report(a, b) {
  a.inc(); a.inc(); a.K.s = 5; a.obj.n = 7;
  console.log(a === b, globalThis.runs, a.id, b.id, b.inc(), a.K === b.K, b.K.s, a.sym === b.sym, a.obj === b.obj, b.obj.n, new a.K() instanceof b.K);
}

const b = require("./state.js");
report(a, b);
