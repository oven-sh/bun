// A step that yields NaN is taken once.
function* shifted(from, to, by) { for (let i = from; i <= to; i++) yield i - by; }
function* quotients(from, to, by) { for (let i = from; i <= to; i++) yield i / by; }
function* running(from, to, by) { let sum = from; for (let i = 0; i < to; i++) { sum = sum * by - sum; yield sum; } }
function* halves(x, n) { for (let i = 0; i < n; i++) { yield x; x = x - x / 2; } }
function* differences(x, n, by) { for (let i = 0; i < n; i++) { x += by; yield x - by; } }
function listed(it) { const out = []; for (const x of it) out.push(x); return out.join(); }
function counted(it) { let n = 0; for (const x of it) { n++; if (n > 50) break; } return n; }
function first(it, n) { const out = []; for (const x of it) { out.push(x); if (out.length === n) break; } return out.join() + " " + listed(it); }
const makes = [
  () => shifted(1, 4, NaN), () => [1, 2], () => shifted(1, 4, 0.5), () => shifted(-1, 4, Infinity), () => shifted(1, 4, -0), () => new Set([3]),
  () => quotients(0, 3, 0), () => quotients(-2, 2, 0), () => quotients(1, 4, NaN), () => quotients(1, 4, 0.5), () => "12",
  () => running(1, 5, 2), () => running(Infinity, 5, 1), () => running(1, 5, NaN), () => running(1, 5, 1e308), () => halves(Infinity, 4), () => halves(NaN, 4), () => halves(1, 4),
  () => differences(1, 5, 2), () => differences(Infinity, 5, -Infinity), () => differences(1, 5, NaN), () => differences(2147483646, 4, 1),
];
for (let turn = 0; turn < 2; turn++) {
  for (const make of makes) console.log(listed(make()), counted(make()), first(make(), 2), [...make()].length);
  const it = shifted(1, 6, NaN), direct = [];
  for (const x of it) { direct.push(x); if (direct.length === 2) break; }
  const other = quotients(0, 3, 0);
  console.log(direct.join(), JSON.stringify(it.next()), listed(it), JSON.stringify([other.next(), other.next(), ...other]), Math.max(...shifted(1, 3, NaN)));
}
