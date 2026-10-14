// Calling the result of `f.bind(thisArg, a)` or `f.bind(thisArg, a, b)` needs no call into the runtime.
declare const console: any;
type L = (...args: any[]) => void;
const self = { n: 0 };
function add(this: { n: number }, a: number, v: number) { this.n += v + a; }
function sub(this: { n: number }, a: number, b: number, v: number) { this.n -= v + a + b; }
const table: L[] = [add.bind(self, 3), sub.bind(self, 1, 2)];
for (let i = 0; i < 5_000_000; i++) { table[i & 1](1); }
console.log(self.n);
export {};
