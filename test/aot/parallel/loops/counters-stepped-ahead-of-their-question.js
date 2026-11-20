// The step of a counter stands in front of the test that ends the loop, or is a part of it: i--, --i, i-- > 0, i++ < n, n - 2 steps at a time. Lists of every kind, starts that are whole, fractions, below zero, texts, too great; the counter is read behind the loop.
'use strict';
function downTo(list, i) { let sum = 0; while (i--) sum += list[i]; return [sum, i]; }
function downAbove(list, i) { let sum = 0; while (i-- > 0) sum += list[i] * 2; return [sum, i]; }
function downFirst(list, i) { let sum = 0; while (--i >= 0) sum -= list[i]; return [sum, i]; }
function upWhile(list, n) { let sum = 0, i = -1; while (++i < n) sum += list[i]; return [sum, i]; }
function upAfter(list, n) { let sum = 0, i = 0; while (i++ < n) sum += list[i - 1]; return [sum, i]; }
function insideStep(list, i) { let sum = 0; while (i) sum += list[--i]; return [sum, i]; }
function byTwos(list, i) { let sum = 0; for (; (i -= 2) >= 0;) sum += list[i]; return [sum, i]; }
function marked(list, i, stop) { let seen = 0; do { if (list[i] === stop) break; seen++; } while (i-- > 0 && seen < 50); return [seen, i]; }
function stored(list, i, v) { while (i--) list[i] = v * i; return [list.length, i]; }
function both(list, from, i) { let sum = 0; while (i-- > from++) sum += list[i] - list[from - 1]; return [sum, i, from]; }
function shrinking(list) { let i = list.length, sum = 0; while (i-- > 0) { sum += list[i]; if (sum > 20 && list.length > i + 2) list.length = i + 1; } return [sum, i, list.length]; }
const told = run => { try { return run().map(v => Object.is(v, -0) ? '-0' : typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : String(v)).join('/'); } catch (error) { return error.constructor.name; } };
const makers = { whole: () => [5, 1, 4, 2, 3, 9, 8], parts: () => [0.5, 1.5, -2.25, 8, 3.75, 6.5], none: () => [], one: () => [3], holes: () => [1, , 3, , 5], texts: () => [1, 'b', 3], gone: () => [2, undefined, null, true, 7], bytes: () => new Uint8Array([9, 8, 7, 6, 5]), reals: () => new Float64Array([0.1, 0.2, 0.3]), record: () => ({ 0: 1, 1: 2, 2: 3, length: 3 }), frozen: () => Object.freeze([4, 5, 6]), big: () => [1n, 2n, 3n] };
const uses = { downTo, downAbove, downFirst, upWhile, upAfter, insideStep, byTwos, stored: (l, n) => stored(l, n, 0.5), both: (l, n) => both(l, 0, n), marked: (l, n) => marked(l, n - 1, 3) };
for (let k = 0; k < 120; k++) for (const name of Object.keys(uses)) uses[name](k & 1 ? makers.whole() : makers.parts(), 5);
for (const name of Object.keys(makers)) console.log(name, Object.keys(uses).map(use => told(() => { const list = makers[name](); return uses[use](list, list.length); })).join(' '));
const starts = [0, 1, 3, 6, 2.0, -0];
console.log(starts.map(n => Object.keys(uses).map(use => told(() => uses[use](makers.whole(), n))).join(' ')).join('\n'));
const odd = [2.5, '4', null, undefined, NaN, true, { valueOf() { return 3; } }, [2], -3, -1];
console.log(odd.map(n => ['downAbove', 'downFirst', 'upWhile', 'upAfter', 'byTwos', 'both'].map(use => told(() => uses[use](makers.whole(), n))).join(' ')).join('\n'));
console.log(told(() => downAbove(makers.whole(), 4n)), told(() => upAfter(makers.whole(), 3n)), told(() => downAbove(makers.whole(), Symbol())), told(() => downAbove(null, 2)), told(() => downAbove(undefined, 0)));
console.log(told(() => shrinking([1, 2, 3, 4, 5, 6, 7, 8, 9])), told(() => shrinking([0.5, 30, 2, 2])), told(() => shrinking([])));
let asked = 0; const edge = { valueOf() { asked++; return 4 - (asked >> 1); } }; console.log(told(() => upWhile([1, 2, 3, 4, 5], edge)), asked, told(() => upAfter([1, 2, 3, 4, 5], edge)), asked);
const loud = []; console.log(told(() => downTo(new Proxy([3, 4, 5], { get(o, k) { loud.push(String(k)); return o[k]; } }), 3)), loud.join());
function nested(rows) { let out = 0, r = rows.length; while (r--) { const row = rows[r]; let c = row.length; while (c-- > 0) out += row[c] * (r + 1); } return [out, r]; }
for (let k = 0; k < 60; k++) nested([[1, 2, 3], [4, 5], [6.5]]); console.log(told(() => nested([[1, 2, 3], [], [0.25, 4], [, 2]])), told(() => nested([])), told(() => nested([[1], null])), told(() => nested([[1], 'ab'])));
let shared = 6; function outside(list) { let sum = 0; while (shared--) { sum += list[shared]; if (shared === 3) shared--; } return [sum, shared]; } console.log(told(() => outside([1, 2, 3, 4, 5, 6])));
class Deck { constructor(cards) { this.cards = cards; this.at = cards.length; } get left() { return this.at; } deal(n) { let sum = 0; while (n-- > 0 && this.at-- > 0) sum += this.cards[this.at]; return [sum, n, this.at]; } }
const deck = new Deck([2, 4, 6, 8, 10]); for (const n of [1, 2, 0, 5, 1]) console.log(told(() => deck.deal(n)), deck.left);
