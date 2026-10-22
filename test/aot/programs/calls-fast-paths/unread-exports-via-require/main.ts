// An ES module is taken by require(), and all that is ever done with its namespace object is to read members by constant names, also behind `as typeof import(..)`. An export that nobody calls, names or reads is not in the program.
// IR+ ^variable g\d+ name="hookOfAPatternAndAnAssertion" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfAMethodCall" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfKeptInAConstant" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfRequiredTwice" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfRequiredAndImported" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfByUntypedCode" .*declared=f\d+( |$)
import { callHook as call0 } from "./aPatternAndAnAssertion.ts";
import { callHook as call1 } from "./aMethodCall.ts";
import { callHook as call2 } from "./keptInAConstant.ts";
import { callHook as call3 } from "./requiredTwice.ts";
import { callHook as call4 } from "./requiredAndImported.ts";
import { callHook as callUntyped } from "./byUntypedCode.ts";
import { readsByName } from "./untyped.js";
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
async function all(): Promise<void> {
    { const { unrelated } = require("./aPatternAndAnAssertion.ts") as typeof import("./aPatternAndAnAssertion.ts"); say("aPatternAndAnAssertion", unrelated()); } say("aPatternAndAnAssertion, the hook", call0());
    say("aMethodCall", require("./aMethodCall.ts").unrelated()); say("aMethodCall, the hook", call1());
    { const ns = require("./keptInAConstant.ts"); say("keptInAConstant", ns.unrelated(), typeof ns.unrelated, ns.__esModule); } say("keptInAConstant, the hook", call2());
    { const first = require("./requiredTwice.ts"); const second = require("./requiredTwice.ts") as typeof import("./requiredTwice.ts"); say("requiredTwice", first.unrelated(), second.unrelated(), first === second); } say("requiredTwice, the hook", call3());
    { const ns = require("./requiredAndImported.ts") as typeof import("./requiredAndImported.ts"); const { unrelated } = await import("./requiredAndImported.ts"); say("requiredAndImported", ns.unrelated(), unrelated()); } say("requiredAndImported, the hook", call4());
    say("byUntypedCode", readsByName()); say("byUntypedCode, the hook", callUntyped());
}
all().then(() => console.log(lines.join("\n")), error => console.log(lines.join("\n") + "\nfailed: " + error));
