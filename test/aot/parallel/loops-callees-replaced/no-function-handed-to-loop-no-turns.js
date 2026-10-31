// A function without types calls what it is given in a loop. Now and then it is given undefined, null, a number or an object, and then the number of turns is zero.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function picker(list) {
  return x => list[x & 3] + list.length;
}
function walk(step, n) {
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, step(j));
  return sum;
}
const strangers = [undefined, null, 5, { call: 1 }, "text"];
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, i % 7 === 3 ? walk(strangers[i % 5], 0) : walk(picker([i, 1, 2, 3]), 24));
console.log(total);
