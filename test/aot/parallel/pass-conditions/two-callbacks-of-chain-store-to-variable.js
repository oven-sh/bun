// map(), filter() and reduce() follow each other, and the callbacks of the first two store to one variable: all the calls of the first come before any call of the second.
let shared = 0;
function run(list) {
  shared = 0;
  return list.map(x => (shared = shared * 3 + x)).filter(x => (shared = shared * 5 + 1) > x).reduce((a, b) => a + b, 0) + shared;
}
let all = 0;
for (let round = 0; round < 40; round++) all = run([1, 2, 3, round]);
console.log(all);
