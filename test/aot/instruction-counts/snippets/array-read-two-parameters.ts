// multiplies two array parameters element by element
const operations = 100;
function weighted(values: number[], weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i]! * weights[i]!;
  return sum;
}
const first: number[] = [];
const second: number[] = [];
for (let i = 0; i < operations; i++) {
  first.push(i * 0.5);
  second.push(i * 0.25 + 1);
}
let total = weighted(second, first);

kernel: {
  total += weighted(first, second);
}

console.log(total);
