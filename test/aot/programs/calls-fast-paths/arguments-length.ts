// `arguments.length` needs no `arguments` object.
// IR- Create\w+Arguments
declare const console: any;
type L = (...args: any[]) => void;
let n = 0;
const table: L[] = [function () { n += arguments.length; }, function () { n -= arguments.length; }];
for (let i = 0; i < 5_000_000; i++) { table[i & 1](1); }
console.log(n);
export {};
