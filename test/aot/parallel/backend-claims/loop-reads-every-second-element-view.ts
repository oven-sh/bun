// A loop reads every second element of a view of numbers: within the view, and for more turns than the view has room for.
function sum(view: Float64Array, turns: number): number {
  let total = 0;
  for (let i = 0; i < turns; i++) {
    const value = view[i * 2 + 1];
    total += value === undefined ? -1 : value;
  }
  return total;
}
const view = new Float64Array(64).fill(1);
let all = 0;
for (let round = 0; round < 50; round++) all += sum(view, 32);
console.log(all, sum(view, 40), sum(view, 0));
