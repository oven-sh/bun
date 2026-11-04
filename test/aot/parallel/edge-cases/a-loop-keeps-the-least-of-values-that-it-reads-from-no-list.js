// A loop that keeps the least or the greatest of what its turns come to, and reads no list and stores into none: there is no element to take several of at once.
function leastOfZero(x, z) {
  let a = x,
    c = z,
    d = 0,
    i0 = 0;
  while (a == 65536 && i0 < 9) {
    i0++;
    c = c > 0 ? d : c;
  }
  return c;
}
function greatestOfSeven(count, start) {
  let found = start;
  for (let i = 0; i < count; i++) found = found < 7 ? 7 : found;
  return found;
}
function greatestOfCounter(count, start) {
  let found = start | 0;
  for (let i = 0; i < count; i++) found = i > found ? i : found;
  return found;
}
function leastByMath(count, start) {
  let found = start | 0;
  for (let i = 0; i < count; i++) found = Math.min(found, 100 - i);
  return found;
}
let sum = 0;
for (let round = 0; round < 2000; round++) {
  sum +=
    leastOfZero(65536, round - 1000) +
    greatestOfSeven(round & 15, round - 1000) +
    greatestOfCounter(round & 31, -5) +
    leastByMath(round & 63, 1000);
}
console.log(sum);
console.log(leastOfZero(65536, 3), leastOfZero(1, 3), leastOfZero(65536, -2), leastOfZero(65536, 0));
console.log(
  greatestOfSeven(0, 1),
  greatestOfSeven(3, 1),
  greatestOfSeven(3, 9),
  greatestOfCounter(20, -5),
  greatestOfCounter(0, -5),
  leastByMath(40, 1000),
  leastByMath(0, 1000),
);
