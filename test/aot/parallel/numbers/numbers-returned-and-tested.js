// What a comparison returns is joined, handed to the join of the call, and tested there.
function byNumber(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  if (a === a) return 0;
  return b === b ? 2 : -2;
}
class Pair {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  compareTo(other) {
    const order = byNumber(this.x, other.x);
    if (order) return order;
    return byNumber(this.y, other.y);
  }
}
const numbers = [];
for (let i = 0; i < 60; i++) numbers.push([i % 7, -i, i / 3, NaN, -0, 0, Infinity][i % 7]);
let less = 0, more = 0, equal = 0, odd = 0, sum = 0;
for (const a of numbers)
  for (const b of numbers) {
    const order = byNumber(a, b);
    if (order < 0) less++;
    else if (order > 0) more++;
    else equal++;
    if (byNumber(b, a) === 2) odd++;
    switch (byNumber(a, -b)) {
      case -1: sum += 1; break;
      case 1: sum += 10; break;
      case 2: sum += 100; break;
      default: sum += 1000;
    }
  }
const pairs = [];
for (let i = 0; i < 40; i++) pairs.push(new Pair(i % 5, (i * 7) % 11));
let text = "";
for (let i = 0; i < pairs.length; i++) {
  let left = 0, right = i;
  const pair = pairs[i];
  while (left < right) {
    const middle = (left + right) >> 1;
    const order = pair.compareTo(pairs[middle]);
    if (order < 0) right = middle;
    else if (order > 0) left = middle + 1;
    else break;
  }
  text += left + "." + right + " ";
}
console.log(less, more, equal, odd, sum, text);
