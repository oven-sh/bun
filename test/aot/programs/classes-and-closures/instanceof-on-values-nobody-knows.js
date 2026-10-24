// `x instanceof C` with C a class of the program and x a value nobody can follow, before and after everything that changes the answer.
const unknown = new Function("value", "return value" + process.argv[0].slice(process.argv[0].length));
const lines = [];

class Base { constructor() { this.z = 1; } }
class Left extends Base { constructor() { super(); this.l = 1; } }
class Right extends Base { constructor() { super(); this.r = "r"; } }
class LeftLeaf extends Left {}
class Alone {}
class FromNull extends null { static make() { return Object.create(FromNull.prototype); } }
class List extends Array {}
class Failure extends Error {}
function Legacy() { this.old = true; }
function LegacyChild() { Legacy.call(this); }
LegacyChild.prototype = Object.create(Legacy.prototype);
function Twin() {}
Twin.prototype = Legacy.prototype;

function isBase(x) { return x instanceof Base; }
function isLeft(x) { return x instanceof Left; }
function isRight(x) { return x instanceof Right; }
function isLeftLeaf(x) { return x instanceof LeftLeaf; }
function isAlone(x) { return x instanceof Alone; }
function isFromNull(x) { return x instanceof FromNull; }
function isList(x) { return x instanceof List; }
function isFailure(x) { return x instanceof Failure; }
function isLegacy(x) { return x instanceof Legacy; }
function isLegacyChild(x) { return x instanceof LegacyChild; }
function isTwin(x) { return x instanceof Twin; }
const tests = [isBase, isLeft, isRight, isLeftLeaf, isAlone, isFromNull, isList, isFailure, isLegacy, isLegacyChild, isTwin];
function fourInARow(a, b, c, d) { let r = 0; if (a instanceof Left) r |= 1; if (b instanceof Left) r |= 2; if (c instanceof Left) r |= 4; if (d instanceof Left) r |= 8; return r; }

function answers(value) {
  let text = "";
  for (const test of tests) {
    let answer;
    try { answer = test(value) ? "1" : "0"; } catch (error) { answer = "!"; }
    text += answer;
  }
  return text;
}
const make = {
  base: () => new Base(), left: () => new Left(), right: () => new Right(), leaf: () => new LeftLeaf(), alone: () => new Alone(), fromNull: () => FromNull.make(),
  list: () => new List(), failure: () => new Failure("f"), legacy: () => new Legacy(), legacyChild: () => new LegacyChild(), twin: () => new Twin(),
  literal: () => ({ z: 1 }), created: () => Object.create(Left.prototype), bare: () => Object.create(null), array: () => [], func: () => function () {}, classObject: () => Left,
  prototypeObject: () => Left.prototype, undefinedValue: () => undefined, nullValue: () => null, number: () => 1, text: () => "t", symbol: () => Symbol.iterator, big: () => 1n,
  proxyOfLeft: () => new Proxy(new Left(), {}), proxyThatLies: () => new Proxy({}, { getPrototypeOf() { return Right.prototype; } }), bound: () => isLeft.bind(null),
};
function round(label) {
  for (const [name, maker] of Object.entries(make))
    lines.push(label + ", " + name + ": " + answers(maker()) + " " + answers(unknown(maker())));
  lines.push(label + ", four: " + fourInARow(unknown(new Left()), unknown(new Right()), unknown(new LeftLeaf()), unknown(null)) + " " + fourInARow(new Base(), new Left(), undefined, unknown({})));
}

for (let warm = 0; warm < 3; warm++) { lines.length = 0; round("as defined"); }

const moved = unknown(new Left());
Object.setPrototypeOf(moved, Right.prototype);
lines.push("an instance under another prototype: " + answers(moved));
Object.setPrototypeOf(moved, Left.prototype);
lines.push("and back: " + answers(moved));
const extended = unknown(new Right());
extended.extra = 1;
lines.push("an instance with another property: " + answers(extended));

const boundLeft = unknown(Left).bind(null);
lines.push("a bound class: " + [new Left() instanceof boundLeft, unknown(new Right()) instanceof boundLeft, unknown(null) instanceof boundLeft].join());
for (const notCallable of [undefined, null, 1, "t", {}, Left.prototype]) {
  let answer;
  try { answer = unknown(new Left()) instanceof unknown(notCallable); } catch (error) { answer = error.constructor.name; }
  lines.push("right side " + String(notCallable && typeof notCallable) + ": " + answer);
}

function defineTwice() { return class Twice { }; }
const First = defineTwice(), Second = defineTwice();
function isTwice(x, C) { return x instanceof C; }
lines.push("a class evaluated twice: " + [isTwice(new First(), First), isTwice(new First(), Second), isTwice(unknown(new Second()), Second), isTwice(unknown(new Second()), First)].join());

Object.setPrototypeOf(Left.prototype, Alone.prototype);
round("Left.prototype inherits from Alone.prototype");
Object.setPrototypeOf(Left.prototype, Base.prototype);
round("and from Base.prototype again");

Object.setPrototypeOf(Alone, { [Symbol.hasInstance](x) { return typeof x === "number"; } });
round("Alone inherits another Symbol.hasInstance");
Object.setPrototypeOf(Alone, { [Symbol.hasInstance]: undefined });
round("Alone inherits none");
Object.setPrototypeOf(Alone, Function.prototype);
round("Alone inherits from Function.prototype again");

Object.defineProperty(Base, Symbol.hasInstance, { configurable: true, value(x) { return x === 1 || x === "t"; } });
round("Base has its own Symbol.hasInstance, which its subclasses inherit");
delete Base[Symbol.hasInstance];
round("and has it no more");

Legacy.prototype = { replaced: true };
round("Legacy.prototype is another object");

const ordinary = Function.prototype[Symbol.hasInstance];
lines.push("the ordinary function by hand: " + [ordinary.call(Left, new LeftLeaf()), ordinary.call(Left, unknown(new Right())), ordinary.call({}, new Left()), ordinary.call(unknown(Alone), unknown(new Alone()))].join());
console.log(lines.join("\n"));
