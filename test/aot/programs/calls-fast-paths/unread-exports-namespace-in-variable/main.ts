// The namespace object of a module is kept in a module variable to which nothing else is stored, and all that is ever done with what the variable holds is to read members by constant names. An export that nobody calls, names or reads is not in the program.
// IR+ ^variable g\d+ name="hookOfAConstant" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfSetLater" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfCopiedToAnother" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfImportedAndKept" .*declared=f\d+( |$)
// IR+ ^variable g\d+ name="hookOfReadInAnotherModule" .*declared=f\d+( |$)
import { callHook as call0 } from "./aConstant.ts";
import { callHook as call1 } from "./setLater.ts";
import { callHook as call2 } from "./copiedToAnother.ts";
import { callHook as call3 } from "./importedAndKept.ts";
import { callHook as call4 } from "./readInAnotherModule.ts";
import { keptForOthers } from "./keeper.ts";
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
const aConstant = require("./aConstant.ts") as typeof import("./aConstant.ts");
function readsTheConstant(): number { return aConstant.unrelated(); }
let setLater: typeof import("./setLater.ts") | undefined;
function load(): void { setLater = require("./setLater.ts"); }
function readsWhatWasSetLater(): number { return setLater ? setLater.unrelated() : -1; }
const first = require("./copiedToAnother.ts") as typeof import("./copiedToAnother.ts");
const second = first;
function readsTheCopy(): number { const { unrelated } = second; return unrelated(); }
let imported: typeof import("./importedAndKept.ts") | undefined;
async function all(): Promise<void> {
    say("aConstant", readsTheConstant(), call0());
    say("setLater, before", readsWhatWasSetLater()); load(); say("setLater", readsWhatWasSetLater(), call1());
    say("copiedToAnother", readsTheCopy(), first === second, call2());
    imported = await import("./importedAndKept.ts"); say("importedAndKept", imported.unrelated(), call3());
    say("readInAnotherModule", keptForOthers.unrelated(), call4());
}
all().then(() => console.log(lines.join("\n")), error => console.log(lines.join("\n") + "\nfailed: " + error));
