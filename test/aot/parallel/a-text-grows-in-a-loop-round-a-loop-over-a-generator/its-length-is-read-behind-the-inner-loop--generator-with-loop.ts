function* pair(a: number, b: number) { for (let i = a; i <= b; i++) yield i; }
function run(times: number): number {
  let total = 0; let last = ""; let round = 0;
  while (round < times) { round++; for (const value of pair(1, 2)) total += value; total += last.length; last += round & 1 ? "ab" : "c"; }
  return total;
}
console.log(run(3), run(10));
