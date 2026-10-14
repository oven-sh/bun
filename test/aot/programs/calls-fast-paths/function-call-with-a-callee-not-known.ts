// `f.call(thisArg, x)`, callee not known: one guard, then an indirect call.
// IR+ IsBuiltinFunction v[0-9]+ Function.call
// IR- CallMethod v[0-9]+ "call"
declare const console: any;
type L = (this: any, ...args: any[]) => void;
let n = 0;
const table: L[] = [function (v: number) { n += v; }, function (v: number) { n -= v; }];
const self = {};
for (let i = 0; i < 5_000_000; i++) { table[i & 1].call(self, 1); }
console.log(n);
export {};
