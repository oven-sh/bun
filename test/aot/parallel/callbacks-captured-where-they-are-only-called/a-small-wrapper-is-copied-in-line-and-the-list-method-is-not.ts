function small(list: number[], f: (x: number) => number): number[] { const made = list.map(x => f(x) + 1); made.push(list.length); return made; }
function maker(list: number[], k: number): number { const t = small(list, x => x * k); return t.length * 1000 + t[0] + t[t.length - 1]; }
function tread(n: number): number { const a = [n, n + 1, n + 2]; return n ? tread(n - 1) + a[n % 3] : 0; }
let sum = 0;
for (let round = 0; round < 300; round++) { sum = (sum + maker([1, 2, 3, round], round % 7)) % 1000003; if (round % 50 === 0) { tread(100); Bun.gc(true); } }
console.log(sum, maker([5], 2), maker([1, 2], 0));
