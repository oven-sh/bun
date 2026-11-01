// Every turn reads a list out of a variable of the module. A turn in eight stores a shorter list, a list of fractions or a list with a gap, or cuts the one that is there.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
let held: number[] = [1, 2, 3, 4, 5, 6, 7, 8];
function work(from: number, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    const e = held[j & 7];
    sum = mix(sum, e === undefined ? -1000 : e);
    if ((j & 7) !== 7) continue;
    const way = (from + j) % 4;
    if (way === 0) held = [from, j];
    else if (way === 1) held = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, from + 0.5];
    else if (way === 2) held = [1, , 3, , 5, , 7, from] as number[];
    else held.length = 3;
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 300; i++) total = mix(total, work(i, 40));
console.log(total);
