// A module whose exported setter nobody calls and nobody names, and whose namespace object goes through then, catch or finally and gets away behind them, in one way a file: the setter is found all the same, and what it stores is called.
import { callHook as call0 } from "./handedOnByTheHandler.ts";
import { callHook as call1 } from "./anUnknownHandler.ts";
import { callHook as call2 } from "./aRestParameter.ts";
import { callHook as call3 } from "./theArgumentsObject.ts";
import { callHook as call4 } from "./returnedAndHandedOn.ts";
import { callHook as call5 } from "./thePromiseOfThenIsKept.ts";
import { callHook as call6 } from "./aSecondHandler.ts";
import { callHook as call7 } from "./aWrittenTypeInTheHandler.ts";
import { callHook as call8 } from "./aComputedKeyInTheHandler.ts";
import { callHook as call9 } from "./theListIsHandedOn.ts";
import { callHook as call10 } from "./passedThroughThenWithoutAHandler.ts";
import { callHook as call11 } from "./storedByTheHandler.ts";
import { callHook as call12 } from "./spreadByTheHandler.ts";
import { callHook as call13 } from "./aBoundFunction.ts";
import { callHook as call14 } from "./readByNameInTheHandler.ts";
import { callHook as call15 } from "./behindCatchAndHandedOn.ts";
import { callHook as call16 } from "./theHandlerIsCalledElsewhereToo.ts";
import { callHook as call17 } from "./aMemberOfThePromiseByAKey.ts";
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
function seven(): number { return 7; }
const hookWord: string = ["Hook"][lines.length];
const thenWord: string = ["then"][lines.length];
const held: any[] = [];
const kept: any[] = [];
function takes(ns: any): void { ns["set" + hookWord](seven); }
function takesList(list: any[]): void { list[0]["set" + hookWord](seven); }
const handlers: ((ns: any) => void)[] = [takes];
async function all(): Promise<void> {
    { say("handedOnByTheHandler, before", call0()); await import("./handedOnByTheHandler.ts").then(ns => takes(ns)); say("handedOnByTheHandler", call0()); }
    { say("anUnknownHandler, before", call1()); await import("./anUnknownHandler.ts").then(handlers[held.length]); say("anUnknownHandler", call1()); }
    { say("aRestParameter, before", call2()); await import("./aRestParameter.ts").then((...every: any[]) => every[0]["set" + hookWord](seven)); say("aRestParameter", call2()); }
    { say("theArgumentsObject, before", call3()); await import("./theArgumentsObject.ts").then(function () { arguments[0]["set" + hookWord](seven); }); say("theArgumentsObject", call3()); }
    { say("returnedAndHandedOn, before", call4()); takes(await import("./returnedAndHandedOn.ts").then(m => m)); say("returnedAndHandedOn", call4()); }
    { say("thePromiseOfThenIsKept, before", call5()); { const promise = import("./thePromiseOfThenIsKept.ts").then(m => m); kept.push(promise); (await kept[kept.length - 1])["set" + hookWord](seven); } say("thePromiseOfThenIsKept", call5()); }
    { say("aSecondHandler, before", call6()); await import("./aSecondHandler.ts").then(m => m).then(m => (m as any)["set" + hookWord](seven)); say("aSecondHandler", call6()); }
    { say("aWrittenTypeInTheHandler, before", call7()); await import("./aWrittenTypeInTheHandler.ts").then((m: { setHook(fn: () => number): void }) => m.setHook(seven)); say("aWrittenTypeInTheHandler", call7()); }
    { say("aComputedKeyInTheHandler, before", call8()); await import("./aComputedKeyInTheHandler.ts").then(m => (m as any)["set" + hookWord](seven)); say("aComputedKeyInTheHandler", call8()); }
    { say("theListIsHandedOn, before", call9()); await Promise.all([import("./theListIsHandedOn.ts")]).then(list => takesList(list)); say("theListIsHandedOn", call9()); }
    { say("passedThroughThenWithoutAHandler, before", call10()); { const ns: any = await import("./passedThroughThenWithoutAHandler.ts").then(undefined, () => undefined); ns["set" + hookWord](seven); } say("passedThroughThenWithoutAHandler", call10()); }
    { say("storedByTheHandler, before", call11()); { let found: any; await import("./storedByTheHandler.ts").then(m => { found = m; }); found["set" + hookWord](seven); } say("storedByTheHandler", call11()); }
    { say("spreadByTheHandler, before", call12()); { const copy: any = await import("./spreadByTheHandler.ts").then(m => ({ ...m })); copy.setHook(seven); } say("spreadByTheHandler", call12()); }
    { say("aBoundFunction, before", call13()); await import("./aBoundFunction.ts").then(takes.bind(null)); say("aBoundFunction", call13()); }
    { say("readByNameInTheHandler, before", call14()); await import("./readByNameInTheHandler.ts").then(m => m.setHook(seven)); say("readByNameInTheHandler", call14()); }
    { say("behindCatchAndHandedOn, before", call15()); takes(await import("./behindCatchAndHandedOn.ts").catch(() => undefined)); say("behindCatchAndHandedOn", call15()); }
    { say("theHandlerIsCalledElsewhereToo, before", call16()); { const both = (m: any) => m["set" + hookWord](seven); both({ setHook() {} }); await import("./theHandlerIsCalledElsewhereToo.ts").then(both); } say("theHandlerIsCalledElsewhereToo", call16()); }
    { say("aMemberOfThePromiseByAKey, before", call17()); await (import("./aMemberOfThePromiseByAKey.ts") as any)[thenWord]((m: any) => m["set" + hookWord](seven)); say("aMemberOfThePromiseByAKey", call17()); }
}
all().then(() => console.log(lines.join("\n")), error => console.log(lines.join("\n") + "\nfailed: " + error));
