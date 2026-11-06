// A function without types reads and stores the elements of what it is given. Now and then it is given undefined, null, a number, or a typed array without a buffer, and then the number of turns is zero.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function walk(list, n) {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    sum = mix(sum, list[j] + list.length);
    list[j] = sum & 255;
  }
  return sum;
}
const gone = new Float64Array(4);
gone.buffer.transfer();
const strangers = [undefined, null, 5, gone];
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, i % 7 === 3 ? walk(strangers[i % 4], 0) : walk(i & 1 ? [i, 1, 2, 3] : new Float64Array([i, 1, 2, 3]), 4));
console.log(total);
