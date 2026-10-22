// `f.apply(this, arguments)`: the `arguments` object is allocated only on the slow path.
// IR+ TypeTest v[0-9]+ testedType=Function\^
declare const console: any;
type L = (...args: any[]) => void;
let n = 0;
function add(v: number) { n += v; }
const table: L[] = [function (this: any) { add.apply(this, arguments as any); }, function (this: any) { add.apply(this, arguments as any); }];
for (let i = 0; i < 5_000_000; i++) { table[i & 1](1); }
console.log(n);
export {};
