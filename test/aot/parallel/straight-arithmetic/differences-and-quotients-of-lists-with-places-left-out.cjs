// STATISTIC: StraightArmHoleChecksRemoved >= 1
// Straight arithmetic over small lists of fractions: a product, a difference and a quotient take NaN for a place that was left out, so nothing asks for it where that is all that is done; a sum that may join texts, a comparison and a store ask.
'use strict';
function slope(p) { return (p[3] - p[1]) / (p[2] - p[0]) - (p[7] - p[5]) / (p[6] - p[4]); }
function shade(p) { const a = p[0] * p[5] - p[1] * p[4], b = p[2] * p[7] - p[3] * p[6], c = p[1] * p[6] - p[2] * p[5]; return a * b - b * c - c * a; }
function handed(p, k) { return [p[0] * k - p[1], p[2] * k - p[3], p[4] / k - p[5], p[6] / k - p[7]]; }
function added(p) { return p[0] + p[1] + p[2] - p[3] * p[4]; }
function kept(p, q) { q[0] = p[1]; q[1] = p[0] * p[2]; q[2] = p[3] - p[2]; return q[0] === undefined ? 'none' : q[1] - q[2]; }
function asked(p) { return p[0] * p[1] > p[2] - p[3] ? p[4] * 2 : p[4] === undefined ? 'gone' : p[5] / 2; }
function bits(p) { return (p[0] * p[1] | 0) ^ (p[2] - p[3]) ^ ~~(p[4] / p[5]); }
function negated(p) { const a = -p[0], b = -p[1]; return a * b - +p[2] - (p[3] - 0) * 1; }
function loops(rows, n) { let sum = 0, odd = 0; for (let i = 0; i < n; i++) { const v = slope(rows[i % rows.length]) - shade(rows[(i + 1) % rows.length]); if (v === v) sum += v; else odd++; } return sum + ' ' + odd; }
const make = (...gone) => { const list = [0.5, 1.25, 2.75, 4.5, 7.125, 9.25, 12.5, 16.75]; for (const at of gone) delete list[at]; return list; };
const short = n => { const list = make(); list.length = n; return list; }, lists = { whole: make(), first: make(0), last: make(7), middle: make(3, 4), all: make(0, 1, 2, 3, 4, 5, 6, 7), short: short(5), empty: [], counts: [1, 2, 3, 5, 8, 13, 21, 34], gaps: [1, , 3, , 5, , 7, ,], zero: [-0, 0, -0, 0, 0, -0, 0, -0], nan: [NaN, 1, 2, NaN, 3, 4, 5, 6], undefined: [undefined, 1.5, null, 2.5, true, 3.5, '4', 5.5], far: Object.assign(make(), { 900: 1 }), view: new Float64Array(make()), heir: Object.setPrototypeOf(make(2, 5), { __proto__: Array.prototype, 2: 100, 5: 0.25 }), big: [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n] };
const uses = { slope, shade, handed: p => handed(p, 4), added, kept: p => kept(p, []), asked, bits, negated };
const show = v => Array.isArray(v) ? v.map(show).join(',') : typeof v === 'number' ? (Object.is(v, -0) ? '-0' : String(Math.round(v * 1e9) / 1e9)) : typeof v + ' ' + String(v), told = run => { try { return show(run()); } catch (error) { return error.constructor.name; } };
for (let k = 0; k < 120; k++) for (const use of Object.keys(uses)) uses[use](k % 3 ? lists.whole : make(k % 8));
for (const name of Object.keys(lists)) console.log(name, Object.keys(uses).map(use => told(() => uses[use](lists[name]))).join(' | '));
for (let k = 0; k < 30; k++) loops([lists.whole, make(k % 8), lists.far], 12); console.log(loops([lists.whole, lists.first, lists.middle], 30), loops([lists.gaps], 9), told(() => loops([lists.whole, lists.big], 4)), told(() => loops([lists.whole, null], 4)));
for (const k of [0, -0, NaN, '2', undefined, null, Infinity, { valueOf: () => 8 }, 2n, [4]]) console.log(told(() => handed(lists.whole, k)), told(() => handed(lists.middle, k)));
const frozen = Object.freeze([0, 0, 0]); console.log(told(() => kept(lists.whole, frozen)), told(() => kept(lists.first, lists.first)), told(() => kept(null, [])), told(() => slope(undefined)));
const proxy = []; console.log(told(() => shade(new Proxy(make(1), { get(o, k) { proxy.push(String(k)); return o[k]; } }))), proxy.join('')); let turned = 0; console.log(told(() => added(Object.defineProperty(make(0), 0, { get() { turned++; return 'text'; } }))), turned);
