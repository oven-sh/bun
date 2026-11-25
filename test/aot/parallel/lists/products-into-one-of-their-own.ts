// Elements that do not change within an inner loop, read beside a store of the outer one into the same list: every pair of the three lists one, rows one apart, views over one buffer.
type Numbers = number[];
function matrices(p: Numbers, q: Numbers, t: Numbers): number { for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; } return t[5]; }
function rows(p: Numbers, q: Numbers, t: Numbers, n: number): number { for (let c = 0; c < n; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[k] * q[k + c]; t[c] = s; } return t[n - 1]; }
function weighted(p: Numbers, t: Numbers, n: number): number { for (let c = 1; c < n; c++) { for (let k = 0; k < 3; k++) t[c] += p[k + 1] * (c + k); } return t[1]; }
function scaled(p: Numbers, t: Numbers, at: number): number { for (let c = 0; c < t.length; c++) { let s = 1; for (let k = 0; k < 2; k++) s *= p[at + k]; t[c] = t[c] * 0.5 + s; } return t[at]; }
function bounded(p: Numbers, t: Numbers): number { let steps = 0; for (let c = 0; c < t.length; c++) { for (let k = 0; k < p[2]; k++) { steps++; if (steps > 400) return steps; } t[c] = c + 1; } return steps; }
function ofViews(p: Float64Array, q: Float64Array, t: Float64Array): number { for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; } return t[5]; }
const kinds: (() => Numbers)[] = [
  () => JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5,10.5,11.5,12.5,13.5,14.5,15.5,16.5,17.5,18.5,19.5]"), () => JSON.parse("[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]"),
  () => { const list: Numbers = []; for (let i = 0; i < 20; i++) list.push(i & 1 ? i : i / 4); return list; }, () => { const list = new Array(20).fill(1); (list as unknown[])[19] = "x"; return list; },
];
const text = (list: ArrayLike<number>) => Array.from(list, value => (Object.is(value, -0) ? "-0" : String(value))).join();
for (let times = 0; times < 2; times++) {
  for (const make of kinds) {
    for (let same = 0; same < 5; same++) {
      const p = make(), q = same === 1 || same === 4 ? p : make(), t = same === 2 || same === 4 ? p : same === 3 ? q : make();
      console.log(same, matrices(p, q, t), text(t)); console.log(rows(p, q, t, 8), text(t)); console.log(weighted(p, t, 6), text(t)); console.log(scaled(p, t, 3), text(t)); console.log(bounded(p, t), text(t));
    }
  }
  for (const offset of [0, 8, 32, 64]) {
    const buffer = new ArrayBuffer(512), p = new Float64Array(buffer, 0, 16), q = new Float64Array(buffer, offset, 16), t = new Float64Array(buffer, 2 * offset, 16);
    for (let i = 0; i < 64; i++) new Float64Array(buffer)[i] = i * 0.25 - 2;
    console.log(offset, ofViews(p, q, t), text(t)); console.log(ofViews(p, p, p), text(p)); console.log(ofViews(q, p, q), text(q));
  }
}
