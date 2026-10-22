// `f.call(thisArg, x)` with an unknown callee is one check and an indirect call.
// IR+ TypeTest v[0-9]+ testedType=Function\^
// IR- CallMethod v[0-9]+ \(.*\) name="call"(?!.* isFallback)
declare const console: any;
type L = (this: any, ...args: any[]) => void;
let n = 0;
const table: L[] = [function (v: number) { n += v; }, function (v: number) { n -= v; }];
const self = {};
for (let i = 0; i < 5_000_000; i++) { table[i & 1].call(self, 1); }
console.log(n);
export {};
