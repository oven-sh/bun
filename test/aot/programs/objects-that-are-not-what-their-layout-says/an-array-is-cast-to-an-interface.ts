interface Pair { first: number; second: number }
const pair = [1, 2] as unknown as Pair;
const real: Pair = { first: 3, second: 4 };
function add(p: Pair): number { return p.first + p.second; }
console.log(add(real), String(add(pair)), (pair as unknown as number[]).length);
