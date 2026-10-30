// JSON.parse goes into what the reviver has put into the holder while an earlier key was visited. Here an object literal, in a holder below the first.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const lit = { la: { qb: 1 }, lb: { qb: 2 } };
let root;
JSON.parse('{"a":{"x":1},"b":{"y":2},"c":3}', function (k, v) {
  if (k === "x") root = this;
  if (k === "a") this.c = lit;
  if (k === "la") return undefined;
  return v;
});
console.log(attempt(() => lit.la.qb), attempt(() => lit.lb.qb), Object.keys(lit).join());
function make() { return { la: { qb: 3 }, lb: { qb: 4 } }; }
console.log(make().la.qb);
