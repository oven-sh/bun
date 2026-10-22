// whole-numbers-stored-as-doubles.js <pinned | plain> <size> <rounds>: an array is filled by push in a loop whose bound is a number that nobody knows the range of; then it is summed.
const pinned = process.argv[2] === "pinned", size = Number(process.argv[3] ?? 64), rounds = Number(process.argv[4] ?? 1000);
const numbers = [];
if (pinned) for (let i = 0; i < size; i++) numbers.push(((i * 7919) % 1000) | 0);
else for (let i = 0; i < size; i++) numbers.push((i * 7919) % 1000);
function sum(array) { let total = 0; for (let j = 0; j < array.length; j++) total += array[j]; return total; }
let total = 0;
for (let round = 0; round < rounds; round++) total += sum(numbers);
console.log(total);
