class Bag {
  *[Symbol.iterator]() { yield 1; }
  [Symbol.toPrimitive]() { return 7; }
  static [Symbol.hasInstance](value: unknown) { return value === 1; }
  get [Symbol.toStringTag]() { return "Bag"; }
  async *[Symbol.asyncIterator]() { yield 2; }
}
const literal = { [Symbol.iterator]() { return [][Symbol.iterator](); }, [Symbol.toPrimitive]: function () { return 1; }, [Symbol.match]: () => null };
const own = Symbol("mine");
class Keyed { [own]() {} static [own]() {} }
console.log(JSON.stringify([
  Bag.prototype[Symbol.iterator].name, Bag.prototype[Symbol.toPrimitive].name, Bag[Symbol.hasInstance].name,
  Object.getOwnPropertyDescriptor(Bag.prototype, Symbol.toStringTag)!.get!.name, Bag.prototype[Symbol.asyncIterator].name,
  literal[Symbol.iterator].name, literal[Symbol.toPrimitive].name, literal[Symbol.match].name,
  (Keyed.prototype as any)[own].name, (Keyed as any)[own].name,
]));
console.log(Bag.prototype[Symbol.iterator], Bag[Symbol.hasInstance], literal[Symbol.iterator], (Keyed.prototype as any)[own]);
console.log([...new Bag()], +(new Bag() as any), (1 as any) instanceof Bag, String(new Bag()));
