// concat, slice, splice and spreads of lists of every kind of storage, with and without holes, and what is stored into the results.
const item = v => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : Array.isArray(v) ? "[" + show(v) + "]" : typeof v === "string" ? JSON.stringify(v) : typeof v === "object" && v ? "{}" : String(v);
function show(list) { let s = list.length + ":"; for (let i = 0; i < list.length; i++) s += (i in list ? item(list[i]) : "hole") + ","; return s; }
const ints = [], halves = [], mixed = [], many = []; for (let i = 0; i < 9; i++) { ints.push(i * 7 - 20); halves.push(i / 2 - 1); mixed.push(i % 3 ? i : "s" + i); } for (let i = 0; i < 70; i++) many.push(i % 7 ? i : i + 0.5);
const makers = [() => [1, 2, 3], () => [1, , 3], () => [0.5, -0, 2], () => [0.5, , 2], () => [NaN, 1], () => ["a", 1], () => [], () => [,], () => [undefined, null], () => [2 ** 31, -(2 ** 31)], () => Array(3), () => Array(4).fill(0), () => Array(4).fill(1.5), () => [[1], 2], () => ints.slice(), () => halves.slice(), () => mixed.slice(1), () => many.slice(), () => Float64Array.of(0.5, NaN, -0), () => 7, () => 0.25, () => NaN, () => "x", () => undefined];
const lines = [];
for (const a of makers) for (const b of makers) {
  const first = a(); if (!Array.isArray(first)) continue;
  const second = b(), joined = first.concat(second);
  let text = show(joined);
  joined[joined.length] = 0.5; joined.push("z"); text += show(joined.slice(-3));
  if (Array.isArray(second)) { const spread = [...first, ...second]; text += show(spread); const cut = second.concat(first); cut.splice(1, 1, 4, 4.5); text += show(cut) + show(second.slice(0, 2)) + show(first.splice(0, 2)) + show(first); }
  else if (second instanceof Float64Array) text += show([...second]) + show([...second, 1]) + show(Array.from(second).concat(first));
  lines.push(text);
}
function numbers(turns) { let n = 0; for (let k = 0; k < turns; k++) { const t = ints.concat(halves), u = halves.concat(ints), v = ints.concat(mixed); n += t[3] + t[12] + u[3] + u[12] + (typeof v[9] === "string" ? 1 : 0) + t.length; t[0] = k / 2; u.push(k); n += t[0] + u[18]; } return n; }
lines.push(numbers(40));
console.log(lines.join("\n"));
