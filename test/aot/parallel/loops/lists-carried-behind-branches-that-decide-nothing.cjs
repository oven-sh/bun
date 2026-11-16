// STATISTIC: ListStoragesCarried >= 8
// Under: --aot-harden=proof-checks: the storage of each list is read of memory again
// Under: --aot-testing=FailSpeculations:3: every push and pop misses in turn
// let w = 0; if (q > 3) w = 1; do { out.push(i); i++; } while (i < n): the branch becomes a jump that is led past the empty block behind it; the loop that it enters carries its list as without the branch.
"use strict";
const seen = [];
const show = x => (Object.is(x, -0) ? "-0" : Array.isArray(x) ? "[" + x.length + ":" + Array.from({ length: Math.min(x.length, 24) }, (_, q) => (q in x ? show(x[q]) : "hole")).join() + "]" : String(x));
function whole(n, q) {
  const out = [];
  let i = 0;
  let w = 0;
  if (q > 3) w = 1;
  do {
    out.push(i);
    i++;
  } while (i < n);
  return out;
}
function fractions(n, q) {
  const out = [];
  let i = 0;
  let w = 0;
  if (q > 3) w = q * 2;
  else w = q + 1;
  do {
    out.push(i * 0.5);
    i++;
  } while (i < n);
  return out;
}
function popped(n, q) {
  let s = 0;
  const out = [];
  for (let i = 0; i < n; i++) out.push(i);
  q > 3 && q < 9;
  while (out.length) s += out.pop();
  return s + out.length;
}
function caught(n, q) {
  const out = [];
  let i = 0;
  let w;
  try {
    if (q > 5) throw q;
    if (q > 3) w = 1;
    do {
      out.push(i);
      i += 1;
    } while (i < n);
  } catch (e) {
    out.push(e);
  }
  return out;
}
const base = Number(process.env.NO_SUCH_NAME || 0);
const named = JSON.parse("{}");
for (const [name, f] of [["whole", whole], ["fractions", fractions], ["popped", popped], ["caught", caught]]) Reflect.set(named, name + process.pid, f);
for (let t = 0; t < 120; t++) {
  for (const n of [t % 40, 0, 1.5, -0, NaN, 70]) {
    const got = [whole(n, t % 7), fractions(n, base + t), popped(n, t % 11), caught(n, t % 7), ...["whole", "fractions", "popped", "caught"].map(name => named[name + process.pid](n + base, t % 5))].map(show).join(" ");
    if (t < 2 || t === 32 || t === 33 || t === 119) seen.push(t + " " + show(n) + " " + got);
  }
}
for (const line of seen) console.log(line);
