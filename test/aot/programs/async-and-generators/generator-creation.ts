// what a freshly made generator is, for every kind of generator function, the first time and every later time
const lines: string[] = [];
function say(...parts: unknown[]) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
}
function* declared(n: number): Generator<number, string, unknown> {
  for (let i = 0; i < n; i++) yield i;
  return "end";
}
const expression = function* (n: number): Generator<number, void, unknown> {
  yield n;
};
class Holder {
  constructor(readonly base: number) {}
  *method(n: number): Generator<number, void, unknown> {
    yield this.base + n;
  }
  static *fixed(n: number): Generator<number, void, unknown> {
    yield n * 2;
  }
  *[Symbol.iterator](): Generator<number, void, unknown> {
    yield this.base;
  }
}
const literal = {
  *member(n: number): Generator<number, void, unknown> {
    yield n + 1;
  },
};
function makes(offset: number) {
  return function* inner(n: number): Generator<number, void, unknown> {
    yield n + offset;
  };
}
const holder = new Holder(10);
const first = makes(100);
const second = makes(200);
const makers: [string, Function, () => Generator<number, unknown, unknown>][] = [
  ["declared", declared, () => declared(2)],
  ["expression", expression, () => expression(2)],
  ["method", holder.method, () => holder.method(2)],
  ["static method", Holder.fixed, () => Holder.fixed(2)],
  ["Symbol.iterator", holder[Symbol.iterator], () => holder[Symbol.iterator]()],
  ["member of a literal", literal.member, () => literal.member(2)],
  ["closure", first, () => first(2)],
  ["another closure of the same function", second, () => second(2)],
];
const generatorPrototype = Object.getPrototypeOf(Object.getPrototypeOf(declared(0)));
for (let round = 0; round < 3; round++) {
  for (const [title, maker, make] of makers) {
    const a = make();
    const b = make();
    say(
      round,
      title,
      Object.getPrototypeOf(a) === maker.prototype,
      Object.getPrototypeOf(a) === Object.getPrototypeOf(b),
      Object.getPrototypeOf(Object.getPrototypeOf(a)) === generatorPrototype,
      a instanceof (maker as any),
      Object.prototype.toString.call(a),
      Object.getOwnPropertyNames(a).length,
      Object.isExtensible(a),
      a === (a[Symbol.iterator]() as unknown),
      a.next(),
      b.next(),
      a.next(),
    );
  }
}
say("closures of one function have their own prototypes", first.prototype === second.prototype, Object.getPrototypeOf(first(0)) === Object.getPrototypeOf(second(0)));
{
  const generator = declared(1);
  (generator as any).note = "kept";
  (generator as any)[3] = "element";
  say("a generator takes properties", Object.keys(generator), declared(1).hasOwnProperty("note"));
}
{
  const kept: Generator<number, string, unknown>[] = [];
  let sum = 0;
  for (let i = 0; i < 200000; i++) {
    const generator = declared(3);
    sum += generator.next().value as number;
    if (i % 1000 === 0) kept.push(generator);
    else if (i % 7 === 0) sum += generator.next().value as number;
  }
  for (const generator of kept) for (const value of generator) sum += value;
  say("many", sum, kept.length, kept[0].next());
}
console.log(lines.join("\n"));
