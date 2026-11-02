// A function without types asks in every turn whether it was given a list, by its truth, and reads and stores an element behind that. It is given an array, a typed array, undefined, null, zero or an empty text.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function work(list, n) {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (list) {
      sum = mix(sum, list[j & 3] + list.length);
      list[j & 3] = j;
    } else sum += 1;
  }
  return sum;
}
const missing = [undefined, null, 0, ""];
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i % 5 === 2 ? missing[i & 3] : i & 1 ? [i, 1, 2, 3] : new Float64Array([i, 1, 2, 3]), 24));
console.log(total);
