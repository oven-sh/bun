// Array.from over a generator that is made for it.
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
class Own extends Array {}
function run(values) {
  let total = 0;
  for (let r = 0; r < 2; r++) for (let i = 0; i < values.length; i++) {
    const x = values[i];
    const made = Array.from(range(0, 4));
    total += made.length + x;
    made.push(x);
    say(made, Array.from(pair(x)), Array.from(odd(x, 9), v => v * 2), Array.from(range(0, 3), function (v, k) { return v + k + this.n; }, { n: x }), Own.from(range(0, 2)).constructor.name, total, state);
    for (const maker of makers) { try { const got = Array.from(maker(x, 6)); say(maker.name, got, got.length, Array.isArray(got)); } catch (error) { say(maker.name, error, state); } }
    const from = Array.from;
    say(from.call(Array, range(x, x + 1)), from(range(0, 1)), Array.from(new Bag([x])), Array.from(new Bag(list).some(2)), Array.from({ length: 2 }, () => x));
  }
  return total;
}
say(run(list), run(doubles));
for (const line of lines) console.log(line);
console.log(lines.length, state);
