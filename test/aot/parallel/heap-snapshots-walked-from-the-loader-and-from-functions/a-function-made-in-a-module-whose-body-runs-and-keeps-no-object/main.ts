// The module has begun, so it has a scope, and a function that was made inside one of its calls leads there.
import { makeAdder } from "./makers";
import { functionsHeldUnder } from "./walk";
(globalThis as any).keptForTheWalk = { mark_of_what_is_held: { adder: makeAdder(1) } };
for (const line of functionsHeldUnder("mark_of_what_is_held")) console.log(line);
console.log((globalThis as any).makersHaveRun);
