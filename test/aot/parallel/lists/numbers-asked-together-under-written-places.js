// STATISTIC: ArraysGuardedForReads >= 6
// Outside loops, three and more numbers of one list are read under written places in a row: the list is asked once for all of them. Lists of whole numbers, of fractions and of both, short, long, with holes, changed between two reads; factors of every kind beside them.
'use strict';
function fare(trip) { return trip[0] + trip[1] * trip[2] - trip[3] / 4; }
function span(trip) { const a = trip[5], b = trip[1], c = trip[4]; return (a - b) * (a - c) + (b - c); }
function toll(trip, rate) { return trip[0] * rate + trip[2] * 2 - trip[4] * rate; }
function heavier(trip, other) { return trip[1] * other[2] - trip[2] * other[1] + trip[3] * other[0]; }
function settled(trip, book) { book.low = trip[0] - trip[1]; book.high = trip[2] * trip[3]; book.mean = (trip[0] + trip[1] + trip[2] + trip[3]) / 4; return book.low + book.high * book.mean; }
function between(trip, step) { const a = trip[0] * 2, b = trip[1] - a; step(trip); return a + b * trip[2] + trip[3] - trip[0]; }
function parted(trip, way) { if (way) return trip[1] + trip[2] + trip[3] * 0.5; return trip[3] - trip[2] * trip[0] - trip[1]; }
function written(trip) { trip[0] = trip[1] + trip[2]; trip[1] = trip[0] * trip[3]; trip[2] = trip[1] - trip[0]; return trip[0] - trip[1] + trip[2]; }
const show = x => typeof x === 'number' ? (Object.is(x, -0) ? '-0' : x !== x ? 'NaN' : String(Math.round(x * 1e6) / 1e6)) : typeof x === 'bigint' ? x + 'n' : typeof x === 'object' && x ? 'object' : typeof x + ' ' + String(x);
const told = run => { try { return show(run()); } catch (error) { return error.constructor.name; } };
const whole = () => [7, 3, 9, 4, 1, 8], parts = () => [1.5, -2.25, 0.5, 8.75, 3.125, 6.5], none = () => {};
function holed(at) { const list = whole(); delete list[at]; return list; }
function grown() { const list = []; list[9] = 1; for (let i = 0; i < 9; i++) list[i] = i / 2 - 1; return list; }
function kept(list, at, v) { list[at] = v; return list; }
const makers = { whole, parts, grown, short: () => [2, 4], empty: () => [], hole: () => holed(2), gap: () => holed(0), far: () => kept(whole(), 2000, 5), zero: () => [-0, 0, -0, -0, 0, -0], wide: () => [2 ** 31, 2 ** 40, -(2 ** 31), 2 ** 53, 1, -1], nan: () => kept(parts(), 1, NaN), mixed: () => [1, 2.5, 3, 4.5, 5, 6.5], text: () => kept(whole(), 3, '12'), gone: () => kept(parts(), 2, undefined), big: () => [1n, 2n, 3n, 4n, 5n, 6n], object: () => kept(whole(), 1, { valueOf() { return 10; } }), view: () => new Float32Array([1, 2, 3, 4, 5, 6]), bytes: () => new Uint8ClampedArray([1, 300, 3, 4, 5, 6]), record: () => ({ 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 }), letters: () => '123456', frozen: () => Object.freeze(whole()), nested: () => kept([[]], 4, [3]) };
for (let k = 0; k < 200; k++) { const a = k & 1 ? whole() : parts(); fare(a); span(a); toll(a, k / 4); heavier(a, parts()); settled(a, { low: 0, high: 0, mean: 0 }); between(a, none); parted(a, k % 3); written(a); }
const uses = { fare: a => fare(a), span: a => span(a), toll: a => toll(a, 0.25), heavier: a => heavier(a, whole()), other: a => heavier(parts(), a), settled: a => settled(a, {}), between: a => between(a, none), one: a => parted(a, 1), two: a => parted(a, 0), written: a => written(a) };
for (const name of Object.keys(makers)) console.log(name, Object.keys(uses).map(use => told(() => uses[use](makers[name]()))).join(' '));
const rates = [2, -0, NaN, Infinity, 1e308, '3', 'x', null, undefined, true, 4n, Symbol.iterator, [], [2], {}, { valueOf() { return 6; } }];
console.log(rates.map(rate => told(() => toll(whole(), rate)) + '/' + told(() => toll(parts(), rate))).join(' '));
const order = []; console.log(told(() => toll(whole(), { valueOf() { order.push('rate'); if (order.length > 1) throw new RangeError('twice'); return 3; } })), order.join());
const changes = { drop: t => { t.length = 2; }, push: t => { t.push(99); }, real: t => { t[2] = 0.5; }, word: t => { t[3] = 'w'; }, empty: t => { delete t[0]; }, swap: t => { t.reverse(); }, lock: t => { Object.freeze(t); }, name: t => { t.extra = 1; }, getter: t => { Object.defineProperty(t, 2, { get: () => 1000 }); }, heir: t => { Object.setPrototypeOf(t, { __proto__: Array.prototype, 3: 41 }); } };
for (const name of Object.keys(changes)) console.log(name, told(() => between(whole(), changes[name])), told(() => between(parts(), changes[name])));
console.log(told(() => fare(null)), told(() => span(undefined)), told(() => written(Object.freeze(whole()))), told(() => settled(whole(), Object.freeze({ low: 0, high: 0, mean: 0 }))), told(() => fare(new Proxy(whole(), { get: (o, k) => (order.push(k), o[k]) }))), order.join());
class Trip extends Array { get cost() { return fare(this) + toll(this, 3); } }
console.log(told(() => Trip.from([4, 5, 6, 7, 8]).cost), told(() => Trip.of(0.5, 1.5, 2.5, 3.5, 4.5).cost), told(() => new Trip(6).cost));
