// a helper that is copied in line adds to what its list holds, three stores; the third would store NaN: the first two are put back, or the turn as written would add twice.
function acc(out: number[], a: number[]): number[] { out[0] = out[0] + a[0]; out[1] = out[1] + a[1]; out[2] = out[2] + a[2]; return out; }
function dot(a: number[], b: number[]): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
const o: number[] = [0.5, 1.75, 3.5], p: number[] = [1.5, 2.5, 3.5], q: number[] = [0.5, 0.25, 4.5];
function f(t: number): number { o[0] = 0.5; o[1] = 1.75; o[2] = t === 41 ? -Infinity : 3.5; p[2] = t === 41 ? Infinity : 3.5; let s = t & 1; for (let i = 0; i < 100; i++) { acc(o, p); s += dot(o, q); } return o[0] * 1000 + o[1]; }
let all = "";
for (let t = 0; t < 60; t++) { const said = f(t); if (t >= 40 && t <= 42) all += said + "|"; }
console.log(all);
export {};
