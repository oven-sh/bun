function* pair(a: number, b: number) { yield a; yield b; }
const table: any[] = [
  (limit: number, ...rest: number[]): number => {
    found: {
      for (let round = 0; round < 3; ++round) {
        for (const value of pair(round, 2)) { if (value > limit) break found; }
      }
      return 0;
    }
    return rest.length;
  },
  (limit: number): number => limit - 1,
];
let sum = 0;
for (let i = 0; i < 40; ++i) sum += table[i & 1](i & 3, 5, 6, 7);
console.log(sum);
