import { test } from "bun:test";
import * as roads from "./roads";
import { grows, sizesOfMap, sizesOfSet } from "./app";
// `size` above Maps and Sets is a getter that no cell of the image names. It is found next above the instance, so it is asked by a byte of its own like a method:
// a name that has nothing to do with it, laid above the class or above all objects, turns nothing off; the getter itself, replaced in the middle of a loop, is found at the next read; put back, the built-in answers again.
const nothing = () => {};
const map = () => new Map([[1, 1], [2, 2]]), set = () => new Set([1, 2, 3]);
const all = (label: string) => console.log(label, sizesOfMap(map(), 3, -1, nothing), sizesOfSet(set(), 3, -1, nothing), grows(map(), 3));
test("a getter next above an instance", () => {
  all("as built:");
  for (const holder of [roads.aboveMaps, roads.aboveSets]) roads.put(holder, roads.named("no", "thing"), 1);
  all("a name laid above each class:");
  for (const [label, holder, run] of [["map", roads.aboveMaps, (then: () => void, at: number) => sizesOfMap(map(), 4, at, then)], ["set", roads.aboveSets, (then: () => void, at: number) => sizesOfSet(set(), 4, at, then)]] as const) {
    const name = roads.named("si", "ze");
    const kept = Object.getOwnPropertyDescriptor(holder, name)!;
    console.log(label, "a getter laid at the second turn:", run(() => { Object.defineProperty(holder, name, { get() { return 77; }, configurable: true }); }, 1));
    console.log(label, "still replaced:", run(nothing, -1));
    console.log(label, "a value laid at the first turn:", run(() => { Object.defineProperty(holder, name, { value: 78, configurable: true, writable: true }); }, 0));
    console.log(label, "taken away at the third turn:", run(() => { roads.drop(holder, name); }, 2));
    Object.defineProperty(holder, name, kept);
    console.log(label, "put back:", run(nothing, -1));
  }
  const own = map();
  Object.defineProperty(own, "size", { value: 5, configurable: true });
  console.log("a size of its own:", sizesOfMap(own, 2, -1, nothing));
  class Odd extends Map<number, number> { get size() { return 40; } }
  console.log("a class below:", sizesOfMap(new Odd([[1, 1]]), 2, -1, nothing));
  for (const holder of [roads.aboveMaps, roads.aboveSets]) roads.drop(holder, roads.named("no", "thing"));
  all("taken away:");
});
