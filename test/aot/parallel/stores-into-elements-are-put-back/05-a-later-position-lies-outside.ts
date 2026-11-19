// the second store of a turn lies outside its list and lengthens it.
const make = (n: number, d: number): number[] => { const l: number[] = []; for (let i = 0; i < n; i++) l.push(i * 1.25 + d); return l; };
const show = (l: unknown[]): string => { let s = ""; for (let i = 0; i < l.length; i++) s += (i in l ? String(l[i]) : "-") + ","; return l.length + ":" + s; };
function step(re: number[], im: number[], far: number): void { for (let k = 0; k < 16; k++) { const r = k + 16; re[r] = re[k] - re[r]; im[r + (k === 9 ? far : 0)] = im[k] + re[r]; re[k] += 1.5; } }
function run(round: number): string { const re = make(32, 0.5), im = make(32, 0.25); step(re, im, round > 40 ? 12 : 0); return show(re) + show(im); }
let last = "";
for (let round = 0; round < 60; round++) last = run(round);
console.log(last);
export {};
