// Comparators that are not consistent, but that programs rely on all the same: they only ever say "less" or only ever say "greater", answer with a boolean, or always answer the same.
// The sorted array must be the one that the engine's own sort produces.
const lines = [];
function record(key, id) { return { key, id }; }
function text(list) { return list.map(x => (typeof x === "object" ? x.key + x.id : Object.is(x, -0) ? "-0" : String(x))).join(); }
const comparators = {
  "less or equal": (a, b) => (a < b ? -1 : 0),
  "greater or equal": (a, b) => (a > b ? 1 : 0),
  "less or greater": (a, b) => (a < b ? -1 : 1),
  "greater as a boolean": (a, b) => a > b,
  "less as a boolean": (a, b) => a < b,
  "at least as a boolean": (a, b) => a >= b,
  "always -1": () => -1,
  "always 1": () => 1,
  "always 0": () => 0,
  "always true": () => true,
  "always false": () => false,
  "always NaN": () => NaN,
  "always undefined": () => undefined,
  "always null": () => null,
  "a string": (a, b) => (a < b ? "-1" : "1"),
  "an object": (a, b) => ({ valueOf: () => a - b }),
  "a bigint is refused": () => 1n,
  "difference": (a, b) => a - b,
  "reversed difference": (a, b) => b - a,
  "-0 and 0": (a, b) => (a < b ? -0 : 0),
  "tiny": (a, b) => (a - b) * 1e-320,
  "infinite": (a, b) => (a < b ? -Infinity : Infinity),
};
function numbers(n, step) { const list = []; for (let i = 0, x = 7; i < n; i++) { x = (x * step + 3) % 101; list.push(x); } return list; }
const inputs = [[2, 1], [1, 2], [3, 1, 2], [1, 2, 3], [3, 2, 1], [5, 3, 9, 1, 7, 2, 8, 6], numbers(9, 31), numbers(17, 13), numbers(40, 7), numbers(100, 29), [0.5, 2.5, 1.5], numbers(20, 11).map(x => x / 4), [1, 1, 1, 1], [2, 1, 2, 1, 2, 1, 2, 1, 2, 1]];
for (const name of Object.keys(comparators)) {
  const compare = comparators[name];
  for (const input of inputs) {
    let sorted, copied;
    try { sorted = text(input.slice().sort(compare)); } catch (error) { sorted = error.constructor.name; }
    try { copied = text(input.toSorted(compare)); } catch (error) { copied = error.constructor.name; }
    lines.push(name + " | " + sorted + (copied === sorted ? "" : " | toSorted: " + copied));
  }
}
const byKey = {
  "less or equal": (a, b) => (a.key < b.key ? -1 : 0),
  "greater or equal": (a, b) => (a.key > b.key ? 1 : 0),
  "greater as a boolean": (a, b) => a.key > b.key,
  "less as a boolean": (a, b) => a.key < b.key,
  "difference": (a, b) => a.key - b.key,
  "always -1": () => -1,
  "always false": () => false,
};
for (const name of Object.keys(byKey)) {
  for (const n of [2, 3, 5, 8, 9, 16, 33, 70]) {
    const list = []; for (let i = 0; i < n; i++) list.push(record((i * 7) % 4, "abcdefghijklmnopqrstuvwxyz"[i % 26] + (i / 26 | 0)));
    lines.push(name + " " + n + " | " + text(list.slice().sort(byKey[name])) + " | " + text(list.toSorted(byKey[name])));
  }
}
lines.push(text([3, undefined, 1, , 2].sort((a, b) => (a < b ? -1 : 0))) + " | " + text(["b", "a", "c"].sort((a, b) => (a < b ? -1 : 0))) + " | " + text(["b", "a", "c"].sort((a, b) => a > b)));
console.log(lines.join("\n"));
