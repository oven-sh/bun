// A function makes further objects with what it finds under Symbol.species of the constructor of its `this`.
function Bag(items) { this.items = items; this.kind = "bag"; }
Object.defineProperty(Bag, Symbol.species, { get() { return this; }, configurable: true });
Bag.prototype.map = function (f) { const Species = this.constructor[Symbol.species]; return new Species(this.items.map(f)); };
Bag.prototype.sum = function () { let sum = 0; for (const item of this.items) sum += item; return sum; };
class Sack extends Bag { constructor(items) { super(items); this.tied = true; } }
class Purse extends Bag { static get [Symbol.species]() { return Bag; } constructor(items) { super(items); this.small = true; } }
class Trick extends Bag { static get [Symbol.species]() { return function (items) { return { items, sum() { return -1; } }; }; } }
function show(o) { return o.constructor.name + " " + Object.keys(o).join() + " " + o.sum(); }
let total = 0;
for (let i = 0; i < 100; i++) total += new Sack([i, 1]).map(x => x * 2).sum() + new Purse([i]).map(x => x + 1).sum();
console.log(total);
for (const bag of [new Bag([1]), new Sack([2]), new Purse([3]), new Trick([4])]) console.log(show(bag), "->", show(bag.map(x => x * 10)));
