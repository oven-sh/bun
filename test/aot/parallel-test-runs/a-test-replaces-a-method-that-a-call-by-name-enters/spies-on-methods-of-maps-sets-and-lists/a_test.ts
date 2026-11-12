// Each spy answers for its method; the calls are counted.
import { spyOn, test } from "bun:test";
import { Ledger, asked, cut, emptied, got, matched, popped } from "./app";
const named = (...parts: string[]): string => parts.join("");
function all(): string {
  const shown: unknown[] = [];
  const key = {};
  for (const ask of [
    () => { const ledger = new Ledger(); for (const line of [" a,1", "b ,2", "a,3"]) ledger.add(line); return ledger.says(); },
    () => emptied(new Set<any>([new Map([[1, 2]]), new Set([3]), new Map(), { size: 9, clear() { this.size = 4; } }])),
    () => asked(new Map([[key, 1]]), key) + " " + asked(new Set([1]), 2) + " " + asked(new WeakMap([[key, 1]]), key) + " " + asked(new WeakSet([key]), {}) + " " + asked({ has: () => "own" }, 0),
    () => got(new Map([[named("k"), 5]]), () => named("k")) + " " + got(new WeakMap([[key, 6]]), () => key),
    () => cut(named(" a", "b ")),
    () => matched(new RegExp(named("b", "+")), named("ab", "bc")),
    () => popped([1, 2, 3].map(value => value + named("").length)),
  ]) {
    try {
      shown.push(ask());
    } catch (error) {
      shown.push((error as Error).constructor.name);
    }
  }
  return shown.join(" ; ");
}
test("Each spy answers for its method; the calls are counted.", () => {
  console.log(all());
  const spies = [spyOn(Map.prototype, "get").mockImplementation(function () { return 70; }), spyOn(Set.prototype, "has").mockImplementation(function () { return "spied" as any; }),
    spyOn(Array.prototype, "push").mockImplementation(function () { return 0; }), spyOn(Array.prototype, "includes")];
  console.log(all(), spies.map(spy => spy.mock.calls.length > 0).join());
  for (const spy of spies) spy.mockRestore();
  console.log(all());
});
