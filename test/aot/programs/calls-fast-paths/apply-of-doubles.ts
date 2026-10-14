// `Math.max(...numbers)` and `f.apply(t, numbers)` on arrays of unboxed doubles do not call into C++.
declare const console: any;
const a: any = JSON.parse("[1.5,2.5,3.5]"), b: any = JSON.parse("[4.5,0.5]");
const sum: any = function (x: any, y: any) { return x + y; };
function run(p: any, q: any, n: number): number { let s = 0; for (let i = 0; i < n; i++) { const l = i & 1 ? p : q; s += Math.max(...l) + sum.apply(null, l); } return s; }
console.log(run(a, b, 2_000_000));
export {};
