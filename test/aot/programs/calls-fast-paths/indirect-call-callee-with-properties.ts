// An indirect call of a function that was given a property is as fast as any other.
declare const console: any;
type L = (...args: any[]) => void;
let n = 0;
const table: L[] = [(v: number) => { n += v; }, (v: number) => { n -= v; }];
(table[0] as any).tag = "a"; (table[1] as any).tag = "b";
for (let i = 0; i < 5_000_000; i++) { table[i & 1](1); }
console.log(n);
export {};
