import { test } from "bun:test";
import * as roads from "./roads";
import { adds, codes, gets, looksFor, pops, pushes, sets, walks } from "./app";
// A method that is found next above an instance is asked by a byte of its own. A name that has nothing to do with it, laid above the class or above all objects, turns nothing off and changes nothing;
// the method itself, replaced in the middle of a loop, is found at the next call; put back, the built-in answers again.
const list = () => [0, 1, 2], map = () => new Map([[0, 5], [1, 6]]), set = () => new Set([0, 1]);
const nothing = () => {};
function all(label: string, atTurn: number, then: (holder: any, name: string) => void) {
  console.log(label, "push", pushes(list(), 4, atTurn, () => then(roads.aboveLists, "push")));
  console.log(label, "pop", pops(list(), 4, atTurn, () => then(roads.aboveLists, "pop")));
  console.log(label, "includes", looksFor(list(), 4, atTurn, () => then(roads.aboveLists, "includes")));
  console.log(label, "indexOf", looksFor(list(), 4, atTurn, () => then(roads.aboveLists, "indexOf")));
  console.log(label, "get", gets(map(), 4, atTurn, () => then(roads.aboveMaps, "get")));
  console.log(label, "has", gets(map(), 4, atTurn, () => then(roads.aboveMaps, "has")));
  console.log(label, "set", sets(map(), 4, atTurn, () => then(roads.aboveMaps, "set")));
  console.log(label, "add", adds(set(), 4, atTurn, () => then(roads.aboveSets, "add")));
  console.log(label, "has of sets", adds(set(), 4, atTurn, () => then(roads.aboveSets, "has")));
  console.log(label, "charCodeAt", codes("abcd", 4, atTurn, () => then(roads.aboveTexts, "charCodeAt")));
  console.log(label, "startsWith", codes("abcd", 4, atTurn, () => then(roads.aboveTexts, "startsWith")));
}
test("methods next above instances", () => {
  all("as built:", -1, nothing);
  for (const holder of [roads.aboveLists, roads.aboveMaps, roads.aboveSets, roads.aboveTexts]) roads.put(holder, roads.named("no", "thing"), 1);
  all("a name laid above each class:", -1, nothing);
  const restore: Array<() => void> = [];
  all("replaced at the second turn:", 1, (holder, name) => { const before = roads.put(holder, roads.named(name), function (this: unknown) { return 77; }); restore.push(() => roads.put(holder, roads.named(name), before)); });
  all("still replaced:", -1, nothing);
  for (const back of restore) back();
  all("put back:", -1, nothing);
  const key = roads.symbolNamed("iter", "ator");
  console.log("loops as built:", walks(set(), map(), 3, -1, nothing));
  for (const [holder, name] of [[roads.aboveSets, key], [roads.aboveMaps, key], [roads.aboveMaps, "values"], [roads.aboveSets, "keys"]] as const) {
    let before: unknown;
    console.log("opener replaced at the second turn:", String(name), walks(set(), map(), 3, 1, () => { before = roads.put(holder, name, holder === roads.aboveMaps && name === key ? function* () { yield [9, 9]; } : function* () { yield 9; }); }));
    roads.put(holder, name, before);
    console.log("put back:", String(name), walks(set(), map(), 2, -1, nothing));
  }
});
