function each(list: number[], visit: (x: number) => number): number { let i = 0; for (; i + 1 < list.length; i++) visit(list[i]); return visit(list[i]); }
const seen: number[] = [];
function plus(list: number[], k: number): number { return each(list, x => { seen.push(x + k); return x + k; }); }
function times(list: number[], k: number): number { return each(list, x => x * k); }
let sum = 0;
for (let i = 0; i < 300; i++) sum += plus([i, i + 1, i + 2], i & 7) + times([i, 3], i & 3);
console.log(sum, seen.length, seen[5], seen[899]);
