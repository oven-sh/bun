// `Array.prototype.sort` with a compiled comparator.
declare const console: any;
const a: number[] = []; for (let i = 0; i < 200_000; i++) a.push((i * 7919) % 200_003);
let n = 0;
a.sort((x, y) => { n++; return x - y; });
console.log(a[0], a[199_999], n > 0);
export {};
