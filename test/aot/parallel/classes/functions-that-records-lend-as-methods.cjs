// Declared functions store into `this` and construct nothing: each is laid under the name of a method, on exports, in a literal, behind a getter, on a prototype. What runs them is whatever the method is called on.
'use strict';
function setPlace(x, y) { this.x = x; this.y = y; this.moves = (this.moves || 0) + 1; return this; }
function stepBy(dx, dy) { this.x += dx; this.y += dy; if (this.trail) this.trail.push(this.x); return this.moves; }
function reset() { this.x = this.y = 0; this.trail = []; this.kept = null; return this; }
function keep(value) { this.kept = value; this.size = this.size === undefined ? 1 : this.size + 1; return this.kept; }
function named(word) { this.word = word; return `${word}:${typeof this.x}`; }
function both() { if (new.target) return; this.twice = (this.twice || 0) + 2; return this.twice; }
exports.setPlace = setPlace; exports.lent = { setPlace, stepBy, keep: keep, reset, get named() { return named; } }; module.exports.both = both;
class Boat { constructor(name) { this.name = name; this.x = 1; this.y = 1; this.trail = []; } where() { return [this.x, this.y, this.trail.length, this.moves].join(); } }
Boat.prototype.setPlace = setPlace; Boat.prototype.stepBy = stepBy; Boat.prototype.reset = reset; Object.assign(Boat.prototype, { keep, both });
function Cart(x) { this.x = x; this.y = -x; } Cart.prototype = { constructor: Cart, setPlace: setPlace, stepBy, named, where() { return this.x + '/' + this.y + '/' + this.moves; } };
const kite = { x: 0.5, y: 0.25, setPlace, stepBy, keep, where() { return JSON.stringify(this); } }, told = run => { try { return String(run()); } catch (error) { return error.constructor.name; } };
function sail(things, n) { let sum = 0; for (let i = 0; i < n; i++) { const t = things[i % things.length]; t.setPlace(i, i / 2); sum += t.stepBy(1, -1) + t.x + t.y; } return sum; }
for (let k = 0; k < 100; k++) { sail([new Boat('a'), new Cart(k), Object.create(kite)], 9); new Boat('b').reset().keep(k); exports.lent.setPlace(k, k); exports.setPlace(k, 1); both.call({}); }
const boat = new Boat('c'), cart = new Cart(2); console.log(sail([boat, cart, kite], 7), boat.where(), cart.where(), kite.where());
console.log(boat.reset().where(), boat.keep('k'), boat.keep(boat) === boat, boat.size, boat.both(), boat.both(), cart.named('w'), exports.lent.named('v'), exports.lent.word, exports.lent.moves, Object.keys(exports.lent).join());
console.log(Object.keys(exports).filter(k => typeof exports[k] !== 'function').join(), exports.x, exports.y, exports.moves, exports.both(), exports.both());
for (const on of [undefined, null, 5, 'text', [], new Map(), Object.freeze({ x: 1 }), Object.create(boat), function f() {}, new Proxy({}, { set(o, k, v) { o[k] = k === 'x' ? v * 10 : v; return true; } })]) console.log(told(() => { const r = setPlace.call(on, 3, 4); return r.x + ',' + r.y + ',' + r.moves; }), told(() => stepBy.call(on, 1, 1)), told(() => keep.apply(on, [on]) === on), told(() => both.call(on)));
const made = new setPlace(7, 8), born = new both(), kept = new keep({ inner: 1 }); console.log(made.x, made.moves, made instanceof setPlace, Object.keys(born).length, born instanceof both, kept.inner, kept instanceof keep, Object.getPrototypeOf(made) === setPlace.prototype, told(() => new exports.lent.named('n').word));
const bound = setPlace.bind(boat, 11); bound(12); console.log(boat.where(), [1, 2].map(stepBy, cart).join(), cart.where(), [3].forEach(setPlace, kite), kite.x, Reflect.apply(named, boat, ['r']), boat.word);
setPlace.prototype.extra = 'e'; console.log(new setPlace(1, 2).extra, boat.extra, setPlace.name, setPlace.length, exports.lent.setPlace === Boat.prototype.setPlace); exports.lent.setPlace = function (x) { this.x = 'o' + x; }; exports.lent.setPlace(1); console.log(exports.lent.x, exports.setPlace(2, 3).x); Boat.prototype.stepBy = () => 1000; console.log(sail([new Boat('d'), cart], 4)); delete Boat.prototype.setPlace; console.log(told(() => sail([boat], 1)), told(() => new Boat('e').setPlace));
Object.defineProperty(Cart.prototype, 'x', { set(v) { this.y = 'set' + v; }, get() { return 4; }, configurable: true }); console.log(told(() => new Cart(1).setPlace(5, 6).y), told(() => new Cart(1).where()), told(() => Object.keys(new Cart(3)).join()));
