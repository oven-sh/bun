// An array stops being pristine inside the mapping function, which runs only because the overload for a pristine array was selected.
async function main() {
const list = [1, 2, 3];
function map(value) {
  list[Symbol.iterator] = function* () { yield "from own iterator"; };
  return value;
}
for (let i = 0; i < 2; i++) {
  const copy = Array.from(list, map);
  console.log(copy.length, typeof copy[0]);
}
const other = [1, 2, 3];
function late() { Object.setPrototypeOf(other, { [Symbol.iterator]: function* () { yield { boxed: true }; }, __proto__: Array.prototype }); }
for (let i = 0; i < 2; i++) {
  const copy = [...other];
  console.log(copy.length, typeof copy[0]);
  const viaSet = new Set(other);
  console.log(viaSet.size);
  [0].forEach(late);
}
const source = [[1, "one"]];
function change() { source[Symbol.iterator] = function* () { yield [{ key: 1 }, 2]; }; }
for (let i = 0; i < 2; i++) {
  const m = new Map(source);
  for (const [k, v] of m) console.log(typeof k, typeof v);
  Promise.resolve().then(change);
  await null;
}
}
main();
