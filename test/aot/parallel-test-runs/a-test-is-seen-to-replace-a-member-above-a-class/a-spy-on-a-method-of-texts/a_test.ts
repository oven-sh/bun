// spyOn names the prototype and the method.
import { spyOn, test } from "bun:test";
import { codes, codesWithHook, cut, fixed, found, owns, total, totalOfSet } from "./app";
const named = (...parts: string[]): string => parts.join("");
function all(): string {
  const text = named("ab", "cd"), list = [1, 2, 3].map(value => value + text.length - 4);
  const shown: unknown[] = [];
  for (const ask of [() => codes(text), () => cut(text), () => total(list), () => totalOfSet(new Set(list)), () => found(new Map([[text, 5]]), text), () => fixed(list.length / 2), () => owns(list, "0")]) {
    try {
      shown.push(ask());
    } catch (error) {
      shown.push((error as Error).constructor.name);
    }
  }
  return shown.join(" ");
}
test("spyOn names the prototype and the method.", () => {
  console.log(all());
  const spy = spyOn(String.prototype, "slice").mockImplementation(function () { return "spied"; });
  console.log(all(), spy.mock.calls.length);
  spy.mockRestore();
  console.log(all());
});
