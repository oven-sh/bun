// A sum that starts as any number and takes in the elements of an integer typed array one by one. Each addition rounds by itself: what comes out depends on where the sum starts (a fraction, minus zero,
// a number next to 2 ** 53, no number at all) and, once it has grown past 2 ** 53, on the order of the additions. Counters that go up, go down and meet.
const mixed = Int32Array.from({ length: 1000 }, (_, k) => (k * 2654435761) | 0);
const greatest = new Int32Array((1 << 22) + 1001).fill(2147483647);
const least = new Int32Array((1 << 22) + 1001).fill(-2147483647);
const zeros = new Int32Array(40);
const thereAndBack = new Int32Array(40);
thereAndBack[3] = 1;
thereAndBack[5] = -1;
const bytes = Uint8Array.from({ length: 1003 }, (_, k) => k * 7);
const shorts = Int16Array.from({ length: 1003 }, (_, k) => k * 7919);

function added(list: Int32Array | Uint8Array | Int16Array, start: number): number {
  let sum = start;
  for (let k = 0; k < list.length; k++) sum += list[k]!;
  return sum;
}

function takenAway(list: Int32Array | Uint8Array | Int16Array, start: number): number {
  let sum = start;
  for (let k = 0; k < list.length; k++) sum -= list[k]!;
  return sum;
}

function addedDownward(list: Int32Array, start: number): number {
  let sum = start;
  for (let k = list.length - 1; k >= 0; k--) sum += list[k]!;
  return sum;
}

function addedFromBothEnds(list: Int32Array, start: number): number {
  let sum = start;
  for (let low = 0, high = list.length - 1; low < high; low++, high--) sum += list[low]! - list[high]!;
  return sum;
}

function twoSums(list: Int32Array, start: number): string {
  let even = start;
  let odd = -start;
  for (let k = 0; k + 1 < list.length; k += 2) {
    even += list[k]!;
    odd -= list[k + 1]!;
  }
  return show(even) + " " + show(odd);
}

function show(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

const starts = [0, -0, 1, -7, 0.5, 0.1, -1e-300, 1e15, -1e15, 2251799813685247, 2251799813685248, -2251799813685248.5, 4503599627370497, 9007199254740992, -9007199254740994, 1e300, Infinity, -Infinity, NaN];
for (const start of starts) {
  console.log("from", show(start));
  for (const list of [mixed, zeros, thereAndBack, greatest, least])
    console.log(" ", show(added(list, start)), show(takenAway(list, start)), show(addedDownward(list, start)), show(addedFromBothEnds(list, start)), twoSums(list, start));
  console.log(" ", show(added(bytes, start)), show(takenAway(bytes, start)), show(added(shorts, start)), show(takenAway(shorts, start)));
}
