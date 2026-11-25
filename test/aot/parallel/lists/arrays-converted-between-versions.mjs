// The preheader of a version converts the array to doubles, a later guard fails, and a version that was walked before runs.
function isPast(x, t) {
  return x > t;
}
function overlap(x) {
  return x.buffer ? new x.constructor(x.buffer, x.BYTES_PER_ELEMENT) : x;
}
const l = [];
function run(a, b, n, t) {
  let s = 0;
  for (let i = 0, m = a.length; i < m; i++) {
    a[i] = b[i] + 1;
    if (isPast(a[i], t)) continue;
    s += +a[i] || 1;
  }
  return s;
}
const show = x => (typeof x === "object" && x ? Object.values(x).join("~") : String(x));
const out = [];
for (const [n, t] of [[3, 2], [8, 4], [7, 8]]) {
  const a = Array.from({ length: 40 }, (_, k) => (k * 7) % 11);
  const b = overlap(a);
  try {
    out.push(run(a, b, n, t));
  } catch (error) {
    out.push(error.name);
  }
  out.push(Array.from(a, show).join());
  if (b !== a) out.push(Array.from(b, show).join());
}
out.push(l.map(show).join());
console.log(out.join(" ").slice(0, 900));
