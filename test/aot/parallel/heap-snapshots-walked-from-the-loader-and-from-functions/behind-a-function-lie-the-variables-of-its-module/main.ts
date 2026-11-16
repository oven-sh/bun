// From a function a tool comes to what the variables of its module hold, also from one that reads none of them, and from one made inside a call.
import { declared, touchesNothing, makeHolder } from "./tools";
import { variablesBehindFunction } from "./walk";
(globalThis as any).keptForTheWalk = { mark_of_the_first: declared, mark_of_the_second: touchesNothing, mark_of_the_third: makeHolder() };
declared("one");
for (const mark of ["mark_of_the_first", "mark_of_the_second", "mark_of_the_third"]) console.log(mark, variablesBehindFunction(mark, ["shelf", "secret"]));
