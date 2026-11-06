import { nextTurns } from "../host.ts";
interface Sale {
  region: string;
  amount: number;
}
const sales: Sale[] = [];
const regions = ["n", "s", "e", "w"];
for (let k = 0; k < 16; k++) sales.push({ region: regions[k & 3]!, amount: k * 5 });
function totalOfTwo(i: number): number {
  const totals = sales.reduce<Record<string, number>>((all, sale) => {
    all[sale.region] = (all[sale.region] ?? 0) + sale.amount + (i & 1);
    return all;
  }, {});
  return totals.n! + totals.w!;
}
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += totalOfTwo(i);
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
