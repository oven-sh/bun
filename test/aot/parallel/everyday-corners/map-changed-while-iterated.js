// Map changed while iterated: compiled answers as plain.
const m = new Map([
  [1, "a"],
  [2, "b"],
  [3, "c"],
]);
const seen = [];
for (const [k] of m) {
  seen.push(k);
  if (k === 1) {
    m.delete(2);
    m.set(4, "d");
  }
  if (k === 3) {
    m.delete(1);
    m.set(1, "again");
  }
  if (seen.length > 8) break;
}
console.log(seen.join());
