// values of every kind from in front of a loop added to what it carries
let calls = 0; const all = process.argv.includes("all"); function f() { calls += 2; }
function plus(s, n, m, x) { for (let i = 0; i < 12; i++) s += n; return s; }
function plusLeft(s, n, m, x) { for (let i = 0; i < 12; i++) s = n + s; return s; }
function minus(s, n, m, x) { for (let i = 0; i < 12; i++) s -= n; return s; }
function times(s, n, m, x) { for (let i = 0; i < 6; i++) s *= n; return s; }
function some(s, n, m, x) { for (let i = 0; i < 12; i++) if (i & 1) s += n; return s; }
function both(s, n, m, x) { for (let i = 0; i < 12; i++) { if (i & 1) s += n; else s -= m; } return s; }
function never(s, n, m, x) { for (let i = 0; i < 12; i++) if (i > 99) s += n; return s; }
function of(s, n, m, x) { for (const v of x) s += n; return s; }
function ofElement(s, n, m, x) { for (const v of x) s += v + n; return s; }
function nested(s, n, m, x) { for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) s += n; return s; }
function change(s, n, m, x) { for (let i = 0; i < 12; i++) { s += n; if (i === 6) n = m; } return s; }
function called(s, n, m, x) { for (let i = 0; i < 12; i++) { s += n; if (i === 5) f(); } return s; }
function caught(s, n, m, x) { for (let i = 0; i < 12; i++) try { s += n; } catch (e) { s = 100; } return s; }
function key(s, n, m, x) { for (let i = 0; i < 12; i++) s += x[i % 3] * n; return s; }
function counter(s, n, m, x) { let k = 0; for (let i = 0; i < 30; i += n) { s += 1; if (++k > 40) break; } return s; }
function whiled(s, n, m, x) { let i = 0; while (i < 10) { s = s + n; i = i + 1; } return s; }
function back(s, n, m, x) { for (let i = 12; i > 0; i--) s = n - s; return s; }
function pairs(s, n, m, x) { let k = 0; for (const v of x) for (const u of x) if (v < u) k++; else if (v > n) k += 2; return k; }
function plus_zero(_, n, m, x) { let s = 0; for (let i = 0; i < 12; i++) s += n; return s; }
function minus_zero(_, n, m, x) { let s = 0; for (let i = 0; i < 12; i++) s -= n; return s; }
function some_zero(_, n, m, x) { let s = 0; for (let i = 0; i < 12; i++) if (i & 1) s += n; return s; }
function of_zero(_, n, m, x) { let s = 0; for (const v of x) s += n; return s; }
function nested_zero(_, n, m, x) { let s = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) s += n; return s; }
function plusLeft_zero(_, n, m, x) { let s = 0; for (let i = 0; i < 12; i++) s = n + s; return s; }
function times_zero(_, n, m, x) { let s = 0; for (let i = 0; i < 6; i++) s *= n; return s; }
function plus_frac(_, n, m, x) { let s = 0.5; for (let i = 0; i < 12; i++) s += n; return s; }
function minus_frac(_, n, m, x) { let s = 0.5; for (let i = 0; i < 12; i++) s -= n; return s; }
function some_frac(_, n, m, x) { let s = 0.5; for (let i = 0; i < 12; i++) if (i & 1) s += n; return s; }
function of_frac(_, n, m, x) { let s = 0.5; for (const v of x) s += n; return s; }
function nested_frac(_, n, m, x) { let s = 0.5; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) s += n; return s; }
function plusLeft_frac(_, n, m, x) { let s = 0.5; for (let i = 0; i < 12; i++) s = n + s; return s; }
function times_frac(_, n, m, x) { let s = 0.5; for (let i = 0; i < 6; i++) s *= n; return s; }
function plus_text(_, n, m, x) { let s = ""; for (let i = 0; i < 12; i++) s += n; return s; }
function minus_text(_, n, m, x) { let s = ""; for (let i = 0; i < 12; i++) s -= n; return s; }
function some_text(_, n, m, x) { let s = ""; for (let i = 0; i < 12; i++) if (i & 1) s += n; return s; }
function of_text(_, n, m, x) { let s = ""; for (const v of x) s += n; return s; }
function nested_text(_, n, m, x) { let s = ""; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) s += n; return s; }
function plusLeft_text(_, n, m, x) { let s = ""; for (let i = 0; i < 12; i++) s = n + s; return s; }
function times_text(_, n, m, x) { let s = ""; for (let i = 0; i < 6; i++) s *= n; return s; }
const U = n => { const o = JSON.parse('{"k":1}'); o.k = n; return o; };
function minusOne(s, n, m, x) { for (let i = 0; i < 12; i++) s = s + n - 1; return s; }
function bothAdded(s, n, m, x) { for (let i = 0; i < 12; i++) s = s + n + m; return s; }
function addedFirst(s, n, m, x) { for (let i = 0; i < 12; i++) s += n + m; return s; }
function ofItself(s, n, m, x) { s = n; for (let i = 0; i < 12; i++) s += n; return s; }
function ofItselfMinus(s, n, m, x) { s = n; for (let i = 0; i < 12; i++) s = s + n - 1; return s; }
function twoSums(s, n, m, x) { let t = 0; for (let i = 0; i < 12; i++) { s += n; t += s; } return show(s) + show(t); }
function twoOfOne(s, n, m, x) { let t = 0; for (let i = 0; i < 12; i++) { s += n; t += n; } return show(s) + show(t); }
function swapped(s, n, m, x) { let t = 0; for (let i = 0; i < 6; i++) { const u = s + n; s = t; t = u; } return show(s) + show(t); }
function bounded(s, n, m, x) { let k = 0; for (let i = 0; i < 12; i++) { s += n; if (s > 20) break; k++; } return show(s) + k; }
function lateChange(s, n, m, x) { for (let i = 0; i < 12; i++) { s += n; if (i === 8) s = m; } return s; }
function lateCall(s, n, m, x) { for (let i = 0; i < 12; i++) { s += n; if (i > 8) f(s); } return s; }
function elements(s, n, m, x) { for (let i = 0; i < 12; i++) { s += n; x[i % 3] = s; } return show(s) + show(x[0]); }
function elementsToo(s, n, m, x) { for (let i = 0; i < 12; i++) s += n + x[i % 3]; return s; }
function field(s, n, m, x) { const o = { n, s }; for (let i = 0; i < 12; i++) o.s += o.n; return o.s; }
function fieldOfUnknown(s, n, m, x) { const o = U(n); for (let i = 0; i < 12; i++) s += o.k; return s; }
function captured(s, n, m, x) { const add = () => { s += n; }; for (let i = 0; i < 12; i++) add(); return s; }
function truncated(s, n, m, x) { for (let i = 0; i < 12; i++) s = (s + n) | 0; return s; }
function asIndex(s, n, m, x) { let k = 0; for (let i = 0; i < 4; i++) { s += n; k += x[s] === undefined ? 1 : 2; } return show(s) + k; }
function outer(s, n, m, x) { for (let j = 0; j < 3; j++) { for (let i = 0; i < 3; i++) s += n; s += m; } return s; }
function early(s, n, m, x) { for (let i = 0; i < 12; i++) { if (i === 5) return s; s += n; } return s; }
function text(s, n, m, x) { let t = ""; for (let i = 0; i < 5; i++) { s += n; t += s + ","; } return t; }
const bodies = { plus, plusLeft, minus, times, some, both, never, of, ofElement, nested, change, called, caught, key, counter, whiled, back, pairs, plus_zero, minus_zero, some_zero, of_zero, nested_zero, plusLeft_zero, times_zero, plus_frac, minus_frac, some_frac, of_frac, nested_frac, plusLeft_frac, times_frac, plus_text, minus_text, some_text, of_text, nested_text, plusLeft_text, times_text, minusOne, bothAdded, addedFirst, ofItself, ofItselfMinus, twoSums, twoOfOne, swapped, bounded, lateChange, lateCall, elements, elementsToo, field, fieldOfUnknown, captured, truncated, asIndex, outer, early, text };
const values = { num: () => 4, frac: () => 4.5, nan: () => NaN, inf: () => -Infinity, negzero: () => -0, big53: () => 9007199254740992, str: () => "t", numstr: () => "4", empty: () => "", undef: () => undefined, nul: () => null, bool: () => true, bigint: () => 4n, obj: () => ({ valueOf() { calls++; return 4; } }), objstr: () => ({ toString() { calls++; return "o"; } }), arr: () => [4], none: () => [], date: () => new Date(4), throws: () => ({ valueOf() { calls++; throw new RangeError("v"); } }), sym: () => Symbol("s"), fn: () => (() => 1), int: () => 2147483647, dbl: () => Math.sqrt(16), p31: () => 2147483648, p32: () => 4294967296, m31: () => -2147483649, tiny: () => 5e-324, wide: () => 2n ** 70n, rope: () => "a" + String(calls), nan2: () => new Float64Array(new BigUint64Array([0x7ff8000000000001n]).buffer)[0], neg: () => -3 };
const starts = { zero: n => 0, frac: n => 0.5, negzero: n => -0, text: n => "", big: n => 1n, value: n => n, undef: n => undefined };
const show = v => { try { return Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? "o" : typeof v + ":" + String(v); } catch (e) { return "E" + e.name; } };
const lists = [[1, 2, 3], [1.5, 2.5, "z"], ["a", "b", "c"], [3, , 1]];
let total = 0;
for (const b in bodies) for (const k in values) {
  let hash = 0;
  for (const s in starts) for (let round = 0; round < lists.length; round++) {
    let line = b + " " + k + " " + s;
    try { const n = values[k](); line += " " + show(bodies[b](starts[s](n), n, round & 1 ? 2 : n, lists[round].slice())) + " " + calls; } catch (e) { line += " " + e.name + " " + calls; }
    if (all) console.log(line);
    for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
    total++;
  }
  console.log(b, k, hash);
}
console.log(total, calls);
