// STATISTIC: KeyedReadsKeepingRegisters >= 4
// What a loop carries over a read under a text stays in its registers: numbers, texts and objects are right behind getters, proxies, throws and collections.
const keys = ["a", "b", "c", "d"], out = [];
let calls = 0;
const made = {};
for (const key of keys) made[key] = key.charCodeAt(0) / 4;
const literal = { a: 1, b: 2.5, c: "c", d: null };
const got = { a: 1, get b() { calls++; let kept = []; for (let i = 0; i < 200; i++) kept.push({ i }); return kept.length / 8; }, c: 3, d: 4 };
const thrown = { a: 1, get b() { if (calls++ % 3 === 2) throw new RangeError("got"); return 0.5; }, c: 2, d: 3 };
const watched = new Proxy({ a: 1, b: 2 }, { get(target, key) { calls++; return target[key] ?? 0.25; } });
function carry(holder, turns) {
  let n = 0, m = 0.5, o = -0, p = 1.25, q = 1e300, text = "", last = { v: 0 };
  for (let k = 0; k < turns; k++) {
    const value = holder[keys[k & 3]];
    n += k; m += p; o -= m; p *= 1.001; q /= 1.5;
    if (typeof value === "number") last = { v: last.v + value };
    else text += typeof value;
  }
  return [n, m.toFixed(4), o.toFixed(2), p.toFixed(5), q > 0, text.length, last.v].join();
}
function sum(holder, turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) n += +holder[keys[k & 3]] || 0;
  return n;
}
function caught(holder, turns) {
  let n = 0.5, failed = 0;
  for (let k = 0; k < turns; k++) {
    try { n += holder[keys[k & 3]]; } catch (error) { failed++; n *= 1.5; }
  }
  return Number(n).toFixed(3) + " " + failed;
}
function* steps(holder, turns) {
  let n = 0.25;
  for (let k = 0; k < turns; k++) { n += +holder[keys[k & 3]] || 0; if (k % 5 === 4) yield n; }
}
for (const holder of [made, literal, got, watched, Object.create(made), "text", new Map()]) out.push(carry(holder, 60), sum(holder, 40), caught(holder, 20), [...steps(holder, 20)].join(" "));
out.push(caught(thrown, 40));
try { out.push(sum(thrown, 40)); } catch (error) { out.push(error.message); }
try { out.push(carry(null, 2)); } catch (error) { out.push(error.constructor.name); }
console.log(out.join("\n"), calls);
