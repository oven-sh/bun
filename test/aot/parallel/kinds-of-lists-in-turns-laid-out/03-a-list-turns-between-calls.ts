// a list turns between calls.
function dot(a: any, w: any, m: number): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * w[(i * 7) & m]; return s; }
const make = (n: number, d: number): any => { const l: any[] = []; for (let i = 0; i < n; i++) l.push(i + d); return l; };
const a = make(50, 0), w = make(64, 0);
function run(r: number): string { if (r === 20) w[5] = 0.5; if (r === 40) { w[5] = 5; a[3] = 1.5; } return String(dot(a, w, 63)); }
let last = "";
for (let r = 0; r < 60; r++) { try { last = run(r); } catch (e) { last = (e as Error).name; } }
console.log(last);
export {};
