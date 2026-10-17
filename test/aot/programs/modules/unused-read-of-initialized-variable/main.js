// A read of a `const` that is known to find it initialized cannot throw: where nobody uses what it yields (the key of an access under a constant symbol, which is a name), it is not there.
// IR= 0 later GetModuleVariable
// IR= 0 Kept GetModuleVariable
// IR= 1 hoisted GetModuleVariable
import { hoisted, later, Kept, outcomeOfHoisted } from "./keys-and-readers.js";
const lines = [];
function show(what, value) { lines.push(what + ": " + String(value)); }
let total = 0;
for (let i = 0; i < 300; i++) total += new Kept(i).count + later(new Kept(i));
show("total", total);
show("ahead of the declaration", outcomeOfHoisted);
show("behind it", [hoisted(new Kept(5)), later({}), [hoisted, later, Kept].map(kept => kept.name).join()].join());
console.log(lines.join("\n"));
