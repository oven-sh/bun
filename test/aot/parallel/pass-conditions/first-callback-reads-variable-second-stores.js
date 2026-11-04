// map() and filter() follow each other. The callback of the first reads a variable that the callback of the second stores to: all the calls of the first come before any call of the second,
// so each of them reads what was there ahead of the chain.
let shared = 0;
function run(list) {
  shared = 1;
  const kept = list.map(x => x + shared).filter(x => (shared = shared * 5 + 1) > x);
  let sum = shared;
  for (const each of kept) sum += each;
  return sum;
}
let all = 0;
for (let round = 0; round < 40; round++) all += run([1, 2, 3, round]);
console.log(all);
