// what a place held is known from the program's own read: a swap, and behind it a store that would be NaN.
const make = (n: number, d: number): number[] => { const l: number[] = []; for (let i = 0; i < n; i++) l.push(i * 1.25 + d); return l; };
const show = (l: unknown[]): string => { let s = ""; for (let i = 0; i < l.length; i++) s += (i in l ? String(l[i]) : "-") + ","; return l.length + ":" + s; };
function step(re: number[], im: number[]): void { for (let k = 0; k < 16; k++) { const r = 31 - k, x = re[k]; re[k] = re[r]; re[r] = x; im[k] = im[k] - im[r]; } }
function run(round: number): string { const re = make(32, 0.5), im = make(32, 0.25); if (round > 40) { im[5] = Infinity; im[26] = Infinity; } step(re, im); return show(re) + show(im); }
let last = "";
for (let round = 0; round < 60; round++) last = run(round);
console.log(last);
export {};
