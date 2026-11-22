// The same turn reads what was laid.
import { test } from "bun:test";
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
test("The same turn reads what was laid.", () => {
  console.log(all());
  const original = String.prototype.charCodeAt;
  console.log(codesWithHook(named("ab", "cdef"), at => {
    if (at === 2) String.prototype.charCodeAt = function () { return 4; };
  }));
  console.log(all());
  String.prototype.charCodeAt = original;
  console.log(all());
});
