// Generators that a function is handed and goes over or steps by hand.
let state = 0;
const lines = [];
const show = v => (typeof v === "function" ? "function" : v instanceof Error ? v.name : typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const say = (...words) => lines.length < 3000 && lines.push(words.map(show).join(" "));
const list = JSON.parse("[3,1,4,1,5,9,2,6]"), doubles = JSON.parse("[0.5,1.5,-2]");
function* range(a, b) { for (let k = a; k < b; k++) yield k; return "end"; }
function* odd(a, b) { for (let k = a; k < b; k++) if (k & 1) yield k; }
function* pair(v) { yield v; state++; yield v + 1; state += 2; }
function* sends(v) { const a = yield v; const b = yield [a, v]; return [a, b]; }
function* guarded(v) { try { yield v; if (v === 4) throw new RangeError("four"); yield v + 1; } finally { state += 5; } }
function* throwing(v) { yield v; if (v > 4) throw new TypeError("large"); yield -v; }
function* nested(v) { for (let k = 0; k < 2; k++) { for (let j = 0; j < v % 3; j++) yield k * 10 + j; state++; } }
function* none() { state += 7; }
class Bag { constructor(v) { this.v = v; } *[Symbol.iterator]() { for (const x of this.v) yield x; } *some(n) { for (let k = 0; k < n; k++) yield this.v[k]; } }
const makers = [range, odd, pair, sends, guarded, throwing, nested, none];
const kept = [];
function sum(it) { let t = 0; for (const v of it) t += typeof v === "number" ? v : 1; return t; }
function drive(it) { let r = it.next(); while (!r.done) r = it.next(r.value * 2); return r.value; }
function take(it, n) { const taken = []; for (let k = 0; k < n; k++) { const r = it.next(); if (r.done) break; taken.push(r.value); } return taken; }
function first(it) { return it.next().value; }
function firstOr(it, other) { const r = it.next(); return r.done ? other : r.value; }
function last(it) { let found, r; while (!(r = it.next()).done) found = r.value; return [found, r.value]; }
function untilLarge(it) { for (const v of it) { if (v > 4) return v; state++; } return "none"; }
function inTry(it) { let t = 0; try { for (const v of it) t += v; } catch (error) { say(error, t); } finally { state += 1; } return t; }
function keeps(it) { kept.push(it); let t = 0; for (const v of it) { t += v; if (t > 3) break; } return t; }
function both(one, other) { let t = ""; for (const v of one) { const r = other.next(); t += v + ":" + r.value + " "; } return t; }
function counted(it) { let n = 0; for (let r = it.next(); !r.done; r = it.next(n)) { if (n++ > 2) return "many"; } return n; }
const arrow = it => { let t = 1; for (const v of it) t = t * 3 + (v | 0) & 255; return t; };
class Reader { constructor() { this.n = 0; } read(it) { for (const v of it) this.n += v | 0; return this.n; } step(it) { let r; while (!(r = it.next()).done) this.n++; return this.n; } }
const reader = new Reader();
const consumers = [sum, drive, first, last, untilLarge, inTry, keeps, counted, arrow];
function run(values) {
  let total = 0;
  for (let r = 0; r < 2; r++) for (let i = 0; i < values.length; i++) {
    const x = values[i];
    total = (total + sum(range(0, 4)) + sum(range(x, x + 2)) + arrow(odd(0, x))) | 0;
    say(drive(sends(x)), take(range(0, 9), 3), take(pair(x), 5), first(range(x, 9)), firstOr(none(), "other"), firstOr(odd(x, 9)), last(range(0, x)), last(sends(x)));
    say(untilLarge(range(x, 8)), untilLarge(guarded(x + 5)), inTry(throwing(x)), inTry(guarded(x)), keeps(pair(x)), counted(range(0, x)), reader.read(range(0, 3)), reader.step(nested(x | 0)));
    say(both(range(0, 3), odd(x, 9)), sum(new Bag(list).some(2)), sum(new Bag([x])), sum([x, 1]), total, state);
    for (const consumer of consumers) for (const maker of makers) { try { say(consumer.name, maker.name, consumer(maker(x, 6))); } catch (error) { say(consumer.name, error); } }
  }
  return total;
}
say(run(list), run(doubles));
for (const line of lines.slice(0, 700).concat(lines.slice(-300))) console.log(line);
console.log(lines.length, state, kept.length, kept[0].next().done);
