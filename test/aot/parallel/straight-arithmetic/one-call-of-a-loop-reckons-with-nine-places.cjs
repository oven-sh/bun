// STATISTIC: ArraysGuardedForReads >= 2
// A method that one call of a loop alone enters reckons with elements at written places of its own list and of one or two others: the lists are asked once in the code as it stands, also where the loop joins texts or begins its turn again.
'use strict';
class Quilt {
  constructor(list) { this.patch = list || [1.5, 0, 0.25, 0, 2, 0, -0.5, 0, 1]; }
  weight() { const p = this.patch; return p[0] * p[4] + p[8] * p[2] - p[6] * p[3] - p[1] * (p[5] - p[7]); }
  seam(o) { const p = this.patch, q = o.patch; return p[0] * q[8] - p[1] * q[7] + p[2] * q[6] - p[3] * q[5] + p[4] * q[4]; }
  lay(o, into) { const p = this.patch, q = o.patch, r = into.patch; r[0] = p[0] + q[1] * 0.5; r[1] = p[1] - q[0] * 0.5; r[2] = p[2] * q[2]; r[3] = p[3] / 2 - q[4]; r[4] = p[5] + q[3] / 4; r[5] = p[4] - q[5]; r[6] = p[8] * 0.75; r[7] = q[8] - p[7]; r[8] = p[6] + q[7]; return into; }
  fold() { const p = this.patch, a = p[0], b = p[1], c = p[2]; p[0] = p[6] * 0.5; p[1] = p[7] - 1; p[2] = p[8]; p[6] = a + 1; p[7] = b * 2; p[8] = c; return this; }
  at(x, y) { const p = this.patch; return (p[0] * x + p[1] * y + p[2]) / (p[6] * x - p[7] * y + p[8]); }
}
function heaviest(quilts) { let best = -Infinity; for (const quilt of quilts) { const w = quilt.weight(); if (w > best) best = w; } return best; }
function seams(quilts) { let sum = 0; for (let i = 1; i < quilts.length; i++) sum += quilts[i].seam(quilts[i - 1]); return sum; }
function pile(quilts, into) { for (let i = 1; i < quilts.length; i++) quilts[i - 1].lay(quilts[i], into); return into.patch; }
function label(quilts) { let out = ''; for (let i = 0; i < quilts.length; i++) out += Math.round(quilts[i].at(i, 2) * 1e3) + ';'; return out; }
function folds(quilts, n) { for (let i = 0; i < n; i++) quilts[i % quilts.length].fold(); return quilts.map(q => q.patch.join()).join(' '); }
function tried(quilts) { let sum = 0, wrong = 0; for (let i = 0; i < quilts.length; i++) { try { sum += quilts[i].weight(); } catch { wrong++; } } return [sum, wrong]; }
const told = run => { try { const v = run(); return Array.isArray(v) ? v.map(x => Object.is(x, -0) ? '-0' : typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : String(x)).join() : typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : String(v); } catch (error) { return error.constructor.name; } };
const counts = () => new Quilt([1, 2, 3, 4, 5, 6, 7, 8, 9]), parts = () => new Quilt([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]);
for (let k = 0; k < 120; k++) { const all = k & 1 ? [new Quilt(), parts(), counts()] : [counts(), counts()]; heaviest(all); seams(all); pile(all, new Quilt()); label(all); folds(all, 4); tried(all); }
const odd = { hole: new Quilt([1, , 3, , 5.5, 6, 7, , 9]), short: new Quilt([1, 2, 3]), none: new Quilt([]), text: new Quilt(['1', '2', 3, '4', 5, 6, 7, 8, 9]), nan: new Quilt([NaN, 0, 0, 0, 1, 0, 0, 0, 1]), zero: new Quilt([-0, -0, -0, -0, -0, -0, -0, -0, -0]), wide: new Quilt([2 ** 31, 2 ** 40, 1, 1, 2 ** 53, 1, 1, 1, -(2 ** 31)]), view: new Quilt(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9.1])), bytes: new Quilt(new Uint8Array(9).fill(7)), gone: new Quilt([undefined, null, true, false, 5, {}, [], [6], 9]), frozen: new Quilt(Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9])), big: new Quilt([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]), record: new Quilt({ 0: 1, 4: 2, 8: 3 }), loud: new Quilt(new Proxy([9, 8, 7, 6, 5, 4, 3, 2, 1], {})) };
for (const name of Object.keys(odd)) { const all = [parts(), odd[name], counts()]; console.log(name, told(() => heaviest(all)), told(() => seams(all)), told(() => pile(all, new Quilt())), told(() => pile([parts(), counts()], odd[name])), told(() => label(all)), told(() => tried(all)), told(() => folds(all, 5))); }
const same = counts(); console.log(told(() => pile([same, same, same], same)), told(() => seams([same, same])), told(() => heaviest([null])), told(() => seams([parts(), {}])), told(() => pile([parts(), counts()], { patch: 'abc' })));
class Banner extends Quilt { get patch() { return this.rows ??= [2, 2, 2, 2, 2, 2, 2, 2, 2]; } set patch(v) { this.rows = [...v].map(x => x + 1); } weight() { return super.weight() * 2; } } console.log(told(() => heaviest([parts(), new Banner()])), told(() => seams([new Banner([1, 2, 3, 4, 5, 6, 7, 8, 9]), counts(), new Banner()])), told(() => folds([new Banner()], 2)));
const later = [counts(), counts(), counts()]; let seen = 0; Object.defineProperty(later[1].patch, 4, { get() { seen++; later[2].patch.length = 2; return 1.5; } }); console.log(told(() => heaviest(later)), seen, told(() => tried(later)));
