// A constructor with a rest parameter that hands it to a method of the new object, by spread, apply and call.
const log = [];
function Spread(...rest) { this.init(...rest); }
Spread.prototype.init = function (x, y) { this.x = x; this.y = y; };
Spread.prototype.sum = function () { return this.x + this.y; };
function Applied(...rest) { this.init.apply(this, rest); }
Applied.prototype = { x: -1, init: function (x, y) { if (x) this.x = x; this.y = y; }, sum() { return this.x + this.y; } };
function Prefixed(first, ...rest) { this.first = first; this.init(7, ...rest); }
Prefixed.prototype.init = function (seven, x) { this.x = x; this.seven = seven; this.count = arguments.length; };
Prefixed.prototype.sum = function () { return this.x + this.seven + this.count + this.first; };
function Other(...rest) { this.init(...rest); return rest.length === 3 ? { sum: () => -1, rest } : 5; }
Other.prototype.init = function () { this.list = Array.from(arguments); };
Other.prototype.sum = function () { return this.list.length; };
class Base { constructor(...rest) { this.init(...rest); } init(x, y) { this.x = x; this.y = y; } sum() { return this.x * 2 + this.y; } }
class Derived extends Base { init(x, y, z) { super.init(y, x); this.z = z; } sum() { return super.sum() + (this.z | 0); } }
function Written(...rest) { rest[0] = rest[0] + 1; this.init(...rest); rest.push(4); this.after = rest.length; }
Written.prototype.init = function (x, y) { this.x = x; this.y = y; };
Written.prototype.sum = function () { return this.x + this.y + this.after; };

function run(make, n) { let sum = 0; for (let i = 0; i < n; i++) sum = (sum + make(i).sum()) | 0; return sum; }
console.log(run(i => new Spread(i, 1), 200), run(i => new Applied(i, 1), 200), run(i => new Prefixed(i, 2), 200));
console.log(run(i => new Other(i, 1), 200), run(i => new Other(i, 1, 2), 200), run(i => new Derived(i, 1, 3), 200), run(i => new Base(i, 1), 200), run(i => new Written(i, 1), 200));

// The iterator of the rest array is its own.
function Iterated(...rest) { if (rest.length > 2) rest[Symbol.iterator] = function* () { log.push("iterated"); yield 50; yield 60; }; this.init(...rest); }
Iterated.prototype.init = function (x, y) { this.x = x; this.y = y; };
Iterated.prototype.sum = function () { return this.x + this.y; };
console.log(run(i => new Iterated(i, 1), 50), run(i => new Iterated(i, 1, 2), 3), log.join());

// The method is replaced, taken away, put on the object and handed to Reflect.
const before = Spread.prototype.init;
Spread.prototype.init = function (x, y) { log.push("replaced " + arguments.length); before.call(this, y, x); };
console.log(run(i => new Spread(i, 1), 3), log.splice(0).join());
Spread.prototype.init = before;
Object.defineProperty(Spread.prototype, "init", { configurable: true, get() { log.push("read"); return before; } });
console.log(run(i => new Spread(i, 1), 3), log.splice(0).join());
delete Spread.prototype.init;
try { new Spread(1, 2); } catch (e) { console.log(e.constructor.name); }
Spread.prototype.init = before;
try { Spread(1, 2); } catch (e) { console.log(e.constructor.name); }
const made = Reflect.construct(Spread, [1, 2], Applied);
console.log(made instanceof Applied, made instanceof Spread, made.sum(), Object.keys(made).join());
console.log(new Spread(1, 2).constructor === Spread, Object.keys(new Prefixed("p", 2)).join(), JSON.stringify(new Other(1, 2)));
const frozen = Object.freeze({ init(x) { this.x = x; } });
Applied.prototype = frozen;
console.log(new Applied(3).x, Object.getPrototypeOf(new Applied(3)) === frozen);
