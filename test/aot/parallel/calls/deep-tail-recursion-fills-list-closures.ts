// A function calls itself last, sixty thousand deep, and each call pushes a closure over a variable of its own. The list is mapped and emptied three hundred times.
// Flags: --aot-validate
const later: (() => number)[] = [];
function walk(n: number): number {
  let count = n;
  later.push(() => ++count);
  return n <= 0 ? 0 : walk(n - 1);
}
let sum = 0;
for (let round = 0; round < 300; round++) {
  walk(60000);
  const all = later.map(each => each());
  later.length = 0;
  sum = (sum + all.length + all[round]) % 1000003;
}
console.log(sum);
export {};
