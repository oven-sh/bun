// In a test run too every function of the product leads to a scope of its module.
import { test } from "bun:test";
import { declared, arrow, touchesNothing, WithFields, WithConstructor, Empty, Derived, OldStyle, makeCounter, makeHolder, bound, waits, yields, literal } from "./tools";
import { plainSum } from "./bare";
import { functionsHeldUnder } from "./walk";
test("a", () => {
  const counter = makeCounter();
  const held = { mark_of_what_is_held: { declared, arrow, touchesNothing, WithFields, WithConstructor, Empty, Derived, OldStyle, up: counter.up, read: counter.read, holder: makeHolder(), bound, waits, yields, plainSum, method: new WithFields().method, more: new Derived().more, ofLiteral: literal.method, arrowOfLiteral: literal.arrow } };
  (globalThis as any).keptForTheWalk = held;
  declared("one"); counter.up();
  for (const line of functionsHeldUnder("mark_of_what_is_held")) console.log(line);
});
