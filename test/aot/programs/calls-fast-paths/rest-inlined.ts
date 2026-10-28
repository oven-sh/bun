// A rest parameter of an inlined function that is only used for `.length` and `[index]` needs no array.
// IR- ^ .*NewArray
declare const console: any;
function count(...v: number[]) { return v.length + v[0] + (v[5] === undefined ? 1 : 0); }
let n = 0;
for (let i = 0; i < 5_000_000; i++) { n += count(i & 1, 2); }
console.log(n);
export {};
