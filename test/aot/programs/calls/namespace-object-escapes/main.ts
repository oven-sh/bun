// A module whose exported setter nobody calls and nobody names, but whose namespace object gets away in one way a file: the setter is found all the same, and what it stores is called.
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
function seven(): number { return 7; }
const hookWord: string = ["Hook"][lines.length];
const held: any[] = [];
function takes(ns: any): void { ns["set" + hookWord](seven); }
import * as asAValue from "./asAValue.ts";
import { inner } from "./outer.ts";
import { callHook as callThis } from "./aMethodThatReadsThis.ts";
import { callHook as callThenable } from "./aThenable.ts";
import { callHook as call0 } from "./aComputedKey.ts";
import { callHook as call1 } from "./itsKeys.ts";
import { callHook as call2 } from "./itsValues.ts";
import { callHook as call3 } from "./aSpread.ts";
import { callHook as call4 } from "./anArgument.ts";
import { callHook as call5 } from "./aThen.ts";
import { callHook as call6 } from "./aFunctionThatReturnsThePromise.ts";
import { callHook as call7 } from "./aStore.ts";
import { callHook as call8 } from "./aForIn.ts";
import { callHook as call9 } from "./aRestInAPattern.ts";
import { callHook as call10 } from "./reflection.ts";
import { callHook as call11 } from "./aDescriptor.ts";
import { callHook as call12 } from "./itsName.ts";
import { callHook as call13 } from "./itsNameInAPattern.ts";
import { callHook as call14 } from "./promiseAll.ts";
import { callHook as call15 } from "./aWrittenType.ts";
import { callHook as call16 } from "./aJoin.ts";
import { callHook as call17 } from "./aClosure.ts";
import { callHook as callWhole } from "./exportedWhole.ts";
import { callHook as callList0 } from "./theListIsKept.ts";
import { callHook as callList1 } from "./theResultsAreHandedOn.ts";
import { callHook as callList2 } from "./aRestOfTheResults.ts";
import { callHook as callList3 } from "./aComputedIndex.ts";
import { callHook as callList4 } from "./aLoopOverTheResults.ts";
import { callHook as callList5 } from "./allSettled.ts";
import { callHook as callList6 } from "./aRace.ts";
import { callHook as callList7 } from "./thePromiseOfAllIsKept.ts";
import { callHook as callList8 } from "./aPromiseOfOnesOwn.ts";
import { callHook as callList9 } from "./takenApartAndReadByName.ts";
function takesList(list: any[]): void { list[0]["set" + hookWord](seven); }
const seenByMine: any[] = [];
class Mine<T> extends Promise<T> { static all(list: any): any { return Promise.all(list).then(results => { seenByMine.push(...results); return results; }); } }
async function all(): Promise<void> {
    { say("aComputedKey, before", call0()); const ns: any = await import("./aComputedKey.ts"); ns["set" + hookWord](seven); say("aComputedKey", call0()); }
    { say("itsKeys, before", call1()); const ns: any = await import("./itsKeys.ts"); for (const key of Object.keys(ns)) if (key.startsWith("set")) ns[key](seven); say("itsKeys", call1()); }
    { say("itsValues, before", call2()); const ns = await import("./itsValues.ts"); for (const value of Object.values(ns) as any[]) if (value.length === 1) value(seven); say("itsValues", call2()); }
    { say("aSpread, before", call3()); const copy: any = { ...(await import("./aSpread.ts")) }; copy.setHook(seven); say("aSpread", call3()); }
    { say("anArgument, before", call4()); takes(await import("./anArgument.ts")); say("anArgument", call4()); }
    { say("aThen, before", call5()); await import("./aThen.ts").then(ns => ns.setHook(seven)); say("aThen", call5()); }
    { say("aFunctionThatReturnsThePromise, before", call6()); const load = () => import("./aFunctionThatReturnsThePromise.ts"); (await load()).setHook(seven); say("aFunctionThatReturnsThePromise", call6()); }
    { say("aStore, before", call7()); held.push(await import("./aStore.ts")); held[held.length - 1].setHook(seven); say("aStore", call7()); }
    { say("aForIn, before", call8()); const ns: any = await import("./aForIn.ts"); for (const key in ns) if (key === "setHook") ns[key](seven); say("aForIn", call8()); }
    { say("aRestInAPattern, before", call9()); const { unrelated, ...rest } = await import("./aRestInAPattern.ts"); (rest as any).setHook(seven); say("unrelated", unrelated()); say("aRestInAPattern", call9()); }
    { say("reflection, before", call10()); const ns = await import("./reflection.ts"); Reflect.get(ns, "setHook")(seven); say("reflection", call10()); }
    { say("aDescriptor, before", call11()); const ns = await import("./aDescriptor.ts"); Object.getOwnPropertyDescriptor(ns, "setHook")!.value(seven); say("aDescriptor", call11()); }
    { say("itsName, before", call12()); (await import("./itsName.ts")).setHook(seven); say("itsName", call12()); }
    { say("itsNameInAPattern, before", call13()); const { setHook } = await import("./itsNameInAPattern.ts"); setHook(seven); say("itsNameInAPattern", call13()); }
    { say("promiseAll, before", call14()); const [ns] = await Promise.all([import("./promiseAll.ts")]); ns.setHook(seven); say("promiseAll", call14()); }
    { say("aWrittenType, before", call15()); const ns: { setHook(fn: () => number): void } = await import("./aWrittenType.ts"); ns.setHook(seven); say("aWrittenType", call15()); }
    { say("aJoin, before", call16()); const ns = hookWord.length > 2 ? await import("./aJoin.ts") : undefined; (ns as any)["set" + hookWord](seven); say("aJoin", call16()); }
    { say("aClosure, before", call17()); const ns = await import("./aClosure.ts"); const later = () => (ns as any)["set" + hookWord](seven); later(); say("aClosure", call17()); }
    { say("theListIsKept, before", callList0()); const list = [import("./theListIsKept.ts")]; held.push(list); const [ns] = await Promise.all(list); say("unrelated", ns.unrelated()); (await held[held.length - 1][0])["set" + hookWord](seven); say("theListIsKept", callList0()); }
    { say("theResultsAreHandedOn, before", callList1()); const results = await Promise.all([import("./theResultsAreHandedOn.ts")]); takesList(results); say("theResultsAreHandedOn", callList1()); }
    { say("aRestOfTheResults, before", callList2()); const [...every] = await Promise.all([import("./aRestOfTheResults.ts")]); (every[0] as any)["set" + hookWord](seven); say("aRestOfTheResults", callList2()); }
    { say("aComputedIndex, before", callList3()); const results = await Promise.all([import("./aComputedIndex.ts")]); (results[held.length - held.length] as any)["set" + hookWord](seven); say("aComputedIndex", callList3()); }
    { say("aLoopOverTheResults, before", callList4()); for (const ns of await Promise.all([import("./aLoopOverTheResults.ts")])) (ns as any)["set" + hookWord](seven); say("aLoopOverTheResults", callList4()); }
    { say("allSettled, before", callList5()); const [settled] = await Promise.allSettled([import("./allSettled.ts")]); (settled as any).value["set" + hookWord](seven); say("allSettled", callList5()); }
    { say("aRace, before", callList6()); const ns: any = await Promise.race([import("./aRace.ts")]); ns["set" + hookWord](seven); say("aRace", callList6()); }
    { say("thePromiseOfAllIsKept, before", callList7()); const promise = Promise.all([import("./thePromiseOfAllIsKept.ts")]); held.push(promise); const [ns] = await promise; say("unrelated", ns.unrelated()); (await held[held.length - 1])[0]["set" + hookWord](seven); say("thePromiseOfAllIsKept", callList7()); }
    { say("aPromiseOfOnesOwn, before", callList8()); const [ns] = await Mine.all([import("./aPromiseOfOnesOwn.ts")]); say("unrelated", ns.unrelated()); seenByMine[0]["set" + hookWord](seven); say("aPromiseOfOnesOwn", callList8()); }
    { say("takenApartAndReadByName, before", callList9()); const [first, { setHook }] = await Promise.all([import("./itsName.ts"), import("./takenApartAndReadByName.ts")]); say("unrelated", first.unrelated()); setHook(seven); say("takenApartAndReadByName", callList9()); }
    { say("asAValue, before", asAValue.callHook()); takes(asAValue); say("asAValue", asAValue.callHook()); }
    { say("exportedWhole, before", callWhole()); takes(inner); say("exportedWhole", callWhole()); }
    { say("aMethodThatReadsThis, before", callThis()); ((await import("./aMethodThatReadsThis.ts")).self() as any)["set" + hookWord](seven); say("aMethodThatReadsThis", callThis()); }
    { say("aThenable, before", callThenable()); say("what the await yields", await import("./aThenable.ts")); say("aThenable", callThenable()); }
}
all().then(() => console.log(lines.join("\n")), error => console.log(lines.join("\n") + "\nfailed: " + error));
