// An empty loop: the baseline to subtract from the other programs that have such a loop.
declare const console: any;
let n = 0;
const table: number[] = [1, -1];
for (let i = 0; i < 5_000_000; i++) { n += table[i & 1]; }
console.log(n);
export {};
