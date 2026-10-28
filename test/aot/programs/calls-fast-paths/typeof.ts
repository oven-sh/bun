// `typeof x === "function"` creates no string.
// IR+ TypeOfIs v[0-9]+ typeofType=7\b
// IR- ^ .*= TypeOf v
declare const console: any;
let n = 0;
const table: any[] = [() => 1, 1];
for (let i = 0; i < 5_000_000; i++) { if (typeof table[i & 1] === "function") n++; }
console.log(n);
export {};
