// STATISTIC: NumbersFoundAtHomeSlots >= 4
// Counters and small numbers are found at their own places where they were added in order, and by their tags where they were not.
const log = [];
function sum(map, end) {
  let total = 0;
  for (let i = 0; i < end; i++) total += map.get(i) ?? 1000;
  return total;
}
function masked(map, end) {
  let total = 0;
  for (let i = 0; i < end; i++) total = (total + (map.get(i & 7) ?? 100)) | 0;
  return total;
}
function count(set, end) {
  let found = 0;
  for (let i = -3; i < end; i++) if (set.has(i)) found++;
  return found;
}
function inside() {
  const map = new Map();
  for (let i = 0; i < 300; i++) map.set(i, i * 2);
  let total = 0;
  for (let i = 0; i < 400; i++) total += map.get(i) ?? 1;
  return total;
}
for (const size of [0, 1, 2, 8, 9, 254, 256, 700]) {
  const inOrder = new Map(), backwards = new Map(), holes = new Map(), halves = new Map(), texts = new Map();
  const set = new Set();
  for (let i = 0; i < size; i++) {
    inOrder.set(i, i);
    backwards.set(size - i, i);
    holes.set(i, i + 0.5);
    halves.set(i / 2, i);
    texts.set(i % 3 ? i : "t" + i, i);
    set.add(i * 2 - 4);
  }
  for (let i = 1; i < size; i += 4) holes.delete(i);
  for (const map of [inOrder, backwards, holes, halves, texts]) log.push(sum(map, size + 5), masked(map, 40));
  log.push(count(set, size + 9), inside());
}
console.log(log.join());
