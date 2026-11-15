// Generators called with arguments that have effects, in conditions and as arguments
let calls = 0;
const next = () => ++calls;
function* upTo(n, from = next()) {
  while (from <= n) yield from++;
}
function run(n) {
  calls = 0;
  const out = [];
  if (upTo(next()).next().value) out.push("yes");
  if (!upTo(0, next() + 1).next().value) out.push("no");
  const [first, second] = upTo(n, ...[next()]);
  out.push(first, second, Math.max(...upTo(n, 1)), [...upTo(next() + n)].length);
  for (const value of upTo(n, next())) if (value > 2) out.push(value);
  return out.map(String).join() + " " + calls;
}
console.log(run(3));
console.log(run(9));
console.log(run(1));
