function* pair(a: number, b: number) { yield a; yield b; }
function slow(list: number[]): number { return list.length * 1000 + list[0]; }
const table: any[] = [
  (first: number, ...rest: number[]): number => {
    let total = 0;
    for (const value of pair(first, 2)) total += value * rest.length;
    if (total > 100) return slow(rest);
    return total;
  },
  (first: number): number => first - 1,
];
let sum = 0;
for (let i = 0; i < 40; ++i) sum += table[i & 1](i, 5, 6, 7);
console.log(sum);
