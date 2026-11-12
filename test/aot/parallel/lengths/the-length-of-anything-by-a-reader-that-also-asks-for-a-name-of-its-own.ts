// A reader that asks a value for `length` and for a name that no built-in answers takes the value for an object of the program. Whatever comes, it says what a look says.
type Any = any;
function bagOf(thing: Any) {
  return [thing.length, thing.limit].join("|");
}
function twice(thing: Any) {
  const first = thing.length;
  const other = thing.encoding;
  return [first, other, thing.length].join("|");
}
function isEmpty(thing: Any) {
  return thing.length === 0 ? "empty " + thing.limit : "holds " + thing.limit;
}
function truthOf(thing: Any) {
  return (thing.length ? "yes" : "no") + thing.strict;
}
function orDefault(options?: Any) {
  const opts = options || {};
  return [opts.length != null && !isNaN(opts.length) ? opts.length | 0 : -1, opts.limit].join("|");
}
function inLoop(things: Any[]) {
  let said = "";
  for (let i = 0; i < things.length; i++) said += things[i].length + "/" + things[i].limit + ";";
  return said;
}
const fromText = new Function("thing", "return [thing.length, thing.limit].join('|')") as (thing: Any) => string;
const byEval = (0, eval)("(function (thing) { return [thing.length, thing.verify].join('|') })") as (thing: Any) => string;
class WithField { length = 7; limit = 1; }
class WithAccessor { get length() { return 8; } limit = 2; }
class WithStatic { static length2 = 1; }
class List extends Array<number> { limit = 3; }
class Bytes extends Uint8Array { limit = 4; }
function copyOf(from: Any) {
  const made: Any = {};
  for (const key in from) made[key] = from[key];
  return made;
}
function args(..._: Any[]) { return arguments; }
const makers: [string, () => Any][] = [
  ["a literal with length", () => ({ length: 5, limit: 9 })],
  ["a literal without", () => ({ limit: 9 })],
  ["an empty literal", () => ({})],
  ["a copy by a loop", () => copyOf({ length: 6, limit: 8, encoding: "hex" })],
  ["a parsed object", () => JSON.parse('{"length":4,"limit":7,"strict":true}')],
  ["length undefined", () => ({ length: undefined, limit: 1 })],
  ["length a text", () => ({ length: "12", limit: 1 })],
  ["length zero", () => ({ length: 0, limit: 1 })],
  ["length minus zero", () => ({ length: -0, limit: 1 })],
  ["a field of a class", () => new WithField()],
  ["an accessor of a class", () => new WithAccessor()],
  ["a class", () => WithStatic],
  ["a list", () => [1, 2, 3]],
  ["an empty list", () => []],
  ["a list of fractions", () => [1.5, 2.5]],
  ["a list with a hole", () => [1, , 3]],
  ["a long sparse list", () => { const l: Any[] = []; l[100000] = 1; return l; }],
  ["a list with a name", () => Object.assign([1, 2], { limit: 5 })],
  ["an heir of Array", () => List.from([1, 2, 3, 4])],
  ["a frozen list", () => Object.freeze([1])],
  ["a text", () => "four"],
  ["an empty text", () => ""],
  ["a joined text", () => "ab".repeat(40) + String(makers.length)],
  ["a String object", () => new String("abc")],
  ["a Buffer", () => Buffer.from("hello")],
  ["a Uint8Array", () => new Uint8Array(3)],
  ["a Float64Array", () => new Float64Array(2)],
  ["an heir of Uint8Array", () => new Bytes(6)],
  ["a view of a resizable buffer", () => new Uint8Array(new (ArrayBuffer as Any)(4, { maxByteLength: 8 }))],
  ["a DataView", () => new DataView(new ArrayBuffer(2))],
  ["a function of two", () => function (a: Any, b: Any) {}],
  ["an arrow of one", () => (a: Any) => a],
  ["a bound function", () => function (a: Any, b: Any, c: Any) {}.bind(null, 1)],
  ["a function with length defined", () => Object.defineProperty(function () {}, "length", { value: 11 })],
  ["a built-in function", () => Math.max],
  ["arguments", () => args(1, 2, 3)],
  ["a Map", () => new Map([[1, 2]])],
  ["a proxy of a list", () => new Proxy([1, 2], {})],
  ["a proxy that answers", () => new Proxy({}, { get: (_, key) => (key === "length" ? 21 : "p") })],
  ["without a prototype", () => Object.assign(Object.create(null), { length: 13 })],
  ["length above", () => Object.create({ length: 14, limit: 15 })],
  ["a number", () => 5],
  ["true", () => true],
  ["a symbol", () => Symbol("s")],
  ["a bigint", () => 5n],
  ["null", () => null],
  ["undefined", () => undefined],
];
const readers: [string, (thing: Any) => string][] = [["bagOf", bagOf], ["twice", twice], ["isEmpty", isEmpty], ["truthOf", truthOf], ["orDefault", orDefault], ["fromText", fromText], ["byEval", byEval]];
const log: string[] = [];
for (let round = 0; round < 3; round++) {
  for (const [reader, read] of readers) {
    for (const [what, make] of makers) {
      let now: string;
      try {
        now = read(make());
      } catch (error) {
        now = "threw " + (error as Error).constructor.name;
      }
      if (!round) log.push(reader + " . " + what + ": " + now);
      else if (!log.includes(reader + " . " + what + ": " + now)) log.push("ROUND " + round + " SAYS OTHERWISE: " + reader + " . " + what + ": " + now);
    }
  }
}
log.push("in a loop: " + inLoop(makers.slice(0, -2).map(([, make]) => make())));
const grows: Any = { limit: 1 };
log.push("before it has one: " + bagOf(grows));
grows.length = 3;
log.push("behind the store: " + bagOf(grows));
delete grows.length;
log.push("behind the delete: " + bagOf(grows));
Object.defineProperty(grows, "length", { get() { return 31; }, configurable: true });
log.push("an accessor laid: " + bagOf(grows));
const list: Any = [1, 2, 3];
log.push("a list: " + bagOf(list));
list.length = 1;
log.push("cut: " + bagOf(list));
list.push(4, 5);
log.push("grown: " + bagOf(list));
console.log(log.join("\n"));
