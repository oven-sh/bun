// Untyped on purpose. What compiled code remembers about a place in the program (the shape an object literal makes, the shapes a read has seen, where a free name lives) names shapes that may die. After any mix of collections the place must work as at first: with shapes made long ago, just now, and made again after they died.
const collect = globalThis.Bun ? full => globalThis.Bun.gc(full) : full => (full ? fullGC() : edenGC());
function churn(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += { a: i, b: "t" + i, c: [i] }.b.length;
  return sum;
}
const makers = [
  (i) => ({ a: i }),
  (i) => ({ a: i, b: i + 1 }),
  (i) => ({ b: i, a: i + 1 }),
  (i) => ({ x: i, y: i, z: i }),
  (i) => ({ x: i, y: i, z: i, w: "w" + i }),
  (i) => ({ name: "n" + i, a: i, list: [i] }),
  (i) => ({ k0: i, k1: i, k2: i, k3: i, k4: i, k5: i, k6: i, k7: i, a: i }),
  (i) => ({ a: { a: i }, deep: { deeper: { a: i } } }),
  (i) => ({ get a() { return i; }, plain: i }),
  (i) => ({ __proto__: { a: i * 2 }, own: i }),
  (i) => ({ ["computed" + (i % 3)]: i, a: i }),
  (i) => ({ a: i, method() { return this.a + 1; } }),
];
function readA(o) {
  return o.a;
}
function total(objects) {
  let sum = 0;
  for (const o of objects) {
    const a = readA(o);
    sum += typeof a === "number" ? a : a === undefined ? 1 : a.a;
  }
  return sum;
}
let kept = [];
for (let round = 0; round < 24; round++) {
  const fresh = [];
  for (let i = 0; i < 300; i++) fresh.push(makers[(i + round) % makers.length](i));
  // Shapes of this round alone: a literal that then grows by a name no other round uses.
  for (let i = 0; i < 40; i++) {
    const o = makers[i % 4](i);
    o["only" + round + "_" + (i % 5)] = i;
    fresh.push(o);
  }
  console.log("round", round, total(fresh), total(kept));
  kept = round % 3 === 0 ? fresh.slice(0, 50) : round % 3 === 1 ? kept : [];
  churn(4000);
  collect(round % 5 === 4);
  if (round % 2) collect(false);
}
function grow(o, n) {
  for (let i = 0; i < n; i++) o["p" + i] = i;
  return o;
}
let widths = 0;
for (let round = 0; round < 10; round++) {
  for (const make of makers) widths += Object.keys(grow(make(round), 12 + round)).length;
  collect(round % 4 === 3);
}
console.log("literals that outgrow their room", widths);

function free() {
  return typeof lateGlobal === "undefined" ? -1 : lateGlobal;
}
function freeMember() {
  return Math.max(1, 2) + JSON.stringify([parseInt("7")]).length + (globalThis.lateObject ? globalThis.lateObject.n : 0);
}
const seen = [];
for (let round = 0; round < 16; round++) {
  seen.push(free(), freeMember());
  if (round === 2) globalThis.lateGlobal = 5;
  if (round === 4) globalThis.lateObject = { n: 40 };
  if (round === 6) globalThis["extra" + round] = { big: churn(10) };
  if (round === 8) delete globalThis.lateGlobal;
  if (round === 10) globalThis.lateGlobal = { valueOf: () => 9 } * 1;
  if (round === 12) globalThis.lateObject = { n: 41, more: true };
  for (let i = 0; i < 6; i++) globalThis["name" + round + "_" + i] = i;
  churn(2000);
  collect(round % 3 === 2);
  collect(false);
}
console.log("free names", seen.join(" "));
