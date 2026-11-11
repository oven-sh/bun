const kept: Array<(x: number) => number> = [];
function keep(a: number, f: (x: number) => number): number { kept.push(f); return f(a); }
function last(a: number, k: number) { return keep(a, x => x * k); }
let sum = 0;
for (let i = 0; i < 50; i++) sum += last(i, 2);
console.log(sum, kept.length, new Set(kept).size, kept[7](3), kept[49](1));
