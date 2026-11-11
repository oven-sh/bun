// Neither generator keeps a value that the collector must see across a yield: their frames have no such word, and the build has nothing to divide by.
function* empty() {}
function* only() { return 7; }
let sum = 0;
for (let round = 0; round < 300; round++) {
  const a = empty(), b = only();
  globalThis.held = a; globalThis.kept = b;
  sum += a.next().done ? 1 : 0;
  sum += b.next().value;
}
console.log(String(sum));
