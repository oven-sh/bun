// a hole in the other.
function dot(a: any, w: any, m: number): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * w[(i * 7) & m]; return s; }
const make = (n: number, d: number): any => { const l: any[] = []; for (let i = 0; i < n; i++) l.push(i + d); return l; };
const a = make(50, 0.5), w = make(64, 0);
function run(r: number): string { if (r === 30) delete w[21]; return String(dot(a, w, 63)); }
let last = "";
for (let r = 0; r < 60; r++) { try { last = run(r); } catch (e) { last = (e as Error).name; } }
console.log(last);
export {};
