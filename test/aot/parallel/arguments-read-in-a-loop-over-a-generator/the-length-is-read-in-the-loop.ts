function* pair(a: number, b: number) { yield a; yield b; }
function slow(list: any): number { return list.length * 1000 + list[0]; }
const plain = {
  add(first: number): number {
    let total = 0;
    for (const value of pair(first, 2)) total += value * arguments.length;
    if (total > 1000) return slow(arguments);
    return total;
  },
  other(first: number): number { return first - 1; },
};
const table: any[] = [plain.add, plain.other];
let sum = 0;
for (let i = 0; i < 40; ++i) sum += table[i & 1](i, 5);
console.log(sum);
