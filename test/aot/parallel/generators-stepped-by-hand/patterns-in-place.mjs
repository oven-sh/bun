// Patterns over generators: how many are taken, defaults, holes, what is left over, closes, throws; in loops, in copies, in other generators.
let state = 0;
const lines = [];
const say = (...words) => lines.length < 3000 && lines.push(words.map(v => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))).join(" "));
const list = JSON.parse("[3,1,4,1,5,9,2,6]");

function* range(a, b) { for (let k = a; k < b; k++) yield k; return "end"; }
function* guarded(v) { try { yield v; yield v + 1; if (v === 2) throw new Error("two"); yield v + 2; yield v + 3; } catch (error) { yield error.message; } finally { state += 10; say("finally", v); } }
function* closing(v) { try { yield v; yield v; } finally { if (v === 4) throw new RangeError("closing"); if (v === 5) yield "again"; state++; } }
function* kinds(v) { yield v; yield undefined; yield null; yield "t" + v; yield [v]; }
function* counted(v) { let k = 0; while (true) { state += k; yield k++ * v; } }
function* outer(v) { const got = yield* range(v, v + 2); yield got; }
class Pair {
  constructor(a, b) { this.a = a; this.b = b; }
  *[Symbol.iterator]() { yield this.a; yield this.b; }
  *both(n) { for (let k = 0; k < n; k++) { yield this.a + k; yield this.b + k; } }
}

const none = v => { const [] = guarded(v); return state; };
const one = v => { const [a] = range(v, v + 1); return a; };
const two = v => { const [a, b] = range(v, 4); return a + ":" + b; };
const defaults = v => { const [a = 7, b = "d", c = v] = range(v, 5); return [a, b, c].join(); };
const holes = v => { const [, b, , d] = counted(v); return b + ":" + d; };
const three = v => { const [a, b, c] = kinds(v); return [a, b, c].map(String).join(); };
const four = v => { let [a, b, c, d = 4] = kinds(v); a += 1; return [a, String(b), String(c), d].join(); };
const five = v => { const [a, b, c, d, e] = kinds(v); return [a, String(b), String(c), d, e.length].join(); };
const rest = v => { const [a, ...others] = range(v, 6); return a + ":" + others.length; };
const inner = v => { const [a, b] = outer(v), [c, d] = outer(v + 1); return [a, b, c, d].join(); };
const closes = v => { const [a] = closing(v); return a; };
const both = v => { const [a, b, c] = closing(v); return [a, b, String(c)].join(); };
const throws = v => { const [a, b, c] = guarded(v); return [a, b, c].join(); };
const pair = v => { const [a, b] = new Pair(v, v * 2); const [c, d, e] = new Pair(v, v + 1).both(2); return [a, b, c, d, e].join(); };
const argument = ([a, b = 9]) => a * b;
const passed = v => argument(range(v, v + 2)) + argument(range(v, v + 1));
const nested = v => { const [[a, b], { at }] = (function* () { yield range(v, 9); yield { at: v }; })(); return [a, b, at].join(); };
const named = v => { const it = range(v, 9); const [a, b] = it; return [a, b, it.next().done].join(); };
function loops(v) { let s = 0; for (let i = 0; i < 5; i++) { const [a, b = 1] = range(i, v); if (a === undefined) continue; s += a * b; if (s > 30) break; } return s; }
function* taking(v) { for (const w of range(0, v)) { const [a, b] = counted(w); yield a + b; } }
function drained(v) { let s = 0; for (const w of taking(v)) s += w; return s; }

const attempt = f => { try { return f(); } catch (error) { return error.name + " " + error.message; } };
const all = [none, one, two, defaults, holes, three, four, five, rest, inner, closes, both, throws, pair, passed, nested, named, loops, drained];
for (let turn = 0; turn < 40; turn++) {
  for (const v of list) {
    const answers = all.map(f => attempt(() => f(v)));
    if (turn % 39 === 0) say(...answers, state);
  }
}
for (const line of lines.slice(0, 60).concat(lines.slice(-12))) console.log(line);
console.log(lines.length, state);
