// A function that was made inside a call leads to a scope of its module also where no variable of that module holds an object: the module has begun, so it has a scope.
import { makeAdder } from "./makers";
import { functionsHeldUnder } from "./walk";
(globalThis as any).keptForTheWalk = { mark_of_what_is_held: { adder: makeAdder(1) } };
for (const line of functionsHeldUnder("mark_of_what_is_held")) console.log(line);
