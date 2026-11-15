// Counters that enter a loop below a small bound and step past it, past int32 and past the exact integers.
function pairs(data: ArrayLike<number>, start: number, end: number): number {
  let sum = 0;
  for (let i = start & 255; i < end; i += 2) sum = (sum * 31 + (data[i]! | ((data[i + 1] ?? 0) << 8))) % 65535;
  return sum;
}
function strided(start: number, end: number, step: number): string {
  let turns = 0, last = -1;
  for (let i = start & 255; i < end; i += step) {
    last = i;
    if (++turns === 1000) break;
  }
  return turns + ":" + last;
}
function byBillions(start: number, end: number): string {
  let turns = 0, sum = 0;
  for (let i = start & 15; i < end; i += 1000000000) {
    turns++;
    sum += i;
  }
  return turns + ":" + sum;
}
function bothWays(start: number, turns: number): number {
  let at = start & 1023;
  for (let i = 0; i < turns; i++) at += i & 1 ? 3 : -2;
  return at;
}
function downAndUp(start: number, floor: number): number {
  let at = start & 127, seen = 0;
  while (at > floor) {
    at -= 3;
    seen += at;
  }
  return seen;
}
function nested(list: number[], from: number): number {
  let sum = 0;
  for (let i = from & 7; i < list.length; i++) {
    for (let j = i; j < list.length; j += i + 1) sum += list[j]! * (j - i);
    for (let k = i & 3; k <= i; k += 2) sum -= k;
  }
  return sum;
}
function found(text: string, from: number): string {
  const places: number[] = [];
  for (let i = from & 63; i < text.length; i += 5) if (text.charCodeAt(i) & 1) places.push(i);
  return places.join();
}
const list = Array.from({ length: 300 }, (_, i) => (i * 37) & 255);
const fractions = list.map(value => value / 4);
for (const data of [list, new Uint8Array(list), new Float64Array(fractions), fractions, { length: 3, 0: 1, 1: 2, 2: 3 }]) {
  console.log(pairs(data, 0, data.length), pairs(data, 255, data.length), pairs(data, 10, 1000), pairs(data, 3, 2 ** 10), pairs(data, 0, 4294967296 * 0 + 5));
}
console.log(strided(0, 2 ** 31 + 5, 2 ** 29), strided(255, 2 ** 53, 2 ** 45), strided(9, 100, 0.5), strided(1, 2 ** 32, 2 ** 31 - 1), strided(200, NaN, 1), strided(3, 10, -(2 ** 31)), strided(7, Infinity, 1e300), strided(2, 50, 0));
console.log(byBillions(5, 5e9), byBillions(15, 2147483648), byBillions(0, 2147483647), byBillions(3, 9.5e9));
console.log(bothWays(0, 5000), bothWays(1023, 3), downAndUp(127, -300), downAndUp(5, -2147483648 + 2147483640), nested(list, 2), nested([1, 2, 3], 12));
console.log(found("the quick brown fox jumps over the lazy dog and runs away from the bear that sleeps", 3));
