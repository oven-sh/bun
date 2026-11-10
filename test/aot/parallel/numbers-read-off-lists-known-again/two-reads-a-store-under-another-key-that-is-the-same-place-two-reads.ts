// STATISTIC: NumbersReadOffListsKnownAgain >= 1
const rounds = Number(process.argv[2] ?? 3);
function halves(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 0.5); return list; }
function walk(list: number[], at: number): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) { sum += list[i] * list[i]; list[at] = sum % 3 + 0.25; sum += list[i] * list[i]; }
  return sum;
}
const said: string[] = [];
for (let round = 0; round < rounds; round++) said.push(String(walk(halves(8), 3 + round)));
console.log(said.join(" "));
