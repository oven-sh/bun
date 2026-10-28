// Private methods, accessors and static private names in classes below classes, read on objects of the class, of classes below, and of others.
const lines = [];
class Root { root = 1; }
class Mid extends Root { #value = 10; #method() { return this.#value + 1; } get #twice() { return this.#value * 2; } set #twice(v) { this.#value = v / 2; } static #made = 0; static count() { return Mid.#made; } constructor() { super(); Mid.#made++; } run() { this.#twice = this.#twice + 2; return this.#method() + this.#twice; } static is(o) { return #method in o; } }
class Low extends Mid { #value = 100; own() { return this.#value; } }
class Side extends Root { #value = -1; side() { return this.#value; } }
let sum = 0; for (let i = 0; i < 400; i++) { const low = new Low(), mid = new Mid(), side = new Side(); sum += low.run() + low.own() + mid.run() + side.side(); }
lines.push(sum, Mid.count(), Mid.is(new Low()), Mid.is(new Side()), Mid.is(new Root()), Mid.is({}));
for (const receiver of [new Side(), new Root(), {}, Mid.prototype]) { try { lines.push(Mid.prototype.run.call(receiver)); } catch (error) { lines.push(error.constructor.name); } }
try { lines.push(Low.prototype.own.call(new Mid())); } catch (error) { lines.push(error.constructor.name); }
console.log(lines.join(" "));
