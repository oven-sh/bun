import { test } from "bun:test";
import * as roads from "./roads";
import { firstOf, lengthOfView, owns, ownsInMap, placeOf } from "./app";
// What stands between an instance and the method: a property of the instance's own, a class below, another prototype: the instance says it, whatever has been laid above its class.
// (A name added next above the instances that would shadow a member found two steps up, `hasOwnProperty` above lists, a compiled test run refuses.)
class Below extends Map<number, number> { get(key: number) { return 40 + key; } }
class Plain extends Map<number, number> {}
class ListBelow extends Array<number> { indexOf() { return 41; } }
test("what shadows a method", () => {
  const map = () => new Map([[0, 5]]), list = () => [1, 2, 3];
  console.log("as built:", firstOf(map(), 2), placeOf(list(), 2), owns(list(), 2), ownsInMap(map(), 2), lengthOfView(new Uint8Array([1, 2]), 2));
  const own = map(); roads.put(own, roads.named("g", "et"), () => 30);
  const ownList = list(); roads.put(ownList, roads.named("index", "Of"), () => 31);
  console.log("of its own:", firstOf(own, 2), placeOf(ownList, 2));
  console.log("classes below:", firstOf(new Below([[0, 5]]), 2), firstOf(new Plain([[0, 5]]), 2), placeOf(ListBelow.from([1, 2]), 2));
  const turned = map(); Object.setPrototypeOf(turned, { get: () => 20 });
  const turnedList = list(); Object.setPrototypeOf(turnedList, { indexOf: () => 21 });
  console.log("another prototype:", firstOf(turned, 2), placeOf(turnedList, 2));
  roads.put(roads.aboveLists, roads.named("no", "thing"), 1);
  roads.put(roads.aboveMaps, roads.named("no", "thing"), 1);
  console.log("behind a name laid above:", firstOf(map(), 2), placeOf(list(), 2), owns(list(), 2), ownsInMap(map(), 2), firstOf(own, 2), placeOf(ownList, 2), firstOf(new Below([[0, 5]]), 2), placeOf(ListBelow.from([1, 2]), 2), firstOf(turned, 2), placeOf(turnedList, 2));
});
