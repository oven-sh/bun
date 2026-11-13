const out = [];
const show = v => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "string" ? '"' + v + '"' : v instanceof Error ? v.name + " " + v.message : String(v);
let asked = 0;
const noisy = value => ({ valueOf() { asked++; return value; } });
const ints = JSON.parse("[0,1,-1,2147483647,-2147483648,2147483646,-2147483647,7]");
const doubles = JSON.parse("[0.5,-0,1e300,4294967296,-2147483649]").concat([NaN, Infinity, -Infinity, -0]);
const strange = ["", "a", "7", null, undefined, true, noisy(3), noisy("x"), [4], [], {}, new Date(0).getTime()];
const bigs = [1n, -5n, 2147483648n];
function adds(left, right) { const kept = []; for (let i = 0; i < left.length; i++) for (let j = 0; j < right.length; j++) kept.push(show(left[i] + right[j])); return kept.join(); }
function subtracts(left, right) { const kept = []; for (let i = 0; i < left.length; i++) for (let j = 0; j < right.length; j++) kept.push(show(left[i] - right[j])); return kept.join(); }
function totals(values) { let total = 0, bits = 0, back = 100; for (let r = 0; r < 3; r++) for (let i = 0; i < values.length; i++) { const x = values[i]; total += x; bits = (bits + x) | 0; back = back - x; } return [total, bits, back].map(show).join(); }
function steps(values) { const step = (v, by) => v + by; let s = 0; for (let i = 0; i < values.length; i++) s = step(values[i], i) + step(i, values[i]); return show(s); }
function caught(left, right) { let count = 0; for (let i = 0; i < left.length; i++) { try { left[i] + right[i % right.length]; count++; } catch (error) { out.push(show(error)); } try { count += typeof (right[i % right.length] - left[i]) === "number"; } catch (error) { out.push(show(error)); } } return count; }
for (let round = 0; round < 2; round++) {
  for (const a of [ints, doubles, strange]) for (const b of [ints, doubles, strange]) { out.push(adds(a, b), subtracts(a, b), totals(a), steps(b)); }
  out.push(adds(bigs, bigs), subtracts(bigs, bigs), caught(bigs, ints), caught(ints, bigs), caught([Symbol("s"), 1], ints), caught(strange, bigs));
  out.push("asked " + asked);
}
console.log(out.join("\n"));
