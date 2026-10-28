// `f.apply(thisArg, array)` with an unknown callee and array passes the elements without an intermediate copy.
// IR+ TypeTest v[0-9]+ testedType=Function\^
// IR+ CallBuiltin v[0-9]+ \(v[0-9]+, v[0-9]+\) overload=FunctionPrototypeApply/
// IR- CallMethod v[0-9]+ \(.*\) name="apply"(?!.* isFallback)
declare const console: any;
type L = (this: any, ...args: any[]) => void;
let n = 0;
const table: L[] = [function (v: number) { n += v; }, function (v: number) { n -= v; }];
const self = {};
const lists: any[][] = [[1], [1]];
for (let i = 0; i < 5_000_000; i++) { table[i & 1].apply(self, lists[i & 1]); }
console.log(n);
export {};
