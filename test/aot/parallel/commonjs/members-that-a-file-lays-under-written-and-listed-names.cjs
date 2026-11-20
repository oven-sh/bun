// A CommonJS file makes itself a function and lays members on it and on its prototype, under written names and under those of a list, with functions that bear names of their own or none: what each is called, how many parameters it takes, what it runs on and what it says are as written.
'use strict';
exports = module.exports = function Stall(owner) { this.owner = owner; this.crates = new Map(); this.said = ''; };
var Stall = exports, fruits = ['apple', 'plum', 'quince', 'pear'], made = Stall.prototype;
exports.Crate = Crate; exports.fruits = fruits; exports.sold = 0;
function Crate(fruit, pounds) { this.fruit = fruit; this.pounds = pounds; exports.sold -= 1; }
Crate.prototype.take = function take(pounds) { var most = Math.min(pounds, this.pounds); this.pounds -= most; return most; };
Crate.prototype.left = function () { return this.fruit + this.pounds; };
made.put = function put(fruit, pounds) { this.crates.set(fruit, new exports.Crate(fruit, pounds)); return this; };
made.sell = function sell(fruit, pounds, to = 'anyone') { var crate = this.crates.get(fruit); if (crate === undefined) throw new RangeError(to + ' wants ' + fruit); exports.sold += crate.take(pounds); return crate.pounds; };
made['count'] = function () { var out = []; this.crates.forEach(function (crate, fruit) { out.push(fruit === crate.fruit ? crate.left() : fruit); }); return out.join(); };
fruits.forEach(function (fruit) { made[fruit] = function (pounds) { this.said += fruit[0] + pounds; for (var i = 1; i < arguments.length; i++) this.put(fruit + i, arguments[i]); return this.crates.has(fruit) ? this.sell(fruit, pounds) : -1; }; });
made.buy = made.sell; made.cry = cry; function cry(word, times = 1, ...rest) { this.said += word.repeat(times); return rest.length; }
Object.defineProperty(made, 'weight', { get: function weight() { var all = 0; for (var crate of this.crates.values()) all += crate.pounds; return all; }, configurable: true });
exports.open = exports['open again'] = function morning(a, b) { return [this === exports, a, b, arguments.length].join(); }; exports.late = null; exports.late = class extends Crate {}; exports.arrow = (a) => a; exports[0] = function () {}; exports[Symbol.for('mark')] = function () {}; module.exports.close = async function* (x, y, z) {};
var called = function (f) { return typeof f === 'function' ? (f.name || '""') + '/' + f.length : typeof f; };
console.log(Object.keys(exports).map(function (k) { return k + '=' + called(exports[k]); }).join(' '), called(exports[Symbol.for('mark')]), called(module.exports), module.exports === exports);
console.log(Object.keys(made).map(function (k) { return k + '=' + called(made[k]); }).join(' '), called(Object.getOwnPropertyDescriptor(made, 'weight').get), Object.keys(Crate.prototype).map(function (k) { return k + '=' + called(Crate.prototype[k]); }).join(' '));
var stall = new module.exports('Ines'), told = function (run) { try { return String(run()); } catch (error) { return error.constructor.name + ': ' + error.message; } };
console.log(stall.put('apple', 10).put('plum', 2.5).sell('apple', 3), stall.buy('plum', 9), told(function () { return stall.sell('pear', 1); }), told(function () { return stall.sell('fig', 1, 'Ola'); }), stall.count(), stall.weight, exports.sold);
for (var k = 0; k < 50; k++) fruits.forEach(function (fruit) { stall[fruit](k % 3); });
console.log(stall.said.length, stall.said.slice(-8), stall.quince(1, 4, 5), stall.count(), stall.cry('ho', 2, 'x', 'y'), stall.said.slice(-4), exports.sold);
console.log(exports.open(1), exports['open again'](1, 2, 3), (0, exports.open)(), new exports.late('l', 2).take(5), exports.late.name, exports.arrow.name, made.buy === made.sell, made.buy.name, new made.put.constructor('return 7')());
made.pear = function replaced() { return 'r' + this.owner; }; console.log(stall.pear(), called(made.pear)); delete made.plum; console.log(told(function () { return stall.plum(1); }).split(':')[0]); made.plum = made['apple']; console.log(stall.plum(1), stall.said.slice(-2), called(made.plum) === called(made.quince));
exports.Crate = function Basket(fruit, pounds) { this.fruit = fruit + '?'; this.pounds = pounds * 2; }; exports.Crate.prototype.left = function left() { return 'basket'; }; stall.put('fig', 4); console.log(stall.count(), told(function () { return stall.sell('fig', 1); }).split(':')[0], stall.weight);
console.log(made.constructor === Stall, stall instanceof module.exports, new made.constructor(3).owner, told(function () { return Stall.call(undefined, 1); }).split(':')[0], Reflect.ownKeys(made).length, fruits.every(function (fruit) { return made.hasOwnProperty(fruit) && typeof made[fruit] === 'function'; }));
