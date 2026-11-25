'use strict';
// STATISTIC: ArraysGuardedForReads >= 8
// Straight code reckons with the elements of one list under constant indices beside numbers that it knows: the list is asked once, in front of its reads. Lists of fractions, of whole numbers, with holes, of other values, short ones, frozen ones, views, records and texts.
function slope(m, i) { const t = i * .125; return m[0] + t * (m[1] + t * (m[2] + t * (m[3] + t * m[4]))); }
function waves(m, i) { const a = i + .5, b = i * .25; return a * m[0] - b * m[1] + a * m[2] - b * m[3] + a * m[4] - b * m[5]; }
function apart(m, i) { const a = i * .5 + 1; return (m[0] - a) * (m[0] - a) + (m[1] - a) * (m[1] - a) + (m[2] - a) * (m[2] - a) + (m[3] - a) * (m[3] - a); }
function halves(m, i) { const k = 1 / (i + 2); return (m[0] + m[1]) * k + (m[2] + m[3]) * k * k + (m[4] + m[5]) * k * k * k; }
function backwards(m, i) { const s = .75 - i; return m[5] * s + m[4] * s * s - m[3] / (s + 9) + m[2] * s - m[1] * s + m[0]; }
class Spot {
  constructor(k) { this.near = k + .5; this.far = k * 2.5; this.sum = 0; }
  take(m) { const n = this.near, f = this.far; this.sum = m[0] * n + m[1] * f + m[2] * n * f - m[3] * n; this.near = m[4] * n - m[5] * f; return this; }
  side(m) { const n = this.near; return m[1] * n - m[3] * n + m[5] * n - m[0] * n + m[2] * n; }
}
function loops(m, n) { let best = -Infinity; for (let i = 0; i < n; i++) { const x = i * .5, y = i + .25; const v = m[0] * x + m[1] * y + m[2] * x * y + m[3] + (m[4] * x - m[5] * y); if (v > best) best = v; } return best; }
function grown(m, i) { const t = i + 1.5; const v = m[0] * t + m[1] * t + m[2] * t + m[3] * t; m.push(v); return v + m[4] * t + m[5] * t + m.length; }
const numbers = [() => [.5, 1.5, -2.25, 3, 4.5, 8], () => [1, 2, 3, 4, 5, 6], () => [1, 2], () => [], () => [.25, 1], () => [2147483647, -2147483648, 1e9, -0, NaN, Infinity], () => [1, 2, 3, 4, 5.5, 6, 7, 8]];
function slopeOf(m, t) { return m[0] + t * (m[1] + t * (m[2] + t * (m[3] + t * m[4]))); }
function wavesOf(m, a, b) { return a * m[0] - b * m[1] + a * m[2] - b * m[3] + a * m[4] - b * m[5]; }
function apartOf(m, a) { return (m[0] - a) * (m[0] - a) + (m[1] - a) * (m[1] - a) + (m[2] - a) * (m[2] - a); }
function halvesOf(m, k) { return (m[0] + m[1]) * k + (m[2] + m[3]) * k * k + (m[4] + m[5]) * k; }
function backwardsOf(m, s) { return m[5] * s + m[4] * s * s - m[3] / (s + 9) + m[2] * s - m[1] * s + m[0]; }
class Known {
  constructor(list, k) { this.list = list; this.near = k + .5; this.far = k * 2.5; this.sum = 0; }
  take() { const m = this.list, n = this.near, f = this.far; this.sum = m[0] * n + m[1] * f + m[2] * n * f - m[3] * n; this.near = m[4] * n - m[5] * f; return this; }
  side() { const m = this.list, n = this.near; return m[1] * n - m[3] * n + m[5] * n - m[0] * n + m[2] * n; }
  both(p, q) { const m = this.list; return m[0] * p + m[1] * q + m[2] * (p - q) + (m[3] * q - m[4] * p); }
}
function tallied(m, t) { const v = m[0] * t - m[1] * t - m[2] / t; m[3] = v; return v + m[0] * 2 - m[1] * 3 - m[2] * 4; }
const made = [() => [.5, 1.5, -2.25, 3, 4.5, 8], () => [1, 2, 3, 4, 5, 6], () => [1, , 3, 4, 5, 6], () => [.5, 1.5, , 2.5, 3, 4], () => [1, 'x', 3, 4, null, 6], () => [1, '2', true, undefined, [3], { valueOf: () => 2 }], () => [1, 2], () => [], () => Object.freeze([1.5, 2.5, 3.5, 4.5, 5.5, 6.5]), () => new Float64Array([1, 2.5, 3, 4, 5, 6]), () => new Uint8Array([1, 2, 3, 4, 5, 250]), () => [2147483647, -2147483648, 1e9, -0, NaN, Infinity], () => ({ 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, push() { return 1; }, length: 7 }), () => 'abcdef', () => '123456', () => null, () => [1n, 2n, 3n, 4n, 5n, 6n]];
const show = x => Object.is(x, -0) ? '-0' : String(x);
for (let round = 0; round < 4; round++) made.forEach((make, at) => {
  const said = [];
  for (const f of [() => slope(make(), round), () => waves(make(), round), () => apart(make(), round), () => halves(make(), round), () => backwards(make(), round), () => { const s = new Spot(round).take(make()).take(make()); return show(s.near) + ':' + show(s.sum) + ':' + show(s.side(make())); }, () => loops(make(), 5), () => grown(make(), round), () => { const m = make(); return grown(m, 1) + grown(m, 2); }]) {
    try { said.push(show(f())); } catch (e) { said.push(e.constructor.name); }
  }
  console.log(round, at, said.join(' '));
});
for (let round = 0; round < 4; round++) numbers.forEach((make, at) => {
  const t = round * .75 + 1, said = [slopeOf(make(), t), wavesOf(make(), t, t + 2), apartOf(make(), t), halvesOf(make(), 1 / t), backwardsOf(make(), t - 2), tallied(make(), t)];
  const k = new Known(make(), round).take().take();
  said.push(k.near, k.sum, k.side(), k.both(t, 3.5), slopeOf(Object.freeze(make()), round), wavesOf(make(), round, at));
  console.log('known', round, at, said.map(show).join(' '));
});
