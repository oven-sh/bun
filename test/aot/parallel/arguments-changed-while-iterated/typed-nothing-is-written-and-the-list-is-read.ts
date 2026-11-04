function total(...values: number[]): number;
function total(): number {
  let sum = 0;
  for (const value of arguments) sum += value as number;
  return sum;
}
function firstTwo(...values: string[]): string;
function firstTwo(): string {
  const [first, second] = arguments;
  return first + "," + second;
}
let sum = 0;
for (let turn = 0; turn < 300; turn++) sum += total(turn, 1, 2, 3);
console.log(sum, total(), total(5), firstTwo("a", "b", "c"), firstTwo("a"));
