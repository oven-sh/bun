// The inner loop is a while.
const list = Array.from(JSON.parse("[1,2,3]"));
let sum = 0;
for (let i = list.length - 1; i >= 0; i--) {
  sum += list[i];
  let j = 0;
  while (j < list.length) { sum += list[j]; j++; }
}
console.log(sum);
