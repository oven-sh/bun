// A small function that reads a lazily initialized module constant is still inlined.
// IR= 0 one CallDirect \(v
// IR= 0 five CallDirect \(v
declare const console: any;
const TABLE: number[] = [3, 1, 4, 1, 5, 9, 2, 6];
function pick(i: number, j: number): number { return TABLE[i & 7] + TABLE[j & 7] * 2 + (i ^ j) + (i | j); }
function one(n: number): number { let t = 0; for (let i = 0; i < n; i++) t = (t + pick(i, i + 1)) | 0; return t; }
function two(n: number): number { let t = 0; for (let i = 0; i < n; i++) t = (t + pick(i + 2, i)) | 0; return t; }
function three(n: number): number { let t = 0; for (let i = 0; i < n; i++) t = (t + pick(i, 3)) | 0; return t; }
function four(n: number): number { let t = 0; for (let i = 0; i < n; i++) t = (t + pick(4, i)) | 0; return t; }
function five(n: number): number { let t = 0; for (let i = 0; i < n; i++) t = (t + pick(i, i)) | 0; return t; }
const N = 6_000_000;
console.log(one(N), two(N), three(N), four(N), five(N));
export {};
