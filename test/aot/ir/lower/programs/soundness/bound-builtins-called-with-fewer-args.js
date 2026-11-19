// RUN: lower
// OPTIONS: builtin-modules

// Bound functions over one built-in, called at one site with different numbers of arguments: a key that is not passed is "undefined".
function main() {
const o1 = { a: 1 };
const o2 = { k: 2, undefined: "under undefined" };
const g1 = Reflect.get.bind(null, o1, "a");
const g2 = Reflect.get.bind(null, o2, "k");
const g3 = Reflect.get.bind(null, o2);
const all = [g1, g2, g3];
for (let i = 0; i < all.length; i++) {
  const r = all[i]();
  console.log(typeof r, typeof r === "number" ? r + 1 : r.length);
}
const m1 = Math.max.bind(null, 1, 2);
const m2 = Math.max.bind(null, 3, 4);
const m3 = Math.max.bind(null);
const a1 = Math.abs.bind(null, -1);
const a2 = Math.abs.bind(null, -2);
const a3 = Math.abs.bind(null);
for (const m of [m1, m2, m3, a1, a2, a3]) {
  const r = m();
  console.log(r, Number.isInteger(r), r | 0, r === r);
}
}
main();
