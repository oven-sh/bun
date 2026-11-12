// The low and the high bound of a search by halves are tried between what enters them; a sum over int32 and a bound that moves away put them back.
const list: number[] = [];
for (let place = 0; place < 100; place++) list.push(place * 3);
const view = new Int32Array(100).map((_, place) => place * 3);
function inList(wanted: number): number {
  let low = 0, high = list.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (list[middle]! < wanted) low = middle + 1;
    else if (list[middle]! > wanted) high = middle - 1;
    else return middle;
  }
  return -low;
}
function inView(wanted: number): number {
  let low = 0, high = view.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (view[middle]! < wanted) low = middle + 1;
    else high = middle;
  }
  return low;
}
function rootOf(square: number, top: number): number {
  let low = 0, high = top, steps = 0;
  while (high > low) {
    if (++steps > 70) return -1;
    const middle = (low + high) >> 1;
    if (middle * middle < square) low = middle + 1;
    else high = middle;
  }
  return low;
}
function away(limit: number): number {
  let low = 0, high = 8, total = 0;
  while (low < high) {
    total += high - low;
    low += 3;
    if (total < limit) high += 4;
  }
  return total * 1000 + high;
}
function meet(from: number, to: number): number {
  let low = from, high = to, total = 0;
  while (low < high) {
    total = (total * 3 + (low ^ high)) | 0;
    if (total & 1) low++;
    else high -= 2;
  }
  return total + low * 7 + high;
}
let sum = 0;
for (let wanted = -5; wanted < 310; wanted++) sum = (sum * 5 + inList(wanted) + inView(wanted)) | 0;
console.log(sum);
console.log([100, 46341, 1 << 30, 2147483647, 4294967295, 9007199254740991].map(top => rootOf(5000 * 5000, top)).join(" "));
console.log([0, 10, 100, 400].map(away).join(" "));
console.log([[0, 40], [-7, 9], [1 << 29, 1 << 30], [2147483600, 2147483647], [5, 5], [9, 2]].map(([from, to]) => meet(from!, to!)).join(" "));
