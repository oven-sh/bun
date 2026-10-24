// A module whose exported setter nobody calls and nobody names. `ns.member()` hands the namespace object over as `this`, and the member is an exported variable that holds, or may hold, a function that reads `this`: the setter is found all the same, and what it stores is called. In the last two the promise of import() is asked for its `then`, and that is not called where it is read.
import { callHook as call0 } from "./readsThis.ts";
import { callHook as call1 } from "./givenFromOutside.ts";
import { callHook as call2 } from "./madeByACall.ts";
import { callHook as call3 } from "./oneOfTwo.ts";
import { callHook as call4 } from "./aMethodOfAnObject.ts";
import { callHook as call5 } from "./thenIsKept.ts";
import { callHook as call6 } from "./thenIsBound.ts";
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
function seven(): number { return 7; }
const hookWord: string = ["Hook"][lines.length];
async function all(): Promise<void> {
    { const ns = await import("./readsThis.ts"); say("readsThis, before", call0()); say("readsThis", ns.unrelated(), call0()); }
    { const ns = await import("./givenFromOutside.ts"); say("givenFromOutside, before", ns.unrelated(), call1()); ns.give(function (this: any): number { this.setHook(seven); return 20; }); say("givenFromOutside", ns.unrelated(), call1()); }
    { const ns = await import("./madeByACall.ts"); say("madeByACall, before", call2()); say("madeByACall", ns.unrelated(), call2()); }
    { const ns = await import("./oneOfTwo.ts"); say("oneOfTwo, before", ns.unrelated(), call3()); ns.swap(); say("oneOfTwo", ns.unrelated(), call3()); }
    { const ns = require("./aMethodOfAnObject.ts") as typeof import("./aMethodOfAnObject.ts"); say("aMethodOfAnObject, before", call4()); say("aMethodOfAnObject", ns.unrelated(), call4()); }
    { const promise = import("./thenIsKept.ts"); const then = promise.then; say("thenIsKept, before", call5()); await then.call(promise, (ns: any) => ns["set" + hookWord](seven)); say("thenIsKept", call5()); }
    { const promise = import("./thenIsBound.ts"); const then = promise.then.bind(promise); say("thenIsBound, before", call6()); await then((ns: any) => ns["set" + hookWord](seven)); say("thenIsBound", call6()); }
}
all().then(() => console.log(lines.join("\n")), error => console.log(lines.join("\n") + "\nfailed: " + error));
