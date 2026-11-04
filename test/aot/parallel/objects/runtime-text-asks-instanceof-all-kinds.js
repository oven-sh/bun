// `instanceof` in text made at run time: classes and functions of the program, built-in and host classes, bound functions, proxies, Symbol.hasInstance, prototypes that are replaced, chains that change, right sides that throw; the same site again and again.
const pad = process.argv.length > 99 ? " " : "";
const text = (...parts) => new Function(...parts.slice(0, -1), parts.at(-1) + pad);
class Shape { constructor(name) { this.name = name; } }
class Circle extends Shape { constructor() { super("circle"); this.r = 1; } }
class Ring extends Circle {}
class Failure extends Error { constructor(status) { super("failure"); this.status = status; } }
class Even { static [Symbol.hasInstance](value) { return typeof value === "number" && value % 2 === 0; } }
class BelowEven extends Even {}
class Keys extends Map {}
function Old(x) { this.x = x; }
function Older() {}
Old.prototype = Object.create(Older.prototype);
const arrow = () => 1;
const bound = Shape.bind(null);
const boundTwice = bound.bind(null);
const proxied = new Proxy(Shape, {});
const trapped = new Proxy(Shape, { get(target, key) { return key === "prototype" ? Circle.prototype : Reflect.get(target, key); } });
const method = { m() {} }.m;
const isInstance = text("value", "constructor", "return value instanceof constructor");
const describe = (value, constructor) => { try { return String(isInstance(value, constructor)); } catch (error) { return error.constructor.name + ": " + error.message; } };
const constructors = { Shape, Circle, Ring, Failure, Even, BelowEven, Keys, Old, Older, arrow, bound, boundTwice, proxied, trapped, method, Object, Function, Error, Map, Array, Promise, Response, Request, URL, Buffer, Uint8Array, plain: {}, nothing: null, missing: undefined, number: 5, string: "s", callableLess: { prototype: Shape.prototype }, custom: { [Symbol.hasInstance]: value => value === 7 } };
const values = { shape: new Shape("s"), circle: new Circle(), ring: new Ring(), failure: new Failure(401), keys: new Keys(), old: new Old(1), older: new Older(), literal: { a: 1 }, bare: Object.create(null), belowCircle: Object.create(Circle.prototype), parsed: JSON.parse('{"a":1}'), array: [1], fn: function () {}, classItself: Circle, error: new TypeError("t"), promise: Promise.resolve(1), response: new Response("r"), url: new URL("http://a/b"), buffer: Buffer.from("b"), proxyOfRing: new Proxy(new Ring(), {}), proxyWithTrap: new Proxy({}, { getPrototypeOf: () => Ring.prototype }), four: 4, seven: 7, word: "w", yes: true, nothing: null, missing: undefined, symbol: Symbol.iterator, big: 10n };
for (let round = 0; round < 3; round++)
  for (const [constructorName, constructor] of Object.entries(constructors)) {
    const row = Object.entries(values).map(([name, value]) => name + "=" + describe(value, constructor)).filter(cell => !cell.endsWith("=false"));
    if (round === 2) console.log(constructorName, row.join(" ") || "none");
  }

// One site, one constructor, asked often, and then the world changes under it.
const isCircle = text("Circle", "return function (value) { return value instanceof Circle; }")(Circle);
const ring = new Ring(), shape = new Shape("s");
let hits = 0; for (let i = 0; i < 1000; i++) hits += isCircle(i & 1 ? ring : shape) ? 1 : 0;
console.log("hits", hits);
Object.setPrototypeOf(ring, Shape.prototype); console.log("ring moved below Shape", isCircle(ring));
Object.setPrototypeOf(ring, Ring.prototype); console.log("ring moved back", isCircle(ring));
Object.setPrototypeOf(Ring.prototype, Shape.prototype); console.log("Ring.prototype moved below Shape", isCircle(ring), isCircle(new Ring()));
Object.setPrototypeOf(Ring.prototype, Circle.prototype); console.log("Ring.prototype moved back", isCircle(ring));
Object.defineProperty(Circle, Symbol.hasInstance, { value: value => value === shape, configurable: true }); console.log("Circle answers for itself", isCircle(ring), isCircle(shape));
delete Circle[Symbol.hasInstance]; console.log("Circle answers as before", isCircle(ring), isCircle(shape));
Object.defineProperty(Shape, Symbol.hasInstance, { value: () => true, configurable: true }); console.log("the class above answers", isCircle(5), isCircle(shape));
delete Shape[Symbol.hasInstance]; console.log("the class above answers no more", isCircle(5), isCircle(ring));

const isOld = text("Old", "return function (value) { return value instanceof Old; }")(Old);
const old = new Old(1);
hits = 0; for (let i = 0; i < 1000; i++) hits += isOld(old) ? 1 : 0;
console.log("hits", hits);
Old.prototype = {}; console.log("another prototype", isOld(old), isOld(new Old(2)));
Old.prototype = 5; try { console.log(isOld(old)); } catch (error) { console.log("a prototype that is no object", error.constructor.name); } console.log("of a number", isOld(3));
Object.defineProperty(Older, "prototype", { value: Object.getPrototypeOf(Object.getPrototypeOf(old)) });
let reads = 0;
function Counted() {}
const counted = new Proxy(Counted, { get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver); } });
console.log("reads of a proxy", isInstance(new Counted(), counted), isInstance(1, counted), reads);
const original = Function.prototype[Symbol.hasInstance];
console.log("the method itself", original.call(Circle, ring), original.call(Circle, shape), original.call({}, ring), original.call(bound, shape));

// Errors thrown and caught by the text, as a composed handler sorts them.
const sort = text("Failure", "Shape", "return function (work) { try { return work(); } catch (error) { if (error instanceof Failure) return 'failure ' + error.status; if (error instanceof Shape) return 'shape'; if (error instanceof Error) return 'error ' + error.message; return 'other ' + String(error); } }")(Failure, Shape);
for (let round = 0; round < 3; round++) console.log(sort(() => { throw new Failure(403); }), sort(() => { throw new Circle(); }), sort(() => { throw new RangeError("r"); }), sort(() => { throw 5; }), sort(() => "fine"));
