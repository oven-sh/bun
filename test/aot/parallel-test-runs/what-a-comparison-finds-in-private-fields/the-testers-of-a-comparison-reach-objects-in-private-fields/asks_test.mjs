// Guards: where expect.objectContaining() compares the objects that two private fields hold, it asks the equality testers of the comparison that it is a part of: the registered ones under a matcher, and the list under this.equals().
import { expect, test } from "bun:test";
class Holder { #kept; constructor(kept) { this.#kept = kept; } }
const bothHave = key => (a, b) => a !== null && b !== null && typeof a === "object" && typeof b === "object" && key in a && key in b ? true : undefined;
const says = check => { try { check(); return "passes"; } catch (error) { return error.constructor.name; } };
const pair = key => [new Holder({ [key]: 1, more: 1 }), expect.objectContaining(new Holder({ [key]: 2 }))];
test("a registered tester", () => {
  const held = key => says(() => expect(pair(key)[0]).toEqual(pair(key)[1]));
  console.log("before", held("registered"));
  expect.addEqualityTesters([bothHave("registered")]);
  console.log("registered", held("registered"), held("other"));
});
test("the list of this.equals()", () => {
  let equals;
  expect.extend({ toLend() { equals = this.equals; return { pass: true, message: () => "" }; } });
  expect(0).toLend();
  console.log("listed", equals(...pair("listed"), [bothHave("listed")]), equals(...pair("listed")), equals(...pair("registered"), [bothHave("listed")]));
});
