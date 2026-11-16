// Spreads of generators in loops over numbers, in functions that such loops call, and in calls.
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
function lengths(x) { return [...range(x, x + 3)].length; }
function sums(x) { let t = 0; for (const v of [...pair(x), x, ...odd(x, 6)]) t += v; return t; }
function largest(x) { return Math.max(...range(0, x), x / 2); }
function ofBag(x) { return [...new Bag([x, x * 2]), ...new Bag(list).some(2)].join(); }
function caught(x) { try { return [...throwing(x), ...guarded(x)].join(); } catch (error) { return error.name + state; } }
function run(values, n) {
  let total = 0;
  for (let r = 0; r < n; r++) for (let i = 0; i < values.length; i++) {
    const x = values[i];
    const spread = [...range(0, 4)];
    total += spread.length + lengths(x) + x;
    say([...pair(x)], sums(x), largest(x), ofBag(x), caught(x), [...nested(x | 0)], [...none()], total, state);
    for (const maker of makers) { try { say([...maker(x, 5)]); } catch (error) { say(error); } }
  }
  return total;
}
say(run(list, 2), run(doubles, 2));
for (const line of lines) console.log(line);
console.log(lines.length, state);
