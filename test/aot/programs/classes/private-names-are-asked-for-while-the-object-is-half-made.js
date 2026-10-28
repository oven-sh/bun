// A method of the class below runs from the constructor above, before the private names are there; a field initializer throws half way.
const lines = [];
class Base { constructor() { lines.push(this.probe()); } probe() { return "base"; } }
class Derived extends Base { #first = 1; #second = Derived.fail ? (() => { throw new RangeError("second"); })() : 2; static last; probe() { Derived.last = this; try { return "d" + this.#first; } catch (error) { return error.constructor.name; } } static state(o) { return [#first in o, #second in o].join(); } sum() { return this.#first + this.#second; } }
lines.push(new Derived().sum(), Derived.state(Derived.last));
Derived.fail = true;
try { new Derived(); } catch (error) { lines.push(error.message, Derived.state(Derived.last)); }
try { lines.push(Derived.last.sum()); } catch (error) { lines.push(error.constructor.name); }
Derived.fail = false;
let total = 0; for (let i = 0; i < 300; i++) total += new Derived().sum(); lines.length = 6; lines.push(total);
console.log(lines.join(" "));
