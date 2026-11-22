// Instances of a class whose constructor fills its fields, some of which computed keys fill too: one test of an instance answers for its fields.
// STATISTIC: IterationRestartsEmitted <= 73
(function () {
const box = {}, SLOT = JSON.parse('"slot"');
const unknown = s => { box[SLOT] = s; return box[SLOT]; };
const turns = JSON.parse("30"), KEY = ["fr", "ont"].join("");
function Pair(front, tail) { this.tail = tail; this.front = front; }
function Name(name) { this.marks = null; this.name = name; }
function copy(o) { const c = o instanceof Pair ? new Pair(null, null) : new Name(""); for (const k in o) c[k] = o[k]; return c; }
function list(n, f) { let l = null; for (let i = n; i--;) l = new Pair(f(i), l); return l; }
function note(a, b, told) {
  const word = b instanceof Name ? b.name : String(b);
  if (!(word in told)) told[word] = a;
  return told[word] === a;
}
function agree(a, b, told) {
  let left = a, right = b, many = 0;
  for (; left instanceof Pair && right instanceof Pair; many++) {
    const here = left.front, there = right.front;
    left = left.tail;
    right = right.tail;
    const isDeep = there instanceof Pair;
    if (here instanceof Pair !== isDeep || !(isDeep ? agree(here, there, told) : note(here, there, told))) return false;
  }
  return many > 3 || left === right;
}
function size(l) { let n = 0; for (let x = l; x instanceof Pair; x = x.tail) n += x.front instanceof Pair ? size(x.front) : 1; return n; }
let hits = 0;
const symbols = ["f", "g", "h"].map(n => new Name(n));
const term = (i, d) => d ? new Pair(symbols[i % 3], list(2, k => term(i + k, d - 1))) : i % 5;
for (let t = 0; t < turns; t++) {
  const a = unknown(term(t, 4)), b = unknown(copy(term(t, 4)));
  if (t % 6 === 1) delete a.tail.front.front;
  if (t % 6 === 2) Object.defineProperty(a.tail, KEY, { get() { ++hits; return 1; } });
  if (t % 6 === 3) Object.freeze(b.tail);
  if (t % 6 === 4) b[KEY] = symbols[(t + 1) % 3];
  if (t % 6 === 5) Object.setPrototypeOf(a.tail, { __proto__: Pair.prototype });
  let said; try { said = agree(a, b, {}) + " " + size(a) + " " + size(b); } catch (e) { said = e.constructor.name; }
  if (t % 6 || t === 12) console.log(said, hits, Object.keys(copy(b)).join());
}
let sum = 0; for (let t = 0; t < 200; t++) sum += size(term(t, 5)) + (agree(term(t, 5), copy(term(t, 5)), {}) ? 1 : 0);
console.log(sum, hits);
})();
