// An indirect call of a function with a rest parameter.
declare const console: any;
type L = (...args: any[]) => void;
let n = 0;
const keep: any[] = [];
const table: L[] = [(...v: number[]) => { keep[0] = v; n += v.length; }, (...v: number[]) => { keep[0] = v; n -= v.length; }];
for (let i = 0; i < 5_000_000; i++) { table[i & 1](1); }
console.log(n, keep[0].length);
export {};
