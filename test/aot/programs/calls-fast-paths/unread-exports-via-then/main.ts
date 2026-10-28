// A module is imported by import(), and its namespace object goes through then, catch and finally into handlers that read members by constant names and do nothing else with it. An export that nobody calls, names or reads is not in the program.
// IR+ ^variable g\d+ name="hookOfAHandler" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfAPatternInTheHandler" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfTheHandlerReturnsIt" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfBehindCatch" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfBehindFinally" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfAnAsyncHandler" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfTwoHandlers" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfAFunctionByName" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfFirstOfAll" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfSecondOfAll" .*declared=f\d+( |$)
import { callHook as call0 } from "./aHandler.ts";
import { callHook as call1 } from "./aPatternInTheHandler.ts";
import { callHook as call2 } from "./theHandlerReturnsIt.ts";
import { callHook as call3 } from "./behindCatch.ts";
import { callHook as call4 } from "./behindFinally.ts";
import { callHook as call5 } from "./anAsyncHandler.ts";
import { callHook as call6 } from "./twoHandlers.ts";
import { callHook as call7 } from "./aFunctionByName.ts";
import { callHook as callAll0 } from "./firstOfAll.ts";
import { callHook as callAll1 } from "./secondOfAll.ts";
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
function readsUnrelated(ns: typeof import("./aFunctionByName.ts")): number { return ns.unrelated(); }
async function all(): Promise<void> {
    say("aHandler", await import("./aHandler.ts").then(ns => ns.unrelated())); say("aHandler, the hook", call0());
    say("aPatternInTheHandler", await import("./aPatternInTheHandler.ts").then(({ unrelated }) => unrelated())); say("aPatternInTheHandler, the hook", call1());
    { const ns = await import("./theHandlerReturnsIt.ts").then(m => m); say("theHandlerReturnsIt", ns.unrelated()); } say("theHandlerReturnsIt, the hook", call2());
    say("behindCatch", await import("./behindCatch.ts").catch(() => undefined).then(ns => ns?.unrelated())); say("behindCatch, the hook", call3());
    say("behindFinally", await import("./behindFinally.ts").finally(() => { lines.push("finally"); }).then(ns => ns.unrelated())); say("behindFinally, the hook", call4());
    say("anAsyncHandler", await import("./anAsyncHandler.ts").then(async ns => ns.unrelated())); say("anAsyncHandler, the hook", call5());
    say("twoHandlers", await import("./twoHandlers.ts").then(m => m).then(m => m.unrelated())); say("twoHandlers, the hook", call6());
    say("aFunctionByName", await import("./aFunctionByName.ts").then(readsUnrelated)); say("aFunctionByName, the hook", call7());
    say("all", await Promise.all([import("./firstOfAll.ts"), import("./secondOfAll.ts")]).then(([first, { unrelated }]) => first.unrelated() + unrelated())); say("all, the hooks", callAll0(), callAll1());
}
all().then(() => console.log(lines.join("\n")), error => console.log(lines.join("\n") + "\nfailed: " + error));
