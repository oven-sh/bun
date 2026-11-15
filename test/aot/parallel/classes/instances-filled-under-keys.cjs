// Instances of a class whose constructor fills its fields, some of which computed keys fill too: one test of an instance answers for its fields.
// STATISTIC: IterationRestartsEmitted <= 73
(function () {
const box = {}, SLOT = JSON.parse('"slot"');
const unknown = s => { box[SLOT] = s; return box[SLOT]; };
const turns = JSON.parse("30"), KEY = ["c", "ar"].join("");
function Pair(car, cdr) { this.car = car; this.cdr = cdr; }
function Name(name) { this.name = name; this.lemmas = null; }
function copy(o) { const c = o instanceof Pair ? new Pair(null, null) : new Name(""); for (const k in o) c[k] = o[k]; return c; }
function list(n, f) { let l = null; for (let i = n; i--;) l = new Pair(f(i), l); return l; }
function unify(a, b, bound) {
  for (;;) {
    if (!(b instanceof Pair)) { if (bound[b]) return a === bound[b]; bound[b] = a; return true; }
    if (!(a instanceof Pair)) return false;
    if (a.car !== b.car) return false;
    let x = a.cdr, y = b.cdr;
    while (x instanceof Pair && y instanceof Pair) { if (!unify(x.car, y.car, bound)) return false; x = x.cdr; y = y.cdr; }
    return x === y || x === null && y === null;
  }
}
function size(l) { let n = 0; for (let x = l; x instanceof Pair; x = x.cdr) n += x.car instanceof Pair ? size(x.car) : 1; return n; }
let hits = 0;
const symbols = ["f", "g", "h"].map(n => new Name(n));
const term = (i, d) => d ? new Pair(symbols[i % 3], list(2, k => term(i + k, d - 1))) : i % 5;
for (let t = 0; t < turns; t++) {
  const a = unknown(term(t, 4)), b = unknown(copy(term(t, 4)));
  if (t % 6 === 1) delete a.cdr.car.car;
  if (t % 6 === 2) Object.defineProperty(a.cdr, KEY, { get() { ++hits; return 1; } });
  if (t % 6 === 3) Object.freeze(b.cdr);
  if (t % 6 === 4) b[KEY] = symbols[(t + 1) % 3];
  if (t % 6 === 5) Object.setPrototypeOf(a.cdr, { __proto__: Pair.prototype });
  let said; try { said = unify(a, b, {}) + " " + size(a) + " " + size(b); } catch (e) { said = e.constructor.name; }
  if (t % 6 || t === 12) console.log(said, hits, Object.keys(copy(b)).join());
}
let sum = 0; for (let t = 0; t < 200; t++) sum += size(term(t, 5)) + (unify(term(t, 5), copy(term(t, 5)), {}) ? 1 : 0);
console.log(sum, hits);
})();
