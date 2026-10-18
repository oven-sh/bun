// sums differences of neighboring elements up to a bound passed as an argument
const operations = 100;
function steps(list: number[], end: number): number {
  let sum = 0;
  for (let i = 1; i < end; i++) sum += list[i]! - list[i - 1]! * 0.5;
  return sum;
}
const list: number[] = [];
for (let i = 0; i <= operations; i++) list.push(i * 1.5);
let total = steps(list, 3);

kernel: {
  total += steps(list, operations + 1);
}

console.log(total);
