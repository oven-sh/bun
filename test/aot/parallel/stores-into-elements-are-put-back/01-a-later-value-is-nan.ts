// the second store of a turn would store NaN: the first is put back and the turn runs as written.
const make = (n: number, d: number): number[] => { const l: number[] = []; for (let i = 0; i < n; i++) l.push(i * 1.25 + d); return l; };
const show = (l: unknown[]): string => { let s = ""; for (let i = 0; i < l.length; i++) s += (i in l ? String(l[i]) : "-") + ","; return l.length + ":" + s; };
function step(re: number[], im: number[], w: number): void { for (let k = 0; k < 16; k++) { const r = k + 16, a = re[k] - re[r] * w, b = im[k] - im[r] * w; re[r] = a; im[r] = b; re[k] += 1.5; im[k] += 0.5; } }
function run(round: number): string { const re = make(32, 0.5), im = make(32, 0.25); if (round > 40) { im[5] = Infinity; im[21] = Infinity; } step(re, im, 1); return show(re) + show(im); }
let last = "";
for (let round = 0; round < 60; round++) last = run(round);
console.log(last);
export {};
