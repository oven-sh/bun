import { spyOn, test } from "bun:test";
import * as roads from "./roads";
import { firstOf, holds, lastOf, total } from "./app";
// Every way to write a member of a built-in is heard: a store, defineProperty with a value and with a getter, delete, Reflect.set, Object.assign, a spy and its restore.
const say = (label: string) => console.log(label, firstOf(new Map([[0, 5]]), 2), lastOf([1, 2, 3], 2), holds(new Set([1]), 2), total(new Set([1, 2])));
const places = (): Array<[any, string | symbol]> => [[roads.aboveMaps, roads.named("g", "et")], [roads.aboveLists, roads.named("index", "Of")], [roads.aboveSets, roads.named("h", "as")], [roads.aboveSets, roads.symbolNamed("iter", "ator")]];
const other = (name: string | symbol) => (typeof name === "symbol" ? function* () { yield 8; } : function () { return 8; });
test("each way to write", () => {
  say("as built:");
  const ways: Record<string, (holder: any, name: string | symbol) => void> = {
    "a store": (holder, name) => { holder[name] = other(name); },
    "defineProperty with a value": (holder, name) => { Object.defineProperty(holder, name, { value: other(name), configurable: true, writable: true }); },
    "defineProperty with a getter": (holder, name) => { Object.defineProperty(holder, name, { get: () => other(name), configurable: true }); },
    "Reflect.set": (holder, name) => { Reflect.set(holder, name, other(name)); },
    "Object.assign": (holder, name) => { Object.assign(holder, { [name]: other(name) }); },
  };
  for (const [label, write] of Object.entries(ways)) {
    const kept = places().map(([holder, name]) => Object.getOwnPropertyDescriptor(holder, name)!);
    for (const [holder, name] of places()) write(holder, name);
    say(label + ":");
    places().forEach(([holder, name], at) => Object.defineProperty(holder, name, kept[at]));
    say("put back:");
  }
  const kept = places().map(([holder, name]) => Object.getOwnPropertyDescriptor(holder, name)!);
  for (const [holder, name] of places().slice(0, 3)) roads.drop(holder, name);
  for (const run of [() => firstOf(new Map([[0, 5]]), 1), () => lastOf([1, 2, 3], 1), () => holds(new Set([1]), 1)]) { try { console.log("deleted:", run()); } catch (error) { console.log("deleted:", (error as Error).constructor.name); } }
  places().forEach(([holder, name], at) => Object.defineProperty(holder, name, kept[at]));
  say("put back:");
  const spies = [spyOn(Map.prototype, "get"), spyOn(Array.prototype, "indexOf"), spyOn(Set.prototype, "has")];
  say("spied on:");
  console.log("calls:", spies.map(spy => spy.mock.calls.length).join(","));
  for (const spy of spies) spy.mockRestore();
  say("restored:");
  console.log("calls:", spies.map(spy => spy.mock.calls.length).join(","));
});
