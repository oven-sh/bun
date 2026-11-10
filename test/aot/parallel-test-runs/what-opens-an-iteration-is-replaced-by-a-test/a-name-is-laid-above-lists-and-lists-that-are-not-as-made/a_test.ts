import { test } from "bun:test";
import * as roads from "./roads";
import { firstAndRest, firstTwo, Holder, list, spreadIntoCall, spreadList, walkAnything, walkEntries, walkKeys, walkList, walkValues } from "./app";
class Odd extends Array<number> { *[Symbol.iterator](): any { yield 40; } }
class Plain extends Array<number> {}
const nothing = () => {};
const all = (things: number[]) => [walkList(things, -1, nothing), walkAnything(things, -1, nothing), spreadList(things), firstTwo(things), firstAndRest(things), walkValues(things), walkKeys(things), walkEntries(things), spreadIntoCall(things)].join(" | ");
// All that a loop over a list goes by no compiled test run can change, so such a loop asks the list alone, whatever a test has laid above lists. What the list itself says must still be heard.
test("a name laid above lists changes no loop; a list that is not as made is walked as it says", () => {
  const key = roads.symbolNamed("iter", "ator");
  const holder = new Holder();
  for (const thing of list()) holder.add(thing);
  console.log("as built:", all(list()), holder.walk());
  roads.put(roads.aboveLists, roads.named("no", "thing"), 1);
  console.log("a name laid above lists:", all(list()), holder.walk());
  const own = list();
  roads.put(own, key, function* () { yield 30; });
  console.log("own method:", all(own));
  holder.lay(key, function* () { yield 31; });
  console.log("own method on a list in a field:", holder.walk());
  console.log("classes below:", all(Odd.from([1, 2])), all(Plain.from([1, 2])));
  const turned = list();
  Object.setPrototypeOf(turned, { [Symbol.iterator]: function* () { yield 20; }, values: () => [21][Symbol.iterator](), keys: () => [22][Symbol.iterator](), entries: () => [[23, 24]][Symbol.iterator]() });
  console.log("another prototype:", all(turned));
  const laidInTheMiddle = list();
  console.log("laid in the middle of the loop:", walkList(laidInTheMiddle, 1, () => { roads.put(laidInTheMiddle, key, function* () { yield 50; }); }), walkList(laidInTheMiddle, -1, nothing));
  const growing = list();
  console.log("it grows and shrinks under the loop:", walkList(growing, 1, () => { growing.push(9); }), walkList(growing, 0, () => { growing.length = 2; }), walkList([1, , 3] as number[], -1, nothing));
  for (const name of ["values", "keys", "entries"]) {
    const before = roads.put(roads.aboveLists, roads.named(name), function () { return [[7, 8]][Symbol.iterator](); });
    console.log(name, "replaced:", all(list()), holder.walk());
    roads.put(roads.aboveLists, roads.named(name), before);
    console.log(name, "put back:", all(list()));
  }
  roads.drop(roads.aboveLists, roads.named("no", "thing"));
  console.log("taken away:", all(list()), holder.walk());
});
