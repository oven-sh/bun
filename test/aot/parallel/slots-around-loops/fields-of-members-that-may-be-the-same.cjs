'use strict';
// A turn adds to fields of one object and of another of its class; both may be the same one, so what is added to is read where it is written, once in a turn.
class Spot { constructor(a, b, c) { this.a = a; this.b = b; this.c = c; this.hits = 0; } }
function pull(spots, at, by) { const one = spots[at]; for (let i = 0; i < spots.length; i++) { const two = spots[i]; one.a += two.b; two.b += one.c; one.c -= two.hits; two.hits += by; } return one.a + one.c; }
function trade(one, two, n) { for (let i = 0; i < n; i++) { one.a -= 1; two.a += 2; one.b += two.a; two.c = one.a - two.b; } return [one.a, one.b, one.c, two.a, two.b, two.c].join(); }
const make = n => Array.from({ length: n }, (_, i) => new Spot(i, i * .5, 10 - i));
for (let k = 0; k < 100; k++) { pull(make(8), k % 8, .5); trade(make(2)[0], make(2)[1], 5); }
const show = s => s.map(p => [p.a, p.b, p.c, p.hits].join('/')).join(' ');
for (const n of [1, 2, 5]) for (let at = 0; at < n; at++) { const s = make(n); console.log(n, at, pull(s, at, .25), show(s)); }
const same = new Spot(1, 2, 3); console.log(trade(same, same, 4), trade(same, new Spot(0, 0, 0), 3));
const twice = make(3); twice[2] = twice[0]; console.log(pull(twice, 0, 1), show(twice), pull([twice[1], twice[1]], 1, 2), show(twice));
const heavy = new Spot(1, 1, 1); Object.defineProperty(heavy, 'a', { get() { return this.hits * 2; }, set(v) { this.hits += v > 0 ? 1 : 0; } }); console.log(pull([same, heavy], 0, 1), pull([heavy, same], 0, 1), show([same]), heavy.hits);
console.log(trade({ a: 1, b: '2', c: 3 }, same, 2), trade(same, { a: '5', b: 1, c: 2 }, 2), pull([same, { a: 1, b: 2, c: 3, hits: 4 }], 0, 1), show([same]));
