// An object of a class is laid below a plain object that stands below the prototype object of the class. A CLOSED BUILD; 300 objects in front of the deed and 300 behind it; what use() finds is judged by its caller.
// THE DEED: the object between gets a name that no class declares.
const unseen = (x) => x;
const taken = [];
class K {
  constructor() { this.a = 1; }
  m() { return "K.m"; }
  n() { return "K.n"; }
  get g() { return "K.g"; }
}
class Other { m() { return "Other.m"; } get g() { return "Other.g"; } }
function callM(k) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return k.m(); }
function callN(k) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return k.n(); }
function readG(k) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return k.g; }
function readNothing(k) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return k.nothing; }
function storeLate(k) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; k.late = 5; return k; }
function isK(k) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return k instanceof K; }
function below(parent) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const made = new K(); Object.setPrototypeOf(made, parent); return made; }
// Every caller of the seven functions above and of judge() is in sight, and each hands over an object of K or of a class below: their forms are typed.
function judge(k) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let m, n, g, nothing, late;
  try { m = callM(k); } catch (e) { m = e.name; }
  try { n = callN(k); } catch (e) { n = e.name; }
  try { g = readG(k); } catch (e) { g = e.name; }
  try { nothing = readNothing(k); } catch (e) { nothing = e.name; }
  try { late = storeLate(k).late; } catch (e) { late = e.name; }
  return [m, n, g, nothing, late, Object.hasOwn(k, "late"), isK(k), k.a].join();
}
const print = (counts) => [...counts].map(([answer, count]) => count + " " + answer).join(" | ");
const count = (counts, answer) => counts.set(answer, (counts.get(answer) || 0) + 1);
function tellPlain() { const counts = new Map(); for (let i = 0; i < 300; i++) count(counts, judge(new K())); return print(counts); }
const between = unseen(Object.create(K.prototype));

function tellLaid() { const counts = new Map(); for (let i = 0; i < 300; i++) count(counts, judge(below(between))); return print(counts); }
console.log(tellPlain(), "//", tellLaid(), taken.length);
between.nothing = "between.nothing";
console.log(tellPlain(), "//", tellLaid(), taken.length);
