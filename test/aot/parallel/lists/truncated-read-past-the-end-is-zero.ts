const M: number[] = [3, 1, 4, 1, 5, 9, 2, 6];
function f(b: any, n: any): any { let w: any = []; for (let t = 0; t < 3; t++) for (let i = 0; i < n; i++) { const x: any = b[t]; w[i] = M[(i * 5) & 15] >>> 0; } return w.join(); }
const L: any = Array.from({ length: 16 }, (_: any, i: number) => i);
console.log(f(new Int32Array(8), 0)); console.log(f(L, 16)); console.log(f(new Float64Array([1.5]), 16));
