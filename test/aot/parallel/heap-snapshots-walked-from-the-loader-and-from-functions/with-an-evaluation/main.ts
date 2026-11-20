// One evaluation anywhere, and unseen code may run in the whole build.
import { declared, arrow, touchesNothing, WithFields, WithConstructor, Empty, Derived, OldStyle, makeCounter, makeHolder, bound, waits, yields, literal } from "./tools";
import { plainSum } from "./bare";
import { functionsHeldUnder, variablesOfLoadedModules } from "./walk";
(0, eval)("0");
const counter = makeCounter();
const held = { mark_of_what_is_held: { declared, arrow, touchesNothing, WithFields, WithConstructor, Empty, Derived, OldStyle, up: counter.up, read: counter.read, holder: makeHolder(), bound, waits, yields, plainSum, method: new WithFields().method, more: new Derived().more, ofLiteral: literal.method, arrowOfLiteral: literal.arrow } };
(globalThis as any).keptForTheWalk = held;
declared("one"); counter.up();
for (const line of functionsHeldUnder("mark_of_what_is_held")) console.log(line);
console.log(variablesOfLoadedModules(["shelf", "secret"]));
