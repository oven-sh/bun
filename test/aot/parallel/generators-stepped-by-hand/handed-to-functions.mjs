// Generators are handed to functions that iterate them, keep them, look at their arguments; patterns stand in functions that loops copy.
let state = 0;
let saved = null;
const lines = [];
const say = (...words) => lines.length < 3000 && lines.push(words.map(v => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))).join(" "));
const list = JSON.parse("[3,1,4,1,5,9,2,6]");

function* range(a, b) { for (let k = a; k < b; k++) yield k; return "end"; }
function* guarded(v) { try { yield v; state++; yield v + 1; if (v === 2) throw new Error("two"); yield v + 2; } finally { state += 10; } }
function* kept(v) { yield v; yield v * 2; }
class Pair { constructor(a, b) { this.a = a; this.b = b; } *both() { yield this.a; yield this.b; } }

function each(it, n) { let t = 0; for (const v of it) { if (t > n) break; t += v; } return t; }
function eachDeep(it, n) { return each(it, n) + 1; }
function spreads(it) { return [...it].length; }
function pair([a, b = 3]) { return a * 100 + b; }
function both(it) { const [a, , c] = it; return String(a) + c; }
function keeps(it) { saved = it; let s = ""; for (const v of it) { s += v; if (s.length > 2) return s; } return s; }
function goesOn() { const r = saved.next(); return String(r.value) + r.done; }
function twice(it, other) { let t = ""; for (const v of it) { const [w] = other; t += v + ":" + w + " "; if (t.length > 12) break; } return t; }
function inTry(it) { try { for (const v of it) { if (v === 4) throw new Error("four"); state++; } return "end"; } catch (error) { return error.message; } finally { state += 2; } }
function args(it) { return arguments.length + each(arguments[0], 9); }
function writes(it) { arguments[0] = [7]; let s = 0; for (const v of it) s += v; return s; }
function rest(first, ...more) { let t = 0; for (const v of first) t++; return t + more.length; }
function late(it) { state++; const [a, b] = it; return a + ":" + b + ":" + state; }
function assigned(it) { it = it ?? [1]; let s = 0; for (const v of it) s += v; return s; }
const arrow = it => { for (const v of it) if (v > 2) return v; return -1; };

function stepPattern(v) { const [a, b] = range(v, v + 2); return a * b; }
function stepOne(v) { const [a] = guarded(v); return a; }
function stepHole(v) { const [, b] = kept(v); return b; }
function stepMethod(v) { const [a, b] = new Pair(v, 2).both(); return a + b; }
function inLoop(vs) { let s = 0; for (let i = 0; i < vs.length; i++) { s = (s + stepPattern(vs[i]) + stepOne(vs[i]) + stepHole(vs[i]) + stepMethod(vs[i])) | 0; } return s; }
function doublesInLoop(vs) { let s = 0; for (let i = 0; i < vs.length; i++) { const [a, b = 0.5] = kept(vs[i] / 4); s += a * b; } return s; }
function mixedInLoop(vs) { let s = ""; for (let i = 0; i < vs.length; i++) { const [a, b] = kept(vs[i]); s += String(a) + (Number.isNaN(b) ? "NaN" : b) + ","; } return s; }
function handedInLoop(vs) { let s = 0; for (let i = 0; i < vs.length; i++) s = (s + each(range(0, vs[i]), 20) + pair(range(vs[i], vs[i] + 1)) + spreads(range(0, vs[i]))) | 0; return s; }

const attempt = f => { try { return f(); } catch (error) { return error.name + " " + error.message; } };
const all = [v => each(range(0, v), 5), v => eachDeep(range(0, v), 9), v => spreads(guarded(v)), v => pair(range(v, v + 1)), v => both(range(v, v + 2)), v => keeps(range(v, 9)), goesOn, v => twice(range(0, 3), range(v, 9)), v => inTry(guarded(v)), v => args(range(0, v)), v => writes(range(0, v)), v => rest(range(0, v), 1, 2), v => late(guarded(v)), v => assigned(range(0, v)), v => arrow(range(0, v)), () => inLoop(list), () => doublesInLoop(list), () => mixedInLoop([1, "2", null, 3.5]), () => handedInLoop(list)];
for (let turn = 0; turn < 40; turn++) {
  for (const v of list) {
    const answers = all.map(f => attempt(() => f(v)));
    if (turn % 39 === 0) say(...answers, state);
  }
}
for (const line of lines) console.log(line);
console.log(lines.length, state);
