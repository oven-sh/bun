// A module is imported by import() or require(), and a member of its namespace object that is an exported variable is called where it is read: `ns.member()` hands the namespace object over as `this`. Where every store to the variable stores a closure of a function that has no `this`, nobody receives it, and an export that nobody calls, names or reads is not in the program.
// IR+ ^variable g\d+ name="hookOfAnArrow" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfAFunctionExpression" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfStoredTwice" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfAClosure" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfRequired" .*declared=f\d+( |$)
import { callHook as call0 } from "./anArrow.ts";
import { callHook as call1 } from "./aFunctionExpression.ts";
import { callHook as call2 } from "./storedTwice.ts";
import { callHook as call3 } from "./aClosure.ts";
import { callHook as call4 } from "./required.ts";
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
async function all(): Promise<void> {
    { const ns = await import("./anArrow.ts"); say("anArrow", ns.unrelated(), call0()); }
    { const ns = await import("./aFunctionExpression.ts"); say("aFunctionExpression", ns.unrelated(), call1()); }
    { const ns = await import("./storedTwice.ts"); say("storedTwice", ns.unrelated()); ns.swap(); say("storedTwice, swapped", ns.unrelated(), call2()); }
    { const ns = await import("./aClosure.ts"); say("aClosure", ns.unrelated()); ns.prepare(); say("aClosure, prepared", ns.unrelated(), call3()); }
    { const ns = require("./required.ts") as typeof import("./required.ts"); say("required", ns.unrelated(), call4()); }
}
all().then(() => console.log(lines.join("\n")), error => console.log(lines.join("\n") + "\nfailed: " + error));
