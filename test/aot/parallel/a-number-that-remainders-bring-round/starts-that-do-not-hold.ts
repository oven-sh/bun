function low(v: Int32Array, from: number): number { let left = from | 0; for (let i = 0; i < v.length; i++) left = Math.min(v[i] - 5, left + 1); return left; }
function sum(v: Uint32Array, from: number): number { let left = from | 0; for (let i = 0; i < v.length; i++) left = left + v[i]; return left; }
function past(v: Int16Array, m: number): string { let left = 7; for (let i = 0; i < m; i++) left = Math.max(v[i] + 1, left - 1); return left + " " + typeof left; }
console.log(low(Int32Array.of(3, -2147483648, 9), 4), sum(Uint32Array.of(4294967295, 4294967295, 2), -1), past(Int16Array.of(-3, 40), 2), past(Int16Array.of(-3, 40), 3));
