import { test } from "bun:test";
import * as roads from "./roads";
import { finds, lengths, lengthsOfDoubles, owns, ownsOfMap, ownsOfNumber, ownsOfText, reads, sum, sums } from "./app";
// `length` and `indexOf` lie TWO steps above a Uint8Array, `hasOwnProperty` two above a list and a Map. What is found there is as built while two things hold:
// nobody has written the member itself, and nobody has ADDED a name to a holder that lies below it. A name laid further up, above all objects, can stand in front of nothing that is found below it.
// Each is done here in the middle of a loop and taken back again. The member itself is written through holders and names that the build cannot see.
// A name that would stand in front of a member further up can be added only where the build sees a test do it, so those are spelled out.
const nothing = () => {};
const bytes = () => new Uint8Array([1, 2, 3, 4]), doubles = () => new Float64Array([1, 2]), list = () => [1, 2], map = () => new Map([[1, 1]]);
const all = (label: string) => console.log(label, lengths(bytes(), 2, -1, nothing), lengthsOfDoubles(doubles(), 2, -1, nothing), sum(bytes()), reads(bytes(), 8), finds(bytes(), 2, -1, nothing), owns(list(), 2, -1, nothing), ownsOfMap(map(), 2, -1, nothing));
test("what lies further above an instance", () => {
  all("as built:");
  Object.defineProperty(Object.prototype, "madeUp", { value: 1, configurable: true, writable: true });
  all("a name laid above all objects:");
  const length = roads.named("len", "gth"), indexOf = roads.named("index", "Of"), hasOwn = roads.named("hasOwn", "Property");

  const keptLength = Object.getOwnPropertyDescriptor(roads.aboveViews, length)!;
  console.log("another getter two steps up, at the second turn:", lengths(bytes(), 4, 1, () => roads.define(roads.aboveViews, length, { get() { return 77; } })));
  console.log("still replaced:", lengths(bytes(), 2, -1, nothing), lengthsOfDoubles(doubles(), 2, -1, nothing), sum(bytes()), reads(bytes(), 8));
  console.log("put back in the middle of sums:", sums(bytes(), 3, 1, () => roads.define(roads.aboveViews, length, keptLength)));
  all("put back:");

  console.log("a value added one step up, at the second turn:", lengths(bytes(), 4, 1, () => { Object.defineProperty(Uint8Array.prototype, "length", { value: 2, writable: true, configurable: true }); }));
  console.log("it shadows for this class alone:", lengths(bytes(), 2, -1, nothing), lengthsOfDoubles(doubles(), 2, -1, nothing), sum(bytes()), reads(bytes(), 8));
  console.log("taken away at the third turn:", lengths(bytes(), 4, 2, () => { delete (Uint8Array.prototype as any).length; }), sum(bytes()));
  console.log("a getter added one step up in the middle of sums:", sums(bytes(), 4, 2, () => { Object.defineProperty(Uint8Array.prototype, "length", { get() { return 1; }, configurable: true }); }));
  delete (Uint8Array.prototype as any).length;
  console.log("above the other class:", lengthsOfDoubles(doubles(), 4, 1, () => { Object.defineProperty(Float64Array.prototype, "length", { value: 9, configurable: true }); }), lengths(bytes(), 2, -1, nothing));
  delete (Float64Array.prototype as any).length;
  all("taken away:");

  const keptIndexOf = roads.aboveViews[indexOf];
  console.log("a method added one step up:", finds(bytes(), 4, 1, () => { (Uint8Array.prototype as any).indexOf = () => 50; }));
  delete (Uint8Array.prototype as any).indexOf;
  console.log("the method itself replaced:", finds(bytes(), 4, 2, () => roads.put(roads.aboveViews, indexOf, () => 60)));
  roads.put(roads.aboveViews, indexOf, keptIndexOf);
  console.log("put back:", finds(bytes(), 2, -1, nothing));

  const keptHasOwn = roads.aboveAll[hasOwn];
  console.log("added above lists:", owns(list(), 4, 1, () => { (Array.prototype as any).hasOwnProperty = () => "laid"; }), ownsOfMap(map(), 2, -1, nothing));
  delete (Array.prototype as any).hasOwnProperty;
  console.log("added above maps:", ownsOfMap(map(), 4, 2, () => { (Map.prototype as any).hasOwnProperty = () => "laid"; }), owns(list(), 2, -1, nothing));
  delete (Map.prototype as any).hasOwnProperty;
  console.log("added above texts:", ownsOfText("text", 4, 1, () => { (String.prototype as any).hasOwnProperty = () => "laid"; }), ownsOfNumber(5, 2, -1, nothing));
  delete (String.prototype as any).hasOwnProperty;
  console.log("added above numbers:", ownsOfNumber(5, 4, 2, () => { (Number.prototype as any).hasOwnProperty = () => "laid"; }), ownsOfText("text", 2, -1, nothing));
  delete (Number.prototype as any).hasOwnProperty;
  console.log("replaced above all objects:", ownsOfText("text", 2, -1, nothing), owns(list(), 4, 1, () => roads.put(roads.aboveAll, hasOwn, () => "other")), ownsOfMap(map(), 2, -1, nothing), ownsOfText("text", 2, -1, nothing), ownsOfNumber(5, 2, -1, nothing));
  roads.put(roads.aboveAll, hasOwn, keptHasOwn);

  const own = bytes();
  Object.defineProperty(own, "length", { value: 1, configurable: true });
  console.log("a length of its own:", lengths(own, 2, -1, nothing), sum(own));
  class Odd extends Uint8Array { get length() { return 2; } }
  console.log("a class below:", lengths(new Odd([1, 2, 3]), 2, -1, nothing), sum(new Odd([1, 2, 3])));
  delete (Object.prototype as any).madeUp;
  all("at the end:");
});
