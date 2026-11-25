// x < list[i] and its kin in loops, of an x from outside the loop of which nothing is known: integers, fractions, -0, NaN, texts, undefined, null, booleans, big integers, objects; lists of integers, of doubles, with holes, of any values.
// STATISTIC: NumbersUnboxedForComparisons >= 1
function pairs(list) { const out = []; for (const x of list) for (const y of list) if (x < y) out.push(x + y); return out; }
function below(list, x) { let n = 0; for (const y of list) if (y < x) n++; return n; }
function rank(list, x) { let n = 0; for (let i = 0; i < list.length; i++) { if (x <= list[i]) n += 1; if (x > list[i]) n += 100; if (list[i] >= x) n += 10000; } return n; }
function first(list, x) { for (let i = 0; i < list.length; i++) if (list[i] > x) return i; return -1; }
function nearest(rows, x) { let best = -1; for (const row of rows) for (const y of row) if (y < x && (best < 0 || y > best)) best = y; return best; }
const integers = JSON.parse("[1, 2, 2, 3, 1, 4, -5, 0]"), doubles = JSON.parse("[0.5, 2, 1.25, -0.0, 1e300, 3]"), holes = [1, , 3, , -1], doubleHoles = [0.5, , 2.5, , 1], strings = ["a", "10", "2", ""], mixed = [1, "2", 2.5, null, undefined, true, NaN], dates = [new Date(5), new Date(1)], large = [1n, 2n, 3];
const values = [0, -0, 1, 2, 2.5, 1.25, -1, NaN, Infinity, -Infinity, 1e300, "2", "a", "", undefined, null, true, false, 2n, new Date(3), { valueOf: () => 2 }, [2], 2147483648, -2147483649];
let digest = 0, cases = 0;
function note(run) { let line; try { line = String(run()); } catch (error) { line = error.constructor.name; } cases++; for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0; if (cases % 41 === 5) console.log(cases, line.slice(0, 120)); }
for (let turn = 0; turn < 3; turn++) {
  for (const list of [integers, doubles, holes, doubleHoles, strings, mixed, dates, large, [], [NaN, 1.5], new Float64Array([1, NaN, -0, 2.5]), new Int8Array([1, -2, 3])]) {
    note(() => pairs(list));
    for (const x of values) { note(() => below(list, x)); note(() => rank(list, x)); note(() => first(list, x)); note(() => nearest([list, integers, list], x)); }
  }
  if (turn === 0) { integers.push(2.5); doubles.push(7); }
  if (turn === 1) { integers.push("x"); doubles[1] = undefined; }
}
let thrown = 0; for (const list of [[1, 2, 3], [1, Symbol("s")]]) try { below(list, Symbol("x")); } catch { thrown++; }
console.log(cases, digest, thrown);
