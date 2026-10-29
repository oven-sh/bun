// A class below Array whose species is a built-in constructor of another class: concat, slice, map, filter, splice, flat and flatMap construct that one, with a length as its argument, and fill what it makes. `new Object(0)` is a Number, `new Map(0)` throws, `new Set(0)` throws, `new String(0)` is a String. Each result is asked, out of a variable, what it is.
const describe = (label, run) => {
  let made;
  try { made = run(); } catch (error) { console.log(label, "throws", error.constructor.name); return; }
  const constructor = made.constructor;
  const above = Object.getPrototypeOf(made);
  console.log(label, constructor.name, constructor === Array, constructor === Object, constructor === Number, above === Array.prototype, above === Object.prototype, above === Number.prototype, Array.isArray(made), made instanceof Array, made instanceof Number, typeof made.valueOf(), Object.prototype.toString.call(made), JSON.stringify(Object.entries(made)));
};
const classWith = species => class extends Array { static get [Symbol.species]() { return species; } };
for (const species of [Object, Number, String, Boolean, Map, Set, Date, Promise, Error, RegExp, Uint8Array, ArrayBuffer, Symbol, undefined, null]) {
  const List = classWith(species);
  const name = species ? species.name : String(species);
  describe(name + " concat", () => new List(1, 2).concat([3]));
  describe(name + " slice", () => new List(1, 2).slice(1));
  describe(name + " map", () => new List(1, 2).map(value => value * 2));
  describe(name + " filter", () => new List(1, 2).filter(value => value > 1));
  describe(name + " splice", () => new List(1, 2).splice(0, 1));
  describe(name + " flat", () => new List(1, [2]).flat());
  describe(name + " flatMap", () => new List(1, 2).flatMap(value => [value]));
}
class OfObjects extends Array { static get [Symbol.species]() { return Object; } }
const joined = new OfObjects(1, 2).concat([3]);
const constructorOfJoined = joined.constructor;
console.log(constructorOfJoined === Number, constructorOfJoined === Object, constructorOfJoined === OfObjects, constructorOfJoined === Array, joined instanceof Number, typeof joined, joined[0], joined[2], joined.length);
const list = [1, 2];
list.constructor = { [Symbol.species]: Object };
const mapped = list.map(value => value + 1);
const constructorOfMapped = mapped.constructor;
console.log(constructorOfMapped === Number, constructorOfMapped === Array, mapped[0], mapped[1], mapped.length, Array.isArray(mapped));
