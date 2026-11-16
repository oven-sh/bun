// import() has loaded a file that imports the module: its body has run, so it has a scope from then on, though none of its variables holds an object.
import { functionsHeldUnder } from "./walk";
const { adder } = await import("./late");
(globalThis as any).keptForTheWalk = { mark_of_what_is_held: { adder } };
for (const line of functionsHeldUnder("mark_of_what_is_held")) console.log(line);
console.log((globalThis as any).makersHaveRun);
