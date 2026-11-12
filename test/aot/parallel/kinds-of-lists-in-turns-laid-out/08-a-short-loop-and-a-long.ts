// a short loop and a long.
function dot(a: any, w: any, m: number): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * w[(i * 7) & m]; return s; }
const make = (n: number, d: number): any => { const l: any[] = []; for (let i = 0; i < n; i++) l.push(i + d); return l; };
const w = make(64, 0.25);
function run(r: number): string { let s = ""; for (const n of [0, 1, 7, 8, 9, 17, 100]) s += dot(make(n, r & 1 ? 0 : 0.5), w, 63) + ","; return s; }
let last = "";
for (let r = 0; r < 60; r++) { try { last = run(r); } catch (e) { last = (e as Error).name; } }
console.log(last);
export {};
