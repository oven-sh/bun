// Functions that loops within loops call ask for the truth of values of every kind: of fields, names that nothing lists, getters, results and elements.
const out = [];
const kinds = [undefined, null, false, true, 0, -0, NaN, 1, -1, 0.5, 2 ** 40, 4294967295, Infinity, "", "a", "tex" + "t", "x".slice(1), 0n, 1n, -5n, 2n ** 70n, {}, [], function () {}, Symbol("s"), new Boolean(false), new String(""), /r/, Object.create(null), new Proxy({}, {})];
let list = kinds;
function pickOne(i) { return list[i % list.length]; }
class Context { constructor(i) { this.isExpression = pickOne(i); this.override = pickOne(i + 1); this.depth = i % 3; } get got() { return pickOne(this.depth); } ask(i) { return pickOne(i + this.depth); } }
class Parser {
  constructor(i) { this.options = {}; this.context = new Context(i); this.count = 0; if (i % 2) this.options["ran" + "ges"] = pickOne(i); }
  next(i) {
    let t = 0; const c = this.context;
    if (!c || !c.isExpression) t += 1;
    if (c.override) t = t * 3 + 2; else t *= 3;
    if (this.options.ranges) t += 5;
    if (this.filename) t += 7;
    if (c.got && c.ask(i)) t ^= 11;
    if (c.ask(i + 1) || pickOne(i)) t += 13;
    t += c.missing ? 17 : c.missing?.inner ? 19 : 23;
    if (i === 77777) { out.push(JSON.stringify([this.count, i, t]), [1, 2, 3].map((x) => x + i).join("-")); this.filename = "f"; throw new RangeError("never " + i); }
    const either = c.isExpression || c.override, both = c.isExpression && c.override;
    t = t * 2 + (either ? 1 : 0) + (both ? 2 : 0) + (!either ? 4 : 0) + (Boolean(both) === !!both ? 8 : 0);
    while (c.override && t < 40) t += 9;
    this.count += t;
    return t | 0;
  }
}
function tokens(p, n) { let s = 0; for (let i = 0; i < n; i++) s = (s * 31 + p.next(i)) | 0; return s; }
function run(n, m) { let s = 0; for (let j = 0; j < m; j++) { const p = new Parser(j); for (let k = 0; k < 2; k++) s = (s * 17 + tokens(p, n)) | 0; } return s; }
for (const [n, m] of [[1, 1], [3, 5], [31, 30], [60, 90]]) out.push(run(n, m));
for (let i = 0; i < kinds.length; i++) { list = [kinds[i]]; out.push(run(2, 2), new Parser(1).next(i)); }
list = [true, false]; out.push(run(20, 20)); list = [undefined, null]; out.push(run(20, 20)); list = ["", {}]; out.push(run(20, 20));
for (const odd of [undefined, null, 0, "", false]) { const p = new Parser(1); p.context = odd; try { out.push(p.next(1)); } catch (e) { out.push(e.constructor.name); } }
const named = new Parser(2); named.filename = "x"; out.push(named.next(3)); named.filename = ""; out.push(named.next(3));
Context.prototype.missing = true; out.push(run(7, 7)); Context.prototype.missing = { inner: 1 }; out.push(run(7, 7)); Context.prototype.missing = 0n; out.push(run(7, 7));
for (const line of out) console.log(String(line));
