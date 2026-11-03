// An untyped recursive function returns `{ sum, count }` at every level and destructures the level below. No level allocates the object.
// `count` is predicted to be an int32, and one call chain takes it past that.
// COUNT: branches >= 1
// COUNT: cells <= 1000
"use strict";
function walk(depth, n) {
  if (depth === 0) return { sum: n, count: 1 };
  const { sum, count } = walk(depth - 1, n + 1);
  return { sum: sum + n, count: count + 1 };
}
function grow(depth, start) {
  if (depth === 0) return { sum: 0, count: start };
  const { sum, count } = grow(depth - 1, start);
  return { sum: sum + 1, count: count + 1 };
}
let total = 0;
for (let i = 0; i < 70000; i++) {
  const { sum, count } = walk(i & 7, 1);
  total += sum + count;
}
const kept = [walk(3, 1), grow(3, 2 ** 31 - 2), grow(2, 0.5), grow(1, "a")];
console.log(total, JSON.stringify(kept), Object.keys(kept[1]).join());
