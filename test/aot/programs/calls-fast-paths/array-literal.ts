// An array literal that escapes is allocated inline.
declare const console: any;
let n = 0;
const keep: any[] = [];
for (let i = 0; i < 5_000_000; i++) { keep[i & 1] = [i, 1]; n += keep[i & 1].length; }
console.log(n);
export {};
