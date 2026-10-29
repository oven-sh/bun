// A call of a function value that is not known statically.
declare const console: any;
type L = (...args: any[]) => void;
let n = 0;
const table: L[] = [(v: number) => { n += v; }, (v: number) => { n -= v; }];
for (let i = 0; i < 5_000_000; i++) { table[i & 1](1); }
console.log(n);
export {};
