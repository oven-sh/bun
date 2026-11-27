// both names are one list: the stores of one name hit the places of the other.
const make = (n: number, d: number): number[] => { const l: number[] = []; for (let i = 0; i < n; i++) l.push(i * 1.25 + d); return l; };
const show = (l: unknown[]): string => { let s = ""; for (let i = 0; i < l.length; i++) s += (i in l ? String(l[i]) : "-") + ","; return l.length + ":" + s; };
function step(re: number[], im: number[], w: number): void { for (let k = 0; k < 16; k++) { const r = k + 16, a = re[k] - re[r] * w, b = im[k] - im[31 - k] * w; re[r] = a; im[31 - k] = b; re[k] += 1.5; } }
function run(round: number): string { const re = make(32, 0.5); if (round > 40) { re[5] = Infinity; re[26] = Infinity; } step(re, re, 1); return show(re); }
let last = "";
for (let round = 0; round < 60; round++) last = run(round);
console.log(last);
export {};
