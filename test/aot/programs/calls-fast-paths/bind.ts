// Calling the result of `f.bind(thisArg)` is as fast as any indirect call.
declare const console: any;
type L = (...args: any[]) => void;
const self = { n: 0 };
function add(this: { n: number }, v: number) { this.n += v; }
function sub(this: { n: number }, v: number) { this.n -= v; }
const table: L[] = [add.bind(self), sub.bind(self)];
for (let i = 0; i < 5_000_000; i++) { table[i & 1](1); }
console.log(self.n);
export {};
