// In a test run too a function that was made inside a call leads to a scope of its module, though no variable of that module holds an object.
import { test } from "bun:test";
import { makeAdder } from "./makers";
import { functionsHeldUnder } from "./walk";
test("a", () => {
  (globalThis as any).keptForTheWalk = { mark_of_what_is_held: { adder: makeAdder(1) } };
  for (const line of functionsHeldUnder("mark_of_what_is_held")) console.log(line);
});
