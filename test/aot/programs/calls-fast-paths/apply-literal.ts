// `f.apply(thisArg, [a, b])`: the array is allocated only on the slow path.
// IR+ TypeTest v[0-9]+ testedType=Function\^
// IR- ^ .*overload=FunctionPrototypeApply/
declare const console: any;
type L = (this: any, ...args: any[]) => void;
let n = 0;
const table: L[] = [function (a: number, b: number) { n += a + b; }, function (a: number, b: number) { n -= a + b; }];
const self = {};
for (let i = 0; i < 5_000_000; i++) { table[i & 1].apply(self, [i, 1]); }
console.log(n);
export {};
