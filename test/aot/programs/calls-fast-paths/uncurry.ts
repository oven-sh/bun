// `Function.prototype.call.bind(f)` with a compiled function `f`.
declare const console: any;
let n = 0;
const f = function (this: any, v: number) { n += v; };
const g = function (this: any, v: number) { n -= v; };
const table: any[] = [Function.prototype.call.bind(f), Function.prototype.call.bind(g)];
const self = {};
for (let i = 0; i < 5_000_000; i++) { table[i & 1](self, 1); }
console.log(n);
export {};
