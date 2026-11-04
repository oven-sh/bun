const own = Symbol("own");
class Bag { *[Symbol.iterator]() { yield 1; } get [Symbol.toStringTag]() { return "Bag"; } [Symbol.toPrimitive]() { return 5; } [own]() { return "own"; } static [Symbol.hasInstance]() { return true; } }
console.log([...new Bag()].join(), String(Object.prototype.toString.call(new Bag())), +new Bag(), new Bag()[own](), 1 instanceof Bag);
