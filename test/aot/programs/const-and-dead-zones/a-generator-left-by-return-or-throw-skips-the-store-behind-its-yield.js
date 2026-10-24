// A generator is left by return() at a yield: the store behind the yield never runs.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function* g(out) {
  var v;
  try { yield 1; v = { a: 1 }; } finally { out.push(attempt(() => v.a)); }
}
const out = [];
const it = g(out); it.next(); it.return(5);
console.log(out.join());
function* h(out) {
  try { yield 1; } finally { out.push(attempt(() => late.a)); }
  let late = { a: 1 };
  yield late;
}
const it2 = h(out); it2.next(); it2.return(5);
console.log(out.join());
const it3 = h(out); it3.next(); attempt(() => it3.throw(new Error("x")));
console.log(out.join());
