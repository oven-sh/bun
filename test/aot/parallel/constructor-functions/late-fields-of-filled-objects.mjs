// What a maker stores behind the construction lies in the object that it hands back, under names that the class does not list too. A build that checks proofs asks for each.
let made = 0;
class Plain { constructor(x) { this.a = x; this.d = x; } }
function Pair(x) { this.a = x; this.d = x; }
class Heir extends Plain { }
class Setter { set b(v) { made += 10; } constructor(x) { this.a = x; this.b = x; } }
function plain(x) { const o = new Plain(x); o.late = "after"; return o; }
function sometimes(x) { const o = new Plain(x); o.call = () => x; if (x > 0) o.late = made++; o.late = "after"; return o; }
function pair(x) { const o = new Pair(x); o.late = x; o.more = null; return o; }
function heir(x) { const o = new Heir(x); o.late = [x]; return o; }
function setter(x) { const o = new Setter(x); o.call = () => x; if (x > 0) o.late = made++; const handed = o; o.late = "after"; return handed; }
function show(o) { return Object.keys(o).map(k => k + ":" + (typeof o[k] === "function" ? o[k]() : o[k])).join(); }
function run(maker) { let s = ""; for (let i = 0; i < 4; i++) { const v = maker(i), w = maker(2); s += show(v) + (w === v) + typeof w.late + " "; } return s; }
function plains() { let s = ""; for (let i = 0; i < 4; i++) { const v = plain(i), w = plain(2); s += v.a + v.late + (w === v) + " "; } return s; }
function some() { let s = ""; for (let i = 0; i < 4; i++) { const v = sometimes(i); s += v.a + v.late + v.call() + " "; } return s; }
function pairs() { let s = ""; for (let i = 0; i < 4; i++) { const v = pair(i); s += v.a + v.late + v.more + " "; } return s; }
function heirs() { let s = ""; for (let i = 0; i < 4; i++) { const v = heir(i); s += v.a + v.late + " "; } return s; }
function setters() { let s = ""; for (let i = 0; i < 4; i++) { const v = setter(i); s += v.a + v.late + v.call() + (v.b === undefined) + " "; } return s; }
for (let turn = 0; turn < 2; turn++) {
  for (const each of [plains, some, pairs, heirs, setters]) console.log(each());
  for (const maker of [plain, sometimes, pair, heir, setter]) console.log(run(maker));
}
console.log(made);
