// Callbacks at every position of a call, several in one call, beside other arguments. A callee may borrow one and keep another.
const pick = new Function("list", "i", process.argv.length < 99 ? "return list[i]" : "");
const kept = [];
function trample(n) { const a = [n, n + 1, n + 2, n + 3]; return n > 0 ? trample(n - 1) + a[n & 3] : a[0]; }
const callees = [
  (a, b, c, d, e) => [a, b, c, d, e].map(x => typeof x === "function" ? x() : x).join(),
  (a, b, c) => { kept.push(b); return typeof a === "function" ? a() : a; },
  (a, b, c) => { kept.push(a, c); return typeof b === "function" ? b() : b; },
  (a) => { kept.push(a); return 0; },
  function () { for (const x of arguments) kept.push(x); return arguments.length; },
  (a, b, c, d) => { kept.push(d); return 1; },
];
const out = [];
for (let i = 0; i < callees.length * 40; i++) {
  const f = pick(callees, i % callees.length), k = i;
  out.push(f(() => k, () => k + 1));
  out.push(f(() => k, k, () => k + 2));
  out.push(f(k, () => k + 3, () => k + 4));
  out.push(f(() => k + 5, () => k + 6, () => k + 7));
  out.push(f(k, k, k, () => k + 8));
  out.push(f(() => k + 9, () => k + 10, () => k + 11, () => k + 12, () => k + 13));
  out.push(f(() => k + 14));
  trample(30);
}
console.log(out.join(" ").length, out.slice(0, 60).join(" "));
let sum = 0; for (const x of kept) sum += typeof x === "function" ? x() : x === undefined ? 1 : x;
console.log(kept.length, sum);
