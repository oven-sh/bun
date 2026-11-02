// A getter that deletes a key behind it: the copy has no such key, whichever way the object keeps its key order.
function digest(o) { return Reflect.ownKeys(o).map(k => String(k) + "=" + String(o[k])).join(); }
function attempt(name, make) {
  try { const made = make(); console.log(name, digest({ ...made }), digest({ ...made })); }
  catch (e) { console.log(name, "threw", e.message); }
}
attempt("plain", () => ({ get a() { delete this.b; return 1; }, b: 2, c: 3 }));
attempt("own order by delete", () => {
  const made = { x: 0, get a() { delete this.b; return 1; }, b: 2, c: 3 };
  delete made.x;
  return made;
});
attempt("own order by delete and add", () => {
  const made = { x: 0, y: 1, get a() { delete this.b; return 1; }, b: 2, c: 3 };
  delete made.x;
  made.x = 5;
  delete made.y;
  return made;
});
attempt("own order, late key", () => {
  const made = { get a() { delete this.c; delete this.late; return 1; }, c: 3 };
  made.late = 4;
  delete made.c;
  made.c = 3;
  return made;
});
class K { get g() { return 1; } }
attempt("getter defined late", () => {
  const made = { p: 1, q: 2, r: 3 };
  delete made.p;
  made.p = 1;
  Object.defineProperty(made, "p", { get() { delete this.q; return "got"; }, enumerable: true, configurable: true });
  return made;
});
const shared = { get a() { delete this.b; return 1; }, b: 2, c: 3 };
for (let i = 0; i < 3; i++) console.log(digest({ ...Object.create(null) }));
function many() { const made = { get a() { delete this.b; this.b = "again"; return 1; }, b: 2, c: 3 }; return made; }
attempt("deleted and put back", many);
const order = [];
function make(i) { return { get a() { if (i & 1) delete this.b; return i; }, b: i, c: i }; }
for (let i = 0; i < 40; i++) order.push(digest({ ...make(i) }));
console.log(order.join("|"));
