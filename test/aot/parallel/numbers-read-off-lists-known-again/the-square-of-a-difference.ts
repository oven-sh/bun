// STATISTIC: NumericElementReadsEliminated >= 1
const rounds = Number(process.argv[2] ?? 3);
function distance(one: number[], other: number[]): number {
  let sum = 0;
  for (let i = 0; i < one.length; i++) sum += (one[i] - other[i]) * (one[i] - other[i]);
  return sum;
}
const here: number[] = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5], there: number[] = [0.5, 1.25, 2.5, 3.75, 5.5, 7.25];
const said: string[] = [];
for (let round = 0; round < rounds; round++) said.push(String(distance(here, there)));
console.log(said.join(" "));
