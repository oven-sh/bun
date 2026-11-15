// Rest elements of patterns over generators.
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
function run(values) {
  let total = 0;
  for (let r = 0; r < 2; r++) for (let i = 0; i < values.length; i++) {
    const x = values[i];
    const [a, b, ...more] = range(0, 5);
    total += a + b + more.length + x;
    const [...all] = range(x, x + 3);
    const [c = "c", ...rest] = odd(x, 8);
    const [, , ...behind] = pair(x);
    more.push(x); all[0] = "first"; rest.length = Math.min(rest.length, 1);
    say(more, all, c, rest, behind, total, state);
    for (const maker of makers) { try { const [p, q = "q", ...others] = maker(x, 7); say(maker.name, p, q, others, others.length, Array.isArray(others)); } catch (error) { say(maker.name, error, state); } }
    try { const [s, ...t] = guarded(x); say(s, t); } catch (error) { say(error.message, state); }
    const [[d, ...e], ...f] = [[...pair(x)], x, x + 1];
    say(d, e, f);
  }
  return total;
}
function given([a, ...more]) { return a + ":" + more.join(); }
say(run(list), run(doubles));
for (const x of list) say(given(range(0, x)), given(pair(x)), given(nested(x)));
for (const line of lines) console.log(line);
console.log(lines.length, state);
